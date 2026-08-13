terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "zig-zag"
}

variable "github_repo" {
  type    = string
  default = "juanobrach/zig-zag"
}

variable "deploy_branch" {
  type    = string
  default = "main-mvp"
}

provider "aws" { region = var.aws_region }
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-${data.aws_caller_identity.current.account_id}-terraform-state"
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  classic  = "repo:${var.github_repo}"
  with_ids = "repo:${replace(var.github_repo, "/", "@*/")}@*"
}

data "aws_iam_policy_document" "terraform_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "${local.classic}:ref:refs/heads/${var.deploy_branch}",
        "${local.classic}:environment:production-infra",
        "${local.with_ids}:ref:refs/heads/${var.deploy_branch}",
        "${local.with_ids}:environment:production-infra",
      ]
    }
  }
}

resource "aws_iam_role" "github_terraform" {
  name               = "${var.project_name}-github-terraform"
  assume_role_policy = data.aws_iam_policy_document.terraform_assume.json
}

resource "aws_iam_role_policy_attachment" "terraform" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEC2FullAccess",
    "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess",
    "arn:aws:iam::aws:policy/IAMFullAccess",
    "arn:aws:iam::aws:policy/SecretsManagerReadWrite",
    "arn:aws:iam::aws:policy/AmazonS3FullAccess",
    "arn:aws:iam::aws:policy/CloudWatchFullAccessV2",
    "arn:aws:iam::aws:policy/CloudFrontFullAccess",
    "arn:aws:iam::aws:policy/AmazonSSMFullAccess",
  ])
  role       = aws_iam_role.github_terraform.name
  policy_arn = each.value
}

data "aws_iam_policy_document" "terraform_extra" {
  statement {
    actions   = ["budgets:*"]
    resources = ["*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.terraform_state.arn, "${aws_s3_bucket.terraform_state.arn}/*"]
  }
}

resource "aws_iam_role_policy" "terraform_extra" {
  name   = "${var.project_name}-github-terraform-extra"
  role   = aws_iam_role.github_terraform.id
  policy = data.aws_iam_policy_document.terraform_extra.json
}

output "state_bucket" { value = aws_s3_bucket.terraform_state.id }
output "terraform_role_arn" { value = aws_iam_role.github_terraform.arn }
