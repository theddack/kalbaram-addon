// 증강 ↔ 가중치 연결 점검 (v0.1.95 Phase 1): 증강 239개마다 '실제 효과 → 계산 경로 → 추천 가중치' 를 한 줄씩 적는다.
//   node tools/aug_weight_audit.js             요약 (분류별 개수)
//   node tools/aug_weight_audit.js --write     docs/증강_가중치_연결표.md 생성
//   node tools/aug_weight_audit.js --json      기계용 JSON (회귀 비교용)
// 경로: rules.augments.*.statsResolved / augments[].effects → scaleTags → augContext.lift → conceptWeights → metricWeights 칸 → offTypeFilter(flips)
// 입력: web/data.json, docs/증강_원본_대조.json (node tools/aug_audit.js --write), docs/미구현_분류.md (node tools/unimpl_triage.js --write)
// 목적 두 가지
//   (1) 서로 다른 효과가 같은 태그 → 같은 가중치 칸으로 뭉치는 사례를 전수로 찾는다 (B1)
//   (2) 수치 계산이 없는 증강을 '계산 가능하나 미구현 / 조건부 근사 필요 / 직접 계산 불필요 / 원본 부족' 으로 가른다
// 아이템·챔피언 이름으로 예외를 두지 않는다. 판정 기준은 전부 효과 키와 원본 값이다.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.Stats = require(path.join(ROOT, "web", "stats.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "증강_원본_대조.json"), "utf8"));
const R = d.rules.augments || {};
const ruleOf = (a) => R[a.id] || {};

// ── 태그 → 지표 가중치 칸 (web/scoring.js metricWeights 와 같은 계수) ──────────────
const BUCKET = {
  AP: [["combo", 1]], AD: [["combo", 1], ["dps", 0.3]], LETHAL: [["combo", 0.5]], MPEN: [["combo", 0.5]],
  HASTE: [["combo", 0.3]], AS: [["dps", 1]], CRIT: [["dps", 1]], ONHIT: [["dps", 0.5]],
  HP: [["ehp", 0.5]], ARMOR: [["ehp", 0.5]], MR: [["ehp", 0.5]], HEALSHIELD: [["support", 1]],
  MS: [["mobility", 0.4]], CC: [["control", 0.8]],
};
// CRITSKILL 은 아이템 태그가 아니다: metricWeights 에서 min(CRITSKILL, CRIT) 만큼의 치명타 몫을 dps 대신 combo 로 보낸다
const MOVE = { CRITSKILL: "CRIT 몫 min(CRITSKILL,CRIT) 을 dps→combo 로" };
const bucketOf = (t) => MOVE[t] || (BUCKET[t] || []).map(([k, v]) => `${k}×${v}`).join("+") || "-";

// ── 효과 성격 (CRIT 태그 안에 섞여 있던 서로 다른 효과 — 2026-11-24 B1 수정으로 스킬 쪽에는 CRITSKILL 이 같이 붙는다) ─
const ATTACK_TRIGGER = new Set(["onhit", "attacks", "onattack"]);  // = web/scoring.js ATTACK_TRIGGER
const KIND_KEYS = {
  "스킬 치명타": ["skillCritDmg", "effectCritDmg", "ultCritDmg"],  // = web/scoring.js SKILL_CRIT_KEYS (CRITSKILL 이 붙는 키)
  "평타 치명타": ["critStackAS", "onhitOnCrit", "AStoCRITDMG"],
  "치명타 확률": ["CRIT", "APtoCRIT"],  // APtoCRIT 은 주문력을 치명타 '확률' 로 — 터지는 자리는 평타라서 CRITSKILL 이 안 붙는다
  "적중 시 효과": ["onhitDmg", "onhitMult", "ONHIT"],
  "공격 속도": ["AS", "bonusAS", "ASmult", "itemADtoAS", "AStoHASTE"],
};
function effectKinds(a) {
  const rule = ruleOf(a);
  const st = rule.statsResolved || {};
  const keys = Object.keys(st);
  const kinds = new Set();
  for (const [kind, list] of Object.entries(KIND_KEYS)) if (keys.some((k) => list.includes(k))) kinds.add(kind);
  for (const e of a.effects || []) {
    const tr = (e.trigger || {}).type;
    if (tr === "onhit" || tr === "attacks") kinds.add("적중 시 효과");
    if (tr === "onattack") kinds.add("공격 속도");
    if (e.chance === "CRIT" || e.countCrit) kinds.add(ATTACK_TRIGGER.has(tr) ? "평타 치명타" : "스킬 치명타");
  }
  if (Object.keys(rule.convert || {}).length) kinds.add("피해 유형 전환");
  return [...kinds];
}

