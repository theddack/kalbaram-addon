// 공식 추천과 다른 사례 분류 (안정화 기획서 10.3): 라이엇 칼바람 공식 추천의 '핵심' 아이템을 우리 기본 빌드(증강 없음·균형)가
// 하나도 담지 않은 챔피언마다, 그 핵심 아이템이 우리 계산에서 몇 위·몇 점인지 보고 나눈다. 공식과 다르다고 점수를 고치지 않는다.
//   node tools/official_diff.js            요약
//   node tools/official_diff.js --write    docs/공식_추천_차이.md
// 분류:
//   계산상 차이 설명 가능  핵심 아이템이 우리 1위 점수의 85% 이상(근소한 차이로 6칸 밖) 또는 주 피해 유형과 반대라 밀어냄
//   증강 연계 때문         (이 표는 증강 없는 기본 빌드라 해당 없음 — 증강을 고르면 몰빵 빌드가 따로 정한다)
//   계산 누락·과대 의심    핵심 아이템 점수가 1위의 70% 미만인데 그 아이템 고유 효과에 못 푼 수치('?')가 있거나 효과를 하나도 못 뽑음
//   추가 검증 필요         그 밖 (점수 차이가 큰데 계산이 틀렸다고 볼 근거가 없음)
const fs = require("fs");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));

const CLOSE = 0.85, FAR = 0.7;

function run(d) {
  S.attachSimilar(d.champions, null, d.items);
  const byId = Object.fromEntries(d.items.map((i) => [i.id, i]));
  const out = [];
  for (const c of d.champions.filter((x) => x.officialItems && x.officialItems.mode === "ARAM")) {
    const w = S.profile(c, d.tags);
    const build = S.buildConcepts(d.items, w, [], [], d.rules, c, { aram: true }, ["balanced"])[0].pick.map((p) => p.item);
    const core = c.officialItems.ranges[0].filter((id) => byId[id]);
    if (!core.length || build.some((i) => core.includes(i.id))) continue;
    const rows = S.rankItems(d.items, w, [], [], d.rules, c, { aram: true }, "balanced").filter((r) => r.item.kind === "legendary");
    const top = rows[0];
    const info = core.map((id) => {
      const idx = rows.findIndex((r) => r.item.id === id);
      const r = rows[idx];
      const it = byId[id];
      const missing = /\?/.test(it.passiveHtml || "") || (/피해|회복|보호막/.test((it.passiveHtml || "") + it.desc) && !(it.effects || []).length && !it.passiveStats);
      return { id, name: it.name, rank: idx + 1, ratio: r && top.score > 0 ? r.score / top.score : null, offType: !!(r && r.offType), missing };
    }).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
    const best = info[0];
    let kind, why;
    if (best.offType) { kind = "계산상 차이 설명 가능"; why = `${best.name}: 주 피해 유형(${c.damageType})과 반대 유형이라 뒤로 밀어냄`; }
    else if (best.ratio != null && best.ratio >= CLOSE) {
      kind = "계산상 차이 설명 가능";
      why = best.rank <= 6 ? `${best.name}: 다음 구매 순위 ${best.rank}위인데 6칸 조합에서 빠짐 (같은 계열 고유 효과·함께 쓸 때 점수)`
        : `${best.name}: 우리 ${best.rank}위, 1위 점수의 ${Math.round(best.ratio * 100)}% (근소한 차이로 6칸 밖)`;
    }
    else if (info.some((x) => x.missing) && (best.ratio ?? 0) < FAR) { const m = info.find((x) => x.missing); kind = "계산 누락·과대 의심"; why = `${m.name}: 고유 효과 수치를 다 못 뽑음 → 낮게 잡혔을 수 있음 (우리 ${m.rank}위)`; }
    else { kind = "추가 검증 필요"; why = `${best.name}: 우리 ${best.rank}위, 1위 점수의 ${best.ratio == null ? "?" : Math.round(best.ratio * 100)}% — 계산이 틀렸다고 볼 근거는 없음 (실게임 피해 기록으로)`; }
    out.push({ id: c.id, name: c.name, role: c.tags[0], core: info, build: build.map((i) => i.name), top: top.item.name, kind, why });
  }
  return out;
}

if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(path.join(WEB, "data.json"), "utf8"));
  const aram = d.champions.filter((x) => x.officialItems && x.officialItems.mode === "ARAM").length;
  const rows = run(d);
  const kinds = ["계산상 차이 설명 가능", "증강 연계 때문", "계산 누락·과대 의심", "추가 검증 필요"];
  const n = (k) => rows.filter((r) => r.kind === k).length;
  console.log(`공식 칼바람 추천 ${aram}명 중 핵심 아이템을 하나도 안 담은 챔피언 ${rows.length}명: ` + kinds.map((k) => `${k} ${n(k)}`).join(" · "));
  if (process.argv.includes("--write")) {
    const esc = (v) => String(v).replace(/\|/g, "\\|");
    const L = ["# 공식 추천과 다른 사례", "",
      `게임 데이터 \`${d.dataVersion}\` · 만든 도구: \`node tools/official_diff.js --write\` (증강 없음 · 균형 빌드 · 칼바람).`, "",
      "> 라이엇 칼바람 공식 추천의 핵심(첫 묶음) 아이템을 우리 기본 빌드 6칸이 하나도 담지 않은 챔피언만 본다 (안정화 기획서 10.3).",
      "> 공식 추천과 다르다는 이유만으로 점수를 바꾸지 않는다. 공식 추천은 가산점(OFFICIAL_BOOST)으로만 쓴다.", "",
      `## 요약`, "", `공식 칼바람 추천이 있는 ${aram}명 중 ${rows.length}명.`, "", "| 분류 | 챔피언 수 |", "|---|---:|",
      ...kinds.map((k) => `| ${k} | ${n(k)} |`), "",
      "'증강 연계 때문'은 이 표(증강 없는 기본 빌드)에는 나오지 않는다. 증강을 고른 뒤의 차이는 증강 몰빵 빌드가 증강에 맞춰 정한 결과다.", "",
      "## 우리 1위로 자주 나오는 아이템 (과대평가 확인 후보)", "",
      "공식과 다른 챔피언들에서 우리 1위가 한 아이템에 몰리면, 그 아이템 계산이 부풀었을 수 있다 (점수는 바꾸지 않고 확인 항목으로).", "",
      "| 우리 1위 | 챔피언 수 | 역할별 |", "|---|---:|---|",
      ...Object.entries(rows.reduce((m, r) => ((m[r.top] = m[r.top] || []).push(r), m), {})).sort((a, b) => b[1].length - a[1].length)
        .map(([name, list]) => `| ${esc(name)} | ${list.length} | ${Object.entries(list.reduce((m, r) => ((m[r.role] = (m[r.role] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(" · ")} |`), "",
      "## 챔피언별", "", "| 챔피언 | 공식 핵심 (우리 순위 · 1위 대비 점수) | 우리 1위 | 분류 | 근거 |", "|---|---|---|---|---|"];
    for (const r of rows.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.name.localeCompare(b.name)))
      L.push(`| ${esc(r.name)} | ${r.core.map((x) => `${esc(x.name)} (${x.rank}위 · ${x.ratio == null ? "?" : Math.round(x.ratio * 100) + "%"}${x.offType ? " · 반대 유형" : ""})`).join(", ")} | ${esc(r.top)} | ${r.kind} | ${esc(r.why)} |`);
    fs.writeFileSync(path.join(__dirname, "..", "docs", "공식_추천_차이.md"), L.join("\n") + "\n");
  }
}
module.exports = { run };
