// 전체 아이템 검증표 (2026-11-14 전체 아이템·증강 평가 검증 P1·P2):
//   P1 아이템마다 기본 능력치(설명 숫자 ↔ 계산에 쓰는 능력치)와 고유 효과의 계산 상태(정확·근사·일부·미계산·확인 필요)
//   P2 대표 챔피언 6명에게 아이템 하나를 넣었을 때 '기본 능력치 몫'과 '고유 효과 몫'을 나눠 재고, 순서·중복 계산을 확인
//   node tools/item_audit.js              요약
//   node tools/item_audit.js --write      docs/아이템_검증표.md
//   node tools/item_audit.js --json 파일
// 계산 결과끼리의 비교예요. 실제 게임 결과가 아니에요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
require("./exp_env")(S, global.Stats);

const FLOOR = { combo: 300, dps: 60, ehp: 2000, support: 600, mobility: 380, control: 1.5 };  // scoring.METRIC_FLOOR
const REFS = ["Jinx", "Garen", "Lux", "Leona", "Zed", "Nami"];  // 원딜·전사·메이지·탱커·암살자·서포터
// 설명 능력치 이름 → 계산 키 (비율은 % 로 적힘). 계산에 안 쓰는 능력치는 null
const STAT_LABEL = {
  "공격력": ["AD"], "주문력": ["AP"], "체력": ["HP"], "방어력": ["ARMOR"], "마법 저항력": ["MR"], "공격 속도": ["AS", true],
  "치명타 확률": ["CRIT", true], "치명타 피해량": ["CRITDMG", true], "스킬 가속": ["HASTE"], "이동 속도": ["MS", false, "MSP"],
  "마나": ["MANA"], "물리 관통력": ["LETHALITY"], "방어구 관통력": ["ARPEN", true], "마법 관통력": ["MPEN", false, "MPENP"],
  "생명력 흡수": ["LS", true], "모든 피해 흡혈": ["OMNIVAMP", true], "체력 회복 및 보호막": ["HSP", true],
  "기본 마나 재생": ["MP5P", true], "기본 체력 재생": ["HP5P", true], "강인함": null,
};
// 고유 효과 문장에서 효과 종류 찾기
const KIND_WORDS = [
  ["dmg", /피해를 입|추가 (물리|마법|고정) 피해|피해를 줍|피해가 증가|피해량이 .*증가|입히는 피해|폭발/],
  ["heal", /회복/], ["shield", /보호막|피해를 흡수/], ["defense", /받는 피해|피해량 감소|방어력|마법 저항력|체력이 증가|최대 체력/],
  ["ms", /이동 속도/], ["haste", /스킬 가속|재사용 대기시간/], ["cc", /둔화|기절|속박|경직|공중에|정화|무적|경직/],
  ["stat", /공격력|주문력|공격 속도|치명타/], ["ally", /아군/],
];
const COND = /이하|미만|이상일|처치|중첩|전투 중|최대|\d+초 동안|일정 시간|매초/;
// 규칙(rules items stats) 키 → 효과 종류
const RULE_KIND = {
  dmgDealtMult: "dmg", effectDmgMult: "dmg", skillDmgMult: "dmg", APmult: "stat", bonusMANAtoAP: "stat", bonusHPtoAP: "stat",
  ehpPhysMult: "defense", ehpMagFlat: "shield", selfHeal: "heal", itemHPbonus: "defense", bonusResistMult: "defense",
  allyHealMult: "heal", allyShieldMult: "shield", dmgToAllyHeal: "heal", allyHealCap: "heal", allyActiveHeal: "heal", allyActiveShield: "shield",
  allyBuffAP: "ally", allyBuffHaste: "ally", allyBuffAS: "ally", MS: "ms", MSP: "ms", MR: "defense", CRIT: "stat", AS: "stat",
  ultHasteAdd: "haste", basicHaste: "haste", onhitRemainingPct: "haste", controlPerCast: "cc", rampAS: "stat", rampMax: "stat", onhitRepeat: "dmg",
};
const strip = (h) => (h || "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

function sections(it) {
  const html = it.passiveHtml || it.desc.split(/<br><br>(?=<span class="t-(passive|active))/).slice(1).join("<br><br>") || "";
  const out = [];
  const re = /<span class="t-(passive|active)">([^<]+)<\/span>([\s\S]*?)(?=<span class="t-(?:passive|active)">|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const text = strip(m[3]).trim();
    const kinds = KIND_WORDS.filter(([, r]) => r.test(text)).map(([k]) => k);
    out.push({ type: m[1] === "active" ? "사용" : "고유", name: m[2].trim(), text, kinds, cond: COND.test(text) });
  }
  return out;
}

function baseCheck(it) {
  const head = it.desc.split(/<span class="t-(?:passive|active)/)[0];
  const out = [];
  const re = /([가-힣 ]+?)\s*<span class="t-attention">([\d.]+)(%?)<\/span>/g;
  let m;
  while ((m = re.exec(head))) {
    const label = m[1].trim(), v = +m[2], pct = m[3] === "%";
    const map = STAT_LABEL[label];
    if (map === undefined) { out.push({ label, v, status: "모르는 능력치" }); continue; }
    if (map === null) { out.push({ label, v, status: "계산에 안 씀" }); continue; }
    const key = pct && map[2] ? map[2] : map[0];
    const isPct = pct && (map[1] || map[2]);
    const want = isPct ? v / 100 : v;
    const got = (it.stats || {})[key];
    out.push({ label, v: m[2] + m[3], key, status: got == null ? "빠짐" : Math.abs(got - want) < 1e-6 ? "같음" : `다름(${got})` });
  }
  return out;
}

function modeled(it) {
  const kinds = new Map();  // 종류 → {src, approx}
  for (const e of it.effects || []) {
    const k = ["physical", "magic", "true", "adaptive"].includes(e.kind) ? "dmg" : e.kind;
    kinds.set(k, { src: `효과 ${e.name}`, approx: false });
  }
  const ps = it.passiveStats || {};
  const rule = it.basisView || [];
  const approx = rule.some((b) => b.t === "assume");
  for (const k of Object.keys(ps)) {
    const kind = RULE_KIND[k] || "stat";
    if (!kinds.has(kind) || !kinds.get(kind).approx) kinds.set(kind, { src: `규칙 ${k}`, approx });
  }
  return kinds;
}

function status(it, secs, kinds) {
  if (!secs.length) return { item: "정확 (능력치만)", rows: [] };
  const rows = secs.map((s) => {
    const want = s.kinds.filter((k) => k !== "ally" || true);
    const hit = want.filter((k) => kinds.has(k) || (k === "ally" && [...kinds.keys()].some((x) => ["heal", "shield", "ally"].includes(x))));
    let st;
    if (!want.length) st = "데이터 확인 필요";
    else if (!hit.length) st = want.every((k) => ["cc", "ms", "ally"].includes(k)) ? "계산되지 않음 (수치화 어려움)" : "계산되지 않음";
    else if (hit.length < want.filter((k) => k !== "stat").length) st = "일부만 계산됨";
    else st = hit.some((k) => (kinds.get(k) || {}).approx) || s.cond ? "근사 계산됨" : "정확하게 계산됨";
    return { ...s, status: st, by: hit.map((k) => (kinds.get(k) || {}).src).filter(Boolean) };
  });
  const order = ["계산되지 않음", "일부만 계산됨", "데이터 확인 필요", "근사 계산됨", "계산되지 않음 (수치화 어려움)", "정확하게 계산됨"];
  const sts = rows.map((r) => r.status);
  let item = sts.every((x) => x === "정확하게 계산됨") ? "정확" : sts.every((x) => x.startsWith("계산되지 않음")) ? "계산되지 않음"
    : sts.some((x) => x.startsWith("계산되지 않음") || x === "일부만 계산됨") ? "일부" : sts.includes("데이터 확인 필요") ? "데이터 확인 필요" : "근사";
  return { item, rows: rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)) };
}

// P2: 아이템 하나의 기본 능력치 몫 · 고유 효과 몫 (챔피언 성향 가중치 = 균형 빌드 전투 가치, 맨몸 대비 %)
function contribution(d, it) {
  const bare = { ...it, effects: [], passiveStats: undefined };
  const res = {};
  for (const cid of REFS) {
    const c = d.champions.find((x) => x.id === cid);
    const w = S.profile(c, d.tags);
    const mw = S.conceptMetricWeights(w, [], d.rules, c, null, {});
    const e0 = Stats.evaluate(c, 18, [], [], {}).m;
    const norm = Object.fromEntries(Object.keys(FLOOR).map((k) => [k, Math.max(e0[k] || 0, FLOOR[k])]));
    const val = (m) => Object.keys(mw).reduce((v, k) => v + mw[k] * (m[k] || 0) / norm[k], 0);
    const v0 = val(e0), vb = val(Stats.evaluate(c, 18, [bare], [], {}).m), vf = val(Stats.evaluate(c, 18, [it], [], {}).m);
    res[cid] = { base: +((vb - v0) * 100).toFixed(1), unique: +((vf - vb) * 100).toFixed(1) };
  }
  return res;
}

// 순서 무관·중복: 아이템 두 개를 넣는 순서를 바꿔도 같은가, 같은 아이템 효과가 두 번 세지지 않는가
function pairChecks(d, items) {
  const c = d.champions.find((x) => x.id === "Jinx"), g = d.champions.find((x) => x.id === "Garen");
  const bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j += 7) {
    for (const ch of [c, g]) {
      const a = Stats.evaluate(ch, 18, [items[i], items[j]], [], {}).m, b = Stats.evaluate(ch, 18, [items[j], items[i]], [], {}).m;
      for (const k of Object.keys(FLOOR)) if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-6 * Math.max(1, Math.abs(a[k] || 0))) bad.push(`${ch.id}: ${items[i].name} + ${items[j].name} (${k})`);
    }
  }
  return bad;
}

