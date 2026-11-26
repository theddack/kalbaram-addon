// v0.1.95 Phase 4 C9-B 검증: 저항 감소로 '아군이' 더 넣는 피해를 점수에 넣은 뒤 실제로 올바르게 계산되는지.
//   node tools/c9b_check.js
// 보는 것: ① 저항 감소가 없으면 0 ② 아군 피해 유형별로 갈리는지 ③ 아군 일부·전체 누락 대체 경로
//   ④ 같은 효과를 아군도 들었을 때(보수적 합치기) ⑤ 아군 자신의 관통을 쓰는지 ⑥ 초당×6 과 한타 피해
//   ⑦ 173명 분포 (아군 몫 ÷ 내 한타 피해) ⑧ 아이템 단계별 ⑨ 캐시·성능
// 성공 조건은 '특정 아이템·증강의 순위 상승' 이 아니라 '값이 식대로 나오는가' 다.
const path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
global.Stats = St;
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (n) => d.items.find((i) => i.name === n);
const aug = (id) => d.augments.find((a) => a.id === id);
const r1 = (x) => Math.round(x * 10) / 10;
const ok = (b) => (b ? "✔" : "✘");

// 아군 한 명을 '엔진에 넘기는 모델' 로 만든다 (app.js allyInfo 와 같은 방법)
function model(id, names, level) {
  const c = champ(id), items = names.map(item).filter(Boolean);
  const L = level || 18;
  const BIG = 1e6, A = St.TARGET.ARMOR, M = St.TARGET.MR, HP = St.TARGET.HP;
  const at = (a, mr) => {
    St.setTarget({ ARMOR: a, MR: mr, HP: HP });
    return St.evaluate(c, L, items, [], OPTS);
  };
  const base = at(A, M);
  const dpsOf = (r) => (r.m.autoDps || 0) + (r.m.skillDps || 0);
  const dps = dpsOf(base);
  const tr = dpsOf(at(BIG, BIG));
  const ph = Math.max(0, dpsOf(at(A, BIG)) - tr);
  const mg = Math.max(0, dpsOf(at(BIG, M)) - tr);
  St.setTarget({ ARMOR: A, MR: M, HP: HP });
  const sum = ph + mg + Math.max(0, tr);
  const t = base.stats.total;
  return { name: c.id, dps: dps, phys: sum ? ph / sum : 0, magic: sum ? mg / sum : 0,
    pen: { ARPEN: t.ARPEN || 0, LETHALITY: t.LETHALITY || 0, MPENP: t.MPENP || 0, MPEN: t.MPEN || 0 },
    keys: (base.m.shred || {}).keys || {} };
}
// 내가 그 효과를 들었을 때의 지표
function me(id, names, augIds, level) {
  const c = champ(id), items = (names || []).map(item).filter(Boolean);
  const as = (augIds || []).length ? S.augStatsOf(augIds.map(aug).filter(Boolean), d.rules, c) : [];
  return St.evaluate(c, level || 18, items, as, OPTS).m;
}
const TEAMS = {
  "물리": [["Jhin", ["광전사의 군화", "무한의 대검", "정수 약탈자"]], ["Vayne", ["광전사의 군화", "크라켄 학살자"]],
    ["Garen", ["판금 장화", "삼위일체"]], ["LeeSin", ["판금 장화", "삼위일체"]]],
  "마법": [["Lux", ["마법사의 신발", "루덴의 메아리"]], ["Annie", ["마법사의 신발", "라바돈의 죽음모자"]],
    ["Brand", ["마법사의 신발", "리안드리의 고통"]], ["Karthus", ["마법사의 신발", "루덴의 메아리"]]],
  "혼합": [["Jhin", ["광전사의 군화", "무한의 대검"]], ["Lux", ["마법사의 신발", "루덴의 메아리"]],
    ["Garen", ["판금 장화", "삼위일체"]], ["Sona", ["명석함의 아이오니아 장화", "구원"]]],
  "고정 많음": [["Vayne", ["광전사의 군화", "크라켄 학살자"]], ["Fiora", ["판금 장화", "삼위일체"]],
    ["Darius", ["판금 장화", "삼위일체"]], ["Olaf", ["판금 장화", "삼위일체"]]],
};
const teamModels = {};
for (const k of Object.keys(TEAMS)) teamModels[k] = TEAMS[k].map((x) => model(x[0], x[1]));
const MINE = [["Garen", ["칠흑의 양날 도끼"], [], "칠흑(방어력 비율)"], ["Lux", ["악의"], [], "악의(고정 마저)"],
  ["Lux", ["리안드리의 고통"], ["ARAM_Erosion"], "부식(둘 다 비율)"], ["Lux", ["핏빛 저주"], [], "핏빛 저주(마저 비율)"]];

