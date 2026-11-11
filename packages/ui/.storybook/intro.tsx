/**
 * A sidebar group's first story (`<Group>/Intro`): what the group holds, one line per section, so a
 * reader with no context can browse the catalog. Order: `storySort` in each preview.tsx.
 * Storybook indexes a file's meta statically: each intro file writes its own `title`.
 */

/** The page: `export default { title: "<Group>/Intro", parameters: { layout: "padded" } }`, then a story that renders this. */
export function IntroPage({
  group,
  lede,
  sections,
}: {
  group: string;
  lede: string;
  sections: readonly (readonly [name: string, holds: string])[];
}) {
  return (
    <article className="grid max-w-[64ch] gap-4 text-(--ui-ink)">
      <h1 className="m-0 text-[24px] font-semibold">{group}</h1>
      <p className="m-0 text-[15px] leading-[1.55] text-(--ui-ink-2)">{lede}</p>
      {/* inline columns: the portal's Tailwind does not scan this folder */}
      <dl
        className="m-0 grid gap-x-4 gap-y-2 text-[14px]"
        style={{ gridTemplateColumns: "minmax(0,12rem) minmax(0,1fr)" }}
      >
        {sections.map(([name, holds]) => (
          <div key={name} className="contents">
            <dt className="font-semibold">{name}</dt>
            <dd className="m-0 text-(--ui-ink-2)">{holds}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
