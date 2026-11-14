// 챔피언·아이템 적합성 (2026-11-14 전체 검증 P3): 전 챔피언 균형 기본 빌드(증강 없음)의 아이템마다 점수 구성과
// 챔피언 전투 방식(평타 비중·치명타·피해 유형·아군 지원)과 맞는지 규칙 기반으로 표시한다. 빌드는 바꾸지 않는다.
//   node tools/champ_fit.js            요약
//   node tools/champ_fit.js --write    docs/챔피언_아이템_적합성.md
// 표시 기준은 엔진이 이미 쓰는 판단과 같다 (scoring.typeOk·치명타 사용자·allysupport). 계산 결과끼리의 비교예요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
require("./exp_env")(S, global.Stats);
const { audit } = require("./item_audit.js");

const SUPPORT_ITEMS = ["월석 재생기", "헬리아의 메아리", "구원", "미카엘의 축복", "강철의 솔라리 펜던트", "흐르는 물의 지팡이", "불타는 향로", "슈렐리아의 군가"];
const t = (i, k) => ((i.tags || {})[k] || 0) >= 0.5;
const isTank = (i) => (t(i, "HP") || t(i, "ARMOR") || t(i, "MR")) && !t(i, "AD") && !t(i, "AP") && !t(i, "AS") && !t(i, "CRIT");

function run(d) {
  const au = audit(d);
  const unc = new Map(au.rows.map((r) => [r.name, r.status]));
  const rows = [];
  for (const c of d.champions) {
    const w = S.profile(c, d.tags);
    const b = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0];
    const share = S.autoShare(c);
    const critUser = c.tags.includes("Marksman") || !c.melee || ((c.traits || {}).CRIT || 0) > 0;
    const ally = (c.features || []).includes("allysupport");
    const o = c.officialItems && c.officialItems.mode === "ARAM" ? c.officialItems : c.similarItems;
    const oset = new Set(o ? o.ranges.flat() : []);
    const flags = [];
    const items = b.pick.map((p) => {
      const i = p.item, f = [];
      if (t(i, "CRIT") && !critUser) f.push("치명타 안 쓰는 챔피언");
      if ((t(i, "ONHIT") || t(i, "AS")) && share < 0.25 && !t(i, "AP")) f.push(`평타 비중 ${Math.round(share * 100)}%`);
      if (c.damageType === "physical" && t(i, "AP") && !t(i, "AD")) f.push("물리 챔피언에 주문력");
      if (c.damageType === "magic" && t(i, "AD") && !t(i, "AP")) f.push("마법 챔피언에 공격력");
      if (SUPPORT_ITEMS.includes(i.name) && !ally) f.push("아군 지원 안 하는 챔피언에 서포터 아이템");
      const st = unc.get(i.name);
      if (st === "계산되지 않음") f.push("고유 효과 미계산");
      flags.push(...f);
      return { name: i.name, kind: i.kind, score: +(p.score || 0).toFixed(2), tag: +(p.tagScore || 0).toFixed(2), official: oset.has(i.id), status: st, flags: f,
        gain: p.gain ? Object.fromEntries(Object.entries(p.gain).filter(([, v]) => Math.abs(v) > 0.005).map(([k, v]) => [k, +(v * 100).toFixed(1)])) : null };
    });
    const legend = items.filter((x) => x.kind === "legendary");
    const tanks = b.pick.filter((p) => p.item.kind === "legendary" && isTank(p.item)).length;
    if (tanks >= 4 && !c.tags.includes("Tank") && !c.tags.includes("Support")) flags.push(`탱커 아이템 ${tanks}개 (역할 ${c.tags.join("/")})`);
    if (ally && !legend.some((x) => SUPPORT_ITEMS.includes(x.name))) flags.push("아군 지원 챔피언인데 서포터 아이템 없음");
    rows.push({ id: c.id, name: c.name, roles: c.tags, dt: c.damageType, melee: !!c.melee, share: +share.toFixed(2), critUser, ally,
      official: legend.filter((x) => x.official).length, items, flags });
  }
  return rows;
}

function markdown(rows, d) {
  const L = [];
  const cnt = {};
  for (const r of rows) for (const f of r.flags) { const k = f.replace(/\d+%|\d+개 \(역할 .*\)/g, (m) => (m.includes("개") ? "N개" : "N%")); cnt[k] = (cnt[k] || 0) + 1; }
  L.push("# 챔피언·아이템 적합성", "", `게임 데이터 \`${d.dataVersion || d.version}\` · 만든 도구: \`node tools/champ_fit.js --write\` · 대상: 전 챔피언 ${rows.length}명, 균형 기본 빌드(증강 없음)`, "");
  L.push("> 표시는 엔진이 이미 쓰는 판단(주 피해 유형·치명타 사용자·아군 지원 챔피언·평타 비중)으로만 했어요. 표시가 있다고 틀린 추천이라는 뜻은 아니에요. 계산 결과끼리의 비교예요.", "");
  L.push("## 표시 종류별 수", "", "| 표시 | 횟수 |", "|---|---:|");
  for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("", `표시가 하나도 없는 챔피언: ${rows.filter((r) => !r.flags.length).length}/${rows.length}`, "");
  L.push("## 챔피언별", "", "| 챔피언 | 역할 | 평타 비중 | 빌드 (점수 · 태그, ★ 공식/비슷한 챔피언 추천) | 표시 |", "|---|---|---:|---|---|");
  for (const r of rows) {
    const b = r.items.map((x) => `${x.official ? "★" : ""}${x.name}(${x.score}·${x.tag})`).join(", ");
    L.push(`| ${r.name} | ${r.roles.join("/")}${r.ally ? " · 아군 지원" : ""} | ${Math.round(r.share * 100)}% | ${b} | ${[...new Set(r.flags)].join(" · ") || "—"} |`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
  S.attachSimilar(d.champions, null, d.items);
  const rows = run(d);
  const n = rows.filter((r) => r.flags.length).length;
  console.log(`챔피언 ${rows.length} · 표시 있는 챔피언 ${n}`);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (arg("--json")) fs.writeFileSync(arg("--json"), JSON.stringify(rows));
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "챔피언_아이템_적합성.md"), markdown(rows, d));
}
module.exports = { run };
