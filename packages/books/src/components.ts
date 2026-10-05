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
    hypothesis: {
      from: "Wren's own books, 2026-10",
      guesses: [
        { is: "change", says: "More banks and cards as Wren adds them.", built: null },
        { is: "fixed", says: "Statements are the truth; receipts only explain them." },
      ],
    },
  }),
];
