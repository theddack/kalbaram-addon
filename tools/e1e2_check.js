// v0.1.95 Phase 4 E1·E2 검증: 자기 회복을 아군 지원에서 빼내고(E1) 죽음의 순환이 자기 회복을 읽게(E2) 한 것이
// 무엇을 바꾸는지 수정 전후로 비교한다 (새 플레이 없이 기존 데이터·기록만 쓴다).
//   OLD_STATS=<수정 전 stats.js 경로> node tools/e1e2_check.js [로그폴더]
// 보는 것: 전 챔피언의 자기 회복·아군 회복·지원 지표·버티는 힘·콤보 피해 / 아이템 Top3·빌드 / 실게임 장면 / 중복·순환 참조
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
const d = require(W + "data.json");
const OPTS = { aram: true };
const AUG_VAMP = "ARAM_SustainingStrike", AUG_CIRCLE = "ARAM_CircleofDeath";

// 주의 (2026-11-25 정정): scoring.js 3번째 줄은 require("./stats.js") 로 계산 엔진을 '파일에서' 읽는다.
// 아래처럼 global.Stats 를 바꿔치기해도 점수·추천(top3Of) 쪽은 안 바뀐다 → 1절의 Top3 비교는 믿을 수 없다.
//   지표(metricsOf)는 ctx.St 로 직접 부르므로 맞다. 추천까지 견주려면 stats.js 파일을 바꿔 끼우고 따로 돌려야 한다
//   (tools/aug_top3_dump.js · tools/c9_shred_check.js 가 그 방식).
function load(statsPath) {
  for (const k of Object.keys(require.cache)) if (/stats\.js$|scoring\.js$/.test(k)) delete require.cache[k];
  global.Stats = require(statsPath);
  const S = require(W + "scoring.js");
  S.attachSimilar(d.champions, null, d.items);
  return { St: global.Stats, S };
}
const NEW = load(W + "stats.js");
const OLD = process.env.OLD_STATS ? load(path.resolve(process.env.OLD_STATS)) : null;
if (!OLD) { console.log("OLD_STATS 를 주지 않아 수정 전 비교는 건너뛴다"); }

const champOf = (v) => (typeof v === "string" ? d.champions.find((c) => c.id === v || c.name === v) : v);
const byName = new Map(d.items.map((i) => [i.name, i]));
const augOf = (id) => d.augments.find((a) => a.id === id);
const r1 = (v) => Math.round((v || 0) * 10) / 10;

