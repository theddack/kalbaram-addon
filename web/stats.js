// 능력치 계산 엔진: 챔피언 레벨별 기본 능력치 + 아이템 + 증강 → 최종 능력치 → 스킬 피해·평타 DPS·유효 체력.
// 화면(app.js)과 점수(scoring.js)가 같이 쓴다. node 로도 검증할 수 있게 UMD 형태.
(function (root) {
  const AS_CAP = 2.5;  // 소환사의 협곡 공속 상한 (증강 모드는 champ.modeStats.asCap = 5.0)
  const BASE_CRIT_DMG = 1.75;
  // 한타에서 평타를 이어 치는 시간 가정(초): 평타로 쌓는 중첩(구인수의 격노검)의 평균을 낼 때 (실게임 검증 필요).
  // 사람이 정한 값이에요. 4·8초로 바꾸면 결과가 바뀌는 챔피언은 docs/균형빌드_조사.md (통계 채용률에 맞추려고 조정하지 않는다)
  const AUTO_FIGHT_SEC = 6;
  const CLEAVE_RANGED = 0.5;  // 원거리 쪼개기 = 근접의 절반 (공격력 20% / 40%)
  const DMG_KINDS = ["magic", "physical", "true"];

  // 표시용 능력치 목록: [키, 이름, 소수점 자리, 비율(%) 여부]
  const ROWS = [
    ["HP", "체력", 0], ["AD", "공격력", 0], ["AP", "주문력", 0], ["AS", "공격 속도", 2],
    ["CRIT", "치명타 확률", 0, true], ["ARMOR", "방어력", 0], ["MR", "마법 저항력", 0],
    ["HASTE", "스킬 가속", 0], ["MS", "이동 속도", 0], ["MANA", "마나", 0],
    ["LETHALITY", "물리 관통력", 0], ["ARPEN", "방어구 관통력", 0, true],
    ["MPEN", "마법 관통력", 0], ["MPENP", "마법 관통력 %", 0, true],
    ["LS", "생명력 흡수", 0, true], ["OMNIVAMP", "모든 피해 흡혈", 0, true],
    ["HSP", "회복·보호막 효과", 0, true],
  ];

  // 레벨 성장: base + g × (L-1) × (0.7025 + 0.0175 × (L-1))
  const growth = (g, L) => g * (L - 1) * (0.7025 + 0.0175 * (L - 1));

  function baseStats(champ, L) {
    const s = champ.stats;
    return {
      HP: s.hp + growth(s.hpperlevel, L),
      MANA: s.mp + growth(s.mpperlevel, L),
      AD: s.attackdamage + growth(s.attackdamageperlevel, L),
      ARMOR: s.armor + growth(s.armorperlevel, L),
      MR: s.spellblock + growth(s.spellblockperlevel, L),
      MS: s.movespeed,
      AS: s.attackspeed,
      asLevelBonus: growth(s.attackspeedperlevel, L) / 100,
      RANGE: s.attackrange,
    };
  }

  function levelValue(v, L) {
    // 증강 수치가 {base, lvl:[1레벨, 18레벨]} 형태면 레벨 보간
    if (v && typeof v === "object" && "base" in v) {
      const b = v.base[0] || 0;
      return b + (v.lvl ? v.lvl[0] + (v.lvl[1] - v.lvl[0]) * (L - 1) / 17 : 0);
    }
    return v;
  }

  // 능력치 객체(아이템 stats·고유 효과·증강 statsResolved)의 [키, 값] 목록은 객체마다 한 번만 만든다 (읽기 전용 데이터라 결과가 같다.
  // 빌드 탐색이 계산마다 Object.entries 를 새로 만들던 몫이 계산 시간의 큰 부분이었다, 2026-11-14 v0.1.92 성능)
  const ENTRIES = new WeakMap();
  const entriesOf = (o) => {
    if (!o) return [];
    let e = ENTRIES.get(o);
    if (!e) ENTRIES.set(o, (e = Object.entries(o)));
    return e;
  };
  // 출처(src)를 붙인 효과 목록은 아이템·패시브마다 한 번만 만든다 (빌드 탐색에서 계산마다 복사하던 것. 읽기 전용으로 쓴다)
  const SRC_FX = new WeakMap();
  function withSrc(owner, src, isItem = false) {
    if (!owner || !owner.effects || !owner.effects.length) return [];
    let m = SRC_FX.get(owner);
    if (!m) SRC_FX.set(owner, (m = new Map()));
    let fx = m.get(src);
    if (!fx) m.set(src, (fx = owner.effects.map((e) => (isItem ? { ...e, src, item: true } : { ...e, src }))));
    return fx;
  }

  // 아이템·증강 능력치 합산 후 최종 능력치. augStats = 고른 증강들의 statsResolved 목록
  function computeStats(champ, L, items, augStats, opts = {}) {
    const base = baseStats(champ, L);
    // 칼바람 증강 모드 공통 능력치 (위키 'Global stat changes', build_data.mayhem_global_stats): 레벨 비례 기본 체력
    const ms = (opts.aram !== false && champ.modeStats) || {};
    if (ms.hp) base.HP += ms.hp[0] + (ms.hp[1] - ms.hp[0]) * (L - 1) / 17;
    const add = { HP: 0, AD: 0, AP: 0, ARMOR: 0, MR: 0, HASTE: 0, MANA: 0, LETHALITY: 0, MPEN: 0,
      MS: 0, AS: 0, CRIT: 0, CRITDMG: 0, MSP: 0, LS: 0, OMNIVAMP: 0, ARPEN: 0, MPENP: 0, HSP: 0 };
    // 관통력 %는 게임처럼 곱해서 합친다: 35% + 35% = 1 − 0.65 × 0.65 = 57.75% (더하면 70%로 과대평가해 세릴다·도미닉을 같이 권했다)
    const PCT_PEN = new Set(["ARPEN", "MPENP"]);
    const addTo = (k, v) => { add[k] = PCT_PEN.has(k) ? 1 - (1 - add[k]) * (1 - v) : add[k] + v; };
    for (const it of items) for (const [k, v] of entriesOf(it.stats)) if (k in add) addTo(k, v);
    const goldAug = augStats.reduce((a, s) => a + (Number((s || {}).goldValue) || 0), 0);
    if (goldAug) {
      const main = apMain(champ) ? "AP" : "AD";
      add[main] += goldAug * 0.5 / GOLD_VALUE[main];
      add.HP += goldAug * 0.3 / GOLD_VALUE.HP;
      add.ARMOR += goldAug * 0.1 / GOLD_VALUE.ARMOR;
      add.MR += goldAug * 0.1 / GOLD_VALUE.MR;
    }
    const mult = { HPmult: 0, ADmult: 0, APmult: 0, ASmult: 0, MSmult: 0, adaptiveMult: 0 };
    const flags = { dmgDealtMult: 0, skillDmgMult: 0, trueBonus: 0, ultHaste: 0, slotHaste: {}, slotDmg: {}, slotHeal: {}, noUlt: false };
    const conv = {};
    // 중첩형 패시브·스킬(베이가·쓰레쉬 등)의 게임 중반 평균 능력치도 항상 들어간다
    // 한타 기준 능력치·스킬 효과(징크스 미니건 3중첩, 베인 은화살 등 rules champions fight)는 추천 점수에만: 게임 중 지금 능력치 비교(opts.now)엔 넣지 않는다
    const fight = champ.fightStats && !(opts && opts.now) ? [champ.fightStats] : [];
    const mods = [...augStats, ...items.map((it) => it.passiveStats).filter(Boolean), ...(champ.stackStats ? [champ.stackStats] : []), ...fight];
    // 효과 출처: 챔피언 패시브, 아이템 고유 효과 (증강 효과는 augStats 의 _effects 로 들어온다)
    const effects = [...withSrc(champ.passive, "패시브")];
    for (const it of items) effects.push(...withSrc(it, it.name, true));
    // 쿨 반환(대마법사·노련한 저격수 등)은 증강마다 따로: 더하면 반환 30% + 80%, 확률 1 + 0.4 로 상한(90%)에 걸려
    // 스킬 가속 900 으로 계산됐다 (2026-10-20 피드백 #13: 대마법사 + 노련한 저격수 궁합 +365)
    const REFUND_KEYS = ["refundPct", "refundChanceRanged", "refundChanceMelee", "refundAll"];
    conv.refunds = [];
    // 능력치 비례 값 (rules {"calc": …} 에 계수가 있는 것: 범람 최대 마나·프로틴 음료 추가 방어/마저·마도사의 주스 상자 주문력):
    // 최종 능력치를 다 구한 뒤 더한다. 다른 능력치를 다시 바꾸지 않는 값(회복·흡혈·피해 증폭)에만 쓴다.
    // 주문력만 예외로 % 증가·주문력 전환(치명타·가속)을 아래에서 같이 적용한다 (리치 두뇌)
    const late = [];
    for (const s of mods) {
      if (s && s.refundPct) conv.refunds.push({ pct: s.refundPct, ranged: s.refundChanceRanged ?? 1, melee: s.refundChanceMelee ?? 1, all: !!s.refundAll });
      // 원거리 챔피언은 값이 다른 능력치 (rules rangedStats → statsResolved.rangedScale: 유리 대포 고정 피해 ×0.6)
      const rScale = (!champ.melee && s && s.rangedScale) || {};
      // '대상 체력 X% 아래' 조건 고유 효과 (rules _belowAt: 세릴다의 원한 둔화): 값 × 조건 아래 피해 비율 (targetBelowShare, 그림자불꽃과 같은 기준)
      const below = s && s._belowAt != null ? targetBelowShare(s._belowAt) : 1;
      // '멀리서 맞히면' 조건 고유 효과 (rules _farMark: 지평선의 초점 600 밖에서 스킬 적중): 값 × 멀리서 맞힐 수 있는 몫 (farMarkShare)
      const far = s && s._farMark != null ? farMarkShare(champ, s._farMark) : 1;
      for (const [k, raw0] of entriesOf(s)) {
        if (k === "rangedScale" || k === "_belowAt" || k === "_farMark") continue;
        const raw = typeof raw0 === "number" ? (rScale[k] != null ? raw0 * rScale[k] : raw0) * below * far : raw0;
        // needsItem: 그 아이템을 가졌을 때만 터지는 증강 효과 (폭풍 쇄도 업그레이드: 폭풍 쇄도의 질풍이 폭발)
        if (k === "_effects") { effects.push(...raw.filter((e) => !e.needsItem || items.some((it) => it.name === e.needsItem))); continue; }
        // C9-A3: 중첩형 저항 감소는 숫자가 아니라 '쌓이는 방식' 으로 적는다 ({stat, perStack, maxStacks, dur, on}).
        // 쌓는 속도는 챔피언의 공격 속도·스킬 빈도라 여기서는 풀지 않고 모아만 둔다 (metrics 에서 shredExpect 로 푼다).
        if (k === "_shred") { (conv._shreds || (conv._shreds = [])).push(...(Array.isArray(raw) ? raw : [raw])); continue; }
        if (REFUND_KEYS.includes(k)) continue;
        if (raw && typeof raw === "object" && raw.ratios && Object.keys(raw.ratios).length) { late.push([k, raw]); continue; }
        const v = levelValue(raw, L);
        if (k in add) addTo(k, v);
        else if (k in mult) mult[k] += v;
        else if (k === "slotHaste") for (const [slot, h] of Object.entries(v)) flags.slotHaste[slot] = (flags.slotHaste[slot] || 0) + h;
        // 스킬 하나만 키우는 피해·회복/보호막 배율 (펜타킬 헤비·파워·스래시·둠: 강화 스킬 피해 10% · 회복·보호막 10%)
        else if (k === "slotDmgMult") for (const [slot, m] of Object.entries(v)) flags.slotDmg[slot] = (flags.slotDmg[slot] || 0) + m;
        else if (k === "slotHealMult") for (const [slot, m] of Object.entries(v)) flags.slotHeal[slot] = (flags.slotHeal[slot] || 0) + m;
        else if (k === "noUlt") flags.noUlt = flags.noUlt || v;
        // 그 아이템을 가졌을 때만 붙는 능력치 (굶주린 히드라 업그레이드: 굶주린 히드라 생명력 흡수 +8%)
        else if (k === "itemStats") { for (const [nm, st] of Object.entries(v)) if (items.some((it) => it.name === nm)) for (const [sk, sv] of Object.entries(st)) if (sk in add) addTo(sk, sv); }
        else if (k in flags) flags[k] += v;
        else convAdd(conv, k, v);
      }
    }
    const aram = (opts.aram !== false && champ.aram) || {};
    const t = {};
    t.bonusHP = add.HP;
    const itemHP = items.reduce((a, it) => a + ((it.stats && it.stats.HP) || 0), 0);
    t.HP = (base.HP + add.HP + itemHP * (conv.itemHPbonus || 0)) * (1 + mult.HPmult);
    t.bonusHP = t.HP - base.HP;
    let bonusAD = add.AD;
    let AP = add.AP;
    // 26.21 변환 증강: 아이템에서 얻은 능력치만 다른 능력치로 (간지럼 괴물: 아이템 공격력 → 공격 속도, 마나 없음 상관없음: 아이템 마나 → 주문력)
    const itemSum = (k) => items.reduce((a, it) => a + ((it.stats && it.stats[k]) || 0), 0);
    let itemASfromAD = 0;
    if (conv.itemADtoAS) { const ad = itemSum("AD"); bonusAD -= ad; itemASfromAD = ad * conv.itemADtoAS; }
    let itemManaGone = 0;
    if (conv.itemMANAtoAP) { itemManaGone = itemSum("MANA"); AP += itemManaGone * conv.itemMANAtoAP; }
    if (conv.bonusADmult) bonusAD *= 1 + conv.bonusADmult;  // 추가 공격력만 % 증가 (묵직한 한 방·왕관의 무게)
    // 적응형은 게임 규칙대로: 추가 공격력과 주문력 중 큰 쪽, 같으면(둘 다 0 등) 스킬이 마법 위주면 주문력.
    // 챔피언 성향만 보면 공격력을 쌓은 트리스타나(마법 비중 높음)가 주문력을 받았다 (2026-10-17 판: 계산 주문력 18.75 · 실제 공격력 +11.25)
    const adaptiveAP = () => AP !== bonusAD ? AP > bonusAD : apMain(champ);
    // 적응형 능력치 증가
    if (mult.adaptiveMult) {
      if (adaptiveAP()) AP *= 1 + mult.adaptiveMult;
      else bonusAD *= 1 + mult.adaptiveMult;
    }
    // 적응형 능력치(고정값): 주문력 또는 추가 공격력 (적응형 1 = 공격력 0.6)
    // 모드: 치명타 확률 100% 초과분 1%당 적응형 (ms.critAdaptive)
    const adaptive = (conv.adaptive || 0) + (ms.critAdaptive ? Math.max(0, add.CRIT - 1) * 100 * ms.critAdaptive : 0);
    if (adaptive) {
      if (adaptiveAP()) AP += adaptive; else bonusAD += adaptive * 0.6;
    }
    // 챔피언 패시브 '의지'(야스오·요네): 치명타 확률 × (1 + critChanceMult), 100% 넘는 1%당 공격력 critToAD (게임 데이터 CritChanceMultiplier·YasuoCritToAD)
    const critRaw = add.CRIT * (1 + (conv.critChanceMult || 0));
    if (conv.critToAD) bonusAD += Math.max(0, critRaw - 1) * 100 * conv.critToAD;
    if (conv.bonusADtoAP) { AP += bonusAD * conv.bonusADtoAP; bonusAD = 0; }
    if (conv.APtoBonusAD) { bonusAD += AP * conv.APtoBonusAD; AP = 0; }
    t.AD = (base.AD + bonusAD) * (1 + mult.ADmult);
    t.bonusAD = t.AD - base.AD;
    t.baseAD = base.AD;
    t.AP = AP * (1 + mult.APmult);
    // 추가 저항 증가: 둘 다 올리는 것(해신 작쇼 bonusResistMult)과 한쪽만 올리는 것(16.23 요새화·신비한 방호)을 더해서 센다.
    // '추가' 저항에만 걸린다 — 챔피언이 레벨로 얻는 기본 저항은 올라가지 않는다 (설명: '추가 방어력이 25% 증가')
    const resMult = 1 + (conv.bonusResistMult || 0);
    t.bonusARMOR = add.ARMOR * (resMult + (conv.bonusARMORmult || 0));
    t.ARMOR = base.ARMOR + t.bonusARMOR;
    t.bonusMR = add.MR * (resMult + (conv.bonusMRmult || 0));
    t.MR = base.MR + t.bonusMR;
    // 람머스 패시브: 방어력·마법 저항력의 일부만큼 공격력 (설명 '15% 방어력 + 15% 마법 저항력')
    if (conv.resistToAD) { const ad = (t.ARMOR + t.MR) * conv.resistToAD; t.AD += ad; t.bonusAD += ad; }
    t.MANA = champ.partype === "마나" ? base.MANA + add.MANA - itemManaGone : 0;
    t.bonusMANA = champ.partype === "마나" ? add.MANA - itemManaGone : 0;
    if (conv.bonusMANAtoAP) t.AP += t.bonusMANA * conv.bonusMANAtoAP * (1 + mult.APmult);
    if (conv.manaToHP && t.MANA) { t.HP += t.MANA * conv.manaToHP; t.bonusHP = t.HP - base.HP; }  // 정신 변환: 최대 마나의 50% 체력
    const apBeforeHP = t.AP;
    if (conv.bonusHPtoAP) t.AP += t.bonusHP * conv.bonusHPtoAP * (1 + mult.APmult);  // 균열 생성기: 추가 체력의 2% 주문력
    // 지배자의 피갑옷 '폭정': 추가 체력의 2.5% 공격력 (추가 공격력으로, 공격력 % 증가를 받는다)
    if (conv.bonusHPtoAD) { const ad = t.bonusHP * conv.bonusHPtoAD * (1 + mult.ADmult); t.AD += ad; t.bonusAD += ad; }
    // 블라디미르 패시브: 주문력 1당 체력 1.6 (추가 체력 → 주문력과 서로 다시 키우지 않는다: 게임 규칙)
    if (conv.APtoBonusHP) { t.HP += apBeforeHP * conv.APtoBonusHP; t.bonusHP = t.HP - base.HP; }
    // 라이즈 패시브: 주문력 100당 최대 마나 10% (게임 데이터 PercentManaIncrease 10 · APAmount 100)
    if (conv.APtoManaPct && t.MANA) { const m = t.MANA * t.AP * conv.APtoManaPct; t.MANA += m; t.bonusMANA += m; }
    // 서포터 아이템 버프 (흐르는 물의 지팡이·불타는 향로): 아군을 회복·보호막으로 도울 때 자신도 받는 버프. 아군을 돕는 챔피언만 (rules items)
    const helps = canProcAllyItem(champ);
    if (helps && conv.allyBuffAP) t.AP += conv.allyBuffAP * (1 + mult.APmult);
    t.HASTE = add.HASTE + (aram.ability_haste || 0) + (conv.APtoHASTE ? t.AP * conv.APtoHASTE : 0);
    if (helps && conv.allyBuffHaste) t.HASTE += conv.allyBuffHaste;
    let bonusAS = base.asLevelBonus + add.AS + itemASfromAD + (helps ? conv.allyBuffAS || 0 : 0);
    // 순수주의자 - 마법사: 레벨 말고 얻은 추가 공격 속도(아이템 + 간지럼 괴물이 공격력에서 바꾼 것)를 스킬 가속으로.
    // 묵직한 한 방보다 먼저 (예전엔 묵직한 한 방이 옮긴 몫을 다시 덮어써 같은 공속이 두 번 쓰였고, 간지럼 괴물 몫은 사라졌다, 2026-10-23 점검)
    if (conv.AStoHASTE) { t.HASTE += (add.AS + itemASfromAD) * 100 * conv.AStoHASTE; bonusAS = base.asLevelBonus; }
    // 묵직한 한 방: 공격 속도의 일부를 치명타 피해로 (AStoCRITDMG = 옮기는 비율, AStoCRITDMGper = 공속 1%당 치명타 피해 %)
    let critDmgFromAS = 0;
    if (conv.AStoCRITDMG) { const moved = bonusAS * conv.AStoCRITDMG; bonusAS -= moved; critDmgFromAS = moved * (conv.AStoCRITDMGper || 0); }
    // 보석 건틀릿: 주문력 1당 치명타 확률 (conv.APtoCRIT, 원본 CritConverRatio 0.00045 = 주문력 100당 4.5%)
    t.CRIT = Math.min(1, critRaw + (conv.APtoCRIT ? t.AP * conv.APtoCRIT : 0));
    // 그레이브즈처럼 공격 속도 표시값이 다른 챔피언은 레벨별 상한 (champ.asCapLv = [1레벨, 18레벨], rules.json champions.asCap)
    const cap = champ.asCapLv ? champ.asCapLv[0] + (champ.asCapLv[1] - champ.asCapLv[0]) * (L - 1) / 17 : ms.asCap || AS_CAP;
    const asOf = (b) => Math.min(cap, (base.AS + b * champ.asRatio) * (1 + mult.ASmult) * (aram.total_as || 1));
    // 치명타마다 쌓이는 공격 속도 (치명적 리듬): 계속 기본 공격할 때 유지 시간(초) 안에 터지는 치명타 수 = 중첩
    // 중첩 = min(최대, 치명타 확률 × 초당 공격 × 유지 시간). 공격 속도가 다시 중첩을 늘리므로 몇 번 반복해 맞춘다
    t.critStacks = 0;
    if (conv.critStackAS && t.CRIT > 0) {
      const max = conv.critStackMax || 0, sec = conv.critStackSec || 0;
      for (let i = 0; i < 8; i++) t.critStacks = Math.min(max, t.CRIT * asOf(bonusAS + conv.critStackAS * t.critStacks) * sec);
      bonusAS += conv.critStackAS * t.critStacks;
    }
    // 구인수의 격노검: 평타마다 공격 속도 rampAS 씩 rampMax 번 쌓이고, 다 쌓인 뒤로 세 번째 평타마다 적중 효과를 한 번 더 (onhitRepeat).
    // 한타에서 평타를 이어 치는 시간(AUTO_FIGHT_SEC) 동안 친 평타 수 n 으로 평균을 낸다: 공속 중첩 = Σ min(i, 최대) / n,
    // 반복 = (n − 최대) / n × onhitRepeat. 예전엔 늘 최대 중첩으로 봐서 공속이 낮은 챔피언·치명타 원딜까지 구인수를 골랐다 (2026-11-12 점검)
    t.rampStacks = 0;
    t.onhitRepeat = conv.rampAS ? 0 : conv.onhitRepeat || 0;
    if (conv.rampAS) {
      const max = conv.rampMax || 0;
      let n = 1;
      for (let i = 0; i < 8; i++) {
        n = Math.max(1, Math.round(asOf(bonusAS + conv.rampAS * t.rampStacks) * EXP.fightSec * EXP.autoUptime));
        let sum = 0;
        for (let k = 0; k < n; k++) sum += Math.min(k, max);
        t.rampStacks = sum / n;
      }
      bonusAS += conv.rampAS * t.rampStacks;
      t.onhitRepeat = (Math.max(0, n - max) / n) * (conv.onhitRepeat || 0);
    }
    t.AS = asOf(bonusAS);
    t.CRITDMG = (BASE_CRIT_DMG + add.CRITDMG + critDmgFromAS) * (conv.critDmgMod || 1);  // 야스오·요네 치명타 피해 × 0.95 (게임 데이터 CritDamageMod)
    // 진처럼 공격 속도가 고정인 챔피언 (champ.asFixed, rules.json champions.asFixed): 공격 속도는 레벨로만 오르고,
    // 레벨별 % + 치명타 확률·추가 공격 속도 비례 %만큼 공격력이 늘며 치명타 피해는 줄어든다 (위키 Jhin '속삭임')
    if (champ.asFixed) {
      const f = champ.asFixed;
      t.AS = base.AS + base.asLevelBonus * champ.asRatio;
      const pct = (f.adPctLv[Math.min(17, L - 1)] || 0) + (f.perCrit || 0) * t.CRIT + (f.perBonusAS || 0) * bonusAS;
      t.AD *= 1 + pct;
      t.bonusAD = t.AD - base.AD;
      t.CRITDMG *= f.critDmgMult || 1;
      // 4번째 탄은 항상 치명타 (critEvery): 기본 공격의 치명타 기대 확률. 표시하는 치명타 확률(t.CRIT)은 그대로
      if (f.critEvery) t.critAuto = t.CRIT + (1 - t.CRIT) / f.critEvery;
    }
    // 이동 속도: (기본 + 고정 증가) × (1 + % 증가 합) → 게임의 감속 구간(415·490 초과분 감소)
    const rawMS = (base.MS + add.MS + (conv.HASTEtoMS ? t.HASTE * conv.HASTEtoMS : 0)) * (1 + add.MSP + mult.MSmult);
    t.MS = rawMS > 490 ? rawMS * 0.5 + 230 : rawMS > 415 ? rawMS * 0.8 + 83 : rawMS;
    // 헤카림 패시브: 추가 이동 속도의 12~24%(레벨 비례)만큼 공격력 (게임 데이터 BonusAD)
    if (conv.bonusMStoAD) { const ad = Math.max(0, t.MS - base.MS) * conv.bonusMStoAD; t.AD += ad; t.bonusAD += ad; }
    t.bonusMS = t.MS - base.MS;
    t.bonusAP = t.AP;  // 주문력은 전부 추가 주문력 (기본 주문력이 없다)
    for (const k of ["LETHALITY", "MPEN", "ARPEN", "MPENP", "LS", "OMNIVAMP", "HSP"]) t[k] = add[k];
    // 가라앉은 자의 축복: 추가 체력을 물리 관통력으로 전환 (추가 체력은 없어진다)
    if (conv.bonusHPtoLETHALITY) { t.LETHALITY += t.bonusHP * conv.bonusHPtoLETHALITY; t.HP = base.HP; t.bonusHP = 0; }
    t.RANGE = base.RANGE;
    t.MP5P = itemSum("MP5P");  // 아이템의 기본 마나 재생 % 합 (새벽심장 '기본 마나 재생 100%당')
    // 새벽심장 '태초의 빛': 기본 마나 재생 100%당 체력 회복·보호막 효과 2%·주문력 15
    if (conv.MP5PtoHSP) t.HSP += t.MP5P * conv.MP5PtoHSP;
    if (conv.MP5PtoAP) { const ap = t.MP5P * conv.MP5PtoAP * (1 + mult.APmult); t.AP += ap; t.bonusAP = t.AP; if (conv.APtoHASTE) t.HASTE += ap * conv.APtoHASTE; }
    t.CSTACKS = champ.stacks || 0;  // 스킬의 '중첩당' 피해 (나서스 Q, 스몰더 Q …)
    for (const [k, raw] of late) {
      let v = levelValue(raw, L);
      for (const [stat, arr] of Object.entries(raw.ratios)) v += (Array.isArray(arr) ? arr[0] : arr) * (t[stat] || 0);
      if (k === "AP") {
        // 주문력은 다른 주문력처럼 % 증가(APmult)를 받고, 주문력에서 바뀌는 값(치명타·가속)에도 들어간다
        // (리치 두뇌 '주문력 30 + 추가 체력 4%'가 라바돈 배율·보석 건틀릿 전환에서 빠졌다, 2026-10-23 점검)
        const ap = v * (1 + mult.APmult);
        t.AP += ap;
        t.bonusAP = t.AP;
        if (conv.APtoHASTE) t.HASTE += ap * conv.APtoHASTE;
        if (conv.APtoCRIT) t.CRIT = Math.min(1, t.CRIT + ap * conv.APtoCRIT);
      } else if (k in t && typeof t[k] === "number") { t[k] += v; if (k === "AD") t.bonusAD += v; }
      else if (k in flags) flags[k] += v;
      else convAdd(conv, k, v);
    }
    // 원 히트 원더(conv.HASTEtoDmg)·핏빛 코발트(conv.markCdRefund)는 스킬 하나에만 걸리는 스킬 증강이라 metrics 의 스킬 계산에서 처리한다
    return { total: t, base, flags, aram, effects, conv };
  }

  // 레벨 L 에서의 스킬 랭크. 궁극기: 3단계면 6/11/16, 4단계(니달리·엘리스·카르마)는 1레벨에 1단계를 그냥 받고 6/11/16,
  // 1단계(제이스)는 1레벨부터. 기본 스킬은 남는 포인트를 Q→W→E 순으로 균등 배분. 우디르처럼 R 도 6단계면 4개 모두 기본 스킬로 본다
  function ranksAt(L, spells) {
    const rr = spells[3] ? spells[3].ranks : 3;
    const basic4 = rr >= 5;
    let r = 0, freeR = 0;
    if (!basic4) {
      if (rr === 1) { r = 1; freeR = 1; }
      else if (rr === 4) { r = 1 + (L >= 6) + (L >= 11) + (L >= 16); freeR = 1; }
      else r = L >= 16 ? 3 : L >= 11 ? 2 : L >= 6 ? 1 : 0;
      r = Math.min(r, rr);
    }
    let pts = L - (r - freeR);
    const n = basic4 ? 4 : 3;
    const out = [0, 0, 0, 0];
    for (let i = 0; pts > 0 && i < 40; i++) {
      const slot = i % n;
      if (out[slot] < (spells[slot] ? spells[slot].ranks : 5)) { out[slot]++; pts--; }
    }
    return basic4 ? out : [out[0], out[1], out[2], r];
  }

  // 주 피해 유형이 마법인가: 라이엇 damageType(물리/마법)이 있으면 그것, 혼합·없음이면 스킬 마법 비율.
  // 스킬 계수만 보면 바루스(W·R 마법)·이즈리얼이 마법 쪽(0.67·0.8)이라 즉시 골드 증강을 주문력으로 바꿨다
  function apMain(champ) {
    if (champ.damageType === "magic") return true;
    if (champ.damageType === "physical") return false;
    return (champ.magicShare ?? 0.5) >= 0.5;
  }

  function statFor(key, t) {
    if (key === "TGT_MAXHP") return TARGET.HP;
    // 최대 체력 × 주문력 (코그모 W: 최대 체력의 4.5% + 주문력 1당 0.01%)
    if (key === "TGT_MAXHP_AP") return TARGET.HP * (t.AP || 0);
    if (key === "TGT_CURHP") return TARGET.HP * TARGET.CUR;
    if (key === "TGT_MISSINGHP") return TARGET.HP * (1 - TARGET.CUR);
    // 잃은 체력 × 주문력 (카이사 플라즈마 폭발: 잃은 체력의 15% + 주문력 1당 0.06%)
    if (key === "TGT_MISSINGHP_AP") return TARGET.HP * (1 - TARGET.CUR) * (t.AP || 0);
    if (key in t) return t[key];
    if (key.startsWith("base")) return t[key] ?? 0;
    return 0;
  }

  // 곱셈 식 나무 (예: (피해 + 계수) × (1 + 치명타 확률)): 실제 능력치를 넣어 계산
  function evalTree(n, L, t) {
    if (n.op === "*") return n.a.reduce((v, x) => v * evalTree(x, L, t), 1);
    if (n.op === "+") return n.a.reduce((v, x) => v + evalTree(x, L, t), 0);
    let v = n.b || 0;
    if (n.l) v += n.l[0] + (n.l[1] - n.l[0]) * (L - 1) / 17;
    for (const [k, c] of Object.entries(n.r || {})) v += c * statFor(k, t);
    return v;
  }

  function effectValue(e, rank, L, t) {
    const i = Math.max(0, rank - 1);
    if (e.tree) return evalTree(e.tree[Math.min(i, e.tree.length - 1)], L, t);
    let v = e.base[Math.min(i, e.base.length - 1)] || 0;
    if (e.lvl) v += e.lvl[0] + (e.lvl[1] - e.lvl[0]) * (L - 1) / 17;
    for (const [k, arr] of entriesOf(e.ratios)) v += arr[Math.min(i, arr.length - 1)] * statFor(k, t);
    return v;
  }

  // 같은 스킬 안에서 최소/최대 같은 대체 수치는 큰 쪽만, 같은 이름은 한 번만 센다
  // 이름으로 정하는 부분(묶기·빼기·치명타 여부)은 스킬마다 한 번만 계산해 둔다 (spellPlan). 계산마다 정규식을 수천 번 돌려서
  // 빌드 탐색(능력치 계산 수천 번)의 37%가 여기였다 (2026-10-15 실측). 값에 따라 정하는 부분(카드 중 최대·치명타 기대값)만 매번 계산
  const PLANS = new WeakMap();
  function spellPlan(effects) {
    let plan = PLANS.get(effects);
    if (plan) return plan;
    const seen = new Set();
    const uniq = [];
    for (const e of effects) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      uniq.push(e);
    }
    // 최소/최대(또는 기본/최대) 같은 대체 수치는 같은 이름 줄기끼리 묶어서 큰 쪽 하나만 센다
    // (다리우스 R damage·maximumdamage, 그라가스 Q mindamage·maxdamage …)
    // 치명타 버전(미스 포츈 Q totaldamagecrit)은 같은 줄기로 묶고, 치명타 확률만큼만 더한 기대값으로 센다
    const stem = (n) => String(n).toLowerCase().replace(/^spell\.[^:]+:/, "")
      .replace(/(minimum|maximum|min|max|tooltip|total|floor|base|calc|crit(ical)?)/g, "");
    const groups = new Map();  // 키 → uniq 번호 목록
    uniq.forEach((e, idx) => {
      if (DMG_KINDS.includes(e.kind) && STAT_BUFF.test(String(e.name).replace(/^spell\.[^:]+:/, ""))) return;  // 능력치 증가 수치(리븐 R bonusad)는 피해가 아니다
      const k = e.kind + "|" + stem(e.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(idx);
    });
    // 같은 종류 안에서: 총합(total)이 있으면 한 번당(per wave·bullet·tick…) 값은 뺀다 (루시안 R, 미스 포츈 R)
    // 강화·벽·지형 같은 조건부 대체 버전은 기본 버전이 있으면 뺀다 (볼리베어 W, 제리 W, 키아나 Q)
    const PER = /per(wave|bullet|tick|second|sec|missile|hit|shot|dagger|blade|stack|bolt)/i;
    const ALT = /(empowered|enhanced|wall|tremor|terrain)/i;  // 재사용(리 신 Q2)·두 번째 공격은 실제로 한 번 더 맞아서 빼지 않는다
    const name = (i) => String(uniq[i].name);
    const byKind = new Map();
    for (const k of groups.keys()) {
      const kind = k.split("|")[0];
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(k);
    }
    for (const keys of byKind.values()) {
      const names = keys.flatMap((k) => groups.get(k).map(name));
      const hasTotal = names.some((n) => /total/i.test(n) && !PER.test(n));
      const hasBase = names.some((n) => !ALT.test(n) && !/crit/i.test(n));
      for (const k of keys) {
        const kept = groups.get(k).filter((i) => !(hasTotal && PER.test(name(i)) && !/total/i.test(name(i))) && !(hasBase && ALT.test(name(i))));
        if (kept.length) groups.set(k, kept); else groups.delete(k);
      }
    }
    const crit = uniq.map((e) => /crit/i.test(e.name));
    const kinds = [...byKind.values()].map((keys) => {
      const live = keys.filter((k) => groups.has(k));
      // 하나만 고르는 버전(트위스티드 페이트 W 파랑·빨강·노랑 카드)
      const cards = live.filter((k) => groups.get(k).every((i) => /^(blue|red|gold)/i.test(name(i).replace(/^spell\.[^:]+:/, ""))));
      return { keys: live, cards: cards.length > 1 ? cards : [] };
    });
    plan = { uniq, groups, kinds, crit };
    PLANS.set(effects, plan);
    return plan;
  }

  function spellTotals(effects, rank, L, t) {
    const { uniq, groups: planGroups, kinds, crit } = spellPlan(effects);
    const vals = uniq.map((e) => ({ kind: e.kind, name: e.name, value: effectValue(e, rank, L, t), ...(e.onhit ? { onhit: true } : {}), ...(e.every ? { every: e.every } : {}), ...(e.autoReplace ? { autoReplace: true } : {}), ...(e.perSec ? { perSec: true } : {}), ...(e.dotSec ? { dotSec: e.dotSec, dotNeedsAuto: !!e.dotNeedsAuto } : {}), ...(e.empower ? { empower: e.empower } : {}), ...(e.ally ? { ally: e.ally } : {}), ...(e.target ? { target: e.target } : {}) }));
    const groups = new Map();
    for (const [k, idx] of planGroups) groups.set(k, idx.map((i) => vals[i]));
    const isCritV = new Map(vals.map((v, i) => [v, crit[i]]));
    const isCrit = (v) => (isCritV.has(v) ? isCritV.get(v) : /crit/i.test(v.name));
    for (const { keys, cards } of kinds) {
      if (cards.length > 1) {
        const best = cards.reduce((a, b) => (Math.max(...groups.get(b).map((v) => v.value)) > Math.max(...groups.get(a).map((v) => v.value)) ? b : a));
        for (const k of cards) if (k !== best) groups.delete(k);
      }
      // 치명타 버전이 다른 이름 줄기에 있어도(탈론 Q leap·critical) 같은 종류의 기본 값이 있으면 치명타 확률만큼만
      const live = keys.filter((k) => groups.has(k));
      const critKeys = live.filter((k) => groups.get(k).every(isCrit));
      const normKeys = live.filter((k) => !critKeys.includes(k));
      if (critKeys.length && normKeys.length) {
        const nTop = Math.max(...normKeys.flatMap((k) => groups.get(k).map((v) => v.value)));
        for (const k of critKeys) {
          const c = groups.get(k).reduce((a, b) => (b.value > a.value ? b : a));
          groups.set(k, [{ ...c, value: Math.min(1, t.CRIT || 0) * Math.max(0, c.value - nTop) }]);
        }
      }
    }
    const out = [];
    for (const list of groups.values()) {
      const cr = list.filter(isCrit), normal = list.filter((v) => !isCrit(v));
      const top = (l) => l.reduce((a, b) => (b.value > a.value ? b : a));
      if (cr.length && normal.length) {
        const n = top(normal), c = top(cr);
        out.push({ ...n, value: n.value + Math.min(1, t.CRIT || 0) * Math.max(0, c.value - n.value) });
      } else out.push(top(list));
    }
    return out;
  }
  const STAT_BUFF = /^(bonus|flat|percent)?(ad|ap|attackdamage|abilitypower|armor|mr|magicresist|ms|movespeed|movementspeed|as|attackspeed)$/i;

  // 저항(방어력·마법 저항력)이 피해를 얼마나 줄이는가. 적용 순서는 게임과 같다 (v0.1.95 Phase 4 C9-A1):
  //   ① 고정 감소(flatRed) → ② 비율 감소(pctRed) → ③ 비율 관통(pctPen) → ④ 고정 관통(flatPen)
  // 감소는 '그 대상을 때리는 모두'에게, 관통은 '나만' 적용된다 — 순서가 달라지면 값이 달라진다.
  // 음수 저항은 1차 구현에서 지금처럼 0 에서 자른다 (실제로 음수가 생기는 조합이 있는지는 C9 에서 따로 잰다)
  function mitigation(resist, pctPen, flatPen, pctRed = 0, flatRed = 0) {
    const reduced = (resist - flatRed) * (1 - pctRed);
    const eff = Math.max(0, reduced * (1 - pctPen) - flatPen);
    return 100 / (100 + eff);
  }
  // 저항 감소 합치기 규칙 (C9-A2): 비율 감소는 관통 %처럼 곱하고, 고정 감소는 더한다.
  // 지금 데이터에 비율 마법 저항력 감소(mrShred)는 핏빛 저주 하나뿐이라 결과는 바뀌지 않는다 (출처가 둘 이상 되면 달라진다)
  const PCT_SHRED = new Set(["mrShred", "armorShred"]);
  const SHRED_CAP = 0.9;  // 비율 감소 상한 (예전 mrShred 상한을 그대로 둔다)
  function convAdd(conv, k, v) {
    conv[k] = PCT_SHRED.has(k) ? 1 - (1 - (conv[k] || 0)) * (1 - v) : (conv[k] || 0) + v;
  }
  // 중첩으로 쌓이는 저항 감소의 한타 평균 (C9-A2.5, docs/v0.1.95_Phase4_C9_저항감소_조사.md 7.1).
  //   rate  1초에 쌓는 횟수 (조건 on 에 따라 평타 공격 속도 · 스킬 빈도 · 둘의 합)
  //   dur   한 중첩이 남아 있는 시간(초) · maxStacks 최대 중첩 · perStack 중첩 하나가 깎는 양
  // 쌓는 동안에도 중첩은 선형으로 올라가므로 그 구간의 평균은 절반이다 (앞 식은 그 구간을 0 으로 쳐서 음수가 나왔다).
  //   포화까지 걸린 시간 t_r ≤ 한타 T :  s̄ = s* × (1 − t_r / (2T))
  //   t_r > T                        :  s̄ = min(s*, rate × T / 2)   … 한타 내내 쌓기만 한다
  // 항상 0 ≤ s̄ ≤ s* 다. 발동이 아예 없으면(rate·dur·maxStacks 중 하나가 0 이하) 0 을 준다 (t_r 이 0/0 이 되지 않게).
  // pinnedAvg 를 주면 그 중첩 평균을 그대로 쓴다 (핏빛 저주의 기존 가정 1.5 를 유지해 결과를 고정할 때).
  function shredExpect({ perStack = 0, maxStacks = 1, rate = 0, dur = 0, fightSec = null, pinnedAvg = null } = {}) {
    const T = Math.max(1e-9, fightSec != null ? fightSec : EXP.fightSec);
    if (pinnedAvg != null) return { stackAvg: pinnedAvg, saturated: pinnedAvg, value: pinnedAvg * perStack };
    if (!(rate > 0) || !(dur > 0) || !(maxStacks > 0)) return { stackAvg: 0, saturated: 0, value: 0 };
    const sat = Math.min(maxStacks, rate * dur);
    const tr = sat / rate;
    const avg = tr <= T ? sat * (1 - tr / (2 * T)) : Math.min(sat, rate * T / 2);
    return { stackAvg: avg, saturated: sat, value: avg * perStack };
  }

  // C9-A3: 모아 둔 중첩형 저항 감소 규칙을 실제 값으로 푼다.
  //   stat      armorShred·mrShred(비율) · armorFlatShred·mrFlatShred(고정) — 물리와 마법 경로를 섞지 않는다
  //   on        어떻게 쌓나: "auto" 기본 공격 · "skill" 스킬 · "both" 둘 다
  //   pinnedAvg 중첩 평균을 못 세는 효과의 기존 가정값 (핏빛 저주 1.5) — 주면 rate 를 보지 않는다
  // 쌓는 속도(rate)는 여기서 한 번만 정한다. shredExpect 가 돌려주는 평균 중첩에는 이미 '쌓는 시간·지속시간' 이
  // 들어 있으므로 바깥에서 가동률을 다시 곱하지 않는다 (docs C9 조사 7.1).
  const SHRED_STATS = { armorShred: "pct", mrShred: "pct", armorFlatShred: "flat", mrFlatShred: "flat" };
  // 쌓는 횟수/초. 기본 공격은 물리 피해라 'physical' 에 들어가고 'magic' 에는 안 들어간다 (C9-A4 칠흑).
  // 스킬로 쌓는 효과는 '실제로 쓰여 맞는 스킬 빈도'(시전 빈도 × 공통 가정) — 다른 스킬 효과와 같은 기준이다.
  // 한 스킬은 몇 번 맞히든 한 번만 센다 (평타와 스킬이 같은 타격을 두 번 세지 않게).
  function shredRate(on, ctx) {
    const auto = Math.max(0, (ctx.AS || 0) * EXP.autoUptime);
    const skill = Math.max(0, (ctx.castRate || 0) * EXP.skillShare);
    const physSkill = Math.max(0, (ctx.physCastRate || 0) * EXP.skillShare);
    const magSkill = Math.max(0, (ctx.magicCastRate || 0) * EXP.skillShare);
    if (on === "auto") return auto;
    if (on === "skill") return skill;
    if (on === "both") return auto + skill;        // 아무 피해나 (부식)
    if (on === "physical") return auto + physSkill;  // 물리 피해만 (칠흑의 양날 도끼)
    if (on === "magic") return magSkill;             // 마법 피해만 (기본 공격은 물리라 빠진다)
    return 0;
  }
  // 중첩이 아니라 '걸려 있는 시간' 인 효과(악의: 궁극기로 피해를 입히면 3초)는 한타 한 번과 길게 싸울 때가 다르다.
  //   한타 한 번(콤보) : min(1, 지속 ÷ 한타 시간)   길게(초당 피해) : min(1, 지속 ÷ 궁극기 재사용 대기시간)
  // 그래서 shredFrom 은 두 벌을 돌려준다 (fight · long). 중첩형은 두 벌이 같다 (평균 중첩에 이미 시간이 들어 있다).
  function shredFrom(specs, ctx) {
    const mk = () => ({ armorShred: 0, mrShred: 0, armorFlatShred: 0, mrFlatShred: 0 });
    const fight = mk(), long = mk(), detail = [];
    const put = (o, stat, kind, v) => { if (kind === "pct") o[stat] = 1 - (1 - o[stat]) * (1 - v); else o[stat] += v; };
    for (const sp of specs || []) {
      const kind = SHRED_STATS[sp && sp.stat];
      if (!kind) continue;
      let vf = 0, vl = 0, info = null;
      if (sp.on === "ult") {
        // 궁극기로 챔피언에게 피해를 입혀야 걸린다: 궁이 막혔거나(증강) 궁에 피해가 없으면 0
        const can = ctx.ultDamage ? 1 : 0;
        const uf = Math.min(1, (sp.dur || 0) / Math.max(ctx.fightSec, 1e-9)) * can;
        const ul = (ctx.ultUptime ? ctx.ultUptime(sp.dur || 0) : 0) * can;
        vf = (sp.perStack || 0) * uf;
        vl = (sp.perStack || 0) * ul;
        info = { stat: sp.stat, on: "ult", fightUptime: uf, longUptime: ul, value: vf, valueLong: vl };
      } else {
        const r = shredExpect({ perStack: sp.perStack || 0, maxStacks: sp.maxStacks || 0, dur: sp.dur || 0,
          rate: sp.pinnedAvg != null ? 1 : shredRate(sp.on, ctx), fightSec: ctx.fightSec, pinnedAvg: sp.pinnedAvg });
        vf = vl = r.value;
        info = { stat: sp.stat, on: sp.on, stackAvg: r.stackAvg, saturated: r.saturated, value: r.value, valueLong: r.value };
      }
      if (!(vf > 0) && !(vl > 0)) continue;
      // 비율은 관통 % 처럼 곱해서, 고정은 더해서 합친다 (C9-A2 와 같은 규칙)
      if (vf > 0) put(fight, sp.stat, kind, vf);
      if (vl > 0) put(long, sp.stat, kind, vl);
      detail.push(info);
    }
    return { fight, long, detail };
  }

  // 기준 상대: 전 챔피언 173명의 18레벨 균형 빌드 능력치 중앙값 (패치 16.20, tools/target_median.js 로 계산)
  // 현재 체력 비례 피해는 체력 70% 상태, 잃은 체력 비례는 30% 잃은 상태로 가정
  // 받는 피해량(초당): 18레벨 칼바람 한타에서 집중될 때 평균 정도. 무적·피해 감소를 버티는 힘으로 바꿀 때 쓴다
  // 추가 체력(BONUS_HP): 같은 173명 균형 빌드의 18레벨 추가 체력 중앙값 (tools/target_median.js). 상대 추가 체력 비례 효과(도미닉 경의 인사)에 쓴다
  // (v0.1.95 Phase 4 C2) 실제 판에서는 app.js enemyTarget() 이 그 판 적들의 추가 체력 평균을 넣어 준다. 예전엔 안 넣어 줘 늘 이 기본값이었다
  // HEAL = 기준 상대가 한타 한 번에 자기 자신을 회복하는 양. 전 챔피언 18레벨 균형 빌드의 중앙값은 0 이다
  // (173명 중 101명이 0 · 중앙값 0 · 평균 271). 그래서 상대를 모를 때 치유 감소(고통스러운 상처)의 값은 0 이고,
  // 실제 판에서는 app.js 가 그 판 적들의 회복량 평균을 넣어 준다 (v0.1.93 P4-B 5단계)
  // 16.23.1 에서 다시 잼 (tools/target_median.js, 2026-11-26): 방어력 113→111 · 마법 저항력 63→67 · 체력 3148→3190
  const TARGET = { ARMOR: 111, MR: 67, HP: 3190, BONUS_HP: 300, CUR: 0.7, DPS_TAKEN: 600, HEAL: 0 };
  // 기준 아군 (v0.1.93 P1 아군 지원): 아군 공격 속도·공격력·적중 시 피해·피해량 강화를 '아군이 더 넣는 피해'로 바꿀 때 쓴다.
  // 원거리 딜러(첫 역할 Marksman, 원거리) 29명의 18레벨 균형 빌드(증강 없음) 지표 중앙값 (tools/ally_model.js, 기준 상대 TARGET 과 같은 방식).
  // 원딜은 주문력 계수가 거의 없어 아군 주문력 버프(흐르는 물의 지팡이)는 기준 아군에선 0 이다 (메이지 아군이면 커짐, 미반영)
  const ALLY = { autoDps: 891, skillDps: 86, AS: 2.04, asRatio: 0.656, AD: 324, HASTE: 10 };
  // 아군 강화를 받는 아군 수: 회복·보호막을 아군 한 명에게 주는 지금 기준과 같다. 여러 아군에게 주는 효과도 1명 (근거 자료 없음, 미검증)
  const ALLY_TARGETS = 1;
  // 골드 → 능력치: 위키 '골드 효율' 기준 가치 (공격력 35, 주문력 20, 체력 2.67, 방어력·마법 저항력 20골드)
  // 골드의 50%는 주 공격 능력치, 30% 체력, 20% 방어력·마법 저항력 반반으로 산다고 본다
  const GOLD_VALUE = { AD: 35, AP: 20, HP: 2.67, ARMOR: 20, MR: 20 };
  const DEFAULT_TARGET = { ...TARGET };
  // 기준 상대 바꾸기: {ARMOR, MR, HP} (실제 상대 챔피언의 18레벨 빌드 능력치 등). 인자 없으면 기본값
  function setTarget(t) {
    Object.assign(TARGET, DEFAULT_TARGET, t ? { ARMOR: t.ARMOR, MR: t.MR, HP: t.HP, ...(t.bonusHP != null ? { BONUS_HP: t.bonusHP } : {}), ...(t.HEAL != null ? { HEAL: t.HEAL } : {}) } : {});
  }
  // 초당 피해에 스킬을 써야 나오는 피해를 넣는 비율 (스킬을 재사용 대기시간마다 계속 맞히는 일은 드물다, ASSUMPTIONS).
  // 스킬에 딸린 효과(스킬 사용 시·지정 스킬 표식)는 '실제로 쓰여 맞는 스킬 빈도' = 시전 빈도 × 이 비율로 보고, 그다음 효과 자체의
  // 재사용 대기시간·갱신 상한을 건다 (리안드리 화상처럼 3초마다 한 번이면 되는 효과는 상한까지 그대로).
  // 2026-11-14 E1: 효과는 시전 빈도 100%로 세서 가렌 + 전부 다 무너뜨려의 증강 스킬분(50)이 가렌 자기 스킬(23)보다 컸다
  const SKILL_DPS_SHARE = 0.3;
  // 실험 설정 (2026-11-14 후속 분석, 가정값 민감도용): 기본값 = 지금 가정. 화면은 바꾸지 않는다 (tools 에서만 setExperiment)
  //   autoUptime  한타 중 기본 공격을 실제로 치는 시간 비율 (평타·적중·기본 공격 시 효과의 초당 피해, 구인수 중첩 평타 수에 곱함)
  //   fightSec    평타를 이어 치는 한타 시간(초, 구인수 중첩 평균)
  //   skillShare  SKILL_DPS_SHARE 대신 쓸 값
  //   allyUptime  아군 강화가 실제로 쓰이는 비율 (아군이 그 시간 동안 때리고 있을 비율). 기본 1 = 한타 내내 때린다는 지금 가정
  const EXP_DEFAULT = { autoUptime: 1, fightSec: AUTO_FIGHT_SEC, skillShare: SKILL_DPS_SHARE, allyUptime: 1 };
  const EXP = { ...EXP_DEFAULT };
  function setExperiment(e) { Object.assign(EXP, EXP_DEFAULT, e || {}); }
  const CAST_MIN_CD = 2; // '스킬 사용 시' 효과: 한 스킬은 최대 2초에 1번 (토글·충전형 스킬이 발동을 부풀리지 않게)
  const COMBO_WINDOW = 4; // 콤보 한 번(스킬 4개)에 걸리는 시간 가정(초): 쿨다운 있는 효과의 발동 횟수 상한
  // 주문 검(리치베인·삼위일체 …)처럼 '스킬 뒤 기본 공격'에 터지는 효과를 실제로 섞어 치는 비율.
  // 라이엇 공식 챔피언 정보의 공격 의존도(info.attack 1~10)로 정한다: 2 이하(럭스·벨코즈·소라카) 25% ~ 6 이상(피즈·케일·트페) 100%.
  // 예전엔 스킬마다 평타를 친다고 봐서 마법 챔피언 기본 빌드 79%에 리치베인이 들어갔다 (2026-11-12 추천 점검)
  const weaveOf = (champ) => {
    const a = ((champ && champ.info) || {}).attack;
    return a == null ? 1 : Math.min(1, Math.max(0.25, (a - 1) / 5));
  };

  // 계산 전체에 쓰는 가정값과 이유 (화면 '데이터 출처 → 계산 가정값'에 그대로 나온다)
  // src: data = 게임 데이터·위키에서 계산한 값, assume = 정한 값(실측 아님)
  const ASSUMPTIONS = [
    { what: "기준 상대: 체력 3190(추가 체력 300) · 방어력 111 · 마법 저항력 67", src: "data",
      why: "전 챔피언 173명이 18레벨에 우리 추천 빌드(균형)를 갖췄을 때의 중앙값이에요 (패치 16.20). 평균은 탱커에 끌려 올라가서 중앙값을 써요. 능력치 패널 '상대'에서 실제 챔피언으로 바꿀 수 있어요." },
    { what: "증강 모드 공통 능력치: 기본 체력 20→400(원거리)·600(근접), 공격 속도 상한 5.0, 치명타 100% 넘는 1%마다 적응형 0.75", src: "data",
      why: "위키 'ARAM: Mayhem' 모드 변경 사항이에요. 실제 경기 기록(베인·미스 포츈) 체력·공격력과 맞춰 봤어요." },
    { what: "레벨당 공격력은 위키 값", src: "data", why: "라이엇 Data Dragon(16.20)이 173명 모두 0으로 주고 있어요. 실제 경기 기록과 위키 값이 맞았어요." },
    { what: "상대 현재 체력 70% (잃은 체력 30%)", src: "assume", why: "한타가 한창일 때를 기준으로 했어요. 현재·잃은 체력 비례 피해와, 체력이 낮을 때만 커지는 효과(그림자불꽃: 40% 아래)에 쓰여요. 체력 조건 효과는 상대 체력이 100%에서 40%로 고르게 줄어든다고 봐서(평균 70%) 그림자불꽃은 기본 계산에서 발동하지 않아요. 상대를 끝까지 잡는 판이 많으면 더 커져요 (실게임 검증 필요)." },
    { what: "기준 아군: 평타 초당 피해 891 · 공격 속도 2.04 · 공격력 324 · 스킬 초당 피해 86", src: "data",
      why: "원거리 딜러 29명이 18레벨에 균형 빌드를 갖췄을 때의 중앙값이에요. 서포터가 주는 아군 공격 속도·공격력·추가 피해를 '이 아군이 더 넣는 피해'로 바꿀 때 써요." },
    { what: "아군 강화: 서포터 기술 1번에 1번, 아군 1명, 더 넣는 피해 1 = 지원 1", src: "assume",
      why: "회복·보호막을 세는 기준과 맞췄어요. 한타는 양쪽 체력 차이로 갈려서 적 체력 1을 더 깎는 것과 아군 체력 1을 지키는 것을 같게 봤어요. 여러 아군이 받거나 메이지 아군이면 더 커요 (실게임 검증 필요)." },
    { what: "받는 피해 초당 600", src: "assume", why: "무적·피해 감소 시간을 '버티는 힘'으로 바꿀 때만 써요. 18레벨 한타에서 집중을 받을 때 정도로 잡았어요." },
    { what: "콤보 = Q·W·E·R 각 1번, 4초", src: "assume", why: "스킬 4개를 한 번씩 쓰는 데 걸리는 시간이에요. 재사용 대기시간이 있는 효과는 4초 안에 발동하는 횟수만 세요." },
    { what: "초당 피해에 스킬 피해는 30%만 (스킬을 써야 터지는 증강·아이템 효과도 같이)", src: "assume", why: "스킬을 재사용 대기시간마다 계속 맞히는 일은 드물어서, 다 넣으면 너무 커져요. 스킬에 딸린 효과(주문 검·붐 앤 베이스 등)도 그 스킬을 써야 나오니 같은 비율이에요." },
    { what: "제어력: 기절·속박은 그대로, 둔화는 30%만", src: "assume", why: "둔화는 움직일 수는 있어서 기절보다 약하게 셌어요. 5초 넘는 지속 효과(장판 등)는 CC로 안 셌어요." },
    { what: "골드 → 능력치: 주 공격 50% · 체력 30% · 방어력·마법 저항력 20%", src: "assume", why: "능력치 1당 골드 가치는 위키 '골드 효율'(공격력 35·주문력 20·체력 2.67·방어 20골드) 그대로이고, 나눠 사는 비율만 정한 값이에요." },
    { what: "평가 기준: 18레벨 · 아이템 6칸 완성", src: "assume", why: "증강·아이템을 같은 조건에서 비교하려고 풀템 시점으로 맞췄어요. 능력치 패널 레벨 슬라이더로 다른 레벨도 볼 수 있어요." },
    { what: "스킬 레벨: 궁극기 6·11·16, 나머지는 Q→W→E 순서로 고르게", src: "assume", why: "챔피언마다 선마가 다르지만 18레벨에는 결국 다 마스터라 차이가 작아요." },
    { what: "충전 공격(스태틱의 단검 등)은 기본 공격 8번에 1번", src: "assume", why: "충전 속도가 이동 거리에 따라 달라서 정확한 숫자가 없어요." },
    { what: "평타로 쌓는 중첩(구인수의 격노검)은 한타 6초 동안 친 평타 수로 평균", src: "assume", why: "매 한타 중첩 0부터 쌓는다고 봐요. 공격 속도가 높을수록 빨리 쌓여 오래 켜져요. 4초·8초로 바꾸면 구인수를 고르는 챔피언 수가 바뀌어서 비교 결과를 문서에 남겼어요." },
    { what: "자기 공격 속도 스킬(트리스타나 Q 등)은 지속 시간 ÷ 한타 6초만큼 켜져 있다고 셈", src: "assume", why: "한타 시작에 쓴다고 보고 구인수와 같은 한타 6초를 써요. 기본 지속 효과는 늘 켜져 있어요. 수치는 스킬 설명 값이고, 추천 점수에만 넣어요 (게임 중 '지금 능력치' 비교에는 안 넣어요)." },
    { what: "치명타 확률로 발동하는 효과는 치명타 확률만큼 기대값", src: "data", why: "설명의 '치명타 확률과 같은 확률'을 그대로 계산해요." },
    { what: "재사용 대기시간은 가속을 받아도 최소 0.5초로 셈", src: "assume", why: "징크스 Q처럼 전환형 스킬이 초당 피해를 부풀리지 않게 했어요." },
    { what: "'스킬 사용 시' 효과는 한 스킬당 최대 2초에 1번", src: "assume", why: "재사용 대기시간이 2초보다 짧은 스킬은 대부분 무기 바꾸기·충전형(징크스 Q 0.9초, 티모 R 0.25초)이라 그대로 세면 발동이 부풀어요. 카시오페아 E처럼 실제로 자주 쓰는 스킬은 조금 적게 셀 수 있어요." },
    { what: "최소~최대가 있는 스킬 피해는 최대로 셈", src: "assume", why: "충전·거리·중첩에 따라 커지는 스킬(바이 Q, 다리우스 R, 사이온 Q 등)은 최대치를 기준으로 비교해요. 최소와 최대를 둘 다 더하던 오류를 고치면서 정한 기준이에요." },
    { what: "같은 스킬의 대체 버전은 하나만 셈", src: "assume", why: "총합과 한 번당 값이 같이 있으면 총합만, 강화·벽 통과·지형 같은 조건부 버전은 기본 버전으로, 치명타 버전은 치명타 확률만큼만 더해요 (예: 볼리베어 W 강화, 루시안 R 한 발당, 미스 포츈 Q 치명타)." },
    { what: "주문 검(리치베인 등)은 평타를 섞는 만큼만", src: "data", why: "스킬을 쓴 뒤 기본 공격을 해야 터져요. 라이엇 챔피언 정보의 공격 의존도(1~10)로 비율을 정해요: 2 이하 25%(럭스·벨코즈·소라카), 3은 40%, 4는 60%, 5는 80%, 6 이상 100%(피즈·케일·트위스티드 페이트)." },
    { what: "지속 피해(화상 등)는 지속 시간마다 1번", src: "data", why: "같은 대상에 다시 걸면 새로 쌓이지 않고 시간만 갱신되는 게임 규칙 그대로예요 (예: 리안드리 화상 3초). 설명에 '무한히 중첩'이 있으면(화염 낙인) 걸 때마다 쌓아요." },
  ];

  const itemOrAugFx = (e) => e.src !== "패시브" && !e.champ;  // 아이템·증강 효과 (챔피언 자기 기술이 아님)
  const CRIT_NAME = new Map();  // 효과 이름 → 치명타 버전인지 (정규식을 이름마다 한 번만)
  const isCritName = (n) => { n = n || ""; let r = CRIT_NAME.get(n); if (r === undefined) { r = /crit/i.test(n); CRIT_NAME.set(n, r); } return r; };
  // '대상 체력 X% 아래' 조건 효과의 공통 비율: 내가 준 피해 중 대상 체력이 at 아래일 때 들어간 몫.
  // 따로 발동률을 정하지 않고 기준 상대 현재 체력(TARGET.CUR, 현재·잃은 체력 비례 피해와 같은 가정)에서 끌어낸다:
  // 한타 동안 상대 체력이 100% → (2 × CUR − 1) 로 고르게 줄어든다 (CUR 70% → 100% → 40%, 평균 70%).
  // 이 가정에선 끝점(40%) 아래로는 내려가지 않아 40% 이하 조건은 0이다 — 처치까지 가는 몫은 근거가 없어 넣지 않았다 (미검증)
  // '600 밖에서 스킬로 맞히면' 조건을 챔피언마다 얼마나 쓸 수 있는지 (지평선의 초점).
  // 피해가 나오는 스킬 중 사거리 R 이 가장 긴 것을 기준으로, 그 사거리 안에서 600 보다 먼 자리가 차지하는 넓이 비율 = 1 − (600/R)².
  // 자리를 고를 수 있다는 가정이 아니라 '그 거리에서 쓸 기회가 얼마나 되나'의 대용값이에요 (가정, 미검증).
  // R < 600 이면 0 (가렌·다리우스처럼 멀리서 맞힐 스킬이 없는 챔피언은 이 효과를 못 쓴다)
  const FAR_DMG = new Set(["physical", "magic", "true"]);
  function farMarkShare(champ, need) {
    let best = 0;
    for (const sp of champ.spells || []) {
      if (!(sp.effects || []).some((e) => FAR_DMG.has(e.kind))) continue;
      best = Math.max(best, sp.range || 0);
    }
    if (best <= need) return 0;
    return Math.round((1 - (need / best) ** 2) * 1e4) / 1e4;
  }
  function targetBelowShare(at) {
    const end = Math.max(0, 2 * TARGET.CUR - 1);
    return Math.max(0, Math.min(1, (at - end) / (1 - end)));
  }
  // 아군 강화 → 기준 아군(ALLY)이 지속시간 동안 더 넣는 피해. 서포터 기술 1번에 1번 (회복·보호막을 콤보 1번에 1번 세는 것과 같음).
  // 아군이 더 넣는 피해 1 = 지원 1 (체력 단위)로 본다: 한타는 양쪽 체력 차이로 갈려서 적 체력 1을 더 깎는 것과 아군 체력 1을 지키는 것을 같게 (가정, 미검증)
  //   allyAS 공격 속도 비율 · allyAD 공격력 · allyOnhit 적중 시 마법 피해(한 번) · allyHaste 스킬 가속 · allyAmp 피해량 비율 · allyAP 주문력(기준 아군 0)
  // 아군 강화 → 기준 아군이 더 넣는 피해. 평타에 붙는 강화(공격 속도·공격력·적중 시)는 아군이 그동안 실제로 때리고 있어야 들어가서
  // 아군 평타 가동률(EXP.allyUptime, 기본 1)을 곱한다. 우리 자신 평타에 EXP.autoUptime 을 쓰는 것과 같은 자리예요 (v0.1.93 P4-B 2단계).
  function allyGain(kind, amt, sec, hits, cap = AS_CAP) {
    const s = Math.min(sec || COMBO_WINDOW, AUTO_FIGHT_SEC);
    const up = EXP.allyUptime;
    if (kind === "allyAS") return ALLY.autoDps * (Math.min(cap, ALLY.AS + ALLY.asRatio * amt) / ALLY.AS - 1) * s * up;
    if (kind === "allyAD") return ALLY.autoDps * amt / ALLY.AD * s * up;
    if (kind === "allyOnhit") return amt * 100 / (100 + TARGET.MR) * Math.min(hits || Infinity, ALLY.AS * s * up);
    if (kind === "allyHaste") return ALLY.skillDps * amt / (100 + ALLY.HASTE) * s;
    if (kind === "allyAmp") return (ALLY.autoDps + ALLY.skillDps) * amt * s;
    return 0;
  }
  const isAllyKind = (k) => typeof k === "string" && k.startsWith("ally");
  // 서포터 아이템(불타는 향로·흐르는 물의 지팡이) 발동 조건: '아군을 치유하거나 보호막을 씌워 주면' (아이템 설명).
  // 아군에게 가는 회복·보호막 기술이 있어야 터진다. 분류만 아군 지원인 챔피언(누누 — 아군 공격 속도 버프)은 못 터뜨린다 (v0.1.93 P4-B 2단계)
  const ALLY_TARGET_KINDS = ["ally", "allies", "selfAndAllies", "selfOrAlly"];
  const CAN_PROC = new WeakMap();
  function canProcAllyItem(champ) {
    if (!champ || !(champ.features || []).includes("allysupport")) return false;
    if (CAN_PROC.has(champ)) return CAN_PROC.get(champ);
    const rows = [...(champ.spells || []).flatMap((s) => s.effects || []), ...((champ.passive || {}).effects || []),
      ...(((champ.fightStats || {})._effects) || [])];
    const ok = rows.some((e) => (e.kind === "heal" || e.kind === "shield") && ALLY_TARGET_KINDS.includes(e.target));
    CAN_PROC.set(champ, ok);
    return ok;
  }

  // 회복·보호막의 대상 (v0.1.93 P4-A). 게임 규칙(누가 받을 수 있나)과 사용 시나리오(실제로 누구에게 쓰나)를 나눈다.
  //   self 자기만 · ally 아군 하나 · allies 주변 아군 여럿 · selfAndAllies 자신과 아군이 함께 · selfOrAlly 자신 또는 아군 중 하나
  // 돌려주는 값은 {self: 자기 몫 배수, ally: 아군 몫 배수}. selfAndAllies 는 게임에서 둘 다 받으니 둘 다 1 (중복 계산이 아님).
  // selfOrAlly 는 둘 중 하나라서 사용 시나리오로 가른다: 아군을 돕는 챔피언이면 아군에게, 아니면 자신에게 (가정, 실게임 미검증).
  function targetShare(target, helps) {
    switch (target) {
      case "self": return { self: 1, ally: 0 };
      case "ally": return { self: 0, ally: 1 };
      case "allies": return { self: 0, ally: ALLY_TARGETS };
      case "selfAndAllies": return { self: 1, ally: ALLY_TARGETS };
      case "selfOrAlly": return helps ? { self: 0, ally: 1 } : { self: 1, ally: 0 };
      // 대상을 못 읽은 효과: 예전처럼 아군을 돕는 챔피언이면 지원, 아니면 자기 생존으로 (rules.json effectTarget 으로 정해 주면 없어진다)
      default: return helps ? { self: 0, ally: 1 } : { self: 1, ally: 0 };
    }
  }
  function metrics(champ, L, stats, opts = {}) {
    const { total: t, flags, aram } = stats;
    const cv = stats.conv || {};
    const asCapOf = (champ.modeStats || {}).asCap || AS_CAP;  // 기준 아군도 같은 모드의 공격 속도 상한
    // 상대 추가 체력 비례 피해 증가 (도미닉 경의 인사 '거인 학살자': 추가 체력 1500에서 최대 15%) → 기준 상대 추가 체력으로
    const bonusHpAmp = cv.tgtBonusHpAmp ? cv.tgtBonusHpAmp * Math.min(1, TARGET.BONUS_HP / (cv.tgtBonusHpAt || 1500)) : 0;
    const dealt = (aram.dmg_dealt || 1) * (1 + flags.dmgDealtMult) * (1 + bonusHpAmp);
    const taken = aram.dmg_taken || 1;
    // 피해 유형별 증가 (그림자불꽃 '잿덩이꽃': 마법·고정 피해만)는 방어 적용 계수에 곱해 모든 피해 계산에 같이 들어간다.
    // 마법 저항력 감소(핏빛 저주 '썩은 부식')는 상대 마법 저항력 자체를 줄인다
    // 체력 조건 피해 증가 (그림자불꽃: 체력 40% 아래 대상에게 마법·고정 피해 +20%): 조건 아래에서 들어가는 피해 비율만큼 (targetBelowShare)
    const lowAmp = cv.lowHpAt ? (cv.lowHpMagicTrueAmp || 0) * targetBelowShare(cv.lowHpAt) : 0;
    const trueMit = 1 + (cv.trueDmgMult || 0) + lowAmp;
    const ranks = ranksAt(L, champ.spells);
    const out = { spells: [], combo: 0, comboRaw: 0, skillDps: 0, autoHit: 0, shield: 0, heal: 0, kitShield: 0, kitHeal: 0, spellOnhit: 0, allyDmg: 0, selfShield: 0, selfHeal: 0 };
    const helps = (champ.features || []).includes("allysupport");
    // ---- 스킬 가속 환산 (쿨 반환·초기화 증강·아이템)
    const ranged = !champ.melee;
    // 쿨의 f% 를 확률 p 로 돌려받음 → 남는 쿨 비율 (1 - pf). 여럿이면 곱한다 → 가속 100 × (1/Π(1-pf) - 1)
    const refund = (ult) => {
      let keep = 1;
      for (const r of cv.refunds || []) {
        if (ult && !r.all) continue;
        keep *= 1 - Math.min(0.9, r.pct * (ranged ? r.ranged : r.melee));
      }
      return 100 * (1 / Math.max(0.1, keep) - 1);
    };
    const rIdx = champ.spells.findIndex((sp) => sp.slot === "R");
    const rSp = champ.spells[rIdx];
    const rRank = ranks[rIdx] || 1;
    const rBaseCd = rSp ? rSp.cooldown[Math.max(0, Math.min(rRank, rSp.cooldown.length) - 1)] || 100 : 100;
    const ultHaste = t.HASTE + flags.ultHaste * 1.5 + (cv.ultHasteAdd || 0)
      + (cv.ultRefundEvery ? 100 * rBaseCd / cv.ultRefundEvery : 0) + refund(true);
    const rCd = rBaseCd * 100 / (100 + ultHaste);
    const ultUptime = (dur) => Math.min(1, (dur || 0) / Math.max(rCd, 1));
    const basicHaste = t.HASTE + (cv.basicHaste || 0) + 100 * t.AS * (cv.onhitCdr || 0)
      + 60 * t.AS * ((cv.onhitRemainingPct || 0) / 0.15) + (cv.critToHaste || 0) * t.CRIT * 100
      + ((champ.features || []).includes("dash") ? (cv.dashHaste || 0) / 3 : 0)
      + (cv.ultTriggerHaste || 0) * ultUptime(cv.ultTriggerDur) + refund();
    out.haste = { basic: basicHaste, ult: ultHaste };
    // ---- C9-A3: 중첩형 저항 감소를 공통 식(shredExpect)으로 풀어 피해 경감에 넣는다
    // 스킬로 쌓는 효과의 시전 빈도: 아래 스킬 루프의 castRate 와 같은 규칙(한 스킬은 최대 CAST_MIN_CD 초에 1번).
    // 다만 원 히트 원더·핏빛 코발트의 대기시간 보정은 빼고 센다 (저항 감소는 스킬 하나만 겨냥하지 않는다).
    const shredCastRate = champ.spells.reduce((a, sp, i) => {
      if (ranks[i] === 0 || (flags.noUlt && sp.slot === "R")) return a;
      const cdBase = sp.cooldown[Math.max(0, Math.min(ranks[i], sp.cooldown.length) - 1)] || 0;
      if (!(cdBase > 0)) return a;
      const h = (sp.slot === "R" ? ultHaste : basicHaste) + (flags.slotHaste[sp.slot] || 0);
      return a + 1 / Math.max(cdBase * 100 / (100 + h), CAST_MIN_CD);
    }, 0);
    // 피해 종류별 시전 빈도 (칠흑: 물리 피해를 입히면 · 핏빛 저주: 마법 피해를 입히면)
    const kindCastRate = (want) => champ.spells.reduce((a, sp, i) => {
      if (ranks[i] === 0 || (flags.noUlt && sp.slot === "R")) return a;
      const cdBase = sp.cooldown[Math.max(0, Math.min(ranks[i], sp.cooldown.length) - 1)] || 0;
      // 적응형 피해는 그 챔피언의 주 능력치 쪽으로 센다 (아래 증강 효과 계산과 같은 규칙)
      const kindOf = (e) => (e.kind === "adaptive" ? (apMain(champ) ? "magic" : "physical") : e.kind);
      if (!(cdBase > 0) || !(sp.effects || []).some((e) => kindOf(e) === want)) return a;
      const h = (sp.slot === "R" ? ultHaste : basicHaste) + (flags.slotHaste[sp.slot] || 0);
      return a + 1 / Math.max(cdBase * 100 / (100 + h), CAST_MIN_CD);
    }, 0);
    const ultDmg = !flags.noUlt && !!rSp && (rSp.effects || []).some((e) => DMG_KINDS.includes(e.kind) || e.kind === "adaptive");
    const shred = shredFrom(cv._shreds, { AS: t.AS, castRate: shredCastRate, fightSec: EXP.fightSec,
      physCastRate: kindCastRate("physical"), magicCastRate: kindCastRate("magic"),
      ultUptime, ultDamage: ultDmg });
    // 규칙에 숫자로 바로 적힌 감소값과 합친다 (비율은 곱, 고정은 합 — C9-A2 와 같은 규칙)
    // 한쪽이 0 이면 그대로 둔다 (1-(1-a)*(1-0) 는 부동소수점 끝자리를 흔들어 기존 값과 미세하게 달라진다)
    const mergeShred = (part) => {
      const pct = (k) => Math.min(SHRED_CAP, !part[k] ? (cv[k] || 0) : !cv[k] ? part[k] : 1 - (1 - cv[k]) * (1 - part[k]));
      return { armorShred: pct("armorShred"), mrShred: pct("mrShred"),
        armorFlatShred: (cv.armorFlatShred || 0) + part.armorFlatShred,
        mrFlatShred: (cv.mrFlatShred || 0) + part.mrFlatShred };
    };
    out.shred = { ...mergeShred(shred.fight), detail: shred.detail };        // 한타 한 번 기준 (콤보)
    out.shredLong = mergeShred(shred.long);                                  // 길게 싸울 때 기준 (초당 피해)
    // 적용 순서는 그대로다: 고정 감소 → 비율 감소 → 비율 관통 → 고정 관통 (mitigation)
    const physMit = mitigation(TARGET.ARMOR, t.ARPEN, t.LETHALITY, out.shred.armorShred, out.shred.armorFlatShred)
      * (1 + (cv.physDmgMult || 0));
    const magMit = mitigation(TARGET.MR, t.MPENP, t.MPEN, out.shred.mrShred, out.shred.mrFlatShred)
      * (1 + (cv.magicDmgMult || 0) + lowAmp);
    // 초당 피해 쪽은 '길게 싸울 때' 가동률로 한 번 더 센다. 차이가 없으면 보정은 정확히 1 이라 값이 그대로다
    const same = out.shred.armorShred === out.shredLong.armorShred && out.shred.mrShred === out.shredLong.mrShred
      && out.shred.armorFlatShred === out.shredLong.armorFlatShred && out.shred.mrFlatShred === out.shredLong.mrFlatShred;
    const adjP = same ? 1 : mitigation(TARGET.ARMOR, t.ARPEN, t.LETHALITY, out.shredLong.armorShred, out.shredLong.armorFlatShred)
      / Math.max(1e-12, mitigation(TARGET.ARMOR, t.ARPEN, t.LETHALITY, out.shred.armorShred, out.shred.armorFlatShred));
    const adjM = same ? 1 : mitigation(TARGET.MR, t.MPENP, t.MPEN, out.shredLong.mrShred, out.shredLong.mrFlatShred)
      / Math.max(1e-12, mitigation(TARGET.MR, t.MPENP, t.MPEN, out.shred.mrShred, out.shred.mrFlatShred));
    // 초당 피해에 쓸 보정 (한타 기준으로 센 값에 곱한다). 고정 피해는 저항과 무관하므로 1
    const dpsAdj = same ? () => 1 : (kind) => (kind === "magic" ? adjM : kind === "physical" ? adjP : 1);
    out.shredAdj = { physical: adjP, magic: adjM };
    // 스킬 증강({{SpellName}}): 원본 설명이 '챔피언 스킬 하나'에만 건다. 어느 스킬인지는 게임 카드에만 나와서
    // 배운 스킬(Q·W·E·R, 재사용 대기시간이 있는 것) 중 하나가 같은 확률로 대상이라고 보고 기대값을 낸다 (가정, 실게임 검증 필요).
    // 궁극기도 대상이 될 수 있다: 같은 계열 증강 설명에 '궁극기가 대상이면' 규칙이 있다 (위키 Terrain'd·Chain Reaction)
    //   원 히트 원더: 대상 스킬 피해 × (1 + 스킬 가속 × 0.75%), 대상 스킬은 가속을 받지 않는다
    //   핏빛 코발트: 대상 스킬로 표식 → 다음 기본 공격이 터뜨리면 대상 스킬의 현재 대기시간을 전체의 65%만큼 줄인다.
    //                터뜨리는 비율 = 스킬 뒤 평타를 섞는 비율(weaveOf, 주문 검과 같은 기준)
    // 예전엔 원 히트 원더가 평타·아이템까지 모든 피해를 키우고 모든 스킬의 가속을 없앴고, 핏빛 코발트는 모든 기본 스킬에 가속 48 +
    // 모든 스킬 사용마다 표식 피해를 셌다 (2026-11-12 점검)
    const ohwK = cv.HASTEtoDmg || 0, cobalt = cv.markCdRefund || 0, weave = weaveOf(champ);
    const targetable = champ.spells.filter((sp, i) => ranks[i] > 0 && !(flags.noUlt && sp.slot === "R")
      && (sp.cooldown[Math.max(0, Math.min(ranks[i], sp.cooldown.length) - 1)] || 0) > 0).length;
    const qT = targetable ? 1 / targetable : 0;
    out.boundCastRate = 0;
    champ.spells.forEach((sp, i) => {
      const rank = ranks[i];
      const disabled = rank === 0 || (flags.noUlt && sp.slot === "R");
      const haste = (sp.slot === "R" ? ultHaste : basicHaste) + (flags.slotHaste[sp.slot] || 0);
      const cdBase = sp.cooldown[Math.max(0, Math.min(rank, sp.cooldown.length) - 1)] || 0;
      const cdNormal = cdBase * 100 / (100 + haste);
      // 대상일 때·아닐 때 4가지 경우(원 히트 원더 대상 × 핏빛 코발트 대상, 서로 따로 정해짐)의 기대값
      const q = !disabled && cdBase > 0 ? qT : 0;
      const qO = ohwK ? q : 0, qC = cobalt ? q : 0;
      const ohwMult = 1 + t.HASTE * ohwK;
      const cobaltCd = 1 - cobalt * weave;
      let eMult = 0, eRate = 0, eRateMult = 0, eCobaltRate = 0;
      for (const [po, o] of [[qO, true], [1 - qO, false]]) for (const [pc, c] of [[qC, true], [1 - qC, false]]) {
        const p = po * pc;
        if (!p) continue;
        const cdCase = (o ? cdBase : cdNormal) * (c ? cobaltCd : 1);
        const m = o ? ohwMult : 1;
        eMult += p * m; eRate += p / Math.max(cdCase, 1e-9); eRateMult += p * m / Math.max(cdCase, 1e-9);
        // 표식 폭발은 '스킬 사용 시' 효과와 같이 한 스킬당 최대 CAST_MIN_CD 초에 1번 (렝가 0.25초·야스오 E 같은 짧은 스킬이 부풀리지 않게)
        if (c) eCobaltRate += p / Math.max(cdCase, CAST_MIN_CD);
      }
      // 한 번 쓸 때 피해 = 기대 배수, 재사용 대기시간 = 피해 기준 기대 발동 빈도에 맞춘 값 (콤보는 한 번, 초당 피해는 빈도)
      const cd = !cdBase ? cdNormal : (ohwK || cobalt) ? eMult / Math.max(eRateMult, 1e-9) : cdNormal;
      // v0.1.95 F5-B 충전형: 오래 싸울 때의 발동 간격은 '충전 1개가 차는 시간' 이다 (게임 파일 값).
      // 켜는 스킬은 rules.json 의 dpsRate 로 하나씩 적는다 — 설치물·평타 강화형은 적중 조건이 달라 켜지 않는다.
      // 한타 한 번 피해(combo)는 그대로 한 번만 센다. 처음 들고 있는 충전량을 초당 피해와 콤보에 두 번 세지 않으려는 것이다.
      const ammoSec = sp.dpsRate === "ammo" && sp.ammo
        ? (sp.ammo.recharge[Math.max(0, Math.min(rank, sp.ammo.recharge.length) - 1)] || 0) : 0;
      const rateBase = ammoSec || cdBase;  // 초당 피해에 들어갈지 가리는 바탕값
      const rateCd = ammoSec ? (sp.ammo.noHaste ? ammoSec : ammoSec * 100 / (100 + haste)) : cd;
      if (!disabled && cdBase > 0) out.boundCastRate += eCobaltRate * weave;
      const vals = disabled ? [] : spellTotals(sp.effects, rank, L, t);
      let dmg = 0, raw = 0, shield = 0, heal = 0, onhit = 0, ally = 0, selfShield = 0, selfHeal = 0;
      let perSecDmg = 0;  // v0.1.95 F5-E: 값 자체가 '초당 피해' 인 효과(토글 장판·지속 독·강화 평타)가 만드는 초당 피해
      let cdDmg = 0;      // 재사용 대기시간으로 나눠 초당 피해를 내는 보통 스킬 몫 (위 몫과 겹치지 않게 따로 센다)
      // 보석 건틀릿: 스킬도 치명타 (145% + 추가 치명타 피해) → 치명타 확률만큼 기대값
      // 보석 팔찌(26.21): 궁극기만 치명타 (ultCritDmg)
      const critMul = cv.skillCritDmg || (sp.slot === "R" && cv.ultCritDmg) || 0;
      const skillCrit = critMul ? 1 + Math.min(1, t.CRIT) * (critMul + (t.CRITDMG - BASE_CRIT_DMG) - 1) : 1;
      for (const v of vals) {
        // 아군이 넣는 추가 피해 (나미 E·소나 Q 멜로디·아이번 W, rules champions allyDealt): 서포터 자기 피해가 아니라 기준 아군의 적중 피해로
        if (v.ally) { const g = allyGain("allyOnhit", v.value, v.ally.sec, v.ally.hits, asCapOf) * ALLY_TARGETS; out.allyDmg += g; ally += g; continue; }
        if (v.onhit && DMG_KINDS.includes(v.kind)) {
          // 스킬의 '기본 지속 효과' 적중 시 피해: 기본 공격마다 (초당 피해의 평타 쪽). 스킬 피해 증폭은 안 받는다
          // v0.1.95 F5-C: '4번째 기본 공격마다'(every) 처럼 몇 번에 한 번인 효과는 그 횟수로 나눠 한 대당 평균으로 센다
          const mit = v.kind === "magic" ? magMit : v.kind === "physical" ? physMit : trueMit;
          // 적중 피해는 초당 피해(평타 쪽)로만 간다 → 길게 싸울 때 기준 보정 (C9-A4)
          onhit += v.value / Math.max(1, v.every || 1) * mit * dealt * (1 + flags.trueBonus) * dpsAdj(v.kind);
          continue;
        }
        // v0.1.95 F5-E: 값이 '초당 피해' 인 토글 장판 (신지드 Q 맹독의 자취·카서스 E 부패).
        // 켜 두는 스킬이라 '한 번 쓰는 피해' 가 아니다 → 초당 피해에 초당 값을 그대로, 한타 한 번 피해에는 콤보 시간만큼.
        // 실제로 맞히는 비율은 다른 스킬과 똑같이 바깥에서 SKILL_DPS_SHARE 가 건다 (새 가정값을 만들지 않는다).
        if (v.perSec && DMG_KINDS.includes(v.kind)) {
          const mit = v.kind === "magic" ? magMit : v.kind === "physical" ? physMit : trueMit;
          const per = v.value * dealt * (1 + flags.skillDmgMult) * (1 + (flags.slotDmg[sp.slot] || 0)) * mit * (1 + flags.trueBonus);
          perSecDmg += per * dpsAdj(v.kind);
          raw += v.value * COMBO_WINDOW * dealt * (1 + flags.skillDmgMult);
          dmg += per * COMBO_WINDOW;
          continue;
        }
        // v0.1.95 F5-E: 몇 초에 걸쳐 들어가는 지속 피해 총량 (티모 E 맹독 다트: 평타 적중마다 다시 걸려 덧씌워진다).
        // 덧씌움이라 여러 번 쌓이지 않는다 → 초당은 총량 ÷ 지속시간이 상한, 한타 한 번 피해에는 총량 한 번.
        if (v.dotSec && DMG_KINDS.includes(v.kind)) {
          const mit = v.kind === "magic" ? magMit : v.kind === "physical" ? physMit : trueMit;
          const total = v.value * dealt * (1 + flags.skillDmgMult) * (1 + (flags.slotDmg[sp.slot] || 0)) * mit * (1 + flags.trueBonus);
          // 평타로 다시 거는 스킬이면 평타가 지속시간보다 느릴 때 그만큼 빈다 (공격 속도 반영)
          const refreshed = v.dotNeedsAuto ? Math.min(1, (t.AS || 0) * v.dotSec) : 1;
          perSecDmg += total / v.dotSec * refreshed * dpsAdj(v.kind);
          raw += v.value * dealt * (1 + flags.skillDmgMult);
          dmg += total;
          continue;
        }
        // v0.1.95 F5-E: 기본 공격을 강화하는 스킬 (렝가 Q·애쉬 Q 는 평타 한 대를 대체, 유나라 Q 는 적중 시 얹는다).
        // 대체형은 '평타 한 대 피해와의 차이' 만 센다 (평타 피해는 이미 autoDps 에 있다 — 이중 계산 방지).
        if (v.empower && DMG_KINDS.includes(v.kind)) {
          const e = v.empower;
          const mit = v.kind === "magic" ? magMit : v.kind === "physical" ? physMit : trueMit;
          const gain = Math.max(0, v.value - (e.mode === "extra" ? 0 : (t.AD || 0)));
          const hit = gain * mit * dealt * (1 + flags.trueBonus);
          if (e.mode === "once") {
            // 충전 1개마다 다음 평타 한 대만 강화 (렝가 Q)
            const sec = ammoSec || cdNormal || 1;
            perSecDmg += hit / Math.max(sec, 0.5) * dpsAdj(v.kind);
            dmg += hit;
          } else {
            // 지속시간 동안 모든 평타가 강화 (애쉬 Q·유나라 Q) → 평타 쪽으로, 가동률만큼
            const as = Math.max(t.AS || 0, 1e-6);
            const needSec = Math.max(0, (e.need - e.dur * as * (e.perHit || 1)) / (as * (e.perHit || 1)));
            const up = e.dur / (e.dur + needSec);
            onhit += hit * up * dpsAdj(v.kind);
            out.empowerUptime = { ...(out.empowerUptime || {}), [sp.slot]: Math.round(up * 1000) / 1000 };
          }
          continue;
        }
        // v0.1.95 F5-C: 기본 공격을 대체하는 스킬(제리 Q '이 스킬은 기본 공격으로 간주됩니다').
        // 평타에 더하지 않고 평타 한 대의 피해를 이 값으로 바꾼다. 스킬 피해로는 세지 않는다 (이중 계산)
        if (v.autoReplace && DMG_KINDS.includes(v.kind)) { out.autoHit = v.value; continue; }
        if (DMG_KINDS.includes(v.kind)) {
          const amp = dealt * (1 + flags.skillDmgMult) * (1 + (flags.slotDmg[sp.slot] || 0)) * skillCrit * ((ohwK || cobalt) && cdBase ? eMult : 1);
          const mit = v.kind === "magic" ? magMit : v.kind === "physical" ? physMit : trueMit;
          raw += v.value * amp;
          dmg += v.value * amp * mit * (1 + flags.trueBonus);
          cdDmg += v.value * amp * mit * (1 + flags.trueBonus) * dpsAdj(v.kind);
        } else if (v.kind === "shield" || v.kind === "heal") {
          // 회복·보호막: 대상(게임 규칙)에 따라 자기 생존과 아군 지원으로 나눈다 (v0.1.93 P4-A)
          const amt = v.kind === "shield"
            ? v.value * (aram.shielding || 1) * (1 + t.HSP) * (1 + (cv.shieldMult || 0)) * (1 + (flags.slotHeal[sp.slot] || 0))
            : v.value * (aram.healing || 1) * (1 + t.HSP) * (1 + (flags.slotHeal[sp.slot] || 0));
          const sh = targetShare(v.target, helps);
          if (v.kind === "shield") { shield += amt * sh.ally; selfShield += amt * sh.self; }
          else { heal += amt * sh.ally; selfHeal += amt * sh.self; }
        }
      }
      out.spells.push({ slot: sp.slot, rank, cd: rateCd, values: vals, dmg, shield, heal, disabled, onhit, ...(ally ? { ally } : {}), ...(selfShield || selfHeal ? { selfShield, selfHeal } : {}) });
      out.spellOnhit += onhit;
      out.combo += dmg;
      out.comboRaw += raw;
      out.shield += shield;
      out.heal += heal;
      out.selfShield += selfShield;
      out.selfHeal += selfHeal;
      out.kitShield += shield;  // 서포터 아이템 발동(향로·월석)은 아군에게 준 몫만 (자기 보호막으로는 발동하지 않는다)
      out.kitHeal += heal;
      // 원래 재사용 대기시간이 아주 짧은 스킬(징크스 Q 같은 전환형)은 DPS에서 제외, 가속으로 짧아진 건 0.5초까지만
      if (rateBase > 0.5) out.skillDps += cdDmg / Math.max(rateCd, 0.5);
      out.skillDps += perSecDmg;  // 초당 값으로 센 몫은 재사용 대기시간과 상관없다 (보통 스킬 몫 cdDmg 와 겹치지 않는다)
    });
    // 증강·아이템 고유 효과·패시브: 발동 빈도에 따라 콤보·DPS·회복/보호막에 더한다
    const casts = out.spells.filter((s) => !s.disabled).length;
    // '스킬 사용 시' 효과의 초당 발동 횟수: 한 스킬은 최대 CAST_MIN_CD 초에 1번으로 센다
    // (재사용 대기시간이 아주 짧은 스킬은 대부분 토글·충전형이라 — 징크스 Q 무기 바꾸기 0.9초, 티모 R 0.25초)
    const castRate = out.spells.reduce((a, s) => a + (!s.disabled && s.cd > 0 ? 1 / Math.max(s.cd, CAST_MIN_CD) : 0), 0);
    out.augCombo = 0;
    out.augDps = 0;
    out.castDps = 0;  // augDps 중 스킬을 써야 나오는 몫 (시전 빈도 100% 기준)
    out.atkDps = 0;  // augDps 중 기본 공격으로 나오는 몫 (적중·기본 공격 시·N회 공격) — 실험 설정 autoUptime 용
    out.itemSelfHp = 0;  // 아이템 효과의 자기 회복·보호막 합 (버티는 힘에 더함)
    // 그 합을 회복과 보호막으로 갈라 둔다 (v0.1.95 Phase 4 C1): 치유 감소(고통스러운 상처)는 보호막을 막지 못하므로
    // 상대 회복량 추정(app.js enemyTarget)은 itemSelfHeal 만 써야 한다. 버티는 힘은 예전처럼 합(itemSelfHp)을 쓴다
    out.itemSelfHeal = 0;
    out.itemSelfShield = 0;
    out.castDpsUsed = 0;  // 같은 몫을 '실제로 쓰여 맞는 스킬 빈도'(× SKILL_DPS_SHARE, 효과 상한 적용)로 센 값 — 초당 피해에 쓴다
    out.effects = [];
    // 한 번에 여러 발 (rules effectCount: 탄환 세례 5발 · 마법 미사일 3발 · 쌍둥이 불꽃 1 + 치명타 확률 × 3)
    const baseV = (e) => {
      let v = effectValue(e, 1, L, t) * (e.ticks || 1) * ((e.count || 1) + (e.countCrit ? Math.min(1, t.CRIT) * e.countCrit : 0));
      if (e.rangedScale != null && !champ.melee) v *= e.rangedScale;
      if (e.uptime != null) v *= e.uptime;  // 조건부 효과의 가동률 (rules effectUptime)
      return v;
    };
    // 치명타 버전 효과: 같은 출처·피해 종류·발동 방식의 일반 효과가 있으면 그 대신 쓰이는 버전이다 (챔피언 스킬의 spellTotals 와 같은 원칙).
    // 일반 효과 + 적용되는 몫 × (치명타 − 일반). 몫은 체력 조건이 있으면(rules effectCritBelow) 그 조건 아래 피해 비율, 없으면 치명타 확률.
    // 2026-11-15 예전엔 둘 다 전부 더했다 (지옥불 난사 발동: 체력 30% 아래 대상에게만 치명타인 사격을 일반 사격과 같이 셈)
    // 치명타 버전이 있을 때만 짝을 찾는다 (모든 효과마다 찾으면 빌드 3종 계산이 약 11% 느려졌다)
    const fxList = stats.effects || [];
    const sameFx = (a, b) => a.src === b.src && a.kind === b.kind && ((a.trigger || {}).type || "once") === ((b.trigger || {}).type || "once");
    for (const e of fxList) {
      let v = baseV(e);
      const sib = isCritName(e.name) ? fxList.find((x) => x !== e && !isCritName(x.name) && sameFx(x, e)) : null;
      let critAlt = null;
      if (sib) {
        const share = e.critBelow != null ? targetBelowShare(e.critBelow) : Math.min(1, t.CRIT || 0);
        critAlt = { full: v, share };
        v = share * Math.max(0, v - baseV(sib));
      }
      // 쪼개기(불경한 히드라)는 원거리 챔피언이면 절반 (근접 공격력 40% · 원거리 20%, 리그 오브 레전드 위키)
      // (2026-10-15 베인+치명적 리듬: 원거리인데 근접 값으로 세서 불경한 히드라가 무한의 대검보다 위였다)
      if (/cleave/i.test(e.name || "") && !champ.melee && e.rangedScale == null) v *= CLEAVE_RANGED;
      if (e.chance === "CRIT") v *= t.CRIT;  // 확률 발동은 기대값
      const tr = e.trigger || { type: "once" };
      if (e.needsAuto && tr.type === "cast") v *= weaveOf(champ);  // 주문 검: 스킬 뒤 평타를 섞는 만큼만
      // 쿨다운이 있으면 콤보 한 번(COMBO_WINDOW초) 안 발동 횟수와 초당 발동 횟수를 제한
      // 기본 공격이 필요한 효과는 콤보 시간 동안 칠 수 있는 기본 공격 수·공격 속도로도 제한
      const autos = Math.max(1, Math.floor(t.AS * COMBO_WINDOW));
      // 지속 피해(화상 등 N초 동안 매초)는 같은 대상에 다시 걸면 시간만 갱신되므로 N초마다 최대 1번
      // 단 '무한히 중첩'(stacking: 화염 낙인)은 걸 때마다 하나씩 더 쌓여서 제한하지 않는다 (2026-10-21 칼리스타 판: 공격 속도 2.4 인데 5초에 1번으로 세 1/12 로 낮게 봄)
      const refresh = e.ticks && tr.type !== "time" && !e.stacking ? e.ticks : 0;
      const comboTimes = (n) => {
        let k = e.cooldown ? Math.min(n, 1 + Math.floor(COMBO_WINDOW / e.cooldown)) : n;
        if (refresh) k = Math.min(k, Math.max(1, Math.ceil(COMBO_WINDOW / refresh)));
        return e.needsAuto ? Math.min(k, autos) : k;
      };
      const rate = (r) => {
        let k = e.cooldown ? Math.min(r, 1 / e.cooldown) : r;
        if (refresh) k = Math.min(k, 1 / refresh);
        return e.needsAuto ? Math.min(k, t.AS) : k;
      };
      const row = { src: e.src || "", kind: e.kind, value: v, trigger: tr.type, ...(critAlt ? { critAlt: true, full: critAlt.full, share: critAlt.share } : {}) };
      out.effects.push(row);
      // 아군 강화 (룰루 W 공격 속도·잔나 E 공격력 …, 불타는 향로 아군 몫): 기준 아군이 더 넣는 피해 → 지원. 아이템 몫은 아군을 돕는 챔피언만 (needsAlly)
      if (isAllyKind(e.kind)) {
        if (e.needsAlly && !canProcAllyItem(champ)) { row.value = 0; continue; }
        // ofAllyAD: 받는 아군의 공격력 비례 (밀리오 패시브 '아군 공격력의 15%')
        row.ally = allyGain(e.kind, v + (e.ofAllyAD || 0) * ALLY.AD, e.sec, e.hits, asCapOf) * ALLY_TARGETS;
        out.allyDmg += row.ally;
        continue;
      }
      if (e.kind === "shield" || e.kind === "heal") {
        const k = e.kind === "shield" ? (aram.shielding || 1) : (aram.healing || 1);
        const amt = v * k * (1 + t.HSP) * (tr.type === "cast" ? comboTimes(casts) : 1);
        // 아이템 효과의 회복·보호막(스테락의 도전·케이닉 루컨·워모그의 갑옷 …)은 자기 자신에게만 → 버티는 힘(EHP)으로 (흡혈·생명선과 같게).
        // 2026-11-14 예전엔 '회복·보호막(지원)' 지표에 넣어, 지원 기준값(600)이 작은 탓에 메이지·서포터 계산 최적이 스테락·케이닉·워모그가 됐고
        // (공식 추천 가산이 가리고 있었음), 레오나 + 탱크 엔진의 점검표 증강 효과 2/3가 스테락 보호막 증가분이었다
        if (e.item) { out.itemSelfHp += amt; if (e.kind === "shield") out.itemSelfShield += amt; else out.itemSelfHeal += amt; continue; }
        // 챔피언 기술(패시브·규칙 효과)의 회복·보호막만 아군에게 줄 수 있다 (아이템·증강 효과는 자기 자신에게만: 스테락·케이닉 루컨)
        const sh = itemOrAugFx(e) ? { self: 1, ally: 0 } : targetShare(e.target, helps);
        row.toSelf = amt * sh.self;
        row.toAlly = amt * sh.ally;
        if (sh.self) { if (e.kind === "shield") out.selfShield += row.toSelf; else out.selfHeal += row.toSelf; }
        if (sh.ally) {
          if (e.kind === "shield") { out.shield += row.toAlly; out.kitShield += row.toAlly; }
          else { out.heal += row.toAlly; out.kitHeal += row.toAlly; }
        }
        continue;
      }
      const kind = e.kind === "adaptive" ? (apMain(champ) ? "magic" : "physical") : e.kind;
      row.kind = kind;
      const mit = kind === "magic" ? magMit : kind === "physical" ? physMit : trueMit;
      const itemOrAug = itemOrAugFx(e);
      // 취약: 아이템·지속 피해 효과도 치명타 (145% + 추가 치명타 피해) → 치명타 확률만큼 기대값 (rules effectCritDmg)
      const effCrit = itemOrAug && cv.effectCritDmg ? 1 + Math.min(1, t.CRIT) * (cv.effectCritDmg + (t.CRITDMG - BASE_CRIT_DMG) - 1) : 1;
      const hit = v * mit * dealt * (1 + flags.trueBonus) * (itemOrAug ? 1 + (cv.effectDmgMult || 0) : 1) * effCrit;
      const hitD = hit * dpsAdj(kind);  // 초당 피해 쪽은 길게 싸울 때 기준 (C9-A4)
      row.hit = hit;
      if (tr.type === "time") { out.augCombo += hit; out.augDps += hitD / Math.max(tr.sec, e.cooldown || 0); }
      else if (tr.type === "attacks") {
        // 적중 시 중첩으로 세는 효과(베인 은화살·카이사 플라즈마, trigger.onhitStacks)는 구인수의 두 번째 적중도 한 번 더 쌓는다
        row.stackRepeat = tr.onhitStacks ? t.onhitRepeat || 0 : 0;
        const a = hitD * rate(t.AS * (1 + row.stackRepeat) / tr.n);
        out.augDps += a; out.atkDps += a;
      }
      else if (tr.type === "onhit") { const a = hitD * rate(t.AS) * (1 + Math.min(1, t.CRIT) * (cv.onhitOnCrit || 0) + (t.onhitRepeat || 0)); out.augDps += a; out.atkDps += a; }
      // '기본 공격 시'(on-attack) 효과 (루난의 허리케인 탄환): 공격마다 1번, 치명타 적용. 적중 효과 반복(구인수·한 발에 두 놈)은 안 받는다
      else if (tr.type === "onattack") { row.dps = hitD * rate(t.AS) * (1 + Math.min(1, t.critAuto ?? t.CRIT) * (t.CRITDMG - 1)); out.augDps += row.dps; out.atkDps += row.dps; }
      else if (tr.type === "cast") { const v = hitD * rate(castRate); out.augCombo += hit * comboTimes(casts); out.augDps += v; out.castDps += v; out.castDpsUsed += hitD * rate(castRate * EXP.skillShare); }
      // 지정 스킬 하나로 쌓은 표식을 기본 공격으로 터뜨림 (핏빛 코발트): 콤보 한 번에 대상 스킬 1번 × 터뜨리는 비율, 초당은 대상 스킬 빈도
      else if (tr.type === "boundCast") { const v = hitD * out.boundCastRate; out.augCombo += hit * (targetable ? weave : 0); out.augDps += v; out.castDps += v; out.castDpsUsed += v * EXP.skillShare; }
      else out.augCombo += hit;
    }
    out.combo += out.augCombo;
    // 치유 감소(고통스러운 상처 40%): 상대가 한타에서 회복할 양 중 못 하게 막는 몫 = 그만큼 더 깎은 것과 같다 → 한타 피해에 더한다.
    // 기준 상대의 회복량(TARGET.HEAL)은 상대를 모르면 0 이라 기본 추천에서는 값이 0 이다 (위 TARGET 설명)
    if (cv.healCut && TARGET.HEAL > 0) {
      out.healCut = TARGET.HEAL * Math.min(1, cv.healCut);
      out.combo += out.healCut;
      out.effects.push({ src: "치유 감소", kind: "true", value: out.healCut, hit: out.healCut, trigger: "once" });
    }
    const critMul = 1 + (t.critAuto ?? t.CRIT) * (t.CRITDMG - 1);
    // 한 발에 두 놈: 치명타 평타는 적중 효과를 한 번 더 (conv.onhitOnCrit 번) → 적중 효과에 (1 + 치명타 확률 × 횟수)
    // 구인수의 격노검: 다 쌓인 뒤 세 번째 평타마다 적중 효과를 한 번 더 (t.onhitRepeat = 쌓는 동안까지 평균 낸 값)
    const onCrit = 1 + Math.min(1, t.critAuto ?? t.CRIT) * (cv.onhitOnCrit || 0) + (t.onhitRepeat || 0);
    // 평타 한 대의 피해: 보통은 공격력, 기본 공격을 대체하는 스킬이 있으면 그 값 (제리 Q)
    out.autoDps = (out.autoHit || t.AD) * t.AS * critMul * physMit * dpsAdj("physical") * dealt * (1 + flags.trueBonus)
      + out.spellOnhit * t.AS * onCrit;
    // ---- 버티는 힘: 체력 × 저항 + 무적·피해 감소(그동안 받을 피해) + 생명선 회복 + 아이템 피해 감소
    // 흡혈: 콤보 한 번(COMBO_WINDOW 초) 동안 준 피해로 회복한 만큼 더 버틴다. 생명력 흡수는 기본 공격 피해만, 모든 피해 흡혈은 스킬·효과 피해까지.
    // 예전엔 흡혈 수치를 합계만 내고 점수엔 안 써서 '마도사의 주스 상자'(모든 피해 흡혈 10%)가 누구에게나 이득 0 → D 였다 (2026-10-22 점검)
    const autoCombo = out.autoDps * COMBO_WINDOW;
    out.vampHeal = ((t.LS || 0) * autoCombo + (t.OMNIVAMP || 0) * (autoCombo + out.combo)) * (aram.healing || 1);
    // 흡수(skillVamp): 스킬로 준 피해(방어 적용 후)의 일부를 '내' 체력으로 회복 → 흡혈과 같은 칸에 넣는다.
    // v0.1.95 Phase 4 E1 전에는 out.heal(아군에게 준 회복)에 더해, 버티는 힘에서 빠지고 지원 지표를 부풀리고
    // 상대 회복량 추정(app.js selfHealOf)에도 안 잡혔다. 생명력 흡수·모든 피해 흡혈과는 출처가 달라 겹치지 않는다
    if (cv.skillVamp) {
      out.skillVampHeal = out.spells.reduce((a, sp) => a + sp.dmg, 0) * cv.skillVamp * (aram.healing || 1) * (1 + t.HSP);
      out.vampHeal += out.skillVampHeal;
    }
    // 정령의 형상 '무한한 활력': 자신이 받는 회복·보호막 증가 → 자기 회복(생명선·흡혈·아이템 자기 회복·보호막)에 곱한다
    // 챔피언 기술의 자기 회복·보호막(out.selfHeal·selfShield)도 버티는 힘으로 (v0.1.93 P4-A, 예전엔 지원 지표에 들어갔다)
    // 네 칸을 갈라 둔다 (E1): 자기 회복 selfHealAll · 아군 회복 heal · 자기 보호막 selfShieldAll · 아군 보호막 shield
    out.selfHealAll = ((cv.selfHeal || 0) + out.vampHeal + out.itemSelfHeal + out.selfHeal) * (1 + (cv.selfHealMult || 0));
    out.selfShieldAll = (out.itemSelfShield + out.selfShield) * (1 + (cv.selfHealMult || 0));
    // v0.1.95 Phase 4 E4·F12: 회복도 보호막도 아닌 두 갈래를 따로 둔다.
    //   selfHp     최대 체력·현재 체력 증가 (원형질 안전벨트 '생명선' 의 최대 체력 몫)
    //   selfAbsorb 주문 방어막·피해 흡수 (감시의 장막 '적의 다음 스킬을 막아 주는 주문 방어막')
    // 둘 다 '자신이 받는 회복·보호막 효과 증가'(정령의 형상 무한한 활력)의 대상이 아니라 곱하지 않는다.
    // 버티는 힘에는 네 갈래 모두 들어가고, 죽음의 순환(회복 → 피해)은 selfHealAll 만 읽는다.
    out.selfHpAll = cv.selfHp || 0;
    out.selfAbsorbAll = cv.selfAbsorb || 0;
    // 죽음의 순환(healToDamage): 원본은 '체력을 회복하거나 재생하면 그 70% 만큼 가장 가까운 적에게 마법 피해'.
    // 그래서 자기 회복만 센다 — 보호막은 회복이 아니고(E2 전에는 아군에게 준 회복을 읽었다), 체력 재생은 아직 모델에 없다.
    // 한 번만 돈다: 이 피해로 다시 흡혈하지 않는다 (피해 → 회복 → 피해 순환을 끊으려고 흡혈을 먼저 구한 뒤에 더한다)
    if (cv.healToDamage && out.selfHealAll > 0) {
      const hd = out.selfHealAll * cv.healToDamage * magMit * dealt;
      out.augCombo += hd;
      out.combo += hd;
      out.effects.push({ src: "회복 → 피해", kind: "magic", value: out.selfHealAll * cv.healToDamage, hit: hd, trigger: "once" });
    }
    const extraHp = out.selfHealAll + out.selfShieldAll + out.selfHpAll + out.selfAbsorbAll;
    // 무적·피해 감소(존야 시간 정지·천상의 구원 …): 그동안 '안 받는 피해'는 저항을 지난 뒤 단위(받는 피해 초당)예요.
    // 버티는 힘은 맞을 수 있는 생피해 단위라, 바꿀 때 기준 상대의 저항 배수를 써요. 내 저항으로 곱하면 방어력이 높을수록
    // 무적이 커져 탱커가 최대 2.5배 과대평가됐어요 (2026-11-16 존야 실험에서 드러남, docs/v0.1.93_P4B_1단계_존야.md).
    // 여러 효과가 겹쳐도 한타 길이(AUTO_FIGHT_SEC)를 넘지 않아요. ÷2 는 '위험할 때 쓴다'는 기존 가정 그대로예요.
    out.avoidSec = Math.min(AUTO_FIGHT_SEC, (cv.invulnSec || 0) + (cv.drSec || 0));
    const avoided = out.avoidSec * TARGET.DPS_TAKEN / 2;
    out.ehpPhys = ((t.HP + extraHp) * (1 + t.ARMOR / 100) + avoided * (1 + TARGET.ARMOR / 100)) * (1 + (cv.ehpPhysMult || 0)) / taken;
    out.ehpMag = ((t.HP + extraHp) * (1 + t.MR / 100) + (cv.ehpMagFlat || 0) * (1 + t.MR / 100) + avoided * (1 + TARGET.MR / 100)) / taken;
    if (cv.ehpMult) { out.ehpPhys *= 1 + cv.ehpMult; out.ehpMag *= 1 + cv.ehpMult; }  // 상대 피해량 감소 (감쇠 광선)
    // 받는 피해의 마법 비율: 게임 중이면 적 구성(라이엇 주 피해 유형)으로, 모르면 반반
    const mag = opts && typeof opts.enemyMagic === "number" ? opts.enemyMagic : 0.5;
    out.ehp = out.ehpPhys * (1 - mag) + out.ehpMag * mag;
    // ---- 기동성: 평균 이동 속도 (궁극기 후 가속 영역 등 가동률 반영)
    out.mobility = t.MS * (1 + (cv.ultTriggerMs || 0) * ultUptime(cv.ultTriggerDur));
    // ---- 제어력: 콤보 한 번에 거는 CC 시간 (스킬·패시브 + 증강·아이템)
    let control = (champ.passive && champ.passive.cc) || 0;
    for (const sp of out.spells) if (!sp.disabled) control += (champ.spells.find((x) => x.slot === sp.slot) || {}).cc || 0;
    // 라일라이의 수정홀 '서리'는 "스킬로 적에게 피해를 입히면" 터진다 → 피해가 나는 스킬 칸만 센다.
    // 2026-11-17 v0.1.93 P3-F: 스킬 칸 수(casts)로 세어 173명 전부 제어력이 1.20 으로 같았고,
    // 피해 스킬이 1개뿐인 타릭도 4개로 셌다 (피해 없는 스킬을 가진 챔피언 103명)
    const dmgCasts = out.spells.filter((s) => !s.disabled && s.dmg > 0).length;
    control += (cv.controlSec || 0) + (cv.controlPerCast || 0) * dmgCasts;
    if (cv.fearPerCast) for (const sp of out.spells) if (!sp.disabled) control += Math.min(cv.fearPerCast, sp.cd / (cv.fearCdDiv || 20));
    out.control = control;
    // 스킬을 쿨마다 계속 쓰는 가정은 과대평가라 스킬 피해와 스킬에 딸린 효과는 SKILL_DPS_SHARE 만
    out.dps = out.autoDps * EXP.autoUptime + EXP.skillShare * out.skillDps + (out.augDps - out.castDps - out.atkDps) + out.atkDps * EXP.autoUptime + out.castDpsUsed;
    // 행동 불가 시간 (존야 '시간 정지' 같은 무적): 그동안 공격을 못 하니 한타 시간에서 그만큼 초당 피해를 뺀다.
    // 콤보(스킬 한 바퀴)는 빼지 않는다 — 멈춘 동안 못 쓴 스킬은 사라지는 게 아니라 뒤로 밀리니까 (한타가 끝나면 잃지만, 그 비율을 정할 근거가 없다).
    // 쓰는 시점·적 공격 집중도는 모르니 '한타 내내 한 번 쓴다'는 가정이에요 (실게임 미검증)
    if (cv.stopSec) {
      // 멈춰 있는 동안에도 '시간마다' 들어가는 피해(지속 피해·소환물·장판: 리안드리 화상, 모르가나 W, 자이라 식물 …)는 계속 들어간다.
      // 그래서 평타·스킬 쪽 초당 피해에서만 뺀다 (v0.1.93, 존야 실험)
      const keepDps = out.augDps - out.castDps - out.atkDps;  // 시간 발동(time) 몫
      out.stopLoss = Math.max(0, out.dps - keepDps) * Math.min(1, cv.stopSec / AUTO_FIGHT_SEC);
      out.dps -= out.stopLoss;
    }
    out.support = out.shield + out.heal + out.allyDmg;
    // 서포터 아이템: 아군을 돕는 챔피언(allysupport)이면 그 도움을 다른 아군에게 더 준다 (rules.json items).
    // 월석 재생기 연쇄(회복 30%·보호막 35%), 헬리아의 메아리(감소 전 피해 30% 충전 → 아군 회복, 최대 80~250).
    // 예전엔 수치로 안 잡혀 서포터 1위가 리치베인 같은 피해 아이템이었다 (2026-10-20 공식 추천 차이 분석)
    if ((champ.features || []).includes("allysupport")) {
      const hsp = (aram.healing || 1) * (1 + t.HSP);
      // 월석 재생기 연쇄는 아군을 회복·보호막으로 도울 때만 터진다: 챔피언 기술로 준 양(kitHeal·kitShield)만 쓴다.
      // 2026-11-14 아이템 자기 보호막(스테락의 도전 1,400·케이닉 루컨 700)까지 연쇄해 레나타 기본 빌드가 스테락·케이닉·워모그가 됐다
      const chain = out.kitHeal * (cv.allyHealMult || 0) + out.kitShield * (cv.allyShieldMult || 0);
      const helia = cv.dmgToAllyHeal ? Math.min(cv.allyHealCap || Infinity, out.comboRaw * cv.dmgToAllyHeal) * hsp : 0;
      // 사용 효과로 아군을 돕는 아이템 (구원·미카엘의 축복 회복, 강철의 솔라리 펜던트 보호막): 한타 1번에 1번, 아군 한 명 (rules items).
      // 2026-11-14 레나타·소라카 기본 빌드가 서포터 아이템 → 딜 아이템으로 바뀐 원인: 이 효과들이 지원 지표에 없어 피해 아이템보다 늘 낮았다
      const active = (cv.allyActiveHeal || 0) * hsp + (cv.allyActiveShield || 0) * (aram.shielding || 1) * (1 + t.HSP);
      out.allySupport = chain + helia + active;
      out.support += out.allySupport;
    }
    return out;
  }

  function evaluate(champ, L, items, augStats, opts) {
    const stats = computeStats(champ, L, items, augStats, opts);
    return { stats, m: metrics(champ, L, stats, opts) };
  }

  const api = { SKILL_DPS_SHARE, setExperiment, ROWS, TARGET, DEFAULT_TARGET, ALLY, ALLY_TARGETS, allyGain, ASSUMPTIONS, setTarget, targetBelowShare, baseStats, computeStats, metrics, evaluate, ranksAt, mitigation, shredExpect };
  if (typeof module !== "undefined") module.exports = api;
  else root.Stats = api;
})(this);
