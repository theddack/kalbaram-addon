// v0.1.95 Phase 4 C1·C2 검증: 상대 회복량에서 보호막을 뺀 것(C1)과 상대 추가 체력 연결(C2)이
// 실제 게임 기록·전 챔피언에서 무엇을 바꾸는지 수정 전후로 비교한다 (새 플레이 없이 기존 기록만 쓴다).
//   node tools/c1c2_check.js [로그폴더] [--json 파일]
//   OLD_STATS=<수정 전 stats.js 경로> 를 주면 버티는 힘(EHP) 보존까지 확인한다
// 보는 것: 회복량·추가 체력 / 아이템 점수·Top3·Top6 / 다음 구매 / 빌드 구성 / 적 대응 목록 / 캐시 일치 / 버티는 힘 보존
// 다음 패치에서도 그대로 쓸 수 있게 아이템·챔피언 이름을 박아 두지 않는다 (규칙 열쇠로 찾는다)
const path = require("path"), fs = require("fs");
const W = path.join(__dirname, "..", "web") + path.sep;
global.Stats = require(W + "stats.js");
const S = require(W + "scoring.js");
const d = require(W + "data.json");
const St = global.Stats;
S.attachSimilar(d.champions, null, d.items);
const byName = new Map(d.items.map((i) => [i.name, i]));
const champOf = (v) => (typeof v === "string" ? d.champions.find((c) => c.id === v || c.name === v) : v);
const SLOTS = S.SLOTS, TARGET_STEP = 0.05;          // = web/app.js
const COUNTER_UP = 3, COUNTER_TOP = 8;              // = web/app.js counterItems
const T_MOVED = { HP: 0.1, ARMOR: 0.15, MR: 0.15 }; // = web/app.js enemyMoved
const OPTS = { aram: true };
const RI = d.rules.items || {};
// 상대 값을 쓰는 아이템을 규칙에서 찾는다 (이름을 박지 않는다)
const withKey = (k) => Object.keys(RI).filter((n) => ((RI[n].stats || {})[k] != null)).map((n) => byName.get(n)).filter(Boolean);
const HEALCUT = withKey("healCut");        // 치유 감소: TARGET.HEAL 을 쓴다
const BONUSHP = withKey("tgtBonusHpAmp");  // 거인 학살: TARGET.BONUS_HP 를 쓴다

let slotBonus = null;
function avgSlotBonus() {
  if (slotBonus) return slotBonus;
  const sum = { ARMOR: 0, MR: 0, HP: 0 };
  for (const c of d.champions) {
    const t = St.computeStats(c, 18, [], [], OPTS).total;
    for (const k of Object.keys(sum)) sum[k] += t[k] / d.champions.length;
  }
  const D = St.DEFAULT_TARGET;
  slotBonus = Object.fromEntries(Object.keys(sum).map((k) => [k, Math.max(0, (D[k] - sum[k]) / SLOTS)]));
  slotBonus.bonusHP = slotBonus.HP;  // 아이템이 올리는 체력은 전부 추가 체력
  return slotBonus;
}
const augStats = (e) => ((e.augments || []).length ? S.augStatsOf(e.augments, d.rules, champOf(e.champ)) : []);
const itemsOf = (list) => (list || []).map((n) => (typeof n === "string" ? byName.get(n) : n)).filter(Boolean);
// web/app.js enemyTarget(): mode "old" = 수정 전(보호막 포함·추가 체력 없음), "new" = 수정 후
function enemyTarget(builds, mode) {
  const b = builds || [];
  if (!b.length) return null;
  const sb = avgSlotBonus();
  const sum = { ARMOR: 0, MR: 0, HP: 0, bonusHP: 0 };
  let heal = 0;
  for (const e of b) {
    const items = itemsOf(e.items), c = champOf(e.champ), as = augStats(e);
    if (!c) continue;
    const t = St.computeStats(c, 18, items, as, OPTS).total;
    const empty = Math.max(0, SLOTS - items.length);
    for (const k of Object.keys(sum)) sum[k] += ((k === "bonusHP" ? t.bonusHP : t[k]) + empty * sb[k]) / b.length;
    const m = St.evaluate(c, 18, items, as, OPTS).m;
    heal += ((m.selfHeal || 0) + (m.vampHeal || 0) + (mode === "old" ? (m.itemSelfHp || 0) : (m.itemSelfHeal || 0))) / b.length;
  }
  const r5 = (v) => Math.round(v / 5) * 5, r50 = (v) => Math.round(v / 50) * 50;
  const out = { ARMOR: r5(sum.ARMOR), MR: r5(sum.MR), HP: r50(sum.HP), HEAL: Math.round(heal / 10) * 10 };
  if (mode !== "old") out.bonusHP = r50(sum.bonusHP);
  return out;
}

