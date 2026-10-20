// 미구현 효과 분류 (안정화 기획서 5장): 증강 원본 대조의 '미구현' 항목마다 우선순위(P0 전투 수치 / P1 상황 조건 / P2 수치화 어려움)와
// 처리 상태(계산 반영 완료 · 태그 기반 간접 반영 · 가정값으로 처리 · 의도적 계산 제외 · 실제 게임 확인 필요)를 근거와 함께 붙인다.
//   node tools/unimpl_triage.js            요약
//   node tools/unimpl_triage.js --write    docs/미구현_분류.md
// 입력: docs/증강_원본_대조.json (node tools/aug_audit.js --write), web/data.json. 근거 없는 '미구현'을 남기지 않는 것이 목적이다.
// 자동 분류(원본 값 이름·종류·설명 문장)가 맞지 않는 항목은 아래 MANUAL 에 사람이 판단한 이유를 적는다.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

const S = { done: "계산 반영 완료", tag: "태그 기반 간접 반영", assume: "가정값으로 처리", skip: "의도적 계산 제외", game: "실제 게임 확인 필요" };

// 사람이 판단한 항목 (증강 id|원본 값 이름): [우선순위, 상태, 이유]
const MANUAL = {
  "ARAM_SpinToWin|SpinDamageAmp": ["P0", "assume", "회전 스킬 하나만 피해 +30% → 규칙이 기본 스킬 3개 평균 +10%로 근사 (어느 스킬이 회전인지 챔피언 데이터에 없음)"],
  "ARAM_SpinToWin|SpinDamageAmp_Ult": ["P0", "game", "회전 궁극기 피해 +50%: 궁극기가 회전형인 챔피언만 (갱플랭크 R 같은 예외). 해당 챔피언 목록이 없어 실게임 확인 후"],
  "ChainReaction|Ult_DamageAmp": ["P1", "game", "궁극기 피해 +250%는 밀쳐서 챔피언끼리 부딪혔을 때만 — 충돌 비율을 정할 수 없음"],
  "Terraind|Calc_TT_Ult_Damage_Amp": ["P1", "game", "지형 생성 궁극기만 피해 증가 — 지형 조건(requires terrain)은 있지만 충돌 비율은 실게임 확인"],
  "ARAM_DualWield|AttackReduction": ["P0", "game", "기본 공격이 두 번 나가는 대신 피해 감소 — 두 번째 공격의 적중 효과 비율(OnHitMod)과 함께 실게임 피해 기록으로 맞춘다"],
  "ARAM_DualWield|OnHitMod": ["P0", "game", "위와 같음 (두 번째 공격의 적중 효과 40%)"],
  "ARAM_Typhoon|ADRatio": ["P1", "skip", "다른 대상에게 쏘는 투사체 — 한 대상 기준 계산이라 주 대상 피해에 들어가지 않음"],
  "EndlessDecimation|BaseHealPercent": ["P1", "game", "잃은 체력 18% 회복 — 그때 잃은 체력을 정할 수 없음 (한타 중 잃은 체력 비율 가정이 필요)"],
  "ARAM_TankItOrLeaveIt|MaxChance": ["P0", "assume", "확률 최대 50% · 피해 감소 20% → 규칙이 기대값으로 근사"],
  "ARAM_TankItOrLeaveIt|DamageReduction": ["P0", "assume", "위와 같음"],
  "ARAM_Upgrade_IE|CritChanceToDamage": ["P0", "game", "무한의 대검 업그레이드: 치명타 확률 → 피해 전환 방식(100% 넘는 부분인지)이 설명만으로 불분명"],
  "ARAM_Upgrade_Collector|ExecutionInc": ["P1", "skip", "처형 기준 증가는 마무리 효과 — 지표에 처형이 없음"],
  "ARAM_Upgrade_Collector|UpgradedGoldAmount": ["P1", "assume", "처형마다 골드 — 처치 횟수 가정이 필요해 즉시 골드(goldValue)만 반영"],
  "ARAM_DontBlink|BonusDamagePerMSDifference": ["P0", "assume", "이동 속도 차이 10당 +1% → 규칙이 차이 50 = +5%로 근사"],
  "ARAM_CriticalHealing|CritHeal": ["P0", "game", "치명타 피해의 40% 회복 — 치명타 피해량 기반 회복이 계산 구조(흡혈은 전체 피해)와 달라 실게임 기록으로 맞춘다"],
  "ARAM_SoulSiphon|HealPercentage": ["P0", "game", "치명타 피해의 12% 회복 (위와 같은 구조)"],
  "ARAM_MasterofDuality|StackDuration": ["P1", "assume", "중첩 유지 시간 — 규칙의 평균 중첩 가정 안에 들어 있음"],
  "WarlockJuicebox|Calc_Vamp": ["P0", "done", "게임 계산식 그대로 (10% + 주문력 비례)"],
  "ARAM_FanTheHammer|MaxDamageAmp": ["P0", "assume", "이동 거리에 비례해 최대 +50% → 거리 보너스 없이(0%) 셈 (낮게 잡힘, 실게임 거리 기록으로)"],
  "ARAM_FanTheHammer|OnHitRatio": ["P0", "game", "탄환마다 적중 효과 20% — 적중 효과 아이템이 있을 때만 붙는 구조를 실게임 피해 기록으로"],
  "ARAM_InfernoTriggered|MinionDamageMod": ["P2", "skip", "미니언 대상 피해 — 챔피언 대상 계산 밖"],
  "ARAM_InfernoTriggered|Calc_Style_MS_Per_Stack": ["P2", "tag", "스타일 등급마다 이동 속도 — 이동 태그로"],
  "ARAM_Firefox|RepeatDamageMod": ["P0", "assume", "불꽃 3개 중 연달아 맞는 2개는 30% → 첫 불꽃만 셈 (조금 낮게 잡힘)"],
  "MightyShield|AdaptiveAmp": ["P0", "assume", "보호막을 얻을 때 3초 적응형 → 규칙이 가동률 35%로 근사 (basis)"],
  "ARAM_StuckInHereWithMe|DamageMitigation": ["P0", "assume", "궁극기 후 2초 피해 감소 50% → 규칙이 '무적 1초'로 환산 (drSec)"],
  "SurgeField|MissileDamagePercent": ["P0", "game", "영역 안에서 입힌 피해의 20%를 투사체로 — 영역 안에 머무는 시간을 정할 수 없음"],
  "ARAM_ClownCollege|BasicAttackDamage": ["P0", "game", "뒤에서 공격할 때만 추가 피해 — 뒤를 잡는 비율을 정할 수 없음"],
  "ARAM_ClownCollege|QCritDamageMod": ["P0", "game", "투명 상태 다음 공격·뒤에서 치명타 — 위와 같은 조건"],
  "ARAM_WeeWooWeeWoo|Calc_HS_Amp_Max": ["P0", "assume", "아군 잃은 체력에 비례해 최대 +50% → 규칙이 평균 15%로 근사 (basis)"],
  "DarkWind|BonusHealingPercent_Max": ["P0", "game", "스킬 재사용 대기시간에 비례해 회복 최대 +50% — 피해·회복 효과 자체가 이동 불가 CC 조건이라 실게임 기록으로"],
  "ARAM_WindspeakersBlessing|Resists": ["P2", "tag", "회복·보호막을 준 아군의 방어력·마법 저항력 — 아군 효과 (지원 태그로)"],
};

