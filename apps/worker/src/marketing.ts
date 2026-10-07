/** The Marketing app's records, from each channel that keeps the numbers. */
import { adDayRecord } from "@wren/channel-meta/records";
import {
  keywordRecord,
  SEARCH_RECORDS,
  searchDayRecord,
  searchPageRecord,
} from "@wren/channel-search/records";
import { textContactRecord } from "@wren/channel-sms/records";
import { CONTENT_RECORDS, SOCIAL_RECORDS } from "@wren/content/records";
import {
  commentRecord,
  dmRecord,
  inviteRecord,
  personRecord,
  placeRecord,
  threadRecord,
} from "@wren/outreach/records";

export const MARKETING_NUMBERS = [
  ...CONTENT_RECORDS,
  adDayRecord,
  ...SEARCH_RECORDS,
  textContactRecord,
  dmRecord,
  commentRecord,
  placeRecord,
  threadRecord,
  inviteRecord,
  personRecord,
  ...SOCIAL_RECORDS,
];

/**
 * A client's Marketing (`MarketingConsole`): what its posting, ads and search loops write into
 * its own database. Its ad days stay empty until its Meta ads are built.
 */
export const CLIENT_MARKETING = [
  ...CONTENT_RECORDS,
  adDayRecord,
  searchPageRecord,
  keywordRecord,
  searchDayRecord,
];
