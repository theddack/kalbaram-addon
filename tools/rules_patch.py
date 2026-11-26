"""rules.json 에서 고친 규칙값만 web/data.json 에 다시 구워 넣는다 (네트워크 없이, v0.1.95 Phase 4).

왜 필요한가: build_data.py 는 rules.json 의 stats 를 data.json 의
  · rules.items[이름].stats          (화면 '근거' 와 app.js 가 읽는다)
  · items[].passiveStats             (stats.js 가 실제로 계산에 쓴다)
  · rules.augments[id].stats/statsResolved  (증강은 statsResolved 를 쓴다)
세 자리에 복사해 둔다. 규칙값만 고쳤을 때 전체 빌드(게임 데이터 내려받기)를 다시 돌리지 않으려고 그 세 자리만 맞춘다.
다음 번 build_data.py 전체 실행이 같은 결과를 다시 만든다 (rules.json 이 원본이다).

  python tools/rules_patch.py --item "원형질 안전벨트" --augment VeilOfWarding [--dry]

증강은 숫자로 바로 쓰는 값만 옮긴다. 게임 데이터 이름("HealToDamageConversion")·계산식({"calc": …}) 이 섞여 있으면
그 증강은 건너뛰고 알린다 (build_data.py 의 resolve_rule_stats 가 해야 할 일이라서).
"""
import argparse
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_data  # 근거 줄(basisView)은 전체 빌드와 같은 함수로 만든다 (두 경로가 어긋나지 않게)


# C9-A3 중첩형 저항 감소 규칙은 글자(감소 키·쌓는 방법)가 들어 있지만 게임 데이터 해석이 필요 없다 → 그대로 넘긴다
LITERAL_KEYS = {"_shred"}


def plain(v):
    """숫자(또는 숫자만 든 구조)인가 — 게임 데이터 이름 해석이 필요 없는 값인가"""
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, list):
        return all(plain(x) for x in v)
    if isinstance(v, dict):
        if {"dv", "calc", "calc18"} & set(v):
            return False
        return all(plain(x) for k, x in v.items() if k not in LITERAL_KEYS)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--item", action="append", default=[])
    ap.add_argument("--augment", action="append", default=[])
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    rules = json.load(io.open(ROOT / "rules.json", encoding="utf-8"))
    data = json.load(io.open(ROOT / "web" / "data.json", encoding="utf-8"))
    items_by_name = {i["name"]: i for i in data["items"]}
    changed = []
    warn = []  # build_data.rule_basis 가 '근거 없는 가정값' 을 담는 자리

    for name in a.item:
        src = (rules.get("items") or {}).get(name)
        if not src:
            sys.exit(f"rules.json 에 아이템 '{name}' 이 없다")
        if not plain(src.get("stats") or {}):
            sys.exit(f"아이템 '{name}': 숫자가 아닌 값이 있다 → build_data.py 전체 실행이 필요하다")
        before = json.dumps(data["rules"]["items"].get(name, {}).get("stats"), ensure_ascii=False)
        data["rules"]["items"][name] = json.loads(json.dumps(src, ensure_ascii=False))
        it = items_by_name.get(name)
        if it is None:
            sys.exit(f"web/data.json 에 아이템 '{name}' 이 없다")
        # build_data.py 와 같은 조건: 확인 문구(check)가 설명에 있어야 규칙을 적용한다
        chk = src.get("check")
        plain_desc = re.sub(r"<[^>]+>", "", (it.get("passiveHtml") or "") + it.get("desc", ""))
        if chk and chk not in plain_desc:
            sys.exit(f"아이템 '{name}': 설명에 '{chk}' 가 없다 (패치로 수치 변경?) → build_data.py 가 미적용으로 둔다")
        it["passiveStats"] = json.loads(json.dumps(src["stats"], ensure_ascii=False))
        # 화면 '근거' 글귀도 build_data.py 와 같은 함수로 다시 만든다
        # (전에는 calc 줄만 바꿔 '설명에 나온 수치' 줄이 빠졌다 — 2026-11-26 두 경로 대조에서 찾음)
        it["basisView"] = build_data.rule_basis(src, src["stats"],
                                                (it.get("passiveHtml") or "") + it["desc"], warn, name)
        changed.append(f"아이템 {name}: {before} → {json.dumps(src['stats'], ensure_ascii=False)}")

    for aid in a.augment:
        src = (rules.get("augments") or {}).get(aid)
        if not src:
            sys.exit(f"rules.json 에 증강 '{aid}' 이 없다")
        st = src.get("stats") or {}
        if not plain(st):
            sys.exit(f"증강 '{aid}': 게임 데이터 이름·계산식이 섞여 있다 → build_data.py 전체 실행이 필요하다")
        cur = data["rules"]["augments"].get(aid) or {}
        before = json.dumps(cur.get("statsResolved"), ensure_ascii=False)
        merged = json.loads(json.dumps(src, ensure_ascii=False))
        # basisView 는 build_data.py 가 만든 것을 그대로 둔다 (본문 글귀만 basis 에서 다시 쓴다)
        merged["statsResolved"] = json.loads(json.dumps(st, ensure_ascii=False))
        aug = next((x for x in data["augments"] if x["id"] == aid), None)
        if aug is not None:
            merged["basisView"] = build_data.rule_basis(merged, st, aug["desc"], warn, aug["name"])
        elif cur.get("basisView"):
            merged["basisView"] = json.loads(json.dumps(cur["basisView"], ensure_ascii=False))
        data["rules"]["augments"][aid] = merged
        changed.append(f"증강 {aid}: {before} → {json.dumps(st, ensure_ascii=False)}")

    if not changed:
        sys.exit("옮길 것을 안 줬다 (--item / --augment)")
    for line in changed:
        print(" ", line)
    for w in warn:
        print("  [규칙 수치]", w)
    if a.dry:
        print("  (--dry: 저장하지 않음)")
        return
    out = ROOT / "web" / "data.json"
    out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")  # build_data.py 와 같은 형식
    print(f"  저장 {out}")


if __name__ == "__main__":
    main()
