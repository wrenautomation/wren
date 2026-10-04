/** The account's calls, keyed so a write's reload asks again. */
import { type AccountView, call, type MailLevel, type MemberView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

const ask = <T>(route: string, p: PageProps) =>
  call<T>(`delivery/${route}`, { client: p.client, asClient: !p.team });

export const useAccount = (p: PageProps) =>
  useCall(`account:${p.client}:${p.team}`, () => ask<AccountView>("account", p));

export const usePeople = (p: PageProps, nonce: number) =>
  useCall(`people:${p.client}:${p.team}:${nonce}`, () =>
    ask<{ people: MemberView[]; canManage: boolean; mail: MailLevel | null }>("people", p),
  );
