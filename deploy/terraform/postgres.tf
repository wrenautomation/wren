# Postgres 17 in Docker on one ARM instance — plus, when a token is set, a
# browserless chromium beside it: the worker's render tier over CDP, at no cost
# beyond the box (Browserbase is the alternative). Reachable from anywhere on 5432 —
# the Lambda has no fixed address and a NAT gateway costs more than the box —
# so the listener is TLS-only (hostssl) with scram passwords and a long random
# secret. Data lives on its own volume; the instance itself is disposable.

data "aws_ssm_parameter" "al2023_arm" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_subnet" "pg" {
  id = sort(data.aws_subnets.default.ids)[0]
}

resource "aws_ssm_parameter" "pg_password" {
  name  = "${local.ssm_root}/pg_password"
  type  = "SecureString"
  value = var.pg_password
}

resource "aws_ssm_parameter" "browser_token" {
  count = var.browser_token == "" ? 0 : 1
  name  = "${local.ssm_root}/browser_token"
  type  = "SecureString"
  value = var.browser_token
}

resource "aws_security_group" "pg" {
  name        = "${local.prefix}-pg"
  description = "Postgres over TLS from anywhere; no SSH (use SSM Session Manager)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "postgres (TLS required by pg_hba)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  dynamic "ingress" {
    for_each = var.browser_token == "" ? [] : [1]
    content {
      description = "browserless CDP (token in the URL)"
      from_port   = 3000
      to_port     = 3000
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_s3_bucket" "backups" {
  bucket_prefix = "${local.prefix}-pg-backups-"
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  # Only the nightly dumps expire; `legacy/` (the retired Python repos' data) is kept.
  rule {
    id     = "expire-pg-dumps"
    status = "Enabled"
    filter {
      prefix = "pg/"
    }
    expiration {
      days = var.backup_retention_days
    }
  }
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pg" {
  name               = "${local.prefix}-pg"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "pg_ssm" {
  role       = aws_iam_role.pg.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

data "aws_iam_policy_document" "pg" {
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameter"]
    resources = concat([aws_ssm_parameter.pg_password.arn], aws_ssm_parameter.browser_token[*].arn)
  }
  statement {
    sid       = "DecryptSsm"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
  statement {
    sid       = "WriteBackups"
    actions   = ["s3:PutObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "pg" {
  name   = "pg"
  role   = aws_iam_role.pg.id
  policy = data.aws_iam_policy_document.pg.json
}

resource "aws_iam_instance_profile" "pg" {
  name = "${local.prefix}-pg"
  role = aws_iam_role.pg.name
}

resource "aws_ebs_volume" "pg_data" {
  availability_zone = data.aws_subnet.pg.availability_zone
  size              = var.pg_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${local.prefix}-pg-data" }
}

resource "aws_instance" "pg" {
  ami                         = data.aws_ssm_parameter.al2023_arm.value
  instance_type               = var.pg_instance_type
  subnet_id                   = data.aws_subnet.pg.id
  vpc_security_group_ids      = [aws_security_group.pg.id]
  iam_instance_profile        = aws_iam_instance_profile.pg.name
  associate_public_ip_address = true
  user_data_replace_on_change = false

  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required"
  }

  user_data = templatefile("${path.module}/user-data.sh", {
    region              = var.region
    volume_id           = aws_ebs_volume.pg_data.id
    pw_param            = aws_ssm_parameter.pg_password.name
    browser_token_param = var.browser_token == "" ? "" : aws_ssm_parameter.browser_token[0].name
    backups             = aws_s3_bucket.backups.bucket
    db_name             = var.name
    db_user             = var.name
    pg_image            = "postgres:17"
  })

  tags = { Name = "${local.prefix}-pg" }

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_volume_attachment" "pg_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.pg_data.id
  instance_id = aws_instance.pg.id
}

resource "aws_eip" "pg" {
  instance = aws_instance.pg.id
  domain   = "vpc"
  tags     = { Name = "${local.prefix}-pg" }
}
