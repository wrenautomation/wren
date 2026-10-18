# Turborepo's shared remote cache (designs/2026-10-17-ui-workbench-and-fast-ci.md, B4):
# ducktors/turborepo-remote-cache (MIT) as one Lambda behind a function URL, artifacts in a
# private bucket that forgets them after 30 days. The Mac's gates and CI read and write it.
# Its token is TURBO_TOKEN in SSM env-2; without it the function has no lock, so the plan fails.
# Terraform makes the function once; deploy/turbo-cache/deploy.sh ships its code.

locals {
  turbo_cache_zip = "${path.module}/../turbo-cache/dist/lambda.zip"
}

resource "aws_s3_bucket" "turbo_cache" {
  bucket = "${local.prefix}-turbo-cache"
}

resource "aws_s3_bucket_public_access_block" "turbo_cache" {
  bucket                  = aws_s3_bucket.turbo_cache.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "turbo_cache" {
  bucket = aws_s3_bucket.turbo_cache.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "turbo_cache" {
  bucket = aws_s3_bucket.turbo_cache.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "turbo_cache" {
  bucket = aws_s3_bucket.turbo_cache.id
  rule {
    id     = "expire-30d"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_iam_role" "turbo_cache" {
  name = "${local.prefix}-turbo-cache"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "turbo_cache" {
  name              = "/aws/lambda/${local.prefix}-turbo-cache"
  retention_in_days = 7
}

resource "aws_iam_role_policy" "turbo_cache" {
  name = "turbo-cache"
  role = aws_iam_role.turbo_cache.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.turbo_cache.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.turbo_cache.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.turbo_cache.arn}:*"
      },
    ]
  })
}

data "aws_ssm_parameter" "env_2" {
  name            = aws_ssm_parameter.env_2.name
  with_decryption = true
}

resource "aws_lambda_function" "turbo_cache" {
  function_name    = "${local.prefix}-turbo-cache"
  role             = aws_iam_role.turbo_cache.arn
  filename         = local.turbo_cache_zip
  source_code_hash = fileexists(local.turbo_cache_zip) ? filebase64sha256(local.turbo_cache_zip) : null
  handler          = "lambda.handler"
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  memory_size      = 256
  timeout          = 30
  # A spend ceiling: a flood of requests waits instead of fanning out. 16 holds the 8 integration
  # shards, the CI gates and a Mac at once; 5 throttled a warm run (a miss, never a failure).
  reserved_concurrent_executions = 16

  environment {
    variables = {
      STORAGE_PROVIDER = "s3"
      STORAGE_PATH     = aws_s3_bucket.turbo_cache.bucket
      S3_REGION        = var.region
      TURBO_TOKEN      = lookup(jsondecode(data.aws_ssm_parameter.env_2.value), "TURBO_TOKEN", "")
      LOG_LEVEL        = "warn"
      NODE_OPTIONS     = "--no-deprecation"
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.turbo_cache.name
  }

  lifecycle {
    # deploy.sh ships the code; a plan never needs the zip once the function exists.
    ignore_changes = [filename, source_code_hash]
    precondition {
      condition     = length(lookup(jsondecode(data.aws_ssm_parameter.env_2.value), "TURBO_TOKEN", "")) >= 32
      error_message = "TURBO_TOKEN (32+ characters) must be in SSM env-2 first: an empty token opens the cache."
    }
  }

  depends_on = [aws_iam_role_policy.turbo_cache]
}

# Open to the internet: GitHub's runners call it. The token is the lock.
resource "aws_lambda_function_url" "turbo_cache" {
  function_name      = aws_lambda_function.turbo_cache.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "turbo_cache_url" {
  statement_id           = "FunctionUrlPublic"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.turbo_cache.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "turbo_cache_url_invoke" {
  statement_id             = "FunctionUrlInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.turbo_cache.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# TURBO_API for CI and the Mac. Not secret by itself, but kept out of the public repo.
output "turbo_cache_url" {
  value     = aws_lambda_function_url.turbo_cache.function_url
  sensitive = true
}
