// 전체 증강·아이템 연계표 (2026-11-14 전체 검증 P4): 등록 증강 전부를 효과 유형으로 나누고, 계산 상태(수치·태그만·조건)와
// 아이템이 증강을 키우는 길(입력 능력치 lift·꼭 넣을 아이템·변환)을 적는다. 수치 증강은 점검표 결과(augment_fit --json)를 붙인다.
//   node tools/augment_link.js [--fit 점검표.json] [--write]   → docs/증강_아이템_연계표.md
// 계산 결과끼리의 비교예요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
require("./exp_env")(S, global.Stats);

const STAT_KEYS = ["AD", "AP", "HP", "ARMOR", "MR", "AS", "CRIT", "HASTE", "MS", "MSP", "LETHALITY", "MPEN", "MANA", "adaptive", "ADmult", "APmult", "HPmult", "ASmult", "CRITDMG"];
const SURV = /^(HP|ARMOR|MR|HPmult|ehp|invuln|drSec|selfHeal|bonusResist)/;
const ONHIT_ITEMS = ["구인수의 격노검", "크라켄 학살자", "몰락한 왕의 검", "마법사의 최후", "내셔의 이빨", "루난의 허리케인", "스태틱의 단검"];

function types(a, rule) {
  const st = rule.statsResolved || {};
  const keys = Object.keys(st);
  const trig = (a.effects || []).map((e) => (e.trigger || {}).type);
  const kinds = (a.effects || []).map((e) => e.kind);
  const t = new Set();
  if (keys.some((k) => STAT_KEYS.includes(k))) t.add("능력치 증가");
  if (trig.some((x) => ["onhit", "attacks", "onattack"].includes(x)) || keys.some((k) => /onhit|crit|AStoCRIT|rampAS/i.test(k))) t.add("평타 강화");
  if (trig.some((x) => ["cast", "boundCast"].includes(x)) || keys.some((k) => /skill|slot|refund|Haste|ult/i.test(k))) t.add("스킬 강화");
  if (keys.some((k) => SURV.test(k))) t.add("체력·생존");
  if (kinds.some((k) => k === "heal" || k === "shield") || keys.some((k) => /Heal|heal|shield|Vamp|LS|OMNIVAMP|HSP/.test(k))) t.add("회복·보호막");
  if (keys.some((k) => /^MS|ms/i.test(k))) t.add("이동 속도");
  if ((a.effects || []).some((e) => e.chance || (e.trigger || {}).type === "time") || rule.requires || a.eligible) t.add("조건부 발동");
  if (a.category === "quest" || /Quest|stack/i.test(a.id) || keys.some((k) => /stack|Stack/.test(k))) t.add("중첩·퀘스트");
  if (/Upgrade/.test(a.id) || (rule.items && !rule.itemsActive)) t.add("아이템 업그레이드");
  if (a.category === "spell") t.add("소환사 주문");
  if (!t.size) t.add(S.hasNumbers(a, { augments: { [a.id]: rule } }) ? "고정 효과" : "효과 종류만 (수치 없음)");
  return [...t];
}

function run(d, fitRows) {
  const byAug = {};
  for (const r of fitRows || []) (byAug[r.aug] = byAug[r.aug] || []).push(r);
  const ref = d.champions.find((c) => c.id === "Garen");
  return d.augments.map((a) => {
    const rule = (d.rules.augments || {})[a.id] || {};
    const ctx = S.augContext([a], d.rules, ref);
    const lift = Object.fromEntries(Object.entries((ctx.liftBy || {})[a.name] || {}).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, +(+v).toFixed(2)]));
    const nums = S.hasNumbers(a, d.rules);
    const rows = byAug[a.name] || [];
    const f = rows.length ? {
      n: rows.length,
      none: rows.filter((r) => r.reach == null).length,
      follow: rows.filter((r) => r.reach != null && r.reach >= 0.7).length,
      same: rows.filter((r) => r.mineItems.slice().sort().join() === r.balItems.slice().sort().join()).length,
      gain: +(rows.reduce((t, r) => t + (r.aoMine - r.aoBal), 0) / rows.length).toFixed(1),
      onhit: rows.filter((r) => r.mineItems.some((n) => ONHIT_ITEMS.includes(n)) && !r.balItems.some((n) => ONHIT_ITEMS.includes(n))).length,
      guinsoo: rows.filter((r) => r.mineItems.includes("구인수의 격노검")).length,
    } : null;
    // 위험: 증강 몫이 거의 늘지 않는데 몰빵이 균형과 다른 장면 비율, 평타 가정에 기대는 적중 아이템 추가
    const risk = [];
    if (f && f.guinsoo >= Math.max(3, f.n * 0.3)) risk.push(`몰빵에 구인수 ${f.guinsoo}/${f.n} (평타 가동 가정)`);
    if (!nums && !Object.keys(lift).length && !(rule.items || []).length) risk.push("수치·연결 능력치·아이템 모두 없음 (아이템과 무관)");
    if (a.unresolved) risk.push(`수치 일부 못 채움 ${a.unresolved}`);
    return { id: a.id, name: a.name, rarity: a.rarityName, category: a.category, types: types(a, rule), numbers: nums, effects: (a.effects || []).length,
      stats: Object.keys(rule.statsResolved || {}).filter((k) => k !== "goldValue"), lift, must: rule.items ? (rule.itemsActive ? "사용 효과 아이템" : rule.items.join("·")) : "",
      requires: rule.requires || (a.eligible ? `챔피언 ${a.eligible.length}명` : ""), fit: f, risk };
  });
}

