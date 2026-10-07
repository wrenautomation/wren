/** Wren's own books. */
import { defineComponent } from "@wren/core/components";

export const BOOKS_COMPONENTS = [
  defineComponent({
    id: "books",
    stage: "run",
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
        "books.in_house",
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
  defineComponent({
    id: "books.bills",
    stage: "run",
    channels: ["email"],
    name: "Bills from the Watch",
    blurb: "Mail from a known vendor runs the books now, not at tomorrow's pass.",
    icon: "money",
    for: "wren",
    ready: false,
    missing: ["Wren's own books; never a client's"],
    requires: { components: ["books", "watch.read"] },
    in: [{ id: "mail", label: "mail", kind: "mail" }],
    hypothesis: {
      from: "Wren's own books, 2026-10",
      guesses: [
        {
          is: "fixed",
          says: "Bills are told apart by the same vendor rules the daily search uses.",
        },
        { is: "fixed", says: "AWS spend is still taken in once a day: it costs per ask." },
      ],
    },
  }),
];
