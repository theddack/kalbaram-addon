// v0.1.95 Phase 5A P0 확인: 이번에 넣은 아이템 효과 8개가 '원본대로' 계산에 들어갔는지 하나씩 본다.
//   node tools/p5a_p0_check.js
// 계산 결과끼리의 대조예요. 실제 게임 결과가 아니에요.
const path = require("path");
const ROOT = path.join(__dirname, "..");
const St = require(path.join(ROOT, "web", "stats.js"));
const R = require(path.join(ROOT, "tools", "rec_baseline.js"));
const S = require(path.join(ROOT, "web", "scoring.js"));
const d = R.load();
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (n) => d.items.find((i) => i.name === n);
const ev0 = (c, items, augs = []) => St.evaluate(c, 18, items, augs, { aram: true });
// 증강은 scoring.augStatsOf 로 풀어서 넣는다 (tests/calc.test.js 와 같은 방법)
const ev = (c, items, augs = []) => { const r = St.evaluate(c, 18, items, S.augStatsOf(augs, d.rules, c), { aram: true }); return { t: r.stats.total, m: r.m }; };
const r2 = (x) => Math.round(x * 100) / 100;
let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  OK  " : "  틀림"} ${msg}`); if (!cond) bad++; };
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * tol);

console.log("== 1. 스테락의 도전 — 기본 공격력과 추가 공격력 구분 ==");
{
  const c = champ("Garen"), st = item("스테락의 도전"), ruby = item("워모그의 갑옷");
  const a = ev(c, []).t, b = ev(c, [st]).t;
  const baseAD = a.baseAD;
  console.log(`  가렌 18레벨 기본 공격력 ${r2(baseAD)} · 맨몸 공격력 ${r2(a.AD)} → 스테락 ${r2(b.AD)}`);
  ok(near(b.AD - a.AD, baseAD * 0.5), `늘어난 공격력 ${r2(b.AD - a.AD)} = 기본 공격력의 50% ${r2(baseAD * 0.5)}`);
  ok(near(b.baseAD, baseAD), "기본 공격력(baseAD)은 그대로 — 늘어난 몫은 추가 공격력으로만 들어간다");
  // 기준이 '기본 공격력'이라, 추가 공격력을 더 사도 스테락 몫은 안 커진다 (서로 다시 키우지 않는다)
  const c1 = ev(c, [st]).t, c2 = ev(c, [st, item("무한의 대검")]).t, c3 = ev(c, [item("무한의 대검")]).t;
  ok(near(c2.AD - c3.AD, c1.AD - a.AD), `다른 공격력 아이템을 더 사도 스테락 몫은 같다 (${r2(c1.AD - a.AD)} ↔ ${r2(c2.AD - c3.AD)})`);
  const m = ev(c, [st]).m;
  ok(m.combo > ev(c, []).m.combo, "한타 피해가 늘어난다");
}

console.log("== 2. 마나무네 — 최대 마나 기준 / 대천사는 추가 마나 기준 ==");
{
  const c = champ("Ryze");             // 마나 챔피언
  const nm = item("마나무네"), ar = item("대천사의 지팡이");
  const a = ev(c, []).t, b = ev(c, [nm]).t;
  console.log(`  라이즈 맨몸 최대 마나 ${r2(a.MANA)} → 마나무네 ${r2(b.MANA)} (추가 ${r2(b.bonusMANA)})`);
  ok(near(b.AD - a.AD - nm.stats.AD, b.MANA * 0.02, 0.05), `늘어난 공격력에서 아이템 공격력 ${nm.stats.AD} 를 뺀 몫 ${r2(b.AD - a.AD - nm.stats.AD)} = 최대 마나의 2% ${r2(b.MANA * 0.02)}`);
  const ab = ev(c, [ar]).t;
  // 라이즈는 주문력으로 최대 마나가 또 늘어나서, 비교는 '아이템이 준 마나'로 한다 (엔진도 그 시점 값으로 센다)
  ok(near(ab.AP - a.AP - ar.stats.AP, ar.stats.MANA * 0.01, 0.05), `대천사는 '추가' 마나 1% → 주문력 ${r2(ab.AP - a.AP - ar.stats.AP)} ↔ ${r2(ar.stats.MANA * 0.01)}`);
  const noMana = ev(champ("Garen"), [nm]).t, noBase = ev(champ("Garen"), []).t;
  ok(near(noMana.AD - noBase.AD, nm.stats.AD), "마나가 없는 챔피언(가렌)은 경탄 몫이 0");
}

