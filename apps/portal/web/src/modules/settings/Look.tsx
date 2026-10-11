/** Colors and type for Wren's own workspace, kept for this person: a client's look stays theirs. */
import { Loading, LookEditor, PageHeader, ThemeGallery } from "@wren/ui";
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
          showcase
        />
      )}
    </>
  );
}

/** Every look on the kit's own parts, the loud ones too: a press wears it, Look tunes it. */
export function Themes() {
  const look = useMyLook();
  return (
    <>
      <PageHeader
        title="Themes"
        lede="Try a look on Wren's workspace. The showcase ones are yours alone; clients pick from the everyday set."
      />
      {!look?.ready ? (
        <Loading lines={4} />
      ) : (
        <ThemeGallery
          current={look.value ?? null}
          onPick={async (next) => {
            look.set(next);
          }}
          showcase
        />
      )}
    </>
  );
}
