// v0.1.93 P2 지표 기준값(normOf). 엔진·화면 이유·점검 도구가 모두 이 함수를 쓴다.
// 기본 sharedAlly: 아군을 돕는 챔피언(allysupport)만 한타 피해·지원을 같은 분모(맨몸 합)로. own 은 v0.1.92까지(기준선 A).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));
const ally = { features: ["allysupport"] }, solo = { features: [] };
const m = { combo: 250, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 };

test("기본(sharedAlly): 아군을 돕는 챔피언만 한타 피해·지원 분모가 맨몸 합", () => {
  const a = S.normOf(m, ally), b = S.normOf(m, solo);
  assert.equal(a.combo, 1250);
  assert.equal(a.support, 1250);
  assert.equal(a.ehp, 3000, "다른 지표는 그대로");
  assert.equal(b.combo, 300, "아군 지원이 아닌 챔피언은 자기 맨몸 값(최소 바닥값)");
  assert.equal(b.support, 1000);
  assert.equal(S.normOf({ ...m, support: 90 }, solo).support, 600);
  assert.equal(S.normOf({ combo: 100, support: 50 }, ally).combo, 300, "합이 작으면 한타 피해 바닥값");
});

test("own(기준선 A): 지표마다 자기 맨몸 값, 작으면 바닥값", (t) => {
  t.after(() => S.setNormMode());
  S.setNormMode("own");
  assert.deepEqual(S.normOf(m, ally), { combo: 300, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 });
});

test("화면 이유 문장(지표 증가율)도 같은 기준값: 잔나 균형 빌드 첫 아이템", () => {
  const d = require(path.join(WEB, "data.json"));
  const c = d.champions.find((x) => x.id === "Janna");
  const pick = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, ["balanced"])[0].pick;
  const p = pick.find((x) => x.gain && x.gain.support > 0);
  assert.ok(p, "지원을 늘리는 아이템이 있어야 해요");
  const e0 = Stats.evaluate(c, 18, [], [], {}).m;
  assert.ok(S.normOf(e0, c).combo === S.normOf(e0, c).support);
});

// 후속 회귀 대상 (P2로 안 풀림, docs/v0.1.93_P2_적용.md): 럭스·소나 몰빵에 증강과 무관한 불타는 향로가 들어가 증강 몫이 균형보다 줄어든다.
// 원인 후보: 아군 강화를 지속시간 전부로 세는 P1 가정 2, allysupport → HEALSHIELD 1.0 태그 가중치 (P3).
// 근거 없는 가중치·발동률로 숨기지 않는다. 고쳐지면 todo 를 떼서 일반 테스트로 바꾼다.
for (const [id, augName] of [["Lux", "징수의 총 업그레이드"], ["Sona", "묵직한 한 방"]]) {
  test(`${id} + ${augName}: 몰빵에 불타는 향로가 없다`, { todo: "P1 가정 2·P3 에서 다룸" }, () => {
    const d = require(path.join(WEB, "data.json"));
    const c = d.champions.find((x) => x.id === id), a = d.augments.find((x) => x.name === augName);
    const pick = S.buildConcepts(d.items, S.profile(c, d.tags), [a], [], d.rules, c, {}, ["augment"])[0].pick.map((p) => p.item.name);
    assert.ok(!pick.includes("불타는 향로"), pick.join(", "));
  });
}
