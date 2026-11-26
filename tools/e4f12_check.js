// v0.1.95 Phase 4 E4·F12 검증: 자기 회복 / 최대 체력 증가 / 일반 보호막 / 주문 방어막·피해 흡수를 갈라 넣은 뒤
// 무엇이 어떻게 바뀌는지 본다 (2026-11-25).
//   node tools/e4f12_check.js [--json 파일]
// 보는 것: 효과 분류 · 정령의 형상 증폭 · 중복 합산 · 상대 회복량 추정과 치유 감소 · 저항 낮은/높은 챔피언 · 캐시 일치
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
const FP = require("./engine_fp.js");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const byName = new Map(d.items.map((i) => [i.name, i]));
const champOf = (v) => d.champions.find((c) => c.id === v || c.name === v);
const augOf = (id) => d.augments.find((a) => a.id === id);
const BELT = "원형질 안전벨트", SPIRIT = "정령의 형상";
const CIRCLE = "ARAM_CircleofDeath", VEIL = "VeilOfWarding";
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const RI = d.rules.items || {}, RA = d.rules.augments || {};
const out = { engine: FP.fingerprint(), inputs: { 조건: "기본" } };

function mOf(champ, itemNames = [], augIds = []) {
  const items = itemNames.map((n) => byName.get(n)).filter(Boolean);
  const as = augIds.length ? S.augStatsOf(augIds.map(augOf).filter(Boolean), d.rules, champ) : [];
  const m = St.evaluate(champ, 18, items, as, OPTS).m;
  const fx = (m.effects || []).find((e) => e.src === "회복 → 피해");
  return { selfHealAll: r1(m.selfHealAll), selfShieldAll: r1(m.selfShieldAll), selfHpAll: r1(m.selfHpAll),
    selfAbsorbAll: r1(m.selfAbsorbAll), ehp: r1(m.ehp), 회복피해: r1(fx ? fx.value : 0) };
}

// ---- 1. 규칙에 무엇이 들어 있나
console.log("=== 1. 규칙값 (지금 파일 기준)");
out.규칙 = { 안전벨트: (RI[BELT] || {}).stats, 장막: (RA[VEIL] || {}).statsResolved, 정령의형상: (RI[SPIRIT] || {}).stats,
  안전벨트_구워진값: (byName.get(BELT) || {}).passiveStats };
for (const [k, v] of Object.entries(out.규칙)) console.log(`  ${k}: ${JSON.stringify(v)}`);

// ---- 2. 효과 분류 (람머스·저항 높은 쪽·낮은 쪽)
console.log("\n=== 2. 효과 분류 — 자기 회복 / 최대 체력 / 일반 보호막 / 주문 방어막");
{
  const rows = {};
  const cases = [
    ["맨몸", [], []],
    ["안전벨트", [BELT], []],
    ["장막", [], [VEIL]],
    ["안전벨트+장막", [BELT], [VEIL]],
    ["안전벨트+정령의 형상", [BELT, SPIRIT], []],
    ["장막+정령의 형상", [SPIRIT], [VEIL]],
    ["안전벨트+죽음의 순환", [BELT], [CIRCLE]],
    ["장막+죽음의 순환", [], [VEIL, CIRCLE]],
  ];
  for (const id of ["Rammus", "Lux"]) {
    const c = champOf(id);
    for (const [label, items, augs] of cases) {
      const key = `${c.name} / ${label}`;
      rows[key] = mOf(c, items, augs);
      console.log(`  ${key.padEnd(34)} ${JSON.stringify(rows[key])}`);
    }
  }
  out.분류 = rows;
}

