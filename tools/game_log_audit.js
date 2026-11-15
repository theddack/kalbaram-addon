// 실전 기록 검증 (v0.1.93 P4-B): 한 판 기록(events.json)으로 ① 추천 계산의 정확도와 ② 애드온의 수집 정확도를 나눠 본다.
//   node tools/game_log_audit.js <기록 폴더|data 폴더|events.json> [...]      요약
//   node tools/game_log_audit.js <...> --md 보고서.md --json 결과.json
//   node tools/game_log_audit.js <...> --eog <measure 폴더>                   경기 결과의 증강 번호까지 대조
// 같은 판의 폴더와 zip 이 같이 있으면 폴더만 쓴다 (한 판을 두 번 세지 않는다).
// 재계산은 '지금 엔진'(v0.1.93)으로 한다. 기록 안의 계산값은 그 판을 돌린 버전(events start.version)의 값이라 따로 적는다.
// 개인정보(소환사 이름·PUUID·토큰·채팅)는 읽지 않는다: 경기 결과 파일에서도 gameId·길이·증강 번호만 본다.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
const STAT_OFF = 0.05;  // app.js STAT_OFF 과 같게
const SMALL = { AS: 0.02, CRIT: 0.02, LS: 0.02 };  // 아주 작은 값의 반올림 차이 제외 폭 (app.js statOff)
const byId = (id) => d.items.find((i) => String(i.id) === String(id));
const augById = (id) => d.augments.find((a) => a.id === id);
const augByNum = (n) => d.augments.find((a) => a.num === n);

// ---- 기록 모으기 (폴더·zip 중복 제거)
function gameDirs(input) {
  const out = [];
  const add = (p) => { if (fs.existsSync(path.join(p, "events.json"))) out.push(p); };
  const stat = fs.existsSync(input) && fs.statSync(input);
  if (!stat) return out;
  if (stat.isFile()) return path.basename(input) === "events.json" ? [path.dirname(input)] : out;
  add(input);
  for (const name of fs.readdirSync(input)) {
    const p = path.join(input, name);
    if (fs.statSync(p).isDirectory()) out.push(...gameDirs(p));
  }
  return [...new Set(out)];
}

// ---- 한 판 읽기
function readGame(dir) {
  const ev = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8"));
  const start = ev.find((e) => e.kind === "start") || {};
  const eog = ev.find((e) => e.kind === "eog") || null;
  return { dir, name: path.basename(dir), champion: start.champion, enemies: start.enemies || [], version: start.version, events: ev, eog };
}

// ---- 타임라인 (무엇이 추천을 바꿀 수 있었나)
const TIMELINE_KINDS = { start: "게임 시작", offers: "증강 선택지 읽음", picked: "증강 고름(클릭)", pickfix: "증강 바로잡음(실제 능력치)", items: "아이템·골드", statcheck: "능력치 대조", verify: "증강 칸 확인", eog: "경기 결과 대조" };
function timeline(g) {
  const rows = [];
  let items = [], augs = [], level = null;
  for (const e of g.events) {
    if (!TIMELINE_KINDS[e.kind]) continue;
    const r = { t: e.t, kind: e.kind, what: TIMELINE_KINDS[e.kind] };
    if (e.kind === "start") r.detail = `${e.champion} · 적 ${(e.enemies || []).join("·")} · 애드온 ${e.version}`;
    if (e.kind === "offers") r.detail = `읽음 ${(e.offers || []).map((x) => x || "?").join(" / ")}`;
    if (e.kind === "picked") r.detail = `${e.picked} (후보 ${(e.from || []).map((x) => x || "?").join(" / ")})`;
    if (e.kind === "pickfix") r.detail = `${e.from} → ${e.to} (어긋난 능력치 ${(e.off || []).join("·")})`;
    if (e.kind === "verify") r.detail = `${e.click}: ${e.result}`;
    if (e.kind === "items") { const names = (e.items || []).map((id) => (byId(id) || {}).name || id); r.detail = `${names.join(", ")} · 골드 ${e.gold}`; items = e.items || []; }
    if (e.kind === "statcheck") {
      level = e.level; augs = e.augs || [];
      const off = Object.entries(e.rows || {}).filter(([k, v]) => statOff(v, k)).map(([k, v]) => `${k} 계산 ${v[0]} vs 실제 ${v[1]}`);
      r.detail = `${e.level}레벨 · 아이템 ${(e.items || []).length}개 · 증강 ${(e.augs || []).map((a) => (augById(a) || {}).name || a).join("·")}${off.length ? " · 어긋남: " + off.join(", ") : ""}`;
      r.off = off.length;
    }
    if (e.kind === "eog") r.detail = `경기 결과 ${(e.augments || []).join("·")} vs 클릭 ${(e.picked || []).join("·")} → ${e.match ? "같음" : "다름"}`;
    rows.push(r);
  }
  return rows;
}

