// 추천 계산 성능 (기획서 10장): 화면이 부르는 계산을 대표 챔피언 16명으로 재서 평균·상위 95%·최대 시간, 메모리, 기억(memo) 효과를 본다.
//   node tools/perf_check.js                    지금 web/ 코드·데이터
//   node tools/perf_check.js --web <폴더>        다른 버전의 web/ (예: git worktree 로 꺼낸 main) — 수정 전후 비교
//   node tools/perf_check.js --json
// 장면: ① 다음 구매 순위(증강 없음) ② 증강 2개 고른 뒤 다음 구매 순위 + 연계 ③ 증강 선택 화면 등급 ④ 빌드 3종
// 차가움 = 기억을 비우고 처음 계산, 따뜻함 = 같은 입력을 바로 다시 (게임 연동은 3초마다 같은 입력으로 다시 그린다)
const fs = require("fs");
const path = require("path");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const WEB = path.resolve(arg("--web") || path.join(__dirname, "..", "web"));
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));
const d = JSON.parse(fs.readFileSync(path.join(WEB, "data.json"), "utf8"));
const REPS = ["Jinx", "Ezreal", "Lux", "Annie", "Malphite", "Garen", "Zed", "Sona", "Darius", "Yasuo", "Vayne", "Nami", "Varus", "Caitlyn", "Jhin", "Kayle"];
const OPTS = { aram: true };
const ROUNDS = Number(arg("--rounds") || 3);

function time(fn) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}
const stat = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

function run() {
  S.attachSimilar(d.champions, null, d.items);
  const scenes = {
    "다음 구매 (증강 없음)": (c, w) => S.tieOrder(S.rankItems(d.items, w, [], [], d.rules, c, OPTS, "balanced"), () => 3),
    "다음 구매 (증강 2개 + 연계)": (c, w, two) => {
      S.rankItems(d.items, w, two, [], d.rules, c, OPTS, "augment");
      S.itemSynergy(d.items, w, two, [], d.rules, c, OPTS);
    },
    "증강 선택 등급": (c, w) => S.augmentTiers(d.augments, d.items, w, [], [], d.rules, c, OPTS),
    "빌드 3종": (c, w, two) => S.buildConcepts(d.items, w, two, [], d.rules, c, OPTS),
  };
  const out = {};
  const heap0 = process.memoryUsage().heapUsed;
  for (const [name, fn] of Object.entries(scenes)) {
    const cold = [], warm = [];
    for (let r = 0; r < ROUNDS; r++) {
      for (const id of REPS) {
        const c = d.champions.find((x) => x.id === id);
        if (!c) continue;
        const w = S.profile(c, d.tags);
        const two = d.augments.filter((a) => a.rarity === 1 && (a.effects || []).length).slice(0, 2);
        S.clearMemo();
        cold.push(time(() => fn(c, w, two)));
        warm.push(time(() => fn(c, w, two)));
      }
    }
    out[name] = { cold: stat(cold), warm: stat(warm) };
  }
  const mem = process.memoryUsage();
  return { web: WEB, dataVersion: d.dataVersion, rounds: ROUNDS, scenes: out,
    heapMB: +(mem.heapUsed / 1048576).toFixed(1), heapGrowMB: +((mem.heapUsed - heap0) / 1048576).toFixed(1), rssMB: +(mem.rss / 1048576).toFixed(1) };
}

if (require.main === module) {
  const r = run();
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  console.log(`${r.web} · 챔피언 ${REPS.length}명 × ${r.rounds}번`);
  console.log("장면                          차가움 평균 / 95% / 최대 (ms)     따뜻함 평균 / 최대 (ms)");
  for (const [k, v] of Object.entries(r.scenes)) {
    console.log(`  ${k.padEnd(24)} ${String(v.cold.avg).padStart(8)} / ${String(v.cold.p95).padStart(7)} / ${String(v.cold.max).padStart(7)}     ${String(v.warm.avg).padStart(6)} / ${String(v.warm.max).padStart(6)}`);
  }
  console.log(`메모리: 힙 ${r.heapMB}MB (측정 중 +${r.heapGrowMB}MB) · 전체 ${r.rssMB}MB`);
}
module.exports = { run };
