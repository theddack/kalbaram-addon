// 검증 도구 공통: '지금 무슨 엔진으로 쟀는지' 를 결과 파일에 남긴다 (v0.1.95 Phase 4, 2026-11-25).
// 왜 필요한가: web/scoring.js 3번째 줄은 require("./stats.js") 로 계산 엔진을 '파일에서' 읽는다.
//   그래서 한 프로세스 안에서 global.Stats 를 바꿔치기해도 점수·추천은 안 바뀐다 (같은 엔진끼리 견주게 된다).
//   수정 전후를 견주려면 web/stats.js 파일을 바꿔 끼우고 '따로 실행' 해야 한다. 그게 실제로 지켜졌는지를
//   결과 파일에 박힌 파일 해시·커밋·실제 로딩 경로로 확인한다.
//   쓰는 곳: tools/c9_shred_check.js · tools/aug_top3_dump.js (--dump 가 fingerprint() 를 함께 저장한다)
const path = require("path"), fs = require("fs"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const FILES = ["web/stats.js", "web/scoring.js", "web/data.json"];

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

// 이 프로세스가 '실제로' 읽은 엔진의 지문
function fingerprint() {
  const files = {};
  for (const rel of FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    files[rel] = { sha256: sha(p), bytes: fs.statSync(p).size };
  }
  // scoring.js 가 실제로 어느 파일을 엔진으로 잡았는지 (require 해석 결과 그대로)
  let loaded = null;
  try { loaded = require.resolve(path.join(ROOT, "web", "stats.js")); } catch { /* 없음 */ }
  const head = git(["rev-parse", "--short", "HEAD"]);
  const dirty = git(["status", "--porcelain", "--", ...FILES]);
  return {
    files, loaded, node: process.version, at: new Date().toISOString(),
    git: { head, 작업중변경: dirty ? dirty.split("\n").filter(Boolean) : [] },
  };
}

const short = (h) => (h ? h.slice(0, 12) : "모름");

const hashOf = (fp, rel) => (fp && fp.files && fp.files[rel] || {}).sha256 || null;
const engineHash = (fp) => hashOf(fp, "web/stats.js");

// 두 결과 파일이 정말 '다른 엔진' 으로 만들어졌는가 (stats.js 만 본다 — 옛 호출부 호환)
function engineDiff(a, b) {
  const ha = engineHash(a), hb = engineHash(b);
  if (!ha || !hb) return { ok: false, why: "지문 없음 (옛 결과 파일) — 같은 엔진끼리 견주고 있는지 알 수 없다" };
  if (ha === hb) return { ok: false, why: `같은 web/stats.js (${short(ha)}) 로 만든 두 파일이다 — 수정 전후 비교가 아니다` };
  return { ok: true, why: `엔진이 다르다 (${short(ha)} → ${short(hb)})` };
}

// 무엇이 달라진 비교인지 가린다 (2026-11-25): 세 파일 해시 + 입력 조건 라벨을 함께 본다.
//   엔진 변경   stats.js·scoring.js 가 다름           → 결과가 달라지는 게 정상일 수 있다
//   데이터 변경  data.json 이 다름 (패치·규칙값 수정)   → 〃
//   입력값 민감도 세 파일은 같고 입력 조건만 다름        → 〃 (기준 상대·규칙값을 메모리에서 바꿔 본 경우)
//   동일 조건 재현 전부 같음                           → 결과도 같아야 한다. 다르면 계산이 불안정한 것
// 결과 파일의 inputs 는 '무슨 조건으로 쟀는지' 라벨이다 (없으면 '안 적음').
const KINDS = { engine: "엔진 변경", data: "데이터 변경", both: "엔진+데이터 변경", input: "입력값 민감도", same: "동일 조건 재현", unknown: "알 수 없음" };
function compareKind(a, b) {
  const h = (rel) => [hashOf(a, rel), hashOf(b, rel)];
  const [sa, sb] = h("web/stats.js"), [ca, cb] = h("web/scoring.js"), [da, db] = h("web/data.json");
  if (!sa || !sb || !ca || !cb || !da || !db) return { kind: KINDS.unknown, engineMoved: false, dataMoved: false, inputMoved: false, why: "지문이 없는 결과 파일이 있다 (옛 파일) — 무엇이 달라진 비교인지 알 수 없다" };
  const engineMoved = sa !== sb || ca !== cb;
  const dataMoved = da !== db;
  const ia = (a.inputs == null ? null : JSON.stringify(a.inputs)), ib = (b.inputs == null ? null : JSON.stringify(b.inputs));
  const inputMoved = ia !== ib;
  const parts = [];
  if (sa !== sb) parts.push(`stats.js ${short(sa)} → ${short(sb)}`);
  if (ca !== cb) parts.push(`scoring.js ${short(ca)} → ${short(cb)}`);
  if (dataMoved) parts.push(`data.json ${short(da)} → ${short(db)}`);
  if (inputMoved) parts.push(`입력 조건 ${ia || "안 적음"} → ${ib || "안 적음"}`);
  const kind = engineMoved && dataMoved ? KINDS.both : engineMoved ? KINDS.engine : dataMoved ? KINDS.data
    : inputMoved ? KINDS.input : KINDS.same;
  const why = kind === KINDS.same
    ? "세 파일 해시와 입력 조건이 모두 같다 → 결과도 같아야 한다 (다르면 계산이 불안정한 것)"
    : `${kind}: ${parts.join(" · ")}`;
  return { kind, engineMoved, dataMoved, inputMoved, why, same: kind === KINDS.same };
}

// 비교 도구가 쓰는 공통 머리말. 무엇이 달라진 비교인지까지 찍는다 (판정은 부르는 쪽에서)
function printEngines(a, b) {
  const line = (label, fp) => {
    if (!fp) return console.log(`  ${label}: 지문 없음`);
    const f = fp.files || {};
    console.log(`  ${label}: stats ${short((f["web/stats.js"] || {}).sha256)} · scoring ${short((f["web/scoring.js"] || {}).sha256)}`
      + ` · data ${short((f["web/data.json"] || {}).sha256)} · 커밋 ${fp.git && fp.git.head || "모름"}`
      + (fp.git && fp.git.작업중변경.length ? ` · 작업중 변경 ${fp.git.작업중변경.length}개` : "") + ` · ${fp.at || ""}`);
  };
  console.log("=== 0. 무슨 엔진·데이터로 쟀나");
  line("전", a.engine || a); line("후", b.engine || b);
  const k = compareKind({ ...(a.engine || a), inputs: a.inputs }, { ...(b.engine || b), inputs: b.inputs });
  console.log(`  → [${k.kind}] ${k.why}`);
  const v = engineDiff(a.engine || a, b.engine || b);
  if (!v.ok && !k.dataMoved && !k.inputMoved) console.log(`  ⚠ ${v.why}`);
  return { ...v, ...k };
}

module.exports = { fingerprint, engineDiff, compareKind, printEngines, engineHash, hashOf, KINDS, FILES, ROOT };