// ── 수치원 ────────────────────────────────────────────────────────────────────
function numSource(a) {
  const st = Object.keys(ruleOf(a).statsResolved || {});
  const eff = (a.effects || []).length;
  if (st.length && eff) return "규칙 수치 + 효과식";
  if (st.length) return "규칙 수치";
  if (eff) return "효과식";
  return "없음";
}

// ── 원본 대조 근거 ────────────────────────────────────────────────────────────
const rowsById = {}, hiddenById = {}, failById = {};
for (const r of audit.rows) (rowsById[r.id] = rowsById[r.id] || []).push(r);
for (const h of audit.hidden || []) (hiddenById[h.id] = hiddenById[h.id] || []).push(h);
for (const f of audit.fails || []) (failById[f.id] = failById[f.id] || []).push(f);

// 미구현 분류(docs/미구현_분류.md)의 처리 상태: "증강 (id) | 원본 값 | ... | 상태 | 근거"
const triage = {};
{
  const md = fs.readFileSync(path.join(ROOT, "docs", "미구현_분류.md"), "utf8");
  for (const line of md.split("\n")) {
    if (!/^\| /.test(line)) continue;
    const c = line.split("|").map((x) => x.trim());
    const m = /\(([^)]+)\)\s*$/.exec(c[1] || "");
    if (!m || !c[4]) continue;
    (triage[m[1]] = triage[m[1]] || []).push({ ref: c[2], status: c[4], why: c[5] || "" });
  }
}

