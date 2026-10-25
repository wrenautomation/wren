/** The Marketing app's records, from each channel that keeps the numbers. */
import { adDayRecord } from "@wren/channel-meta/records";
import {
  keywordRecord,
  SEARCH_RECORDS,
  searchDayRecord,
  searchPageRecord,
} from "@wren/channel-search/records";
import { textContactRecord } from "@wren/channel-sms/records";
import {
  ANALYTICS_RECORDS,
  askedReplyRecord,
  contentRecords,
  inboxRecord,
  reviewRecord,
  socialRecords,
  type VideoSigner,
} from "@wren/content/records";
import { factsRecord } from "@wren/core/facts";
import { accountSource } from "@wren/core/record-accounts";
import { type ReachPolicy, recordAccountsOf } from "@wren/outreach";
import {
  accountRecordOf,
  commentRecord,
  dmRecord,
  inviteRecord,
  personRecord,
  placeRecord,
  threadRecord,
} from "@wren/outreach/records";

// The accounts a record can be on: the Account filter's labels, read before records are served.
accountSource(recordAccountsOf);

/**
 * `signer` links a draft's stored files (thumbnail, cover) in its field editor; `policy` is the
 * reach caps the Accounts page counts today's sends against.
 */
export const marketingNumbers = (signer?: VideoSigner, policy?: ReachPolicy) => [
  ...contentRecords(signer),
  ...ANALYTICS_RECORDS,
  adDayRecord,
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
  ...socialRecords(signer),
  reviewRecord,
  // The facts every draft may claim, edited on Marketing → Facts.
  factsRecord,
];

/**
 * A client's Marketing (`MarketingConsole`): what its posting, ads and search loops write into
 * its own database, and its Inbox with the replies there that wait on a yes. Its ad days stay
 * empty until its Meta ads are built.
 */
export const clientMarketing = (signer?: VideoSigner) => [
  ...contentRecords(signer),
  adDayRecord,
  searchPageRecord,
  keywordRecord,
  searchDayRecord,
  inboxRecord,
  askedReplyRecord,
  reviewRecord,
];
