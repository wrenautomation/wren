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
  type        = "String"   # addresses and copy, no secrets; skips a KMS read per cold start
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
  # Domain provisioning (Domain/{domain}): append to the roster, keep each new
  # inbox's password under /<name>/inboxes/, recycle itself so the fleet reloads.
  statement {
    sid     = "ProvisionWrite"
    actions = ["ssm:PutParameter"]
    resources = [
      aws_ssm_parameter.roster.arn,
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter/${var.name}/inboxes/*",
    ]
  }
  statement {
    sid       = "EncryptSsm"
    actions   = ["kms:Encrypt", "kms:GenerateDataKey"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
  # Content calls run on autobrowse's box; the worker wakes it (start + our started-by tag).
  dynamic "statement" {
    for_each = var.autobrowse_instance_id == "" ? [] : [var.autobrowse_instance_id]
    content {
      sid       = "WakeAutobrowse"
      actions   = ["ec2:StartInstances", "ec2:CreateTags"]
      resources = ["arn:aws:ec2:${var.region}:${data.aws_caller_identity.me.account_id}:instance/${statement.value}"]
    }
  }
  dynamic "statement" {
    for_each = var.autobrowse_instance_id == "" ? [] : [1]
    content {
      sid       = "SeeAutobrowse"
      actions   = ["ec2:DescribeInstances"]
      resources = ["*"]
    }
  }
  statement {
    sid       = "RecycleSelf"
    actions   = ["lambda:UpdateFunctionConfiguration", "lambda:GetFunctionConfiguration"]
    resources = ["arn:aws:lambda:${var.region}:${data.aws_caller_identity.me.account_id}:function:${local.prefix}-worker"]
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
  # A spend ceiling: each concurrent run costs ~$1.44/day at 1 GB. Restate retries throttles.
  reserved_concurrent_executions = var.lambda_max_concurrency

  environment {
    variables = merge(
      {
        WREN_SSM_ENV_PARAM    = aws_ssm_parameter.env.name
        WREN_SSM_ROSTER_PARAM = aws_ssm_parameter.roster.name
        WREN_RENDERER         = var.browser_token == "" ? "browserbase" : "cdp"
        WREN_LOG_LEVEL        = "info"
        WREN_MEDIA_BUCKET     = aws_s3_bucket.media.bucket
        WREN_FILES_BUCKET     = aws_s3_bucket.files.bucket
        # The pool chain runs on the Postgres box (deploy/scripts/box-worker.sh), not here.
        WREN_POOL_CHAIN_HOST = "box"
      },
      var.restate_identity_key == "" ? {} : { WREN_RESTATE_IDENTITY_KEY = var.restate_identity_key },
      var.autobrowse_instance_id == "" ? {} : { WREN_AUTOBROWSE_INSTANCE_ID = var.autobrowse_instance_id },
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
