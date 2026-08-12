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
  default     = "juanobrach/zig-zag"
}

variable "deploy_branch" {
  type    = string
  default = "main-mvp"
}

variable "backend_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "chroma_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "chroma_image" {
  description = "Pinned multi-architecture Chroma image digest."
  type        = string
  default     = "chromadb/chroma@sha256:f9cef32d15ba51e15a7d288d0e0086607921c8761ed6717d722e2c055e04798b"
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
