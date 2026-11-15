// v0.1.93 실전 기록 검증 도구(tools/game_log_audit.js): 기록을 지금 엔진으로 다시 계산해 어긋난 능력치와 증강 기록 차이를 찾는다.
// 픽스처는 사람이 만든 가짜 기록이에요 (개인정보 없음): 능력치 한 줄만 일부러 실제가 40 높게 넣었어요.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { run, gameDirs, statOff } = require("../tools/game_log_audit.js");
const DIR = path.join(__dirname, "data", "log_audit");

test("기록 폴더 찾기: events.json 이 있는 폴더만", () => {
  const dirs = gameDirs(DIR);
  assert.equal(dirs.length, 1);
  assert.ok(dirs[0].endsWith("20260101_000000_Lux"));
});

test("5% 넘게 다르면 어긋남, 작은 값은 반올림 폭을 둔다", () => {
  assert.equal(statOff([100, 100], "AP"), false);
  assert.equal(statOff([100, 110], "AP"), true);
  assert.equal(statOff([0.7, 0.71], "AS"), false, "공격 속도 0.02 안쪽은 넘어감");
  assert.equal(statOff([0.7, 0.75], "AS"), true);
});

test("지금 엔진으로 다시 계산해 어긋난 능력치를 찾는다", () => {
  const [g] = run([DIR]);
  assert.equal(g.champion, "Lux");
  assert.equal(g.stats.AP.nowOff, 1, "일부러 넣은 주문력 차이 하나");
  assert.equal(g.stats.HP.nowOff, 0);
  assert.equal(g.stats.AS.nowOff, 0);
  const worst = g.stats.AP.worst;
  assert.equal(worst.level, 6);
  assert.ok(worst.real - worst.now > 35, `${worst.now} vs ${worst.real}`);
});

test("타임라인에 증강·아이템·능력치가 시각 순서로 들어간다", () => {
  const [g] = run([DIR]);
  const kinds = g.timeline.map((r) => r.kind);
  assert.deepEqual(kinds, ["start", "statcheck", "picked", "items", "statcheck", "eog"]);
  assert.ok(g.timeline.every((r, i, a) => i === 0 || r.t >= a[i - 1].t));
  assert.equal(g.aug.picked.length, 1);
  assert.equal(g.aug.match, true);
});
