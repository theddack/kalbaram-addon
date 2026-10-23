// 증강 원본 대조: 게임 데이터(CommunityDragon kiwi.bin.json)의 증강 효과 값과 우리가 계산에 넣는 값을 효과 항목마다 맞춰 본다.
//   node tools/aug_audit.js            요약 (상태별 개수)
//   node tools/aug_audit.js --write    docs/증강_원본_대조_결과.md + docs/증강_원본_대조.json 생성
//   node tools/aug_audit.js --check    저장된 대조 결과(docs/증강_원본_대조.json)와 비교해 새로 생긴 문제만 마크다운으로 (매일 갱신이 web/review.md 에 덧붙여 이슈로)
// 원본: .cache/kiwi.bin.json · .cache/lol.stringtable.json (build_data.py 가 받아 둔 것, 버전은 .cache/content-metadata.json)
// 비교 대상: web/data.json (증강 effects = 툴팁에서 자동으로 뽑은 효과, rules.augments.*.statsResolved = 계산에 쓰는 값) + rules.json (사람이 적은 규칙 원문)
//
// 효과 항목 = 툴팁의 @자리표시자@ 하나 (플레이어가 보는 수치). 툴팁에 안 나오는 원본 값은 따로 센다.
// 상태 (기획서 4.4):
//   일치         원본 값이 계산에 그대로 들어간다 (이름으로 연결·자동 추출·같은 숫자)
//   불일치       계산에 쓰는 값이 원본과 다르다
//   미구현       원본 효과가 계산 어디에도 안 쓰인다
//   가정         원본으로 정할 수 없는 값(평균 중첩·발동 횟수 등)을 정해서 쓴다
//   원본 확인 불가 원본에서 값을 찾지 못했다
//   계산 제외    일부러 계산하지 않는다 (이유가 규칙·종류에 있다)
// 연결 방식: 이름 참조(패치 수치를 따라감) · 자동 추출 · 설명 자동 추정 · 숫자 직접 입력(패치로 바뀌면 안 따라감) · 배수 가정
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const CACHE = path.join(ROOT, ".cache");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

const STATES = ["일치", "불일치", "미구현", "가정", "원본 확인 불가", "계산 제외"];
// 효과 항목 종류 (기획서 4.3): 원본 값 이름으로 나눈다
const KINDS = [
  ["발동 주기", /^(?!.*refund).*(cooldown|(^|_)cd|icd|timer|interval|every|period|rate$)/i],
  ["지속 시간", /duration|time|seconds|window|linger/i],
  ["중첩", /stack|max(count|num)|count|charges|cap/i],
  ["거리·범위", /range|radius|distance|size/i],
  ["성장", /level|lvl|perlevel|scal/i],
  ["확률", /chance|percent?chance/i],
];
const kindOf = (name) => (KINDS.find(([, re]) => re.test(name)) || ["수치"])[0];

function expandTemplates(text, strings, depth = 0) {
  return String(text || "").replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => {
    const key = k.replace(/@[^@]*@/g, "").trim().toLowerCase();
    if (key === "spellname" || key === "spellnameonly" || depth > 3) return "";
    return expandTemplates(strings[key] || "", strings, depth + 1);
  });
}

// 계산식 하나가 쓰는 원본 값 이름 (다른 계산식 참조까지 따라감)
function calcDeps(calcs, name, seen = new Set()) {
  const out = new Set();
  const c = calcs[String(name).toLowerCase()];
  if (!c || seen.has(String(name).toLowerCase())) return out;
  seen.add(String(name).toLowerCase());
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const k of ["mDataValue", "StartDataValue", "EndDataValue"]) if (typeof o[k] === "string") out.add(o[k].toLowerCase());
    if (typeof o.mSpellCalculationKey === "string") for (const d of calcDeps(calcs, o.mSpellCalculationKey, seen)) out.add(d);
    Object.values(o).forEach(walk);
  };
  walk(c);
  return out;
}

