// P3 태그 점수 몫 점검: 균형 빌드(증강 없음) 아이템 점수를 수치 · 태그(능력치 선호 / 계산된 효과 / 미계산 효과) · 그 밖(공식 추천·증강 연계 가산)으로 나눈다.
//   node tools/tag_share.js            요약 (역할별·아군 지원 챔피언)
//   node tools/tag_share.js --champs Lux,Soraka   챔피언별 아이템 분해
// 태그 분류는 tools/tag_overlap.js 판정(계산됨 여부)을 그대로 쓴다. 계산 결과끼리의 비교예요.
const path = require("path");
const W = path.join(__dirname, "..", "web");
global.Stats = global.Stats || require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const EXP_LABEL = require("./exp_env")(S, global.Stats);
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const TAG_K = 0.4;  // scoring.TAG_K
const audit = require("./tag_overlap.js").audit(d);
const cls = {};  // 아이템 이름 → 태그 → 분류
for (const r of audit) { cls[r.name] = {}; for (const [t, v] of Object.entries(r.tags)) cls[r.name][t] = v.type === "능력치" ? "stat" : v.computed ? "fxCalc" : "fxNone"; }
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

function split(c) {
  const w = S.profile(c, d.tags);
  const picks = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick;
  const tot = { num: 0, stat: 0, fxCalc: 0, fxNone: 0, other: 0 };
  const rows = [];
  for (const p of picks) {
    const t = (p.tagScore || 0) * TAG_K, num = p.score - t;
    const r = { item: p.item.name, num, stat: 0, fxCalc: 0, fxNone: 0, other: 0, tags: {} };
    let sum = 0;
    for (const q of p.parts || []) { const k = (cls[p.item.name] || {})[q.tag] || "fxNone"; const v = q.value * TAG_K * (p.mismatch ? 0 : 1); r[k] += v; sum += v; r.tags[q.tag] = +(q.value * TAG_K).toFixed(3); }
    r.other = t - sum;
    for (const k of Object.keys(tot)) tot[k] += r[k];
    rows.push(r);
  }
  return { id: c.id, name: c.name, role: c.tags[0], sup: (c.features || []).includes("allysupport"), hs: w.HEALSHIELD, tot, rows };
}

const champs = arg("--champs") ? arg("--champs").split(",").map((id) => d.champions.find((c) => c.id === id)) : d.champions.filter((c) => c.spells);
const res = champs.map(split);
const pct = (o) => { const s = Object.values(o).reduce((a, b) => a + Math.abs(b), 0) || 1; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(100 * v / s)])); };
const LBL = { num: "수치", stat: "능력치 태그", fxCalc: "계산된 효과 태그", fxNone: "미계산 효과 태그", other: "공식·연계 가산" };
const show = (o) => Object.entries(pct(o)).map(([k, v]) => `${LBL[k]} ${v}%`).join(" · ");
console.log(`P3 태그 몫 ${EXP_LABEL ? "(" + EXP_LABEL + ")" : ""} · 균형 빌드 아이템 점수 합 기준`);
if (arg("--champs")) {
  for (const r of res) { console.log(`\n${r.name} (HEALSHIELD 가중치 ${r.hs}) ${show(r.tot)}`); for (const x of r.rows) console.log(`  ${x.item.padEnd(12)} 수치 ${x.num.toFixed(2)} · 능력치 ${x.stat.toFixed(2)} · 계산된 효과 ${x.fxCalc.toFixed(2)} · 미계산 ${x.fxNone.toFixed(2)} · 가산 ${x.other.toFixed(2)} | ${JSON.stringify(x.tags)}`); }
} else {
  const sum = (rs) => rs.reduce((a, r) => { for (const k of Object.keys(a)) a[k] += r.tot[k]; return a; }, { num: 0, stat: 0, fxCalc: 0, fxNone: 0, other: 0 });
  console.log(`  전체 ${res.length}명: ${show(sum(res))}`);
  for (const role of ["Marksman", "Mage", "Tank", "Fighter", "Assassin", "Support"]) { const rs = res.filter((r) => r.role === role); console.log(`  ${role} ${rs.length}명: ${show(sum(rs))}`); }
  const sp = res.filter((r) => r.sup); console.log(`  아군 지원 ${sp.length}명: ${show(sum(sp))}`);
}
module.exports = { split };
