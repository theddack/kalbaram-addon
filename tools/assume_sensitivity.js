// 가정값 목록 + 민감도 (기획서 5.3·5.4): 원본으로 정할 수 없어 사람이 정한 값을 모두 모으고,
// 그 값을 ±30%(--pct 로 바꿈) 움직였을 때 증강 등급·추천 1순위가 바뀌는지 본다.
//   node tools/assume_sensitivity.js            요약
//   node tools/assume_sensitivity.js --write    docs/가정값_목록.md 생성
//   node tools/assume_sensitivity.js --pct 20   ±20%
// ±N% 는 시험 범위일 뿐 실제 게임의 오차 범위가 아니다. 실제 범위를 아는 가정은 '범위' 칸에 따로 적는다.
// 대표 챔피언 6명(역할별)로 본다: 계산이 무거워 전 챔피언은 돌리지 않는다 (맥에서 약 1~2분).
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = global.Stats || require(path.join(ROOT, "web", "stats.js"));
const St = global.Stats;
const S = require(path.join(ROOT, "web", "scoring.js"));
const R = require("./rec_baseline.js");

const REPS = ["Jinx", "Lux", "Malphite", "Garen", "Zed", "Sona"];
const OPTS = { aram: true };
const argPct = process.argv.indexOf("--pct");
const PCT = argPct > 0 ? Number(process.argv[argPct + 1]) / 100 : 0.3;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// 숫자 범위 'a~b' 를 설명·근거 문장에서 찾는다 (실제 가능한 범위를 사람이 적어 둔 경우)
const rangeOf = (...texts) => {
  for (const t of texts) {
    const m = String(t || "").match(/(\d+(?:\.\d+)?)\s*%?\s*~\s*(\d+(?:\.\d+)?)\s*(%|초|회|개|중첩)?/);
    if (m) return `${m[1]}~${m[2]}${m[3] || ""}`;
  }
  return null;
};

// 증강 규칙에서 가정이 들어간 능력치 키: 숫자 직접 입력(설명에 없는 값) · 배수(times) · 평균 중첩(stacks)
function augmentAssumptions(d) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "rules.json"), "utf8")).augments;
  const out = [];
  for (const a of d.augments) {
    const r = raw[a.id];
    const built = d.rules.augments[a.id];
    if (!r || !r.stats || !built || !built.statsResolved) continue;
    const plain = (a.desc || "").replace(/<[^>]+>/g, "");
    const nums = new Set(plain.match(/\d+(?:\.\d+)?/g) || []);
    const inDesc = (v) => nums.has(String(+v.toFixed(4))) || nums.has(String(+(v * 100).toFixed(4)));
    const keys = [];
    for (const [k, v] of Object.entries(r.stats)) {
      if (typeof v === "number" && !(inDesc(v) && !(r.basis && (r.basis.assume || []).length))) keys.push({ k, how: "숫자 직접 입력" });
      else if (v && typeof v === "object" && (v.times ?? 1) !== 1) keys.push({ k, how: `원본 × ${v.times}` });
      else if (v && typeof v === "object" && v.stacks) keys.push({ k, how: `평균 중첩 ${v.stacks}` });
    }
    if (!keys.length) continue;
    const b = r.basis || {};
    out.push({ id: a.id, name: a.name, rarity: a.rarity, keys,
      values: Object.fromEntries(keys.map(({ k }) => [k, built.statsResolved[k]])),
      why: (b.assume || []).map((x) => x.why).join(" / ") || r.model || "",
      what: (b.assume || []).map((x) => x.what).join(" / ") || b.calc || "",
      range: rangeOf(r.model, b.calc, ...(b.assume || []).map((x) => x.what), plain),
      noData: (b.assume || []).some((x) => x.noData) || !(b.assume || []).length });
  }
  return out;
}

const scaleVal = (v, f) => (typeof v === "number" ? v * f
  : v && typeof v === "object" && "base" in v ? { ...v, base: v.base.map((x) => x * f), lvl: v.lvl && v.lvl.map((x) => x * f) } : v);

// 한 챔피언에서 증강 하나의 등급(수치 순위 백분위)·추천 1순위
function tierOf(gains, rarityPool, id, gain) {
  const list = rarityPool.map((a) => (a.id === id ? gain : gains[a.id] ? gains[a.id].gain : null)).filter((g) => g != null);
  const rank = 1 + list.filter((g) => g > gain).length;
  const pct = rank / list.length;
  const tier = gain < 0 ? "D" : S.TIER_CUTS.find(([, cut]) => pct <= cut)[0];
  return { tier, rank, n: list.length };
}

