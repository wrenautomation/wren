/**
 * The contract: its text as issued, then the signature, or the form an owner
 * signs with. Signing sends back the text's fingerprint, so what's signed is
 * exactly what was read. Prints alone.
 */
import {
  Alert,
  Button,
  ButtonLink,
  Empty,
  failureOf,
  Input,
  Loading,
  PageHeader,
  Section,
} from "@wren/ui";
import { type FormEvent, Fragment, type ReactNode, useState } from "react";
import { ApiError, type ContractView, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FIELD, FORM, field, QUIET } from "./bits.js";
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
        {c.error.status === 404 ? (
          <Empty>This work started without a contract.</Empty>
        ) : (
          <Alert onRetry={c.error.status === 403 ? undefined : c.retry}>
            {c.error.status === 403
              ? "Only an owner of your account can read and sign the contract. Ask one to sign in."
              : failureOf(c.error, "contract").line}
          </Alert>
        )}
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
      <article data-print className="max-w-[72ch] text-[15px] leading-[1.6]">
        {blocks(k.body)}
        <div className="mt-7 border-t border-(--ui-hair) pt-4 text-[14px]">
          {k.signed ? (
            <p>
              Signed for the client by {k.signed.name}
              {k.signed.title ? `, ${k.signed.title}` : ""} ({k.signed.email}) on{" "}
              {stamp(k.signed.at)}.
            </p>
          ) : null}
          <p className={QUIET}>
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
      <form className={FORM} aria-label="Sign the contract" onSubmit={submit}>
        <label className={FIELD}>
          <span>Your full name</span>
          <Input name="name" required maxLength={200} autoComplete="name" />
        </label>
        <label className={FIELD}>
          <span>Your title (optional)</span>
          <Input name="title" maxLength={200} autoComplete="organization-title" />
        </label>
        <label className="flex min-h-[38px] basis-full items-center gap-2 text-[14px]">
          <input type="checkbox" name="agreed" required />
          I've read this agreement. I agree to it for my company and I'm allowed to sign for it.
        </label>
        <div className="flex basis-full flex-wrap items-center gap-3">
          <Button size="dense" type="submit" disabled={busy}>
            Sign the contract
          </Button>
          <span className={QUIET}>This counts as your signature. We email you a copy.</span>
          {error ? (
            <span className={ERROR} role="alert">
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
        <ul key={out.length} className="mb-2.5 list-disc pl-5 [&>li]:mb-1">
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
          <h1 className="mb-4 text-[26px] font-semibold">{b.slice(2)}</h1>
        ) : b.startsWith("## ") ? (
          <h2 className="mt-7 mb-2 text-[16.5px] font-semibold">{b.slice(3)}</h2>
        ) : (
          <p className="mb-2.5">{b}</p>
        )}
      </Fragment>,
    );
  }
  flush();
  return out;
}