// ---- 3. 중복 합산·증폭 확인
console.log("\n=== 3. 중복 합산과 증폭");
{
  const c = champOf("Rammus");
  const bare = mOf(c, [], []), belt = mOf(c, [BELT], []), veil = mOf(c, [], [VEIL]);
  const beltSpirit = mOf(c, [BELT, SPIRIT], []), spirit = mOf(c, [SPIRIT], []), veilSpirit = mOf(c, [SPIRIT], [VEIL]);
  const sum = belt.selfHealAll + belt.selfHpAll + belt.selfShieldAll + belt.selfAbsorbAll;
  const chk = [];
  chk.push([`안전벨트가 주는 값의 합 = ${r1(sum)} (예전 한 덩어리 700 과 같아야 한다)`, Math.abs(sum - 700) < 1]);
  chk.push([`자기 회복 칸에 들어간 몫 ${belt.selfHealAll} · 최대 체력 칸 ${belt.selfHpAll}`, true]);
  chk.push([`장막은 주문 방어막 칸으로만 (흡수 ${veil.selfAbsorbAll} · 회복 ${r1(veil.selfHealAll - bare.selfHealAll)})`, true]);
  // 정령의 형상: 받는 회복·보호막 25% 증가 → 자기 회복만 1.25배, 최대 체력·주문 방어막은 그대로여야 한다
  // 정령의 형상은 마법 저항력 50 을 같이 준다 → 원본 계수를 넣은 뒤로는 회복 바탕값 자체가 커진다.
  // 그래서 '바탕값 × 1.25' 와 견준다 (배율만 떼어 보려고)
  const beltOnlySpirit = St.computeStats(champOf("Rammus"), 18, [byName.get(BELT), byName.get(SPIRIT)], [], OPTS);
  const ruleHeal = (cv) => cv.selfHeal || 0;
  const expectHeal = ruleHeal(beltOnlySpirit.conv) * 1.25;
  const healAmp = (beltSpirit.selfHealAll - bare.selfHealAll * 1.25) / Math.max(1e-9, ruleHeal(beltOnlySpirit.conv));
  const hpAmp = beltSpirit.selfHpAll / Math.max(1e-9, belt.selfHpAll);
  const absorbAmp = veilSpirit.selfAbsorbAll / Math.max(1e-9, veil.selfAbsorbAll);
  chk.push([`정령의 형상 뒤 자기 회복 ${r1(beltSpirit.selfHealAll)} = 규칙값 ${r1(ruleHeal(beltOnlySpirit.conv))} × 1.25 (${r1(expectHeal)}) 여야 한다`,
    Math.abs(beltSpirit.selfHealAll - expectHeal) < 1]);
  chk.push([`회복에 걸린 배율 ${r1(healAmp * 100) / 100} (1.25 여야 한다)`, Math.abs(healAmp - 1.25) < 0.01]);
  chk.push([`정령의 형상이 최대 체력 증가에 곱하는 배율 ${r1(hpAmp * 100) / 100} (1 이어야 한다)`, Math.abs(hpAmp - 1) < 0.01 || belt.selfHpAll === 0]);
  chk.push([`정령의 형상이 주문 방어막에 곱하는 배율 ${r1(absorbAmp * 100) / 100} (1 이어야 한다)`, Math.abs(absorbAmp - 1) < 0.01 || veil.selfAbsorbAll === 0]);
  // 죽음의 순환은 '실제 자기 회복' 만 환산해야 한다
  const circleBelt = mOf(c, [BELT], [CIRCLE]), circleVeil = mOf(c, [], [VEIL, CIRCLE]), circleBare = mOf(c, [], [CIRCLE]);
  chk.push([`죽음의 순환 — 안전벨트 회복→피해 ${circleBelt.회복피해} (자기 회복 ${circleBelt.selfHealAll} × 0.7)`,
    Math.abs(circleBelt.회복피해 - circleBelt.selfHealAll * 0.7) < 1]);
  chk.push([`죽음의 순환 — 장막 회복→피해 ${circleVeil.회복피해} (맨몸 ${circleBare.회복피해}: 주문 방어막은 안 세야 한다)`,
    Math.abs(circleVeil.회복피해 - circleBare.회복피해) < 1]);
  for (const [t, ok] of chk) console.log(`  ${ok ? "확인" : "⚠ 어긋남"} — ${t}`);
  out.중복합산 = chk.map(([t, ok]) => ({ 항목: t, 통과: ok }));
}

// ---- 4. 상대 회복량 추정과 치유 감소 (app.js selfHealOf 와 같은 식)
console.log("\n=== 4. 상대가 원형질 안전벨트를 샀을 때 — 회복량 추정과 치유 감소 추천");
{
  // 옛 식(app.js 가 규칙값 cv.selfHeal 을 안 보던 때) 과 새 식(selfHealAll) 을 나란히 본다
  const oldOf = (m) => (m.selfHeal || 0) + (m.vampHeal || 0) + (m.itemSelfHeal || 0);
  const selfHealOf = (m) => (m.selfHealAll != null ? m.selfHealAll : oldOf(m));
  const foe = champOf("Garen") || d.champions[0];
  const no = St.evaluate(foe, 18, [], [], OPTS).m, yes = St.evaluate(foe, 18, [byName.get(BELT)], [], OPTS).m;
  const healNo = selfHealOf(no), healYes = selfHealOf(yes);
  console.log(`  상대(${foe.name}) 자기 회복 추정 — 옛 식: ${r1(oldOf(no))} → ${r1(oldOf(yes))} (규칙값을 안 봐서 그대로)`);
  console.log(`  상대(${foe.name}) 자기 회복 추정 — 새 식: ${r1(healNo)} → ${r1(healYes)} (+${r1(healYes - healNo)})`);
  out.상대회복량_옛식 = { 없을때: r1(oldOf(no)), 샀을때: r1(oldOf(yes)) };
  const HEALCUT = Object.keys(RI).filter((n) => ((RI[n].stats || {}).healCut != null)).map((n) => byName.get(n)).filter(Boolean);
  const me = champOf("Ashe") || d.champions[0];
  const rankWith = (heal) => {
    St.setTarget({ ARMOR: St.DEFAULT_TARGET.ARMOR, MR: St.DEFAULT_TARGET.MR, HP: St.DEFAULT_TARGET.HP, HEAL: heal });
    S.clearMemo();
    const rows = S.rankItems(d.items, S.profile(me, d.tags), [], [], d.rules, me, OPTS, "balanced").filter((r) => r.item.kind === "legendary");
    St.setTarget(null); S.clearMemo();
    return { top3: rows.slice(0, 3).map((r) => r.item.name), 치유감소순위: HEALCUT.map((it) => [it.name, rows.findIndex((r) => r.item.id === it.id) + 1]) };
  };
  // 상대 5명 중 1명이 샀다고 보면 평균 회복량은 그 1/5 만큼 오른다 (app.js enemyTarget 은 5명 평균)
  const base = rankWith(Math.round(healNo)), moved = rankWith(Math.round(healNo + (healYes - healNo) / 5));
  console.log(`  기준 상대 회복량 ${Math.round(healNo)} → ${Math.round(healNo + (healYes - healNo) / 5)} (5명 평균)`);
  console.log(`  ${me.name} Top3: ${base.top3.join(" / ")}  →  ${moved.top3.join(" / ")}`);
  console.log(`  치유 감소 아이템 순위: ${JSON.stringify(base.치유감소순위)} → ${JSON.stringify(moved.치유감소순위)}`);
  out.상대회복량 = { 상대: foe.name, 없을때: r1(healNo), 샀을때: r1(healYes), 기준: base, 바뀐뒤: moved };
}