// ── 수치 없는 증강 4분류 ───────────────────────────────────────────────────────
// A 계산 가능하나 미구현 : 원본에 조건 없는 전투 수치가 있는데 계산에 안 들어감
// B 조건부 근사 필요     : 원본 수치는 있으나 발동 조건·횟수·가동률을 원본만으로 정할 수 없음
// C 직접 계산 불필요     : 효과의 값이 다른 경로로 이미 계산에 들어가거나(아이템·증강 지급) 추천에 쓸 전투 수치가 아님(소환사 주문·골드)
// E 엔진 계산 범위 밖    : 수치가 있어도 지금 계산 모형(한 대상 · 한타 1번 · 자기 자신 기준)으로는 표현할 수 없음 — 모형을 넓혀야 들어간다
// D 원본 부족           : 원본에 피해·회복 값 자체가 없거나 계산식 부품을 못 읽음
// 2026-11-24 Phase 2: C 를 '불필요'와 '범위 밖'으로 갈랐다 (향후 개선 목록에서 둘을 섞지 않기 위해)
const CLS = { A: "계산 가능하나 미구현", B: "조건부 근사 필요", C: "직접 수치 계산 불필요", E: "엔진 계산 범위 밖", D: "원본 데이터 부족" };
const CLS_ORDER = ["A", "B", "C", "E", "D"];
// 자동 규칙으로 가르기 어려운 것만 사람이 판단한 이유를 적는다 (이름 예외가 아니라 효과 성격 판단)
const MANUAL = {
  ARAM_Quest_UrfsChampion: ["C", "퀘스트 보상이 아이템 지급 — 조건 값(QuestRequirement)은 전투 수치가 아님"],
  ARAM_Quest_WoogletsWitchcap: ["C", "퀘스트 보상이 아이템(우글렛의 마녀 모자) — 아이템 쪽 계산이 맡음"],
  ARAM_Quest_VoidImmolation: ["C", "퀘스트 보상이 아이템 합성 — 아이템 쪽 계산이 맡음"],
  Quest_UltraHydra: ["C", "퀘스트 보상이 아이템 합성 — 아이템 쪽 계산이 맡음"],
  ARAM_Quest_SteelYourHeart: ["C", "퀘스트 보상이 아이템 — 아이템 쪽 계산이 맡음"],
  ARAM_Upgrade_Sheen: ["C", "아이템 업그레이드 — 바뀐 아이템 능력치로 계산됨"],
  ARAM_Upgrade_ZH: ["E", "원본 값은 존야 재사용 대기시간 45초(UpgradeCD)와 경직 중 이동 속도 50%(UpgradeMS) — 계산이 한타 1번 기준이라 아이템 쿨 감소는 한 번의 값을 바꾸지 않는다 (최첨단 발명가와 같은 기준)"],
  ARAM_Upgrade_IE: ["B", "무한의 대검 업그레이드: 치명타 확률 → 피해 전환(CritChanceToDamage 0.5)의 적용 방식(100% 초과분인지)이 설명만으로 불분명"],
  SpellVolley: ["E", "추가 대상 2명 — 계산이 한 대상 기준이라 단일 대상 피해가 늘지 않음"],
  Missile_Split: ["E", "투사체 분산 — 위와 같이 한 대상 기준 계산 밖"],
  ARAM_EtherealWeapon: ["D", "스킬이 적중 시 효과를 발동 — 원본에 재사용 대기시간 1.5초만 있고 적용 비율이 없음"],
  ARAM_InfernalSoul: ["D", "추가 피해 값이 원본에 없음 (게임 중 집계 표기)"],
  ARAM_MountainSoul: ["D", "보호막 값이 원본에 없음"],
  ARAM_OceanSoul: ["D", "체력·마나 재생 값이 원본에 없음"],
  PressureCooker: ["D", "최대 체력 비례 화상 피해 계수가 원본에 없음 (사거리·흡혈만 있음)"],
  YouSpinMeRightRound: ["C", "소환사 주문 교체 — 소환사 주문은 계산하지 않음"],
  Poltergeist: ["C", "소환사 주문 교체"],
  ARAM_Quickstep: ["C", "소환사 주문 돌진 — 이동 효과"],
  Overextender: ["C", "대포 발사기(이동 수단) 효과 — 전투 계산 밖"],
  Snowbomb: ["C", "눈덩이(소환사 주문) 효과 — 소환사 주문은 계산하지 않음"],
  ARAM_Snowday: ["C", "눈덩이 가속 — 소환사 주문은 계산하지 않음"],
  ARAM_Flashy: ["C", "점멸 관련 효과 — 소환사 주문"],
  Flash2: ["C", "점멸 2개 — 소환사 주문"],
  KingMe: ["C", "증강·아이템 지급"],
  ARAM_TransmutePrismatic: ["C", "증강 지급"],
  ARAM_TransmuteChaos: ["C", "증강 지급"],
  ARAM_TransmuteGold: ["C", "증강 지급"],
  ARAM_PandorasBox: ["C", "증강 전환"],
  ARAM_OmniSoul: ["C", "다른 증강(영혼)을 지급 — 지급된 쪽이 계산 대상"],
  ARAM_Minionmancer: ["E", "미니언 강화 — 챔피언 대상 계산 밖"],
  ARAM_ApexInventor: ["E", "아이템 가속(ItemHaste) — 아이템 사용 효과는 계산하지 않음"],
  ARAM_ScopedWeapons: ["E", "사거리 증가 — 지표에 사거리가 없음 (태그로 반영)"],
  ARAM_ScopierWeapons: ["E", "사거리 증가 — 위와 같음"],
  ARAM_ScopiestWeapons: ["E", "사거리 증가 — 위와 같음"],
  Ability_SelfAOE_DoubleCast: ["E", "자신 중심 범위 스킬 2회 시전 — 어느 스킬인지 챔피언 데이터에 없음"],
  ARAM_SpecializedRecursion: ["B", "보상 값은 원본에 있음(AbilityHasteReward 80, 최대 160) — 퀘스트 달성 단계를 원본에서 정할 수 없어 가정 필요"],
  SpecializedEmpowerment: ["B", "보상 값은 원본에 있음(DamageAmpReward 30) — 퀘스트 달성 단계 가정 필요"],
  ARAM_BangBang: ["D", "유성 피해 값이 원본에 없음 (사거리 600·범위 225·배율만 있음)"],
  ARAM_Multishot: ["E", "퀘스트 보상이 추가 투사체(추가 대상) — 3연발과 같이 한 대상 기준 계산 밖 (퀘스트 조건 횟수는 원본에 없음)"],
  ARAM_Typhoon: ["E", "다른 대상에게 쏘는 투사체 — 한 대상 기준 계산 밖"],
  ARAM_WindspeakersBlessing: ["E", "회복·보호막을 준 아군의 방어력·마법 저항력 — 아군 효과 (지원 태그)"],
  PromQueen: ["E", "궁극기 재사용 대기시간 관련 보조 효과 — 규칙이 lift 로만 처리"],
  ARAM_StackosaurusRex: ["B", "스킬 중첩 2배(StackModifier 100%) — 챔피언마다 중첩 스킬이 달라 평균 중첩 가정이 필요"],
  LittleExtraHelp: ["B", "공격 속도 +75%(ExtraAttackSpeed) 값은 있으나 지속 시간·발동 주기가 원본에 없어 가동률 가정이 필요"],
  Sonata: ["B", "10초마다 자동 시전(Cooldown 10)은 있으나 회복·보호막 값이 원본에 없어 아군 수·효과량 가정이 필요"],
  Sound_Barrier: ["C", "소환사 주문 교체 (음속 장벽)"],
  GroupHug: ["E", "아군 이동 관련 효과"],
  RISE: ["E", "아군 전체 효과 — 아군 쪽 계산"],
  Bonk: ["B", "추가 피해 30%(DamageMultiplier)는 효과로 강화된 공격에만 — 강화 공격 비율 가정이 필요"],
  MercysStrike: ["B", "최대 체력 2.5% + 회복·보호막 효과 비례 피해(계산식 있음) — 아군 회복·보호막 시전 뒤에만 발동해 발동 비율 가정이 필요"],
  ARAM_SpiritBomb: ["B", "회복·보호막 계산식이 조건부 — 가동률 가정이 필요"],
  ARAM_Hellbent: ["B", "부활·적응형·흡혈이 조건부 — 발동 조건 가정이 필요"],
  ARAM_SymphonyofWar: ["B", "룬 수치는 원본에 다 있음(ASCap 10, StackCap 6, 적응형 3~5.5, 회복 10%) — 중첩이 쌓이는 비율 가정이 필요"],
};
function classifyNoNum(a) {
  if (MANUAL[a.id]) return { cls: MANUAL[a.id][0], why: MANUAL[a.id][1], by: "사람 판단" };
  const rows = rowsById[a.id] || [];
  const states = new Set(rows.map((r) => r.state));
  if ((failById[a.id] || []).length || states.has("원본 확인 불가")) return { cls: "D", why: "원본에서 값·계산식 부품을 읽지 못함", by: "원본 대조" };
  if (rows.length && [...states].every((s) => s === "계산 제외")) return { cls: "C", why: (rows[0].why || "규칙상 계산 제외"), by: "원본 대조" };
  const tr = triage[a.id] || [];
  if (tr.some((t) => t.status === "실제 게임 확인 필요")) return { cls: "B", why: (tr.find((t) => t.status === "실제 게임 확인 필요").why || ""), by: "미구현 분류" };
  if (tr.some((t) => t.status === "가정값으로 처리")) return { cls: "B", why: (tr.find((t) => t.status === "가정값으로 처리").why || ""), by: "미구현 분류" };
  if (tr.some((t) => t.status === "의도적 계산 제외")) return { cls: "C", why: (tr.find((t) => t.status === "의도적 계산 제외").why || ""), by: "미구현 분류" };
  if (tr.some((t) => t.status === "태그 기반 간접 반영")) {
    const t = tr.find((x) => x.status === "태그 기반 간접 반영");
    return { cls: /조건|발동|실게임/.test(t.why) ? "B" : "A", why: t.why, by: "미구현 분류" };
  }
  if (rows.some((r) => r.state === "미구현")) return { cls: "A", why: "원본에 수치가 있는데 계산에 들어가지 않음", by: "원본 대조" };
  if (!rows.length && !(hiddenById[a.id] || []).length) return { cls: "D", why: "원본에 값이 없음", by: "원본 대조" };
  return { cls: "C", why: "전투 수치로 볼 값이 없음", by: "자동" };
}

