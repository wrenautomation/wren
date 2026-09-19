# GitHub Actions on main deploys code through OIDC: no long-lived AWS keys in
# GitHub. The role can replace the worker's code and publish a version; it
# cannot touch configuration, the database box, or secrets.
#
# An account may hold only one OIDC provider for GitHub. If this apply fails
# because it exists: terraform import aws_iam_openid_connect_provider.github <arn>

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate chain itself; the list is required, not used.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

data "aws_iam_policy_document" "ci_assume" {
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
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      # A job with `environment:` carries the environment subject, not the branch.
      values = [
        "repo:${var.github_repo}:ref:refs/heads/main",
        "repo:${var.github_repo}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = "${local.prefix}-ci"
  assume_role_policy = data.aws_iam_policy_document.ci_assume.json
}

data "aws_iam_policy_document" "ci" {
  statement {
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:ListVersionsByFunction",
    ]
    resources = [aws_lambda_function.worker.arn]
  }
}

resource "aws_iam_role_policy" "ci" {
  name   = "deploy-worker"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci.json
}
