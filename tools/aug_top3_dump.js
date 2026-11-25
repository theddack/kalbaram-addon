// 증강 조합별 아이템 Top3 를 저장한다 (수정 전후 비교용).
//   node tools/aug_top3_dump.js <결과파일>      지금 엔진으로 계산해 저장 (엔진 지문을 함께 남긴다)
//   node tools/aug_top3_dump.js --cmp <전> <후>  저장한 두 결과를 견준다
// web/scoring.js 는 require("./stats.js") 로 계산 엔진을 파일에서 바로 읽는다 → global.Stats 교체로는 비교가 안 된다.
// 수정 전후를 견주려면 web/stats.js 파일을 바꿔 끼우고 이 스크립트를 따로 두 번 돌려야 한다.
const path = require("path"), fs = require("fs");
const FP = require("./engine_fp.js");

if (process.argv[2] === "--cmp") {
  const a = JSON.parse(fs.readFileSync(process.argv[3], "utf8")), b = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  const eng = FP.printEngines(a.engine, b.engine);
  if (!eng.ok) console.log("  (아래 '달라진 것 없음' 은 이 상태에서는 근거가 되지 않는다)");
  const A = a.scenes || a, B = b.scenes || b;   // 지문 없던 옛 결과 파일도 읽는다
  const per = {};
  for (const k of Object.keys(B)) {
    const label = k.split(":")[0], x = A[k], y = B[k];
    const p = per[label] || (per[label] = { 장면: 0, top1: 0, 구성: 0, 순서: 0, 없음: 0 });
    p.장면++;
    if (!x) { p.없음++; continue; }
    if (x.top3[0] !== y.top3[0]) p.top1++;
    if (JSON.stringify([...x.top3].sort()) !== JSON.stringify([...y.top3].sort())) p.구성++;
    else if (JSON.stringify(x.top3) !== JSON.stringify(y.top3)) p.순서++;
  }
  for (const [label, p] of Object.entries(per)) {
    console.log(`  [${label}] 장면 ${p.장면} · 1순위 ${p.top1} · Top3 구성 ${p.구성} · 순서만 ${p.순서}` + (p.없음 ? ` · 한쪽에만 ${p.없음}` : ""));
  }
  process.exit(0);
}

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
fs.writeFileSync(process.argv[2], JSON.stringify({ engine: FP.fingerprint(), scenes: out }));
console.log(`저장 ${process.argv[2]} — ${Object.keys(out).length}장면`);
