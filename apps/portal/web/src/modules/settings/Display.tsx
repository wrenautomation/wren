/** Layout: the sidebar, the pages column, rows, text, the frame. Wren's Settings and a client's Your settings both draw it. */
import { DisplayPanel, Loading, PageHeader, Section, showKeys, useFrame } from "@wren/ui";

/** Every layout setting, saved for this person as they change. */
export function DisplaySection() {
  const frame = useFrame();
  return (
    <Section title="Layout" note="Saved as you change it, on every device you sign in on.">
      {frame ? (
        <div className="max-w-[420px]">
          <DisplayPanel control={frame} onKeys={showKeys} />
        </div>
      ) : (
        <Loading lines={4} />
      )}
    </Section>
  );
}

export function Display() {
  return (
    <>
      <PageHeader title="Layout" lede="How the portal sits on your screen. Only you see these." />
      <DisplaySection />
    </>
  );
}
