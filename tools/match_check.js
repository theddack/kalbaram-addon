// 실제 판(전적)으로 추천 대조: 사람들이 실제로 고른 증강이 우리 등급에서 어디였는지, 그리고 이긴 쪽과 진 쪽이 어땠는지.
// 판 받기: python tools/match_review.py (롤 클라이언트 전적, 이름·계정 없이 .cache/matches/ 에 저장)
//   node tools/match_check.js          요약
//   node tools/match_check.js --json   결과를 JSON 으로
// 등급은 '혼자 골랐을 때'(고른 증강 없이) 기준이다: 챔피언마다 한 번만 계산한다 (선택 순서별로 다시 계산하면 너무 오래 걸린다).
// 표본이 작아서(판 수십 개) 승률 차이는 참고만 한다. 통계적으로 확실하다고 말하지 않는다.
const fs = require("fs");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));

const TIER_SCORE = { S: 4, A: 3, B: 2, C: 1, D: 0 };
const TIER_SHARE = { S: 0.1, A: 0.2, B: 0.3, C: 0.25, D: 0.15 };  // scoring TIER_CUTS 로 나눈 비율 (아무렇게나 고르면 이만큼)

function loadMatches(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function check(d, matches) {
  S.attachSimilar(d.champions, null, d.items);  // 화면과 같게
  const champByKey = Object.fromEntries(d.champions.map((c) => [Number(c.key), c]));
  const augByNum = Object.fromEntries(d.augments.filter((a) => a.num).map((a) => [a.num, a]));
  const legendary = new Set(d.items.filter((i) => i.kind === "legendary").map((i) => i.id));
  const tierCache = {};
  const tiersOf = (c) => (tierCache[c.id] ||= S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, "total"));
  const picked = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const players = [];
  for (const m of matches) {
    for (const p of m.players || []) {
      const c = champByKey[p.champion];
      if (!c) continue;
      const augs = (p.augments || []).map((n) => augByNum[n]).filter(Boolean);
      const tiers = tiersOf(c);
      const ts = augs.map((a) => (tiers[a.id] || {}).tier).filter(Boolean);
      for (const t of ts) picked[t]++;
      // 아이템: 실제로 산 전설 아이템 ↔ 그 증강들로 짠 우리 '증강 몰빵' 빌드
      const w = S.profile(c, d.tags);
      const ours = augs.length ? S.buildConcepts(d.items, w, augs, [], d.rules, c, {}, ["augment"])[0].pick.map((x) => x.item.id) : [];
      const theirs = (p.items || []).map(String).filter((id) => legendary.has(id));
      const overlap = theirs.filter((id) => ours.includes(id)).length;
      players.push({ champ: c.id, win: p.win, me: p.me, tiers: ts, tierAvg: ts.length ? ts.reduce((a, t) => a + TIER_SCORE[t], 0) / ts.length : null,
        overlap, bought: theirs.length });
    }
  }
  const n = Object.values(picked).reduce((a, b) => a + b, 0);
  const rate = (rows) => (rows.length ? +(100 * rows.filter((r) => r.win).length / rows.length).toFixed(1) : null);
  const withTier = players.filter((r) => r.tierAvg != null).sort((a, b) => a.tierAvg - b.tierAvg);
  const half = Math.floor(withTier.length / 2);
  const avg = (rows, k) => (rows.length ? +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(2) : null);
  const bought = players.filter((r) => r.bought >= 3);
  return {
    games: matches.length, players: players.length, champions: Object.keys(tierCache).length,
    picked: Object.fromEntries(Object.entries(picked).map(([t, k]) => [t, { n: k, pct: n ? +(100 * k / n).toFixed(1) : 0, random: 100 * TIER_SHARE[t] }])),
    winByTier: { low: rate(withTier.slice(0, half)), high: rate(withTier.slice(half)), lowAvg: avg(withTier.slice(0, half), "tierAvg"), highAvg: avg(withTier.slice(half), "tierAvg") },
    overlap: { win: avg(bought.filter((r) => r.win), "overlap"), lose: avg(bought.filter((r) => !r.win), "overlap"), n: bought.length },
    me: { n: players.filter((r) => r.me).length, win: rate(players.filter((r) => r.me)), tierAvg: avg(players.filter((r) => r.me && r.tierAvg != null), "tierAvg") },
  };
}

if (require.main === module) {
  const d = require(path.join(WEB, "data.json"));
  const matches = loadMatches(path.join(__dirname, "..", ".cache", "matches"));
  if (!matches.length) {
    console.log("받은 판이 없어요. 롤 클라이언트를 켜고 python tools/match_review.py 를 먼저 실행해 주세요.");
    process.exit(1);
  }
  const r = check(d, matches);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`칼바람 증강 모드 ${r.games}판 · 플레이어 ${r.players}명 · 챔피언 ${r.champions}명`);
  console.log("실제로 고른 증강의 우리 등급 (혼자 골랐을 때 기준) — 아무렇게나 고르면:");
  for (const [t, v] of Object.entries(r.picked)) console.log(`  ${t}: ${v.pct}% (${v.n}개) — ${v.random}%`);
  console.log(`고른 증강 평균 등급 하위 절반 승률 ${r.winByTier.low}% (평균 ${r.winByTier.lowAvg}) · 상위 절반 ${r.winByTier.high}% (평균 ${r.winByTier.highAvg})`);
  console.log(`산 전설 아이템이 우리 몰빵 빌드와 겹친 수 (3개 이상 산 ${r.overlap.n}명): 이긴 쪽 ${r.overlap.win} · 진 쪽 ${r.overlap.lose}`);
  console.log(`나: ${r.me.n}판 승률 ${r.me.win}% · 고른 증강 평균 등급 ${r.me.tierAvg}`);
  console.log("※ 표본이 작아 승률 차이는 참고만 해요.");
}

module.exports = { check, loadMatches };
