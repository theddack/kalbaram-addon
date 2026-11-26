// v0.1.95 F5-E: 토글 장판(신지드 Q 맹독의 자취·카서스 E 부패)의 가동률에 따라 추천이 얼마나 달라지는지.
//   node tools/f5e_uptime.js
// 가동률 = 한타 동안 그 장판이 켜져 있고 적이 그 안에 있는 시간 비율.
// 엔진 기본값은 100% 이고, '실제로 맞히는 비율' 은 다른 스킬과 똑같이 공통 가정(SKILL_DPS_SHARE 30%)이 바깥에서 건다.
// 주의: stats.js 는 효과 배열을 WeakMap 으로 외워 두므로, 값을 바꿀 때는 새 객체로 통째로 갈아 끼워야 한다.
const path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
global.Stats = St;
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const TARGETS = [["Singed", "Q", "damagepersecond"], ["Karthus", "E", "totaldps"]];

function setUptime(id, slot, name, u) {
  const c = d.champions.find((x) => x.id === id);
  const sp = c.spells.find((s) => s.slot === slot);
  const orig = sp.__orig || (sp.__orig = sp.effects);
  sp.effects = orig.map((e) => (e.name !== name ? e
    : { ...e, base: (e.base || []).map((v) => v * u), ...(e.lvl ? { lvl: e.lvl.map((v) => v * u) } : {}),
        ...(e.ratios ? { ratios: Object.fromEntries(Object.entries(e.ratios).map(([k, a]) => [k, a.map((v) => v * u)])) } : {}) }));
  if (S.clearMemo) S.clearMemo();
}

function row(id) {
  const c = d.champions.find((x) => x.id === id);
  const w = S.profile(c, d.tags);
  const m = St.evaluate(c, 18, [], [], OPTS).m;
  const top = S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced")
    .filter((r) => r.item.kind === "legendary").slice(0, 3).map((r) => r.item.name);
  const build = S.buildConcepts(d.items, w, [], [], d.rules, c, OPTS, ["balanced"])[0].pick.map((p) => p.item.name);
  return { combo: Math.round(m.combo), skillDps: Math.round(m.skillDps), dps: Math.round(m.dps), top, build };
}

console.log("=== 토글 장판 가동률 민감도 (18레벨, 아이템 없이 평가 · 추천은 균형 빌드)");
for (const [id, slot, name] of TARGETS) {
  const c = d.champions.find((x) => x.id === id);
  console.log(`\n[${c.name} ${slot}]`);
  let base = null;
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    setUptime(id, slot, name, u);
    const r = row(id);
    if (u === 0) base = r;
    const t3 = r.top.join(" / ");
    console.log(`  가동률 ${String(u * 100).padStart(3)}% → 콤보 ${String(r.combo).padStart(5)} · 초당 스킬 ${String(r.skillDps).padStart(4)}`
      + ` · 종합 초당 ${String(r.dps).padStart(4)} · Top3 ${t3}`
      + (JSON.stringify(r.top) === JSON.stringify(base.top) ? "" : "  ← 0% 와 다름")
      + (JSON.stringify(r.build) === JSON.stringify(base.build) ? "" : `  [빌드 바뀜: ${r.build.filter((x) => !base.build.includes(x)).join(", ") || "순서"}]`));
  }
  setUptime(id, slot, name, 1);  // 되돌리기 (기본값 100%)
}
console.log("\n기본값: 100% (활성 시간). 실제로 맞히는 비율은 다른 스킬과 같은 공통 가정이 바깥에서 건다.");
