// 증강 → 아이템 점검표: 챔피언이 증강 하나를 골랐을 때 '증강 몰빵' 빌드가 그 증강 효과를 얼마나 키우는지 잰다.
//   node tools/augment_fit.js                 요약 (역할별 대표 18명 × 수치가 있는 증강 전부)
//   node tools/augment_fit.js --write         docs/증강_아이템_점검표.md
//   node tools/augment_fit.js --champs Jinx,Sion --augs 강타자
// 잰 값 (계산 결과끼리의 비교, 실게임 아님):
//   증강 자체 효과 = 증강을 넣었을 때 늘어나는 지표(한타 피해·초당 피해·버티는 힘·지원·기동·제어)를 맨몸 대비 비율로 더한 것.
//                    챔피언 성향 가중치를 쓰지 않는다 (탱커가 고른 피해 증강도 피해가 얼마나 늘었는지 그대로 본다)
//   기본  = 증강 없이 짠 균형 빌드에서의 증강 자체 효과
//   몰빵  = 그 증강을 고른 '증강 몰빵' 빌드에서
//   상한  = 신발은 몰빵과 같게 두고 전설 아이템 5개를 증강 자체 효과가 가장 커지게 고른 참고값 (탐욕 선택, 같은 계열 제한은 안 봄)
//   달성률 = (몰빵 − 기본) / (상한 − 기본). 상한이 기본과 거의 같으면 '아이템 무관' (아이템으로 키울 수 없는 증강)
// 2026-11-13 강타자(최대 체력 3.5% 적중 피해)를 골라도 징크스 몰빵 빌드가 기본과 같았던 일에서 시작.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
// 실험 설정 (환경 변수 AUG_OFFICIAL·OFFICIAL_AUG·OFFICIAL_BAL·AUG_DELTA·AUTO_UPTIME·FIGHT_SEC·SKILL_SHARE, tools/exp_env.js)
const EXP_LABEL = require("./exp_env")(S, global.Stats);

const REPS = { Marksman: ["Jinx", "Vayne", "Caitlyn"], Mage: ["Lux", "Annie", "Viktor"], Tank: ["Malphite", "Sion", "Leona"],
  Fighter: ["Garen", "Darius", "Irelia"], Assassin: ["Zed", "Akali", "Kayn"], Support: ["Sona", "Nami", "Lulu"] };
const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };  // scoring.METRIC_FLOOR 와 같게
const KEYS = Object.keys(FLOOR);
const NONE = 0.02;  // 상한 − 기본이 이보다 작으면 아이템 무관

function setup(d, c, aug) {
  const cc = S.withChosenFeatures(c, [aug], d.rules);
  const A = S.augStatsOf([aug], d.rules, cc);
  const empty = Stats.evaluate(cc, 18, [], [], {}).m;
  const norm = Object.fromEntries(KEYS.map((k) => [k, Math.max(empty[k] || 0, FLOOR[k])]));
  const eff = (items) => {
    const m0 = Stats.evaluate(cc, 18, items, [], {}).m, m1 = Stats.evaluate(cc, 18, items, A, {}).m;
    let v = 0;
    for (const k of KEYS) v += ((m1[k] || 0) - (m0[k] || 0)) / norm[k];
    return v * 100;
  };
  return { cc, eff };
}

