data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  github_repo_with_ids = "repo:${replace(var.github_repo, "/", "@*/")}@*"
  github_repo_classic  = "repo:${var.github_repo}"
}

data "aws_iam_policy_document" "github_cd_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
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
        "${local.github_repo_classic}:ref:refs/heads/${var.deploy_branch}",
        "${local.github_repo_classic}:environment:production",
        "${local.github_repo_with_ids}:ref:refs/heads/${var.deploy_branch}",
        "${local.github_repo_with_ids}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "github_cd" {
  name               = "${var.project_name}-github-cd"
  assume_role_policy = data.aws_iam_policy_document.github_cd_assume.json
}

data "aws_iam_policy_document" "github_cd" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage", "ecr:PutImage", "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.frontend.arn]
  }
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
  }
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.frontend.arn]
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/prod/infra/*"]
  }
  statement {
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"]
  }
  statement {
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*"]
    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Project"
      values   = [var.project_name]
    }
  }
  statement {
    actions = [
      "ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation",
      "ec2:DescribeInstances", "rds:DescribeDBInstances",
      "elasticloadbalancing:DescribeTargetHealth",
    ]
    resources = ["*"]
  }
  statement {
    actions   = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [aws_instance.backend.arn, aws_instance.chroma.arn]
  }
  statement {
    actions   = ["rds:StartDBInstance", "rds:StopDBInstance"]
    resources = [aws_db_instance.main.arn]
  }
}

resource "aws_iam_role_policy" "github_cd" {
  name   = "${var.project_name}-github-cd"
  role   = aws_iam_role.github_cd.id
  policy = data.aws_iam_policy_document.github_cd.json
}
