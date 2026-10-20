// 증강 ↔ 아이템 연계·충돌을 규칙 전체로 점검한다 (예시 하나가 아니라 규칙에 적힌 것 모두).
// '다음 구매' 순서는 화면과 같은 tools/rec_baseline.js rankRows (rankItems → 연계 표시 → tieOrder 근거)
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../tools/rec_baseline.js");
const S = require("../web/scoring.js");

const d = R.load();
S.attachSimilar(d.champions, null, d.items);
const champ = (id) => d.champions.find((c) => c.id === id);
const aug = (id) => d.augments.find((a) => a.id === id);
const rule = (a) => (d.rules.augments || {})[a.id] || {};
const TYPES = ["Jinx", "Lux", "Malphite", "Garen", "Kayle"];  // 원딜·마법사·탱커·전사·혼합
// 충돌 또는 이미 조건을 못 맞춤(D · 조건 없음: 지형이 없는 럭스의 '지형 생성됨', 근접이 된 뒤의 조준경)
const conflictOrUnmet = (t) => (t.link && t.link.kind === "conflict") || (t.tier === "D" && t.reasons.includes("조건 없음"));
const unmet = (a, c) => (a.eligible && !a.eligible.includes(c.id))
  || (rule(a).requires && !(S.withChosenFeatures(c, [a], d.rules).features || []).includes(rule(a).requires));

test("아이템이 필요한 증강(규칙 items)은 어느 챔피언이든 그 아이템이 '다음 구매' 목록에 남고 근거 1순위(필요)로 표시", () => {
  const augs = d.augments.filter((a) => (rule(a).items || []).length && !a.category);
  assert.ok(augs.length >= 10);
  const legendary = new Set(d.items.map((i) => i.name));
  for (const a of augs) for (const id of TYPES) {
    const c = champ(id);
    if (unmet(a, c)) continue;
    const wanted = rule(a).items.filter((n) => legendary.has(n));
    if (!wanted.length) continue;
    const { rows, prio } = R.rankRows(d, c, [a], []);
    const hit = rows.filter((r) => wanted.includes(r.item.name));
    assert.ok(hit.length, `${id}+${a.name}: ${wanted.join("/")} 가 목록에 없음`);
    assert.ok(hit.every((r) => prio(r) === 0), `${id}+${a.name}: 필요 아이템이 근거 1순위가 아님`);
    // 몰빵 빌드에도 하나는 들어간다 (증강 효과를 내려면 그 아이템이 있어야 해서)
    const b = S.buildConcepts(d.items, S.profile(c, d.tags), [a], [], d.rules, c, { aram: true }, ["augment"])[0];
    assert.ok(b.pick.some((p) => wanted.includes(p.item.name)), `${id}+${a.name}: 몰빵 빌드에 ${wanted.join("/")} 없음`);
  }
});

test("환산 증강: 공격력→주문력(물리 챔피언)·주문력→공격력(마법 챔피언)이면 환산된 쪽 아이템을 반대 유형으로 밀지 않는다", () => {
  const cases = [["ARAM_ADAPt", "Jinx", "AP"], ["ARAM_escAPADe", "Lux", "AD"]];
  for (const [aid, cid, to] of cases) {
    const a = aug(aid), c = champ(cid);
    assert.ok(a && (rule(a).convert || {}), aid);
    const rows = S.rankItems(d.items, S.profile(c, d.tags), [a], [], d.rules, c, { aram: true }, "augment");
    const conv = rows.filter((r) => r.item.kind === "legendary" && ((r.item.tags || {})[to] || 0) >= 0.5);
    assert.ok(conv.length && conv.every((r) => !r.offType), `${cid}+${a.name}: ${to} 아이템이 반대 유형으로 밀림`);
    // 증강 없으면 그대로 민다 (환산 때문에만 풀린다)
    const plain = S.rankItems(d.items, S.profile(c, d.tags), [], [], d.rules, c, { aram: true });
    assert.ok(plain.some((r) => r.offType && ((r.item.tags || {})[to] || 0) >= 0.5), `${cid}: 증강 없을 땐 ${to} 아이템을 민다`);
  }
});

test("충돌: 궁극기 봉인(기본으로 돌아가기)을 골랐으면 궁극기 효과 증강은 전부 '효과 충돌'", () => {
  const sealer = d.augments.find((a) => (rule(a).zero || []).includes("ULT"));
  const c = champ("Lux");
  const tiers = S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), [sealer], [], d.rules, c, { aram: true });
  const ult = d.augments.filter((a) => a.id !== sealer.id && tiers[a.id]
    && (((rule(a).tags || a.tags || {}).ULT || 0) >= 0.6));
  assert.ok(ult.length >= 2, "궁극기 증강이 여러 개");
  for (const a of ult) {
    const t = tiers[a.id];
    assert.ok(conflictOrUnmet(t), `${a.name}: 충돌 아님`);
    assert.ok(t.reasons.includes("충돌") || t.tier === "D", `${a.name}: 등급에 충돌이 반영 안 됨`);
  }
});

