// 목적함수 정규화 대안 B (v0.1.93 P3-F): 지표 기준값(분모)을 '맨몸' 대신 '전 챔피언 균형 빌드 중앙값'으로.
//   node tools/norm_median.js            중앙값을 재서 보여 준다
//   node tools/norm_median.js --write    tests/data/p3f/norm_median.json 에 저장 (실험 설정 NORM=median 이 읽는다)
//   node tools/norm_median.js --iter 2   대안 B 로 바꾼 뒤 다시 재서 값이 수렴하는지 본다 (순환 확인)
// 기본값은 바꾸지 않는다. 실험 설정으로만 쓴다 (tools/exp_env.js NORM=median).
// 계산 결과끼리의 비교예요. 실제 게임 결과가 아니에요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
const OUT = path.join(ROOT, "tests", "data", "p3f", "norm_median.json");
const KEYS = Object.keys(S.normOf({}, null));
const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// 전 챔피언 균형 빌드(증강 없음, 18레벨)의 지표 중앙값. 지금 걸려 있는 정규화 모드로 빌드를 짠다
function measure() {
  const got = Object.fromEntries(KEYS.map((k) => [k, []]));
  const ratio = Object.fromEntries(KEYS.map((k) => [k, []]));  // 대안 B′ 용: 지금 분모로 잰 비율의 중앙값
  for (const c of d.champions) {
    if (!c.spells) continue;
    const w = S.profile(c, d.tags);
    const items = S.buildConcepts(d.items, w, [], [], d.rules, c, { aram: true }, ["balanced"])[0].pick.map((p) => p.item);
    const m = Stats.evaluate(c, 18, items, [], { aram: true }).m;
    const bare = Stats.evaluate(c, 18, [], [], { aram: true }).m;
    const nb = S.normOf(bare, c);
    for (const k of KEYS) { got[k].push(m[k] || 0); ratio[k].push((m[k] || 0) / nb[k]); }
  }
  // 중앙값이 0 인 지표(지원: 173명 중 163명이 0)는 0 이 아닌 값들의 중앙값을 쓴다 — 0으로 나눌 수 없고,
  // 바닥값(600)을 쓰면 지원만 척도가 작아져 서포터가 지원 아이템으로 과하게 쏠린다. 그래도 0이면 바닥값
  const out = {}, raw = {}, nz = {};
  for (const k of KEYS) {
    raw[k] = Math.round(med(got[k]) * 100) / 100;
    const pos = got[k].filter((v) => v > 0);
    nz[k] = pos.length ? Math.round(med(pos) * 100) / 100 : 0;
    out[k] = raw[k] > 0 ? raw[k] : nz[k] > 0 ? nz[k] : FLOOR[k];
  }
  // 대안 B′: 지표마다 '보통 빌드의 비율' 중앙값 → 이 값으로 한 번 더 나누면 모든 지표가 1 근처가 된다
  const scale = {};
  for (const k of KEYS) {
    let v = med(ratio[k]);
    if (!(v > 0)) { const pos = ratio[k].filter((x) => x > 0); v = pos.length ? med(pos) : 1; }  // 지원처럼 대부분 0인 지표는 0이 아닌 값들로
    scale[k] = v > 0 ? Math.round(v * 1e4) / 1e4 : 1;
  }
  return { norm: out, raw, nz, scale };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const iter = Math.max(1, +(argv[argv.indexOf("--iter") + 1] || 1) || 1);
  let last = null;
  for (let i = 0; i < iter; i++) {
    const r = measure();
    console.log(`${i + 1}회차 중앙값: ${JSON.stringify(r.raw)}`);
    console.log(`   0 이 아닌 값들의 중앙값: ${JSON.stringify(r.nz)}`);
    console.log(`   분모로 쓸 값: ${JSON.stringify(r.norm)}`);
    console.log(`   대안 B′ 척도(지금 분모 기준 비율 중앙값): ${JSON.stringify(r.scale)}`);
    if (last) {
      const diff = KEYS.map((k) => `${k} ${(((r.norm[k] - last.norm[k]) / last.norm[k]) * 100).toFixed(1)}%`).join(" · ");
      console.log(`   지난 회차 대비: ${diff}`);
    }
    last = r;
    if (i + 1 < iter) { S.setNormMedian(r.norm); S.setNormMode("median"); S.clearMemo(); }
  }
  if (argv.includes("--write")) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ dataVersion: d.dataVersion, builtAt: new Date().toISOString(), note: "전 챔피언 균형 빌드(증강 없음·18레벨) 지표 중앙값. 기본값(sharedAlly)으로 잰 1회차 값", norm: last.norm, raw: last.raw, nz: last.nz, scale: last.scale }, null, 2) + "\n");
    console.log("저장:", path.relative(ROOT, OUT));
  }
}
module.exports = { measure, OUT };