// ── 챔피언 대표 (유형별 lift 영향 확인용) ─────────────────────────────────────
const repr = [
  ["마법", d.champions.find((c) => c.damageType === "magic" && c.id === "Ahri") || d.champions.find((c) => c.damageType === "magic")],
  ["물리", d.champions.find((c) => c.id === "Jinx") || d.champions.find((c) => c.damageType === "physical")],
  ["혼합", d.champions.find((c) => c.damageType !== "magic" && c.damageType !== "physical")],
].filter(([, c]) => c);
S.attachSimilar(d.champions, null, d.items);

const AUG = S.CONCEPTS.find((c) => c.key === "augment");
function mwFor(champ, chosen) {
  const w = S.profile(champ, d.tags);
  const ctx = S.augContext(chosen, d.rules, champ);
  return { mw: S.metricWeights(S.conceptWeights(w, ctx, AUG)), ctx };
}
const baseMw = new Map(repr.map(([k, c]) => [k, mwFor(c, []).mw]));

// ── flips (반대 유형 차단 전체 해제) ──────────────────────────────────────────
const OFF = { magic: { off: ["AD", "CRIT", "LETHAL"], own: ["AP", "MPEN"] }, physical: { off: ["AP", "MPEN"], own: ["AD", "CRIT", "LETHAL"] } };
function flipsFor(dt, ctx) {
  const rule = OFF[dt], lift = ctx.lift || {}, conv = ctx.convert || {};
  const liftOf = (keys) => Math.max(0, ...keys.map((t) => lift[t] || 0));
  const converts = Object.keys(conv).some((t) => rule.off.includes(conv[t]) || rule.off.includes(t));
  // 2026-11-24 B2 수정 반영: 반대 유형 능력치가 그 증강의 피해 계산에 실제로 쓰일 때만 연다 (augContext 의 _dmg 를 그대로 본다)
  const dmgLift = (t) => Object.values(ctx.liftBy || {}).some((l) => (l[t] || 0) >= 0.5 && l._dmg && l._dmg.has(t));
  const opened = rule.off.filter((t) => (lift[t] || 0) >= 0.5 && dmgLift(t));
  const flips = converts || (opened.length > 0 && liftOf(rule.off) > liftOf(rule.own));
  return { flips, converts, opened, offLift: liftOf(rule.off), ownLift: liftOf(rule.own) };
}

