/**
 * The driver: walks the steps from where the last invocation stopped. Pure
 * over `Host` and the state it is handed back, so the Domain object is a
 * thin shell and a unit test runs the whole provision.
 *
 * One invocation ends in one of four ways: every step done; a gate open
 * (a person answers, then `resume`); a person needed (a browser leg or a
 * check failed for good; they fix it and `resume`); or an error the next
 * invocation retries from the same step. Nothing ever parks.
 */
import type { Deps } from "./deps.js";
import { type Gate, type GateAnswer, GateOpen, type Host, NeedsHuman } from "./host.js";
import type { Plan } from "./plan.js";
import { type Memo, STEPS, type StepResult } from "./steps.js";

export interface OpenGate {
  name: Gate;
  prompt: string;
  step: string;
  openedAt: string;
  artifacts?: Record<string, string>;
}

export interface RunState {
  results: Record<string, StepResult>;
  memo: Memo;
  answers: Partial<Record<Gate, GateAnswer>>;
  gate: OpenGate | null;
  /** The last error, cleared when the step it came from succeeds. */
  error: { step: string; message: string; at: string } | null;
  finishedAt: string | null;
}

export type RunStatus = "idle" | "running" | "waiting" | "dry-run" | "rejected" | "failed" | "done";

export const emptyState = (): RunState => ({
  results: {},
  memo: {},
  answers: {},
  gate: null,
  error: null,
  finishedAt: null,
});

export function statusOf(state: RunState): RunStatus {
  if (state.finishedAt) {
    if (Object.values(state.results).some((r) => r.status === "rejected")) return "rejected";
    return Object.keys(state.results).length === STEPS.length ? "done" : "dry-run";
  }
  if (state.gate) return "waiting";
  if (state.error) return "failed";
  return Object.keys(state.results).length === 0 ? "idle" : "running";
}

/** One pass: runs until every step is done or one has to stop. Mutates and returns `state`. */
export async function provisionOnce(
  host: Host,
  deps: Deps,
  plan: Plan,
  state: RunState,
): Promise<RunState> {
  // A person's answer to a "human" gate: approved = try the step again; declined = it is over.
  const human = state.gate?.name === "human" ? state.answers.human : undefined;
  if (state.gate && human && !human.approved) {
    state.results[state.gate.step] = {
      status: "rejected",
      detail: human.note ?? "declined by the operator",
    };
    state.gate = null;
    state.answers = {};
    state.finishedAt = (await host.now()).toISOString();
    return state;
  }
  state.gate = null;
  for (const step of STEPS) {
    if (state.results[step.name]) continue;
    if (plan.dryRun && step.irreversible) {
      state.finishedAt = (await host.now()).toISOString();
      return state;
    }
    let result: StepResult;
    try {
      result = await step.run({
        host,
        deps,
        plan,
        memo: state.memo,
        gate: (name, prompt) => {
          const answer = state.answers[name];
          if (!answer) throw new GateOpen(name, prompt);
          return answer;
        },
      });
    } catch (err) {
      const at = (await host.now()).toISOString();
      if (err instanceof GateOpen) {
        state.gate = { name: err.gate, prompt: err.prompt, step: step.name, openedAt: at };
        return state;
      }
      if (err instanceof NeedsHuman) {
        state.gate = {
          name: "human",
          prompt: err.message,
          step: step.name,
          openedAt: at,
          artifacts: err.artifacts,
        };
        return state;
      }
      state.error = {
        step: step.name,
        message: err instanceof Error ? err.message : String(err),
        at,
      };
      throw err;
    }
    state.results[step.name] = result;
    state.error = null;
    // A gate's answer is spent by the step that asked; the next ask is a new question.
    state.answers = {};
    if (result.status === "rejected") {
      state.finishedAt = (await host.now()).toISOString();
      return state;
    }
  }
  state.finishedAt = (await host.now()).toISOString();
  return state;
}
