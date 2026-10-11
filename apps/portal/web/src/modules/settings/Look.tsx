/** Colors and type for Wren's own workspace, kept for this person: a client's look stays theirs. */
import { Loading, LookEditor, PageHeader } from "@wren/ui";
import { useMyLook } from "../../look-pref.js";

export function MyLook() {
  const look = useMyLook();
  return (
    <>
      <PageHeader
        title="Look"
        lede="Colors and type in Wren's workspace. A client's workspace keeps the client's look."
      />
      {!look?.ready ? (
        <Loading lines={4} />
      ) : (
        <LookEditor
          look={look.value ?? null}
          onSave={async (next) => {
            look.set(next);
          }}
        />
      )}
    </>
  );
}
