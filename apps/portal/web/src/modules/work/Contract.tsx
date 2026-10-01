/**
 * The contract: its text as issued, then the signature, or the form an owner
 * signs with. Signing sends back the text's fingerprint, so what's signed is
 * exactly what was read. Prints alone.
 */
import { Alert, Button, ButtonLink, Loading, PageHeader, Section } from "@wren/ui";
import { type FormEvent, Fragment, type ReactNode, useState } from "react";
import { ApiError, type ContractView, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { field } from "./bits.js";
import { at } from "./nav.js";

export function Contract(props: PageProps) {
  const engagementId = Number(props.params.get("e")) || undefined;
  const [nonce, setNonce] = useState(0);
  const c = useCall(`contract:${props.client}:${props.team}:${engagementId}:${nonce}`, () =>
    call<ContractView>("delivery/contract", {
      client: props.client,
      asClient: !props.team,
      engagementId,
    }),
  );
  const back = (
    <ButtonLink href={at("paperwork")} tone="quiet" size="sm">
      Paperwork
    </ButtonLink>
  );
  if (c.error && !c.data)
    return (
      <>
        <PageHeader title="Contract" actions={back} />
        <Alert onRetry={c.error.status === 403 ? undefined : c.retry}>
          {c.error.status === 403
            ? "Only an owner of your account can read and sign the contract. Ask one to sign in."
            : c.error.message}
        </Alert>
      </>
    );
  if (!c.data)
    return (
      <>
        <PageHeader title="Contract" actions={back} />
        <Loading lines={12} />
      </>
    );
  const k = c.data;
  return (
    <>
      <PageHeader
        title="Contract"
        lede={
          k.signed ? "Signed. Your copy is below." : "Read it through, then sign at the bottom."
        }
        actions={
          <>
            {back}
            <Button tone="quiet" size="sm" icon="download" onClick={() => window.print()}>
              Print or save as PDF
            </Button>
          </>
        }
      />
      <article className="wk-doc wk-print">
        {blocks(k.body)}
        <div className="wk-signed">
          {k.signed ? (
            <p>
              Signed for the client by {k.signed.name}
              {k.signed.title ? `, ${k.signed.title}` : ""} ({k.signed.email}) on{" "}
              {stamp(k.signed.at)}.
            </p>
          ) : null}
          <p className="wk-quiet">
            Issued by Wren on {stamp(k.issuedAt)}. Version {k.version}. Fingerprint {k.sha256}.
          </p>
        </div>
      </article>
      {!k.signed && !props.team ? (
        <Sign k={k} props={props} onSigned={() => setNonce((n) => n + 1)} />
      ) : null}
    </>
  );
}

function Sign({ k, props, onSigned }: { k: ContractView; props: PageProps; onSigned: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await call("delivery/sign", {
        client: props.client,
        engagementId: k.engagementId,
        sha256: k.sha256,
        name: field(f, "name"),
        title: field(f, "title"),
        agreed: f.get("agreed") === "on",
      });
      onSigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Sign">
      <form className="wk-form" aria-label="Sign the contract" onSubmit={submit}>
        <label className="wk-field">
          <span>Your full name</span>
          <input name="name" required maxLength={200} autoComplete="name" />
        </label>
        <label className="wk-field">
          <span>Your title (optional)</span>
          <input name="title" maxLength={200} autoComplete="organization-title" />
        </label>
        <label className="wk-check wk-wide">
          <input type="checkbox" name="agreed" required />
          I've read this agreement. I agree to it for my company and I'm allowed to sign for it.
        </label>
        <div className="wk-form-foot">
          <Button type="submit" disabled={busy || props.demo}>
            Sign the contract
          </Button>
          <span className="wk-quiet">This counts as your signature. We email you a copy.</span>
          {error ? (
            <span className="wk-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

/** "Oct 1, 2026, 14:05 UTC": a signature's moment, the same for everyone. */
const stamp = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}, ${iso.slice(11, 16)} UTC`;

/** The contract's light marks: `# ` title, `## ` heading, `- ` list lines, blank lines between. */
function blocks(body: string): ReactNode {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length)
      out.push(
        <ul key={out.length}>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>,
      );
    items = [];
  };
  for (const b of body.split("\n\n")) {
    if (b.startsWith("- ")) {
      items.push(b.slice(2));
      continue;
    }
    flush();
    out.push(
      <Fragment key={out.length}>
        {b.startsWith("# ") ? (
          <h1>{b.slice(2)}</h1>
        ) : b.startsWith("## ") ? (
          <h2>{b.slice(3)}</h2>
        ) : (
          <p>{b}</p>
        )}
      </Fragment>,
    );
  }
  flush();
  return out;
}
