/** The Marketing app's records, from each channel that keeps the numbers. */
import { adDayRecord } from "@wren/channel-meta/records";
import {
  keywordRecord,
  SEARCH_RECORDS,
  searchDayRecord,
  searchPageRecord,
} from "@wren/channel-search/records";
import { textContactRecord } from "@wren/channel-sms/records";
import { contentRecords, socialRecords, type VideoSigner } from "@wren/content/records";
import { factsRecord } from "@wren/core/facts";
import {
  commentRecord,
  dmRecord,
  inviteRecord,
  personRecord,
  placeRecord,
  threadRecord,
} from "@wren/outreach/records";

/** `signer` links a draft's stored files (thumbnail, cover) in its field editor. */
export const marketingNumbers = (signer?: VideoSigner) => [
  ...contentRecords(signer),
  adDayRecord,
  ...SEARCH_RECORDS,
  textContactRecord,
  dmRecord,
  commentRecord,
  placeRecord,
  threadRecord,
  inviteRecord,
  personRecord,
  ...socialRecords(signer),
  // The facts every draft may claim, edited on Marketing → Facts.
  factsRecord,
];
export const MARKETING_NUMBERS = marketingNumbers();

/**
 * A client's Marketing (`MarketingConsole`): what its posting, ads and search loops write into
 * its own database. Its ad days stay empty until its Meta ads are built.
 */
export const clientMarketing = (signer?: VideoSigner) => [
  ...contentRecords(signer),
  adDayRecord,
  searchPageRecord,
  keywordRecord,
  searchDayRecord,
];
export const CLIENT_MARKETING = clientMarketing();
