// 통합 추천 일관성 (2026-10-22 고도화 기획서 7.2 시나리오): 증강 추천 · 연계 · 아이템 추천 · 상대 대응이 서로 모순되지 않는지.
// 원하는 동작을 검사한다 → 실패하면 실제 오류 (1단계 재현), 고친 뒤 통과해야 한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage } = require("./page");

const setup = async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const item = (n) => p.data.items.find((i) => i.name === n);
  const isAP = (n) => ((item(n) || {}).tags || {}).AP >= 0.5;
  const isAD = (n) => ((item(n) || {}).tags || {}).AD >= 0.5;
  // 흡혈 아이템을 산 적 = 회복 많음 (enemyInfo healItem)
  const vamp = p.data.items.filter((i) => i.kind === "legendary" && (i.tags.VAMP || 0) >= 0.5).map((i) => i.id);
  const live = (champion, extra = {}) => p.w.applyLive({ enabled: true, inGame: true, champion, level: 14, gold: 0, gameTime: 700, items: [],
    enemies: ["Darius", "Fiora", "Lux", "Ahri", "Malphite"], ...extra });
  const healers = (aug = {}) => ["Darius", "Fiora", "Lux", "Ahri", "Malphite"].map((c, i) => ({ champion: c, level: 14,
    items: i < 2 ? [vamp[0], vamp[1]].filter(Boolean) : [], augments: aug[c] || [] }));
  const pick = (name) => p.w.applyAug({ offers: null, seq: 1, picked: name, pickedFrom: [name, null, null], pickSeq: (p.__ps = (p.__ps || 0) + 1) });
  const advice = () => { p.w.renderItemList(); p.w.sendOverlay(); return (sent.at(-1).enemy || {}).advice || []; };
  return { p, sent, item, isAP, isAD, live, healers, pick, advice };
};

