// 화면 흐름 테스트: 챔피언 → 증강 → 아이템 → 초기화, 선택지 비교, 쉽게 보기, 상대 고르기
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage } = require("./page");

test("처음 화면: 챔피언 목록과 데이터 요약", async () => {
  const p = await loadPage();
  assert.equal(p.qa(".champ").length, p.data.champions.length);
  assert.match(p.text("#meta"), /증강 \d+개/);
  assert.deepEqual(p.errors, []);
});

test("챔피언 → 첫 증강 → 빌드", async () => {
  const p = await loadPage();
  p.pickChamp("Jinx");
  assert.match(p.text("#champ-card"), /징크스/);
  assert.equal(p.qa(".aug").length, p.data.augments.length, "자세히 보기는 증강 전체");
  assert.equal(p.qa("#concept-tabs button").length, 3, "빌드 3종");
  assert.equal(p.qa("#build .item").length, 6, "완성 빌드 6칸");
  p.click(p.augRow("ARAM_DrawYourSword"));
  assert.equal(p.qa("#chosen .slot[data-i]").length, 1);
  assert.match(p.text("#aug-title"), /다음 증강/);
  assert.equal(p.qa("#build .item").length, 6);
  assert.deepEqual(p.errors, []);
});

test("아이템: 고정·신발 1개·6칸·같은 계열", async () => {
  const p = await loadPage();
  p.pickChamp("Jinx");
  p.click(p.itemRow("무한의 대검"));
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 1);
  assert.ok(p.qa("#build .item.fixed").length >= 1, "고른 아이템은 빌드에 고정");
  const boots = p.qa("#item-list .item").filter((e) => e.textContent.includes("신발"));
  p.click(boots[0]);
  p.click(p.qa("#item-list .item").filter((e) => e.textContent.includes("신발"))[1]);
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 2, "신발은 1개까지");
  assert.ok(p.alerts.some((m) => m.includes("신발")), "신발 2개째는 안내");
  for (let i = 0; i < 8; i++) {
    const it = p.qa("#item-list .item").find((e) => !e.textContent.includes("신발"));
    if (it) p.click(it);
  }
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 6, "최대 6칸");
  p.click(p.q("#reset-items"));
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 0);
});

test("같은 계열 고유 효과는 하나만 (주문 검)", async () => {
  const p = await loadPage();
  p.pickChamp("Ezreal");
  p.click(p.itemRow("삼위일체"));
  p.click(p.itemRow("리치베인"));
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 1);
  assert.ok(p.alerts.some((m) => m.includes("주문 검")));
});

test("조건 없는 챔피언은 ⛔ 효과 없음 (위키 적용 스킬 목록)", async () => {
  const p = await loadPage();
  p.pickChamp("Lux");
  const row = p.augRow("ARAM_SpinToWin");
  assert.ok(row, "승리를 위한 회전 행");
  assert.match(row.textContent, /효과 없음|⛔/);
});

test("이번 선택지: 3개 비교·추천 1개·새로고침 권장", async () => {
  const p = await loadPage();
  p.pickChamp("Seraphine");
  const names = ["치명적 치유", "도주 계획", "거인"];
  p.qa("#offers input[list]").forEach((inp, i) => {
    inp.value = names[i];
    for (const t of ["input", "change"]) inp.dispatchEvent(new p.w.Event(t, { bubbles: true }));
  });
  const rows = p.qa(".offer-table tr").slice(1);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.classList.contains("best")).length, 1, "추천은 하나");
  assert.equal(p.qa(".offer-table .how").length, 3, "선택지마다 쓰는 법");
  // 몰빵 빌드는 평가를 먼저 보여 준 다음 채운다 (게임 화면 카드가 늦지 않게)
  assert.match(p.text("#offer-result"), /계산 중/);
  await new Promise((r) => setTimeout(r, 0));
  assert.doesNotMatch(p.text("#offer-result"), /계산 중/);
  assert.equal(p.qa(".offer-table .mini-build").filter((td) => td.querySelector("img")).length, 3, "몰빵 빌드 아이콘");
  assert.ok(p.qa(".offer-table .chip.fun").length <= 1, "재미 픽은 많아야 하나");
  assert.ok(!rows.find((r) => r.classList.contains("best")).querySelector(".chip.fun"), "재미 픽은 추천과 다른 것");
  // 강한 선택과 재미있는 선택을 문구로 구분 (안정화 기획서 8.5)
  assert.match(rows.find((r) => r.classList.contains("best")).textContent, /💪 강한 선택/);
  assert.match(p.text("#offer-result"), /💪 강한 선택 = 계산상 전투 성능이 가장 좋아요/);
  assert.deepEqual(p.errors, []);
});

test("연계 상태 칩: 고른 증강이 있으면 선택지·목록에 등급과 따로 보인다", async () => {
  const p = await loadPage();
  p.pickChamp("Lux");
  assert.equal(p.qa("#aug-list .link").length, 0, "첫 증강 전엔 연계 표시 없음");
  p.click(p.augRow("ARAM_BacktoBasics"));
  assert.ok(p.qa("#aug-list .link").length > 0);
  assert.ok(p.qa("#aug-list .link.l-conflict").length > 0, "궁극기 증강은 효과 충돌");
  const conflict = p.qa("#aug-list .aug").find((e) => e.querySelector(".link.l-conflict"));
  assert.match(conflict.textContent, /궁극기/, "충돌 이유 문장");
  assert.deepEqual(p.errors, []);
});

test("쓰는 법·재미 픽·변칙 설명", async () => {
  const p = await loadPage();
  p.pickChamp("Jinx");
  // 변칙 탭: 증강이 없으면 실험 빌드라고 알린다
  p.click(p.qa("#concept-tabs button").find((b) => b.dataset.k === "twist"));
  assert.match(p.text("#concept-desc"), /실험 빌드/);
  // 고른 증강 밑에 쓰는 법
  p.click(p.augRow("ARAM_BigBrain"));
  assert.match(p.text("#chosen"), /🎮 전술적 대비/);
  p.click(p.qa("#concept-tabs button").find((b) => b.dataset.k === "twist"));
  assert.match(p.text("#concept-desc"), /전술적 대비.*받쳐 주는 변칙/);
  // 선택지: 변칙 열쇠·재미 픽 (빌드가 크게 바뀌는 증강)
  p.click(p.qa("#chosen .slot[data-i]")[0]);
  const names = ["전술적 대비", "도주 계획", "거인"];
  p.qa("#offers input[list]").forEach((inp, i) => {
    inp.value = names[i];
    for (const t of ["input", "change"]) inp.dispatchEvent(new p.w.Event(t, { bubbles: true }));
  });
  assert.match(p.text("#offer-result"), /변칙 열쇠/);
  // 재미 픽은 플레이 방향이 실제로 바뀌는 것(변신·변칙 열쇠)만
  for (const row of p.qa(".offer-table tr").slice(1)) {
    if (row.querySelector(".chip.fun")) assert.match(row.textContent, /변신|변칙 열쇠/);
  }
  assert.match(p.text("#offer-result"), /같이 살 것|🎮/);
  assert.deepEqual(p.errors, []);
});

test("레벨만 바뀐 게임 연동은 순위를 다시 계산하지 않는다", async () => {
  const p = await loadPage();
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 10, items: ["3031"] });
  const before = p.q("#aug-list").innerHTML;
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 11, items: ["3031"] });
  assert.equal(p.q("#level-val").textContent, "11");
  assert.equal(p.q("#aug-list").innerHTML, before, "증강 목록은 그대로");
  assert.equal(p.qa("#chosen-items .islot[data-id]").length, 1, "산 아이템 반영");
});

test("쉽게 보기: 15개 + 더 보기, 근거 펼쳐도 선택 안 됨, 자세히 보기 전환", async () => {
  const p = await loadPage({ simple: true });
  assert.ok(p.doc.body.classList.contains("simple"));
  p.pickChamp("Jinx");
  assert.equal(p.qa(".aug").length, 15);
  assert.ok(p.q(".more-augs"));
  const basis = p.q(".aug .basis summary");
  assert.ok(basis, "근거 보기 있음");
  p.click(basis);
  assert.equal(p.qa("#chosen .slot[data-i]").length, 0, "근거를 눌러도 증강 선택 안 됨");
  p.click(p.q(".more-augs"));
  assert.equal(p.qa(".aug").length, p.data.augments.length);
  p.click(p.q("#simple-toggle"));
  assert.ok(!p.doc.body.classList.contains("simple"));
  assert.ok(p.qa("#metrics .tile").length === 6, "자세히 보기로 바꾸면 능력치 표가 그려짐");
});

test("이유 문장은 실제 숫자 (A → B)", async () => {
  const p = await loadPage({ simple: true });
  p.pickChamp("Seraphine");
  const reasons = p.qa(".aug .why").map((e) => e.textContent);
  assert.ok(reasons.some((r) => /\(\d[\d,.]* → \d[\d,.]*/.test(r)), reasons.slice(0, 3).join(" / "));
  assert.ok(!reasons.some((r) => /\d{3,}% 늘어요/.test(r)), "큰 퍼센트 문장 없음");
});

test("상대 고르기: 탱커를 고르면 피해가 줄고, 기준으로 돌아오면 원래대로", async () => {
  const p = await loadPage();
  p.pickChamp("Lux");
  const combo = () => p.text("#metrics .tile .big");
  const base = combo();
  const sel = p.q("#target-champ");
  // 마법 저항력이 기준(63)보다 높은 탱커 (말파이트는 공식 추천 아이템이 방어력 위주라 마법 저항력이 기준과 같아졌다)
  sel.value = "Galio"; sel.dispatchEvent(new p.w.Event("change"));
  assert.match(p.text("#target-info"), /갈리오/);
  assert.ok(Number(combo().replace(/,/g, "")) < Number(base.replace(/,/g, "")));
  sel.value = ""; sel.dispatchEvent(new p.w.Event("change"));
  assert.equal(combo(), base);
});

test("받은 데이터의 이상한 id 는 화면에서 뺀다", async () => {
  const p = await loadPage();
  const d = { champions: [{ id: "Jinx", key: "222" }, { id: "<img src=x>", key: "1" }], augments: [{ id: "A_1" }, { id: "../x" }], items: [{ id: "3031" }, { id: "1;x" }] };
  const out = p.w.sanitizeData(d);
  assert.deepEqual(out.champions.map((c) => c.id), ["Jinx"]);
  assert.deepEqual(out.augments.map((a) => a.id), ["A_1"]);
  assert.deepEqual(out.items.map((i) => i.id), ["3031"]);
});

test("쉽게 보기에서도 '다음에 살 아이템'과 추천 빌드가 나온다", async () => {
  const p = await loadPage({ simple: true });
  p.pickChamp("Jinx");
  assert.ok(p.qa("#next-buy .next-row").length >= 1, "다음에 살 아이템");
  assert.equal(p.qa("#build .item").length, 6, "추천 빌드");
  p.click(p.qa(".aug")[0]);
  assert.ok(p.qa("#next-buy .next-row").length >= 1, "증강을 고른 뒤에도");
});

test("지금 골드로 살 것: 남은 금액·살 부품·완성 가능", async () => {
  const p = await loadPage({ simple: true });
  const IE = p.data.items.find((i) => i.name === "무한의 대검");
  const b1 = p.w.buyNow(IE, 1300, []);
  assert.equal(b1.left, IE.gold);
  assert.equal(b1.part.name, "B.F. 대검", "1300골드로 살 수 있는 가장 비싼 부품");
  const owned = ["1038", "1037"];  // B.F. 대검 + 곡괭이
  const b2 = p.w.buyNow(IE, 1400, owned);
  assert.equal(b2.left, IE.gold - 1300 - 875);
  assert.ok(b2.done, "남은 금액보다 골드가 많으면 완성 가능");
  const b3 = p.w.buyNow(IE, 100, []);
  assert.equal(b3.part, null, "가장 싼 부품보다 골드가 적으면 없음");
  // 같은 부품이 두 번 들어가는 레시피: 하나 가졌으면 두 번째를 권한다 (예전엔 '살 부품 없음', 2026-10-23 점검)
  const WM = p.data.items.find((i) => i.id === "3083");  // 워모그의 갑옷 = 거인의 허리띠(900) ×2 + 수정 팔 보호구(800)
  const b4 = p.w.buyNow(WM, 1000, ["1011"]);
  assert.equal(b4.part && b4.part.id, "1011", "두 번째 거인의 허리띠 (예전엔 빠져서 수정 팔 보호구를 권했다)");
  // 게임 연동: 골드만 바뀌면 순위는 그대로, '지금 살 것' 줄만 갱신
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["1001"], gold: 500 });
  assert.match(p.text("#buy-now"), /지금 골드 500/);
  const list = p.q("#aug-list").innerHTML;
  // 골드만 1초마다 오르면 상점이 닫혀 있을 땐 10초에 한 번만 다시 그린다 (게임 중 CPU)
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["1001"], gold: 900 });
  assert.match(p.text("#buy-now"), /지금 골드 500/, "상점이 닫혀 있으면 바로 안 그림");
  // 상점을 열면 바로 (게임 화면 상자에 보인다)
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["1001"], gold: 1800, aug: { shop: { x: 0 } } });
  assert.match(p.text("#buy-now"), /지금 골드 1,800/);
  assert.equal(p.q("#aug-list").innerHTML, list);
  // 부품이 바뀌면 상점이 닫혀 있어도 바로
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["1001", "1036"], gold: 1450 });
  assert.match(p.text("#buy-now"), /지금 골드 1,450/);
  p.w.applyLive({ enabled: true, inGame: false });
  assert.equal(p.text("#buy-now"), "", "게임이 끝나면 지움");
});

