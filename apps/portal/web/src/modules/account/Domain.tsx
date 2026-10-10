/**
 * Domain: this portal on the client's own address, like portal.theirfirm.com. An owner sets it up.
 * Once it's live, the site chat tag for their website comes from it (designs/2026-10-09-site-chat.md).
 */
import {
  Button,
  Copyable,
  Empty,
  Facts,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  Tag,
} from "@wren/ui";
import { type ReactNode, useEffect, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FIELD, Form, field, QUIET, TOOLS, useAct } from "../work/bits.js";

interface DomainView {
  hostname: string;
  live: boolean;
  status: string;
  sslStatus: string;
  records: {
    cname: { name: string; target: string };
    txt: { name: string; value: string } | null;
  };
  problem: string | null;
  checkedAt: string;
}

interface Domains {
  domains: DomainView[];
  target: string;
  ready: boolean;
  canManage: boolean;
}

/** While a domain waits on DNS, look again this often. */
const POLL_MS = 15_000;

/** The chat bubble for their website: one tag, served from their live domain. */
function SiteChat({ live }: { live: string | null }) {
  return (
    <Section
      title="Site chat"
      note="A chat bubble on your website. Messages land in Marketing → Inbox, and you answer there."
    >
      {live ? (
        <div className="grid gap-3">
          <Copyable text={`<script src="https://${live}/o/__chat.js" async></script>`} />
          <p className={QUIET}>
            Paste it before {"</body>"} on every page, or once in your site builder's footer code.
            Add data-color="#1d4ed8" to match your brand, or data-greeting="Ask us anything" for the
            first line.
          </p>
        </div>
      ) : (
        <Empty>The chat tag comes from your domain. Set one up above and it shows here.</Empty>
      )}
    </Section>
  );
}

function stateOf(d: DomainView): string {
  if (d.live) return "Live. Your portal works at this address.";
  if (d.sslStatus === "pending_validation" || d.status === "pending")
    return "Waiting for the DNS record. This page checks again every few seconds. It usually takes a few minutes, sometimes an hour.";
  return `Not live yet (${d.status}, certificate ${d.sslStatus}).`;
}

export function Domain(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const load = useCall(`domains:${props.client}:${props.team}:${nonce}`, () =>
    call<Domains>("delivery/domains", { client: props.client, asClient: !props.team }),
  );
  const act = useAct(props, () => setNonce((n) => n + 1));
  const data = load.data;
  const waiting = data?.domains.some((d) => !d.live) ?? false;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [waiting]);

  return (
    <>
      <PageHeader
        title="Domain"
        lede="Open this portal at your own address, like portal.yourfirm.com. You add one DNS record and we handle the certificate."
      />
      <Section>
        {load.error && !data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !data ? (
          <Loading lines={3} />
        ) : data.domains.length === 0 ? (
          <Empty>
            {data.ready
              ? "No domain yet. Your portal is at app.wrenautomation.com."
              : "Custom domains aren't switched on yet."}
          </Empty>
        ) : (
          data.domains.map((d) => (
            <div key={d.hostname} className="grid gap-3">
              <p>
                <b>{d.hostname}</b>{" "}
                <Tag tone={d.live ? "green" : "neutral"}>{d.live ? "Live" : "Setting up"}</Tag>
              </p>
              <p className={QUIET}>{stateOf(d)}</p>
              {d.problem ? <p className={ERROR}>{d.problem}</p> : null}
              {d.live ? (
                <p>
                  <a className="underline" href={`https://${d.hostname}/`}>
                    Open {d.hostname}
                  </a>
                </p>
              ) : null}
              <Facts
                items={[
                  ["Type", "CNAME"],
                  ["Name", <Copyable key="n" text={d.records.cname.name} />],
                  ["Value", <Copyable key="v" text={d.records.cname.target} />],
                  ...(d.records.txt
                    ? ([
                        [
                          "Then, if asked: TXT name",
                          <Copyable key="tn" text={d.records.txt.name} />,
                        ],
                        ["TXT value", <Copyable key="tv" text={d.records.txt.value} />],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
              <p className={QUIET}>
                Add the record where your domain's DNS lives (Cloudflare, GoDaddy, Squarespace). If
                it has a proxy switch, leave it off. Your email records stay as they are.
              </p>
              {data.canManage ? (
                <div className={TOOLS}>
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={act.busy}
                    onClick={() => {
                      if (
                        confirm(`Remove ${d.hostname}? The portal stops working there right away.`)
                      )
                        void act.run("removeDomain", { hostname: d.hostname });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
        {act.error && data?.domains.length ? <p className={ERROR}>{act.error}</p> : null}
      </Section>
      {data?.canManage && data.ready && data.domains.length === 0 ? (
        <Section title="Add your domain" note="Use a subdomain you don't use for anything else.">
          <Form
            label="Add your domain"
            submit="Add"
            act={act}
            onSubmit={(f) => act.run("addDomain", { hostname: field(f, "hostname") })}
          >
            <label className={`${FIELD} grow basis-[260px]`}>
              <span>Address</span>
              <Input name="hostname" required maxLength={253} placeholder="portal.yourfirm.com" />
            </label>
          </Form>
        </Section>
      ) : data && !data.canManage && data.domains.length === 0 ? (
        <p className={QUIET}>Ask an owner to set up your domain.</p>
      ) : null}
      {data ? <SiteChat live={data.domains.find((d) => d.live)?.hostname ?? null} /> : null}
    </>
  );
}