test("R1 상대 대응 조언은 증강으로 바뀐 피해 유형을 따른다: 징크스 + 적응형 능력치(공격력→주문력)면 치유 감소도 주문력 쪽", async () => {
  const { p, live, healers, pick, advice, isAP } = await setup();
  live("Jinx", { enemyBuilds: healers() });
  const before = advice().join("\n");
  assert.match(before, /치유 감소|회복/, "회복 많은 적 조언이 있어야");
  pick("적응형 능력치");
  const after = advice().find((l) => /회복/.test(l)) || "";
  const names = (after.match(/→[^(]*/) || [""])[0];
  assert.ok(p.data.items.some((i) => names.includes(i.name) && isAP(i.name)), `주문력 치유 감소 아이템이 없음: ${after}`);
  p.w.close();
});

test("R1b 저항 조언도 증강 유형을 따른다: 럭스 + 마법사 (물리)(주문력→공격력)면 공격력 마법 저항 아이템", async () => {
  const { p, live, pick, advice, isAD } = await setup();
  // 적이 전부 마법 → 마법 저항 우선
  const mages = ["Lux", "Ahri", "Xerath", "Syndra", "Brand"];
  live("Lux", { enemies: mages, enemyBuilds: mages.map((c) => ({ champion: c, level: 14, items: [] })) });
  pick("마법사 (물리)");
  const line = advice().find((l) => /마법 저항 우선/.test(l)) || "";
  const names = (line.split("우선:")[1] || "");
  assert.ok(p.data.items.some((i) => names.includes(i.name) && isAD(i.name)), `공격력 마법 저항 아이템이 없음: ${line}`);
  p.w.close();
});

test("R2 조언이 권한 대응 아이템이 다음 구매에 들어간다 (완성 빌드 후보에 없어도): 가렌 vs 회복 많은 적", async () => {
  const { p, sent, live, healers, advice } = await setup();
  live("Garen", { enemyBuilds: healers() });
  const adv = advice().find((l) => /회복/.test(l)) || "";
  const hud = (sent.at(-1).hud || []).join("\n");
  // 조언에 나온 이름(완성품 또는 부품)이 다음 구매·지금 살 것 줄 어디에도 없으면 조언과 구매가 따로 논다
  const parts = Object.values(p.data.parts || {}).map((x) => x.name);
  const named = [...p.data.items.map((i) => i.name), ...parts].filter((n) => adv.includes(n));
  assert.ok(named.length, `조언에 아이템 이름이 없음: ${adv}`);
  const buyLines = hud.split("\n").filter((l) => /다음 구매|지금/.test(l)).join(" / ");
  assert.ok(named.some((n) => buyLines.includes(n)), `조언(${named.join("·")})이 다음 구매·지금 살 것(${buyLines})에 없음`);
  p.w.close();
});

test("R3 시험 인식(점수판) 증강은 대응 조언·상대 능력치를 바꾸지 않고, 다음 게임에 남지 않는다", async () => {
  const { p, live, advice } = await setup();
  const heal = p.data.augments.find((a) => a.category !== "spell" && (((p.data.rules.augments[a.id] || {}).tags || a.tags || {}).HEALSHIELD || 0) >= 0.6);
  const foes = ["Lux", "Ahri", "Xerath", "Ezreal", "Jinx"];
  const builds = foes.map((c) => ({ champion: c, level: 12, items: [] }));
  live("Garen", { enemies: foes, enemyBuilds: builds });
  const base = advice().join("\n");
  const T0 = JSON.stringify(p.w.Stats.TARGET);
  // 점수판으로만 읽은 회복 증강 (럭스·아리)
  live("Garen", { enemies: foes, enemyBuilds: builds, aug: { enemyAugs: { Lux: [heal.id], Ahri: [heal.id] } } });
  const withBoard = advice().join("\n");
  assert.doesNotMatch(withBoard, /적 회복 많음/, "점수판 증강으로 회복 조언이 생김");
  assert.equal(JSON.stringify(p.w.Stats.TARGET), T0, "점수판 증강이 상대 능력치를 바꿈");
  assert.equal(withBoard.replace(/\n?.*점수판.*/g, ""), base.replace(/\n?.*점수판.*/g, ""), "점수판 정보 줄 말고는 같아야");
  // 같은 증강이 확인 경로와 점수판에 둘 다 있으면 한 번만 (확인된 쪽)
  live("Garen", { enemies: foes, enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items: [], augments: c === "Lux" ? [heal.id] : [] })),
    aug: { enemyAugs: { Lux: [heal.id] } } });
  const lux = p.w.enemyInfo().list.find((c) => c.id === "Lux");
  assert.ok(lux);
  // 다음 게임 (다른 적): 이전 적 증강이 남지 않는다
  const foes2 = ["Garen", "Darius", "Sett", "Mordekaiser", "Nasus"];
  p.w.applyLive({ enabled: true, inGame: true, champion: "Lux", level: 3, gameTime: 10, items: [], enemies: foes2,
    enemyBuilds: foes2.map((c) => ({ champion: c, level: 3, items: [] })) });
  assert.doesNotMatch(advice().join("\n"), /럭스|아리/, "이전 게임 적이 조언에 남음");
  p.w.close();
});

test("R4 대응 아이템은 이미 가진 아이템·같은 고유 효과를 권하지 않는다", async () => {
  const { p, live, healers, advice, item } = await setup();
  const mr = item("필멸자의 운명");
  live("Jinx", { items: [mr.id], enemyBuilds: healers() });
  const adv = advice().find((l) => /회복/.test(l)) || "";
  const sameLimit = p.data.items.filter((i) => i.limit && i.limit === mr.limit && i.kind === "legendary").map((i) => i.name);
  for (const n of sameLimit) assert.ok(!(adv.split("→")[1] || "").includes(n), `가진 것과 같은 계열 ${n}: ${adv}`);
  p.w.close();
});

test("R5 상대 대응이 증강 필수 아이템(강철 같은 심장 → 강철심장)을 밀어내지 않는다", async () => {
  const { p, sent, live, healers, pick, advice } = await setup();
  live("Garen", { enemyBuilds: healers() });
  pick("강철 같은 심장");
  advice();
  const first = ((sent.at(-1).hud || [])[0] || "");
  assert.match(first, /다음 구매: 강철심장/, first);
  p.w.close();
});
