// v0.1.95 Phase 4 C9-B0: 기준 아군(stats.js ALLY)이 넣는 피해의 물리·마법·고정 비중.
//   node tools/ally_damage_mix.js
// 왜 필요한가: 저항 감소는 '그 대상을 때리는 모두'에게 득이 된다 (C9-B 아군 몫).
//   방어력 감소는 아군의 '물리' 피해만, 마법 저항력 감소는 '마법' 피해만 키운다.
//   지금 ALLY 모델에는 피해 유형 비중이 없어, 모르고 더하면 마법 저항력 감소(핏빛 저주)가 과대평가된다.
// 어떻게 재는가: 피해는 저항 계수에 대해 1차식이다 (D = 물리몫 × physMit + 마법몫 × magMit + 고정몫).
//   기준 상대의 방어력·마법 저항력을 번갈아 아주 크게 만들어(1e6) 유형별로 갈라낸다.
//   재는 것은 '방어 적용 뒤 실제로 들어가는 피해' 비중이다 (계산에 쓰는 것도 그 값이다).
const path = require("path");
const W = path.join(__dirname, "..", "web");
global.Stats = require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const St = global.Stats;
const BIG = 1e6;
const OPTS = {};  // ally_model.js 와 같은 조건 (칼바람 보정 없이 18레벨 균형 빌드)

function dmgOf(c, build, armor, mr) {
  St.setTarget({ ARMOR: armor, MR: mr, HP: St.DEFAULT_TARGET.HP });
  const m = St.evaluate(c, 18, build, [], OPTS).m;
  const v = m.autoDps + m.skillDps;
  St.setTarget(null);
  return v;
}
function mixOf(c) {
  const build = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item);
  const A = St.DEFAULT_TARGET.ARMOR, M = St.DEFAULT_TARGET.MR;
  const all = dmgOf(c, build, A, M);
  const tr = dmgOf(c, build, BIG, BIG);
  const phys = dmgOf(c, build, A, BIG) - tr;
  const mag = dmgOf(c, build, BIG, M) - tr;
  const sum = phys + mag + tr;
  return { id: c.id, name: c.name, all, phys, mag, tr, sum,
    pPhys: sum > 0 ? phys / sum : 0, pMag: sum > 0 ? mag / sum : 0, pTrue: sum > 0 ? tr / sum : 0,
    gap: all > 0 ? (sum - all) / all : 0 };
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (x) => (x * 100).toFixed(1) + "%";

function run(list, label) {
  const rows = list.map(mixOf);
  const worst = rows.slice().sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  console.log(`\n[${label}] ${rows.length}명`);
  console.log(`  물리 ${pct(med(rows.map((r) => r.pPhys)))} · 마법 ${pct(med(rows.map((r) => r.pMag)))} · 고정 ${pct(med(rows.map((r) => r.pTrue)))} (지표마다 따로 낸 중앙값)`);
  console.log(`  갈라낸 합과 실제 피해의 차이: 중앙값 ${pct(med(rows.map((r) => Math.abs(r.gap))))} · 가장 큰 ${worst.name} ${pct(worst.gap)} (1차식이 아닌 효과가 있으면 커진다)`);
  const srt = rows.slice().sort((a, b) => b.pMag - a.pMag);
  console.log(`  마법 비중 높은 쪽: ${srt.slice(0, 3).map((r) => `${r.name} ${pct(r.pMag)}`).join(" · ")}`);
  console.log(`  마법 비중 낮은 쪽: ${srt.slice(-3).map((r) => `${r.name} ${pct(r.pMag)}`).join(" · ")}`);
  return rows;
}
const marks = d.champions.filter((x) => x.tags[0] === "Marksman" && !x.melee);
console.log("=== C9-B0 기준 아군의 피해 유형 비중 (18레벨 균형 빌드, 증강 없음)");
const a = run(marks, "기준 아군 = 원거리 딜러");
run(d.champions.filter((x) => x.tags[0] === "Mage"), "참고: 메이지 아군");
run(d.champions, "참고: 전 챔피언");
console.log(`\n기준 아군 피해 ${St.ALLY.autoDps + St.ALLY.skillDps} (ALLY.autoDps ${St.ALLY.autoDps} + skillDps ${St.ALLY.skillDps})`);
console.log(`  → 물리 ${pct(med(a.map((r) => r.pPhys)))} · 마법 ${pct(med(a.map((r) => r.pMag)))} · 고정 ${pct(med(a.map((r) => r.pTrue)))}`);
