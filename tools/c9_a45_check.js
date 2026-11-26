// v0.1.95 Phase 4 C9-A4·A5 검증: 칠흑의 양날 도끼·악의·부식의 저항 감소가 제대로 계산되는지.
//   node tools/c9_a45_check.js
// 보는 것: ① 전 챔피언 범위·NaN·상한 ② 피해 유형별(물리·마법·혼합) ③ 상대 저항이 낮을 때·높을 때
//          ④ 감소 + 관통을 같이 썼을 때 유효 저항이 음수가 되는가 ⑤ 복수 조합 ⑥ 공격 속도·스킬 가속 민감도
//          ⑦ 악의의 한타 가동률과 장기 가동률
// 추천 순위가 오르는지를 보는 도구가 아니다 — 값이 규칙대로 나오는지만 본다.
const path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
global.Stats = St;
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const item = (n) => d.items.find((i) => i.name === n);
const aug = (id) => d.augments.find((a) => a.id === id);
const CLEAVER = "칠흑의 양날 도끼", MALIGN = "악의", ERO = "ARAM_Erosion";
const r3 = (x) => Math.round(x * 1000) / 1000;
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

function run(c, items = [], augIds = []) {
  const as = augIds.length ? S.augStatsOf(augIds.map(aug).filter(Boolean), d.rules, c) : [];
  const picked = items.map(item).filter(Boolean);
  return { cs: St.computeStats(c, 18, picked, as, OPTS), m: St.evaluate(c, 18, picked, as, OPTS).m };
}

console.log("=== 1. 전 챔피언 173명 — 값 범위와 상한 (18레벨)");
for (const [label, items, augs, key, cap] of [
  ["칠흑", [CLEAVER], [], "armorShred", 0.3], ["악의", [MALIGN], [], "mrFlatShred", 10],
  ["부식", [], [ERO], "armorShred", 0.3], ["부식(마법)", [], [ERO], "mrShred", 0.3]]) {
  const vals = [], bad = [];
  for (const c of d.champions) {
    const { m } = run(c, items, augs);
    const v = m.shred[key];
    if (!Number.isFinite(v) || v < 0 || v > cap + 1e-12 || !Number.isFinite(m.combo) || !Number.isFinite(m.dps)) bad.push(c.name);
    vals.push(v);
  }
  const sorted = [...vals].sort((a, b) => a - b);
  console.log(`  ${label} ${key}: 가장 낮음 ${r3(sorted[0])} · 중앙값 ${r3(med(vals))} · 가장 높음 ${r3(sorted[sorted.length - 1])}`
    + ` · 상한 ${cap} 넘거나 NaN ${bad.length}명 ${bad.slice(0, 3).join(",")}`);
}

console.log("\n=== 2. 피해 유형별 (라이엇 주 피해 유형) — 칠흑 방어력 감소 중앙값");
{
  const by = { physical: [], magic: [], mixed: [] };
  for (const c of d.champions) {
    const t = c.damageType || "mixed";
    if (by[t]) by[t].push(run(c, [CLEAVER]).m.shred.armorShred);
  }
  for (const [k, v] of Object.entries(by)) console.log(`  ${k} ${v.length}명: 중앙값 ${r3(med(v))}`);
  console.log("  ※ 기본 공격이 물리라 마법 챔피언도 쌓인다 — 물리 스킬이 있는 쪽이 더 쌓이는지를 본다");
}

console.log("\n=== 3. 상대 저항이 낮을 때·높을 때 (기준 상대만 바꾼다)");
{
  const lux = d.champions.find((c) => c.id === "Lux"), garen = d.champions.find((c) => c.id === "Garen");
  const base = { ...St.TARGET };
  for (const [label, t] of [["낮음 (방어력 40 · 마저 30)", { ARMOR: 40, MR: 30, HP: base.HP }],
    ["기본", null], ["높음 (방어력 250 · 마저 200)", { ARMOR: 250, MR: 200, HP: base.HP }]]) {
    St.setTarget(t);
    // 감소 효과만 떼어 본다: 같은 능력치에서 '깎은 저항'과 '안 깎은 저항'의 피해 배율을 견준다
    const g = run(garen, [CLEAVER]), l = run(lux, [MALIGN]);
    const pm0 = St.mitigation(St.TARGET.ARMOR, g.cs.total.ARPEN, g.cs.total.LETHALITY, 0, 0);
    const pm1 = St.mitigation(St.TARGET.ARMOR, g.cs.total.ARPEN, g.cs.total.LETHALITY, g.m.shred.armorShred, g.m.shred.armorFlatShred);
    const mm0 = St.mitigation(St.TARGET.MR, l.cs.total.MPENP, l.cs.total.MPEN, 0, 0);
    const mm1 = St.mitigation(St.TARGET.MR, l.cs.total.MPENP, l.cs.total.MPEN, l.m.shred.mrShred, l.m.shred.mrFlatShred);
    console.log(`  ${label}: 칠흑 물리 피해 배율 ${r3(pm0)} → ${r3(pm1)} (+${r3((pm1 / pm0 - 1) * 100)}%)`
      + ` · 악의 마법 피해 배율 ${r3(mm0)} → ${r3(mm1)} (+${r3((mm1 / mm0 - 1) * 100)}%)`);
  }
  St.setTarget(null);
}

