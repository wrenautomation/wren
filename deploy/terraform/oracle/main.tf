# The work box on Oracle's Always Free tier (WA-1274): one A1 (arm64) VM for CI runs, checks and
# renders. Disposable: no state on it; cloud-init (user_data) sets it up. Its own root, so a move
# to AWS is the sibling module with the same outputs (ip, ssh_user, arch), never an edit here.
#
# Free tenancy only (William 11-10): nothing here may bill. A1 Flex up to 4 OCPU / 24 GB and
# 200 GB of block volume are Always Free. Idle 7 days (CPU p95, network, memory all < 20%) and
# Oracle stops the box; the runner's real work keeps it busy.
#
# Auth: the API key from credvault, passed as TF_VAR_* by `apply.sh`. State local, gitignored.

terraform {
  required_version = ">= 1.6"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.12"
    }
  }
}

provider "oci" {
  tenancy_ocid = var.tenancy_ocid
  user_ocid    = var.user_ocid
  fingerprint  = var.fingerprint
  private_key  = var.private_key
  region       = var.region
}

data "oci_identity_availability_domains" "all" {
  compartment_id = var.tenancy_ocid
}

locals {
  ads = data.oci_identity_availability_domains.all.availability_domains
  # capacity differs per AD: apply.sh walks them on "Out of host capacity"
  ad = local.ads[var.ad_index % length(local.ads)].name
}

# newest Canonical Ubuntu 24.04 for arm64
data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "work" {
  compartment_id = var.tenancy_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${var.name}-vcn"
  dns_label      = "work"
}

resource "oci_core_internet_gateway" "work" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.work.id
  display_name   = "${var.name}-igw"
}

resource "oci_core_route_table" "work" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.work.id
  display_name   = "${var.name}-routes"
  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.work.id
  }
}

# SSH in, everything out; the runner polls GitHub, so nothing else listens
resource "oci_core_security_list" "work" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.work.id
  display_name   = "${var.name}-ssh-only"
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }
  dynamic "ingress_security_rules" {
    for_each = var.ssh_from
    content {
      source   = ingress_security_rules.value
      protocol = "6"
      tcp_options {
        min = 22
        max = 22
      }
    }
  }
}

resource "oci_core_subnet" "work" {
  compartment_id    = var.tenancy_ocid
  vcn_id            = oci_core_vcn.work.id
  cidr_block        = "10.42.1.0/24"
  display_name      = "${var.name}-public"
  dns_label         = "pub"
  route_table_id    = oci_core_route_table.work.id
  security_list_ids = [oci_core_security_list.work.id]
}

resource "oci_core_instance" "work" {
  compartment_id      = var.tenancy_ocid
  availability_domain = local.ad
  display_name        = var.name
  shape               = var.shape
  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }
  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_gb
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.work.id
    assign_public_ip = true
  }
  metadata = merge(
    { ssh_authorized_keys = var.ssh_public_key },
    var.user_data == "" ? {} : { user_data = base64encode(var.user_data) },
  )
  lifecycle {
    # newer images must not rebuild a running box
    ignore_changes = [source_details[0].source_id]
  }
}
