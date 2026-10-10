/** The project's service card on Today: how far along it is, what's delivered, and what waits on the client. */
import { AppGlance, num, Tag } from "@wren/ui";
import type { PageProps } from "../../module.js";
import { useWork } from "./bits.js";

export function Glance(props: PageProps) {
  const home = useWork(props);
  if (home.error) return null;
  if (!home.data) return <AppGlance figures={null} />;
  const all = home.data.engagements;
  if (!all.length) return null;
  const steps = all.flatMap((e) => e.steps);
  const done = steps.filter((s) => s.state === "done").length;
  const open = all.flatMap((e) => e.asks).filter((a) => !a.answeredAt).length;
  return (
    <AppGlance
      figures={[
        { label: "Steps done", value: `${num(done)} of ${num(steps.length)}` },
        { label: "Delivered", value: all.flatMap((e) => e.deliverables).length },
      ]}
      note={
        open > 0 ? (
          <Tag tone="accent">
            {num(open)} {open === 1 ? "thing needs" : "things need"} you
          </Tag>
        ) : null
      }
    />
  );
}
