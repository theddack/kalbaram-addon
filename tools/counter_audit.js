// 상대 대응 효과 전수 대조 (v0.1.95 Phase 4-2): 전체 아이템의 원본 설명에서 '상대 대응' 효과를 찾아
// ① 그 효과가 수치 계산에 들어가는지 ② 들어간다면 상대 정보(TARGET.*/enemyMagic)를 실제로 보는지 ③ 문구에만 쓰는지를 가른다.
//   node tools/counter_audit.js            요약
//   node tools/counter_audit.js --write    docs/아이템_효과_구현_연결표.md
// 계산 결과·데이터끼리의 대조예요. 실제 게임 결과가 아니에요.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const d = require(path.join(ROOT, "web", "data.json"));
const RI = (d.rules && d.rules.items) || {};
const text = (i) => JSON.stringify([i.desc, i.passiveHtml]).replace(/<[^>]+>/g, "").replace(/\n/g, " ");
const ruleKeys = (i) => Object.keys((RI[i.name] || {}).stats || {});  // rules.items 는 아이템 이름이 열쇠다
const statKeys = (i) => (i.stats && !Array.isArray(i.stats) ? Object.keys(i.stats) : []);
const effKinds = (i) => (i.effects || []).map((e) => e.kind);
const tgtRatio = (i) => (i.effects || []).some((e) => Object.keys(e.ratios || {}).some((k) => k.startsWith("TGT_")));

// 계산 키마다 '상대 정보를 보는가' — web/stats.js 를 읽고 손으로 확인해 적는다 (키가 늘면 여기도 늘린다)
const USES_ENEMY = {
  healCut: "TARGET.HEAL (상대 회복량)",
  mrShred: "TARGET.MR (상대 마법 저항력)",
  tgtBonusHpAmp: "TARGET.BONUS_HP — 실제 상대에서 안 들어온다 (항상 기본값 300)",
  lowHpMagicTrueAmp: "TARGET.CUR — 고정 0.7 (상대와 무관)",
  ehpPhysMult: "아니오 (내 버티는 힘에 곱한다. 상대 공격 속도·평타 비중과 무관)",
  ehpMagFlat: "아니오 (내 마법 버티는 힘에 더한다)",
  ehpMult: "아니오",
};
// 대응 효과 14가지: [이름, 원본 설명 정규식, 이 효과를 재는 계산 키, 비고]
const CATS = [
  ["치유 감소", /고통스러운 상처|상처\s*를 남깁/, ["healCut"], "상대 회복량(TARGET.HEAL)에 곱한다 — 유일하게 상대 값을 직접 쓰는 대응 효과"],
  ["보호막 감소", /보호막의 효과를|보호막 파괴자/, [], "계산 키 없음. 조언 문구(enemyAdvice '보호막 감소')에만"],
  ["방어력 감소", /방어력(을|이) ?[\d.]*%?\s*(만큼\s*)?감소|방어구를 감소/, [], "계산 키 없음 (마법 저항력 쪽만 mrShred 로 있다)"],
  ["마법 저항력 감소", /마법 저항력(을|이) ?[\d.]*%?\s*(만큼\s*)?감소/, ["mrShred"], "TARGET.MR 을 깎아 관통처럼 계산한다"],
  ["물리 관통", /물리 관통력|방어구 관통력/, ["(능력치 LETHALITY·ARPEN)"], "능력치로 계산 — TARGET.ARMOR 와 함께 피해 경감식에 들어간다"],
  ["마법 관통", /마법 관통력/, ["(능력치 MPEN·MPENP)"], "능력치로 계산 — TARGET.MR 과 함께"],
  ["체력 비례 피해 (상대 체력)", /(대상|적)[^.]{0,30}최대 체력의 [\d.]+%|잃은 체력|현재 체력의 [\d.]+%/, ["tgtBonusHpAmp", "(ratios TGT_MAXHP)"], "최대 체력은 TARGET.HP, 추가 체력은 TARGET.BONUS_HP (상대에서 안 들어옴)"],
  ["평타 피해 감소", /기본 공격으로 받는 피해|치명타로 받는 피해량/, ["ehpPhysMult"], "내 물리 버티는 힘 배수로 근사 — 상대 평타 비중을 안 본다"],
  ["공격 속도 감소", /공격 속도를 [\d.]+%만큼 감소/, ["ehpPhysMult"], "위와 같은 근사 — 상대 공격 속도를 안 본다"],
  ["강인함", /강인함/, [], "계산 키 없음 (아이템 검증표에도 '강인함은 계산에 쓰지 않음')"],
  ["군중 제어 해제", /군중 제어 효과\(?[^)]*\)?를 제거|정화/, [], "계산 키 없음. 조언 문구에만"],
  ["주문 보호막", /주문 방어막|적의 다음 스킬을 막아/, [], "계산 키 없음"],
  ["피해 감소", /받는 피해량이 [\d.]+% 감소|피해를 [\d.]+% 감소/, ["ehpPhysMult", "ehpMult", "drSec"], "일부만 — 아이템마다 다르다"],
  ["생명선 보호막", /생명선/, ["(effects shield)"], "보호막 수치로 계산 (발동 조건은 안 본다)"],
  ["무적·경직", /경직 상태가 됩니다|무적/, ["invulnSec"], "기본 데이터에 invulnSec 가 없다 — 실험(ZHONYA=…)에서만 들어간다"],
  ["이동 속도", /이동 속도가? [\d.]+/, ["MS", "MSP"], "기동성 지표로 계산 — 상대와 무관"],
];

