import { describe, expect, it } from "vitest";
import { type MapsRead, mapsPost, mapsRows } from "./maps-reviews.js";
import { ringNote } from "./review-ring.js";
import { fromMaps } from "./store.js";

const read: MapsRead = {
  placeId: "ChIJsynthetic_place-0001",
  name: "Synthetic Bakery",
  url: "https://www.google.com/maps/place/?q=place_id:ChIJsynthetic_place-0001",
  reviews: [
    {
      id: "r1",
      author: "Avery Quinlan",
      authorUrl: null,
      stars: 5,
      text: "Great bread.",
      at: "2026-10-01T12:00:00.000Z",
      estimated: false,
      ago: "a week ago",
      edited: false,
      reply: { text: "Thanks, Avery!", ago: "a week ago" },
    },
    {
      id: "r2",
      author: "Jordan Lee",
      authorUrl: null,
      stars: 2,
      text: "",
      at: "2026-10-08T12:00:00.000Z",
      estimated: true,
      ago: "a day ago",
      edited: false,
      reply: null,
    },
    {
      id: "r3",
      author: "No Time",
      authorUrl: null,
      stars: 4,
      text: "Fine.",
      at: null,
      estimated: true,
      ago: "yesterday",
      edited: false,
      reply: null,
    },
  ],
};

describe("maps reviews", () => {
  it("keeps each timed review under its place, marked from Maps", () => {
    const rows = mapsRows(read);
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(rows[0]).toMatchObject({
      postId: mapsPost(read.placeId),
      author: "Avery Quinlan",
      stars: 5,
      repliedWith: "Thanks, Avery!",
      url: read.url,
    });
    expect(rows[1]?.repliedWith).toBeUndefined();
    expect(fromMaps(rows[1]?.raw)).toBe(true);
    expect(fromMaps({ name: "accounts/1/locations/2/reviews/3" })).toBe(false);
  });

  it("rings each owner by an @", () => {
    expect(ringNote(1, "Jordan Lee", ["owner@kappa.example", "b@kappa.example"])).toBe(
      "1 star review from Jordan Lee. It needs a reply. @owner@kappa.example @b@kappa.example",
    );
  });
});