function classify(row, aug, rule) {
  const key = `${row.id}|${row.ref.replace(/[*⚠].*$/, "").trim()}`;
  if (MANUAL[key]) { const [p, s, why] = MANUAL[key]; return { prio: p, status: S[s], why }; }
  const name = row.ref.replace(/[*⚠].*$/, "").trim();
  const desc = (aug.desc || "").replace(/<[^>]+>/g, "");
  const tags = rule.tags || aug.tags || {};
  const numeric = (aug.effects || []).length > 0 || !!rule.statsResolved;
  const once = (aug.effects || []).every((e) => (e.trigger || {}).type === "once");
  const has = (t) => (tags[t] || 0) >= 0.4;
  if (/TT$|Tooltip|TT_/.test(name)) return { prio: "P2", status: S.skip, why: "툴팁 표시용 값 (계산용 값은 따로 있음)" };
  if (/눈덩이/.test(desc) && /Haste|DamageAmp|Size/i.test(name)) return { prio: "P2", status: S.skip, why: "눈덩이(소환사 주문) 효과 — 소환사 주문은 계산하지 않음" };
  if (/아군[^.]{0,30}(이동 속도|회복|보호막|방어력)/.test(desc) && /Ally|MS|Speed|Resist|Heal/i.test(name))
    return { prio: "P2", status: has("HEALSHIELD") ? S.tag : S.skip, why: "아군에게 주는 효과 — 내 빌드 계산 밖" + (has("HEALSHIELD") ? " (지원 태그로 반영)" : "") };
  if (/Gold/i.test(name)) return { prio: "P1", status: S.assume, why: "골드: 즉시 받는 골드만 goldValue 로, 처치·시간마다 받는 골드는 횟수를 정할 수 없어 계산 안 함" };
  if (row.kind === "거리·범위" || /Size|Range|Radius|Distance/i.test(name))
    return { prio: "P2", status: S.skip, why: "크기·사거리·범위 — 한 대상 피해 계산과 무관 (사거리는 원거리 판정에만 쓴다)" };
  if (/Slow|Stun|KnockUp|Knockup|Fear|Poly|Root|Snare|Tenacity|SlowResist|Lockout/i.test(name))
    return { prio: "P2", status: has("CC") || has("MS") ? S.tag : S.skip, why: "군중 제어·둔화·강인함 — " + (has("CC") || has("MS") ? "CC·이동 태그와 제어력 지표로 반영" : "피해·생존 지표 밖") };
  if (/MS|Move|Speed/i.test(name) && !/AS/.test(name))
    return { prio: "P2", status: has("MS") ? S.tag : S.skip, why: "이동 속도 — " + (has("MS") ? "이동 태그·기동 지표로 반영" : "피해·생존 지표 밖, 잠깐 켜지는 이동 속도") };
  if (row.kind === "지속 시간" || /Duration|Delay|Time$/i.test(name))
    return { prio: "P1", status: numeric ? S.assume : S.skip, why: numeric ? "지속 시간 — 효과를 한타 1번(콤보 4초) 단위로 세서 지속 시간은 따로 쓰지 않음 (가동률 가정은 규칙 basis)" : "지속 시간 — 이 증강은 수치 계산 대상이 아님" };
  if (row.kind === "발동 주기" || /Cooldown|CD$/i.test(name)) {
    const sec = typeof row.source === "number" ? row.source : null;
    if (numeric && once && sec != null && sec >= 4) return { prio: "P1", status: S.skip, why: `재사용 대기시간 ${sec}초 — 한타 1번으로 세는 효과라 한타(4초)보다 길면 영향 없음` };
    return { prio: "P1", status: numeric ? S.game : S.skip, why: numeric ? "재사용 대기시간이 실제 발동에 걸리는지 설명·위키만으로 불분명" : "수치 계산 대상이 아닌 효과의 재사용 대기시간" };
  }
  if (/Threshold|Execute|Min.*Health|HealthPercent|Health_?Threshold/i.test(name))
    return { prio: "P1", status: S.assume, why: "체력 조건 — 조건이 맞을 때 한 번으로 셈 (조건이 맞는 비율은 실게임 기록으로)" };
  if (/Stack|Max(Count|Stacks)|PercentOfStacksLost|Devotion/i.test(name) || row.kind === "중첩")
    return { prio: "P1", status: S.assume, why: "중첩 — 평균 중첩은 규칙 basis 가정, 최대·잃는 비율은 따로 계산 안 함" };
  if (/Chance/i.test(name)) return { prio: "P1", status: S.assume, why: "확률 — 기대값으로 근사" };
  if (/Haste|AbilityHaste|CDR|Refund/i.test(name))
    return { prio: "P0", status: has("HASTE") ? S.tag : S.game, why: "스킬 가속·쿨 반환 — " + (has("HASTE") ? "가속 태그로 반영 (수치 조건이 있어 직접 계산 안 함)" : "조건을 정할 수 없어 실게임 확인") };
  if (/Heal|Shield|Vamp|Omni|Lifesteal/i.test(name))
    return { prio: "P0", status: has("HEALSHIELD") || has("VAMP") ? S.tag : S.game, why: "회복·보호막·흡혈 — " + (has("HEALSHIELD") || has("VAMP") ? "회복 태그로 반영, 발동 조건이 있어 수치는 실게임 기록으로" : "발동 조건을 정할 수 없어 실게임 확인") };
  if (/Damage|Amp|Ratio|Dmg|Mult|Mis|Bolt|Hit/i.test(name))
    return { prio: "P0", status: numeric ? S.game : S.tag, why: numeric ? "피해 관련 값 — 발동 조건(대상 수·거리·특정 스킬)이 있어 원본만으로 횟수를 정할 수 없음" : "피해 관련 값 — 숫자 계산 대상이 아닌 증강 (효과 태그로 반영)" };
  if (/AD|AP|AS|Armor|MR|Resist|ARMR|Adaptive/i.test(name))
    return { prio: "P0", status: has("AD") || has("AP") || has("AS") || has("ARMOR") || has("MR") || has("HP") ? S.tag : S.game, why: "능력치 — 조건부 능력치라 태그로 반영 (조건 비율은 실게임 기록으로)" };
  return { prio: "P2", status: numeric ? S.assume : S.tag, why: numeric ? "같은 증강의 다른 값으로 근사 (규칙 model/basis)" : "효과 태그로 점수에 반영 (숫자 계산 대상 아님)" };
}

