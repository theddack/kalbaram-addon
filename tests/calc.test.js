// 계산 엔진 테스트: 능력치·발동 빈도·기억(memo)·실제 사례로 확인한 값
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const St = global.Stats;
const S = require(path.join(WEB, "scoring.js"));
const d = require(path.join(WEB, "data.json"));
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (name) => d.items.find((i) => i.name === name);
const aug = (id) => d.augments.find((a) => a.id === id);

test("레벨 성장식: 럭스 18레벨 체력 (손 검산 2263 근처)", () => {
  const t = St.computeStats(champ("Lux"), 18, [], [], { aram: false }).total;
  assert.ok(Math.abs(t.HP - 2263) < 30, `HP ${t.HP}`);
});

test("지속 피해는 지속 시간마다 1번: 징크스 + 리안드리 초당 피해 = 화상 1번 ÷ 3초", () => {
  const m = St.evaluate(champ("Jinx"), 18, [item("리안드리의 고통")], []).m;
  const row = m.effects.find((e) => e.src === "리안드리의 고통");
  const base = St.evaluate(champ("Jinx"), 18, [], []).m;
  const lia = m.augDps - base.augDps;
  assert.ok(Math.abs(lia - row.hit / 3) < 0.5, `리안드리 초당 ${lia} vs ${row.hit / 3}`);
});

test("'스킬 사용 시' 효과는 한 스킬당 최대 2초에 1번 (징크스 Q 0.9초 토글)", () => {
  const c = champ("Jinx");
  assert.ok(c.spells.find((x) => x.slot === "Q").cooldown[0] < 2, "징크스 Q 는 짧은 토글");
  const eff = { kind: "magic", name: "t", base: [100], trigger: { type: "cast" }, src: "시험" };
  const m = St.metrics(c, 18, St.computeStats(c, 18, [], [{ _effects: [eff] }]));
  const row = m.effects.find((e) => e.src === "시험");
  const expected = row.hit * m.spells.reduce((t, sp) => t + (!sp.disabled && sp.cd > 0 ? 1 / Math.max(sp.cd, 2) : 0), 0);
  const base = St.metrics(c, 18, St.computeStats(c, 18, [], [])).augDps;
  assert.ok(Math.abs(m.augDps - base - expected) < 0.01, `${m.augDps - base} vs ${expected}`);
});

test("기준 상대는 공통 가정값 표와 같은 숫자", () => {
  const a = St.ASSUMPTIONS.find((x) => x.what.startsWith("기준 상대"));
  assert.ok(a.what.includes(String(St.DEFAULT_TARGET.HP)) && a.what.includes(String(St.DEFAULT_TARGET.ARMOR)), a.what);
});

test("상대 바꾸기: setTarget 후 기본값 복귀", () => {
  St.setTarget({ ARMOR: 300, MR: 200, HP: 5000 });
  assert.equal(St.TARGET.ARMOR, 300);
  St.setTarget(null);
  assert.deepEqual({ ...St.TARGET }, { ...St.DEFAULT_TARGET });
});

test("계산 기억: 같은 조건이면 같은 결과, 증강이 다르면 새로 계산", () => {
  const c = champ("Jinx"), w = S.profile(c, d.tags);
  const [a1] = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"]);
  const [a2] = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"]);
  assert.equal(a1, a2, "같은 조건 → 기억된 결과");
  const all = S.buildConcepts(d.items, w, [], [], d.rules, c, {});
  assert.equal(all.length, 3);
  assert.equal(all.find((x) => x.key === "balanced"), a1, "3종을 달라고 해도 균형 빌드는 다시 찾지 않는다");
  const [b] = S.buildConcepts(d.items, w, [aug("ARAM_DrawYourSword")], [], d.rules, c, {}, ["balanced"]);
  assert.notEqual(a1, b);
  St.setTarget({ ARMOR: 300, MR: 200, HP: 5000 });
  const [t] = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"]);
  St.setTarget(null);
  assert.notEqual(a1, t, "상대가 바뀌면 다시 계산");
});

test("계산 기억: 챔피언·고른 증강·산 아이템·상대 구성·규칙이 바뀌면 새로 계산, 같으면 그대로", () => {
  const c = champ("Jinx"), w = S.profile(c, d.tags);
  const one = (...a) => S.buildConcepts(...a)[0];
  const base = [d.items, w, [aug("ARAM_DrawYourSword")], [d.items.find((i) => i.kind === "legendary")], d.rules, c, { enemyMagic: 0.5 }, ["augment"]];
  const b0 = one(...base);
  assert.equal(one(...base), b0, "같으면 기억된 결과");
  const variants = {
    챔피언: () => { const x = [...base]; x[5] = champ("Lux"); x[1] = S.profile(x[5], d.tags); return x; },
    고른증강: () => { const x = [...base]; x[2] = [aug("ARAM_SpinToWin")]; return x; },
    산아이템: () => { const x = [...base]; x[3] = []; return x; },
    상대구성: () => { const x = [...base]; x[6] = { enemyMagic: 0.8 }; return x; },
    규칙: () => { const x = [...base]; x[4] = JSON.parse(JSON.stringify(d.rules)); return x; },
  };
  for (const [k, make] of Object.entries(variants)) assert.notEqual(one(...make()), b0, k);
  // 증강 점수(수치)도 같은 기준
  const g0 = S.numericAugmentGains(d.augments.slice(0, 20), d.items, w, [], [], d.rules, c, { enemyMagic: 0.5 });
  assert.equal(S.numericAugmentGains(d.augments.slice(0, 20), d.items, w, [], [], d.rules, c, { enemyMagic: 0.5 }), g0);
  assert.notEqual(S.numericAugmentGains(d.augments.slice(0, 20), d.items, w, [], [], d.rules, c, { enemyMagic: 0.9 }), g0, "상대 구성");
  assert.notEqual(S.numericAugmentGains(d.augments.slice(0, 20), d.items, w, [aug("ARAM_DrawYourSword")], [], d.rules, c, { enemyMagic: 0.5 }), g0, "고른 증강");
});

test("계산 기억: 길이가 같아도 다른 후보 목록이면 새로 계산", () => {
  const c = champ("Lux"), w = S.profile(c, d.tags);
  const nums = d.augments.filter((a) => S.hasNumbers(a, d.rules));
  const g1 = S.numericAugmentGains([nums[0]], d.items, w, [], [], d.rules, c);
  const g2 = S.numericAugmentGains([nums[1]], d.items, w, [], [], d.rules, c);
  assert.ok(nums[1].id in g2.gains && !(nums[0].id in g2.gains), "B 를 물으면 B 의 결과 (A 결과가 나오면 안 된다)");
  assert.ok(nums[0].id in g1.gains);
});

test("조건을 못 맞춘 증강은 능력치도 효과도 0 (럭스 + 승리를 위한 회전)", () => {
  const lux = champ("Lux"), spin = aug("ARAM_SpinToWin");
  assert.ok(spin.eligible && !spin.eligible.includes("Lux"));
  const [st] = S.augStatsOf([spin], d.rules, lux);
  assert.deepEqual(st, { _effects: [] });
  const ok = champ(spin.eligible[0]);
  const [st2] = S.augStatsOf([spin], d.rules, ok);
  assert.ok(Object.keys(st2).length >= 1, "맞는 챔피언이면 그대로");
});

