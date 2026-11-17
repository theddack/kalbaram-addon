"""기록한 판의 원본 이벤트(offers·click)를 지금 코드의 augocr.Tracker 로 다시 먹여 고른 증강을 맞춰 본다.

    python tools/aug_replay.py                      기록 폴더 전체 (data/logs/games)
    python tools/aug_replay.py <폴더|zip> [...]      고른 판만
    python tools/aug_replay.py --dir <기록 폴더>     기록 폴더 위치를 직접
    python tools/aug_replay.py --rule first         클릭 규칙 실험 (아래)

클릭 규칙(--rule): 같은 선택 화면에서 어느 클릭을 고른 것으로 볼지
    now    지금 코드 그대로 — 확실한 클릭이 있으면 그것, 없으면 짐작한 클릭 (기본)
    first  먼저 온 클릭 — 확실·짐작을 가리지 않고 시간 순서로 첫 번째

정답은 경기 결과(eog)다. 경기 결과 칸은 6개뿐이라 그보다 많이 고른 판은 '칸 모자람'으로 따로 센다
(gamelog.EOG_SLOTS). 계산 결과가 아니라 기록 재생이라, 기록에 없는 것은 알 수 없다.
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import augocr  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_DIRS = [Path(r"E:/Downloads/06.Up/칼바람증강Addon/data/logs/games"), ROOT / ".cache" / "games"]


def events_of(p):
    p = Path(p)
    if p.is_dir():
        f = p / "events.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None
    if p.suffix == ".zip":
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if n.endswith("events.json"):
                    return json.loads(z.read(n).decode("utf-8"))
    return None


class FirstClick(augocr.Tracker):
    """실험 규칙 'first': 확실·짐작을 가리지 않고 이번 선택 화면에서 처음 온 클릭을 고른 칸으로 본다"""

    def click(self, slot, sure=True):
        if self._last is None or slot is None:
            return
        if self._click is None and self._guess is None:
            if sure:
                self._click = slot
            else:
                self._guess = slot


def replay(ev, rule="now"):
    """원본 이벤트를 Tracker 에 먹인다 → 고른 증강 목록"""
    t = (FirstClick if rule == "first" else augocr.Tracker)()
    picks, seen = [], [0]

    def snap():
        q = t.state.get("pickSeq", 0)
        if q > seen[0]:
            seen[0] = q
            picks.append(t.state.get("picked"))

    for e in ev:
        k = e.get("kind")
        if k == "offers":
            t.feed(e.get("offers"), pos=e.get("pos"))
        elif k == "click":
            if e.get("reroll") is not None:
                t.reroll(e["reroll"])
            elif e.get("slot") is not None:
                t.click(e["slot"])
            elif e.get("guess") is not None:
                t.click(e["guess"], sure=False)
        else:
            continue
        snap()
    for _ in range(augocr.Tracker.CLOSE_AFTER):
        t.feed(None)
        snap()
    return picks


def judge(picks, eog):
    """정답(경기 결과)과 맞춰 본다 → (판정, 설명)"""
    if not eog:
        return "확인 불가", "경기 결과가 없어요"
    truth, got = sorted(map(str, eog.get("augments") or [])), sorted(str(p) for p in picks if p)
    miss = [n for n in truth if n not in got]
    extra = [n for n in got if n not in truth]
    blank = sum(1 for p in picks if not p)
    if not miss and not extra and not blank:
        return "맞음", ""
    if not miss and extra and len(picks) > len(truth):
        # 경기 결과 칸(6개)보다 많이 골랐을 수 있다 — 기록에만 있는 것이 있고 결과에만 있는 것은 없을 때
        return "칸 모자람?", f"기록에만: {', '.join(extra)}"
    why = []
    if blank:
        why.append(f"못 읽은 칸 {blank}개")
    if miss:
        why.append(f"결과에만: {', '.join(miss)}")
    if extra:
        why.append(f"기록에만: {', '.join(extra)}")
    return "다름", " · ".join(why)


def main(argv):
    rule = "now"
    if "--rule" in argv:
        i = argv.index("--rule")
        rule = argv[i + 1]
        del argv[i:i + 2]
    dirs = []
    while "--dir" in argv:
        i = argv.index("--dir")
        dirs.append(Path(argv[i + 1]))
        del argv[i:i + 2]
    targets = [Path(a) for a in argv]
    if not targets:
        for d in dirs or DEFAULT_DIRS:
            if d.exists():
                targets += sorted(p for p in d.iterdir() if p.is_dir())
        if not targets:
            print("기록 폴더를 못 찾았어요. --dir 로 알려 주세요.")
            return 1
    print(f"클릭 규칙: {rule}")
    n_ok = 0
    rows = []
    for p in targets:
        ev = events_of(p)
        if not ev:
            continue
        eog = next((e for e in ev if e.get("kind") == "eog"), None)
        picks = replay(ev, rule)
        verdict, why = judge(picks, eog)
        n_ok += verdict == "맞음"
        rows.append((p.name, verdict, why, eog and eog.get("augments"), picks))
    for name, verdict, why, truth, picks in rows:
        print(f"\n== {name}: {verdict}{' — ' + why if why else ''}")
        print(f"   경기 결과 {truth}")
        print(f"   재생 결과 {picks}")
    print(f"\n맞음 {n_ok} / {len(rows)}판")
    print("※ 기록 재생이에요. 기록에 안 남은 것은 알 수 없어요.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
