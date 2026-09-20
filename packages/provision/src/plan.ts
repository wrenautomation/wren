/** What one domain provision is asked to produce. Validated once, stored on the object as given. */
import { z } from "zod";

const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/;
const LOCAL = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const inboxSchema = z.object({
  /** The part before @. */
  local: z.string().regex(LOCAL),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
});

export const planSchema = z.object({
  domain: z.string().regex(DOMAIN),
  inboxes: z.array(inboxSchema).min(1),
  /** Niches the inboxes may serve on the roster. */
  niches: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]).default("all"),
  /** Gmail send-as signature HTML; empty = leave the signature alone. */
  signatureHtml: z.string().default(""),
  /** Buy the domain when nobody holds it (purchase gate first). */
  buy: z.boolean().default(true),
  /** Enrol the inboxes in warmup (a browser leg). */
  warmup: z.boolean().default(true),
  /** Put the inboxes on the roster, redeploy, start their loops. */
  handoff: z.boolean().default(true),
  /** Run the reversible steps, stop before the first irreversible one. */
  dryRun: z.boolean().default(false),
});

export type Inbox = z.infer<typeof inboxSchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanInput = z.input<typeof planSchema>;

export const parsePlan = (input: unknown): Plan => planSchema.parse(input);

export const inboxAddress = (plan: Pick<Plan, "domain">, inbox: Pick<Inbox, "local">): string =>
  `${inbox.local}@${plan.domain}`.toLowerCase();
