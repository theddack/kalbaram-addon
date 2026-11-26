// 평균 상대 모델 vs 개별 상대 평가 (v0.1.95 Phase 4-3 §5.1): 실제 게임 기록의 최종 적 구성으로
//   ① 지금처럼 다섯 명을 평균한 기준 하나로 아이템 순위를 내는 것과
//   ② 다섯 명 각각을 기준으로 순위를 내서 점수를 평균하는 것
// 의 결과 차이(1순위·Top3·Top6)와 계산 비용을 잰다. 계산 결과끼리의 비교예요.
//   node tools/target_mix.js [--champs N]
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
const d = require(path.join(ROOT, "web", "data.json"));
const St = global.Stats;
S.attachSimilar(d.champions, null, d.items);
const byName = new Map(d.items.map((i) => [i.name, i]));
const champOf = (v) => d.champions.find((c) => c.id === v || c.name === v);
const SLOTS = S.SLOTS;

let slotBonus = null;
function avgSlotBonus() {
  if (slotBonus) return slotBonus;
  const sum = { ARMOR: 0, MR: 0, HP: 0 };
  for (const c of d.champions) { const t = St.computeStats(c, 18, [], [], { aram: true }).total; for (const k of Object.keys(sum)) sum[k] += t[k] / d.champions.length; }
  const D = St.DEFAULT_TARGET;
  slotBonus = Object.fromEntries(Object.keys(sum).map((k) => [k, Math.max(0, (D[k] - sum[k]) / SLOTS)]));
  return slotBonus;
}
// 적 한 명의 기준 (18레벨 예상: 산 아이템 + 안 산 칸은 평균 빌드)
function oneTarget(e) {
  const items = (e.items || []).map((n) => byName.get(n)).filter(Boolean);
  const sb = avgSlotBonus(), empty = Math.max(0, SLOTS - items.length);
  const t = St.computeStats(champOf(e.champ), 18, items, [], { aram: true }).total;
  const m = St.evaluate(champOf(e.champ), 18, items, [], { aram: true }).m;
  const r5 = (v) => Math.round(v / 5) * 5;
  // v0.1.95 Phase 4 C6 재측정 (2026-11-26): 지금 web/app.js enemyTarget() 과 같은 계산으로 맞췄다.
  //   C1 아이템 보호막을 회복에서 뺀다 · C2 추가 체력도 돌려준다 · C4 아군에게 주는 회복까지 더한다
  const heal = (m.selfHealAll != null ? m.selfHealAll : 0) + (m.allyHealAll != null ? m.allyHealAll : (m.heal || 0));
  return { ARMOR: r5(t.ARMOR + empty * sb.ARMOR), MR: r5(t.MR + empty * sb.MR), HP: Math.round((t.HP + empty * sb.HP) / 50) * 50,
    bonusHP: Math.round((t.bonusHP + empty * sb.HP) / 50) * 50, HEAL: Math.round(heal / 10) * 10 };
}
const avgTarget = (ts) => ({ ARMOR: Math.round(ts.reduce((a, t) => a + t.ARMOR, 0) / ts.length / 5) * 5,
  MR: Math.round(ts.reduce((a, t) => a + t.MR, 0) / ts.length / 5) * 5,
  HP: Math.round(ts.reduce((a, t) => a + t.HP, 0) / ts.length / 50) * 50,
  bonusHP: Math.round(ts.reduce((a, t) => a + t.bonusHP, 0) / ts.length / 50) * 50,
  HEAL: Math.round(ts.reduce((a, t) => a + t.HEAL, 0) / ts.length / 10) * 10 });

const root = "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = [];
for (const g of fs.readdirSync(root)) {
  const f = path.join(root, g, "events.json");
  if (!fs.existsSync(f)) continue;
  const ev = JSON.parse(fs.readFileSync(f, "utf8"));
  const en = ev.filter((x) => x.kind === "enemy" && (x.builds || []).length);
  if (en.length) games.push({ g, builds: en[en.length - 1].builds });
}
const nArg = process.argv.indexOf("--champs");
const champs = nArg > 0 ? d.champions.slice(0, +process.argv[nArg + 1]) : d.champions;
const top = (rows, n) => rows.slice(0, n).map((r) => r.item.name);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const out = [];
for (const { g, builds } of games) {
  const ts = builds.map(oneTarget), avg = avgTarget(ts);
  let c1 = 0, c3 = 0, c6 = 0, set3 = 0;
  let msAvg = 0, msEach = 0;
  const examples = [];
  for (const c of champs) {
    const w = S.profile(c, d.tags);
    let t0 = Date.now();
    St.setTarget(avg); S.clearMemo();
    const rowsAvg = S.rankItems(d.items, w, [], [], d.rules, c, { aram: true }, "balanced").filter((r) => r.item.kind === "legendary");
    msAvg += Date.now() - t0;
    t0 = Date.now();
    const sum = new Map();
    for (const t of ts) {
      St.setTarget(t); S.clearMemo();
      for (const r of S.rankItems(d.items, w, [], [], d.rules, c, { aram: true }, "balanced")) {
        if (r.item.kind !== "legendary") continue;
        sum.set(r.item.name, (sum.get(r.item.name) || 0) + r.score / ts.length);
      }
    }
    msEach += Date.now() - t0;
    const rowsEach = [...sum.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => ({ item: { name } }));
    const a1 = top(rowsAvg, 1), b1 = top(rowsEach, 1), a3 = top(rowsAvg, 3), b3 = top(rowsEach, 3), a6 = top(rowsAvg, 6), b6 = top(rowsEach, 6);
    if (!same(a1, b1)) c1++;
    if (!same(a3, b3)) c3++;
    if (!same(a6, b6)) c6++;
    if (new Set(a3).size !== new Set([...a3].filter((x) => b3.includes(x))).size) { set3++; if (examples.length < 4) examples.push(`${c.name}: 평균 ${a3.join(">")} / 개별 ${b3.join(">")}`); }
  }
  out.push({ game: g, 적: builds.map((b) => b.champ).join(","), 평균기준: avg, 개별기준: ts,
    챔피언: champs.length, 바뀜_1순위: c1, 바뀜_Top3순서: c3, 바뀜_Top6순서: c6, 바뀜_Top3구성: set3,
    ms_평균모델: msAvg, ms_개별모델: msEach, examples });
}
St.setTarget(null);
console.log(JSON.stringify(out, null, 1));
