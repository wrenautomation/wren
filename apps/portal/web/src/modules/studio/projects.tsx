/**
 * Studio › Projects (designs/2026-11-13-studio-suite.md, D1, D6): every video from the idea on,
 * its stage and what waits on him. `VideoProjectDesk/wren`; Pieces and Vireo's queue joined here.
 */
import type { Project } from "@wren/starling-studio/projects";
import type { ProjectKind } from "@wren/starling-studio/schema";
import {
  Button,
  Empty,
  FormKept,
  LoadFailed,
  PlatformMark,
  Seg,
  Skeleton,
  Tag,
  TextField,
  useEditForm,
  useSeen,
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { usePieces } from "../marketing/pieces.js";
import { shelfState, wentTo } from "../marketing/video-shelf-state.js";
import type { Open } from "../variants/page.js";

export const STUDIO_EDIT = "/studio/edit";

const KIND_LABEL: Record<ProjectKind, string> = {
  long: "Long video",
  short: "Short",
  ad: "Ad",
  demo: "Demo",
};
const KINDS = Object.keys(KIND_LABEL) as ProjectKind[];

const desk = <T,>(handler: string, input: Record<string, unknown> = {}) =>
  call<T>("console/call", { service: "VideoProjectDesk", handler, key: "wren", input });
export const listProjects = () => desk<{ projects: Project[] }>("list");
export const useProjects = () => useCall("studio-projects", listProjects);

/** Unscored samples in open batches of the project's subjects (D4). */
export function waitsOf(p: Pick<Project, "subjects">, queue: readonly Open[]): number {
  const mine = new Set(Object.values(p.subjects));
  return queue
    .filter((o) => mine.has(o.subject.id))
    .reduce((n, o) => n + o.samples.filter((s) => !s.verdict).length, 0);
}

/** Before filming the idea is the state; after, the edit's. */
function stageOf(p: Project, posted: boolean) {
  if (!p.edit) return { label: "Idea", tone: "neutral" as const };
  return shelfState({ state: p.edit.state, render: null }, posted);
}

export function ProjectsPage({ params }: PageProps) {
  const got = useProjects();
  const pieces = usePieces();
  const queue = useCall("variants-queue", () => call<Open[]>("variants/queue", {}));
  const [adding, setAdding] = useState(false);
  useSeen(
    "list",
    got.data
      ? { label: "Projects", icon: "video", text: `${got.data.projects.length} video projects` }
      : null,
  );

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  const byEdit = new Map(
    (pieces.data?.pieces ?? []).filter((x) => x.video).map((x) => [x.video as number, x]),
  );
  const open = queue.data ?? [];
  const projects = got.data?.projects;

  return (
    <div className="flex flex-col gap-5">
      {/* empty: the Empty box holds the one New project */}
      {projects?.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-(--ui-ink-3)">
            {projects
              ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}`
              : null}
          </span>
          {adding ? null : (
            <Button size="sm" icon="plus" className="ml-auto" onClick={() => setAdding(true)}>
              New project
            </Button>
          )}
        </div>
      )}
      {adding ? (
        <NewProject
          onDone={() => {
            setAdding(false);
            got.retry();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {!projects ? (
        <Ghosts />
      ) : !projects.length ? (
        adding ? null : (
          <Empty
            title="No project yet"
            action={
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
                New project
              </Button>
            }
          >
            A project holds one video from the idea on: its brief, its script, its edit and where it
            went. Start one here, or ask the agent to start one from an outlier.
          </Empty>
        )
      ) : (
        <ul aria-label="Projects" className="m-0 grid list-none gap-1 p-0">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0 transition-opacity duration-150 starting:opacity-0">
              <Row
                p={p}
                went={wentTo(p.edit ? byEdit.get(p.edit.id) : undefined)}
                waits={waitsOf(p, open)}
                to={href(STUDIO_EDIT, { project: String(p.id) }, params)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ p, went, waits, to }: { p: Project; went: string[]; waits: number; to: string }) {
  const stage = stageOf(p, went.length > 0);
  return (
    <a
      href={to}
      className="grid gap-1.5 rounded-[10px] px-3 py-3 text-inherit no-underline transition-colors duration-150 hover:bg-(--ui-hover) focus-visible:bg-(--ui-hover)"
    >
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 text-[15px] leading-[1.35] font-semibold wrap-anywhere">
          {p.title}
        </span>
        <span className="text-[12px] text-(--ui-ink-3)">{KIND_LABEL[p.kind]}</span>
      </span>
      {p.brief ? (
        <span className="line-clamp-[8] text-[13px] leading-[1.45] whitespace-pre-line text-(--ui-ink-2)">
          {p.brief}
        </span>
      ) : null}
      <span className="flex min-h-5 flex-wrap items-center gap-2">
        <Tag tone={stage.tone}>{stage.label}</Tag>
        {waits ? <Tag tone="accent">{waits} to score</Tag> : null}
        {p.inspiration.length ? (
          <span className="text-[12px] text-(--ui-ink-3)">
            {p.inspiration.length} {p.inspiration.length === 1 ? "reference" : "references"}
          </span>
        ) : null}
        {went.length ? (
          <span className="ml-auto flex items-center gap-1.5">
            {went.map((m) => (
              <PlatformMark key={m} mark={m} size={14} />
            ))}
          </span>
        ) : null}
      </span>
    </a>
  );
}

function NewProject({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const form = useEditForm<{ title: string; kind: ProjectKind }>({
    key: "studio:new-project",
    defaults: { title: "", kind: "long" },
  });
  const title = form.watch("title");
  const kind = form.watch("kind");
  // a refusal keeps what he typed (useEditForm)
  const send = form.onSend(
    async (v) => {
      await desk("add", { title: v.title.trim(), kind: v.kind });
      onDone();
    },
    { clear: true },
  );
  return (
    <form
      aria-label="New project"
      className="grid gap-3 rounded-[12px] bg-(--ui-fill) p-4 transition-opacity duration-150 starting:opacity-0"
      onSubmit={(e) => void send(e)}
    >
      <FormKept form={form} />
      <TextField
        form={form}
        name="title"
        aria-label="Title"
        placeholder="What the video is about"
        maxLength={200}
        autoFocus
      />
      <Seg
        label="Kind"
        value={kind}
        onChange={(k) => form.setValue("kind", k, { shouldDirty: true })}
        items={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
      {form.error ? (
        <p role="alert" className="m-0 text-[13px] text-(--ui-bad)">
          {form.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!title.trim()} busy={form.formState.isSubmitting}>
          Add project
        </Button>
        <Button type="button" size="sm" tone="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Ghosts() {
  return (
    <ul aria-label="Loading projects" aria-busy="true" className="m-0 grid list-none gap-1 p-0">
      {[0, 1, 2].map((i) => (
        <li key={i} className="grid gap-2 px-3 py-3">
          <Skeleton className="h-4 w-[55%]" />
          <Skeleton className="h-3 w-[80%]" />
          <Skeleton className="h-5 w-[90px]" />
        </li>
      ))}
    </ul>
  );
}
