/** The demo's own page, opened from the top bar's "Sample firm" chip: what in it is real. */
import { PageHeader, Section } from "@wren/ui";
import { BODY, LIST } from "../work/bits.js";
import { at } from "./nav.js";

export function Real() {
  return (
    <>
      <PageHeader
        title="What's real"
        lede="This sample firm is built from a real agency's public client list. Its research is real. Its CRM is made up, since we don't have the agency's."
      />
      <Section title="Real">
        <ul className={`${LIST} list-none`}>
          <li>The companies and the people. Last names are shortened.</li>
          <li>Where each person works now, and which companies are hiring.</li>
          <li>Email addresses found at people's new companies, and how each one checked out.</li>
          <li>The source behind every fact.</li>
        </ul>
      </Section>
      <Section title="Made up">
        <ul className={`${LIST} list-none`}>
          <li>The CRM's owners, statuses, and last contact and placement dates.</li>
          <li>The email addresses on file, at people's old companies.</li>
        </ul>
      </Section>
      <Section title="Written by Wren">
        <p className={BODY}>Each brief and each draft, from the real facts.</p>
      </Section>
      <Section title="Try it">
        <p className={BODY}>
          Approve or skip a draft in <a href={at("emails", { view: "approve" })}>Emails</a>, or mark
          someone called in <a href={at("people", { view: "call" })}>People</a>. A reload puts it
          all back.
        </p>
      </Section>
    </>
  );
}
