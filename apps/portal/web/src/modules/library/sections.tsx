/**
 * Library → Sections: every block a Sections page is built from, with its blurb, its fields and a
 * preview drawn from its sample words. Read only: blocks are code (packages/sites templates).
 */
import { renderPage } from "@wren/sites/render";
import { SECTIONS, type SectionType, templateOf } from "@wren/sites/templates";
import { FRAME, FRAME_BODY, FRAME_HEAD, GROUP_LABEL, PageHeader } from "@wren/ui";
import { useMemo } from "react";
import { QUIET } from "../work/bits.js";

function Block({ b }: { b: SectionType }) {
  const html = useMemo(
    () =>
      renderPage(
        templateOf("page"),
        { title: b.name, sections: [{ id: "s", type: b.type, ...b.sample }] },
        { page: "library", base: "", track: false },
      ),
    [b],
  );
  return (
    <section className={FRAME} aria-label={b.name}>
      <div className={FRAME_HEAD}>
        <span className={GROUP_LABEL}>{b.name}</span>
        <span className={`text-[13px] ${QUIET}`}>{b.blurb}</span>
      </div>
      <div
        className={`${FRAME_BODY} grid gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}
      >
        <ul className="grid content-start gap-1 text-[13.5px]">
          {b.fields.map((f) => (
            <li key={f.key}>
              {f.label}
              <span className={QUIET}>
                {f.optional ? ", optional" : ""}
                {f.kind === "lines" || f.kind === "items" ? `, up to ${f.max}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <iframe
          srcDoc={html}
          title={`${b.name} preview`}
          sandbox=""
          loading="lazy"
          className="block h-[280px] w-full border border-(--ui-hair)"
        />
      </div>
    </section>
  );
}

export function Sections() {
  return (
    <>
      <PageHeader
        title="Sections"
        lede="The blocks a Sections page is made of, in any order. Add them from a page's copy in Sites."
      />
      <div className="grid gap-4">
        {SECTIONS.map((b) => (
          <Block key={b.type} b={b} />
        ))}
      </div>
    </>
  );
}
