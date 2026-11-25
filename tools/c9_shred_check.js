// v0.1.95 Phase 4 C9-A1·A2·A2.5 검증: 저항 감소 공통 계산 순서를 넣은 뒤 추천 결과가 그대로인지 수정 전후로 견준다.
//   node tools/c9_shred_check.js --dump <결과파일>   지금 web/stats.js 로 장면 전부를 계산해 저장
//   node tools/c9_shred_check.js --cmp <전> <후>     저장한 두 결과를 견준다
//   node tools/c9_shred_check.js                     수정 뒤 값만 본다 (핏빛 저주·음수 저항)
// 주의: web/scoring.js 는 3번째 줄에서 require("./stats.js") 로 계산 엔진을 고정해 읽는다.
//   global.Stats 를 바꿔치기해도 점수 쪽은 안 바뀐다 → 수정 전후 비교는 '파일을 바꿔 끼우고 따로 실행'해야 한다.
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
const OPTS = { aram: true };
const R = require(path.join(__dirname, "rec_baseline.js"));
const S = require(W + "scoring.js");
const St = global.Stats;

// ---- 실게임 기록에서 뽑은 장면 (판마다 챔피언·레벨·산 아이템·고른 증강·그때 기준 상대)
function gameScenes(root) {
  const out = [], seen = new Set();
  const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
  for (const g of games) {
    const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
    let champ = null, items = [], level = 1, augs = [], target = null;
    for (const x of ev) {
      if (x.kind === "start") champ = x.champion;
      if (x.kind === "items") { items = x.items || []; level = x.level || level; }
      if (x.kind === "picked" && x.picked) augs = augs.concat([x.picked]);
      if (x.kind === "enemy" && x.target) target = x.target;
      if (!champ || !target) continue;
      const key = [g, champ, level, items.join("|"), augs.join("|"), target.ARMOR, target.MR, target.HP].join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ game: g, t: x.t, champ, level, items: items.slice(), augs: augs.slice(), target: { ...target } });
    }
  }
  return out;
}

function rankOf(d, sc) {
  const c = d.champions.find((x) => x.id === sc.champ || x.name === sc.champ);
  if (!c) return null;
  const chosen = sc.augs.map((n) => d.augments.find((a) => a.name === n || a.id === n)).filter(Boolean);
  const fixed = sc.items.map((n) => d.items.find((i) => i.name === n || i.id === n)).filter(Boolean);
  St.setTarget({ ARMOR: sc.target.ARMOR, MR: sc.target.MR, HP: sc.target.HP,
    ...(sc.target.bonusHP != null ? { bonusHP: sc.target.bonusHP } : {}),
    ...(sc.target.HEAL != null ? { HEAL: sc.target.HEAL } : {}) });
  const r = R.ranking(d, c, chosen, fixed, OPTS);
  St.setTarget(null);
  return r;
}

const argv = process.argv.slice(2);
const LOGS = process.env.GAME_LOGS || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";

if (argv[0] === "--dump") {
  const d = R.load();
  S.attachSimilar(d.champions, null, d.items);
  const t0 = Date.now();
  const base = R.snapshot(d);
  const scenes = gameScenes(LOGS);
  const game = {};
  for (const sc of scenes) {
    const r = rankOf(d, sc);
    if (r) game[`${sc.game}:${sc.t}`] = { top: r.top, raw: r.raw, input: { champ: sc.champ, level: sc.level, items: sc.items, augs: sc.augs, target: sc.target } };
  }
  fs.writeFileSync(argv[1], JSON.stringify({ baseline: base, game, version: d.version, builtAt: d.builtAt }, null, 0));
  console.log(`저장 ${argv[1]} — 기준선 ${Object.keys(base.scenes).length}장면 · 실게임 ${Object.keys(game).length}장면 (${Date.now() - t0}ms)`);
  process.exit(0);
}

