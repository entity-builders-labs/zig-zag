variable "project_name" {
  type    = string
  default = "zig-zag"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repository in owner/name format."
  type        = string
  default     = "jiseruk/zig-zag"
}

variable "deploy_branch" {
  type    = string
  default = "main"
}

variable "backend_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "budget_alert_email" {
  description = "Email that receives the USD 10 monthly budget alerts."
  type        = string
}

variable "app_config_parameter_name" {
  description = "SecureString JSON containing application secrets, seeded outside Terraform."
  type        = string
  default     = "/zig-zag/prod/app"
}
