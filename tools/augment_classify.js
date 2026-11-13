// '못 따라감' 장면 4분류: 계산 누락 · 탐색 실패 · 목표 함수 왜곡 · 정상 유지 (분석용, 엔진은 안 바꿈)
//   탐색 실패: 엔진과 같은 목표 함수(J = 엔진 buildWith 의 scoreOf)·같은 제약(근사)으로 한 칸 교체를 반복해 J 가 0.5% 넘게 오르는 조합이 있음
//   목표 함수 왜곡: 증강 자체 효과(A, 성향 중립)와 전체 전투 가치(V, 균형 가중치)가 둘 다 나아지는 빌드가 있는데 J 는 그걸 더 낮게 봄
//   계산 누락: 그 증강의 직접 전투 수치가 계산에 없음 (원본 대조 미구현 P0 중 태그만·실게임 확인 필요)
//   정상 유지: 위에 해당 없음 = 증강을 더 살리려면 전투 가치를 내줘야 하는 맞바꿈
//   node tools/augment_classify.js <augment_fit --json 결과> <역할,역할> <출력.json>
// 계산 누락 목록은 docs/미구현_분류.md 의 P0 중 '태그 기반 간접 반영'·'실제 게임 확인 필요' 증강 (node tools/unimpl_triage.js --write 로 갱신)
const path = require("path");
const R = path.join(__dirname, "..");
global.Stats = require(R + "/web/stats.js");
const S = require(R + "/web/scoring.js");
if (process.env.AUG_OFFICIAL === "0") S.setAugmentOfficial(false);
if (process.env.AUG_DELTA) S.setAugmentDelta(+process.env.AUG_DELTA);
const d = require(R + "/web/data.json");
const fs = require("fs");
S.attachSimilar(d.champions, null, d.items);
const [fitPath, rolesArg, outPath] = process.argv.slice(2);
const roles = rolesArg.split(",");
const p0 = (fs.readFileSync(path.join(R, "docs", "미구현_분류.md"), "utf8").split("## P0")[1] || "").split("## P1")[0];
const missing = new Set(p0.split("\n").filter((l) => /^\| /.test(l) && /(태그 기반 간접 반영|실제 게임 확인 필요)/.test(l))
  .map((l) => l.split("|")[1].replace(/\(.*\)/, "").trim()));
