# Client files (D11): what we hand over and what a client uploads to answer an
# ask, under clients/<id>/. Private. The worker signs a PUT for an upload (exact
# size and type) and a GET that lasts minutes; the browser talks to S3 directly.

resource "aws_s3_bucket" "files" {
  bucket_prefix = "${local.prefix}-files-"
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# The portal's browser PUTs an upload straight here with the signed URL, and
# GETs replay chunks for the player.
resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  cors_rule {
    allowed_origins = ["https://app.${var.auth_domain}"]
    allowed_methods = ["PUT", "GET"]
    allowed_headers = ["content-type"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "worker_files" {
  statement {
    sid       = "ClientFiles"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.files.arn}/clients/*"]
  }
}

resource "aws_iam_role_policy" "worker_files" {
  name   = "worker-files"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_files.json
}

# Session replay (designs/2026-10-06-signals.md): the lander's Pages Function
# writes rrweb chunks under site/replays/<view>/ with a put-only key; the worker
# signs a short GET per chunk for the console's player. Kept 90 days.

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "replays-90d"
    status = "Enabled"
    filter {
      prefix = "site/replays/"
    }
    expiration {
      days = 90
    }
  }
}

resource "aws_iam_user" "lander_replays" {
  name = "${local.prefix}-lander-replays"
}

data "aws_iam_policy_document" "lander_replays" {
  statement {
    sid       = "PutReplayChunks"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.files.arn}/site/replays/*"]
  }
}

resource "aws_iam_user_policy" "lander_replays" {
  name   = "put-replays"
  user   = aws_iam_user.lander_replays.name
  policy = data.aws_iam_policy_document.lander_replays.json
}

# The key, bucket and region go to SSM, and from there to the lander's REPLAY_*
# Pages secrets through scripts/secrets.mjs run. A leak can only upload junk that expires.
resource "aws_iam_access_key" "lander_replays" {
  user = aws_iam_user.lander_replays.name
}

resource "aws_ssm_parameter" "lander_replays" {
  name        = "${local.ssm_root}/lander-replays"
  description = "The lander's REPLAY_* Pages secrets: bucket, region, put-only key"
  type        = "SecureString"
  value = jsonencode({
    REPLAY_BUCKET = aws_s3_bucket.files.bucket
    REPLAY_REGION = data.aws_region.here.region
    REPLAY_KEY_ID = aws_iam_access_key.lander_replays.id
    REPLAY_SECRET = aws_iam_access_key.lander_replays.secret
  })
}

data "aws_iam_policy_document" "worker_replays" {
  statement {
    sid       = "ReadReplays"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.files.arn}/site/replays/*"]
  }
}

resource "aws_iam_role_policy" "worker_replays" {
  name   = "worker-replays"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_replays.json
}
