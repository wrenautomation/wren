/**
 * Wren's console records (`makeConsolePortal`'s `records`): the one list the worker, the portal
 * preview (`apps/portal/scripts/preview.ts`) and the page stories' types (`./record-types.ts`)
 * serve. Each place passes what it has (buckets, the lander, the roster); what it lacks gets the
 * part's own fallback: no bucket lists files unplayed, no lander has no visits or replays.
 */
import { BOOKS_RECORDS } from "@wren/books/records";
import { CALENDAR_RECORDS, recordingRecord } from "@wren/calendar/records";
import {
  callRecord,
  emailRecords,
  firmRecord,
  modelRecord,
  replyRecord,
} from "@wren/channel-email/records";
import { heatRecord, sessionRecord, surveyAnswerRecord } from "@wren/channel-search/records";
import { mediaRecord, sopRecord, videoRecord } from "@wren/content/records";
import { askRecord } from "@wren/core/ask";
import { BROADCAST_RECORDS } from "@wren/core/broadcast-records";
import { clientRecord } from "@wren/core/clients";
import { MARKETING_RECORDS } from "@wren/core/marketing/records";
import { profileRecords } from "@wren/core/profile-records";
import type { RecordType } from "@wren/core/records";
import { SEGMENT_RECORDS } from "@wren/core/segment-records";
import { SENT_RECORDS } from "@wren/core/sent/records";
import { templateRecords } from "@wren/core/templates/records";
import { BILLING_RECORDS } from "@wren/delivery/billing/records";
import { HEALTH_RECORDS } from "@wren/delivery/health";
import { LEARN_RECORDS, sopRecordFor } from "@wren/learn/records";
import { NOTES_RECORDS } from "@wren/notes/records";
import { PIPELINE_RECORDS } from "@wren/pipeline/records";
import { RESEARCH_RECORDS } from "@wren/research/records";
import { SITES_RECORDS } from "@wren/sites/records";
import { VOICE_RECORDS } from "@wren/voice/records";
import { WATCH_RECORDS } from "@wren/watch/records";
import { marketingNumbers } from "./marketing.js";
import { copyRecords } from "./record-edits.js";
import { reviewRecord } from "./review.js";
import { WORKFLOWS } from "./workflows.js";

type Email = Parameters<typeof emailRecords>;
type Signer = Parameters<typeof videoRecord>[0];

export interface ConsoleRecordsAt {
  /** Email's senders and send caps: its campaigns, inboxes and stalls. Absent: replies, calls, companies and model usage. */
  email?: { roster: Email[0]; policy: Email[1] } | undefined;
  /** The name a text signs with, on the copy pages. */
  smsSenderName?: string;
  /** Signs videos, media and a draft's stored files. Absent: listed, not played. */
  media?: Signer;
  /** The reach caps the Accounts page counts today's sends against. */
  reach?: Parameters<typeof marketingNumbers>[1];
  /** Signs a recorded call's mp4. */
  recordings?: Parameters<typeof recordingRecord>[0];
  /** The SOP folders on this machine; absent: the library reads the database only. */
  sopsDir?: string | null;
  /** The lander's recorded views: replays and survey answers. Absent: heatmaps keep their counts. */
  sessions?: Parameters<typeof sessionRecord>[0] | undefined;
  /** A profile's site visits. */
  visits?: NonNullable<Parameters<typeof profileRecords>[1]>["visits"];
}

/** Every record type Wren's console serves, as `at` can serve them. */
export function consoleRecords(at: ConsoleRecordsAt = {}): RecordType[] {
  return [
    ...(at.email
      ? emailRecords(at.email.roster, at.email.policy)
      : [replyRecord, callRecord, firmRecord, modelRecord]),
    ...BOOKS_RECORDS,
    ...WATCH_RECORDS,
    ...LEARN_RECORDS,
    sopRecordFor(at.sopsDir ?? null),
    ...CALENDAR_RECORDS,
    recordingRecord(at.recordings),
    ...VOICE_RECORDS,
    ...RESEARCH_RECORDS,
    ...marketingNumbers(at.media, at.reach),
    ...(at.sessions ? [sessionRecord(at.sessions), surveyAnswerRecord(at.sessions.site)] : []),
    // Heatmaps draw on the newest replay; without them, their counts still show.
    heatRecord(at.sessions),
    videoRecord(at.media),
    // The Library's Media (the same files, one row each) and SOPs.
    mediaRecord(at.media),
    sopRecord,
    ...copyRecords(at.smsSenderName ?? ""),
    ...MARKETING_RECORDS,
    // Every message we sent, on any channel (People → Sent).
    ...SENT_RECORDS,
    // Wren's segments and who is in each (People → Segments).
    ...SEGMENT_RECORDS,
    // Wren's broadcasts and who each went to (People → Broadcasts).
    ...BROADCAST_RECORDS,
    // Everyone once, their addresses, traits and timeline (People). Research: Wren's own people only.
    ...profileRecords(WORKFLOWS, { research: true, ...(at.visits ? { visits: at.visits } : {}) }),
    ...templateRecords(WORKFLOWS),
    clientRecord,
    // Each client's health and the flags about it (Clients).
    ...HEALTH_RECORDS,
    // Money in by bank transfer, and the invoice each paid (Money).
    ...BILLING_RECORDS,
    // Where you were @ed in Wren's notes: yours only (the Inbox's Mentions).
    ...NOTES_RECORDS,
    // Every page we run and its numbers by source (Sites).
    ...SITES_RECORDS,
    // The shape, its journeys, deals and numbers (Journeys).
    ...PIPELINE_RECORDS,
    reviewRecord(),
    askRecord,
  ];
}
