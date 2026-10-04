/** Wren's own books. */
import { defineComponent } from "@wren/core/components";

export const BOOKS_COMPONENTS = [
  defineComponent({
    id: "books",
    name: "Books",
    blurb: "Wren's spend, subscriptions and economics, imported daily.",
    icon: "money",
    for: "wren",
    ready: false,
    missing: ["Wren's own books; never a client's"],
    provides: {
      services: ["Books", "BooksConsole"],
      loops: ["Books"],
      records: [
        "books.spend",
        "books.subscription",
        "books.month",
        "books.channel",
        "books.cohort",
        "books.account",
      ],
      apps: ["money"],
    },
  }),
];
