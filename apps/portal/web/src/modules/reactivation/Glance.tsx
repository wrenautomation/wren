/** Reactivation's launcher card: the list, who moved, the briefs, and drafts waiting on an OK. */
import { AppGlance, num, Tag } from "@wren/ui";
import { call, type Overview } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

export function Glance({ client }: PageProps) {
  const o = useCall(`overview:${client}`, () =>
    call<Overview>("reactivation/overview", { client }),
  );
  if (o.error) return null;
  if (!o.data) return <AppGlance figures={null} />;
  const { people, moved, briefs, pipeline } = o.data;
  const ok = pipeline.steps.find((s) => s.id === "approve");
  return (
    <AppGlance
      figures={[
        { label: "On your list", value: people },
        { label: "Moved jobs", value: moved },
        { label: "Briefs", value: briefs },
      ]}
      note={
        ok?.state === "yours" && ok.count > 0 ? (
          <Tag tone="accent">
            {num(ok.count)} {ok.count === 1 ? "draft waits" : "drafts wait"} for your OK
          </Tag>
        ) : null
      }
    />
  );
}
