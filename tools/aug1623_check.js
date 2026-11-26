// 16.23.1 새 증강(요새화·신비한 방호·더욱 굳건한 태세·점액 천지) 확인.
//   node tools/aug1623_check.js
// 보는 것: ① 기본 저항과 추가 저항을 가르는가 ② 여러 개 겹칠 때 ③ 원형질 안전벨트(추가 저항 175% 회복)·
//          죽음의 순환(회복 → 피해)과의 연계 ④ 점액 천지의 상대 최대 체력 비례 피해.
const path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
global.Stats = St;
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (n) => d.items.find((i) => i.name === n);
const aug = (id) => d.augments.find((a) => a.id === id);
const OPTS = { aram: true };
const r1 = (x) => Math.round(x * 10) / 10;

function run(id, augIds, items = []) {
  const c = champ(id);
  const as = augIds.length ? S.augStatsOf(augIds.map(aug).filter(Boolean), d.rules, c) : [];
  const picked = items.map(item).filter(Boolean);
  const cs = St.computeStats(c, 18, picked, as, OPTS);
  const m = St.evaluate(c, 18, picked, as, OPTS).m;
  return { t: cs.total, m };
}

console.log("=== 1. 기본 저항과 추가 저항 (아이템 없이, 18레벨 가렌)");
const base = run("Garen", []);
console.log(`  증강 없음: 방어력 ${r1(base.t.ARMOR)} (기본 ${r1(base.t.ARMOR - base.t.bonusARMOR)} + 추가 ${r1(base.t.bonusARMOR)})`);
for (const [label, ids] of [["요새화", ["Fortified"]], ["신비한 방호", ["MysticGuard"]],
  ["더욱 굳건한 태세", ["SteadfastPresence"]], ["요새화+신비한 방호", ["Fortified", "MysticGuard"]],
  ["요새화+더욱 굳건한 태세", ["Fortified", "SteadfastPresence"]],
  ["셋 다", ["Fortified", "MysticGuard", "SteadfastPresence"]]]) {
  const x = run("Garen", ids);
  console.log(`  ${label}: 방어력 ${r1(x.t.ARMOR)} (추가 ${r1(x.t.bonusARMOR)}) · 마법 저항력 ${r1(x.t.MR)} (추가 ${r1(x.t.bonusMR)})`
    + ` · 버티는 힘 ${Math.round(x.m.ehp)}`);
}

console.log("\n=== 2. 추가 저항이 있을 때 (판금 장화 + 밴시의 장막)");
const gear = ["판금 장화", "밴시의 장막"];
for (const [label, ids] of [["증강 없음", []], ["요새화", ["Fortified"]], ["신비한 방호", ["MysticGuard"]],
  ["요새화+신비한 방호", ["Fortified", "MysticGuard"]]]) {
  const x = run("Garen", ids, gear);
  console.log(`  ${label}: 추가 방어력 ${r1(x.t.bonusARMOR)} · 추가 마법 저항력 ${r1(x.t.bonusMR)} · 버티는 힘 ${Math.round(x.m.ehp)}`);
}

console.log("\n=== 3. 원형질 안전벨트(추가 저항 175% 회복) 연계");
const BELT = "원형질 안전벨트";
for (const [label, ids] of [["안전벨트만", []], ["안전벨트+요새화", ["Fortified"]],
  ["안전벨트+신비한 방호", ["MysticGuard"]], ["안전벨트+셋 다", ["Fortified", "MysticGuard", "SteadfastPresence"]]]) {
  const x = run("Garen", ids, [BELT]);
  console.log(`  ${label}: 자기 회복 ${Math.round(x.m.selfHealAll)} · 최대 체력 증가 ${Math.round(x.m.selfHpAll)} · 버티는 힘 ${Math.round(x.m.ehp)}`);
}

console.log("\n=== 4. 죽음의 순환(회복 → 피해) 연계");
for (const [label, ids] of [["죽음의 순환만", ["ARAM_CircleofDeath"]],
  ["죽음의 순환+요새화", ["ARAM_CircleofDeath", "Fortified"]],
  ["죽음의 순환+셋 다", ["ARAM_CircleofDeath", "Fortified", "MysticGuard", "SteadfastPresence"]]]) {
  const x = run("Garen", ids, [BELT]);
  console.log(`  ${label}: 자기 회복 ${Math.round(x.m.selfHealAll)} · 한타 피해 ${Math.round(x.m.combo)}`);
}

console.log("\n=== 5. 점액 천지 (6초마다, 상대 최대 체력 비례)");
for (const id of ["Garen", "Lux", "Ashe"]) {
  const a = run(id, []), b = run(id, ["ARAM_SlimeTime"]);
  console.log(`  ${champ(id).name}: 한타 피해 ${Math.round(a.m.combo)} → ${Math.round(b.m.combo)}`
    + ` · 초당 ${Math.round(a.m.dps)} → ${Math.round(b.m.dps)}`);
}

console.log("\n=== 6. 기본 저항은 올라가지 않아야 한다");
const g0 = run("Garen", []), g1 = run("Garen", ["Fortified"]);
const baseArmor0 = g0.t.ARMOR - g0.t.bonusARMOR, baseArmor1 = g1.t.ARMOR - g1.t.bonusARMOR;
console.log(`  기본 방어력 ${r1(baseArmor0)} → ${r1(baseArmor1)} ${Math.abs(baseArmor0 - baseArmor1) < 1e-9 ? "(같다 ✔)" : "(다르다 ✘)"}`);