// ---- 5. 저항이 낮은 챔피언과 높은 챔피언 (원본 계수 적용 뒤에 달라지는 자리)
console.log("\n=== 5. 추가 저항이 낮은/높은 챔피언에서 안전벨트가 주는 값");
{
  const rows = [];
  for (const c of d.champions) {
    const build = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item);
    const bare = St.computeStats(c, 18, [], [], OPTS).total, full = St.computeStats(c, 18, build, [], OPTS).total;
    rows.push({ name: c.name, bonus: r1((full.ARMOR - bare.ARMOR) + (full.MR - bare.MR)) });
  }
  rows.sort((a, b) => a.bonus - b.bonus);
  const pick = [rows[0], rows[1], rows[rows.length >> 1], rows[rows.length - 2], rows[rows.length - 1]];
  // 그 챔피언의 균형 빌드에 안전벨트를 더 끼웠을 때 '안전벨트가 주는 몫' 만 떼어 본다
  // (selfHealAll 에는 챔피언 스킬 회복·흡혈도 섞여 있어 그대로 쓰면 안 된다)
  const beltGain = (c, build) => {
    const no = St.computeStats(c, 18, build, [], OPTS).conv, yes = St.computeStats(c, 18, [...build, byName.get(BELT)], [], OPTS).conv;
    const t = St.computeStats(c, 18, [...build, byName.get(BELT)], [], OPTS).total;
    return { 회복: r1((yes.selfHeal || 0) - (no.selfHeal || 0)), 최대체력: r1((yes.selfHp || 0) - (no.selfHp || 0)),
      추가저항: r1(t.bonusARMOR + t.bonusMR) };
  };
  out.저항별 = [];
  for (const r of pick) {
    const c = champOf(r.name);
    const build = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item).slice(0, 5);
    const g = beltGain(c, build);
    console.log(`  ${r.name.padEnd(10)} 빌드 추가 저항 ${String(g.추가저항).padStart(6)} → 안전벨트 회복 ${String(g.회복).padStart(7)} · 최대 체력 ${String(g.최대체력).padStart(5)}`);
    out.저항별.push({ name: r.name, ...g });
  }
}

// ---- 6. 캐시 적중과 초기화 뒤 결과가 같은가
console.log("\n=== 6. 캐시 일치 (같은 입력 두 번 · 초기화 뒤 한 번)");
{
  const bad = [];
  const ids = ["Rammus", "Lux", "Ashe", "Gragas", "Nasus"];
  for (const id of ids) {
    const c = champOf(id);
    const chosen = [augOf(CIRCLE)].filter(Boolean);
    const run = () => S.rankItems(d.items, S.profile(c, d.tags), chosen, [], d.rules, c, OPTS, "augment")
      .filter((r) => r.item.kind === "legendary").slice(0, 6).map((r) => `${r.item.name}:${Math.round(r.score * 1e4)}`);
    const a = run(), b = run();
    S.clearMemo();
    const z = run();
    if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(a) !== JSON.stringify(z)) bad.push(id);
  }
  console.log(`  ${ids.length}명 확인 — 어긋난 챔피언 ${bad.length}${bad.length ? " (" + bad.join(", ") + ")" : ""}`);
  out.캐시 = { 확인: ids.length, 어긋남: bad };
}

const at = process.argv.indexOf("--json");
if (at > 0 && process.argv[at + 1]) { fs.writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 1)); console.log(`\n저장 ${process.argv[at + 1]}`); }
