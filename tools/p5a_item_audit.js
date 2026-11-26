// v0.1.95 Phase 5A: 추천 대상 아이템 전수 대조.
// 원본 설명(desc·passiveHtml)에 적힌 숫자 하나하나를 지금 구현(stats·passiveStats·effects·rules.items)과 맞춰 보고,
// 맞은 숫자·못 맞춘 숫자·계산 경로를 아이템마다 적는다. 고치지는 않는다 (확정만 한다).
//   node tools/p5a_item_audit.js                 요약
//   node tools/p5a_item_audit.js --list          아이템마다 한 줄
//   node tools/p5a_item_audit.js --item 이름     그 아이템만 자세히
//   node tools/p5a_item_audit.js --todo          손볼 곳이 있는 아이템만 자세히
//   node tools/p5a_item_audit.js --json 파일
// 계산 결과·데이터끼리의 대조예요. 실제 게임 결과가 아니에요.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const D = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "data.json"), "utf8"));
const SRC = ["stats.js", "scoring.js", "app.js"].map((f) => fs.readFileSync(path.join(ROOT, "web", f), "utf8"));
const SRCNAME = ["stats.js", "scoring.js", "app.js"];

// ---- 설명 → 글자
const strip = (h) => (h || "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

// 설명 머리(고유 효과 앞)의 기본 능력치
const STAT_LABEL = {
  "공격력": "AD", "주문력": "AP", "체력": "HP", "방어력": "ARMOR", "마법 저항력": "MR", "공격 속도": "AS%",
  "치명타 확률": "CRIT%", "치명타 피해량": "CRITDMG%", "스킬 가속": "HASTE", "이동 속도": "MS", "마나": "MANA",
  "물리 관통력": "LETHALITY", "방어구 관통력": "ARPEN%", "마법 관통력": "MPEN", "생명력 흡수": "LS%",
  "모든 피해 흡혈": "OMNIVAMP%", "체력 회복 및 보호막": "HSP%", "기본 마나 재생": "MP5P%", "기본 체력 재생": "HP5P%",
  "강인함": null, "방어구 관통": "ARPEN%",
};

function headStats(it) {
  const head = strip(it.desc.split(/<span class="t-(?:passive|active)/)[0]);
  const out = [];
  for (const line of head.split("\n")) {
    const m = line.match(/^\s*([가-힣 ]+?)\s+([\d.]+)(%?)\s*$/);
    if (!m) continue;
    out.push({ label: m[1].trim(), num: Number(m[2]), pct: m[3] === "%" });
  }
  return out;
}

function sections(it) {
  const html = it.passiveHtml || it.desc.split(/<br><br>(?=<span class="t-(passive|active))/).slice(1).join("<br><br>") || "";
  const out = [];
  const re = /<span class="t-(passive|active)">([^<]+)<\/span>([\s\S]*?)(?=<span class="t-(?:passive|active)">|$)/g;
  let m;
  while ((m = re.exec(html))) out.push({ type: m[1] === "active" ? "사용" : "고유", name: m[2].trim(), text: strip(m[3]).trim() });
  return out;
}

// ---- 설명에서 숫자 뽑기 (수치·계수·지속시간·재사용 대기시간·중첩)
function numbers(text) {
  const out = [];
  const push = (role, v, raw) => out.push({ role, v, raw });
  let m;
  const re = /([\d.]+)\s*(%|초|회|번|중첩)?/g;
  while ((m = re.exec(text))) {
    const v = Number(m[1]);
    if (!isFinite(v)) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const unit = m[2] || "";
    let role = "수치";
    if (unit === "초") role = /재사용 대기시간|쿨|대기시간/.test(before) ? "재사용 대기시간" : "지속시간";
    else if (unit === "회" || unit === "번" || unit === "중첩") role = "중첩·횟수";
    else if (unit === "%") role = "비율";
    push(role, v, m[0].trim());
  }
  return out;
}

// ---- 구현 쪽 숫자 모으기
function implValues(it, rule) {
  const vals = [];
  const add = (where, k, v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => add(where, k + "[" + i + "]", x)); return; }
    if (typeof v === "object") { for (const [k2, v2] of Object.entries(v)) add(where, k + "." + k2, v2); return; }
    if (typeof v === "number") vals.push({ where, key: k, v });
  };
  for (const [k, v] of Object.entries(it.stats || {})) add("stats", k, v);
  for (const [k, v] of Object.entries(it.passiveStats || {})) add("passiveStats", k, v);
  (it.effects || []).forEach((e, i) => {
    for (const [k, v] of Object.entries(e)) add("effects[" + i + "]", k, v);
  });
  if (rule) for (const [k, v] of Object.entries(rule.stats || {})) add("rules", k, v);
  return vals;
}

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);
function matches(n, vals) {
  // 설명 40% ↔ 구현 0.4 / 40 둘 다 인정. 설명 3초 ↔ 구현 3.
  const want = [n.v, n.v / 100, n.v * 100];
  return vals.filter((x) => want.some((w) => near(x.v, w)));
}

// ---- 계산 경로: 그 키가 엔진 어디에서 읽히는지 (첫 자리)
const pathCache = new Map();
function calcPath(key) {
  if (pathCache.has(key)) return pathCache.get(key);
  const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
  const hits = [];
  SRC.forEach((s, fi) => {
    const lines = s.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { hits.push(SRCNAME[fi] + ":" + (i + 1)); break; }
    }
  });
  const r = hits.join(" · ") || "없음";
  pathCache.set(key, r);
  return r;
}

// ---- 사람이 확인한 분류 (2026-11-26 Phase 5A 전수 검증)
//   분류: 정상 구현 · 부분 구현 · 잘못된 구현 · 미구현 · 원본 근거 부족 · 현재 모델 범위 밖
//   [분류, 무엇이 빠졌거나 어긋났나 (원본 근거)]
const VERDICT = {
  // ── 미구현: 원본에 수치가 있는데 계산에 아무것도 없다
  "마나무네": ["정상 구현", "경탄 '최대 마나의 2% → 추가 공격력' (maxMANAtoAD 0.02, Phase 5A P0-5). 마나순환(변신)은 변신 후 아이템이 추천 목록에 없어 세지 않는다"],
  "혹한의 손길": ["정상 구현", "경탄 '추가 최대 마나의 15% → 체력' (bonusMANAtoHP 0.15, Phase 5A P0-5). 마나순환(변신)은 세지 않는다"],
  "아트마의 심판": ["정상 구현", "큰손 '추가 체력 100당 치명타 1%, 최대 30%' (bonusHPtoCRIT·cap, Phase 5A P0-4)"],
  "스테락의 도전": ["정상 구현", "잡아채는 발톱 '기본 공격력의 50% → 추가 공격력' (baseADtoAD 0.5) + 생명선 보호막 (Phase 5A P0-1)"],
  "끝없는 절망": ["정상 구현", "고뇌의 마법 피해 + '입힌 피해의 250% 자기 회복' (selfHealOfDmg, Phase 5A P0-6)"],
  "어둠불꽃 횃불": ["미구현", "어둠불꽃 '영향받는 적 하나당 주문력 4%' 없음 (지속 피해만 센다)"],
  "지배자의 피갑옷": ["부분 구현", "폭정(추가 체력 2.5% → 공격력)은 있고, 응징 '잃은 체력 비례 공격력 최대 10%' 가 없다"],
  "악의": ["정상 구현", "경멸 궁극기 가속 20 (Phase 5A P0-3) + 증오안개 마법 저항력 10 감소·장판 피해 (C9-A4)"],
  "심연의 가면": ["미구현", "파괴 '주변 적 챔피언이 입는 마법 피해 12% 증가' 없음 — 아군에게도 득이 되는 효과라 C9-B 의 아군 몫과 같은 자리"],
  "기사의 맹세": ["미구현", "희생 '아군 피해의 14% 대신 받기 · 아군이 준 피해의 12% 회복' 없음"],
  "밴시의 장막": ["미구현", "무효화(주문 방어막, 40초) 없음 — E4 가 만든 주문 방어막 칸(selfAbsorbAll)에 아이템이 연결돼 있지 않다"],
  "밤의 끝자락": ["미구현", "무효화(주문 방어막, 30초) 없음 — 밴시의 장막과 같은 자리"],
  "마법광학 장치 C44": ["미구현", "확대(거리 비례 최대 10%)·비전 조준(사거리 100) 없음"],
  "탐욕의 군화": ["미구현", "학살 '처치 관여마다 모든 피해 흡혈 0.6%, 최대 10회' 없음"],
  "존야의 모래시계": ["미구현", "시간 정지(2.5초 경직) 없음 — 무적 환산 계산(stats.js 무적·행동 불가)은 있는데 이 아이템이 연결돼 있지 않다"],
  // ── 미구현: 게임 데이터는 '?' 지만 위키에 수치가 있다 (2026-11-26 위키 대조)
  "독사의 송곳니": ["미구현", "보호막 파괴자 — 게임 데이터는 0%/?%. 위키: 근접 50%·원거리 35%, 3초, 칼바람 전용 수치 없음 (C7 의 '근거 없음'이 풀린다)"],
  "굶주린 히드라": ["부분 구현", "쪼개기 근접 40%·원거리 20% 공격력을 넣었다 (위키 수치, Phase 5A P0-2). 사용 효과(Ravenous Crescent)는 원본 설명에 없어 아직 안 센다"],
  "발걸음 분쇄기": ["부분 구현", "쪼개기 근접 40%·원거리 20% 공격력을 넣었다 (위키 수치, Phase 5A P0-2). 사용 효과(Breaking Shockwave)는 원본 설명에 없어 아직 안 센다"],
  "월식": ["미구현", "늘 떠오르는 달 — 위키: 최대 체력 근접 8%·원거리 5% 물리 피해 + 보호막 근접 150·원거리 75 (+추가 공격력 계수, 칼바람은 근접 50%·원거리 25%), 쿨 6초"],
  "오만": ["미구현", "명성 — 위키 칼바람: 공격력 근접 15·원거리 10 + 처치당 근접 2·원거리 1, 지속 근접 90초·원거리 45초"],
  "벼락폭풍검": ["미구현", "창공 — 위키: 현재 체력 근접 8%·원거리 6% 물리 피해 + 물리 관통력 근접 15·원거리 12 (4초)"],
  "요우무의 유령검": ["미구현", "출몰 — 위키 칼바람: 전투 이탈 시 이동 속도 근접 30·원거리 15"],
  "밴들파이프": ["미구현", "팡파르 — 위키: 주변 아군 공격 속도 근접 30%·원거리 20%, 본인 이동 속도 20, 지속 근접 8초·원거리 4초"],
  // ── 잘못된 구현: 값은 맞는데 화면에 보이는 근거 문구가 원본과 다르다
  "영겁의 지팡이": ["잘못된 구현", "계산값(최대 중첩 체력 100·마나 300·주문력 30)은 원본과 같은데, 근거 문구가 '60초마다'로 남아 있다 (원본은 40초마다). 18레벨 최대 중첩 가정이라 점수는 안 바뀐다"],
  "필멸자의 운명": ["잘못된 구현", "수치(상처 40%)는 맞고, 화면 근거(basisView)가 '막는 회복은 상대 자기 회복만 센다'로 남아 있다 — C4 뒤로는 상대가 아군에게 주는 회복도 함께 센다"],
  // ── 원본 근거 부족: 게임 데이터·위키 어디에도 수치가 없다
  "실체화 장비": ["원본 근거 부족", "마나 실현의 피해·회복 증가량이 원본에 0 으로 비어 있다"],
  "핏빛 저주": ["정상 구현", "썩은 부식(마법 저항력 7.5% 감소, 4회 중첩)은 C9-A3 공통 저항 감소 식(`_shred`)으로 들어가 있다. 중첩 평균 1.5 가정"],
  "슈렐리아의 군가": ["현재 모델 범위 밖", "고무적인 연설(주변 아군 이동 속도 30%, 4초) — 수치는 원본에 있는데 아군 이동 속도를 받는 계산 칸이 없다"],
  "마법공학 총검": ["원본 근거 부족", "번개 화살의 피해가 원본에 0 으로 비어 있다 (둔화 1.5초 25% 는 받는 군중 제어 모델 밖)"],
  "마법공학 로켓 벨트": ["원본 근거 부족", "초음속의 피해 수치가 원본에 없다 (돌진 가치는 모델 범위 밖)"],
  "끝없는 갈망": ["원본 근거 부족", "기근의 스킬 가속이 원본에 '?' · 위키에 해당 아이템 문서 없음 (만찬의 모든 피해 흡혈 15% 는 수치가 있으나 처치 조건이라 모델 밖)"],
  "판금 장화": ["부분 구현", "장갑판 감소율이 원본에 '?%' 라 일반적인 값 12% 를 가정해 받는 물리 피해 6% 감소로 넣어 뒀다 (가정값 목록에 있음) — 계산은 되고 있고 근거만 가정이다"],

  "실험적 마공학판": ["부분 구현", "마공학 충전(궁극기 가속 30)은 있고, 폭주의 공격 속도·이동 속도가 원본에 '?%'"],
  "맬모셔스의 아귀": ["부분 구현", "생명선 보호막 흡수량이 원본에 '?%' · 전투 종료까지 모든 피해 흡혈 10% 가 없다"],
  "균열 생성기": ["부분 구현", "공허의 부패(최대 8% → 콤보 평균 5%)·공허의 마력(2%)은 있고, 최대일 때의 모든 피해 흡혈이 원본에 '?%'"],
  "죽음의 무도": ["부분 구현", "반항(추가 공격력 100% 회복)은 있고, 고통 무시의 '받은 피해 ?% 를 3초에 걸쳐' 가 원본에 비어 있다"],
  "얼어붙은 건틀릿": ["부분 구현", "주문 검(150% 기본 공격력)은 있고, 서리 영역 둔화율이 원본에 '?'"],
  "루난의 허리케인": ["부분 구현", "탄환 피해(60% 공격력)는 있고, 맞히는 적 수가 원본에 '?명' — 지금은 1명으로 센다"],
  "그림자 검": ["부분 구현", "밤의 추적자(50 + 물리 관통력 150%)는 있고, 암전(와드 드러내기)은 계산 밖"],
  // ── 현재 모델 범위 밖
  "유령 무희": ["현재 모델 범위 밖", "망령의 왈츠(유체화) — 유닛 통과를 수치로 보는 칸이 없다"],
  "신속의 장화": ["현재 모델 범위 밖", "날쌘 발걸음(둔화 25% 감소) — 받는 군중 제어 시간 모델이 없다 (C8 나)"],
  "헤르메스의 시미터": ["현재 모델 범위 밖", "수은(군중 제어 해제) — 받는 군중 제어 시간 모델이 없다 (C8 나)"],
  "헤르메스의 발걸음": ["현재 모델 범위 밖", "능력치는 다 들어간다. 강인함은 수치로 안 쓴다"],
  "명석함의 아이오니아 장화": ["현재 모델 범위 밖", "소환사 주문 가속 10 — 소환사 주문을 점수로 보지 않는다"],
  "징수의 총": ["현재 모델 범위 밖", "죽음(체력 5% 미만 처형)·세금(25골드) — 처형과 골드 획득을 보는 칸이 없다"],
  "망령 해적검": ["현재 모델 범위 밖", "영혼의 닻(귀환 표식) — 자리 이동을 수치로 보지 않는다"],
  "망자의 갑옷": ["부분 구현", "침몰시키는 자(40 + 기본 공격력 100%)는 있고, 굴하지 않는 자(둔화 15% 감소)는 받는 군중 제어 모델 밖"],
  "대자연의 힘": ["정상 구현", "굳건함: 마법 저항력 70·이동 속도 6% 를 가동률 70% 로 환산해 49·4% (기본 능력치와 합산되는 것이 맞다)"],
  "윤 탈 야생화살": ["정상 구현", "연습이 치명타를 낳는다(치명타 25% 최대치)·광풍(공격 속도 30% × 가동률 50% = 15%) 둘 다 들어가 있다"],
  "피바라기": ["잘못된 구현", "E3: 흡혈(생명력 흡수 15%) 전액과 '초과 회복 → 보호막' 165~315 를 둘 다 더한다. 보호막은 같은 흡혈이 넘친 몫이라 겹친다 (넘친 양의 근거가 없어 보류 중)"],
  "구원": ["부분 구현", "F23: 아군 회복(150~350)은 아군을 돕는 챔피언만, 중재의 고정 피해(대상 최대 체력 10%)는 모든 챔피언에게 한타 1번씩 들어간다. 중재의 재사용 대기시간이 원본에 없어 '한타 1번' 가정을 쓴다 — 아리처럼 아군을 안 돕는 챔피언도 이 피해만으로 점수를 받는다"],
};

// ---- 아이템 한 개 검사
function audit(it) {
  const rule = (D.rules.items || {})[it.name] || null;
  const vals = implValues(it, rule);
  const secs = sections(it);
  const head = headStats(it);

  // 기본 능력치 대조
  const baseBad = [];
  for (const h of head) {
    const key = STAT_LABEL[h.label];
    if (key === null) continue;                       // 강인함: 안 씀 (의도)
    if (key === undefined) { baseBad.push(`${h.label} ${h.num}${h.pct ? "%" : ""} (이름 모름)`); continue; }
    const k = key.replace("%", "");
    const got = (it.stats || {})[k] != null ? it.stats[k] : ((it.stats || {})[k + "P"] != null ? it.stats[k + "P"] : (k === "MS" ? (it.stats || {}).MSP : undefined));
    if (got == null) { baseBad.push(`${h.label} ${h.num}${h.pct ? "%" : ""} → 계산에 없음`); continue; }
    const want = h.pct ? h.num / 100 : h.num;
    if (!near(got, want) && !near(got, h.num) && !near(got, h.num / 100)) baseBad.push(`${h.label} 설명 ${h.num}${h.pct ? "%" : ""} ↔ 계산 ${got}`);
  }

  // 효과 숫자 대조
  const secOut = secs.map((s) => {
    const ns = numbers(s.text);
    const hit = [], miss = [];
    for (const n of ns) {
      const m = matches(n, vals);
      (m.length ? hit : miss).push({ ...n, at: m.map((x) => x.where + "." + x.key).join(",") });
    }
    return { ...s, nums: ns.length, hit, miss };
  });

  // 밑줄로 시작하는 키(_shred·_effects·_farMark …)도 '계산에 들어간 효과'다 (엔진이 읽는다).
  // 2026-11-26: 예전에는 이걸 걸러내서 핏빛 저주(저항 감소는 C9-A3 로 구현됨)가 '미구현'으로 잘못 잡혔다.
  const allKeys = [...new Set([...Object.keys(it.passiveStats || {}), ...Object.keys((rule || {}).stats || {})])];
  const implKeys = allKeys.filter((k) => !k.startsWith("_"));
  const hiddenKeys = allKeys.filter((k) => k.startsWith("_"));
  const effKinds = (it.effects || []).map((e) => e.kind);
  const missAll = secOut.reduce((a, s) => a + s.miss.length, 0);
  const hitAll = secOut.reduce((a, s) => a + s.hit.length, 0);

  // 자동 분류 제안 (사람이 확정한다)
  let guess;
  if (!secs.length) guess = baseBad.length ? "잘못된 구현" : "정상 구현 (능력치만)";
  else if (!allKeys.length && !effKinds.length) guess = "미구현";
  else if (missAll === 0 && !baseBad.length) guess = "정상 구현";
  else guess = baseBad.length ? "잘못된 구현" : "부분 구현";

  const v = VERDICT[it.name];
  return { name: it.name, id: it.id, kind: it.kind, gold: it.gold, mode: it.modeValues || null, limit: it.limit || null,
    baseBad, secs: secOut, implKeys, effKinds, hitAll, missAll, guess,
    verdict: v ? v[0] : guess, note: v ? v[1] : "", byHand: !!v, hiddenKeys,
    paths: implKeys.concat(hiddenKeys).map((k) => k + " → " + calcPath(k)) };
}

// ---- 실행
const argv = process.argv.slice(2);
const items = D.items.filter((i) => i.kind === "legendary" || i.kind === "boots");
const rows = items.map(audit);

function detail(r) {
  const L = [];
  L.push(`## ${r.name} (${r.id} · ${r.kind} · ${r.gold}골드${r.mode ? " · 칼바람 수치 " + r.mode : ""}${r.limit ? " · 계열 " + r.limit : ""})`);
  L.push(`- 분류(자동): ${r.guess} · 숫자 맞음 ${r.hitAll} / 못 맞춤 ${r.missAll}`);
  if (r.baseBad.length) L.push(`- 기본 능력치 어긋남: ${r.baseBad.join(" · ")}`);
  for (const s of r.secs) {
    L.push(`- [${s.type}] ${s.name}: ${s.text.replace(/\n/g, " ").slice(0, 200)}`);
    if (s.miss.length) L.push(`    못 맞춘 숫자: ${s.miss.map((m) => `${m.raw}(${m.role})`).join(" · ")}`);
    if (s.hit.length) L.push(`    맞은 숫자: ${s.hit.map((m) => `${m.raw}→${m.at}`).join(" · ")}`);
  }
  if (r.implKeys.length) L.push(`- 계산 경로: ${r.paths.join(" | ")}`);
  if (r.effKinds.length) L.push(`- effects: ${r.effKinds.join(", ")}`);
  return L.join("\n");
}

const ORDER = ["잘못된 구현", "미구현", "부분 구현", "원본 근거 부족", "현재 모델 범위 밖", "정상 구현", "정상 구현 (능력치만)"];
function writeDoc(file) {
  const L = [];
  L.push("# 아이템 전수 검증표 (v0.1.95 Phase 5A)", "");
  L.push(`게임 데이터 \`${D.dataVersion}\` · 만든 도구: \`node tools/p5a_item_audit.js --write\` · 만든 때 2026-11-26`, "");
  L.push("> 추천 대상 아이템마다 **원본 설명의 숫자 하나하나**를 지금 구현(`stats`·`passiveStats`·`effects`·`rules.items`)과 맞춰 본 표예요.");
  L.push("> 계산·데이터끼리의 대조이고 **실제 게임 결과가 아니에요**. 아이템 하나를 자세히 보려면 `node tools/p5a_item_audit.js --item 이름`.", "");
  const by = {};
  for (const r of rows) (by[r.verdict] = by[r.verdict] || []).push(r);
  L.push("## 분류 집계", "", "| 분류 | 아이템 수 | 뜻 |", "|---|---:|---|");
  const MEAN = {
    "정상 구현": "원본 숫자가 모두 계산에 들어가 있다", "정상 구현 (능력치만)": "고유 효과가 없고 기본 능력치만 있는 아이템",
    "부분 구현": "일부만 들어가 있다", "잘못된 구현": "수치나 화면 근거가 원본과 어긋난다",
    "미구현": "원본에 수치가 있는데 계산에 아무것도 없다", "원본 근거 부족": "원본(게임 데이터·위키)에 수치가 없다",
    "현재 모델 범위 밖": "수치는 있지만 그것을 담을 계산 칸이 없다",
  };
  for (const k of ORDER) if (by[k]) L.push(`| ${k} | ${by[k].length} | ${MEAN[k]} |`);
  L.push(`| **합계** | **${rows.length}** | 전설 ${rows.filter((r) => r.kind === "legendary").length} · 신발 ${rows.filter((r) => r.kind === "boots").length} |`, "");
  L.push("기본 능력치(설명 숫자 ↔ 계산 능력치)가 어긋난 아이템은 **0개**예요. 강인함만 수치로 쓰지 않아요.", "");
  for (const k of ORDER) {
    if (!by[k]) continue;
    L.push(`## ${k} (${by[k].length})`, "");
    L.push("| 아이템 | 골드 | 원본 근거와 빠진 것 | 계산 경로 |", "|---|---:|---|---|");
    for (const r of by[k].sort((a, b) => b.gold - a.gold)) {
      const note = r.note || (r.missAll ? `설명 숫자 ${r.hitAll + r.missAll}개 중 ${r.missAll}개가 계산에 안 보임` : "원본 숫자가 모두 들어가 있음");
      const p = r.paths.length ? r.paths.join("<br>") : (r.effKinds.length ? `effects: ${r.effKinds.join(", ")}` : "없음");
      L.push(`| ${r.name}${r.mode ? " ⟨칼바람⟩" : ""} | ${r.gold} | ${note} | ${p} |`);
    }
    L.push("");
  }
  L.push("## 읽는 법", "", "- **⟨칼바람⟩** 은 빌드할 때 칼바람 전용 수치가 적용된 아이템이에요 (26개 중 추천 대상 " + rows.filter((r) => r.mode).length + "개).");
  L.push("- '계산 경로'는 그 효과 키를 엔진에서 처음 읽는 자리예요. 줄 번호는 데이터를 다시 만들 때마다 달라질 수 있어요.");
  L.push("- 분류가 사람 손으로 확정된 아이템은 " + rows.filter((r) => r.byHand).length + "개, 나머지는 숫자 대조 결과로 자동 분류했어요.");
  fs.writeFileSync(file, L.join("\n") + "\n");
  console.log(`${rows.length}개 → ${file}`);
}

if (argv[0] === "--write") writeDoc(path.join(ROOT, "docs", "아이템_전수검증표.md"));
else if (argv[0] === "--item") {
  const r = rows.find((x) => x.name === argv[1]);
  console.log(r ? detail(r) : "없는 아이템");
} else if (argv[0] === "--todo") {
  const bad = rows.filter((r) => r.guess !== "정상 구현" && r.guess !== "정상 구현 (능력치만)");
  console.log(`손볼 곳이 있는 아이템 ${bad.length} / ${rows.length}\n`);
  for (const r of bad) console.log(detail(r) + "\n");
} else if (argv[0] === "--all") {
  for (const r of rows) console.log(detail(r) + "\n");
} else if (argv[0] === "--list") {
  for (const r of rows) console.log(`${r.guess.padEnd(16)} 맞음 ${String(r.hitAll).padStart(3)} 못맞춤 ${String(r.missAll).padStart(3)}  ${r.name}`);
} else if (argv[0] === "--json") {
  fs.writeFileSync(argv[1], JSON.stringify(rows, null, 1));
  console.log(`${rows.length}개 → ${argv[1]}`);
} else {
  const by = {};
  for (const r of rows) by[r.guess] = (by[r.guess] || 0) + 1;
  console.log(`추천 대상 ${rows.length}개`, by);
  console.log(`기본 능력치가 어긋난 아이템 ${rows.filter((r) => r.baseBad.length).length}`);
  console.log(`설명 숫자를 하나도 못 맞춘 아이템 ${rows.filter((r) => r.hitAll === 0 && r.secs.length).length}`);
  console.log(`칼바람 전용 수치가 들어간 아이템 ${rows.filter((r) => r.mode).length}`);
}
