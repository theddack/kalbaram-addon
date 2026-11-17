// P2 서포터 평가 척도 점검: 지표 기준값(맨몸, 최소 METRIC_FLOOR)이 '맨몸 지표가 작은 챔피언'의 작은 증가를 얼마나 키우는지 잰다.
//   node tools/scale_check.js            요약 (바닥값에 걸린 챔피언 수, 서포터 균형 빌드 아이템별 가치 분해)
//   node tools/scale_check.js --json     전체 결과 JSON
// 계산 결과끼리의 비교이고 실게임 아님. 목표 함수는 바꾸지 않는다 (분석 전용).
const path = require("path");
const W = path.join(__dirname, "..", "web");
global.Stats = global.Stats || require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const EXP_LABEL = require("./exp_env")(S, global.Stats);
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };  // scoring.METRIC_FLOOR
const KEYS = Object.keys(FLOOR);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const isSup = (c) => (c.features || []).includes("allysupport");

function champRow(c) {
  const w = S.profile(c, d.tags);
  const mw = S.conceptMetricWeights(w, [], d.rules, c, S.CONCEPTS[1]);
  const empty = Stats.evaluate(c, 18, [], [], {}).m;
  const norm = Object.fromEntries(KEYS.map((k) => [k, Math.max(empty[k] || 0, FLOOR[k])]));
  const build = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
  const full = Stats.evaluate(c, 18, build, [], {}).m;
  // 아이템별 가치 분해: 빌드에서 그 아이템만 뺐을 때 지표별 mw·Δ/norm
  const parts = build.map((it) => {
    const m0 = Stats.evaluate(c, 18, build.filter((x) => x !== it), [], {}).m;
    const p = {};
    for (const k of KEYS) p[k] = (mw[k] || 0) * ((full[k] || 0) - (m0[k] || 0)) / norm[k];
    return { item: it.name, parts: p, raw: Object.fromEntries(KEYS.map((k) => [k, (full[k] || 0) - (m0[k] || 0)])) };
  });
  return { id: c.id, name: c.name, role: c.tags[0], sup: isSup(c), mw, empty, norm, full, build: build.map((i) => i.name), parts };
}

const rows = d.champions.filter((c) => c.spells).map(champRow);
if (process.argv.includes("--json")) { console.log(JSON.stringify(rows)); process.exit(0); }
const f = (x, n = 0) => (+x).toFixed(n);
console.log(`P2 척도 점검 ${EXP_LABEL ? "(" + EXP_LABEL + ")" : ""} · 챔피언 ${rows.length}명 (아군 지원 ${rows.filter((r) => r.sup).length})`);
for (const k of ["combo", "support"]) {
  for (const g of [["전체", rows], ["아군 지원", rows.filter((r) => r.sup)], ["그 외", rows.filter((r) => !r.sup)]]) {
    const e = g[1].map((r) => r.empty[k] || 0), fl = g[1].filter((r) => (r.empty[k] || 0) < FLOOR[k]).length;
    console.log(`  ${k} 맨몸 ${g[0]}: 중앙값 ${f(med(e))} · 바닥값(${FLOOR[k]}) 아래 ${fl}/${g[1].length} · 완성 빌드 중앙값 ${f(med(g[1].map((r) => r.full[k] || 0)))}`);
  }
}
console.log("\n아군 지원 챔피언: 지표 가중치(콤보·지원)·맨몸→완성(콤보·지원)·지원 아이템 가치 몫");
for (const r of rows.filter((x) => x.sup).sort((a, b) => a.empty.support - b.empty.support)) {
  const tot = r.parts.reduce((s, p) => s + Object.values(p.parts).reduce((a, b) => a + b, 0), 0);
  const sup = r.parts.reduce((s, p) => s + p.parts.support, 0), cmb = r.parts.reduce((s, p) => s + p.parts.combo, 0);
  console.log(`  ${r.name.padEnd(6)} mw ${f(r.mw.combo, 2)}/${f(r.mw.support, 2)} · 콤보 ${f(r.empty.combo)}→${f(r.full.combo)} · 지원 ${f(r.empty.support)}→${f(r.full.support)} · 가치 콤보 ${f(100 * cmb / tot)}% 지원 ${f(100 * sup / tot)}%`);
}
const SUPPORT_ITEMS = ["월석 재생기", "헬리아의 메아리", "구원", "미카엘의 축복", "강철의 솔라리 펜던트", "흐르는 물의 지팡이", "불타는 향로", "슈렐리아의 군가"];  // tools/champ_fit.js 와 같게
const supRows = rows.filter((r) => r.sup);
console.log(`
서포터 아이템 합: 아군 지원 ${supRows.reduce((s, r) => s + r.build.filter((n) => SUPPORT_ITEMS.includes(n)).length, 0)} · 그 외 ${rows.filter((r) => !r.sup).reduce((s, r) => s + r.build.filter((n) => SUPPORT_ITEMS.includes(n)).length, 0)}`);
module.exports = { champRow };