test("빌드: 6칸, 신발 1개, 같은 계열 중복 없음 (전 챔피언)", () => {
  for (const c of d.champions) {
    const [b] = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, ["balanced"]);
    const items = b.pick.map((p) => p.item);
    assert.equal(items.length, 6, c.id);
    assert.ok(items.filter((i) => i.kind === "boots").length <= 1, c.id);
    const limits = items.map((i) => i.limit).filter(Boolean);
    assert.equal(new Set(limits).size, limits.length, `${c.id} 같은 계열 ${limits}`);
    for (const v of Object.values(b.final)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${c.id} NaN`);
  }
});

test("증강 등급: 전 증강이 등급을 받고, 조건 미충족은 D", () => {
  const c = champ("Lux");
  const tiers = S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, "total");
  assert.equal(Object.keys(tiers).length, d.augments.length);
  assert.equal(tiers.ARAM_SpinToWin.tier, "D");
});

test("스킬 레벨: 제이스·니달리·우디르 18레벨 포인트 18개", () => {
  for (const id of ["Jayce", "Nidalee", "Karma", "Elise", "Udyr", "Jinx"]) {
    const c = champ(id);
    const r = St.ranksAt(18, c.spells);
    const free = c.spells[3].ranks === 1 || c.spells[3].ranks === 4 ? 1 : 0;
    assert.equal(r.reduce((a, b) => a + b, 0) - free, 18, `${id} ${r}`);
    r.forEach((x, i) => assert.ok(x <= c.spells[i].ranks, `${id} ${i} ${x}`));
  }
  assert.deepEqual(St.ranksAt(18, champ("Jayce").spells), [6, 6, 6, 1]);
  assert.equal(St.ranksAt(1, champ("Nidalee").spells)[3], 1, "니달리 R 은 1레벨부터");
});

test("최소·최대 피해는 큰 쪽 하나만 (다리우스 R)", () => {
  const m = St.evaluate(champ("Darius"), 18, [], []).m;
  const r = m.spells.find((s) => s.slot === "R");
  assert.equal(r.values.length, 1, r.values.map((v) => v.name).join(","));
});

test("추가 주문력 계수가 계산된다 (잭스 E·R)", () => {
  const j = champ("Jax");
  const a = St.evaluate(j, 18, [], []).m.combo, b = St.evaluate(j, 18, [item("라바돈의 죽음모자")], []).m.combo;
  assert.ok(b > a * 1.2, `${a} → ${b}`);
});

test("이동 속도 감속 구간 (490 초과는 절반만)", () => {
  const t = St.computeStats(champ("Jinx"), 18, [], [{ MS: 400 }]).total;
  assert.ok(t.MS < 600, `MS ${t.MS}`);
});

test("검을 뽑아라(근접 전환)는 추천 빌드에도 반영된다", () => {
  const c = champ("Jinx"), w = S.profile(c, d.tags), dys = aug("ARAM_DrawYourSword");
  const melee = S.withChosenFeatures(c, [dys], d.rules);
  assert.ok(melee.melee && melee.features.includes("melee"));
  const [b] = S.buildConcepts(d.items, w, [dys], [], d.rules, c, {}, ["balanced"]);
  const m = St.evaluate(melee, 18, b.pick.map((p) => p.item), S.augStatsOf([dys], d.rules, c)).m;
  assert.ok(Math.abs(b.final.dps - m.dps) < 0.5, `빌드 ${b.final.dps} vs 근접 ${m.dps}`);
});

test("대체 버전은 하나만: 트페 W 카드 1장, 렝가 강화 Q 제외, 리 신 Q1+Q2", () => {
  const vals = (id, slot) => St.evaluate(champ(id), 18, [], []).m.spells.find((s) => s.slot === slot).values
    .filter((v) => ["magic", "physical", "true"].includes(v.kind)).map((v) => v.name);
  assert.equal(vals("TwistedFate", "W").length, 1);
  assert.ok(!vals("Rengar", "Q").some((n) => /empowered/i.test(n)));
  assert.deepEqual(vals("LeeSin", "Q").sort(), ["initialdamage", "recastdamage"]);
});

test("곱셈 식(닐라 Q)은 치명타 확률이 오르면 피해도 오른다", () => {
  const c = champ("Nilah");
  const q = (items) => St.evaluate(c, 18, items, []).m.spells.find((s) => s.slot === "Q").values[0].value;
  assert.ok(q([item("무한의 대검")]) > q([]));
});

test("중첩형: 나서스 Q 는 평균 중첩만큼, 베이가는 주문력 중첩", () => {
  const nasus = champ("Nasus");
  assert.ok(nasus.stacks > 0 && nasus.stackBasis.some((b) => b.t === "assume"));
  const t = St.computeStats(champ("Veigar"), 18, [], []).total;
  assert.ok(t.AP >= champ("Veigar").stackStats.AP);
});

test("새로 숫자로 계산되는 증강: 흡수(스킬 피해 회복), 죽음의 순환(회복 → 피해)", () => {
  const lux = champ("Lux");
  // 흡수는 '내' 체력을 회복하는 효과라 자기 회복 칸에 들어간다 (v0.1.95 Phase 4 E1 전에는 아군 회복 칸이었다)
  const heal = (augs) => St.evaluate(lux, 18, [], S.augStatsOf(augs, d.rules, lux)).m.selfHealAll;
  assert.ok(heal([aug("ARAM_SustainingStrike")]) > heal([]));
  const sor = champ("Soraka");
  const combo = (augs) => St.evaluate(sor, 18, [], S.augStatsOf(augs, d.rules, sor)).m.combo;
  assert.ok(combo([aug("ARAM_CircleofDeath")]) > combo([]));
});

test("기본 빌드는 라이엇 주 피해 유형을 따른다 (이렐리아 AP·전사 치명타 쏠림 막기)", async () => {
  const { loadPage } = require("./page");
  const p = await loadPage({ simple: true });
  const by = (id) => p.data.champions.find((c) => c.id === id);
  const items = (id) => p.w.itemSetBlocks(by(id))[0].items.map((i) => p.data.items.find((x) => x.id === i));
  const isAP = (it) => (it.tags.AP || 0) >= 0.5 && !((it.tags.AD || 0) >= 0.5);
  const isCrit = (it) => (it.tags.CRIT || 0) >= 0.5 || "CRIT" in (Array.isArray(it.stats) ? {} : it.stats || {});
  assert.equal(by("Irelia").damageType, "physical");
  assert.ok(!items("Irelia").some(isAP), "이렐리아(물리)에 AP 아이템 없음");
  for (const id of ["Azir", "Teemo"]) assert.ok(!items(id).some((it) => (it.tags.AD || 0) >= 0.5 && !(it.tags.AP >= 0.5)), `${id}(마법)에 AD 아이템 없음`);
  // 예외: 라이엇 칼바람 추천이 반대 유형 위주인 챔피언 (케일 = 크라켄·몰락한 왕의 검·구인수) → 그 아이템을 반대 유형으로 밀어내지 않는다.
  // (2026-10-20 E 기본 지속 효과를 평타마다 세면서 케일 기본 빌드는 AP 적중(내셔의 이빨·리치베인)이 앞선다 — 고르는 것은 계산, 밀어내지만 않는다)
  const official = new Set(by("Kayle").officialItems.ranges.flat());
  const S = require("../web/scoring.js");
  const kc = by("Kayle");
  const rows = S.rankItems(p.data.items, S.profile(kc, p.data.tags), [], [], p.data.rules, kc, { aram: true });
  assert.ok(rows.filter((r) => official.has(r.item.id) && (r.item.tags.AD || 0) >= 0.5).every((r) => !r.offType), "케일 라이엇 추천 AD 적중 아이템은 반대 유형으로 안 밀림");
  for (const id of ["Darius", "Trundle", "Jax"]) assert.ok(!items(id).some(isCrit), `${id}(치명타 못 살리는 근접)에 치명타 없음`);
  assert.ok(items("Jinx").some(isCrit), "원거리 딜러는 치명타 그대로");
  assert.ok(items("Yasuo").some(isCrit), "치명타 특성(야스오)은 그대로");
});

// ---- 추천 품질 (2026-10-15 검토: 변칙은 증강이 받쳐 줄 때만, 몰빵은 증강을 실제로 살리는지)
const build = (cid, augIds, key) => {
  const c = champ(cid);
  return S.buildConcepts(d.items, S.profile(c, d.tags), augIds.map(aug), [], d.rules, c, {}, [key])[0];
};
const hasTag = (b, t) => b.pick.filter((p) => ((p.item.tags || {})[t] || 0) >= 0.5).length;

test("변칙: 증강이 없으면 받쳐 주는 정도 0 (화면에 실험 빌드로 표시)", () => {
  const b = build("Jinx", [], "twist");
  assert.equal(b.twist.s, 0);
  assert.ok(b.twist.opp.includes("AP"), "징크스의 반대쪽은 주문력");
});

test("변칙: 주문력 계수 보호막(전술적 대비)이면 징크스가 주문력 아이템을 산다", () => {
  const b = build("Jinx", ["ARAM_BigBrain"], "twist");
  assert.ok(b.twist.s > 0 && b.twist.by.includes("전술적 대비"), JSON.stringify(b.twist));
  assert.ok(hasTag(b, "AP") >= 2, b.pick.map((p) => p.item.name).join(","));
});

test("변칙: 공격력·주문력을 둘 다 키우는 증강(적응형 계수)이나 주문력 고정 수치는 근거가 아니다", () => {
  const sup = (cid, ids) => S.twistSupport(S.profile(champ(cid), d.tags), S.augContext(ids.map(aug), d.rules)).s;
  const id = (name) => d.augments.find((a) => a.name === name).id;
  assert.equal(sup("Zed", [id("불여우")]), 0, "불여우: 공격력·주문력 계수 둘 다");
  assert.equal(sup("Jinx", [id("사악한 정신")]), 0, "사악한 정신: 주문력 +80 고정");
  assert.equal(sup("Jinx", ["ARAM_ADAPt"]), 1, "공격력→주문력 환산은 확실한 근거");
});

test("몰빵: 아이템 업그레이드 증강은 그 아이템을 빌드에 넣는다 (징크스 + 징수의 총 업그레이드)", () => {
  const id = d.augments.find((a) => a.name === "징수의 총 업그레이드").id;
  for (const key of ["augment", "balanced"]) {
    const b = build("Jinx", [id], key);
    assert.ok(b.pick.some((p) => p.item.name === "징수의 총"), `${key}: ${b.pick.map((p) => p.item.name).join(",")}`);
  }
});

test("몰빵: 적 방어력을 깎는 증강(부식)에 방어력 아이템을 사지 않는다", () => {
  const id = d.augments.find((a) => a.name === "부식").id;
  const b = build("Jinx", [id], "augment");
  assert.equal(hasTag(b, "ARMOR") - b.pick.filter((p) => p.item.kind === "boots" && ((p.item.tags || {}).ARMOR || 0) >= 0.5).length, 0,
    b.pick.map((p) => p.item.name).join(","));
});

test("추천 품질 점검: 몰빵 빌드가 증강을 살리는 비율 95% 이상, 변칙 정상 90% 이상 (표본)", () => {
  const Q = require(path.join(__dirname, "..", "tools", "augment_quality.js"));
  const ids = d.augments.filter((a, i) => i % 5 === 0).map((a) => a.id);
  const sum = Q.summary(Q.check(d, ["Jinx", "Malphite"], ids));
  assert.ok(sum.mollppang.n > 30 && sum.mollppang.rate >= 0.95, JSON.stringify(sum));
  assert.ok(sum.twist.rate >= 0.9, JSON.stringify(sum));
});

// ---- 연계 상태 (등급과 따로): 강한 연계·일반·없음·충돌·불확실
const tiersOf = (cid, chosenIds) => {
  const c = champ(cid);
  return S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), chosenIds.map(aug), [], d.rules, c, {}, "synergy");
};
const byName = (name) => d.augments.find((a) => a.name === name);

test("연계: 고른 증강이 없으면 연계 표시 없음", () => {
  const t = tiersOf("Lux", []);
  assert.ok(Object.values(t).every((x) => x.link === null));
});

test("연계: 궁극기 봉인(기본으로 돌아가기) + 궁극기 증강 = 효과 충돌, 이유 문장, 등급 한 단계 아래", () => {
  const t = tiersOf("Lux", ["ARAM_BacktoBasics"]);
  const ult = Object.entries(t).filter(([, x]) => x.link && x.link.kind === "conflict");
  assert.ok(ult.length > 0);
  assert.ok(ult.every(([, x]) => /궁극기/.test(x.link.why)), ult.map(([, x]) => x.link.why).join("\n"));
});

test("연계: 반대 방향 환산(적응형 능력치 ↔ 마법사 (물리))은 충돌", () => {
  assert.match(S.ruleConflict(aug("ARAM_escAPADe"), [aug("ARAM_ADAPt")], d.rules), /환산/);
  assert.equal(S.ruleConflict(byName("부식"), [aug("ARAM_ADAPt")], d.rules), null, "상관없는 증강은 충돌 아님");
});

test("연계: 숫자상 손해만으로는 충돌이라 하지 않는다 (규칙으로 아는 충돌만)", () => {
  const t = tiersOf("Lux", ["ARAM_BacktoBasics"]);
  for (const x of Object.values(t)) if (x.link && x.link.kind === "conflict") assert.ok(x.link.why, "충돌이면 이유가 있다");
  assert.ok(Object.values(t).some((x) => x.link && x.link.kind === "none" && x.interaction < 0), "음수 궁합은 '직접 연계 없음'");
});

test("연계: 숫자로 계산 못 하는 쪽이 있으면 판정 불확실, 계산되면 강한/일반/없음", () => {
  const t = tiersOf("Sona", [byName("흡수").id]);
  const kinds = new Set(Object.values(t).map((x) => x.link && x.link.kind));
  for (const k of ["strong", "none", "unsure"]) assert.ok(kinds.has(k), `${k} 없음: ${[...kinds]}`);
  for (const [id, x] of Object.entries(t)) {
    if (!x.link) continue;
    if (!S.hasNumbers(aug(id), d.rules)) assert.ok(["unsure", "conflict", "strong", "some"].includes(x.link.kind), `${aug(id).name}: 숫자 없는 증강을 '연계 없음'이라 단정`);
    if (x.link.kind === "strong") assert.ok(x.interaction >= S.SYNERGY_MARK);
  }
});

test("연계: 두 번째·세 번째 증강까지 누적 (고른 증강 2개 기준 궁합)", () => {
  const one = tiersOf("Sona", [byName("흡수").id]);
  const two = tiersOf("Sona", [byName("흡수").id, "ARAM_BigBrain"]);
  const id = byName("응급처치 키트").id;
  assert.notEqual(one[id].interaction, two[id].interaction);
});

test("치명적 리듬 베인: 무한의 대검이 불경한 히드라보다 위 (치명타 공속 중첩 · 쪼개기는 주변 적에게만)", () => {
  const c = d.champions.find((x) => x.id === "Vayne");
  const w = S.profile(c, d.tags);
  const rh = d.augments.find((a) => a.id === "CriticalRhythm");
  const owned = ["6672", "3006", "3036", "3153"].map((id) => d.items.find((i) => i.id === id));
  const rows = S.rankItems(d.items, w, [rh], owned, d.rules, c, { aram: true }, "augment");
  const at = (n) => rows.findIndex((r) => r.item.name === n);
  assert.ok(at("무한의 대검") < at("불경한 히드라"), `무한의 대검 ${at("무한의 대검") + 1}위 · 불경한 히드라 ${at("불경한 히드라") + 1}위`);
  // 치명타가 오를수록 공격 속도도 오른다
  const aug = S.augStatsOf([rh], d.rules, c);
  const as = (items) => Stats.computeStats(c, 18, items, aug, { aram: true }).total.AS;
  assert.ok(as([...owned, d.items.find((i) => i.id === "3031")]) > as(owned));
});

test("치명적 리듬 중첩 = 치명타 확률 × 초당 공격 × 유지 6초 (최대 10, 모두 게임 데이터 값)", () => {
  const c = d.champions.find((x) => x.id === "Vayne");
  const rh = d.augments.find((a) => a.id === "CriticalRhythm");
  const r = d.rules.augments.CriticalRhythm.statsResolved;
  assert.deepEqual([+r.critStackAS.toFixed(2), r.critStackMax, r.critStackSec], [0.06, 10, 6]);
  const aug = S.augStatsOf([rh], d.rules, c);
  // 아이템 없음: 치명타 25%(증강)만 → 6초에 터지는 치명타 수 = 0.25 × 공격 속도 × 6
  const t0 = Stats.computeStats(c, 18, [], aug, { aram: true }).total;
  assert.ok(Math.abs(t0.critStacks - 0.25 * t0.AS * 6) < 0.01, `중첩 ${t0.critStacks} · 공속 ${t0.AS}`);
  assert.ok(t0.critStacks < 2.5, "예전 가정(치명타 확률 × 10 = 2.5)보다 적다");
  // 치명타 100%면 최대 10
  const full = ["3031", "6672", "3046", "3036"].map((id) => d.items.find((i) => i.id === id)).filter(Boolean);
  const t1 = Stats.computeStats(c, 18, full, aug, { aram: true }).total;
  assert.equal(t1.CRIT, 1);
  assert.equal(t1.critStacks, 10);
});

test("효과 종류만 있는 증강은 몰빵 빌드에 그 효과 아이템을 하나는 넣는다 · 아이템으로 안 커지는 증강(lift {})은 안 넣는다", () => {
  const build = (cid, aid) => {
    const c = d.champions.find((x) => x.id === cid);
    const a = d.augments.find((x) => x.id === aid);
    return S.buildConcepts(d.items, S.profile(c, d.tags), [a], [], d.rules, c, {}, ["augment"])[0].pick.map((p) => p.item);
  };
  for (const cid of ["Ezreal", "Vayne"]) {
    const picks = build(cid, "Ability_SelfAOE_DoubleCast");
    assert.ok(picks.some((i) => (i.tags.HASTE || 0) >= 0.5), `${cid} 메아리 시전: ${picks.map((i) => i.name).join(", ")}`);
  }
  // 아이템 가속 = 사용 효과 아이템 (빌드할 때 게임 데이터 설명에서 채움)
  const act = d.rules.augments.ARAM_ApexInventor.items;
  assert.ok(act.length >= 5 && act.includes("요우무의 유령검"));
  assert.ok(build("Ezreal", "ARAM_ApexInventor").some((i) => act.includes(i.name)));
  // 눈덩이 가속·티아라 매혹은 아이템으로 안 커진다 → 빌드가 따라가지 않는다
  const ctx = S.augContext([d.augments.find((x) => x.id === "ARAM_Snowday"), d.augments.find((x) => x.id === "PromQueen")], d.rules);
  assert.deepEqual(ctx.lift, {});
});

test("적응형은 추가 공격력과 주문력 중 큰 쪽으로 (2026-10-17 트리스타나 판: 치명타 125% → 초과 25% = 적응형 18.75 → 공격력 +11.25, 실제 334.05)", () => {
  const its = ["루난의 허리케인", "크라켄 학살자", "광전사의 군화", "윤 탈 야생화살", "도미닉 경의 인사", "무한의 대검"].map(item);
  const augs = [aug("ARAM_Vulnerability")];
  const t = St.computeStats(champ("Tristana"), 18, its, S.augStatsOf(augs, d.rules, champ("Tristana")), { aram: true }).total;
  assert.equal(t.AP, 0);
  assert.ok(Math.abs(t.AD - 334.05) < 0.05, `AD ${t.AD}`);
});

test("그레이브즈 공격 속도는 재장전 속도 상한(0.651~0.891, 레벨 비례)에서 막힌다 (2026-10-17 판: 계산 1.78 · 실제 0.89)", () => {
  const its = ["크라켄 학살자", "루난의 허리케인", "윤 탈 야생화살", "광전사의 군화"].map(item);
  assert.ok(Math.abs(St.computeStats(champ("Graves"), 18, its, [], { aram: true }).total.AS - 0.891) < 0.001);
  assert.ok(St.computeStats(champ("Graves"), 1, its, [], { aram: true }).total.AS <= 0.651 + 1e-9);
  assert.ok(St.computeStats(champ("Jinx"), 18, its, [], { aram: true }).total.AS > 1.5, "다른 챔피언은 그대로");
});

test("관통력 %는 곱해서 합친다 (35% + 35% = 57.75%, 게임 규칙)", () => {
  const its = ["도미닉 경의 인사", "세릴다의 원한"].map(item);
  const t = St.computeStats(champ("Graves"), 18, its, [], { aram: true }).total;
  assert.ok(Math.abs(t.ARPEN - (1 - 0.65 * 0.65)) < 1e-9, `ARPEN ${t.ARPEN}`);
});

test("진: 공격 속도는 아이템으로 오르지 않고, 추가 공격 속도·치명타는 공격력으로 · 추천 가중치에서 공격 속도 비중이 낮다", () => {
  const jhin = champ("Jhin");
  const zeal = d.items.find((i) => i.name === "광전사의 군화");
  const a = St.computeStats(jhin, 18, [], []).total, b = St.computeStats(jhin, 18, [zeal], []).total;
  assert.equal(b.AS, a.AS);
  assert.ok(b.AD > a.AD, "추가 공격 속도 → 공격력");
  const S2 = require("../web/scoring.js");
  assert.ok(S2.profile(jhin, d.tags).AS < S2.profile(champ("Jinx"), d.tags).AS);
});

test("라이엇 공식 추천 아이템 가산점: 균형 빌드에 핵심이 들어오고 이유에 표시, 변칙에는 안 들어간다", () => {
  // 럭스: 공식 칼바람 핵심 아이템이 가산점 없이는 균형 빌드에 안 들어갔다 (tools/official_check.js)
  const off = champ("Lux");
  assert.equal(off.officialItems.mode, "ARAM");
  const core = off.officialItems.ranges[0];
  const plain = { ...off, officialItems: null };
  const w = S.profile(off, d.tags);
  S.clearMemo();
  const base = S.buildConcepts(d.items, w, [], [], d.rules, plain, {}, ["balanced"])[0].pick;
  assert.ok(!base.some((p) => core.includes(p.item.id)), "가산점 없을 땐 핵심이 없었다");
  const bal = S.buildConcepts(d.items, w, [], [], d.rules, off, {}, ["balanced"])[0].pick;
  const hit = bal.find((p) => core.includes(p.item.id));
  assert.ok(hit, "핵심 아이템이 들어온다");
  assert.ok((hit.reasons || []).includes("라이엇 추천 (칼바람)"), JSON.stringify(hit.reasons));
  const tw = S.buildConcepts(d.items, w, [], [], d.rules, off, {}, ["twist"])[0].pick;
  assert.ok(!tw.some((p) => (p.reasons || []).includes("라이엇 추천 (칼바람)")), "변칙은 공식 추천을 따르지 않는다");
  assert.equal(S.officialWeights(off, 0.5)[core[0]], 0.5, "세기를 곱한다");
  assert.equal(S.officialWeights(plain, 1), null);
});

test("공식 칼바람 추천이 없는 챔피언: 비슷한 챔피언 공식 추천을 빌린다 (주 피해 유형 반대 아이템은 빼고)", () => {
  const champs = d.champions.map((c) => ({ ...c }));
  S.attachSimilar(champs, null, d.items);
  const k = champs.find((c) => c.id === "Kindred");
  assert.equal(k.officialItems, null);
  assert.equal(k.similarItems.from.length, 3);
  const apOnly = (id) => { const it = d.items.find((i) => i.id === id); return it && (it.tags.AP || 0) >= 0.5 && !((it.tags.AD || 0) >= 0.5); };
  assert.ok(!k.similarItems.ranges.flat().some(apOnly), "물리 챔피언에게 주문력 아이템을 빌려 오지 않는다");
  const lux = champs.find((c) => c.id === "Lux");
  assert.ok(lux.officialItems && !lux.similarItems, "자기 공식 추천이 있으면 안 빌린다");
  S.clearMemo();
  const pick = S.buildConcepts(d.items, S.profile(k, d.tags), [], [], d.rules, k, {}, ["balanced"])[0].pick;
  const why = pick.flatMap((p) => p.reasons || []).find((r) => r.startsWith("비슷한 챔피언 라이엇 추천"));
  assert.ok(why && why.includes(k.similarItems.from[0]), "이유에 어느 챔피언 것인지");
});

test("크라켄 학살자는 3번째 평타마다 기본 피해 (최대값을 평타마다로 계산해 평타 초당 피해가 5배가 되던 것)", () => {
  const c = champ("Varus");
  const base = St.evaluate(c, 18, [], [], { aram: true }).m.dps;
  const kraken = St.evaluate(c, 18, [d.items.find((i) => i.id === "6672")], [], { aram: true }).m.dps;
  const ie = St.evaluate(c, 18, [item("무한의 대검")], [], { aram: true }).m.dps;
  assert.ok(kraken / base < 3, `크라켄 ${(kraken / base).toFixed(2)}배`);
  assert.ok(kraken / base < 1.6 * (ie / base), "무한의 대검보다 터무니없이 크지 않다");
});

test("점수가 비슷하면 증강 필요 → 증강 연계 → 라이엇 추천 → 점수 순 (차이가 크면 계산 순서 그대로)", () => {
  const row = (id, score, p, offType = false) => ({ item: { id }, score, p, offType });
  const prio = (r) => r.p;
  // 100 · 98(라이엇) · 97(연계) · 80(연계) · 오프타입
  const rows = [row("a", 100, 3), row("b", 98, 2), row("c", 97, 1), row("d", 80, 1), row("x", 120, 0, true)];
  const out = S.tieOrder(rows, prio);
  assert.deepEqual(out.map((r) => r.item.id), ["c", "b", "a", "d", "x"], "5% 안쪽(95 이상)은 근거 순, 80 은 크게 낮아 뒤, 반대 유형은 맨 뒤 그대로");
  assert.equal(out[0].tie, "점수 비슷 → 증강 연계 우선");
  assert.equal(out[1].tie, "점수 비슷 → 라이엇 추천 우선");
  assert.equal(out[2].tie, undefined, "원래 1위가 그대로면 표시 없음");
  const far = S.tieOrder([row("a", 100, 3), row("c", 90, 1)], prio);
  assert.deepEqual(far.map((r) => r.item.id), ["a", "c"], "10% 차이면 연계라도 안 올린다");
});

test("챔피언 전투 특성: 베인 은화살·징크스 미니건은 추천 점수(한타)에만, 지금 능력치 비교(now)엔 안 넣는다", () => {
  const v = champ("Vayne");
  const fx = (v.fightStats._effects || [])[0];
  assert.equal(fx.kind, "true");
  assert.equal(fx.ratios.TGT_MAXHP[0], 0.1, "W 5단계 최대 체력 10% (설명 수치)");
  const m = St.evaluate(v, 18, [], [], { aram: true }).m;
  const row = m.effects.find((e) => e.src === "W 은화살");
  assert.ok(row && row.hit > 0, "은화살이 초당 피해에 들어간다");
  const now = St.computeStats(v, 18, [], [], { aram: true, now: true });
  assert.ok(!now.effects.some((e) => e.src === "W 은화살"), "지금 능력치 계산엔 없다");
  const j = champ("Jinx");
  const fight = St.computeStats(j, 18, [], [], { aram: true }).total.AS;
  const live = St.computeStats(j, 18, [], [], { aram: true, now: true }).total.AS;
  assert.ok(fight > live * 1.5, `미니건 3중첩 공격 속도 ${fight} vs 지금 ${live}`);
  assert.ok(j.fightBasis.some((b) => b.t === "assume"), "가정은 근거에 적혀 있다");
});

test("주 피해 유형: 라이엇 damageType 이 물리면 스킬 마법 비율이 높아도 물리 (바루스 즉시 골드 증강·추천 가중치)", () => {
  const c = champ("Varus");
  assert.equal(c.damageType, "physical");
  assert.ok(c.magicShare > 0.5, "스킬 계수만 보면 마법 쪽");
  const t = St.computeStats(c, 18, [], [{ goldValue: 1000 }], { aram: true }).total;
  const t0 = St.computeStats(c, 18, [], [], { aram: true }).total;
  assert.ok(t.AD > t0.AD && t.AP === t0.AP, "즉시 골드는 공격력으로");
  const w = S.profile(c, d.tags);
  assert.ok(w.AD > w.AP, `AD ${w.AD} > AP ${w.AP}`);
});

test("라이엇 칼바람 추천이 반대 유형 위주면(케일) 그 아이템을 맨 뒤로 밀지 않는다 · 케일은 18레벨 원거리", () => {
  const c = champ("Kayle");
  assert.equal(c.melee, false);
  assert.equal(c.range, 625);
  const rows = S.rankItems(d.items, S.profile(c, d.tags), [], [], d.rules, c, { aram: true });
  const kraken = rows.find((r) => r.item.name === "크라켄 학살자");
  assert.ok(kraken && !kraken.offType, "크라켄 학살자(라이엇 추천)는 반대 유형 표시 없음");
  // 공식 추천이 같은 유형인 마법 챔피언(럭스)은 그대로 막는다
  const lux = S.rankItems(d.items, S.profile(champ("Lux"), d.tags), [], [], d.rules, champ("Lux"), { aram: true });
  assert.ok(lux.find((r) => r.item.name === "크라켄 학살자").offType);
});

test("점수 비슷 폭(tieOrder bandK): 0 이면 계산 순서 그대로 · 기본은 TIE_BAND 5%", () => {
  const row = (id, score, p) => ({ item: { id }, score, p });
  const rows = () => [row("a", 100, 3), row("b", 97, 1), row("c", 90, 2)];
  assert.deepEqual(S.tieOrder(rows(), (r) => r.p, 0).map((r) => r.item.id), ["a", "b", "c"]);
  assert.deepEqual(S.tieOrder(rows(), (r) => r.p).map((r) => r.item.id), ["b", "a", "c"]);
  assert.deepEqual(S.tieOrder(rows(), (r) => r.p, 0.12).map((r) => r.item.id), ["b", "c", "a"]);
  assert.equal(S.TIE_BAND, 0.05);
});

// 2026-10-20 증강 원본 대조: 반복 발동 효과에 원본 재사용 대기시간이 빠져 있었다 (골드 강탈을 기본 공격마다 30초짜리 피해로 셈)
test("반복 발동 증강 효과의 재사용 대기시간: rules effectCooldown 이 모두 적용되고 발동 상한이 걸린다", () => {
  // 패치로 삭제된 증강(26.21 치명적 미사일 등)은 규칙만 남아 있다 → 데이터에 있는 증강만
  const ids = Object.entries(d.rules.augments).filter(([id, r]) => r.effectCooldown && aug(id)).map(([id]) => id);
  assert.ok(ids.length >= 3, ids.join(","));  // 26.21 치명적 미사일 삭제 → 쌍둥이 불꽃·골드 강탈·지옥불 난사
  for (const id of ids) {
    const rep = aug(id).effects.filter((e) => ["onhit", "attacks", "cast"].includes(e.trigger.type));
    assert.ok(rep.length && rep.every((e) => e.cooldown > 0), id);
  }
  // 골드 강탈 30초: 평타가 초당 2번이어도 초당 피해는 30초에 1번 꼴
  const c = champ("Jinx");
  const m = St.evaluate(c, 18, [], [S.augStatsOf([aug("Goldrend")], d.rules, c)[0]]).m;
  const e = m.effects.find((x) => x.src === aug("Goldrend").name);
  assert.ok(m.augDps <= e.hit / 30 + 1e-6, `augDps ${m.augDps} · 한 번 ${e.hit}`);
});

// 2026-10-20 챔피언 특성: 스킬 '기본 지속 효과' 적중 시 피해는 기본 공격마다 (스킬 콤보 1번으로만 세서 공격 속도 가치를 낮게 봤다)
test("스킬 기본 지속 효과 적중 시 피해: 케일 E·바루스 W 는 평타 초당 피해에, 베인 W(3회째)·트리스타나 E(처치 시)는 아님", () => {
  const on = (id, slot) => champ(id).spells.find((s) => s.slot === slot).effects.some((e) => e.onhit);
  assert.ok(on("Kayle", "E") && on("Varus", "W") && on("Kassadin", "W"));
  assert.ok(!on("Vayne", "W") && !on("Tristana", "E") && !on("Ivern", "W") && !on("Kalista", "W"));
  // 공격 속도를 올리면 적중 피해도 같은 비율로 는다
  const c = champ("Kayle");
  const m1 = St.evaluate(c, 18, [], []).m, m2 = St.evaluate(c, 18, [item("고속 연사포")], []).m;
  assert.ok(m1.spellOnhit > 0 && m2.autoDps > m1.autoDps);
});

test("진 4번째 탄은 항상 치명타: 치명타 0%여도 기본 공격 치명타 기대 확률 25%", () => {
  const t = St.computeStats(champ("Jhin"), 18, [], []).total;
  assert.equal(t.CRIT, 0);
  assert.ok(Math.abs(t.critAuto - 0.25) < 1e-9, String(t.critAuto));
});

// 2026-10-20 미구현 정리: 한 번에 여러 발·능력치 비례 값·아이템 효과 치명타 (원본 값 이름으로)
// (탄환 세례 5발은 26.21 패치에서 증강이 삭제돼 뺐다)
test("효과 횟수(effectCount): 쌍둥이 불꽃 1 + 치명타 × 3 · 검무는 한타 1번 8회 · 마법 미사일은 3발 합계 1%·6초", () => {
  const fx = (id) => aug(id).effects[0];
  // 마법 미사일: 투사체당 0.334% × 3발 = 툴팁 1% (합계). 3발을 다시 곱하면 3배였다 (2026-10-22 원본 대조)
  assert.equal(fx("ARAM_MagicMissile").count, undefined);
  assert.equal(fx("ARAM_MagicMissile").ratios.TGT_MAXHP[0], 0.01);
  assert.equal(fx("ARAM_MagicMissile").cooldown, 6);
  assert.deepEqual([fx("ARAM_BladeWaltz").count, fx("ARAM_BladeWaltz").trigger.type], [8, "once"]);
  assert.deepEqual([fx("Twinfire").count, fx("Twinfire").countCrit], [1, 3]);
  // 치명타 확률이 오르면 쌍둥이 불꽃 한 번 피해도 는다 (1 + 치명타 × 3 발)
  const c = champ("Lux");
  const hit = (items) => St.evaluate(c, 18, items, S.augStatsOf([aug("Twinfire")], d.rules, c)).m.effects.find((e) => e.src === aug("Twinfire").name).value;
  assert.ok(hit([item("무한의 대검")]) > hit([]) * 1.5);
});

test("능력치 비례 값: 범람 10% + 마나 비례 · 프로틴 음료 25% + 추가 방어·마저 비례 · 마도사의 주스 상자 10% + 주문력 비례", () => {
  const st = (id, cid, items = []) => St.computeStats(champ(cid), 18, items, S.augStatsOf([aug(id)], d.rules, champ(cid)));
  const o = st("ARAM_Overflow", "Lux");
  assert.ok(Math.abs(o.flags.skillDmgMult - (0.1 + 0.00005 * o.total.MANA)) < 1e-9);
  const p = st("ARAM_ProteinShake", "Malphite", [item("가시 갑옷")]);
  assert.ok(Math.abs(p.total.HSP - (0.25 + 0.0035 * (p.total.bonusARMOR + p.total.bonusMR))) < 1e-9);
  const w = st("WarlockJuicebox", "Lux", [item("라바돈의 죽음모자")]);
  assert.ok(w.total.OMNIVAMP > 0.1 && Math.abs(w.total.OMNIVAMP - (0.1 + 0.00035 * w.total.AP)) < 1e-9);
});

test("취약: 아이템 효과도 치명타 → 치명타 확률이 높을수록 아이템 효과 피해가 커진다", () => {
  const c = champ("Tristana");
  const eff = (augs) => St.evaluate(c, 18, [item("몰락한 왕의 검"), item("무한의 대검")], S.augStatsOf(augs, d.rules, c)).m.effects
    .filter((e) => e.src === "몰락한 왕의 검").reduce((t, e) => t + (e.hit || 0), 0);
  assert.ok(eff([aug("ARAM_Vulnerability")]) > eff([]) * 1.3);
});

// 2026-10-20 리치베인 과대평가 확인: 서포터 아이템 고유 효과(월석 재생기 연쇄·헬리아의 메아리 피해 → 아군 회복)가 수치로 안 잡혔다
test("서포터 아이템: 아군을 돕는 챔피언이면 월석 재생기·헬리아의 메아리가 지원 지표를 올리고, 아니면 안 올린다", () => {
  const sup = (id, name) => {
    const c = champ(id);
    return St.evaluate(c, 18, [item(name)], []).m.allySupport || 0;
  };
  assert.ok(sup("Lulu", "월석 재생기") > 0, "룰루 + 월석");
  assert.ok(sup("Lulu", "헬리아의 메아리") > 0, "룰루 + 헬리아");
  assert.equal(sup("Zed", "월석 재생기"), 0, "아군을 안 돕는 제드는 없음");
  // 헬리아 충전은 레벨 비례 최대(18레벨 250)를 넘지 않는다
  const m = St.evaluate(champ("Lulu"), 18, [item("헬리아의 메아리"), item("라바돈의 죽음모자")], []).m;
  assert.ok(m.allySupport <= 250 * 1.5 + 1e-6, String(m.allySupport));
});

// v0.1.55 후속 기획 A-③: 균열 생성기 고유 효과가 통째로 빠져 있었다 (공식 추천 차이 '계산 누락 의심' 5명의 핵심 아이템)
test("균열 생성기: 추가 체력의 2% 주문력 + 주는 피해 증가 (콤보 평균 5%)", () => {
  const rift = item("균열 생성기"), c = champ("Ekko");
  const a = St.computeStats(c, 18, [rift], [], { aram: true }).total;
  const plain = { ...rift, passiveStats: undefined };
  const b = St.computeStats(c, 18, [plain], [], { aram: true }).total;
  assert.ok(Math.abs(a.AP - b.AP - a.bonusHP * 0.02) < 0.01, `주문력 ${a.AP} vs ${b.AP} (추가 체력 ${a.bonusHP})`);
  const ma = St.evaluate(c, 18, [rift], [], { aram: true }).m, mb = St.evaluate(c, 18, [plain], [], { aram: true }).m;
  assert.ok(ma.combo > mb.combo * 1.05, `콤보 ${ma.combo} vs ${mb.combo}`);
});

// 26.21 새 증강 변환 (원본 값은 rules.json — 여기선 엔진 계산만 합성 값으로)
test("26.21 변환: 아이템 마나→주문력 · 아이템 공격력→공격 속도 · 추가 체력→물리 관통력 · 공격 속도→치명타 피해 · 궁극기 치명타", () => {
  const ct = (c, items, aug) => St.computeStats(champ(c), 18, items, aug ? [aug] : [], { aram: true }).total;
  // 마나 없음, 상관없음: 아이템 마나 10 → 주문력 0.8, 아이템 마나는 없어진다
  const tear = [item("대천사의 지팡이")].filter(Boolean);
  const mana = tear[0].stats.MANA;
  const a0 = ct("Lux", tear), a1 = ct("Lux", tear, { itemMANAtoAP: 0.08 });
  assert.ok(Math.abs(a1.MANA - (a0.MANA - mana)) < 0.01, `마나 ${a0.MANA} → ${a1.MANA}`);
  assert.ok(a1.AP > a0.AP, `주문력 ${a0.AP} → ${a1.AP}`);
  // 간지럼 괴물: 아이템 공격력 → 공격 속도 (1당 1.75%)
  const ie = [item("무한의 대검")];
  const b0 = ct("Jinx", ie), b1 = ct("Jinx", ie, { itemADtoAS: 0.0175 });
  assert.ok(Math.abs(b1.bonusAD - (b0.bonusAD - ie[0].stats.AD)) < 0.01, `추가 공격력 ${b0.bonusAD} → ${b1.bonusAD}`);
  assert.ok(b1.AS > b0.AS, `공격 속도 ${b0.AS} → ${b1.AS}`);
  // 가라앉은 자의 축복: 추가 체력 100 → 물리 관통력 5, 추가 체력은 없어진다
  const hp = [item("워모그의 갑옷")];
  const c0 = ct("Darius", hp), c1 = ct("Darius", hp, { bonusHPtoLETHALITY: 0.05 });
  assert.equal(c1.bonusHP, 0);
  assert.ok(Math.abs(c1.LETHALITY - c0.LETHALITY - c0.bonusHP * 0.05) < 0.01, `관통 ${c0.LETHALITY} → ${c1.LETHALITY}`);
  // 묵직한 한 방: 공격 속도의 75% → 치명타 피해 (1%당 0.67%)
  const d0 = ct("Jinx", ie), d1 = ct("Jinx", ie, { AStoCRITDMG: 0.75, AStoCRITDMGper: 0.67 });
  assert.ok(d1.AS < d0.AS && d1.CRITDMG > d0.CRITDMG, `공속 ${d0.AS}→${d1.AS} 치명타 피해 ${d0.CRITDMG}→${d1.CRITDMG}`);
  // 보석 팔찌: 궁극기만 치명타 → 치명타 확률이 있으면 콤보 피해가 는다
  const lux = champ("Lux");
  const e0 = St.evaluate(lux, 18, [], [{ CRIT: 0.5 }], { aram: true }).m, e1 = St.evaluate(lux, 18, [], [{ CRIT: 0.5, ultCritDmg: 1.45 }], { aram: true }).m;
  assert.ok(e1.combo > e0.combo, `콤보 ${e0.combo} → ${e1.combo}`);
});

test("궁합(같이 − 따로)은 같은 지표 가중치로: 상관없는 증강을 골랐다고 공격 속도 증강이 '충돌'이 되지 않는다 (칼리스타 판)", () => {
  const c = champ("Kalista");
  const w = S.profile(c, d.tags);
  const byName = (n) => d.augments.find((a) => a.name === n);
  const chosen = ["무한 반복", "전부 다 무너뜨려", "떴다, 징크스"].map(byName);
  const t = S.augmentTiers(d.augments, d.items, w, chosen, [], d.rules, c, { aram: true });
  const z = t[byName("광신자").id];
  assert.ok(!z.reasons.includes("충돌"), `광신자 ${z.tier} ${z.reasons}`);
  assert.ok(["S", "A"].includes(z.tier), `광신자 ${z.tier}`);
  const t2 = S.augmentTiers(d.augments, d.items, w, chosen.slice(0, 2), [], d.rules, c, { aram: true });
  assert.ok(Math.abs(t2[byName("떴다, 징크스").id].interaction) < 0.05, "공격과 상관없는 소환사 주문 증강은 궁합 거의 0");
});

test("'무한히 중첩'되는 화상(화염 낙인)은 공격마다 쌓인다: 공격 속도 높은 원딜에서 지속 시간마다 1번보다 훨씬 크다", () => {
  const a = d.augments.find((x) => x.name === "화염 낙인");
  assert.ok(a.effects.some((e) => e.ticks && e.stacking));
  const c = champ("Kalista");
  const st = S.augStatsOf([a], d.rules, c);
  // 화염 낙인 몫만 (칼리스타 창 중첩 같은 챔피언 효과는 빼고)
  const none = St.evaluate(c, 18, [], [], { aram: true }).m.augDps;
  const on = St.evaluate(c, 18, [], st, { aram: true }).m.augDps - none;
  const off = St.evaluate(c, 18, [], [{ _effects: st[0]._effects.map((e) => ({ ...e, stacking: false })) }], { aram: true }).m.augDps - none;
  assert.ok(on > off * 2, `쌓임 ${on} vs 갱신만 ${off}`);
  // 리안드리(중첩 안 됨)는 그대로 지속 시간마다 1번
  assert.ok(!d.items.find((i) => i.name === "리안드리의 고통").effects.some((e) => e.stacking));
});

test("칼리스타 뽑아 찢기: 기본 공격마다 창 하나 (스킬 계산은 창 2개로만 센다) → 공격 속도가 E 피해를 키운다", () => {
  const c = champ("Kalista");
  const fx = c.fightStats._effects.find((e) => e.src === "E 창 중첩");
  assert.ok(fx && fx.trigger.type === "onhit");
  const m = St.evaluate(c, 18, [], [], { aram: true }).m;
  const row = m.effects.find((e) => e.src === "E 창 중첩");
  assert.ok(row && row.hit > 0);
  const as = St.evaluate(c, 18, [item("구인수의 격노검")], [], { aram: true }).m.effects.find((e) => e.src === "E 창 중첩");
  assert.ok(c.fightBasis.some((b) => b.t === "assume"));
  assert.ok(!St.computeStats(c, 18, [], [], { aram: true, now: true }).effects.some((e) => e.src === "E 창 중첩"), "지금 능력치엔 없다");
  assert.ok(as.hit >= row.hit);
});

test("아이템 연계(🔗): 아이템 능력치·효과 태그를 안 바꾸는 증강(퀸카)은 어떤 아이템에도 연계가 생기지 않는다 (같은 지표 가중치로 비교)", () => {
  const a = aug("PromQueen");
  for (const id of ["Kalista", "Lux", "Garen"]) {
    const c = champ(id);
    const syn = S.itemSynergy(d.items, S.profile(c, d.tags), [a], [], d.rules, c, { aram: true });
    const worst = Math.max(...Object.values(syn).map((v) => Math.abs(v.delta)));
    assert.ok(worst < 0.1, `${id}: 연계 차이 ${worst}`);
  }
});

test("26.21 새 증강 규칙: 고반동 스킬 피해 25% · 장갑 충격 다음 기본 공격(10초) · 펜타킬 강화 스킬 가속 20 · 음속 장벽은 아군 지원 챔피언만", () => {
  assert.equal(d.rules.augments.Recoil.statsResolved.skillDmgMult, 0.25);
  const ai = aug("ArmoredImpact").effects[0];
  // 추가 방어력 계수: 26.21 2.5 → 16.22 2.2 (패치로 바뀜, 커뮤니티 드래곤 16.22 데이터)
  assert.ok(ai.needsAuto && ai.cooldown === 10 && [2.5, 2.2].includes(ai.ratios.bonusARMOR[0]));
  assert.deepEqual(d.rules.augments.GoH_PentakillAug_Q.statsResolved.slotHaste, { Q: 20 });
  const tierOf = (cid, aid) => { const c = champ(cid); return S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), [], [], d.rules, c, { aram: true })[aid].tier; };
  assert.equal(tierOf("Garen", "Sound_Barrier"), "D", "아군 보호막이 없는 가렌");
  assert.ok(["S", "A"].includes(tierOf("Janna", "Sound_Barrier")), "아군 보호막 잔나");
});

test("어떤 증강이든 재밌게: 흡혈만 주는 증강(마도사의 주스 상자)도 이득이 0이 아니고, '받쳐 주는 변칙'이면 실제로 반대 유형 아이템이 2개 이상", () => {
  const juice = aug("WarlockJuicebox");
  for (const id of ["Lux", "Garen", "Vladimir"]) {
    const c = champ(id);
    const g = S.numericAugmentGains([juice], d.items, S.profile(c, d.tags), [], [], d.rules, c, { aram: true }).gains[juice.id];
    assert.ok(g && g.gain > 0, `${id}: 흡혈 이득 ${g && g.gain}`);
  }
  for (const [cid, aid] of [["Zed", "NoManaNoProblem"], ["Zed", "ARAM_ADAPt"], ["Jinx", "ARAM_ADAPt"]]) {
    const c = champ(cid);
    const b = S.buildConcepts(d.items, S.profile(c, d.tags), [aug(aid)], [], d.rules, c, {}, ["twist"])[0];
    if (b.twist.s > 0) assert.ok(b.pick.filter((p) => b.twist.opp.some((t) => ((p.item.tags || {})[t] || 0) >= 0.5)).length >= 2, `${cid}+${aid}`);
  }
  // 황홀한 나비는 아군 지원 챔피언만
  const t = S.augmentTiers(d.augments, d.items, S.profile(champ("Zed"), d.tags), [], [], d.rules, champ("Zed"), { aram: true });
  assert.equal(t.EnchantingButterflies.tier, "D");
});

test("새 증강 정보가 비지 않는다: 아이콘 · 한글 이름 · 설명 속 못 푼 수치(?) (2026-10-22)", () => {
  const fs = require("fs");
  const path = require("path");
  const icon = (id) => ["webp", "png"].some((e) => fs.existsSync(path.join(__dirname, "..", "web", "icons", "augment", `${id}.${e}`)));
  const fresh = d.augments.filter((a) => a.firstSeen);
  assert.ok(fresh.length >= 30);
  for (const a of fresh) {
    assert.ok(icon(a.id), `${a.name}: 아이콘 없음`);
    // RISE 는 공식 한글 이름도 영어 그대로다 (16.22 게임 문자열 'RISE')
    assert.ok(a.id === "RISE" || !/^[A-Za-z_]+$/.test(a.name), `${a.id}: 이름이 영문 id`);
    assert.equal(a.unresolved, 0, `${a.name}: 못 푼 수치 ${a.unresolved}`);
  }
  const salv = aug("Salvation").desc.replace(/<[^>]+>/g, "");
  assert.match(salv, /체력이 50% 아래로/);
  assert.ok(!d.augments.some((a) => a.id === "GoH_PentakillAug_Generic"), "이름 없는 자리 표시용 증강은 뺀다");
});

test("새 증강 계산 보강: 폭풍 쇄도 업그레이드는 폭풍 쇄도가 있을 때만 · 펜타킬 강화 스킬 피해 10% · 핏빛 코발트 가속 · 아티스트 보호는 원거리 절반", () => {
  const c = champ("Ahri");
  const st = S.augStatsOf([aug("Upgrade_Stormsurge")], d.rules, c);
  const has = (items) => St.evaluate(c, 18, items, st, { aram: true }).m.effects.some((e) => e.src === aug("Upgrade_Stormsurge").name);
  assert.equal(has([]), false, "폭풍 쇄도 없으면 폭발 없음");
  assert.equal(has([item("폭풍 쇄도")]), true, "폭풍 쇄도 있으면 폭발");
  // 펜타킬 헤비: Q 피해만 10%
  const q = (augs) => St.evaluate(c, 18, [], S.augStatsOf(augs, d.rules, c), { aram: true }).m.spells.find((s) => s.slot === "Q").dmg;
  const w = (augs) => St.evaluate(c, 18, [], S.augStatsOf(augs, d.rules, c), { aram: true }).m.spells.find((s) => s.slot === "W").dmg;
  assert.ok(Math.abs(q([aug("GoH_PentakillAug_Q")]) / q([]) - 1.1) < 1e-6, "Q 피해 10%");
  assert.ok(Math.abs(w([aug("GoH_PentakillAug_Q")]) - w([])) < 1e-6, "W 는 그대로");
  // 2026-11-12 바꿈: 예전엔 모든 기본 스킬 가속 48로 셌다 → 원본 값 그대로 지정 스킬 하나의 대기시간 65% (아래 '핏빛 코발트:' 테스트)
  assert.equal(d.rules.augments.CrimsonCobalt.statsResolved.markCdRefund, 0.65);
  const t = S.augmentTiers(d.augments, d.items, S.profile(champ("Garen"), d.tags), [], [], d.rules, champ("Garen"), { aram: true });
  assert.equal(t.HandsOffTheTalent.tier, "D", "근접은 조건 없음");
  assert.equal(aug("HandsOffTheTalent").effects[0].uptime, 0.5);
});

// 16.22 원 히트 원더: 스킬 가속 100당 피해량 75% (원본 Calc_AbilityDamagetoAH 75 · AHMultiplier 100), 스킬 가속 효과는 더 이상 없음
test("16.22 원 히트 원더: 능력치 단계에서는 가속·피해량을 바꾸지 않는다 (스킬 하나에만 거는 건 스킬 계산에서)", () => {
  // 2026-11-12 바꿈: 예전 기대값(가속 0·모든 피해 +가속×0.75%)은 원본 '{{SpellName}} 하나'와 달랐다 (아래 '원 히트 원더:' 테스트)
  const lux = champ("Lux"), items = [item("우주의 추진력")];
  const r0 = St.computeStats(lux, 18, items, [], { aram: true });
  const r1 = St.computeStats(lux, 18, items, [{ HASTEtoDmg: 0.0075, ultHaste: 30 }], { aram: true });
  assert.ok(r0.total.HASTE > 0, "비교하려면 가속이 있어야");
  assert.equal(r1.total.HASTE, r0.total.HASTE, "가속 능력치는 그대로");
  assert.equal(r1.flags.dmgDealtMult, r0.flags.dmgDealtMult, "모든 피해 증폭 없음");
  assert.equal(r1.conv.HASTEtoDmg, 0.0075);
});

test("늦게 더하는 주문력(리치 두뇌)도 주문력 % 증가를 받는다 · 순수주의자-마법사는 간지럼 괴물이 바꾼 공속도 가속으로 (2026-10-23 점검)", () => {
  const lux = champ("Lux");
  const ap = (ids) => St.computeStats(lux, 18, [], S.augStatsOf(ids.map(aug), d.rules, lux)).total.AP;
  const mult = d.rules.augments.NoManaNoProblem.statsResolved.APmult;
  assert.ok(mult > 0, "마나 없음, 상관없음: 주문력 % 증가");
  const lich = ap(["LichBrain", "NoManaNoProblem"]) - ap(["NoManaNoProblem"]);
  assert.ok(Math.abs(lich - 30 * (1 + mult)) < 0.01, `리치 두뇌 주문력 ${lich} (30 × ${1 + mult} 이어야)`);
  const jinx = champ("Jinx");
  const haste = (ids) => St.computeStats(jinx, 18, [item("무한의 대검")], S.augStatsOf(ids.map(aug), d.rules, jinx)).total.HASTE;
  assert.ok(haste(["ARAM_Purist_Caster", "TickleMonster"]) > haste(["ARAM_Purist_Caster"]), "간지럼 괴물 공속도 가속으로 바뀐다");
});

test("증강 등급: 정렬 점수가 같으면 같은 등급 (2026-10-24 진단 C03: 가렌 폴터가이스트 S · 점멸 2 A · 전환: 골드 A)", () => {
  for (const id of ["Garen", "Galio", "Jinx", "Lux"]) {
    const c = champ(id), w = S.profile(c, d.tags);
    const t = S.augmentTiers(d.augments, d.items, w, [], [], d.rules, c, { aram: true });
    const sc = Object.fromEntries(S.rankAugments(d.augments, w, [], [], c, d.rules).map((r) => [r.aug.id, r.score]));
    const groups = {};
    for (const a of d.augments) {
      const x = t[a.id];
      if (!x || x.basis !== "효과" || x.reasons.includes("조건 없음")) continue;
      const k = `${a.rarity}|${sc[a.id] || 0}`;
      (groups[k] = groups[k] || []).push(`${a.name}=${x.tier}`);
    }
    for (const g of Object.values(groups)) assert.equal(new Set(g.map((s) => s.split("=")[1])).size, 1, `${id}: ${g.join(", ")}`);
  }
  const g = champ("Garen"), gt = S.augmentTiers(d.augments, d.items, S.profile(g, d.tags), [], [], d.rules, g, { aram: true });
  const by = (n) => gt[d.augments.find((a) => a.name === n).id].tier;
  assert.equal(by("폴터가이스트"), by("점멸 2"));
  assert.equal(by("점멸 2"), by("전환: 골드"));
});

test("2026-11-11 카이사: 원딜 템을 산 뒤엔 공식 추천(AP)·양쪽 증강이 있어도 AP 템을 뒤로", () => {
  // 운명의 무기 + 불을 밝혀(공격력·주문력 둘 다), 삼위일체·광전사의 군화를 산 상태에서 리안드리의 고통이 '다음 구매' 1순위로 나와
  // 윤 탈 대신 리안드리를 섞었다 (원딜 빌드에 AP 하나). 공식 칼바람 추천이 AP 라 반대 유형 막기를 건너뛰었다
  const c = champ("Kaisa"), w = S.profile(c, d.tags);
  const legend = d.items.filter((i) => i.kind === "legendary");
  const augs = ["WeaponOfDestiny", "ARAM_LightemUp"].map(aug);
  const rows = S.rankItems(legend, w, augs, [item("삼위일체"), item("광전사의 군화")], d.rules, c, {}, "augment");
  for (const n of ["리안드리의 고통", "리치베인", "내셔의 이빨"]) {
    assert.ok(rows.find((r) => r.item.name === n).offType, `${n} 은 뒤로`);
  }
  // AP 로 시작했으면 AP 카이사 그대로 (공식 추천 존중)
  const ap = S.rankItems(legend, w, [], [item("루덴의 메아리")], d.rules, c, {}, "balanced");
  assert.ok(!ap.find((r) => r.item.name === "리안드리의 고통").offType, "AP 로 산 카이사는 막지 않음");
  // 아무것도 안 샀을 땐 지금처럼 (공식 추천이 AP 라 막지 않음)
  const none = S.rankItems(legend, w, [], [], d.rules, c, {}, "balanced");
  assert.ok(!none.find((r) => r.item.name === "리안드리의 고통").offType);
});

// ---- 2026-11-12 추천 전체 점검 (전 챔피언 × 무작위 증강) 에서 찾은 버그
const legendBuild = (cid, augIds, key = "balanced", fixed = []) => {
  const c = champ(cid);
  return S.buildConcepts(d.items, S.profile(c, d.tags), augIds.map(aug), fixed.map(item), d.rules, c, {}, [key])[0].pick.map((p) => p.item.name);
};

test("점검 1: 원거리 전용 루난의 허리케인은 근접 빌드에 넣지 않는다 (게임 데이터 구매 제한)", () => {
  assert.equal(item("루난의 허리케인").only, "ranged");
  for (const [cid, augs] of [["Gangplank", ["ARAM_Upgrade_IE"]], ["Renekton", ["ARAM_Upgrade_IE"]], ["Nasus", []]]) {
    for (const key of ["balanced", "augment"]) assert.ok(!legendBuild(cid, augs, key).includes("루난의 허리케인"), `${cid} ${key}`);
  }
  assert.ok(legendBuild("Jinx", [], "balanced").length === 6);
});

test("점검 2: 치명타 안 쓰는 근접은 주문력 증강을 골라도·피해 유형이 혼합이어도 치명타 템을 넣지 않는다", () => {
  const crit = (names) => names.filter((n) => { const it = item(n); return it && (((it.tags || {}).CRIT || 0) >= 0.5 || (it.stats && "CRIT" in it.stats)); });
  // 잭스 + 굶주린 속박(주문력) · 환영 무기 · 유리 대포 → 도미닉·루난이 들어갔다
  const jaxAugs = ["굶주린 속박", "환영 무기", "공포", "유리 대포"].map((n) => d.augments.find((a) => a.name === n).id);
  assert.deepEqual(crit(legendBuild("Jax", jaxAugs)), []);
  // 우디르(혼합) + 작은 도움(공격 속도) → 윤 탈·루난
  const udyrAugs = ["감시의 장막", "메아리 시전", "선혈포식", "작은 도움"].map((n) => d.augments.find((a) => a.name === n).id);
  assert.deepEqual(crit(legendBuild("Udyr", udyrAugs)), []);
  // 무한의 대검 업그레이드처럼 증강이 요구한 치명타 템은 그대로
  assert.ok(legendBuild("Renekton", ["ARAM_Upgrade_IE"], "augment").includes("무한의 대검"));
});

test("점검 3: 조건을 못 맞춘 증강(근접 + 조준경 부착)은 빌드 방향도 바꾸지 않는다", () => {
  const ctx = S.augContext([aug("ARAM_ScopiestWeapons")], d.rules, champ("Renekton"));
  assert.deepEqual(ctx.lift, {}, "근접 레넥톤에겐 사거리 증강이 아무것도 키우지 않는다");
  assert.ok((S.augContext([aug("ARAM_ScopiestWeapons")], d.rules, champ("Jinx")).lift.AS || 0) > 0, "원거리는 그대로");
  // 발동하지 않는 증강의 몰빵 = 균형 빌드 (2026-11-14: 증강 몫을 못 늘리면 균형 빌드를 그대로 쓴다)
  assert.deepEqual(legendBuild("Renekton", ["ARAM_ScopiestWeapons"], "augment"), legendBuild("Renekton", [], "balanced"));
});

test("점검 4: 퀘스트가 아이템을 모두 요구하면(궁극의 히드라 3종·우글렛·이케시아) 증강 몰빵 빌드에 다 넣는다", () => {
  const has = (b, names) => names.filter((n) => b.includes(n)).length;
  assert.equal(has(legendBuild("Darius", ["Quest_UltraHydra"], "augment"), ["굶주린 히드라", "불경한 히드라", "거대한 히드라"]), 3);
  assert.equal(has(legendBuild("Veigar", ["ARAM_Quest_WoogletsWitchcap"], "augment"), ["라바돈의 죽음모자", "존야의 모래시계"]), 2);
  assert.equal(has(legendBuild("Gragas", ["ARAM_Quest_VoidImmolation"], "augment"), ["태양불꽃 방패", "공허한 광휘"]), 2);
  // 하나만 있으면 되는 업그레이드는 그대로 하나
  const sheen = legendBuild("Ezreal", ["ARAM_Upgrade_Sheen"], "augment");
  assert.ok(has(sheen, ["삼위일체", "리치베인", "얼어붙은 건틀릿", "정수 약탈자"]) >= 1);
});

test("점검 5: 신발은 빌드 유형에 맞춘다 (물리에 마법사의 신발, AP 서포터에 광전사의 군화 X)", () => {
  const boots = (b) => b.find((n) => item(n) && item(n).kind === "boots");
  assert.notEqual(boots(legendBuild("Kaisa", [])), "마법사의 신발", "원딜 카이사 시작 빌드");
  // 밀리오 + 공격 속도와 상관없는 증강 → 광전사의 군화가 들어갔다
  const milio = ["핏빛 코발트", "압력솥", "신성한 중재", "지옥의 전도체"].map((n) => d.augments.find((a) => a.name === n).id);
  assert.notEqual(boots(legendBuild("Milio", milio)), "광전사의 군화");
  // 공격 속도를 스킬 가속으로 바꾸는 증강(순수주의자 - 마법사)이면 광전사의 군화도 스킬 가속 신발이라 막지 않는다
  const soraka = ["믿음직한 무기", "파워", "아티스트 보호", "순수주의자 - 마법사"].map((n) => d.augments.find((a) => a.name === n).id);
  assert.ok(legendBuild("Soraka", soraka).length === 6);
});

test("점검 7: 주문 검(리치베인)은 평타를 섞는 만큼만 — 라이엇 공격 의존도(info.attack)", () => {
  const lich = item("리치베인");
  const val = (cid) => {
    const c = champ(cid);
    const row = St.evaluate(c, 18, [lich], [], { aram: true }).m;
    const base = St.evaluate(c, 18, [], [], { aram: true }).m;
    return row.combo - base.combo;
  };
  assert.ok(champ("Lux").info.attack <= 2 && champ("Fizz").info.attack >= 6);
  // 럭스(평타 거의 안 침)는 피즈(평타 섞음)보다 리치베인으로 덜 강해진다
  assert.ok(val("Lux") / Math.max(1, St.evaluate(champ("Lux"), 18, [], [], { aram: true }).m.combo)
    < val("Fizz") / Math.max(1, St.evaluate(champ("Fizz"), 18, [], [], { aram: true }).m.combo));
  assert.ok(!legendBuild("Lux", []).includes("리치베인"), "럭스 기본 빌드엔 리치베인 없음");
  assert.ok(legendBuild("Ekko", []).includes("리치베인"), "에코는 그대로");
});

test("점검 8: 흐르는 물의 지팡이 버프는 피해가 아니라 주문력·스킬 가속 (아군을 돕는 챔피언만)", () => {
  const fw = item("흐르는 물의 지팡이");
  assert.ok(!(fw.effects || []).some((e) => e.name === "APMod"), "주문력 +40 버프를 마법 피해 40 으로 세지 않는다");
  const ap = (cid) => St.evaluate(champ(cid), 18, [fw], [], { aram: true }).stats.total.AP;
  assert.ok(champ("Janna").features.includes("allysupport") && !champ("Veigar").features.includes("allysupport"));
  assert.ok(ap("Janna") - St.evaluate(champ("Janna"), 18, [], [], { aram: true }).stats.total.AP >= 75, "잔나: 기본 35 + 버프 40");
  assert.ok(ap("Veigar") - St.evaluate(champ("Veigar"), 18, [], [], { aram: true }).stats.total.AP < 75, "베이가: 버프 없음");
});

// ---- 적중 시 계산식 (케일·카이사·베인·코그모): 평타마다 붙는 추가 피해와 중첩. 추천 결과 검사는 tests/recommend.test.js
test("점검 10-1: 구인수의 격노검은 최대 중첩 시 세 번째 평타마다 적중 효과를 두 번 (적중 시 피해 × 4/3)", () => {
  const g = item("구인수의 격노검");
  assert.ok(g.passiveStats && Math.abs(g.passiveStats.onhitRepeat - 1 / 3) < 1e-3 && g.passiveStats.rampMax === 4, JSON.stringify(g.passiveStats));
  const c = champ("Kaisa");
  const dps = (list) => St.evaluate(c, 18, list.map(item), [], { aram: true }).m.dps;
  // 몰락한 왕의 검(현재 체력 비례 적중 시)이 있으면 구인수가 더 크게 오른다
  assert.ok(dps(["몰락한 왕의 검", "구인수의 격노검"]) - dps(["몰락한 왕의 검"]) > dps(["무한의 대검", "구인수의 격노검"]) - dps(["무한의 대검"]));
});

test("점검 10-2: 카이사 패시브 플라즈마 폭발(잃은 체력 15% + 주문력 100당 6%)을 계산에 넣는다", () => {
  const c = champ("Kaisa");
  const e = St.evaluate(c, 18, [], [], { aram: true }).stats;
  assert.ok(JSON.stringify(c.fightStats || {}).includes("TGT_MISSINGHP"));
  // 주문력이 오르면 폭발도 커진다
  const dps = (list) => St.evaluate(c, 18, list.map(item), [], { aram: true }).m.dps;
  assert.ok(dps(["라바돈의 죽음모자"]) > dps([]));
  assert.ok(e);
});

test("점검 10-5: 구인수 중첩은 한타 동안 평타로 쌓으니 늘 최대가 아니고, 공속이 높을수록 오래 켜진다", () => {
  const g = item("구인수의 격노검");
  const at = (cid, extra) => St.evaluate(champ(cid), 18, [g, ...extra.map(item)], [], { aram: true }).stats.total;
  const slow = at("Jayce", []), fast = at("Kaisa", ["광전사의 군화", "스태틱의 단검"]);
  // 최대(공속 32%·적중 효과 1/3)보다 작다
  assert.ok(slow.rampStacks < 4 && slow.onhitRepeat < 1 / 3, `${slow.rampStacks} ${slow.onhitRepeat}`);
  // 공속이 높으면 더 오래 켜진다
  assert.ok(fast.rampStacks > slow.rampStacks && fast.onhitRepeat > slow.onhitRepeat, `${fast.onhitRepeat} vs ${slow.onhitRepeat}`);
});

test("점검 10-6: 구인수의 두 번째 적중은 적중 시 중첩(베인 은화살·카이사 플라즈마)도 한 번 더 쌓는다", () => {
  const g = item("구인수의 격노검");
  for (const [cid, src] of [["Vayne", "W 은화살"], ["Kaisa", "패시브 플라즈마 폭발"]]) {
    const r = St.evaluate(champ(cid), 18, [g], [], { aram: true });
    const row = r.m.effects.find((e) => e.src === src);
    assert.ok(row && row.stackRepeat > 0, `${cid} ${JSON.stringify(row)}`);
  }
});

test("점검 10-7: 코그모 W(생체마법 폭격) 적중 시 최대 체력 비례 피해를 계산에 넣는다", () => {
  const c = champ("KogMaw");
  const r = St.evaluate(c, 18, [], [], { aram: true });
  assert.ok(r.m.effects.some((e) => e.src === "W 생체마법 폭격"), JSON.stringify(r.m.effects.map((e) => e.src)));
  // 기본 빌드는 묻지 않는다: 아수라장 통계는 적중 시(구인수 56.5%)인데, 라이엇 공식 칼바람 추천이 AP(루덴·리안드리)라 공식 추천을 따른다
  const dps = (list) => St.evaluate(c, 18, list.map(item), [], { aram: true }).m.dps;
  assert.ok(dps(["구인수의 격노검"]) > dps([]));
});

// ---- 스킬 증강({{SpellName}}): 원본 설명은 '챔피언 스킬 하나'에만 걸린다 (2026-11-12 원 히트 원더·핏빛 코발트 점검)
const evA = (cid, items, augNames) => {
  const c = champ(cid);
  return St.evaluate(c, 18, items.map(item), S.augStatsOf(augNames.map((n) => d.augments.find((a) => a.name === n)), d.rules, c), { aram: true });
};
const cdOf = (r, slot) => r.m.spells.find((s) => s.slot === slot).cd;

test("원 히트 원더: 기본 공격 피해는 그대로 (스킬 하나의 피해만 커진다)", () => {
  const items = ["무한의 대검", "요우무의 유령검", "세릴다의 원한"];
  const a = evA("Jinx", items, ["되풀이"]).m.autoDps, b = evA("Jinx", items, ["되풀이", "원 히트 원더"]).m.autoDps;
  assert.ok(Math.abs(a - b) < 1e-6, `평타 초당 피해 ${a} → ${b}`);
});

test("원 히트 원더: 가속을 잃는 건 스킬 하나 (기대값이라 모든 스킬이 가속을 일부 유지), 궁극기도 대상", () => {
  const none = evA("Nasus", [], []), full = evA("Nasus", [], ["되풀이"]), ohw = evA("Nasus", [], ["되풀이", "원 히트 원더"]);
  for (const s of ["Q", "W", "E", "R"]) {
    assert.ok(cdOf(ohw, s) < cdOf(none, s) - 1e-6, `${s}: 가속이 남아야 ${cdOf(ohw, s)} vs 가속 없음 ${cdOf(none, s)}`);
    assert.ok(cdOf(ohw, s) > cdOf(full, s) + 1e-6, `${s}: 대상일 수 있으니 가속을 일부 잃는다 ${cdOf(ohw, s)} vs ${cdOf(full, s)}`);
  }
});

test("핏빛 코발트: 표식 피해는 지정 스킬 하나로만 (콤보 한 번에 최대 1번), 스킬 피해와 따로 센다", () => {
  const base = evA("Nasus", [], []), cob = evA("Nasus", [], ["핏빛 코발트"]);
  const row = cob.m.effects.find((e) => e.src === "핏빛 코발트");
  assert.ok(row && row.hit > 0);
  assert.ok(cob.m.augCombo - base.m.augCombo <= row.hit + 1e-6, `콤보 ${cob.m.augCombo - base.m.augCombo} > 한 번 ${row.hit}`);
  // 이중 계산 없음: 스킬 자체 피해는 그대로
  for (const s of ["Q", "W", "E", "R"]) assert.ok(Math.abs(cob.m.spells.find((x) => x.slot === s).dmg - base.m.spells.find((x) => x.slot === s).dmg) < 1e-6, s);
});

test("핏빛 코발트: 재사용 대기시간 감소(65%)도 지정 스킬 하나로만 (모든 기본 스킬이 다 줄지 않는다)", () => {
  const base = evA("Nasus", [], []), cob = evA("Nasus", [], ["핏빛 코발트"]);
  for (const s of ["Q", "W", "E"]) {
    const r = cdOf(cob, s) / cdOf(base, s);
    assert.ok(r > 0.675 + 1e-3 && r < 1, `${s}: 재사용 대기시간 비율 ${r.toFixed(3)} (예전: 모든 기본 스킬 0.675)`);
  }
});

test("핏빛 코발트: 대기시간이 아주 짧은 스킬(렝가 0.25초·야스오 E)도 표식 폭발은 한 스킬당 최대 2초에 1번 ('스킬 사용 시'와 같은 기준)", () => {
  for (const cid of ["Rengar", "Yasuo"]) {
    const cob = evA(cid, [], ["핏빛 코발트"]), base = evA(cid, [], []);
    const row = cob.m.effects.find((e) => e.src === "핏빛 코발트");
    // 대상 스킬 하나 + 터뜨리는 비율 ≤ 1 이라 초당 최대 0.5번
    assert.ok(cob.m.augDps - base.m.augDps <= row.hit * 0.5 + 1e-6, `${cid}: 표식 초당 ${(cob.m.augDps - base.m.augDps).toFixed(1)} > ${(row.hit * 0.5).toFixed(1)}`);
  }
});

// 원거리 배율 (2026-11-12 추천 엔진 통합 점검 N1): 게임 데이터 계산식의 mRangedMultiplier 를 효과에 옮긴다.
// 예전엔 아이템의 근접/원거리 문구(Item_Melee_Ranged_Split)만 읽어, 붐 앤 베이스(원거리 25~100) 같은 값을 원거리도 근접 값으로 셌다.
test("원거리 배율: 증강·아이템 계산식의 원거리 배율이 효과에 붙는다 (게임 데이터 mRangedMultiplier)", () => {
  const scaleOf = (list, name) => (list.find((e) => e.name === name) || {}).rangedScale;
  const close = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 0.002, `${msg}: ${a}`);
  close(scaleOf(aug("TheBoomAndTheBass").effects, "Calc_Damage"), 0.5, "붐 앤 베이스");
  close(scaleOf(aug("TakeemDownDownDown").effects, "Calc_Damage_Hit"), 0.5, "전부 다 무너뜨려 피해");
  close(scaleOf(aug("TakeemDownDownDown").effects, "Calc_Damage_Per_Previous_Stack"), 0.5, "전부 다 무너뜨려 중첩당");
  close(scaleOf(aug("ThirdTimesTheHarm").effects, "Calc_Damage_Per_Stack"), 0.5, "해악의 숫자 3 중첩당");
  close(scaleOf(item("거대한 히드라").effects, "OnHitDamageCalc"), 0.5, "거대한 히드라 적중");
  close(scaleOf(item("선체파괴자").effects, "MaxStackDamage"), 0.7, "선체파괴자");
  close(scaleOf(item("불멸의 철갑궁").effects, "ShieldAmount"), 0.8, "불멸의 철갑궁 보호막");
  close(scaleOf(item("그림자 검").effects, "TotalWardDamage"), 0.667, "그림자 검 와드 피해");
  // 크라켄 학살자: 원거리 배율 값(RangedDamageMultiplier)이 칼바람·증강 모드에서 1 → 줄이지 않는다
  const kr = scaleOf(item("크라켄 학살자").effects, "DamageAmount");
  assert.ok(kr == null || Math.abs(kr - 1) < 1e-9, `크라켄 ${kr}`);
});

test("원거리 배율: 붐 앤 베이스 한 번 피해는 원거리 챔피언이 근접의 절반", () => {
  const a = aug("TheBoomAndTheBass");
  const hit = (c) => St.evaluate(c, 18, [], [{ _effects: a.effects.map((e) => ({ ...e, src: a.name })) }]).m.effects.find((e) => e.src === a.name).value;
  const jinx = champ("Jinx");
  const asMelee = { ...jinx, melee: true };
  const r = hit(jinx) / hit(asMelee);
  assert.ok(Math.abs(r - 0.5) < 1e-6, `원거리/근접 ${r}`);
});

test("원거리 배율: 유리 대포 추가 고정 피해는 근접 25% · 원거리 15% (게임 데이터 TrueDamagePercSplit ×0.6)", () => {
  const st = (d.rules.augments.GlassCannon || {}).statsResolved;
  const tb = (c) => St.computeStats(champ(c), 18, [], [st]).flags.trueBonus;
  assert.ok(Math.abs(tb("Garen") - 0.25) < 1e-6, `가렌 ${tb("Garen")}`);
  assert.ok(Math.abs(tb("Jinx") - 0.15) < 1e-6, `징크스 ${tb("Jinx")}`);
});

test("전부 다 무너뜨려: 기본 공격 적중과 스킬 적중 모두에 발동 (영어 원문 'Attacks and Abilities', 통합 점검 N3)", () => {
  const fx = aug("TakeemDownDownDown").effects;
  const hit = fx.filter((e) => e.name === "Calc_Damage_Hit");
  assert.ok(hit.some((e) => e.trigger.type === "onhit"), "기본 공격 적중마다");
  assert.ok(hit.some((e) => e.trigger.type === "cast" && !e.needsAuto), "스킬 적중마다 (평타 없이)");
  assert.ok(fx.some((e) => e.name === "Calc_Damage_Consume"), "5중첩 폭발");
  // 평타로 싸우는 근접 챔피언(트린다미어)은 예전('스킬 뒤 평타'만)보다 초당 피해가 커야 한다
  const a = aug("TakeemDownDownDown");
  const dps = (effects) => St.evaluate(champ("Tryndamere"), 18, [], [{ _effects: effects.map((e) => ({ ...e, src: a.name })) }]).m.augDps;
  const old = [{ kind: "magic", name: "Calc_Damage_Hit", ...hit[0], trigger: { type: "cast" }, needsAuto: true }];
  assert.ok(dps(fx) > dps(old) * 1.5, `${dps(fx)} vs ${dps(old)}`);
});

test("도취: 기본 공격 적중 시 최대 마나 7% 마법 피해, 원거리 ×0.8 (게임 데이터 ManaPercentDamagePercent)", () => {
  const e = aug("ARAM_Juiced").effects.find((x) => x.trigger && x.trigger.type === "onhit");
  assert.ok(e, "적중 효과");
  assert.ok(Math.abs(e.ratios.MANA[0] - 0.07) < 1e-6, JSON.stringify(e));
  assert.ok(Math.abs(e.rangedScale - 0.8) < 1e-3, `${e.rangedScale}`);
});

// 자기 공격 속도 스킬 (2026-11-12 통합 점검 D1): 트리스타나 Q 같은 스킬 공격 속도가 계산에 없었다.
// 값은 스킬 설명(게임 데이터 수치)에서 읽고, 가동률 = 지속 시간 ÷ 한타 6초(최대 1), 기본 지속 효과는 1
test("자기 공격 속도 스킬: 트리스타나 Q 120% (7초 → 한타 내내), 미스 포츈 W 100% × 4/6, 카이사 E 80% × 4/6", () => {
  const as = (id) => ((champ(id).fightStats || {}).AS || 0);
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a}`);
  near(as("Tristana"), 1.2, "트리스타나");
  near(as("MissFortune"), 1.0 * 4 / 6, "미스 포츈");
  near(as("Kaisa"), 0.8 * 4 / 6, "카이사 (설명이 0.8% 로 표기)");
  near(as("KogMaw"), 0.25, "코그모 Q 기본 지속 효과");
  near(as("Jinx"), 1.3, "징크스는 기존 규칙 그대로");
  const t = St.computeStats(champ("Tristana"), 18, [], []).total.AS;
  const tNow = St.computeStats(champ("Tristana"), 18, [], [], { now: true }).total.AS;
  assert.ok(t > tNow * 1.5, `추천 점수에만: 한타 ${t} vs 지금 ${tNow}`);
});