console.log("\n=== 4. 감소 + 관통 — 유효 저항이 음수가 되는가 (0 에서 자른다)");
{
  const pen = ["도미닉 경의 인사", "그림자 검", "공허의 지팡이", "마법사의 신발"];
  let worstA = Infinity, worstM = Infinity, who = "", neg = 0;
  for (const c of d.champions) {
    const { cs, m } = run(c, [CLEAVER, ...pen], [ERO]);
    const t = cs.total, sh = m.shred;
    const a = (St.TARGET.ARMOR - sh.armorFlatShred) * (1 - sh.armorShred) * (1 - (t.ARPEN || 0)) - (t.LETHALITY || 0);
    const mr = (St.TARGET.MR - sh.mrFlatShred) * (1 - sh.mrShred) * (1 - (t.MPENP || 0)) - (t.MPEN || 0);
    if (a < 0 || mr < 0) neg++;
    if (a < worstA) { worstA = a; who = c.name; }
    worstM = Math.min(worstM, mr);
  }
  console.log(`  가장 낮아진 유효 저항: 방어력 ${r3(worstA)} (${who}) · 마법 저항력 ${r3(worstM)} · 음수가 되는 챔피언 ${neg}명`);
  console.log(`  → ${neg ? "0 에서 자르는 기존 제한이 실제로 쓰인다 (후속 항목)" : "음수가 생기지 않는다 (기존 제한이 쓰이지 않는다)"}`);
}

console.log("\n=== 5. 단독·복수 조합 (가렌·룩스 18레벨)");
for (const [id, combos] of [["Garen", [[[CLEAVER], []], [[], [ERO]], [[CLEAVER], [ERO]]]],
  ["Lux", [[["핏빛 저주"], []], [[MALIGN], []], [[], [ERO]], [["핏빛 저주", MALIGN], [ERO]]]]]) {
  const c = d.champions.find((x) => x.id === id);
  for (const [items, augs] of combos) {
    const { m } = run(c, items, augs);
    const lbl = [...items, ...augs.map((a) => (aug(a) || {}).name || a)].join(" + ");
    console.log(`  ${id} ${lbl}: 방어력 감소 ${r3(m.shred.armorShred)} · 마저 감소 ${r3(m.shred.mrShred)}`
      + ` · 고정 마저 감소 ${r3(m.shred.mrFlatShred)} (길게 ${r3(m.shredLong.mrFlatShred)})`
      + ` · 한타 피해 ${Math.round(m.combo)} · 초당 ${Math.round(m.dps)}`);
  }
}

console.log("\n=== 6. 공격 속도·스킬 가속 민감도 (중첩이 빨리 쌓이면 감소량이 커야 한다)");
{
  const ashe = d.champions.find((c) => c.id === "Ashe");
  for (const gear of [[], ["광전사의 군화"], ["광전사의 군화", "구인수의 격노검"], ["광전사의 군화", "구인수의 격노검", "정수 약탈자"]]) {
    const { cs, m } = run(ashe, [CLEAVER, ...gear]);
    console.log(`  애쉬 + ${gear.length}칸: 공격 속도 ${r3(cs.total.AS)} → 칠흑 방어력 감소 ${r3(m.shred.armorShred)}`);
  }
  const lux = d.champions.find((c) => c.id === "Lux");
  for (const gear of [[], ["명석함의 아이오니아 장화"], ["명석함의 아이오니아 장화", "악의"]]) {
    const { cs, m } = run(lux, gear, [ERO]);
    console.log(`  룩스 + ${gear.length}칸: 스킬 가속 ${r3(cs.total.HASTE)} → 부식 감소 ${r3(m.shred.armorShred)}`);
  }
}

console.log("\n=== 7. 악의 — 한타 가동률과 장기 가동률 (궁 대기시간마다 다르다)");
for (const id of ["Lux", "Annie", "Garen", "Ashe", "Nami"]) {
  const c = d.champions.find((x) => x.id === id);
  const { m } = run(c, [MALIGN]);
  const det = m.shred.detail.find((x) => x.on === "ult");
  const rCd = det && det.longUptime > 0 ? 3 / det.longUptime : 0;
  console.log(`  ${c.name}: 궁 대기시간 약 ${r3(rCd)}초 · 가동률 한타 ${r3(det ? det.fightUptime : 0)} · 길게 ${r3(det ? det.longUptime : 0)}`
    + ` → 고정 감소 한타 ${r3(m.shred.mrFlatShred)} · 길게 ${r3(m.shredLong.mrFlatShred)} · 초당 보정 ${r3(m.shredAdj.magic)}`);
}
