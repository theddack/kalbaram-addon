// v0.1.95 Phase 4 C9-A1·A2·A2.5 검증: 저항 감소 공통 계산 순서를 넣은 뒤 추천 결과가 그대로인지 수정 전후로 견준다.
//   node tools/c9_shred_check.js --dump <결과파일> [--scenes game] [--limit N] [--inputs 라벨]   지금 web/stats.js 로 계산해 저장
//   node tools/c9_shred_check.js --cmp <전> <후>     저장한 두 결과를 견준다 (엔진 지문부터 찍는다)
//   node tools/c9_shred_check.js --positive          양성 대조: 엔진을 일부러 틀리게 바꿔 끼우고 '차이를 잡는지' 본다
//   node tools/c9_shred_check.js                     수정 뒤 값만 본다 (핏빛 저주·음수 저항)
// 주의: web/scoring.js 는 3번째 줄에서 require("./stats.js") 로 계산 엔진을 고정해 읽는다.
//   global.Stats 를 바꿔치기해도 점수 쪽은 안 바뀐다 → 수정 전후 비교는 '파일을 바꿔 끼우고 따로 실행'해야 한다.
//   그게 지켜졌는지는 결과 파일에 함께 저장하는 엔진 지문(tools/engine_fp.js)으로 확인한다.
const path = require("path"), fs = require("fs");
const FP = require("./engine_fp.js");
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

const flag = (name, dflt = null) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] ? argv[i + 1] : dflt; };

if (argv[0] === "--dump") {
  const d = R.load();
  S.attachSimilar(d.champions, null, d.items);
  const t0 = Date.now();
  const onlyGame = flag("--scenes") === "game";
  const limit = Number(flag("--limit", 0)) || 0;
  const base = onlyGame ? { scenes: {} } : R.snapshot(d);
  let scenes = gameScenes(LOGS);
  if (limit) scenes = scenes.slice(0, limit);
  const game = {};
  for (const sc of scenes) {
    const r = rankOf(d, sc);
    if (r) game[`${sc.game}:${sc.t}`] = { top: r.top, raw: r.raw, input: { champ: sc.champ, level: sc.level, items: sc.items, augs: sc.augs, target: sc.target } };
  }
  const inputs = { 조건: flag("--inputs", "기본"), 장면: onlyGame ? "실게임만" : "기준선+실게임", 상한: limit || "없음" };
  fs.writeFileSync(argv[1], JSON.stringify({ engine: FP.fingerprint(), inputs, baseline: base, game, version: d.version, builtAt: d.builtAt }, null, 0));
  console.log(`저장 ${argv[1]} — 기준선 ${Object.keys(base.scenes).length}장면 · 실게임 ${Object.keys(game).length}장면 (${Date.now() - t0}ms)`);
  process.exit(0);
}

// 실게임 장면 비교 (양성 대조 테스트가 직접 부른다 — tests/verify_tools.test.js)
function cmpGame(ga, gb) {
  const keys = Object.keys(gb);
  const out = { 장면: keys.length, top1: 0, top3: 0, top6: 0, score: 0, maxd: 0, rawMoved: 0, miss: 0, ex: [] };
  for (const k of keys) {
    const x = ga[k], y = gb[k];
    if (!x) { out.miss++; continue; }
    const na = x.top.map((v) => v.name), nb = y.top.map((v) => v.name);
    if (na[0] !== nb[0]) { out.top1++; if (out.ex.length < 5) out.ex.push(`${k}: ${na[0]} → ${nb[0]}`); }
    if (JSON.stringify(na.slice(0, 3)) !== JSON.stringify(nb.slice(0, 3))) out.top3++;
    if (JSON.stringify(na) !== JSON.stringify(nb)) out.top6++;
    if (JSON.stringify(x.raw) !== JSON.stringify(y.raw)) out.rawMoved++;
    const sb = new Map(y.top.map((v) => [v.name, v.score]));
    let moved = false;
    for (const v of x.top) if (sb.has(v.name)) { const dd = Math.abs(v.score - sb.get(v.name)); if (dd > 1e-9) { moved = true; out.maxd = Math.max(out.maxd, dd); } }
    if (moved) out.score++;
  }
  return out;
}
const anyMove = (r) => r.top1 + r.top3 + r.top6 + r.score + r.rawMoved > 0;
module.exports = { cmpGame, anyMove, gameScenes };

