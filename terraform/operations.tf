resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly-usd-10"
  budget_type  = "COST"
  limit_amount = "10"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset([50, 80, 100])
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "FORECASTED"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }
}

locals {
  infra_parameters = {
    frontend_bucket           = aws_s3_bucket.frontend.id
    frontend_distribution_id  = aws_cloudfront_distribution.frontend.id
    frontend_url              = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    api_url                   = "https://${aws_cloudfront_distribution.api.domain_name}"
    backend_listener_rule_arn = aws_lb_listener_rule.cloudfront_only.arn
  }

  backend_active_slot_parameter = "/${var.project_name}/prod/infra/backend_active_slot"
  backend_image_tag_parameter   = "/${var.project_name}/prod/infra/backend_image_tag"
}

resource "aws_ssm_parameter" "infra" {
  for_each = local.infra_parameters
  name     = "/${var.project_name}/prod/infra/${each.key}"
  type     = "String"
  value    = each.value
}

# Written by canary-deploy.sh, not by Terraform, past this initial value —
# these track live rollout state that changes between applies.
resource "aws_ssm_parameter" "backend_active_slot" {
  name  = local.backend_active_slot_parameter
  type  = "String"
  value = "blue"

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "backend_image_tag" {
  name  = local.backend_image_tag_parameter
  type  = "String"
  value = "none"

  lifecycle { ignore_changes = [value] }
}