function markdown(rows, d) {
  const L = [];
  const cnt = {};
  for (const r of rows) for (const t of r.types) cnt[t] = (cnt[t] || 0) + 1;
  L.push("# 증강 → 아이템 연계표", "", `게임 데이터 \`${d.dataVersion || d.version}\` · 만든 도구: \`node tools/augment_link.js --write\` · 등록 증강 ${rows.length}개 전부`, "");
  L.push("> 증강마다 효과 유형, 계산 상태, 아이템이 증강을 키우는 길(입력 능력치·꼭 넣을 아이템)을 적었어요. '점검표'는 역할별 18명 × 수치 증강 장면(`augment_fit`)의 결과예요. 계산 결과끼리의 비교예요.", "");
  L.push("## 요약", "", "| 항목 | 수 |", "|---|---:|");
  L.push(`| 등록 증강 | ${rows.length} |`, `| 수치 계산 (효과·능력치) | ${rows.filter((r) => r.numbers).length} |`, `| 효과 종류만 (수치 없음) | ${rows.filter((r) => !r.numbers).length} |`);
  L.push(`| 아이템이 키우는 입력 능력치가 있음 | ${rows.filter((r) => Object.keys(r.lift).length).length} |`, `| 꼭 넣을 아이템이 있음 (퀘스트·업그레이드) | ${rows.filter((r) => r.must).length} |`);
  L.push(`| 발동 조건이 있음 (근접·원거리·챔피언 한정) | ${rows.filter((r) => r.requires).length} |`, `| 위험 표시 | ${rows.filter((r) => r.risk.length).length} |`, "");
  L.push("| 효과 유형 (여러 개일 수 있음) | 증강 수 |", "|---|---:|");
  for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("", "## 위험 표시", "", "| 증강 | 유형 | 위험 |", "|---|---|---|");
  for (const r of rows.filter((x) => x.risk.length)) L.push(`| ${r.name} | ${r.types.join("·")} | ${r.risk.join(" · ")} |`);
  L.push("", "## 증강별", "", "| 증강 | 등급 | 유형 | 계산 | 아이템이 키우는 능력치 (lift) | 꼭 넣을 아이템 | 조건 | 점검표: 몰빵=균형 / 잘 따라감 / 아이템 무관 / 장면 · 증강 몫 증가 평균 |", "|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const f = r.fit ? `${r.fit.same} / ${r.fit.follow} / ${r.fit.none} / ${r.fit.n} · ${r.fit.gain}` : "—";
    L.push(`| ${r.name} | ${r.rarity || ""} | ${r.types.join("·")} | ${r.numbers ? `수치 (${[...(r.effects ? [`효과 ${r.effects}`] : []), ...(r.stats.length ? [r.stats.slice(0, 4).join(",")] : [])].join(" · ")})` : "효과 종류만"} | ${Object.entries(r.lift).map(([k, v]) => `${k} ${v}`).join(", ") || "—"} | ${r.must || "—"} | ${r.requires || "—"} | ${f} |`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
  S.attachSimilar(d.champions, null, d.items);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const fit = arg("--fit") ? JSON.parse(fs.readFileSync(arg("--fit"), "utf8")) : null;
  const rows = run(d, fit);
  console.log(`증강 ${rows.length} · 수치 ${rows.filter((r) => r.numbers).length} · 위험 ${rows.filter((r) => r.risk.length).length}`);
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows));
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "증강_아이템_연계표.md"), markdown(rows, d));
}
module.exports = { run };