console.log("== 3. 혹한의 손길 — 추가 최대 마나의 15% 체력 ==");
{
  const c = champ("Ryze"), fh = item("혹한의 손길");
  const a = ev(c, []).t, b = ev(c, [fh]).t;
  const want = fh.stats.HP + b.bonusMANA * 0.15;
  console.log(`  라이즈 맨몸 체력 ${r2(a.HP)} → 혹한의 손길 ${r2(b.HP)} (아이템 체력 ${fh.stats.HP} + 추가 마나 ${r2(b.bonusMANA)} 의 15%)`);
  ok(near(b.HP - a.HP, want, 0.01), `늘어난 체력 ${r2(b.HP - a.HP)} = ${r2(want)}`);
  ok(near(b.bonusMANA, fh.stats.MANA), "'추가' 마나 기준이라 챔피언 기본 마나는 안 센다");
}

console.log("== 4. 아트마의 심판 — 추가 체력 기준 · 상한 30% · 증강 연계 ==");
{
  const c = champ("Garen"), at = item("아트마의 심판"), wm = item("워모그의 갑옷");
  const a = ev(c, []).t, b = ev(c, [at]).t;
  const addCrit = b.CRIT - a.CRIT - at.stats.CRIT;
  console.log(`  가렌 + 아트마: 추가 체력 ${r2(b.bonusHP)} · 치명타 ${r2(a.CRIT * 100)}% → ${r2(b.CRIT * 100)}% (아이템 ${at.stats.CRIT * 100}% + 큰손 ${r2(addCrit * 100)}%)`);
  ok(near(addCrit, Math.min(0.3, b.bonusHP * 0.0001), 0.02), `큰손 몫 = min(30%, 추가 체력 ${r2(b.bonusHP)} × 0.01%) = ${r2(Math.min(0.3, b.bonusHP * 0.0001) * 100)}%`);
  // 체력을 아주 많이 쌓으면 30% 에서 멈춘다
  const big = ev(c, [at, wm, item("워모그의 갑옷"), item("망자의 갑옷"), item("강철심장"), item("태양불꽃 방패")]).t;
  const bigAdd = big.CRIT - ev(c, [wm, item("워모그의 갑옷"), item("망자의 갑옷"), item("강철심장"), item("태양불꽃 방패")]).t.CRIT - at.stats.CRIT;
  ok(big.bonusHP * 0.0001 > 0.3 ? near(bigAdd, 0.3, 0.03) : true, `추가 체력 ${r2(big.bonusHP)} 일 때 큰손 몫 ${r2(bigAdd * 100)}% (상한 30%)`);
  ok(big.CRIT <= 1.0001, "전체 치명타 확률은 100% 를 넘지 않는다");
  // 증강 연계: 보석 건틀릿(주문력 → 치명타)과 같이 들어가도 서로 덮어쓰지 않는다
  const gem = d.augments.find((x) => x.name === "보석 건틀릿");
  if (gem) {
    const lx = champ("Lux");
    const g0 = ev(lx, [at, item("라바돈의 죽음모자")], [gem]).t, g1 = ev(lx, [at, item("라바돈의 죽음모자")]).t;
    ok(g0.CRIT > g1.CRIT, `보석 건틀릿과 함께: ${r2(g1.CRIT * 100)}% → ${r2(g0.CRIT * 100)}% (둘 다 더해진다)`);
  }
}

