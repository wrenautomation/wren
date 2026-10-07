import { describe, expect, it } from "vitest";
import { reasonLabel } from "./reason-labels.js";

describe("reasonLabel", () => {
  it.each([
    ["web GET /exa/companies: 502 Failed to reach environment", "Exa search failed (502)"],
    [
      "fb-public GET /groups/zilker/posts/42: 502 fb-public GET /groups/{group}/posts/{post} failed after spending a read: fb-public/walk-group-post: the post's top comments a visitor sees: text is empty on 1 of 2 rows",
      "Facebook read came back without text (1 of 2)",
    ],
    ["author is empty on 1 of 1 rows", "Came back without author (1 of 1)"],
    ["web GET /serper/search: 429 slow down", "Serper read hit its rate limit"],
    ["meta POST /act_1/ads: 403 no", "Meta call was refused (403)"],
    ["team page empty", "Team page empty"],
    ["", ""],
  ])("%s reads %s", (raw, label) => expect(reasonLabel(raw)).toBe(label));
});
