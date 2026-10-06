// A credential link (designs/2026-10-06-credential-links.md). Wren's sign-in fetches the
// ciphertext once; the key is the link's fragment and never leaves this page. Text only
// through textContent.

const view = document.getElementById("view");
const id = location.pathname.split("/")[2];
const AUTH = location.hostname.startsWith("phone.")
  ? `https://auth.${location.hostname.slice("phone.".length)}`
  : null;
const KEPT = `cred-link:${id}`;
const CLEAR_MS = 120_000;

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

/** A POST with a fresh token from Wren's sign-in; null when signed out. */
async function call(path) {
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
  let cred = JSON.parse(new TextDecoder().decode(plain));
  sessionStorage.removeItem(KEPT);
  const copy = (field, label) =>
    h(
      "button",
      {
        class: "primary",
        onclick: async (e) => {
          if (!cred) return;
          await navigator.clipboard.writeText(cred[field]);
          e.target.textContent = "Copied";
          setTimeout(() => (e.target.textContent = label), 1500);
        },
      },
      label,
    );
  show(
    h("p", {}, cred.site),
    copy("username", "Copy username"),
    copy("password", "Copy password"),
    h("p", {}, "Cleared from this page in 2 minutes."),
  );
  setTimeout(() => {
    cred = null;
    say("Cleared. Mint a new link if you need it again.");
  }, CLEAR_MS);
}

async function main() {
  if (!AUTH) return say("Open this on phone.wrenautomation.com.");
  if (!key) return say("This link has no key. Mint a new one.");
  const peek = await call(`/api/links/${id}`);
  if (!peek) return signIn();
  show(
    h("p", {}, `A login for ${peek.site}. It opens once.`),
    h("button", { class: "primary", onclick: () => reveal().catch(fail) }, "Reveal"),
  );
}

const fail = (e) => say(e instanceof DOMException ? "This link's key is wrong." : e.message);
main().catch(fail);
