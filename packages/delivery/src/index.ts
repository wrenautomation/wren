/**
 * Delivery: what we do for each client (D1–D12). An engagement is a bought
 * offer with its plan dated from a start day; the timeline, deliverables, asks
 * and results hang off it. A foundation: products post into it, it never
 * imports one. Every write names the client, and a row of another client's
 * is "not found", so one client can never reach another's by id.
 */

export { amount, CONTRACT_VERSION, contractText, WREN_PARTY } from "./contract.js";
export {
  addInvoice,
  type Bill,
  billCents,
  billLines,
  billMonth,
  billsDue,
  disputeInvoice,
  markInvoice,
  monthName,
  type Reversed,
  refundInvoice,
  setupInvoice,
  stopIfReversed,
  type UsageItem,
} from "./invoices.js";
export {
  appOf,
  HALFWAY,
  LAST_WEEK,
  mailLevelOf,
  momentLabel,
  momentsReached,
  nextOffers,
  pagePath,
  recordInterest,
  recordReview,
  setMailLevel,
  WORK_APP,
} from "./moments.js";
export {
  agreementOf,
  answerAccess,
  onboard,
  planOf,
  requestAccess,
  signAgreement,
  startIfReady,
  termsFor,
} from "./onboarding.js";
export {
  addDays,
  DeliveryRefusal,
  dayOf,
  engagementOf,
  mondayOf,
  todayUtc,
  weekday,
} from "./rows.js";
export * from "./schema.js";
export * from "./source.js";
export {
  type AccessView,
  type AskView,
  boughtBy,
  type CommentView,
  type DeliverableView,
  type DeliveryHome,
  deliveryHome,
  type EngagementView,
  type InvoiceView,
  invoicesOf,
  type MilestoneState,
  type MomentView,
  type NextView,
  type PaperworkView,
  type PulseView,
  type ResultView,
  type ReviewView,
  type StepView,
  storedFile,
  timeline,
  type UpdateView,
} from "./views.js";
export {
  addAsk,
  addComment,
  addDeliverable,
  answerAsk,
  type CommentOn,
  datedPlan,
  decideDeliverable,
  hideUpdate,
  markDone,
  postUpdate,
  recordPulse,
  recordResult,
  setEngagementSource,
  setEngagementStatus,
  slipMilestone,
  startEngagement,
} from "./work.js";
