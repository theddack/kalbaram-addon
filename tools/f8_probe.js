// F8·E3 조사: '자기 회복(cv.selfHeal)' 으로 들어간 값이 정말 회복인가, 어디로 전달되는가 (2026-11-25).
//   node tools/f8_probe.js
// 범위: 조사만 한다. 규칙값을 고치지 않는다 (민감도는 메모리에서만 바꿔 보고 되돌린다).
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const RI = d.rules.items || {}, RA = d.rules.augments || {};
const byName = new Map(d.items.map((i) => [i.name, i]));
const augOf = (id) => d.augments.find((a) => a.id === id);
const CIRCLE = "ARAM_CircleofDeath";
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const strip = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// ---- 1. cv.selfHeal 계열을 쓰는 전부
console.log("=== 1. '자기 회복' 칸으로 들어가는 규칙 전부");
const users = [];
for (const [n, v] of Object.entries(RI)) for (const k of Object.keys((v.stats || {}))) if (/^selfHeal/.test(k)) users.push({ 종류: "아이템", 이름: n, 열쇠: k, 값: v.stats[k], 규칙: v });
for (const [n, v] of Object.entries(RA)) for (const k of Object.keys((v.stats || {}))) if (/^selfHeal/.test(k)) users.push({ 종류: "증강", 이름: n, 열쇠: k, 값: v.stats[k], 규칙: v });
for (const u of users) {
  const it = byName.get(u.이름), aug = d.augments.find((a) => a.id === u.이름);
  console.log(`\n [${u.종류}] ${aug ? aug.name + " (" + u.이름 + ")" : u.이름} — ${u.열쇠} = ${JSON.stringify(u.값)}`);
  console.log(`   규칙 근거: ${(u.규칙.basis && u.규칙.basis.calc) || u.규칙.model || "(없음)"}`);
  console.log(`   원본 설명: ${strip((it || aug || {}).desc).slice(0, 220) || "(없음)"}`);
}

// ---- 2. 그 값이 어디로 가는가
console.log("\n=== 2. 전달 경로 (람머스로 확인)");
{
  const c = d.champions.find((x) => x.id === "Rammus") || d.champions[0];
  const belt = byName.get("원형질 안전벨트");
  const base = St.evaluate(c, 18, [], [], OPTS).m;
  const with1 = St.evaluate(c, 18, [belt], [], OPTS).m;
  const circle = St.evaluate(c, 18, [belt], S.augStatsOf([augOf(CIRCLE)], d.rules, c), OPTS).m;
  const fx = (circle.effects || []).find((e) => e.src === "회복 → 피해");
  console.log(`  자기 회복 묶음(selfHealAll): ${r1(base.selfHealAll)} → ${r1(with1.selfHealAll)} (+${r1(with1.selfHealAll - base.selfHealAll)})`);
  console.log(`  버티는 힘(ehp): ${r1(base.ehp)} → ${r1(with1.ehp)}`);
  console.log(`  아이템 자기 회복(itemSelfHeal, app.js 상대 회복량 추정이 읽는 칸): ${r1(base.itemSelfHeal)} → ${r1(with1.itemSelfHeal)}`);
  console.log(`  → 규칙값 selfHeal 은 itemSelfHeal 에 안 들어간다 = 상대 회복량 추정·치유 감소에는 안 잡힌다`);
  console.log(`  죽음의 순환(회복 → 피해): ${fx ? r1(fx.value) + " (방어 전) · 맞는 피해 " + r1(fx.hit) : "없음"}`);
}

// ---- 3. 민감도: 700 중 '회복이 아닌 300' 을 빼면 추천이 얼마나 움직이나 (고치는 게 아니라 재 보는 것)
console.log("\n=== 3. 민감도 — selfHeal 700 → 400 (체력 +300 을 회복에서 뺀 경우)");
{
  // 아이템 규칙값은 build_data.py 가 data.json 의 item.passiveStats 로 구워 넣는다 (rules.json 을 바꿔도 런타임엔 안 먹는다).
  // 게다가 stats.js 는 능력치 객체마다 Object.entries 를 WeakMap(ENTRIES)에 기억해 둔다 →
  // 속성만 바꾸면 안 먹는다. 객체를 통째로 새로 꽂아야 다시 읽는다 (민감도 조사의 함정).
  const belt = byName.get("원형질 안전벨트");
  const keep = belt.passiveStats.selfHeal;
  const setSelfHeal = (v) => { belt.passiveStats = { ...belt.passiveStats, selfHeal: v }; };
  const top1 = (chosen) => {
    const out = {};
    for (const c of d.champions) {
      const as = chosen.length ? S.augStatsOf(chosen, d.rules, c) : [];
      const rows = S.rankItems(d.items, S.profile(c, d.tags), chosen, [], d.rules, c, OPTS, chosen.length ? "augment" : "balanced")
        .filter((r) => r.item.kind === "legendary");
      out[c.id] = { t1: rows[0].item.name, t3: rows.slice(0, 3).map((r) => r.item.name) };
    }
    return out;
  };
  for (const [label, ids] of [["죽음의 순환", [CIRCLE]], ["증강 없음", []]]) {
    const chosen = ids.map(augOf).filter(Boolean);
    setSelfHeal(keep); S.clearMemo();
    const a = top1(chosen);
    setSelfHeal(400); S.clearMemo();
    const b = top1(chosen);
    setSelfHeal(keep); S.clearMemo();
    let t1 = 0, t3 = 0, belt700 = 0, belt400 = 0;
    for (const id of Object.keys(a)) {
      if (a[id].t1 !== b[id].t1) t1++;
      if (JSON.stringify(a[id].t3) !== JSON.stringify(b[id].t3)) t3++;
      if (a[id].t1 === "원형질 안전벨트") belt700++;
      if (b[id].t1 === "원형질 안전벨트") belt400++;
    }
    console.log(`  [${label}] 1순위 달라짐 ${t1}명 · Top3 달라짐 ${t3}명 · 원형질 안전벨트 1순위 ${belt700} → ${belt400}`);
  }
  console.log("  (규칙값은 되돌렸다. 이 수치는 '어느 쪽이 맞다' 가 아니라 '분류가 결과를 얼마나 움직이나' 다)");
}