// CommunityDragon 은 이름을 모르는 값·계산식을 FNV-1a 32비트 해시({90a024ae})로 적는다 (소문자 이름의 해시)
const fnv = (str) => {
  let h = 0x811c9dc5;
  for (const c of Buffer.from(String(str).toLowerCase())) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return `{${h.toString(16).padStart(8, "0")}}`;
};

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-3);

function audit() {
  const kiwi = read(path.join(CACHE, "kiwi.bin.json"));
  // 26.21 부터 새 문자열은 해시 키로만 있다 → build_data 가 해시로 찾아 둔 것(stringtable.found.json)을 합친다.
  // 없으면 새 증강 툴팁이 빈 문자열이라 자리표시자 0개 → '새 문제 없음'으로 지나갔다 (2026-10-23 점검)
  let found = null;
  try { found = read(path.join(CACHE, "stringtable.found.json")); } catch (e) { found = null; }
  if (!found) throw new Error(".cache/stringtable.found.json 이 없어요 — python build_data.py 를 먼저 돌리세요");
  const strings = { ...read(path.join(CACHE, "lol.stringtable.json")).entries, ...found };
  const meta = read(path.join(CACHE, "content-metadata.json"));
  const d = read(path.join(ROOT, "web", "data.json"));
  const rulesRaw = read(path.join(ROOT, "rules.json")).augments;
  const built = d.rules.augments;
  // build_data 계산기가 못 푼 자리표시자 (python tools/aug_resolve_check.py --json). 없으면 이 부분만 빠진다
  let fails = [];
  try { fails = read(path.join(ROOT, "docs", "증강_해석_실패.json")); } catch (e) { fails = null; }
  const failOf = (id, expr) => (fails || []).find((f) => f.id === id && f.ref === expr);
  const augData = {};
  for (const v of Object.values(kiwi)) if (v && v.__type === "AugmentData") augData[v.AugmentNameId] = v;

  const rows = [];      // 효과 항목 (툴팁 자리표시자)
  const hidden = [];    // 툴팁에 안 나오는 원본 값
  const literals = [];  // 규칙에 직접 적은 숫자 (원본 값과 짝이 없는 것)
  const perAug = [];
  const overcount = [];  // 반복 발동 효과에 재사용 대기시간이 빠진 것
  for (const a of d.augments) {
    const src = augData[a.id];
    const spell = src && kiwi[src.RootSpell] && kiwi[src.RootSpell].mSpell;
    const raw = rulesRaw[a.id] || {};
    const rule = built[a.id] || {};
    const info = { id: a.id, name: a.name, rarity: a.rarityName, category: a.category, patch: a.patch || null,
      patchCheck: a.patchCheck || null, auto: !!rule.auto, items: 0 };
    perAug.push(info);
    if (!spell) {
      rows.push({ id: a.id, name: a.name, ref: "-", kind: "-", source: null, applied: null, state: "원본 확인 불가", how: "-",
        why: "kiwi.bin.json 에 이 증강의 스펠 데이터가 없음" });
      continue;
    }
    const dv = {};
    for (const x of spell.DataValues || []) dv[x.name.toLowerCase()] = { name: x.name, values: x.values || [0] };
    const calcs = Object.fromEntries(Object.entries(spell.mSpellCalculations || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const val = (n) => { const x = dv[n]; return x ? (x.values[1] ?? x.values[x.values.length - 1]) : null; };
    // 이름 → 원본에 있는 키 (그대로 없으면 해시 이름). 해시로만 찾은 것은 build_data 가 못 풀어 설명에 '?'로 나간다
    const hashed = new Set();
    const keyOf = (n) => {
      if (dv[n] || calcs[n]) return n;
      const h = fnv(n);
      if (dv[h] || calcs[h]) { hashed.add(n); return h; }
      return n;
    };

    // 툴팁 (build_data 와 같게: 본문이 너무 짧으면 기본 설명)
    let tip = expandTemplates(strings[(src.AugmentTooltipTra || "").toLowerCase()] || "", strings);
    const body = tip.replace(/<flavorText>[\s\S]*?<\/flavorText>|<[^>]+>|\s+/gi, "");
    if (body.length < 15) tip = expandTemplates(strings[(src.DescriptionTra || "").toLowerCase()] || "", strings) || tip;
    const refs = [];
    for (const m of tip.matchAll(/@([^@]+)@/g)) {
      const expr = m[1];
      if (/^f\d+(\.\d+)?(\*[\d.]+)?$/i.test(expr)) continue;  // 게임 중 집계 값 (효과 아님)
      const mm = expr.match(/^([A-Za-z_][\w.]*?)(?:\.0)?(?:\*(-?[\d.]+))?$/);
      if (!mm) { refs.push({ expr, name: null }); continue; }
      const n = keyOf(mm[1].toLowerCase());
      if (!refs.some((r) => r.name === n)) refs.push({ expr, name: n, mul: mm[2] ? Number(mm[2]) : 1, hashed: hashed.has(mm[1].toLowerCase()) });
    }

    // 계산에 쓰이는 원본 값: 자동 추출 효과 · 규칙 stats(이름 참조) · 규칙 effects
    const used = new Map();  // 원본 값 이름 → {how, key, applied}
    const use = (n, how, key, applied) => { n = keyOf(n); if (!used.has(n)) used.set(n, { how, key, applied }); };
    const useCalc = (cn, how, key, applied) => { const k = keyOf(cn.toLowerCase()); use(k, how, key, applied); for (const x of calcDeps(calcs, k)) use(x, how, key, applied); };
    for (const e of a.effects || []) {
      const how = e.trigger && e.trigger.from === "rules.json" ? "규칙 계산식" : "자동 추출";
      const n = String(e.name || "");
      if (calcs[keyOf(n.toLowerCase())]) useCalc(n, how, e.kind, e);
      else use(n.toLowerCase(), how, e.kind, e);
    }
    // 'N초마다'·'재사용 대기시간 N초' 는 설명 문장에서 발동 간격(trigger.sec)으로 읽힌다 → 같은 값의 원본과 연결
    for (const e of a.effects || []) {
      const sec = e.trigger && typeof e.trigger.sec === "number" ? e.trigger.sec : e.cooldown;
      if (!sec) continue;
      const hit = Object.keys(dv).find((n) => near(val(n), sec) && kindOf(dv[n].name) === "발동 주기");
      if (hit) use(hit, "자동 추출 (발동 간격)", "trigger.sec", sec);
    }
    // 반복 발동(기본 공격·스킬마다)으로 세는데 원본의 재사용 대기시간이 빠진 효과 → 발동 횟수를 과대 계산
    for (const e of a.effects || []) {
      const t = (e.trigger || {}).type;
      if (!["onhit", "attacks", "cast"].includes(t) || e.cooldown) continue;
      for (const [n, x] of Object.entries(dv)) {
        if (kindOf(x.name) !== "발동 주기" || !(val(n) > 0)) continue;
        overcount.push({ id: a.id, name: a.name, effect: `${e.kind} ${e.name}`, trigger: t, dv: x.name, sec: val(n),
          desc: (a.desc || "").replace(/<[^>]+>/g, "").match(/[^.]*(재사용 대기시간|초마다)[^.]*/)?.[0]?.trim() || "" });
      }
    }
    const spec = raw.stats || {};
    const res = rule.statsResolved || {};
    const assumes = (raw.basis && raw.basis.assume) || [];
    // 효과 횟수·재사용 대기시간 규칙이 쓰는 원본 값 (탄환 세례 AdditionalBolts, 골드 강탈 TimerDuration …)
    for (const [k, sp] of [["effectCount", raw.effectCount], ["effectCooldown", raw.effectCooldown]]) {
      for (const n of [sp && sp.dv, sp && sp.calc18, sp && sp.critPer].filter(Boolean)) use(String(n).toLowerCase(), "이름 참조", k, null);
    }
    for (const [k, v] of Object.entries(spec)) {
      if (v && typeof v === "object" && "calcRatio" in v) { useCalc(v.calcRatio, "이름 참조", k, res[k]); continue; }
      if (typeof v === "string") use(v.replace(/^-/, "").toLowerCase(), "이름 참조", k, res[k]);
      else if (v && typeof v === "object" && "dv" in v) use(v.dv.toLowerCase(), (v.times ?? 1) !== 1 ? "배수 가정" : "이름 참조", k, res[k]);
      else if (v && typeof v === "object" && ("calc18" in v || "calc" in v)) useCalc(v.calc18 || v.calc, v.stacks ? "배수 가정" : "이름 참조", k, res[k]);
      else if (v && typeof v === "object") for (const n of Object.values(v)) use(String(n).toLowerCase(), "이름 참조", k, res[k]);
    }
    // 숫자만으로 된 계산식(원본 값 참조 없음)의 값: 정신 변환 ManaToHealthCalc 같은 것도 직접 적은 숫자와 짝지을 수 있게
    const constOf = (n) => {
      const c = calcs[n];
      if (!c || calcDeps(calcs, n).size) return null;
      const parts = c.mFormulaParts || [];
      if (!parts.length || !parts.every((p) => p && p.__type === "NumberCalculationPart")) return null;
      return parts.reduce((t, p) => t + (p.mNumber || 0), 0);
    };
    const numOf = (n) => (dv[n] ? val(n) : constOf(n));
    // 직접 적은 숫자: 원본 값과 같으면 그 값과 짝짓는다 (패치로 바뀌면 안 따라감 → 이름 참조로 바꾸면 좋다)
    const pairs = [];
    const descNums = new Set((a.desc || "").replace(/<[^>]+>/g, "").match(/\d+(?:\.\d+)?/g) || []);
    const inDesc = (v) => descNums.has(String(+v.toFixed(4))) || descNums.has(String(+(v * 100).toFixed(4)));
    for (const [k, v] of Object.entries(spec)) {
      if (typeof v !== "number") continue;
      const hit = [...Object.keys(dv), ...Object.keys(calcs)].find((n) => { const x = numOf(n); return x != null && (near(v, x) || near(v, Math.abs(x)) || near(v * 100, x) || near(v, x * 100)); });
      // 값만 같다고 같은 효과는 아니다 (신난다! 이동 속도 0.15 ↔ 공격 속도 버프 ASBuff 0.15). 짝은 참고로만 적고 연결로 세지 않는다
      if (hit) pairs.push({ dv: hit, key: k, value: v });
      literals.push({ id: a.id, name: a.name, key: k, value: v,
        state: assumes.length || (raw.basis && raw.basis.calc) ? "가정" : inDesc(v) ? "일치 (설명 수치)" : "원본 확인 불가",
        why: assumes.length ? assumes.map((x) => x.what).join(" / ") : (raw.basis && raw.basis.calc) || raw.model || "근거 없음",
        sameAs: hit ? (dv[hit] ? dv[hit].name : hit) : undefined });
    }
    // 설명 자동 추정 (rules.json 에 규칙이 없을 때 build_data.auto_stats): 값이 같은 원본 값과 짝
    if (rule.auto) for (const [k, v] of Object.entries(res)) {
      const hit = Object.keys(dv).find((n) => { const x = val(n); return x != null && (near(v, x) || near(v * 100, x)); });
      if (hit) use(hit, "설명 자동 추정", k, v);
    }

    // 일부러 계산하지 않는 증강: 종류(퀘스트·무작위·소환사 주문), 규칙에 '아이템으로 안 커짐'(lift {}) · 메모만
    const excluded = a.category ? { quest: "퀘스트형 (조건 달성 보상이라 시점을 정할 수 없음)", random: "무작위 효과", spell: "소환사 주문 변경" }[a.category]
      : raw.lift && !Object.keys(raw.lift).length && !Object.keys(spec).length ? "규칙: 아이템으로 커지지 않는 효과 (lift {})"
      : !Object.keys(spec).length && !(a.effects || []).length && raw.note ? `규칙 메모만 있음: ${raw.note}` : null;

    for (const r of refs) {
      info.items++;
      if (!r.name) { rows.push({ id: a.id, name: a.name, ref: r.expr, kind: "-", source: null, applied: null, state: "원본 확인 불가", how: "-", why: "자리표시자 형식을 못 읽음" }); continue; }
      const isCalc = !!calcs[r.name];
      const cv = isCalc ? constOf(r.name) : null;
      const source = cv != null ? cv : isCalc ? `계산식 (${[...calcDeps(calcs, r.name)].map((x) => (dv[x] ? `${dv[x].name}=${+val(x).toFixed(4)}` : x)).join(", ") || "상수"})` : val(r.name);
      // 계산식 자리: 계산식 자체가 안 쓰여도 그 안의 원본 값이 쓰이면 연결된 것 (유레카: 규칙이 APToHasteConversion 을 직접 참조)
      const deps = isCalc ? [...calcDeps(calcs, r.name)] : [];
      const viaDep = isCalc && !used.get(r.name) && deps.find((x) => used.has(x));
      const u = used.get(r.name) || (viaDep ? { ...used.get(viaDep), how: used.get(viaDep).how + " (계산식 안의 값)" } : null);
      const row = { id: a.id, name: a.name, ref: r.expr + (r.hashed ? " ⚠해시" : ""), kind: kindOf(r.expr), source, applied: null, how: u ? u.how : "-", key: u ? u.key : null, hashed: r.hashed || undefined };
      if (!isCalc && source == null) {
        Object.assign(row, { state: "원본 확인 불가", why: "툴팁이 가리키는 값이 원본 데이터에 없음" });
      } else if (u) {
        row.applied = u.applied && typeof u.applied === "object" ? "효과식" : u.applied;
        if (u.how === "배수 가정") {
          row.state = "가정";
          row.why = (assumes[0] && assumes[0].what) || "원본 값 × 정한 배수";
        } else if (!isCalc && typeof u.applied === "number" && u.how === "이름 참조" && !near(Math.abs(u.applied), Math.abs(source))) {
          row.state = "불일치";
          row.why = `계산 값 ${u.applied} ≠ 원본 ${source}` + (a.patchCheck ? " (패치 노트 값으로 덮어씀)" : "");
        } else {
          row.state = "일치";
          row.why = u.how === "숫자 직접 입력" ? "값은 같지만 숫자를 직접 적어 패치로 바뀌면 안 따라감" : "";
        }
      } else if (excluded) {
        Object.assign(row, { state: "계산 제외", why: excluded });
      } else if (!isCalc && Object.values(spec).some((v) => typeof v === "number") && (raw.basis || raw.model)) {
        // 계산식(피해·보호막 공식이 많다)은 근사로 치지 않는다: 지옥의 전도체 화상 피해는 규칙이 가속만 근사해 피해가 빠져 있었다
        // 규칙이 이 수치를 직접 참조하지 않고 근사한 값(평균·가동률 등)으로 대신 계산 → 근사 내용을 사람이 확인해야 한다
        Object.assign(row, { state: "가정", how: "근사 규칙", why: (raw.basis && raw.basis.calc) || raw.model });
      } else if (!Object.keys(spec).length && !(a.effects || []).length) {
        Object.assign(row, { state: "미구현", why: raw.tags || Object.keys(a.tags || {}).length ? "수치 계산 없음 (효과 태그 점수로만 반영)" : "계산 어디에도 안 쓰임" });
      } else {
        Object.assign(row, { state: "미구현", why: `이 항목은 안 쓰임 (같은 증강의 다른 값만 계산: ${[...used.values()].map((x) => x.key).filter(Boolean).join(", ") || "-"})` });
      }
      const p = pairs.find((x) => x.dv === r.name);
      if (p && !u) row.why = (row.why ? row.why + " · " : "") + `규칙 ${p.key}=${p.value} 과 값이 같음 (같은 효과인지 확인 필요)`;
      const f = failOf(a.id, r.expr);
      if (f) {
        row.buildFail = f.why;
        row.why = (row.why ? row.why + " · " : "") + `빌드 계산기가 못 풀어 설명에 '?' (${f.why})`;
      }
      rows.push(row);
    }
    // 툴팁에 안 나오는 원본 값
    const tipNames = new Set(refs.map((r) => r.name));
    for (const [n, x] of Object.entries(dv)) {
      if (tipNames.has(n) || [...tipNames].some((t) => calcs[t] && calcDeps(calcs, t).has(n))) continue;
      hidden.push({ id: a.id, name: a.name, value: val(n), dv: x.name, kind: kindOf(x.name), used: used.has(n) ? used.get(n).how : null });
    }
    info.states = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.id === a.id && r.state === s).length]));
  }
  const count = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s).length]));
  return { version: meta.version, dataVersion: d.dataVersion, builtAt: d.builtAt, augments: d.augments.length,
    disabled: d.disabled, rows, hidden, literals, perAug, count, fails, overcount };
}

