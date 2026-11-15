// 실험 설정을 환경 변수로 받아 엔진에 건다 (분석 도구 공용, 화면 기본값은 그대로).
//   AUG_OFFICIAL=1         증강 몰빵에 공식 추천 가산을 다시 넣음 (기본은 뺌, 2026-11-14 결정. = OFFICIAL_AUG=1)
//   OFFICIAL_AUG=0.5       증강 몰빵 공식 가산 배율
//   OFFICIAL_BAL=0.5       균형 빌드 공식 가산 배율
//   AUG_DELTA=0.2          증강 몰빵 = 증강 몫 최대 (전체 전투 가치 ≥ (1 − δ) × 균형)
//   AUG_FOCUS=2            증강 몰빵 목표의 증강 몫 세기 (scoring CONCEPTS[0].focus, 기본 1. v0.1.93 P3-R 실험)
//   AUTO_UPTIME=0.7        한타 중 기본 공격을 실제로 치는 시간 비율 (기본 1)
//   FIGHT_SEC=4            평타를 이어 치는 한타 시간(초, 기본 6)
//   SKILL_SHARE=0.5        스킬 적중 빈도 비율 (기본 0.3)
//   NORM=own               지표마다 자기 맨몸 값으로 나눔 (v0.1.92까지 = 기준선 A). 기본은 sharedAlly (v0.1.93 P2) · shared 는 모든 챔피언에 같은 분모
//   TAG_DEDUP=effect       수치로 이미 계산되는 효과 태그(tools/tag_overlap.js '계산됨')를 아이템 태그 점수에서 뺌 (기본은 그대로)
//   TAG_DEDUP=unique       TAG_DEDUP=effect 에서 기본 능력치로 계산되는 효과 태그(관통·가속·흡혈 = 능력치 선호)는 남기고, 고유 효과로 계산되는 태그만 뺌 (v0.1.93 P3)
//   HS_TRAIT=fixed         아군 지원 챔피언의 회복·보호막 특성(HEALSHIELD)을 예전처럼 1.0 고정으로 (v0.1.93 P3 E2 적용 전과 비교용.
//                          기본 데이터는 지원 수치가 나오는 스킬·패시브 수 × 0.4, 최대 1 = build_data.py ally_healshield_trait)
// 쓰는 법: const label = require("./exp_env")(S, Stats);  → 건 설정을 글로 돌려준다 (없으면 "")
// 지원 수치(회복·보호막·아군 강화)가 나오는 스킬 수 × 0.4 (최대 1)를 엔진 계산으로 센다.
// 데이터 생성(build_data.py ally_healshield_trait)과 같은지 tests/scale.test.js 가 본다. 패시브·스킬마다 하나로 센다 (18레벨 맨몸 계산에서 값이 0보다 큰 것)
function healShieldTrait(Stats, c) {
  const m = Stats.evaluate(c, 18, [], [], {}).m, src = new Set();
  // 아군에게 가는 몫만 센다 (v0.1.93 P4-A: 스킬의 shield·heal 은 아군 몫, 자기 몫은 selfShield·selfHeal)
  for (const s of m.spells || []) if ((s.shield || 0) + (s.heal || 0) + (s.ally || 0) > 0) src.add(s.slot);
  for (const r of m.effects || []) if ((r.toAlly || 0) > 0 || (r.ally || 0) > 0) src.add(r.slot || (String(r.src || "").startsWith("패시브") ? "P" : r.src));
  return Math.min(1, Math.round(src.size * 0.4 * 100) / 100);
}
const apply = function apply(S, Stats, env = process.env) {
  const parts = [];
  const num = (k) => (env[k] != null && env[k] !== "" ? +env[k] : null);
  const oa = env.AUG_OFFICIAL === "0" ? 0 : env.AUG_OFFICIAL === "1" ? 1 : num("OFFICIAL_AUG"), ob = num("OFFICIAL_BAL");
  if (oa != null || ob != null) {
    S.setOfficialScale({ ...(oa != null ? { augment: oa } : {}), ...(ob != null ? { balanced: ob } : {}) });
    if (oa != null) parts.push(`몰빵 공식 ×${oa}`);
    if (ob != null) parts.push(`균형 공식 ×${ob}`);
  }
  if (num("AUG_FOCUS") != null) { S.CONCEPTS[0].focus = num("AUG_FOCUS"); S.clearMemo(); parts.push(`몰빵 focus ${num("AUG_FOCUS")}`); }
  const dl = num("AUG_DELTA");
  if (dl != null) { S.setAugmentDelta(dl); parts.push(`δ ${dl}`); }
  const exp = {};
  if (num("AUTO_UPTIME") != null) { exp.autoUptime = num("AUTO_UPTIME"); parts.push(`평타 가동 ${exp.autoUptime}`); }
  if (num("FIGHT_SEC") != null) { exp.fightSec = num("FIGHT_SEC"); parts.push(`한타 ${exp.fightSec}초`); }
  if (num("SKILL_SHARE") != null) { exp.skillShare = num("SKILL_SHARE"); parts.push(`스킬 적중 ${exp.skillShare}`); }
  if (Object.keys(exp).length) { Stats.setExperiment(exp); S.clearMemo(); }
  if (env.NORM && env.NORM !== "sharedAlly") { S.setNormMode(env.NORM); parts.push(`기준값 ${env.NORM}`); }
  if (env.HS_TRAIT === "fixed") {
    const path = require("path");
    const d = JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "web", "data.json"), "utf8"));
    const map = {};
    for (const c of d.champions.filter((x) => x.spells && (x.features || []).includes("allysupport"))) {
      map[c.id] = { ...(c.traits || {}), HEALSHIELD: 1 };
    }
    S.setTraitOverride(map);
    parts.push("HEALSHIELD 특성 1.0 고정 (E2 전)");
  }
  if (env.TAG_DEDUP === "effect" || env.TAG_DEDUP === "unique") {
    const path = require("path");
    const d = JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "web", "data.json"), "utf8"));
    const rows = require("./tag_overlap.js").audit(d);
    const skip = {};
    for (const r of rows) {
      const it = d.items.find((i) => i.name === r.name);
      const set = new Set(Object.entries(r.tags).filter(([, v]) => v.type === "효과" && v.computed && (env.TAG_DEDUP === "effect" || v.how !== "능력치")).map(([t]) => t));
      if (it && set.size) skip[it.id] = set;
    }
    S.setTagSkip(skip);
    parts.push(env.TAG_DEDUP === "unique" ? "고유 효과로 계산되는 태그 뺌" : "계산되는 효과 태그 뺌");
  }
  return parts.join(" · ");
};
module.exports = apply;
module.exports.healShieldTrait = healShieldTrait;
