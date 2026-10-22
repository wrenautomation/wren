# Documenso for Wren e-signatures

Design: `designs/2026-10-21-esign-and-newsletter.md`. Documenso 2.21.0, AGPL, run unmodified.
Wren talks to it over HTTP only. It needs about 520 MB with its database. It does not fit the
database box. Use a host with 2 GB and Docker (see "Hosting options" in the design).

## Set up

1. DNS: an `A` record for the sign-in name (for example `sign.<your domain>`) to the host. DNS only.
2. Make the signing certificate. It is self-made: the seal proves the file did not change.
   Use a long passphrase. Set it first: `export CERT_PASS=...`.

       openssl genrsa -out private.key 3072
       openssl req -new -x509 -key private.key -out certificate.crt -days 3650 -subj "/O=Wren Automation/CN=Wren e-sign"
       openssl pkcs12 -export -out wren-sign.p12 -inkey private.key -in certificate.crt -password env:CERT_PASS

   Put `wren-sign.p12` and its passphrase in credvault. Then delete `private.key`.
3. Copy this folder to the host (`/opt/wren-documenso`). Copy `documenso.env.example` to a file
   named `.env` there. Fill it: `openssl rand -hex 24` for each secret, and
   `base64 < wren-sign.p12 | tr -d '\n'` for `SIGNING_P12_BASE64`. Mode 600.
4. `docker compose up -d`. Open `https://<DOCUMENSO_HOST>`. Make the first account (William's).
5. Set `DISABLE_SIGNUP=true` in the file. Run `docker compose up -d` again.
6. In Documenso: Settings, API tokens, make a token. Settings, Webhooks, add
   `https://phone.wrenautomation.com/webhooks/documenso`. Pick a long random secret. Turn on the
   events Document opened, completed, rejected and cancelled.

## Connect Wren

Three values. Two go in AWS SSM `/wren/prod/env-3` (a JSON object; the Terraform resource
`aws_ssm_parameter.env_3` makes it empty). One goes to the phone Worker.

    WREN_DOCUMENSO_URL    https://<DOCUMENSO_HOST>
    WREN_DOCUMENSO_TOKEN  the API token from step 6
    DOCUMENSO_WEBHOOK_SECRET   the same secret as the webhook (Worker secret, see deploy/phone.md)

Merge the two keys into `env-3` by JSON. Never run push-secrets for this. The workers read the
parameter at start, so deploy after. Without the two keys a sealed send stops with a clear reason
and the own-signature flow is not affected.

Send one sealed document to an address of yours before any client. Check: the mail has the link,
the signed PDF opens in Documenso and in Wren, and the status goes sent, viewed, signed.

## Run

- Logs: `docker compose logs -f app`.
- Update: change the image tag in `compose.yml` (read Documenso's release notes first), then
  `docker compose pull && docker compose up -d`. Documenso migrates its own database.
- Back up the `pgdata` volume. Wren keeps the signed PDF, certificate and audit log of every
  completed document in its own bucket, so a lost Documenso loses only open envelopes.
- Lost `.p12`: old PDFs stay valid. New seals need a new certificate.
