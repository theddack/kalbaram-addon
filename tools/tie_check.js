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

// 기록한 판의 5분 기록마다: 그때 아이템(부품 포함)·고른 증강
function snapshots(d) {
  const out = [];
  if (!fs.existsSync(GAMES)) return out;
  for (const name of fs.readdirSync(GAMES).sort()) {
    const dir = path.join(GAMES, name);
    if (!fs.existsSync(path.join(dir, "game.json"))) continue;
    const game = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
    const c = d.champions.find((x) => x.id === game.champion);
    for (const f of fs.readdirSync(dir).filter((x) => /^live_\d+s\.json$/.test(x))) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const ap = raw.activePlayer || {};
      const me = (raw.allPlayers || []).find((p) => p.riotId === ap.riotId);
      if (!ap.championStats || !ap.championStats.moveSpeed || !me) continue;
      const t = (raw.gameData || {}).gameTime || 0;
      out.push({ key: `${name}:${Math.round(t)}`, c,
        fixed: me.items.map((i) => d.items.find((x) => x.id === String(i.itemID))).filter(Boolean),
        inventory: me.items.map((i) => String(i.itemID)),
        chosen: game.augments.filter(([, at]) => at <= t).map(([id]) => d.augments.find((a) => a.id === id)).filter(Boolean) });
    }
  }
  return out;
}

// D. 근거 순서로 올린 아이템: 원래 점수가 넘어선 아이템보다 얼마나 낮았나 (TIE_BAND 안이어야 한다). 근거 종류별로
function liftPart(d, snaps) {
  const why = {};
  for (const s of snaps) {
    const { rows, prio } = R.rankRows(d, s.c, s.chosen, s.fixed);
    const ordered = S.tieOrder(rows, prio).filter((r) => r.item.kind === "legendary" && !r.offType).slice(0, 6);
    const top = Math.max(...rows.filter((r) => r.item.kind === "legendary" && !r.offType).map((r) => r.score));
    for (const [i, r] of ordered.entries()) {
      if (!r.tie) continue;
      const passed = ordered.slice(i + 1).filter((x) => x.score > r.score);
      if (!passed.length) continue;
      const gap = (Math.max(...passed.map((x) => x.score)) - r.score) / Math.abs(top || 1);
      const w = (why[r.tie] = why[r.tie] || { n: 0, max: 0, sum: 0, top1: 0 });
      w.n++; w.sum += gap; w.max = Math.max(w.max, gap); if (i === 0) w.top1++;
    }
  }
  for (const w of Object.values(why)) { w.avg = +(w.sum / w.n).toFixed(4); w.max = +w.max.toFixed(4); delete w.sum; }
  return { snaps: snaps.length, why };
}

// E. 만드는 중 (app.js buildingItem 과 같은 규칙): 산 부품이 500골드 넘게 들어간 아이템을 순위 8위 안이면 1순위로 유지.
// 유지한 아이템이 그때 1순위보다 점수가 얼마나 낮은가 (크면 상황이 바뀌었는데 붙잡고 있는 것)
const BUILD_KEEP_GOLD = 500, BUILD_KEEP_TOP = 8;
function buildPart(d, snaps) {
  const node = (id) => d.parts[id] || d.items.find((i) => i.id === id);
  const gold = (id) => (node(id) || {}).gold || 0;
  const remain = (id, owned) => {
    if (owned[id] > 0) { owned[id]--; return 0; }
    const from = (node(id) || {}).from || [];
    if (!from.length) return gold(id);
    return gold(id) - from.reduce((t, c) => t + gold(c), 0) + from.reduce((t, c) => t + remain(c, owned), 0);
  };
  const out = [];
  for (const s of snaps) {
    const parts = s.inventory.filter((id) => d.parts[id] && !d.items.some((i) => i.id === id && i.kind === "legendary"));
    if (!parts.length) continue;
    const { rows, prio } = R.rankRows(d, s.c, s.chosen, s.fixed);
    const avail = S.tieOrder(rows, prio).filter((r) => r.item.kind === "legendary" && !r.offType && !s.fixed.some((f) => f.id === r.item.id));
    let best = null;
    for (const r of avail.slice(0, BUILD_KEEP_TOP)) {
      const owned = parts.reduce((m, id) => ((m[id] = (m[id] || 0) + 1), m), {});
      const sunk = gold(r.item.id) - remain(r.item.id, owned);
      if (sunk > ((best && best.sunk) || 0)) best = { r, sunk };
    }
    if (!best || best.sunk < BUILD_KEEP_GOLD || best.r === avail[0]) continue;
    out.push({ key: s.key, kept: best.r.item.name, top1: avail[0].item.name, sunk: best.sunk,
      gap: +((avail[0].score - best.r.score) / Math.abs(avail[0].score || 1)).toFixed(4) });
  }
  return out;
}

