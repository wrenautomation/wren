/** CDC relay and event readers (relay.ts): box only, loaded by dynamic import, so NATS and node-pg stay out of the Lambda. */
export {
  consumeEvents,
  type DurableOptions,
  type WatchOptions,
  watchEvents,
} from "./event-consumers.js";
export {
  EVENTS_STREAM,
  EVENTS_SUBJECT,
  eventSubject,
  publishEvent,
  RELAY_PUBLICATION,
  RELAY_SLOT,
  type Relay,
  type RelayOptions,
  type RelayState,
  type RelayStatus,
  type RunEvent,
  startRelay,
} from "./relay.js";
