import { describe, expect, it } from "vitest";
import { applyCommands } from "./commands.js";
import { TranscriberEars } from "./ears.js";
import { pickAdapter } from "./route.js";
import { startDictation } from "./session.js";
import {
  DICTATION_RATE,
  FakeTranscriber,
  openAiTranscriber,
  pcmFrame,
  resample,
  samplesOf,
  samplesOfWav,
  wavOf,
} from "./transcriber.js";

/** 100 ms of a tone (speech to the ears) or of silence. */
const slice = (loud: boolean) => {
  const n = DICTATION_RATE / 10;
  const s = new Float32Array(n);
  if (loud)
    for (let i = 0; i < n; i++) s[i] = 0.3 * Math.sin((i / DICTATION_RATE) * 2 * Math.PI * 220);
  return pcmFrame(s);
};
const talk = (ms: number) => Array.from({ length: ms / 100 }, () => slice(true));
const hush = (ms: number) => Array.from({ length: ms / 100 }, () => slice(false));
const settle = () => new Promise((ok) => setTimeout(ok, 5));

describe("applyCommands", () => {
  it("turns new line and period into what they say", () => {
    expect(
      applyCommands("Reply to Dana and say the proposal is attached, New Line, talk soon period."),
    ).toBe("Reply to Dana and say the proposal is attached\nTalk soon.");
    expect(applyCommands("Thanks period see you Monday")).toBe("Thanks. See you Monday");
    expect(applyCommands("first line new line second")).toBe("first line\nSecond");
    expect(applyCommands("one newline two")).toBe("one\nTwo");
  });
  it("leaves words that only hold a command alone", () => {
    expect(applyCommands("A periodic check on the newlines")).toBe(
      "A periodic check on the newlines",
    );
  });
  it("keeps one full stop when the model wrote its own", () => {
    expect(applyCommands("Done period.")).toBe("Done.");
    expect(applyCommands("Period. Schedule the post")).toBe(". Schedule the post");
  });
});

describe("pickAdapter", () => {
  const none = { webgpu: false, server: false, speech: false, fallback: false };
  it("prefers the browser, then the server", () => {
    expect(pickAdapter("auto", { ...none, webgpu: true, server: true })).toEqual({
      adapter: "browser",
      why: null,
    });
    expect(pickAdapter("auto", { ...none, server: true })).toEqual({
      adapter: "server",
      why: null,
    });
  });
  it("uses the browser's own speech only when allowed", () => {
    expect(pickAdapter("auto", { ...none, speech: true }).adapter).toBeNull();
    expect(pickAdapter("auto", { ...none, speech: true, fallback: true }).adapter).toBe("speech");
  });
  it("says why when nothing can run", () => {
    expect(pickAdapter("auto", none)).toEqual({
      adapter: null,
      why: "This browser has no WebGPU and no speech server is set up.",
    });
    expect(pickAdapter("server", { ...none, webgpu: true }).why).toBe(
      "No speech server is set up.",
    );
    expect(pickAdapter("off", { ...none, webgpu: true }).why).toMatch(/off/);
  });
  it("moves past a model that failed", () => {
    expect(
      pickAdapter("auto", { ...none, webgpu: true, server: true, failed: ["browser"] }).adapter,
    ).toBe("server");
    expect(pickAdapter("browser", { ...none, webgpu: true, failed: ["browser"] }).why).toMatch(
      /didn't load/,
    );
  });
});

