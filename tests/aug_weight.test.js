// v0.1.95 B1·B2·B3 테스트. 먼저 결함을 재현하는 쪽으로 쓰고(Phase 1), 고친 뒤 '제대로 도는지' 쪽으로 뒤집었다
// (B1·B2 는 Phase 2, B3 는 Phase 3). 주석에 수정 전 숫자를 남겨 둔다 — 되돌아가면 바로 보이게.
// 특정 아이템을 몇 위로 만들자는 기준이 아니라, 효과 성격과 점수 기여도가 맞물리는지를 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const WEB = path.join(__dirname, "..", "web");
global.Stats = global.Stats || require(path.join(WEB, "stats.js"));
const St = global.Stats;
const S = require(path.join(WEB, "scoring.js"));
const d = require(path.join(WEB, "data.json"));
S.attachSimilar(d.champions, null, d.items);

const champ = (id) => d.champions.find((c) => c.id === id);
const item = (name) => d.items.find((i) => i.name === name);
const aug = (name) => d.augments.find((a) => a.name === name);
const AUG = S.CONCEPTS.find((c) => c.key === "augment");
const mwOf = (c, chosen) => S.metricWeights(S.conceptWeights(S.profile(c, d.tags), S.augContext(chosen, d.rules, c), AUG));
const offTypeCount = (c, chosen) =>
  S.rankItems(d.items, S.profile(c, d.tags), chosen, [], d.rules, c, { aram: true }, chosen.length ? "augment" : "balanced")
    .filter((r) => r.item.kind === "legendary" && r.offType).length;

// ── B1: 스킬 치명타와 평타 치명타가 같은 CRIT 태그로 묶여 전부 평타(dps) 칸으로 간다 ──
test("[B1 수정] 스킬 치명타 증강(보석 건틀릿)이 아리의 가중치를 스킬 쪽으로 보낸다", () => {
  const c = champ("Ahri");
  const a = mwOf(c, []), b = mwOf(c, [aug("보석 건틀릿")]);
  // 수정 전: dps 0.018 → 0.379 (21.5배), combo 0.692 → 0.520 (스킬 치명타가 통째로 평타 칸으로 갔다)
  // 수정 후: dps 0.018 → 0.099 (5.6배), combo 0.692 → 0.800
  assert.ok(b.dps / a.dps < 10, `dps 배수 ${(b.dps / a.dps).toFixed(1)}`);
  assert.ok(b.combo > a.combo, `combo ${a.combo.toFixed(3)} → ${b.combo.toFixed(3)}`);
});

test("[B1 수정] 평타 치명타 증강(치명적인 공격)은 그대로 평타 칸에 남는다", () => {
  for (const id of ["Ahri", "Jinx"]) {
    const c = champ(id);
    const a = mwOf(c, []), b = mwOf(c, [aug("치명적인 공격")]);
    // 순수 치명타 확률 증강은 스킬 치명타 키가 없다 → 칸 배분이 바뀌면 안 된다
    assert.ok(Math.abs(b.dps - a.dps) < 1e-9, `${id} dps ${a.dps.toFixed(3)} → ${b.dps.toFixed(3)}`);
  }
});

test("[B1 수정] 스킬·평타 치명타가 같이 유효한 챔피언은 양쪽 몫이 다 남는다", () => {
  const c = champ("Jinx");
  const a = mwOf(c, []), b = mwOf(c, [aug("보석 건틀릿")]);
  // 징크스 본래 치명타 성향(평타)은 그대로 평타 칸에, 증강이 올린 몫만 스킬 칸으로
  assert.ok(b.dps > 0.2, `평타 몫이 사라졌다: dps ${b.dps.toFixed(3)}`);
  assert.ok(b.combo > a.combo, `스킬 몫이 안 늘었다: combo ${a.combo.toFixed(3)} → ${b.combo.toFixed(3)}`);
});

test("[B1 수정] 치명타 아이템 연계는 끊기지 않는다 (아리 + 보석 건틀릿)", () => {
  const c = champ("Ahri");
  const ctx = S.augContext([aug("보석 건틀릿")], d.rules, c);
  // 치명타 아이템을 원하는 근거(lift.CRIT)는 그대로여야 한다 — 칸 배분만 바꾼다
  assert.ok((ctx.lift.CRIT || 0) >= 0.5, `lift.CRIT ${ctx.lift.CRIT}`);
  const iw = S.conceptWeights(S.profile(c, d.tags), ctx, AUG);
  assert.ok((iw.CRIT || 0) > 0.5, `iw.CRIT ${(iw.CRIT || 0).toFixed(3)}`);
});