console.log("=== 1. 저항 감소가 없으면 아군 몫도 0 이어야 한다");
for (const x of [["Garen", []], ["Lux", ["루덴의 메아리"]], ["Jhin", ["무한의 대검"]]]) {
  St.setAllies(teamModels["물리"]);
  const m = me(x[0], x[1]);
  console.log(`  ${champ(x[0]).name} ${x[1].join("+") || "맨몸"}: 감소 ${r1(m.shred.armorShred * 100)}%/${r1(m.shred.mrShred * 100)}% → 아군 몫 ${r1(m.shredAlly.avg)} ${ok(m.shredAlly.avg === 0)}`);
}

console.log("\n=== 2. 아군 피해 유형에 따라 갈리는가 (아군 4명 · 평균 한 명분이 점수로)");
for (const x of MINE) {
  const line = [];
  for (const tn of Object.keys(teamModels)) {
    St.setAllies(teamModels[tn]);
    const m = me(x[0], x[1], x[2]);
    line.push(`${tn} 평균 ${Math.round(m.shredAlly.avg)} (합 ${Math.round(m.shredAlly.sum)})`);
  }
  St.setAllies(null);
  const base = me(x[0], x[1], x[2]);
  console.log(`  ${x[3]}: ${line.join(" · ")} | 아군 못 봤을 때(대체 모델) ${Math.round(base.shredAlly.avg)}`);
}

console.log("\n=== 3. 아군을 일부만 봤을 때 (모자란 인원을 기준 아군으로 채우지 않는다)");
{
  const full = teamModels["혼합"];
  for (const n of [4, 2, 1, 0]) {
    St.setAllies(n ? full.slice(0, n) : null);
    const m = me("Garen", ["칠흑의 양날 도끼"]);
    console.log(`  본 아군 ${n}명: 출처 ${m.shredAlly.source} · 센 인원 ${m.shredAlly.n} · 합 ${Math.round(m.shredAlly.sum)} · 점수에 들어가는 평균 ${Math.round(m.shredAlly.avg)}`);
  }
}

console.log("\n=== 4. 같은 효과를 아군도 들었을 때 (같은 효과는 큰 쪽만 — 보수적, 실게임 미검증)");
{
  const plain = model("Jhin", ["광전사의 군화", "무한의 대검"]);
  const withBC = model("Jhin", ["광전사의 군화", "칠흑의 양날 도끼"]);
  for (const x of [["아군 칠흑 없음", plain], ["아군도 칠흑", withBC]]) {
    St.setAllies([x[1]]);
    const m = me("Garen", ["칠흑의 양날 도끼"]);
    const allyShred = St.shredFold(x[1].keys);
    console.log(`  ${x[0]}: 내 감소 ${r1(m.shred.armorShred * 100)}% · 아군 감소 ${r1(allyShred.armorShred * 100)}%`
      + ` → 배율비 +${r1((m.shredAlly.per[0].physRatio - 1) * 100)}% · 기여 ${Math.round(m.shredAlly.avg)}`);
  }
  St.setAllies([model("Jhin", ["광전사의 군화", "악의"])]);
  const m2 = me("Garen", ["칠흑의 양날 도끼"]);
  console.log(`  같은 아군이 다른 효과(악의)를 들었을 때: 내 기여 ${Math.round(m2.shredAlly.avg)} (효과가 달라 겹치지 않는다 — 칠흑 없음과 같은 수준)`);
}

console.log("\n=== 5. 아군 자신의 관통을 쓰는가 (내 관통이 아니다)");
{
  const noPen = model("Jhin", ["광전사의 군화", "무한의 대검"]);
  const bigPen = model("Jhin", ["판금 장화", "세릴다의 원한", "도미닉 경의 인사"]);
  for (const x of [["관통 없는 아군", noPen], ["관통 많은 아군", bigPen]]) {
    St.setAllies([x[1]]);
    const m = me("Garen", ["칠흑의 양날 도끼"]);
    console.log(`  ${x[0]} (비율 관통 ${r1(x[1].pen.ARPEN * 100)}% · 고정 관통 ${r1(x[1].pen.LETHALITY)}):`
      + ` 배율비 +${r1((m.shredAlly.per[0].physRatio - 1) * 100)}% · 초당 ${Math.round(x[1].dps)} · 기여 ${Math.round(m.shredAlly.avg)}`);
  }
}

console.log("\n=== 6. 아군 초당 피해 × 6초 와 그 아군의 한타 피해 (단위 확인)");
for (const x of [["Jhin", ["광전사의 군화", "무한의 대검"]], ["Lux", ["마법사의 신발", "루덴의 메아리"]]]) {
  St.setAllies(null);
  const m = me(x[0], x[1]);
  const a = model(x[0], x[1]);
  console.log(`  ${champ(x[0]).name}: 초당 ${Math.round(a.dps)} × 6 = ${Math.round(a.dps * 6)} · 엔진 한타 피해 ${Math.round(m.combo)}`
    + ` (초당×6 이 ${r1((a.dps * 6 / Math.max(1, m.combo) - 1) * 100)}% 크다)`);
}

