# Crawled page HTML a day old (`PageArchive`, served on the Postgres box): gzip
# under pages/<document id>.html.gz. Kept forever, like the rows that point here;
# out of Postgres it no longer fills the data volume or every nightly dump.
# The box worker reads the name from its own env (/wren/prod/box: WREN_PAGES_BUCKET).

resource "aws_s3_bucket" "pages" {
  bucket_prefix = "${local.prefix}-pages-"
}

resource "aws_s3_bucket_public_access_block" "pages" {
  bucket                  = aws_s3_bucket.pages.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "pages" {
  bucket = aws_s3_bucket.pages.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pages" {
  bucket = aws_s3_bucket.pages.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Archive (put) and re-scan (get) both run on the box, next to the rows.
data "aws_iam_policy_document" "pg_pages" {
  statement {
    sid       = "Pages"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.pages.arn}/pages/*"]
  }
}

resource "aws_iam_role_policy" "pg_pages" {
  name   = "pg-pages"
  role   = aws_iam_role.pg.id
  policy = data.aws_iam_policy_document.pg_pages.json
}
