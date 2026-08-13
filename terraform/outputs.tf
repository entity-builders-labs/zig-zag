output "frontend_url" { value = "https://${aws_cloudfront_distribution.frontend.domain_name}" }
output "api_url" { value = "https://${aws_cloudfront_distribution.api.domain_name}" }
output "frontend_bucket" { value = aws_s3_bucket.frontend.id }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "backend_instance_id" { value = aws_instance.backend.id }
output "chroma_instance_id" { value = aws_instance.chroma.id }
output "github_cd_role_arn" { value = aws_iam_role.github_cd.arn }
output "rds_master_secret_arn" {
  value     = aws_db_instance.main.master_user_secret[0].secret_arn
  sensitive = true
}