// F. 같은 입력 반복 · 적 구성 정보(받는 마법 비율) 0.1 변화에 1순위가 바뀌는 기록 수. 레벨·골드는 순위 계산에 안 들어간다 (18레벨 완성 기준)
function stablePart(d, snaps) {
  let same = 0, flip = 0;
  const flips = [];
  const top = (s, opts) => { const { rows, prio } = R.rankRows(d, s.c, s.chosen, s.fixed, opts);
    return S.tieOrder(rows, prio).find((r) => r.item.kind === "legendary" && !r.offType && !s.fixed.some((f) => f.id === r.item.id)); };
  for (const s of snaps) {
    const a = top(s, { aram: true, enemyMagic: 0.5 }), b = top(s, { aram: true, enemyMagic: 0.5 });
    if (a && b && a.item.id === b.item.id) same++;
    const up = top(s, { aram: true, enemyMagic: 0.6 });
    if (a && up && a.item.id !== up.item.id) { flip++; flips.push(`${s.key} ${a.item.name}→${up.item.name}`); }
  }
  return { snaps: snaps.length, same, flip, flips };
}

if (require.main === module) {
  const d = R.load();
  S.attachSimilar(d.champions, null, d.items);
  const matches = loadMatches(path.join(__dirname, "..", ".cache", "matches"));
  const snaps = snapshots(d);
  const res = { match: matches.length ? matchPart(d, matches) : null, games: gamePart(d),
    lift: liftPart(d, snaps), build: buildPart(d, snaps), stable: stablePart(d, snaps) };
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
  const L = { 0: "고른 증강에 필요", 1: "증강 연계", 2: "라이엇 추천" };
  console.log(`D. 근거 순서로 올린 아이템 (기록 ${res.lift.snaps}개, Top6): 넘어선 아이템과의 점수 차이 (1위 점수 대비)`);
  for (const [k, w] of Object.entries(res.lift.why)) console.log(`   ${(L[k] || k).padEnd(10)} ${w.n}번 (1순위로 올린 것 ${w.top1}) · 평균 ${(w.avg * 100).toFixed(1)}% · 최대 ${(w.max * 100).toFixed(1)}%`);
  console.log(`E. 만드는 중으로 1순위를 바꾼 기록 ${res.build.length}개` + (res.build.length ? ":" : ""));
  for (const b of res.build) console.log(`   ${b.key}: ${b.kept} (부품 ${b.sunk}G) ← 계산 1순위 ${b.top1}, 점수 ${(b.gap * 100).toFixed(1)}% 낮음`);
  const st = res.stable;
  console.log(`F. 같은 입력 반복 ${st.same}/${st.snaps} 같음 · 받는 마법 비율 0.5→0.6 에 1순위 바뀜 ${st.flip}/${st.snaps}` + (st.flip ? ": " + st.flips.join(", ") : ""));
  console.log("   레벨·골드는 순위 계산에 안 들어가요 (18레벨 완성 기준) → 레벨·골드만 바뀌어 1순위가 흔들리는 일은 구조상 없음");
  console.log("※ 실제 선택이 정답은 아니에요. 표본이 작아 참고만 해요.");
}

module.exports = { matchPart, gamePart, liftPart, buildPart, stablePart, snapshots, BANDS };