const rows = JSON.parse(fs.readFileSync(fitPath, "utf8")).filter((r) => roles.includes(r.role) && r.reach != null && r.reach >= 0 && r.reach < 0.3);
const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };
const legal = (list) => { const lim = list.map((i) => i.limit).filter(Boolean); return new Set(lim).size === lim.length && new Set(list.map((i) => i.name)).size === list.length; };
const out = [];
const t0 = Date.now();
for (const r of rows) {
  const c0 = d.champions.find((x) => x.id === r.champ), w = S.profile(c0, d.tags), aug = d.augments.find((a) => a.name === r.aug);
  const c = S.withChosenFeatures(c0, [aug], d.rules), ctx = S.augContext([aug], d.rules, c);
  const A = S.augStatsOf([aug], d.rules, c);
  const cache = new Map();
  const ev = (list, withAug) => { const k = (withAug ? "A" : "B") + list.map((i) => i.id).join(","); if (!cache.has(k)) cache.set(k, Stats.evaluate(c, 18, list, withAug ? A : [], {}).m); return cache.get(k); };
  const e0 = ev([], false), norm = Object.fromEntries(Object.keys(FLOOR).map((k) => [k, Math.max(e0[k], FLOOR[k])]));
  const eng = S.buildConcepts(d.items, w, [aug], [], d.rules, c0, {}, ["augment"])[0];
  const balB = S.buildConcepts(d.items, w, [aug], [], d.rules, c0, {}, ["balanced"])[0];
  const measure = (list) => {
    const mA = ev(list, true), mB = ev(list, false);
    let a = 0; for (const k of Object.keys(FLOOR)) a += ((mA[k] || 0) - (mB[k] || 0)) / norm[k];  // 증강 자체 효과 (성향 중립)
    return { J: eng.scoreOf(list), V: balB.valueOf(list), A: a * 100 };  // J = 엔진 몰빵 목표, V = 전체 전투 가치 (챔피언 성향)
  };
  const B = eng.pick.map((p) => p.item);
  // 엔진 제약 근사: 주 피해 유형 반대·치명타 못 쓰는 챔피언·필수 아이템
  const lift = ctx.lift || {};
  const critUser = c.tags.includes("Marksman") || !c.melee || ((c.traits || {}).CRIT || 0) > 0;
  const offK = c.damageType === "physical" ? ["AP", "MPEN"] : c.damageType === "magic" ? ["AD", "CRIT", "LETHAL"] : [];
  const ownK = c.damageType === "physical" ? ["AD", "CRIT", "LETHAL"] : c.damageType === "magic" ? ["AP", "MPEN"] : [];
  const flips = offK.some((k) => (lift[k] || 0) >= 0.5) || Object.keys(ctx.convert || {}).length > 0;
  const isOff = (i) => { const t = i.tags || {}; const crit = (t.CRIT || 0) >= 0.5 || "CRIT" in (i.stats || {});
    if (!critUser && c.damageType !== "magic" && crit && !((lift.CRIT || 0) >= 0.5)) return true;
    return !flips && offK.some((k) => (t[k] || 0) >= 0.5) && !ownK.some((k) => (t[k] || 0) >= 0.5); };
  const must = new Set(Object.keys(ctx.wanted || {}));
  const pool = d.items.filter((i) => i.kind === "legendary" && !(i.only === "ranged" && c.melee) && !(i.only === "melee" && !c.melee) && !isOff(i));
  const climb = (accept, startScore) => {
    let best = B.slice(), bs = startScore, improved = true, rounds = 0;
    while (improved && rounds < 4) {
      improved = false; rounds++;
      for (let k = 0; k < best.length; k++) {
        if (best[k].kind !== "legendary" || must.has(best[k].name)) continue;
        for (const it of pool) {
          const cand = best.slice(); cand[k] = it;
          if (!legal(cand)) continue;
          const m = measure(cand), s = accept(m);
          if (s != null && s > bs + 1e-9) { best = cand; bs = s; improved = true; }
        }
      }
    }
    return best;
  };
  const m0 = measure(B);
  // 1) 탐색 실패: J 만 올림
  const bJ = climb((m) => m.J, m0.J), mJ = measure(bJ);
  const searchFail = mJ.J > m0.J * 1.005;
  // 2) 동시 개선: V 를 지키면서 A 를 올림
  const bA = climb((m) => (m.V >= m0.V - 1e-9 ? m.A : null), m0.A), mA2 = measure(bA);
  const room = Math.max(r.top - m0.A, 1e-9);
  const both = mA2.A - m0.A >= Math.max(1, 0.1 * room) && mA2.V >= m0.V - 1e-9;
  const distort = both && mA2.J <= m0.J + 1e-9;
  const calcMiss = missing.has(r.aug);
  const primary = searchFail ? "탐색 실패" : distort ? "목표 함수 왜곡" : (both ? "탐색 실패" : calcMiss ? "계산 누락" : "정상 유지");
  const legN = (l) => l.filter((i) => i.kind === "legendary").map((i) => i.name);
  out.push({ champ: r.champ, role: r.role, aug: r.aug, primary, searchFail, both, distort, calcMiss,
    engine: { items: legN(B), ...m0 }, bestJ: { items: legN(bJ), ...mJ }, bestBoth: { items: legN(bA), ...mA2 }, top: r.top, base: r.base });
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(roles.join(","), out.length, "장면", Math.round((Date.now() - t0) / 1000) + "초");
