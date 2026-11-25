// 실제 게임 기록으로 '상대 회복량(TARGET.HEAL)이 한 판에 몇 번 바뀌나'를 센다 (v0.1.95 Phase 4-0).
// Phase 3 에서 회복량을 캐시 열쇠에 넣었으므로, 값이 바뀔 때마다 빌드 3종을 다시 계산한다.
// 그 재계산이 실제 판에서 몇 번·얼마 간격으로 일어나는지를 기존 로그로 확인한다 (새 플레이 없이).
//   node tools/heal_churn.js [로그폴더]   기본: data/logs/games
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
global.Stats = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
const St = global.Stats;
const byName = new Map(d.items.map((i) => [i.name, i]));
const champOf = (v) => (typeof v === "string" ? d.champions.find((c) => c.id === v || c.name === v) : v);
const SLOTS = S.SLOTS, TARGET_STEP = 0.05;  // = web/app.js

// web/app.js avgSlotBonus() 와 같은 계산 (안 산 칸은 평균 빌드만큼 산다고 본다)
let slotBonus = null;
function avgSlotBonus() {
  if (slotBonus) return slotBonus;
  const sum = { ARMOR: 0, MR: 0, HP: 0 };
  for (const c of d.champions) {
    const t = St.computeStats(c, 18, [], [], { aram: true }).total;
    for (const k of Object.keys(sum)) sum[k] += t[k] / d.champions.length;
  }
  const D = St.DEFAULT_TARGET;
  slotBonus = Object.fromEntries(Object.keys(sum).map((k) => [k, Math.max(0, (D[k] - sum[k]) / SLOTS)]));
  slotBonus.bonusHP = slotBonus.HP;  // 아이템이 올리는 체력은 전부 추가 체력 (web/app.js 와 같게)
  return slotBonus;
}
const augStats = (e) => ((e.augments || []).length ? S.augStatsOf(e.augments, d.rules, champOf(e.champ)) : []);
// web/app.js enemyTarget() 과 같은 계산
function enemyTarget(builds) {
  const b = builds || [];
  if (!b.length) return null;
  const sb = avgSlotBonus();
  const sum = { ARMOR: 0, MR: 0, HP: 0, bonusHP: 0 };
  let heal = 0;
  for (const e of b) {
    const items = (e.items || []).map((n) => byName.get(n)).filter(Boolean);
    const t = St.computeStats(champOf(e.champ), 18, items, augStats(e), { aram: true }).total;
    const empty = Math.max(0, SLOTS - items.length);
    for (const k of Object.keys(sum)) sum[k] += ((k === "bonusHP" ? t.bonusHP : t[k]) + empty * sb[k]) / b.length;
    const m = St.evaluate(champOf(e.champ), 18, items, augStats(e), { aram: true }).m;
    // v0.1.95 Phase 4 C1 뒤의 회복량: 아이템 보호막(itemSelfShield)은 빼고 센다
    heal += ((m.selfHeal || 0) + (m.vampHeal || 0) + (m.itemSelfHeal || 0)) / b.length;
  }
  const r5 = (v) => Math.round(v / 5) * 5;
  return { ARMOR: r5(sum.ARMOR), MR: r5(sum.MR), HP: Math.round(sum.HP / 50) * 50,
    bonusHP: Math.round(sum.bonusHP / 50) * 50, HEAL: Math.round(heal / 10) * 10 };
}

const root = process.argv[2] || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json")));
const all = [];
for (const g of games) {
  const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
  const start = ev.find((x) => x.kind === "start") || {};
  const enemies = ev.filter((x) => x.kind === "enemy" && (x.builds || []).length);
  // app.js 와 같은 순서: enemy 이벤트마다 enemyTarget() 을 내고 applyEnemyTarget() 의 판정을 따라 한다
  let T = { ARMOR: St.DEFAULT_TARGET.ARMOR, MR: St.DEFAULT_TARGET.MR, HP: St.DEFAULT_TARGET.HP, bonusHP: St.DEFAULT_TARGET.BONUS_HP, HEAL: 0 }, fromEnemy = false;
  const healChanges = [], anyChanges = [];
  let lastHealT = null;
  for (const x of enemies) {
    const next = enemyTarget(x.builds);
    // v0.1.95 Phase 4 C2: 추가 체력도 같은 5% 밴드 안에 둔다 (web/app.js applyEnemyTarget 과 같게)
    const small = next && fromEnemy && next.HEAL === T.HEAL
      && Math.abs(next.bonusHP - T.bonusHP) < Math.abs(T.HP) * TARGET_STEP
      && ["ARMOR", "MR", "HP"].every((k) => Math.abs(next[k] - T[k]) < Math.abs(T[k]) * TARGET_STEP);
    if (!small) {
      const healMoved = next.HEAL !== T.HEAL;
      const otherMoved = ["ARMOR", "MR", "HP", "bonusHP"].some((k) => next[k] !== T[k]);
      const moved = healMoved || otherMoved;
      if (moved) anyChanges.push({ t: x.t, heal: healMoved, other: otherMoved });
      if (healMoved) {
        healChanges.push({ t: x.t, from: T.HEAL, to: next.HEAL, gap: lastHealT == null ? null : Math.round((x.t - lastHealT) * 10) / 10 });
        lastHealT = x.t;
      }
      T = next; fromEnemy = true;
    }
  }
  const dur = (ev[ev.length - 1] || {}).t || 0;
  const gaps = healChanges.map((c) => c.gap).filter((v) => v != null);
  const steps = healChanges.map((c) => Math.abs(c.to - c.from));
  all.push({
    game: g, champ: start.champion, 길이분: Math.round(dur / 6) / 10, enemy이벤트: enemies.length,
    기준바뀜: anyChanges.length, 회복량바뀜: healChanges.length,
    회복량만바뀜: anyChanges.filter((c) => c.heal && !c.other).length,  // Phase 3 으로 새로 생기는 재계산 (전에는 옛 캐시를 썼다)
    둘다바뀜: anyChanges.filter((c) => c.heal && c.other).length,
    최종HEAL: T.HEAL,
    간격초: gaps.length ? { 최소: Math.min(...gaps), 중앙: gaps.slice().sort((a, b) => a - b)[gaps.length >> 1], 최대: Math.max(...gaps) } : null,
    변화폭: steps.length ? { 최소: Math.min(...steps), 최대: Math.max(...steps) } : null,
    연속30초내: gaps.filter((v) => v <= 30).length,
    회복량만_시각: anyChanges.filter((c) => c.heal && !c.other).map((c) => Math.round(c.t)),
    changes: healChanges,
  });
}
const sum = (k) => all.reduce((a, r) => a + r[k], 0);
console.log(JSON.stringify({
  게임수: all.length, 총_enemy이벤트: sum("enemy이벤트"), 총_기준바뀜: sum("기준바뀜"), 총_회복량바뀜: sum("회복량바뀜"),
  판당_회복량바뀜_평균: Math.round(sum("회복량바뀜") / all.length * 10) / 10,
  games: all,
}, null, 1));
