// 점수가 비슷할 때 근거 순서로 바꾸는 규칙(scoring tieOrder, 5%)을 실제 기록으로 점검한다.
//   node tools/tie_check.js          요약
//   node tools/tie_check.js --json   결과를 JSON 으로
// 비교하는 폭: 0(규칙 없음 = 계산 순서 그대로) · 3% · 5%(지금) · 8% · 12%
// A. 전적 (python tools/match_review.py 로 받은 .cache/matches): 전설 아이템을 3개 이상 산 플레이어마다
//    그 챔피언·고른 증강으로 낸 '다음 구매' 순위 Top3·Top6 에 실제로 산 아이템이 몇 개 들었나 (산 순서는 모름)
// B. 기록한 판 (tests/data/games): 5분 기록마다 그때 아이템·증강으로 낸 순위에서, 다음 기록까지 새로 완성한 전설 아이템의 순위
// C. 흔들림 (B 와 같은 판): 다음 기록에서 1순위가 바뀐 횟수 중 '1순위를 사서'가 아닌 것
// 실제 플레이어 선택이 정답은 아니다 (잘못 사는 사람도 많다). 규칙을 바꿨을 때 실제 선택과 더 멀어지는지만 본다.
const fs = require("fs");
const path = require("path");
const R = require("./rec_baseline.js");
const S = require(path.join(__dirname, "..", "web", "scoring.js"));
const { loadMatches } = require("./match_check.js");

const BANDS = [0, 0.03, 0.05, 0.08, 0.12];
const GAMES = path.join(__dirname, "..", "tests", "data", "games");

const order = (rows, prio, band) => S.tieOrder(rows.map((r) => ({ ...r, tie: undefined })), prio, band)
  .filter((r) => r.item.kind === "legendary" && !r.offType).map((r) => r.item.id);

function matchPart(d, matches) {
  const champByKey = Object.fromEntries(d.champions.map((c) => [Number(c.key), c]));
  const augByNum = Object.fromEntries(d.augments.filter((a) => a.num).map((a) => [a.num, a]));
  const legendary = new Set(d.items.filter((i) => i.kind === "legendary").map((i) => i.id));
  const out = Object.fromEntries(BANDS.map((b) => [b, { top3: 0, top6: 0, top3w: 0, top6w: 0 }]));
  let n = 0, nw = 0, moved = 0;
  for (const m of matches) for (const p of m.players || []) {
    const c = champByKey[p.champion];
    const bought = (p.items || []).map(String).filter((id) => legendary.has(id));
    if (!c || bought.length < 3) continue;
    const augs = (p.augments || []).map((x) => augByNum[x]).filter(Boolean);
    const { rows, prio } = R.rankRows(d, c, augs, []);
    n++;
    if (p.win) nw++;
    const raw = order(rows, prio, 0);
    if (raw.slice(0, 6).join() !== order(rows, prio, 0.05).slice(0, 6).join()) moved++;
    for (const b of BANDS) {
      const ids = order(rows, prio, b);
      const h3 = bought.filter((id) => ids.slice(0, 3).includes(id)).length;
      const h6 = bought.filter((id) => ids.slice(0, 6).includes(id)).length;
      out[b].top3 += h3; out[b].top6 += h6;
      if (p.win) { out[b].top3w += h3; out[b].top6w += h6; }
    }
  }
  const avg = (v, k) => (k ? +(v / k).toFixed(3) : null);
  return { players: n, winners: nw, movedTop6: moved,
    bands: Object.fromEntries(BANDS.map((b) => [b, { top3: avg(out[b].top3, n), top6: avg(out[b].top6, n), top3win: avg(out[b].top3w, nw), top6win: avg(out[b].top6w, nw) }])) };
}

