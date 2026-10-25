/**
 * An issue as a Listmonk campaign, and the tags that carry it back (designs/2026-10-21-esign-and-newsletter.md).
 * Listmonk posts each message to Wren with the campaign's name, uuid and tags and nothing about its
 * lists, so the tags say which topic and issue a message belongs to:
 *   `issue:<topic>:<slug>`  a campaign Wren made for a post; the issue key is `<topic>:<slug>`.
 *   `wren-topic:<topic>`    a campaign made by hand in Listmonk's editor; the issue key is
 *                           `<topic>:<name as slug>-<first 8 of the uuid>`.
 */
import type { Listmonk } from "./client.js";
import { escapeTemplate } from "./client.js";

/** The postback messenger `wren listmonk setup` registers; a campaign names it to go through Wren. */
export const MESSENGER = "wren";
/** The campaign template: the body and nothing else. Listmonk wraps a plain body in its HTML template otherwise. */
export const TEMPLATE_NAME = "wren plain";
export const TEMPLATE_BODY = '{{ template "content" . }}';

export const issueTag = (topic: string, slug: string) => `issue:${topic}:${slug}`;

export interface IssueRef {
  topic: string;
  /** The slug the issue's links and sends are filed under. */
  slug: string;
  /** `<topic>:<slug>`: the key `issueSentTo` and `wren newsletter status` use. */
  key: string;
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** The issue a posted message belongs to, from its campaign; null when the campaign names no topic. */
export function issueOf(c: {
  uuid: string;
  name: string;
  tags?: string[] | null | undefined;
}): IssueRef | null {
  const tags = c.tags ?? [];
  for (const t of tags) {
    const m = /^issue:([^:]+):([a-z0-9-]+)$/.exec(t);
    if (m?.[1] && m[2]) return { topic: m[1], slug: m[2], key: `${m[1]}:${m[2]}` };
  }
  const topic = tags.find((t) => t.startsWith("wren-topic:"))?.slice("wren-topic:".length);
  if (!topic) return null;
  const slug = `${slugOf(c.name) || "campaign"}-${c.uuid.slice(0, 8)}`;
  return { topic, slug, key: `${topic}:${slug}` };
}

/** The `wren plain` template's id: found by name, made when missing. */
export async function ensureTemplate(lm: Listmonk): Promise<number> {
  const have = (await lm.templates()).find((t) => t.name === TEMPLATE_NAME);
  return have?.id ?? (await lm.createTemplate({ name: TEMPLATE_NAME, body: TEMPLATE_BODY })).id;
}

export interface CampaignStart {
  id: number;
  status: string;
  toSend: number;
}

/**
 * Make the issue's campaign and start it, or find the one an earlier call made. A rerun of the
 * same issue never makes a second campaign: a draft or paused one starts again, a running or
 * finished one is left, and a cancelled one stays cancelled (it is the operator's stop).
 */
export async function startCampaign(
  lm: Listmonk,
  o: { listId: number; topic: string; slug: string; subject: string; body: string },
): Promise<CampaignStart> {
  const tag = issueTag(o.topic, o.slug);
  const found = (await lm.campaigns(tag)).find((c) => c.tags?.includes(tag));
  const campaign =
    found ??
    (await lm.createCampaign({
      name: tag,
      subject: o.subject,
      listIds: [o.listId],
      body: escapeTemplate(o.body),
      templateId: await ensureTemplate(lm),
      messenger: MESSENGER,
      tags: [tag],
    }));
  if (campaign.status === "draft" || campaign.status === "paused") {
    await lm.setCampaignStatus(campaign.id, "running");
  }
  const now = await lm.campaign(campaign.id);
  return { id: now.id, status: now.status, toSend: now.to_send ?? 0 };
}