if (argv[0] === "--cmp") {
  const a = JSON.parse(fs.readFileSync(argv[1], "utf8")), b = JSON.parse(fs.readFileSync(argv[2], "utf8"));
  console.log("=== 1. 기준선 장면 (solo 173 · aug 48 · tiers 16 · game 26)");
  console.log(`  장면 ${Object.keys(b.baseline.scenes).length}개`);
  R.report(R.compare(a.baseline, b.baseline), a.baseline, b.baseline);
  console.log("\n=== 2. 실게임 기록 장면");
  const keys = Object.keys(b.game);
  let top1 = 0, top3 = 0, top6 = 0, score = 0, maxd = 0, rawMoved = 0, miss = 0;
  const ex = [];
  for (const k of keys) {
    const x = a.game[k], y = b.game[k];
    if (!x) { miss++; continue; }
    const na = x.top.map((v) => v.name), nb = y.top.map((v) => v.name);
    if (na[0] !== nb[0]) { top1++; if (ex.length < 5) ex.push(`${k}: ${na[0]} → ${nb[0]}`); }
    if (JSON.stringify(na.slice(0, 3)) !== JSON.stringify(nb.slice(0, 3))) top3++;
    if (JSON.stringify(na) !== JSON.stringify(nb)) top6++;
    if (JSON.stringify(x.raw) !== JSON.stringify(y.raw)) rawMoved++;
    const sb = new Map(y.top.map((v) => [v.name, v.score]));
    let moved = false;
    for (const v of x.top) if (sb.has(v.name)) { const dd = Math.abs(v.score - sb.get(v.name)); if (dd > 1e-9) { moved = true; maxd = Math.max(maxd, dd); } }
    if (moved) score++;
  }
  console.log(`  장면 ${keys.length}개 · 1순위 바뀜 ${top1} · Top3 바뀜 ${top3} · Top6 바뀜 ${top6}`);
  console.log(`  점수 바뀐 장면 ${score} (최대 ${maxd}) · 계산 순서(tieOrder 전) 바뀜 ${rawMoved} · 한쪽에만 있는 장면 ${miss}`);
  if (ex.length) console.log("  " + ex.join(" / "));
  process.exit(0);
}

// ---- 지금 값만 보기
const d = R.load();
S.attachSimilar(d.champions, null, d.items);
console.log("=== 핏빛 저주 (A2.5 중첩 평균 1.5 가정 유지)");
{
  const blight = d.items.find((i) => i.name === "핏빛 저주"), lux = d.champions.find((c) => c.id === "Lux");
  const cv = St.computeStats(lux, 18, [blight], [], OPTS).conv;
  const mr = St.TARGET.MR;
  const before = 100 / (100 + mr), after = St.mitigation ? St.mitigation(mr, 0, 0, cv.mrShred || 0, cv.mrFlatShred || 0) : 100 / (100 + mr * (1 - (cv.mrShred || 0)));
  console.log(`  규칙 mrShred ${cv.mrShred} · 기준 상대 마저 ${mr} → 깎인 뒤 ${(mr * (1 - (cv.mrShred || 0))).toFixed(2)}`);
  console.log(`  마법 피해 배율 ${before.toFixed(5)} → ${after.toFixed(5)} (+${((after / before - 1) * 100).toFixed(2)}%)`);
}
console.log("\n=== 저항이 0 아래로 내려가는 조합 (1차 구현은 0 에서 자른다)");
{
  const pen = d.items.filter((i) => i.stats && (i.stats.LETHALITY || i.stats.MPEN || i.stats.ARPEN || i.stats.MPENP)).slice(0, 6);
  let worstA = Infinity, worstM = Infinity, who = "";
  for (const c of d.champions) {
    const t = St.computeStats(c, 18, pen, [], OPTS).total;
    const a = St.TARGET.ARMOR * (1 - (t.ARPEN || 0)) - (t.LETHALITY || 0);
    const m = St.TARGET.MR * (1 - (t.MPENP || 0)) - (t.MPEN || 0);
    if (a < worstA) { worstA = a; who = c.name; }
    worstM = Math.min(worstM, m);
  }
  console.log(`  관통만으로 가장 낮아진 저항: 방어력 ${worstA.toFixed(1)} · 마법 저항력 ${worstM.toFixed(1)} (${who} 기준, 관통 아이템 ${pen.length}칸)`);
  console.log(`  → 음수가 ${worstA < 0 || worstM < 0 ? "생긴다 (C9-A4 전에 처리 필요)" : "생기지 않는다 (0 클램프가 실제로 쓰이지 않는다)"}`);
}
