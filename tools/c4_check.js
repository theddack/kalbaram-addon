// v0.1.95 Phase 4 C4 검증: 상대 회복량(TARGET.HEAL)에 '아군에게 주는 회복'까지 넣은 것과
// '회복 많음' 조언 판정을 같은 추정값으로 옮긴 것이 무엇을 바꾸는지 수정 전후로 견준다 (새 플레이 없이).
//   node tools/c4_check.js [로그폴더]
// 보는 것: ① 회복·보호막 갈래 분리 ② 자기/아군 중복 없음 ③ 전 챔피언 173명 ④ 회복 vs 보호막 챔피언
//          ⑤ 치유 감소 아이템 순위 ⑥ 실게임 기록의 TARGET.HEAL·추천 ⑦ 조언 발동 ⑧ 캐시 일치
// 아이템·챔피언 이름을 박지 않는다 (규칙 열쇠로 찾는다). 특정 아이템의 순위 상승을 성공 조건으로 삼지 않는다.
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
global.Stats = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
const St = global.Stats;
const R = require("./rec_baseline.js");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const byName = new Map(d.items.map((i) => [i.name, i]));
const champ = (id) => d.champions.find((c) => c.id === id || c.name === id);
const RI = d.rules.items || {};
const withKey = (k) => Object.keys(RI).filter((n) => ((RI[n].stats || {})[k] != null)).map((n) => byName.get(n)).filter(Boolean);
const HEALCUT = withKey("healCut");
const fmt = (v, p = 0) => (Math.round(v * 10 ** p) / 10 ** p).toLocaleString("en-US");
const line = (s) => console.log(s);

