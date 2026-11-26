// v0.1.92 아이템 고유 효과 계산 보완: 아이템 검증표(docs/아이템_검증표.md)에서 '계산되지 않음'이던 고유 효과를
// 설명 수치대로 계산하는지. 각 테스트는 같은 아이템에서 고유 효과(passiveStats)만 뺀 것과 비교한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const St = global.Stats;
const d = require(path.join(WEB, "data.json"));
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (name) => d.items.find((i) => i.name === name);
const bare = (it) => ({ ...it, passiveStats: undefined });
const ev = (c, items) => St.evaluate(c, 18, items, [], {});
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("그림자불꽃 '잿덩이꽃': 체력 40% 아래 대상 마법·고정 피해 +20%, 비율은 기준 상대 현재 체력 가정에서", () => {
  const it = item("그림자불꽃"), c = champ("Lux");
  assert.ok(it.passiveStats, "규칙이 붙어야 해요");
  // 기본: 상대 체력 평균 70% = 100% → 40% 로 고르게 → 40% 아래 피해 0
  near(ev(c, [it]).m.combo / ev(c, [bare(it)]).m.combo, 1, 1e-9, "기본 가정에선 발동 없음");
  const cur = St.TARGET.CUR;
  St.TARGET.CUR = 0.5;  // 100% → 0% (처치까지): 피해의 40%가 조건 아래 → 마법·고정 +8%
  try {
    const a = ev(c, [it]).m, b = ev(c, [bare(it)]).m;
    near(a.combo / b.combo, 1.08, 0.005, "럭스 콤보(마법)");
    near(a.autoDps, b.autoDps, 1e-9, "기본 공격(물리)은 그대로");
  } finally { St.TARGET.CUR = cur; }
});

test("'대상 체력 X% 아래' 조건 비율은 공통 함수 하나로, 기준 상대 현재 체력 가정에서만 끌어낸다 (따로 정한 발동률 없음)", () => {
  near(St.targetBelowShare(0.4), 0, 1e-12, "평균 70% → 100%~40%: 40% 아래 0");
  near(St.targetBelowShare(0.5), 1 / 6, 1e-12, "50% 아래는 (0.5 − 0.4) / 0.6");
  near(St.targetBelowShare(1), 1, 1e-12, "100% 아래는 전부");
  const cur = St.TARGET.CUR;
  St.TARGET.CUR = 0.5;
  try { near(St.targetBelowShare(0.4), 0.4, 1e-12, "평균 50% → 처치까지: 40%"); } finally { St.TARGET.CUR = cur; }
});

test("도미닉 경의 인사 '거인 학살자': 기준 상대 추가 체력만큼 피해 증가 (1500에서 최대 15%)", () => {
  const it = item("도미닉 경의 인사"), c = champ("Jinx");
  assert.ok(it.passiveStats, "규칙이 붙어야 해요");
  const want = 1 + 0.15 * Math.min(1, St.DEFAULT_TARGET.BONUS_HP / 1500);
  const a = ev(c, [it]).m, b = ev(c, [bare(it)]).m;
  near(a.autoDps / b.autoDps, want, 1e-6, "징크스 평타");
  St.setTarget({ ARMOR: 113, MR: 63, HP: 4500, bonusHP: 2000 });
  try { near(ev(c, [it]).m.autoDps / ev(c, [bare(it)]).m.autoDps, 1.15, 1e-6, "추가 체력 2000 상대는 최대"); } finally { St.setTarget(); }
});

test("리안드리의 고통 '고난': 전투 중 매초 2% (최대 6%) → 콤보 4초 평균 4.5%", () => {
  const it = item("리안드리의 고통"), c = champ("Annie");
  const a = ev(c, [it]).m, b = ev(c, [bare(it)]).m;
  near(a.combo / b.combo, 1.045, 0.002, "애니 콤보");
});

test("지배자의 피갑옷 '폭정': 추가 체력의 2.5% 공격력", () => {
  const it = item("지배자의 피갑옷"), c = champ("Darius");
  const a = St.computeStats(c, 18, [it], []).total, b = St.computeStats(c, 18, [bare(it)], []).total;
  near(a.AD - b.AD, b.bonusHP * 0.025, 0.01, "공격력 증가");
  near(a.bonusAD - b.bonusAD, a.AD - b.AD, 1e-9, "추가 공격력으로");
});

