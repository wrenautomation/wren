# The worker as one Lambda. Terraform owns its configuration; CI owns its code
# (update-function-code + publish), so the zip here is only the first upload.

resource "aws_ssm_parameter" "env" {
  name        = "${local.ssm_root}/env"
  description = "JSON object of env names to values; written by deploy/scripts/push-secrets.sh"
  type        = "SecureString"
  tier        = "Advanced" # 8 KB: the service-account key alone is ~2.5 KB
  value       = "{}"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "roster" {
  name        = "${local.ssm_root}/senders_config"
  description = "senders_config.toml: the sender roster; written by deploy/scripts/push-secrets.sh"
  type        = "SecureString"
  tier        = "Advanced" # the roster passes 4 KB
  value       = "# empty roster: push-secrets.sh fills this\n"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.prefix}-worker"
  retention_in_days = 30
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "${local.prefix}-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.worker.arn}:*"]
  }
  statement {
    sid       = "ReadEnv"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.env.arn, aws_ssm_parameter.roster.arn]
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "worker"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_lambda_function" "worker" {
  function_name    = "${local.prefix}-worker"
  role             = aws_iam_role.worker.arn
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  handler          = "app/lambda.handler"
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_s
  publish          = true

  environment {
    variables = merge(
      {
        WREN_SSM_ENV_PARAM    = aws_ssm_parameter.env.name
        WREN_SSM_ROSTER_PARAM = aws_ssm_parameter.roster.name
        WREN_RENDERER         = var.browser_token == "" ? "browserbase" : "cdp"
        WREN_LOG_LEVEL        = "info"
      },
      var.restate_identity_key == "" ? {} : { WREN_RESTATE_IDENTITY_KEY = var.restate_identity_key },
    )
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.worker.name
  }

  depends_on = [aws_iam_role_policy.worker]

  lifecycle {
    # CI publishes new code; a later apply must not roll it back to this zip.
    ignore_changes = [filename, source_code_hash]
  }
}
