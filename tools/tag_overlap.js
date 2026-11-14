// 태그 점수 ↔ 수치 평가 중복 점검 (2026-11-15 v0.1.92 회귀 확인): 아이템 태그마다 그 효과가 이미 수치 계산(전투 지표)에 들어가는지 효과 단위로 나눈다.
//   능력치 태그: 아이템 기본 능력치에서 나온 태그 (공격력·주문력·체력 …) → 수치에 늘 들어가지만 챔피언 성향(어떤 능력치를 좋아하나)을 싣는 몫이라 따로 본다
//   효과 태그: 설명에서 읽은 태그 (회복·보호막·제어·적중·고정 피해·관통·가속·흡혈·궁극기) → 그 효과가 수치로 계산되는지 기준 챔피언으로 잰다
//   node tools/tag_overlap.js [--json 출력.json] [--write]   → docs/태그_수치_중복표.md
// 판단은 아이템 이름이 아니라 계산 결과로 한다: 고유 효과(passiveStats·effects)를 뺀 것과 비교해 그 태그가 뜻하는 지표가 움직이면 '계산됨'.
// 계산 결과끼리의 비교예요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const St = global.Stats;

const STAT_TAG_KEYS = { AD: ["AD"], AP: ["AP"], AS: ["AS"], CRIT: ["CRIT"], HP: ["HP"], ARMOR: ["ARMOR"], MR: ["MR"], MANA: ["MANA"], MS: ["MS", "MSP"] };
// 효과 태그 → 수치 계산 여부를 보는 방법
//   stat: 아이템 능력치(stats)에 그 키가 있으면 계산됨 (관통·가속·흡혈은 능력치로 들어간다)
//   metric: 고유 효과를 뺀 것보다 그 지표가 커지면 계산됨 (기준 챔피언 중 하나라도)
//   rows: 그 아이템 출처의 효과 줄 중 조건을 맞는 게 있으면 계산됨
const EFFECT_TAGS = {
  LETHAL: { stat: ["LETHALITY", "ARPEN"] },
  MPEN: { stat: ["MPEN", "MPENP"], conv: ["mrShred"] },
  HASTE: { stat: ["HASTE"], metricTotal: "HASTE" },
  VAMP: { stat: ["LS", "OMNIVAMP"], metricTotal: "LS" },
  ULT: { flag: "ultHaste", conv: ["ultHasteAdd"] },
  HEALSHIELD: { metric: ["support"] },
  CC: { metric: ["control"] },
  // 적중·기본 공격에 붙는 효과: 발동 방식이 적중·N회 공격·공격 시이거나, 스킬 뒤 기본 공격(주문 검)·'다음 기본 공격' 효과
  ONHIT: { fx: (e) => ["onhit", "attacks", "onattack"].includes((e.trigger || {}).type) || e.needsAuto || /기본 공격|적중/.test((e.trigger || {}).from || ""), metricTotal: "onhitRepeat" },
  TRUE: { rows: (r) => r.kind === "true", conv: ["trueDmgMult", "lowHpMagicTrueAmp"] },
};
const REF = ["Soraka", "Lulu", "Lux", "Garen", "Jinx", "Leona", "Zed"];

function audit(d) {
  const refs = REF.map((id) => d.champions.find((c) => c.id === id)).filter(Boolean);
  const bare = (it) => ({ ...it, passiveStats: undefined, effects: [] });
  const rows = [];
  for (const it of d.items.filter((i) => i.kind === "legendary" || i.kind === "boots")) {
    const out = { name: it.name, kind: it.kind, tags: {} };
    for (const [t, s] of Object.entries(it.tags || {})) {
      if (STAT_TAG_KEYS[t]) { out.tags[t] = { s, type: "능력치", computed: STAT_TAG_KEYS[t].some((k) => (it.stats || {})[k]) }; continue; }
      const rule = EFFECT_TAGS[t];
      if (!rule) { out.tags[t] = { s, type: "효과", computed: false, how: "점검 기준 없음" }; continue; }
      let computed = false, how = "";
      if (rule.stat && rule.stat.some((k) => (it.stats || {})[k])) { computed = true; how = "능력치"; }
      for (const c of refs) {
        if (computed) break;
        const a = St.evaluate(c, 18, [it], [], {}), b = St.evaluate(c, 18, [bare(it)], [], {});
        if (rule.metric && rule.metric.some((k) => a.m[k] > b.m[k] + 1e-6)) { computed = true; how = `고유 효과 → ${rule.metric.join("·")}`; }
        else if (rule.rows && a.m.effects.some((r) => r.src === it.name && rule.rows(r) && (r.value || 0) > 0)) { computed = true; how = "고유 효과 계산 줄"; }
        else if (rule.fx && (it.effects || []).some(rule.fx) && a.m.effects.some((r) => r.src === it.name && (r.value || 0) > 0)) { computed = true; how = "고유 효과 계산 줄"; }
        else if (rule.conv && rule.conv.some((k) => (a.stats.conv[k] || 0) > (b.stats.conv[k] || 0))) { computed = true; how = "고유 효과 배율"; }
        else if (rule.flag && (a.stats.flags[rule.flag] || 0) > (b.stats.flags[rule.flag] || 0)) { computed = true; how = "고유 효과 배율"; }
        else if (rule.metricTotal && (a.stats.total[rule.metricTotal] || 0) > (b.stats.total[rule.metricTotal] || 0) + 1e-9) { computed = true; how = "고유 효과 능력치"; }
      }
      out.tags[t] = { s, type: "효과", computed, how };
    }
    rows.push(out);
  }
  return rows;
}