test("핏빛 저주 '썩은 부식': 마법 저항력 7.5% 감소 중첩을 콤보 평균(1.5중첩)으로", () => {
  const it = item("핏빛 저주"), c = champ("Annie");
  assert.ok(it.passiveStats, "규칙이 붙어야 해요");
  assert.ok(ev(c, [it]).m.combo > ev(c, [bare(it)]).m.combo, "마법 피해가 늘어요");
});

test("새벽심장 '태초의 빛': 기본 마나 재생 100%당 주문력 15·회복/보호막 2%", () => {
  const it = item("새벽심장"), c = champ("Soraka");
  const a = St.computeStats(c, 18, [it], []).total, b = St.computeStats(c, 18, [bare(it)], []).total;
  near(a.AP - b.AP, 15 * it.stats.MP5P, 0.01, "주문력");
  near(a.HSP - b.HSP, 0.02 * it.stats.MP5P, 1e-9, "회복·보호막");
});

test("정령의 형상 '무한한 활력': 자신이 받는 회복·보호막 25% → 자기 회복이 있으면 버티는 힘 증가", () => {
  const it = item("정령의 형상"), c = champ("Garen");
  const sterak = item("스테락의 도전");
  const a = ev(c, [it, sterak]).m, b = ev(c, [bare(it), sterak]).m;
  assert.ok(a.ehp > b.ehp, `${a.ehp} > ${b.ehp}`);
});

test("영겁의 지팡이 '불멸의 시간': 최대 중첩(체력 100·마나 300·주문력 30)은 추천 점수에만", () => {
  const it = item("영겁의 지팡이"), c = champ("Ryze");
  const a = St.computeStats(c, 18, [it], []).total, b = St.computeStats(c, 18, [bare(it)], []).total;
  assert.ok(a.AP > b.AP + 29 && a.HP > b.HP + 99, `AP ${a.AP - b.AP} HP ${a.HP - b.HP}`);
});

test("구원 '중재': 아군 회복과 함께 적 챔피언에게 최대 체력 10% 고정 피해 (한타 1번)", () => {
  const it = item("구원"), c = champ("Renata");
  const a = ev(c, [it]).m, b = ev(c, [bare(it)]).m;
  near(a.combo - b.combo, 0.1 * St.DEFAULT_TARGET.HP, 1, "콤보 고정 피해");
  assert.ok(a.support > b.support, "아군 회복은 그대로 지원으로");
});

// v0.1.92 서포터 평가: 체력 단위로 셀 수 있는데 계산에 빠져 있던 아군 지원 기술 (rules.json champions fight)
test("서포터 기술: 룰루 R 아군 최대 체력, 타릭 R 아군 무적, 유미 W 회복·보호막 증가가 지원(support)에 들어간다", () => {
  const sup = (id, l = []) => St.evaluate(champ(id), 18, l, [], {}).m;
  const lulu = sup("Lulu"), luluAp = sup("Lulu", [item("라바돈의 죽음모자")]);
  assert.ok(champ("Lulu").fightStats, "룰루 규칙");
  const row = lulu.effects.find((e) => e.src === "R 급속 성장");
  assert.ok(row && row.value >= 575, `룰루 R ${row && row.value}`);
  assert.ok(luluAp.kitShield - lulu.kitShield > 0, "주문력 비례");
  const taric = sup("Taric").effects.find((e) => e.src === "R 우주의 광휘");
  assert.ok(taric && Math.abs(taric.value - 2.5 * St.DEFAULT_TARGET.DPS_TAKEN / 2) < 1, `타릭 R ${taric && taric.value}`);
  const y = St.computeStats(champ("Yuumi"), 18, [], []).total.HSP;
  assert.ok(Math.abs(y - 0.08) < 1e-9, `유미 회복·보호막 ${y}`);
});

