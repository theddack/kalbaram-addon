// 증강 중심 회귀 점검: "이 증강을 골랐을 때 그 효과를 실제로 살리는 빌드를 주는가"를 전 챔피언으로 잰다.
// 기존 빌드와 얼마나 비슷한지는 보지 않는다 (2026-11-12 증강 중심 원칙).
//   node tools/augment_regress.js                     요약
//   node tools/augment_regress.js --save a.json       결과 저장
//   node tools/augment_regress.js --compare a.json    저장한 결과와 비교 (바뀐 챔피언·증강)
//   node tools/augment_regress.js --root <폴더>        다른 사본(web/)으로 계산 (변경 전후 비교용)
// 장면 두 가지:
//   연계: 챔피언 → 첫 증강(종합 1위) → 연계 증강 2개(연계 보기 1위) → 빌드 3종
//   대표 조합: 아래 COMBOS 증강을 받을 수 있는 모든 챔피언에게 하나씩 → 빌드 3종 + 카드 등급
// 잰 값:
//   활용도 = 그 빌드에서 고른 증강들이 보태는 가치 합 (scoring.augContribution × 100). 기본 = 증강 없이 짠 균형 빌드
//   요구 아이템 = 증강이 요구하는 아이템(퀘스트 등)이 몰빵 빌드에 몇 개 들어갔나
//   등급 = 증강 카드 등급과 사유 (발동 불가 '조건 없음'과 활용 안내를 구분해서 본다)
// 계산 결과끼리의 비교예요. 실제 게임에서의 추천 정확도가 아니에요 (실게임 검증 필요).
const fs = require("fs");
const path = require("path");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = arg("--root") || path.join(__dirname, "..");
global.Stats = require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
// 실험 설정 (환경 변수 AUG_OFFICIAL·OFFICIAL_AUG·OFFICIAL_BAL·AUG_DELTA·AUTO_UPTIME·FIGHT_SEC·SKILL_SHARE, tools/exp_env.js)
const EXP_LABEL = require("./exp_env")(S, global.Stats);
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
S.attachSimilar(d.champions, null, d.items);

// 대표 조합: 퀘스트(아이템 여러 개 요구), 가속 → 피해, 체력 비례 평타, 공격 속도, 주문력, 반대 유형으로 끄는 증강
const COMBOS = [["궁극의 히드라"], ["우글렛의 마녀 모자"], ["이케시아의 몰락"], ["원 히트 원더"], ["강타자"], ["치명적 리듬"], ["사악한 정신"], ["마법 명사수"]];
const KEYS = ["augment", "balanced", "twist"];
const leg = (b) => b.pick.filter((p) => p.item.kind === "legendary").map((p) => p.item.name);
const ruleOf = (a) => ((d.rules || {}).augments || {})[a.name] || ((d.rules || {}).augments || {})[a.id] || {};

function scene(c, w, augs) {
  const base = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0];
  const bs = Object.fromEntries(S.buildConcepts(d.items, w, augs, [], d.rules, c, {}, KEYS).map((b) => [b.key, b]));
  const util = (b) => Math.round(augs.reduce((t, a, i) => t + S.augContribution(b.pick.map((p) => p.item), w, augs.filter((_, j) => j !== i), a, d.rules, c), 0) * 1000) / 10;
  const need = augs.flatMap((a) => (ruleOf(a).itemsAll && ruleOf(a).items) || []);
  const out = { augs: augs.map((a) => a.name), base: leg(base), u: { base: util(base) } };
  for (const k of KEYS) { out[k] = leg(bs[k]); out.u[k] = util(bs[k]); }
  if (need.length) out.need = { n: need.length, augment: need.filter((n) => out.augment.includes(n)).length, balanced: need.filter((n) => out.balanced.includes(n)).length };
  return out;
}

