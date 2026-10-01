output "pg_host" {
  value = aws_eip.pg.public_ip
}

output "database_url" {
  description = "WREN_DATABASE_URL for the worker, CI and the CLI. sslmode=require: encrypted, self-signed."
  value       = "postgresql://${var.name}:${var.pg_password}@${aws_eip.pg.public_ip}:5432/${var.name}?sslmode=require"
  sensitive   = true
}

output "pg_instance_id" {
  description = "aws ssm start-session --target <id> for a shell; no SSH."
  value       = aws_instance.pg.id
}

output "backups_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "media_bucket" {
  description = "WREN_MEDIA_BUCKET for the CLI (the worker has it already)"
  value       = aws_s3_bucket.media.bucket
}

output "files_bucket" {
  description = "WREN_FILES_BUCKET for the CLI (the worker has it already)"
  value       = aws_s3_bucket.files.bucket
}

output "videos_bucket" {
  description = "WREN_VIDEOS_BUCKET for the CLI"
  value       = aws_s3_bucket.videos.bucket
}

output "videos_origin" {
  description = "WREN_VIDEOS_ORIGIN for the CLI, and VIDEOS_ORIGIN for the lander's /v/<id> page"
  value       = "https://${aws_cloudfront_distribution.videos.domain_name}"
}

output "lambda_arn" {
  value = aws_lambda_function.worker.arn
}

output "lambda_name" {
  value = aws_lambda_function.worker.function_name
}

output "restate_invoker_role_arn" {
  description = "--assume-role-arn for `restate deployments register`"
  value       = one(aws_iam_role.restate_invoker[*].arn)
}

output "ci_role_arn" {
  description = "GitHub secret AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.ci.arn
}

output "ssm_env_param" {
  value = aws_ssm_parameter.env.name
}

output "cdp_url" {
  description = "WREN_CDP_URL for the worker when the browser container is on (renderer=cdp)."
  value       = var.browser_token == "" ? "" : "ws://${aws_eip.pg.public_ip}:3000?token=${var.browser_token}"
  sensitive   = true
}
