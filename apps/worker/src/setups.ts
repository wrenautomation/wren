/**
 * Every setup (designs/2026-10-07-setup-and-vendors.md): core's Google and Meta, the phone's,
 * email's. Each walks the spine as a `kind: "setup"` workflow.
 */
import { EMAIL_SETUPS } from "@wren/channel-email";
import { SMS_SETUPS } from "@wren/channel-sms";
import type { Setup } from "@wren/core/setup";
import { CORE_SETUPS } from "@wren/core/setups";

export const SETUPS: readonly Setup[] = [...SMS_SETUPS, ...EMAIL_SETUPS, ...CORE_SETUPS];
