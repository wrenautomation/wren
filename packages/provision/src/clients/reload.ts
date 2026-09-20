/**
 * Making the running fleet see a changed roster. On Lambda the roster is
 * read from SSM at cold start, so a configuration bump (a new description)
 * recycles every instance: the next invocations load the new roster.
 * Locally the roster is a file and the worker is restarted by hand.
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import type { RosterStore } from "./roster.js";

export interface Reloader {
  /** Kick the reload; returns as soon as it is requested. */
  reload(): Promise<void>;
  /** Has the kicked reload taken effect? One probe, no waiting. */
  ready(): Promise<boolean>;
  /** What happened, for the step's outcome line. */
  readonly name: string;
}

export function lambdaReloader(opts: { functionName: string; lambda?: LambdaClient }): Reloader {
  const lambda = opts.lambda ?? new LambdaClient({});
  return {
    name: `lambda ${opts.functionName} recycled`,
    async reload() {
      await lambda.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: opts.functionName,
          Description: `roster ${new Date().toISOString()}`,
        }),
      );
    },
    async ready() {
      const c = await lambda.send(
        new GetFunctionConfigurationCommand({ FunctionName: opts.functionName }),
      );
      if (c.LastUpdateStatus === "Failed")
        throw new Error(`lambda update failed: ${c.LastUpdateStatusReason ?? "no reason given"}`);
      return c.LastUpdateStatus === "Successful";
    },
  };
}

/** Local: nothing recycles a process but its operator. */
export const restartByHand: Reloader = {
  name: "restart the worker to load the roster",
  async reload() {},
  async ready() {
    return true;
  },
};

export function fileRosterStore(path: string): RosterStore {
  return {
    read: () => readFile(path, "utf8"),
    write: (text) => writeFile(path, text, "utf8"),
  };
}
