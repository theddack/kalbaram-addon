// 추천 기준선: 지금 계산이 내는 추천을 저장해 두고, 계산을 고친 뒤 무엇이 바뀌었는지 자동으로 비교한다.
//   node tools/rec_baseline.js            저장된 기준선(tests/data/rec_baseline.json)과 비교해 바뀐 점 요약
//   node tools/rec_baseline.js --update   지금 결과를 기준선으로 저장 (바뀐 게 의도한 개선일 때만)
//   node tools/rec_baseline.js --json     비교 결과를 JSON 으로
// 장면 (화면 app.js 와 같은 입력: 칼바람 aram, 공식·비슷한 챔피언 추천, 점수가 비슷하면 tieOrder):
//   solo:<챔피언>        모든 챔피언 · 증강 없음 · 아이템 없음 → 다음 구매 순위 Top6 + 균형 빌드 6칸
//   aug:<챔피언>:<증강>  대표 챔피언 · 등급마다 수치 1위 증강 하나 → 순위 Top6 + 증강 몰빵 빌드 + 증강 등급 Top5
//   game:<판>:<초>       실제 기록한 판의 그 시각 (레벨·완성 아이템·고른 증강) → 순위 Top6
// 비교: Top1 바뀜 · Top3 구성 바뀜 · Top6 구성 바뀜 · 빌드 칸 바뀜 · tieOrder 때문에 계산 순서와 달라진 장면 수
const fs = require("fs");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = global.Stats || require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));
const FILE = path.join(__dirname, "..", "tests", "data", "rec_baseline.json");
const GAMES = path.join(__dirname, "..", "tests", "data", "games");

// augment_quality 대표 12명 + 정확도 기획서 우선 챔피언 (바루스·징크스·케이틀린·진·베인·케일)
const REPS = ["Jinx", "Ezreal", "Lux", "Annie", "Malphite", "Garen", "Zed", "Sona", "Darius", "Yasuo", "Vayne", "Nami",
  "Varus", "Caitlyn", "Jhin", "Kayle"];
const TOP = 6;
const OPTS = { aram: true };
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// app.js itemRanking 과 같은 순서: rankItems → (증강이 있으면) 연계 표시 → tieOrder
const LINK_TOP = 6;
function rankRows(d, c, chosen, fixed, opts = OPTS) {
  const w = S.profile(c, d.tags);
  const rows = S.rankItems(d.items, w, chosen, fixed, d.rules, c, opts, chosen.length ? "augment" : "balanced");
  const ctx = S.augContext(chosen, d.rules);
  if (chosen.length) {
    const syn = S.itemSynergy(d.items, w, chosen, fixed, d.rules, c, opts);
    const links = rows.filter((r) => r.item.kind !== "special" || ctx.wanted[r.item.name])
      .filter((r) => syn[r.item.id] && syn[r.item.id].delta > 0.1)
      .sort((a, b) => syn[b.item.id].delta - syn[a.item.id].delta).slice(0, LINK_TOP).map((r) => r.item.id);
    for (const r of rows) r.synergy = links.includes(r.item.id) || !!ctx.wanted[r.item.name];
  }
  const official = S.officialWeights(c, 1) || {};
  const prio = (r) => (ctx.wanted[r.item.name] ? 0 : r.synergy ? 1 : official[r.item.id] ? 2 : 3);
  return { rows, prio };
}
// 아이템 점수 구성: 지표별 수치 이득(gain: 한타 피해·초당 피해·버티는 힘·지원·기동·제어, 맨몸 대비 비율) + 태그 점수.
// 순위가 바뀌면 어느 항목이 바뀌었는지 비교한다 (기획서 8.2 '변경 원인')
const PARTS = ["combo", "dps", "ehp", "support", "mobility", "control"];
const partsOf = (r) => (r.gain ? Object.fromEntries(PARTS.map((k) => [k, r4(r.gain[k] || 0)]).filter(([, v]) => v)) : {});
function ranking(d, c, chosen, fixed, opts = OPTS) {
  const { rows, prio } = rankRows(d, c, chosen, fixed, opts);
  const raw = rows.filter((r) => r.item.kind === "legendary" && !r.offType).map((r) => r.item.name);
  const ordered = S.tieOrder(rows, prio).filter((r) => r.item.kind === "legendary" && !r.offType);
  return {
    top: ordered.slice(0, TOP).map((r) => ({ name: r.item.name, score: r4(r.score), tag: r4(r.tagScore || 0), parts: partsOf(r),
      ...(r.synergy ? { link: true } : {}), ...(r.tie ? { tie: r.tie } : {}) })),
    raw: raw.slice(0, TOP),  // tieOrder 를 쓰기 전 계산 순서
  };
}

