/**
 * Every setup (designs/2026-10-07-setup-and-vendors.md): core's Google and Meta, the phone's,
 * email's, Stripe's for pay links, client mail access (designs/2026-10-07-mail-access.md), client
 * social accounts (designs/2026-10-07-client-social.md). Each walks the executor as a `kind: "setup"` workflow.
 */

import { SMS_SETUPS } from "@wren/starling-sms";
import type { Setup } from "@wren/core/setup";
import { CORE_SETUPS } from "@wren/core/setups";
import { PAYMENTS_SETUPS } from "@wren/payments/setups";
import { EMAIL_SETUPS } from "@wren/starling-email";
import { MAIL_SETUPS } from "@wren/starling-email/access/setups";
import { SOCIAL_SETUPS } from "@wren/starling-inbound/connect";

export const SETUPS: readonly Setup[] = [
  ...SMS_SETUPS,
  ...EMAIL_SETUPS,
  ...MAIL_SETUPS,
  ...SOCIAL_SETUPS,
  ...CORE_SETUPS,
  ...PAYMENTS_SETUPS,
];
