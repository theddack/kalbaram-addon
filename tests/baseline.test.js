// 추천 기준선 (tools/rec_baseline.js): 같은 입력이면 같은 결과, 저장된 기준선과 대표 장면이 같은지.
// 계산을 일부러 고쳐서 바뀐 거면 node tools/rec_baseline.js 로 바뀐 점을 보고 --update 로 기준선을 새로 저장한다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const R = require("../tools/rec_baseline.js");
const S = require("../web/scoring.js");

const d = R.load();
S.attachSimilar(d.champions, null, d.items);
const base = JSON.parse(fs.readFileSync(R.FILE, "utf8"));
const champ = (id) => d.champions.find((c) => c.id === id);
const PICK = ["Varus", "Jinx", "Caitlyn", "Jhin", "Vayne", "Kayle", "Lux", "Malphite"];
// 매일 데이터 갱신(refresh.yml)은 새 데이터로 테스트한다: 게임 데이터가 바뀌면 비교는 건너뛴다 (기준선은 사람이 보고 새로 저장)
// (게임 패치(Data Dragon version)가 바뀐 것도 본다: 2026-10-21 커뮤니티 드래곤 표기는 16.20 인데 증강은 16.21 로 바뀌어 있었다)
const stale = (base.dataVersion !== d.dataVersion || base.version !== d.version) && "게임 데이터가 기준선과 달라요: node tools/rec_baseline.js 로 보고 --update";

test("기준선: 같은 입력을 두 번 계산해도 순위·점수가 같다", () => {
  for (const id of PICK) assert.deepStrictEqual(R.ranking(d, champ(id), [], []), R.ranking(d, champ(id), [], []), id);
});

test("기준선: 대표 챔피언(증강 없음) 순위가 저장된 기준선과 같다", { skip: stale }, () => {
  for (const id of PICK) {
    const now = R.ranking(d, champ(id), [], []);
    const b = base.scenes[`solo:${id}`];
    assert.deepStrictEqual(now.top.map((x) => x.name), b.top.map((x) => x.name), id);
    assert.deepStrictEqual(now.raw, b.raw, id);
  }
});

test("기준선: 증강 장면도 저장된 기준선과 같다", { skip: stale }, () => {
  const keys = Object.keys(base.scenes).filter((k) => /^aug:(Varus|Jinx|Kayle):/.test(k));
  assert.ok(keys.length >= 3);
  for (const k of keys) {
    const [, id, aug] = k.split(":");
    const now = R.ranking(d, champ(id), [d.augments.find((a) => a.id === aug)], []);
    assert.deepStrictEqual(now.top.map((x) => x.name), base.scenes[k].top.map((x) => x.name), k);
  }
});

test("기준선 비교: 바뀐 1순위를 찾아낸다", () => {
  const a = { dataVersion: "x", scenes: { "solo:A": { top: [{ name: "가", score: 1 }, { name: "나", score: 0.9 }], raw: ["가", "나"], build: ["가"] } } };
  const b = { dataVersion: "x", scenes: { "solo:A": { top: [{ name: "나", score: 1.1 }, { name: "가", score: 1 }], raw: ["나", "가"], build: ["나"] } } };
  const sum = R.compare(a, b);
  assert.strictEqual(sum.top1.length, 1);
  assert.strictEqual(sum.build.length, 1);
  assert.strictEqual(R.compare(a, a).top1.length, 0);
});

test("기준선 비교: 1순위가 바뀐 원인을 항목별로 (근거 순서 / 점수 차이를 가장 크게 바꾼 지표)", () => {
  const top = (list) => ({ top: list, raw: list.map((x) => x.name) });
  const A = { name: "A", score: 3, tag: 0.5, parts: { dps: 0.3, ehp: 0.1 } };
  const B = { name: "B", score: 2.8, tag: 0.5, parts: { dps: 0.2, ehp: 0.1 } };
  const base = { dataVersion: "x", scenes: { s: top([A, B]) } };
  // B 의 초당 피해 이득이 커져 1순위가 됨: 두 아이템 차이 (0.45 − 0.3) − (0.2 − 0.3) = +0.25
  const now = { dataVersion: "x", scenes: { s: top([{ ...B, score: 3.2, parts: { dps: 0.45, ehp: 0.1 } }, A]) } };
  assert.match(R.compare(base, now).top1[0], /A → B \[초당 피해 \+0\.250\]/);
  // 근거 순서로 올라옴
  const tie = { dataVersion: "x", scenes: { s: top([{ ...B, tie: "증강 연계" }, A]) } };
  assert.match(R.compare(base, tie).top1[0], /\[근거 순서: 증강 연계\]/);
});
