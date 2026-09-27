// Wren SMS: inbox, thread + reply, numbers, stats. Vanilla, hash-routed, text only
// through textContent (never innerHTML), so a reply can never inject markup.

const view = document.getElementById("view");
const title = document.getElementById("title");
const back = document.getElementById("back");
const tabs = document.getElementById("tabs");
const status = document.getElementById("status");

const DISPOSITIONS = [
  "interested",
  "not_interested",
  "question",
  "wrong_person",
  "opt_out",
  "other",
];
const POLL_MS = 20_000;
let poll = null;
let filter = "all";

// ---- tiny DOM helper ------------------------------------------------------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function screen(name, ...kids) {
  title.textContent = name;
  view.replaceChildren(...kids);
}

function us(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const words = (s) => String(s).replace(/_/g, " ");

function when(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---- server ---------------------------------------------------------------

class SignedOut extends Error {}

async function post(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401) throw new SignedOut();
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

const api = (handler, body) => post(`/api/${handler}`, body);

// ---- passkeys (WebAuthn JSON <-> binary, by hand so older Safari works) ----

const b64u = {
  toBytes(s) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
  from(buf) {
    let bin = "";
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
};

async function addDevice(setup, label) {
  const o = await post("/auth/register/options", { setup });
  const cred = await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: b64u.toBytes(o.challenge),
      user: { ...o.user, id: b64u.toBytes(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({
        ...c,
        id: b64u.toBytes(c.id),
      })),
    },
  });
  const r = cred.response;
  await post("/auth/register/verify", {
    setup,
    label,
    response: {
      id: cred.id,
      rawId: b64u.from(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults(),
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64u.from(r.clientDataJSON),
        attestationObject: b64u.from(r.attestationObject),
        transports: r.getTransports ? r.getTransports() : [],
      },
    },
  });
}

async function signIn() {
  const o = await post("/auth/login/options");
  const cred = await navigator.credentials.get({
    publicKey: {
      ...o,
      challenge: b64u.toBytes(o.challenge),
      allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64u.toBytes(c.id) })),
    },
  });
  const r = cred.response;
  await post("/auth/login/verify", {
    response: {
      id: cred.id,
      rawId: b64u.from(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults(),
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: b64u.from(r.clientDataJSON),
        authenticatorData: b64u.from(r.authenticatorData),
        signature: b64u.from(r.signature),
        userHandle: r.userHandle ? b64u.from(r.userHandle) : undefined,
      },
    },
  });
}

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  return "device";
}

function signInScreen(message) {
  stopPoll();
  tabs.hidden = true;
  back.hidden = true;
  const setup = new URLSearchParams(location.search).get("setup");
  const err = message ? h("div", { class: "error" }, message) : null;
  if (setup) {
    const label = h("input", { class: "field", value: guessDevice(), "aria-label": "Device name" });
    const btn = h("button", { class: "primary" }, "Add this device with a passkey");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await addDevice(setup, label.value.trim() || "device");
        history.replaceState(null, "", "/#/inbox");
        route();
      } catch (e) {
        signInScreen(e.message);
      }
    });
    screen(
      "Add device",
      h(
        "div",
        { class: "center" },
        h("p", {}, "One time per device. Face ID, fingerprint or Touch ID."),
        label,
        btn,
      ),
      err,
    );
    return;
  }
  const btn = h("button", { class: "primary" }, "Sign in with passkey");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await signIn();
      route();
    } catch (e) {
      signInScreen(e.name === "NotAllowedError" ? "Cancelled." : e.message);
    }
  });
  screen("Wren SMS", h("div", { class: "center" }, h("p", {}, "Signed out."), btn), err);
}

// ---- screens ----------------------------------------------------------------