function audit(d) {
  const all = d.items;
  const rec = all.filter((i) => i.kind === "legendary" || i.kind === "boots");
  const rows = rec.map((it) => {
    const secs = sections(it), kinds = modeled(it), st = status(it, secs, kinds);
    return { id: it.id, name: it.name, kind: it.kind, gold: it.gold, only: it.only, limit: it.limit, base: baseCheck(it),
      status: st.item, sections: st.rows, hasRule: !!it.passiveStats, effects: (it.effects || []).length, contrib: contribution(d, it) };
  });
  return { counts: {
    all: all.length, recommendable: rec.length, special: all.filter((i) => i.kind === "special").length,
    calc: rows.filter((r) => r.effects || r.hasRule).length,
    uncomputed: rows.filter((r) => r.sections.some((s) => s.status.startsWith("계산되지 않음") || s.status === "일부만 계산됨")).length,
    conditional: rows.filter((r) => r.sections.some((s) => s.cond)).length,
    limited: rows.filter((r) => r.limit).length,
  }, rows, pairs: pairChecks(d, rec) };
}

function markdown(res, d) {
  const L = [];
  const by = (st) => res.rows.filter((r) => r.status === st).length;
  L.push("# 아이템 검증표", "", `게임 데이터 \`${d.dataVersion || d.version}\` · 만든 도구: \`node tools/item_audit.js --write\``, "");
  L.push("> 아이템마다 기본 능력치와 고유 효과가 계산에 어떻게 들어가는지예요. 계산 결과끼리의 비교이고 실게임 결과가 아니에요.", "");
  const c = res.counts;
  L.push("## 요약", "", "| 항목 | 수 |", "|---|---:|");
  L.push(`| 전체 등록 아이템 | ${c.all} |`, `| 추천 가능 (전설 + 신발) | ${c.recommendable} |`, `| 증강 보상 아이템 (자동 추천 안 함) | ${c.special} |`);
  L.push(`| 고유 효과를 계산하는 아이템 (효과 또는 규칙) | ${c.calc} |`, `| 계산되지 않는 효과가 있는 아이템 | ${c.uncomputed} |`, `| 조건부 효과가 있는 아이템 | ${c.conditional} |`, `| 고유 효과 제한(같은 계열) 아이템 | ${c.limited} |`);
  L.push("", "| 계산 상태 | 아이템 수 |", "|---|---:|");
  for (const s of ["정확 (능력치만)", "정확", "근사", "일부", "계산되지 않음", "데이터 확인 필요"]) L.push(`| ${s} | ${by(s)} |`);
  const baseBad = res.rows.flatMap((r) => r.base.filter((b) => b.status !== "같음" && b.status !== "계산에 안 씀").map((b) => `${r.name}: ${b.label} ${b.v} → ${b.status}`));
  L.push("", "## 기본 능력치 대조 (설명 숫자 ↔ 계산 능력치)", "", baseBad.length ? baseBad.map((x) => `- ${x}`).join("\n") : "- 모두 같음", "");
  L.push("- 강인함은 계산에 쓰지 않아요 (수치화 어려움).", "");
  L.push("## 순서·중복 점검", "", res.pairs.length ? res.pairs.slice(0, 30).map((x) => `- 순서에 따라 다름: ${x}`).join("\n") : `- 아이템 두 개 순서를 바꿔도 결과가 같아요 (표본 ${Math.round(res.rows.length * res.rows.length / 14) * 2}쌍)`, "");
  L.push("## 고유 효과 몫이 큰 아이템 (대표 6명 중 최대, 맨몸 대비 전투 가치 %p)", "");
  L.push("| 아이템 | 상태 | 기본 능력치 몫 | 고유 효과 몫 | 챔피언 |", "|---|---|---:|---:|---|");
  const top = res.rows.map((r) => { const e = Object.entries(r.contrib).sort((a, b) => b[1].unique - a[1].unique)[0]; return [r, e]; })
    .filter(([, e]) => e[1].unique > 0).sort((a, b) => b[1][1].unique - a[1][1].unique).slice(0, 25);
  for (const [r, [cid, v]] of top) L.push(`| ${r.name} | ${r.status} | ${v.base} | ${v.unique} | ${cid} |`);
  L.push("", "## 고유 효과가 있는데 대표 6명 누구에게도 몫이 0인 아이템", "");
  const zero = res.rows.filter((r) => r.sections.length && Object.values(r.contrib).every((v) => Math.abs(v.unique) < 0.05));
  for (const r of zero) L.push(`- ${r.name} (${r.status}): ${r.sections.map((s) => `${s.name}[${s.status}]`).join(" · ")}`);
  L.push("", "## 아이템별 고유 효과 상태", "", "| 아이템 | 상태 | 효과 | 계산 출처 |", "|---|---|---|---|");
  for (const r of res.rows) {
    if (!r.sections.length) { L.push(`| ${r.name} | ${r.status} | — | — |`); continue; }
    for (const [i, s] of r.sections.entries()) L.push(`| ${i ? "" : r.name} | ${i ? "" : r.status} | ${s.type} ${s.name}${s.cond ? " (조건부)" : ""}: ${s.status} | ${s.by.join(", ") || "—"} |`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
  const res = audit(d);
  const by = {};
  for (const r of res.rows) by[r.status] = (by[r.status] || 0) + 1;
  console.log(JSON.stringify(res.counts), JSON.stringify(by), "순서 문제", res.pairs.length);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(res));
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "아이템_검증표.md"), markdown(res, d));
}
module.exports = { audit, sections, baseCheck };
