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
  const heal = (augs) => St.evaluate(lux, 18, [], S.augStatsOf(augs, d.rules, lux)).m.heal;
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
  assert.deepEqual(legendBuild("Renekton", ["ARAM_ScopiestWeapons"], "augment"), legendBuild("Renekton", [], "augment"));
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