async function inbox() {
  back.hidden = true;
  const rows = await api("threads", { filter, limit: 100 });
  const chips = ["all", "unread", "replied"].map((f) =>
    h(
      "button",
      {
        class: `chip${f === filter ? " on" : ""}`,
        onclick: () => {
          filter = f;
          route();
        },
      },
      f,
    ),
  );
  const list = rows.length
    ? h(
        "ul",
        { class: "list" },
        rows.map((t) =>
          h(
            "li",
            {},
            h(
              "a",
              { class: `row${t.unread ? " unread" : ""}`, href: `#/thread/${t.contactId}` },
              h(
                "div",
                { class: "row-top" },
                h(
                  "span",
                  { class: "row-name" },
                  t.company || t.display,
                  t.disposition ? h("span", { class: "tag" }, words(t.disposition)) : null,
                ),
                h("span", { class: "row-when" }, when(t.lastAt)),
              ),
              h("div", { class: "row-body" }, t.lastDirection === "out" ? "You: " : "", t.lastBody),
            ),
          ),
        ),
      )
    : h("div", { class: "empty" }, filter === "all" ? "No texts yet." : `Nothing ${filter}.`);
  screen("Inbox", h("div", { class: "filters" }, chips), list);
}

async function thread(id) {
  back.hidden = false;
  const t = await api("thread", { contactId: id });
  if (!t) return screen("Not found", h("div", { class: "empty" }, "No such thread."));
  const c = t.contact;
  const meta = h(
    "div",
    { class: "meta" },
    `${c.display} · ${words(c.state)}`,
    c.fromNumber ? ` · from ${us(c.fromNumber)}` : "",
    h("br"),
    `basis ${c.basis}`,
    c.basisDetail ? ` (${c.basisDetail})` : "",
    c.sourceUrl
      ? [
          " · ",
          h("a", { href: c.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, "found here"),
        ]
      : "",
  );
  const bubbles = h("div", { class: "bubbles" });
  for (const m of t.messages) {
    const side = m.direction === "in" ? "in" : "out";
    bubbles.append(h("div", { class: `bubble ${side}` }, m.body));
    const bits = [when(m.at)];
    if (side === "out") bits.push(m.state);
    const metaEl = h("div", { class: `bubble-meta ${side}` }, bits.join(" · "));
    if (m.state === "failed" || m.state === "unknown") metaEl.classList.add("bad");
    if (m.errorCode || m.detail) metaEl.append(` · ${m.errorCode || ""} ${m.detail || ""}`);
    if (side === "in") {
      const sel = h(
        "select",
        { "aria-label": "Label" },
        h("option", { value: "" }, m.disposition ? "" : "label…"),
        DISPOSITIONS.map((d) => h("option", { value: d, selected: d === m.disposition }, words(d))),
      );
      sel.addEventListener("change", async () => {
        if (!sel.value) return;
        try {
          await api("label", { messageId: m.id, disposition: sel.value });
        } catch (e) {
          alert(e.message);
        }
      });
      metaEl.append(sel);
    }
    bubbles.append(metaEl);
  }
  screen(c.company || c.display, meta, bubbles, composer(c));
  bubbles.lastElementChild?.scrollIntoView({ block: "end" });
  if (
    c.readAt === null ||
    t.messages.some((m) => m.direction === "in" && new Date(m.at) > new Date(c.readAt))
  ) {
    api("markRead", { contactId: id }).catch(() => {});
  }
}

function composer(c) {
  if (c.state === "opted_out")
    return h(
      "div",
      { class: "composer" },
      h("span", { class: "count" }, "Opted out. Never texted again unless they text START."),
    );
  const box = h("textarea", { rows: 1, placeholder: "Text", "aria-label": "Message" });
  const count = h("span", { class: "count" });
  const send = h("button", { class: "send", disabled: true }, "Send");
  box.addEventListener("input", () => {
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
    count.textContent = box.value.length > 120 ? String(box.value.length) : "";
    send.disabled = box.value.trim() === "";
  });
  send.addEventListener("click", async () => {
    send.disabled = true;
    try {
      await api("reply", { contactId: c.id, body: box.value });
      box.value = "";
      route();
    } catch (e) {
      if (e instanceof SignedOut) return signInScreen();
      alert(e.message);
      send.disabled = false;
    }
  });
  return h("div", { class: "composer" }, box, count, send);
}

async function numbers() {
  back.hidden = true;
  const v = await api("numbers");
  const header = h(
    "div",
    { class: "card" },
    h("h2", {}, `Today (${v.day})`),
    h(
      "div",
      { class: "kv" },
      h("span", {}, "Sent"),
      h("span", {}, `${v.sentToday} / ${v.dailyCap}`),
    ),
    h("div", { class: "kv" }, h("span", {}, "Room left"), h("span", {}, v.remaining)),
    h(
      "div",
      { class: "kv" },
      h("span", {}, "Provider"),
      h("span", {}, `${v.provider}${v.live ? " · live" : " · not live"}`),
    ),
  );
  const cards = v.numbers.length
    ? v.numbers.map((n) => {
        const btn = h("button", { class: "btn" }, n.state === "paused" ? "Resume" : "Pause");
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            if (n.state === "paused") await api("resume", { e164: n.e164 });
            else await api("pause", { e164: n.e164, reason: "paused from the phone" });
            route();
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
          }
        });
        return h(
          "div",
          { class: "card" },
          h("h2", {}, n.display, h("span", { class: "tag" }, n.state)),
          h(
            "div",
            { class: "kv" },
            h("span", {}, "Today"),
            h("span", {}, `${n.sentToday} / ${n.cap}`),
          ),
          h("div", { class: "kv" }, h("span", {}, "Ramp from"), h("span", {}, n.rampStartedOn)),
          n.pausedReason ? h("div", { class: "kv bad" }, n.pausedReason) : null,
          n.state === "retired" ? null : btn,
        );
      })
    : [
        h(
          "div",
          { class: "empty" },
          "No numbers. Buy them at Telnyx, then run `wren sms numbers sync`.",
        ),
      ];
  screen("Numbers", header, ...cards);
}

