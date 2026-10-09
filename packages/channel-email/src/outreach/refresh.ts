/**
 * Keeps the approved queue current. Compose renders a whole sequence on enroll, so an
 * email queued for days would ship old copy after a template edit, and would keep the
 * pixel token it got when tracking was on. A refresh re-renders every auto-approved,
 * unsent message of a niche from today's templates, facts and sign-offs (same seed,
 * same link code), and makes its token match today's tracking switch.
 *
 * Kept as written (only the token follows the switch):
 * - a message a person approved or edited: what they read is what ships;
 * - the rest of a sequence once any step went out: a follow-up restates the opener, so it
 *   must restate the one the lead got;
 * - a message whose sender is not active: its sign-off is not on hand, and a re-render
 *   would ship it unsigned.
 */

import {
  type Allocation,
  MissingFactError,
  render,
  type Template,
  toSource,
} from "@wren/core/slots";
import { emailRef, recordVersion } from "@wren/core/templates";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { enrollments, messages } from "../schema.js";
import { CALL_TIMES } from "../send/call-times.js";
import { linkFacts, mintLinkCode, mintOpenToken, signed } from "./compose.js";
import { type Facts, factsFor, factsForCompany } from "./facts.js";
import type { Filler } from "./fills.js";
import { livePages, pageFacts, pageSlugs } from "./pages.js";

export interface RefreshOptions {
  readonly niche: string;
  readonly templates: ReadonlyMap<string, Template>;
  /** Per template under an experiment: the shares its loci are drawn by. */
  readonly allocations?: ReadonlyMap<string, Allocation>;
  readonly factsView: string | null;
  /** Each offer's `offer.*` facts, by offer id. */
  readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly site: string | null;
  /** The niche's active senders: only their queue is re-rendered. */
  readonly senders: readonly string[];
  /** Plain sign-off per active sender (absent = that sender signs nothing). */
  readonly signatures: Readonly<Record<string, string>>;
  readonly trackOpens: boolean;
  /**
   * Re-render only messages whose template changed since they were rendered: what a deploy
   * needs, and no facts read for the rest. Off (the midnight top-up), facts and sign-off
   * changes are picked up too.
   */
  readonly staleOnly?: boolean;
  /** Casual names and prompt slots by a model (fills.ts), as compose has them. */
  readonly fill?: Filler;
}

export interface RefreshStats {
  /** Auto-approved unsent messages looked at. */
  checked: number;
  /** Text kept: a step of the sequence already went out, or the sender is not active. */
  kept_started_or_inactive: number;
  /** Text or subject changed to today's render. */
  rerendered: number;
  /** Pixel token cleared (tracking off) or minted (tracking on). */
  tokens_changed: number;
  /** The template is gone or a fact it needs is missing now: left as queued. */
  kept_unrenderable: number;
  /** `staleOnly`: already on the current template version, not re-rendered. */
  kept_current: number;
  /** Sent or changed state while this ran: left alone. */
  raced: number;
}