function check(d, champIds, augFilter) {
  const items = d.items.filter((i) => i.kind === "legendary");
  const rows = [];
  for (const cid of champIds) {
    const c = d.champions.find((x) => x.id === cid);
    if (!c) continue;
    const w = S.profile(c, d.tags);
    const base = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
    const augs = d.augments.filter((a) => !a.category && S.hasNumbers(a, d.rules) && (!a.eligible || a.eligible.includes(c.id))
      && (!augFilter || augFilter.includes(a.name) || augFilter.includes(a.id)));
    for (const a of augs) {
      const rule = (d.rules.augments || {})[a.id] || {};
      if (rule.requires && !((S.withChosenFeatures(c, [a], d.rules).features || []).includes(rule.requires))) continue;  // 발동 안 함
      const { cc, eff } = setup(d, c, a);
      const engA = S.buildConcepts(d.items, w, [a], [], d.rules, c, {}, ["augment"])[0];
      const mine = engA.pick.map((p) => p.item);
      // 같은 증강을 고른 균형 빌드: 전체 전투 가치(V, 챔피언 성향)와 증강 몫(엔진 기준, 증강 출력 가중치)을 몰빵과 같은 잣대로 비교
      const balB = S.buildConcepts(d.items, w, [a], [], d.rules, c, {}, ["balanced"])[0];
      const balL = balB.pick.map((p) => p.item);
      const boots = mine.filter((i) => i.kind !== "legendary");
      const pool = items.filter((i) => !(i.only === "ranged" && cc.melee) && !(i.only === "melee" && !cc.melee));
      // 탐욕 선택: 한 칸씩 증강 자체 효과를 가장 많이 늘리는 아이템 (후보는 첫 칸 기준 상위 40개)
      const first = pool.map((i) => [i, eff([...boots, i])]).sort((x, y) => y[1] - x[1]).slice(0, 40).map((x) => x[0]);
      let pick = [];
      for (let k = 0; k < 5; k++) {
        let best = null;
        for (const i of first) {
          if (pick.includes(i)) continue;
          const v = eff([...boots, ...pick, i]);
          if (!best || v > best[1]) best = [i, v];
        }
        if (!best) break;
        pick.push(best[0]);
      }
      const b = eff(base), m = eff(mine), top = Math.max(eff([...boots, ...pick]), m, b);
      const room = top - b;
      const leg = (list) => list.filter((i) => i.kind === "legendary").map((i) => i.name);
      rows.push({ champ: cid, role: (c.tags || [])[0], aug: a.name, rarity: a.rarityName, base: +b.toFixed(1), mine: +m.toFixed(1), top: +top.toFixed(1),
        reach: room < NONE ? null : +((m - b) / room).toFixed(2), same: leg(base).sort().join() === leg(mine).sort().join(),
        mineItems: leg(mine), topItems: leg(pick),
        bal: +eff(balL).toFixed(1), balItems: leg(balL),
        vMine: balB.valueOf ? +balB.valueOf(mine).toFixed(4) : null, vBal: balB.valueOf ? +balB.valueOf(balL).toFixed(4) : null,
        aoMine: engA.augOf ? +(engA.augOf(mine) * 100).toFixed(2) : null, aoBal: engA.augOf ? +(engA.augOf(balL) * 100).toFixed(2) : null, aoBase: engA.augOf ? +(engA.augOf(base) * 100).toFixed(2) : null });
    }
  }
  return rows;
}

function summarize(rows) {
  const judged = rows.filter((r) => r.reach != null);
  const grade = (r) => (r.reach == null ? "아이템 무관" : r.reach >= 0.7 ? "잘 따라감" : r.reach >= 0.3 ? "일부" : r.reach >= 0 ? "못 따라감" : "역행");
  const count = (list) => list.reduce((o, r) => ((o[grade(r)] = (o[grade(r)] || 0) + 1), o), {});
  const byRole = {};
  for (const r of rows) (byRole[r.role] = byRole[r.role] || []).push(r);
  const byAug = {};
  for (const r of rows) (byAug[r.aug] = byAug[r.aug] || []).push(r);
  return { n: rows.length, judged: judged.length, all: count(rows), byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, count(v)])), byAug, grade };
}

