// 기준 아군(stats.js ALLY)의 근거: 원거리 딜러(첫 역할 Marksman, 원거리)의 18레벨 균형 빌드(증강 없음) 지표 중앙값 (v0.1.93 P1).
//   node tools/ally_model.js   → 평타 초당 피해·스킬 초당 피해·공격 속도·공속 계수·공격력·스킬 가속 중앙값 (패치 후 다시 돌려서 stats.js 에 반영)
// 아군 강화(공격 속도·공격력·적중 시 피해·스킬 가속)를 '아군이 더 넣는 피해'로 바꿀 때 쓴다. 기준 상대(tools/target_median.js)와 같은 방식.
// 지표마다 따로 중앙값을 낸다 (한 챔피언을 고르지 않는다).
const path = require("path");
const W = path.join(__dirname, "..", "web");
global.Stats = require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);

function measure() {
  const rows = [];
  for (const c of d.champions.filter((x) => x.tags[0] === "Marksman" && !x.melee)) {
    const b = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
    const e = Stats.evaluate(c, 18, b, [], {});
    const t = e.stats.total;
    rows.push({ id: c.id, autoDps: e.m.autoDps, skillDps: e.m.skillDps, AS: t.AS, asRatio: c.asRatio, AD: t.AD, HASTE: t.HASTE });
  }
  const med = (k) => { const a = rows.map((r) => r[k]).sort((x, y) => x - y); return a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
  const out = {};
  for (const k of ["autoDps", "skillDps", "AS", "asRatio", "AD", "HASTE"]) out[k] = +med(k).toFixed(3);
  return { n: rows.length, median: out, now: Stats.ALLY };
}

if (require.main === module) {
  const r = measure();
  console.log(`원거리 딜러 ${r.n}명 18레벨 균형 빌드 중앙값`, r.median);
  console.log("stats.js ALLY 지금 값", r.now);
}
module.exports = { measure };