// v0.1.92 회귀 확인: '체력 X% 아래 대상에게 치명타' 버전 효과가 일반 효과와 따로 전부 더해지던 중복 (지옥불 난사 발동)
test("치명타 버전 효과(체력 조건)는 일반 효과를 대신한다: 조건 아래 몫만큼만 (치명타 − 일반) 차이를 더한다", () => {
  const a = d.augments.find((x) => x.name === "지옥불 난사 발동"), c = champ("Jinx");
  const S = require(path.join(WEB, "scoring.js"));
  const crit = (a.effects || []).find((e) => /crit/i.test(e.name));
  assert.ok(crit && crit.critBelow === 0.3, `치명타 체력 기준 ${crit && crit.critBelow}`);
  const rows = (cur) => {
    const keep = St.TARGET.CUR; St.TARGET.CUR = cur;
    try { return St.evaluate(c, 18, [], S.augStatsOf([a], d.rules, c), {}).m.effects.filter((e) => e.src === a.name); } finally { St.TARGET.CUR = keep; }
  };
  const base = rows(0.7);
  const normal = base.find((e) => e.value > 0 && !e.critAlt), alt = base.find((e) => e.critAlt);
  assert.ok(normal && alt, "일반·치명타 두 줄");
  near(alt.value, 0, 1e-9, "기본 가정(100% → 40%)에선 30% 아래가 없어 치명타 몫 0");
  const r = rows(0.5), n2 = r.find((e) => !e.critAlt), a2 = r.find((e) => e.critAlt);
  near(a2.value, 0.3 * (alt.full - n2.value), 1e-6, "처치까지 가면 피해의 30%만 치명타 차이");
});

test("세릴다의 원한 '매서운 추위': 대상 체력 50% 아래 조건을 그림자불꽃과 같은 공통 기준(targetBelowShare)으로", () => {
  const it = item("세릴다의 원한"), c = champ("Draven");
  assert.equal(it.passiveStats._belowAt, 0.5, "조건 체력 규칙");
  const ctl = () => St.computeStats(c, 18, [it], []).conv.controlPerCast || 0;
  near(ctl(), 0.3 * St.targetBelowShare(0.5), 1e-9, "라일라이 기준 0.3초 × 조건 아래 비율 (기본 1/6)");
  const cur = St.TARGET.CUR;
  St.TARGET.CUR = 0.5;
  try { near(ctl(), 0.3 * 0.5, 1e-9, "처치까지 가는 경로면 절반 (예전 고정값 0.15와 같은 경우)"); } finally { St.TARGET.CUR = cur; }
});

// v0.1.93 발견: 유미 E '슈우우웅'의 마나 회복(20~36)이 마법 피해로 콤보에 들어가 있었다
test("마나 회복 수치는 피해가 아니다 (유미 E manarestore)", () => {
  const e = champ("Yuumi").spells.find((s) => s.slot === "E").effects;
  assert.ok(!e.some((x) => /mana(restore|refund)/i.test(x.name) && ["magic", "physical", "true", "adaptive"].includes(x.kind)), JSON.stringify(e.map((x) => x.name)));
});

// v0.1.93 P1 아군 지원: 아군 강화 → 기준 아군(stats.js ALLY)이 지속시간 동안 더 넣는 피해 = 지원
test("아군 강화는 기준 아군이 더 넣는 피해로 지원에 들어간다 (룰루 W 공격 속도·잔나 E 공격력)", () => {
  const A = St.ALLY, m = (id, l = []) => St.evaluate(champ(id), 18, l, [], {}).m;
  const lulu = m("Lulu").effects.find((e) => e.src === "W 변덕쟁이");
  const as2 = A.AS + A.asRatio * 0.3;
  near(lulu.ally, A.autoDps * (as2 / A.AS - 1) * 4, 1e-6, "룰루 W: 공격 속도 30% 4초");
  const janna = m("Janna").effects.find((e) => e.src === "E 폭풍의 눈");
  near(janna.ally, A.autoDps * 30 / A.AD * 4, 1e-6, "잔나 E: 공격력 30 4초 (주문력 0)");
  const jAp = m("Janna", [item("라바돈의 죽음모자")]).effects.find((e) => e.src === "E 폭풍의 눈");
  assert.ok(jAp.ally > janna.ally, "주문력 10% 계수");
  assert.ok(m("Lulu").support - m("Lulu").shield - m("Lulu").heal >= lulu.ally - 1e-9, "지원 지표에 더해짐");
});

test("아군이 넣는 추가 피해(나미 E)는 서포터 자기 콤보에서 빠지고 기준 아군의 적중 3번으로 옮겨진다 (두 번 세지 않음)", () => {
  const c = champ("Nami"), e = c.spells.find((s) => s.slot === "E").effects.find((x) => x.name === "totaldamage");
  assert.deepEqual(e.ally, { hits: 3, sec: 6 });
  const m = St.evaluate(c, 18, [], [], {}).m, sp = m.spells.find((s) => s.slot === "E");
  near(sp.dmg, 0, 1e-9, "나미 E 자기 피해 0");
  near(sp.ally, 80 * 100 / (100 + St.TARGET.MR) * 3, 1e-6, "80 마법 피해 × 3번 (기준 상대 마법 저항력)");
});

