import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { fromB64, toB64 } from "./doc.js";
import { FLUSH_AFTER, POLL_EVERY, Room, type Seat, type SyncAnswer } from "./room.js";
import type { Role } from "./types.js";

const ID = "6f1c2c4e-0000-4000-8000-000000000001";

/** The service: one doc, who sent what, and who it refuses. */
function server() {
  const doc = new Y.Doc();
  const sent: { by: string; text: string }[] = [];
  const refuse = new Map<string, number>();
  const roles = new Map<string, Role>();
  let down = false;
  const sync = vi.fn(
    async (as: Record<string, unknown>, b: { update: string; sv: string }): Promise<SyncAnswer> => {
      if (down) throw new Error("unreachable");
      const by = String(as.email);
      const status = refuse.get(by);
      if (status) return { ok: false, status, message: "no" };
      if (b.update) {
        Y.applyUpdate(doc, fromB64(b.update));
        sent.push({ by, text: doc.getText("t").toString() });
      }
      return {
        ok: true,
        update: toB64(Y.encodeStateAsUpdate(doc, fromB64(b.sv))),
        sv: toB64(Y.encodeStateVector(doc)),
        version: sent.length,
        name: "Plan",
        updatedAt: null,
        editedBy: sent.at(-1)?.by ?? null,
        role: roles.get(by) ?? "edit",
      };
    },
  );
  return {
    doc,
    sent,
    refuse,
    roles,
    sync,
    down: (v: boolean) => {
      down = v;
    },
  };
}

type Server = ReturnType<typeof server>;

/** A browser: its own doc, the frames it got. */
async function browser(room: Room, s: Server, email: string, role: Role) {
  s.roles.set(email, role);
  const got: Record<string, unknown>[] = [];
  const closed: number[] = [];
  const doc = new Y.Doc();
  const socket = {
    send: (s: string) => {
      const f = JSON.parse(s);
      got.push(f);
      if (f.t === "sync" || f.t === "update") Y.applyUpdate(doc, fromB64(f.update), "room");
    },
    close: (code: number) => void closed.push(code),
  };
  const seat: Seat = { email, as: { email } };
  const peer = await room.join(socket, seat);
  let seq = 0;
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin === "room") return;
    room.message(peer, JSON.stringify({ t: "update", update: toB64(u), seq: ++seq }));
  });
  room.message(peer, JSON.stringify({ t: "hello", sv: toB64(Y.encodeStateVector(doc)) }));
  return { doc, got, closed, peer, text: () => doc.getText("t").toString() };
}

