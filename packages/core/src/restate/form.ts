/**
 * A handler's form: its input as a zod schema, its effect, whether the ingress may call it.
 * Restate checks the input against the schema and publishes it, and the console's Handlers
 * page builds the form from it (`designs/2026-10-04-handler-forms.md`).
 *
 * Each wrapper hands back the handler's own type, so typed clients see what they saw before.
 */
import * as restate from "@restatedev/restate-sdk";
import { z } from "zod";

/** What a press does outside wren: money, a message to a person, a public post. */
export type Effect = "spends" | "sends" | "posts";

export interface Form {
  /** Mirrors the handler's TS input; objects loose, so a field it forgets still arrives. */
  input?: z.ZodType;
  effect?: Effect;
  /** Only another service calls it; the ingress refuses it. */
  ingressPrivate?: true;
}

/** A handler that takes nothing: an empty form. No body, null and `{}` all pass. */
export const NO_INPUT = z.preprocess(
  (v) => (v === null ? undefined : v),
  z.looseObject({}).optional(),
);

/**
 * A portal request's own fields (`PortalRequest`). The portal's Worker and the console's `call`
 * fill `viewer`; a form never asks for it.
 */
export const PORTAL_FIELDS = {
  viewer: z.looseObject({}).optional().describe("Who asks; filled in, never typed"),
  client: z.string().optional().describe("Which of the viewer's clients; the first when left out"),
  asClient: z.boolean().optional().describe("An operator looking as the client would"),
};

/** Restate's handler options for a form. `accept` keeps the JSON content type an optional input loses. */
export const formOptions = (form: Form) => ({
  ...(form.input ? { input: restate.serde.schema(form.input), accept: "application/json" } : {}),
  ...(form.effect ? { metadata: { effect: form.effect } } : {}),
  ...(form.ingressPrivate ? { ingressPrivate: true } : {}),
});

type Wrap = (opts: unknown, fn: unknown) => unknown;
/** Each wrapped handler's form, so `portalService` can wrap it again behind the guard. */
const FORMS = new WeakMap<object, Form>();
const wrap =
  (w: Wrap) =>
  <F>(form: Form, fn: F): F => {
    const handler = w(formOptions(form), fn) as F;
    FORMS.set(handler as object, form);
    return handler;
  };
/** The form a handler was wrapped with, if any. */
export const handlerForm = (handler: unknown): Form | undefined =>
  typeof handler === "function" ? FORMS.get(handler) : undefined;

/** A service's handler with its form. */
export const serviceHandler = wrap(restate.handlers.handler as Wrap);
/** An object's exclusive handler with its form. */
export const exclusiveHandler = wrap(restate.handlers.object.exclusive as Wrap);
/** An object's shared handler with its form. */
export const sharedHandler = wrap(restate.handlers.object.shared as Wrap);