test("아이템 아군 버프(불타는 향로)는 아군을 돕는 챔피언만, 기준 아군 몫이 지원에 들어간다", () => {
  const it = item("불타는 향로");
  const gain = (id) => St.evaluate(champ(id), 18, [it], [], {}).m.allyDmg - St.evaluate(champ(id), 18, [], [], {}).m.allyDmg;
  assert.ok(gain("Soraka") > 0, "소라카 (아군 지원)");
  near(gain("Garen"), 0, 1e-9, "가렌 (아군 지원 아님)");
  const A = St.ALLY;
  near(gain("Soraka"), St.allyGain("allyAS", 0.25, 6, null, 5) + St.allyGain("allyOnhit", 20, 6, null, 5), 1e-6, "공격 속도 25% + 적중 20, 6초");
  near(St.allyGain("allyAP", 40, 6), 0, 1e-12, "기준 아군(원딜)은 주문력 계수 0");
  assert.ok(A.autoDps > 0 && A.AS > 0);
});

test("받는 아군 공격력 비례 효과(밀리오 패시브)와 아군이 터뜨리는 표식(레나타 패시브)도 기준 아군으로", () => {
  const row = (id, src) => St.evaluate(champ(id), 18, [], [], {}).m.effects.find((e) => e.src === src);
  near(row("Milio", "패시브 타오르는 힘").ally, 0.15 * St.ALLY.AD * 100 / (100 + St.TARGET.MR), 1e-6, "아군 공격력 15% 마법 피해 1번");
  near(row("Renata", "패시브 영향력").ally, 0.033 * St.TARGET.HP * 100 / (100 + St.TARGET.MR), 1e-6, "최대 체력 3.3% 마법 피해 1번");
});

// v0.1.93 P4-B 3단계 지크의 융합 (게임 데이터 3050: Duration 5 · SlowAmount 0.3 · DamagePerSecond 30 · UltimateHaste 15 · Cooldown 45)
test("지크의 융합: 폭풍 피해 5번·둔화 1.5초·궁극기 가속 15", () => {
  const it = item("지크의 융합"), c = champ("Leona");
  const a = ev(c, [bare(it)]).m, b = ev(c, [it]).m;
  near(b.control - a.control, 1.5, 0.01, "30% 둔화 5초 = 제어력 1.5초 (라일라이와 같은 기준)");
  // 폭풍 피해: 매초 30 × 5초 (전에는 1초치만 셌다)
  const eff = (it.effects || []).find((e) => e.name === "DamagePerSecond");
  assert.equal(eff.ticks, 5, "5번");
  const noFx = { ...it, effects: [] };
  const one = { ...it, effects: [{ ...eff, ticks: 1 }] };
  const gain5 = ev(c, [it]).m.combo - ev(c, [noFx]).m.combo, gain1 = ev(c, [one]).m.combo - ev(c, [noFx]).m.combo;
  assert.ok(Math.abs(gain5 - gain1 * 5) < gain1 * 0.05, `폭풍 피해가 5배: ${Math.round(gain1)} → ${Math.round(gain5)}`);
  // 궁극기 가속은 궁극기 재사용 대기시간에만
  const r1 = ev(c, [bare(it)]).stats, r2 = ev(c, [it]).stats;
  assert.equal(r2.conv.ultHasteAdd, 15);
  const ult = (m) => (m.spells.find((s) => s.slot === "R") || {}).cd;
  assert.ok(ult(b) < ult(a), `궁극기만 짧아진다: ${ult(a).toFixed(1)} → ${ult(b).toFixed(1)}`);
  assert.equal(Math.round((b.spells.find((s) => s.slot === "Q") || {}).cd * 10), Math.round((a.spells.find((s) => s.slot === "Q") || {}).cd * 10), "기본 스킬은 그대로");
});

