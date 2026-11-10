# The work box on AWS (designs/2026-11-10-work-box.md): the Oracle module's sibling, same outputs
# (ip, ssh_user, arch, shape), so a move swaps the root and register-runners.sh takes the new ip.
# Written, never applied: it bills (t4g.xlarge ~$98/mo on demand). Apply only on William's yes.
#   tofu -chdir=deploy/terraform/work-aws apply -var ssh_public_key="$WREN_WORK_SSH_PUBLIC_KEY" \
#     -var user_data="$(cat deploy/work-box/box-setup.sh)"
# State local, gitignored (../.gitignore).

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "wren", role = "work-box" }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "wren-work"
}

# Graviton: arm64 like the Oracle A1 and the Lambdas. c7g.xlarge for more CPU, less memory.
variable "instance_type" {
  type    = string
  default = "t4g.xlarge"
}

variable "disk_gb" {
  type    = number
  default = 100
}

variable "ssh_public_key" {
  type = string
}

variable "ssh_from" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "user_data" {
  description = "deploy/work-box/box-setup.sh"
  type        = string
  default     = ""
}

# newest Canonical Ubuntu 24.04 for arm64
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
}

data "aws_vpc" "default" {
  default = true
}

resource "aws_key_pair" "work" {
  key_name   = var.name
  public_key = var.ssh_public_key
}

resource "aws_security_group" "work" {
  name        = var.name
  description = "work box: ssh in, all out"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_from
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "work" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.work.key_name
  vpc_security_group_ids = [aws_security_group.work.id]
  user_data              = var.user_data == "" ? null : var.user_data
  root_block_device {
    volume_size = var.disk_gb
    volume_type = "gp3"
  }
  # t4g: unlimited CPU credits bill past the baseline; standard caps them instead
  credit_specification {
    cpu_credits = "standard"
  }
  metadata_options {
    http_tokens = "required"
  }
  tags = { Name = var.name }
  lifecycle {
    # newer images and user_data edits must not rebuild a running box
    ignore_changes = [ami, user_data]
  }
}

output "ip" {
  value = aws_instance.work.public_ip
}

output "ssh_user" {
  value = "ubuntu"
}

output "arch" {
  value = "arm64"
}

output "shape" {
  value = var.instance_type
}
