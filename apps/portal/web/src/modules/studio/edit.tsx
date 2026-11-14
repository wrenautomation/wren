/**
 * Studio › Edit (designs/2026-11-13-studio-suite.md, D6): Finish on a project's edit
 * (`?project=`), or on any recording (`?video=`); with neither, the newest recordings.
 */
import { CopyButton, Empty, LoadFailed, Loading } from "@wren/ui";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { StudioVideo, VideoShelf } from "../marketing/video-shelf.js";
import { STUDIO_EDIT, useProjects } from "./projects.js";

const PROJECTS = "/studio/projects";

export function EditPage(props: PageProps) {
  const { params } = props;
  const video = params.get("video");
  const project = params.get("project");
  if (video)
    return (
      <StudioVideo
        key={video}
        {...props}
        id={video}
        at={STUDIO_EDIT}
        back={{ href: href(STUDIO_EDIT, { video: null }, params), label: "Edit" }}
      />
    );
  if (project) return <ProjectEdit {...props} id={Number(project)} />;
  return <VideoShelf params={params} at={STUDIO_EDIT} />;
}

function ProjectEdit({ id, ...props }: PageProps & { id: number }) {
  const got = useProjects();
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={6} heading />;
  const p = got.data.projects.find((x) => x.id === id);
  if (!p)
    return (
      <Empty title="This project isn't here" action={<a href={PROJECTS}>All projects</a>}>
        It was never made, or the link is wrong.
      </Empty>
    );
  if (!p.edit)
    return (
      <Empty
        title={p.title}
        action={
          <CopyButton
            text={`wren project film ${p.id} `}
            label="Copy the command"
            tone="secondary"
          />
        }
      >
        Not filmed yet. Record it, then tie the recording to this project with{" "}
        <code className="whitespace-nowrap">wren project film {p.id} &lt;video id&gt;</code>. Its
        edit opens here.
      </Empty>
    );
  return (
    <StudioVideo
      key={p.edit.id}
      {...props}
      id={String(p.edit.id)}
      at={STUDIO_EDIT}
      back={{ href: PROJECTS, label: "Projects" }}
    />
  );
}
