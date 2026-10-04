/**
 * The welcome guide: what happens, who does what, and how we keep in touch.
 * Built from the offer and the paperwork, so it's right for each client.
 */
import { ButtonLink, PageHeader, Section } from "@wren/ui";
import type { EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { BODY, dayLabel, Engagements, LIST, QUIET, useWork } from "./bits.js";
import { at } from "./nav.js";

export function Welcome(props: PageProps) {
  const work = useWork(props);
  return (
    <>
      <PageHeader
        title="Welcome to Wren"
        lede="How this works, who does what, and where to find us."
        actions={
          <ButtonLink href={at("paperwork")} tone="quiet" size="sm">
            Paperwork
          </ButtonLink>
        }
      />
      <Engagements work={work}>{(e) => <Guide e={e} />}</Engagements>
    </>
  );
}

/** What's left before the plan starts. */
function waitingOn(e: EngagementView): string[] {
  const p = e.paperwork;
  const out: string[] = [];
  if (p.contract && !p.contract.signedAt) out.push("sign the contract");
  if (p.setupPaid === false) out.push("pay the setup invoice");
  const open = p.access.filter((a) => a.status === "open").length;
  if (open) out.push(`answer ${open === 1 ? "our access request" : `${open} access requests`}`);
  return out;
}

function Guide({ e }: { e: EngagementView }) {
  const left = waitingOn(e);
  const first = e.steps[0];
  return (
    <>
      <Section>
        <p className={BODY}>{e.offer.promise}</p>
        {e.offer.guarantee ? <p className={QUIET}>{e.offer.guarantee}</p> : null}
      </Section>
      <Section title="1. Getting started">
        <ol className={LIST}>
          {e.paperwork.contract ? (
            <li>
              An owner of your account reads and signs the contract on the{" "}
              <a href={at("paperwork")}>Paperwork</a> page. Everyone who owns the account gets a
              signed copy by email.
            </li>
          ) : null}
          {e.paperwork.setupPaid !== null ? (
            <li>
              We send the setup invoice through Wise. You'll see it under{" "}
              <a href="/account/billing">Billing</a> too.
            </li>
          ) : null}
          {e.paperwork.access.length ? (
            <li>
              We ask for access to your systems one at a time, with what we need, why, and how to
              take it back. Mark each one when you've given it.
            </li>
          ) : null}
          <li>
            {e.status === "onboarding"
              ? left.length
                ? `The plan starts the day that's done. Its dates move with it. Still to do: ${left.join(", ")}.`
                : "All done. The plan starts today."
              : `The plan started ${dayLabel(e.startsOn)}.`}
            {first ? ` First up: ${first.name}.` : ""}
          </li>
        </ol>
      </Section>

      <Section title="2. What we do">
        <ul className={LIST}>
          {e.offer.youGet.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>

      <Section title="3. What we need from you">
        <ul className={LIST}>
          {e.offer.youGive.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className={QUIET}>
          When we're waiting on you, the dates move by the same amount. Anything we need shows under{" "}
          <a href={at("needs-you")}>Needs you</a>.
        </p>
      </Section>

      <Section title="4. Keeping in touch">
        <ul className={LIST}>
          <li>
            We post what we did on <a href={at("updates")}>Updates</a> as it happens. Comment on any
            of it and we'll answer there.
          </li>
          <li>
            Anything we make for you lands in <a href={at("deliverables")}>Deliverables</a>. Some
            wait for your OK before anything goes out.
          </li>
          <li>Every Friday you get a short email on the week. One tap tells us how it went.</li>
          <li>
            Questions any time: reply to any of our emails, or write to william@wrenautomation.com.
          </li>
        </ul>
      </Section>
    </>
  );
}