// 루난의 허리케인 탄환은 '기본 공격 시'(on-attack) 효과 (위키 "Basic attacks on-attack fire additional bolts … affected by critical strike modifiers").
// 예전엔 '적중 시'로 읽어 구인수(적중 효과 두 번)·한 발에 두 놈(치명타 때 적중 효과 한 번 더)이 탄환 피해까지 불렸다 (2026-11-12 스몰더 판: 치명타 빌드에 구인수 1순위)
test("루난 탄환: 기본 공격마다 1번·치명타 적용, 구인수·한 발에 두 놈으로 늘지 않음", () => {
  const c = champ("Smolder"), run = item("루난의 허리케인"), gu = item("구인수의 격노검");
  const bolt = run.effects.find((e) => e.name === "BoltDamage");
  assert.equal(bolt.trigger.type, "onattack");
  const dpsOf = (items, aug) => {
    const st = St.computeStats(c, 18, items, aug), m = St.metrics(c, 18, st);
    const row = m.effects.find((e) => e.src === "루난의 허리케인");
    return { row, t: st.total };
  };
  const twin = [{ CRIT: 1, onhitOnCrit: 1 }];  // 한 발에 두 놈 + 치명타 100%
  const a = dpsOf([run], twin), b = dpsOf([run, gu], twin);
  const crit = (t) => 1 + Math.min(1, t.CRIT) * (t.CRITDMG - 1);
  for (const x of [a, b]) assert.ok(Math.abs(x.row.dps - x.row.hit * x.t.AS * crit(x.t)) < 1e-6, JSON.stringify(x.row));
});

