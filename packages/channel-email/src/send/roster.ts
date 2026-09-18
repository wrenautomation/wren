/**
 * The sending-fleet roster: who may send, for which niches (D43). One
 * checked-in TOML file is the single machine-readable source of truth;
 * a sender missing from the file simply cannot be sent through. Every
 * defect is a `RosterError`, never a skip: a typo'd key, a duplicate
 * address or an unknown niche silently ignored would mean a campaign
 * sending through the wrong inboxes.
 *
 * This module never imports the niche registry; the composition root passes
 * the registered names in for validation.
 */
import { existsSync, readFileSync } from "node:fs";
import { parse as parseToml, TomlError } from "smol-toml";
import { fillPage, visibleText } from "./transport.js";

/** The roster is missing or does not describe a usable fleet: stops a run before any send. */
export class RosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterError";
  }
}

/**
 * The sign-off in both forms a message carries it. `text` is what compose
 * pins into the body (D37); `html` is the authored rich form. The loader
 * refuses them if they say different things.
 */
export class Signature {
  constructor(
    readonly text: string,
    readonly html: string,
  ) {
    Object.freeze(this);
  }

  /** This sign-off with its `{page}` slot filled in both forms by the same rule. */
  forPage(page: string): Signature {
    return new Signature(fillPage(this.text, page), fillPage(this.html, page));
  }
}

export interface Sender {
  readonly address: string; // lowercased
  /** Niches whose campaigns may send through this inbox; null = every niche, present and future. */
  readonly niches: readonly string[] | null;
  /** Carve-outs from the wildcard: "all but these". */
  readonly excludedNiches: readonly string[];
  /** A Workspace-suspended sender stays listed but is never handed to campaigns. */
  readonly suspended: boolean;
  /** The From name; absent means the bare address, never derived from the local part. */
  readonly displayName: string | null;
  /** The sign-off every message from this inbox carries, or null to sign nothing. */
  readonly signature: Signature | null;
}

export function senderDomain(sender: Pick<Sender, "address">): string {
  return sender.address.slice(sender.address.lastIndexOf("@") + 1);
}

const KNOWN_KEYS = new Set(["address", "display_name", "niches", "except", "suspended"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "string");
}

function signatureOf(raw: unknown, where: string): Signature | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw new RosterError(`${where}: must be a table with 'text' and 'html'`);
  const unknown = Object.keys(raw)
    .filter((k) => k !== "text" && k !== "html")
    .sort();
  if (unknown.length) {
    throw new RosterError(`${where}: knows only 'text' and 'html', not ${unknown.join(", ")}`);
  }
  const forms: Record<"text" | "html", string> = { text: "", html: "" };
  for (const key of ["text", "html"] as const) {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new RosterError(`${where}: '${key}' must be a non-blank string`);
    }
    forms[key] = value
      .replace(/^\n+|\n+$/g, "")
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n");
  }
  const seen = visibleText(forms.html);
  if (seen !== forms.text) {
    throw new RosterError(
      `${where}: the two forms say different things, so a recipient's client would choose ` +
        `between them.\n  text says: ${JSON.stringify(forms.text)}\n  html shows: ${JSON.stringify(seen)}`,
    );
  }
  return new Signature(forms.text, forms.html);
}

function unknownNiches(names: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(names.filter((n) => !known.has(n)))].sort();
}

