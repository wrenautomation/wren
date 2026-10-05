/** The Marketing app's records, from each channel that keeps the numbers. */
import { adDayRecord } from "@wren/channel-meta/records";
import { SEARCH_RECORDS } from "@wren/channel-search/records";
import { textContactRecord } from "@wren/channel-sms/records";
import { CONTENT_RECORDS } from "@wren/content/records";
import { dmRecord } from "@wren/outreach/records";

export const MARKETING_NUMBERS = [
  ...CONTENT_RECORDS,
  adDayRecord,
  ...SEARCH_RECORDS,
  textContactRecord,
  dmRecord,
];
