/** Your settings: the mail this person gets from us (D9), dictation on this device, and how they sign in. */
import {
  Button,
  ButtonLink,
  LoadFailed,
  Loading,
  MessagePreview,
  PageHeader,
  Section,
} from "@wren/ui";
import { useState } from "react";
import { AUTH_ORIGIN, type MailLevel } from "../../api.js";
import type { PageProps } from "../../module.js";
import { BODY, ERROR, QUIET, TOOLS, useAct } from "../work/bits.js";
import { Dictation } from "./dictation.js";
import { usePeople, useRecap } from "./load.js";

const MAIL: [MailLevel, string, string][] = [
  ["all", "Everything", "An email when something needs you, plus a recap on Friday."],
  ["digest", "Friday recap only", "One email on Friday afternoon about the week."],
  ["off", "None", "No email. You can still check everything here."],
];

/** The preview's one-tap ratings open the page without rating: a look never votes. */
const unTapped = (text: string) => text.replace(/&e=\d+&pulse=\d+/g, "");

export function You(props: PageProps) {
  const [nonce, setNonce] = useState(0);
  const people = usePeople(props, nonce);
  const act = useAct(props, () => setNonce((n) => n + 1));
  const mail = people.data?.mail ?? null;
  const recap = useRecap(props);

  return (
    <>
      <PageHeader
        title="Your settings"
        lede="Just for you. Everyone on the account sets their own."
      />
      <Section title="Email from us">
        {people.error && !people.data ? (
          <LoadFailed error={people.error} onRetry={people.retry} />
        ) : !people.data ? (
          <Loading lines={2} />
        ) : !mail ? (
          <p className={QUIET}>Only people on the account get email from us.</p>
        ) : (
          <>
            <div className={TOOLS}>
              {MAIL.map(([level, label]) => (
                <Button
                  key={level}
                  size="dense"
                  aria-pressed={mail === level}
                  tone={mail === level ? "primary" : "secondary"}
                  disabled={act.busy}
                  onClick={() => void act.run("mail", { level })}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className={QUIET}>{MAIL.find(([l]) => l === mail)?.[2]}</p>
            {act.error ? <p className={ERROR}>{act.error}</p> : null}
          </>
        )}
      </Section>
      <Section title="The Friday recap">
        {recap.error && !recap.data ? (
          <LoadFailed error={recap.error} onRetry={recap.retry} />
        ) : !recap.data ? (
          <Loading lines={2} />
        ) : !recap.data.recap ? (
          <p className={QUIET}>No recap yet. It starts once the work is under way.</p>
        ) : (
          <>
            <p className={QUIET}>
              This week's, as it would go now. It goes Friday afternoon to everyone who gets email
              from us.
            </p>
            <MessagePreview
              message={{ kind: "email", from: "Wren", subject: recap.data.recap.subject }}
              body={unTapped(recap.data.recap.text)}
              reader
            />
          </>
        )}
      </Section>
      <Dictation />
      <Section title="Signing in">
        <p className={BODY}>
          Use the email you were invited with. You can sign in with a passkey, a code we email you,
          Google, Microsoft or a password. A passkey uses Face ID, Touch ID or your phone's screen
          lock, and you add one on each device. To set a password, pick "Set or reset my password"
          on the sign-in page.
        </p>
        {AUTH_ORIGIN ? (
          <div className={TOOLS}>
            <ButtonLink
              href={`${AUTH_ORIGIN}/passkeys?next=${encodeURIComponent(location.href)}`}
              size="dense"
              tone="secondary"
            >
              Passkeys
            </ButtonLink>
            <ButtonLink href={AUTH_ORIGIN} size="sm" tone="quiet">
              Sign-in page
            </ButtonLink>
          </div>
        ) : null}
      </Section>
    </>
  );
}
