// 추천 성질 검사 (증강 중심 원칙, 2026-11-12): 특정 아이템 조합을 정답으로 두지 않고
// "고른 증강의 효과를 그 빌드가 실제로 살리는가"와 빌드 종류·등급 규칙을 본다. 계산식 자체는 tests/calc.test.js.
//   활용도 = 그 빌드에서 고른 증강들이 보태는 가치 합 (scoring.augContribution). 전 챔피언 점검은 tools/augment_regress.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const St = global.Stats;
const S = require(path.join(WEB, "scoring.js"));
const d = require(path.join(WEB, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (name) => d.items.find((i) => i.name === name);
const byName = (name) => d.augments.find((a) => a.name === name);

const builds = (cid, augNames, keys = ["augment", "balanced"]) => {
  const c = champ(cid), w = S.profile(c, d.tags), augs = augNames.map(byName);
  const out = Object.fromEntries(S.buildConcepts(d.items, w, augs, [], d.rules, c, {}, keys).map((b) => [b.key, b.pick.map((p) => p.item)]));
  out.base = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
  const util = (items) => augs.reduce((t, a, i) => t + S.augContribution(items, w, augs.filter((_, j) => j !== i), a, d.rules, c), 0);
  out.u = Object.fromEntries(Object.keys(out).map((k) => [k, util(out[k])]));
  out.legend = (k) => out[k].filter((i) => i.kind === "legendary").map((i) => i.name);
  return out;
};

// 역할이 다른 증강·같은 성향 증강·연계 증강 3개를 섞은 대표 장면
const SCENES = [
  ["Garen", ["작은 도움", "검무", "마도사의 주스 상자"]],
  ["MonkeyKing", ["핏빛 코발트", "원 히트 원더", "되풀이"]],
  ["Sion", ["강타자"]],
  ["Kaisa", ["사악한 정신"]],
  ["Kayle", ["광신자"]],
  ["Viktor", ["궁극의 히드라"]],
];

test("추천 1: 균형 빌드는 증강 없이 짠 기본 빌드보다 고른 증강을 덜 살리지 않는다", () => {
  for (const [cid, names] of SCENES) {
    const b = builds(cid, names);
    assert.ok(b.u.balanced >= b.u.base - 1e-6, `${cid} [${names}] 균형 ${b.u.balanced} < 기본 ${b.u.base}`);
  }
});

test("추천 2: 증강 몰빵 빌드는 균형 빌드만큼은 증강을 살린다 (계산 오차 3% 안)", () => {
  for (const [cid, names] of SCENES) {
    const b = builds(cid, names);
    assert.ok(b.u.augment >= b.u.balanced * 0.97 - 1e-6, `${cid} [${names}] 몰빵 ${b.u.augment} < 균형 ${b.u.balanced}`);
  }
});

test("추천 3: 역할과 다른 퀘스트는 D 로 막지 않고 '변칙 퀘스트' 안내만, 몰빵 빌드는 퀘스트 아이템을 모두 넣는다", () => {
  const hyd = ["굶주린 히드라", "불경한 히드라", "거대한 히드라"];
  const vik = champ("Viktor"), w = S.profile(vik, d.tags), q = byName("궁극의 히드라");
  const r = S.rankAugments([q], w, [], [], vik, d.rules, d.items)[0];
  assert.equal(r.req, null, "발동 조건(req)으로 막지 않는다");
  assert.equal(r.hint && r.hint.kind, "offTypeQuest");
  const t = S.augmentTiers(d.augments, d.items, w, [], [], d.rules, vik, {}, "total")[q.id];
  assert.ok(!t.reasons.includes("조건 없음"), JSON.stringify(t));
  assert.equal(builds("Viktor", ["궁극의 히드라"]).legend("augment").filter((n) => hyd.includes(n)).length, 3);
  // 평소 유형과 맞으면 안내도 없다
  const dar = champ("Darius");
  const rd = S.rankAugments([q], S.profile(dar, d.tags), [], [], dar, d.rules, d.items)[0];
  assert.ok(!rd.hint && !rd.req);
});

test("추천 4: 균형 빌드의 칸 제한은 코어 밖 '반대 유형' 아이템에만 (같은 유형의 증강용 아이템은 제한 없음)", () => {
  // 메이지 + 궁극의 히드라: 반대 유형(AD) 아이템은 offSlots 칸까지만
  const ad = (n) => { const t = item(n).tags || {}; return (t.AD || 0) >= 0.5 && !((t.AP || 0) >= 0.5); };
  const v = builds("Viktor", ["궁극의 히드라"]);
  const core = v.legend("base");
  assert.ok(v.legend("balanced").filter((n) => !core.includes(n) && ad(n)).length <= S.offSlots(champ("Viktor")), `${v.legend("balanced")}`);
  // 오공 + 원 히트 원더(가속 → 피해): 같은 유형(AD) 가속 아이템은 칸 수에 안 세서 균형도 증강을 몰빵만큼 살린다
  const m = builds("MonkeyKing", ["핏빛 코발트", "원 히트 원더", "되풀이"]);
  assert.ok(m.u.balanced >= m.u.augment * 0.9, `균형 ${m.u.balanced} vs 몰빵 ${m.u.augment}`);
});

test("추천 5: 혼합형(원딜 + 메이지 또는 피해 유형 혼합)은 반대 유형 칸을 하나 더", () => {
  assert.equal(S.offSlots(champ("Kayle")), 3);
  assert.equal(S.offSlots(champ("Kaisa")), 3);
  assert.equal(S.offSlots(champ("Garen")), 2);
  assert.equal(S.offSlots(champ("Viktor")), 2);
});

test("추천 6: 적중 시 아이템(구인수)의 이득은 평타로 싸우는 챔피언이 스킬로 싸우는 챔피언보다 크다", () => {
  const gain = (cid) => {
    const c = champ(cid);
    const m0 = St.evaluate(c, 18, [], [], { aram: true }).m, m1 = St.evaluate(c, 18, [item("구인수의 격노검")], [], { aram: true }).m;
    return (m1.dps - m0.dps) / m0.dps;
  };
  assert.ok(gain("Kayle") > gain("Lux"), `케일 ${gain("Kayle")} 럭스 ${gain("Lux")}`);
});
