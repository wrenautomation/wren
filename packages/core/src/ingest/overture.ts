/**
 * Overture Maps places, as `wren fetch get` writes them (JSON lines, one place per
 * line), turned into import rows. Niche-agnostic: a niche registers a format with
 * its name and, if it needs one, its own `decline` rule.
 *
 * The whole file is read first so chains can be seen: a domain listed at `chainAt`
 * or more places is a chain, and all its places are declined. Closed places and
 * public bodies (.gov, .mil, Canadian government hosts) are declined too. Declined
 * rows are counted by reason on the import (`stats.declined`), and the file on disk
 * stays whole.
 *
 * Each place rides along whole under `overture`; the canonical fields are lifted
 * beside it, plus `phone`, `postcode` and `places_with_domain`. Identity is domain-first; a
 * place with no usable site is keyed `overture:<id>`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractDomain, isPlatformDomain } from "../emails.js";
import { IDENTITY_KEY, type RawRow } from "./schema.js";
import type { LeadSource, SourceFormat } from "./sources.js";

export type OverturePlace = Record<string, unknown>;

/** A niche's own drop rule: the reason to decline this place, or null to keep it. */
export type PlaceDecline = (place: OverturePlace, domain: string | null) => string | null;

export const CHAIN_AT = 3;

const PUBLIC_BODY =
  /(^|\.)(gov|mil)$|(^|\.)gc\.ca$|(^|\.)canada\.ca$|(^|\.)(gov|gouv)\.[a-z]{2}\.ca$/;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
const field = (v: unknown, key: string): string | null => {
  if (typeof v !== "object" || v === null) return null;
  const x = (v as Record<string, unknown>)[key];
  return typeof x === "string" && x.trim() ? x.trim() : null;
};
const firstAddress = (place: OverturePlace): unknown =>
  Array.isArray(place.addresses) ? place.addresses[0] : undefined;

/** The domain that keys the place, or null (no site, a platform page, not a domain). */
export function placeDomain(place: OverturePlace): string | null {
  const site = strings(place.websites)[0];
  const domain = site ? extractDomain(site) : null;
  return domain && !isPlatformDomain(domain) ? domain : null;
}

/** One place -> an import row: canonical fields first, the place whole under `overture`. */
export function overtureRow(place: OverturePlace, placesWithDomain: number): RawRow {
  const name = field(place.names, "primary");
  const website = strings(place.websites)[0];
  const email = strings(place.emails).find((e) => e.includes("@"));
  const phone = strings(place.phones)[0];
  const address = firstAddress(place);
  const geo = [field(address, "locality"), field(address, "region")].filter(Boolean).join(", ");
  const country = field(address, "country");
  const postcode = field(address, "postcode");
  const out: RawRow = {
    ...(name ? { company_name: name } : {}),
    ...(website ? { website } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(geo ? { geo } : {}),
    ...(country ? { country } : {}),
    ...(postcode ? { postcode } : {}),
    source: "overture",
    places_with_domain: placesWithDomain,
    overture: place,
  };
  const id = typeof place.id === "string" ? place.id.trim() : "";
  if (id && !placeDomain(place)) out[IDENTITY_KEY] = { source_key: `overture:${id}` };
  return out;
}

/** Why a place is declined, or null. Order: closed, public body, the niche's rule, chain. */
export function declineReason(
  place: OverturePlace,
  domain: string | null,
  placesWithDomain: number,
  opts: { chainAt: number; decline?: PlaceDecline | undefined },
): string | null {
  if (place.operating_status === "permanently_closed") return "closed";
  const site = strings(place.websites)[0];
  const host = site ? extractDomain(site) : null;
  if (host && PUBLIC_BODY.test(host)) return "public_body";
  const own = opts.decline?.(place, domain);
  if (own) return own;
  if (domain && placesWithDomain >= opts.chainAt) return "chain";
  return null;
}

export class OverturePlacesSource implements LeadSource {
  readonly sourceType = "overture";
  readonly sourceRef: string;
  readonly contentHash: string;
  private readonly bytes: Uint8Array;
  private readonly counts: Record<string, number> = {};

  constructor(
    readonly path: string,
    private readonly opts: { chainAt?: number; decline?: PlaceDecline } = {},
  ) {
    this.sourceRef = path;
    this.bytes = readFileSync(path);
    this.contentHash = createHash("sha256").update(this.bytes).digest("hex");
  }

  *rows(): Generator<RawRow> {
    const places: OverturePlace[] = [];
    for (const line of new TextDecoder("utf-8").decode(this.bytes).split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
        places.push(parsed as OverturePlace);
    }
    const open = places.filter((p) => p.operating_status !== "permanently_closed");
    const perDomain = new Map<string, number>();
    for (const p of open) {
      const d = placeDomain(p);
      if (d) perDomain.set(d, (perDomain.get(d) ?? 0) + 1);
    }
    const chainAt = this.opts.chainAt ?? CHAIN_AT;
    for (const place of places) {
      const domain = placeDomain(place);
      const n = domain ? (perDomain.get(domain) ?? 0) : 0;
      const reason = declineReason(place, domain, n, { chainAt, decline: this.opts.decline });
      if (reason) {
        this.counts[reason] = (this.counts[reason] ?? 0) + 1;
        continue;
      }
      yield overtureRow(place, n);
    }
  }

  declined(): Record<string, number> {
    return { ...this.counts };
  }
}

/** A niche's Overture import format. */
export function overtureFormat(spec: {
  name: string;
  help: string;
  niche: string;
  chainAt?: number;
  decline?: PlaceDecline;
}): SourceFormat {
  const { name, help, niche, ...opts } = spec;
  return {
    name,
    help,
    build: (p) => new OverturePlacesSource(p, opts),
    niche,
    columnMapped: false,
    directory: false,
  };
}
