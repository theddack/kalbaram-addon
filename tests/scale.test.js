// v0.1.93 P2 지표 기준값(normOf). 엔진·화면 이유·점검 도구가 모두 이 함수를 쓴다.
// 기본 sharedAlly: 아군을 돕는 챔피언(allysupport)만 한타 피해·지원을 같은 분모(맨몸 합)로. own 은 v0.1.92까지(기준선 A).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const S = require(path.join(WEB, "scoring.js"));
const ally = { features: ["allysupport"] }, solo = { features: [] };
const m = { combo: 250, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 };

test("기본(sharedAlly): 아군을 돕는 챔피언만 한타 피해·지원 분모가 맨몸 합", () => {
  const a = S.normOf(m, ally), b = S.normOf(m, solo);
  assert.equal(a.combo, 1250);
  assert.equal(a.support, 1250);
  assert.equal(a.ehp, 3000, "다른 지표는 그대로");
  assert.equal(b.combo, 300, "아군 지원이 아닌 챔피언은 자기 맨몸 값(최소 바닥값)");
  assert.equal(b.support, 1000);
  assert.equal(S.normOf({ ...m, support: 90 }, solo).support, 600);
  assert.equal(S.normOf({ combo: 100, support: 50 }, ally).combo, 300, "합이 작으면 한타 피해 바닥값");
});

test("own(기준선 A): 지표마다 자기 맨몸 값, 작으면 바닥값", (t) => {
  t.after(() => S.setNormMode());
  S.setNormMode("own");
  assert.deepEqual(S.normOf(m, ally), { combo: 300, dps: 100, ehp: 3000, support: 1000, mobility: 400, control: 2 });
});

test("화면 이유 문장(지표 증가율)도 같은 기준값: 잔나 균형 빌드 첫 아이템", () => {
  const d = require(path.join(WEB, "data.json"));
  const c = d.champions.find((x) => x.id === "Janna");
  const pick = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, ["balanced"])[0].pick;
  const p = pick.find((x) => x.gain && x.gain.support > 0);
  assert.ok(p, "지원을 늘리는 아이템이 있어야 해요");
  const e0 = Stats.evaluate(c, 18, [], [], {}).m;
  assert.ok(S.normOf(e0, c).combo === S.normOf(e0, c).support);
});

// 럭스·소나 몰빵에 증강과 무관한 불타는 향로가 들어가 증강 몫이 균형보다 줄던 장면 (P1 뒤 생김, P2로 안 풀림, docs/v0.1.93_P2_적용.md).
// P3 E2(회복·보호막 특성 1.0 고정 → 스킬 수 규칙)로 풀린 장면은 일반 테스트로 지킨다.
// 남은 장면은 todo: 원인 후보는 아군 강화를 지속시간 전부로 세는 P1 가정 2와 Riot 역할 '서포터' 기본값 (P4 후속).
// 근거 없는 가중치·발동률로 숨기지 않는다. 고쳐지면 todo 를 떼서 위로 옮긴다.
const hasCenser = (id, augName) => {
  const d = require(path.join(WEB, "data.json"));
  const c = d.champions.find((x) => x.id === id), a = d.augments.find((x) => x.name === augName);
  const pick = S.buildConcepts(d.items, S.profile(c, d.tags), [a], [], d.rules, c, {}, ["augment"])[0].pick.map((p) => p.item.name);
  return [pick.includes("불타는 향로"), pick.join(", ")];
};
for (const [id, augName] of [["Lux", "징수의 총 업그레이드"], ["Sona", "묵직한 한 방"]]) {
  test(`${id} + ${augName}: 몰빵에 불타는 향로가 없다 (P3 E2로 풀림)`, () => { const [has, list] = hasCenser(id, augName); assert.ok(!has, list); });
}
for (const [id, augName] of [["Lux", "묵직한 한 방"], ["Sona", "불사르기 업그레이드"], ["Sona", "징수의 총 업그레이드"]]) {
  test(`${id} + ${augName}: 몰빵에 불타는 향로가 없다`, { todo: "P4: 아군 강화 지속시간 가정" }, () => { const [has, list] = hasCenser(id, augName); assert.ok(!has, list); });
}