function run(d) {
  S.attachSimilar(d.champions, null, d.items);
  const assumptions = augmentAssumptions(d);
  const ctx = {};
  for (const id of REPS) {
    const c = d.champions.find((x) => x.id === id);
    const w = S.profile(c, d.tags);
    ctx[id] = { c, w, gains: S.numericAugmentGains(d.augments, d.items, w, [], [], d.rules, c, OPTS).gains };
  }
  S.setMemoMax(0);  // 같은 rules 객체를 고쳐 가며 계산하므로 기억된 결과를 쓰면 안 된다
  for (const as of assumptions) {
    const a = d.augments.find((x) => x.id === as.id);
    const rule = d.rules.augments[a.id];
    const orig = { ...rule.statsResolved };
    as.result = [];
    for (const id of REPS) {
      const { c, w, gains } = ctx[id];
      if (!gains[a.id]) continue;  // 이 챔피언에겐 숫자로 평가되지 않음 (조건 없음 등)
      const pool = d.augments.filter((x) => x.rarity === a.rarity);
      const base = tierOf(gains, pool, a.id, gains[a.id].gain);
      const top0 = R.ranking(d, c, [a], []).top[0];
      const row = { champ: id, base: `${base.tier}${base.rank}/${base.n}`, top1: top0 && top0.name, var: {} };
      for (const f of [1 - PCT, 1 + PCT]) {
        for (const { k } of as.keys) rule.statsResolved[k] = scaleVal(orig[k], f);
        const g = S.numericAugmentGains([a], d.items, w, [], [], d.rules, c, OPTS).gains[a.id];
        const t = g ? tierOf(gains, pool, a.id, g.gain) : null;
        const top = R.ranking(d, c, [a], []).top[0];
        row.var[f < 1 ? "minus" : "plus"] = { tier: t ? `${t.tier}${t.rank}/${t.n}` : "-", tierChanged: !!t && t.tier !== base.tier,
          top1: top && top.name, top1Changed: !!top && !!top0 && top.name !== top0.name };
        Object.assign(rule.statsResolved, orig);
      }
      as.result.push(row);
    }
    // 심각도: 3 = 아이템 추천 1순위가 바뀜, 2 = 등급 두 칸 이상, 1 = 등급 한 칸 (백분위 경계라 흔하다), 0 = 그대로
    const O = "SABCD";
    const sev = (r) => Math.max(0, ...Object.values(r.var).map((v) => (v.top1Changed ? 3
      : v.tier === "-" ? 0 : Math.min(2, Math.abs(O.indexOf(v.tier[0]) - O.indexOf(r.base[0]))))));
    for (const r of as.result) r.severity = sev(r);
    as.severity = Math.max(0, ...as.result.map((r) => r.severity));
    as.unstable = as.result.filter((r) => r.severity >= 2).map((r) => r.champ);
  }
  S.setMemoMax(40);
  // 계산 전체 가정 (stats.js ASSUMPTIONS 중 숫자로 바꿀 수 있는 것): 대표 챔피언 증강 없는 추천 1순위
  const globals = [];
  for (const [key, label] of [["CUR", "상대 현재 체력 70%"], ["DPS_TAKEN", "받는 피해 초당 600"]]) {
    const orig = St.TARGET[key];
    const changed = [];
    S.setMemoMax(0);
    const top = (id) => R.ranking(d, d.champions.find((x) => x.id === id), [], []).top[0].name;
    const base = Object.fromEntries(REPS.map((id) => [id, top(id)]));
    for (const f of [1 - PCT, 1 + PCT]) {
      St.TARGET[key] = key === "CUR" ? Math.min(1, orig * f) : orig * f;
      for (const id of REPS) { const t = top(id); if (t !== base[id]) changed.push(`${id} ${f < 1 ? "−" : "+"}: ${base[id]} → ${t}`); }
      St.TARGET[key] = orig;
    }
    S.setMemoMax(40);
    globals.push({ key, label, changed });
  }
  return { pct: PCT, reps: REPS, assumptions, globals, dataVersion: d.dataVersion };
}

