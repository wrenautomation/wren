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

# The worker signs GETs (a URL signed by a role that cannot read is refused) and
# uploads a local path of its own.
data "aws_iam_policy_document" "worker_media" {
  statement {
    sid       = "Media"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/media/*"]
  }
}

resource "aws_iam_role_policy" "worker_media" {
  name   = "worker-media"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_media.json
}
