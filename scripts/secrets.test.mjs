// node --test scripts/secrets.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, setLines } from "./secrets.mjs";

test("set keeps the old line as a dated comment", () => {
  const t = "A=1\nB=2\n";
  assert.equal(setLines(t, ["A==x"], {}, "D"), "# before D: A=1\nA=x\nB=2\n");
  assert.equal(setLines(t, ["B=V"], { V: "y" }, "D"), "A=1\n# before D: B=2\nB=y\n");
  assert.equal(setLines(t, ["-A", "C==z"], {}, "D"), "# before D: A=1\nB=2\nC=z\n");
  assert.throws(() => setLines(t, ["A=NOPE"], {}, "D"));
  assert.equal(setLines(t, ["!A"], {}, "D"), "B=2\n");
});

test("parse drops an inline note after a bare value and keeps a quoted one whole", () => {
  const t = 'A=abc-1 #me@x.example (note)\nB="two words # kept"\nC=plain\nD=x=y\nE=a b, c\nF={"k":"v w"}\n';
  assert.deepEqual(parse(t), {
    A: "abc-1",
    B: "two words # kept",
    C: "plain",
    D: "x=y",
    E: "a b, c",
    F: '{"k":"v w"}',
  });
});

test("set quotes a value with a space or a hash", () => {
  assert.equal(setLines("A=1\n", ["A==two words"], {}, "D"), '# before D: A=1\nA="two words"\n');
  assert.deepEqual(parse(setLines("", ["A==k #note"], {}, "D")), { A: "k #note" });
});
