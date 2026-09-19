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

output "lambda_arn" {
  value = aws_lambda_function.worker.arn
}

output "lambda_name" {
  value = aws_lambda_function.worker.function_name
}

output "restate_invoker_role_arn" {
  description = "--assume-role-arn for `restate deployments register`"
  value       = aws_iam_role.restate_invoker.arn
}

output "ci_role_arn" {
  description = "GitHub secret AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.ci.arn
}

output "ssm_env_param" {
  value = aws_ssm_parameter.env.name
}
