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
  // 탄환 세례: 방향마다 8초 대기시간은 스킬 가속과 무관 → 가속 아이템을 끌어오지 않는다
  assert.ok(!("HASTE" in d.rules.augments.ARAM_FanTheHammer.tags));
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
  const ids = Object.entries(d.rules.augments).filter(([, r]) => r.effectCooldown).map(([id]) => id);
  assert.ok(ids.length >= 4, ids.join(","));
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
test("효과 횟수(effectCount): 탄환 세례 5발·마법 미사일 3발·쌍둥이 불꽃 1 + 치명타 × 3 · 검무는 한타 1번 8회", () => {
  const fx = (id) => aug(id).effects[0];
  assert.equal(fx("ARAM_FanTheHammer").count, 5);
  assert.equal(fx("ARAM_MagicMissile").count, 3);
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
