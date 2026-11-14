// 실험 설정을 환경 변수로 받아 엔진에 건다 (분석 도구 공용, 화면 기본값은 그대로).
//   AUG_OFFICIAL=1         증강 몰빵에 공식 추천 가산을 다시 넣음 (기본은 뺌, 2026-11-14 결정. = OFFICIAL_AUG=1)
//   OFFICIAL_AUG=0.5       증강 몰빵 공식 가산 배율
//   OFFICIAL_BAL=0.5       균형 빌드 공식 가산 배율
//   AUG_DELTA=0.2          증강 몰빵 = 증강 몫 최대 (전체 전투 가치 ≥ (1 − δ) × 균형)
//   AUTO_UPTIME=0.7        한타 중 기본 공격을 실제로 치는 시간 비율 (기본 1)
//   FIGHT_SEC=4            평타를 이어 치는 한타 시간(초, 기본 6)
//   SKILL_SHARE=0.5        스킬 적중 빈도 비율 (기본 0.3)
// 쓰는 법: const label = require("./exp_env")(S, Stats);  → 건 설정을 글로 돌려준다 (없으면 "")
module.exports = function apply(S, Stats, env = process.env) {
  const parts = [];
  const num = (k) => (env[k] != null && env[k] !== "" ? +env[k] : null);
  const oa = env.AUG_OFFICIAL === "0" ? 0 : env.AUG_OFFICIAL === "1" ? 1 : num("OFFICIAL_AUG"), ob = num("OFFICIAL_BAL");
  if (oa != null || ob != null) {
    S.setOfficialScale({ ...(oa != null ? { augment: oa } : {}), ...(ob != null ? { balanced: ob } : {}) });
    if (oa != null) parts.push(`몰빵 공식 ×${oa}`);
    if (ob != null) parts.push(`균형 공식 ×${ob}`);
  }
  const dl = num("AUG_DELTA");
  if (dl != null) { S.setAugmentDelta(dl); parts.push(`δ ${dl}`); }
  const exp = {};
  if (num("AUTO_UPTIME") != null) { exp.autoUptime = num("AUTO_UPTIME"); parts.push(`평타 가동 ${exp.autoUptime}`); }
  if (num("FIGHT_SEC") != null) { exp.fightSec = num("FIGHT_SEC"); parts.push(`한타 ${exp.fightSec}초`); }
  if (num("SKILL_SHARE") != null) { exp.skillShare = num("SKILL_SHARE"); parts.push(`스킬 적중 ${exp.skillShare}`); }
  if (Object.keys(exp).length) { Stats.setExperiment(exp); S.clearMemo(); }
  return parts.join(" · ");
};
