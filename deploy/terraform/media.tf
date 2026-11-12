# The media store: a video or image a post carries. The CLI uploads it (by
# content hash), the worker signs a day-long GET URL that Graph, TikTok, X and
# the autobrowse box fetch. Private; nothing public reads it directly.

resource "aws_s3_bucket" "media" {
  bucket_prefix = "${local.prefix}-media-"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# A portal file (a post's thumbnail, a story photo): the browser PUTs it on a link
# the worker signs, with the SHA-256 it hashed (packages/starling/inbound/src/media.ts).
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_origins = ["https://app.${var.auth_domain}"]
    allowed_methods = ["PUT"]
    allowed_headers = ["content-type", "x-amz-checksum-sha256"]
    max_age_seconds = 3600
  }
}

# The worker signs GETs (a URL signed by a role that cannot read is refused) and
# uploads a local path of its own.
data "aws_iam_policy_document" "worker_media" {
  statement {
    sid       = "Media"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
  # Canon's files (designs/2026-11-12-canon-files.md): read only, never on a publish path.
  # Reels and posters by record id; screenshots and slides by hash.
  statement {
    sid     = "CanonFiles"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.media.arn}/cache/*/*.mp4",
      "${aws_s3_bucket.media.arn}/cache/*/*.jpg",
      "${aws_s3_bucket.media.arn}/canon/*",
    ]
  }
}

resource "aws_iam_role_policy" "worker_media" {
  name   = "worker-media"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_media.json
}

# Downloaded media and their reads (WA-1029): `cache/<platform>/<id>`, so nothing downloads
# twice. Kept, never expired (store everything): Glacier Instant Retrieval after 30 days,
# same millisecond reads at a sixth of the price. Its 90-day minimum is moot for kept files.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "cache-glacier-ir-30d"
    status = "Enabled"
    filter {
      prefix = "cache/"
    }
    transition {
      days          = 30
      storage_class = "GLACIER_IR"
    }
  }
  rule {
    id     = "abort-uploads-7d"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
