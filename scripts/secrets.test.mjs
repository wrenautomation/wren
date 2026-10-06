// node --test scripts/secrets.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { setLines } from "./secrets.mjs";

test("set keeps the old line as a dated comment", () => {
  const t = "A=1\nB=2\n";
  assert.equal(setLines(t, ["A==x"], {}, "D"), "# before D: A=1\nA=x\nB=2\n");
  assert.equal(setLines(t, ["B=V"], { V: "y" }, "D"), "A=1\n# before D: B=2\nB=y\n");
  assert.equal(setLines(t, ["-A", "C==z"], {}, "D"), "# before D: A=1\nB=2\nC=z\n");
  assert.throws(() => setLines(t, ["A=NOPE"], {}, "D"));
});
