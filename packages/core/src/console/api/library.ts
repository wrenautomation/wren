/**
 * The Library and the team's own tools: snippets, flags, experiments, surveys (and a client
 * login's answers), AI tool tokens.
 */
import { type Permission, WREN } from "../../access.js";
import {
  addExperiment,
  type ExperimentInput,
  removeExperiments,
  shipExperiments,
  startExperiments,
  stopExperiments,
} from "../../experiment-store.js";
import { addFlag, type FlagInput, removeFlags } from "../../flag-store.js";
import { addSnippet, removeSnippet, type SnippetInput, snippetsOf } from "../../library.js";
import {
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  type SignedViewer,
  seesInternal,
  teamCan,
} from "../../portal.js";
import {
  addSurvey,
  answerSurvey,
  pauseSurveys,
  removeSurveys,
  type SurveyInput,
  startSurveys,
  surveysDue,
} from "../../survey-store.js";
import { listTokens, makeToken, revokeToken } from "../../tokens.js";
import type { ConsoleContext } from "./context.js";

export function libraryHandlers(ctx: ConsoleContext) {
  const { main, edge, team, teamWriter } = ctx;
  /** An experiment button's writer (`manage` at Wren) and the flags it names. */
  const experimentIds = (req: PortalRequest & { ids?: unknown }): [string, string[]] => {
    const by = teamWriter(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
    const ids = Array.isArray(req.ids) ? req.ids.filter((x) => typeof x === "string") : [];
    if (!ids.length) throw new PortalRefusal("say which experiment", 400);
    return [by, ids];
  };
  return {
    /** Wren's snippets for the Insert picker: the team's, in any workspace it drafts in. */
    snippets: async (req: PortalRequest) => {
      team(req);
      return snippetsOf(main);
    },
    snippetAdd: async (req: PortalRequest & SnippetInput) => {
      const by = teamWriter(req);
      const { title, body, tags, channel } = req;
      return addSnippet(main, { title, body, tags, channel }, by);
    },
    /** Flags are a release decision: `manage` at Wren. */
    flagAdd: async (req: PortalRequest & FlagInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const { key, about, surface, variants } = req;
      return addFlag(main, { key, about, surface, variants }, by, edge);
    },
    flagRemove: async (req: PortalRequest & { ids?: unknown }) => {
      teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const ids = Array.isArray(req.ids) ? req.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length) throw new PortalRefusal("say which flag", 400);
      return { done: await removeFlags(main, ids, edge) };
    },
    /** Experiments: Start and Ship put a variant live on the public site, so `manage` (William). */
    experimentAdd: async (req: PortalRequest & ExperimentInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      return addExperiment(main, { flag: req.flag, goal: req.goal }, by);
    },
    experimentStart: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await startExperiments(main, ids, by, edge) };
    },
    experimentShip: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await shipExperiments(main, ids, by, edge) };
    },
    experimentStop: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await stopExperiments(main, ids, by, edge) };
    },
    experimentRemove: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await removeExperiments(main, ids) };
    },
    /** Surveys: Go live puts a site survey on the public site, so `manage` (William). */
    surveyAdd: async (req: PortalRequest & SurveyInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const { key, question, kind, choices, surface } = req;
      return addSurvey(main, { key, question, kind, choices, surface }, by);
    },
    surveyStart: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await startSurveys(main, ids, by, edge) };
    },
    surveyPause: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await pauseSurveys(main, ids, edge) };
    },
    surveyRemove: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await removeSurveys(main, ids) };
    },
    /** A client login's portal surveys on its client; the team and the demo get none. */
    surveysDue: async (req: PortalRequest) => {
      if (isDemo(req.viewer) || seesInternal(req)) return [];
      const client = await pickClient(main, req);
      return surveysDue(main, client.id, (req.viewer as SignedViewer).email);
    },
    surveyAnswer: async (req: PortalRequest & { survey?: unknown; value?: unknown }) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (seesInternal(req)) throw new PortalRefusal("surveys are for client logins", 403);
      if (typeof req.survey !== "string") throw new PortalRefusal("say which survey", 400);
      const client = await pickClient(main, req);
      return answerSurvey(main, {
        survey: req.survey,
        client: client.id,
        person: (req.viewer as SignedViewer).email,
        value: req.value,
      });
    },
    /** The signed-in person's live AI tool tokens (designs/2026-10-09-ai-tools.md). Never the demo's. */
    tokens: async (req: PortalRequest) => {
      if (isDemo(req.viewer)) return [];
      return listTokens(main, (req.viewer as SignedViewer).email);
    },
    /**
     * A new token, shown once. Pinned to the request's client (a client's own host, or the
     * workspace picked), else to `pin` if given, else as wide as its person.
     */
    tokenMake: async (
      req: PortalRequest & {
        name?: unknown;
        pin?: unknown;
        days?: unknown;
        verbs?: unknown;
        apps?: unknown;
      },
    ) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (typeof req.name !== "string") throw new PortalRefusal("name the token", 400);
      const client = req.client || (typeof req.pin === "string" && req.pin ? req.pin : null);
      const days = req.days === undefined || req.days === null ? null : Number(req.days);
      const list = (v: unknown, what: string) => {
        if (v === undefined || v === null) return null;
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
          throw new PortalRefusal(`${what}: a list of names`, 400);
        return v as string[];
      };
      // A token made by a token is held to the maker's cap: it can't widen itself.
      const cap = (req.viewer as SignedViewer).cap;
      const verbs = list(req.verbs, "verbs") ?? (cap ? [...cap.verbs] : null);
      const apps = list(req.apps, "apps") ?? (cap?.apps ? [...cap.apps] : null);
      if (cap && verbs?.some((v) => !cap.verbs.includes(v as Permission)))
        throw new PortalRefusal("This token can't make one that does more.", 403);
      if (cap?.apps && apps?.some((a) => !cap.apps?.includes(a)))
        throw new PortalRefusal("This token can't make one that reaches more.", 403);
      return makeToken(main, (req.viewer as SignedViewer).email, {
        name: req.name,
        client,
        days,
        verbs,
        apps,
      });
    },
    tokenRevoke: async (req: PortalRequest & { id?: unknown }) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (typeof req.id !== "string" || !/^[0-9a-f-]{36}$/i.test(req.id))
        throw new PortalRefusal("say which token", 400);
      await revokeToken(main, (req.viewer as SignedViewer).email, req.id);
      return { revoked: req.id };
    },
    /** A record action: `{ids}`, each removed. */
    snippetRemove: async (req: PortalRequest & { ids?: unknown }) => {
      teamWriter(req);
      const ids = Array.isArray(req.ids) ? req.ids.map(Number).filter(Number.isSafeInteger) : [];
      if (!ids.length) throw new PortalRefusal("say which snippet", 400);
      for (const id of ids) await removeSnippet(main, id);
      return { done: ids };
    },
  };
}