function run() {
  const chain = {}, combos = {};
  for (const c of d.champions) {
    const w = S.profile(c, d.tags);
    const pool = d.augments.filter((a) => !a.eligible || a.eligible.includes(c.id));
    const chosen = [];
    for (let k = 0; k < 3; k++) {
      const t = S.augmentTiers(pool, d.items, w, chosen, [], d.rules, c, {}, k ? "synergy" : "total");
      const best = Object.entries(t).filter(([, v]) => v.tier !== "D")
        .sort((a, b) => ("SABCD".indexOf(a[1].tier) - "SABCD".indexOf(b[1].tier)) || (a[1].pct - b[1].pct))[0];
      if (!best) break;
      chosen.push(pool.find((a) => String(a.id) === best[0]));
    }
    if (chosen.length) chain[c.id] = scene(c, w, chosen);
    const tiers = S.augmentTiers(pool, d.items, w, [], [], d.rules, c, {}, "total");
    const ranked = Object.fromEntries(S.rankAugments(pool, w, [], [], c, d.rules, d.items).map((r) => [r.aug.id, r]));
    for (const names of COMBOS) {
      const augs = names.map((n) => pool.find((a) => a.name === n));
      if (augs.some((a) => !a)) continue;
      const r = scene(c, w, augs);
      const a0 = augs[0], t = tiers[a0.id] || {}, rk = ranked[a0.id] || {};
      r.tier = t.tier; r.reasons = t.reasons || [];
      r.req = rk.req ? `${rk.req.feature}:${rk.req.met ? "충족" : "없음"}` : null;
      r.hint = rk.hint ? rk.hint.kind : null;
      (combos[names.join("+")] = combos[names.join("+")] || {})[c.id] = r;
    }
  }
  return { version: d.version, chain, combos };
}

const same = (a, b) => a.slice().sort().join() === b.slice().sort().join();
function summary(res) {
  const rows = Object.values(res.chain);
  const avg = (f, list = rows) => (list.reduce((t, r) => t + f(r), 0) / Math.max(1, list.length));
  const f1 = (x) => x.toFixed(1);
  console.log(`[연계] 챔피언 ${rows.length}명 · 증강 활용도 평균: 기본 ${f1(avg((r) => r.u.base))} · 균형 ${f1(avg((r) => r.u.balanced))} · 몰빵 ${f1(avg((r) => r.u.augment))} · 변칙 ${f1(avg((r) => r.u.twist))}`);
  console.log(`  균형이 기본보다 증강을 덜 살림 ${rows.filter((r) => r.u.balanced < r.u.base - 0.05).length} · 몰빵이 균형보다 덜 살림 ${rows.filter((r) => r.u.augment < r.u.balanced - 0.05).length} · 균형=몰빵 같은 빌드 ${rows.filter((r) => same(r.balanced, r.augment)).length}`);
  for (const [k, m] of Object.entries(res.combos)) {
    const list = Object.values(m);
    const tiers = {};
    for (const r of list) tiers[r.tier] = (tiers[r.tier] || 0) + 1;
    const req = list.filter((r) => r.req && r.req.endsWith("없음")).length;
    const need = list.filter((r) => r.need);
    const needTxt = need.length ? ` · 몰빵에 요구 아이템 전부 ${need.filter((r) => r.need.augment === r.need.n).length}/${need.length}` : "";
    console.log(`[${k}] ${list.length}명 · 등급 ${"SABCD".split("").map((t) => `${t}${tiers[t] || 0}`).join(" ")} · 조건 없음 ${req} · 활용 안내 ${list.filter((r) => r.hint).length}` +
      ` · 활용도 기본 ${f1(avg((r) => r.u.base, list))} 균형 ${f1(avg((r) => r.u.balanced, list))} 몰빵 ${f1(avg((r) => r.u.augment, list))}${needTxt}`);
  }
  console.log("※ 계산 결과끼리의 비교예요. 실제 게임에서의 추천 정확도가 아니에요.");
}

function compare(a, b) {
  const lines = [];
  const diffScene = (label, x, y) => {
    if (!x || !y) return;
    const ch = KEYS.filter((k) => !same(x[k], y[k]));
    const tier = x.tier !== y.tier ? ` 등급 ${x.tier}→${y.tier}` : "";
    if (!ch.length && !tier) return;
    lines.push(`${label}${tier} ${ch.map((k) => `${k} 활용도 ${x.u[k]}→${y.u[k]}`).join(" · ")}`);
    for (const k of ch) lines.push(`    ${k}: ${x[k].join(", ")}\n      → ${y[k].join(", ")}`);
  };
  for (const id of Object.keys(b.chain)) diffScene(`[연계] ${id} [${b.chain[id].augs.join("+")}]`, a.chain[id], b.chain[id]);
  for (const k of Object.keys(b.combos)) for (const id of Object.keys(b.combos[k])) diffScene(`[${k}] ${id}`, (a.combos[k] || {})[id], b.combos[k][id]);
  console.log(`\n바뀐 장면 ${lines.filter((l) => l.startsWith("[")).length}개`);
  for (const l of lines) console.log(l);
}

const res = run();
summary(res);
if (arg("--save")) fs.writeFileSync(arg("--save"), JSON.stringify(res));
if (arg("--compare")) compare(JSON.parse(fs.readFileSync(arg("--compare"), "utf8")), res);
