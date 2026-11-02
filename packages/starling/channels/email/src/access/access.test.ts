// Each mailbox's state, what blocks it and the next step: pure, from accounts and connections.

import { keyProblem, MAIL_TOKEN_NAME } from "@wren/core/key-refs";
import type { AccountView } from "@wren/core/setup";
import { describe, expect, it } from "vitest";
import { FACTS, mailboxStates, tokenName } from "./access.js";
import type { ConnectionRow } from "./schema.js";

let n = 0;
const acct = (site: string, ref: string, role = "send", facts: AccountView["facts"] = []) =>
  ({ id: ++n, client: "acme", site, ref, role, facts, runs: [] }) as unknown as AccountView;
const fact = (f: string, ok: boolean) =>
  ({
    fact: f,
    state: ok ? "ok" : "failing",
    why: ok ? "ok" : "no",
    checkedAt: new Date(0),
  }) as never;
const conn = (a: AccountView, access: "send" | "read", state = "connected") =>
  ({
    accountId: a.id,
    access,
    state,
    why: null,
    connectedAt: new Date(0),
  }) as unknown as ConnectionRow;
const BOTH = { google: true, microsoft: true };

describe("mailboxStates", () => {
  it("without Wren's app: Needs setup, nothing to press", () => {
    const m = acct("mailbox", "ann@acme.example");
    const [v] = mailboxStates([m], [], { google: false, microsoft: false }).mailboxes;
    expect(v).toMatchObject({ state: "not_set_up", blocking: "Needs setup: Wren's Google app" });
    expect(v?.may).toEqual({ connectSend: false, connectRead: false });
  });

  it("a Workspace mailbox to read waits on the admin, and can send meanwhile", () => {
    const org = acct("google_workspace", "acme.example");
    const m = acct("mailbox", "ann@acme.example", "read");
    const out = mailboxStates([org, m], [], BOTH);
    expect(out.orgs[0]).toMatchObject({ ready: false, readers: 1, provider: "google" });
    expect(out.mailboxes[0]).toMatchObject({ state: "waiting_admin", want: "read" });
    // Google allows the test read before trust; that read is the Check.
    expect(out.mailboxes[0]?.may).toEqual({ connectSend: true, connectRead: true });
  });

  it("Microsoft can't connect to read until the admin consents", () => {
    const org = acct("microsoft_365", "beta.example");
    const m = acct("mailbox", "bo@beta.example", "read");
    const [before] = mailboxStates([org, m], [], BOTH).mailboxes;
    expect(before?.may.connectRead).toBe(false);
    const ready = acct("microsoft_365", "beta.example", "send", [
      fact(FACTS.microsoftConsent, true),
    ]);
    const m2 = acct("mailbox", "bo@beta.example", "read");
    const [after] = mailboxStates([ready, m2], [], BOTH).mailboxes;
    expect(after).toMatchObject({ provider: "microsoft", state: "not_set_up" });
    expect(after?.may.connectRead).toBe(true);
  });

  it("send only on personal Gmail says why reading can't", () => {
    const m = acct("mailbox", "cy@gmail.com", "read");
    const [v] = mailboxStates([m], [conn(m, "send")], BOTH).mailboxes;
    expect(v).toMatchObject({ state: "send_only", personal: true });
    expect(v?.blocking).toMatch(/^Needs Workspace trust/);
    expect(v?.may.connectRead).toBe(false);
  });

  it("connected to read; broken says connect again", () => {
    const org = acct("google_workspace", "acme.example", "send", [fact(FACTS.googleTrust, true)]);
    const m = acct("mailbox", "ann@acme.example", "read");
    expect(mailboxStates([org, m], [conn(m, "read")], BOTH).mailboxes[0]).toMatchObject({
      state: "read_send",
      blocking: null,
      next: null,
    });
    const [b] = mailboxStates([org, m], [conn(m, "read", "broken")], BOTH).mailboxes;
    expect(b).toMatchObject({ state: "broken", next: "Connect it again." });
  });

  it("a send-only mailbox that wants nothing more is done", () => {
    const m = acct("mailbox", "ann@acme.example");
    expect(mailboxStates([m], [conn(m, "send")], BOTH).mailboxes[0]).toMatchObject({
      state: "send_only",
      blocking: null,
    });
  });
});

describe("tokenName", () => {
  it("is a key store name, the address hashed", () => {
    const k = tokenName("google", "Ann@Acme.example");
    expect(k).toMatch(MAIL_TOKEN_NAME);
    expect(k).toBe(tokenName("google", "ann@acme.example"));
    expect(k).not.toContain("ANN");
    expect(keyProblem(k, JSON.stringify({ refresh: "synthetic-refresh" }), "wren")).toBeNull();
    expect(keyProblem(k, JSON.stringify({ refresh: "synthetic-refresh" }))).toContain(
      "by that name",
    );
  });
});
