// v0.1.95 Phase 4 C2 뒤 점검: '추가 체력 완충 밴드를 최대 체력 기준으로 바꾼 뒤
// 최대 체력이 높은 상대에서 추가 체력만 크게 바뀐 갱신이 빠질 수 있나'를 센다.
// 성능을 더 깎으려는 게 아니라 지금 갱신 조건이 맞는지만 본다 (새 플레이 없이 기존 기록만 쓴다).
//   node tools/band_check.js [로그폴더]
// 보는 것: ① 실제 기록에서 '빠진 갱신' 횟수와 그때 추천이 달라지는지
//          ② 밴드가 삼킬 수 있는 최대 추가 체력 차이와 그 차이가 거인 학살 점수를 얼마나 움직이는지
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
global.Stats = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
const St = global.Stats;
S.attachSimilar(d.champions, null, d.items);
const byName = new Map(d.items.map((i) => [i.name, i]));
const champOf = (v) => (typeof v === "string" ? d.champions.find((c) => c.id === v || c.name === v) : v);
const SLOTS = S.SLOTS, TARGET_STEP = 0.05;  // = web/app.js
const OPTS = { aram: true };
const RI = d.rules.items || {};
const withKey = (k) => Object.keys(RI).filter((n) => ((RI[n].stats || {})[k] != null)).map((n) => byName.get(n)).filter(Boolean);
const BONUSHP = withKey("tgtBonusHpAmp");  // 거인 학살: TARGET.BONUS_HP 를 쓰는 아이템
const AMP_AT = Math.max(...BONUSHP.map((i) => (RI[i.name].stats || {}).tgtBonusHpAt || 1500));

let slotBonus = null;
function avgSlotBonus() {
  if (slotBonus) return slotBonus;
  const sum = { ARMOR: 0, MR: 0, HP: 0 };
  for (const c of d.champions) {
    const t = St.computeStats(c, 18, [], [], OPTS).total;
    for (const k of Object.keys(sum)) sum[k] += t[k] / d.champions.length;
  }
  const D = St.DEFAULT_TARGET;
  slotBonus = Object.fromEntries(Object.keys(sum).map((k) => [k, Math.max(0, (D[k] - sum[k]) / SLOTS)]));
  slotBonus.bonusHP = slotBonus.HP;
  return slotBonus;
}
const augStats = (e) => ((e.augments || []).length ? S.augStatsOf(e.augments, d.rules, champOf(e.champ)) : []);
const itemsOf = (list) => (list || []).map((n) => (typeof n === "string" ? byName.get(n) : n)).filter(Boolean);
function enemyTarget(builds) {  // = web/app.js enemyTarget()
  const b = builds || [];
  if (!b.length) return null;
  const sb = avgSlotBonus();
  const sum = { ARMOR: 0, MR: 0, HP: 0, bonusHP: 0 };
  let heal = 0;
  for (const e of b) {
    const items = itemsOf(e.items), c = champOf(e.champ), as = augStats(e);
    if (!c) continue;
    const t = St.computeStats(c, 18, items, as, OPTS).total;
    const empty = Math.max(0, SLOTS - items.length);
    for (const k of Object.keys(sum)) sum[k] += ((k === "bonusHP" ? t.bonusHP : t[k]) + empty * sb[k]) / b.length;
    const m = St.evaluate(c, 18, items, as, OPTS).m;
    heal += ((m.selfHeal || 0) + (m.vampHeal || 0) + (m.itemSelfHeal || 0)) / b.length;
  }
  const r5 = (v) => Math.round(v / 5) * 5, r50 = (v) => Math.round(v / 50) * 50;
  return { ARMOR: r5(sum.ARMOR), MR: r5(sum.MR), HP: r50(sum.HP), bonusHP: r50(sum.bonusHP), HEAL: Math.round(heal / 10) * 10 };
}

