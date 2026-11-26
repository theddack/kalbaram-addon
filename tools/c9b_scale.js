// v0.1.95 Phase 4 C9-B 설계용 크기 재기: 저항 감소를 '아군 몫' 까지 세면 얼마나 커지는가.
//   node tools/c9b_scale.js
// 왜: 아군 4명의 피해 증가량을 그대로 더하면 내 개인 지표(한타 피해)를 압도할 수 있다.
//     점수에 넣기 전에 크기부터 잰다 (가중치는 건드리지 않는다).
// 재는 법: 저항 감소가 있을 때와 없을 때, 그 상대를 때리는 사람의 '방어 적용 뒤 피해' 차이.
//   아군 피해는 그 아군 자신의 관통으로 계산한다 (내 관통이 아니다).
const path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const St = require(W + "stats.js");
global.Stats = St;
const S = require(W + "scoring.js");
const d = require(W + "data.json");
S.attachSimilar(d.champions, null, d.items);
const OPTS = { aram: true };
const champ = (id) => d.champions.find((c) => c.id === id);
const item = (n) => d.items.find((i) => i.name === n);
const aug = (id) => d.augments.find((a) => a.id === id);
const FIGHT = 6;  // AUTO_FIGHT_SEC
const r1 = (x) => Math.round(x * 10) / 10;

// 그 사람이 '깎인 상대' 를 때릴 때 늘어나는 피해 (초당). 자기 관통은 자기 것으로 계산한다
function gainOf(c, level, items, shred) {
  const cs = St.computeStats(c, level, items, [], OPTS);
  const t = cs.total;
  const m = St.evaluate(c, level, items, [], OPTS).m;
  const mix = (() => {
    const BIG = 1e6, saved = { ...St.DEFAULT_TARGET };
    // 기준 상대 값은 먼저 붙잡아 둔다 — 재는 동안 TARGET 이 바뀌므로 St.TARGET 을 다시 읽으면 BIG 가 들어온다
    const A = St.TARGET.ARMOR, M = St.TARGET.MR;
    const at = (a, mr) => { St.setTarget({ ARMOR: a, MR: mr, HP: saved.HP }); const r = St.evaluate(c, level, items, [], OPTS).m; return r.autoDps + r.skillDps; };
    const all = at(A, M), tr = at(BIG, BIG);
    const phys = Math.max(0, at(A, BIG) - tr), mag = Math.max(0, at(BIG, M) - tr);
    St.setTarget(null);
    const sum = phys + mag + tr;
    return { all, phys: sum ? phys / sum : 0, mag: sum ? mag / sum : 0, tr: sum ? tr / sum : 0 };
  })();
  const dps = m.autoDps + m.skillDps;
  const pm0 = St.mitigation(St.TARGET.ARMOR, t.ARPEN, t.LETHALITY, 0, 0);
  const pm1 = St.mitigation(St.TARGET.ARMOR, t.ARPEN, t.LETHALITY, shred.armorShred || 0, shred.armorFlatShred || 0);
  const mm0 = St.mitigation(St.TARGET.MR, t.MPENP, t.MPEN, 0, 0);
  const mm1 = St.mitigation(St.TARGET.MR, t.MPENP, t.MPEN, shred.mrShred || 0, shred.mrFlatShred || 0);
  // 고정 피해(tr)에는 저항 감소가 걸리지 않는다
  const up = mix.phys * (pm1 / pm0 - 1) + mix.mag * (mm1 / mm0 - 1);
  return { dps, up, add: dps * up * FIGHT, mix };
}