// v0.1.93 P3 E2: 데이터의 회복·보호막 특성(build_data.py ally_healshield_trait)이 엔진 계산으로 센 값과 같다
test("아군 지원 챔피언 회복·보호막 특성 = 지원 수치가 나오는 스킬·패시브 수 × 0.4 (데이터 = 엔진 계산)", () => {
  const d = require(path.join(WEB, "data.json"));
  const { healShieldTrait } = require("../tools/exp_env.js");
  const ally = d.champions.filter((c) => c.spells && (c.features || []).includes("allysupport"));
  assert.ok(ally.length > 30);
  for (const c of ally) assert.equal(c.traits.HEALSHIELD || 0, healShieldTrait(Stats, c), c.id);
  assert.ok(ally.some((c) => c.traits.HEALSHIELD < 1), "1.0 고정이 아님");
});

// v0.1.93 P4-A: 회복·보호막의 대상(게임 규칙)과 쓰는 상황(사용 시나리오)을 나눈다.
test("대상별 몫: self 는 자기 생존, ally·allies 는 지원, selfAndAllies 는 둘 다", () => {
  const d = require(path.join(WEB, "data.json"));
  const ev = (id) => { const c = d.champions.find((x) => x.id === id); return Stats.evaluate(c, 18, [], [], {}).m; };
  const garen = ev("Garen");  // W 자기 보호막
  assert.equal(garen.support, 0, "자기 보호막은 지원이 아니에요");
  assert.ok(garen.selfShield > 0);
  const soraka = ev("Soraka");  // Q 자기 회복 · W·R 아군 회복
  assert.ok(soraka.heal > 0 && soraka.selfHeal > 0);
  // selfAndAllies: 케일 W '천상의 축복'(자신과 아군 챔피언 회복) — 자기 몫과 아군 몫이 둘 다 잡힌다
  const kayle = ev("Kayle");
  assert.ok(kayle.selfHeal > 0 && kayle.heal > 0, `selfAndAllies 는 자기·아군 둘 다: 자기 ${Math.round(kayle.selfHeal)} 아군 ${Math.round(kayle.heal)}`);
  // 타릭 R 은 2026-11-16 부터 자기 몫을 무적 경로로 옮겨 자기 보호막이 0 이다 (tests/calc.test.js 에서 따로 본다)
});

test("자기 회복·보호막은 버티는 힘으로 (지원 지표에 두 번 세지 않는다)", () => {
  const d = require(path.join(WEB, "data.json"));
  const c = d.champions.find((x) => x.id === "DrMundo");
  const m = Stats.evaluate(c, 18, [], [], {}).m;
  assert.equal(m.support, 0);
  assert.ok(m.selfHeal > 1000, "R 자기 회복");
  const bare = Stats.evaluate({ ...c, spells: c.spells.map((s) => ({ ...s, effects: [] })) }, 18, [], [], {}).m;
  assert.ok(m.ehp > bare.ehp, "자기 회복이 버티는 힘을 늘려요");
});

test("아군 지원 분류: 아군에게 가는 몫이 계산되는 챔피언만", () => {
  const d = require(path.join(WEB, "data.json"));
  const has = (id) => (d.champions.find((x) => x.id === id).features || []).includes("allysupport");
  for (const id of ["Soraka", "Lulu", "Janna", "Nunu"]) assert.ok(has(id), id);
  // 설명에만 '아군'이 있고 아군 몫이 계산되지 않는 챔피언은 빠진다 (v0.1.93 P4-A)
  for (const id of ["Nilah", "Lucian", "Hecarim", "Galio", "Kled", "Yorick"]) assert.ok(!has(id), id);
});
