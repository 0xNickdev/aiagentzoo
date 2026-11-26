import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreOf } from "../src/chain/check.ts";

test("caution scores compress smoothly into 25..59: rising with weight, never into avoid's band, never stuck at the cap", () => {
  const seen: number[] = [];
  for (let raw = 0; raw <= 400; raw += 5) {
    const s = scoreOf("caution", [raw])!;
    assert.ok(s >= 25 && s <= 59, `raw ${raw} gave ${s}`);
    if (seen.length) assert.ok(s >= seen.at(-1)!, "never lower for more weight");
    seen.push(s);
  }
  // Typical cautions (one to four reasons, 10..60) spread over the band instead of piling at 59.
  const typical = [10, 20, 30, 45, 60].map((w) => scoreOf("caution", [w])!);
  assert.equal(new Set(typical).size, typical.length);
  assert.ok(typical.at(-1)! < 59, `60 of weight gave ${typical.at(-1)}`);
  assert.ok(scoreOf("avoid", [0])! >= 60);
  assert.ok(scoreOf("pass", [])! <= 24);
});
