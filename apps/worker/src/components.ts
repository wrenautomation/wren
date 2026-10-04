/**
 * Every component, from every package: the source for the catalog, installs and
 * gating. `components.test.ts` checks every service, record and app is in one.
 */
import { BOOKS_COMPONENTS } from "@wren/books/components";
import { EMAIL_COMPONENTS } from "@wren/channel-email/components";
import { META_COMPONENTS } from "@wren/channel-meta/components";
import { SEARCH_COMPONENTS } from "@wren/channel-search/components";
import { SMS_COMPONENTS } from "@wren/channel-sms/components";
import { CONTENT_COMPONENTS } from "@wren/content/components";
import type { Component } from "@wren/core/components";
import { DELIVERY_COMPONENTS } from "@wren/delivery/components";
import { OUTREACH_COMPONENTS } from "@wren/outreach/components";
import { REACTIVATION_COMPONENTS } from "@wren/reactivation/components";
import { RESEARCH_COMPONENTS } from "@wren/research/components";

export const COMPONENTS: readonly Component[] = [
  ...RESEARCH_COMPONENTS,
  ...EMAIL_COMPONENTS,
  ...SMS_COMPONENTS,
  ...REACTIVATION_COMPONENTS,
  ...DELIVERY_COMPONENTS,
  ...CONTENT_COMPONENTS,
  ...META_COMPONENTS,
  ...SEARCH_COMPONENTS,
  ...OUTREACH_COMPONENTS,
  ...BOOKS_COMPONENTS,
];

/** Services and apps that are the platform itself, not a feature anyone installs. */
export const PLATFORM = {
  services: {
    ConsolePortal: "the console: loops, handlers, records, clients and installs",
    AuditSealer: "seals the audit log every write lands in",
    TokenRenewal: "renews every site's tokens, for content and ads alike",
  },
  apps: {
    account: "every client's account: people, look, billing",
    loops: "every loop, whoever's it is",
    handlers: "every handler, as a form",
    clients: "the client registry",
    marketplace: "every component, and the browser mods",
  },
  records: {
    "console.client": "the client registry",
    "console.loop": "every loop",
    "console.handler": "every handler",
    "console.component": "every component",
  },
} as const;
