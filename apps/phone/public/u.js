// A drop (autobrowse designs/2026-10-20-files.md): a photo or document sealed in this browser under the key in
// the link's fragment, posted as ciphertext once. The key never leaves this page; the Worker
// keeps only the ciphertext until the Mac takes it. Text only through textContent.

const view = document.getElementById("view");
const id = location.pathname.split("/")[2];
const AUTH = location.hostname.startsWith("phone.")
  ? `https://auth.${location.hostname.slice("phone.".length)}`
  : null;
const KEPT = `drop:${id}`;
const MAX = 12 * 1024 * 1024;

// The key moves to this tab's storage and off the address bar, as on the reveal page.
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

let token = null;
/** A POST: bare first (an open drop), then with a token from Wren's sign-in; null when signed out. */
async function call(path, body = "{}") {
  const send = (auth) =>
    fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body,
    });
  if (!token) {
    const bare = await send(null);
    if (bare.status !== 401) return answer(bare);
    if (!AUTH) return null;
    const t = await fetch(`${AUTH}/api/auth/token`, { credentials: "include" });
    if (t.status === 401) return null;
    if (!t.ok) throw new Error(`sign-in ${t.status}`);
    token = (await t.json()).token;
  }
  const res = await send(token);
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
    h("p", {}, "Sign in with your Wren account to send this."),
    h(
      "button",
      { class: "primary", onclick: () => location.assign(`${AUTH}/?next=${next}`) },
      "Sign in",
    ),
  );
}

const bytes = (b64) =>
  Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
function b64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function send(file) {
  if (file.size > MAX)
    return say("That file is over 12 MB. Take the photo again, or send a smaller scan.");
  say("Sealing on this phone…");
  const k = await crypto.subtle.importKey("raw", bytes(key), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, await file.arrayBuffer());
  say("Sending…");
  const done = await call(
    `/api/drops/${id}/fill`,
    JSON.stringify({ iv: b64(iv), data: b64(sealed) }),
  );
  if (!done) return signIn();
  sessionStorage.removeItem(KEPT);
  say("Sent. Only Wren's Mac can open it. This link no longer works.");
}

async function main() {
  if (!key) return say("This link has no key. Ask for a new one.");
  const peek = await call(`/api/drops/${id}`);
  if (!peek) return AUTH ? signIn() : say("Open this on phone.wrenautomation.com.");
  if (peek.filled) return say("Already sent. Ask for a new link to send another.");
  const input = h("input", {
    type: "file",
    accept:
      "image/jpeg,image/png,image/heic,image/webp,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,text/markdown",
    hidden: "",
    onchange: () => input.files[0] && send(input.files[0]).catch(fail),
  });
  show(
    h("p", {}, `${peek.label}.`),
    h("p", {}, "Sealed on this phone before it leaves. Nobody but Wren's Mac can open it."),
    input,
    h(
      "button",
      { class: "primary", onclick: () => input.click() },
      "Take a photo or choose a file",
    ),
  );
}

const fail = (e) => say(e instanceof DOMException ? "This link's key is wrong." : e.message);
main().catch(fail);