// 화면(app.js enemyInfo·statOpts)과 같은 적 마법 비율: 적마다 라이엇 주 피해 유형(완성 아이템 2개 이상이면 산 아이템),
// 킬 1개 +0.1 · 완성 아이템 1개 +0.25 가중, 반영 60%, 0.1 단위
function enemyMagicOf(d, enemies) {
  if (!enemies.length) return null;
  const share = { magic: 1, physical: 0, mixed: 0.5 };
  let wsum = 0, mag = 0;
  for (const e of enemies) {
    const leg = e.items.filter((i) => i.kind === "legendary");
    const ap = leg.filter((i) => ((i.tags || {}).AP || 0) >= 0.5).length, ad = leg.filter((i) => ((i.tags || {}).AD || 0) >= 0.5).length;
    const by = leg.length >= 2 && ap + ad ? ap / (ap + ad) : null;
    const w = 1 + 0.1 * (e.kills || 0) + 0.25 * leg.length;
    wsum += w;
    mag += w * (by ?? share[e.champ.damageType] ?? 0.5);
  }
  return Math.round((0.5 + (mag / wsum - 0.5) * 0.6) * 10) / 10;
}

function build(d, c, chosen, key) {
  const w = S.profile(c, d.tags);
  const b = S.buildConcepts(d.items, w, chosen, [], d.rules, c, OPTS, [key])[0];
  return b ? b.pick.map((p) => p.item.name) : [];
}

// 실제 기록한 판: 각 5분 기록의 레벨·완성 아이템·그 시각까지 고른 증강
function gameScenes(d) {
  if (!fs.existsSync(GAMES)) return [];
  const out = [];
  for (const name of fs.readdirSync(GAMES).sort()) {
    const dir = path.join(GAMES, name);
    if (!fs.existsSync(path.join(dir, "game.json"))) continue;
    const game = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
    const c = d.champions.find((x) => x.id === game.champion);
    if (!c) continue;
    const files = fs.readdirSync(dir).filter((f) => /^live_\d+s\.json$/.test(f))
      .sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
    for (const f of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const ap = raw.activePlayer || {};
      if (!ap.championStats || !ap.championStats.moveSpeed) continue;
      const t = Math.round((raw.gameData || {}).gameTime || 0);
      const me = (raw.allPlayers || []).find((p) => p.riotId === ap.riotId);
      if (!me) continue;
      const fixed = me.items.map((i) => d.items.find((x) => x.id === String(i.itemID))).filter(Boolean);
      const chosen = game.augments.filter(([, at]) => at <= t).map(([id]) => d.augments.find((a) => a.id === id)).filter(Boolean);
      const champOf = (p) => d.champions.find((x) => x.id === String(p.rawChampionName || "").replace(/^game_character_displayname_/, ""));
      const enemies = (raw.allPlayers || []).filter((p) => p.team !== me.team).map((p) => ({ champ: champOf(p), kills: (p.scores || {}).kills || 0,
        items: (p.items || []).map((i) => d.items.find((x) => x.id === String(i.itemID))).filter(Boolean) })).filter((e) => e.champ);
      const enemyMagic = enemyMagicOf(d, enemies);
      out.push({ key: `game:${name}:${t}`, champ: c.id, level: ap.level, items: fixed.map((i) => i.name), augs: chosen.map((a) => a.id),
        gold: Math.round(ap.currentGold || 0), enemies: enemies.map((e) => e.champ.id), enemyItems: enemies.reduce((n, e) => n + e.items.filter((i) => i.kind === "legendary").length, 0),
        enemyMagic, c, chosen, fixed });
    }
  }
  return out;
}