async function stats() {
  back.hidden = true;
  const s = await api("stats", { days: 30 });
  const kv = (k, v) => h("div", { class: "kv" }, h("span", {}, k), h("span", {}, v));
  screen(
    "Stats",
    h(
      "div",
      { class: "card" },
      h("h2", {}, `Last 30 days · ${s.texted} texted`),
      kv("Delivered", s.delivery.text),
      kv("Replied", s.reply.text),
      kv("Interested", s.interested.text),
      kv("Opted out", s.optOut.text),
      kv("Spend", `$${s.costUsd.toFixed(2)}`),
      s.costPerReplyUsd !== null ? kv("Per reply", `$${s.costPerReplyUsd.toFixed(2)}`) : null,
    ),
    h(
      "div",
      { class: "card" },
      h("h2", {}, "By step"),
      s.steps.length
        ? s.steps.map((r) =>
            kv(
              `${r.sequence ?? "manual"} #${r.step ?? "-"}`,
              `${r.delivered}/${r.sent} delivered · ${r.failed} failed`,
            ),
          )
        : h("div", { class: "empty" }, "Nothing sent."),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Contacts"),
      Object.entries(s.contacts).map(([k, v]) => kv(words(k), v)),
    ),
  );
}

// ---- router -------------------------------------------------------------------

/** Not typing, not picking a label: a refresh would not lose anything. */
function idle() {
  const draft = view.querySelector("textarea");
  return !draft?.value.trim() && !document.activeElement?.matches("textarea, select");
}

function stopPoll() {
  if (poll) clearInterval(poll);
  poll = null;
}

async function route() {
  stopPoll();
  const [, name = "inbox", arg] = (location.hash || "#/inbox").split("/");
  tabs.hidden = false;
  for (const a of tabs.querySelectorAll("a")) a.classList.toggle("on", a.dataset.tab === name);
  status.textContent = "";
  try {
    if (name === "thread") {
      tabs.hidden = true;
      await thread(Number(arg));
    } else if (name === "numbers") await numbers();
    else if (name === "stats") await stats();
    else await inbox();
    if (name === "inbox" || name === "thread") {
      poll = setInterval(
        () => document.visibilityState === "visible" && idle() && route(),
        POLL_MS,
      );
    }
  } catch (e) {
    if (e instanceof SignedOut) return signInScreen();
    status.textContent = "offline";
    view.prepend(h("div", { class: "error" }, e.message));
  }
}

back.addEventListener("click", () => (location.hash = "#/inbox"));
window.addEventListener("hashchange", route);
document.addEventListener(
  "visibilitychange",
  () => document.visibilityState === "visible" && idle() && route(),
);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

if (new URLSearchParams(location.search).get("setup")) signInScreen();
else route();
