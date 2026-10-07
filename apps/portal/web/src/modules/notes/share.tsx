/**
 * Share, as Docs does: people and groups by role (view, comment, edit), everyone in the workspace
 * or only those added, a new owner. At Wren a note can go to a client's people too. Only the
 * owner changes it; everyone else sees who owns it.
 */
import { Button, Input, say } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useEffect, useId, useState } from "react";
import { WREN } from "../../module.js";
import {
  docPath,
  type NoteOpen,
  type NotePeople,
  type NoteShare,
  notes,
  ROLE_LABEL,
  type ShareRole,
} from "./api.js";
import { Dot } from "./versions.js";

const SELECT =
  "h-8 min-w-0 border border-(--ui-hair) bg-(--ui-paper) px-1.5 text-[13px] text-(--ui-ink)";
const ROLES = Object.entries(ROLE_LABEL) as [ShareRole, string][];

function RolePick({
  value,
  onChange,
  label,
  remove,
}: {
  value: ShareRole;
  onChange: (r: ShareRole | null) => void;
  label: string;
  remove?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      className={SELECT}
      onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as ShareRole))}
    >
      {ROLES.map(([r, l]) => (
        <option key={r} value={r}>
          {l}
        </option>
      ))}
      {remove ? <option value="">Remove</option> : null}
    </select>
  );
}

export function ShareDialog({
  client,
  note,
  people,
  open,
  onOpenChange,
  onChanged,
}: {
  client: string;
  note: NoteOpen;
  people: NotePeople | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const owner = note.role === "owner";
  const wren = client === WREN.id;
  const [shares, setShares] = useState<NoteShare[]>(note.shares);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<ShareRole>("edit");
  const [general, setGeneral] = useState(note.general);
  const [generalRole, setGeneralRole] = useState<ShareRole>(note.generalRole as ShareRole);
  const [to, setTo] = useState("");
  const list = useId();
  useEffect(() => {
    setShares(note.shares);
    setGeneral(note.general);
    setGeneralRole(note.generalRole as ShareRole);
  }, [note]);

  const place = wren ? "Wren" : (people?.client ?? "this workspace");
  const nameOf = (w: string) =>
    w === "team"
      ? "Wren's team"
      : w.startsWith("client:")
        ? `${people?.clients.find((c) => `client:${c.id}` === w)?.name ?? w.slice(7)}'s people`
        : w;

  const share = (w: string, r: ShareRole | null) =>
    notes(client, "share", { id: note.id, who: w, role: r })
      .then((out) => {
        setShares(out.shares);
        onChanged();
      })
      .catch(say.failed);
  const setAccess = (g: "private" | "workspace", r: ShareRole) => {
    setGeneral(g);
    setGeneralRole(r);
    void notes(client, "general", { id: note.id, general: g, role: r })
      .then(onChanged)
      .catch(say.failed);
  };
  const add = () => {
    const w = who.trim().toLowerCase();
    if (!w) return;
    void share(w, role).then(() => setWho(""));
  };
  const copy = () =>
    navigator.clipboard
      .writeText(`${location.origin}${docPath(note.id)}`)
      .then(() => say.done("Link copied. Only people with access can open it."))
      .catch(say.failed);

  const options = [
    ...(wren ? [["team", "Wren's team"]] : []),
    ...(people?.clients ?? []).map((c) => [`client:${c.id}`, `${c.name}'s people`]),
    ...(people?.people ?? [])
      .filter((p) => p.email !== note.owner.toLowerCase())
      .map((p) => [p.email, p.email]),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share “{note.name}”</DialogTitle>
          <DialogDescription>
            {owner
              ? "Add people or a group, or open it to everyone here."
              : "Only its owner can change who has it."}
          </DialogDescription>
        </DialogHeader>
        {owner ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              value={who}
              list={list}
              aria-label="Add a person or group"
              placeholder={wren ? "Email, Wren's team or a client" : "Email"}
              className="h-8 min-w-0 flex-1 rounded-none"
              onChange={(e) => setWho(e.target.value)}
            />
            <datalist id={list}>
              {options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </datalist>
            <RolePick value={role} onChange={(r) => r && setRole(r)} label="Their role" />
            <Button size="dense" type="submit" disabled={!who.trim()}>
              Add
            </Button>
          </form>
        ) : null}
        <section className="grid gap-1">
          <h3 className="m-0 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
            People with access
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            <li className="flex items-center gap-2 py-1.5 text-[13.5px]">
              <Dot email={note.owner} />
              <span className="min-w-0 flex-1 truncate">
                {note.owner.startsWith("agent:") ? "Claude" : note.owner}
              </span>
              <span className="text-[13px] text-(--ui-ink-2)">Owner</span>
            </li>
            {shares.map((s) => (
              <li key={s.who} className="flex items-center gap-2 py-1.5 text-[13.5px]">
                <Dot email={s.who} />
                <span className="min-w-0 flex-1 truncate">{nameOf(s.who)}</span>
                {owner ? (
                  <RolePick
                    value={s.role as ShareRole}
                    onChange={(r) => void share(s.who, r)}
                    label={`${nameOf(s.who)}'s role`}
                    remove
                  />
                ) : (
                  <span className="text-[13px] text-(--ui-ink-2)">
                    {ROLE_LABEL[s.role as ShareRole]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="grid gap-1.5">
          <h3 className="m-0 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
            General access
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
            {owner ? (
              <>
                <select
                  aria-label="General access"
                  value={general}
                  className={SELECT}
                  onChange={(e) =>
                    setAccess(e.target.value as "private" | "workspace", generalRole)
                  }
                >
                  <option value="private">Only people added</option>
                  <option value="workspace">Everyone at {place}</option>
                </select>
                {general === "workspace" ? (
                  <RolePick
                    value={generalRole}
                    onChange={(r) => r && setAccess("workspace", r)}
                    label="Their role"
                  />
                ) : null}
              </>
            ) : (
              <span>
                {general === "workspace"
                  ? `Everyone at ${place}: ${ROLE_LABEL[generalRole].toLowerCase()}`
                  : "Only people added"}
              </span>
            )}
          </div>
        </section>
        {owner && people?.people.length ? (
          <section className="grid gap-1.5">
            <h3 className="m-0 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
              Owner
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="New owner"
                value={to}
                className={SELECT}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Pick someone here</option>
                {people.people
                  .filter((p) => p.email !== note.owner.toLowerCase())
                  .map((p) => (
                    <option key={p.email} value={p.email}>
                      {p.email}
                    </option>
                  ))}
              </select>
              <Button
                tone="secondary"
                size="dense"
                disabled={!to}
                onClick={() =>
                  notes(client, "transfer", { id: note.id, to })
                    .then(() => {
                      say.done(`${to} owns it now. You can still edit it.`);
                      onOpenChange(false);
                      onChanged();
                    })
                    .catch(say.failed)
                }
              >
                Make owner
              </Button>
            </div>
          </section>
        ) : null}
        <div className="flex justify-between gap-2 pt-1">
          <Button tone="secondary" size="dense" icon="link" onClick={copy}>
            Copy link
          </Button>
          <Button size="dense" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