test("상대 능력치는 앞에 고른 상대와 무관", async () => {
  const p = await loadPage();
  p.pickChamp("Lux");
  const sel = p.q("#target-champ");
  const pick = (id) => { sel.value = id; sel.dispatchEvent(new p.w.Event("change")); return p.text("#target-info"); };
  const a = pick("Garen");
  pick("Malphite");
  const b = pick("Garen");
  assert.equal(a, b);
});

test("같은 챔피언으로 다음 게임: 고른 증강을 비운다", async () => {
  const p = await loadPage();
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 5, items: [] });
  p.click(p.qa(".aug")[0]);
  assert.equal(p.qa("#chosen .slot[data-i]").length, 1);
  p.w.applyLive({ enabled: true, inGame: false });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 1, items: [] });
  assert.equal(p.qa("#chosen .slot[data-i]").length, 0);
});

test("쉽게 보기 '전체 보기'는 챔피언을 바꾸면 다시 15개", async () => {
  const p = await loadPage({ simple: true });
  p.pickChamp("Jinx");
  p.click(p.q(".more-augs"));
  p.pickChamp("Lux");
  assert.equal(p.qa(".aug").length, 15);
});

test("증강 인식: 읽은 선택지를 채우고 게임 화면 카드에 보내며, 닫히면 고른 증강을 넣는다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Poppy", level: 6, items: ["3084"] });
  const offers = ["눈 폭발", "강타자", "정신 변환"];
  p.w.applyAug({ offers, seq: 1, picked: null, pickSeq: 0 });
  assert.deepEqual(p.qa("#offers input[type=search]").map((e) => e.value), offers);
  const cards = sent.at(-1).cards;
  assert.equal(cards.filter(Boolean).length, 3, "카드 3장 모두 게임 화면 표시");
  assert.ok(cards.every((c) => c.label), "평가 글자가 있다");
  // 같은 seq 는 다시 그리지 않는다 (직접 지운 걸 덮어쓰지 않게)
  p.click(p.q("#reset-offers"));
  p.w.applyAug({ offers, seq: 1, picked: null, pickSeq: 0 });
  assert.equal(p.qa("#offers input[type=search]")[0].value, "");
  // 선택 화면이 닫힘 → 고른 증강
  p.w.applyAug({ offers: null, seq: 1, picked: "강타자", pickedFrom: offers, pickSeq: 1 });
  assert.match(p.text("#chosen"), /강타자/);
  assert.deepEqual(p.qa("#offers input[type=search]").map((e) => e.value), ["", "", ""]);
  // 못 정했으면 선택지를 남기고 직접 누르게 한다
  p.w.applyAug({ offers: null, seq: 2, picked: null, pickedFrom: ["눈 폭발", "탱크 엔진", "정신 변환"], pickSeq: 2 });
  assert.match(p.text("#offer-result"), /이걸로 선택/);
  // 증강 칸 그림으로 확인: 못 정한 것은 채우고 (가벼운 모드도)
  p.w.applyAug({ offers: null, seq: 2, picked: "정신 변환", pickedFrom: ["눈 폭발", "탱크 엔진", "정신 변환"], by: "hud", replaces: null, pickSeq: 3 });
  assert.match(p.text("#chosen"), /정신 변환/);
  // 클릭 짐작이 틀렸으면 빼고 바꾼다
  p.w.applyAug({ offers: null, seq: 1, picked: "눈 폭발", pickedFrom: offers, by: "hud", replaces: "강타자", pickSeq: 4 });
  assert.match(p.text("#chosen"), /눈 폭발/);
  assert.doesNotMatch(p.text("#chosen"), /강타자/);
  assert.deepEqual(p.errors, []);
});

test("챔피언 선택 중: 롤에서 고른 챔피언을 따라가고, 대기석에서 바꾸면 화면·상점 추천도 바뀐다", async () => {
  const p = await loadPage({ simple: true });
  const writes = [];
  const api = { write_item_set: async (key, title) => { writes.push(title); return { ok: true, blocks: 3 }; } };
  p.q("#itemset-toggle").checked = true;
  await p.w.applyLcu(api, { connected: true, phase: "ChampSelect", championKey: 39 });
  assert.match(p.text("#champ-card"), /이렐리아/);
  await p.w.applyLcu(api, { connected: true, phase: "ChampSelect", championKey: 799 });  // 대기석에서 암베사로
  assert.match(p.text("#champ-card"), /암베사/);
  assert.match(writes.at(-1), /암베사/);
  assert.match(p.text("#itemset-status"), /상점 추천: 암베사 기본 빌드 등록됨/);
  p.pickChamp("Jinx");  // 그 사이 다른 챔피언을 눌러 보면
  await p.w.applyLcu(api, { connected: true, phase: "ChampSelect", championKey: 799 });
  assert.match(p.text("#champ-card"), /징크스/, "롤 챔피언이 그대로면 덮어쓰지 않는다");
  assert.deepEqual(p.errors, []);
});

test("게임에서 산 부품도 고른 아이템 밑에 보인다", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Nami", level: 3, items: ["2052", "1001", "1042"], gold: 500 });
  assert.match(p.text("#chosen-items"), /게임에서 산 부품: 장화 · 단검/);
  p.w.applyLive({ enabled: true, inGame: true, champion: "Nami", level: 3, items: ["2052", "1001", "1042", "1052"], gold: 100 });
  assert.match(p.text("#chosen-items"), /증폭의 고서/, "골드·부품만 바뀌어도 갱신");
});

test("게임 화면 상자(상점 옆): 산 아이템 평가, 증강 TOP 은 넣지 않음", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Irelia", level: 6, items: ["3153"] });  // 몰락한 왕의 검
  p.w.sendOverlay();
  const hud = sent.at(-1).hud.join("\n");
  assert.doesNotMatch(hud, /첫 증강 추천/, "상점 옆 상자엔 증강 TOP 을 넣지 않는다 (게임을 덜 가리게)");
  assert.match(hud, /산 아이템: 몰락한 왕의 검 (✅|👍)/);
  p.w.applyLive({ enabled: true, inGame: true, champion: "Irelia", level: 7, items: ["3153", "3089"] });  // 라바돈
  p.w.sendOverlay();
  assert.match(sent.at(-1).hud.join("\n"), /라바돈의 죽음모자 ⚠️/, "물리 챔피언의 AP 아이템은 경고");
  assert.match(p.text("#chosen-items"), /라바돈의 죽음모자 물리 챔피언에겐 반대 유형이에요/);
  assert.deepEqual(p.errors, []);
});

test("고른 증강을 못 정해도 게임 화면 카드 표시는 지운다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "DrMundo", level: 3, items: [] });
  const offers = ["도주 계획", "강타자", "지옥불 난사 발동"];
  p.w.applyAug({ offers, seq: 1, pickSeq: 0 });
  assert.equal(sent.at(-1).cards.filter(Boolean).length, 3);
  p.w.applyAug({ offers: null, seq: 1, picked: null, pickedFrom: offers, pickSeq: 1 });
  assert.equal(sent.at(-1).cards.filter(Boolean).length, 0, "선택 화면이 닫혔으니 게임 화면 카드는 지움");
  assert.match(p.text("#offer-result"), /이걸로 선택/, "애드온엔 직접 고를 수 있게 남김");
  p.w.applyLive({ enabled: true, inGame: true, champion: "DrMundo", level: 4, items: [] });  // 다시 그려도
  assert.equal(sent.at(-1).cards.filter(Boolean).length, 0);
});

test("적 구성: 받는 피해 비율·회복·탱커 조언이 뜨고 계산에 반영된다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const base = { enabled: true, inGame: true, champion: "Darius", level: 9, items: [] };
  p.w.applyLive({ ...base, enemies: [] });
  assert.equal(p.w.enemyInfo(), null, "적을 모르면 반반(기본값)");
  const before = p.text("#next-buy");
  // 마법 위주 + 회복 많은 + 탱커 많은 적
  p.w.applyLive({ ...base, enemies: ["Lux", "Vladimir", "Soraka", "Malphite", "Sejuani"] });
  assert.ok(p.w.enemyInfo().magic >= 0.6);
  const adv = p.text("#next-buy");
  assert.match(adv, /적 구성 추정: 마법 \d+%/);
  assert.match(adv, /적 탱커 많음/);
  assert.notEqual(adv, before);
  p.w.sendOverlay();
  assert.match(sent.at(-1).hud.join("\n"), /적 마법 \d+%/, "게임 화면 상자는 짧게 (피드백 #20)");
  assert.deepEqual(p.errors, []);
});

test("증강 칸 아이콘으로 읽은 고른 증강을 더한다 (클릭으로 잡은 것과 합침)", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Naafiri", level: 9, items: [] });
  p.w.applyAug({ offers: null, seq: 1, picked: "골드 강탈", pickedFrom: ["골드 강탈", "신성한 눈덩이", "거인"], pickSeq: 1 });
  assert.match(p.text("#chosen"), /골드 강탈/);
  const giant = p.data.augments.find((a) => a.name === "거인");
  p.w.applyAug({ offers: null, seq: 1, picked: "골드 강탈", pickSeq: 1, hudPicked: [giant.id] });
  assert.match(p.text("#chosen"), /거인/, "증강 칸에서 찾은 것을 더한다");
  assert.match(p.text("#chosen"), /골드 강탈/, "클릭으로 잡은 것은 지우지 않는다");
});

test("고른 증강이 4개인데 선택 화면이 또 뜨면 증강 칸에서 확인 못 한 것을 빼고 카드를 띄운다", async () => {
  // 2026-10-15 케일 판: 틀린 클릭 짐작(극악무도)이 남아 4개로 차서 마지막 선택 화면 카드가 안 떴다
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Kayle", level: 15, items: [] });
  const id = (n) => p.data.augments.find((a) => a.name === n).id;
  p.w.applyAug({ offers: null, seq: 1, picked: "극악무도", pickSeq: 1 });
  const real = ["광휘의 검 업그레이드", "시작부터 끝까지", "미친 과학자"];
  p.w.applyAug({ offers: null, seq: 1, pickSeq: 1, hudPicked: real.map(id) });
  assert.match(p.text("#chosen"), /극악무도/);
  p.w.applyAug({ offers: ["속전속결", "민병대", "조준경 부착"], seq: 2, pickSeq: 1, hudPicked: real.map(id) });
  assert.doesNotMatch(p.text("#chosen"), /극악무도/, "확인 못 한 짐작만 뺀다");
  for (const n of real) assert.match(p.text("#chosen"), new RegExp(n));
  assert.equal(sent.at(-1).cards.filter(Boolean).length, 3, "게임 화면에 카드 3장");
  assert.deepEqual(p.errors, []);
});