const statOff = ([calc, real], k) => Math.abs(calc - real) > Math.max(Math.abs(real) * STAT_OFF, SMALL[k] || 1);

// ---- 성장 능력치 되감기 (v0.1.93): 기록된 능력치 대조 줄을 순서대로 보며 화면(app.js trackGrow)과 같은 규칙으로 추정한다.
//   · 아이템·레벨이 바뀐 줄은 건너뛴다 (산 직후 값이 섞인다)  · 같은 값이 두 줄 이어질 때만 반영  · 상한 안에서만
// 화면은 초 단위로 더 자주 재지만 기록은 바뀔 때만 남아, 여기 추정은 화면보다 느리게 따라간다 (그래서 '되감기'는 참고값이다)
function growOf(rules, champ, items, chosen) {
  const out = [];
  for (const it of items) {
    const rule = (rules.items || {})[it.name] || {};
    for (const [k, g] of Object.entries(rule.grow || {})) {
      const assume = (it.passiveStats || {})[k] ?? (it.stats || {})[k] ?? 0;
      out.push({ key: k, assume, cap: typeof g === "number" ? g : g.max, src: it.name });
    }
  }
  for (const a of chosen) {
    const rule = S.ruleOf(rules, a);
    const st = (S.augStatsOf([a], rules, champ) || [])[0] || {};
    for (const [k, g] of Object.entries(rule.grow || {})) out.push({ key: k, assume: st[k] || 0, cap: typeof g === "number" ? g : g.max, src: a.name });
  }
  return out;
}

// ---- 능력치 재계산 (지금 엔진으로)
function recheck(g) {
  const champ = d.champions.find((c) => c.id === g.champion);
  const rows = [];
  if (!champ) return rows;
  const cand = {}, est = {}, one = {}, held = {};
  let lastKey = null;
  for (const e of g.events.filter((x) => x.kind === "statcheck")) {
    const key = JSON.stringify([e.level, [...(e.items || [])].sort(), [...(e.augs || [])].sort()]);
    const chosen = (e.augs || []).map(augById).filter(Boolean);
    const c = S.withChosenFeatures(champ, chosen, d.rules);
    const items = (e.items || []).map(byId).filter(Boolean);
    const opts = { aram: true, now: true };
    // 화면(app.js nowAugStats)과 같은 입력: 즉시 골드로 바꾼 값과 가동률로 셈한 조건부 능력치는 뺀다 (게임 값에 이미 들어 있거나 켜져 있을 때만 보임).
    // 처치 관여로 쌓는 능력치와 모루 능력치는 기록에 없어 넣지 못한다 (그만큼 계산이 낮게 나올 수 있다 → 보고서에 적는다)
    const augStats = S.augStatsOf(chosen, d.rules, champ).map((s, i) => {
      if (!s) return s;
      const rule = S.ruleOf(d.rules, chosen[i]);
      const o = { ...(s.goldValue ? { ...s, goldValue: 0 } : s) };
      for (const k of rule.uptime || []) delete o[k];
      return o;
    });
    const anvil = e.anvil && Object.keys(e.anvil).length ? [{ ...e.anvil }] : [];
    const t = Stats.computeStats(c, e.level, items, [...augStats, ...anvil], opts).total;
    // 성장 능력치 되감기: 같은 입력에서 성장 몫을 0 으로 둔 값과 실제를 견줘 지금 쌓인 양을 짐작한다
    const grows = growOf(d.rules, champ, items, chosen);
    const changed = key !== lastKey;
    lastKey = key;
    const withGrow = { ...t };
    for (const gr of grows) {
      if (grows.filter((x) => x.key === gr.key).length > 1) continue;
      const real = (e.rows || {})[gr.key] ? e.rows[gr.key][1] : null;
      if (real == null) continue;
      const base = (t[gr.key] || 0) - gr.assume;  // 성장 몫을 뺀 값 (근사: 비율 증가가 있으면 조금 다름)
      const v = Math.max(0, Math.min(gr.cap, real - base));
      const tol = Math.max(Math.abs(gr.cap) * 0.02, ["CRIT", "AS", "LS"].includes(gr.key) ? 0.02 : 1);
      const c0 = cand[gr.key];
      if (changed) { cand[gr.key] = null; one[gr.key] = v; continue; }  // 아이템·레벨이 막 바뀐 줄 (참고값만)
      one[gr.key] = v;
      if (!c0 || Math.abs(c0 - v) > tol) { cand[gr.key] = v; continue; }
      est[gr.key] = v;
      held[gr.key] = (held[gr.key] || 0) + 1;
    }
    for (const gr of grows) if (est[gr.key] != null) withGrow[gr.key] = (t[gr.key] || 0) - gr.assume + est[gr.key];
    // 참고: 한 번 읽은 값만으로 맞춘 경우 (화면 규칙은 같은 값이 두 번 이어질 때만 쓴다)
    const withOne = { ...t };
    for (const gr of grows) if (one[gr.key] != null) withOne[gr.key] = (t[gr.key] || 0) - gr.assume + one[gr.key];
    for (const [k, v] of Object.entries(e.rows || {})) {
      const [oldCalc, real] = v;
      const now = Math.round((t[k] || 0) * 100) / 100;
      const grown = Math.round((withGrow[k] || 0) * 100) / 100;
      const grownOne = Math.round((withOne[k] || 0) * 100) / 100;
      rows.push({ t: e.t, level: e.level, stat: k, real, old: oldCalc, now, grown, grownOne,
        oldOff: statOff([oldCalc, real], k), nowOff: statOff([now, real], k), grownOff: statOff([grown, real], k),
        grownOneOff: statOff([grownOne, real], k),
        items: (e.items || []).length, augs: (e.augs || []).map((a) => (augById(a) || {}).name || a) });
    }
  }
  return rows;
}

