/** A vendor read that never ran: the gate said no, or the client's key isn't there. */
import { SiteCallError } from "./content/autobrowse.js";

/** The gate said no: nothing was read. `why` is the gate's words ("No daily share set"). */
export class VendorStop extends SiteCallError {
  readonly vendor: string;
  readonly why: string;
  constructor(
    site: string,
    method: string,
    path: string,
    vendor: string,
    why: string,
    status = 429,
  ) {
    super(site, method, path, status, `${vendor}: ${why}`);
    this.name = "VendorStop";
    this.vendor = vendor;
    this.why = why;
  }
}

export const isVendorStop = (err: unknown): err is VendorStop =>
  err instanceof Error && err.name === "VendorStop";
