"""매일 갱신한 데이터가 망가지지 않았는지: 챔피언·증강·아이템 수가 갑자기 크게 줄거나,
채워져 있던 칸(증강 한글 이름·설명·아이콘, 챔피언 피해 유형·공식 추천)이 갑자기 비면 반영하지 않는다.

  python tools/data_sanity.py <이전 data.json> <새 data.json>   → 괜찮으면 종료 코드 0, 이상하면 1 (이유 출력)
"""
import json
import re
import sys

KEYS = ("champions", "augments", "items")
MIN_RATIO = 0.9  # 이전의 90% 밑으로 줄면 받은 데이터가 덜 온 것으로 본다 (패치로 몇 개 빠지는 건 괜찮다)
MAX_DROP = 0.05  # 채워진 비율이 5%p 넘게 떨어지면 받기·해석 실패로 본다
HANGUL = re.compile(r"[가-힣]")
# 개수만 보면 이름이 영문 id 로 바뀌거나(문자열 해시를 못 찾음) 받기 실패로 칸이 비어도 통과했다 (2026-10-23 점검)
FILLED = (
    ("augments", "한글 이름", lambda a: bool(HANGUL.search(a.get("name") or ""))),
    ("augments", "설명", lambda a: bool((a.get("desc") or "").strip())),
    ("augments", "아이콘", lambda a: bool(a.get("icon"))),
    ("champions", "피해 유형", lambda c: bool(c.get("damageType"))),
    ("champions", "공식 추천 아이템", lambda c: bool(c.get("officialItems"))),
    # 위키 응답이 200 인데 내용이 바뀌면(확인 페이지·모듈 이동) 해석이 빈 값이 되어도 실패 목록에 안 들어갔다
    ("champions", "칼바람 보정(위키)", lambda c: bool(c.get("aram"))),
    ("champions", "모드 능력치(위키)", lambda c: bool(c.get("modeStats"))),
)


def filled(rows, fn):
    return sum(1 for r in rows if fn(r)) / len(rows) if rows else 0.0


def problems(old, new):
    out = []
    for k in KEYS:
        a, b = len(old.get(k) or []), len(new.get(k) or [])
        if b == 0 or (a and b < a * MIN_RATIO):
            out.append(f"{k} {a} → {b}개")
    for c in new.get("champions") or []:
        if not c.get("id") or not c.get("name"):
            out.append("이름 없는 챔피언")
            break
    for k, label, fn in FILLED:
        a, b = filled(old.get(k) or [], fn), filled(new.get(k) or [], fn)
        if b < a - MAX_DROP:
            out.append(f"{k} {label} {a:.0%} → {b:.0%}")
    return out


if __name__ == "__main__":
    old, new = (json.load(open(p, encoding="utf-8")) for p in sys.argv[1:3])
    bad = problems(old, new)
    print("데이터 이상: " + ", ".join(bad) if bad else "데이터 정상")
    sys.exit(1 if bad else 0)
