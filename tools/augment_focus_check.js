// P3-R 증강 몰빵 목표 함수 원인 분석: 대표 장면에서 몰빵 빌드 점수를 수치(전체 전투 가치 V · 증강 몫 A) · 태그로 나누고,
// 다른 빌드(E2 전 몰빵 등)를 같은 목표 함수로 다시 재서 '목표 함수가 그 빌드를 낮게 보나' vs '탐색이 놓쳤나'를 가른다.
//   node tools/augment_focus_check.js                      대표 장면 (럭스·애니 + 응급처치 키트, 소나 + 격려하기 …)
//   node tools/augment_focus_check.js --focus 2            몰빵 focus 세기 실험 (기본 CONCEPTS[0].focus = 1)
//   AUG_DELTA=0.1 node tools/augment_focus_check.js        허용폭 실험 (tools/exp_env.js)
// 몰빵 목표(scoring.js buildWith finalScore, δ 없음) = (V + focus × A) × NUM_K + 태그 × TAG_K. 증강 몰빵에는 공식 추천 가산이 없다(기본).
// 계산 결과끼리의 비교예요. 기본 목표 함수는 바꾸지 않는다.
const path = require("path");
const zlib = require("zlib"), fs = require("fs");
const W = path.join(__dirname, "..", "web");
global.Stats = global.Stats || require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const EXP = require("./exp_env")(S, global.Stats);
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const NUM_K = 4, TAG_K = 0.4;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (arg("--focus")) { S.CONCEPTS[0].focus = +arg("--focus"); S.clearMemo(); }  // = 환경 변수 AUG_FOCUS
const SCENES = [["Lux", "응급처치 키트"], ["Annie", "응급처치 키트"], ["Sona", "격려하기"], ["Lux", "빵과 버터"], ["Annie", "자연의 회복"], ["Lux", "타오르는 새벽"]];
const prev = (() => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "..", "tests", "data", "p2", "augment_fit_C.json.gz")))); } catch { return []; } })();
const byName = (n) => d.items.find((i) => i.name === n);

function scene(id, augName) {
  const c = d.champions.find((x) => x.id === id), a = d.augments.find((x) => x.name === augName);
  const w = S.profile(c, d.tags);
  const eng = S.buildConcepts(d.items, w, [a], [], d.rules, c, {}, ["augment"])[0];
  const bal = S.buildConcepts(d.items, w, [a], [], d.rules, c, {}, ["balanced"])[0];
  const focus = S.CONCEPTS[0].focus;
  const part = (list) => {
    const V = eng.valueOf(list), A = eng.augOf(list), sc = eng.scoreOf(list);
    return { V, A, num: NUM_K * (V + focus * A), tag: sc - NUM_K * (V + focus * A), score: sc };
  };
  const mine = eng.pick.map((p) => p.item), balL = bal.pick.map((p) => p.item);
  const old = (prev.find((r) => r.champ === id && r.aug === augName) || {}).mineItems;
  const rows = [["몰빵 (지금)", mine], ["균형", balL]];
  if (old) {
    const oldL = [mine.find((i) => i.kind === "boots"), ...old.map(byName)].filter(Boolean);
    rows.push(["몰빵 (E2 전)", oldL]);
    // 탐색 점검: E2 전 몰빵에서 같은 목표·같은 제약으로 한 칸 교체를 올라가 본다 (지금 몰빵보다 높은 구성이 있으면 탐색이 놓친 것)
    const up = eng.improve(oldL, eng.scoreOf);
    if (up) rows.push(["E2 전→교체", up.pick.map((p) => p.item)]);
  }
  // 탐색 점검: E2 전 몰빵에서 같은 목표·같은 제약으로 한 칸 교체를 올라가 본다
  return { id, augName, how: eng.sameAsBalanced ? "균형 그대로 (증강 몫 증가 부족 규칙)" : eng.fromBalanced ? "균형에서 증강 몫 교체 (규칙)" : "몰빵 탐색", rows: rows.map(([n, l]) => ({ n, items: l.map((i) => i.name), ...part(l) })), v0: part(balL).V, a0: part(balL).A };
}

console.log(`P3-R 몰빵 목표 분해 ${EXP ? "(" + EXP + ")" : ""} · focus ${S.CONCEPTS[0].focus}`);
for (const [id, an] of SCENES) {
  const r = scene(id, an);
  console.log(`\n${id} + ${an} — 결과: ${r.how}`);
  for (const x of r.rows) {
    const delta = process.env.AUG_DELTA != null && process.env.AUG_DELTA !== "";  // δ 모드는 목표가 '증강 몫 최대 (V 하한)'라 태그 분해가 없다
    const aRatio = Math.abs(r.a0) > 1e-6 ? (x.A / r.a0).toFixed(2) : "균형 0";
    console.log(`  ${x.n.padEnd(10)} 점수 ${x.score.toFixed(2)} = 수치 ${x.num.toFixed(2)} (V ${x.V.toFixed(3)} · A ${x.A.toFixed(3)})${delta ? "" : ` + 태그 ${x.tag.toFixed(2)}`} · V/균형 ${(x.V / r.v0).toFixed(3)} · A/균형 ${aRatio}`);
    console.log(`  ${"".padEnd(10)} ${x.items.join(", ")}`);
  }
}