// ---- 4. 같은 분류 오류가 더 있나
console.log("\n=== 4. 같은 분류 오류 찾기 (회복이 아닌 것이 회복 칸에 있나)");
{
  const WORDS = ["보호막", "방어막", "막아", "흡수", "최대 체력", "체력 증가", "재생"];
  for (const u of users) {
    const it = byName.get(u.이름), aug = d.augments.find((a) => a.id === u.이름);
    const txt = strip((it || aug || {}).desc) + " " + ((u.규칙.basis && u.규칙.basis.calc) || "") + " " + (u.규칙.model || "");
    const hit = WORDS.filter((w) => txt.includes(w));
    console.log(`  ${aug ? aug.name : u.이름}: ${hit.length ? "⚠ 회복이 아닌 말이 섞여 있다 — " + hit.join(", ") : "회복만"}`);
  }
  // 반대쪽 precedent: 보호막을 보호막 칸으로 넣은 예
  const malmo = RI["맬모셔스의 아귀"];
  console.log(`  참고(맞게 넣은 예) 맬모셔스의 아귀: ${JSON.stringify(malmo && malmo.stats)} → 마법 버티는 힘에만 더한다 (회복으로 안 센다)`);
}

// ---- 5. 원본 수치가 정말 없는가 (E3 '원본 수치 없음' 재확인)
console.log("\n=== 5. 원본 수치 — desc 는 0 이지만 passiveHtml 에는 들어 있다");
{
  const belt = byName.get("원형질 안전벨트");
  console.log(`  desc(값 안 풀린 쪽): ${strip(belt.desc).slice(0, 160)}`);
  console.log(`  passiveHtml(값 풀린 쪽): ${strip(belt.passiveHtml)}`);
  console.log(`  규칙에 구워진 값(item.passiveStats): ${JSON.stringify(belt.passiveStats)}`);
}

// ---- 6. '회복량이 모자란' 쪽: 원본은 저항 비례분도 회복한다 (규칙은 통째로 뺐다)
console.log("\n=== 6. 저항 비례분(추가 방어력·마저의 175%)을 빼서 얼마나 작아졌나");
{
  const rows = [];
  for (const c of d.champions) {
    const build = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item);
    const bare = St.computeStats(c, 18, [], [], OPTS).total;
    const full = St.computeStats(c, 18, build, [], OPTS).total;
    const bonus = (full.ARMOR - bare.ARMOR) + (full.MR - bare.MR);
    rows.push({ name: c.name, bonus, heal: 400 + 1.75 * bonus });
  }
  rows.sort((a, b) => a.heal - b.heal);
  const mid = rows[rows.length >> 1];
  const pick = (n) => rows.find((r) => r.name === n);
  console.log(`  18레벨 균형 빌드의 추가 방어력+마저: 가장 적음 ${r1(rows[0].bonus)} · 중앙값 ${r1(mid.bonus)} · 가장 많음 ${r1(rows[rows.length - 1].bonus)}`);
  console.log(`  원본대로면 회복량 = 400 + 175% × 그 값 → 가장 적음 ${r1(rows[0].heal)} · 중앙값 ${r1(mid.heal)} · 가장 많음 ${r1(rows[rows.length - 1].heal)}`);
  console.log(`  지금 규칙은 회복 400 + 체력 300 = 700 한 덩어리 (저항 비례분 0)`);
  for (const n of ["람머스", "그라가스", "애쉬"]) { const r = pick(n); if (r) console.log(`   ${n}: 추가 저항 ${r1(r.bonus)} → 원본 회복 ${r1(r.heal)}`); }
  console.log("  ※ 발동 조건(체력 30% 아래·재사용 60초)과 '5초 동안만 최대 체력'은 아직 어느 쪽에도 안 들어가 있다");
}