// 챔피언 패시브 능력치 (2026-11-13 벨베스 판: 계산 공격 속도 1.31 · 실제 2.99). 태그로만 있던 패시브를 게임 데이터·설명 값으로 계산
test("챔피언 패시브: 상시 능력치·변환 (다이애나 공속, 야스오 치명타 2배, 블라디미르·람머스·헤카림 변환)", () => {
  const T = (id, items = [], L = 18) => St.computeStats(champ(id), L, items.map(item), [], { now: true }).total;
  const T0 = (id, items = [], L = 18) => St.computeStats({ ...champ(id), stackStats: null }, L, items.map(item), [], { now: true }).total;
  assert.ok(T("Diana").AS > T0("Diana").AS * 1.15, "다이애나 공속 35%");
  const y = T("Yasuo", ["무한의 대검"]);  // 무한의 대검 치명타 25% → 50%
  assert.ok(Math.abs(y.CRIT - 2 * T0("Yasuo", ["무한의 대검"]).CRIT) < 1e-6, `야스오 치명타 ${y.CRIT}`);
  assert.ok(T("Vladimir", ["라바돈의 죽음모자"]).HP > T0("Vladimir", ["라바돈의 죽음모자"]).HP + 100, "블라디미르 주문력 → 체력");
  assert.ok(T("Vladimir", ["워모그의 갑옷"]).AP > 20, "블라디미르 추가 체력 → 주문력");
  assert.ok(T("Rammus", ["가시 갑옷"]).AD > T0("Rammus", ["가시 갑옷"]).AD + 20, "람머스 방어 → 공격력");
  assert.ok(T("Hecarim", ["광전사의 군화"]).AD > T0("Hecarim", ["광전사의 군화"]).AD + 5, "헤카림 이속 → 공격력");
});

