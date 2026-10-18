// 라이엇 공식 추천 아이템과 우리 기본 추천(증강 없음·균형 빌드) 비교.
// 공식 추천을 가산점으로 넣기 전·후를 같은 기준으로 잰다 (실제 게임 결과가 아니라 '공식 핵심을 얼마나 담나'와 '챔피언마다 다른가').
//   node tools/official_check.js          요약
//   node tools/official_check.js --list   챔피언별 표
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));

function measure(d, withOfficial) {
  const rows = [];
  for (const c0 of d.champions) {
    const c = withOfficial ? c0 : { ...c0, officialItems: null };
    const w = S.profile(c, d.tags);
    const pick = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
    const o = c0.officialItems;
    const row = { id: c0.id, name: c0.name, roles: c0.tags, build: pick.map((i) => i.id), mode: o ? o.mode : null };
    if (o && o.mode === "ARAM") {
      const all = new Set(o.ranges.flat());
      row.core = pick.some((i) => o.ranges[0].includes(i.id));
      row.overlap = pick.filter((i) => all.has(i.id)).length;
    }
    rows.push(row);
  }
  return rows;
}

function summary(rows) {
  const aram = rows.filter((r) => r.mode === "ARAM");
  const same = {};
  for (const r of rows) {
    const k = `${r.roles[0]}|${[...r.build].sort().join(",")}`;
    same[k] = (same[k] || 0) + 1;
  }
  const dup = Object.values(same).filter((n) => n > 1).reduce((a, n) => a + n, 0);
  return {
    aram: aram.length,
    coreHit: aram.filter((r) => r.core).length,
    overlapAvg: +(aram.reduce((a, r) => a + r.overlap, 0) / Math.max(1, aram.length)).toFixed(2),
    sameBuild: dup,  // 같은 주 역할 안에서 6칸 구성이 다른 챔피언과 똑같은 챔피언 수
    distinct: new Set(rows.map((r) => [...r.build].sort().join(","))).size,
  };
}

if (require.main === module) {
  const d = require(path.join(WEB, "data.json"));
  const before = measure(d, false);
  S.clearMemo();
  const after = measure(d, true);
  const b = summary(before), a = summary(after);
  console.log(`공식 칼바람 추천이 있는 챔피언 ${a.aram}명 (일반 게임만 ${after.filter((r) => r.mode === "CLASSIC").length}명 · 없음 ${after.filter((r) => !r.mode).length}명)`);
  console.log(`핵심 아이템을 담은 챔피언   : ${b.coreHit} → ${a.coreHit} / ${a.aram}`);
  console.log(`공식 추천과 겹치는 칸 (평균) : ${b.overlapAvg} → ${a.overlapAvg} / 6`);
  console.log(`같은 역할에서 구성이 똑같은 챔피언 : ${b.sameBuild} → ${a.sameBuild} / ${after.length}`);
  console.log(`서로 다른 구성 수           : ${b.distinct} → ${a.distinct}`);
  if (process.argv.includes("--list")) {
    const name = (id) => (d.items.find((i) => i.id === id) || {}).name || id;
    for (const r of after) console.log(`${r.name}\t${r.mode || "-"}\t${r.build.map(name).join(" · ")}`);
  }
}

module.exports = { measure, summary };
