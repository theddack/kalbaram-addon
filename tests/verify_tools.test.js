// 검증 도구 자체를 검증한다 (v0.1.95 Phase 4, 2026-11-25).
// 왜: 앞 판 E1·E2 비교는 '달라진 것 없음' 이라고 했지만 사실은 같은 엔진끼리 견주고 있었다.
//   비교 도구가 (1) 정말 다른 엔진으로 쟀는지 가려내는지 (2) 차이가 있으면 실제로 잡는지를 고정한다.
//   엔진을 바꿔 끼우는 느린 양성 대조는 `node tools/c9_shred_check.js --positive` 로 따로 돌린다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const FP = require("../tools/engine_fp.js");
const C9 = require("../tools/c9_shred_check.js");
const WEB = path.join(__dirname, "..", "web");

// ---- 1. 엔진 지문
test("엔진 지문: 지금 읽은 파일의 해시·커밋·경로를 남긴다", () => {
  const fp = FP.fingerprint();
  for (const rel of FP.FILES) {
    assert.ok(fp.files[rel], `${rel} 지문이 없다`);
    assert.match(fp.files[rel].sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(fp.loaded, path.join(WEB, "stats.js"));   // scoring.js 가 실제로 잡는 그 파일
  assert.ok(fp.at && fp.node);
});

test("엔진 지문: 같은 엔진끼리 견주면 '수정 전후 비교가 아니다' 라고 한다", () => {
  const a = FP.fingerprint(), b = FP.fingerprint();
  const same = FP.engineDiff(a, b);
  assert.equal(same.ok, false);
  assert.match(same.why, /같은 web\/stats\.js/);

  const moved = JSON.parse(JSON.stringify(b));
  moved.files["web/stats.js"].sha256 = "0".repeat(64);
  assert.equal(FP.engineDiff(a, moved).ok, true);

  assert.equal(FP.engineDiff(a, { files: {} }).ok, false);          // 지문 없는 옛 결과 파일
  assert.match(FP.engineDiff(a, { files: {} }).why, /지문 없음/);
});

// ---- 2. 비교 도구가 차이를 잡는가 (양성 대조, 가짜 결과 파일로 빠르게)
const scene = (names, scores, raw) => ({ top: names.map((n, i) => ({ name: n, score: scores[i] })), raw: raw || names });
const base = () => ({ s1: scene(["가", "나", "다"], [3, 2, 1]), s2: scene(["라", "마", "바"], [9, 8, 7]) });

test("비교 도구: 똑같은 결과면 달라진 것이 없다고 한다", () => {
  const r = C9.cmpGame(base(), base());
  assert.deepEqual([r.장면, r.top1, r.top3, r.top6, r.score, r.rawMoved, r.miss], [2, 0, 0, 0, 0, 0, 0]);
  assert.equal(C9.anyMove(r), false);
});

test("비교 도구: 1순위가 바뀌면 잡는다", () => {
  const b = base(); b.s1 = scene(["나", "가", "다"], [3, 2, 1]);
  const r = C9.cmpGame(base(), b);
  assert.equal(r.top1, 1);
  assert.equal(r.top3, 1);
  assert.equal(r.top6, 1);
  assert.equal(C9.anyMove(r), true);
  assert.match(r.ex[0], /가 → 나/);
});

test("비교 도구: 점수만 아주 조금 움직여도 잡는다 (순위는 그대로)", () => {
  const b = base(); b.s2 = scene(["라", "마", "바"], [9.0000001, 8, 7]);
  const r = C9.cmpGame(base(), b);
  assert.equal(r.top1, 0);
  assert.equal(r.top6, 0);
  assert.equal(r.score, 1);
  assert.ok(r.maxd > 0);
  assert.equal(C9.anyMove(r), true);
});

test("비교 도구: 동점 정렬 전 계산 순서(raw)가 바뀌면 잡는다", () => {
  const b = base(); b.s1 = scene(["가", "나", "다"], [3, 2, 1], ["나", "가", "다"]);
  const r = C9.cmpGame(base(), b);
  assert.equal(r.top6, 0);        // 보이는 순위는 그대로
  assert.equal(r.score, 0);
  assert.equal(r.rawMoved, 1);    // 안쪽 계산 순서는 달라졌다
  assert.equal(C9.anyMove(r), true);
});

test("비교 도구: raw 는 이름 배열이다 (숫자 빼기로 견주면 NaN 이 된다)", () => {
  // 앞 판에 raw 를 점수로 알고 Math.abs(a-b) 로 견주다가 차이를 통째로 놓쳤다
  const r = base().s1.raw;
  assert.ok(Array.isArray(r) && typeof r[0] === "string");
  assert.ok(Number.isNaN(Math.abs(r[0] - r[1])));
});

test("비교 도구: 한쪽에만 있는 장면을 따로 센다", () => {
  const b = base(); b.s3 = scene(["사"], [1]);
  const r = C9.cmpGame(base(), b);
  assert.equal(r.miss, 1);
});

// ---- 3. 엔진을 어떻게 잡는지 (도구 작성자가 속지 않게 고정)
test("scoring.js 는 계산 엔진을 파일에서 읽는다 (global.Stats 교체로는 안 바뀐다)", () => {
  const src = fs.readFileSync(path.join(WEB, "scoring.js"), "utf8");
  assert.match(src, /require\("\.\/stats\.js"\)/);
  global.Stats = { 가짜: true };
  const S = require(path.join(WEB, "scoring.js"));
  const d = require(path.join(WEB, "data.json"));
  S.attachSimilar(d.champions, null, d.items);
  const c = d.champions[0];
  // 가짜 엔진을 global 에 꽂아도 그대로 돈다 = global.Stats 는 읽지 않는다
  const rows = S.rankItems(d.items, S.profile(c, d.tags), [], [], d.rules, c, { aram: true }, "balanced");
  assert.ok(rows.length > 0 && rows[0].score > 0);
});

// ---- 4. 무엇이 달라진 비교인지 가리는가 (2026-11-25)
const fpWith = (stats, scoring, data, inputs) => ({
  engine: { files: { "web/stats.js": { sha256: stats.repeat(64).slice(0, 64) },
    "web/scoring.js": { sha256: scoring.repeat(64).slice(0, 64) },
    "web/data.json": { sha256: data.repeat(64).slice(0, 64) } }, at: "t", node: "v" },
  inputs,
});
const kindOf = (a, b) => FP.compareKind({ ...a.engine, inputs: a.inputs }, { ...b.engine, inputs: b.inputs }).kind;

test("비교 종류: 엔진 변경 · 데이터 변경 · 입력값 민감도 · 동일 조건 재현을 가린다", () => {
  const base = fpWith("1", "2", "3", { 조건: "기본" });
  assert.equal(kindOf(base, base), FP.KINDS.same);
  assert.equal(kindOf(base, fpWith("9", "2", "3", { 조건: "기본" })), FP.KINDS.engine);   // stats.js
  assert.equal(kindOf(base, fpWith("1", "9", "3", { 조건: "기본" })), FP.KINDS.engine);   // scoring.js
  assert.equal(kindOf(base, fpWith("1", "2", "9", { 조건: "기본" })), FP.KINDS.data);
  assert.equal(kindOf(base, fpWith("9", "2", "9", { 조건: "기본" })), FP.KINDS.both);
  assert.equal(kindOf(base, fpWith("1", "2", "3", { 조건: "기준상대 바꿈" })), FP.KINDS.input);
  assert.equal(kindOf(base, { engine: { files: {} } }), FP.KINDS.unknown);
});

test("비교 종류: '동일 조건 재현' 이면 결과도 같아야 한다고 알린다", () => {
  const base = fpWith("1", "2", "3", { 조건: "기본" });
  const k = FP.compareKind({ ...base.engine, inputs: base.inputs }, { ...base.engine, inputs: base.inputs });
  assert.equal(k.same, true);
  assert.match(k.why, /결과도 같아야 한다/);
  assert.equal(k.engineMoved, false);
  assert.equal(k.dataMoved, false);
});

test("비교 종류: 세 파일 중 data.json 만 달라도 잡는다 (stats.js 만 보던 때는 못 잡았다)", () => {
  const a = fpWith("1", "2", "3", { 조건: "기본" }), b = fpWith("1", "2", "9", { 조건: "기본" });
  assert.equal(FP.engineDiff(a.engine, b.engine).ok, false);           // 옛 판정: stats.js 가 같다
  const k = FP.compareKind({ ...a.engine, inputs: a.inputs }, { ...b.engine, inputs: b.inputs });
  assert.equal(k.dataMoved, true);                                     // 새 판정: 데이터가 달라졌다
  assert.equal(k.same, false);
});
