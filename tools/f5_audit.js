// v0.1.95 Phase 4 F5: 초당 피해에서 빠지는 스킬 23개를 하나씩 뜯어본다 (조사 전용, 계산은 바꾸지 않는다).
//   node tools/f5_audit.js            — 표 전체
//   node tools/f5_audit.js 카서스      — 한 명만 (이름 일부)
//
// 왜 필요한가: web/stats.js 는 `if (cdBase > 0.5) out.skillDps += dmg / max(cd, 0.5)` 로 초당 피해를 쌓는다.
//   뜻은 "징크스 Q 무기 바꾸기처럼 토글·전환형은 초당 피해에서 뺀다" 인데,
//   데이터의 재사용 대기시간이 0 인 스킬(카서스 Q 같은 충전형)까지 같이 빠진다.
//   쿨타임을 임의로 채우면 안 되므로, 스킬마다 '왜 0 인지' 를 게임 원본 값으로 가린다.
//
// 무엇을 근거로 가르는가 (전부 게임 데이터 파일의 값이다, 짐작이 아니다):
//   · mMaxAmmo + mAmmoRechargeTime  → 충전형. 오래 싸울 때의 발동 간격은 '충전 1개가 차는 시간' 이다
//   · bIsToggleSpell / Trait_Toggle → 토글형. 켜 두는 것이라 '한 번 쓰는 피해' 가 아니다
//   · PositiveEffect_EmpowerAttack / Trait_AttackReset → 평타 강화형. 피해는 기본 공격을 타고 들어간다
//   · Trait_PassiveSlot             → 패시브 칸 (스킬 칸에 있지만 쓰는 스킬이 아니다)
//   · Trait_NoCooldown              → 게임이 스스로 '재사용 대기시간 없음' 이라고 표시한 스킬
// 게임 데이터 파일(.cache/bins)이 없으면 그 칸은 '(캐시 없음)' 으로 비워 두고 나머지만 찍는다.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const W = path.join(ROOT, "web");
global.Stats = require(path.join(W, "stats.js"));
const S = require(path.join(W, "scoring.js"));
const d = require(path.join(W, "data.json"));
S.attachSimilar(d.champions, null, d.items);
const St = global.Stats;
const CACHE = path.join(ROOT, ".cache");
const KINDS = ["physical", "magic", "true"];
const only = process.argv[2];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}
// .cache/bins/<Cid>.bin.json 에서 스킬 레코드 찾기 (champion_data.find_spell 과 같은 방식)
function findSpell(bin, id) {
  if (!bin) return null;
  const suffix = "/" + String(id).toLowerCase();
  for (const [k, v] of Object.entries(bin)) {
    if (v && typeof v === "object" && v.__type === "SpellObject" && k.toLowerCase().endsWith(suffix)) {
      return v.mSpell || {};
    }
  }
  return null;
}
function gameInfo(cid, slot) {
  const dd = readJson(path.join(CACHE, "champion", cid + ".json"));
  const bin = readJson(path.join(CACHE, "bins", cid + ".bin.json"));
  if (!dd || !bin) return null;
  const i = "QWER".indexOf(slot);
  const sp = ((dd.data || {})[cid] || {}).spells || [];
  if (!sp[i]) return null;
  const g = findSpell(bin, sp[i].id) || {};
  return {
    id: sp[i].id,
    ddCd: sp[i].cooldown,
    maxAmmo: g.mMaxAmmo || null,
    ammoRecharge: g.mAmmoRechargeTime || null,
    toggle: !!g.bIsToggleSpell,
    cooldownTime: g.cooldownTime || null,
    tags: g.mSpellTags || [],
  };
}
// 발동 구조 분류 — 게임 값만 본다. 여러 쪽에 걸리면 모두 적는다 (사람이 마지막으로 가린다)
function classify(gi) {
  if (!gi) return ["(캐시 없음)"];
  const t = gi.tags || [];
  const out = [];
  if (gi.toggle || t.includes("Trait_Toggle")) out.push("토글형");
  if (gi.maxAmmo && gi.ammoRecharge) out.push("충전형");
  if (t.includes("PositiveEffect_EmpowerAttack") || t.includes("Trait_AttackBuff_Duration")) out.push("평타 강화형");
  if (t.includes("Trait_PassiveSlot")) out.push("패시브 칸");
  if (t.includes("Trait_DoT")) out.push("지속 피해");
  if (!out.length) out.push(t.includes("Trait_NoCooldown") ? "쿨 없음(게임 표시)" : "분류 근거 없음");
  return out;
}

