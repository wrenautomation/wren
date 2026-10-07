import { describe, expect, it } from "vitest";
import { DRIVE_MAX, DriveRefusal, driveIdOf, googleDrive } from "./drive.js";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]);

type Call = { url: string; auth: string | null };
function fake(answer: (url: string, auth: string | null) => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url, auth });
    return answer(url, auth);
  };
  return { calls, fetch };
}

describe("driveIdOf", () => {
  it("reads Docs and Drive links and bare ids", () => {
    expect(driveIdOf(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`)).toBe(ID);
    expect(driveIdOf(`https://drive.google.com/file/d/${ID}/view`)).toBe(ID);
    expect(driveIdOf(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
    expect(driveIdOf(ID)).toBe(ID);
  });
  it("refuses other hosts and plain http", () => {
    expect(driveIdOf(`https://evil.test/document/d/${ID}`)).toBeNull();
    expect(driveIdOf(`http://docs.google.com/document/d/${ID}`)).toBeNull();
    expect(driveIdOf("notes")).toBeNull();
  });
});

describe("googleDrive", () => {
  it("exports a Google Doc as the service account", async () => {
    const f = fake((url) =>
      url.includes("/export?")
        ? new Response(ZIP)
        : Response.json({ name: "Plan.docx", mimeType: "application/vnd.google-apps.document" }),
    );
    const drive = googleDrive({ token: async () => "tok", fetch: f.fetch });
    const file = await drive.get(ID);
    expect(file.name).toBe("Plan");
    expect([...file.bytes]).toEqual([...ZIP]);
    expect(f.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(f.calls[1]?.url).toContain(`/files/${ID}/export?mimeType=`);
  });

  it("falls back to the public link when the account can't see it", async () => {
    const f = fake((url) =>
      url.startsWith("https://www.googleapis.com")
        ? new Response("{}", { status: 404 })
        : new Response(ZIP, {
            headers: { "content-disposition": "attachment; filename*=UTF-8''Team%20notes.docx" },
          }),
    );
    const file = await googleDrive({ token: async () => "tok", fetch: f.fetch }).get(ID);
    expect(file.name).toBe("Team notes");
    expect(f.calls.at(-1)?.auth).toBeNull();
  });

  it("says how to share it when Google asks to sign in", async () => {
    const f = fake(
      () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
    );
    const drive = googleDrive({ fetch: f.fetch, who: () => "reader@wren.test" });
    await expect(drive.get(ID)).rejects.toThrow(/Share it with reader@wren\.test/);
    expect(f.calls.map((c) => c.url)).toEqual([
      `https://docs.google.com/document/d/${ID}/export?format=docx`,
      `https://drive.google.com/uc?export=download&id=${ID}`,
    ]);
  });

  it("refuses what isn't a doc, and what's too big", async () => {
    const sheet = fake(() =>
      Response.json({ name: "S", mimeType: "application/vnd.google-apps.spreadsheet" }),
    );
    await expect(
      googleDrive({ token: async () => "t", fetch: sheet.fetch }).get(ID),
    ).rejects.toThrow("That's not a Google Doc or a Word file.");
    const big = fake(() => new Response(new Uint8Array(DRIVE_MAX + 1)));
    const err = await googleDrive({ fetch: big.fetch })
      .get(ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriveRefusal);
    expect((err as Error).message).toBe("Files from Drive go up to 4 MB.");
  });
});