function markdown(r, d) {
  const L = [];
  const P = Math.round(r.pct * 100);
  const esc = (s) => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  L.push("# 가정값 목록과 민감도", "");
  L.push(`게임 데이터 \`${r.dataVersion}\` · 만든 도구: \`node tools/assume_sensitivity.js --write\` (±${P}%, 대표 챔피언 ${r.reps.join("·")}).`, "");
  L.push(`> ±${P}% 는 **시험 범위**다. 실제 게임에서 값이 이만큼 흔들린다는 뜻이 아니다. 실제 범위를 아는 가정은 '범위' 칸에 적었다.`);
  L.push("> 흔들림 강 = 그 증강을 고른 뒤 아이템 추천 1순위가 바뀜 · 중 = 증강 등급이 두 칸 이상 바뀜 · 약 = 한 칸 (등급이 백분위 구간이라 경계에 있으면 흔하다).", "");
  const un = r.assumptions.filter((a) => a.unstable.length);
  L.push("## 요약", "");
  const n = (k) => r.assumptions.filter((a) => a.severity === k).length;
  L.push(`- 증강 규칙의 가정 ${r.assumptions.length}개 (숫자 직접 입력·원본 × 배수·평균 중첩). ±${P}% 에 흔들림 강 **${n(3)}** · 중 **${n(2)}** · 약 ${n(1)} · 그대로 ${n(0)}.`);
  L.push(`- 실제 게임 확인이 필요한 것(근거 데이터 없음) ${r.assumptions.filter((a) => a.noData).length}개.`);
  for (const g of r.globals) L.push(`- 계산 전체 가정 '${g.label}' ±${P}%: 대표 챔피언 추천 1순위 변화 ${g.changed.length}건${g.changed.length ? " (" + g.changed.join(", ") + ")" : ""}`);
  L.push("", "## 흔들림 강·중 (먼저 실게임으로 확인할 것)", "");
  L.push("| 증강 | 가정 키 | 현재 값 | 범위 | 흔들린 챔피언 | 등급(순위/전체)·1순위 변화 |", "|---|---|---|---|---|---|");
  for (const a of un) {
    const detail = a.result.filter((x) => a.unstable.includes(x.champ)).map((x) =>
      `${x.champ} 등급 −${P}%: ${x.var.minus.tier} · 기준: ${x.base} · +${P}%: ${x.var.plus.tier}` + (x.var.minus.top1Changed || x.var.plus.top1Changed
        ? ` · 1순위 ${x.top1}→${[x.var.minus, x.var.plus].filter((v) => v.top1Changed).map((v) => v.top1).join("/")}` : "")).join("<br>");
    L.push(`| ${esc(a.name)} (${a.id}) | ${a.keys.map((k) => `${k.k} (${k.how})`).join(", ")} | ${esc(Object.entries(a.values).map(([k, v]) => `${k} ${typeof v === "number" ? r4(v) : "레벨 비례"}`).join(", "))} | ${esc(a.range)} | ${a.unstable.join(", ")} | ${detail} |`);
  }
  L.push("", "## 증강 가정 전체 (기획서 5.3: 이유·범위·현재 값·근거·영향·실게임 확인)", "");
  L.push("| 증강 | 가정 키 | 현재 값 | 가정 (무엇을 정했나) | 이유 | 범위 | 영향 (±" + P + "%) | 실게임 확인 |", "|---|---|---|---|---|---|---|---|");
  for (const a of r.assumptions) {
    const eff = !a.result.length ? "숫자 평가 대상 아님" : `${["그대로", "약", "중", "강"][a.severity]} (${a.result.filter((x) => x.severity).length}/${a.result.length}명)`;
    L.push(`| ${esc(a.name)} (${a.id}) | ${a.keys.map((k) => `${k.k} (${k.how})`).join(", ")} | ${esc(Object.entries(a.values).map(([k, v]) => `${k} ${typeof v === "number" ? r4(v) : "레벨 비례"}`).join(", "))} | ${esc(a.what)} | ${esc(a.why)} | ${esc(a.range)} | ${eff} | ${a.noData ? "필요" : "근거 있음"} |`);
  }
  // 아이템·챔피언·계산 전체 가정은 목록만 (민감도는 증강 가정에만 돌렸다)
  L.push("", "## 아이템 고유 효과 가정", "", "| 아이템 | 가정 | 이유 |", "|---|---|---|");
  for (const [name, r0] of Object.entries(d.rules.items || {})) for (const x of ((r0.basis || {}).assume || [])) L.push(`| ${esc(name)} | ${esc(x.what)} | ${esc(x.why)} |`);
  L.push("", "## 챔피언 가정 (중첩형 패시브 평균 중첩·전투 특성)", "", "| 챔피언 | 가정 | 이유 |", "|---|---|---|");
  for (const [id, r0] of Object.entries(d.rules.champions || {})) {
    for (const x of ((r0.basis || {}).assume || [])) L.push(`| ${esc(id)} | ${esc(x.what)} | ${esc(x.why)} |`);
    for (const e of ((r0.fight || {})._effects || [])) if (e.trigger && e.trigger.from) L.push(`| ${esc(id)} | 전투 특성 '${esc(e.src)}' 발동: ${esc(e.trigger.from)} | 추천 점수에만 (지금 능력치 비교 제외) |`);
  }
  L.push("", "## 계산 전체 가정 (web/stats.js ASSUMPTIONS)", "", "| 가정 | 출처 | 이유 |", "|---|---|---|");
  for (const x of St.ASSUMPTIONS) L.push(`| ${esc(x.what)} | ${x.src === "data" ? "데이터" : "정한 값"} | ${esc(x.why)} |`);
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const t0 = Date.now();
  const d = R.load();
  const r = run(d);
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(ROOT, "docs", "가정값_목록.md"), markdown(r, d));
  const un = r.assumptions.filter((a) => a.unstable.length);
  console.log(`가정 ${r.assumptions.length}개 · ±${Math.round(r.pct * 100)}% 에 흔들림 강·중 ${un.length}개: ${un.map((a) => a.name).join(", ")}`);
  for (const g of r.globals) console.log(`  ${g.label}: 1순위 변화 ${g.changed.length}건`);
  console.log(`(${Date.now() - t0}ms)`);
}
module.exports = { run, augmentAssumptions };
