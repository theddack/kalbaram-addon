// 증강 조합별 아이템 Top3 를 저장한다 (수정 전후 비교용).
//   node tools/aug_top3_dump.js <결과파일>
// web/scoring.js 는 require("./stats.js") 로 계산 엔진을 파일에서 바로 읽는다 → global.Stats 교체로는 비교가 안 된다.
// 수정 전후를 견주려면 web/stats.js 파일을 바꿔 끼우고 이 스크립트를 따로 두 번 돌려야 한다.
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const AUG_VAMP = "ARAM_SustainingStrike", AUG_CIRCLE = "ARAM_CircleofDeath";
const augOf = (id) => d.augments.find((a) => a.id === id);
const COMBOS = [["없음", []], ["흡수", [AUG_VAMP]], ["죽음의 순환", [AUG_CIRCLE]], ["둘 다", [AUG_VAMP, AUG_CIRCLE]]];
const out = {};
for (const [label, ids] of COMBOS) {
  const chosen = ids.map(augOf).filter(Boolean);
  for (const c of d.champions) {
    const as = chosen.length ? S.augStatsOf(chosen, d.rules, c) : [];
    const m = St.evaluate(c, 18, [], as, OPTS).m;
    const w = S.profile(c, d.tags);
    const rows = S.rankItems(d.items, w, chosen, [], d.rules, c, OPTS, chosen.length ? "augment" : "balanced");
    out[`${label}:${c.id}`] = {
      top3: rows.filter((r) => r.item.kind === "legendary").slice(0, 3).map((r) => r.item.name),
      score3: rows.filter((r) => r.item.kind === "legendary").slice(0, 3).map((r) => Math.round(r.score * 1e4) / 1e4),
      m: { selfHealAll: m.selfHealAll, heal: m.heal, shield: m.shield, support: m.support, ehp: m.ehp, combo: m.combo },
    };
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(`저장 ${process.argv[2]} — ${Object.keys(out).length}장면`);