describe("audio helpers", () => {
  it("round-trips samples through a frame and a WAV", () => {
    const s = new Float32Array([0, 0.5, -0.5, 0.25]);
    expect([...samplesOf(pcmFrame(s))].map((x) => x.toFixed(2))).toEqual([
      "0.00",
      "0.50",
      "-0.50",
      "0.25",
    ]);
    const back = samplesOfWav(wavOf(s));
    expect(back?.length).toBe(4);
    expect(samplesOfWav(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("resamples 48 kHz to 16 kHz", () => {
    expect(resample(new Float32Array(4800), 48_000).length).toBe(1600);
  });
});

describe("TranscriberEars", () => {
  it("gives partials while talking and a final per pause, in order", async () => {
    const model = new FakeTranscriber(["Hello there friend", "Second part"]);
    const heard: string[] = [];
    const ear = new TranscriberEars(model).open((h) =>
      heard.push(h.kind === "partial" || h.kind === "final" ? `${h.kind}:${h.text}` : h.kind),
    );
    for (const f of [...hush(500), ...talk(600)]) {
      ear.push(f);
      await settle();
    }
    for (const f of [...hush(800), ...talk(400)]) {
      ear.push(f);
      await settle();
    }
    await ear.finish?.();
    expect(heard[0]).toBe("speech");
    expect(heard).toContain("partial:Hello there");
    const finals = heard.filter((h) => h.startsWith("final:"));
    expect(finals).toEqual(["final:Hello there friend", "final:Second part"]);
    // The first segment kept only 300 ms before the speech, plus 300 ms of padding each side.
    const first = model.runs.find((r) => r.final);
    expect(first?.samples).toBe((300 + 600 + 700 + 600) * 16);
  });
  it("runs the first partial after 150 ms of speech, not on the quiet before it", async () => {
    const model = new FakeTranscriber(["Reply"]);
    const ear = new TranscriberEars(model).open(() => {});
    for (const f of [...hush(500), ...talk(100)]) {
      ear.push(f);
      await settle();
    }
    expect(model.runs).toEqual([]);
    for (const f of talk(100)) ear.push(f);
    await settle();
    expect(model.runs.length).toBe(1);
  });
  it("hears nothing in silence", async () => {
    const model = new FakeTranscriber(["never"]);
    const heard: string[] = [];
    const ear = new TranscriberEars(model).open((h) => heard.push(h.kind));
    for (const f of hush(2000)) ear.push(f);
    await ear.finish?.();
    expect(heard).toEqual([]);
    expect(model.runs).toEqual([]);
  });
  it("cuts a long segment at the cap", async () => {
    const model = new FakeTranscriber(["one", "two"]);
    const finals: string[] = [];
    const ear = new TranscriberEars(model, { maxSegmentMs: 1000 }).open((h) => {
      if (h.kind === "final") finals.push(h.text);
    });
    for (const f of talk(1500)) ear.push(f);
    await ear.finish?.();
    expect(finals).toEqual(["one", "two"]);
  });
  it("reports a failed run and goes on", async () => {
    const errors: unknown[] = [];
    const ear = new TranscriberEars(
      {
        name: "broken",
        model: "x",
        transcribe: async () => {
          throw new Error("no");
        },
      },
      { onError: (e) => errors.push(e) },
    ).open(() => {});
    for (const f of talk(400)) ear.push(f);
    await ear.finish?.();
    expect(errors.length).toBeGreaterThan(0);
  });
  it("drops what's in flight on close", async () => {
    const finals: string[] = [];
    const ear = new TranscriberEars(new FakeTranscriber(["late"], { ms: 20 })).open((h) => {
      if (h.kind === "final") finals.push(h.text);
    });
    for (const f of [...talk(400), ...hush(800)]) ear.push(f);
    ear.close();
    await new Promise((ok) => setTimeout(ok, 40));
    expect(finals).toEqual([]);
  });
});

describe("startDictation", () => {
  it("times the stages and applies commands", async () => {
    let t = 1000;
    const out: string[] = [];
    const s = startDictation({
      ears: new TranscriberEars(new FakeTranscriber(["Thanks period new line Dana"])),
      on: { partial: (p) => out.push(`~${p}`), final: (f) => out.push(f) },
      now: () => t,
    });
    t = 1040;
    for (const f of talk(600)) {
      s.push(f);
      await settle();
    }
    t = 1300;
    s.push(slice(false));
    t = 1500;
    const run = await s.stop();
    expect(out.at(-1)).toBe("Thanks.\nDana");
    expect(out.some((o) => o.startsWith("~"))).toBe(true);
    // First words count from the talking, not the press.
    expect(run).toEqual({ micMs: 40, firstMs: 0, finalMs: 0, words: 2, audioMs: 700 });
  });
  it("has no final time when nothing was said", async () => {
    const s = startDictation({
      ears: new TranscriberEars(new FakeTranscriber([])),
      on: { partial: () => {}, final: () => {} },
    });
    for (const f of hush(300)) s.push(f);
    const run = await s.stop();
    expect(run.finalMs).toBeNull();
    expect(run.words).toBe(0);
  });
});

describe("openAiTranscriber", () => {
  it("posts a WAV with the model and reads the text", async () => {
    let seen: { url: string; auth: string | null; form: FormData } | null = null;
    const model = openAiTranscriber({
      url: "https://speech.example/v1/audio/transcriptions",
      model: "whisper-large-v3-turbo",
      key: "k",
      fetch: (async (url: string, init: RequestInit) => {
        seen = {
          url,
          auth: new Headers(init.headers).get("authorization"),
          form: init.body as FormData,
        };
        return new Response(JSON.stringify({ text: " Hi there. " }));
      }) as unknown as typeof fetch,
    });
    expect(await model.transcribe(new Float32Array(1600), { final: true })).toBe("Hi there.");
    const got = seen as unknown as { url: string; auth: string | null; form: FormData };
    expect(got.url).toBe("https://speech.example/v1/audio/transcriptions");
    expect(got.auth).toBe("Bearer k");
    expect(got.form.get("model")).toBe("whisper-large-v3-turbo");
    expect((got.form.get("file") as Blob).size).toBe(44 + 3200);
  });
  it("says what the server answered when it fails", async () => {
    const model = openAiTranscriber({
      url: "https://speech.example/x",
      model: "m",
      fetch: (async () => new Response("no", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(model.transcribe(new Float32Array(10), { final: true })).rejects.toThrow("429");
  });
});
