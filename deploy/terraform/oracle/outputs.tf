# same three outputs as any provider's work-box module: a move swaps the module, not the callers
output "ip" {
  value = oci_core_instance.work.public_ip
}

output "ssh_user" {
  value = "ubuntu"
}

output "arch" {
  value = "arm64"
}

output "shape" {
  value = "${var.shape} ${var.ocpus} OCPU / ${var.memory_gb} GB"
}
