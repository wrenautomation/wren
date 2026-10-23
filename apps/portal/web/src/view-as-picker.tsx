/**
 * The View as picker (designs/2026-10-14-view-as.md): find a client, then who to be there: a
 * person on its team (its owner first), someone new in a role, or the sandbox's blank new
 * client. Opens in Look; the strip switches to Act. Loaded on first open, with cmdk.
 */
import type { ViewAsChoices, ViewAsPerson, ViewAsPlace, ViewAsRole } from "@wren/core/view-as";
import { LoadFailed, Loading, say } from "@wren/ui";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@wren/ui/components/ui/command";
import { useEffect, useState } from "react";
import { callAsMe, viewAs } from "./api.js";
import { useCall } from "./load.js";
import type { PickerPreset } from "./view-as.js";

/** The team's own place in the list: Wren, for an admin. */
const TEAM = "wren";

const HINT = "ml-auto wrap-anywhere whitespace-normal pl-3 text-xs text-muted-foreground";

export function Picker({ preset, onClose }: { preset: PickerPreset | null; onClose: () => void }) {
  // Read as the operator, not the person viewed as: held for this tab only, never kept.
  const got = useCall("view-as:list", () => callAsMe<ViewAsChoices>("console/viewAsList"), {
    kept: false,
  });
  const choices = got.data ?? null;
  const error = got.error;
  const [at, setAt] = useState<string | null>(preset?.client || null);
  const [busy, setBusy] = useState(false);
  const mayAct = choices?.act === true;
  const open = (client: string, who: { email?: string; role?: string }) =>
    viewAs({ client, ...who, act: false, mayAct });
  // A preset person goes straight in.
  useEffect(() => {
    if (choices && preset?.email && preset.client) open(preset.client, { email: preset.email });
  });

  const sandbox = (verb: "sandboxMake" | "sandboxReset") => {
    setBusy(true);
    callAsMe<{ id: string }>(`console/${verb}`)
      .then((c) => open(c.id, {}))
      .catch((e) => {
        setBusy(false);
        say.failed(e);
      });
  };

  const place: ViewAsPlace | null =
    at === TEAM && choices?.team
      ? { id: TEAM, name: "Wren", kind: "client", ...choices.team }
      : (choices?.clients.find((c) => c.id === at) ?? null);

  return (
    <CommandDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="View as"
      description="See the portal as a client or a person there."
    >
      {/* cmdk filters what's typed; each place resets it. */}
      <Command key={place?.id ?? "all"}>
        <CommandInput
          placeholder={place ? `Find someone at ${place.name}` : "Find a client"}
          autoFocus
        />
        <CommandList>
          {error && !choices ? (
            <div className="p-3">
              <LoadFailed error={error} onRetry={got.retry} />
            </div>
          ) : !choices || busy ? (
            <div className="p-3">
              <Loading lines={4} />
            </div>
          ) : place ? (
            <Place
              place={place}
              admin={mayAct}
              onBack={() => setAt(null)}
              onPerson={(p) => open(place.id, { email: p.email })}
              onRole={(r) => open(place.id, { role: r.id })}
              onReset={() => sandbox("sandboxReset")}
            />
          ) : (
            <>
              <CommandEmpty>No client by that name.</CommandEmpty>
              <CommandGroup heading="Clients">
                {choices.clients
                  .filter((c) => c.kind !== "sandbox")
                  .map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.id}`}
                      onSelect={() => setAt(c.id)}
                    >
                      <span className="wrap-anywhere whitespace-normal">{c.name}</span>
                      <span className={HINT}>
                        {c.kind === "demo" ? "Demo" : `${c.people.length} on the team`}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
              {mayAct ? (
                <CommandGroup heading="Start fresh">
                  <CommandItem
                    value="new client sandbox blank"
                    onSelect={() => (choices.sandbox ? setAt("sandbox") : sandbox("sandboxMake"))}
                  >
                    <span className="wrap-anywhere whitespace-normal">A new client</span>
                    <span className={HINT}>Blank, as on day one. Never sends.</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {choices.team ? (
                <CommandGroup heading="Wren">
                  <CommandItem value="teammate our team" onSelect={() => setAt(TEAM)}>
                    <span className="wrap-anywhere whitespace-normal">A teammate</span>
                    <span className={HINT}>{choices.team.people.length} on the team</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** One place's people, then its roles with nobody in them, then the sandbox's Start over. */
function Place({
  place,
  admin,
  onBack,
  onPerson,
  onRole,
  onReset,
}: {
  place: ViewAsPlace;
  admin: boolean;
  onBack: () => void;
  onPerson: (p: ViewAsPerson) => void;
  onRole: (r: ViewAsRole) => void;
  onReset: () => void;
}) {
  // The owner first: who View as opens on when no one is picked.
  const people = [...place.people].sort(
    (a, b) => Number(b.role === "owner") - Number(a.role === "owner"),
  );
  const roleName = (id: string) => place.roles.find((r) => r.id === id)?.name ?? id;
  return (
    <>
      <CommandEmpty>Nobody by that name.</CommandEmpty>
      <CommandGroup heading={place.name}>
        <CommandItem value="back all clients" onSelect={onBack}>
          <span className="wrap-anywhere whitespace-normal text-muted-foreground">
            Back to all clients
          </span>
        </CommandItem>
      </CommandGroup>
      {people.length ? (
        <CommandGroup heading="People">
          {people.map((p) => (
            <CommandItem key={p.email} value={`${p.email} ${p.role}`} onSelect={() => onPerson(p)}>
              <span className="wrap-anywhere whitespace-normal">{p.email}</span>
              <span className={HINT}>{roleName(p.role)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      <CommandGroup heading="Someone new">
        {place.roles.map((r) => (
          <CommandItem key={r.id} value={`new ${r.name} ${r.id}`} onSelect={() => onRole(r)}>
            <span className="wrap-anywhere whitespace-normal">Someone new as {r.name}</span>
          </CommandItem>
        ))}
      </CommandGroup>
      {place.kind === "sandbox" && admin ? (
        <CommandGroup heading="This sandbox">
          <CommandItem value="start over wipe reset" onSelect={onReset}>
            <span className="wrap-anywhere whitespace-normal">Start over</span>
            <span className={HINT}>Wipes it back to blank.</span>
          </CommandItem>
        </CommandGroup>
      ) : null}
    </>
  );
}
