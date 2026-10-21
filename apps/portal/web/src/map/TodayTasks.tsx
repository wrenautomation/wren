/**
 * Today's tasks (artifact section 07): one card per person track, late first. Hover or focus a
 * task and its line lights on the Map; a click opens its track. The list comes from `tasksOf`.
 */
import { cx, Tag } from "@wren/ui";
import { hoursSay, type Task } from "./tasks.js";

/** The owner's initials in a round tile. */
function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[34px] place-items-center rounded-full bg-(--ui-fill) text-[12px] font-semibold text-(--ui-ink-2)"
    >
      {initials}
    </span>
  );
}

/** "Late · promise 4h, median 6h", or "Promise 4h". A task with no promise shows neither. */
function PromisePill({ task }: { task: Task }) {
  if (!task.promise) return null;
  if (!task.late) return <Tag>{`Promise ${task.promise}`}</Tag>;
  const median = task.medianHours === null ? "" : `, median ${hoursSay(task.medianHours)}`;
  return (
    <Tag className="bg-(--ui-bad-tint) text-(--ui-bad)">
      {`Late · promise ${task.promise}${median}`}
    </Tag>
  );
}

export function TodayTasks({
  tasks,
  onLight,
  onOpen,
}: {
  tasks: readonly Task[];
  /** The line to light on the Map, or null when the pointer or focus leaves. */
  onLight: (line: string | null) => void;
  onOpen: (id: string) => void;
}) {
  return (
    // The artifact's `.sheet .sh`: no frame, the h3 on the paper.
    <section aria-label="Tasks" className="grid gap-3">
      <h2 className="m-0 flex items-baseline gap-2 text-[16px] font-semibold tracking-[-0.01em]">
        Today · waiting on you
        {tasks.length ? (
          <span className="text-[13px] font-normal text-(--ui-ink-2) tabular-nums">
            {tasks.length}
          </span>
        ) : null}
      </h2>
      {tasks.length ? (
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-x-3 gap-y-1">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={cx(
                  "grid w-full cursor-pointer grid-cols-[34px_1fr] gap-2.5 border-0 border-t border-solid border-(--ui-hair) bg-transparent p-2.5 text-left text-(--ui-ink)",
                  "rounded-(--ui-leaf-chip) transition-colors duration-200 hover:bg-(--ui-wash) focus-visible:bg-(--ui-wash)",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ui-focus)",
                )}
                onPointerEnter={() => onLight(t.line)}
                onPointerLeave={() => onLight(null)}
                onFocus={() => onLight(t.line)}
                onBlur={() => onLight(null)}
                onClick={() => onOpen(t.id)}
              >
                <Avatar initials={t.initials} />
                <span className="grid min-w-0 gap-0.5">
                  <b className="text-[14px] font-semibold">{t.name}</b>
                  <span className="text-[12.5px] text-(--ui-ink-2)">
                    {`${t.lineName} · ${t.waiting} waiting at ${t.at}`}
                  </span>
                  <span className="mt-1 flex">
                    <PromisePill task={t} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-(--ui-ink-2)">No tasks waiting.</p>
      )}
    </section>
  );
}