// v0.1.93 P4-B 4단계 지평선의 초점 (게임 데이터 4628: DamageAmp 0.1 · SnipeRange 600 · BuffDuration 6)
test("지평선의 초점: 600 밖에서 맞힐 수 있는 몫만큼 모든 피해 +10%", () => {
  const it = item("지평선의 초점");
  assert.deepEqual(it.passiveStats, { dmgDealtMult: 0.1, _farMark: 600 }, "규칙이 붙어야 해요");
  const DMG = new Set(["physical", "magic", "true"]);
  const farR = (c) => Math.max(0, ...(c.spells || []).filter((s) => (s.effects || []).some((e) => DMG.has(e.kind))).map((s) => s.range || 0));
  const share = (c) => (farR(c) <= 600 ? 0 : 1 - (600 / farR(c)) ** 2);
  for (const id of ["Lux", "Xerath", "Annie"]) {
    const c = champ(id), a = ev(c, [bare(it)]).m, b = ev(c, [it]).m;
    near(b.combo / a.combo, 1 + 0.1 * share(c), 0.002, `${id} 한타 피해 (몫 ${share(c).toFixed(2)})`);
  }
  // 멀리서 맞힐 피해 스킬이 없는 챔피언은 값이 0 (가렌 가장 긴 피해 스킬 사거리 < 600)
  const g = champ("Garen");
  assert.ok(farR(g) < 600, `가렌 피해 스킬 사거리 ${farR(g)}`);
  near(ev(g, [it]).m.combo, ev(g, [bare(it)]).m.combo, 1e-9, "가렌은 못 쓴다");
});

// v0.1.93 P4-B 5단계 고통스러운 상처 (상대 회복량이 근거라 상대를 모르면 0)
test("치유 감소: 상대 회복량의 40%만큼 한타 피해, 상대를 모르면 0", () => {
  const c = champ("Lux");
  for (const n of ["모렐로노미콘", "필멸자의 운명", "화공 펑크 사슬검", "가시 갑옷"]) {
    assert.deepEqual(item(n).passiveStats, { healCut: 0.4 }, `${n} 규칙`);
  }
  const it = item("모렐로노미콘");
  assert.equal(St.TARGET.HEAL, 0, "기준 상대는 회복 0 (전 챔피언 균형 빌드 중앙값)");
  near(ev(c, [it]).m.combo, ev(c, [bare(it)]).m.combo, 1e-9, "상대를 모르면 값이 없다");
  const saved = St.TARGET.HEAL;
  St.setTarget({ ARMOR: St.TARGET.ARMOR, MR: St.TARGET.MR, HP: St.TARGET.HP, HEAL: 1000 });
  try {
    near(ev(c, [it]).m.combo - ev(c, [bare(it)]).m.combo, 400, 1e-6, "회복 1000 × 40%");
    assert.equal(ev(c, [bare(it)]).m.healCut, undefined, "효과가 없는 아이템은 안 센다");
  } finally { St.setTarget(null); St.TARGET.HEAL = saved; }
});

// v0.1.93 P3-F 1·2: 아이템 업그레이드 증강의 보유 조건, 라일라이의 '피해를 입히면' 조건
const S = require(path.join(WEB, "scoring.js"));

test("아이템 업그레이드 증강: 그 아이템이 없으면 능력치도 효과도 안 들어간다", () => {
  const c = champ("Jinx");
  const pairs = [];
  for (const a of d.augments) {
    const rule = (d.rules.augments || {})[a.id] || {};
    if (!(rule.items || []).length) continue;
    if (!Object.keys(rule.statsResolved || {}).length && !(a.effects || []).length) continue;
    pairs.push([a, rule.items]);
  }
  assert.ok(pairs.length >= 4, `아이템을 요구하는 수치 증강이 있어야 해요: ${pairs.length}`);
  const other = item("무한의 대검");
  for (const [a, need] of pairs) {
    const has = [d.items.find((i) => need.includes(i.name))].filter(Boolean);
    assert.equal(has.length, 1, `${a.name} 이 요구하는 아이템 ${need.join(",")}`);
    const off = S.augStatsOf([a], d.rules, c, [other])[0];
    const on = S.augStatsOf([a], d.rules, c, has)[0];
    assert.deepEqual(off, { _effects: [] }, `${a.name}: 아이템이 없으면 비어 있어야 해요`);
    assert.ok(Object.keys(on).length > 1 || (on._effects || []).length, `${a.name}: 아이템이 있으면 들어가야 해요`);
  }
  // 꽃피는 새벽의 검 업그레이드 = 공격 속도 +100%. 아이템 없이 들면 공격 속도가 안 오른다
  const up = d.augments.find((a) => a.name === "꽃피는 새벽의 검 업그레이드");
  const asOf = (items) => St.evaluate(c, 18, items, S.augStatsOf([up], d.rules, c, items), {}).stats.total.AS;
  near(asOf([other]), St.evaluate(c, 18, [other], [], {}).stats.total.AS, 1e-9, "아이템 없이는 공격 속도 그대로");
  assert.ok(asOf([item("꽃피는 새벽의 검")]) > St.evaluate(c, 18, [item("꽃피는 새벽의 검")], [], {}).stats.total.AS + 0.5,
    "아이템이 있으면 공격 속도가 크게 오른다");
  // items 를 안 넘기면(아이템과 무관한 계산) 예전처럼 그대로 넣는다
  assert.ok(S.augStatsOf([up], d.rules, c)[0].AS, "items 를 안 주면 조건을 안 본다");
});