// ── 전수 계산 ─────────────────────────────────────────────────────────────────
const rows = [];
for (const a of d.augments) {
  const rule = ruleOf(a);
  const st = rule.statsResolved || {};
  const scales = S.scaleTags ? null : null; // scaleTags 는 비공개 — lift 로 확인한다
  const perChamp = {};
  for (const [k, c] of repr) {
    const { mw, ctx } = mwFor(c, [a]);
    const b = baseMw.get(k);
    const delta = Object.fromEntries(Object.keys(mw).map((m) => [m, Math.round((mw[m] - b[m]) * 1000) / 1000]));
    perChamp[k] = { lift: ctx.lift, mw: Object.fromEntries(Object.entries(mw).map(([m, v]) => [m, Math.round(v * 1000) / 1000])), delta,
      flips: OFF[c.damageType] ? flipsFor(c.damageType, ctx) : null };
  }
  const liftTags = Object.keys(perChamp[repr[0][0]].lift);
  const kinds = effectKinds(a);
  const src = numSource(a);
  const row = {
    id: a.id, name: a.name, rarity: a.rarityName, src, keys: Object.keys(st), effects: (a.effects || []).map((e) => e.kind + (e.trigger ? "/" + (e.trigger.type || "") : "")),
    kinds, lift: perChamp[repr[0][0]].lift, buckets: liftTags.map((t) => `${t}→${bucketOf(t)}`), perChamp,
  };
  if (src === "없음") row.cls = classifyNoNum(a);
  rows.push(row);
}

// ── 요약 ──────────────────────────────────────────────────────────────────────
const noNum = rows.filter((r) => r.src === "없음");
const clsCount = {};
for (const r of noNum) clsCount[r.cls.cls] = (clsCount[r.cls.cls] || 0) + 1;
const critRows = rows.filter((r) => (r.lift.CRIT || 0) >= 0.5);
const flipRows = {};
for (const dt of ["magic", "physical"]) {
  const key = dt === "magic" ? "마법" : "물리";
  flipRows[dt] = rows.filter((r) => r.perChamp[key] && r.perChamp[key].flips && r.perChamp[key].flips.flips);
}