// ---- 증강 기록 대조 (클릭 추적 vs 경기 결과). eogDir 이 있으면 번호까지 본다 (이름·계정 칸은 읽지 않는다)
function augmentCheck(g, eogDir) {
  const champKey = (d.champions.find((c) => c.id === g.champion) || {}).key;
  const picked = g.events.filter((e) => e.kind === "picked").map((e) => ({ t: e.t, name: e.picked, from: e.from || [] }));
  const fixes = g.events.filter((e) => e.kind === "pickfix").map((e) => ({ t: e.t, from: e.from, to: e.to, off: e.off }));
  const out = { picked, fixes, eogNames: g.eog ? g.eog.augments || [] : null, match: g.eog ? g.eog.match : null, nums: null, unknown: [] };
  if (!eogDir || !fs.existsSync(eogDir)) return out;
  for (const f of fs.readdirSync(eogDir).filter((n) => /^eog_\d+\.json$/.test(n))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(eogDir, f), "utf8")); } catch { continue; }
    const st = ((j.localPlayer || {}).stats) || {};
    const nums = [1, 2, 3, 4, 5, 6].map((i) => st[`playerAugment${i}`]).filter(Boolean);
    if (!nums.length) continue;
    const names = nums.map((n) => ({ num: n, name: (augByNum(n) || {}).name || null }));
    // 이 판인지: 내 챔피언 번호로 잇는다 (기록에는 gameId 가 없다). 같은 챔피언으로 여러 판을 했으면 경기 길이가 가까운 쪽
    if (String((j.localPlayer || {}).championId) !== String(champKey)) continue;
    const logSec = Math.max(...g.events.map((x) => x.t || 0));
    const gap = Math.abs((j.gameLength || 0) - logSec);
    if (out.nums && out.gap <= gap) continue;
    out.gap = gap;
    out.nums = names;
    out.unknown = names.filter((x) => !x.name).map((x) => x.num);
    out.onlyInLog = picked.map((p) => p.name).filter((nm) => !names.some((x) => x.name === nm));
    out.onlyInGame = names.filter((x) => x.name && !picked.some((p) => p.name === x.name)).map((x) => x.name);
  }
  return out;
}