const rows = [];
for (const c of d.champions) {
  if (only && !c.name.includes(only) && c.id !== only) continue;
  let build = [];
  try {
    build = S.buildConcepts(d.items, S.profile(c, d.tags), [], [], d.rules, c, {}, ["balanced"])[0].pick.map((p) => p.item);
  } catch { build = []; }
  const m = St.evaluate(c, 18, build, [], {}).m;
  for (const sp of c.spells) {
    const cd = (sp.cooldown || [0])[0] || 0;
    const dmgEff = (sp.effects || []).filter((e) => KINDS.includes(e.kind));
    if (!dmgEff.length || cd > 0.5) continue;
    const sm = (m.spells || []).find((x) => x.slot === sp.slot) || {};
    const gi = gameInfo(c.id, sp.slot);
    rows.push({
      champ: c.name, cid: c.id, slot: sp.slot, name: sp.name, cd: sp.cooldown,
      dmg: sm.dmg || 0, onhit: sm.onhit || 0,
      // 엔진이 실제로 남긴 값 (대안 효과는 spellPlan 이 하나만 남긴다 — 중복 합산 확인용)
      kept: (sm.values || []).filter((v) => KINDS.includes(v.kind)).map((v) => `${v.name}${v.onhit ? "(적중)" : ""} ${Math.round(v.value)}${v.kind[0]}`),
      raw: dmgEff.map((e) => e.name),
      combo: m.combo || 0, skillDps: m.skillDps || 0, autoDps: m.autoDps || 0,
      gi, cls: classify(gi),
    });
  }
}

console.log("=== F5: 초당 피해에서 빠지는 스킬 (18레벨 균형 빌드, 증강 없음)");
console.log(`빠진 스킬 ${rows.length}개 / 챔피언 ${new Set(rows.map((r) => r.cid)).size}명\n`);
for (const r of rows) {
  const gi = r.gi || {};
  console.log(`${r.champ} ${r.slot} ${r.name}  [${r.cls.join(" + ")}]`);
  console.log(`   데이터 쿨 ${JSON.stringify(r.cd.slice(0, 3))}` +
    (gi.ammoRecharge ? ` · 충전 ${JSON.stringify(gi.maxAmmo)}개, 1개 차는 데 ${JSON.stringify(gi.ammoRecharge)}초` : "") +
    (gi.toggle ? " · 토글" : ""));
  console.log(`   한 번 피해 ${Math.round(r.dmg)} (평타 적중 몫 ${Math.round(r.onhit)}) · 남은 값 ${r.kept.join(" / ") || "없음"}`);
  if (r.raw.length > r.kept.length) console.log(`   원본 효과 ${r.raw.length}개 중 ${r.kept.length}개만 셈 (대안 효과는 큰 쪽 하나만)`);
  console.log(`   이 챔피언: 콤보 ${Math.round(r.combo)} · 초당 스킬 ${Math.round(r.skillDps)} · 초당 평타 ${Math.round(r.autoDps)}`);
  if (gi.tags && gi.tags.length) console.log(`   게임 표시: ${gi.tags.join(", ")}`);
  console.log("");
}
const byCls = {};
for (const r of rows) for (const c of r.cls) (byCls[c] = byCls[c] || []).push(`${r.champ} ${r.slot}`);
console.log("--- 분류별");
for (const [k, v] of Object.entries(byCls).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k} ${v.length}개: ${v.join(" · ")}`);
}
