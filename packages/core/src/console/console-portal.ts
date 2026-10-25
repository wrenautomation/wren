/**
 * `makeConsolePortal`: the ConsolePortal service over `consoleApi`, each handler behind the
 * portal's guard; a component change journals its loops' starts and stops.
 */
import * as restate from "@restatedev/restate-sdk";
import { accessHandlers } from "../access-console.js";
import { ASK, type AskService, ask, type QuestionRequest } from "../ask.js";
import type { LoopKey } from "../components.js";
import { CONSOLE_APPS, CONSOLE_ROUTES } from "../console-routes.js";
import { customHandlers } from "../custom-console.js";
import { EXECUTOR, type ExecutorService, failedOf } from "../executor.js";
import type { ExperimentInput } from "../experiment-store.js";
import type { FlagInput } from "../flag-store.js";
import type { SnippetInput } from "../library.js";
import { answer, PortalRefusal, type PortalRequest, portalService } from "../portal.js";
import type { ExportAsk, GetAsk, ListAsk, StatsAsk } from "../records-serve.js";
import type { SurveyInput } from "../survey-store.js";
import { viewAsApi, viewAsHandlers } from "../view-as.js";
import type { ComponentRequest, InstallRequest } from "./components.js";
import {
  type AddClientRequest,
  type AskRequest,
  type CallRequest,
  type ConnectRequest,
  consoleApi,
  type DoorRequest,
  type EditRequest,
  type IdsRequest,
  type KeepRequest,
  type SetLookRequest,
  type TeamSeatRequest,
  type TemplateRequest,
  type UndoRequest,
  type ViewRequest,
  type WorkflowSaveRequest,
  type WorkflowTestRequest,
} from "./console-api.js";
import type { SetLoopRequest } from "./loops.js";

// The SDK types `jsonSchema` as optional without `| undefined`; the json serde has it unset.
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<unknown>;

/** What `setLoop` calls on any loop object; `start` with no body keeps its stored settings. */
type LoopControl = {
  start: (ctx: restate.ObjectContext) => Promise<unknown>;
  stop: (ctx: restate.ObjectContext) => Promise<unknown>;
};

/**
 * A component change, journaled so a replay never installs twice, then its loops: the ones
 * its block lists started, the ones it dropped stopped. The sends land after the answer.
 */
async function changeLoops(
  ctx: restate.Context,
  verb: string,
  change: () => Promise<{ start: LoopKey[]; stop: LoopKey[] }>,
) {
  const out = await ctx.run(verb, () => answer(change));
  for (const l of out.start) ctx.objectSendClient<LoopControl>({ name: l.service }, l.key).start();
  for (const l of out.stop) ctx.objectSendClient<LoopControl>({ name: l.service }, l.key).stop();
  return out;
}