test("라일라이의 수정홀: 피해를 주는 스킬 칸만 센다 (전 챔피언 같은 값이 아니다)", () => {
  const it = item("라일라이의 수정홀");
  assert.deepEqual(it.passiveStats, { controlPerCast: 0.3 }, "규칙이 붙어야 해요");
  const add = (c) => ev(c, [it]).m.control - ev(c, [bare(it)]).m.control;
  const dmgCasts = (c) => ev(c, []).m.spells.filter((s) => !s.disabled && s.dmg > 0).length;
  for (const id of ["Taric", "Sona", "Lux", "Zed"]) {
    near(add(champ(id)), 0.3 * dmgCasts(champ(id)), 1e-9, `${id} 피해 스킬 ${dmgCasts(champ(id))}칸`);
  }
  assert.ok(dmgCasts(champ("Taric")) < dmgCasts(champ("Lux")), "타릭은 럭스보다 피해 스킬이 적다");
  const vals = new Set(d.champions.filter((c) => c.spells).map((c) => Math.round(add(c) * 100)));
  assert.ok(vals.size > 1, `전 챔피언이 같은 값이면 조건을 안 보는 것: ${[...vals].join(",")}`);
});

// ---- v0.1.95 Phase 4 C1: 아이템 효과의 자기 회복과 자기 보호막을 따로 센다
// 예전엔 둘 다 out.itemSelfHp 한 통에 담겨, 상대 회복량 추정(app.js enemyTarget)이 보호막까지 '회복'으로 셌다.
// 고통스러운 상처(치유 감소)는 보호막을 막지 못하므로 치유 감소 아이템의 값이 부풀려졌다 (실제 5판 중 3판에서 추정값의 33~76%가 보호막)
// v0.1.95 Phase 5 (E3): 피바라기의 '초과 회복 → 보호막'은 같은 흡혈의 넘친 몫이라 두 번 세지 않으려고 뺐다 → 목록에서 제외
const SHIELD_ITEMS = ["불멸의 철갑궁", "케이닉 루컨", "스테락의 도전", "파멸의식 고서"];
const HEAL_ITEMS = ["죽음의 무도", "워모그의 갑옷", "무덤꽃", "갈라진 하늘", "황혼과 새벽", "꽃피는 새벽의 검"];

test("아이템 자기 보호막은 회복과 따로 센다 (치유 감소가 막는 건 회복뿐)", () => {
  const c = champ("Jinx");
  for (const n of SHIELD_ITEMS) {
    const m = ev(c, [item(n)]).m;
    assert.ok(m.itemSelfShield > 0, `${n}: 보호막이 안 잡혀요 (${m.itemSelfShield})`);
    assert.equal(m.itemSelfHeal, 0, `${n}: 보호막인데 회복으로 셌어요 (${m.itemSelfHeal})`);
  }
  for (const n of HEAL_ITEMS) {
    const m = ev(c, [item(n)]).m;
    assert.ok(m.itemSelfHeal > 0, `${n}: 회복이 안 잡혀요 (${m.itemSelfHeal})`);
    assert.equal(m.itemSelfShield, 0, `${n}: 회복인데 보호막으로 셌어요 (${m.itemSelfShield})`);
  }
});

// 분리해도 버티는 힘(EHP)은 그대로여야 한다: extraHp 는 itemSelfHp(합)를 쓰므로 합이 깨지지 않는지 본다
test("보호막을 갈라도 자기 생존력 계산은 그대로: itemSelfHp = 자기 회복 + 자기 보호막", () => {
  for (const id of ["Jinx", "Garen", "Soraka", "Darius", "Lux"]) {
    const c = champ(id);
    for (const n of [...SHIELD_ITEMS, ...HEAL_ITEMS]) {
      const m = ev(c, [item(n)]).m;
      near(m.itemSelfHp, (m.itemSelfHeal || 0) + (m.itemSelfShield || 0), 1e-9, `${id}/${n}`);
    }
  }
});
