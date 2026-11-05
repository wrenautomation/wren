/** The Marketing app's records, from each channel that keeps the numbers. */

import { factsRecord } from "@wren/core/facts";
import { accountSource } from "@wren/core/record-accounts";
import { type ReachPolicy, recordAccountsOf } from "@wren/starling-acts";
import {
  ANALYTICS_RECORDS,
  askedReplyRecord,
  type ConsoleDeps,
  contentRecords,
  inboxRecordOf,
  ourPostOf,
  reviewRecord,
  socialRecordsOf,
  type VideoSigner,
} from "@wren/starling-inbound/records";
import { engageRecordOf, exploreRecord, reachItems } from "@wren/starling-outbound";
import {
  accountRecordOf,
  commentRecord,
  dmRecord,
  inviteRecord,
  personRecord,
  placeRecord,
  threadRecord,
} from "@wren/starling-outbound/records";
import {
  keywordRecord,
  SEARCH_RECORDS,
  searchDayRecord,
  searchPageRecord,
} from "@wren/starling-search/records";
import { textContactRecord } from "@wren/starling-sms/records";
import { deskKinds } from "./desk.js";

// The accounts a record can be on: the Account filter's labels, read before records are served.
accountSource(recordAccountsOf);

/** The Inbox and To approve over every channel: outbound's rows laid on inbound's lists. */
const consoleDeps = (signer?: VideoSigner): ConsoleDeps => ({
  reach: reachItems,
  kinds: deskKinds,
  ...(signer ? { signer } : {}),
});

/**
 * `signer` links a draft's stored files (thumbnail, cover) in its field editor; `policy` is the
 * reach caps the Accounts page counts today's sends against.
 */
export const marketingNumbers = (signer?: VideoSigner, policy?: ReachPolicy) => [
  ...contentRecords(signer),
  ...ANALYTICS_RECORDS,
  ...SEARCH_RECORDS,
  textContactRecord,
  dmRecord,
  commentRecord,
  placeRecord,
  threadRecord,
  inviteRecord,
  personRecord,
  // Every account we speak as: Outreach → Accounts.
  accountRecordOf(policy),
  ...socialRecordsOf(consoleDeps(signer)),
  // What we write on others' ground, and what the searches found: outbound's lists.
  engageRecordOf({
    kinds: deskKinds,
    ourPost: ourPostOf,
    ...(signer ? { host: signer.host } : {}),
  }),
  exploreRecord,
  reviewRecord,
  // The facts every draft may claim, edited on Marketing → Facts.
  factsRecord,
];

/**
 * A client's Marketing (`MarketingConsole`): what its posting and search loops write into its own
 * database, and its Inbox with the replies there that wait on a yes.
 */
export const clientMarketing = (signer?: VideoSigner) => [
  ...contentRecords(signer),
  searchPageRecord,
  keywordRecord,
  searchDayRecord,
  inboxRecordOf(consoleDeps(signer)),
  askedReplyRecord,
  reviewRecord,
];
