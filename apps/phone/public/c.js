// A credential link (designs/2026-10-06-credential-links.md). The ciphertext is fetched once
// (an open link without sign-in, any other through Wren's sign-in); the key is the link's
// fragment and never leaves this page. It holds `{label, fields: [{name, value}]}`. Text only
// through textContent.

const view = document.getElementById("view");
const id = location.pathname.split("/")[2];
const AUTH = location.hostname.startsWith("phone.")
  ? `https://auth.${location.hostname.slice("phone.".length)}`
  : null;
const KEPT = `cred-link:${id}`;
const CLEAR_MS = 300_000;

// The key moves to this tab's storage and off the address bar: the sign-in round trip returns
// to the bare path, and neither the history nor the sign-in server ever sees it.
if (location.hash.length > 1) {
  sessionStorage.setItem(KEPT, location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
}
const key = sessionStorage.getItem(KEPT);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}
const show = (...kids) => view.replaceChildren(...kids);
const say = (text) => show(h("p", {}, text));

/** A POST: bare first (an open link), then with a token from Wren's sign-in; null when signed out. */
async function call(path) {
  const bare = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (bare.status !== 401) return answer(bare);
  if (!AUTH) return null;
  const t = await fetch(`${AUTH}/api/auth/token`, { credentials: "include" });
  if (t.status === 401) return null;
  if (!t.ok) throw new Error(`sign-in ${t.status}`);
  const { token } = await t.json();
  const res = await fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) return null;
  return answer(res);
}

async function answer(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function signIn() {
  const next = encodeURIComponent(location.origin + location.pathname);
  show(
    h("p", {}, "Sign in with your Wren account to open this login."),
    h(
      "button",
      { class: "primary", onclick: () => location.assign(`${AUTH}/?next=${next}`) },
      "Sign in",
    ),
  );
}

const bytes = (b64) =>
  Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function reveal() {
  say("Opening…");
  const sealed = await call(`/api/links/${id}/take`);
  if (!sealed) return signIn();
  const k = await crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(sealed.iv) },
    k,
    bytes(sealed.data),
  );
  let held = JSON.parse(new TextDecoder().decode(plain));
  sessionStorage.removeItem(KEPT);
  const field = (i) => {
    const { name } = held.fields[i];
    const value = h("code", { hidden: "" });
    const copy = h(
      "button",
      {
        class: "primary",
        onclick: async () => {
          if (!held) return;
          await navigator.clipboard.writeText(held.fields[i].value);
          copy.textContent = "Copied";
          setTimeout(() => (copy.textContent = `Copy ${name}`), 1500);
        },
      },
      `Copy ${name}`,
    );
    const peek = h(
      "button",
      {
        class: "peek",
        onclick: () => {
          if (!held) return;
          value.textContent = held.fields[i].value;
          value.hidden = !value.hidden;
          peek.textContent = value.hidden ? "Show" : "Hide";
        },
      },
      "Show",
    );
    return h("div", { class: "item" }, copy, peek, value);
  };
  show(
    h("p", {}, held.label),
    ...held.fields.map((_, i) => field(i)),
    h("p", {}, "Cleared from this page in 5 minutes. The link no longer works."),
  );
  setTimeout(() => {
    held = null;
    say("Cleared. Ask for a new link if you need it again.");
  }, CLEAR_MS);
}

async function main() {
  if (!key) return say("This link has no key. Ask for a new one.");
  const peek = await call(`/api/links/${id}`);
  if (!peek) return AUTH ? signIn() : say("Open this on phone.wrenautomation.com.");
  show(
    h("p", {}, `${peek.label}. It opens once.`),
    h("button", { class: "primary", onclick: () => reveal().catch(fail) }, "Reveal"),
  );
}

const fail = (e) => say(e instanceof DOMException ? "This link's key is wrong." : e.message);
main().catch(fail);