export function makeConsolePortal(deps: Parameters<typeof consoleApi>[0]) {
  const api = consoleApi(deps);
  return portalService({
    name: "ConsolePortal",
    main: deps.main,
    routes: CONSOLE_ROUTES,
    apps: CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      ...accessHandlers(api),
      ...customHandlers(api),
      ...viewAsHandlers(viewAsApi(deps)),
      view: (_: restate.Context, req: ViewRequest) => answer(() => api.view(req)),
      loops: (_: restate.Context, req: PortalRequest) => answer(() => api.loops(req)),
      agents: (_: restate.Context, req: PortalRequest) => answer(() => api.agents(req)),
      decisions: (_: restate.Context, req: PortalRequest) => answer(() => api.decisions(req)),
      recordsTypes: (_: restate.Context, req: PortalRequest) => answer(() => api.recordsTypes(req)),
      recordsList: (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => api.recordsList(req)),
      recordsCounts: (_: restate.Context, req: PortalRequest & { asks?: unknown }) =>
        answer(() => api.recordsCounts(req)),
      recordsGet: (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => api.recordsGet(req)),
      recordsExport: (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => api.recordsExport(req)),
      recordsStats: (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => api.recordsStats(req)),
      // One write each, journaled: a retry returns the same answer, never a second change.
      recordsEdit: (ctx: restate.Context, req: EditRequest) =>
        answer(() => ctx.run("edit", () => answer(() => api.recordsEdit(req)))),
      recordsUndo: (ctx: restate.Context, req: UndoRequest) =>
        answer(() => ctx.run("undo", () => answer(() => api.recordsUndo(req)))),
      recordsAsk: (ctx: restate.Context, req: AskRequest) =>
        answer(async () => {
          const id = await ctx.run("open run", () => answer(() => api.recordsAskOpen(req)));
          ctx.serviceSendClient<AskService>(ASK).edit({ id });
          return { id };
        }),
      savedViews: (_: restate.Context, req: KeepRequest) => answer(() => api.savedViews(req)),
      saveView: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("save view", () => answer(() => api.saveView(req)))),
      removeView: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("remove view", () => answer(() => api.removeView(req)))),
      moveViews: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("move views", () => answer(() => api.moveViews(req)))),
      prefs: (_: restate.Context, req: KeepRequest) => answer(() => api.prefs(req)),
      snippets: (_: restate.Context, req: PortalRequest) => answer(() => api.snippets(req)),
      snippetAdd: (ctx: restate.Context, req: PortalRequest & SnippetInput) =>
        answer(() => ctx.run("add snippet", () => answer(() => api.snippetAdd(req)))),
      snippetRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove snippet", () => answer(() => api.snippetRemove(req)))),
      flagAdd: (ctx: restate.Context, req: PortalRequest & FlagInput) =>
        answer(() => ctx.run("add flag", () => answer(() => api.flagAdd(req)))),
      flagRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove flag", () => answer(() => api.flagRemove(req)))),
      experimentAdd: (ctx: restate.Context, req: PortalRequest & ExperimentInput) =>
        answer(() => ctx.run("add experiment", () => answer(() => api.experimentAdd(req)))),
      experimentStart: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("start experiment", () => answer(() => api.experimentStart(req)))),
      experimentShip: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("ship experiment", () => answer(() => api.experimentShip(req)))),
      experimentStop: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("stop experiment", () => answer(() => api.experimentStop(req)))),
      experimentRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove experiment", () => answer(() => api.experimentRemove(req)))),
      surveyAdd: (ctx: restate.Context, req: PortalRequest & SurveyInput) =>
        answer(() => ctx.run("add survey", () => answer(() => api.surveyAdd(req)))),
      surveyStart: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("start survey", () => answer(() => api.surveyStart(req)))),
      surveyPause: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("pause survey", () => answer(() => api.surveyPause(req)))),
      surveyRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove survey", () => answer(() => api.surveyRemove(req)))),
      surveysDue: (_: restate.Context, req: PortalRequest) => answer(() => api.surveysDue(req)),
      surveyAnswer: (
        ctx: restate.Context,
        req: PortalRequest & { survey?: unknown; value?: unknown },
      ) => answer(() => ctx.run("answer survey", () => answer(() => api.surveyAnswer(req)))),
      tokens: (_: restate.Context, req: PortalRequest) => answer(() => api.tokens(req)),
      tokenMake: (
        ctx: restate.Context,
        req: PortalRequest & { name?: unknown; pin?: unknown; days?: unknown },
      ) => answer(() => ctx.run("make token", () => answer(() => api.tokenMake(req)))),
      tokenRevoke: (ctx: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(() => ctx.run("revoke token", () => answer(() => api.tokenRevoke(req)))),
      setPref: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("set pref", () => answer(() => api.setPref(req)))),
      setLoop: (ctx: restate.Context, req: SetLoopRequest) =>
        answer(async () => {
          api.adminFor(req);
          // Journaled: the call below suspends the Lambda, and the replay must find the same list.
          const loop = api.pick(req, await ctx.run("read loops", () => api.loops(req)));
          const object = ctx.objectClient<LoopControl>({ name: loop.service }, loop.key);
          await (req.run ? object.start() : object.stop());
          return { ...loop, running: req.run };
        }),
      /**
       * Any public handler, by an operator, as one durable call: the target is checked
       * against Restate's own list, and the call is a runs row with who made it.
       */
      call: (ctx: restate.Context, req: CallRequest) =>
        answer(async (): Promise<unknown> => {
          const read = api.reader(req);
          // Journaled: the call below suspends the Lambda, and the replay must find the same target.
          const h = api.target(req, await ctx.run("read handler", read));
          await ctx.run("check row", () => answer(() => api.callOn(req, h)));
          const runId = await ctx.run("open run", () => api.openCall(req, h));
          const target = {
            service: h.service,
            method: h.handler,
            ...(h.kind === "service" ? {} : { key: req.key as string }),
            // The operator is the viewer, whatever the input says.
            parameter: h.viewer ? { ...(req.input as object), viewer: req.viewer } : req.input,
            inputSerde: JSON_SERDE,
          };
          if (req.send) {
            ctx.genericSend(target);
            await ctx.run("close run", () => api.closeCall(runId, null));
            return { sent: true };
          }
          try {
            const out = await ctx.genericCall<unknown, unknown>({
              ...target,
              outputSerde: JSON_SERDE,
            });
            await ctx.run("close run", () => api.closeCall(runId, null));
            return out;
          } catch (err) {
            if (err instanceof restate.TerminalError)
              await ctx.run("close run", () => api.closeCall(runId, err.message));
            throw err;
          }
        }),
      setLook: (_: restate.Context, req: SetLookRequest) => answer(() => api.setLook(req)),
      teamSet: (_: restate.Context, req: TeamSeatRequest) => answer(() => api.teamSet(req)),
      teamRemove: (_: restate.Context, req: TeamSeatRequest) => answer(() => api.teamRemove(req)),
      install: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "install", () => api.install(req)),
      configure: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "configure", () => api.configure(req)),
      uninstall: (ctx: restate.Context, req: ComponentRequest) =>
        changeLoops(ctx, "uninstall", () => api.uninstall(req)),
      ask: (_: restate.Context, req: ComponentRequest) => answer(() => api.ask(req)),
      templatePlan: (_: restate.Context, req: TemplateRequest) =>
        answer(() => api.templatePlan(req)),
      // Journaled once: a retry reads the same answer, and the door's token is never made twice.
      templateInstall: (ctx: restate.Context, req: TemplateRequest) =>
        answer(() => ctx.run("install template", () => answer(() => api.templateInstall(req)))),
      templatePublish: (ctx: restate.Context, req: TemplateRequest) =>
        answer(() => ctx.run("ask approval", () => answer(() => api.templatePublish(req)))),
      templateUninstall: (ctx: restate.Context, req: TemplateRequest) =>
        changeLoops(ctx, "uninstall template", () => api.templateUninstall(req)),
      templateApprove: (ctx: restate.Context, req: IdsRequest) =>
        changeLoops(ctx, "approve template", () => api.templateApprove(req)),
      templateDecline: (ctx: restate.Context, req: IdsRequest) =>
        answer(() => ctx.run("decline template", () => answer(() => api.templateDecline(req)))),
      templateInstalls: (_: restate.Context, req: PortalRequest) =>
        answer(() => api.templateInstalls(req)),
      connect: (ctx: restate.Context, req: ConnectRequest) =>
        answer(() => ctx.run("connect", () => answer(() => api.connect(req)))),
      workflowSave: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("save draft", () => answer(() => api.workflowSave(req)))),
      // Its Schedule nodes' clocks start after the commit, as a template's loops do.
      workflowPublish: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        changeLoops(ctx, "publish", async () => {
          const out = await api.workflowPublish(req);
          return { ...out, start: out.start ?? [], stop: [] };
        }),
      workflowSwitch: (ctx: restate.Context, req: WorkflowSaveRequest & { on?: unknown }) =>
        changeLoops(ctx, "switch", () => api.workflowSwitch(req)),
      workflowDiscard: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("discard draft", () => answer(() => api.workflowDiscard(req)))),
      workflowTemplateSave: (
        ctx: restate.Context,
        req: WorkflowSaveRequest & { name?: unknown; blurb?: unknown },
      ) =>
        answer(() =>
          ctx.run("save as template", () => answer(() => api.workflowTemplateSave(req))),
        ),
      workflowTemplateDelete: (ctx: restate.Context, req: PortalRequest & { template?: unknown }) =>
        answer(() =>
          ctx.run("delete template", () => answer(() => api.workflowTemplateDelete(req))),
        ),
      workflowAsk: (ctx: restate.Context, req: WorkflowSaveRequest & { message?: unknown }) =>
        answer(async () => {
          const id = await ctx.run("open run", () => answer(() => api.workflowAskOpen(req)));
          ctx.serviceSendClient<AskService>(ASK).edit({ id });
          return { id };
        }),
      workflowAnswer: (_: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(() => api.workflowAnswer(req)),
      workflowBuild: (
        ctx: restate.Context,
        req: PortalRequest & { message?: unknown; name?: unknown },
      ) =>
        answer(async () => {
          const got = await ctx.run("build", () => answer(() => api.workflowBuild(req)));
          if (got.ask) ctx.serviceSendClient<AskService>(ASK).edit({ id: got.ask });
          return got;
        }),
      workflowsMade: (_: restate.Context, req: PortalRequest) =>
        answer(() => api.workflowsMade(req)),
      workflowDelete: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("delete workflow", () => answer(() => api.workflowDelete(req)))),
      workflowTest: (_: restate.Context, req: WorkflowTestRequest) =>
        answer(() => api.workflowTest(req)),
      workflowDoors: (_: restate.Context, req: DoorRequest) => answer(() => api.workflowDoors(req)),
      doorReveal: (_: restate.Context, req: DoorRequest) => answer(() => api.doorReveal(req)),
      // Journaled once: a retry reads the same token, and never makes a second one.
      doorRotate: (ctx: restate.Context, req: DoorRequest) =>
        answer(() => ctx.run("rotate door", () => answer(() => api.doorRotate(req)))),
      /** A failed executor step, again, waited on so the button says how it went. */
      retryEvent: (ctx: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(async () => {
          const id = api.eventToRetry(req);
          const got = await ctx
            .serviceClient<ExecutorService>(EXECUTOR)
            .retry({ client: null, id });
          if (!got) throw new PortalRefusal("it isn't failed now", 409);
          return { done: [id], ...got };
        }),
      /**
       * Many failed runs again at once: each failed step behind them gets `Executor/retry`. Sent,
       * not waited on; the list shows them leave Failed as each runs.
       */
      replay: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(async () => {
          const refs = api.toReplay(req);
          const ids = await ctx.run("failed steps", () => failedOf(deps.main, refs));
          if (!ids.length) throw new PortalRefusal("none of them is failed now", 409);
          for (const id of ids)
            ctx.serviceSendClient<ExecutorService>(EXECUTOR).retry({ client: null, id });
          return { done: refs, replayed: ids.length };
        }),
      releaseHold: (_: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(() => api.releaseHold(req)),
      question: (ctx: restate.Context, req: QuestionRequest) =>
        answer(() => ask(ctx, deps.main, req, deps.askContext)),
      addClient: (ctx: restate.Context, req: AddClientRequest) =>
        answer(async () => {
          const ask = api.newClient(req);
          // One step: a retry after a timeout finishes the same add, and the replay reads its answer.
          const made = await ctx.run("add client", () => api.addClient(ask), {
            maxRetryAttempts: 3,
          });
          // The id was taken before this ask: same name is the same client, else a clash.
          if (made.name !== ask.name || made.demo)
            throw new PortalRefusal(`client ${ask.id} exists`, 409);
          return made;
        }),
    },
  });
}
