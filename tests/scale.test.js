// v0.1.93 P2 지표 기준값(normOf): 기본은 지표마다 자기 맨몸 값(최소 METRIC_FLOOR) 그대로.
// 실험 설정(setNormMode)은 tools 에서만 쓰고, 끝나면 기본으로 돌린다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));
const ally = { features: ["allysupport"] }, solo = { features: [] };
const m = { combo: 250, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 };

test("기본 기준값: 지표마다 자기 맨몸 값, 작으면 바닥값", () => {
  const n = S.normOf(m, ally);
  assert.deepEqual(n, { combo: 300, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 });
  assert.equal(S.normOf({ ...m, support: 90 }, solo).support, 600);
});

test("sharedAlly 실험: 아군을 돕는 챔피언만 한타 피해·지원을 같은 분모(맨몸 합)로", (t) => {
  t.after(() => S.setNormMode("own"));
  S.setNormMode("sharedAlly");
  const a = S.normOf(m, ally), b = S.normOf(m, solo);
  assert.equal(a.combo, 1250);
  assert.equal(a.support, 1250);
  assert.equal(a.ehp, 3000, "다른 지표는 그대로");
  assert.equal(b.combo, 300, "아군 지원이 아닌 챔피언은 그대로");
  assert.equal(b.support, 1000);
});
