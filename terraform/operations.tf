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
    frontend_bucket          = aws_s3_bucket.frontend.id
    frontend_distribution_id = aws_cloudfront_distribution.frontend.id
    frontend_url             = "https://${aws_cloudfront_distribution.frontend.domain_name}"
    api_url                  = "https://${aws_cloudfront_distribution.api.domain_name}"
    backend_instance_id      = aws_instance.backend.id
  }
}

resource "aws_ssm_parameter" "infra" {
  for_each = local.infra_parameters
  name     = "/${var.project_name}/prod/infra/${each.key}"
  type     = "String"
  value    = each.value
}