console.log("== 5. 히드라 계열 쪼개기 — 근접·원거리 계수 ==");
{
  const hyd = ["굶주린 히드라", "발걸음 분쇄기", "불경한 히드라"];
  for (const n of hyd) {
    const it = item(n);
    const melee = ev(champ("Garen"), [it]).m, mBase = ev(champ("Garen"), []).m;
    const ranged = ev(champ("Jinx"), [it]).m, rBase = ev(champ("Jinx"), []).m;
    const fx = (m) => (m.effects || []).filter((e) => /Cleave/i.test(e.src || "") || e.src === n);
    const mv = fx(melee).reduce((a, e) => a + (e.value || 0), 0), rv = fx(ranged).reduce((a, e) => a + (e.value || 0), 0);
    console.log(`  ${n}: 근접(가렌) 쪼개기 한 대 ${r2(mv)} · 원거리(징크스) ${r2(rv)}`);
    ok(mv > 0 && rv > 0, `${n} 쪼개기가 계산에 들어간다`);
    ok(near(mv, ev(champ("Garen"), [it]).t.AD * 0.4, 0.03), `${n} 근접 계수 40% 공격력`);
    ok(near(rv, ev(champ("Jinx"), [it]).t.AD * 0.2, 0.03), `${n} 원거리 계수 20% 공격력`);
    ok(melee.combo > mBase.combo && ranged.combo > rBase.combo, `${n} 한타 피해가 늘어난다`);
  }
  ok(new Set(hyd.map((n) => item(n).limit)).size === 1 && item("굶주린 히드라").limit === "Hydra",
    "셋 다 같은 고유 효과 계열(Hydra) — 두 개를 같이 추천하지 않는다");
}

console.log("== 6. 악의 — 궁극기 가속만, 일반 스킬 가속에는 안 들어간다 ==");
{
  const c = champ("Lux"), mal = item("악의");
  const a = ev(c, []).m, b = ev(c, [mal]).m;
  console.log(`  럭스 맨몸 가속 기본 ${r2(a.haste.basic)} / 궁극기 ${r2(a.haste.ult)} → 악의 기본 ${r2(b.haste.basic)} / 궁극기 ${r2(b.haste.ult)}`);
  ok(near(b.haste.basic - a.haste.basic, mal.stats.HASTE, 0.01), `기본 스킬 가속은 아이템 스킬 가속 ${mal.stats.HASTE} 만 늘었다 (궁극기 가속 20 이 섞이지 않는다)`);
  ok(near(b.haste.ult - a.haste.ult, mal.stats.HASTE + 20, 0.01), `궁극기 가속은 ${mal.stats.HASTE} + 20 만큼 늘었다`);
}

console.log("== 7. 끝없는 절망 — 입힌 피해의 250% 자기 회복 ==");
{
  const c = champ("Garen"), ud = item("끝없는 절망");
  const a = ev(c, []).m, b = ev(c, [ud]).m;
  const row = (b.effects || []).find((e) => e.src === "끝없는 절망" && e.hit > 0);
  ok(!!row, "고뇌의 피해 줄이 있다");
  if (row) {
    const heal = b.itemSelfHeal - a.itemSelfHeal;
    console.log(`  고뇌 피해(방어 적용 후) ${r2(row.hit)} → 자기 회복 ${r2(heal)}`);
    ok(heal > 0, "자기 회복이 생겼다");
    ok(near(heal / row.hit, 2.5 * (1 + ev(c, [ud]).t.HSP), 0.03), `회복 ÷ 피해 = ${r2(heal / row.hit)} (250% × 회복 증폭)`);
  }
  ok(near(b.heal || 0, a.heal || 0), "아군에게 주는 회복(지원 지표)에는 안 들어간다");
  ok(b.selfHealAll > a.selfHealAll, "자기 회복 합(selfHealAll)에 들어간다 → 버티는 힘·상대 회복량 추정에도 따라온다");
  // 순환 참조: 두 번 계산해도 같은 값 (회복이 피해를 다시 키우지 않는다)
  const again = ev(c, [ud]).m;
  ok(near(again.itemSelfHeal, b.itemSelfHeal, 0) && near(again.combo, b.combo, 0), "두 번 계산해도 같다 (순환 참조 없음)");
  // 죽음의 순환(회복 → 피해)과 함께: 회복이 커진 만큼 피해도 커지지만 한 번만
  const dc = d.augments.find((x) => x.name === "죽음의 순환");
  if (dc) {
    const x0 = ev(c, [], [dc]).m, x1 = ev(c, [ud], [dc]).m;
    const dRow = (x1.effects || []).filter((e) => e.src === "회복 → 피해");
    ok(dRow.length === 1, `죽음의 순환 줄이 한 번만 생긴다 (${dRow.length}개)`);
    ok(x1.combo > x0.combo, "죽음의 순환과 함께 쓰면 한타 피해가 더 는다 (자기 회복이 늘었으므로)");
  }
}

console.log(bad ? `\n틀린 항목 ${bad}개` : "\n모두 통과");
process.exitCode = bad ? 1 : 0;