if (argv[0] === "--cmp") {
  const a = JSON.parse(fs.readFileSync(argv[1], "utf8")), b = JSON.parse(fs.readFileSync(argv[2], "utf8"));
  const eng = FP.printEngines(a, b);
  if (eng.same) console.log("  (아래 '달라진 것 없음' 은 이 상태에서는 근거가 되지 않는다)");
  console.log("\n=== 1. 기준선 장면 (solo 173 · aug 48 · tiers 16 · game 26)");
  console.log(`  장면 ${Object.keys(b.baseline.scenes).length}개`);
  if (Object.keys(b.baseline.scenes).length) {
    // report() 는 글을 돌려주기만 한다 (찍지 않는다) — 2026-11-25 이전에는 이 줄이 아무것도 안 찍고 있었다
    const sum = R.compare(a.baseline, b.baseline);
    console.log(R.report(sum, a.baseline, b.baseline).replace(/^/gm, "  "));
  }
  else console.log("  건너뜀 (--scenes game 으로 뜬 결과)");
  console.log("\n=== 2. 실게임 기록 장면");
  const r = cmpGame(a.game, b.game);
  console.log(`  장면 ${r.장면}개 · 1순위 바뀜 ${r.top1} · Top3 바뀜 ${r.top3} · Top6 바뀜 ${r.top6}`);
  console.log(`  점수 바뀐 장면 ${r.score} (최대 ${r.maxd}) · 계산 순서(tieOrder 전) 바뀜 ${r.rawMoved} · 한쪽에만 있는 장면 ${r.miss}`);
  if (r.ex.length) console.log("  " + r.ex.join(" / "));
  process.exit(0);
}

// ---- 양성 대조: 엔진을 일부러 틀리게 바꿔 끼우고 비교 도구가 '차이를 잡는지' 본다.
// 결과가 '달라진 것 없음' 으로 나오면 그건 비교 도구가 고장 난 것이다 (앞 판 global.Stats 교체 비교가 그랬다).
if (argv[0] === "--positive") {
  const { execFileSync } = require("child_process");
  const os = require("os");
  const STATS = path.join(__dirname, "..", "web", "stats.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c9pos-"));
  const backup = path.join(tmp, "stats.backup.js");
  const N = Number(flag("--limit", 20)) || 20;
  const run = (out) => execFileSync(process.execPath, [__filename, "--dump", out, "--scenes", "game", "--limit", String(N)],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  const before = path.join(tmp, "before.json"), after = path.join(tmp, "after.json");
  fs.copyFileSync(STATS, backup);
  let ok = false;
  try {
    console.log(run(before).trim());
    // 저항 배수를 1% 틀리게 (게임 규칙과 다른 값 → 모든 장면의 점수가 조금씩 움직여야 한다)
    const src = fs.readFileSync(STATS, "utf8");
    const MARK = "return 100 / (100 + eff);";
    if (!src.includes(MARK)) throw new Error(`엔진에서 바꿀 자리를 못 찾았다 (${MARK}) — 양성 대조를 건너뛴다`);
    fs.writeFileSync(STATS, src.replace(MARK, "return 100 / (100 + eff * 1.01);"));
    console.log(run(after).trim());
    ok = true;
  } finally {
    fs.copyFileSync(backup, STATS);
    const same = fs.readFileSync(STATS, "utf8") === fs.readFileSync(backup, "utf8");
    console.log(`원래 엔진 되돌림: ${same ? "확인" : "⚠ 실패 — web/stats.js 를 직접 확인하라"}`);
  }
  if (ok) {
    const a = JSON.parse(fs.readFileSync(before, "utf8")), b = JSON.parse(fs.readFileSync(after, "utf8"));
    const eng = FP.printEngines(a, b);
    const r = cmpGame(a.game, b.game);
    console.log(`\n=== 양성 대조 (장면 ${r.장면}개, 저항 배수를 1% 틀리게 바꾼 엔진)`);
    console.log(`  1순위 ${r.top1} · Top3 ${r.top3} · Top6 ${r.top6} · 점수 ${r.score} (최대 ${r.maxd}) · 계산 순서 ${r.rawMoved}`);
    console.log(`  → 엔진 지문 ${eng.ok ? "다름(정상)" : "⚠ 같음"} · 차이 감지 ${anyMove(r) ? "성공 (비교 도구가 제대로 잡는다)" : "⚠ 실패 — 비교 도구를 믿지 마라"}`);
    process.exit(eng.ok && anyMove(r) ? 0 : 1);
  }
  process.exit(1);
}

// ---- 지금 값만 보기 (모듈로 불러 쓸 때는 돌지 않는다)
if (require.main !== module) return;
const d = R.load();
S.attachSimilar(d.champions, null, d.items);
console.log("=== 핏빛 저주 (C9-A3 공통 중첩 식 · 중첩 평균 1.5 가정 유지)");
{
  const blight = d.items.find((i) => i.name === "핏빛 저주"), lux = d.champions.find((c) => c.id === "Lux");
  const sh = St.evaluate(lux, 18, [blight], [], OPTS).m.shred;
  const mr = St.TARGET.MR;
  const before = 100 / (100 + mr), after = St.mitigation(mr, 0, 0, sh.mrShred, sh.mrFlatShred);
  const det = (sh.detail || []).map((x) => `${x.stat} 중첩 평균 ${x.stackAvg.toFixed(2)}/포화 ${x.saturated.toFixed(2)} → ${x.value.toFixed(4)}`).join(" · ");
  console.log(`  mrShred ${sh.mrShred} (${det || "규칙에 숫자로"}) · 기준 상대 마저 ${mr} → 깎인 뒤 ${(mr * (1 - sh.mrShred)).toFixed(2)}`);
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