/** Parse and validate the roster text (`where` names the source for messages). */
export function parseRoster(
  text: string,
  where: string,
  knownNiches?: ReadonlySet<string>,
): Sender[] {
  let data: Record<string, unknown>;
  try {
    data = parseToml(text);
  } catch (err) {
    if (err instanceof TomlError)
      throw new RosterError(`${where} is not valid TOML: ${err.message}`);
    throw err;
  }
  const signature = signatureOf(data.signature, `${where} [signature]`);
  const entries = data.senders;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RosterError(`${where} has no [[senders]] entries — an empty fleet can't send`);
  }
  const registered = knownNiches ? [...knownNiches].sort().join(", ") : "";
  const senders: Sender[] = [];
  const seen = new Set<string>();
  entries.forEach((entry: unknown, index) => {
    const at = `${where} sender #${index + 1}`;
    if (!isRecord(entry)) throw new RosterError(`${at}: must be a table`);
    const unknown = Object.keys(entry)
      .filter((k) => !KNOWN_KEYS.has(k))
      .sort();
    if (unknown.length) {
      throw new RosterError(
        `${at}: unknown key(s) ${unknown.join(", ")} — knows: ${[...KNOWN_KEYS].sort().join(", ")}`,
      );
    }
    const rawAddress = entry.address;
    if (typeof rawAddress !== "string" || rawAddress !== rawAddress.trim() || !rawAddress) {
      throw new RosterError(`${at}: 'address' must be a non-blank string`);
    }
    const address = rawAddress.toLowerCase();
    const sep = address.lastIndexOf("@");
    const local = sep < 0 ? "" : address.slice(0, sep);
    const domain = sep < 0 ? "" : address.slice(sep + 1);
    if (sep < 0 || !local || !domain.includes(".")) {
      throw new RosterError(`${at}: ${JSON.stringify(address)} is not an email address`);
    }
    if (seen.has(address)) throw new RosterError(`${at}: ${address} appears twice`);
    seen.add(address);

    const rawNiches = entry.niches;
    let niches: readonly string[] | null;
    if (rawNiches === "all") {
      niches = null;
    } else if (isStringList(rawNiches)) {
      if (rawNiches.includes("all")) {
        throw new RosterError(
          `${at}: the wildcard is the string form — write niches = "all", not a list containing it`,
        );
      }
      if (knownNiches) {
        const bad = unknownNiches(rawNiches, knownNiches);
        if (bad.length) {
          throw new RosterError(
            `${at}: unknown niche(s) ${bad.join(", ")} — registered: ${registered}`,
          );
        }
      }
      niches = [...rawNiches];
    } else {
      throw new RosterError(
        `${at}: 'niches' must be "all" or a non-empty list of niche names — a sender no campaign ` +
          "may use doesn't belong in the roster (suspend it instead)",
      );
    }

    const rawExcept = entry.except;
    let excluded: readonly string[] = [];
    if (rawExcept !== undefined && rawExcept !== null) {
      if (niches !== null) {
        throw new RosterError(
          `${at}: 'except' only carves the "all" wildcard — with an explicit list, just leave the niche out`,
        );
      }
      if (!isStringList(rawExcept)) {
        throw new RosterError(
          `${at}: 'except' must be a non-empty list of niche names (for no carve-outs, niches = "all" alone)`,
        );
      }
      if (knownNiches) {
        const bad = unknownNiches(rawExcept, knownNiches);
        if (bad.length) {
          throw new RosterError(
            `${at}: unknown niche(s) ${bad.join(", ")} — registered: ${registered}`,
          );
        }
      }
      excluded = [...rawExcept];
    }

    const suspended = entry.suspended ?? false;
    if (typeof suspended !== "boolean")
      throw new RosterError(`${at}: 'suspended' must be true or false`);
    const displayName = entry.display_name;
    if (
      displayName !== undefined &&
      displayName !== null &&
      (typeof displayName !== "string" || !displayName.trim())
    ) {
      throw new RosterError(`${at}: 'display_name' must be a non-blank string`);
    }
    senders.push({
      address,
      niches,
      excludedNiches: excluded,
      suspended,
      displayName: typeof displayName === "string" ? displayName.trim() : null,
      signature,
    });
  });
  return senders;
}

/** Load the roster file, refusing loudly on anything off. */
export function loadRoster(path: string, knownNiches?: ReadonlySet<string>): Sender[] {
  if (!existsSync(path)) {
    throw new RosterError(`sender roster not found at ${path} — see spec D43 for its shape`);
  }
  return parseRoster(readFileSync(path, "utf8"), path, knownNiches);
}

/** The senders a campaign may use: not suspended, and (when scoped) assigned to the niche. Order preserved. */
export function activeSenders(roster: readonly Sender[], niche?: string | null): Sender[] {
  const allowed = (s: Sender): boolean => {
    if (niche === undefined || niche === null) return true;
    if (s.excludedNiches.includes(niche)) return false;
    return s.niches === null || s.niches.includes(niche);
  };
  return roster.filter((s) => !s.suspended && allowed(s));
}