function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "number") return String(+v.toFixed(4));
  return String(v).replace(/\|/g, "\\|");
}

function markdown(r) {
  const L = [];
  const by = (s) => r.rows.filter((x) => x.state === s);
  L.push("# 증강 원본 대조 결과", "");
  L.push(`게임 데이터 \`${r.version}\` (CommunityDragon \`latest\`, 라이브 서버) · 우리 데이터 \`web/data.json\` ${r.dataVersion} (빌드 ${r.builtAt}).`);
  L.push("원본: `game/maps/modespecificdata/kiwi.bin.json` (증강 스펠 DataValues·계산식) + 한국어 문자열 테이블 (툴팁).");
  L.push("만든 도구: `node tools/aug_audit.js --write` (같은 원본이면 같은 결과). 효과 항목 단위 원본 데이터: `docs/증강_원본_대조.json`.", "");
  L.push("> 이 문서는 **원본 값이 계산에 들어가는지**만 본다. 계산식이 게임과 똑같이 동작하는지(발동 조건·횟수)와 실제 게임 수치는 확인하지 않았다 (기획서 5장·9장).", "");
  L.push("## 요약", "");
  L.push(`- 대상 증강 ${r.augments}개 (비활성 ${r.disabled.length}개 제외: ${r.disabled.join(", ")})`);
  L.push(`- 효과 항목(툴팁 수치) ${r.rows.length}개`, "");
  L.push("| 상태 | 항목 수 | 뜻 |", "|---|---:|---|");
  const mean = { "일치": "원본 값이 계산에 그대로 들어감", "불일치": "계산 값이 원본과 다름", "미구현": "계산 어디에도 안 쓰임",
    "가정": "원본으로 못 정하는 값을 정해서 씀", "원본 확인 불가": "원본에서 값을 못 찾음", "계산 제외": "일부러 계산 안 함 (이유 있음)" };
  for (const s of STATES) L.push(`| ${s} | ${r.count[s]} | ${mean[s]} |`);
  const how = {};
  for (const x of by("일치")) how[x.how] = (how[x.how] || 0) + 1;
  L.push("", "일치 항목의 연결 방식: " + Object.entries(how).map(([k, v]) => `${k} ${v}`).join(" · "));
  const kinds = {};
  for (const x of by("미구현")) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  L.push(`- 미구현 항목 종류: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const lc = (s) => r.literals.filter((x) => x.state === s).length;
  L.push(`- 규칙에 숫자로 직접 적은 값 ${r.literals.length}개: 가정 ${lc("가정")} · 설명에 나온 수치 ${lc("일치 (설명 수치)")} · 근거 없음 ${lc("원본 확인 불가")}. 패치로 원본이 바뀌어도 따라가지 않는다`);
  L.push(`- 툴팁에 안 나오는 원본 값 ${r.hidden.length}개 (그중 계산에 쓰임 ${r.hidden.filter((x) => x.used).length})`, "");

  const table = (list, cols) => {
    L.push("| " + cols.map((c) => c[0]).join(" | ") + " |", "|" + cols.map(() => "---").join("|") + "|");
    for (const x of list) L.push("| " + cols.map((c) => fmt(c[1](x))).join(" | ") + " |");
    L.push("");
  };
  const base = [["증강", (x) => `${x.name} (${x.id})`], ["항목", (x) => x.ref], ["종류", (x) => x.kind], ["원본", (x) => x.source]];
  L.push("## 빌드 계산기가 못 푸는 자리표시자 (설명에 '?')", "");
  if (!r.fails) L.push("`python tools/aug_resolve_check.py --json` 을 먼저 실행해야 나온다.", "");
  else {
    L.push(`${r.fails.length}개 · 증강 ${new Set(r.fails.map((x) => x.id)).size}개. 화면 설명에 '?' 로 나가고, 피해·보호막 계산식이면 자동 효과에서도 빠진다.`, "");
    table(r.fails, [["증강", (x) => `${x.name} (${x.id})`], ["자리표시자", (x) => x.ref], ["이유", (x) => x.why],
      ["대조 상태", (x) => (r.rows.find((y) => y.id === x.id && y.ref.startsWith(x.ref)) || {}).state]]);
  }
  L.push("## 반복 발동 효과에 재사용 대기시간이 빠진 것 (발동 과대 계산)", "");
  L.push("기본 공격·스킬마다 터지는 것으로 세는데, 원본에 재사용 대기시간 값이 있고 효과에는 없다. 초당 피해(augDps)·콤보 발동 횟수가 커진다.", "");
  if (r.overcount.length) table(r.overcount, [["증강", (x) => `${x.name} (${x.id})`], ["효과", (x) => x.effect], ["발동", (x) => x.trigger],
    ["원본 쿨다운", (x) => `${x.dv} = ${x.sec}`], ["설명", (x) => x.desc]]); else L.push("없음.", "");
  L.push("## 불일치", "");
  if (by("불일치").length) table(by("불일치"), [...base, ["계산 값", (x) => x.applied], ["이유", (x) => x.why]]); else L.push("없음.", "");
  L.push("## 미구현 (원본 효과가 계산에 안 쓰임)", "");
  L.push("툴팁에 나오는 수치인데 자동 추출·규칙 어디에도 연결되지 않은 것. 숫자로 비교하기 어려운 효과(무적·CC·이동 등)가 많고, 태그(tags)로만 점수에 들어가는 증강도 있다.", "");
  table(by("미구현"), [...base, ["이유", (x) => x.why]]);
  L.push("## 가정", "");
  table(by("가정"), [...base, ["계산 값", (x) => x.applied], ["가정", (x) => x.why]]);
  L.push("### 규칙에 숫자로 직접 적은 값", "");
  L.push("'값이 같은 원본'은 숫자만 같은 원본 값이다. 같은 효과면 이름 참조로 바꿀 수 있지만, 우연히 같은 경우도 있다 (예: 신난다! 이동 속도 0.15 ↔ ASBuff).", "");
  table(r.literals, [["증강", (x) => `${x.name} (${x.id})`], ["키", (x) => x.key], ["값", (x) => x.value], ["상태", (x) => x.state],
    ["값이 같은 원본", (x) => x.sameAs], ["근거", (x) => x.why]]);
  L.push("## 원본 확인 불가", "");
  if (by("원본 확인 불가").length) table(by("원본 확인 불가"), [...base, ["이유", (x) => x.why]]); else L.push("없음.", "");
  L.push("## 계산 제외", "");
  table(by("계산 제외"), [...base, ["이유", (x) => x.why]]);
  L.push("## 패치 상태", "");
  const patched = r.perAug.filter((x) => x.patch);
  L.push(`이번 패치 노트에 나온 증강 ${patched.length}개:`, "");
  table(patched, [["증강", (x) => `${x.name} (${x.id})`], ["패치 노트", (x) => (x.patch || []).join(" / ")],
    ["게임 데이터 대조", (x) => (x.patchCheck || []).map((p) => p.status).join(", ") || "대조 줄 없음"]]);
  L.push("## 증강별 상태", "");
  table(r.perAug, [["증강", (x) => `${x.name} (${x.id})`], ["등급", (x) => x.rarity], ["항목", (x) => x.items],
    ...STATES.map((s) => [s, (x) => (x.states ? x.states[s] || "" : "")])]);
  return L.join("\n");
}

// 새로 생긴 문제: 불일치 · 빌드가 못 푸는 자리표시자 · 쿨다운 빠진 반복 효과 · 새 증강의 미구현 (저장된 대조 결과에 없던 것만)
function newProblems(r, base) {
  const key = (x) => `${x.id}|${x.ref || x.effect || ""}|${x.dv || ""}`;
  const had = (list) => new Set((list || []).map(key));
  const out = [];
  const add = (title, list, fmtRow) => { if (list.length) out.push(`### ${title} (${list.length})`, "", ...list.map((x) => `- ${fmtRow(x)}`), ""); };
  add("불일치 (계산 값 ≠ 원본)", r.rows.filter((x) => x.state === "불일치" && !had(base.rows.filter((y) => y.state === "불일치")).has(key(x))),
    (x) => `${x.name} (${x.id}) ${x.ref}: ${x.why}`);
  add("설명에 '?' (빌드 계산기가 못 품)", (r.fails || []).filter((x) => !had(base.fails).has(key(x))), (x) => `${x.name} (${x.id}) ${x.ref}: ${x.why}`);
  add("반복 발동 효과에 원본 재사용 대기시간이 빠짐", r.overcount.filter((x) => !had(base.overcount).has(key(x))),
    (x) => `${x.name} (${x.id}) ${x.effect} — 원본 ${x.dv} = ${x.sec}초 → rules.json effectCooldown 검토`);
  const oldAugs = new Set(base.perAug.map((x) => x.id));
  add("새 증강의 계산 안 되는 수치", r.rows.filter((x) => !oldAugs.has(x.id) && ["미구현", "원본 확인 불가"].includes(x.state)),
    (x) => `${x.name} (${x.id}) ${x.ref} = ${fmt(x.source)}: ${x.state}`);
  return out.length ? ["## 증강 원본 대조 (tools/aug_audit.js --check)", "", `게임 데이터 ${r.version} · 저장된 대조 ${base.version}`, "", ...out].join("\n") : "";
}

if (require.main === module) {
  const r = audit();
  if (process.argv.includes("--check")) {
    let base = null;
    // 저장된 대조를 못 읽으면 조용히 '새 문제 없음'으로 끝내지 않는다 (매일 갱신이 실패로 알 수 있게)
    const base = read(path.join(ROOT, "docs", "증강_원본_대조.json"));
    process.stdout.write(newProblems(r, base));
    process.exit(0);
  }
  if (process.argv.includes("--write")) {
    fs.writeFileSync(path.join(ROOT, "docs", "증강_원본_대조_결과.md"), markdown(r) + "\n");
    fs.writeFileSync(path.join(ROOT, "docs", "증강_원본_대조.json"), JSON.stringify(r, null, 1) + "\n");
  }
  console.log(`원본 ${r.version} · 증강 ${r.augments}개 · 효과 항목 ${r.rows.length}개`);
  for (const s of STATES) console.log(`  ${s}: ${r.count[s]}`);
  console.log(`  규칙에 직접 적은 숫자 ${r.literals.length} · 툴팁 밖 원본 값 ${r.hidden.length} · 쿨다운 빠진 반복 효과 ${r.overcount.length}`);
}
module.exports = { audit, newProblems };