test("[B1 근거] 보석 건틀릿 아리에게 무한의 대검의 combo 상승은 전부 치명타에서 온다 (공격력 몫 0)", () => {
  const c = champ("Ahri");
  const A = S.augStatsOf([aug("보석 건틀릿")], d.rules, c);
  const base = ["리안드리의 고통", "그림자불꽃", "폭풍 쇄도", "라바돈의 죽음모자", "공허의 지팡이"].map(item);
  const IE = item("무한의 대검");
  const mk = (suf, keep) => ({ ...IE, id: IE.id + suf, stats: Object.fromEntries(Object.entries(IE.stats).filter(([k]) => keep(k))) });
  const m0 = St.evaluate(c, 18, base, A, { aram: true }).m;
  const ev = (x) => St.evaluate(c, 18, base.concat([x]), A, { aram: true }).m;
  const full = ev(IE), adOnly = ev(mk("_ad", (k) => !/CRIT/.test(k))), critOnly = ev(mk("_crit", (k) => /CRIT/.test(k)));
  // 수치 계산 자체는 맞다: 공격력 75 는 아리의 콤보 피해를 전혀 못 올리고, 치명타가 올린 몫이 전부다
  assert.ok(Math.abs(adOnly.combo - m0.combo) < 1, `공격력만: combo ${Math.round(m0.combo)} → ${Math.round(adOnly.combo)}`);
  assert.ok(Math.abs(critOnly.combo - full.combo) < 1, `치명타만 ${Math.round(critOnly.combo)} vs 전체 ${Math.round(full.combo)}`);
  // ⇒ Phase 2 후에도 이 사실은 그대로여야 한다 (수치 계산은 건드리지 않는다).
});

// ── B2: 부수 효과의 lift 하나로 반대 유형 차단이 통째로 꺼진다 ───────────────────
test("[B2 수정] 보호막 계수로 붙은 주문력은 징크스의 반대 유형 차단을 끄지 않는다", () => {
  const c = champ("Jinx");
  const before = offTypeCount(c, []);
  // 수정 전: 전술적 대비 뒤 0개 (차단이 통째로 꺼졌다). 전술적 대비의 주문력은 사망 시 보호막 계수에서만 쓰인다
  assert.ok(before > 20, `증강 없을 때 반대 유형 ${before}개`);
  assert.equal(offTypeCount(c, [aug("전술적 대비")]), before, "보호막 계수 주문력으로 열렸다");
});

test("[B2 수정] 수치 계산이 없는 설명 태그만으로는 반대 유형이 열리지 않는다", () => {
  const c = champ("Jinx");
  const before = offTypeCount(c, []);
  // 3연발·주문 분산·다중 공격은 주문력 계수가 하나도 없는데 태그 하나로 물리 챔피언 전원의 차단을 껐다
  for (const n of ["3연발", "주문 분산", "다중 공격"]) {
    assert.equal(offTypeCount(c, [aug(n)]), before, `${n} 으로 열렸다`);
  }
});

test("[B2 수정] 치명타 증강을 고른 마법 챔피언에게 무한의 대검은 차단되지 않는다", () => {
  const c = champ("Ahri");
  const rows = S.rankItems(d.items, S.profile(c, d.tags), [aug("보석 건틀릿")], [], d.rules, c, { aram: true }, "augment");
  const row = (n) => rows.find((r) => r.item.name === n);
  // 공격력과 치명타를 같이 가진 아이템: 치명타가 증강과 연계되므로 공격력 때문에 막지 않는다 (순위는 계산에 맡긴다)
  assert.ok(!row("무한의 대검").offType, "무한의 대검이 차단됐다");
  assert.ok(!row("정수 약탈자").offType, "정수 약탈자가 차단됐다");
  // 치명타가 없는 공격력 아이템은 계속 뒤로 민다 (전체 해제가 아니다)
  assert.ok(row("몰락한 왕의 검").offType, "몰락한 왕의 검이 열렸다");
  assert.ok(row("요우무의 유령검").offType, "요우무의 유령검이 열렸다");
});

