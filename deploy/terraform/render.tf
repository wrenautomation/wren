# The render Lambda (designs/2026-11-09-render-lambda.md): headless chromium for both lanes'
# page reads and slide paints. x86_64: @sparticuz/chromium's npm package carries the x64 binary.
# The zip is over 50 MB, so its code comes from the backups bucket; CI replaces it (deploy.sh).

variable "render_s3_key" {
  description = "First code for the render Lambda in the backups bucket; CI owns it afterwards."
  type        = string
  default     = "render/initial.zip"
}

resource "aws_cloudwatch_log_group" "render" {
  name              = "/aws/lambda/${local.prefix}-render"
  retention_in_days = 14
}

resource "aws_iam_role" "render" {
  name               = "${local.prefix}-render"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "render" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.render.arn}:*"]
  }
}

resource "aws_iam_role_policy" "render" {
  role   = aws_iam_role.render.id
  policy = data.aws_iam_policy_document.render.json
}

resource "aws_lambda_function" "render" {
  function_name = "${local.prefix}-render"
  role          = aws_iam_role.render.arn
  s3_bucket     = aws_s3_bucket.backups.bucket
  s3_key        = var.render_s3_key
  handler       = "lambda.handler"
  runtime       = var.lambda_runtime
  architectures = ["x86_64"]
  # chromium wants ~1.5 GB on heavy pages; 2 GB at ~5 s is 10 GB-s a render (free tier: 400k a month)
  memory_size = 2048
  timeout     = 60
  # A spend ceiling: at most 4 chromiums at once
  reserved_concurrent_executions = 4

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.render.name
  }

  depends_on = [aws_iam_role_policy.render]

  lifecycle {
    # CI publishes new code; a later apply must not roll it back
    ignore_changes = [s3_key, s3_object_version, source_code_hash]
  }
}

output "render_function" {
  value = aws_lambda_function.render.function_name
}