describe("the live room", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("relays an edit at once and saves it as its author a moment later", async () => {
    const s = server();
    s.doc.getText("t").insert(0, "Plan");
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const ben = await browser(room, s, "ben@firm.example", "view");
    expect(amy.text()).toBe("Plan");
    amy.doc.getText("t").insert(4, " A");
    expect(ben.text()).toBe("Plan A");
    expect(s.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(FLUSH_AFTER + 10);
    expect(s.sent).toEqual([{ by: "amy@firm.example", text: "Plan A" }]);
    expect(amy.got.find((f) => f.t === "saved")).toMatchObject({ seq: 1, version: 1 });
    expect(ben.got.find((f) => f.t === "saved")).toMatchObject({ seq: null });
    room.close();
  });

  it("refuses a viewer's edit and holds a commenter's until the server takes it", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const vic = await browser(room, s, "vic@firm.example", "view");
    const cal = await browser(room, s, "cal@firm.example", "comment");
    vic.doc.getText("t").insert(0, "nope");
    expect(vic.got.at(-1)).toMatchObject({ t: "refused", status: 403 });
    expect(amy.text()).toBe("");
    cal.doc.getText("t").insert(0, "maybe");
    expect(amy.text()).toBe("");
    await vi.advanceTimersByTimeAsync(10);
    expect(s.sent).toEqual([{ by: "cal@firm.example", text: "maybe" }]);
    expect(amy.text()).toBe("maybe");
    room.close();
  });

  it("drops a commenter's change the server refuses, and keeps them a commenter", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const cal = await browser(room, s, "cal@firm.example", "comment");
    s.refuse.set("cal@firm.example", 403);
    cal.doc.getText("t").insert(0, "rewrite");
    await vi.advanceTimersByTimeAsync(10);
    expect(cal.got.at(-1)).toMatchObject({ t: "refused", status: 403 });
    expect(amy.text()).toBe("");
    expect(cal.peer.role).toBe("comment");
    room.close();
  });

  it("brings what the server wrote to everyone on the poll", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const ben = await browser(room, s, "ben@firm.example", "edit");
    s.doc.getText("t").insert(0, "from the CLI");
    await vi.advanceTimersByTimeAsync(POLL_EVERY + 10);
    expect(amy.text()).toBe("from the CLI");
    expect(ben.text()).toBe("from the CLI");
    room.close();
  });

  it("refuses a join the server refuses", async () => {
    const s = server();
    s.refuse.set("eve@else.example", 404);
    const room = new Room(ID, { sync: s.sync });
    await expect(browser(room, s, "eve@else.example", "view")).rejects.toMatchObject({
      status: 404,
    });
    expect(room.size).toBe(0);
  });

  it("tells someone shared up or down, and acts on it", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const ben = await browser(room, s, "ben@firm.example", "view");
    s.roles.set("ben@firm.example", "edit");
    await vi.advanceTimersByTimeAsync(POLL_EVERY * 2 + 10);
    expect(ben.got).toContainEqual({ t: "role", role: "edit" });
    ben.doc.getText("t").insert(0, "now mine too");
    expect(amy.text()).toBe("now mine too");
    room.close();
  });

  it("puts someone who can't open it any more out of the room", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "view");
    s.refuse.set("amy@firm.example", 404);
    await vi.advanceTimersByTimeAsync(POLL_EVERY + 10);
    expect(amy.closed).toEqual([4404]);
    expect(room.size).toBe(0);
  });

  it("sends the last one's unsent edits when they leave, then closes", async () => {
    const s = server();
    const empty = vi.fn();
    const later: Promise<unknown>[] = [];
    const room = new Room(ID, { sync: s.sync, onEmpty: empty, later: (p) => later.push(p) });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    amy.doc.getText("t").insert(0, "last words");
    room.leave(amy.peer);
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(later);
    expect(s.sent).toEqual([{ by: "amy@firm.example", text: "last words" }]);
    expect(empty).toHaveBeenCalledOnce();
    expect(room.closed).toBe(true);
  });

  it("keeps edits through an outage and sends them when it's back", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    s.down(true);
    amy.doc.getText("t").insert(0, "kept");
    await vi.advanceTimersByTimeAsync(FLUSH_AFTER + 10);
    expect(s.sent).toEqual([]);
    s.down(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.sent).toEqual([{ by: "amy@firm.example", text: "kept" }]);
    room.close();
  });

  it("relays cursors under the signed-in email, drops them on leave, and refuses a borrowed one", async () => {
    const s = server();
    const room = new Room(ID, { sync: s.sync });
    const amy = await browser(room, s, "amy@firm.example", "edit");
    const ben = await browser(room, s, "ben@firm.example", "edit");
    const seen = new Awareness(new Y.Doc());
    const relay = () => {
      for (const f of ben.got.filter((x) => x.t === "awareness").splice(0))
        applyAwarenessUpdate(seen, fromB64(String(f.update)), "room");
      ben.got.splice(0, ben.got.length, ...ben.got.filter((x) => x.t !== "awareness"));
    };
    const mine = new Awareness(amy.doc);
    mine.setLocalState({ user: { email: "someone@else.example", name: "Amy" }, cursor: null });
    const up = encodeAwarenessUpdate(mine, [amy.doc.clientID]);
    room.message(amy.peer, JSON.stringify({ t: "awareness", update: toB64(up) }));
    relay();
    expect(seen.getStates().get(amy.doc.clientID)).toMatchObject({
      user: { email: "amy@firm.example", name: "Amy" },
    });
    // Ben sends a newer state for Amy's cursor: closed.
    mine.setLocalStateField("cursor", { anchor: 1 });
    const borrowed = encodeAwarenessUpdate(mine, [amy.doc.clientID]);
    room.message(ben.peer, JSON.stringify({ t: "awareness", update: toB64(borrowed) }));
    expect(ben.closed).toEqual([4400]);
    room.leave(amy.peer);
    relay();
    expect(seen.getStates().has(amy.doc.clientID)).toBe(false);
    mine.destroy();
    seen.destroy();
    room.close();
  });
});
