"""한 판 기록 자동 판정: 실게임 확인 항목(안정화 기획서 9.3)을 기록(events.json)으로 해결/재현/확인 못 함으로 나눈다.

    python tools/log_judge.py <data.zip | 게임 기록 폴더 | events.json> [...]   여러 판을 한 번에
    python tools/log_judge.py <...> --md 결과.md                                  표를 파일로

테스터는 '개선용 기록 남기기'를 켜고 한 판 한 뒤 data.zip(또는 logs/games/날짜_챔피언.zip)만 보내면 된다.
판정은 기록에 남은 시각(t, 초)과 내용으로만 한다. 기록에 없는 것(카드 설명을 가렸는지, 버튼 위치 등 눈으로 볼 것)은
'확인 못 함 (영상·스크린샷 필요)'으로 남긴다. 결과:
  해결      기대대로 동작한 사례만 있음
  재현      기대와 다른 사례가 있음 (근거에 시각)
  부분      맞은 사례와 틀린 사례가 섞임
  해당 없음 그 판에 그 상황이 없었음 (예: 한 번도 안 죽음)
  확인 못 함 기록으로 볼 수 없음
기록 항목: shop(상점 열림·닫힘) · dead(죽음·부활, v0.1.55~) · drawn(표시 창이 실제로 그린 것, v0.1.55~) · offers(읽은 선택지) ·
click(클릭·새로고침 버튼) · shown(화면이 보낸 카드 평가·상자 글) · items(산 아이템·골드) · picked(고른 증강)
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOX_GONE_SEC = 2.0     # 상점 닫힘·부활 뒤 이 안에 상자가 사라져야 한다
BOX_SHOWN_SEC = 3.0    # 상점 열림·죽음 뒤 이 안에 상자가 떠야 한다
CARD_LABEL_SEC = 3.0   # 선택지를 읽고 이 안에 카드 3장 평가가 떠야 한다
BUY_SYNC_SEC = 3.0     # 산 뒤 이 안에 상자가 새 골드·아이템으로 바뀌어야 한다
FLICKER_PER_MIN = 6    # 같은 상태에서 상자 크기가 1분에 이만큼 넘게 바뀌면 흔들림


def load_games(path):
    """→ [(이름, events)]. zip 안에 판이 여럿이면 모두"""
    p = Path(path)
    out = []
    if p.suffix == ".zip":
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if n.endswith("events.json"):
                    out.append((n.rsplit("/", 2)[-2] if "/" in n else p.stem, json.loads(z.read(n).decode("utf-8"))))
    elif p.is_dir():
        for f in sorted(p.rglob("events.json")):
            out.append((f.parent.name, json.loads(f.read_text(encoding="utf-8"))))
    else:
        out.append((p.parent.name, json.loads(p.read_text(encoding="utf-8"))))
    return out


def item_names():
    try:
        d = json.loads((ROOT / "web" / "data.json").read_text(encoding="utf-8"))
        return {i["id"]: i["name"] for i in d["items"]}, {i["id"] for i in d["items"] if i.get("kind") == "legendary"}
    except (OSError, ValueError, KeyError):
        return {}, set()


def verdict(ok, bad):
    if not ok and not bad:
        return "해당 없음"
    if bad and ok:
        return "부분"
    return "재현" if bad else "해결"


def first_after(events, t, kinds, pred=lambda e: True, within=None):
    for e in events:
        if e["kind"] in kinds and e["t"] >= t and (within is None or e["t"] - t <= within) and pred(e):
            return e
    return None


def has_box(e):
    return "상점 상자" in (e.get("kinds") or "")


def judge(events):
    names, legendary = item_names()
    ev = sorted(events, key=lambda e: e.get("t", 0))
    have_drawn = any(e["kind"] == "drawn" for e in ev)
    have_dead = any(e["kind"] == "dead" for e in ev)
    rows = []

    def row(area, name, result, why):
        rows.append({"area": area, "name": name, "result": result, "why": why})

    def state_at(t, kind, key, default=None):
        v = default
        for e in ev:
            if e["t"] > t:
                break
            if e["kind"] == kind:
                v = e.get(key)
        return v

    # ---- 증강 선택
    offers = [e for e in ev if e["kind"] == "offers" and e.get("offers")]
    ok, bad = [], []
    for o in offers:
        n_read = sum(1 for x in o["offers"] if x)
        s = first_after(ev, o["t"], {"shown"}, lambda e: any(e.get("cards") or []), CARD_LABEL_SEC)
        n_lab = sum(1 for c in (s.get("cards") if s else []) or [] if c)
        (ok if n_read == 3 and n_lab == 3 else bad).append(f"{o['t']}초 읽음 {n_read}·평가 {n_lab}")
    row("증강", "카드 3장 모두 평가 (#7)", verdict(ok, bad), f"선택지 {len(offers)}번 · " + ("; ".join(bad[:4]) or "모두 3장"))

    if not have_dead:
        row("증강", "죽어 있을 때 뜬 선택 화면 인식 (#8)", "확인 못 함", "죽음 기록(dead)이 없는 버전의 기록")
    else:
        ok, bad = [], []
        for o in offers:
            if not state_at(o["t"], "dead", "dead", False):
                continue
            near = [e for e in ev if e["kind"] == "near" and o["t"] - 15 <= e["t"] < o["t"]]
            lag = round(o["t"] - near[0]["t"], 1) if near else 0.0
            (ok if lag <= 2.5 else bad).append(f"{o['t']}초 (조각 글자부터 {lag}초)")
        row("증강", "죽어 있을 때 뜬 선택 화면 인식 (#8)", verdict(ok, bad), "; ".join((bad or ok)[:4]) or "죽은 채 뜬 선택 화면 없음")

    clicks = [e for e in ev if e["kind"] == "click" and e.get("reroll") is not None]
    ok, bad = [], []
    for c in clicks:
        slot = c["reroll"]
        old = state_at(c["t"], "offers", "offers")
        old_name = old[slot] if old and slot < len(old) else None
        nxt = first_after(ev, c["t"] + 0.01, {"shown"}, lambda e: any(e.get("cards") or []), 6)
        card = (nxt.get("cards") or [None] * 3)[slot] if nxt else None
        if not nxt:
            continue
        stale = bool(card and old_name and card.startswith(old_name + ":"))
        advise = bool(card and "새로고침?" in card)
        (bad if stale or advise else ok).append(f"{c['t']}초 {slot + 1}번 칸" + (" 옛 평가 남음" if stale else "") + (" 새로고침 또 권함" if advise else ""))
    row("증강", "새로고침 후 옛 평가 지우기·'새로고침 씀' 반영 (#7 #9)", verdict(ok, bad) if clicks else "해당 없음",
        f"새로고침 클릭 {len(clicks)}번 · " + ("; ".join(bad[:4]) or "문제 없음"))
    picked = [e for e in ev if e["kind"] == "picked" and e.get("picked")]
    row("증강", "고른 증강 인식 (참고)", "해결" if picked else "해당 없음", f"고른 증강 {len(picked)}개: " + ", ".join(e["picked"] for e in picked))
    row("증강", "증강 4개 뒤 추천 영역 전환 (#15)", "확인 못 함", "애드온 창 화면이라 기록에 없음 (스크린샷 필요)")

    # ---- 상점·상자
    shops = [e for e in ev if e["kind"] == "shop"]
    if not have_drawn:
        for n in ("처음 연 상점에 상자 (#10)", "상점 닫으면 상자 바로 사라짐 (#11)", "부활하면 상자 바로 사라짐 (#11)"):
            row("상점", n, "확인 못 함", "그린 기록(drawn)이 없는 버전의 기록")
    else:
        opens = [e for e in shops if e.get("open")]
        if opens:
            o = opens[0]
            d = first_after(ev, o["t"], {"drawn"}, has_box, BOX_SHOWN_SEC)
            row("상점", "처음 연 상점에 상자 (#10)", "해결" if d else "재현",
                f"{o['t']}초 열림 → " + (f"{round(d['t'] - o['t'], 1)}초 뒤 상자" if d else f"{BOX_SHOWN_SEC:g}초 안에 상자 없음"))
        else:
            row("상점", "처음 연 상점에 상자 (#10)", "해당 없음", "상점을 연 기록 없음")
        ok, bad = [], []
        for c in (e for e in shops if not e.get("open")):
            if state_at(c["t"], "dead", "dead", False):
                continue  # 죽어 있으면 상자가 남는 게 맞다
            gone = first_after(ev, c["t"], {"drawn"}, lambda e: not has_box(e), BOX_GONE_SEC)
            (ok if gone else bad).append(f"{c['t']}초 닫힘" + ("" if gone else f" → {BOX_GONE_SEC:g}초 넘게 상자"))
        row("상점", "상점 닫으면 상자 바로 사라짐 (#11)", verdict(ok, bad), "; ".join(bad[:4]) or f"닫힘 {len(ok)}번 모두 사라짐")
        ok, bad = [], []
        for r in (e for e in ev if e["kind"] == "dead" and not e.get("dead")):
            if state_at(r["t"], "shop", "open", False):
                continue  # 상점이 열려 있으면 상자가 남는 게 맞다
            gone = first_after(ev, r["t"], {"drawn"}, lambda e: not has_box(e), BOX_GONE_SEC)
            (ok if gone else bad).append(f"{r['t']}초 부활" + ("" if gone else f" → {BOX_GONE_SEC:g}초 넘게 상자"))
        row("상점", "부활하면 상자 바로 사라짐 (#11)", verdict(ok, bad) if have_dead else "확인 못 함", "; ".join(bad[:4]) or f"부활 {len(ok)}번 모두 사라짐")
        ok, bad = [], []
        for dd in (e for e in ev if e["kind"] == "dead" and e.get("dead")):
            d = first_after(ev, dd["t"], {"drawn"}, has_box, BOX_SHOWN_SEC + 3)
            (ok if d else bad).append(f"{dd['t']}초 죽음" + (f" → {round(d['t'] - dd['t'], 1)}초 뒤 상자" if d else " → 상자 없음"))
        row("상점", "죽어 있을 때 상자 (#10)", verdict(ok, bad) if have_dead else "확인 못 함", "; ".join(bad[:4]) or "; ".join(ok[:3]))

    # 산 직후: 상자가 산 아이템을 다시 권하거나, 산 뒤 골드보다 비싼 것을 '지금 살 것'으로 남기지 않는가
    ok, bad = [], []
    for i, it in enumerate(e for e in ev if e["kind"] == "items"):
        if i == 0:
            continue
        bought = {names.get(x, x) for x in it.get("items") or [] if x in legendary}
        gold = it.get("gold")
        late = [s for s in ev if s["kind"] == "shown" and it["t"] + BUY_SYNC_SEC <= s["t"] <= it["t"] + BUY_SYNC_SEC + 5]
        probs = []
        for s in late[:1]:
            box = s.get("box") or []
            nxt = next((l for l in box if l.startswith("다음 구매: ")), "")
            again = [n for n in bought if re.search(re.escape(n) + r"(\(|$| >)", nxt[len("다음 구매: "):])]
            if again:
                probs.append(f"산 {again[0]}을 다시 권함")
            m = next((re.search(r"\((\d+)G · ([\d,]+)G 기준\)", l) for l in box if l.startswith("💰")), None)
            if m and gold is not None and int(m.group(2).replace(",", "")) > gold + 50 and int(m.group(1)) > gold:
                probs.append(f"💰 {m.group(1)}G (기준 {m.group(2)}G, 실제 {gold}G)")
        if late:
            (bad if probs else ok).append(f"{it['t']}초 " + (", ".join(probs) or "맞음"))
    row("상점", "산 직후 골드·아이템 반영 (#12)", verdict(ok, bad), "; ".join(bad[:4]) or f"구매 {len(ok)}번 확인")

    # ---- 화면 표시
    if have_drawn:
        boxes = [e for e in ev if e["kind"] == "drawn" and e.get("kinds") == "상점 상자" and e.get("where")]
        changes = sum(1 for a, b in zip(boxes, boxes[1:]) if a["where"] != b["where"] and b["t"] - a["t"] < 60)
        span = (boxes[-1]["t"] - boxes[0]["t"]) / 60 if len(boxes) > 1 else 0
        rate = changes / span if span else 0
        row("화면", "상자 크기·위치 흔들림 (#20)", "해당 없음" if not boxes else ("재현" if rate > FLICKER_PER_MIN else "해결"),
            f"상자 크기·위치 변경 {changes}번 / {round(span, 1)}분")
        on_right = [e for e in ev if e["kind"] == "drawn" and has_box(e) and e.get("where") and e["where"][0] > 0.5
                    and state_at(e["t"], "shop", "open", False)]
        row("화면", "상점이 열렸을 때 상자가 상점 창을 피함 (#19)", "재현" if on_right else ("해결" if boxes else "해당 없음"),
            f"상점이 열린 채 오른쪽에 그린 상자 {len(on_right)}번")
        dead_top = [e for e in ev if e["kind"] == "drawn" and has_box(e) and e.get("where") and e["where"][1] < 0.27 and e["where"][0] < 0.3
                    and state_at(e["t"], "dead", "dead", False)]
        row("화면", "죽어 있을 때 죽음 정보 창을 가리지 않음 (#19)", "재현" if dead_top else ("해결" if have_dead else "확인 못 함"),
            f"죽어 있을 때 왼쪽 위 0~27%에 그린 상자 {len(dead_top)}번")
    else:
        for n in ("상자 크기·위치 흔들림 (#20)", "상점이 열렸을 때 상자가 상점 창을 피함 (#19)", "죽어 있을 때 죽음 정보 창을 가리지 않음 (#19)"):
            row("화면", n, "확인 못 함", "그린 기록(drawn)이 없는 버전의 기록")
    cut = [l for s in ev if s["kind"] == "shown" for l in (s.get("box") or []) if "→" in l and l.endswith("…")]
    row("화면", "상자 아이템 이름 잘림 (#20)", "재현" if cut else "해결", f"잘린 조언 줄 {len(cut)}개" + (f": {cut[0][:40]}" if cut else ""))
    for n, why in (("카드 평가가 카드 설명을 가리지 않음 (#18)", "그린 자리는 있지만 설명 위치는 화면마다 달라 영상·스크린샷 필요"),
                   ("상단 버튼 위치 고정 (#21)", "애드온 창 화면이라 기록에 없음"), ("⚙ 설정 창 닫기 (#22)", "애드온 창 화면이라 기록에 없음")):
        row("화면", n, "확인 못 함", why)
    perf = next((e for e in ev if e["kind"] == "perf"), None)
    if perf:
        ms = perf.get("ms") or {}
        main_ = {k: v for k, v in ms.items() if isinstance(v, dict) and "p95" in v}
        row("성능", "처리 시간 (참고)", "해결", " · ".join(f"{k} 평균 {v['avg']}ms/95% {v['p95']}ms" for k, v in list(main_.items())[:5]) or "기록 없음")
    return rows


def markdown(results):
    L = ["# 한 판 기록 자동 판정", "", "결과: 해결 · 재현 · 부분 · 해당 없음 · 확인 못 함. 근거의 '초'는 기록 시작부터 시각이에요.", ""]
    for name, rows in results:
        L += [f"## {name}", "", "| 영역 | 확인 항목 | 결과 | 근거 |", "|---|---|---|---|"]
        L += [f"| {r['area']} | {r['name']} | {r['result']} | {r['why'].replace('|', '/')} |" for r in rows]
        L.append("")
    return "\n".join(L)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--md"]
    md_out = sys.argv[sys.argv.index("--md") + 1] if "--md" in sys.argv else None
    if md_out:
        args.remove(md_out)
    if not args:
        print(__doc__)
        sys.exit(1)
    results = [(name, judge(events)) for a in args for name, events in load_games(a)]
    text = markdown(results)
    if md_out:
        Path(md_out).write_text(text + "\n", encoding="utf-8")
    print(text)