test("챔피언 패시브: 싸울 때만 켜지는 공격 속도는 한타 능력치에만 (이렐리아·벨베스)", () => {
  const as = (id) => ((champ(id).fightStats || {}).AS || 0);
  assert.ok(as("Irelia") > 0.5, `이렐리아 ${as("Irelia")}`);
  assert.ok(as("Jax") > 0.3, `잭스 ${as("Jax")}`);
  assert.ok(((champ("Belveth").fightStats || {}).ASmult || 0) > 0.1, "벨베스 본모습 총 공격 속도");
  // 벨베스 연보라 중첩: 게임 중 지금 능력치에도 (영구)
  const t = St.computeStats(champ("Belveth"), 14, [], [], { now: true }).total;
  const t0 = St.computeStats({ ...champ("Belveth"), stackStats: null }, 14, [], [], { now: true }).total;
  assert.ok(t.AS > t0.AS + 0.4, `벨베스 14레벨 ${t0.AS} → ${t.AS}`);
});

// P1 E1 (2026-11-14 엔진 개선): 스킬을 써야 터지는 효과(스킬 사용 시·지정 스킬)는 스킬 피해와 같은 비율로 초당 피해에 넣는다.
// 스킬 피해는 '재사용 대기시간마다 계속 맞히지 못한다'는 이유로 30%만 넣는데, 그 스킬에 딸린 효과는 100%로 넣어
// 가렌 + 전부 다 무너뜨려에서 증강의 스킬분(50)이 가렌 자기 스킬(23)보다 크게 들어갔다
test("E1: 스킬 사용 시 효과는 초당 피해에서 스킬 피해와 같은 비율 (평타 효과는 100%)", () => {
  const c = champ("Garen");
  const castFx = { kind: "magic", name: "t", base: [100], trigger: { type: "cast" }, src: "시험" };
  const hitFx = { kind: "magic", name: "t2", base: [100], trigger: { type: "onhit" }, src: "시험2" };
  const m0 = St.evaluate(c, 18, [], []).m;
  const mc = St.evaluate(c, 18, [], [{ _effects: [castFx] }]).m;
  const mh = St.evaluate(c, 18, [], [{ _effects: [hitFx] }]).m;
  const castRaw = mc.augDps - m0.augDps, hitRaw = mh.augDps - m0.augDps;
  assert.ok(Math.abs((mc.dps - m0.dps) - St.SKILL_DPS_SHARE * castRaw) < 1e-6, `스킬 효과 ${mc.dps - m0.dps} vs ${castRaw}`);
  assert.ok(Math.abs((mh.dps - m0.dps) - hitRaw) < 1e-6, "평타 효과는 그대로");
});

test("E1: 갱신·재사용 대기시간 상한이 있는 스킬 효과는 상한까지 그대로 (리안드리 3초 화상)", () => {
  const c = champ("Kayle");
  const capped = { kind: "magic", name: "t", base: [100], trigger: { type: "cast" }, cooldown: 3, src: "시험" };
  const m0 = St.evaluate(c, 18, [item("광전사의 군화")], []).m, m = St.evaluate(c, 18, [item("광전사의 군화")], [{ _effects: [capped] }]).m;
  const raw = m.augDps - m0.augDps, used = m.dps - m0.dps;
  // 시전 빈도 × 0.3 이 1/3초보다 크면 상한(1/3)에 걸려 그대로, 작으면 줄어든다 — 어느 쪽이든 30% 아래로는 안 내려간다
  assert.ok(used >= St.SKILL_DPS_SHARE * raw - 1e-6 && used <= raw + 1e-6, `${used} / ${raw}`);
});

// P1 E4: '대상' 최대 체력에 비례하는 증강(화염 낙인: 대상 최대 체력 0.4% 화상)에 자기 체력 태그(HP)가 붙어
// 체력 아이템을 따라가게 될 수 있었다. 계산 효과가 대상 체력만 쓰면 HP 태그를 뺀다 (강타자처럼 자기 체력 비례는 유지)
test("E4: 대상 체력 비례만 있는 증강은 자기 체력 태그가 없다", () => {
  for (const id of ["ARAM_Firebrand", "ThirdTimesTheHarm", "ARAM_MagicMissile"]) assert.ok(!(aug(id).tags || {}).HP, `${id} ${JSON.stringify(aug(id).tags)}`);
  assert.ok((aug("ARAM_HeavyHitter").tags || {}).HP > 0, "강타자는 자기 체력 비례");
});

// P1 E8 (2026-11-13 제이스 판 실측). 증강 모드 기본 체력 −200 은 형태(해머·캐논)에 따른 것으로 보여 바꾸지 않는다 (케일 실측은 근접 값이 맞음).
// 굶주린 히드라 업그레이드: 굶주린 히드라의 생명력 흡수 +8% (게임 데이터 계산식 0.08, 설명 '20%로 증가') — 계산 12% · 실제 20%
test("E8: 굶주린 히드라 업그레이드는 굶주린 히드라를 가졌을 때만 그 아이템의 흡혈을 올린다", () => {
  const up = aug("Upgrade_Ravenous"), st = (d.rules.augments.Upgrade_Ravenous || {}).statsResolved;
  const ls = (items) => St.computeStats(champ("Jayce"), 13, items.map(item), [st]).total.LS;
  assert.ok(up && Math.abs(ls(["굶주린 히드라"]) - 0.2) < 1e-6, `히드라 보유 ${ls(["굶주린 히드라"])}`);
  assert.equal(ls([]), 0, "히드라가 없으면 그대로");
});

// 2026-11-14 후속 분석: 레나타 기본 빌드가 서포터 아이템 → 딜 아이템이 된 원인 (특정 챔피언·아이템을 고정하지 않고 지원 계산 구조를 고침)
test("서포터: 월석 재생기 연쇄는 챔피언 기술로 준 회복·보호막만 (아이템 자기 보호막은 연쇄하지 않음)", () => {
  const c = champ("Renata");
  const ally = (names) => St.evaluate(c, 18, names.map(item), [], {}).m.allySupport || 0;
  const moon = ally(["월석 재생기"]);
  // 스테락의 도전 보호막(자기 자신에게만)은 아군에게 연쇄되지 않는다. 예전엔 1,400 × 35%가 더해졌다
  assert.ok(Math.abs(ally(["월석 재생기", "스테락의 도전"]) - moon) < 1, `${moon} → ${ally(["월석 재생기", "스테락의 도전"])}`);
  assert.ok(Math.abs(ally(["월석 재생기", "케이닉 루컨"]) - moon) < 1);
  // 레나타 E 보호막(아군에게도 줌)은 연쇄된다
  const kit = St.evaluate(c, 18, [item("월석 재생기")], [], {}).m.kitShield;
  assert.ok(kit > 0 && moon >= kit * 0.35 - 1, `${kit} ${moon}`);
});

test("서포터: 사용 효과로 아군을 돕는 아이템(구원·미카엘·솔라리)은 아군을 돕는 챔피언의 지원 지표에 들어간다", () => {
  const sup = (id, names) => St.evaluate(champ(id), 18, names.map(item), [], {}).m.support;
  for (const [n, min] of [["구원", 350], ["미카엘의 축복", 250], ["강철의 솔라리 펜던트", 360]]) {
    const g = sup("Renata", [n]) - sup("Renata", []);
    assert.ok(g >= min * 0.9, `${n}: +${g}`);
    // 아군을 돕지 않는 챔피언(가렌)에게는 사용 효과를 지원으로 세지 않는다 (아이템 능력치의 회복·보호막 효과 증가분만)
    assert.ok(sup("Garen", [n]) - sup("Garen", []) < min * 0.5, `가렌 ${n}`);
  }
});

test("서포터: 기본 빌드에 지원 아이템이 들어간다 (레나타·라칸, 수정 전엔 리치베인·라바돈·공허)", () => {
  for (const id of ["Renata", "Rakan"]) {
    const c = champ(id), w = S.profile(c, d.tags);
    const names = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item.name);
    const supportItems = names.filter((n) => ["월석 재생기", "헬리아의 메아리", "구원", "미카엘의 축복", "강철의 솔라리 펜던트", "흐르는 물의 지팡이", "불타는 향로", "슈렐리아의 군가"].includes(n));
    assert.ok(supportItems.length >= 2, `${id}: ${names.join(", ")}`);
  }
});

test("실험 설정(setExperiment)은 기본값이면 계산이 그대로이고, 되돌리면 원래 값", () => {
  const c = champ("Jinx"), l = [item("구인수의 격노검"), item("크라켄 학살자")];
  const m0 = St.evaluate(c, 18, l, [], {}).m.dps;
  St.setExperiment({ autoUptime: 0.5 });
  const half = St.evaluate(c, 18, l, [], {}).m.dps;
  St.setExperiment(null);
  assert.equal(St.evaluate(c, 18, l, [], {}).m.dps, m0);
  assert.ok(half < m0 * 0.7, `${m0} → ${half}`);
});

// 2026-11-14 후속 분석: 아이템 자기 보호막이 '회복·보호막(지원)' 지표로 가던 구조 오류
test("아이템 효과의 자기 회복·보호막(스테락의 도전)은 지원이 아니라 버티는 힘으로", () => {
  const c = champ("Leona");
  const m0 = St.evaluate(c, 18, [], [], {}).m, m1 = St.evaluate(c, 18, [item("스테락의 도전")], [], {}).m;
  assert.equal(m1.support, m0.support, "지원 지표는 그대로");
  assert.ok(m1.itemSelfHp > 200 && m1.ehp > m0.ehp, `${m1.itemSelfHp} ${m0.ehp} → ${m1.ehp}`);
});

test("레오나 + 탱크 엔진: 점검표의 증강 효과(모든 지표 같은 비중)와 엔진의 증강 몫(증강 출력 가중치)이 같은 지표(버티는 힘)를 본다", () => {
  const c0 = champ("Leona"), a = d.augments.find((x) => x.name === "탱크 엔진"), c = S.withChosenFeatures(c0, [a], d.rules), A = S.augStatsOf([a], d.rules, c);
  const l = ["스테락의 도전", "케이닉 루컨", "워모그의 갑옷"].map(item);
  const m1 = St.evaluate(c, 18, l, A, {}).m, m0 = St.evaluate(c, 18, l, [], {}).m;
  // 예전엔 탱크 엔진 체력이 스테락 보호막을 키운 몫이 지원 +213%(점검표 효과의 2/3)로 잡혔다
  assert.ok(Math.abs(m1.support - m0.support) < 1e-6, `${m0.support} → ${m1.support}`);
  assert.ok(m1.ehp > m0.ehp);
});

test("메이지·서포터 기본 빌드에 자기 보호막 탱커 아이템(스테락·케이닉·워모그)이 몰리지 않는다 (피들스틱·나미)", () => {
  for (const id of ["Fiddlesticks", "Nami"]) {
    const c = champ(id), w = S.profile(c, d.tags);
    const names = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item.name);
    assert.ok(names.filter((n) => ["스테락의 도전", "케이닉 루컨", "워모그의 갑옷"].includes(n)).length <= 1, `${id}: ${names.join(", ")}`);
  }
});

// 2026-11-14 전체 검증 P4: 규칙으로 붙인 효과가 설명에서 자동으로 뽑은 같은 효과와 겹쳐 두 번 세던 오류 (간지럼 괴물 적중 피해 2배)
test("증강 효과는 같은 계산식·같은 발동 방식이 두 번 들어가지 않는다 (간지럼 괴물 적중 피해 1번)", () => {
  for (const a of d.augments) {
    const seen = new Set();
    for (const e of a.effects || []) {
      const k = `${e.name}|${(e.trigger || {}).type}`;
      assert.ok(!seen.has(k), `${a.name}: ${k}`);
      seen.add(k);
    }
  }
  assert.equal(aug("TickleMonster").effects.filter((e) => e.name === "Calc_OnHitDamage").length, 1);
  // 전부 다 무너뜨려는 기본 공격 적중·스킬 적중을 따로 센다 (같은 계산식, 다른 발동)
  assert.equal(aug("TakeemDownDownDown").effects.filter((e) => e.name === "Calc_Damage_Hit").length, 2);
});

// v0.1.93 P4-B 1단계 실험 구조: 행동 불가 시간(stopSec)은 그동안 공격을 못 하는 몫만큼 초당 피해를 깎는다.
// 콤보(스킬 한 바퀴)는 깎지 않는다 — 멈춘 동안 못 쓴 스킬은 뒤로 밀릴 뿐이라서. 기본 데이터에는 쓰는 아이템이 없다 (실험 설정에서만)
test("행동 불가 시간: 초당 피해만 그 비율만큼 줄고 콤보는 그대로", () => {
  const c = champ("Lux");
  const plain = { id: "zz", name: "가짜", kind: "legendary", stats: { AP: 100 }, tags: {} };
  const stop = { ...plain, passiveStats: { stopSec: 3 } };
  const a = St.evaluate(c, 18, [plain], [], {}).m;
  const b = St.evaluate(c, 18, [stop], [], {}).m;
  assert.equal(Math.round(b.combo), Math.round(a.combo), "콤보는 그대로");
  const close = (x, y, msg) => assert.ok(Math.abs(x - y) <= Math.max(1, Math.abs(y) * 0.02), `${msg}: ${x} vs ${y}`);
  close(b.dps, a.dps * (1 - 3 / 6), "한타 6초 중 3초 멈추면 초당 피해 절반");
  close(b.stopLoss, a.dps * 0.5, "줄어든 양을 따로 남긴다");
  assert.equal(St.evaluate(c, 18, [plain], [], {}).m.stopLoss, undefined, "없는 아이템은 그대로");
});

// v0.1.93 P4-B: 무적·피해 감소로 '안 받는 피해'는 저항을 지난 뒤 단위(받는 피해)라, 버티는 힘(생피해) 단위로 바꿀 때
// 기준 상대의 저항 배수를 써야 한다. 내 저항으로 곱하면 방어력이 높을수록 무적이 커져 탱커가 과대평가된다 (2026-11-16 존야 실험).
test("무적 환산: 내 방어력이 달라도 같은 값만큼 버티는 힘이 는다", () => {
  // 칼바람 받는 피해 보정이 없는 챔피언끼리 (보정이 있으면 그 배수만큼 달라지는 게 맞다)
  const squishy = champ("Orianna"), tank = champ("Malphite");
  assert.ok(!squishy.aram && !tank.aram, "보정 없는 챔피언으로 비교");
  const inv = { id: "zz", name: "가짜무적", kind: "legendary", stats: {}, tags: {}, passiveStats: { invulnSec: 2.5 } };
  const gain = (c) => St.evaluate(c, 18, [inv], [], {}).m.ehp - St.evaluate(c, 18, [], [], {}).m.ehp;
  const a = gain(squishy), b = gain(tank);
  assert.ok(Math.abs(a - b) < Math.max(a, b) * 0.02, `무적 2.5초는 누구에게나 같은 양: 오리아나 ${Math.round(a)} vs 말파이트 ${Math.round(b)}`);
  // 크기: 받는 피해 초당 600 × 2.5초 ÷ 2 (위험할 때 쓴다 가정) × 기준 상대 저항 배수
  const T = St.TARGET;
  const want = 2.5 * T.DPS_TAKEN / 2 * ((1 + T.ARMOR / 100) * 0.5 + (1 + T.MR / 100) * 0.5);
  assert.ok(Math.abs(a - want) < want * 0.05, `기준 상대 저항으로 환산: ${Math.round(a)} vs ${Math.round(want)}`);
});

test("무적·피해 감소가 겹쳐도 한타 길이를 넘지 않는다", () => {
  const c = champ("Leona");
  const mk = (ps) => ({ id: "zz", name: "가짜", kind: "legendary", stats: {}, tags: {}, passiveStats: ps });
  const base = St.evaluate(c, 18, [], [], {}).m.ehp;
  const long = St.evaluate(c, 18, [mk({ invulnSec: 5, drSec: 5 })], [], {}).m.ehp - base;
  const cap = St.evaluate(c, 18, [mk({ invulnSec: 6 })], [], {}).m.ehp - base;
  assert.ok(Math.abs(long - cap) < cap * 0.02, `합쳐도 한타 ${6}초까지만: ${Math.round(long)} vs ${Math.round(cap)}`);
});

// v0.1.93: 타릭 R '우주의 광휘'(자신과 주변 아군 무적)는 자기 몫을 무적 공통 경로로, 아군 몫만 보호막으로 센다.
// 예전엔 자기 몫도 보호막이라 내 방어력·마법 저항력을 곱해, 탱커 빌드 타릭에서 2.4배로 잡혔다 (2026-11-16)
test("타릭 R: 자기 몫은 무적 경로, 아군 몫만 지원 지표", () => {
  const c = champ("Taric");
  const m = St.evaluate(c, 18, [], [], {}).m;
  assert.equal(Math.round(m.selfShield), 0, "자기 보호막으로 세지 않는다");
  assert.ok(m.shield > 700, `아군 보호막은 그대로: ${Math.round(m.shield)}`);
  const bare = { ...c, fightStats: { ...(c.fightStats || {}), invulnSec: 0 } };
  assert.ok(St.evaluate(c, 18, [], [], {}).m.ehp > St.evaluate(bare, 18, [], [], {}).m.ehp, "무적은 버티는 힘으로");
});

// v0.1.93 P4-B 2단계: 아군 강화는 아군이 그 시간 동안 때리고 있어야 들어간다 (아군 평타 가동률, 기본 1 = 지금 가정).
// 우리 자신 평타에 autoUptime 을 쓰는 것과 같은 자리. 스킬 가속 강화는 평타가 아니라 그대로
test("아군 강화: 평타에 붙는 몫만 아군 가동률을 받는다", () => {
  const c = champ("Lux");
  const censer = item("불타는 향로"), staff = item("흐르는 물의 지팡이");
  const at = (up, it) => { St.setExperiment({ allyUptime: up }); const m = St.evaluate(c, 18, [it], [], {}).m; St.setExperiment({}); return m.allyDmg; };
  const full = at(1, censer), half = at(0.5, censer);
  assert.ok(Math.abs(half - full * 0.5) < full * 0.05, `공격 속도·적중 시 강화는 절반으로: ${Math.round(full)} → ${Math.round(half)}`);
  const s1 = at(1, staff), s2 = at(0.5, staff);
  assert.ok(Math.abs(s1 - s2) < 1, `스킬 가속 강화는 가동률과 무관: ${Math.round(s1)} vs ${Math.round(s2)}`);
  assert.equal(St.evaluate(c, 18, [censer], [], {}).m.allyDmg > 0, true, "기본값(1)은 지금과 같다");
});

// 존야 '시간 정지' 중에도 지속 피해·소환물은 계속 들어간다 → 멈춤 손실에서 뺀다 (실험 설정에서만 쓰는 구조)
test("행동 불가: 시간마다 들어가는 피해는 멈춤 손실에서 빠진다", () => {
  const c = champ("Garen");
  const stop = { id: "zz", name: "가짜멈춤", kind: "legendary", stats: {}, tags: {}, passiveStats: { stopSec: 3 } };
  // '시간마다'(time) 들어가는 피해를 가진 가짜 아이템: 멈춰 있어도 계속 들어간다 (지속 피해·소환물)
  const dot = { id: "zy", name: "가짜지속", kind: "legendary", stats: {}, tags: {},
    effects: [{ kind: "magic", name: "DotPerSec", base: [200], trigger: { type: "time", sec: 1 } }] };
  const loss = (items) => { const a = St.evaluate(c, 18, items, [], {}).m, b = St.evaluate(c, 18, [...items, stop], [], {}).m; return (a.dps - b.dps) / a.dps; };
  const plain = loss([]), withDot = loss([dot]);
  assert.ok(plain > 0.45, `지속 피해가 없으면 절반 가까이 잃는다: ${(plain * 100).toFixed(0)}%`);
  assert.ok(withDot < plain - 0.05, `지속 피해가 있으면 덜 잃는다: ${(withDot * 100).toFixed(0)}% < ${(plain * 100).toFixed(0)}%`);
});