test("아이템이 있어야 하는 증강(강철 같은 심장)을 고르면 그 아이템이 '다음 구매' 맨 앞", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: [] });
  p.w.applyAug({ offers: null, seq: 1, picked: "강철 같은 심장", pickSeq: 1 });
  assert.match(sent.at(-1).hud.find((x) => x.startsWith("다음 구매")), /^다음 구매: 강철심장/);
  assert.match(p.text("#next-buy"), /증강에 필요/);
  // 이미 샀으면 다시 권하지 않는다
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["3084"] });
  assert.doesNotMatch(p.text("#next-buy"), /증강에 필요/);
  assert.deepEqual(p.errors, []);
});

test("적 대응: 적이 산 아이템 때문에 순위가 크게 오른 아이템·증강을 표시한다 (케일 판 실제 적 아이템)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const enemyBuilds = [{ champion: "Velkoz", level: 16, items: ["6655", "3135", "3020", "4645", "4646"] },
    { champion: "Rammus", level: 15, items: ["3075", "3047", "3084", "3068"] },
    { champion: "Rell", level: 16, items: ["3121", "3143", "3050", "3047"] },
    { champion: "TahmKench", level: 16, items: ["3084", "3111", "3083", "3075", "3067"] },
    { champion: "Kalista", level: 16, items: ["3006", "3153", "3302", "6672"] }];
  const live = (x) => p.w.applyLive({ enabled: true, inGame: true, champion: "Kayle", level: 11, items: ["3100", "3115", "3006"],
    enemies: enemyBuilds.map((e) => e.champion), ...x });
  live({ enemyBuilds: enemyBuilds.map((e) => ({ ...e, items: [] })) });
  assert.doesNotMatch(p.text("#next-buy"), /적 대응/, "적이 아무것도 안 샀으면 표시 안 함");
  live({ enemyBuilds });
  // 상대 능력치만 바뀌면 나눠 계산한 뒤 다시 그린다 (warmThenRender) → 조각 계산이 끝날 때까지
  await new Promise((r) => setTimeout(r, 1500));
  assert.match(p.text("#next-buy"), /🛡️ 적 대응/);
  const box = sent.at(-1).hud.join("\n");
  assert.match(box, /적 (가시 갑옷|강철심장) 2·(가시 갑옷|강철심장) 2 \(체력·방어력 높음\) → 적 대응: 리안드리의 고통/, "상자에 무엇 때문에 무엇을 사라는지");
  assert.match(box, /다음 구매: .*\(적 대응\)/);
  // 증강 선택: 고정 피해 증강(마법 미사일)은 단단한 적에게 더 좋다
  p.w.applyAug({ offers: ["마법 미사일", "강타자", "마법 명사수"], seq: 1, pickSeq: 0 });
  const cards = sent.at(-1).cards;
  assert.match(cards[0].reason, /적 대응/);
  assert.doesNotMatch(cards[2].reason, /적 대응/);
  assert.deepEqual(p.errors, []);
});

test("게임 화면 상자: 상점·죽음에만 띄우라고 보낸다 (시작 직후는 안 띄움: 안정화 기획서 UX-03)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const live = (x) => p.w.applyLive({ enabled: true, inGame: true, champion: "Kayle", level: 9, items: [], gold: 100, ...x });
  live({ gameTime: 30 });
  assert.equal(sent.at(-1).box, null, "시작 1분 넘게 상자가 떠 있어 방해 (2026-10-19 외부 테스터)");
  live({ gameTime: 300, gold: 120 });
  assert.equal(sent.at(-1).box, null);
  live({ gameTime: 310, dead: true, gold: 130 });
  assert.equal(sent.at(-1).box, "dead");
  live({ gameTime: 320, dead: false, gold: 140, aug: { shop: { left: 0.2 } } });
  assert.equal(sent.at(-1).box, "shop");
  assert.deepEqual(p.errors, []);
});

test("증강 칸 결과와 고른 증강이 한 번에 오면 화면은 한 번만 다시 그린다", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Naafiri", level: 9, items: [] });
  const giant = p.data.augments.find((a) => a.name === "거인");
  const orig = p.w.renderAll;
  let n = 0;
  p.w.renderAll = () => { n++; orig(); };
  p.w.applyAug({ offers: null, seq: 1, picked: "골드 강탈", pickSeq: 1, hudPicked: [giant.id] });
  p.w.renderAll = orig;
  assert.equal(n, 1);
  assert.match(p.text("#chosen"), /거인/);
  assert.match(p.text("#chosen"), /골드 강탈/);
  // 고른 것을 못 정했을 때 안내 문구는 다시 그린 뒤에도 남는다
  p.w.applyAug({ offers: null, seq: 1, picked: null, pickedFrom: ["신성한 눈덩이", "부식", "흡수"], pickSeq: 2 });
  assert.match(p.text("#offer-result"), /확인하지 못했어요/);
  assert.deepEqual(p.errors, []);
});

test("증강 쿨타임: 자동 주기는 고른 시각부터, 체력 발동은 체력이 기준 아래로 떨어질 때부터 (모두 예상)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const live = (hp, extra = {}) => p.w.applyLive({ enabled: true, inGame: true, champion: "Lulu", level: 9, items: [],
    stats: { currentHealth: hp, maxHealth: 1000 }, ...extra });
  live(1000);
  p.w.applyAug({ offers: null, seq: 1, picked: "퀸카", pickSeq: 1 });
  p.w.applyAug({ offers: null, seq: 1, picked: "도주 계획", pickSeq: 2 });
  p.w.applyAug({ offers: null, seq: 1, picked: "빛의 인도자 결의", pickSeq: 3 });
  p.w.applyAug({ offers: null, seq: 1, picked: "강타자", pickSeq: 4 });
  live(900);
  let t = sent.at(-1).timers;
  assert.equal(JSON.stringify(t.map((x) => x.name).sort()), JSON.stringify(["도주 계획", "빛의 인도자 결의", "퀸카"]), "쿨타임 있는 증강만");
  assert.equal(t.find((x) => x.name === "퀸카").period, 35);
  assert.equal(t.find((x) => x.name === "도주 계획").readyAt, 0, "아직 발동 안 함 = 준비");
  live(300);  // 30%: 도주 계획(35%)·빛의 인도자(50%) 발동
  t = sent.at(-1).timers;
  const now = Date.now() / 1000;
  assert.ok(Math.abs(t.find((x) => x.name === "도주 계획").readyAt - (now + 75)) < 2);
  assert.ok(Math.abs(t.find((x) => x.name === "빛의 인도자 결의").readyAt - (now + 45)) < 2);
  live(0, { dead: true });  // 사망: 빛의 인도자만 초기화
  t = sent.at(-1).timers;
  assert.equal(t.find((x) => x.name === "빛의 인도자 결의").readyAt, 0);
  assert.ok(t.find((x) => x.name === "도주 계획").readyAt > now);
  const n = sent.length;
  live(0, { dead: true });
  assert.equal(sent.length, n, "바뀐 게 없으면 다시 보내지 않는다");
  assert.deepEqual(p.errors, []);
});

test("상대 아이템 반영: 적이 산 아이템으로 상대 능력치·관통·치유 감소, 기록, 게임 끝나면 원래대로", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const id = (n) => p.data.items.find((i) => i.name === n).id;
  const foes = ["Malphite", "Leona", "Soraka", "Vayne", "Lux"];
  const live = (builds, lv = 12) => p.w.applyLive({ enabled: true, inGame: true, champion: "Lux", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c, k) => ({ champion: c, level: lv, items: builds[k] || [] })) });
  const T = () => ({ ...p.w.Stats.TARGET });
  live([]);
  const t0 = T();
  assert.match(p.text("#target-info"), /아이템·증강 비교: 이번 판 적 5명 18레벨 예상/);
  assert.match(p.text("#target-info"), /지금 적 \(평균 12레벨, 산 아이템만\)/);
  assert.ok(Math.abs(t0.MR - p.w.Stats.DEFAULT_TARGET.MR) < 15, "아직 안 산 칸은 평균 빌드: 기준 상대와 비슷");
  live([[id("가시 갑옷"), id("태양불꽃 방패")], [id("대자연의 힘"), id("정령의 형상"), id("케이닉 루컨")], [], [id("몰락한 왕의 검")], [id("케이닉 루컨")]]);
  const t1 = T();
  assert.ok(t1.MR > t0.MR + 30 && t1.ARMOR > t0.ARMOR, `방어 아이템을 사면 상대가 단단해진다 ${JSON.stringify([t0, t1])}`);
  p.w.sendOverlay();
  const e = sent.at(-1).enemy;
  assert.ok(e && e.auto && e.target.MR === t1.MR, "기록용으로 상대 능력치를 보낸다");
  assert.ok(e.builds.find((b) => b.champ === "Leona").items.includes("케이닉 루컨"));
  // 지금 상대(실제 레벨·산 아이템)는 18레벨 예상보다 약하다 (아직 안 산 칸·레벨 차이)
  assert.ok(e.now && e.now.level === 12 && e.now.MR < e.target.MR && e.now.HP < e.target.HP, JSON.stringify(e.now));
  assert.equal(e.resistItems.MR, 4, "실제로 산 마법 저항 아이템 수");
  const advice = e.advice.join("\n");
  assert.match(advice, /적이 마법 저항 아이템 4개 \(지금 평균 마법 저항력 \d+\) → 관통/);
  assert.match(advice, /회복 많음 \([^)]*베인/, "흡혈 아이템을 산 적은 회복 많음");
  // 레벨만 오르면 예상 상대는 그대로, 지금 상대만 바뀐다
  const tBefore = T();
  live([[id("가시 갑옷"), id("태양불꽃 방패")], [id("대자연의 힘"), id("정령의 형상"), id("케이닉 루컨")], [], [id("몰락한 왕의 검")], [id("케이닉 루컨")]], 16);
  assert.deepEqual(T(), tBefore);
  assert.match(p.text("#target-info"), /지금 적 \(평균 16레벨/);
  // 방어 아이템이 2개뿐이면 관통 조언은 탱커 기준만 (예상 빌드로 채운 값으로는 조언하지 않는다)
  live([[], [id("대자연의 힘")], [], [], [id("케이닉 루컨")]]);
  p.w.sendOverlay();
  assert.doesNotMatch(sent.at(-1).enemy.advice.join("\n"), /마법 저항 아이템/);
  // 상대를 직접 고르면 그대로 둔다
  const sel = p.q("#target-champ");
  sel.value = "Garen"; sel.dispatchEvent(new p.w.Event("change", { bubbles: true }));
  const tg = T();
  live([[id("가시 갑옷")], [], [], [], []]);
  assert.deepEqual(T(), tg, "직접 고른 상대는 적 아이템으로 바꾸지 않는다");
  sel.value = ""; sel.dispatchEvent(new p.w.Event("change", { bubbles: true }));
  // 게임이 끝나면 기준 상대로
  p.w.applyLive({ enabled: true, inGame: false });
  assert.deepEqual(T(), { ...p.w.Stats.DEFAULT_TARGET, CUR: T().CUR, DPS_TAKEN: T().DPS_TAKEN });
  assert.match(p.text("#target-info"), /기준 상대/);
  assert.deepEqual(p.errors, []);
});