const ids = (list) => list.map((r) => (r.item ? r.item.id : r.id));
function sceneOf(champ, myItems, target) {
  const weights = S.profile(champ, d.tags);
  St.setTarget(target);
  const rank = S.rankItems(d.items, weights, [], myItems, d.rules, champ, OPTS, "balanced");
  const legend = rank.filter((r) => r.item.kind === "legendary");
  const build = S.buildConcepts(d.items, weights, [], myItems, d.rules, champ, OPTS, ["balanced"])[0];
  const have = new Set(myItems.map((i) => i.id));
  const score = Object.fromEntries(BONUSHP.map((it) => {
    const r = legend.find((x) => x.item.id === it.id);
    return [it.name, r ? r.score : null];
  }));
  return { top1: ids(legend.slice(0, 1))[0], top3: ids(legend.slice(0, 3)), top6: ids(legend.slice(0, 6)),
    nextBuy: legend.filter((r) => !have.has(r.item.id)).slice(0, 3).map((r) => r.item.id),
    build: build ? build.pick.map((p) => p.item.id) : [], score };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setSame = (a, b) => same([...a].sort(), [...b].sort());

// ---- ① 실제 게임 기록: 갱신이 빠진 자리마다 '그 자리에서 다시 쟀다면' 과 비교
const root = process.argv[2] || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
let events = 0, skipped = 0, skippedBonus = 0, worstGap = 0, changedScenes = 0, scenesChecked = 0;
const rows = [];
for (const g of games) {
  const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
  const start = ev.find((x) => x.kind === "start") || {};
  const champ = champOf(start.champion);
  const enemies = ev.filter((x) => x.kind === "enemy" && (x.builds || []).length);
  if (!champ || !enemies.length) continue;
  const D = St.DEFAULT_TARGET;
  let T = { ARMOR: D.ARMOR, MR: D.MR, HP: D.HP, bonusHP: D.BONUS_HP, HEAL: 0 }, fromEnemy = false;
  for (const x of enemies) {
    events++;
    const next = enemyTarget(x.builds);
    const small = next && fromEnemy && next.HEAL === T.HEAL
      && Math.abs(next.bonusHP - T.bonusHP) < Math.abs(T.HP) * TARGET_STEP
      && ["ARMOR", "MR", "HP"].every((k) => Math.abs(next[k] - T[k]) < Math.abs(T[k]) * TARGET_STEP);
    if (small) {
      skipped++;
      const gap = Math.abs(next.bonusHP - T.bonusHP);
      if (gap > 0) {
        skippedBonus++;
        worstGap = Math.max(worstGap, gap);
        // 빠진 그 자리에서 '묵은 기준' 과 '새 기준' 의 추천을 비교한다
        const myItems = itemsOf(x.items);
        const a = sceneOf(champ, myItems, T), b = sceneOf(champ, myItems, next);
        scenesChecked++;
        const diff = { top1: a.top1 !== b.top1, top3: !setSame(a.top3, b.top3), top6: !same(a.top6, b.top6),
          다음구매: !same(a.nextBuy, b.nextBuy), 빌드: !setSame(a.build, b.build) };
        const sgap = Math.max(...Object.keys(a.score).map((n) => Math.abs((a.score[n] || 0) - (b.score[n] || 0))));
        if (Object.values(diff).some(Boolean)) changedScenes++;
        rows.push({ game: g, t: Math.round(x.t), 묵은추가체력: T.bonusHP, 새추가체력: next.bonusHP, 차이: gap,
          최대체력: T.HP, 밴드: Math.round(Math.abs(T.HP) * TARGET_STEP), 점수차이: Math.round(sgap * 1000) / 1000, ...diff });
      }
    } else { T = next; fromEnemy = true; }
  }
}
console.log("=== ① 실제 기록: 갱신이 빠진 자리");
console.log(`enemy 이벤트 ${events} · 밴드 안이라 넘어감 ${skipped} · 그중 추가 체력이 실제로 달랐던 자리 ${skippedBonus}`);
console.log(`넘어간 자리의 추가 체력 차이 최대 ${worstGap} · 추천이 달라진 자리 ${changedScenes}/${scenesChecked}`);
for (const r of rows) console.log("  ", JSON.stringify(r, null, 0));

// ---- ② 밴드가 삼킬 수 있는 최대 차이와 그 차이가 점수를 얼마나 움직이나
console.log("\n=== ② 밴드가 삼킬 수 있는 최대 차이 (계산)");
console.log(`거인 학살 계열: ${BONUSHP.map((i) => i.name).join(", ")} · 포화 지점 tgtBonusHpAt=${AMP_AT}`);
const probe = champOf("Darius") || d.champions[0];
for (const hp of [2500, 3148, 3500, 4000, 4500, 5000]) {
  const band = Math.round(hp * TARGET_STEP);
  // 밴드는 '차이 < 밴드' 이므로 삼킬 수 있는 최대 차이는 밴드 바로 아래의 50 배수
  const swallow = Math.max(0, Math.ceil(band / 50) * 50 - 50);
  const lo = { ARMOR: 113, MR: 63, HP: hp, bonusHP: 1000, HEAL: 0 };
  const hi = { ...lo, bonusHP: 1000 + swallow };
  const a = sceneOf(probe, [], lo), b = sceneOf(probe, [], hi);
  const sgap = Math.max(...Object.keys(a.score).map((n) => Math.abs((a.score[n] || 0) - (b.score[n] || 0))));
  const ampGap = Math.min(1, hi.bonusHP / AMP_AT) - Math.min(1, lo.bonusHP / AMP_AT);
  console.log(`  최대 체력 ${hp} → 밴드 ${band} · 삼킬 수 있는 최대 추가 체력 차이 ${swallow}`
    + ` · 증폭 몫 차이 ${(ampGap * 100).toFixed(1)}% · 거인 학살 점수 차이 ${(sgap).toFixed(4)}`
    + ` · 1순위 ${a.top1 === b.top1 ? "같음" : "달라짐"} · Top3 ${setSame(a.top3, b.top3) ? "같음" : "달라짐"}`);
}
console.log("\n※ 추가 체력은 최대 체력의 일부라, 최대 체력이 밴드 안에 있으면 추가 체력이 그보다 크게 움직이기 어렵다 (①에서 확인).");

// ---- ③ 갱신 기준을 바꿔 보면 재계산 횟수와 '빠진 갱신' 이 어떻게 달라지나 (고르기 위한 비교, 바꾸지는 않는다)
console.log("\n=== ③ 추가 체력 갱신 기준 비교 (재계산 횟수 ↔ 추천이 달라진 자리)");
const POLICIES = [
  ["지금: 최대 체력의 5%", (T) => Math.abs(T.HP) * TARGET_STEP],
  ["고정 200", () => 200],
  ["고정 100", () => 100],
  ["차이가 있으면 항상", () => 1],
  ["Phase 3 이전: 추가 체력을 안 봄", () => Infinity],
];
for (const [label, bandOf] of POLICIES) {
  let recalc = 0, missed = 0, missedChanged = 0, worst = 0;
  for (const g of games) {
    const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
    const start = ev.find((x) => x.kind === "start") || {};
    const champ = champOf(start.champion);
    const enemies = ev.filter((x) => x.kind === "enemy" && (x.builds || []).length);
    if (!champ || !enemies.length) continue;
    const D = St.DEFAULT_TARGET;
    let T = { ARMOR: D.ARMOR, MR: D.MR, HP: D.HP, bonusHP: D.BONUS_HP, HEAL: 0 }, fromEnemy = false;
    for (const x of enemies) {
      const next = enemyTarget(x.builds);
      const small = next && fromEnemy && next.HEAL === T.HEAL
        && Math.abs(next.bonusHP - T.bonusHP) < bandOf(T)
        && ["ARMOR", "MR", "HP"].every((k) => Math.abs(next[k] - T[k]) < Math.abs(T[k]) * TARGET_STEP);
      if (small) {
        if (next.bonusHP !== T.bonusHP) {
          missed++;
          worst = Math.max(worst, Math.abs(next.bonusHP - T.bonusHP));
          const myItems = itemsOf(x.items);
          const a = sceneOf(champ, myItems, T), b = sceneOf(champ, myItems, next);
          if (a.top1 !== b.top1 || !setSame(a.top3, b.top3) || !same(a.nextBuy, b.nextBuy) || !setSame(a.build, b.build)) missedChanged++;
        }
      } else { recalc++; T = next; fromEnemy = true; }
    }
  }
  console.log(`  ${label}: 재계산 ${recalc}/${events} · 추가 체력이 달랐는데 넘어간 자리 ${missed} (최대 차이 ${worst}) · 그중 1순위·Top3·다음구매·빌드가 달라지는 자리 ${missedChanged}`);
}