// ---- web/app.js 와 같은 계산
const selfHealOf = (m) => (m.selfHealAll != null ? m.selfHealAll : (m.selfHeal || 0) + (m.vampHeal || 0) + (m.itemSelfHeal || 0));
const allyHealOf = (m) => (m.allyHealAll != null ? m.allyHealAll : (m.heal || 0));
const ev = (c, items, augs) => St.evaluate(c, 18, items || [], augs || [], OPTS).m;
const healNew = (c, items) => { const m = ev(c, items); return selfHealOf(m) + allyHealOf(m); };   // C4 뒤
const healOld = (c, items) => selfHealOf(ev(c, items));                                            // C4 전
let mid = null;
const healBaseline = () => (mid != null ? mid : (mid = (() => {
  const v = d.champions.map((c) => healNew(c, [])).filter((x) => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
})()));
// 수정 전 조언 판정 (개수 규칙)
const healsCnt = (c) => (c.spells || []).filter((sp) => (sp.effects || []).some((x) => x && x.kind === "heal")).length
  + (((c.passive || {}).effects || []).some((x) => x && x.kind === "heal") ? 1 : 0);
const healItem = (i) => (i.tags && (i.tags.VAMP || 0) >= 0.5) || (i.stats && !Array.isArray(i.stats) && ("LS" in i.stats || "OMNIVAMP" in i.stats));
const adviceOld = (team) => team.filter((e) => healsCnt(e.c) >= 2 || (e.items || []).some(healItem)).length >= 2;
const adviceNew = (team) => team.reduce((a, e) => a + healNew(e.c, e.items), 0) >= 2 * healBaseline();
const targetHeal = (team, how) => Math.round(team.reduce((a, e) => a + how(e.c, e.items), 0) / team.length / 10) * 10;

// ---- ① 회복·보호막 갈래가 갈라졌나
line("① 서포터 아이템의 회복·보호막 갈래 (합계는 그대로여야 한다)");
const supItems = ["allyHealMult", "allyShieldMult", "dmgToAllyHeal", "allyActiveHeal", "allyActiveShield"]
  .map((k) => ({ k, its: withKey(k) }));
line("   규칙에서 찾은 서포터 아이템: " + supItems.map((x) => `${x.k}=${x.its.map((i) => i.name).join("/") || "없음"}`).join(" · "));
const supAll = [...new Set(supItems.flatMap((x) => x.its))];
let bad1 = 0, seenSplit = 0;
for (const id of d.champions.filter((c) => (c.features || []).includes("allysupport")).map((c) => c.id)) {
  const c = champ(id);
  const m = ev(c, supAll.slice(0, 6));
  const sum = (m.allySupportHeal || 0) + (m.allySupportShield || 0);
  if (Math.abs(sum - (m.allySupport || 0)) > 1e-6) { bad1++; line(`   ✗ ${c.name} 합계 어긋남 ${m.allySupport} vs ${sum}`); }
  if ((m.allySupport || 0) > 0) seenSplit++;
}
line(`   아군 지원 챔피언 ${d.champions.filter((c) => (c.features || []).includes("allysupport")).length}명 · 서포터 아이템 효과가 난 경우 ${seenSplit}명 · 합계 어긋남 ${bad1}`);
// 보호막만 주는 챔피언은 아군 회복 0 이어야 한다
const shieldOnly = d.champions.filter((c) => { const m = ev(c, []); return (m.shield || 0) > 0 && allyHealOf(m) === 0; });
line(`   아군에게 보호막만 주는 챔피언 ${shieldOnly.length}명 → 아군 회복 추정 전부 0 (보호막이 회복으로 새지 않는다)`);
line(`   예: ${shieldOnly.slice(0, 6).map((c) => `${c.name} 보호막 ${fmt(ev(c, []).shield)}·회복 0`).join(" · ")}`);

// ---- ② 자기 회복과 아군 회복이 겹치지 않나
line("");
line("② 자기 회복 ↔ 아군 회복 중복 없음 (한 칸에서 두 번 세지 않는지)");
let bad2 = 0, both = 0;
for (const c of d.champions) {
  const m = ev(c, supAll.slice(0, 6));
  const self = selfHealOf(m), ally = allyHealOf(m);
  // 스킬 칸이 나눠 적은 자기 몫/아군 몫 (targetShare). 규칙 효과(패시브·고유 효과)는 스킬 칸 밖이라 아군 회복이 더 클 수 있다
  const spAlly = (m.spells || []).reduce((a, sp) => a + (sp.heal || 0), 0);
  if (self < 0 || ally < 0) { bad2++; line(`   ✗ ${c.name} 음수 회복`); continue; }
  if (self > 0 && ally > 0) both++;
  // 아군 회복 = 기술 아군 몫(heal) + 서포터 아이템 회복. 스킬 칸 몫보다 작아지면 어디선가 빠진 것이다
  if (ally + 1e-6 < spAlly) { bad2++; line(`   ✗ ${c.name} 아군 회복이 스킬 칸 합보다 작다 ${ally} < ${spAlly}`); }
  if (Math.abs(ally - ((m.heal || 0) + (m.allySupportHeal || 0))) > 1e-6) { bad2++; line(`   ✗ ${c.name} 아군 회복 칸 합 어긋남`); }
}
line(`   어긋남 ${bad2} · 자기 회복과 아군 회복을 둘 다 가진 챔피언 ${both}명 (두 칸이 따로 센다)`);
const noHealCut = ["selfShieldAll", "allySupportShield", "shield", "selfHpAll", "selfAbsorbAll"];
line(`   치유 감소가 못 깎는 칸은 추정값에 안 들어간다: ${noHealCut.join(" · ")}`);

// ---- ③ 전 챔피언 173명 (적 5명 중 1명으로)
line("");
line("③ 전 챔피언 173명 — 그 챔피언을 적 5명 중 1명으로 넣었을 때 (나머지 4명은 회복이 0인 적)");
const filler = d.champions.filter((c) => healNew(c, []) === 0).slice(0, 4).map((c) => ({ c, items: [] }));
const rows3 = d.champions.map((c) => {
  const team = [{ c, items: [] }, ...filler];
  return { n: c.name, old: targetHeal(team, healOld), now: targetHeal(team, healNew),
    advOld: adviceOld(team), advNew: adviceNew(team) };
});
const moved = rows3.filter((r) => r.now !== r.old);
line(`   기준값 healBaseline(회복이 있는 챔피언의 중앙값) = ${fmt(healBaseline(), 1)}`);
line(`   TARGET.HEAL 이 달라진 챔피언 ${moved.length} / 173 · 전부 0 이상 (아군 회복은 더하기만 한다: ${moved.every((r) => r.now >= r.old) ? "맞음" : "✗ 아님"})`);
line(`   올라간 폭 상위: ${moved.sort((a, b) => (b.now - b.old) - (a.now - a.old)).slice(0, 8).map((r) => `${r.n} ${r.old}→${r.now}`).join(" · ")}`);
const advDiff = rows3.filter((r) => r.advOld !== r.advNew);
line(`   조언 발동 판정이 달라진 챔피언 ${advDiff.length} (새로 나옴 ${advDiff.filter((r) => r.advNew).length} · 안 나옴 ${advDiff.filter((r) => r.advOld).length})`);
line(`   새로 나옴: ${advDiff.filter((r) => r.advNew).slice(0, 10).map((r) => r.n).join(" · ") || "없음"}`);
line(`   안 나옴:   ${advDiff.filter((r) => r.advOld).slice(0, 10).map((r) => r.n).join(" · ") || "없음"}`);
// 반대 방향: 예전엔 '흡혈 아이템을 샀으면 회복 많음'이라 아이템 하나로도 조언이 나왔다
const vampIts = d.items.filter((i) => i.kind === "legendary" && healItem(i));
const vampTeam = (n, k) => d.champions.filter((c) => healNew(c, []) === 0).slice(0, n).map((c) => ({ c, items: vampIts.slice(0, k) }));
line(`   흡혈 아이템을 산 적만 있는 팀 (회복 기술은 없음):`);
for (const [n, k] of [[2, 1], [2, 3], [5, 1], [5, 3], [5, 6]]) {
  const t = vampTeam(n, k);
  line(`     적 ${n}명 × 흡혈 아이템 ${k}개 → HEAL ${targetHeal(t, healOld)}→${targetHeal(t, healNew)} · 조언 ${adviceOld(t) ? "나옴" : "없음"} → ${adviceNew(t) ? "나옴" : "없음"}`);
}

// ---- ④ 회복 챔피언 vs 보호막 챔피언
line("");
line("④ 회복 챔피언 ↔ 보호막 챔피언 (보호막은 추정값을 올리면 안 된다)");
for (const id of ["Soraka", "Sona", "Yuumi", "Taric", "Nami", "Janna", "Lulu", "Karma", "Seraphine", "Lux"]) {
  const c = champ(id); if (!c) continue;
  const m = ev(c, []);
  line(`   ${c.name.padEnd(6)} 자기 ${fmt(selfHealOf(m)).padStart(6)} · 아군 회복 ${fmt(allyHealOf(m)).padStart(6)} · 아군 보호막 ${fmt(m.shield).padStart(6)}`
    + ` → 추정 ${fmt(healNew(c, [])).padStart(6)} (전 ${fmt(healOld(c, []))})`);
}

// ---- ⑤ 치유 감소 아이템 순위
line("");
line("⑤ 치유 감소 아이템 순위 (회복 많은 적 구성에서) — 순위가 오르는 것 자체가 성공 조건은 아니다");
const REPS = ["Ashe", "Lux", "Garen", "Darius", "Ahri", "Jinx"];
const sorakaTeam = [{ c: champ("Soraka"), items: [] }, ...filler];
for (const id of REPS) {
  const c = champ(id); if (!c) continue;
  const res = [];
  for (const [label, how] of [["전", healOld], ["후", healNew]]) {
    St.setTarget({ ARMOR: St.DEFAULT_TARGET.ARMOR, MR: St.DEFAULT_TARGET.MR, HP: St.DEFAULT_TARGET.HP, HEAL: targetHeal(sorakaTeam, how) });
    const r = R.ranking(d, c, [], [], OPTS);
    const rank = HEALCUT.map((it) => r.top.map((x) => x.name).indexOf(it.name) + 1);
    res.push({ label, heal: St.TARGET.HEAL, top3: r.top.map((x) => x.name).slice(0, 3).join("·"), rank });
    St.setTarget(null);
  }
  const chg = res[0].top3 !== res[1].top3;
  line(`   ${c.name.padEnd(6)} HEAL ${res[0].heal}→${res[1].heal} · Top3 ${chg ? `${res[0].top3}  →  ${res[1].top3}` : "그대로 " + res[1].top3}`);
}

// ---- ⑥ 실게임 기록
line("");
line("⑥ 실게임 기록 (기록된 적 빌드로 TARGET.HEAL 을 다시 낸다)");
const root = process.argv[2] || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
let scenes = 0, sceneMoved = 0, top6Moved = 0, top1Moved = 0, maxUp = 0, maxWho = "", advMoved = 0, advOn = 0, advOff = 0, rawUp = 0;
for (const g of games) {
  const evs = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
  const start = evs.find((x) => x.kind === "start") || {};
  const me = champ(start.champion || "");
  let items = [], augs = [], seen = new Set();
  for (const x of evs) {
    if (x.kind === "items") items = x.items || [];
    if (x.kind === "picked" && x.picked) augs = augs.concat([x.picked]);
    if (x.kind !== "enemy" || !(x.builds || []).length || !me) continue;
    const team = x.builds.map((e) => ({ c: champ(e.champ), items: (e.items || []).map((n) => byName.get(n)).filter(Boolean) })).filter((e) => e.c);
    if (!team.length) continue;
    const key = [team.map((e) => e.c.id + ":" + e.items.map((i) => i.id).join(",")).join("|"), items.join("|"), augs.join("|")].join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    scenes++;
    const hOld = targetHeal(team, healOld), hNew = targetHeal(team, healNew);
    const aOld = adviceOld(team), aNew = adviceNew(team);
    if (aOld !== aNew) { advMoved++; if (aNew) advOn++; else advOff++; }
    // 10 단위로 반올림하기 전 값도 본다 (반올림에 묻힌 차이가 있는지)
    rawUp = Math.max(rawUp, team.reduce((a, e) => a + healNew(e.c, e.items) - healOld(e.c, e.items), 0) / team.length);
    if (hNew !== hOld) {
      sceneMoved++;
      if (hNew - hOld > maxUp) { maxUp = hNew - hOld; maxWho = `${g} ${team.map((e) => e.c.name).join("·")}`; }
      const fixed = items.map((n) => byName.get(n)).filter(Boolean);
      const chosen = augs.map((n) => d.augments.find((a) => a.name === n || a.id === n)).filter(Boolean);
      const t = { ARMOR: St.DEFAULT_TARGET.ARMOR, MR: St.DEFAULT_TARGET.MR, HP: St.DEFAULT_TARGET.HP };
      St.setTarget({ ...t, HEAL: hOld }); const a = R.ranking(d, me, chosen, fixed, OPTS);
      St.setTarget({ ...t, HEAL: hNew }); const b = R.ranking(d, me, chosen, fixed, OPTS);
      St.setTarget(null);
      const A = a.top.map((x) => x.name), B = b.top.map((x) => x.name);
      if (A.join() !== B.join()) top6Moved++;
      if (A[0] !== B[0]) top1Moved++;
    }
  }
}
line(`   판 ${games.length}개 · 장면 ${scenes}개 · TARGET.HEAL 이 달라진 장면 ${sceneMoved} · Top6 ${top6Moved} · 1순위 ${top1Moved}`);
line(`   가장 많이 오른 장면: +${maxUp}${maxWho ? " (" + maxWho + ")" : ""} · 반올림 전 최대 +${fmt(rawUp, 2)}`);
line(`   치유 감소 조언 판정이 달라진 장면 ${advMoved} (새로 나옴 ${advOn} · 안 나옴 ${advOff})`);

// ---- ⑦ 캐시 일치
line("");
line("⑦ 같은 구성을 두 번 계산하면 같은 값인가");
const t1 = targetHeal(sorakaTeam, healNew), t2 = targetHeal(sorakaTeam, healNew);
const r1 = (() => { St.setTarget({ ARMOR: 111, MR: 67, HP: 3190, HEAL: t1 }); const r = R.ranking(d, champ("Ashe"), [], [], OPTS); St.setTarget(null); return r.top.map((x) => x.name).join(); })();
const r2 = (() => { St.setTarget({ ARMOR: 111, MR: 67, HP: 3190, HEAL: t2 }); const r = R.ranking(d, champ("Ashe"), [], [], OPTS); St.setTarget(null); return r.top.map((x) => x.name).join(); })();
line(`   회복량 ${t1} == ${t2} · 추천 ${r1 === r2 ? "같음" : "✗ 다름"}`);
line("");
line(`마침 · 어긋남 ${bad1 + bad2}`);
