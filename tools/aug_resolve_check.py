"""증강 툴팁 자리표시자 중 build_data 계산기(lol_calc.Calc)가 못 푸는 것과 그 이유.

    python tools/aug_resolve_check.py          표로 출력
    python tools/aug_resolve_check.py --json   JSON 으로 (tools/aug_audit.js 가 읽는다: docs/증강_해석_실패.json)

원본은 build_data.py 가 받아 둔 .cache/ (kiwi.bin.json · lol.stringtable.json). 못 풀면 화면 설명에 '?' 가 나가고,
그 계산식이 피해·보호막이면 자동 효과(effects)에서도 빠진다.
이유: 원본에 이름 없음(해시 이름 {xxxxxxxx} 이거나 다른 스펠 값) / 모르는 능력치 코드(mStat) / 모르는 계산식 부품.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from build_data import expand_templates  # noqa: E402
from lol_calc import STAT, Calc  # noqa: E402

PLACE = re.compile(r"([A-Za-z_][\w.]*?)(?:\.0)?(?:\*(-?[\d.]+))?")


def fnv(s):
    h = 0x811C9DC5
    for c in s.lower().encode():
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return "{%08x}" % h


def walk(o, out):
    if isinstance(o, dict):
        if o.get("__type"):
            out["types"].add(o["__type"])
        if "mStat" in o and o["mStat"] not in STAT:
            out["stats"].add(o["mStat"])
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)


def check():
    kiwi = json.loads((ROOT / ".cache" / "kiwi.bin.json").read_text(encoding="utf-8"))
    strings = json.loads((ROOT / ".cache" / "lol.stringtable.json").read_text(encoding="utf-8"))["entries"]
    data = json.loads((ROOT / "web" / "data.json").read_text(encoding="utf-8"))
    aug = {v["AugmentNameId"]: v for v in kiwi.values() if isinstance(v, dict) and v.get("__type") == "AugmentData"}
    rows = []
    for a in data["augments"]:
        src = aug.get(a["id"])
        if not src:
            continue
        spell = kiwi.get(src.get("RootSpell", ""), {}).get("mSpell", {})
        calc = Calc(spell)
        calcs = {k.lower(): v for k, v in (spell.get("mSpellCalculations") or {}).items()}
        raw = expand_templates(strings.get((src.get("AugmentTooltipTra") or "").lower()) or "", strings)
        body = re.sub(r"<flavorText>.*?</flavorText>|<[^>]+>|\s+", "", raw, flags=re.S | re.I)
        if len(body) < 15:
            raw = expand_templates(strings.get((src.get("DescriptionTra") or "").lower()) or "", strings) or raw
        seen = set()
        for m in re.finditer(r"@([^@]+)@", raw):
            expr = m.group(1)
            if re.fullmatch(r"f\d+(\.\d+)?(\*[\d.]+)?", expr, re.I) or expr in seen:
                continue
            seen.add(expr)
            mm = PLACE.fullmatch(expr)
            if mm and calc.resolve(mm.group(1), 1)[0] is not None:
                continue
            name = mm.group(1).lower() if mm else expr
            row = {"id": a["id"], "name": a["name"], "ref": expr}
            c = calcs.get(name)
            if c is None and fnv(name) in calcs:
                c = calcs[fnv(name)]
                row["hashed"] = fnv(name)
            if c is None:
                row["why"] = "원본에 이름 없음" + (" (해시 이름 값)" if row.get("hashed") else "")
                hv = next((dv for dv in spell.get("DataValues") or [] if dv["name"] == fnv(name)), None)
                if hv:
                    row["hashed"], row["why"] = fnv(name), f"해시 이름 값 {fnv(name)} = {hv['values'][1]:g}"
            else:
                info = {"types": set(), "stats": set()}
                walk(c, info)
                bad_types = sorted(t for t in info["types"] if t.startswith("{"))
                if info["stats"]:
                    row["why"] = "모르는 능력치 코드 mStat " + ", ".join(map(str, sorted(info["stats"])))
                elif bad_types:
                    row["why"] = "모르는 계산식 부품 " + ", ".join(bad_types)
                else:
                    row["why"] = "계산식 해석 실패 (" + ", ".join(sorted(info["types"])) + ")"
                if row.get("hashed"):
                    ok = calc.calc(row["hashed"], 1)[0] is not None
                    row["why"] = f"해시 이름 계산식 {row['hashed']}" + (" (해시로 찾으면 풀림)" if ok else " · " + row["why"])
            rows.append(row)
    return rows


if __name__ == "__main__":
    out = check()
    if "--json" in sys.argv:
        (ROOT / "docs" / "증강_해석_실패.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for r in out:
        print(f"{r['name']} ({r['id']}) | {r['ref']} | {r['why']}")
    print(f"못 푼 자리표시자 {len(out)}개, 증강 {len({r['id'] for r in out})}개")
