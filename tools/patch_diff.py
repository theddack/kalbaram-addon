"""두 data.json(= 두 패치)의 원본 값을 통째로 비교한다. 적용하지 않고 보기만 한다.

  python tools/patch_diff.py <옛 data.json> <새 data.json> [--full]

패치 노트는 사람이 쓴 요약이라 빠지는 게 있어서, 실제로 추천에 쓰는 값만 본다.
  · 챔피언: 기본 능력치·성장치, 스킬 재사용 대기시간·피해 계수, 칼바람/증강 모드 전용 보정
  · 아이템: 추가·삭제, 가격, 능력치, 고유 효과 수치, 모드 전용 수치
  · 증강: 추가·삭제, 설명, 수치(statsResolved)
  · rules.json 로 직접 적어 둔 수치가 새 원본 설명과 어긋나는지 (build_data 의 check 문구)
--full 을 주면 바뀐 항목을 전부 찍는다 (기본은 종류마다 앞 15개).
"""
import argparse
import io
import json
import re
from collections import Counter

J = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True)


def load(p):
    return json.load(io.open(p, encoding="utf-8"))


def show(rows, full, label):
    print(f"\n### {label} — {len(rows)}건")
    for r in rows if full else rows[:15]:
        print("  " + r)
    if not full and len(rows) > 15:
        print(f"  … 그 밖 {len(rows) - 15}건 (--full 로 전부)")


def champ_diff(a, b, full):
    A = {c["id"]: c for c in a["champions"]}
    B = {c["id"]: c for c in b["champions"]}
    show([f"추가 {B[k]['name']}" for k in sorted(set(B) - set(A))]
         + [f"삭제 {A[k]['name']}" for k in sorted(set(A) - set(B))], full, "챔피언 추가·삭제")
    stat_rows, spell_rows, mode_rows = [], [], []
    for k in sorted(set(A) & set(B)):
        x, y = A[k], B[k]
        for f in ("stats", "aram", "asRatio", "melee"):
            if J(x.get(f)) != J(y.get(f)):
                if f == "stats":
                    for s in sorted(set(x["stats"]) | set(y["stats"])):
                        if J(x["stats"].get(s)) != J(y["stats"].get(s)):
                            stat_rows.append(f"{y['name']} {s}: {x['stats'].get(s)} → {y['stats'].get(s)}")
                else:
                    (mode_rows if f == "aram" else stat_rows).append(
                        f"{y['name']} {f}: {J(x.get(f))[:90]} → {J(y.get(f))[:90]}")
        xs = {s["slot"]: s for s in x["spells"]}
        ys = {s["slot"]: s for s in y["spells"]}
        for slot in "QWER":
            p, q = xs.get(slot), ys.get(slot)
            if not p or not q:
                continue
            if J(p["cooldown"]) != J(q["cooldown"]):
                spell_rows.append(f"{y['name']} {slot} 재사용 대기시간 {p['cooldown'][:3]} → {q['cooldown'][:3]}")
            pe = {e.get("name"): e for e in p["effects"]}
            qe = {e.get("name"): e for e in q["effects"]}
            for n in sorted(set(pe) | set(qe)):
                if J(pe.get(n)) != J(qe.get(n)):
                    spell_rows.append(f"{y['name']} {slot} 효과 {n}: {J(pe.get(n))[:70]} → {J(qe.get(n))[:70]}")
        if J(x.get("passive")) != J(y.get("passive")):
            spell_rows.append(f"{y['name']} 기본 지속 효과 바뀜")
    show(stat_rows, full, "챔피언 능력치")
    show(spell_rows, full, "챔피언 스킬 (재사용 대기시간·피해 계수·패시브)")
    show(mode_rows, full, "칼바람/증강 모드 전용 챔피언 보정")