test("윈도우 프로그램: 챔피언 검색·목록을 숨기고, 게임에서 고른 챔피언은 가운데 칸에", async () => {
  const p = await loadPage({ simple: true });
  p.w.document.body.classList.add("winapp");
  // 롤 클라이언트 연결이 안 되면(자동 감지 실패) 직접 고르게 목록을 보인다
  p.w.renderChamps();
  assert.ok(p.qa("#champ-grid .champ").length > 100, "연결 전엔 직접 고를 수 있다");
  await p.w.applyLcu({ write_item_set: async () => ({ ok: true }) }, { connected: true, phase: "Lobby" });
  assert.equal(p.qa("#champ-grid .champ").length, 0, "연결되면 목록을 만들지 않는다");
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 6, items: [] });
  assert.match(p.text("#champ-card"), /징크스/);
  await p.w.applyLcu({}, { connected: false });
  assert.equal(p.qa("#champ-grid .champ").length, 0, "게임 중이면 연결이 끊겨도 게임이 알려 준다");
  p.w.applyLive({ enabled: true, inGame: false });
  assert.ok(p.qa("#champ-grid .champ").length > 100, "연결도 게임도 없으면 다시 직접");
  assert.deepEqual(p.errors, []);
});

test("아이템 칸이 다 찼으면 바꾸기(판다 → 산다)를 아이콘으로 보낸다 (베인 판 실제 아이템)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const full = (items) => p.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 18, items, dead: true });
  full(["6672", "3006", "3032", "3036", "3153"]);
  assert.equal(sent.at(-1).swap, null, "칸이 남으면 바꾸기 없음");
  // 마법 챔피언 아이템(라바돈의 죽음모자)을 하나 낀 6칸 → 그걸 팔라고
  full(["6672", "3006", "3032", "3036", "3153", "3089"]);
  const sw = sent.at(-1).swap;
  assert.ok(sw, "바꾸기 보냄");
  assert.equal(sw.sell, "3089");
  assert.notEqual(sw.buy, "3089");
  assert.match(p.text("#next-buy"), /바꾸면 더 좋아요/);
  // 판매가(게임 데이터 gold.sell)를 뺀 실제 골드와, 지금 골드로 되는지
  const rab = p.data.items.find((i) => i.id === "3089");
  const buy = p.data.items.find((i) => i.id === sw.buy);
  assert.ok(Number(rab.sell) > 0, "아이템 데이터에 판매가가 있다");
  assert.equal(sw.cost, Math.max(0, Number(buy.gold) - Number(rab.sell)));
  assert.match(p.text("#next-buy"), /팔면 [\d,]+G 돌려받아 실제로 [\d,]+G/);
  p.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 18, items: ["6672", "3006", "3032", "3036", "3153", "3089"], dead: true, gold: 99999 });
  p.w.renderNextBuy && p.w.sendOverlay();
  assert.equal(sent.at(-1).swap.ready, true, "골드가 충분하면 지금 바꿀 수 있음");
  assert.ok(!sent.at(-1).hud.some((x) => /라바돈/.test(x) && /팔/.test(x)), "상자 글은 늘리지 않는다 (아이콘으로만)");
  assert.deepEqual(p.errors, []);
  // 판매가가 데이터에 없으면 짐작하지 않는다: 실제 비용 줄 없이 바꾸기만 안내
  const p2 = await loadPage({ simple: true, edit: (x) => x.items.forEach((i) => delete i.sell) });
  const sent2 = [];
  p2.w.pywebview = { api: { set_overlay: (x) => sent2.push(x) } };
  p2.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 18, items: ["6672", "3006", "3032", "3036", "3153", "3089"], dead: true, gold: 99999 });
  assert.equal(sent2.at(-1).swap.cost, null);
  assert.equal(sent2.at(-1).swap.ready, false);
  assert.doesNotMatch(p2.text("#next-buy"), /돌려받아/);
  assert.match(p2.text("#next-buy"), /바꾸면 더 좋아요/);
  assert.deepEqual(p2.errors, []);
});

test("적별 위협·보호막·공격 속도·확인된 적 증강 (산 아이템·소환사 주문 칸만 근거)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const id = (n) => p.data.items.find((i) => i.name === n).id;
  const foes = ["Mordekaiser", "Xayah", "Leona", "Vayne", "Lux"];
  const builds = [[id("스테락의 도전"), id("가시 갑옷"), id("태양불꽃 방패")], [id("불멸의 철갑궁"), id("크라켄 학살자"), id("구인수의 격노검")],
    [id("케이닉 루컨")], [id("몰락한 왕의 검")], []];
  p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c, k) => ({ champion: c, level: 12, items: builds[k], augments: k === 0 ? ["GrowthSpurt"] : k === 1 ? ["ARAM_FlashySpell"] : [] })) });
  p.w.sendOverlay();
  const e = sent.at(-1).enemy;
  const advice = e.advice.join("\n");
  assert.match(advice, /적별 \(산 아이템\): .*모데카이저 탱커 3/);
  assert.match(advice, /자야 보호막·공속 2/);
  assert.match(advice, /적 보호막 많음 \(보호막 아이템 3개\) → 보호막 감소: 독사의 송곳니/, advice);
  assert.match(advice, /적 공격 속도 높음 \(자야\) → 검토: /, "가렌은 앞에서 맞는다");
  assert.match(advice, /적 증강 \(확인됨\): 모데카이저 급속 성장 · 자야 점멸 난사/);
  assert.deepEqual(e.builds.find((b) => b.champ === "Mordekaiser").augments, ["급속 성장"], "기록에도 남긴다");
  const hud = sent.at(-1).hud.join("\n");
  assert.doesNotMatch(hud, /적별|적 증강/, "게임 화면 상자는 할 일만 (짧게)");
  assert.match(hud, /보호막 감소/);
  assert.deepEqual(p.errors, []);
});

test("Tab 점수판에서 읽은 적 증강은 정보 줄로만 (대응·상대 능력치엔 안 씀: 2026-10-19 실제 판 3개 중 1개만 맞음)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const aug = p.data.augments.find((a) => a.category !== "spell");
  const grow = p.data.augments.find((a) => a.id === "GrowthSpurt");
  const foes = ["Mordekaiser", "Lux"];
  p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c, k) => ({ champion: c, level: 12, items: [], augments: k === 0 ? ["GrowthSpurt"] : [] })),
    aug: { enemyAugs: { mordekaiser: ["GrowthSpurt"], Lux: [aug.id, "없는증강"] } } });
  p.w.sendOverlay();
  const e = sent.at(-1).enemy;
  assert.deepEqual(e.builds.find((b) => b.champ === "Mordekaiser").augments, [grow.name], "소환사 주문 칸 증강만 확인됨");
  assert.equal(e.builds.find((b) => b.champ === "Lux").augments, undefined, "점수판 증강은 확인된 증강에 안 넣는다");
  assert.ok(e.advice.some((l) => l.startsWith("적 증강 (점수판 시험, 대응에 안 씀)") && l.includes(`럭스 ${aug.name}`) && !l.includes("모데카이저")), e.advice.join("\n"));
  assert.ok(!sent.at(-1).hud.some((l) => l.startsWith("적 증강")), "게임 화면 상자엔 안 보낸다");
  assert.deepEqual(p.errors, []);
});

test("적 증강도 대응 규칙에: 회복→치유 감소, 체력·방어→탱커(관통), 군중 제어 2개→강인함, 근거 표시", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const tags = (a) => ((p.data.rules.augments || {})[a.id] || {}).tags || a.tags || {};
  const pick = (f, n = 1) => p.data.augments.filter((a) => a.category !== "spell" && f(tags(a))).slice(0, n);
  const heal = pick((t) => (t.HEALSHIELD || 0) >= 0.5 && !(t.CC >= 0.6), 2);
  const tank = pick((t) => (t.HP || 0) >= 0.6 && !(t.CC >= 0.6) && !(t.HEALSHIELD >= 0.5), 2);
  const cc = pick((t) => (t.CC || 0) >= 0.6 && !(t.HEALSHIELD >= 0.5) && !(t.HP >= 0.6) && !(t.ARMOR >= 0.6) && !(t.MR >= 0.6) && !(t.AS >= 0.6), 2);
  assert.equal(heal.length + tank.length + cc.length, 6, "데이터에 증강 종류가 있어야");
  const foes = ["Lux", "Ahri", "Xerath", "Ezreal", "Jinx"];  // 회복·탱커가 아닌 적들
  const enemyAugs = { Lux: [heal[0].id], Ahri: [heal[1].id], Xerath: [tank[0].id, tank[1].id], Ezreal: [cc[0].id], Jinx: [cc[1].id] };
  // 확인된 적 증강으로 넘긴다 (소환사 주문 칸 이름표 자리: 증강 id 그대로도 맞춰진다)
  const live = (augs) => p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items: [], augments: augs[c] || [] })) });
  live({});
  p.w.renderItemList();
  p.w.sendOverlay();
  let advice = sent.at(-1).enemy.advice.join("\n");
  assert.doesNotMatch(advice, /적 회복 많음|적 군중 제어 증강/, "증강을 모르면 조언 없음");
  live(enemyAugs);
  p.w.renderItemList();
  p.w.sendOverlay();
  advice = sent.at(-1).enemy.advice.join("\n");
  assert.ok(advice.includes(`적 회복 많음 (럭스·아리) (적 증강: 럭스 ${heal[0].name} · 아리 ${heal[1].name})`), advice);
  assert.match(advice, /적 군중 제어 증강 \(이즈리얼 .* · 징크스 .*\) → 검토: 헤르메스의 발걸음/, advice);
  assert.ok(p.w.enemyInfo().tanks.some((c) => c.id === "Xerath"), "체력·방어 증강 2개면 탱커로 센다 (관통 조언 기준)");
  assert.doesNotMatch(advice, /제라스 탱커/, "적별 (산 아이템) 줄은 산 아이템만");
  assert.deepEqual(p.errors, []);
});

test("선택 화면이 닫히면 클릭을 못 잡았어도 게임 화면 카드를 바로 지운다 (2026-10-19 퀸 판: 20초 남음)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Quinn", level: 11, items: [] });
  p.w.applyAug({ offers: ["검을 뽑아라", "거인 학살자", "신비한 주먹"], seq: 5, pickSeq: 0 });
  assert.ok(sent.at(-1).cards.some(Boolean), "선택지가 뜨면 카드 평가");
  p.w.applyAug({ offers: null, seq: 5, pickSeq: 0 });  // 닫힘, 고른 것은 아직 모름 ('못 정함'은 20초 뒤)
  assert.ok(!sent.at(-1).cards.some(Boolean), "닫히면 바로 지운다");
  assert.deepEqual(p.errors, []);
});

test("맨 위 '⚙ 표시 설정': 상자 자리·내용·글자 크기를 라디오로, 처음 한 번 안내 (2026-10-20 찾기 어렵다는 지적)", async () => {
  const p = await loadPage({ simple: true });
  const calls = [];
  const st = { desktop: true, live: false, overlay: true, overlaySupported: true, overlayPos: { y: 0.7, spread: 0.246 },
    itemSets: false, record: false, board: false, boxPos: "left-middle", boxDetail: "auto", boxFont: "normal" };
  p.w.pywebview = { api: new Proxy({}, { get: (_, name) => async (...a) => { calls.push([name, ...a]); return name === "get_state" ? st : null; } }) };
  p.w.dispatchEvent(new p.w.Event("pywebviewready"));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(p.q("#ov-settings").hidden, false, "게임 화면 표시 옆에 보인다");
  const checked = (name) => p.q(`input[name="${name}"]:checked`).value;
  assert.equal(checked("ov-box"), "left-middle");
  assert.equal(checked("ov-detail"), "auto");
  assert.equal(checked("ov-font"), "normal");
  assert.match(p.text("#ov-detail-help"), /보통: 상점을 열면 자세히/);
  const big = p.q('input[name="ov-font"][value="large"]');
  big.checked = true; big.dispatchEvent(new p.w.Event("change"));
  assert.ok(calls.some(([n, v]) => n === "set_box_font" && v === "large"));
  const det = p.q('input[name="ov-detail"][value="detail"]');
  det.checked = true; det.dispatchEvent(new p.w.Event("change"));
  assert.ok(calls.some(([n, v]) => n === "set_box_detail" && v === "detail"));
  assert.match(p.text("#ov-detail-help"), /자세히: 죽어 있을 때/);
  assert.equal(p.q("#ov-hint").hidden, false, "처음 한 번 안내");
  p.q("#ov-hint-close").click();
  assert.equal(p.q("#ov-hint").hidden, true);
  assert.equal(p.q("#overlay-pos"), null, "옛 '위치 맞추기' 칸은 없앴다");
  assert.deepEqual(p.errors, []);
  p.w.close();  // 프로그램 시작 처리가 켠 주기 타이머를 멈춘다 (안 그러면 테스트가 안 끝난다)
});