function snapshot(d) {
  S.attachSimilar(d.champions, null, d.items);  // 화면과 같게
  const scenes = {};
  for (const c of d.champions) {
    const r = ranking(d, c, [], []);
    scenes[`solo:${c.id}`] = { ...r, build: build(d, c, [], "balanced") };
  }
  for (const id of REPS) {
    const c = d.champions.find((x) => x.id === id);
    if (!c) continue;
    const w = S.profile(c, d.tags);
    const tiers = S.augmentTiers(d.augments, d.items, w, [], [], d.rules, c, OPTS);
    const tierTop = {};
    for (const rarity of [0, 1, 2]) {
      const list = d.augments.filter((a) => a.rarity === rarity && tiers[a.id]);
      const num = list.filter((a) => tiers[a.id].basis === "수치").sort((a, b) => tiers[a.id].rank - tiers[b.id].rank);
      tierTop[rarity] = num.slice(0, 5).map((a) => `${a.id}:${tiers[a.id].tier}`);
      const a = num[0];
      if (!a) continue;
      const r = ranking(d, c, [a], []);
      scenes[`aug:${c.id}:${a.id}`] = { ...r, build: build(d, c, [a], "augment") };
    }
    scenes[`tiers:${c.id}`] = { tiers: tierTop };
  }
  for (const g of gameScenes(d)) {
    // 게임 중 화면처럼 적 구성(받는 마법 비율)을 넣는다. 레벨·골드는 순위 계산에 안 쓰여(18레벨 완성 기준) 기록만 한다
    const opts = g.enemyMagic != null ? { ...OPTS, enemyMagic: g.enemyMagic } : OPTS;
    const r = ranking(d, g.c, g.chosen, g.fixed, opts);
    const assume = g.chosen.filter((a) => ((d.rules.augments[a.id] || {}).basis || {}).assume).map((a) => a.id);
    scenes[g.key] = { ...r, input: { champ: g.champ, level: g.level, items: g.items, augs: g.augs, gold: g.gold,
      enemies: g.enemies, enemyItems: g.enemyItems, enemyMagic: g.enemyMagic, ...(assume.length ? { assumeAugs: assume } : {}) } };
  }
  // 엔진 버전: 프로그램 버전 + 계산 전체 가정값(기준 상대·ASSUMPTIONS)의 지문. 가정이 바뀌면 지문이 바뀐다
  const ver = (fs.readFileSync(path.join(__dirname, "..", "desktop.py"), "utf8").match(/APP_VERSION = "([^"]+)"/) || [])[1];
  const assumeHash = require("crypto").createHash("sha1").update(JSON.stringify([global.Stats.DEFAULT_TARGET, global.Stats.ASSUMPTIONS])).digest("hex").slice(0, 10);
  return { dataVersion: d.dataVersion, version: d.version, engine: { app: ver, assumptions: assumeHash }, scenes };
}

