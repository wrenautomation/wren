# SpamAssassin for `wren email spamcheck` (designs/2026-10-05-deliverability-tests.md).
# Local rules only at run time (spamd --local): the block lists are the setup test's job.
# Rules are fetched once at build; rebuild to refresh them.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends spamassassin spamc spamd ca-certificates gnupg \
 && rm -rf /var/lib/apt/lists/* \
 && (sa-update || [ $? -eq 1 ]) \
 && useradd --system --no-create-home spamd
USER root
EXPOSE 783