test("추천 다시 계산 시간을 게임 화면 표시와 같이 보낸다 (기록용)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 5, items: ["3006"] });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 5, items: ["3006", "6672"] });
  const last = sent.at(-1);
  assert.equal(typeof last.calcMs, "number");
  assert.ok(last.calcSeq >= 1);
  assert.deepEqual(p.errors, []);
});

test("고른 증강 출처: 증강 칸에서 본 것은 확인됨, 클릭으로만 짐작한 것은 화면 추정", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Vayne", level: 5, items: [] });
  const id = (n) => p.data.augments.find((a) => a.name === n).id;
  p.w.applyAug({ pickSeq: 1, picked: "치명적 리듬", pickedFrom: ["치명적 리듬", "취약", "부메랑 투척"], hudPicked: [] });
  assert.match(p.text("#chosen"), /치명적 리듬클릭으로 앎/);
  p.w.applyAug({ pickSeq: 1, hudPicked: [id("치명적 리듬")] });
  assert.match(p.text("#chosen"), /치명적 리듬✔ 확인됨/);
  assert.deepEqual(p.errors, []);
});

test("게임 중 능력치 표에 게임 실제 값을 옆에 보여 주고, 5% 넘게 다르면 ⚠️ · 기록용으로 보낸다", async () => {
  const p = await loadPage({ simple: false });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const raw = require("./data/live_missfortune_4s.json").activePlayer.championStats;
  const stats = { ...raw, attackDamage: 80 };  // 공격력만 일부러 크게 다르게
  p.w.applyLive({ enabled: true, inGame: true, champion: "MissFortune", level: 3, items: [], dead: true, stats });
  const table = p.text("#stat-table");
  assert.match(table, /게임 실제/);
  assert.match(table, /공격력.*⚠️ 80/);
  assert.doesNotMatch(table, /이동 속도[^가-힣]*⚠️/, "이동 속도는 같다 (325)");
  p.w.sendOverlay();
  const sc = sent.at(-1).statCheck;
  assert.equal(sc.level, 3);
  assert.equal(JSON.stringify(sc.rows.MS), "[325,325]");
  assert.equal(sc.rows.AD[1], 80);
  // 게임 밖(연동 꺼짐)에선 실제 칸이 없다
  p.w.applyLive({ enabled: true, inGame: false });
  assert.deepEqual(p.errors, []);
});

test("적 대응 조언이 권한 아이템은 '다음 구매' 3번째에 이유와 함께 (치유 감소는 점수에 없어 순위와 상관없이)", async () => {
  // 2026-10-17 지적: 조언은 '치유 감소: 필멸자의 운명'인데 다음 구매엔 없었다
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const foes = ["Vladimir", "Soraka", "Aatrox", "Lux", "Malphite"];
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items: [] })) });
  p.w.sendOverlay();
  const next = sent.at(-1).hud.find((x) => x.startsWith("다음 구매"));
  assert.match(next, /> 필멸자의 운명\(치유 감소\)$/, next);
  assert.match(p.text("#next-buy"), /🛡️ 치유 감소/);
  // 이미 샀으면 다시 권하지 않는다
  const mr = p.data.items.find((i) => i.name === "필멸자의 운명").id;
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 12, items: [mr], enemies: foes,
    enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items: [] })) });
  p.w.sendOverlay();
  assert.doesNotMatch(sent.at(-1).hud.find((x) => x.startsWith("다음 구매")), /필멸자의 운명/);
  assert.deepEqual(p.errors, []);
});

test("적 구성 비율: 완성 아이템 2개 이상 산 적은 산 아이템으로 (AP 로 간 원딜)", async () => {
  const p = await loadPage({ simple: true });
  const id = (n) => p.data.items.find((i) => i.name === n).id;
  const foes = ["Ezreal", "Kaisa", "Corki", "Varus", "Garen"];
  const live = (items) => p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 12, items: [], enemies: foes,
    enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items })) });
  live([]);
  const before = p.w.enemyInfo().magic;
  assert.match(p.text("#next-buy"), /적 구성 추정: 마법/);
  live([id("리치베인"), id("루덴의 메아리")]);
  await new Promise((r) => setTimeout(r, 1500));  // 나눠 계산한 뒤 다시 그린다 (warmThenRender)
  assert.ok(p.w.enemyInfo().magic > before + 0.3, `${before} → ${p.w.enemyInfo().magic}`);
  assert.match(p.text("#next-buy"), /적 구성 \(산 아이템 반영\): 마법 100%/);
  assert.deepEqual(p.errors, []);
});

test("확인된 적 증강(급속 성장)의 체력을 상대 능력치에 넣는다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const foes = ["Ezreal", "Kaisa", "Corki", "Varus", "Garen"];
  const hp = (augments) => {
    p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 12, items: [], enemies: foes,
      enemyBuilds: foes.map((c) => ({ champion: c, level: 12, items: [], augments })) });
    p.w.sendOverlay();
    return sent.at(-1).enemy;
  };
  const a = hp([]), b = hp(["GrowthSpurt"]);
  assert.ok(b.target.HP > a.target.HP && b.now.HP > a.now.HP, `${a.target.HP} → ${b.target.HP}`);
  assert.deepEqual(p.errors, []);
});


test("우르곳 판 카드 문구: 역할에 있는 방향은 변신이 아니고, 수치가 안 늘면 '잘 맞아요'라고 하지 않는다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const cards = async (offers, seq) => {
    p.w.applyAug({ offers, seq, pickSeq: seq > 1 ? 1 : 0 });
    await new Promise((r) => setTimeout(r, 300));
    return sent.at(-1).cards;
  };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Urgot", level: 3, items: [] });
  const first = await cards(["강타자", "도주 계획", "불을 밝혀"], 1);
  assert.doesNotMatch(first[0].reason, /탱커형으로 변신/, "우르곳은 탱커 역할이 있다");
  p.w.applyAug({ offers: null, seq: 1, picked: "불을 밝혀", pickedFrom: ["강타자", "도주 계획", "불을 밝혀"], pickSeq: 1 });
  // (원래 판의 '궁극기 봇'은 26.21 패치에서 삭제 → 궁극기 대변혁으로. 둘은 관계가 없어 궁합 0:
  //  예전엔 지표 가중치가 달라 생긴 가짜 궁합 + 로 '애매'였다 — 2026-10-21 같은 가중치로 고침)
  const second = await cards(["궁극기 대변혁", "한 발에 두 놈", "열의"], 2);
  assert.doesNotMatch(second[0].label, /강한 선택/);
  assert.doesNotMatch(second[0].reason, /잘 맞아요/, second[0].reason);
  assert.deepEqual(p.errors, []);
});

test("사미라 판: 불러오는 중(능력치 0)엔 비교하지 않고, 증강에 필요한 아이템은 사도 🤔가 아니다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const zero = { attackDamage: 0, armor: 0, magicResist: 0, moveSpeed: 0, maxHealth: 0 };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Samira", level: 1, items: [], stats: zero });
  p.w.sendOverlay();
  assert.equal(sent.at(-1).statCheck, null);
  const collector = p.data.items.find((i) => i.name === "징수의 총").id;
  p.w.applyLive({ enabled: true, inGame: true, champion: "Samira", level: 14, items: [collector] });
  p.w.applyAug({ offers: null, seq: 1, picked: "징수의 총 업그레이드", pickSeq: 1 });
  p.w.sendOverlay();
  assert.match(sent.at(-1).hud.find((x) => x.startsWith("산 아이템")), /징수의 총 ✅/);
  assert.deepEqual(p.errors, []);
});

test("게임 중 지금 능력치엔 즉시 골드 증강의 능력치 환산을 넣지 않는다 (사미라 판 공격력 +3.57)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const stats = { attackDamage: 163.32, armor: 60, magicResist: 40, moveSpeed: 400, maxHealth: 2000 };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Samira", level: 11, items: [], stats });
  p.w.sendOverlay();
  const before = sent.at(-1).statCheck.rows.AD[0];
  p.w.applyAug({ offers: null, seq: 1, picked: "징수의 총 업그레이드", pickSeq: 1 });
  p.w.sendOverlay();
  assert.equal(sent.at(-1).statCheck.rows.AD[0], before);
  assert.deepEqual(p.errors, []);
});

test("트리스타나 판: 지금 능력치의 무한 반복 가속은 처치 관여 수만큼, 윤 탈 광풍 공속(가동률)은 빼고 센다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const items = ["3085", "6672", "3006", "3032", "3036"];
  const stats = { attackDamage: 239.22, armor: 87.9, magicResist: 48.92, moveSpeed: 403.3, maxHealth: 2471.74, abilityHaste: 147, attackSpeed: 1.88 };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Tristana", level: 16, items, stats, takedowns: 29 });
  p.w.applyAug({ offers: null, seq: 1, picked: "무한 반복", pickSeq: 1 });
  p.w.applyAug({ offers: null, seq: 2, picked: "취약", pickSeq: 2 });
  p.w.sendOverlay();
  const rows = sent.at(-1).statCheck.rows;
  assert.deepEqual([...rows.HASTE], [147, 147]);
  assert.deepEqual([...rows.AS], [1.88, 1.88]);
  assert.deepEqual(p.errors, []);
});

test("세나 판: 쌓는 능력치(안개)는 게임 실제 값으로 지금 쌓인 만큼 맞춘다 (치명타는 20개마다 10% 계단)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  // 2026-10-18 세나 판 실제 값: 3레벨 시작 (안개 0개) → 계산 공격력 80 · 치명타 20% 였다
  const base = { armor: 30.9, magicResist: 34.62, moveSpeed: 330, maxHealth: 725.98, attackSpeed: 0.64 };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Senna", level: 3, items: [], stats: { ...base, attackDamage: 50, critChance: 0 } });
  p.w.sendOverlay();
  let rows = sent.at(-1).statCheck.rows;
  assert.deepEqual([...rows.AD], [50, 50]);
  assert.deepEqual([...rows.CRIT], [0, 0]);
  // 12레벨 · 거대한 히드라·광전사의 군화: 안개 0개일 때와 70개(공격력 +52.5)일 때 → 치명타는 3계단(30%)만 오른다 (35% 가 아니라)
  const st12 = { armor: 64.38, magicResist: 43.83, moveSpeed: 390, maxHealth: 2272.09, attackSpeed: 0.98, critChance: 0 };
  const at = (ad) => {
    p.w.applyLive({ enabled: true, inGame: true, champion: "Senna", level: 12, items: ["3748", "3006"], stats: { ...st12, attackDamage: ad } });
    p.w.sendOverlay();
    return sent.at(-1).statCheck.rows;
  };
  const zero = at(1).AD[0];  // 실제가 맨몸보다 낮으면 0개로 본다
  rows = at(zero + 52.5);
  assert.ok(Math.abs(rows.AD[0] - (zero + 52.5)) < 0.01, `공격력 ${rows.AD[0]}`);
  assert.equal(Math.round((rows.CRIT[0] - at(zero).CRIT[0]) * 100), 30);
  assert.deepEqual(p.errors, []);
});