// ---- 한 장면(챔피언 + 내 아이템 + 기준 상대)에서 추천을 모두 뽑는다
const ids = (list) => list.map((r) => (r.item ? r.item.id : r.id));
const DIFF_KEYS = ["top1", "top3순서", "top3구성", "top6순서", "다음구매", "빌드", "적대응"];
function sceneOf(champ, myItems, target) {
  const weights = S.profile(champ, d.tags);
  St.setTarget(target);
  const rank = S.rankItems(d.items, weights, [], myItems, d.rules, champ, OPTS, "balanced");
  const legend = rank.filter((r) => r.item.kind === "legendary");
  const build = S.buildConcepts(d.items, weights, [], myItems, d.rules, champ, OPTS, ["balanced"])[0];
  const D = St.DEFAULT_TARGET;
  const moved = Object.keys(T_MOVED).some((k) => Math.abs(St.TARGET[k] - D[k]) >= D[k] * T_MOVED[k]);
  let counter = [];
  if (moved) {
    const saved = { ARMOR: St.TARGET.ARMOR, MR: St.TARGET.MR, HP: St.TARGET.HP, bonusHP: St.TARGET.BONUS_HP, HEAL: St.TARGET.HEAL };
    St.setTarget(null);
    const base = S.rankItems(d.items, weights, [], myItems, d.rules, champ, OPTS, "balanced").filter((r) => r.item.kind === "legendary");
    St.setTarget(saved);
    const bi = new Map(base.map((r, i) => [r.item.id, i]));
    counter = legend.map((r, i) => ({ r, i })).filter((x) => x.i < COUNTER_TOP && (bi.get(x.r.item.id) ?? 99) - x.i >= COUNTER_UP).map((x) => x.r.item.id);
  }
  const have = new Set(myItems.map((i) => i.id));
  const nextBuy = legend.filter((r) => !have.has(r.item.id)).slice(0, 3).map((r) => r.item.id);
  const scoreOf = (list) => Object.fromEntries(list.map((it) => {
    const r = legend.find((x) => x.item.id === it.id);
    return [it.name, r ? Math.round(r.score * 1000) / 1000 : null];
  }));
  return { top1: ids(legend.slice(0, 1))[0], top3: ids(legend.slice(0, 3)), top6: ids(legend.slice(0, 6)), nextBuy,
    build: build ? build.pick.map((p) => p.item.id) : [], counter,
    치유감소점수: scoreOf(HEALCUT), 거인학살점수: scoreOf(BONUSHP) };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setSame = (a, b) => same([...a].sort(), [...b].sort());
const diffScene = (a, b) => ({
  top1: a.top1 !== b.top1, top3순서: !same(a.top3, b.top3), top3구성: !setSame(a.top3, b.top3),
  top6순서: !same(a.top6, b.top6), 다음구매: !same(a.nextBuy, b.nextBuy),
  빌드: !setSame(a.build, b.build), 적대응: !setSame(a.counter, b.counter),
});
const anyDiff = (r) => DIFF_KEYS.some((k) => r[k]);

// ---- 1. 실제 게임 기록: enemy 이벤트마다 (중간 구매 시점 포함)
const root = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games";
const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
const gameRows = [], sceneRows = [];
for (const g of games) {
  const ev = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
  const start = ev.find((x) => x.kind === "start") || {};
  const champ = champOf(start.champion);
  const enemies = ev.filter((x) => x.kind === "enemy" && (x.builds || []).length);
  if (!champ || !enemies.length) continue;
  let lastKey = null;
  const points = [];
  for (const x of enemies) {
    const o = enemyTarget(x.builds, "old"), n = enemyTarget(x.builds, "new");
    const myItems = itemsOf(x.items);
    const key = JSON.stringify([o.HEAL, n.HEAL, n.bonusHP, myItems.map((i) => i.id)]);
    points.push({ t: Math.round(x.t), old: o, neu: n, myItems, changed: key !== lastKey });
    lastKey = key;
  }
  // 값이 바뀐 지점마다 + 마지막 구성 (같은 값을 수백 번 다시 재지 않게)
  const picks = points.filter((p) => p.changed);
  if (points.length && !picks.includes(points[points.length - 1])) picks.push(points[points.length - 1]);
  let diffs = 0;
  for (const p of picks) {
    const base = { ARMOR: p.neu.ARMOR, MR: p.neu.MR, HP: p.neu.HP };  // 방어력·마법 저항력·체력은 C1·C2 가 안 건드린다
    const A = sceneOf(champ, p.myItems, { ...base, HEAL: p.old.HEAL });                              // 수정 전
    const B1 = sceneOf(champ, p.myItems, { ...base, HEAL: p.neu.HEAL });                             // C1 만
    const B2 = sceneOf(champ, p.myItems, { ...base, bonusHP: p.neu.bonusHP, HEAL: p.old.HEAL });     // C2 만
    const C = sceneOf(champ, p.myItems, { ...base, bonusHP: p.neu.bonusHP, HEAL: p.neu.HEAL });      // 둘 다
    const dd = diffScene(A, C), d1 = diffScene(A, B1), d2 = diffScene(A, B2);
    if (anyDiff(dd)) diffs++;
    sceneRows.push({ game: g, t: p.t, 내아이템: p.myItems.length,
      HEAL: [p.old.HEAL, p.neu.HEAL], 추가체력: [St.DEFAULT_TARGET.BONUS_HP, p.neu.bonusHP], ...dd,
      C1만: d1, C2만: d2,
      ...(dd.top1 ? { 바뀐1순위: [A.top1, C.top1], "1순위_C1만": B1.top1, "1순위_C2만": B2.top1 } : {}),
      치유감소점수: [A.치유감소점수, C.치유감소점수], 거인학살점수: [A.거인학살점수, C.거인학살점수] });
  }
  const last = points[points.length - 1];
  gameRows.push({ game: g, champ: start.champion, enemy이벤트: points.length, 비교장면: picks.length, 달라진장면: diffs,
    최종_HEAL: [last.old.HEAL, last.neu.HEAL], 최종_추가체력: [St.DEFAULT_TARGET.BONUS_HP, last.neu.bonusHP],
    보호막이던몫: last.old.HEAL ? Math.round((1 - last.neu.HEAL / last.old.HEAL) * 100) + "%" : "-" });
}

// ---- 2. 전 챔피언 173명: 회복량·추가 체력의 증감 방향 (늘면 오르고 줄면 내려가는가)
const baseT = { ARMOR: 113, MR: 63, HP: 3148 };
const probe = [];
for (const c of d.champions) {
  const w = S.profile(c, d.tags);
  const sc = (t, it) => { St.setTarget(t); const r = S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced").find((x) => x.item.id === it.id); return r ? r.score : NaN; };
  const h0 = sc({ ...baseT, HEAL: 0 }, HEALCUT[0]), h600 = sc({ ...baseT, HEAL: 600 }, HEALCUT[0]);
  const b0 = sc({ ...baseT, bonusHP: 0 }, BONUSHP[0]), b2000 = sc({ ...baseT, bonusHP: 2000 }, BONUSHP[0]);
  probe.push({ champ: c.id, 치유감소_증가: h600 - h0, 거인학살_증가: b2000 - b0 });
}
const bad = probe.filter((r) => !(r.치유감소_증가 > 0) || !(r.거인학살_증가 > 0));

// ---- 3. 캐시 적중 결과와 초기화 뒤 결과가 같은가
const cacheRows = [];
for (const c of d.champions.slice(0, 20)) {
  const w = S.profile(c, d.tags);
  for (const t of [{ ...baseT, bonusHP: 300, HEAL: 0 }, { ...baseT, bonusHP: 1800, HEAL: 450 }]) {
    St.setTarget(t);
    const a = ids(S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced"));
    const b = ids(S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced"));  // 기억 적중
    S.clearMemo();
    St.setTarget(t);
    const z = ids(S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced"));  // 초기화 뒤
    if (!same(a, b) || !same(a, z)) cacheRows.push({ champ: c.id, target: t, 적중일치: same(a, b), 초기화일치: same(a, z) });
  }
}

// ---- 4. 버티는 힘(EHP) 보존: 수정 전 stats.js 와 비교 (OLD_STATS 를 주면)
const ehpRows = [];
const oldPath = process.env.OLD_STATS;
if (oldPath && fs.existsSync(oldPath)) {
  const OldStats = require(path.resolve(oldPath));
  // 자기 회복·보호막 효과를 가진 아이템 전부 (이름을 박지 않는다)
  const hs = d.items.filter((i) => (i.effects || []).some((e) => e.kind === "shield" || e.kind === "heal")
    || ((RI[i.name] || {}).stats || {}).selfHeal != null || ((RI[i.name] || {}).stats || {}).selfHealMult != null);
  St.setTarget(null);
  for (const c of d.champions) for (const it of hs) {
    const a = St.evaluate(c, 18, [it], [], OPTS).m, b = OldStats.evaluate(c, 18, [it], [], OPTS).m;
    const dd = Math.abs(a.ehp - b.ehp) + Math.abs((a.itemSelfHp || 0) - (b.itemSelfHp || 0));
    if (dd > 1e-9) ehpRows.push({ champ: c.id, item: it.name, ehp: [b.ehp, a.ehp], itemSelfHp: [b.itemSelfHp, a.itemSelfHp] });
  }
  ehpRows.unshift({ 비교한아이템: hs.length, 비교한챔피언: d.champions.length });
}
St.setTarget(null);

const changed = sceneRows.filter(anyDiff);
const out = {
  요약: {
    게임수: gameRows.length, 비교장면: sceneRows.length, 달라진장면: changed.length,
    "1순위바뀜": sceneRows.filter((r) => r.top1).length, Top3구성바뀜: sceneRows.filter((r) => r.top3구성).length,
    Top3순서바뀜: sceneRows.filter((r) => r.top3순서).length, Top6순서바뀜: sceneRows.filter((r) => r.top6순서).length,
    다음구매바뀜: sceneRows.filter((r) => r.다음구매).length, 빌드바뀜: sceneRows.filter((r) => r.빌드).length,
    적대응바뀜: sceneRows.filter((r) => r.적대응).length,
    C1만_달라진장면: sceneRows.filter((r) => anyDiff(r.C1만)).length, C2만_달라진장면: sceneRows.filter((r) => anyDiff(r.C2만)).length,
    "C1만_1순위": sceneRows.filter((r) => r.C1만.top1).length, "C2만_1순위": sceneRows.filter((r) => r.C2만.top1).length,
    C1만_Top3구성: sceneRows.filter((r) => r.C1만.top3구성).length, C2만_Top3구성: sceneRows.filter((r) => r.C2만.top3구성).length,
    C1만_다음구매: sceneRows.filter((r) => r.C1만.다음구매).length, C2만_다음구매: sceneRows.filter((r) => r.C2만.다음구매).length,
    C1만_빌드: sceneRows.filter((r) => r.C1만.빌드).length, C2만_빌드: sceneRows.filter((r) => r.C2만.빌드).length,
    C1만_적대응: sceneRows.filter((r) => r.C1만.적대응).length, C2만_적대응: sceneRows.filter((r) => r.C2만.적대응).length,
    챔피언수: probe.length, 증감방향이상: bad.length, 캐시불일치: cacheRows.length,
    버티는힘차이: oldPath ? Math.max(0, ehpRows.length - 1) : "미실행 (OLD_STATS 없음)",
  },
  증감_요약: {
    치유감소_증가_최소: Math.min(...probe.map((r) => r.치유감소_증가)), 치유감소_증가_최대: Math.max(...probe.map((r) => r.치유감소_증가)),
    거인학살_증가_최소: Math.min(...probe.map((r) => r.거인학살_증가)), 거인학살_증가_최대: Math.max(...probe.map((r) => r.거인학살_증가)),
    기준아이템: { 치유감소: HEALCUT[0] && HEALCUT[0].name, 거인학살: BONUSHP[0] && BONUSHP[0].name },
  },
  games: gameRows, 달라진장면: changed, 증감방향이상: bad.slice(0, 10), 캐시불일치: cacheRows.slice(0, 10), 버티는힘차이: ehpRows.slice(0, 11),
};
const jsonAt = process.argv.indexOf("--json");
if (jsonAt > 0 && process.argv[jsonAt + 1]) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ ...out, scenes: sceneRows }, null, 1));
console.log(JSON.stringify({ 요약: out.요약, 증감_요약: out.증감_요약, games: out.games }, null, 1));