console.log("=== 1. 저항 감소를 들었을 때 '내' 몫과 '아군 4명' 몫 (18레벨 · 한타 6초)");
const TEAMS = {
  "물리 중심 (진·베인·가렌·리신)": [["Jhin", ["광전사의 군화", "무한의 대검", "정수 약탈자"]], ["Vayne", ["버서커", "크라켄 학살자"]],
    ["Garen", ["판금 장화", "삼위일체"]], ["LeeSin", ["판금 장화", "삼위일체"]]],
  "마법 중심 (룩스·애니·브랜드·카서스)": [["Lux", ["마법사의 신발", "루덴의 메아리"]], ["Annie", ["마법사의 신발", "라바돈의 죽음모자"]],
    ["Brand", ["마법사의 신발", "리안드리의 고통"]], ["Karthus", ["마법사의 신발", "루덴의 메아리"]]],
  "혼합 (진·룩스·가렌·소나)": [["Jhin", ["광전사의 군화", "무한의 대검"]], ["Lux", ["마법사의 신발", "루덴의 메아리"]],
    ["Garen", ["판금 장화", "삼위일체"]], ["Sona", ["명석함의 아이오니아 장화", "구원"]]],
};
const fix = (list) => list.map(([id, names]) => [champ(id), names.map(item).filter(Boolean)]).filter(([c]) => c);
for (const [who, items, augs] of [["Garen", ["칠흑의 양날 도끼"], []], ["Lux", ["악의"], []], ["Lux", [], ["ARAM_Erosion"]]]) {
  const me = champ(who);
  const as = augs.length ? S.augStatsOf(augs.map(aug).filter(Boolean), d.rules, me) : [];
  const mm = St.evaluate(me, 18, items.map(item).filter(Boolean), as, OPTS).m;
  const shred = mm.shred;
  const label = [...items, ...augs.map((a) => (aug(a) || {}).name)].join("+");
  console.log(`\n[${who} + ${label}] 감소: 방어력 ${r1(shred.armorShred * 100)}% · 마저 ${r1(shred.mrShred * 100)}% · 고정 마저 ${r1(shred.mrFlatShred)}`);
  console.log(`  내 한타 피해 ${Math.round(mm.combo)} · 내 초당 ${Math.round(mm.dps)}`);
  for (const [name, list] of Object.entries(TEAMS)) {
    let add = 0, det = [];
    for (const [c, bag] of fix(list)) {
      const g = gainOf(c, 18, bag, shred);
      add += g.add;
      det.push(`${c.name} +${Math.round(g.add)}`);
    }
    console.log(`  아군 4명(${name}) 한타 동안 더 넣는 피해 ${Math.round(add)} = 내 한타 피해의 ${r1(add / mm.combo * 100)}% · ${det.join(" · ")}`);
  }
}

console.log("\n=== 2. 지금 쓰는 기준 아군(ALLY) 하나로 셀 때와 실제 아군을 셀 때");
{
  const me = champ("Garen");
  const shred = St.evaluate(me, 18, [item("칠흑의 양날 도끼")], [], OPTS).m.shred;
  const A = St.ALLY;
  const pm0 = St.mitigation(St.TARGET.ARMOR, 0, 0, 0, 0), pm1 = St.mitigation(St.TARGET.ARMOR, 0, 0, shred.armorShred, shred.armorFlatShred);
  const allyPhys = 0.987;  // 기준 아군(원딜 29명 중앙값)의 물리 비중
  const one = (A.autoDps + A.skillDps) * allyPhys * (pm1 / pm0 - 1) * FIGHT;
  console.log(`  기준 아군 1명: +${Math.round(one)} · 4명이면 +${Math.round(one * 4)} (지금 회복·보호막과 같은 '아군 1명' 규칙이면 +${Math.round(one)})`);
  console.log(`  ※ 기준 아군은 물리 98.7% 라 마법 저항력 감소(핏빛 저주·악의)는 거의 0 이 된다 — 실제 아군이 메이지면 정반대다`);
}

console.log("\n=== 3. 아군이 이미 같은 효과를 들고 있을 때 (겹침)");
{
  const me = champ("Garen");
  const shred = St.evaluate(me, 18, [item("칠흑의 양날 도끼")], [], OPTS).m.shred;
  const ally = champ("Jhin");
  const allyShred = St.evaluate(ally, 18, [item("칠흑의 양날 도끼")], [], OPTS).m.shred;
  const both = 1 - (1 - shred.armorShred) * (1 - allyShred.armorShred);
  console.log(`  나 ${r1(shred.armorShred * 100)}% · 아군도 칠흑 ${r1(allyShred.armorShred * 100)}% → 같이 ${r1(both * 100)}% (곱해서 쌓인다)`);
  console.log(`  내가 더해 주는 몫 = 같이(${r1(both * 100)}%) − 아군 혼자(${r1(allyShred.armorShred * 100)}%) = ${r1((both - allyShred.armorShred) * 100)}%p`
    + ` → 아군이 이미 들고 있으면 내 기여가 ${r1((1 - (both - allyShred.armorShred) / shred.armorShred) * 100)}% 줄어든다`);
}
