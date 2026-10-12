// The load shape every scenario shares. A run ramps to the peak and holds it. A stress run
// (STAIRS, set by scripts/loadtest.mjs --stress) climbs a staircase of user counts, STEP_S
// seconds a stair, and stops once a threshold breaks; the harness then names the stair it broke.
const STEP_S = Number(__ENV.STEP_S ?? 30);
const RAMP_S = 5;

export function shape(thresholds) {
  const stairs = (__ENV.STAIRS ?? "").split(",").filter(Boolean).map(Number);
  if (!stairs.length) {
    const peak = Number(__ENV.VUS ?? 100);
    return {
      scenarios: {
        ramp: {
          executor: "ramping-vus",
          stages: [
            { duration: "20s", target: peak },
            { duration: "40s", target: peak },
            { duration: "10s", target: 0 },
          ],
        },
      },
      thresholds,
    };
  }
  return {
    scenarios: {
      stairs: {
        executor: "ramping-vus",
        stages: stairs.flatMap((target) => [
          { duration: `${RAMP_S}s`, target },
          { duration: `${STEP_S - RAMP_S}s`, target },
        ]),
      },
    },
    // Whole-run numbers trail the stair that broke, so stop soon after; the harness reads stairs.
    thresholds: Object.fromEntries(
      Object.entries(thresholds).map(([metric, list]) => [
        metric,
        list.map((threshold) => ({ threshold, abortOnFail: true, delayAbortEval: "10s" })),
      ]),
    ),
  };
}
