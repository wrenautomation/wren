/**
 * The Monitor's mail on the spine (designs/2026-10-06-mail-push.md): mail a vendor rule matches runs
 * the books' pass now, not at tomorrow's. The step only decides; the pass runs on the box.
 */
import type { Step } from "@wren/core/spine";
import { VENDORS, type VendorSpec } from "./chart.js";
import { vendorFor } from "./mailbox.js";

export interface BillsStepDeps {
  /** A kept mail's sender and subject by its id; null when gone. */
  mailOf: (id: number) => Promise<{ fromAddress: string; subject: string } | null>;
  /** Run the books' pass; `key` is the same for a retried step, so it runs once. */
  runBooks: (key: string) => Promise<void>;
  vendorSpecs?: readonly VendorSpec[];
}

export const billsStep =
  (d: BillsStepDeps): Step =>
  async (_port, e) => {
    const id = Number(e.data.mailId);
    if (!Number.isInteger(id)) throw new Error(`${e.subject} is no kept email`);
    const m = await d.mailOf(id);
    if (m && vendorFor(d.vendorSpecs ?? VENDORS, m.fromAddress, m.subject))
      await d.runBooks(`books-bill:${id}`);
    return [];
  };
