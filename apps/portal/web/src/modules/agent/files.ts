/**
 * Files in a chat (designs/2026-11-04-multi-user-runtime.md, Decision 7). Small images and PDFs go
 * in the turn as API blocks; the rest lands on the relay's Mac (`POST /s/<setup>/files`) and the
 * turn names its path. Each file gets an `[Attached: …]` line: API blocks carry no name.
 */
import type { AgentSent } from "@wren/ui";
import { relayPost } from "./connect.js";

/** One block of a person's turn, as the Messages API takes it. */
export type Wire =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageType; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const isImage = (t: string): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t);
/** Raw bytes; base64 stays under the API's 5 MB per image. */
const IMAGE_CAP = 3.75 * 1024 * 1024;
/** A PDF rides every later turn of the chat: larger ones go to disk and birdwatch reads them. */
const PDF_CAP = 10 * 1024 * 1024;

// assistant-ui reads only "*" as any file; "*/*" matches none
export const ACCEPT = "*";
/** The relay's own cap (relay.ts UPLOAD_CAP): refused here before a long upload. */
const UPLOAD_CAP = 500 * 1024 * 1024;

async function base64(file: File): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error(`Couldn't read ${file.name}`));
    r.readAsDataURL(file);
  });
  return url.slice(url.indexOf(",") + 1);
}

/** A picked file → the blocks its turn carries. Big or other files upload now. */
export async function readyFile(setup: string, token: string, file: File): Promise<Wire[]> {
  const line = (s: string): Wire => ({ type: "text", text: `[Attached: ${s}]` });
  const type = file.type;
  if (isImage(type) && file.size <= IMAGE_CAP)
    return [
      line(file.name),
      { type: "image", source: { type: "base64", media_type: type, data: await base64(file) } },
    ];
  if (file.type === "application/pdf" && file.size <= PDF_CAP)
    return [
      line(file.name),
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: await base64(file) },
      },
    ];
  if (file.size > UPLOAD_CAP) throw new Error("Files stop at 500 MB");
  const { path } = await relayPost<{ path: string }>(
    `/s/${encodeURIComponent(setup)}/files?name=${encodeURIComponent(file.name)}`,
    token,
    file,
  );
  return [line(path)];
}

/** A turn on the wire: words first (the CLI titles the chat from them), then the page, then files. */
export function turnContent(text: string, files: readonly AgentSent[], page?: string): Wire[] {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...(page ? [{ type: "text" as const, text: `[Page: ${page}]` }] : []),
    ...files.flatMap((f) => f.data as Wire[]),
  ];
}
