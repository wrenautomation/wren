/** The viewer's sign-in has no Aerie actor: every Aerie page says the one line that adds it. */
import { Empty } from "@wren/ui";
import type { ApiError } from "../../api.js";

const NO_ACTOR = /^no Aerie actor for (.+)$/;

export const isNoActor = (e: ApiError | null | undefined): e is ApiError =>
  e?.status === 403 && NO_ACTOR.test(e.message);

export function NoActor({ error }: { error: ApiError }) {
  const email = NO_ACTOR.exec(error.message)?.[1] ?? "<email>";
  return (
    <Empty title={`No Aerie actor for ${email}`} waits>
      Add one from the CLI:{" "}
      <code>
        aerie actor set &lt;id&gt; <span className="whitespace-nowrap">--email</span> {email}
      </code>
    </Empty>
  );
}
