// v0.1.95 Phase 4 C5 검증: 조언이 '다음 구매' 3번째 자리에 아이템을 끼워 넣던 것을 없앤 뒤
// 실제 화면(web/app.js 를 jsdom 에 그대로 띄움)에서 무엇이 달라지는지 장면마다 적는다.
//   node tools/c5_check.js --dump <결과파일> [로그폴더] [--limit N]   지금 코드로 계산해 저장
//   node tools/c5_check.js --cmp <전> <후>                            저장한 두 결과를 견준다
// 수정 전후 비교는 git worktree 로 예전 코드를 따로 받아 각각 --dump 한 뒤 --cmp 한다 (C9-B 때와 같은 방법).
// 특정 아이템의 순위 상승·하락을 성공 조건으로 삼지 않는다. 바뀐 장면의 '원인'을 적는 것이 목적이다.
const path = require("path"), fs = require("fs");
const ROOT = path.join(__dirname, "..");
const { loadPage } = require(path.join(ROOT, "tests", "page.js"));
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
const byName = new Map(d.items.map((i) => [i.name, i]));
const augByName = new Map(d.augments.map((a) => [a.name, a]));
const argv = process.argv.slice(2);
const flag = (n, dflt = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };

// ---- 기록에서 장면 모으기 (내 챔피언·레벨·산 아이템·고른 증강 + 그때 적 빌드)
function scenes(root, limit) {
  const out = [];
  const games = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, "events.json"))) : [];
  for (const g of games) {
    const evs = JSON.parse(fs.readFileSync(path.join(root, g, "events.json"), "utf8"));
    const start = evs.find((x) => x.kind === "start") || {};
    if (!start.champion) continue;
    let items = [], augs = [], level = 1;
    const seen = new Set();
    for (const x of evs) {
      if (x.kind === "items") { items = x.items || []; level = x.level || level; }
      if (x.kind === "picked" && x.picked) augs = augs.concat([x.picked]);
      if (x.kind !== "enemy" || !(x.builds || []).length) continue;
      const builds = x.builds.map((e) => ({ champion: e.champ, level: e.level || 18,
        items: (e.items || []).map((n) => (byName.get(n) || {}).id).filter(Boolean),
        augments: e.augments || [] }));
      const key = [items.join("|"), augs.join("|"), JSON.stringify(builds.map((b) => [b.champion, b.items]))].join("/");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ game: g, t: x.t, champion: start.champion, level,
        items: items.map((n) => (byName.get(n) || {}).id).filter(Boolean),
        augs: augs.map((n) => (augByName.get(n) || {}).id).filter(Boolean),
        enemies: builds.map((b) => b.champion), builds });
      if (limit && out.length >= limit) return out;
    }
  }
  return out;
}

async function dump(file, root, limit) {
  const list = scenes(root, limit);
  const p = await loadPage({ simple: true });
  p.w.pywebview = { api: { set_overlay: () => {} } };
  const rows = [];
  const t0 = Date.now();
  for (const sc of list) {
    p.w.applyLive({ enabled: true, inGame: true, champion: sc.champion, level: sc.level, items: sc.items,
      enemies: sc.enemies, enemyBuilds: sc.builds });
    for (const id of sc.augs) p.w.applyAug({ offers: null, seq: 1, picked: (d.augments.find((a) => a.id === id) || {}).name, pickSeq: 1 });
    p.w.renderItemList();
    const next = p.qa("#next-buy .next-row").map((e) => ({ name: (e.dataset.label || e.title || "").trim(), chip: (e.querySelector(".chip") || {}).textContent || "" }));
    const adv = p.qa("#next-buy .enemy-advice div").map((e) => e.textContent.trim());
    const swText = p.text("#next-buy");
    rows.push({ key: `${sc.game}:${sc.t}`, champ: sc.champion, next: next.map((n) => n.name), chips: next.map((n) => n.chip.trim()),
      advice: adv, swap: /바꾸면|적 대응/.test(swText) ? swText.slice(0, 160) : "" });
  }
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), scenes: rows.length, ms: Date.now() - t0, rows }, null, 1));
  console.log(`장면 ${rows.length}개 저장 (${Date.now() - t0}ms) → ${file}`);
  console.log(`조언 줄에 '계산에는 안 들어감(참고)'이 붙은 장면 ${rows.filter((r) => r.advice.some((a) => a.includes("계산에는 안 들어감"))).length}`);
  console.log(`다음 구매에 '🛡️' 표가 붙은 장면 ${rows.filter((r) => r.chips.some((c) => c.includes("🛡️"))).length}`);
  process.exit(0);
}

function cmp(a, b) {
  const A = JSON.parse(fs.readFileSync(a, "utf8")), B = JSON.parse(fs.readFileSync(b, "utf8"));
  const map = new Map(A.rows.map((r) => [r.key, r]));
  let n = 0, nextMoved = 0, top1 = 0, advMoved = 0, swapMoved = 0;
  const why = new Map();
  for (const r of B.rows) {
    const o = map.get(r.key); if (!o) continue;
    n++;
    if (o.next.join() !== r.next.join()) {
      nextMoved++;
      if (o.next[0] !== r.next[0]) top1++;
      const gone = o.next.filter((x) => !r.next.includes(x)), came = r.next.filter((x) => !o.next.includes(x));
      const k = `${gone.join("·") || "-"} → ${came.join("·") || "-"}`;
      why.set(k, (why.get(k) || 0) + 1);
    }
    if (o.advice.join() !== r.advice.join()) advMoved++;
    if (o.swap !== r.swap) swapMoved++;
  }
  console.log(`장면 ${n}개 비교 (전 ${A.scenes} · 후 ${B.scenes})`);
  console.log(`다음 구매 3개가 달라진 장면 ${nextMoved} · 그중 1순위까지 ${top1}`);
  console.log(`조언 줄이 달라진 장면 ${advMoved} · 바꾸기 안내가 달라진 장면 ${swapMoved}`);
  console.log("바뀐 내용 (빠진 것 → 들어온 것):");
  for (const [k, c] of [...why].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`   ${String(c).padStart(4)}장면  ${k}`);
}

if (argv[0] === "--dump") dump(flag("--dump"), argv.find((x, i) => i > 1 && !x.startsWith("--") && argv[i - 1] !== "--limit") || "E:/Downloads/06.Up/칼바람증강Addon/data/logs/games", Number(flag("--limit", 0)));
else if (argv[0] === "--cmp") cmp(argv[1], argv[2]);
else console.log("쓰는 법: node tools/c5_check.js --dump <파일> [로그폴더] [--limit N]  |  --cmp <전> <후>");
