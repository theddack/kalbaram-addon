// v0.1.95 재현 테스트 (수정 전에 먼저 작성): B1·B2·B3 가 지금 어떻게 틀리는지를 숫자로 고정해 둔다.
// 여기 적힌 값은 '지금 상태'다. Phase 2·3 에서 고치면 ⇒ 로 적힌 쪽으로 바뀌어야 하고, 그때 이 파일의 단언을 뒤집는다.
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

// ── B3: 캐시 열쇠에 상대 회복량(TARGET.HEAL)이 빠져 옛 결과가 남는다 ──────────────
test("[B3 재현] 상대 회복량만 바뀌면 빌드 계산이 옛 결과를 그대로 돌려준다", () => {
  const c = champ("Galio");
  const opts = { aram: true, enemyMagic: 0.5 }, T = { ARMOR: 170, MR: 65, HP: 3450 };
  const build = () => S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, opts, ["balanced"])[0].pick.map((p) => p.item.name).join(" / ");
  try {
    S.clearMemo(); St.setTarget({ ...T, HEAL: 0 });
    const low = build();
    St.setTarget({ ...T, HEAL: 450 });
    const stale = build();
    S.clearMemo();
    const fresh = build();
    assert.equal(stale, low, "회복량을 올렸는데 결과가 그대로다 (지금 상태)");
    assert.notEqual(fresh, low, "기억을 비우면 치유 감소 아이템이 들어온다");
    assert.ok(/모렐로노미콘/.test(fresh), `새로 계산한 빌드: ${fresh}`);
  } finally {
    St.setTarget(null); S.clearMemo();
  }
  // ⇒ Phase 3 후: memoKey 와 app.js 캐시 열쇠에 HEAL 이 들어가 stale !== low 가 된다.
});
