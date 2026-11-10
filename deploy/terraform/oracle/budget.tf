# Free-tier guard (WA-1274): any real spend (trial credit included) mails William. Budgets
# bill nothing. 1% of $1 = the first cent.
resource "oci_budget_budget" "free_guard" {
  compartment_id = var.tenancy_ocid
  display_name   = "${var.name}-free-guard"
  amount         = 1
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.tenancy_ocid]
}

resource "oci_budget_alert_rule" "first_cent" {
  budget_id      = oci_budget_budget.free_guard.id
  display_name   = "first-cent"
  type           = "ACTUAL"
  threshold_type = "PERCENTAGE"
  threshold      = 1
  recipients     = var.alert_email
  message        = "Oracle tenancy spent money. It must stay on Always Free (WA-1274)."
}