// 원래 판의 '도박꾼'은 26.21 패치에서 삭제 → 같은 '능력치 모루'를 주는 '능력치!'로
test("아우렐리온 솔(도박꾼) 판: 계산과 실제 차이가 30초 넘게 남으면 모루 능력치로 더한다 · 모루가 없는 판은 안 더한다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  let now = 1000;
  p.w.anvilNow = () => now;
  // 2026-10-18 실제 값 9레벨 · 리치베인·마법사의 신발: 스킬 가속 계산 10 · 실제 32 (모루), 공격 속도는 잠깐 켜진 값이라 안 본다
  const stats = { maxHealth: 1405.42, attackDamage: 79.57, abilityPower: 100, attackSpeed: 1.2, armor: 48.96, magicResist: 38.76, abilityHaste: 32, moveSpeed: 408.1 };
  const live = () => { p.w.applyLive({ enabled: true, inGame: true, champion: "AurelionSol", level: 9, items: ["3100", "3020"], stats }); p.w.sendOverlay(); return sent.at(-1).statCheck; };
  live();
  assert.equal(live().rows.HASTE[0], 10, "모루 증강 전엔 그대로");
  p.w.applyAug({ offers: null, seq: 1, picked: "능력치!", pickSeq: 1 });
  live();
  now += 10;
  assert.equal(live().rows.HASTE[0], 10, "30초 전엔 아직");
  now += 25;
  const sc = live();
  assert.equal(sc.rows.HASTE[0], 32);
  assert.deepEqual({ ...sc.anvil }, { HASTE: 22 });
  assert.notEqual(sc.rows.AS[0], 1.2, "공격 속도는 모루로 보지 않는다");
  assert.deepEqual(p.errors, []);
});

test("게임 화면 상자는 다음 구매가 맨 위, 고른 증강은 맨 아래 · 자주 안 쓰는 버튼은 더보기 메뉴 안", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const stats = { attackDamage: 163.32, armor: 60, magicResist: 40, moveSpeed: 400, maxHealth: 2000 };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Samira", level: 11, items: [], stats });
  p.w.applyAug({ offers: null, seq: 1, picked: "바늘에 실 끼우기", pickSeq: 1 });
  p.w.sendOverlay();
  const hud = sent.at(-1).hud;
  assert.match(hud[0], /^다음 구매: /);
  assert.match(hud.at(-1), /^고른 증강: /);
  for (const id of ["reset-all", "update-data", "changelog-link", "sources-link", "verify-link"])
    assert.ok(p.w.document.querySelector(`#more-menu #${id}`), id);
  assert.deepEqual(p.errors, []);
});

test("6칸이 다 찼어도 적 대응(치유 감소)이 필요하면 바꾸기로 (2026-10-19 킨드레드: 조언은 처형인, 위에는 '그대로 좋아요')", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const id = (n) => p.data.items.find((i) => i.name === n).id;
  const six = ["크라켄 학살자", "광전사의 군화", "윤 탈 야생화살", "도미닉 경의 인사", "몰락한 왕의 검", "루난의 허리케인"].map(id);
  const foes = ["Samira", "Caitlyn"];
  const live = (items, builds) => p.w.applyLive({ enabled: true, inGame: true, champion: "Kindred", level: 18, items, enemies: foes,
    enemyBuilds: foes.map((c) => ({ champion: c, level: 18, items: builds })) });
  live(six, [id("피바라기")]);
  p.w.renderItemList();
  p.w.sendOverlay();
  const sw = sent.at(-1).swap;
  assert.ok(sw, "바꾸기 보냄");
  assert.equal(sw.why, "치유 감소");
  const buy = p.data.items.find((i) => i.id === sw.buy);
  assert.ok(JSON.stringify([buy.desc, buy.passiveHtml]).includes("고통스러운 상처"), buy.name);
  assert.ok(six.includes(sw.sell) && sw.sell !== id("광전사의 군화"), "완성 아이템을 판다 (신발은 안 판다)");
  if (buy.limit) assert.ok(!six.filter((x) => x !== sw.sell).some((x) => p.data.items.find((i) => i.id === x).limit === buy.limit), "같은 계열이면 그걸 판다");
  assert.match(p.text("#next-buy"), /적 대응으로 바꾸면 좋아요/);
  assert.match(sent.at(-1).hud[0], /적 대응\(치유 감소\)/);
  // 이미 치유 감소 아이템이 있으면 적 대응 바꾸기 없음
  live([...six.slice(0, 5), buy.id], [id("피바라기")]);
  p.w.renderItemList();
  p.w.sendOverlay();
  assert.notEqual((sent.at(-1).swap || {}).why, "치유 감소");
  // 산 아이템이 다 잘 맞으면(👍) 확정해서 팔라고 하지 않고 '검토'로 (2026-10-24 진단 C09: 순위가 가장 낮다는 이유로 👍 도 팔았다)
  const orig = p.w.itemVerdicts;
  p.w.itemVerdicts = () => orig().map((v) => ({ ...v, mark: "👍" }));
  // 같은 계열(도미닉 ↔ 필멸자의 운명)은 둘 다 못 가져서 바꾸기가 맞다 → 계열이 겹치지 않는 빌드로
  live(six.map((x) => (x === id("도미닉 경의 인사") ? id("무한의 대검") : x)), [id("피바라기")]);
  p.w.renderItemList();
  p.w.sendOverlay();
  assert.equal(sent.at(-1).swap, null, "게임 화면에 바꾸기 아이콘을 보내지 않는다");
  assert.match(sent.at(-1).hud[0], /적 대응\(치유 감소\)은 .+ 바꿀지는 선택/);
  assert.match(p.text("#next-buy"), /바꾸면 손해일 수 있어요/);
  p.w.itemVerdicts = orig;
  assert.deepEqual(p.errors, []);
});

test("6칸이 다 차면 게임 화면 상자에 다음 구매 대신 '6칸 완성' · 추천이 바뀌면 이유 줄", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const stats = { attackDamage: 300, armor: 100, magicResist: 50, moveSpeed: 400, maxHealth: 2700 };
  const six = ["6672", "3085", "3032", "3006", "3031", "3036"];
  p.w.applyLive({ enabled: true, inGame: true, champion: "Graves", level: 18, items: six, stats });
  p.w.sendOverlay();
  const hud = sent.at(-1).hud;
  assert.ok(!hud.some((l) => l.startsWith("다음 구매")), hud.join("\n"));
  assert.match(hud[0], /^✅ 6칸 완성/);
  assert.match(p.text("#next-buy"), /6칸 완성/);
  // 추천이 바뀌면 새로 들어온 아이템마다 원인 (고른 증강 / 적 상황)
  p.w.applyLive({ enabled: true, inGame: true, champion: "Graves", level: 9, items: ["6672"], stats });
  p.w.renderItemList();
  p.w.applyAug({ offers: null, seq: 1, picked: "무한 반복", pickSeq: 1 });
  p.w.renderItemList();
  // 무한 반복만으론 다음 3개가 그대로 → 치명적 치유까지 고르면 바뀌고, 원인은 방금 고른 치명적 치유 (먼저 고른 무한 반복이 아니라)
  // (원래 판의 탄환 세례는 26.21 패치에서 삭제)
  p.w.applyAug({ offers: null, seq: 2, picked: "치명적 치유", pickSeq: 2 });
  p.w.renderItemList();
  assert.match(p.text("#next-buy"), /🔁 .+ ← 치명적 치유 골라서/);
  assert.equal(p.text("#next-buy").split("← 치명적 치유 골라서").length, 2, "같은 이유는 한 번만 (여러 아이템은 · 로 묶어서)");
  assert.ok(sent.at(-1).hud.some((l) => l.startsWith("🔁 ")), "게임 화면 상자에도");
  const heal = { champion: "Soraka", level: 9, items: [] }, heal2 = { champion: "Yuumi", level: 9, items: [] };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Graves", level: 9, items: ["6672"], stats, enemies: ["Soraka", "Yuumi", "Aatrox"],
    enemyBuilds: [heal, heal2, { champion: "Aatrox", level: 9, items: [] }] });
  p.w.renderItemList();
  assert.match(p.text("#next-buy"), /🔁 필멸자의 운명 ← 치유 감소/);
  assert.deepEqual(p.errors, []);
});

test("적 마법 비중이 높으면 마법 저항 아이템을 다음 구매에 (원인 표시) · 많이 큰 적은 구성 비율에 더 크게", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const stats = { attackDamage: 200, armor: 80, magicResist: 45, moveSpeed: 400, maxHealth: 2000 };
  const ap = ["3089", "3135"];  // 라바돈·공허의 지팡이 (마법 아이템)
  const live = (kills) => p.w.applyLive({ enabled: true, inGame: true, champion: "Graves", level: 11, items: ["6672", "3006"], stats,
    enemies: ["Lux", "Brand", "Syndra", "Jinx", "Caitlyn"],
    enemyBuilds: [{ champion: "Lux", level: 11, kills, items: ap }, { champion: "Brand", level: 11, kills: 0, items: ap },
      { champion: "Syndra", level: 11, kills: 0, items: [] }, { champion: "Jinx", level: 11, kills: 0, items: [] }, { champion: "Caitlyn", level: 11, kills: 0, items: [] }] });
  live(0);
  p.w.renderItemList();
  const m0 = Number(p.text("#next-buy").match(/마법 (\d+)%/)[1]);
  live(12);
  p.w.renderItemList();
  const txt = p.text("#next-buy");
  const m1 = Number(txt.match(/마법 (\d+)%/)[1]);
  assert.ok(m1 > m0, `킬 12개 럭스 → 마법 비중 ${m0}% → ${m1}%`);
  assert.match(txt, /많이 큼: 럭스/);
  assert.match(txt, /마법 저항 우선: /);
  assert.ok(sent.at(-1).hud.some((l) => l.startsWith("다음 구매") && /\(마법 저항\)/.test(l)), sent.at(-1).hud.join("\n"));
  assert.deepEqual(p.errors, []);
});

test("다음 구매 3개는 같이 가질 수 있는 것만 (같은 계열 고유 효과는 하나) · 이미 가진 계열은 조언에도 안 나온다 (그레이브즈 판 '도미닉 > 필멸자 > 세릴다')", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const stats = { attackDamage: 250, armor: 90, magicResist: 50, moveSpeed: 400, maxHealth: 2400 };
  const enemyBuilds = [{ champion: "Soraka", level: 16, items: [] }, { champion: "Yuumi", level: 16, items: [] }, { champion: "Kalista", level: 16, items: [] }];
  const live = (items) => p.w.applyLive({ enabled: true, inGame: true, champion: "Graves", level: 16, items, stats, enemies: ["Soraka", "Yuumi", "Kalista"], enemyBuilds });
  live(["6672", "3085", "3032", "3006"]);
  p.w.applyAug({ offers: null, seq: 1, picked: "바늘에 실 끼우기", pickSeq: 1 });
  p.w.applyAug({ offers: null, seq: 2, picked: "치명적 치유", pickSeq: 2 });
  p.w.renderItemList();
  const ids = [...p.w.document.querySelectorAll("#next-buy .next-row")].map((e) => e.dataset.id);
  const lim = ids.map((id) => p.data.items.find((i) => i.id === id).limit).filter(Boolean);
  assert.equal(new Set(lim).size, lim.length, ids.join(","));
  live(["6672", "3085", "3032", "3006", "3036"]);  // 도미닉(치명상 계열)을 삼
  p.w.renderItemList();
  assert.doesNotMatch(p.text("#next-buy"), /치유 감소: 필멸자의 운명/);
  assert.deepEqual(p.errors, []);
});

test("산 부품으로 만들던 아이템은 순위가 바뀌어도 다음 구매 1순위로 (만드는 중)", async () => {
  const p = await loadPage({ simple: true });
  const live = (items, level = 9) => p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level, items, gold: 0 });
  live([]);
  const first = () => p.q("#next-buy .next-row").dataset.id;
  // 단검 하나(250G)로는 묶지 않는다
  live(["1042"]);
  assert.doesNotMatch(p.text("#next-buy"), /만드는 중/);
  // 단검 2개 + 민첩성의 망토 (2026-10-19 지적: 루난을 보고 샀는데 윤 탈로 바뀜) → 그 부품을 가장 많이 쓰는 아이템이 1순위
  live(["1042", "1042", "1018"]);
  assert.match(p.text("#next-buy"), /🧩 만드는 중/);
  const kept = first();
  const D = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "web", "data.json"), "utf8"));
  const tree = (id) => { const x = D.parts[id] || D.items.find((i) => i.id === id); return [id, ...((x && x.from) || []).flatMap(tree)]; };
  // 산 부품을 쓰는 아이템 (바로 전 1순위가 단검 2개를 쓰는 크라켄이면 그것, 아니면 망토까지 쓰는 루난 — 데이터에 따라 다르다)
  const used = tree(kept);
  assert.ok(used.filter((x) => x === "1042").length >= 2 || used.includes("1018"), `산 부품을 쓰는 아이템: ${kept}`);
  // 레벨이 바뀌어 다시 계산해도 그대로
  live(["1042", "1042", "1018"], 12);
  assert.equal(first(), kept);
  assert.match(p.q("#next-buy .next-row").dataset.label, /\(만드는 중\)/, "게임 화면 상자에도");
  assert.deepEqual(p.errors, []);
});