function metricsOf(ctx, champ, augIds, items = []) {
  global.Stats = ctx.St;
  const as = augIds.length ? ctx.S.augStatsOf(augIds.map(augOf), d.rules, champ) : [];
  const m = ctx.St.evaluate(champ, 18, items, as, OPTS).m;
  const fx = (m.effects || []).find((e) => e.src === "회복 → 피해");
  return { selfHealAll: m.selfHealAll, heal: m.heal, shield: m.shield, selfShield: m.selfShield,
    selfHeal: m.selfHeal, itemSelfHeal: m.itemSelfHeal,
    support: m.support, ehp: m.ehp, combo: m.combo, vampHeal: m.vampHeal, circleDmg: fx ? fx.value : 0 };
}
function top3Of(ctx, champ, augIds) {
  global.Stats = ctx.St;
  const as = augIds.length ? ctx.S.augStatsOf(augIds.map(augOf), d.rules, champ) : [];
  const w = ctx.S.profile(champ, d.tags);
  const rank = ctx.S.rankItems(d.items, w, augIds.map(augOf), [], d.rules, champ, OPTS, augIds.length ? "augment" : "balanced");
  return rank.filter((r) => r.item.kind === "legendary").slice(0, 3).map((r) => r.item.id);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. 전 챔피언 × 증강 조합
console.log("=== 1. 전 챔피언 173명 × 증강 조합 (수정 전후)");
const COMBOS = [["없음", []], ["흡수", [AUG_VAMP]], ["죽음의 순환", [AUG_CIRCLE]], ["둘 다", [AUG_VAMP, AUG_CIRCLE]]];
for (const [label, augs] of COMBOS) {
  let healUp = 0, ehpUp = 0, comboUp = 0, supportDown = 0, top3Moved = 0, bad = 0;
  const examples = [];
  for (const c of d.champions) {
    const n = metricsOf(NEW, c, augs);
    if (!Number.isFinite(n.selfHealAll) || !Number.isFinite(n.ehp) || n.selfHealAll < 0) bad++;
    if (!OLD) continue;
    const o = metricsOf(OLD, c, augs);
    // 수정 전에는 selfHealAll 이라는 칸이 없었다 → 같은 뜻의 갈래 합으로 견준다 (아이템이 없으면 cv.selfHeal 은 0)
    const oldSelf = (o.vampHeal || 0) + (o.selfHeal || 0) + (o.itemSelfHeal || 0);
    if (n.selfHealAll - oldSelf > 1) healUp++;
    if (n.ehp - o.ehp > 1) ehpUp++;
    if (Math.abs(n.combo - o.combo) > 1) comboUp++;
    if (o.support - n.support > 1) supportDown++;
    if (augs.length && !same(top3Of(NEW, c, augs), top3Of(OLD, c, augs))) { top3Moved++; if (examples.length < 4) examples.push(c.name); }
  }
  console.log(`  [${label}] 깨진 값 ${bad}명` + (OLD ? ` · 자기 회복 늘어남 ${healUp} · 버티는 힘 늘어남 ${ehpUp}`
    + ` · 콤보 피해 달라짐 ${comboUp} · 지원 지표 줄어듦 ${supportDown} · Top3 달라짐 ${top3Moved}`
    + (examples.length ? ` (${examples.join(", ")}…)` : "") : ""));
}

// ---- 2. 중복·순환 참조
console.log("\n=== 2. 중복 계산·순환 참조");
{
  const lux = champOf("Lux");
  const v = metricsOf(NEW, lux, [AUG_VAMP]), both = metricsOf(NEW, lux, [AUG_VAMP, AUG_CIRCLE]);
  const rate = (d.rules.augments[AUG_CIRCLE] || {}).stats ? 0.7 : 0.7;
  console.log(`  흡수만: 자기 회복 ${r1(v.selfHealAll)} · 아군 회복 ${r1(v.heal)}`);
  console.log(`  흡수+죽음의 순환: 회복 → 피해 ${r1(both.circleDmg)} (자기 회복 ${r1(both.selfHealAll)} × ${rate} = ${r1(both.selfHealAll * rate)})`);
  console.log(`  자기 회복은 두 증강을 같이 골라도 한 번만 센다: ${Math.abs(both.selfHealAll - v.selfHealAll) < 1 ? "예" : "아니오"}`);
  const omni = byName.get("마도사의 주스 상자") || byName.get("리안드리의 고통");
  const a = metricsOf(NEW, lux, [], [omni]), b = metricsOf(NEW, lux, [AUG_CIRCLE], [omni]);
  console.log(`  순환 참조: 죽음의 순환을 넣어도 흡혈이 그대로인가 — ${Math.abs(a.vampHeal - b.vampHeal) < 1e-9 ? "예 (한 번만 돈다)" : `아니오 (${r1(a.vampHeal)} → ${r1(b.vampHeal)})`}`);
}

// ---- 3. 아군 회복 지표에 보호막이 섞여 있나 (C4 앞 확인)
console.log("\n=== 3. C4 앞 확인: '아군 회복' 지표에 보호막이 섞여 있나");
{
  const rows = [];
  for (const id of ["Soraka", "Sona", "Lulu", "Janna", "Karma", "Yuumi", "Taric", "Renata"]) {
    const c = champOf(id);
    if (!c) continue;
    global.Stats = NEW.St;
    const m = NEW.St.evaluate(c, 18, [], [], OPTS).m;
    rows.push({ 챔피언: c.name, 아군회복: r1(m.heal), 아군보호막: r1(m.shield),
      기술회복: r1(m.kitHeal), 기술보호막: r1(m.kitShield), 아군지원묶음: r1(m.allySupport || 0) });
  }
  for (const r of rows) console.log("  ", JSON.stringify(r));
  const sup = champOf("Renata") || champOf("Soraka");
  global.Stats = NEW.St;
  const items = ["월석 재생기", "강철의 솔라리 펜던트", "구원"].map((n) => byName.get(n)).filter(Boolean);
  const m = NEW.St.evaluate(sup, 18, items, [], OPTS).m;
  console.log(`  서포터 아이템을 낀 ${sup.name}: 아군 회복 ${r1(m.heal)} · 아군 보호막 ${r1(m.shield)} · 아군 지원 묶음 ${r1(m.allySupport)}`);
  console.log("  → 아군 지원 묶음(allySupport)은 회복과 보호막을 한 값으로 합친다. C4 가 '아군 회복'만 쓰려면 out.heal 을 써야 한다.");
}

// ---- 4. 실제 게임 기록에 이 증강이 있었나
console.log("\n=== 4. 실제 게임 기록");
const root = process.argv[2] || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
let found = 0;
for (const g of games) {
  const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
  const mine = new Set(), theirs = new Set();
  for (const x of ev) {
    for (const a of x.augments || []) mine.add(a);
    for (const b of x.builds || []) for (const a of b.augments || []) theirs.add(a);
  }
  const hit = [AUG_VAMP, AUG_CIRCLE].filter((a) => mine.has(a) || theirs.has(a));
  if (hit.length) { found++; console.log(`  ${g}: ${hit.join(", ")}`); }
}
console.log(`  이 증강이 나온 판 ${found}/${games.length}`);
