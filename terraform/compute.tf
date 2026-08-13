resource "aws_cloudwatch_log_group" "backend" {
  name              = "/${var.project_name}/backend"
  retention_in_days = 14
}

resource "aws_launch_template" "backend" {
  name_prefix            = "${var.project_name}-backend-"
  image_id               = data.aws_ami.amazon_linux.id
  instance_type          = var.backend_instance_type
  update_default_version = true

  iam_instance_profile { name = aws_iam_instance_profile.backend.name }
  vpc_security_group_ids = [aws_security_group.backend.id]

  # The instance deploys itself on boot (see the template) by reading the
  # target image tag from backend_image_tag in SSM — user_data content
  # itself never changes per deploy, only that parameter does. That's what
  # lets a plain ASG desired_capacity bump act as the deploy trigger, no
  # launch template version bump needed per deploy.
  user_data = base64encode(templatefile("${path.module}/templates/backend-user-data.sh.tftpl", {
    aws_region          = var.aws_region
    app_parameter       = var.app_config_parameter_name
    image_tag_parameter = local.backend_image_tag_parameter
    db_secret_arn       = aws_db_instance.main.master_user_secret[0].secret_arn
    db_host             = aws_db_instance.main.address
    db_port             = aws_db_instance.main.port
    db_name             = aws_db_instance.main.db_name
    cors_origin         = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    ecr_repository_url  = aws_ecr_repository.backend.repository_url
    backend_log_group   = aws_cloudwatch_log_group.backend.name
  }))

  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 8
      encrypted             = true
      delete_on_termination = true
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.project_name}-backend", Role = "backend" }
  }

  lifecycle { create_before_destroy = true }
}

# Two fixed slots instead of one ASG per deploy: Terraform manages a stable
# set of resources (both always exist) and the CD pipeline only ever flips
# which one is "active" and adjusts desired_capacity/listener weights via the
# AWS API — no repeated `terraform apply` mid-rollout. See canary-deploy.sh.
resource "aws_autoscaling_group" "backend" {
  for_each = toset(["blue", "green"])

  name                = "${var.project_name}-backend-${each.key}"
  vpc_zone_identifier = [aws_subnet.public[0].id]
  target_group_arns   = [aws_lb_target_group.backend[each.key].arn]
  health_check_type   = "ELB"
  # user_data's worst case is dnf install + up to 150s polling the image-tag
  # SSM parameter + image pull + up to 150s polling the container's local
  # health endpoint — comfortably over the previous 120s, which caused the
  # ASG to kill and relaunch instances before they ever finished deploying.
  health_check_grace_period = 300

  # Starts at 0 for both — the active slot is scaled up by the first real
  # deploy through canary-deploy.sh, not by Terraform itself. Changes to
  # desired_capacity made by the CD pipeline between applies are intentional
  # and shouldn't be reverted by a later `terraform apply`.
  min_size         = 0
  max_size         = 1
  desired_capacity = 0

  launch_template {
    id      = aws_launch_template.backend.id
    version = "$Latest"
  }

  tag {
    key                 = "Slot"
    value               = each.key
    propagate_at_launch = true
  }
  tag {
    key                 = "Project"
    value               = var.project_name
    propagate_at_launch = true
  }

  lifecycle { ignore_changes = [desired_capacity] }
}

resource "aws_cloudwatch_metric_alarm" "backend_error_rate" {
  for_each = toset(["blue", "green"])

  alarm_name          = "${var.project_name}-backend-${each.key}-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.backend[each.key].arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_latency" {
  for_each = toset(["blue", "green"])

  alarm_name          = "${var.project_name}-backend-${each.key}-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p95"
  threshold           = 2
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = aws_lb.api.arn_suffix
    TargetGroup  = aws_lb_target_group.backend[each.key].arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_cpu" {
  for_each = toset(["blue", "green"])

  alarm_name          = "${var.project_name}-backend-${each.key}-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Average"
  threshold           = 90
  treat_missing_data  = "notBreaching"
  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.backend[each.key].name
  }
}
