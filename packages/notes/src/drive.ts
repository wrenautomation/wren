/**
 * A Google Doc or a Word file in Google Drive, read for import as `.docx` bytes. Two ways in, and
 * neither asks anyone to sign in to Google: Wren's service account reads what's shared with it,
 * and a file shared as "Anyone with the link" is read like a browser would. The browser turns the
 * bytes into a note.
 */
import { PortalRefusal } from "@wren/core/refusal";

export const DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC = "application/vnd.google-apps.document";
/** Biggest file it takes: the answer goes back as base64 through Restate and Lambda (6 MB). */
export const DRIVE_MAX = 4 * 1024 * 1024;

export interface DriveFile {
  name: string;
  bytes: Uint8Array;
}

export interface NoteDrive {
  /** The service account's email, to share a private doc with; null without one. */
  who: () => string | null;
  get: (id: string) => Promise<DriveFile>;
}

/** Said to the person: why the file didn't come in. */
export class DriveRefusal extends PortalRefusal {}

const ID = /^[\w-]{20,200}$/;

/** The file id in a Docs or Drive link, or a bare id; null when it isn't one. */
export function driveIdOf(link: string): string | null {
  const s = link.trim();
  if (ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^(docs|drive)\.google\.com$/.test(u.hostname)) return null;
  const path = /\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
  return path && ID.test(path) ? path : null;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function googleDrive(o: {
  /** A bearer for the service account on `DRIVE_READ_SCOPE`; left out, public links only. */
  token?: (() => Promise<string>) | undefined;
  who?: (() => string | null) | undefined;
  fetch?: Fetch;
}): NoteDrive {
  const get: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const who = () => {
    try {
      return o.who?.() ?? null;
    } catch {
      return null;
    }
  };

  /** As the service account; null when it can't see the file. */
  async function asAccount(id: string): Promise<DriveFile | null> {
    if (!o.token) return null;
    let bearer: string;
    try {
      bearer = await o.token();
    } catch {
      return null;
    }
    const auth = { headers: { authorization: `Bearer ${bearer}` } };
    const api = `https://www.googleapis.com/drive/v3/files/${id}`;
    const meta = await get(`${api}?fields=name,mimeType,size&supportsAllDrives=true`, auth);
    if (meta.status === 404 || meta.status === 403) return null;
    if (!meta.ok) throw new DriveRefusal("Google Drive didn't answer. Try again.", 503);
    const m = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
    if (m.mimeType !== GOOGLE_DOC && m.mimeType !== DOCX_TYPE)
      throw new DriveRefusal("That's not a Google Doc or a Word file.");
    if (Number(m.size ?? 0) > DRIVE_MAX) throw tooBig();
    const res = await get(
      m.mimeType === GOOGLE_DOC
        ? `${api}/export?mimeType=${encodeURIComponent(DOCX_TYPE)}`
        : `${api}?alt=media&supportsAllDrives=true`,
      auth,
    );
    // Google won't export a Doc over 10 MB; say so plainly.
    if (res.status === 403) throw tooBig();
    if (!res.ok) throw new DriveRefusal("Google Drive didn't answer. Try again.", 503);
    return { name: nameOf(m.name ?? ""), bytes: await capped(res) };
  }

  /** As anyone with the link would; null when Google asks to sign in. */
  async function asLink(id: string): Promise<DriveFile | null> {
    for (const url of [
      `https://docs.google.com/document/d/${id}/export?format=docx`,
      `https://drive.google.com/uc?export=download&id=${id}`,
    ]) {
      const res = await get(url, { redirect: "follow" }).catch(() => null);
      if (!res?.ok) continue;
      const bytes = await capped(res);
      if (!isZip(bytes)) continue;
      return { name: nameOf(fileName(res.headers.get("content-disposition"))), bytes };
    }
    return null;
  }

  return {
    who,
    async get(id) {
      if (!ID.test(id)) throw new DriveRefusal("Paste a Google Docs or Drive link.");
      const file = (await asAccount(id)) ?? (await asLink(id));
      if (file) return file;
      const me = who();
      throw new DriveRefusal(
        me
          ? `Google won't share it with Wren. Share it with ${me}, or as Anyone with the link.`
          : "Google won't share it with Wren. Share it as Anyone with the link.",
        404,
      );
    },
  };
}

const tooBig = () => new DriveRefusal("Files from Drive go up to 4 MB.");

/** The body, refused past `DRIVE_MAX`. */
async function capped(res: Response): Promise<Uint8Array> {
  const said = Number(res.headers.get("content-length") ?? 0);
  if (said > DRIVE_MAX) throw tooBig();
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > DRIVE_MAX) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** A `.docx` is a zip: "PK". A sign-in page is not. */
const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** The name in a Content-Disposition header. */
function fileName(header: string | null): string {
  if (!header) return "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      return star;
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] ?? "";
}

/** A title from a file name: no extension, no path. */
const nameOf = (name: string) =>
  name
    .replace(/^.*[\\/]/, "")
    .replace(/\.docx$/i, "")
    .trim()
    .slice(0, 300);
