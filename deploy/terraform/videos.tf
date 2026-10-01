# Per-lead demo videos: `v/<id>.mp4`, `.jpg` and `.json`, uploaded by the CLI
# (`wren video render`), played by the lander's /v/<id> page through
# CloudFront. The bucket stays private: only the distribution reads it, and
# only under v/. An id is 16 random bytes, so nothing is listable or guessable.

resource "aws_s3_bucket" "videos" {
  bucket_prefix = "${local.prefix}-videos-"
}

resource "aws_s3_bucket_public_access_block" "videos" {
  bucket                  = aws_s3_bucket.videos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "videos" {
  bucket = aws_s3_bucket.videos.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_cloudfront_origin_access_control" "videos" {
  name                              = "${local.prefix}-videos"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "videos" {
  enabled         = true
  comment         = "${local.prefix} videos"
  is_ipv6_enabled = true
  http_version    = "http2and3"
  # North America and Europe: where the leads are, at the lowest rate.
  price_class = "PriceClass_100"

  origin {
    origin_id                = "videos"
    domain_name              = aws_s3_bucket.videos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.videos.id
  }

  default_cache_behavior {
    target_origin_id       = "videos"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "videos_cdn" {
  statement {
    sid       = "CloudFrontReadsVideos"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.videos.arn}/v/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.videos.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "videos" {
  bucket = aws_s3_bucket.videos.id
  policy = data.aws_iam_policy_document.videos_cdn.json
  # A policy naming a service principal is not "public", but apply it after the block anyway.
  depends_on = [aws_s3_bucket_public_access_block.videos]
}