function triage() {
  const audit = read("docs/증강_원본_대조.json");
  const d = read("web/data.json");
  const augs = Object.fromEntries(d.augments.map((a) => [a.id, a]));
  const rows = audit.rows.filter((r) => r.state === "미구현").map((r) => ({ ...r, ...classify(r, augs[r.id], d.rules.augments[r.id] || {}) }));
  return { version: audit.version, rows };
}

if (require.main === module) {
  const { version, rows } = triage();
  const count = (f) => rows.filter(f).length;
  const prios = ["P0", "P1", "P2"];
  const stats = Object.values(S);
  const lines = [`미구현 ${rows.length}개 (게임 데이터 ${version})`];
  for (const p of prios) lines.push(`  ${p}: ${count((r) => r.prio === p)} — ` + stats.map((s) => `${s} ${count((r) => r.prio === p && r.status === s)}`).join(" · "));
  console.log(lines.join("\n"));
  if (process.argv.includes("--write")) {
    const esc = (v) => String(v ?? "—").replace(/\|/g, "\\|");
    const L = ["# 미구현 효과 분류", "",
      `게임 데이터 \`${version}\` · 만든 도구: \`node tools/unimpl_triage.js --write\` (입력: \`docs/증강_원본_대조.json\`).`, "",
      "> 증강 원본 대조에서 '미구현'(툴팁 수치가 계산에 직접 안 쓰임)인 항목마다 우선순위와 처리 상태를 근거와 함께 적는다 (안정화 기획서 5장).",
      "> P0 = 직접 전투 수치 · P1 = 상황 조건 · P2 = 수치화가 어려운 효과. '실제 게임 확인 필요'는 원본만으로 발동 조건·횟수를 정할 수 없어 실게임 기록으로 맞출 항목이다.", "",
      "## 요약", "", "| 우선순위 | 항목 | " + stats.join(" | ") + " |", "|---|---:|" + stats.map(() => "---:").join("|") + "|"];
    for (const p of prios) L.push(`| ${p} | ${count((r) => r.prio === p)} | ` + stats.map((s) => count((r) => r.prio === p && r.status === s)).join(" | ") + " |");
    L.push("", "이번에 계산에 넣은 것 (v0.1.55, 미구현 179 → 164): 탄환 세례 5발·마법 미사일 3발·검무 8회(한타 1번)·쌍둥이 불꽃/치명적 미사일 치명타 비례 발 수(effectCount), " +
      "취약 아이템·지속 피해 치명타, 범람·프로틴 음료·마도사의 주스 상자 능력치 비례(게임 계산식 그대로), 정신 변환·장인의 솜씨·업그레이드 골드 이름 참조, 확고한 의지로 +20(가정).", "");
    L.push("### 원본 값이 없어 대조에 안 잡히는 확인 항목", "",
      "- 지옥불 난사 발동: 설명 '2초 동안 10회에 걸쳐' — 한 번만 센다. 스타일 S 등급을 채우는 시간을 몰라 10배로 넣으면 다시 부풀 수 있어 **실제 게임 확인 필요** (v0.1.54 에서 스킬마다 터지던 과대 계산을 5초로 막은 상태)",
      "- 치명적 미사일: 원본 Cooldown 4 — 설명·위키에 없어 넣지 않음, **실제 게임 확인 필요**", "");
    for (const p of prios) {
      L.push(`## ${p}`, "", "| 증강 | 원본 값 | 원본 | 상태 | 근거 |", "|---|---|---|---|---|");
      for (const r of rows.filter((x) => x.prio === p).sort((a, b) => stats.indexOf(a.status) - stats.indexOf(b.status) || a.name.localeCompare(b.name)))
        L.push(`| ${esc(r.name)} (${r.id}) | ${esc(r.ref)} | ${esc(typeof r.source === "number" ? +r.source.toFixed(4) : r.source)} | ${r.status} | ${esc(r.why)} |`);
      L.push("");
    }
    fs.writeFileSync(path.join(ROOT, "docs", "미구현_분류.md"), L.join("\n") + "\n");
  }
}
module.exports = { triage, classify };
