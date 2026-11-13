/**
 * The Tasks page's address (aerie D16): the view keys through Aerie's own codec (`addressOfView`,
 * lists repeat their key), the page's own keys (`task`) kept beside them.
 */

import { type AddressView, addressOfView, VIEW_KEYS } from "@wrenautomation/aerie/core";
import { queryText } from "../../route.js";

export const TASKS = "/aerie/tasks";
/** no `group` in the address: the List groups by status */
export const GROUP = "status";

const VIEW: ReadonlySet<string> = new Set(VIEW_KEYS);

/** the page at `next`, with the address's non-view keys as they are */
export function addressOf(params: URLSearchParams, next: AddressView): string {
  const own = [...params].filter(([k]) => !VIEW.has(k));
  const s = queryText(new URLSearchParams([...own, ...addressOfView(next)]));
  return `${TASKS}${s ? `?${s}` : ""}`;
}

/** one string per screen: a saved view is on when its key equals the address's (search aside) */
export function viewKey(v: AddressView): string {
  const { text: _, ...rest } = v;
  return new URLSearchParams(addressOfView({ ...rest, group: v.group ?? GROUP })).toString();
}

/** the view with its search cleared */
export const withoutText = (v: AddressView): AddressView => {
  const { text: _, ...rest } = v;
  return rest;
};

/** the view with no filter and no search: how it lays out stays */
export const unfiltered = (v: AddressView): AddressView => {
  const { text: _, ...rest } = v;
  return { ...rest, filter: {} };
};