// ── 전체 챔피언 × 증강 전수 (실행 건수와 제외 조건을 남긴다) ──────────────────
function census() {
  const total = d.champions.length * d.augments.length;
  let pairs = 0, flip = 0, skipType = 0, skipReq = 0;
  const byAug = {}, byChamp = {};
  for (const c of d.champions) {
    const rule = OFF[c.damageType];
    for (const a of d.augments) {
      if (!rule) { skipType++; continue; }  // 혼합형 챔피언: OFF_TYPE 규칙 자체가 없어 차단이 안 걸린다
      const ctx = S.augContext([a], d.rules, c);
      const ar = ruleOf(a);
      const unmet = a.eligible ? !a.eligible.includes(c.id) : ar.requires && !(c.features || []).includes(ar.requires);
      if (unmet) skipReq++;  // 조건을 못 맞추는 증강: augContext 가 효과를 빼므로 lift 도 없다
      pairs++;
      const f = flipsFor(c.damageType, ctx);
      if (f.flips) { flip++; byAug[a.name] = (byAug[a.name] || 0) + 1; byChamp[c.id] = (byChamp[c.id] || 0) + 1; }
    }
  }
  const dtCount = {};
  for (const c of d.champions) dtCount[c.damageType] = (dtCount[c.damageType] || 0) + 1;
  return { champions: d.champions.length, augments: d.augments.length, total, pairs, skipType, skipReq, flip, byAug, dtCount,
    flipAugs: Object.keys(byAug).length };
}
const CEN = census();

function summary() {
  const L = [];
  L.push(`증강 ${rows.length}개 · 게임 데이터 ${audit.dataVersion}`);
  const bySrc = {};
  for (const r of rows) bySrc[r.src] = (bySrc[r.src] || 0) + 1;
  L.push("수치원: " + Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(" / "));
  L.push("수치 없는 증강 분류: " + Object.entries(clsCount).map(([k, v]) => `${CLS[k]} ${v}`).join(" / "));
  L.push(`lift.CRIT ≥ 0.5: ${critRows.length}개 (성격: ` + critRows.map((r) => r.name + "=" + (r.kinds.join("+") || "태그만")).join(", ") + ")");
  L.push(`flips(반대 유형 전체 해제): 대표 챔피언 기준 마법 ${flipRows.magic.length} · 물리 ${flipRows.physical.length}`);
  L.push(`전수(챔피언 ${CEN.champions} × 증강 ${CEN.augments} = ${CEN.total}쌍): 계산 ${CEN.pairs} / 혼합형 제외 ${CEN.skipType} / 조건 미충족 ${CEN.skipReq} → flips ${CEN.flip}쌍 · 증강 ${CEN.flipAugs}종`);
  return L.join("\n");
}