// 증강: 증강 태그(lift)는 그 태그 아이템의 태그 가중치를 올린다. 증강 수치 효과가 그 능력치에 비례해 이미 커지면(아이템 능력치 → 증강 몫 증가) 같은 연계를 두 번 센다.
// 기준 챔피언에 그 능력치만 가진 가상 아이템을 더해 증강 몫(증강 있음 − 없음, 지표 기준값으로 나눈 합)이 커지면 '계산됨'
const PROBE = { AD: { AD: 45 }, AP: { AP: 80 }, AS: { AS: 0.35 }, CRIT: { CRIT: 0.25 }, HP: { HP: 400 }, ARMOR: { ARMOR: 50 }, MR: { MR: 50 }, HASTE: { HASTE: 20 }, MANA: { MANA: 500 }, MS: { MSP: 0.05 }, LETHAL: { LETHALITY: 18 }, MPEN: { MPEN: 15 }, VAMP: { LS: 0.1 } };
const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };
function auditAugments(d) {
  const S = require(path.join(ROOT, "web", "scoring.js"));
  const out = [];
  for (const a of d.augments) {
    const c0 = d.champions.find((c) => !a.eligible || a.eligible.includes(c.id) ? (a.eligible ? true : c.id === "Garen") : false) || d.champions[0];
    const ctx = S.augContext([a], d.rules, c0);
    const lift = Object.keys((ctx.liftBy || {})[a.name] || {}).filter((k) => !k.startsWith("_"));
    if (!lift.length) continue;
    const nums = S.hasNumbers(a, d.rules);
    const refs = [c0, ...["Lux", "Jinx", "Soraka"].map((id) => d.champions.find((c) => c.id === id))].filter((c) => !a.eligible || a.eligible.includes(c.id));
    const tags = {};
    for (const t of lift) {
      let computed = false;
      if (nums && PROBE[t]) for (const c0b of refs) {
        const c = S.withChosenFeatures(c0b, [a], d.rules), A = S.augStatsOf([a], d.rules, c);
        const share = (items) => { const m1 = St.evaluate(c, 18, items, A, {}).m, m0 = St.evaluate(c, 18, items, [], {}).m;
          return Object.keys(FLOOR).reduce((s, k) => s + ((m1[k] || 0) - (m0[k] || 0)) / FLOOR[k], 0); };
        const probe = { id: "probe", name: "가상", kind: "legendary", stats: PROBE[t], tags: {} };
        if (share([probe]) > share([]) + 1e-6) { computed = true; break; }
      }
      tags[t] = { computed, probe: !!PROBE[t] };
    }
    out.push({ name: a.name, numbers: nums, tags });
  }
  return out;
}

