# The lake (designs/2026-10-11-lake.md): every database's tables as Parquet, all history, written
# by `wren lake sync` (nightly in CI, .github/workflows/lake.yml) and read by `wren lake sql`. The
# catalog is the wren_lake database on the box. Private, SSE-S3 (no KMS: per-request cost).
# DuckLake never overwrites a file; versions keep a deleted one for 30 days.

resource "aws_s3_bucket" "lake" {
  bucket_prefix = "${local.prefix}-lake-"
}

resource "aws_s3_bucket_public_access_block" "lake" {
  bucket                  = aws_s3_bucket.lake.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "lake" {
  bucket = aws_s3_bucket.lake.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "lake" {
  bucket = aws_s3_bucket.lake.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lake" {
  bucket     = aws_s3_bucket.lake.id
  depends_on = [aws_s3_bucket_versioning.lake]
  rule {
    id     = "deleted-files"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

# CI's nightly sync reads and writes the lake; nothing else in CI touches it.
data "aws_iam_policy_document" "ci_lake" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.lake.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.lake.arn}/*"]
  }
}

resource "aws_iam_role_policy" "ci_lake" {
  name   = "lake"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci_lake.json
}

output "lake_bucket" {
  value = aws_s3_bucket.lake.bucket
}
