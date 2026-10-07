# Wren's sign-in as one Lambda behind a function URL (designs/2026-09-30-client-delivery-portal.md, A5).
# The auth Worker on auth.<domain> is its only caller: it signs each call with the
# edge secret, and the Lambda refuses the rest. Terraform owns the configuration;
# CI owns the code, so the zip here is only the first upload.

variable "auth_lambda_zip" {
  description = "Built by `pnpm --filter @wren/auth-app build:lambda`. CI replaces the code afterwards."
  type        = string
  default     = "../../apps/auth/dist/lambda.zip"
}

variable "auth_domain" {
  description = "The domain whose auth. and app. hosts sign-in serves."
  type        = string
  default     = "wrenautomation.com"
}

resource "aws_cloudwatch_log_group" "auth" {
  name              = "/aws/lambda/${local.prefix}-auth"
  retention_in_days = 30
}

resource "aws_iam_role" "auth" {
  name               = "${local.prefix}-auth"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "auth" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.auth.arn}:*"]
  }
  statement {
    sid     = "ReadEnv"
    actions = ["ssm:GetParameter"]
    # Not the key store's parameter: this Lambda only seals, with the public key below.
    resources = [aws_ssm_parameter.env.arn, aws_ssm_parameter.env_2.arn]
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_role_policy" "auth" {
  name   = "auth"
  role   = aws_iam_role.auth.id
  policy = data.aws_iam_policy_document.auth.json
}

resource "aws_lambda_function" "auth" {
  function_name    = "${local.prefix}-auth"
  role             = aws_iam_role.auth.arn
  filename         = var.auth_lambda_zip
  source_code_hash = filebase64sha256(var.auth_lambda_zip)
  handler          = "index.handler"
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 15
  publish          = true

  environment {
    variables = merge(
      {
        WREN_SSM_ENV_PARAM = join(",", [aws_ssm_parameter.env.name, aws_ssm_parameter.env_2.name])
        WREN_AUTH_ORIGIN   = "https://auth.${var.auth_domain}"
        WREN_AUTH_APPS     = "https://app.${var.auth_domain}"
        WREN_AUTH_MAILBOX  = "william@${var.auth_domain}"
        WREN_AUTH_FROM     = "portal@${var.auth_domain}"
      },
      # Seals a pasted key (/api/keys/stage). Unset: saving a key answers 503.
      var.keystore_public_key == "" ? {} : { WREN_KEYSTORE_PUBLIC = var.keystore_public_key },
    )
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.auth.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_iam_role_policy.auth]
}

# Open to the internet by design; the edge secret is the lock.
resource "aws_lambda_function_url" "auth" {
  function_name      = aws_lambda_function.auth.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "auth_url" {
  statement_id           = "FunctionUrlPublic"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.auth.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "auth_url_invoke" {
  statement_id             = "FunctionUrlInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.auth.function_name
  principal                = "*"
  invoked_via_function_url = true
}

output "auth_lambda_name" {
  value = aws_lambda_function.auth.function_name
}

output "auth_function_url" {
  value = aws_lambda_function_url.auth.function_url
}
