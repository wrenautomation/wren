/**
 * The contract: its text as issued, then the signature, or the form an owner
 * signs with. Signing sends back the text's fingerprint, so what's signed is
 * exactly what was read. Prints alone.
 */
import {
  Alert,
  Button,
  ButtonLink,
  CheckField,
  Empty,
  failureOf,
  Loading,
  PageHeader,
  Section,
  TextField,
  useEditForm,
} from "@wren/ui";
import { Fragment, type ReactNode } from "react";
import { z } from "zod";
import { type ContractView, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { ERROR, FORM, NARROW, QUIET, trimmed } from "./bits.js";
import { at } from "./nav.js";

export function Contract(props: PageProps) {
  const engagementId = Number(props.params.get("e")) || undefined;
  // One key for every read: a reload replaces the kept answer, never adds a new one.
  const c = useCall(`contract:${props.client}:${props.team}:${engagementId}`, () =>
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
      {!k.signed && !props.team ? <Sign k={k} props={props} onSigned={c.retry} /> : null}
    </>
  );
}

const SIGN_BLANK = { name: "", title: "", agreed: false };
const SIGN = z.object({
  name: z.string().trim().min(1, "Add your full name."),
  title: z.string(),
  agreed: z.boolean().refine((v) => v, "Tick the box to sign."),
});

function Sign({ k, props, onSigned }: { k: ContractView; props: PageProps; onSigned: () => void }) {
  const form = useEditForm({
    key: `contract:sign:${props.client}:${k.engagementId}`,
    defaults: SIGN_BLANK,
    schema: SIGN,
  });
  const sign = form.onSend(async (v) => {
    await call("delivery/sign", {
      client: props.client,
      engagementId: k.engagementId,
      sha256: k.sha256,
      name: trimmed(v.name),
      title: trimmed(v.title),
      agreed: v.agreed,
    });
    onSigned();
  });
  const error = form.formState.errors.agreed?.message ?? form.error;
  return (
    <Section title="Sign">
      <form className={FORM} aria-label="Sign the contract" onSubmit={(e) => void sign(e)}>
        <TextField
          form={form}
          name="name"
          label="Your full name"
          className={NARROW}
          required
          maxLength={200}
          autoComplete="name"
        />
        <TextField
          form={form}
          name="title"
          label="Your title (optional)"
          className={NARROW}
          maxLength={200}
          autoComplete="organization-title"
        />
        <CheckField
          form={form}
          name="agreed"
          required
          label="I've read this agreement. I agree to it for my company and I'm allowed to sign for it."
          className="min-h-[38px] basis-full text-[14px]"
        />
        <div className="flex basis-full flex-wrap items-center gap-3">
          <Button tone="primary" size="dense" type="submit" disabled={form.formState.isSubmitting}>
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
