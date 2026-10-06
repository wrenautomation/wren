# Credential links: a stored login on the phone, once

2026-10-06. William: "a secure single use link for credentials (username as one clipboard copy,
password as the other) is a good feature for mobile". He can't run `autobrowse creds copy` on the
iPhone, so a login that has to happen on the phone (a Studio setting, an app sign-in) stalls.

## What it is

- **Mint (the Mac):** `autobrowse creds link <site>` reads the sealed store, encrypts
  `{site, username, password}` with AES-GCM under a fresh random key, stores only the
  ciphertext on the phone Worker (10 min TTL), and prints
  `https://phone.wrenautomation.com/c/<id>#<key>`. Nothing else is printed. Audited like
  `creds copy`.
- **Reveal (the phone):** `/c/<id>` needs Wren's operator sign-in (auth.wrenautomation.com,
  passkey: the same sign-in as the SMS app). The page shows the site and a Reveal button. Reveal is
  a POST that returns the ciphertext and deletes it. The browser decrypts with the key from the
  fragment (never sent to a server) and shows two buttons: Copy username, Copy password. The page
  drops the plaintext after 2 minutes.

## Why this shape

- The server never sees a password: ciphertext on the Worker, key only in the link's fragment.
- The link alone opens nothing: fetching the ciphertext takes an operator sign-in.
- Link previews can't burn it: GET shows the page and only the POST consumes it.
- Single use plus a 10 min TTL means a link left in chat or a log is dead soon after.

## Pieces

- `apps/phone`: a KV namespace (`CRED_LINKS`, `expirationTtl` 600). `POST /links` (the Mac, HMAC
  signed with `CRED_LINK_SECRET`, the same shape as the cal.com door) stores `{site, iv, data}`
  under a random 128-bit id. `POST /api/links/<id>/take` (operator token) returns it once and
  deletes it. `/c/<id>` serves the reveal page (static, in `public/`, WebCrypto). The KV free tier
  covers it ($0).
- autobrowse: `creds link <site>` beside `creds copy`, the secret in its env (same name), the URL
  from config.
- Secret: `CRED_LINK_SECRET` set in wren with `secrets.mjs set`, then `wrangler secret put`
  (deploy/phone.md); autobrowse reads the same value from its env.

ponytail: KV get-then-delete is not atomic. Two signed-in operators racing the same link inside a
second could both read it. Move to a Durable Object if that ever matters.

## Rules

- The agent mints only for Wren's accounts unless William names a personal one.
- Never mint in a loop; one link per ask.
- No TOTP seeds or recovery codes in a link. Add a current TOTP code later if a phone login needs
  one.

## Decision log

- 2026-10-06: built from William's ask; shape is my call (fragment key + operator sign-in + POST
  to consume). He can redirect.
- 2026-10-06: built. Added `POST /api/links/<id>` (operator) so the page can name the site before
  Reveal without consuming it. The mint body carries `at`; one older than 5 minutes is refused, so
  a captured mint can't be replayed. Signature header `x-wren-signature-256`. Before the sign-in
  round trip the page moves the key from the fragment to the tab's sessionStorage, so the sign-in
  server's `next` never carries it.