test("[B2 유지] 유형 전환 증강(적응형 능력치)은 지금처럼 전체 해제여야 한다", () => {
  const c = champ("Jinx");
  assert.equal(offTypeCount(c, [aug("적응형 능력치")]), 0);
  // ⇒ Phase 2 후에도 0 (convert 가 있는 증강은 비정석 빌드를 막지 않는다).
});

// ── B3: 캐시 열쇠에 상대 회복량(TARGET.HEAL)이 빠져 옛 결과가 남았다 (2026-11-24 Phase 3 수정) ──
const T0 = { ARMOR: 170, MR: 65, HP: 3450 };
const buildOf = (c, opts) => S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, opts, ["balanced"])[0].pick.map((p) => p.item.name).join(" / ");

test("[B3 수정] 상대 회복량만 올려도 빌드가 다시 계산된다", () => {
  const c = champ("Galio"), opts = { aram: true, enemyMagic: 0.5 };
  try {
    S.clearMemo(); St.setTarget({ ...T0, HEAL: 0 });
    const low = buildOf(c, opts);
    St.setTarget({ ...T0, HEAL: 450 });
    const cached = buildOf(c, opts);          // 캐시를 비우지 않고 그대로
    S.clearMemo();
    const fresh = buildOf(c, opts);           // 비우고 새로
    assert.notEqual(cached, low, "회복량을 올렸는데 결과가 그대로다");
    assert.equal(cached, fresh, `캐시 결과 ${cached} ≠ 새로 계산 ${fresh}`);
    assert.ok(/모렐로노미콘/.test(cached), `치유 감소가 안 들어왔다: ${cached}`);
  } finally { St.setTarget(null); S.clearMemo(); }
});

test("[B3 수정] 상대 회복량이 줄어도 다시 계산된다 (치유 감소가 빠진다)", () => {
  const c = champ("Galio"), opts = { aram: true, enemyMagic: 0.5 };
  try {
    S.clearMemo(); St.setTarget({ ...T0, HEAL: 450 });
    const high = buildOf(c, opts);
    St.setTarget({ ...T0, HEAL: 0 });
    const cached = buildOf(c, opts);
    S.clearMemo();
    const fresh = buildOf(c, opts);
    assert.notEqual(cached, high, "회복량을 0으로 내렸는데 결과가 그대로다");
    assert.equal(cached, fresh, `캐시 결과 ${cached} ≠ 새로 계산 ${fresh}`);
    assert.ok(!/모렐로노미콘/.test(cached), `치유 감소가 안 빠졌다: ${cached}`);
  } finally { St.setTarget(null); S.clearMemo(); }
});

test("[B3 수정] 회복량이 그대로면 기억한 결과를 다시 쓴다 (적중)", () => {
  const c = champ("Galio"), opts = { aram: true, enemyMagic: 0.5 };
  try {
    S.clearMemo(); St.setTarget({ ...T0, HEAL: 300 });
    buildOf(c, opts);
    S.memoStats(true);                        // 세는 값만 0으로, 기억은 그대로
    St.setTarget({ ...T0, HEAL: 300 });       // 같은 값으로 다시 설정
    buildOf(c, opts);
    const st = S.memoStats();
    assert.equal(st.miss, 0, `다시 계산했다 (hit ${st.hit} / miss ${st.miss})`);
    assert.ok(st.hit > 0, "기억을 쓰지 않았다");
  } finally { St.setTarget(null); S.clearMemo(); }
});

test("[B3 수정] 회복량 말고 다른 상대 값이 같으면 열쇠가 그대로여야 한다 (과잉 무효화 아님)", () => {
  const c = champ("Galio"), opts = { aram: true, enemyMagic: 0.5 };
  try {
    S.clearMemo(); St.setTarget({ ...T0, HEAL: 0 });
    const a = buildOf(c, opts);
    St.setTarget({ ...T0, HEAL: 450 });
    buildOf(c, opts);
    S.memoStats(true);
    St.setTarget({ ...T0, HEAL: 0 });         // 처음 값으로 되돌림 → 첫 결과가 기억에 남아 있어야 한다
    const back = buildOf(c, opts);
    const st = S.memoStats();
    assert.equal(back, a, "되돌렸는데 결과가 다르다");
    assert.equal(st.miss, 0, `되돌렸는데 다시 계산했다 (hit ${st.hit} / miss ${st.miss})`);
  } finally { St.setTarget(null); S.clearMemo(); }
});
