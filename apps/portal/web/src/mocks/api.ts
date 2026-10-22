/**
 * The portal's server, faked in the browser for page stories (designs/2026-10-18-portal-page-stories.md).
 * Every call is `POST /api/<path>` (`../api.ts`); reads made together come as one `pulse`. One
 * MSW handler answers both from a table, so the app runs as it does live: batching, the write
 * path and the data layer included. Synthetic data only: the repo is public.
 */
import { delay, HttpResponse, http } from "msw";

/** A call's answer: its body, or a refusal (`{ status: 403, body: { error } }`). */
export type Answer = { status: number; body: unknown };
/** Path (`delivery/me`) → its body, or a function of the call's body. */
export type Answers = Record<string, Body | Reply>;
/** A fixed answer. `object` takes in arrays and every typed body. */
type Body = object | string | number | boolean | null;
/** An answer made from the call's body. */
type Reply = (body: Record<string, unknown>) => unknown;

/** What a route of the server's API object `A` answers. */
export type Out<A, K extends keyof A> = A[K] extends (...args: never[]) => infer R
  ? Awaited<R>
  : never;

/**
 * Answers for one service, typed by its API object (`serve<NotesApi>("notes", { … })`): when the
 * server changes what a route answers, the typecheck fails here, not the story.
 */
export function serve<A>(
  service: string,
  routes: { [K in keyof A & string]?: Out<A, K> | ((body: Record<string, unknown>) => Out<A, K>) },
): Answers {
  return Object.fromEntries(
    Object.entries(routes).map(([k, v]) => [`${service}/${k}`, v as Body | Reply]),
  );
}

/** How every call goes: as the table says, never back (`pending`), or refused (`fails`). */
export type Mode = "answer" | "pending" | "fails";

/** Wrapped so a table entry can say a status: `refuse(403, "Not yours")`. */
const REFUSAL = Symbol("refusal");
export const refuse = (status: number, error: string) => ({ [REFUSAL]: status, error });

/**
 * The table's key for a call: its path, or for a public handler called by name (`console/call`)
 * `console/call:<Service>.<handler>`.
 */
export const keyOf = (path: string, body: Record<string, unknown>) =>
  path === "console/call" ? `${path}:${body.service}.${body.handler}` : path;

/** This story's calls still out, and the ones the table lacked: `settled()` reads both. */
const story = { out: 0, unmocked: new Set<string>() };

/** A call with no answer: named in the console and failed by `settled`. Answer it with a 404. */
export function unmocked(key: string) {
  console.warn(`unmocked: ${key}`);
  story.unmocked.add(key);
  return refuse(404, `unmocked: ${key}`);
}

/** Called before each story renders. */
export function freshStory() {
  story.out = 0;
  story.unmocked.clear();
}

/**
 * Waits until no call has been out for `quietMs`, then fails if any call was unmocked: a page
 * that starts a new read needs its answer in the table (`./data/`), not a 404 in the test.
 */
export async function settled(quietMs = 200, maxMs = 8000) {
  const end = Date.now() + maxMs;
  let quietSince = Date.now();
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 25));
    if (story.out > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) break;
  }
  if (story.unmocked.size)
    throw new Error(`Calls with no answer: ${[...story.unmocked].join(", ")}`);
}

/** The answer to one call. A call the table lacks is a 404, named in the console. */
export function answerOf(
  answers: Answers,
  path: string,
  body: Record<string, unknown>,
  mode: Mode,
): Answer | null {
  // Who is signed in always answers: without it there is no shell to show a state in.
  if (path !== "delivery/me") {
    if (mode === "pending") return null;
    if (mode === "fails")
      return { status: 500, body: { error: "The fake server failed, as asked." } };
  }
  const key = keyOf(path, body);
  const entry = answers[key];
  if (entry === undefined) return { status: 404, body: { error: unmocked(key).error } };
  const got = typeof entry === "function" ? (entry as Reply)(body) : entry;
  if (got && typeof got === "object" && REFUSAL in got) {
    const { [REFUSAL]: status, ...rest } = got as { [REFUSAL]: number; error: string };
    return { status, body: rest };
  }
  return { status: 200, body: messy ? stretch(got) : got };
}

/**
 * Messy mode (the `data` toolbar, `wren-look --messy`): every answer's records as prod's look, not
 * the table's tidy one. A string with a space is words a person wrote (a subject, a name, a note),
 * so it grows long, with marks and other scripts; ids, enums, dates and addresses have no space and
 * stay, so the app still runs. The app's own words (a field's label, a view's name, a state) stay
 * as shipped: those are ours, not the data's. Fixed text, so a run is the same each time.
 */
const MESSY_TAIL = " and a much longer real world line, as prod data has: Ünïcödé, 長い件名, 📬";
const OURS = new Set([
  "label", "description", "hint", "noun", "plural", "placeholder", "help", "empty",
  "states", "views", "fields", "columns",
]);
let messy = false;
export const setMessy = (on: boolean) => {
  messy = on;
};
export function stretch(v: unknown): unknown {
  if (typeof v === "string") return v.includes(" ") && v.length < 400 ? v + MESSY_TAIL : v;
  if (Array.isArray(v)) return v.map(stretch);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, OURS.has(k) ? x : stretch(x)]),
    );
  return v;
}

type Call = { path: string; body?: Record<string, unknown> };

/** An answer, counted out until the page has had a beat to read it and ask what follows. */
async function counted(answer: () => Promise<Response>) {
  story.out++;
  try {
    return await answer();
  } finally {
    setTimeout(() => story.out--, 50);
  }
}

/** The MSW handlers for `answers`. A story overrides one path with its own table on top. */
export function fakeApi(answers: Answers, mode: Mode = "answer") {
  return [
    // The app makes no GET to /api once loaded (dictation's, at load, is .storybook/main.ts's).
    http.get("/api/*", ({ params }) => {
      const key = `GET ${String((params as Record<string, string[] | string>)[0] ?? "")}`;
      console.warn(`unmocked: ${key}`);
      story.unmocked.add(key);
      return HttpResponse.json({ error: `unmocked: ${key}` }, { status: 404 });
    }),
    http.post("/api/pulse", async ({ request }) => {
      const { calls } = (await request.json()) as { calls: Call[] };
      const each = calls.map((c) => answerOf(answers, c.path, c.body ?? {}, mode));
      if (each.some((a) => a === null)) return delay("infinite").then(() => HttpResponse.json({}));
      return counted(async () => HttpResponse.json({ answers: each }));
    }),
    http.post("/api/*", async ({ request, params }) => {
      const path = String((params as Record<string, string[] | string>)[0] ?? "");
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const a = answerOf(answers, path, body, mode);
      if (!a) return delay("infinite").then(() => HttpResponse.json({}));
      return counted(async () => HttpResponse.json(a.body as never, { status: a.status }));
    }),
  ];
}
