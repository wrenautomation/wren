# wren production: Postgres in Docker on one small EC2 box, the worker as a
# Lambda that Restate Cloud invokes through an IAM role, secrets in SSM, CI on
# GitHub OIDC. Nothing here is niche- or channel-specific: it is the shape any
# wren deployment takes.
#
# State is local by default (deploy/terraform/terraform.tfstate, gitignored).
# One operator, one environment; move it to S3 when there are two.

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
    tags = { project = var.name, env = var.env, managed = "terraform" }
  }
}

locals {
  prefix   = "${var.name}-${var.env}"
  ssm_root = "/${var.name}/${var.env}"
}

data "aws_caller_identity" "me" {}
data "aws_region" "here" {}