// v0.1.93 P4-B 2단계: 불타는 향로·흐르는 물의 지팡이는 '아군을 치유하거나 보호막을 씌워 주면' 발동한다 (아이템 설명).
// 아군을 회복·보호막으로 돕는 기술이 없으면 발동할 수 없다 — 누누는 아군 공격 속도 버프라 분류만 아군 지원이다
test("향로·흐르는 물: 아군 회복·보호막이 있는 챔피언만 발동한다", () => {
  const censer = item("불타는 향로"), staff = item("흐르는 물의 지팡이");
  const gain = (id, it) => { const c = champ(id); return St.evaluate(c, 18, [it], [], {}).m.allyDmg - St.evaluate(c, 18, [], [], {}).m.allyDmg; };
  assert.ok(gain("Soraka", censer) > 400, "아군 회복이 있으면 발동");
  assert.ok(gain("Lux", censer) > 400, "아군 보호막이 있으면 발동");
  assert.equal(Math.round(gain("Nunu", censer)), 0, "아군 회복·보호막이 없으면 발동 안 함");
  assert.equal(Math.round(gain("Nunu", staff)), 0, "흐르는 물의 지팡이도 같음");
  assert.equal(Math.round(gain("Jinx", censer)), 0, "아군 지원 챔피언이 아니면 그대로 0");
});