export async function refreshQueue(db: Queryable, opts: RefreshOptions): Promise<RefreshStats> {
  const stats: RefreshStats = {
    checked: 0,
    kept_started_or_inactive: 0,
    rerendered: 0,
    tokens_changed: 0,
    kept_unrenderable: 0,
    kept_current: 0,
    raced: 0,
  };
  const queued = await db
    .select({ m: messages, e: enrollments })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(
      and(
        eq(enrollments.niche, opts.niche),
        eq(enrollments.state, "active"),
        inArray(messages.state, ["draft", "approved"]),
      ),
    );
  const enrollmentIds = [...new Set(queued.map((q) => q.e.id))];
  const started = new Set(
    enrollmentIds.length === 0
      ? []
      : (
          await db
            .selectDistinct({ id: messages.enrollmentId })
            .from(messages)
            .where(
              and(
                inArray(messages.enrollmentId, enrollmentIds),
                or(
                  inArray(messages.state, ["sending", "sent", "unknown"]),
                  isNotNull(messages.sentAt),
                ),
              ),
            )
        ).map((r) => r.id),
  );
  const active = new Set(opts.senders);
  const untouched = (m: (typeof queued)[number]["m"]) =>
    m.approvedBy === "auto" && m.editedAt === null;
  const rerenders = ({ m, e }: (typeof queued)[number]) =>
    untouched(m) &&
    !started.has(e.id) &&
    active.has(e.sender) &&
    !(opts.staleOnly && opts.templates.get(m.template)?.version === m.templateVersion) &&
    opts.templates.has(m.template);
  // Facts for every enrollment a message of which re-renders, filled before the first write:
  // a deploy's refresh asks the model for the whole queue at once, not one email at a time.
  const factsByEnrollment = new Map<number, Facts>();
  const templatesByEnrollment = new Map<number, Template[]>();
  for (const q of queued.filter(rerenders)) {
    const list = templatesByEnrollment.get(q.e.id) ?? [];
    list.push(opts.templates.get(q.m.template) as Template);
    templatesByEnrollment.set(q.e.id, list);
    if (!factsByEnrollment.has(q.e.id))
      factsByEnrollment.set(
        q.e.id,
        q.e.personId !== null
          ? await factsFor(db, q.e.personId, opts.factsView)
          : await factsForCompany(db, q.e.companyId, opts.factsView),
      );
  }
  if (opts.fill) {
    const fill = opts.fill;
    await fill.warm([...factsByEnrollment.values()], opts.templates.values());
    for (const [id, facts] of factsByEnrollment)
      factsByEnrollment.set(id, await fill.fill(facts, templatesByEnrollment.get(id) ?? []));
  }
  // Only live pages fill: a copy linking one gone off keeps its words, and the send holds it.
  const pages = [...(await livePages(db, pageSlugs(opts.templates.values())))];
  const recorded = new Set<string>();
  for (const { m, e } of queued) {
    const update: Partial<typeof messages.$inferInsert> = {};
    if (!opts.trackOpens && m.openToken !== null) update.openToken = null;
    if (opts.trackOpens && m.openToken === null && m.approvedBy === "auto") {
      update.openToken = mintOpenToken();
    }
    const mine = untouched(m);
    if (mine) stats.checked++;
    if (mine && (started.has(e.id) || !active.has(e.sender))) {
      stats.kept_started_or_inactive++;
    } else if (
      mine &&
      opts.staleOnly &&
      opts.templates.get(m.template)?.version === m.templateVersion
    ) {
      stats.kept_current++;
    } else if (mine) {
      const tpl = opts.templates.get(m.template);
      const facts = factsByEnrollment.get(e.id) ?? null;
      const offerFacts = opts.offerFacts.get(e.offer) ?? {};
      const linkCode = m.linkCode ?? mintLinkCode();
      let rendered: ReturnType<typeof render> | null = null;
      try {
        rendered =
          tpl && facts
            ? render(
                tpl,
                {
                  ...facts.values,
                  ...offerFacts,
                  "call.times": CALL_TIMES,
                  ...linkFacts(opts.site, e.offer, facts.values, offerFacts, linkCode),
                  ...pageFacts(pages, e.offer, linkCode),
                },
                e.personId !== null ? `person:${e.personId}` : `company:${e.companyId}`,
                opts.allocations?.get(tpl.name),
              )
            : null;
      } catch (err) {
        if (!(err instanceof MissingFactError)) throw err;
      }
      if (!tpl || !rendered) {
        stats.kept_unrenderable++;
      } else {
        const body = signed(rendered.body, opts.signatures[e.sender] ?? "");
        if (body !== m.body || rendered.subject !== m.subject) {
          const key = `${tpl.name}\x00${tpl.version}`;
          if (!recorded.has(key)) {
            recorded.add(key);
            await recordVersion(db, emailRef(opts.niche, tpl.name), tpl.version, {
              source: toSource(tpl),
              by: "pipeline:refresh",
            });
          }
          Object.assign(update, {
            subject: rendered.subject,
            body,
            templateVersion: rendered.provenance.version,
            provenance: { ...(m.provenance as Record<string, unknown>), ...rendered.provenance },
            linkCode,
          });
        }
      }
    }
    if (Object.keys(update).length === 0) continue;
    // Only while it is still unsent: the send loop may have claimed it since the read.
    const done = await db
      .update(messages)
      .set(update)
      .where(and(eq(messages.id, m.id), inArray(messages.state, ["draft", "approved"])))
      .returning({ id: messages.id });
    if (done.length === 0) {
      stats.raced++;
      continue;
    }
    if ("body" in update) stats.rerendered++;
    if ("openToken" in update) stats.tokens_changed++;
  }
  return stats;
}