function markdown(rows, d, augs) {
  const L = [];
  const eff = rows.flatMap((r) => Object.entries(r.tags).filter(([, v]) => v.type === "효과").map(([t, v]) => ({ item: r.name, t, ...v })));
  const byTag = {};
  for (const e of eff) { const b = (byTag[e.t] = byTag[e.t] || { yes: 0, no: 0, noItems: [] }); if (e.computed) b.yes++; else { b.no++; b.noItems.push(e.item); } }
  L.push("# 태그 점수 ↔ 수치 평가 중복표", "", `게임 데이터 \`${d.dataVersion || d.version}\` · 만든 도구: \`node tools/tag_overlap.js --write\` · 추천 대상 아이템 ${rows.length}개`, "");
  L.push("> 아이템 태그마다 그 효과가 수치 계산(전투 지표)에 이미 들어가는지 나눴어요. '계산됨'이면 태그 점수와 수치 평가가 같은 효과를 두 번 셀 수 있어요. 능력치 태그는 수치에 늘 들어가지만 챔피언 성향(어떤 능력치를 좋아하나)을 싣는 몫이라 따로 적었어요. 계산 결과끼리의 비교예요.", "");
  L.push("## 효과 태그", "", "| 태그 | 수치로 계산됨 | 계산 안 됨 (태그만) | 계산 안 되는 아이템 |", "|---|---:|---:|---|");
  for (const [t, b] of Object.entries(byTag).sort()) L.push(`| ${t} | ${b.yes} | ${b.no} | ${b.noItems.join(", ") || "—"} |`);
  const st = rows.flatMap((r) => Object.values(r.tags).filter((v) => v.type === "능력치"));
  L.push("", `능력치 태그 ${st.length}개 중 수치로 계산됨 ${st.filter((v) => v.computed).length}개.`, "");
  L.push("## 아이템별 효과 태그", "", "| 아이템 | 계산됨 (태그 강도) | 태그만 |", "|---|---|---|");
  for (const r of rows) {
    const e = Object.entries(r.tags).filter(([, v]) => v.type === "효과");
    if (!e.length) continue;
    L.push(`| ${r.name} | ${e.filter(([, v]) => v.computed).map(([t, v]) => `${t} ${v.s}`).join(", ") || "—"} | ${e.filter(([, v]) => !v.computed).map(([t, v]) => `${t} ${v.s}`).join(", ") || "—"} |`);
  }
  L.push("");
  if (augs) {
    const all = augs.flatMap((a) => Object.entries(a.tags).map(([t, v]) => ({ a: a.name, numbers: a.numbers, t, ...v })));
    L.push("## 증강 태그 (아이템 태그 가중치를 올리는 lift)", "", "> 증강 수치 효과가 그 능력치에 비례해 이미 커지면 '계산됨' (그 능력치만 가진 가상 아이템을 더해 증강 몫이 커지는지). 효과 태그(회복·제어·적중 …)는 가상 아이템으로 잴 수 없어 '판단 못 함'이에요.", "");
    L.push(`- 태그 가중치를 올리는 증강 ${augs.length}개 (수치 있음 ${augs.filter((a) => a.numbers).length}) · 태그 ${all.length}개: 계산됨 ${all.filter((x) => x.computed).length} · 수치 효과와 무관 ${all.filter((x) => !x.computed && x.probe && x.numbers).length} · 수치 없는 증강 ${all.filter((x) => !x.numbers).length} · 판단 못 함 ${all.filter((x) => !x.probe && x.numbers).length}`, "");
    L.push("| 증강 | 수치 | 계산됨 | 수치 효과와 무관 | 판단 못 함 / 수치 없음 |", "|---|---|---|---|---|");
    for (const a of augs) {
      const e = Object.entries(a.tags);
      L.push(`| ${a.name} | ${a.numbers ? "있음" : "없음"} | ${e.filter(([, v]) => v.computed).map(([t]) => t).join(", ") || "—"} | ${a.numbers ? e.filter(([, v]) => !v.computed && v.probe).map(([t]) => t).join(", ") || "—" : "—"} | ${e.filter(([, v]) => !v.probe || !a.numbers).map(([t]) => t).join(", ") || "—"} |`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
  const rows = audit(d);
  const eff = rows.flatMap((r) => Object.values(r.tags).filter((v) => v.type === "효과"));
  console.log(`아이템 ${rows.length} · 효과 태그 ${eff.length} · 수치로 계산됨 ${eff.filter((v) => v.computed).length} · 태그만 ${eff.filter((v) => !v.computed).length}`);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows));
  const augs = auditAugments(d);
  const at = augs.flatMap((a) => Object.values(a.tags));
  console.log(`증강 태그 가중치 ${augs.length}개 · 태그 ${at.length} · 계산됨 ${at.filter((v) => v.computed).length}`);
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "태그_수치_중복표.md"), markdown(rows, d, augs));
}
module.exports = { audit, auditAugments };
