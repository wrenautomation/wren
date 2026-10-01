// Wren SMS: inbox, thread + reply, numbers, templates, stats. Vanilla, hash-routed, text only
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
// Sign-in is Wren's (auth.<domain>): a passkey, an emailed code, Google... The app
// holds the 15-minute token from there and sends it with each call; the Worker
// lets Wren's operators in.

class SignedOut extends Error {}

const AUTH = location.hostname.startsWith("phone.")
  ? `https://auth.${location.hostname.slice("phone.".length)}`
  : null;
let held = null;

/** The current token, fetched again a minute before it runs out. */
async function token() {
  if (!AUTH) return null;
  if (held && held.until > Date.now()) return held.token;
  const res = await fetch(`${AUTH}/api/auth/token`, { credentials: "include" });
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  const { token: t } = await res.json();
  const exp = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp;
  held = { token: t, until: exp * 1000 - 60_000 };
  return t;
}

async function post(path, body = {}, retried = false) {
  const t = await token();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // A token the Worker refused (keys rotated, clock skew): one fresh one, then sign in.
  if (res.status === 401) {
    held = null;
    if (!retried) return post(path, body, true);
    throw new SignedOut();
  }
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

function signInScreen(message) {
  stopPoll();
  tabs.hidden = true;
  back.hidden = true;
  const here = encodeURIComponent(location.href);
  const err = message ? h("div", { class: "error" }, message) : null;
  const btn = h("button", { class: "primary" }, "Sign in");
  btn.addEventListener("click", () => AUTH && location.assign(`${AUTH}/?next=${here}`));
  const passkey = AUTH
    ? h("a", { href: `${AUTH}/passkeys?next=${here}` }, "Add a passkey on this device")
    : null;
  screen(
    "Wren SMS",
    h("div", { class: "center" }, h("p", {}, "Signed out. Use your Wren account."), btn, passkey),
    err,
  );
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
            h("span", {}, "Texts"),
            h(
              "span",
              { class: n.country === "US" && !n.registeredAt ? "bad" : "" },
              n.country === "US"
                ? n.registeredAt
                  ? `US phones since ${n.registeredAt.slice(0, 10)}`
                  : "US phones once carriers approve"
                : "Canadian phones",
            ),
          ),
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

async function templates() {
  back.hidden = true;
  const slots = await api("templates");
  const hint = h(
    "div",
    { class: "card hint" },
    "An empty template is never sent. {first_name|there} uses “there” when there’s no name.",
  );
  screen("Templates", hint, ...slots.map(templateCard));
}

function templateCard(t) {
  const rules = [];
  if (t.fields.length) rules.push(`Fields: ${t.fields.map((f) => `{${f}}`).join(" ")}`);
  if (t.mustSayStop) rules.push("Must include STOP.");
  if (t.minLength > 1) rules.push(`At least ${t.minLength} characters.`);
  const saved = t.body
    ? `${t.segments.parts} ${t.segments.parts === 1 ? "part" : "parts"} · saved ${when(t.updatedAt)} by ${t.updatedBy}`
    : "Empty, so it’s never sent.";
  const box = h("textarea", { class: "tpl", rows: 4, "aria-label": t.purpose });
  box.value = t.body;
  const count = h("span", { class: "count" });
  const save = h("button", { class: "btn", disabled: true }, "Save");
  const grow = () => {
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  };
  box.addEventListener("input", () => {
    grow();
    count.textContent = `${box.value.trim().length} characters`;
    save.disabled = box.value.trim() === t.body;
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      card.replaceWith(templateCard(await api("setTemplate", { key: t.key, body: box.value })));
    } catch (e) {
      if (e instanceof SignedOut) return signInScreen();
      alert(e.message);
      save.disabled = false;
    }
  });
  const card = h(
    "div",
    { class: "card" },
    h("h2", {}, t.purpose, h("span", { class: "tag" }, t.body ? "filled" : "empty")),
    rules.length ? h("div", { class: "hint" }, rules.join(" ")) : null,
    box,
    t.preview && t.preview !== t.body ? h("div", { class: "hint" }, `Sample: ${t.preview}`) : null,
    h(
      "div",
      { class: "tpl-foot" },
      h("span", { class: t.body ? "hint" : "hint bad" }, saved),
      count,
      save,
    ),
  );
  requestAnimationFrame(grow);
  return card;
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
    else if (name === "templates") await templates();
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

route();
