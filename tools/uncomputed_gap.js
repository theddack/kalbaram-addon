// P4-B 우선순위: 고유 효과가 계산되지 않는 아이템이 '공식 추천인데 우리 균형 빌드에 못 들어가는' 정도를 잰다.
//   node tools/uncomputed_gap.js            요약 (공식 추천 수 · 우리 빌드 수 · 바꿔 넣었을 때 점수 차이)
//   node tools/uncomputed_gap.js --json 파일
// 재는 법: 그 아이템이 공식 추천인 챔피언마다, 균형 빌드의 전설 아이템 한 칸을 이 아이템으로 바꿔 같은 목표 함수로 다시 점수를 낸다.
//   가장 덜 손해인 교체의 점수 차이(%)가 '0에 가까울수록' 계산만 더해지면 빌드에 들어올 가능성이 커요.
// 계산 결과끼리의 비교예요. 실게임 검증이 아니에요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
require("./exp_env")(S, global.Stats);
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
S.attachSimilar(d.champions, null, d.items);
const { audit } = require("./item_audit.js");
const UNCOMPUTED = /계산되지 않음|일부만/;

function candidates() {
  const { rows } = audit(d);
  const out = new Map();
  for (const r of rows) {
    if (r.kind !== "legendary" && r.kind !== "boots") continue;
    const un = (r.sections || []).filter((s) => UNCOMPUTED.test(s.status || ""));
    if (un.length) out.set(r.name, un.map((s) => `${s.name}[${s.status}]`).join(" · "));
  }
  return out;
}

function run() {
  const cand = candidates();
  const officialOf = (c) => (c.officialItems && c.officialItems.mode === "ARAM" ? new Set(c.officialItems.ranges.flat()) : null);
  const stat = new Map();  // 아이템 이름 → {off, inBuild, gaps: []}
  for (const c of d.champions.filter((x) => x.spells)) {
    const off = officialOf(c);
    if (!off) continue;
    const w = S.profile(c, d.tags);
    const built = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0];
    const picks = built.pick.map((p) => p.item);
    const cur = built.scoreOf(picks.map((i) => i));
    const have = new Set(picks.map((i) => i.name));
    for (const id of off) {
      const it = d.items.find((i) => i.id === id);
      if (!it || !cand.has(it.name) || (it.kind !== "legendary" && it.kind !== "boots")) continue;
      const s = stat.get(it.name) || { off: 0, inBuild: 0, gaps: [] };
      s.off++;
      if (have.has(it.name)) { s.inBuild++; stat.set(it.name, s); continue; }
      let best = -Infinity;
      for (let k = 0; k < picks.length; k++) {
        if (picks[k].kind !== it.kind) continue;
        const alt = picks.slice(); alt[k] = it;
        best = Math.max(best, built.scoreOf(alt));
      }
      if (best > -Infinity) s.gaps.push((best - cur) / Math.abs(cur) * 100);
      stat.set(it.name, s);
    }
  }
  const rows = [...stat].map(([name, s]) => ({
    name, why: cand.get(name), off: s.off, inBuild: s.inBuild,
    best: s.gaps.length ? Math.max(...s.gaps) : null,
    median: s.gaps.length ? [...s.gaps].sort((a, b) => a - b)[s.gaps.length >> 1] : null,
  })).sort((a, b) => (b.off - b.inBuild) - (a.off - a.inBuild) || (b.best || -99) - (a.best || -99));
  return rows;
}

if (require.main === module) {
  const rows = run();
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows));
  console.log("고유 효과가 계산되지 않는 아이템 · 공식 추천인데 우리 빌드에 없는 경우 (점수 차이 = 한 칸 바꿔 넣었을 때, 0에 가까울수록 들어오기 쉬움)");
  for (const r of rows) {
    if (r.off === r.inBuild) continue;
    console.log(`  ${r.name.padEnd(14)} 공식 ${String(r.off).padStart(3)} · 우리 ${String(r.inBuild).padStart(3)} · 점수 차이 최선 ${r.best == null ? "—" : r.best.toFixed(1) + "%"} 중앙 ${r.median == null ? "—" : r.median.toFixed(1) + "%"} · ${r.why}`);
  }
}
module.exports = { run };
