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

# The portal's browser PUTs an upload straight here with the signed URL.
resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  cors_rule {
    allowed_origins = ["https://app.${var.auth_domain}"]
    allowed_methods = ["PUT"]
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
