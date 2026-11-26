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
  // 회복 많음 판정은 v0.1.95 Phase 4 C4 부터 '추천 점수가 쓰는 회복 추정값'이다 (흡혈 아이템 개수가 아니라).
  // 흡혈 아이템 한두 개로는 추정 회복량이 기준(회복이 있는 챔피언의 중앙값 2명분)에 못 미친다 → 적 전원에게 3개씩 준다
  const vamp = p.data.items.filter((i) => i.kind === "legendary" && (i.tags.VAMP || 0) >= 0.5).map((i) => i.id);
  const live = (champion, extra = {}) => p.w.applyLive({ enabled: true, inGame: true, champion, level: 14, gold: 0, gameTime: 700, items: [],
    enemies: ["Darius", "Fiora", "Lux", "Ahri", "Malphite"], ...extra });
  const healers = (aug = {}) => ["Darius", "Fiora", "Lux", "Ahri", "Malphite"].map((c) => ({ champion: c, level: 14,
    items: vamp.slice(0, 3), augments: aug[c] || [] }));
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

// v0.1.95 Phase 4 C5 (2026-11-26): 예전 R2 는 '조언이 권한 아이템이 다음 구매에 들어간다'였다.
// 그 강제 삽입이 점수 근거 없는 추천을 만들어 없앴다 → 이제 볼 것은 '조언이 아이템을 밀어 넣지 않는가'다.
test("R2 조언은 점수를 설명만 하고 다음 구매에 아이템을 밀어 넣지 않는다: 가렌 vs 회복 많은 적", async () => {
  const { p, live, healers, advice } = await setup();
  live("Garen", { enemyBuilds: healers() });
  const adv = advice();
  assert.ok(adv.some((l) => /회복 많음/.test(l)), `회복 조언이 없음: ${adv.join(" / ")}`);
  // 다음 구매 줄에 조언 이유 표가 붙은 자리가 없어야 한다 (점수로 올라온 '적 대응'은 그대로 둔다)
  const rows = p.qa("#next-buy .next-row").map((e) => e.dataset.label || "");
  assert.ok(rows.length, "다음 구매가 비었다");
  const ADV = ["치유 감소", "관통", "방어력", "마법 저항", "보호막 감소", "공속 대응", "군중 제어 대응"];
  for (const r of rows) for (const w of ADV) assert.ok(!r.includes(`(${w})`), `${r} 에 조언 표가 붙었다`);
  p.w.close();
});

test("R2b 계산에 안 들어가는 대응은 조언 줄에 그렇게 적고, 다음 구매·바꾸기에는 안 민다 (C5)", async () => {
  const { p, live, advice } = await setup();
  // 보호막 아이템을 3개 이상 산 적 → '보호막 감소' 조언 (칼바람 보호막 감소 수치가 0% 라 점수에는 못 들어간다)
  const shield = p.data.items.filter((i) => i.kind === "legendary" && (i.effects || []).some((x) => x && x.kind === "shield")).map((i) => i.id);
  const foes = ["Darius", "Fiora", "Lux", "Ahri", "Malphite"];
  live("Garen", { enemyBuilds: foes.map((c) => ({ champion: c, level: 18, items: shield.slice(0, 3), augments: [] })) });
  const adv = advice();
  assert.ok(adv.some((l) => /계산에는 안 들어감/.test(l)), `계산 밖 표시가 없음: ${adv.join(" / ")}`);
  // 계산 밖 대응은 '6칸 바꾸기' 이유로도 나오지 않는다 (6칸을 채우고 확인)
  const six = p.data.items.filter((i) => i.kind === "legendary").slice(0, 5).map((i) => i.id)
    .concat(p.data.items.filter((i) => i.kind === "boots")[0].id);
  live("Garen", { items: six, level: 18, enemyBuilds: foes.map((c) => ({ champion: c, level: 18, items: shield.slice(0, 3), augments: [] })) });
  p.w.renderItemList();
  const sw = p.w.swapAdvice();
  if (sw && sw.why) assert.ok(["치유 감소", "관통", "방어력", "마법 저항"].includes(sw.why), `계산 밖 대응으로 바꾸라고 한다: ${sw.why}`);
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