function markdown() {
  const L = [];
  L.push("# 증강 ↔ 가중치 연결표", "");
  L.push(`게임 데이터 \`${audit.dataVersion}\` · 만든 도구: \`node tools/aug_weight_audit.js --write\` · 증강 ${rows.length}개 전수`, "");
  L.push("> 증강의 실제 효과가 어떤 계산 경로를 거쳐 추천 가중치의 어느 칸으로 들어가는지 한 줄씩 적는다.", "");
  L.push("경로: `rules.augments.*.statsResolved` / `augments[].effects` → `scaleTags` → `augContext.lift` → `conceptWeights` → `metricWeights` 칸 → `offTypeFilter`", "");
  L.push("`CRITSKILL` 은 아이템 태그가 아니라 표식이다: 치명타가 어느 자리(평타/스킬)에서 터지는지를 `metricWeights` 에만 알려 준다 (`scaleTags` → `conceptWeights` → `metricWeights`).", "");

  L.push("## 1. 수치원", "");
  const bySrc = {};
  for (const r of rows) bySrc[r.src] = (bySrc[r.src] || 0) + 1;
  L.push("| 수치원 | 증강 수 | 뜻 |", "|---|---:|---|");
  const srcWhy = { "규칙 수치": "`statsResolved` 로 능력치·배수를 직접 계산", "효과식": "`effects` 의 계수식(기본값+비례)으로 피해·회복을 계산",
    "규칙 수치 + 효과식": "둘 다", "없음": "수치 계산이 전혀 없음 — 효과 종류(태그)로만 평가" };
  for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} | ${srcWhy[k] || ""} |`);
  L.push("");

  L.push("## 2. 같은 태그로 뭉친 서로 다른 효과", "");
  L.push("| 효과 성격 | 증강 수 | 지금 붙는 태그 | 그 태그가 가는 지표 칸 |", "|---|---:|---|---|");
  const kindTag = {
    "스킬 치명타": ["CRIT + CRITSKILL", "그 몫은 combo×1 (평타 칸으로 안 감)"],
    "평타 치명타": ["CRIT", "dps×1"],
    "치명타 확률": ["CRIT", "dps×1"],
    "적중 시 효과": ["ONHIT", "dps×0.5"],
    "공격 속도": ["AS", "dps×1"],
    "피해 유형 전환": ["convert", "태그 자체를 바꿈"],
  };
  for (const kind of [...Object.keys(KIND_KEYS), "피해 유형 전환"]) {
    const list = rows.filter((r) => r.kinds.includes(kind));
    const [t, b] = kindTag[kind];
    L.push(`| ${kind} | ${list.length} | ${t} | ${b} |`);
  }
  L.push("");
  L.push("### 2.1 `lift.CRIT ≥ 0.5` 증강 — 효과 성격별로 가는 칸 (2026-11-24 B1 수정 반영)", "");
  L.push("> 치명타가 스킬·아이템 효과에 붙는 증강은 `CRITSKILL` 이 같이 붙어, 그 몫만큼 `dps` 대신 `combo` 로 간다. 챔피언 본래 치명타 성향은 그대로 `dps` 에 남는다.", "");
  L.push("| 증강 | lift.CRIT | lift.CRITSKILL | 효과 키 | 효과 성격 | 가는 칸 |", "|---|---:|---:|---|---|---|");
  for (const r of critRows) {
    const cs = r.lift.CRITSKILL || 0;
    const dest = cs ? `combo (치명타 몫 중 ${Math.min(cs, r.lift.CRIT)}) + dps (나머지)` : "dps";
    L.push(`| ${r.name} | ${r.lift.CRIT} | ${cs || "-"} | ${r.keys.filter((k) => /CRIT|crit/i.test(k)).join(", ") || "-"} | ${r.kinds.join(" + ") || "수치 없음 (태그만)"} | ${dest} |`);
  }
  L.push("");

  L.push("## 3. 반대 유형 차단 전체 해제(`flips`)", "");
  L.push("| 기준 챔피언 | flips 증강 수 | 그중 `convert` 가 있는 것 |", "|---|---:|---:|");
  for (const dt of ["magic", "physical"]) {
    const list = flipRows[dt];
    L.push(`| ${dt === "magic" ? "마법" : "물리"} | ${list.length} | ${list.filter((r) => r.perChamp[dt === "magic" ? "마법" : "물리"].flips.converts).length} |`);
  }
  L.push("");
  for (const dt of ["magic", "physical"]) {
    const key = dt === "magic" ? "마법" : "물리";
    L.push(`### 3.${dt === "magic" ? 1 : 2} ${key} 챔피언 기준 ${flipRows[dt].length}개`, "");
    L.push("| 증강 | 반대 유형 lift | 내 유형 lift | convert | 해제 근거가 된 태그 |", "|---|---:|---:|---|---|");
    for (const r of flipRows[dt]) {
      const f = r.perChamp[key].flips;
      const off = OFF[dt].off.filter((t) => (r.perChamp[key].lift[t] || 0) >= 0.5);
      L.push(`| ${r.name} | ${f.offLift} | ${f.ownLift} | ${f.converts ? "있음" : "없음"} | ${off.join(", ") || "-"} |`);
    }
    L.push("");
  }

  L.push("### 3.3 전체 챔피언 × 증강 전수", "");
  L.push("| 항목 | 건수 | 설명 |", "|---|---:|---|");
  L.push(`| 전체 조합 | ${CEN.total} | 챔피언 ${CEN.champions} × 증강 ${CEN.augments} |`);
  L.push(`| 실제 계산 | ${CEN.pairs} | 아래 제외를 뺀 수 |`);
  L.push(`| 제외: 혼합형 챔피언 | ${CEN.skipType} | \`OFF_TYPE\` 규칙이 없어 유형 차단 자체가 안 걸림 (혼합 ${CEN.dtCount.mixed || 0}명 × 증강 ${CEN.augments}) |`);
  L.push(`| (계산에 포함) 조건 미충족 | ${CEN.skipReq} | \`eligible\`·\`requires\` 를 못 맞춰 lift 가 비는 조합 — 제외하지 않고 '해제 안 됨' 으로 셈 |`);
  L.push(`| flips 가 켜지는 조합 | ${CEN.flip} | 전체 계산의 ${(CEN.flip / CEN.pairs * 100).toFixed(1)}% |`);
  L.push(`| flips 를 켜는 증강 종류 | ${CEN.flipAugs} | 한 챔피언에게라도 켜지는 증강 |`);
  L.push("");
  L.push("| 증강 | flips 가 켜지는 챔피언 수 |", "|---|---:|");
  for (const [n, v] of Object.entries(CEN.byAug).sort((a, b) => b[1] - a[1])) L.push(`| ${n} | ${v} |`);
  L.push("");

  L.push("## 4. 수치 계산이 없는 증강 분류", "");
  L.push(`전체 ${noNum.length}개. 분류 기준은 원본 값(\`docs/증강_원본_대조.json\`)과 미구현 분류(\`docs/미구현_분류.md\`)다.`, "");
  L.push("| 분류 | 증강 수 | 뜻 |", "|---|---:|---|");
  const clsWhy = { A: "원본에 조건 없는 전투 수치가 있는데 계산에 안 들어감 — 바로 넣을 수 있음",
    B: "원본 수치는 있으나 발동 조건·횟수·가동률을 원본만으로 정할 수 없음 — 가정값 승인이 필요",
    C: "효과의 값이 다른 경로로 이미 계산에 들어가거나(아이템·증강 지급·업그레이드) 추천에 쓸 전투 수치가 아님(소환사 주문·골드·이동 수단)",
    E: "수치가 있어도 지금 계산 모형(한 대상 · 한타 1번 · 자기 자신 기준)으로는 표현할 수 없음 — 추가 대상·아군 효과·사거리·아이템 사용 효과",
    D: "원본에 피해·회복 값 자체가 없거나 계산식 부품을 읽지 못함" };
  for (const k of CLS_ORDER) L.push(`| ${CLS[k]} | ${clsCount[k] || 0} | ${clsWhy[k]} |`);
  L.push("");
  for (const k of CLS_ORDER) {
    const list = noNum.filter((r) => r.cls.cls === k);
    L.push(`### 4.${CLS_ORDER.indexOf(k) + 1} ${CLS[k]} — ${list.length}개`, "");
    if (!list.length) { L.push("해당 없음. 수치가 없는 증강은 전부 조건·계산 범위·원본 부족 중 하나에 걸린다 — 조건 없이 바로 넣을 수 있는 수치는 하나도 없었다.", ""); continue; }
    L.push("| 증강 | 태그 | 근거 | 판단 출처 |", "|---|---|---|---|");
    for (const r of list) L.push(`| ${r.name} | ${Object.keys(r.lift).join(", ") || "-"} | ${(r.cls.why || "").replace(/\|/g, "/")} | ${r.cls.by} |`);
    L.push("");
  }

  L.push("## 5. 전체 연결표", "");
  L.push("| 증강 | 수치원 | 효과 키 / 효과식 | lift | 가는 지표 칸 | 마법 flips | 물리 flips |", "|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const keys = (r.keys.length ? r.keys.join(", ") : r.effects.join(", ")) || "-";
    L.push(`| ${r.name} | ${r.src} | ${keys} | ${Object.entries(r.lift).map(([t, v]) => `${t} ${v}`).join(", ") || "-"} | ${r.buckets.join(", ") || "-"} | ${r.perChamp["마법"] && r.perChamp["마법"].flips.flips ? "○" : ""} | ${r.perChamp["물리"] && r.perChamp["물리"].flips.flips ? "○" : ""} |`);
  }
  L.push("");
  return L.join("\n");
}

const arg = process.argv.slice(2);
if (arg.includes("--json")) {
  console.log(JSON.stringify({ dataVersion: audit.dataVersion, rows, clsCount }, null, 1));
} else if (arg.includes("--write")) {
  const out = path.join(ROOT, "docs", "증강_가중치_연결표.md");
  fs.writeFileSync(out, markdown());
  console.log(summary());
  console.log("\n썼다: docs/증강_가중치_연결표.md");
} else {
  console.log(summary());
}