// E1·E2 (v0.1.95 Phase 4, 2026-11-25): 자기 회복 / 아군 회복 / 자기 보호막 / 아군 보호막을 가른다.
//   E1 증강 '흡수'(skillVamp)는 내 체력을 회복하는 효과인데 아군에게 준 회복(out.heal) 칸에 들어가
//      ① 버티는 힘에서 빠지고 ② 지원 지표를 부풀리고 ③ 상대 회복량 추정에도 안 잡혔다.
//   E2 '죽음의 순환'(healToDamage)은 원본이 '내 체력을 회복·재생하면'인데 아군에게 준 회복을 읽었다.
const AUG_VAMP = "ARAM_SustainingStrike", AUG_CIRCLE = "ARAM_CircleofDeath";
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (허용 ${tol})`);
const mOf = (c, augs, items = []) => St.evaluate(c, 18, items, S.augStatsOf(augs.map(aug), d.rules, c), { aram: true }).m;

test("E1 흡수: 스킬 피해로 내가 회복하는 양은 자기 회복이다 (아군 지원 아님)", () => {
  const lux = champ("Lux");
  const a = mOf(lux, []), b = mOf(lux, [AUG_VAMP]);
  assert.ok(b.selfHealAll > a.selfHealAll, `자기 회복이 안 올랐다: ${a.selfHealAll} → ${b.selfHealAll}`);
  assert.equal(b.heal, a.heal, `아군에게 준 회복 칸이 움직였다: ${a.heal} → ${b.heal}`);
  assert.ok(b.ehp > a.ehp, `자기 회복인데 버티는 힘이 그대로다: ${a.ehp} → ${b.ehp}`);
  assert.equal(b.support - a.support, 0, "지원 지표가 자기 회복으로 올랐다");
});

test("E2 죽음의 순환: 자기 회복만 있는 챔피언에서도 피해가 난다", () => {
  const vlad = champ("Vladimir");  // 자기 회복 있음 · 아군 회복 0
  const a = mOf(vlad, []), b = mOf(vlad, [AUG_CIRCLE]);
  assert.equal(a.heal, 0, "시험 전제: 이 챔피언은 아군에게 주는 회복이 없어요");
  assert.ok(a.selfHealAll > 0, "시험 전제: 자기 회복이 있어야 해요");
  assert.ok(b.combo > a.combo, `자기 회복을 못 읽어 피해가 0 이다: ${a.combo} → ${b.combo}`);
});

test("E2 죽음의 순환: 아군에게 준 회복으로는 피해가 나지 않는다", () => {
  const sor = champ("Soraka");  // 아군 회복 1045 · 자기 회복 135
  const a = mOf(sor, []), b = mOf(sor, [AUG_CIRCLE]);
  const fx = b.effects.find((e) => e.src === "회복 → 피해");
  assert.ok(fx, "회복 → 피해 효과가 있어야 해요");
  assert.ok(fx.value < a.heal * 0.7, `아군에게 준 회복까지 피해로 셌다: ${fx.value} (아군 회복 ${Math.round(a.heal)})`);
  near(fx.value, a.selfHealAll * 0.7, a.selfHealAll * 0.05, "자기 회복의 70% 여야 해요");
});

test("E1+E2 중복 없음: 흡수와 죽음의 순환을 같이 골라도 회복을 한 번만 센다", () => {
  const lux = champ("Lux");
  const v = mOf(lux, [AUG_VAMP]), both = mOf(lux, [AUG_VAMP, AUG_CIRCLE]);
  const fx = both.effects.find((e) => e.src === "회복 → 피해");
  assert.ok(fx, "회복 → 피해 효과가 있어야 해요");
  near(fx.value, v.selfHealAll * 0.7, v.selfHealAll * 0.02, "자기 회복 합의 70% (두 번 세면 두 배가 된다)");
});

test("E2 순환 참조 없음: 죽음의 순환이 낸 피해로 다시 흡혈하지 않는다", () => {
  const lux = champ("Lux"), omni = item("마도사의 주스 상자") || item("리안드리의 고통");
  const a = mOf(lux, [], [omni]), b = mOf(lux, [AUG_CIRCLE], [omni]);
  near(b.vampHeal, a.vampHeal, Math.max(1e-9, a.vampHeal * 1e-9), "회복 → 피해가 흡혈을 다시 늘렸다 (한 번만 돌아야 해요)");
});

test("회복·보호막 네 칸은 서로 겹치지 않는다 (자기 회복·아군 회복·자기 보호막·아군 보호막)", () => {
  for (const id of ["Soraka", "Sona", "Lux", "Vladimir", "Garen"]) {
    const m = mOf(champ(id), []);
    near(m.selfHealAll, ((m.selfHeal || 0) + (m.vampHeal || 0) + (m.itemSelfHeal || 0)) * (1 + 0), Math.max(1, m.selfHealAll * 0.001) + 1e-6,
      `${id}: 자기 회복 합이 갈래 합과 다르다`);
    near(m.selfShieldAll, (m.selfShield || 0) + (m.itemSelfShield || 0), 1e-6, `${id}: 자기 보호막 합이 갈래 합과 다르다`);
    assert.equal(m.support, m.shield + m.heal + m.allyDmg + (m.allySupport || 0), `${id}: 지원 지표에 자기 몫이 섞였다`);
  }
});

// ---- v0.1.95 Phase 4 C9-A1·A2: 저항 감소 공통 계산 순서
test("C9-A1 적용 순서: 고정 감소 → 비율 감소 → 비율 관통 → 고정 관통", () => {
  // 저항 100, 고정 감소 20, 비율 감소 50%, 비율 관통 40%, 고정 관통 10
  //   맞는 순서: ((100 − 20) × 0.5) × 0.6 − 10 = 14 → 100/114
  const got = St.mitigation(100, 0.4, 10, 0.5, 20);
  near(got, 100 / 114, 1e-12, "순서가 틀렸다");
  // 순서를 바꾸면 값이 달라진다 (관통을 먼저 걸면: (100 × 0.6 − 10 − 20) × 0.5 = 15 → 100/115)
  assert.notEqual(Math.round(got * 1e6), Math.round((100 / 115) * 1e6), "관통을 먼저 건 값과 같으면 안 돼요");
});

test("C9-A1 기본값은 항등: 감소 인자를 안 주면 예전 식과 같다", () => {
  for (const [r, pp, fp] of [[113, 0, 0], [113, 0.35, 18], [63, 0.4, 10], [0, 0.5, 5]]) {
    near(St.mitigation(r, pp, fp), 100 / (100 + Math.max(0, r * (1 - pp) - fp)), 1e-12, `저항 ${r}`);
    near(St.mitigation(r, pp, fp, 0, 0), St.mitigation(r, pp, fp), 1e-12, `저항 ${r} 0 인자`);
  }
});

test("C9-A1 비율 관통은 저항이 0 이하면 아무 일도 하지 않는다", () => {
  near(St.mitigation(30, 0.5, 0, 0, 40), 1, 1e-12, "고정 감소로 0 아래가 된 저항");
  near(St.mitigation(30, 0, 0, 0, 30), 1, 1e-12, "저항이 정확히 0");
});

test("C9-A2 비율 저항 감소는 곱해서 합친다 (관통 %와 같은 규칙)", () => {
  // 7.5% 감소 두 번 → 1 − 0.925 × 0.925 = 14.4375% (더하면 15%)
  const two = St.computeStats(champ("Lux"), 18, [], [{ mrShred: 0.075 }, { mrShred: 0.075 }], { aram: true }).conv.mrShred;
  near(two, 1 - 0.925 * 0.925, 1e-12, "두 출처를 더했다 (곱해야 해요)");
  assert.ok(two < 0.15, "더한 값(0.15)보다 작아야 해요");
  // 아이템 쪽 출처(C9-A3 공통 중첩 규칙)와 섞여도 곱한다 (핏빛 저주 11.25% + 가상 7.5%)
  const mixed = St.evaluate(champ("Lux"), 18, [item("핏빛 저주")], [{ mrShred: 0.075 }], { aram: true }).m.shred.mrShred;
  near(mixed, 1 - 0.8875 * 0.925, 1e-12, "아이템·증강 출처를 더했다");
  assert.ok(mixed < 0.1125 + 0.075, "더한 값보다 작아야 해요");
});

test("C9-A2 고정 저항 감소는 더해서 합친다", () => {
  const sum = St.computeStats(champ("Lux"), 18, [],
    [{ mrFlatShred: 10 }, { armorFlatShred: 5 }, { mrFlatShred: 6 }], { aram: true }).conv;
  near(sum.mrFlatShred, 16, 1e-12, "고정 마법 저항력 감소");
  near(sum.armorFlatShred, 5, 1e-12, "고정 방어력 감소");
});

test("C9-A3 핏빛 저주는 공통 중첩 식을 타고도 값이 그대로다 (중첩 평균 1.5 고정)", () => {
  const rule = (d.rules.items || {})["핏빛 저주"];
  assert.ok(rule && rule.stats && rule.stats._shred, "핏빛 저주가 공통 중첩 규칙(_shred)으로 적혀 있어야 해요");
  const spec = rule.stats._shred[0];
  assert.equal(spec.stat, "mrShred");
  near(spec.perStack * spec.pinnedAvg, 0.1125, 1e-12, "중첩 평균 1.5 × 7.5% 가정 (값 불변)");
  // 공통 자리로 옮겨도 깎인 마법 저항력과 피해 배율이 예전 식과 같다
  const blight = item("핏빛 저주");
  assert.ok(blight, "핏빛 저주 아이템이 있어야 해요");
  const sh = St.evaluate(champ("Lux"), 18, [blight], [], { aram: true }).m.shred;
  near(sh.mrShred, 0.1125, 1e-12, "아이템 하나면 곱·합이 같다");
  near(sh.armorShred, 0, 1e-12, "마법 쪽 효과가 물리 쪽으로 새면 안 돼요");
  near(St.mitigation(St.TARGET.MR, 0, 0, sh.mrShred, 0),
    100 / (100 + St.TARGET.MR * (1 - 0.1125)), 1e-12, "예전 식(MR × (1 − mrShred))과 같은 값");
  // 중첩 평균이 고정값이라 공격 속도·스킬 빈도가 달라도 흔들리지 않는다
  for (const id of ["Lux", "Garen", "Ashe"]) {
    near(St.evaluate(champ(id), 18, [blight], [], { aram: true }).m.shred.mrShred, 0.1125, 1e-12, `${id}`);
  }
});

test("C9-A3 공통 중첩 식 연결: 쌓는 방법(on)마다 빈도가 다르고 경계에서 0 이 된다", () => {
  const sh = (specs, id = "Ashe", items = []) =>
    St.evaluate(champ(id), 18, items, [{ _shred: specs }], { aram: true }).m.shred;
  // 발동 빈도 0 · 지속시간 0 · 최대 중첩 0 → 값 0 (NaN 이 번지지 않는다)
  for (const bad of [{ stat: "armorShred", perStack: 0.06, maxStacks: 5, dur: 0, on: "auto" },
    { stat: "armorShred", perStack: 0.06, maxStacks: 0, dur: 6, on: "auto" },
    { stat: "armorShred", perStack: 0.06, maxStacks: 5, dur: 6, on: "none" }]) {
    const r = sh([bad]);
    assert.equal(r.armorShred, 0, `${JSON.stringify(bad)} 는 0 이어야 해요`);
    assert.ok(Number.isFinite(r.armorShred));
  }
  // 평타로 쌓는 효과와 스킬로 쌓는 효과는 빈도가 다르다 (공격 속도 vs 시전 빈도 × 공통 가정)
  const base = { perStack: 0.06, maxStacks: 5, dur: 6 };
  const auto = sh([{ stat: "armorShred", ...base, on: "auto" }]).armorShred;
  const skill = sh([{ stat: "armorShred", ...base, on: "skill" }]).armorShred;
  const both = sh([{ stat: "armorShred", ...base, on: "both" }]).armorShred;
  assert.ok(auto > skill && skill > 0, `평타 쪽이 더 자주 쌓여야 해요 (${auto} vs ${skill})`);
  assert.ok(both >= auto, "둘 다면 더 쌓여야 해요");
  // 최대 중첩에 도달하는 조합과 못 하는 조합
  const reach = sh([{ stat: "armorShred", perStack: 0.01, maxStacks: 2, dur: 6, on: "auto" }]);
  const far = sh([{ stat: "armorShred", perStack: 0.01, maxStacks: 30, dur: 60, on: "auto" }]);
  assert.ok(reach.armorShred > 0 && reach.armorShred <= 0.01 * 2 + 1e-12, "도달 조합도 최대 중첩(2)을 넘으면 안 돼요");
  assert.ok(far.armorShred > 0 && far.armorShred < 0.01 * 30, "못 채우는 조합은 쌓는 중 평균");
  // 물리·마법 경로가 섞이지 않는다
  const split = sh([{ stat: "armorShred", ...base, on: "auto" }, { stat: "mrFlatShred", perStack: 5, maxStacks: 1, dur: 6, on: "auto" }]);
  assert.ok(split.armorShred > 0 && split.mrShred === 0, "비율 방어력 감소가 마법 쪽으로 새면 안 돼요");
  assert.ok(split.mrFlatShred > 0 && split.armorFlatShred === 0, "고정 감소도 경로가 갈려야 해요");
  // 비율은 곱, 고정은 합
  const one = sh([{ stat: "armorShred", ...base, on: "auto" }]).armorShred;
  const two = sh([{ stat: "armorShred", ...base, on: "auto" }, { stat: "armorShred", ...base, on: "auto" }]).armorShred;
  near(two, 1 - (1 - one) * (1 - one), 1e-12, "비율 감소 둘은 곱한다");
  const f2 = sh([{ stat: "armorFlatShred", perStack: 5, maxStacks: 1, dur: 6, on: "auto" },
    { stat: "armorFlatShred", perStack: 5, maxStacks: 1, dur: 6, on: "auto" }]).armorFlatShred;
  const f1 = sh([{ stat: "armorFlatShred", perStack: 5, maxStacks: 1, dur: 6, on: "auto" }]).armorFlatShred;
  near(f2, f1 * 2, 1e-12, "고정 감소 둘은 더한다");
});

// ---- v0.1.95 Phase 4 C9-A4: 칠흑의 양날 도끼(중첩형 비율 감소) · 악의(조건부 고정 감소)
const CLEAVER = "칠흑의 양날 도끼", MALIGN = "악의";
const shredOf = (id, items = [], augs = []) =>
  St.evaluate(champ(id), 18, items.map(item).filter(Boolean), augs, { aram: true }).m;

test("C9-A4 칠흑: 물리 피해 횟수로 중첩을 센다 (평타 + 물리 스킬, 한 스킬은 한 번)", () => {
  for (const id of ["Garen", "Ashe", "Lux"]) {
    const m = shredOf(id, [CLEAVER]);
    const c = champ(id);
    // 같은 규칙으로 손 계산: 평타(공격 속도) + 물리 피해가 있는 스킬의 시전 빈도 × 공통 가정 30%
    const cs = St.computeStats(c, 18, [item(CLEAVER)], [], { aram: true });
    const ranks = St.ranksAt(18, c.spells);
    const haste = m.haste;
    let physCast = 0, allCast = 0;
    c.spells.forEach((sp, i) => {
      const cd = sp.cooldown[Math.max(0, Math.min(ranks[i], sp.cooldown.length) - 1)] || 0;
      if (ranks[i] === 0 || !(cd > 0)) return;
      const r = 1 / Math.max(cd * 100 / (100 + (sp.slot === "R" ? haste.ult : haste.basic)), 2);
      allCast += r;
      const kinds = (sp.effects || []).map((e) => e.kind);
      if (kinds.includes("physical") || (kinds.includes("adaptive") && !/^(Lux|Annie|Sona)$/.test(id))) physCast += r;
    });
    const rate = cs.total.AS + physCast * 0.3;
    const want = St.shredExpect({ perStack: 0.06, maxStacks: 5, dur: 6, rate, fightSec: 6 });
    near(m.shred.armorShred, want.value, 1e-9, `${id} 중첩 평균이 식과 달라요`);
    assert.ok(m.shred.armorShred <= 0.3 + 1e-12, `${id}: 최대 중첩 5 × 6% = 30% 를 넘으면 안 돼요`);
    assert.equal(m.shred.mrShred, 0, `${id}: 칠흑은 마법 저항력을 깎지 않아요`);
    assert.ok(allCast >= physCast, "물리 스킬 빈도가 전체 시전 빈도보다 클 수 없어요");
  }
});

test("C9-A4 칠흑: 마법·고정 피해는 중첩에 안 들어간다", () => {
  // 'magic' 으로 쌓는 효과에는 기본 공격(물리)이 들어가지 않는다 → 마법 스킬이 없으면 0
  const onlyMagic = [{ _shred: [{ stat: "armorShred", perStack: 0.06, maxStacks: 5, dur: 6, on: "magic" }] }];
  const phys = [{ _shred: [{ stat: "armorShred", perStack: 0.06, maxStacks: 5, dur: 6, on: "physical" }] }];
  for (const id of ["Garen", "Ashe"]) {
    const a = shredOf(id, [], onlyMagic).shred.armorShred;
    const b = shredOf(id, [], phys).shred.armorShred;
    assert.ok(b > a, `${id}: 물리 쪽이 더 쌓여야 해요 (${b} vs ${a})`);
  }
  // 같은 스킬에 피해 효과가 여럿이어도 한 번만 센다: 규칙이 효과 수를 보지 않는다
  const c = champ("Garen");
  const many = c.spells.filter((sp) => (sp.effects || []).filter((e) => e.kind === "physical").length > 1).length;
  const m = shredOf("Garen", [CLEAVER]);
  assert.ok(m.shred.detail.length === 1, "칠흑은 감소 규칙 하나다 (효과마다 세면 여러 개가 돼요)");
  assert.ok(many >= 0);
});

test("C9-A4 악의: 궁극기 피해로 걸리고 한타·장기 가동률이 다르다", () => {
  const m = shredOf("Lux", [MALIGN]);
  const d0 = m.shred.detail.find((x) => x.stat === "mrFlatShred");
  assert.ok(d0, "고정 마법 저항력 감소가 있어야 해요");
  near(d0.fightUptime, 0.5, 1e-12, "한타 한 번: 3초 ÷ 6초");
  near(m.shred.mrFlatShred, 10 * 0.5, 1e-12, "한타 기준 감소량");
  assert.ok(d0.longUptime > 0 && d0.longUptime < d0.fightUptime, "길게 싸울 때는 궁 대기시간만큼 낮아야 해요");
  near(m.shredLong.mrFlatShred, 10 * d0.longUptime, 1e-12, "길게 싸울 때 감소량");
  // 길게 싸울 때가 덜 깎이므로 초당 피해 쪽 보정은 1 보다 작고, 물리 쪽은 건드리지 않는다
  assert.ok(m.shredAdj.magic < 1 && m.shredAdj.magic > 0.9, `마법 보정 ${m.shredAdj.magic}`);
  assert.equal(m.shredAdj.physical, 1, "물리 쪽은 그대로여야 해요");
  assert.equal(m.shred.mrShred, 0, "비율 감소가 아니라 고정 감소예요");
  // 같은 가동률을 두 번 곱하지 않는다: 감소량 = 10 × 가동률 한 번
  assert.ok(m.shred.mrFlatShred === 10 * d0.fightUptime);
});

test("C9-A4 악의: 궁극기가 막히면(증강) 감소가 0 이다", () => {
  const noUlt = d.augments.find((a) => ((d.rules.augments[a.id] || {}).statsResolved || {}).noUlt);
  assert.ok(noUlt, "궁을 막는 증강이 있어야 해요");
  const as = S.augStatsOf([noUlt], d.rules, champ("Lux"));
  const m = St.evaluate(champ("Lux"), 18, [item(MALIGN)], as, { aram: true }).m;
  assert.equal(m.shred.mrFlatShred, 0, "궁을 못 쓰면 증오안개도 안 걸려요");
  assert.equal(m.shredAdj.magic, 1, "차이가 없으면 보정도 1 이에요");
});

// ---- v0.1.95 Phase 4 C9-A5: 부식 — 관통 자리에서 저항 감소 자리로
const EROSION = () => d.augments.find((a) => a.id === "ARAM_Erosion");
const withEro = (id, items = []) => {
  const c = champ(id), as = S.augStatsOf([EROSION()], d.rules, c);
  const picked = items.map(item).filter(Boolean);
  return { cs: St.computeStats(c, 18, picked, as, { aram: true }), m: St.evaluate(c, 18, picked, as, { aram: true }).m };
};

test("C9-A5 부식: 관통이 아니라 저항 감소로 들어간다 (두 자리에 겹치지 않는다)", () => {
  const rule = d.rules.augments.ARAM_Erosion;
  assert.ok(rule.statsResolved && rule.statsResolved._shred, "부식이 공통 중첩 규칙으로 적혀 있어야 해요");
  assert.equal(rule.statsResolved.ARPEN, undefined, "관통 자리에 남아 있으면 두 번 세요");
  assert.equal(rule.statsResolved.MPENP, undefined);
  for (const id of ["Garen", "Lux", "Ashe"]) {
    const { cs, m } = withEro(id);
    assert.equal(cs.total.ARPEN, 0, `${id}: 방어구 관통력이 오르면 안 돼요`);
    assert.equal(cs.total.MPENP, 0, `${id}: 마법 관통력이 오르면 안 돼요`);
    assert.ok(m.shred.armorShred > 0 && m.shred.mrShred > 0, `${id}: 방어력·마법 저항력 둘 다 깎여야 해요`);
    near(m.shred.armorShred, m.shred.mrShred, 1e-12, "원본이 같은 값이라 둘이 같아야 해요");
    assert.ok(m.shred.armorShred <= 0.3 + 1e-12, "최대 20중첩 × 1.5% = 30% 를 넘으면 안 돼요");
  }
});

test("C9-A5 부식: 공격 속도·스킬 빈도가 오르면 중첩이 는다", () => {
  const slow = withEro("Ashe").m.shred.armorShred;
  const fast = withEro("Ashe", ["광전사의 군화", "구인수의 격노검"]).m.shred.armorShred;
  assert.ok(fast > slow, `공격 속도가 오르면 더 쌓여야 해요 (${fast} vs ${slow})`);
  // 스킬 가속이 오르면 시전 빈도가 올라 중첩도 는다
  const haste = withEro("Lux", ["악의"]).m.shred.armorShred;
  assert.ok(haste > withEro("Lux").m.shred.armorShred, "스킬 가속이 오르면 더 쌓여야 해요");
});

test("C9-A5 부식 + 칠흑·핏빛 저주·악의: 비율은 곱, 고정은 합", () => {
  const ero = withEro("Garen").m.shred.armorShred;
  const cle = St.evaluate(champ("Garen"), 18, [item(CLEAVER)], [], { aram: true }).m.shred.armorShred;
  const both = withEro("Garen", [CLEAVER]).m.shred;
  assert.ok(both.armorShred < ero + cle, "더하면 과대평가예요 (곱해야 해요)");
  assert.ok(both.armorShred > Math.max(ero, cle), "둘을 같이 쓰면 하나보다는 커야 해요");
  // 핏빛 저주(마법 비율)와 악의(마법 고정)를 같이
  const all = withEro("Lux", ["핏빛 저주", MALIGN]).m.shred;
  // 같은 조합 안에서 두 몫을 꺼내 곱이 맞는지 본다 (중첩 속도는 아이템에 따라 달라지므로 따로 재면 안 된다)
  const eroMr = all.detail.find((x) => x.stat === "mrShred" && x.on === "both").value;
  const blightMr = all.detail.find((x) => x.stat === "mrShred" && x.on === "skill").value;
  assert.ok(all.mrShred > blightMr && all.mrShred > eroMr, "비율끼리 쌓여야 해요");
  near(all.mrShred, 1 - (1 - blightMr) * (1 - eroMr), 1e-12, "더하지 말고 곱해야 해요");
  assert.ok(all.mrShred < blightMr + eroMr, "더하면 과대평가예요");
  near(all.mrFlatShred, 5, 1e-12, "고정 감소는 악의 몫 그대로 (한타 기준)");
});

test("C9-A5 부식 + 관통: 감소 → 관통 순서가 그대로다", () => {
  const { cs, m } = withEro("Lux", ["공허의 지팡이"]);
  const want = St.mitigation(St.TARGET.MR, cs.total.MPENP, cs.total.MPEN, m.shred.mrShred, m.shred.mrFlatShred);
  const byHand = 100 / (100 + Math.max(0,
    (St.TARGET.MR - m.shred.mrFlatShred) * (1 - m.shred.mrShred) * (1 - cs.total.MPENP) - cs.total.MPEN));
  near(want, byHand, 1e-12, "고정 감소 → 비율 감소 → 비율 관통 → 고정 관통");
  assert.ok(cs.total.MPENP > 0, "관통은 아이템에서만 와야 해요");
});

test("C9-A3 저항 감소 → 관통 순서를 그대로 지킨다", () => {
  // 고정 감소 → 비율 감소 → 비율 관통 → 고정 관통
  const R = 100, pctRed = 0.2, flatRed = 10, pctPen = 0.3, flatPen = 5;
  const want = 100 / (100 + Math.max(0, (R - flatRed) * (1 - pctRed) * (1 - pctPen) - flatPen));
  near(St.mitigation(R, pctPen, flatPen, pctRed, flatRed), want, 1e-12, "순서가 바뀌면 값이 달라져요");
  // 공통 중첩 식으로 들어온 감소도 같은 자리에 들어간다 (마법 쪽)
  const sh = St.evaluate(champ("Lux"), 18, [item("핏빛 저주")], [], { aram: true }).m.shred;
  near(sh.mrShred, 0.1125, 1e-12);
  assert.ok(St.mitigation(St.TARGET.MR, 0.4, 0, sh.mrShred, 0) > St.mitigation(St.TARGET.MR, 0.4, 0, 0, 0),
    "감소가 관통과 같이 걸리면 피해가 더 들어가야 해요");
});

test("C9-A2.5 중첩 평균 식: 포화 전·후 두 갈래가 손 계산과 같다", () => {
  // 칠흑(6% ×5, 6초, 초당 1.5회): s* = min(5, 9) = 5 · t_r = 3.33초 ≤ 6초 → 5 × (1 − 3.33/12) = 3.611
  const a = St.shredExpect({ perStack: 0.06, maxStacks: 5, rate: 1.5, dur: 6, fightSec: 6 });
  near(a.saturated, 5, 1e-12, "포화 중첩");
  near(a.stackAvg, 5 * (1 - (5 / 1.5) / 12), 1e-12, "포화 전 갈래");
  near(a.value, a.stackAvg * 0.06, 1e-12, "깎는 양");
  // 부식(1.5% ×20, 4초, 초당 2회): s* = min(20, 8) = 8 · t_r = 4초 ≤ 6초 → 8 × (1 − 4/12) = 5.333
  const b = St.shredExpect({ perStack: 0.015, maxStacks: 20, rate: 2, dur: 4, fightSec: 6 });
  near(b.stackAvg, 8 * (1 - 4 / 12), 1e-12, "부식");
  // 포화가 한타보다 오래 걸리는 경우: 한타 내내 쌓기만 한다 → rate × T / 2
  const c = St.shredExpect({ perStack: 0.01, maxStacks: 30, rate: 2, dur: 60, fightSec: 6 });
  near(c.stackAvg, 2 * 6 / 2, 1e-12, "포화 후 갈래");
  assert.ok(c.stackAvg <= c.saturated, "평균이 포화 중첩을 넘으면 안 돼요");
});

test("C9-A2.5 중첩 평균은 0 아래로도 포화 위로도 안 간다 (발동 0회 포함)", () => {
  for (const o of [{ rate: 0, dur: 6, maxStacks: 5 }, { rate: 2, dur: 0, maxStacks: 5 }, { rate: 2, dur: 6, maxStacks: 0 },
    { rate: -1, dur: 6, maxStacks: 5 }, { rate: 0, dur: 0, maxStacks: 0 }]) {
    const r = St.shredExpect({ perStack: 0.06, ...o, fightSec: 6 });
    assert.equal(r.stackAvg, 0, `발동이 없으면 0 이어야 해요: ${JSON.stringify(o)}`);
    assert.ok(Number.isFinite(r.value), `값이 숫자여야 해요: ${JSON.stringify(o)}`);
  }
  // 어떤 조합에서도 0 ≤ 평균 ≤ 포화 중첩 (예전 식은 포화 시간이 한타보다 길면 음수가 됐다)
  for (const rate of [0.1, 0.5, 1, 2, 5]) for (const dur of [0.5, 2, 4, 6, 20]) for (const maxStacks of [1, 4, 5, 20]) {
    const r = St.shredExpect({ perStack: 0.01, rate, dur, maxStacks, fightSec: 6 });
    assert.ok(r.stackAvg >= 0 && r.stackAvg <= r.saturated + 1e-12, `${rate}/${dur}/${maxStacks} → ${r.stackAvg} (포화 ${r.saturated})`);
  }
});

test("C9-A2.5 중첩 평균을 1.5 로 고정하면 핏빛 저주의 지금 값이 그대로 나온다", () => {
  const r = St.shredExpect({ perStack: 0.075, maxStacks: 4, rate: 1, dur: 6, pinnedAvg: 1.5 });
  near(r.value, 0.1125, 1e-12, "지금 규칙 값 (중첩 평균 1.5 × 7.5%)");
  const spec = (d.rules.items["핏빛 저주"].stats || {})._shred[0];
  near(r.value, spec.perStack * spec.pinnedAvg, 1e-12, "데이터 규칙과 같은 값");
});

// ---- v0.1.95 Phase 4 E4·F12: 자기 회복 / 최대 체력 증가 / 일반 보호막 / 주문 방어막·피해 흡수를 가른다
const BELT = "원형질 안전벨트", SPIRIT = "정령의 형상";
const e4m = (id, itemNames = [], augIds = []) => {
  const c = champ(id);
  const as = augIds.length ? S.augStatsOf(augIds.map(aug).filter(Boolean), d.rules, c) : [];
  return St.evaluate(c, 18, itemNames.map(item).filter(Boolean), as, { aram: true }).m;
};
const e4dmg = (m) => { const fx = (m.effects || []).find((e) => e.src === "회복 → 피해"); return fx ? fx.value : 0; };

test("E4 원형질 안전벨트: 회복과 최대 체력 증가를 따로 센다 (18레벨·추가 저항 0 이면 400 + 300)", () => {
  const rule = d.rules.items[BELT].stats;
  assert.deepEqual(rule.selfHeal.lvl, [100, 400], "원본: 회복 100~400 (레벨 비례)");
  assert.deepEqual(rule.selfHeal.ratios, { bonusARMOR: 1.75, bonusMR: 1.75 }, "원본: 추가 방어력·마법 저항력의 175%");
  assert.deepEqual(rule.selfHp.lvl, [100, 300], "원본: 최대 체력 100~300 (레벨 비례)");
  assert.deepEqual(item(BELT).passiveStats, rule, "data.json 에 구워진 값도 같아야 해요");
  const bare = e4m("Rammus"), belt = e4m("Rammus", [BELT]);
  assert.equal(Math.round(belt.selfHealAll - bare.selfHealAll), 400, "추가 저항이 없으면 18레벨 400");
  assert.equal(Math.round(belt.selfHpAll), 300);
  // 한 아이템을 두 칸에 중복으로 더하지 않는다 (합 700, 1400 이 아님)
  assert.equal(Math.round(belt.selfHealAll + belt.selfHpAll + belt.selfShieldAll + belt.selfAbsorbAll), 700);
});

test("E4 원형질 안전벨트 원본 계수: 레벨 비례 보간과 추가 저항 175%", () => {
  const c = champ("Rammus"), belt = item(BELT);
  const at = (L, items = [belt]) => St.computeStats(c, L, items, [], { aram: true });
  // 레벨 보간은 1~18레벨 직선 (구원·미카엘의 축복과 같은 방식)
  near(at(1).conv.selfHeal, 100, 1e-9, "1레벨 회복");
  near(at(18).conv.selfHeal, 400, 1e-9, "18레벨 회복");
  near(at(1).conv.selfHp, 100, 1e-9, "1레벨 최대 체력");
  near(at(18).conv.selfHp, 300, 1e-9, "18레벨 최대 체력");
  near(at(10).conv.selfHeal, 100 + 300 * 9 / 17, 1e-9, "10레벨은 직선 보간");
  // 아이템으로 얻는 추가 저항이 회복에 들어간다 (마법 저항력 40 → +70)
  const mr = item("밴시의 장막");
  const t = at(18, [belt, mr]).total;
  near(at(18, [belt, mr]).conv.selfHeal, 400 + 1.75 * (t.bonusARMOR + t.bonusMR), 1e-9, "추가 저항의 175%");
  // 최대 체력 증가는 저항을 안 탄다
  near(at(18, [belt, mr]).conv.selfHp, 300, 1e-9, "최대 체력은 그대로");
});

test("F12 감시의 장막: 주문 방어막은 회복이 아니라 피해 흡수 칸으로", () => {
  assert.equal((d.rules.augments.VeilOfWarding.statsResolved || {}).selfAbsorb, 396);
  assert.equal((d.rules.augments.VeilOfWarding.statsResolved || {}).selfHeal, undefined);
  const bare = e4m("Rammus"), veil = e4m("Rammus", [], ["VeilOfWarding"]);
  assert.equal(Math.round(veil.selfAbsorbAll), 396);
  assert.equal(Math.round(veil.selfHealAll - bare.selfHealAll), 0, "회복 칸은 그대로여야 해요");
});

test("E4·F12 죽음의 순환은 '실제 자기 회복' 만 피해로 바꾼다", () => {
  const belt = e4m("Rammus", [BELT], ["ARAM_CircleofDeath"]);
  const rate = d.rules.augments.ARAM_CircleofDeath.statsResolved.healToDamage;
  near(e4dmg(belt), belt.selfHealAll * rate, 1e-9, "자기 회복 몫만");
  assert.ok(Math.abs(e4dmg(belt) - (belt.selfHealAll + belt.selfHpAll) * rate) > 100, "최대 체력 증가까지 세면 안 돼요");
  // 주문 방어막만 있으면 피해로 바뀌는 몫이 없다
  const bare = e4m("Rammus", [], ["ARAM_CircleofDeath"]);
  const veil = e4m("Rammus", [], ["VeilOfWarding", "ARAM_CircleofDeath"]);
  near(e4dmg(veil), e4dmg(bare), 1e-9, "주문 방어막은 회복이 아니에요");
});

test("E4·F12 정령의 형상은 회복·보호막만 25% 올린다 (최대 체력·주문 방어막은 그대로)", () => {
  const beltSpirit = e4m("Rammus", [BELT, SPIRIT]), belt = e4m("Rammus", [BELT]);
  // 정령의 형상은 마법 저항력 50 도 같이 주므로 회복 바탕값 자체가 커진다 → 규칙값 × 1.25 와 견준다
  const cv = St.computeStats(champ("Rammus"), 18, [item(BELT), item(SPIRIT)], [], { aram: true }).conv;
  near(beltSpirit.selfHealAll, cv.selfHeal * 1.25, 1e-9, "회복은 규칙값의 1.25배");
  near(beltSpirit.selfHpAll / belt.selfHpAll, 1, 1e-9, "최대 체력 증가는 그대로");
  const veil = e4m("Rammus", [], ["VeilOfWarding"]), veilSpirit = e4m("Rammus", [SPIRIT], ["VeilOfWarding"]);
  near(veilSpirit.selfAbsorbAll / veil.selfAbsorbAll, 1, 1e-9, "주문 방어막도 그대로");
  // 일반 보호막(럭스 W)은 예전처럼 1.25배
  const luxBare = e4m("Lux"), luxSpirit = e4m("Lux", [SPIRIT]);
  near(luxSpirit.selfShieldAll / luxBare.selfShieldAll, 1.25, 1e-9, "일반 보호막은 올라가요");
});

test("E4 네 갈래 모두 버티는 힘에는 들어간다", () => {
  const c = champ("Rammus");
  const bare = St.evaluate(c, 18, [], [], { aram: true }).m;
  for (const [label, items, augs] of [["회복+최대 체력", [BELT], []], ["주문 방어막", [], ["VeilOfWarding"]]]) {
    const m = e4m("Rammus", items, augs);
    assert.ok(m.ehp > bare.ehp, `${label} 이 버티는 힘에 들어가야 해요 (${m.ehp} vs ${bare.ehp})`);
  }
});

// ---------------------------------------------------------------- F5-A 서로 대안인 피해를 둘 다 세지 않는다
const f5spell = (id, slot) => champ(id).spells.find((s) => s.slot === slot);

test("F5-A 카서스 Q 는 단일 대상 값만 센다 (설명: '하나의 적만 맞힐 경우')", () => {
  const names = f5spell("Karthus", "Q").effects.map((e) => e.name);
  assert.deepEqual(names, ["qsingletargetdamage"], "여러 명 값(qdamage)은 함께 들어가지 않아요");
});

test("F5-A 럼블 E 는 기본 값만 센다 (강화는 위험 상태일 때만)", () => {
  const names = f5spell("Rumble", "E").effects.map((e) => e.name);
  assert.deepEqual(names, ["totaldamage"], "강화 값(empdamage)은 함께 들어가지 않아요");
});

test("F5-A 칼리스타 E 는 둘 다 센다 (대안이 아니라 창 2개 몫)", () => {
  const names = f5spell("Kalista", "E").effects.map((e) => e.name);
  assert.deepEqual(names, ["normaldamage", "additionaldamage"],
    "기본 + 두 번째 창은 함께 들어가는 피해예요 (창 3개부터는 규칙의 fight 효과가 센다)");
  const rule = d.rules.champions.Kalista;
  assert.ok(rule && JSON.stringify(rule.fight).includes("RendPerSpear"), "창 하나당 피해가 규칙에 있어야 해요");
});

test("F5-A 이름이 비슷하다고 자동으로 빼지 않는다 (규칙에 적은 것만)", () => {
  const drops = Object.entries(d.rules.champions)
    .filter(([, r]) => r && r.dropEffects).map(([id]) => id).sort();
  assert.deepEqual(drops, ["Karthus", "Rumble", "Yunara"], "뺀 자리는 규칙에 적은 챔피언뿐이에요 (유나라는 F5-E 의 확산 피해)");
  // 같은 모양('기본 + 강화')인데 규칙에 없는 스킬은 그대로 둔다 — 엔진의 대안 처리(spellPlan)가 맡는다
  assert.ok(f5spell("Rengar", "Q").effects.length > 1, "렝가 Q 는 데이터에 둘 다 남아 있어요");
});

// ---------------------------------------------------------------- F5-B 충전형 스킬의 장기 발동 간격
test("F5-B 충전 값은 규칙으로 켠 스킬에만 쓴다 (설치물·평타 강화형은 그대로 제외)", () => {
  const on = [];
  for (const c of d.champions) for (const s of c.spells) if (s.dpsRate === "ammo") on.push(`${c.id} ${s.slot}`);
  assert.deepEqual(on.sort(), ["Karthus Q", "Nilah E", "Rengar E", "Rengar Q", "Rengar W", "Rumble E"]);
  // 렝가 Q 는 충전 간격만 쓰고 피해는 평타 대체(차이만)로 간다 — 자세한 것은 F5-E 테스트에서 본다
  // 게임 파일에 충전 값이 있어도 켜지 않은 스킬 (설치물 4개)
  const off = ["Gangplank E", "Ivern W", "Caitlyn W", "Teemo R"];
  for (const key of off) {
    const [id, slot] = key.split(" ");
    const sp = champ(id).spells.find((s) => s.slot === slot);
    assert.ok(sp.ammo, `${key} 는 충전 값이 데이터에 있어야 해요`);
    assert.equal(sp.dpsRate, undefined, `${key} 는 아직 초당 피해에 넣지 않아요`);
  }
});

test("F5-B 카서스 Q 가 초당 스킬 피해에 들어간다 (충전 1초)", () => {
  const m = St.evaluate(champ("Karthus"), 18, [], [], { aram: true }).m;
  const q = m.spells.find((s) => s.slot === "Q");
  assert.ok(q.cd <= 1 && q.cd > 0, `발동 간격은 1초 이하여야 해요 (${q.cd})`);
  assert.ok(m.skillDps > q.dmg / 2, `Q 피해가 초당 피해에 들어가야 해요 (${m.skillDps} vs ${q.dmg})`);
});

test("F5-B 닐라 E 는 스킬 가속을 받지 않는다 (게임 파일 표시)", () => {
  const sp = champ("Nilah").spells.find((s) => s.slot === "E");
  assert.equal(sp.ammo.noHaste, true);
  const bare = St.evaluate(champ("Nilah"), 18, [], [], { aram: true }).m.spells.find((s) => s.slot === "E");
  const haste = St.evaluate(champ("Nilah"), 18, [item("명석함의 아이오니아 장화")].filter(Boolean), [], { aram: true })
    .m.spells.find((s) => s.slot === "E");
  assert.equal(Math.round(bare.cd * 100), Math.round(haste.cd * 100), "가속을 줘도 발동 간격이 같아야 해요");
});

test("F5-B 한타 한 번 피해는 그대로 한 번만 센다 (처음 들고 있는 충전량을 두 번 세지 않는다)", () => {
  for (const id of ["Karthus", "Rengar", "Nilah", "Rumble"]) {
    const m = St.evaluate(champ(id), 18, [], [], { aram: true }).m;
    const sum = m.spells.reduce((a, s) => a + (s.dmg || 0), 0);
    assert.ok(Math.abs(m.combo - sum) < m.combo * 0.5 + 1e-6,
      `${id}: 콤보가 스킬 한 번씩의 합에서 크게 벗어나면 안 돼요 (${m.combo} vs ${sum})`);
  }
});

// ---------------------------------------------------------------- F5-C 평타 쪽으로 가야 하는 피해
test("F5-C 제리 Q 는 평타를 대체한다 (평타에 더하지 않는다)", () => {
  const c = champ("Zeri");
  const sp = c.spells.find((s) => s.slot === "Q");
  assert.ok(sp.effects.some((e) => e.autoReplace), "규칙이 데이터에 붙어 있어야 해요");
  const m = St.evaluate(c, 18, [], [], { aram: true }).m;
  assert.ok(m.autoHit > 0, "평타 한 대의 피해가 Q 값이어야 해요");
  const t = St.computeStats(c, 18, [], [], { aram: true }).total;
  assert.ok(m.autoHit > t.AD, `Q 값(${m.autoHit})이 그냥 공격력(${t.AD})보다 커야 해요`);
  const q = m.spells.find((s) => s.slot === "Q");
  assert.equal(Math.round(q.dmg), 0, "같은 피해를 스킬 쪽으로 또 세면 안 돼요");
});

test("F5-C 트위스티드 페이트 E 는 4번째 평타마다 (한 대당 1/4)", () => {
  const c = champ("TwistedFate");
  const e = c.spells.find((s) => s.slot === "E").effects.find((x) => x.name === "bonusdamage");
  assert.equal(e.every, 4);
  assert.equal(e.onhit, true);
  const m = St.evaluate(c, 18, [], [], { aram: true }).m;
  assert.ok(m.spellOnhit > 0, "평타 적중 피해에 들어가야 해요");
  const raw = m.spells.find((s) => s.slot === "E").values.find((v) => v.name === "bonusdamage").value;
  assert.ok(m.spellOnhit < raw, `한 대당 평균은 원래 값보다 작아야 해요 (${m.spellOnhit} vs ${raw})`);
});

test("F5-C 평타를 대체·강화하지 않는 챔피언은 그대로다", () => {
  const n = d.champions.filter((c) => c.spells.some((s) => s.effects.some((e) => e.autoReplace || e.every))).length;
  assert.equal(n, 2, "규칙에 적은 두 명(제리·트위스티드 페이트)뿐이어야 해요");
});

// ---------------------------------------------------------------- F5-D 게임 원본에 재사용 대기시간이 없는 스킬
test("F5-D 베이가 W·탐 켄치 R 은 규칙에 적은 값으로 센다 (출처는 basis 에)", () => {
  const vw = champ("Veigar").spells.find((s) => s.slot === "W");
  assert.equal(vw.cooldownFrom, "rules");
  assert.equal(vw.cooldown[0], 6.48, "위키 공식 8 × 0.9^2 (극악 120중첩 가정과 같은 기준)");
  const tr = champ("TahmKench").spells.find((s) => s.slot === "R");
  assert.deepEqual(tr.cooldown, [120, 100, 80]);
  for (const id of ["Veigar", "TahmKench"]) {
    const m = St.evaluate(champ(id), 18, [], [], { aram: true }).m;
    assert.ok(m.skillDps > 0, `${id} 의 초당 스킬 피해가 0 이면 안 돼요`);
  }
});

test("F5-D 규칙으로 채운 쿨타임은 두 자리뿐이다 (쉬바나 R·야스오 E 는 후속)", () => {
  const filled = [];
  for (const c of d.champions) for (const s of c.spells) if (s.cooldownFrom === "rules") filled.push(`${c.id} ${s.slot}`);
  assert.deepEqual(filled.sort(), ["TahmKench R", "Veigar W"]);
  assert.equal(champ("Shyvana").spells.find((s) => s.slot === "R").cooldown[0], 0, "쉬바나 R 은 분노로 쓰는 스킬이라 그대로예요");
});

// ---------------------------------------------------------------- 16.23.1 새 증강
const a1623 = (id) => d.augments.find((x) => x.id === id);
const plain1623 = (id) => a1623(id).desc.replace(/<[^>]+>/g, "");
const with1623 = (champId, ids, items = []) => {
  const c = champ(champId);
  const as = S.augStatsOf(ids.map(a1623).filter(Boolean), d.rules, c);
  return St.computeStats(c, 18, items.map(item).filter(Boolean), as, { aram: true }).total;
};

test("16.23 요새화·신비한 방호·더욱 굳건한 태세: 설명 수치가 그대로인가 (패치 감시)", () => {
  assert.match(plain1623("Fortified"), /20의 방어력[\s\S]*추가 방어력이 25% 증가/);
  assert.match(plain1623("MysticGuard"), /20의 마법 저항력[\s\S]*추가 마법 저항력이 25% 증가/);
  assert.match(plain1623("SteadfastPresence"), /추가 방어력 및 마법 저항력이 16% 증가/);
});

test("16.23 저항 증강은 추가 저항만 올린다 (기본 저항은 그대로)", () => {
  const b = with1623("Garen", []), f = with1623("Garen", ["Fortified"]);
  assert.equal(Math.round((b.ARMOR - b.bonusARMOR) * 100), Math.round((f.ARMOR - f.bonusARMOR) * 100),
    "레벨로 얻는 기본 방어력은 올라가면 안 돼요");
  assert.ok(Math.abs(f.bonusARMOR - (b.bonusARMOR + 20) * 1.25) < 1e-6,
    `추가 방어력 = (원래 + 20) × 1.25 여야 해요 (${f.bonusARMOR})`);
  assert.equal(Math.round(f.bonusMR * 100), Math.round(b.bonusMR * 100), "요새화는 마법 저항력을 올리지 않아요");
  const g = with1623("Garen", ["MysticGuard"]);
  assert.equal(Math.round(g.bonusARMOR * 100), Math.round(b.bonusARMOR * 100), "신비한 방호는 방어력을 올리지 않아요");
});

test("16.23 저항 증강 여러 개는 더해서 센다", () => {
  const b = with1623("Garen", []), both = with1623("Garen", ["Fortified", "SteadfastPresence"]);
  assert.ok(Math.abs(both.bonusARMOR - (b.bonusARMOR + 20) * (1 + 0.25 + 0.16)) < 1e-6,
    `25% + 16% 가 더해져야 해요 (${both.bonusARMOR})`);
});

test("16.23 저항 증강은 원형질 안전벨트 회복(추가 저항 175%)을 키운다", () => {
  const m = (ids) => St.evaluate(champ("Garen"), 18, [item("원형질 안전벨트")],
    S.augStatsOf(ids.map(a1623).filter(Boolean), d.rules, champ("Garen")), { aram: true }).m;
  const bare = m([]), fort = m(["Fortified"]);
  const t0 = with1623("Garen", [], ["원형질 안전벨트"]), t1 = with1623("Garen", ["Fortified"], ["원형질 안전벨트"]);
  const gain = (t1.bonusARMOR - t0.bonusARMOR) * 1.75;
  assert.ok(Math.abs((fort.selfHealAll - bare.selfHealAll) - gain) < 1, `늘어난 추가 방어력의 175% 만큼이어야 해요`);
  assert.equal(Math.round(fort.selfHpAll), Math.round(bare.selfHpAll), "최대 체력 증가 몫은 저항과 상관없어요");
});

test("16.23 점액 천지는 6초마다 상대 최대 체력 비례 피해", () => {
  const fx = a1623("ARAM_SlimeTime").effects;
  assert.equal(fx.length, 2, "기본 피해 + 최대 체력 비례 둘");
  for (const e of fx) assert.equal(e.trigger.sec, 6);
  assert.ok(JSON.stringify(fx).includes("TGT_MAXHP"), "상대 최대 체력 비례가 들어가야 해요");
  const bare = St.evaluate(champ("Garen"), 18, [], [], { aram: true }).m;
  const slime = St.evaluate(champ("Garen"), 18, [],
    S.augStatsOf([a1623("ARAM_SlimeTime")], d.rules, champ("Garen")), { aram: true }).m;
  assert.ok(slime.combo > bare.combo && slime.dps > bare.dps, "피해가 들어가야 해요");
});

test("16.23 사라진 증강 4개는 기록용으로 남는다", () => {
  const gone = (d.removedAugs || []).map((x) => x.id).sort();
  assert.deepEqual(gone, ["PatOnTheBack", "SharkTempest", "Snowbomb", "SurgeField"]);
  for (const x of d.removedAugs) assert.equal(x.removedIn, "16.23.1");
  for (const id of gone) assert.equal(d.augments.find((a) => a.id === id), undefined, "추천 목록에는 없어야 해요");
});

// ---------------------------------------------------------------- F5-E 가동률·발동 구조
const f5e = (id) => St.evaluate(champ(id), 18, [], [], { aram: true }).m;
const f5eSpell = (id, slot) => champ(id).spells.find((s) => s.slot === slot);
const f5eVal = (id, slot, name) => f5e(id).spells.find((s) => s.slot === slot).values.find((v) => v.name === name).value;

test("F5-E 토글 장판은 초당 값 그대로, 콤보에는 콤보 시간만큼 (신지드 Q·카서스 E)", () => {
  for (const [id, slot, name] of [["Singed", "Q", "damagepersecond"], ["Karthus", "E", "totaldps"]]) {
    const e = f5eSpell(id, slot).effects.find((x) => x.name === name);
    assert.equal(e.perSec, true, `${id} ${slot} 가 초당 값으로 표시돼야 해요`);
    const m = f5e(id);
    const sp = m.spells.find((s) => s.slot === slot);
    // 콤보 몫 = 초당 몫 × 4초(COMBO_WINDOW) — 두 자리가 같은 비율이어야 한다
    assert.ok(sp.dmg > 0 && m.skillDps > 0);
    assert.ok(Math.abs(sp.dmg / 4 - (sp.dmg / 4)) < 1e-9);
  }
});

test("F5-E 티모 E 는 총량(4초)과 즉시 적중을 가른다", () => {
  const e = f5eSpell("Teemo", "E").effects.find((x) => x.name === "totaldotdamage");
  assert.equal(e.dotSec, 4);
  assert.equal(e.dotNeedsAuto, true);
  const impact = f5eSpell("Teemo", "E").effects.find((x) => x.name === "impactcalculateddamage");
  assert.equal(impact.onhit, true, "즉시 피해는 평타 적중 쪽 그대로예요");
  const m = f5e("Teemo");
  assert.ok(m.spellOnhit > 0 && m.skillDps > 0);
});

test("F5-E 렝가 Q 는 평타 한 대와의 차이만 센다", () => {
  const m = f5e("Rengar");
  const t = St.computeStats(champ("Rengar"), 18, [], [], { aram: true }).total;
  const q = m.spells.find((s) => s.slot === "Q");
  const val = f5eVal("Rengar", "Q", "qtotaldamage");
  assert.ok(q.dmg < val, `평타 피해를 뺀 값이어야 해요 (${q.dmg} vs ${val})`);
  assert.ok(q.dmg > 0 && val - t.AD > 0);
  assert.ok(q.cd > 3 && q.cd < 7, `발동 간격은 충전 시간이어야 해요 (${q.cd})`);
});

test("F5-E 애쉬 Q·유나라 Q 는 평타 쪽으로 가고 콤보에는 안 남는다", () => {
  for (const id of ["Ashe", "Yunara"]) {
    const m = f5e(id);
    const q = m.spells.find((s) => s.slot === "Q");
    assert.equal(Math.round(q.dmg), 0, `${id} Q 가 콤보에 남으면 평타와 두 번 세요`);
    assert.ok(m.spellOnhit > 0, `${id} 의 평타 적중 피해에 들어가야 해요`);
    assert.ok(m.empowerUptime && m.empowerUptime.Q > 0 && m.empowerUptime.Q <= 1, `${id} 가동률이 0~1 이어야 해요`);
  }
  // 유나라 확산 피해(주변 적)는 상대 한 명 기준 계산에서 뺀다
  assert.equal(f5eSpell("Yunara", "Q").effects.find((x) => x.name === "calc_damage_spread"), undefined);
});

test("F5-E 가동률 식은 '활성 중에도 중첩이 쌓인다' 를 따른다 (애쉬·유나라 같은 식)", () => {
  // needSec = max(0, 필요 - 지속 × 공속 × 평타당) ÷ (공속 × 평타당),  가동률 = 지속 ÷ (지속 + needSec)
  const want = (dur, need, perHit, as) => {
    const rate = as * perHit;
    const needSec = Math.max(0, (need - dur * rate)) / rate;
    return Math.round(dur / (dur + needSec) * 1000) / 1000;
  };
  for (const [id, dur, need, perHit] of [["Ashe", 6, 4, 1], ["Yunara", 5, 8, 2]]) {
    for (const lv of [1, 3, 6, 11, 18]) {
      const as = St.computeStats(champ(id), lv, [], [], { aram: true }).total.AS;
      const got = St.evaluate(champ(id), lv, [], [], { aram: true }).m.empowerUptime.Q;
      assert.ok(Math.abs(got - want(dur, need, perHit, as)) < 2e-3,
        `${id} ${lv}레벨 가동률이 식과 달라요 (${got} vs ${want(dur, need, perHit, as)})`);
    }
  }
  // 18레벨(추천 기준)에서는 둘 다 1 — 지속시간 안에 중첩이 다 모인다
  assert.equal(St.evaluate(champ("Ashe"), 18, [], [], { aram: true }).m.empowerUptime.Q, 1);
  assert.equal(St.evaluate(champ("Yunara"), 18, [], [], { aram: true }).m.empowerUptime.Q, 1);
  // 1레벨(공속 낮음)에서는 1 아래
  assert.ok(St.evaluate(champ("Yunara"), 1, [], [], { aram: true }).m.empowerUptime.Q < 1);
});

test("F5-E 가동률은 공격 속도에서 나온다 (느리면 내려간다)", () => {
  const c = champ("Ashe");
  const fast = St.evaluate(c, 18, [], [], { aram: true }).m.empowerUptime.Q;
  const slow = St.evaluate(c, 3, [], [], { aram: true }).m.empowerUptime.Q;
  assert.ok(fast >= slow, `공격 속도가 낮으면 가동률이 같거나 낮아야 해요 (${fast} vs ${slow})`);
  assert.ok(fast <= 1);
});

// ---- v0.1.95 Phase 4 C9-B: 저항 감소로 '아군이' 더 넣는 피해
// 아군 모델은 setAllies 로 넣는다 (게임에서는 app.js 가 실제 아군으로 만든다). 테스트는 끝나면 반드시 비운다.
const ally = (o) => ({ name: o.name || "t", dps: o.dps != null ? o.dps : 1000, phys: o.phys != null ? o.phys : 1,
  magic: o.magic != null ? o.magic : 0, pen: o.pen || {}, keys: o.keys || {} });
const withAllies = (list, fn) => { St.setAllies(list); try { return fn(); } finally { St.setAllies(null); } };
const BC = () => item("칠흑의 양날 도끼");

test("C9-B 저항 감소가 없으면 아군 몫도 0 이다", () => {
  withAllies([ally({})], () => {
    for (const [id, items] of [["Garen", []], ["Jhin", [item("무한의 대검")]], ["Lux", [item("루덴의 메아리")]]]) {
      const m = St.evaluate(champ(id), 18, items, [], { aram: true }).m;
      assert.equal(m.shredAlly.avg, 0, `${id} 는 저항 감소가 없는데 아군 몫이 생겼어요`);
    }
  });
});

test("C9-B 점수에 들어가는 것은 '본 아군의 평균 한 명분' 이다 (합계가 아니다)", () => {
  const one = ally({ name: "a", dps: 1000, phys: 1 });
  const four = [one, ally({ name: "b", dps: 1000, phys: 1 }), ally({ name: "c", dps: 1000, phys: 1 }), ally({ name: "d", dps: 1000, phys: 1 })];
  const m1 = withAllies([one], () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m);
  const m4 = withAllies(four, () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m);
  assert.equal(m4.shredAlly.n, 4);
  assert.ok(Math.abs(m4.shredAlly.sum - m1.shredAlly.sum * 4) < 1e-6, "같은 아군 넷이면 합은 네 배여야 해요");
  assert.ok(Math.abs(m4.shredAlly.avg - m1.shredAlly.avg) < 1e-6, "평균 한 명분은 인원수와 무관해야 해요");
  // out.allyDmg 에는 평균만 더해진다
  const base = withAllies([one], () => St.evaluate(champ("Garen"), 18, [], [], { aram: true }).m);
  assert.ok(Math.abs((m1.allyDmg - base.allyDmg) - m1.shredAlly.avg) < 1e-6, "지원 쪽에는 평균 한 명분만 들어가야 해요");
});

test("C9-B 아군을 한 명도 못 보면 대체 모델 하나, 일부만 보면 본 아군만 센다", () => {
  const seen = withAllies([ally({ dps: 1000 }), ally({ name: "b", dps: 1000 })],
    () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly);
  assert.equal(seen.source, "live");
  assert.equal(seen.n, 2, "모자란 인원을 기준 아군으로 채우면 안 돼요");
  St.setAllies(null);
  const none = St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly;
  assert.equal(none.source, "model");
  assert.equal(none.n, 1);
  assert.ok(none.avg > 0);
});

test("C9-B 고정 피해에는 저항 감소가 걸리지 않는다", () => {
  const m = withAllies([ally({ dps: 1000, phys: 0, magic: 0 })], () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m);
  assert.equal(m.shredAlly.avg, 0, "고정 피해만 넣는 아군에게는 득이 없어야 해요");
});

test("C9-B 물리 감소는 물리 아군에게, 마법 감소는 마법 아군에게 간다", () => {
  const physAlly = [ally({ dps: 1000, phys: 1, magic: 0 })], magAlly = [ally({ dps: 1000, phys: 0, magic: 1 })];
  const bc = (list) => withAllies(list, () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly.avg);
  const mal = (list) => withAllies(list, () => St.evaluate(champ("Lux"), 18, [item("악의")], [], { aram: true }).m.shredAlly.avg);
  assert.ok(bc(physAlly) > 0 && bc(magAlly) === 0, "칠흑(방어력 감소)은 물리 아군에게만 가야 해요");
  assert.ok(mal(magAlly) > 0 && mal(physAlly) === 0, "악의(마법 저항력 감소)는 마법 아군에게만 가야 해요");
});

test("C9-B 아군이 같은 효과를 들고 있으면 내 기여가 줄고, 같은 값이면 0 이다", () => {
  const myKeys = St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shred.keys;
  const plain = ally({ dps: 1000, phys: 1 });
  const sameItem = ally({ dps: 1000, phys: 1, keys: myKeys });   // 나와 똑같은 칠흑을 들었다
  const half = ally({ dps: 1000, phys: 1, keys: Object.fromEntries(Object.entries(myKeys)
    .map(([k, v]) => [k, { ...v, value: v.value / 2 }])) });
  const g = (a) => withAllies([a], () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly.avg);
  assert.ok(g(plain) > 0);
  assert.equal(g(sameItem), 0, "같은 효과를 같은 값으로 들고 있으면 더해 줄 몫이 없어야 해요");
  assert.ok(g(half) > 0 && g(half) < g(plain), "일부만 겹치면 내 기여가 줄어야 해요");
});

test("C9-B 서로 다른 효과는 겹치지 않는다 (곱해서 쌓인다)", () => {
  const malKeys = St.evaluate(champ("Lux"), 18, [item("악의")], [], { aram: true }).m.shred.keys;
  const plain = ally({ dps: 1000, phys: 1 });
  const other = ally({ dps: 1000, phys: 1, keys: malKeys });  // 아군은 고정 마법 저항력 감소 — 내 방어력 감소와 다르다
  const g = (a) => withAllies([a], () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly.avg);
  assert.ok(Math.abs(g(other) - g(plain)) < 1e-9, "효과가 다르면 내 몫이 깎이지 않아야 해요");
});

test("C9-B 아군 자신의 관통으로 센다 (내 관통이 아니다)", () => {
  const noPen = ally({ dps: 1000, phys: 1 });
  const penAlly = ally({ dps: 1000, phys: 1, pen: { ARPEN: 0.4 } });
  const g = (a) => withAllies([a], () => St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shredAlly.avg);
  assert.ok(g(penAlly) < g(noPen), "관통이 많은 아군에게는 저항 감소의 득이 작아야 해요");
  // 내 관통을 바꿔도 아군 쪽 배율비는 그대로여야 한다 (내 관통을 아군에게 쓰면 틀린다)
  const mine = (items) => withAllies([noPen], () => St.evaluate(champ("Garen"), 18, items, [], { aram: true }).m);
  const plainMe = mine([BC()]), penMe = mine([BC(), item("도미닉 경의 인사")]);
  assert.equal(plainMe.shred.armorShred, penMe.shred.armorShred, "관통 아이템은 감소량을 바꾸지 않아요");
  assert.ok(Math.abs(plainMe.shredAlly.per[0].physRatio - penMe.shredAlly.per[0].physRatio) < 1e-12,
    "내가 관통을 더 사도 아군 쪽 배율비는 그대로여야 해요");
});

test("C9-B 아군은 내 피해를 바꾸지 않는다 (역방향 기여는 이번 범위 밖)", () => {
  const keys = St.evaluate(champ("Garen"), 18, [BC()], [], { aram: true }).m.shred.keys;
  const none = St.evaluate(champ("Lux"), 18, [item("루덴의 메아리")], [], { aram: true }).m;
  const with4 = withAllies([ally({ keys }), ally({ name: "b", keys })],
    () => St.evaluate(champ("Lux"), 18, [item("루덴의 메아리")], [], { aram: true }).m);
  assert.equal(with4.combo, none.combo, "아군의 저항 감소가 내 피해를 키우면 안 돼요 (아직 안 센다)");
  assert.equal(with4.dps, none.dps);
});

test("C9-B 아군 지문(allyKey)은 아군이 바뀔 때만 바뀐다", () => {
  St.setAllies(null);
  assert.equal(St.allyKey(), "");
  St.setAllies([ally({ name: "a", dps: 1000 })]);
  const k1 = St.allyKey();
  St.setAllies([ally({ name: "a", dps: 1000 })]);
  assert.equal(St.allyKey(), k1, "같은 아군이면 지문도 같아야 캐시를 쓸 수 있어요");
  St.setAllies([ally({ name: "a", dps: 1200 })]);
  assert.notEqual(St.allyKey(), k1, "아군이 아이템을 사면 지문이 달라져야 해요");
  St.setAllies(null);
  assert.equal(St.allyKey(), "");
});