const names = (a) => (a || []).map((x) => (typeof x === "string" ? x : x.name));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// 1순위가 바뀐 원인: 새 1순위가 근거 순서로 올라왔는지, 아니면 두 아이템 점수 차이를 가장 크게 바꾼 항목(지표·태그)
const PART_LABEL = { combo: "한타 피해", dps: "초당 피해", ehp: "버티는 힘", support: "지원", mobility: "기동", control: "제어", tag: "태그 점수" };
function causeOf(a, b) {
  const nb = b.top[0], oldInB = b.top.find((x) => x.name === a.top[0].name), na = a.top.find((x) => x.name === nb.name);
  if (nb.tie && !(na && na.tie)) return ` [근거 순서: ${nb.tie}]`;
  if (!na || !oldInB || !na.parts || !oldInB.parts) return "";
  // (새 1순위 − 옛 1순위) 점수 차이의 변화를 항목별로
  const diff = (s, t) => { const o = {}; for (const k of [...PARTS, "tag"]) o[k] = (k === "tag" ? (s.tag || 0) - (t.tag || 0) : ((s.parts || {})[k] || 0) - ((t.parts || {})[k] || 0)); return o; };
  const before = diff(na, a.top[0]), after = diff(nb, oldInB);
  const ch = Object.keys(after).map((k) => [k, after[k] - before[k]]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  return ch[0] && Math.abs(ch[0][1]) > 1e-4 ? ` [${PART_LABEL[ch[0][0]]} ${ch[0][1] > 0 ? "+" : ""}${ch[0][1].toFixed(3)}]` : "";
}

function compare(base, now) {
  const sum = { scenes: 0, top1: [], top3: [], top6: [], build: [], tiers: [], added: [], removed: [],
    tieBase: 0, tieNow: 0, scoreShift: 0 };
  const keys = new Set([...Object.keys(base.scenes), ...Object.keys(now.scenes)]);
  const tieMoved = (s) => s && s.raw && s.top && names(s.top).some((n, i) => n !== s.raw[i]);
  for (const k of [...keys].sort()) {
    const a = base.scenes[k], b = now.scenes[k];
    if (!a) { sum.added.push(k); continue; }
    if (!b) { sum.removed.push(k); continue; }
    sum.scenes++;
    if (tieMoved(a)) sum.tieBase++;
    if (tieMoved(b)) sum.tieNow++;
    if (a.tiers) {
      if (JSON.stringify(a.tiers) !== JSON.stringify(b.tiers)) sum.tiers.push(k);
      continue;
    }
    const ta = names(a.top), tb = names(b.top);
    if (ta[0] !== tb[0]) sum.top1.push(`${k}: ${ta[0]} → ${tb[0]}` + causeOf(a, b));
    if (!sameSet(ta.slice(0, 3), tb.slice(0, 3))) sum.top3.push(k);
    if (!sameSet(ta, tb)) sum.top6.push(k);
    if (a.build && !sameSet(a.build, b.build)) sum.build.push(`${k}: -[${a.build.filter((x) => !b.build.includes(x)).join(", ")}] +[${b.build.filter((x) => !a.build.includes(x)).join(", ")}]`);
    for (const x of a.top) {
      const y = b.top.find((t) => t.name === x.name);
      if (y) sum.scoreShift = Math.max(sum.scoreShift, Math.abs(y.score - x.score));
    }
  }
  return sum;
}

function report(sum, base, now) {
  const eng = (x) => (x.engine ? `v${x.engine.app} 가정 ${x.engine.assumptions}` : "엔진 정보 없음");
  const lines = [`기준선 데이터 ${base.dataVersion} (${eng(base)}) · 지금 ${now.dataVersion} (${eng(now)})`, `장면 ${sum.scenes}개 비교`];
  const n = (label, list, show = 12) => {
    lines.push(`${label}: ${list.length}`);
    for (const x of list.slice(0, show)) lines.push(`  ${x}`);
    if (list.length > show) lines.push(`  … ${list.length - show}개 더`);
  };
  n("1순위 바뀜", sum.top1);
  n("Top3 구성 바뀜", sum.top3, 0);
  n("Top6 구성 바뀜", sum.top6, 0);
  n("빌드 칸 바뀜", sum.build);
  n("증강 등급 Top5 바뀜", sum.tiers);
  lines.push(`점수가 비슷해 계산 순서와 달라진 장면 (tieOrder): 기준선 ${sum.tieBase} → 지금 ${sum.tieNow}`);
  lines.push(`같은 아이템 점수 최대 변화: ${sum.scoreShift.toFixed(4)}`);
  if (sum.added.length) n("새 장면", sum.added, 5);
  if (sum.removed.length) n("없어진 장면", sum.removed, 5);
  return lines.join("\n");
}

const load = () => JSON.parse(fs.readFileSync(path.join(WEB, "data.json"), "utf8"));

if (require.main === module) {
  const t0 = Date.now();
  const now = snapshot(load());
  const ms = Date.now() - t0;
  if (process.argv.includes("--update")) {
    fs.writeFileSync(FILE, JSON.stringify(now, null, 1) + "\n");
    console.log(`기준선 저장: 장면 ${Object.keys(now.scenes).length}개 (${ms}ms)`);
  } else if (!fs.existsSync(FILE)) {
    console.log("기준선이 없어요. --update 로 먼저 저장하세요.");
    process.exitCode = 1;
  } else {
    const base = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const sum = compare(base, now);
    console.log(process.argv.includes("--json") ? JSON.stringify(sum, null, 1) : report(sum, base, now) + `\n(계산 ${ms}ms)`);
  }
}

module.exports = { snapshot, compare, report, ranking, rankRows, load, REPS, FILE };
