variable "region" {
  description = "Restate Cloud runs in us-east-1 / eu-west-1; keep the Lambda beside it."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  type    = string
  default = "wren"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "pg_password" {
  description = "The wren role's password. Generate: openssl rand -base64 32 | tr -d '/+='"
  type        = string
  sensitive   = true
}

variable "pg_instance_type" {
  description = "ARM; t4g.small is 2 GB, enough for this schema at this volume."
  type        = string
  default     = "t4g.small"
}

variable "pg_volume_gb" {
  description = "Data volume, separate from the root disk so the instance is disposable."
  type        = number
  default     = 20
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "lambda_zip" {
  description = "Built by `pnpm --filter @wren/worker build:lambda`. CI replaces the code afterwards."
  type        = string
  default     = "../../apps/worker/dist/lambda.zip"
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "lambda_memory_mb" {
  type    = number
  default = 1024
}

variable "lambda_timeout_s" {
  description = "Lambda's ceiling is 900. Every handler step is far shorter; this is headroom for a render."
  type        = number
  default     = 900
}

variable "restate_trust_policy" {
  description = "The IAM trust policy JSON Restate Cloud shows under Developers > Security > AWS Lambda for this environment. Empty = no invoker role yet."
  type        = string
  default     = ""
}

variable "restate_identity_key" {
  description = "Restate Cloud's request-identity public key (publickeyv1_...), from the same page. Empty = not enforced."
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "owner/name; CI on its main branch may update the Lambda's code."
  type        = string
  default     = "wrenautomation/wren"
}

variable "browser_token" {
  description = "Token for the browserless chromium on the Postgres box (WREN_CDP_URL carries it). Generate like pg_password. Empty = no browser container."
  type        = string
  sensitive   = true
  default     = ""
}