function markdown(rows, sum, d) {
  const G = ["잘 따라감", "일부", "못 따라감", "역행", "아이템 무관"];
  const L = [];
  L.push("# 증강 → 아이템 점검표", "");
  L.push(`게임 데이터 \`${d.dataVersion || d.version}\` · 만든 도구: \`node tools/augment_fit.js --write\` · 대상: 역할별 대표 18명 × 수치가 있는 증강`, "");
  L.push("> 챔피언이 증강 하나를 골랐을 때 '증강 몰빵' 빌드가 그 증강 효과를 얼마나 키우는지예요. 계산 결과끼리의 비교이고 실게임 결과가 아니에요.", "");
  L.push("- **증강 자체 효과**: 증강을 넣었을 때 늘어나는 피해·버티는 힘·지원 등을 맨몸 대비 비율로 더한 값 (챔피언 성향 가중치 없음)");
  L.push("- **기본** 증강 없이 짠 균형 빌드 · **몰빵** 그 증강의 몰빵 빌드 · **상한** 증강 자체 효과가 가장 커지는 전설 아이템 5개 (참고값, 같은 계열 제한 안 봄)");
  L.push("- **달성률** = (몰빵 − 기본) ÷ (상한 − 기본). 잘 따라감 ≥ 70% · 일부 30~70% · 못 따라감 0~30% · 역행 < 0 · 아이템 무관 = 상한이 기본과 거의 같음", "");
  L.push("## 요약", "");
  L.push(`| 구분 | 장면 | ${G.join(" | ")} |`, `|---|---:|${G.map(() => "---:").join("|")}|`);
  L.push(`| 전체 | ${sum.n} | ${G.map((g) => sum.all[g] || 0).join(" | ")} |`);
  for (const [k, v] of Object.entries(sum.byRole)) L.push(`| ${k} | ${Object.values(v).reduce((a, b) => a + b, 0)} | ${G.map((g) => v[g] || 0).join(" | ")} |`);
  L.push("");
  L.push("## 증강별 (못 따라감·역행이 많은 순)", "");
  L.push("| 증강 | 등급 | 장면 | 잘 따라감 | 일부 | 못 따라감 | 역행 | 아이템 무관 | 평균 기본 → 몰빵 → 상한 |", "|---|---|---:|---:|---:|---:|---:|---:|---|");
  const avg = (l, k) => (l.reduce((t, r) => t + r[k], 0) / l.length).toFixed(1);
  const augRows = Object.entries(sum.byAug).map(([a, l]) => {
    const c = {};
    for (const r of l) c[sum.grade(r)] = (c[sum.grade(r)] || 0) + 1;
    return [a, l, c];
  }).sort((x, y) => ((y[2]["못 따라감"] || 0) + (y[2]["역행"] || 0)) - ((x[2]["못 따라감"] || 0) + (x[2]["역행"] || 0)));
  for (const [a, l, c] of augRows) L.push(`| ${a} | ${l[0].rarity || ""} | ${l.length} | ${G.map((g) => c[g] || 0).join(" | ")} | ${avg(l, "base")} → ${avg(l, "mine")} → ${avg(l, "top")} |`);
  L.push("");
  L.push("## 못 따라감·역행 사례 (상한과 차이가 큰 순 40개)", "");
  L.push("| 챔피언 | 증강 | 기본 → 몰빵 → 상한 | 몰빵 빌드 | 증강을 키우는 아이템 (상한) |", "|---|---|---|---|---|");
  const bad = rows.filter((r) => r.reach != null && r.reach < 0.3).sort((x, y) => (y.top - y.mine) - (x.top - x.mine)).slice(0, 40);
  for (const r of bad) L.push(`| ${r.champ} | ${r.aug} | ${r.base} → ${r.mine} → ${r.top} | ${r.mineItems.join(", ")} | ${r.topItems.join(", ")} |`);
  L.push("");
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
  S.attachSimilar(d.champions, null, d.items);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const champs = arg("--champs") ? arg("--champs").split(",") : Object.values(REPS).flat();
  const augs = arg("--augs") ? arg("--augs").split(",") : null;
  const t0 = Date.now();
  const rows = check(d, champs, augs);
  const sum = summarize(rows);
  console.log(`장면 ${sum.n} · ` + Object.entries(sum.all).map(([k, v]) => `${k} ${v}`).join(" · ") + ` (${Math.round((Date.now() - t0) / 1000)}초)`);
  for (const [k, v] of Object.entries(sum.byRole)) console.log(`  ${k}: ` + Object.entries(v).map(([g, n]) => `${g} ${n}`).join(" · "));
  if (process.argv.includes("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows));
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "증강_아이템_점검표.md"), markdown(rows, sum, d));
  console.log("※ 계산 결과끼리의 비교예요. 실제 게임에서의 추천 정확도가 아니에요.");
}
module.exports = { check, summarize, REPS };
