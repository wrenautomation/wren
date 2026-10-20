/** The portal's one player store. Expand opens the item's page through the router. */
import { navigate } from "../route.js";
import { createPlayerStore } from "./store.js";

export const player = createPlayerStore({ go: (to) => navigate(to) });
