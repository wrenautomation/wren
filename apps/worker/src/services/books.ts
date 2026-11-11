/**
 * The books' day and its console.
 */
import { resolve } from "node:path";
import {
  awsCostExplorer,
  bankOfCanada,
  cloudTrailDecrypts,
  dirStore,
  feedAccess,
  s3Store,
} from "@wren/books";
import { makeBooks, makeBooksConsole } from "@wren/books/restate";
import type { AnyService, Deps } from "./deps.js";

/** The books domain's services, in the order they were served from `services.ts`. */
export function booksServices(deps: Deps): AnyService[] {
  const { db, keys, llm, mailboxOf, notify, rootDir, settings } = deps;
  const services: AnyService[] = [];
  // The books' day: billing mail kept, read and posted, AWS spend in, alerts out;
  // off until `wren books loop start`.
  services.push(
    makeBooks({
      db,
      llm,
      mailboxes: settings.booksMailboxes.map(mailboxOf("wren:books")),
      store: settings.booksBucket
        ? s3Store(settings.booksBucket)
        : dirStore(resolve(rootDir, ".books")),
      rates: bankOfCanada(),
      aws: settings.booksAwsUsage ? awsCostExplorer() : null,
      decrypts: settings.booksAwsUsage ? cloudTrailDecrypts() : null,
      // linked cards' tokens and Wren's Plaid keys, sealed under client wren
      plaid: keys
        ? feedAccess((o) => keys.named({ ...o, client: "wren", by: "wren:books" }))
        : null,
      since: settings.booksSince,
      ...notify,
    }),
  );
  services.push(makeBooksConsole(db));
  return services;
}
