variable "name" {
  type    = string
  default = "wren-work"
}

variable "region" {
  type    = string
  default = "us-ashburn-1"
}

variable "tenancy_ocid" {
  type = string
}

variable "user_ocid" {
  type = string
}

variable "fingerprint" {
  type = string
}

variable "private_key" {
  description = "API signing key, PEM; from credvault via apply.sh"
  type        = string
  sensitive   = true
}

variable "ad_index" {
  description = "which availability domain; apply.sh steps it on a capacity error"
  type        = number
  default     = 0
}

variable "shape" {
  type    = string
  default = "VM.Standard.A1.Flex"
}

# Always Free ceiling: 4 OCPU / 24 GB across all A1 VMs
variable "ocpus" {
  type    = number
  default = 4
}

variable "memory_gb" {
  type    = number
  default = 24
}

# Always Free: 200 GB of block volume in all
variable "boot_gb" {
  type    = number
  default = 100
}

variable "ssh_public_key" {
  type = string
}

variable "ssh_from" {
  description = "CIDRs allowed to SSH in"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "user_data" {
  description = "cloud-init for the box (WA-1277); empty: plain Ubuntu"
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "where the free-tier guard mails (William's; apply.sh reads the Oracle login)"
  type        = string
}
