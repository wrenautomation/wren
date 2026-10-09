/**
 * The Code node's sandbox (designs/2026-10-09-code-step.md): a function body run in QuickJS
 * (wasm, in process), a fresh context per call. It sees `event` (a copy) and `now`, and has no
 * fetch, timers, require or files. Server only: the web reads `logic.ts`, never this.
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import { CODE_MOST } from "./logic.js";
import type { SpineEvent, Step } from "./spine.js";

const RESULT_MOST = 64_000;
const RUN_MS = 1_000;
const MEMORY = 32 * 1024 * 1024;

let module: Promise<QuickJSWASMModule> | undefined;
const quickjs = () => {
  module ??= import("@jitl/quickjs-singlefile-mjs-release-sync").then((v) =>
    newQuickJSWASMModuleFromVariant(v.default),
  );
  return module;
};

/** What a run gives back: the fields to merge, or null to leave by `skip`. */
export type CodeResult = { data: Record<string, unknown> } | { data: null };

/** Run `code` on `e`. Throws with the code's own error line when it throws, loops or overflows. */
export async function runCode(code: string, e: SpineEvent, now: Date): Promise<CodeResult> {
  if (code.length > CODE_MOST) throw new Error(`code over ${CODE_MOST} characters`);
  const runtime = (await quickjs()).newRuntime();
  runtime.setMemoryLimit(MEMORY);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + RUN_MS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const input = JSON.stringify({ event: e, now: now.toISOString() });
    const src = `(() => { const { event, now } = ${input};\nconst __r = (() => {\n${code}\n})();\nreturn JSON.stringify(__r === undefined ? null : __r); })()`;
    const got = vm.evalCode(src, "code.js");
    if (got.error) {
      const err = vm.dump(got.error) as { name?: string; message?: string } | string;
      got.error.dispose();
      if (Date.now() > deadline) throw new Error(`code ran past ${RUN_MS / 1000} s`);
      throw new Error(
        typeof err === "string" ? err : `${err?.name ?? "Error"}: ${err?.message ?? "failed"}`,
      );
    }
    const text = vm.dump(got.value) as unknown;
    got.value.dispose();
    if (typeof text !== "string") return { data: null };
    if (text.length > RESULT_MOST) throw new Error(`result over ${RESULT_MOST / 1000} KB`);
    const out = JSON.parse(text) as unknown;
    if (out === null || out === false) return { data: null };
    if (typeof out !== "object" || Array.isArray(out))
      throw new Error("return an object of fields, or null to skip");
    return { data: out as Record<string, unknown> };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

/** The Code node's step, by its node id, for the spine and dry tests. */
export const CODE_STEPS: Record<string, Step> = {
  "logic.code": (_port, e, at) => codeStep(String(at.with.code ?? ""), e),
};

/** The Code node's step: fields merged into `data` and out by `out`, else `skip` unchanged. */
export async function codeStep(code: string, e: SpineEvent, now = new Date()) {
  const r = await runCode(code, e, now);
  return r.data
    ? [{ port: "out", event: { ...e, data: { ...e.data, ...r.data } } }]
    : [{ port: "skip", event: e }];
}