test("충돌: 근접 전환(검을 뽑아라)을 골랐으면 원거리 전용 증강(조준경)은 전부 '효과 충돌'", () => {
  const melee = d.augments.find((a) => ((rule(a).setsFeatures || {}).add || []).includes("melee"));
  const c = champ("Jinx");
  const tiers = S.augmentTiers(d.augments, d.items, S.profile(c, d.tags), [melee], [], d.rules, c, { aram: true });
  const ranged = d.augments.filter((a) => rule(a).requires === "ranged" && tiers[a.id]);
  assert.ok(ranged.length >= 3);
  for (const a of ranged) assert.ok(conflictOrUnmet(tiers[a.id]) && tiers[a.id].tier === "D", a.name);
});

test("연계 표시(🔗)는 그 증강 때문에 점수가 오른 아이템에만: 증강을 빼면 같은 아이템 점수가 낮다", () => {
  for (const id of ["Jinx", "Lux", "Garen"]) {
    const c = champ(id);
    const w = S.profile(c, d.tags);
    const tiers = S.augmentTiers(d.augments, d.items, w, [], [], d.rules, c, { aram: true });
    const top = d.augments.filter((a) => tiers[a.id] && tiers[a.id].basis === "수치" && a.rarity === 1)
      .sort((x, y) => tiers[x.id].rank - tiers[y.id].rank)[0];
    const syn = S.itemSynergy(d.items, w, [top], [], d.rules, c, { aram: true });
    const { rows } = R.rankRows(d, c, [top], []);
    const linked = rows.filter((r) => r.synergy && !(rule(top).items || []).includes(r.item.name));
    for (const r of linked) assert.ok(syn[r.item.id].delta > 0, `${id}+${top.name}: ${r.item.name} 연계인데 증강 효과로 오르지 않음`);
  }
});

// 2026-10-20: 연계 점수가 기준 차이(몰빵 vs 균형)를 증강 효과로 잡아 평타 증강에 공격 속도 아이템이 깎이고 라바돈이 연계로 나왔다
test("평타 강화 증강(기본 공격마다 터지는 효과, 주문력 계수 없음)은 공격 속도 아이템 연계 점수를 깎지 않는다", () => {
  const c = champ("Jinx");
  const w = S.profile(c, d.tags);
  const as = d.items.find((i) => i.name === "고속 연사포");
  const augs = d.augments.filter((a) => (a.effects || []).some((e) => ["onhit", "attacks"].includes(e.trigger.type))
    && !(a.effects || []).some((e) => e.ratios && e.ratios.AP) && !unmet(a, c));
  assert.ok(augs.length >= 3, augs.map((a) => a.name).join(","));
  for (const a of augs) {
    const syn = S.itemSynergy(d.items, w, [a], [], d.rules, c, { aram: true });
    assert.ok(syn[as.id].delta > -0.25, `${a.name}: 고속 연사포 ${syn[as.id].delta.toFixed(2)}`);
  }
});

test("스킬 강화 증강(스킬마다 터지는 효과)은 마법사의 스킬 가속·주문력 아이템 연계 점수를 깎지 않는다", () => {
  const c = champ("Lux");
  const w = S.profile(c, d.tags);
  const augs = d.augments.filter((a) => (a.effects || []).some((e) => e.trigger.type === "cast") && !unmet(a, c));
  assert.ok(augs.length >= 3);
  for (const a of augs) {
    const syn = S.itemSynergy(d.items, w, [a], [], d.rules, c, { aram: true });
    for (const name of ["라바돈의 죽음모자", "쇼진의 창"]) {
      const it = d.items.find((i) => i.name === name);
      assert.ok(syn[it.id].delta > -0.25, `${a.name}: ${name} ${syn[it.id].delta.toFixed(2)}`);
    }
  }
});

test("생존형 증강 두 개: 같은 효과를 두 번 세지 않는다 (같이 고른 이득 ≤ 따로 고른 이득의 합)", () => {
  const c = champ("Malphite");
  const w = S.profile(c, d.tags);
  const surv = d.augments.filter((a) => a.rarity === 1 && !unmet(a, c)
    && (a.effects || []).some((e) => ["heal", "shield"].includes(e.kind))).slice(0, 6);
  assert.ok(surv.length >= 2);
  const gain = (chosen, a) => S.numericAugmentGains([a], d.items, w, chosen, [], d.rules, c, { aram: true }).gains[a.id];
  for (let i = 0; i + 1 < surv.length; i += 2) {
    const [a, b] = [surv[i], surv[i + 1]];
    const alone = gain([], b), withA = gain([a], b);
    if (!alone || !withA) continue;
    assert.ok(withA.gain <= alone.gain * 1.05 + 1e-6, `${a.name} + ${b.name}: 같이 ${withA.gain.toFixed(3)} > 따로 ${alone.gain.toFixed(3)}`);
  }
});