console.log("\n=== 7. 전 챔피언 173명: 아군 몫 ÷ 내 한타 피해 (칠흑 하나만 들었을 때)");
{
  St.setAllies(teamModels["혼합"]);
  const rows = [];
  for (const c of d.champions) {
    const m = St.evaluate(c, 18, [item("칠흑의 양날 도끼")], [], OPTS).m;
    if (!Number.isFinite(m.shredAlly.avg) || !Number.isFinite(m.allyDmg)) { console.log(`  ✘ ${c.name} 값이 숫자가 아니다`); continue; }
    rows.push({ name: c.name, r: m.shredAlly.avg / Math.max(1, m.combo), v: m.shredAlly.avg });
  }
  rows.sort((a, b) => a.r - b.r);
  const q = (p) => rows[Math.min(rows.length - 1, Math.floor(rows.length * p))];
  console.log(`  ${rows.length}명 모두 숫자 ✔ · 최소 ${r1(rows[0].r * 100)}% (${rows[0].name})`
    + ` · 중앙값 ${r1(q(0.5).r * 100)}% · 90% ${r1(q(0.9).r * 100)}% · 최대 ${r1(rows[rows.length - 1].r * 100)}% (${rows[rows.length - 1].name})`);
}

console.log("\n=== 8. 아이템 단계별 (초반 1칸 · 중반 3칸 · 후반 6칸)");
{
  St.setAllies(teamModels["혼합"]);
  const sets = [["초반", ["칠흑의 양날 도끼"]], ["중반", ["칠흑의 양날 도끼", "판금 장화", "삼위일체"]],
    ["후반", ["칠흑의 양날 도끼", "판금 장화", "삼위일체", "스테락의 도전", "죽음의 무도", "태양불꽃 방패"]]];
  for (const x of sets) {
    const m = me("Garen", x[1]);
    console.log(`  ${x[0]}(${x[1].length}칸): 내 감소 ${r1(m.shred.armorShred * 100)}% · 내 한타 ${Math.round(m.combo)} · 아군 몫 ${Math.round(m.shredAlly.avg)} (${r1(m.shredAlly.avg / m.combo * 100)}%)`);
  }
}

console.log("\n=== 9. 캐시·성능");
{
  const c = champ("Garen"), w = S.profile(c, d.tags);
  // 기억(memo)을 쓰는 길로 잰다: 빌드 추천 (rankItems 는 기억을 쓰지 않는다)
  const run = () => S.buildConcepts(d.items, w, [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item.name).join(",");
  St.setAllies(teamModels["혼합"]); S.clearMemo();
  let t0 = Date.now(); const a1 = run(); const first = Date.now() - t0;
  t0 = Date.now(); const a2 = run(); const cached = Date.now() - t0;
  St.setAllies(teamModels["마법"]);
  t0 = Date.now(); const b1 = run(); const other = Date.now() - t0;
  St.setAllies(teamModels["혼합"]);
  const a3 = run();
  console.log(`  같은 아군 두 번: ${a1 === a2 ? "같다 ✔" : "다르다 ✘"} (${first}ms → ${cached}ms)`);
  console.log(`  아군을 바꾸면 다시 센다: ${other}ms · 결과 ${b1 === a1 ? "같음" : "달라짐"}`);
  console.log(`  아군을 되돌리면 원래 결과: ${a3 === a1 ? "같다 ✔" : "다르다 ✘"}`);
  const st = S.memoStats ? S.memoStats() : null;
  if (st) console.log(`  기억 적중 ${st.hit} · 빗나감 ${st.miss}`);
  const t1 = Date.now();
  for (let i = 0; i < 20; i++) St.evaluate(c, 18, [item("칠흑의 양날 도끼")], [], OPTS);
  console.log(`  저항 감소 들고 20번 계산: ${Date.now() - t1}ms`);
}
St.setAllies(null);

console.log("");
console.log("=== 10. 아군 정보가 있는 합성 장면: 대체 모델과 실제 아군 팀의 추천 차이");
{
  const REPS = ["Jinx", "Ezreal", "Lux", "Annie", "Malphite", "Garen", "Zed", "Sona", "Darius", "Yasuo", "Vayne", "Nami",
    "Varus", "Caitlyn", "Jhin", "Kayle"];
  const top6 = (c) => {
    const w = S.profile(c, d.tags);
    return S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced").filter((r) => r.item.kind === "legendary")
      .slice(0, 6).map((r) => r.item.name);
  };
  const run = (models) => { St.setAllies(models); S.clearMemo(); const o = {}; for (const id of REPS) o[id] = top6(champ(id)); return o; };
  const base = run(null);
  for (const tn of Object.keys(teamModels)) {
    const now = run(teamModels[tn]);
    const diff = REPS.filter((id) => now[id].join() !== base[id].join());
    const first = REPS.filter((id) => now[id][0] !== base[id][0]);
    console.log(`  ${tn} 팀: 대체 모델과 Top6 가 다른 챔피언 ${diff.length}/16 · 1순위가 다른 챔피언 ${first.length}`
      + (diff.length ? ` (${diff.map((id) => champ(id).name).join(", ")})` : ""));
  }
  St.setAllies(null);
}
