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
      # Newer repos have "immutable subjects": the claim carries owner and repo ids
      # (repo:owner@id/name@id:…). Trust both spellings.
      values = flatten([
        for prefix in distinct(["repo:${var.github_repo}", var.github_sub_prefix]) : [
          "${prefix}:ref:refs/heads/main",
          "${prefix}:environment:production",
        ] if prefix != ""
      ])
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
    # By name, not by reference: a targeted apply of this policy then leaves the functions alone.
    resources = [
      for f in ["worker", "auth"] :
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.me.account_id}:function:${local.prefix}-${f}"
    ]
  }
}

resource "aws_iam_role_policy" "ci" {
  name   = "deploy-worker"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci.json
}