def item_diff(a, b, full):
    A = {i["name"]: i for i in a["items"]}
    B = {i["name"]: i for i in b["items"]}
    show([f"추가 {k} ({B[k].get('kind')}, {B[k].get('gold')}골드)" for k in sorted(set(B) - set(A))]
         + [f"삭제 {k}" for k in sorted(set(A) - set(B))], full, "아이템 추가·삭제")
    rows = []
    for k in sorted(set(A) & set(B)):
        x, y = A[k], B[k]
        for f in ("gold", "stats", "effects", "passiveStats", "modeValues", "kind", "limit"):
            if J(x.get(f)) != J(y.get(f)):
                rows.append(f"{k} {f}: {J(x.get(f))[:110]} → {J(y.get(f))[:110]}")
    show(rows, full, "아이템 값")


def aug_diff(a, b, full):
    A = {x["id"]: x for x in a["augments"]}
    B = {x["id"]: x for x in b["augments"]}
    show([f"추가 {B[k]['name']} ({k}, {B[k].get('tier')})" for k in sorted(set(B) - set(A))]
         + [f"삭제 {A[k]['name']} ({k})" for k in sorted(set(A) - set(B))], full, "증강 추가·삭제")
    rows = []
    for k in sorted(set(A) & set(B)):
        x, y = A[k], B[k]
        for f in ("desc", "tier", "effects", "tags"):
            if J(x.get(f)) != J(y.get(f)):
                rows.append(f"{y['name']}({k}) {f}: {J(x.get(f))[:110]} → {J(y.get(f))[:110]}")
    show(rows, full, "증강 값")
    ra, rb = a["rules"]["augments"], b["rules"]["augments"]
    rows = [f"{k} statsResolved: {J((ra.get(k) or {}).get('statsResolved'))} → {J((rb.get(k) or {}).get('statsResolved'))}"
            for k in sorted(set(ra) | set(rb))
            if J((ra.get(k) or {}).get("statsResolved")) != J((rb.get(k) or {}).get("statsResolved"))]
    show(rows, full, "증강 규칙 수치(statsResolved)")


def rules_vs_new(b, full):
    """rules.json 로 적어 둔 수치가 새 원본 설명과 어긋나는 자리 (build_data 의 check 문구 그대로)"""
    rows = []
    items = {i["name"]: i for i in b["items"]}
    for name, r in (b["rules"].get("items") or {}).items():
        it = items.get(name)
        if not it:
            rows.append(f"{name}: 새 패치에 아이템이 없음 → 규칙 미적용")
            continue
        chk = r.get("check")
        plain = re.sub(r"<[^>]+>", "", (it.get("passiveHtml") or "") + it.get("desc", ""))
        if chk and chk not in plain:
            rows.append(f"{name}: 설명에 '{chk}' 없음 → 수치 바뀐 듯, 규칙 미적용")
        elif r.get("stats") and not it.get("passiveStats"):
            rows.append(f"{name}: 규칙 수치가 아이템에 안 붙음")
    augs = {x["id"] for x in b["augments"]}
    for aid, r in (b["rules"].get("augments") or {}).items():
        if (r.get("stats") or r.get("statsResolved")) and aid not in augs:
            rows.append(f"증강 {aid}: 새 패치에 없음 → 규칙 미적용")
    show(rows, full, "rules.json 수치와 새 원본의 불일치")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args()
    A, B = load(a.old), load(a.new)
    print(f"# 패치 비교: {A['version']} ({A['dataVersion'][:12]}) → {B['version']} ({B['dataVersion'][:12]})")
    print(f"  만든 때 {A['builtAt']} → {B['builtAt']}")
    champ_diff(A, B, a.full)
    item_diff(A, B, a.full)
    aug_diff(A, B, a.full)
    rules_vs_new(B, a.full)
    print("\n# 요약")
    print(f"  챔피언 {len(A['champions'])}→{len(B['champions'])} · 아이템 {len(A['items'])}→{len(B['items'])} "
          f"· 증강 {len(A['augments'])}→{len(B['augments'])}")
    print(f"  비활성 증강 {len(A.get('disabled') or [])}→{len(B.get('disabled') or [])}: "
          f"{', '.join(B.get('disabled') or [])}")
    pc = Counter(r["status"] for x in B["augments"] + B["champions"] for r in (x.get("patchCheck") or []))
    print(f"  새 패치 노트 대조: {dict(pc)}")


if __name__ == "__main__":
    main()
