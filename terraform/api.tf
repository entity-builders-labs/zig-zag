resource "random_password" "origin_verify" {
  length  = 32
  special = false
}

resource "aws_lb" "api" {
  name               = "${var.project_name}-api"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "backend" {
  for_each = toset(["blue", "green"])

  name     = "${var.project_name}-backend-${each.key}"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200-399"
  }
}

resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"message\":\"Forbidden\"}"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "cloudfront_only" {
  listener_arn = aws_lb_listener.api.arn
  priority     = 10

  action {
    type = "forward"
    forward {
      # Steady-state baseline: all traffic to blue. canary-deploy.sh moves
      # these weights directly via the API during a rollout/rollback — this
      # HCL value is never live once a first deploy has happened, hence the
      # ignore_changes below.
      target_group {
        arn    = aws_lb_target_group.backend["blue"].arn
        weight = 100
      }
      target_group {
        arn    = aws_lb_target_group.backend["green"].arn
        weight = 0
      }
    }
  }

  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  # Migration to the weighted blue/green forward is confirmed live (see plan
  # file) — canary-deploy.sh owns the actual weights from here on, ignore
  # drift so its runtime changes don't show up as perpetual plan diffs.
  lifecycle { ignore_changes = [action] }
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  origin {
    domain_name = aws_lb.api.dns_name
    origin_id   = "api-alb"

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "api-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}