test("게임 중 챔피언 칸을 숨겼으면(autochamp) 3칸 규칙을 쓰지 않는다 · 칸 너비는 창 크기에 맞춰", () => {
  // 2026-10-19 지적: 왼쪽·가운데·오른쪽 간격. 3칸 규칙이 뒤에 있어 이겨서 가운데 내용이 좁은 왼쪽 칸에 들어갔다
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "web", "style.css"), "utf8");
  const three = css.split("\n").filter((l) => /body\.ingame[^{]*main \{ grid-template-columns: \S+ \S+ \S+/.test(l)
    || /body\.ingame[^{]*main \{ grid-template-columns: clamp\([^)]*\) minmax\(0, 1fr\) clamp/.test(l));
  assert.ok(three.length >= 1, "게임 중 3칸 규칙");
  for (const l of three) assert.match(l, /:not\(\.autochamp\)/, l);
  assert.doesNotMatch(css, /main \{[^}]*grid-template-columns: \d+px 1fr \d+px/, "큰 칸 3개를 고정 px 로 두지 않는다");
});

// 2026-10-20 피드백 #11·#10: 상자를 띄울 이유(상점·죽음)가 바뀌면 골드·아이템이 그대로여도 바로 다시 보낸다
test("상점을 닫거나 부활하면 골드가 같아도 게임 화면 상자를 바로 다시 보낸다 (상자가 남지 않게)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const live = (extra) => p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: [], gold: 500, gameTime: 300, ...extra });
  live({ aug: { shop: { left: 0.3 } } });
  assert.equal(sent.at(-1).box, "shop");
  const n = sent.length;
  live({ aug: { shop: null } });  // 상점 닫힘 (골드 그대로)
  assert.ok(sent.length > n, "다시 보냄");
  assert.equal(sent.at(-1).box, null);
  live({ dead: true });  // 죽음
  assert.equal(sent.at(-1).box, "dead");
  live({ dead: false });  // 부활
  assert.equal(sent.at(-1).box, null);
  // 레벨만 바뀌어도(같은 빌드) 이유가 바뀌었으면 보낸다
  live({ dead: true, level: 10 });
  assert.equal(sent.at(-1).box, "dead");
  assert.deepEqual(p.errors, []);
});

// 2026-10-20 피드백 #22·#21·#15·#17
test("⚙ 팝업은 바깥 클릭·Esc·✕ 로 닫히고, 상태 글은 짧은 말 · 증강 4개면 완료 요약", async () => {
  const p = await loadPage({ simple: true });
  const ov = p.q("#ov-settings"), more = p.q("#more-menu");
  ov.open = true;
  p.click(p.q("main"));
  assert.equal(ov.open, false, "바깥 클릭");
  more.open = true;
  p.doc.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(more.open, false, "Esc");
  ov.open = true;
  p.click(p.q("#ov-close"));
  assert.equal(ov.open, false, "✕");
  p.w.applyLive({ enabled: true, inGame: true, champion: "Corki", championName: "코르키", level: 1, gameTime: 1, items: [],
    overlayStatus: "표시 중 · 테두리 없음 1440×900 · 상점 상자 (가로 0.00~0.25 세로 0.05~0.40)", aug: { status: "증강 선택 화면 아님 (ko · 버퍼 4인자)" } });
  const st = p.text("#live-status");
  assert.match(st, /코르키 시작 중 · 게임 화면: 상점 상자/);
  assert.doesNotMatch(st, /가로|버퍼/, "진단 값은 툴팁으로");
  assert.match(p.q("#live-status").title, /가로 0\.00/);
  // 증강 4개
  const four = ["ARAM_Archmage", "BurstingTeeth", "ARAM_DrawYourSword", "ARAM_GiantSlayer"];
  for (const id of four) p.click(p.augRow(id) || p.qa(".aug").find((e) => !p.text("#chosen").includes(e.dataset.id)));
  assert.equal(p.text("#aug-title"), "증강 4개 완료");
  assert.deepEqual(p.errors, []);
});

// 안정화 기획서 8.2: 완성 빌드 추천(18레벨)과 따로, 지금 레벨·가진 것 기준으로 지금 골드로 살 수 있는 것 중 당장 가장 강해지는 것
test("현재 구매 추천: 지금 골드로 살 수 있는 것만, 완성 빌드 경로와 다르면 이유를 붙인다", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: [], gold: 1300, gameTime: 400 });
  const line = p.q("#buy-now .buy-now-current");
  assert.ok(line, "한 줄이 있다");
  assert.match(line.textContent, /지금 9레벨에서 바로 강해지는 것: .+ \(([\d,]+)G\)/);
  const cost = Number(/\(([\d,]+)G\)/.exec(line.textContent)[1].replace(/,/g, ""));
  assert.ok(cost <= 1300, `지금 골드로 살 수 있는 것: ${cost}`);
  assert.match(line.textContent, /완성 빌드로 가는 길과 같아요|완성 빌드 기준으로는/);
  // 골드가 없으면 안 보인다 (상점이 열려 있으면 골드가 바뀌자마자 다시 그린다. 닫혀 있으면 10초에 한 번이 원래 동작)
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: [], gold: 0, gameTime: 420, aug: { shop: { left: 0.3 } } });
  assert.equal(p.q("#buy-now .buy-now-current"), null);
  assert.deepEqual(p.errors, []);
});

// v0.1.55 후속 기획 A-②: 현재 구매 추천 캐시는 결과를 바꾸는 조건이 바뀌면 다시 계산한다
test("현재 구매 추천 캐시: 같은 조건이면 재사용, 가중치·적 마법 비율·기준 상대·살 수 있는 후보가 바뀌면 다시 계산", async () => {
  const p = await loadPage({ simple: true });
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 9, items: [], gold: 1300, gameTime: 400 });
  const S = p.w.Scoring, orig = S.buyNowGains, St = p.w.Stats;
  let calls = 0;
  S.buyNowGains = (...a) => { calls++; return orig(...a); };
  try {
    p.w.buyNowCurrent(1300);
    const base = calls;
    p.w.buyNowCurrent(1300);
    assert.equal(calls, base, "같은 조건 → 캐시");
    p.w.buyNowCurrent(1301);
    assert.equal(calls, base, "골드가 조금 달라도 살 수 있는 후보가 같으면 캐시");
    p.w.buyNowCurrent(200);
    assert.equal(calls, base + 1, "살 수 있는 후보가 달라짐");
    // 가중치: buyNowGains 에 넘어간 state.weights 를 그대로 바꾼다 (app.js 의 state 는 전역 어휘 범위라 테스트에서 못 집는다)
    let w = null;
    S.buyNowGains = (...a) => { calls++; w = a[1]; return orig(...a); };
    p.w.buyNowCurrent(0);
    p.w.buyNowCurrent(1300);
    const n0 = calls;
    w.AD = (w.AD || 0) + 1;
    p.w.buyNowCurrent(1300);
    assert.equal(calls, n0 + 1, "가중치");
    const n = calls - 1;
    assert.equal(calls, n + 1, "가중치");
    const t = St.TARGET.MR;
    St.TARGET.MR = t + 40;
    p.w.buyNowCurrent(1300);
    assert.equal(calls, n + 2, "기준 상대 마법 저항력");
    St.TARGET.MR = t;
    // 칼바람 보정 토글: 바꾸면 화면이 다시 그려지며 부를 수도 있다 → 그 전보다 늘었는지만 본다
    const n2 = calls;
    const tg = p.q("#aram-toggle");
    tg.checked = !tg.checked;
    tg.dispatchEvent(new p.w.Event("change", { bubbles: true }));
    p.w.buyNowCurrent(1300);
    assert.ok(calls > n2, "칼바람 보정 (statOpts)");
  } finally {
    S.buyNowGains = orig;
  }
  assert.deepEqual(p.errors, []);
});

// 안정화 기획서 8.3: 만드는 중 아이템은 1순위보다 15% 넘게 낮고 남은 골드당 가치도 나쁠 때만 놓아 준다
test("만드는 중 놓아 주기: 점수 차이가 크고 남은 골드당 가치도 나쁘면 놓아 주고, 거의 다 만들었으면 계속", async () => {
  const p = await loadPage({ simple: true });
  const it = (name) => p.data.items.find((i) => i.name === name);
  const top = { item: it("무한의 대검"), score: 2 };
  assert.equal(p.w.keepWorth({ item: it("크라켄 학살자"), sunk: 600, score: 1 }, top), false, "절반 점수 · 남은 돈 많음 → 놓아 줌");
  assert.equal(p.w.keepWorth({ item: it("크라켄 학살자"), sunk: it("크라켄 학살자").gold - 300, score: 1 }, top), true, "남은 300G → 계속");
  assert.equal(p.w.keepWorth({ item: it("크라켄 학살자"), sunk: 600, score: 1.9 }, top), true, "점수 차이 5% → 계속");
});

// 26.21 헤드라이너(K/DA 등)는 증강을 하나 더 준다: 4개가 모두 증강 칸 그림으로 확인된 뒤 선택 화면이 또 뜨면 짐작을 빼지 않고 5번째로 받는다
test("추가 증강: 4개 확인 뒤 뜬 선택 화면은 카드를 띄우고 5번째로 받는다 · 확인 안 된 짐작이 있으면 예전처럼 짐작을 뺀다", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Lux", level: 16, items: [] });
  const id = (n) => p.data.augments.find((a) => a.name === n).id;
  const four = ["무한 반복", "대마법사", "도주 계획", "강타자"];
  p.w.applyAug({ offers: null, seq: 0, pickSeq: 0, hudPicked: four.map(id) });
  for (const n of four) assert.match(p.text("#chosen"), new RegExp(n));
  p.w.applyAug({ offers: ["불을 밝혀", "한 발에 두 놈", "열의"], seq: 5, pickSeq: 0, hudPicked: four.map(id) });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.at(-1).cards.filter(Boolean).length, 3, "추가 선택 화면 카드 3장");
  for (const n of four) assert.match(p.text("#chosen"), new RegExp(n), "확인된 4개는 그대로");
  p.w.applyAug({ offers: null, seq: 5, picked: "열의", pickSeq: 1, hudPicked: four.map(id) });
  assert.match(p.text("#chosen"), /열의/, "5번째로 받음");
  // 짐작(증강 칸 미확인)이 섞여 있으면 예전처럼 그 짐작을 뺀다 (2026-10-15 케일 판)
  const q = await loadPage({ simple: true });
  q.w.pywebview = { api: { set_overlay: () => {} } };
  q.w.applyLive({ enabled: true, inGame: true, champion: "Lux", level: 16, items: [] });
  q.w.applyAug({ offers: null, seq: 0, pickSeq: 0, hudPicked: four.slice(0, 3).map(id) });
  q.w.applyAug({ offers: null, seq: 0, picked: "강타자", pickSeq: 1, hudPicked: four.slice(0, 3).map(id) });
  q.w.applyAug({ offers: ["불을 밝혀", "한 발에 두 놈", "열의"], seq: 5, pickSeq: 1, hudPicked: four.slice(0, 3).map(id) });
  assert.doesNotMatch(q.text("#chosen"), /강타자/, "확인 못 한 짐작은 뺀다");
  assert.deepEqual(p.errors, []);
  assert.deepEqual(q.errors, []);
});

