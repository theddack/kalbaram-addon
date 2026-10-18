"""롤 클라이언트 전적에서 내 최근 칼바람 증강 모드 판을 받아 .cache/matches/ 에 저장한다 (클라이언트 API 읽기만).

  python tools/match_review.py          → 최근 40판 중 칼바람 증강 모드 판 (이미 받은 판은 건너뜀)
  python tools/match_review.py 100      → 최근 100판에서

저장하는 것은 lcu.redact_match 결과뿐이다: 10명의 챔피언·증강 번호·아이템·승패·피해량 (이름·계정 칸은 버린다, 내 칸만 me=True).
.cache/ 는 커밋하지 않는다. 받은 판으로 추천을 대조하려면: node tools/match_check.js
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import lcu  # noqa: E402
import overlay  # noqa: E402

OUT = ROOT / ".cache" / "matches"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main(argv):
    count = int(argv[0]) if argv and argv[0].isdigit() else 40
    path = lcu.find_lockfile(overlay.game_install_dirs())
    if not path:
        print("롤 클라이언트가 꺼져 있어요 (lockfile 을 못 찾음). 클라이언트를 켜고 다시 실행해 주세요.")
        return 1
    c = lcu.Lcu(path)
    OUT.mkdir(parents=True, exist_ok=True)
    ids = c.kiwi_games(count)
    new = 0
    for gid in ids:
        p = OUT / f"{int(gid)}.json"
        if p.exists():
            continue
        m = c.match(gid)
        if not m.get("players"):
            continue
        p.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
        new += 1
    print(f"칼바람 증강 모드 {len(ids)}판 중 새로 받은 판 {new}개 → {OUT} (모두 {len(list(OUT.glob('*.json')))}판)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