function gamePart(d) {
  const per = Object.fromEntries(BANDS.map((b) => [b, { ranks: [], hit1: 0, hit3: 0, churn: 0, flips: 0 }]));
  let steps = 0;
  if (!fs.existsSync(GAMES)) return { steps, bands: {} };
  for (const name of fs.readdirSync(GAMES).sort()) {
    const dir = path.join(GAMES, name);
    if (!fs.existsSync(path.join(dir, "game.json"))) continue;
    const game = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
    const c = d.champions.find((x) => x.id === game.champion);
    const snaps = [];
    for (const f of fs.readdirSync(dir).filter((x) => /^live_\d+s\.json$/.test(x))) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const ap = raw.activePlayer || {};
      if (!ap.championStats || !ap.championStats.moveSpeed) continue;
      const me = (raw.allPlayers || []).find((p) => p.riotId === ap.riotId);
      if (!me) continue;
      const t = (raw.gameData || {}).gameTime || 0;
      snaps.push({ t, fixed: me.items.map((i) => d.items.find((x) => x.id === String(i.itemID))).filter(Boolean),
        chosen: game.augments.filter(([, at]) => at <= t).map(([id]) => d.augments.find((a) => a.id === id)).filter(Boolean) });
    }
    snaps.sort((a, b) => a.t - b.t);
    const lists = snaps.map((s) => { const { rows, prio } = R.rankRows(d, c, s.chosen, s.fixed); return Object.fromEntries(BANDS.map((b) => [b, order(rows, prio, b)])); });
    for (let i = 0; i + 1 < snaps.length; i++) {
      const have = new Set(snaps[i].fixed.map((x) => x.id));
      const fresh = snaps[i + 1].fixed.filter((x) => x.kind === "legendary" && !have.has(x.id)).map((x) => x.id);
      for (const b of BANDS) {
        const now = lists[i][b], next = lists[i + 1][b];
        if (fresh.length) {
          const r = Math.min(...fresh.map((id) => (now.indexOf(id) + 1) || 99));
          per[b].ranks.push(r);
          if (r === 1) per[b].hit1++;
          if (r <= 3) per[b].hit3++;
        }
        if (now[0] !== next[0]) { per[b].flips++; if (!fresh.includes(now[0])) per[b].churn++; }
      }
      if (fresh.length) steps++;
    }
  }
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  return { steps, bands: Object.fromEntries(BANDS.map((b) => [b, { hit1: per[b].hit1, hit3: per[b].hit3, medianRank: med(per[b].ranks), flips: per[b].flips, churn: per[b].churn }])) };
}

if (require.main === module) {
  const d = R.load();
  S.attachSimilar(d.champions, null, d.items);
  const matches = loadMatches(path.join(__dirname, "..", ".cache", "matches"));
  const res = { match: matches.length ? matchPart(d, matches) : null, games: gamePart(d) };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }
  const pct = (b) => (b === 0 ? "규칙 없음" : `${Math.round(b * 100)}%`);
  if (res.match) {
    const m = res.match;
    console.log(`A. 전적: 전설 3개 이상 산 플레이어 ${m.players}명 (이긴 쪽 ${m.winners}) · 5% 규칙이 Top6 를 바꾼 플레이어 ${m.movedTop6}명`);
    console.log("   폭        Top3 적중  Top6 적중  (이긴 쪽 Top3 · Top6)");
    for (const b of BANDS) { const x = m.bands[b]; console.log(`   ${pct(b).padEnd(8)}  ${x.top3.toFixed(3)}      ${x.top6.toFixed(3)}      (${x.top3win.toFixed(3)} · ${x.top6win.toFixed(3)})`); }
  } else console.log("A. 전적 없음 (python tools/match_review.py)");
  const g = res.games;
  console.log(`B·C. 기록한 판: 다음 기록까지 전설 아이템을 새로 완성한 구간 ${g.steps}개`);
  console.log("   폭        1순위 적중  3위 안  순위 중앙값  1순위 바뀜(산 것 아님)");
  for (const b of BANDS) { const x = g.bands[b]; console.log(`   ${pct(b).padEnd(8)}  ${x.hit1}           ${x.hit3}       ${x.medianRank}            ${x.flips} (${x.churn})`); }
  console.log("※ 실제 선택이 정답은 아니에요. 표본이 작아 참고만 해요.");
}

module.exports = { matchPart, gamePart, BANDS };