// 새 증강 페이지 (web/new.html · new.js): 이번 패치에 처음 보인 증강과 PBE 미리 보기, 사라진 증강
test("새 증강 페이지: 이번 패치 firstSeen·미리 보기만 등급별로 · 사라진 증강 · 이름 찾기", async () => {
  const { JSDOM } = require("jsdom");
  const fs = require("fs");
  const path = require("path");
  const WEB = path.join(__dirname, "..", "web");
  const html = fs.readFileSync(path.join(WEB, "new.html"), "utf8").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/new.html" });
  const w = dom.window;
  w.fetch = async () => ({ json: async () => ({}) });
  w.eval(fs.readFileSync(path.join(WEB, "new.js"), "utf8"));
  const aug = (id, name, rarityName, extra) => ({ id, name, enName: name, rarityName, desc: `${name} 설명`, effects: [], icon: false, num: 1, ...extra });
  const d = { version: "16.21.1", iconExt: "webp", removedAugs: [{ id: "X", name: "탄환 세례", rarityName: "프리즘" }],
    rules: { augments: { LichBrain: { stats: { AP: 30 }, statsResolved: { AP: { base: [30], ratios: { bonusHP: [0.04] } } } } } },
    augments: [aug("LichBrain", "리치 두뇌", "실버", { firstSeen: "16.21.1" }), aug("BEES", "벌이다!!!", "골드", { preview: "PBE", effects: [{}] }),
      aug("Old", "옛 증강", "골드", { firstSeen: "16.19.1" }), aug("Older", "더 옛 증강", "실버")] };
  assert.equal(w.NewAugs.render(d), 2, "이번 패치 + 미리 보기만");
  const text = w.document.getElementById("groups").textContent;
  assert.match(text, /리치 두뇌/);
  assert.doesNotMatch(text, /옛 증강/);
  assert.match(text, /연계: 체력 아이템/, "추가 체력 비례 주문력 → 체력 아이템");
  assert.match(text, /미리 보기 \(PBE\)/);
  assert.equal(w.document.getElementById("warn").hidden, false);
  assert.match(w.document.getElementById("removed").textContent, /탄환 세례/);
  assert.equal(w.document.getElementById("title").textContent, "26.21 새 증강", "라이엇 패치 이름 (게임 16.21 = 패치 26.21)");
  assert.match(w.document.getElementById("kicker").textContent, /패치 26\.21 \(게임 16\.21\)/);
});

test("누르자마자 다음 선택 화면: 고른 증강을 넣고 새 선택지 카드는 남긴다 · 아이템을 사면 상점 인식 없이도 상자 (하이머딩거 판)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Heimerdinger", level: 7, gameTime: 280, items: [] });
  p.w.applyAug({ offers: ["궁극의 각성", "결투의 대가", "유레카"], seq: 1, pickSeq: 0 });
  await new Promise((r) => setTimeout(r, 300));
  p.w.applyAug({ offers: ["가속 추구", "신난다!", "소환술사"], seq: 2, picked: "유레카", pickedFrom: ["궁극의 각성", "결투의 대가", "유레카"], pickSeq: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const cards = sent.at(-1).cards.filter(Boolean).map((c) => c.name);
  assert.ok(p.doc.querySelector("#chosen").textContent.includes("유레카"), "유레카를 고른 증강에");
  assert.equal(JSON.stringify(cards), JSON.stringify(["가속 추구", "신난다!", "소환술사"]), "새 선택지 카드는 그대로");
  // 상점 창을 못 알아봐도(aug.shop 없음) 살아 있는데 가방이 바뀌면 상자를 띄운다
  const tome = p.data.parts ? Object.keys(p.data.parts).find((id) => p.data.parts[id].name === "증폭의 고서") : null;
  p.w.applyLive({ enabled: true, inGame: true, champion: "Heimerdinger", level: 7, gameTime: 300, items: [tome].filter(Boolean) });
  assert.equal(sent.at(-1).box, "bought", "산 직후는 따로 (그리는 쪽이 상점 인식과 상관없이 띄운다)");
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test("어떤 증강이든 재밌게: 증강마다 '쓰는 법' 한 줄이 있다 (사람이 쓴 tips 포함)", async () => {
  const p = await loadPage({ simple: true });
  p.pickChamp("Jinx");
  const empty = p.data.augments.filter((a) => !String(p.w.playTip(a) || "").trim()).map((a) => a.name);
  assert.equal(empty.length, 0, empty.join(", "));
  assert.equal(p.w.playTip(p.data.augments.find((a) => a.id === "PromQueen")), p.data.rules.tips.PromQueen);
  p.w.close();
});

test("상대 아이템 변화: 예상 상대 능력치가 5% 미만이면 기준 그대로, 크면 나눠 계산한 뒤 반영 (벨코즈 판 느린 계산)", async () => {
  const p = await loadPage({ simple: true });
  p.w.pywebview = { api: { set_overlay: () => {} } };
  const id = (n) => p.data.items.find((i) => i.name === n).id;
  const foes = ["Tristana", "Cassiopeia", "Garen", "Lux", "Sona"];
  const live = (items) => p.w.applyLive({ enabled: true, inGame: true, champion: "Velkoz", level: 9, gameTime: 400, items: [], enemies: foes,
    enemyBuilds: foes.map((c, i) => ({ champion: c, level: 9, items: items[i] || [] })) });
  live([]);
  const T = () => JSON.stringify([p.w.Stats.TARGET.ARMOR, p.w.Stats.TARGET.MR, p.w.Stats.TARGET.HP]);
  const t0 = T();
  live([[], [id("라바돈의 죽음모자")]]);  // 체력 조금 바뀜 → 그대로
  assert.equal(T(), t0, "작은 변화는 기준 그대로");
  const t1 = performance.now();
  live([[], [id("라바돈의 죽음모자")], [id("가시 갑옷"), id("태양불꽃 방패")]]);  // 방어력 크게
  assert.ok(performance.now() - t1 < 150, "바로 돌아온다 (계산은 나눠서)");
  assert.notEqual(T(), t0, "큰 변화는 반영");
  await new Promise((r) => setTimeout(r, 1500));
  assert.match(p.text("#next-buy"), /다음에 살 아이템/);
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test("증강을 고르면 상점 인식 없이도 그 증강 기준 다음 구매 상자를 8초 띄운다 (2026-10-24: 첫 증강 뒤 추천이 안 보임)", async () => {
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  let now = 1_000_000;
  p.w.Date.now = () => now;
  const live = (gt) => p.w.applyLive({ enabled: true, inGame: true, champion: "Yunara", level: 3, gold: 1400, gameTime: gt, items: [] });
  live(20);
  assert.equal(sent.at(-1).box, null, "고르기 전엔 상자 없음 (게임을 가리지 않게)");
  p.w.applyAug({ offers: ["전부 다 무너뜨려", "위력 추구", "치명적인 공격"], seq: 1, pickSeq: 0 });
  p.w.applyAug({ offers: null, seq: 1, picked: "전부 다 무너뜨려", pickedFrom: ["전부 다 무너뜨려", "위력 추구", "치명적인 공격"], pickSeq: 1 });
  const s = sent.at(-1);
  assert.equal(s.box, "bought", "고른 직후 상자");
  assert.match((s.hud || [])[0] || "", /^다음 구매: /, "첫 줄은 증강 기준 다음 구매");
  now += 5000; live(25);
  assert.equal(sent.at(-1).box, "bought", "8초 안엔 그대로");
  now += 4000; live(29);
  assert.equal(sent.at(-1).box, null, "8초가 지나면 내린다");
  assert.deepEqual(p.errors, []);
  p.w.close();
});

test("효과 없는 증강은 '강한 선택'·변신으로 권하지 않는다", async () => {
  // 징크스에게 '너만을 위해'(아군 회복·보호막 스킬이 없어 발동 안 함)가 셋 다 D 등급인 선택지에서 이득 0 으로 1순위가 되어
  // 게임 화면 카드에 '효과 없음 · 강한 선택', 표에 '💪 강한 선택 🔄 서포터형으로 변신'이 같이 떴다
  const p = await loadPage();
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Jinx", level: 6, items: [] });
  const offers = ["너만을 위해", "천상의 신체", "간지럼 괴물"];
  p.w.applyAug({ offers, seq: 1, picked: null, pickSeq: 0 });
  const card = sent.at(-1).cards[0];
  assert.equal(card.name, "너만을 위해");
  assert.match(card.label, /효과 없음/);
  assert.doesNotMatch(card.label, /강한 선택/);
  const row = p.qa(".offer-table tr").slice(1).find((r) => r.textContent.includes("너만을 위해"));
  assert.doesNotMatch(row.textContent, /강한 선택|변신/);
  assert.ok(sent.at(-1).cards.some((c) => /강한 선택/.test(c.label)), "다른 카드에 강한 선택");
});

test("강한 선택 카드에 '새로고침 권장'을 같이 붙이지 않는다 (게임 화면 카드와 같게)", async () => {
  // 가렌: 더블 타임(C, 같은 등급 하위)이 강한 선택이면서 새로고침 권장 → 게임 화면 카드는 강한 선택만 보였는데 표엔 둘 다
  const p = await loadPage();
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  p.w.applyLive({ enabled: true, inGame: true, champion: "Garen", level: 6, items: [] });
  p.w.applyAug({ offers: ["더블 타임", "너만을 위해", "기본으로 돌아가기"], seq: 1, picked: null, pickSeq: 0 });
  for (const r of p.qa(".offer-table tr").slice(1)) {
    assert.ok(!(/강한 선택/.test(r.textContent) && /새로고침 권장/.test(r.textContent)), r.textContent.slice(0, 60));
  }
});

test("지금 살 것: 가진 중간 부품 안에 이미 들어 있는 하위 부품은 다시 권하지 않는다", async () => {
  // 황혼과 새벽(2510) = 광휘의 검 + 방출의 마법봉 + 점화석(루비 수정·빛나는 티끌) + 단검. 루비 수정은 점화석 안에만 있는데,
  // 점화석을 가진 채 450G 에 '루비 수정부터 사세요'라고 했다 (트리 전체 개수만 세서 가진 중간 부품 안을 빼지 않았다)
  const p = await loadPage({ simple: true });
  const DD = p.data.items.find((i) => i.id === "2510");
  const b = p.w.buyNow(DD, 450, ["3067"]);
  assert.ok(b.part && b.part.id !== "1028", `살 부품: ${b.part && b.part.name}`);
  assert.equal(p.w.buyNow(DD, 900, ["3067"]).part.id, "3057", "더 비싼 다른 부품은 그대로");
  // '⚡ 지금 강해지는 것'도 같게
  p.w.applyLive({ enabled: true, inGame: true, champion: "Ornn", level: 9, items: ["3067"], gold: 450, gameTime: 300 });
  p.q("#next-buy").innerHTML = '<div class="next-row" data-id="2510"></div>';
  p.q("#build").innerHTML = "";
  const r = p.w.buyNowCurrent(450);
  assert.ok(!r || r.id !== "1028", `지금 강해지는 것: ${r && r.name}`);
});

test("지금 살 것을 못 정하면 지난 '💰 지금' 문구를 게임 화면 상자에 남기지 않는다", async () => {
  // 2026-10-25 기록: 아크샨 판이 끝나고 챔피언 정보 없이 시작된 다음 기록의 상자에 '💰 지금 무한의 대검 완성 가능 (3,768G 기준)'이 남았다.
  // renderBuyNow 가 골드·1순위가 없을 때 애드온 창만 비우고 상자 문구(buyNowText)는 지우지 않았다
  const p = await loadPage({ simple: true });
  const sent = [];
  p.w.pywebview = { api: { set_overlay: (x) => sent.push(x) } };
  const base = { enabled: true, inGame: true, champion: "Jinx", level: 9, items: ["1001"], gameTime: 300, aug: { shop: true } };
  p.w.applyLive({ ...base, gold: 1300 });
  assert.ok(sent.at(-1).hud.some((h) => h.startsWith("💰")), "골드가 있으면 문구");
  p.w.applyLive({ ...base, gold: null });
  assert.equal(p.text("#buy-now"), "");
  assert.equal(sent.at(-1).hud.filter((h) => h.startsWith("💰")).length, 0, "애드온 창처럼 상자도 비운다");
});