function markdown(res) {
  const L = ["# 실전 기록 검증", "", `도구: \`node tools/game_log_audit.js\` · 지금 엔진으로 다시 계산한 값과 기록 당시 값(애드온 버전)을 나눠 적어요.`, "",
    "> 실전 몇 판은 오류를 찾는 표본이지, 추천이 좋다는 증거가 아니에요. 계산 결과와 게임이 알려 준 값의 비교예요.", ""];
  for (const g of res) {
    L.push(`## ${g.champion} (${g.name})`, "", `애드온 ${g.version} · 적 ${g.enemies.join("·")} · 기록 ${g.events}개`, "");
    L.push("### 증강", "", `- 클릭으로 고른 것: ${g.aug.picked.map((p) => `${p.name}(${p.t.toFixed(0)}초)`).join(", ") || "없음"}`);
    if (g.aug.fixes.length) L.push(`- 실제 능력치로 바로잡음: ${g.aug.fixes.map((f) => `${f.t.toFixed(0)}초 ${f.from} → ${f.to} (${(f.off || []).join("·")})`).join(", ")}`);
    L.push(`- 경기 결과: ${(g.aug.eogNames || []).join(", ") || "없음"} → ${g.aug.match ? "같음" : "다름"}`);
    if (g.aug.nums) {
      L.push(`- 경기 결과 번호: ${g.aug.nums.map((x) => `${x.num}${x.name ? "=" + x.name : "(모르는 번호)"}`).join(", ")}`);
      if (g.aug.onlyInLog && g.aug.onlyInLog.length) L.push(`- 기록에만 있음: ${g.aug.onlyInLog.join(", ")}`);
      if (g.aug.onlyInGame && g.aug.onlyInGame.length) L.push(`- 경기 결과에만 있음: ${g.aug.onlyInGame.join(", ")}`);
    }
    L.push("", "### 능력치 (지금 엔진 재계산)", "", "| 능력치 | 어긋난 횟수 (기록 당시 → 지금) | 가장 큰 차이 |", "|---|---|---|");
    for (const [k, s] of Object.entries(g.stats)) {
      L.push(`| ${k} | ${s.oldOff} → ${s.nowOff} / ${s.n} | ${s.worst ? `${s.worst.level}레벨 ${s.worst.t.toFixed(0)}초: 계산 ${s.worst.now} vs 실제 ${s.worst.real}` : "—"} |`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

function run(inputs, eogDir) {
  const dirs = inputs.flatMap(gameDirs);
  return dirs.map((dir) => {
    const g = readGame(dir);
    const rc = recheck(g);
    const stats = {};
    for (const r of rc) {
      const s = (stats[r.stat] = stats[r.stat] || { n: 0, oldOff: 0, nowOff: 0, grownOff: 0, worst: null });
      s.n++; s.oldOff += r.oldOff ? 1 : 0; s.nowOff += r.nowOff ? 1 : 0; s.grownOff += r.grownOff ? 1 : 0;
      s.grownOneOff = (s.grownOneOff || 0) + (r.grownOneOff ? 1 : 0);
      const gap = Math.abs(r.now - r.real) / Math.max(1e-9, Math.abs(r.real));
      if (r.nowOff && (!s.worst || gap > Math.abs(s.worst.now - s.worst.real) / Math.max(1e-9, Math.abs(s.worst.real)))) s.worst = r;
    }
    const held = rc.filter((r) => r.grown !== r.now).length;
    return { name: g.name, champion: g.champion, version: g.version, enemies: g.enemies, events: g.events.length,
      timeline: timeline(g), aug: augmentCheck(g, eogDir), stats, rows: rc, growHeld: held };
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const inputs = argv.filter((a, i) => !a.startsWith("--") && !["--md", "--json", "--eog"].includes(argv[i - 1]));
  if (!inputs.length) { console.log("쓰는 법: node tools/game_log_audit.js <기록 폴더> [--eog <measure 폴더>] [--md 파일] [--json 파일]"); process.exit(1); }
  const res = run(inputs, arg("--eog"));
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(res, null, 1));
  if (arg("--md")) fs.writeFileSync(arg("--md"), markdown(res));
  for (const g of res) {
    const off = Object.entries(g.stats).filter(([, s]) => s.nowOff).map(([k, s]) => `${k} ${s.nowOff}→${s.grownOff}(참고 ${s.grownOneOff})/${s.n}`);
    console.log(`${g.champion} (${g.name}) · 애드온 ${g.version} · 기록 ${g.events}개`);
    console.log(`  증강: 클릭 ${g.aug.picked.length}개 · 경기 결과 ${(g.aug.eogNames || []).length}개 → ${g.aug.match ? "같음" : "다름"}${g.aug.unknown.length ? ` · 모르는 번호 ${g.aug.unknown.join(",")}` : ""}`);
    if (g.aug.onlyInLog && g.aug.onlyInLog.length) console.log(`         기록에만: ${g.aug.onlyInLog.join(", ")} · 경기 결과에만: ${(g.aug.onlyInGame || []).join(", ") || "없음"}`);
    console.log(`  지금 엔진 능력치 어긋남 (성장 되감기 전→후, 괄호는 한 번 읽은 값 참고): ${off.join(" · ") || "없음"}`);
    if (!g.growHeld) console.log("  ※ 되감기 반영 0회: 능력치 대조 기록은 레벨·아이템·증강이 바뀔 때만 남아, '같은 값 두 번' 규칙을 채우지 못해요 (화면은 1초마다 재요)");
  }
}
module.exports = { run, gameDirs, statOff };
