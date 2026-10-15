/** The account's calls, one key each: a write re-reads its call (`retry`), never a new key. */
import { type AccountView, call, type MailLevel, type MemberView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

const ask = <T>(route: string, p: PageProps) =>
  call<T>(`delivery/${route}`, { client: p.client, asClient: !p.team });

export const useAccount = (p: PageProps) =>
  useCall(`account:${p.client}:${p.team}`, () => ask<AccountView>("account", p));

export type Recap = { subject: string; text: string };
export const useRecap = (p: PageProps) =>
  useCall(`recap:${p.client}:${p.team}`, () => ask<{ recap: Recap | null }>("recap", p));

/** One key: a write re-reads it (`retry`), so an older answer never repaints the list. */
export const usePeople = (p: PageProps) =>
  useCall(`people:${p.client}:${p.team}`, () =>
    ask<{
      people: MemberView[];
      canManage: boolean;
      /** The roles an invite picks from; older workers send none. */
      roles?: { id: string; name: string }[];
      mail: MailLevel | null;
    }>("people", p),
  );
