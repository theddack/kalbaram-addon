// 추천 성질 검사 (증강 중심 원칙, 2026-11-12): 특정 아이템 조합을 정답으로 두지 않고
// "고른 증강의 효과를 그 빌드가 실제로 살리는가"와 빌드 종류·등급 규칙을 본다. 계산식 자체는 tests/calc.test.js.
//   활용도 = 그 빌드에서 고른 증강들이 보태는 가치 합 (scoring.augContribution). 전 챔피언 점검은 tools/augment_regress.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = require(path.join(WEB, "stats.js"));
const St = global.Stats;
const S = require(path.join(WEB, "scoring.js"));
const d = require(path.join(WEB, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (name) => d.items.find((i) => i.name === name);
const byName = (name) => d.augments.find((a) => a.name === name);

const builds = (cid, augNames, keys = ["augment", "balanced"]) => {
  const c = champ(cid), w = S.profile(c, d.tags), augs = augNames.map(byName);
  const out = Object.fromEntries(S.buildConcepts(d.items, w, augs, [], d.rules, c, {}, keys).map((b) => [b.key, b.pick.map((p) => p.item)]));
  out.base = S.buildConcepts(d.items, w, [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
  const util = (items) => augs.reduce((t, a, i) => t + S.augContribution(items, w, augs.filter((_, j) => j !== i), a, d.rules, c), 0);
  out.u = Object.fromEntries(Object.keys(out).map((k) => [k, util(out[k])]));
  out.legend = (k) => out[k].filter((i) => i.kind === "legendary").map((i) => i.name);
  return out;
};

// 역할이 다른 증강·같은 성향 증강·연계 증강 3개를 섞은 대표 장면
const SCENES = [
  ["Garen", ["작은 도움", "검무", "마도사의 주스 상자"]],
  ["MonkeyKing", ["핏빛 코발트", "원 히트 원더", "되풀이"]],
  ["Sion", ["강타자"]],
  ["Kaisa", ["사악한 정신"]],
  ["Kayle", ["광신자"]],
  ["Viktor", ["궁극의 히드라"]],
];

test("추천 1: 균형 빌드는 증강 없이 짠 기본 빌드보다 고른 증강을 덜 살리지 않는다", () => {
  for (const [cid, names] of SCENES) {
    const b = builds(cid, names);
    assert.ok(b.u.balanced >= b.u.base - 1e-6, `${cid} [${names}] 균형 ${b.u.balanced} < 기본 ${b.u.base}`);
  }
});

test("추천 2: 증강 몰빵 빌드는 균형 빌드만큼은 증강을 살린다 (계산 오차 3% 안)", () => {
  for (const [cid, names] of SCENES) {
    const b = builds(cid, names);
    assert.ok(b.u.augment >= b.u.balanced * 0.97 - 1e-6, `${cid} [${names}] 몰빵 ${b.u.augment} < 균형 ${b.u.balanced}`);
  }
});

test("추천 3: 역할과 다른 퀘스트는 D 로 막지 않고 '변칙 퀘스트' 안내만, 몰빵 빌드는 퀘스트 아이템을 모두 넣는다", () => {
  const hyd = ["굶주린 히드라", "불경한 히드라", "거대한 히드라"];
  const vik = champ("Viktor"), w = S.profile(vik, d.tags), q = byName("궁극의 히드라");
  const r = S.rankAugments([q], w, [], [], vik, d.rules, d.items)[0];
  assert.equal(r.req, null, "발동 조건(req)으로 막지 않는다");
  assert.equal(r.hint && r.hint.kind, "offTypeQuest");
  const t = S.augmentTiers(d.augments, d.items, w, [], [], d.rules, vik, {}, "total")[q.id];
  assert.ok(!t.reasons.includes("조건 없음"), JSON.stringify(t));
  assert.equal(builds("Viktor", ["궁극의 히드라"]).legend("augment").filter((n) => hyd.includes(n)).length, 3);
  // 평소 유형과 맞으면 안내도 없다
  const dar = champ("Darius");
  const rd = S.rankAugments([q], S.profile(dar, d.tags), [], [], dar, d.rules, d.items)[0];
  assert.ok(!rd.hint && !rd.req);
});

test("추천 4: 균형 빌드의 칸 제한은 코어 밖 '반대 유형' 아이템에만 (같은 유형의 증강용 아이템은 제한 없음)", () => {
  // 메이지 + 궁극의 히드라: 반대 유형(AD) 아이템은 offSlots 칸까지만
  const ad = (n) => { const t = item(n).tags || {}; return (t.AD || 0) >= 0.5 && !((t.AP || 0) >= 0.5); };
  const v = builds("Viktor", ["궁극의 히드라"]);
  const core = v.legend("base");
  assert.ok(v.legend("balanced").filter((n) => !core.includes(n) && ad(n)).length <= S.offSlots(champ("Viktor")), `${v.legend("balanced")}`);
  // 같은 유형(AD 챔피언의 AD 아이템)은 코어 밖이어도 칸 수에 안 센다: 코어 아이템을 후보에서 빼면 코어 밖 AD 템이 2칸을 넘어 들어가야 한다.
  // (2026-11-14 바꿈: 예전 예시 '다리우스 + 붐 앤 베이스 + 왕관의 무게 + 이빨 요정'은 증강 태그가 지표 가중치에 섞이던 것(E3)에 기대고 있었다)
  const darC = champ("Darius"), darW = S.profile(darC, d.tags);
  const darCore = S.buildConcepts(d.items, darW, [], [], d.rules, darC, {}, ["balanced"])[0].pick.filter((p) => p.item.kind === "legendary").map((p) => p.item.name);
  const augs = ["붐 앤 베이스", "왕관의 무게"].map(byName);
  const pool = d.items.filter((i) => !darCore.includes(i.name));
  const bal = S.buildConcepts(pool, darW, augs, [], d.rules, darC, {}, ["balanced"])[0].pick.filter((p) => p.item.kind === "legendary").map((p) => p.item.name);
  const sameType = bal.filter((n) => ad(n));
  assert.ok(sameType.length > S.offSlots(darC), `${bal} / 코어 ${darCore}`);
});

test("추천 5: 혼합형(원딜 + 메이지 또는 피해 유형 혼합)은 반대 유형 칸을 하나 더", () => {
  assert.equal(S.offSlots(champ("Kayle")), 3);
  assert.equal(S.offSlots(champ("Kaisa")), 3);
  assert.equal(S.offSlots(champ("Garen")), 2);
  assert.equal(S.offSlots(champ("Viktor")), 2);
});

test("추천 6: 적중 시 아이템(구인수)의 이득은 평타로 싸우는 챔피언이 스킬로 싸우는 챔피언보다 크다", () => {
  const gain = (cid) => {
    const c = champ(cid);
    const m0 = St.evaluate(c, 18, [], [], { aram: true }).m, m1 = St.evaluate(c, 18, [item("구인수의 격노검")], [], { aram: true }).m;
    return (m1.dps - m0.dps) / m0.dps;
  };
  assert.ok(gain("Kayle") > gain("Lux"), `케일 ${gain("Kayle")} 럭스 ${gain("Lux")}`);
});

// P2 (2026-11-14 엔진 개선): 증강이 빌드에서 따라갈 입력 능력치(lift)를 효과 계수·발동 방식·변환 키에서 읽는다.
// 예전엔 수치 증강 180개 중 128개가 비어, 몰빵 가중치가 챔피언 가중치와 같아졌다 (화염 낙인·치명적 리듬·유레카 …)
test("P2-1: 변환·발동 방식에서 입력 능력치를 읽는다 (고정 능력치만 있는 증강은 비워 둔다)", () => {
  const jinx = champ("Jinx");
  const lift = (n) => S.augContext([byName(n)], d.rules, jinx).lift;
  assert.ok(lift("유레카").AP > 0, "유레카: 주문력 → 가속");
  assert.ok(lift("치명적 리듬").CRIT > 0, "치명적 리듬: 치명타마다 공속");
  assert.ok(lift("간지럼 괴물").AD > 0, "간지럼 괴물: 아이템 공격력 → 공속");
  assert.ok(lift("화염 낙인").AS > 0, "화염 낙인: 평타마다 화상");
  assert.ok(!lift("화염 낙인").HP, "대상 체력 비례는 자기 체력과 연결 안 함");
  assert.ok(lift("강타자").HP > 0, "강타자: 자기 최대 체력 비례");
  assert.deepEqual(lift("사악한 정신"), {}, "주문력 +80 은 아이템으로 안 커짐");
});

// P2-2: 전체 전투 가치는 챔피언 성향 가중치 그대로(증강 태그를 섞지 않음), 몰빵의 증강 몫은 증강 출력 가중치로.
// 강타자(최대 체력 비례 '피해')의 체력 태그가 버티는 힘 가중치로 새지 않고, 증강 출력은 피해 쪽이다
test("P2-2: 증강 태그는 지표 가중치에 섞지 않고, 증강 몫은 증강 출력(강타자 = 피해)으로 잰다", () => {
  const sion = champ("Sion"), w = S.profile(sion, d.tags), hh = byName("강타자");
  assert.deepEqual(S.conceptMetricWeights(w, [hh], d.rules, sion, S.CONCEPTS[0]), S.conceptMetricWeights(w, [], d.rules, sion, S.CONCEPTS[0]));
  const out = S.augOutputWeights([hh], d.rules, sion);
  assert.ok(out.dps + out.combo > 0.9 && out.ehp < 0.05, JSON.stringify(out));
  assert.equal(S.augOutputWeights([], d.rules, sion), null);
});

// P4 (2026-11-14): 최종 점수는 순서와 무관하고, 빔 뒤 교체 탐색으로 한 칸 교체로는 더 오르지 않는다
test("P4: 같은 구성은 순서와 무관하게 같은 점수, 엔진 빌드는 한 칸 교체로 더 오르지 않는다", () => {
  for (const [cid, names, key] of [["Leona", ["핀볼"], "augment"], ["Nami", ["흡수"], "balanced"], ["Jinx", ["강타자"], "augment"]]) {
    const c = champ(cid), w = S.profile(c, d.tags), ch = names.map(byName);
    const b = S.buildConcepts(d.items, w, ch, [], d.rules, c, {}, [key])[0];
    const list = b.pick.map((p) => p.item);
    assert.ok(Math.abs(b.scoreOf(list) - b.scoreOf(list.slice().reverse())) < 1e-9, `${cid} 순서`);
    // 교체 후보: 이 챔피언의 다른 빌드에 나온 아이템 (엔진 제약을 지키는 아이템들)
    const pool = new Set(S.buildConcepts(d.items, w, ch, [], d.rules, c, {}).flatMap((x) => x.pick.map((p) => p.item)));
    const base = b.scoreOf(list);
    for (let k = 0; k < list.length; k++) for (const it of pool) {
      if (it.kind !== list[k].kind || list.includes(it)) continue;
      const cand = list.slice(); cand[k] = it;
      const lim = cand.map((i) => i.limit).filter(Boolean);
      if (new Set(lim).size !== lim.length) continue;
      assert.ok(b.scoreOf(cand) <= base + 1e-9, `${cid} ${key}: ${list[k].name} → ${it.name} 이 더 높다`);
    }
  }
});

// P3: 몰빵의 공식 추천 가산 실험 설정과 δ(전투 가치 하한)
test("P3: δ 를 정하면 몰빵 빌드의 전투 가치는 균형 빌드의 (1 − δ) 이상, 끄면 예전 목표 그대로", () => {
  const c = champ("Jinx"), w = S.profile(c, d.tags), ch = [byName("강타자")];
  const off = S.buildConcepts(d.items, w, ch, [], d.rules, c, {}, ["augment"])[0];
  try {
    S.setAugmentDelta(0.2);
    const b = S.buildConcepts(d.items, w, ch, [], d.rules, c, {}, ["augment"])[0];
    const bal = S.buildConcepts(d.items, w, ch, [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
    const list = b.pick.map((p) => p.item);
    assert.ok(b.valueOf(list) >= 0.8 * b.valueOf(bal) - 1e-9, `${b.valueOf(list)} vs ${b.valueOf(bal)}`);
    assert.ok(b.augOf(list) >= off.augOf(off.pick.map((p) => p.item)) - 1e-9, "증강 몫은 줄지 않는다");
  } finally { S.setAugmentDelta(null); }
  const again = S.buildConcepts(d.items, w, ch, [], d.rules, c, {}, ["augment"])[0];
  assert.deepEqual(again.pick.map((p) => p.item.name), off.pick.map((p) => p.item.name), "끄면 원래대로");
});