// 정규식이 잡았지만 상대 대응이 아닌 것 (사람이 원본 설명을 읽고 뺀다): 아이템|효과 → 이유
const EXCLUDE = {
  "체력 비례 피해 (상대 체력)|지배자의 피갑옷": "'잃은 체력'은 내 체력 (응징: 내가 피를 흘릴수록 공격력)",
  "체력 비례 피해 (상대 체력)|갈라진 하늘": "'잃은 체력의 4%'는 내 회복량 (라이트실드)",
};
const items = d.items.filter((i) => i.kind === "legendary" || i.kind === "boots");
const rows = [];
for (const [name, re, keys, note] of CATS) {
  const hit = items.filter((i) => re.test(text(i)) && !EXCLUDE[`${name}|${i.name}`]);
  const dropped = items.filter((i) => re.test(text(i)) && EXCLUDE[`${name}|${i.name}`]).map((i) => `${i.name} — ${EXCLUDE[`${name}|${i.name}`]}`);
  const detail = hit.map((i) => {
    const rk = ruleKeys(i), ek = effKinds(i), sk = statKeys(i);
    const has = keys.some((k) => k.startsWith("(")
      ? (k.includes("TGT_") ? tgtRatio(i) : k.includes("effects") ? ek.length > 0 : /LETHALITY|ARPEN|MPEN/.test(k) ? sk.some((x) => k.includes(x)) : true)
      : rk.includes(k) || sk.includes(k));
    const state = !keys.length ? "미계산 (계산 키 없음)" : has ? "수치 계산" : "미계산 (이 아이템엔 키 없음)";
    return { name: i.name, 상태: state, 키: [...rk, ...sk.filter((x) => keys.includes(x))].join(" ") || "-", 효과: ek.join(",") || "-" };
  });
  rows.push({ 효과: name, 아이템수: hit.length, keys, note, dropped,
    계산됨: detail.filter((x) => x.상태 === "수치 계산").length, detail });
}

if (process.argv.includes("--write")) {
  const L = ["# 아이템 효과 구현 연결표 — 상대 대응", "",
    `게임 데이터 \`${d.version}\` · 만든 도구: \`node tools/counter_audit.js --write\``, "",
    "> 전체 아이템(전설 + 신발 " + items.length + "개)의 **원본 설명**에서 상대 대응 효과를 찾아, 그 효과가 추천 계산에 들어가는지와",
    "> 들어간다면 **상대 정보를 실제로 보는지**를 가른 표예요. 계산·데이터끼리의 대조이고 실게임 결과가 아니에요.", "",
    "## 요약", "", "| 대응 효과 | 설명에 있는 아이템 | 수치 계산되는 아이템 | 계산 키 | 상대 정보를 보는가 |", "|---|---:|---:|---|---|"];
  for (const r of rows) {
    const uses = r.keys.map((k) => USES_ENEMY[k]).filter(Boolean)[0] || (r.keys.length ? "아니오 (내 능력치만)" : "—");
    L.push(`| ${r.효과} | ${r.아이템수} | ${r.계산됨} | ${r.keys.join(", ") || "없음"} | ${uses} |`);
  }
  L.push("", "## 효과별 아이템", "");
  for (const r of rows) {
    L.push(`### ${r.효과} (${r.아이템수}개)`, "", r.note, "");
    if (!r.detail.length) { L.push("해당 아이템 없음", ""); continue; }
    L.push("| 아이템 | 상태 | 그 아이템의 규칙 키 | effects |", "|---|---|---|---|");
    for (const x of r.detail) L.push(`| ${x.name} | ${x.상태} | ${x.키} | ${x.효과} |`);
    L.push("");
    if (r.dropped.length) L.push("뺀 것 (설명 문장이 걸렸지만 상대 대응이 아님): " + r.dropped.join(" / "), "");
  }
  fs.writeFileSync(path.join(ROOT, "docs", "아이템_효과_구현_연결표.md"), L.join("\n") + "\n", "utf8");
  console.log("docs/아이템_효과_구현_연결표.md 썼음");
}
console.log(rows.map((r) => `${r.효과}: 설명 ${r.아이템수}개 · 계산 ${r.계산됨}개 · 키 ${r.keys.join(",") || "없음"}`).join("\n"));
