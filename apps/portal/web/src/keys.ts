/**
 * A pasted key goes to `/api/keys/stage` alone (designs/2026-10-07-key-store.md): it comes back
 * as a ref and its last 4. A route that saves it takes the ref, never the key.
 */
import { call } from "./api.js";

export interface SavedKey {
  ref: string;
  last4: string;
}

export const saveKey = (client: string, name: string, value: string) =>
  call<SavedKey>("keys/stage", { client, name, value: value.trim() });
