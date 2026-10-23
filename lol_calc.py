"""게임 계산식(mSpellCalculations) 해석기.

스킬·증강 수치를 '기본값 + 레벨 비례 + 능력치 계수' 구조(Expr)로 평가한다.
스킬 레벨(rank)마다 따로 평가할 수 있어서 '40/55/70/85/100 + 40% 주문력' 같은 표시와
화면에서의 실제 수치 계산(최종 능력치 대입)에 같이 쓴다.
"""
import re

# 계산식의 mStat 번호 → (키, 표시 이름).
# 173명 스킬에서 번호별 사용처를 뽑아 실제 계수와 대조해 확정했다 (docs/개발자_문서.md 참고).
STAT = {
    0: ("AP", "주문력"), 1: ("ARMOR", "방어력"), 2: ("AD", "공격력"), 4: ("AS", "공격 속도"),
    6: ("MR", "마법 저항력"), 7: ("MS", "이동 속도"), 8: ("CRIT", "치명타 확률"),
    9: ("CRITDMG", "치명타 피해"), 12: ("HP", "최대 체력"), 14: ("CURHP", "현재 체력"),
    16: ("MISSINGHP", "잃은 체력"), 29: ("LETHALITY", "물리 관통력"), 31: ("RANGE", "사거리"),
    # 증강에서 쓰는 번호 (2026-10-20, 위키 증강 설명과 대조 · docs/증강_원본_대조_결과.md):
    # 11 = 'With Haste'(속행) 이동 속도 = 스킬 가속의 70%, 34 = 'Mercy's Strike'(자비의 일격) 회복·보호막 효과 10%당 +2%,
    # 22·23 = 'Drop Bear'(곰 투하) 마법 관통력 1당 +2 · 1%당 +5
    11: ("HASTE", "스킬 가속"), 22: ("MPEN", "마법 관통력"), 23: ("MPENP", "마법 관통력"), 34: ("HSP", "회복·보호막 효과"),
    -1: ("MANA", "최대 마나"),  # 번호 없음: AbilityResourceByCoefficient 전용
}
# 계수 단위 맞추기: 게임은 % 관통력 계수를 '1%당'으로 적는데 우리 능력치(MPENP)는 0~1 비율이라 100배 (위키 'Drop Bear' 1%당 +5)
STAT_SCALE = {23: 100}
# 0~1 비율로 계산하는 능력치 (설명에 '1%당 N' 으로 표시)
PER_PCT = {"HSP", "MPENP"}
# mStatFormula: 없음/0 = 전체, 1 = 기본, 2 = 추가
FORMULA_PREFIX = {0: "", 1: "base", 2: "bonus"}
PREFIX_NAME = {"": "", "base": "기본 ", "bonus": "추가 "}


def stat_key(p):
    sid = p.get("mStat", 0)
    if sid not in STAT:
        return None
    return FORMULA_PREFIX.get(p.get("mStatFormula", 0), "") + STAT[sid][0]


def stat_label(key):
    for prefix in ("bonus", "base"):
        if key.startswith(prefix):
            base = key[len(prefix):]
            return PREFIX_NAME[prefix] + next(n for k, n in STAT.values() if k == base)
    return next(n for k, n in STAT.values() if k == key)


def fmt_num(v):
    if abs(v - round(v)) < 1e-6:
        return str(int(round(v)))
    if abs(v) >= 10:
        return f"{v:.1f}".rstrip("0").rstrip(".")
    return f"{v:.2f}".rstrip("0").rstrip(".")


class Expr:
    """base + 레벨 비례(lvl: 1레벨값, 18레벨값) + Σ ratios[키] × 능력치"""

    __slots__ = ("base", "lvl", "ratios")

    def __init__(self, base=0.0, lvl=None, ratios=None):
        self.base, self.lvl, self.ratios = base, lvl, dict(ratios or {})

    def add(self, o):
        if isinstance(o, Node):
            return Node("+", [self, o])
        lvl = self.lvl
        if o.lvl:
            lvl = (lvl[0] + o.lvl[0], lvl[1] + o.lvl[1]) if lvl else o.lvl
        r = dict(self.ratios)
        for k, v in o.ratios.items():
            r[k] = r.get(k, 0) + v
        return Expr(self.base + o.base, lvl, r)

    def scale(self, k):
        return Expr(self.base * k, (self.lvl[0] * k, self.lvl[1] * k) if self.lvl else None,
                    {s: v * k for s, v in self.ratios.items()})

    def is_number(self):
        return not self.lvl and not self.ratios


class Node:
    """'기본 + 계수' 한 줄로 못 담는 식 (능력치끼리 곱하는 식: (피해 + 계수) × (1 + 치명타 확률) 등).
    화면(stats.js)이 실제 능력치를 넣어 계산한다. op: '+' 또는 '*'"""

    __slots__ = ("op", "items")

    def __init__(self, op, items):
        self.op, self.items = op, items

    def add(self, o):
        return Node("+", [self, o])

    def scale(self, k):
        return Node("*", [self, Expr(k)])

    def is_number(self):
        return False


def mul(a, b):
    """두 식의 곱: 한쪽이 숫자면 Expr 로, 아니면 Node"""
    if isinstance(b, Expr) and b.is_number():
        return a.scale(b.base)
    if isinstance(a, Expr) and a.is_number():
        return b.scale(a.base)
    return Node("*", [a, b])


def fnv1a(name):
    """CommunityDragon 이 이름을 모르는 값·계산식을 적는 해시 이름 {xxxxxxxx} (소문자 이름의 FNV-1a 32비트)"""
    h = 0x811C9DC5
    for c in (name or "").lower().encode():
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return "{%08x}" % h


def hashed_key(table, name):
    """이름 그대로 없으면 해시 이름으로 찾는다 (승리를 위한 회전 SpinDamageAmp_Ult = {90a024ae}: 설명에 '?' 가 나갔다)"""
    key = (name or "").lower()
    return key if key in table else fnv1a(key) if fnv1a(key) in table else key


# 모드별 수치 덮어쓰기(DataValuesModeOverride) 우선순위: 칼바람 증강 모드 → 칼바람
MODE_OVERRIDES = ("Kiwi", "ARAM")


class Calc:
    def __init__(self, spell, effect_amounts=None, modes=MODE_OVERRIDES):
        self.values = {}
        for dv in spell.get("DataValues", []) or []:
            self.values[dv["name"].lower()] = dv.get("values") or [0]
        self.mode_used = None
        overrides = spell.get("DataValuesModeOverride") or {}
        for m in modes:  # 스킬 수치를 그 모드 값으로 (예: 바드 미프 주문력 계수 50% → 증강 모드 67%)
            if m in overrides:
                for dv in overrides[m].get("SpellDataValues", []) or []:
                    self.values[dv["name"].lower()] = dv.get("values") or [0]
                self.mode_used = m
                break
        self.calcs = {k.lower(): v for k, v in (spell.get("mSpellCalculations") or {}).items()}
        # 계산식 자체의 모드별 덮어쓰기: 이름이 해시인 칸에 {모드: {"Calculations": {...}}} 형태로 들어 있다
        for fv in spell.values():
            if isinstance(fv, dict) and any(isinstance(x, dict) and "Calculations" in x for x in fv.values()):
                for m in modes:
                    if m in fv:
                        for name, c in (fv[m].get("Calculations") or {}).items():
                            self.calcs[name.lower()] = c
                        self.mode_used = self.mode_used or m
                        break
        self.effects = effect_amounts or spell.get("mEffectAmount") or []

    def value(self, name, rank):
        vals = self.values.get(hashed_key(self.values, name))
        if vals is None:
            return None
        return vals[rank] if rank < len(vals) else vals[-1]

    def part(self, p, rank, depth=0):
        if depth > 10 or not isinstance(p, dict):
            return None
        t = p.get("__type")
        if t == "NumberCalculationPart":
            return Expr(p.get("mNumber", 0))
        if t == "NamedDataValueCalculationPart":
            v = self.value(p.get("mDataValue"), rank)
            return None if v is None else Expr(v)
        if t == "EffectValueCalculationPart":
            idx = p.get("mEffectIndex", 1) - 1
            if 0 <= idx < len(self.effects):
                vals = self.effects[idx].get("value") or [0]
                return Expr(vals[rank] if rank < len(vals) else vals[-1])
            return None
        if t in ("StatByCoefficientCalculationPart", "StatByNamedDataValueCalculationPart",
                 "StatBySubPartCalculationPart"):
            key = stat_key(p)
            if key is None:
                return None
            if t == "StatByCoefficientCalculationPart":
                coef = p.get("mCoefficient", 0) * STAT_SCALE.get(p.get("mStat", 0), 1)
            elif t == "StatByNamedDataValueCalculationPart":
                coef = self.value(p.get("mDataValue"), rank)
                coef = None if coef is None else coef * STAT_SCALE.get(p.get("mStat", 0), 1)
            else:
                # 계수가 레벨에 따라 변하면 18레벨 값을 쓴다 (빌드 비교는 풀템 기준이라)
                sub = self.part(p.get("mSubpart"), rank, depth + 1)
                # 계수 단위는 다른 두 경로와 같게 맞춘다 (mStat 23 = 100배, 빠지면 계수가 100배 작게 나왔다)
                unit = STAT_SCALE.get(p.get("mStat", 0), 1)
                if sub is not None and (isinstance(sub, Node) or sub.ratios):  # 계수가 다른 능력치에 따라 변함 → 곱셈 식
                    return Node("*", [Expr(ratios={key: unit}), sub])
                coef = None if sub is None else (sub.base + (sub.lvl[1] if sub.lvl else 0)) * unit
            return None if coef is None else Expr(ratios={key: coef})
        if t == "AbilityResourceByCoefficientCalculationPart":  # 마나 계수 (라이즈 등)
            prefix = FORMULA_PREFIX.get(p.get("mStatFormula", 0), "")
            return Expr(ratios={prefix + "MANA": p.get("mCoefficient", 0)})
        if t == "ByCharLevelFormulaCalculationPart":  # 레벨별 값 표
            # 표마다 시작이 다르다: 럭스·브라움 패시브는 첫 칸 = 1레벨, 카타리나·세트 패시브는 첫 칸이 0(0레벨 자리)이고 둘째 칸 = 1레벨
            vals = p.get("values") or [0]
            off = 1 if len(vals) > 18 and vals[0] == 0 and vals[1] != 0 else 0
            return Expr(lvl=(vals[off], vals[min(17 + off, len(vals) - 1)]))
        if "StartDataValue" in p and "EndDataValue" in p:  # 시작값~끝값 레벨 비례
            a, b = self.value(p["StartDataValue"], rank), self.value(p["EndDataValue"], rank)
            return None if a is None or b is None else Expr(lvl=(a, b))
        if t == "ByCharLevelInterpolationCalculationPart":
            return Expr(lvl=(p.get("mStartValue", 0), p.get("mEndValue", 0)))
        if t == "ByCharLevelBreakpointsCalculationPart":
            # 레벨마다 증가량이 더해지고, 구간(breakpoint)에서 증가량이 바뀌거나(mBonusPerLevelAtAndAfter)
            # 그 레벨에 한 번 더해진다(mAdditionalBonusAtThisLevel). 18레벨 값까지 차례로 더한다
            start = p.get("mLevel1Value", 0)
            per = p.get("mInitialBonusPerLevel", 0)
            bps = {bp.get("mLevel", 99): bp for bp in p.get("mBreakpoints", []) or []}
            end = start
            for lv in range(2, 19):
                bp = bps.get(lv)
                if bp and "mBonusPerLevelAtAndAfter" in bp:
                    per = bp["mBonusPerLevelAtAndAfter"]
                end += per + (bp.get("mAdditionalBonusAtThisLevel", 0) if bp else 0)
            return Expr(lvl=(start, end))
        if t in ("SumOfSubPartsCalculationPart", "ClampSubPartsCalculationPart"):
            total = Expr()
            for sp in p.get("mSubparts", []) or []:
                r = self.part(sp, rank, depth + 1)
                if r is None:
                    return None
                total = total.add(r)
            if t == "ClampSubPartsCalculationPart":
                lo, hi = p.get("mFloor"), p.get("mCeiling")

                def clamp(v):
                    v = max(v, lo) if lo is not None else v
                    return min(v, hi) if hi is not None else v
                if lo is None and hi is None:
                    return total
                if isinstance(total, Expr) and not total.ratios:  # 숫자 · 레벨 비례(1·18레벨 양 끝)는 한계를 그대로 적용
                    if not total.lvl:
                        return Expr(clamp(total.base))
                    return Expr(lvl=(clamp(total.base + total.lvl[0]), clamp(total.base + total.lvl[1])))
                # 능력치 계수가 섞이면 한계를 식으로 못 담아 한계 없이 둔다. 2026-10-23 점검: 원본 전체 9곳(카이사 E 이동 속도·
                # 시전 시간 등 표시용)뿐이고 피해·증강 계산에는 없다. 해석 실패(None)로 바꾸면 카이사 E 설명이 '?'가 됐다
                return total
            return total
        if t == "ProductOfSubPartsCalculationPart":
            a = self.part(p.get("mPart1"), rank, depth + 1)
            b = self.part(p.get("mPart2"), rank, depth + 1)
            if a is None or b is None:
                return None
            return mul(a, b)
        if t == "BuffCounterByCoefficientCalculationPart":  # 게임 중 쌓는 중첩 × 계수 → '중첩당 N' (계산에는 0중첩)
            return Expr(ratios={"STACKS": p.get("mCoefficient", 0)})
        if t == "BuffCounterByNamedDataValueCalculationPart":  # 중첩 × 값 이름
            v = self.value(p.get("mDataValue"), rank)
            return None if v is None else Expr(ratios={"STACKS": v})
        if "mSpellCalculationKey" in p:  # 다른 계산식 참조
            return self.calc(p["mSpellCalculationKey"], rank, depth + 1)[0]
        return None

    def calc(self, name, rank=1, depth=0):
        """(Expr | None, 백분율 표시 여부)"""
        c = self.calcs.get(hashed_key(self.calcs, name))
        if c is None or depth > 10:
            return None, False
        t = c.get("__type")
        if t == "GameCalculationModified":
            base, pct = self.calc(c.get("mModifiedGameCalculation", ""), rank, depth + 1)
            m = self.part(c.get("mMultiplier"), rank, depth + 1)
            if base is None or m is None:
                return None, False
            return mul(base, m), pct
        if t == "GameCalculationConditional":
            return self.calc(c.get("mDefaultGameCalculation", ""), rank, depth + 1)
        total = Expr()
        for p in c.get("mFormulaParts", []) or []:
            r = self.part(p, rank, depth + 1)
            if r is None:
                return None, False
            total = total.add(r)
        if c.get("mMultiplier"):
            m = self.part(c["mMultiplier"], rank, depth + 1)
            if m is None:
                return None, False
            total = mul(total, m)
        return total, bool(c.get("mDisplayAsPercent"))

    def resolve(self, name, rank=1):
        """이름을 값(DataValue)·계산식·구버전 효과값(e1, e2 …)으로 평가. (Expr | None, pct)"""
        v = self.value(name, rank)
        if v is not None:
            return Expr(v), False
        m = re.fullmatch(r"e(\d+)", name or "", re.I)
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(self.effects):
                vals = self.effects[idx].get("value") or [0]
                return Expr(vals[rank] if rank < len(vals) else vals[-1]), False
        return self.calc(name, rank)


def fmt_node(e, pct=False):
    if isinstance(e, Expr):
        return fmt_expr_ranks([e], pct)
    sep = " × " if e.op == "*" else " + "
    inner = sep.join(fmt_node(x) for x in e.items)
    return f"({inner})" if e.op == "*" else inner


def tree_json(e):
    if isinstance(e, Expr):
        out = {"b": round(e.base, 4)}
        if e.lvl:
            out["l"] = [round(e.lvl[0], 4), round(e.lvl[1], 4)]
        if e.ratios:
            out["r"] = {k: round(v, 4) for k, v in e.ratios.items()}
        return out
    return {"op": e.op, "a": [tree_json(x) for x in e.items]}


def fmt_expr_ranks(exprs, pct=False):
    """랭크별 Expr 목록을 '40/55/70 + 40% 주문력' 형태로."""
    if any(isinstance(e, Node) for e in exprs):  # 곱셈 식: 마지막 랭크 기준으로 식 모양 그대로
        return fmt_node(exprs[-1], pct)
    k = 100 if pct else 1
    unit = "%" if pct else ""
    bases = [e.base * k for e in exprs]
    parts = []
    if any(abs(b) > 1e-9 for b in bases) or not any(e.lvl or e.ratios for e in exprs):
        uniq = []
        for b in bases:
            s = fmt_num(b)
            if not uniq or uniq[-1] != s:
                uniq.append(s)
        parts.append("/".join(uniq) + unit if len(set(uniq)) > 1 else uniq[0] + unit)
    lvl = exprs[-1].lvl
    if lvl:
        parts.append(f"{fmt_num(lvl[0] * k)}~{fmt_num(lvl[1] * k)}{unit}(레벨 비례)")
    keys = []
    for e in exprs:
        for key in e.ratios:
            if key not in keys:
                keys.append(key)
    if keys == ["STACKS"] and not parts and abs(exprs[-1].ratios["STACKS"] - 1) < 1e-9:
        return "(게임 중 집계)"  # 중첩 수 그대로 = 플레이 중 누적값 (드레이븐 획득 골드 등)
    for key in keys:
        if key == "STACKS":
            parts.append(f"중첩당 {fmt_num(exprs[-1].ratios[key] * k)}{unit}")
            continue
        if key in PER_PCT:  # 0~1 비율 능력치는 '1%당 N' (계수 750 × 회복·보호막 효과 → 1%당 7.5. '75000%'로 나왔다)
            vals = [fmt_num(e.ratios.get(key, 0) * k / 100) for e in exprs]
            uniq = list(dict.fromkeys(vals))
            parts.append(f"{stat_label(key)} 1%당 {'/'.join(vals) if len(uniq) > 1 else uniq[0]}{unit}")
            continue
        vals = [fmt_num(e.ratios.get(key, 0) * 100) for e in exprs]
        uniq = list(dict.fromkeys(vals))
        parts.append(f"{'/'.join(vals) if len(uniq) > 1 else uniq[0]}% {stat_label(key)}")
    return " + ".join(parts)


def expr_json(exprs):
    """화면 계산용: 랭크별 base, 레벨 비례, 계수(랭크별). 곱셈 식이 섞이면 랭크별 식 나무(tree)."""
    if any(isinstance(e, Node) for e in exprs):
        return {"base": [0] * len(exprs), "tree": [tree_json(e) for e in exprs]}
    keys = sorted({k for e in exprs for k in e.ratios})
    out = {"base": [round(e.base, 4) for e in exprs]}
    if exprs and exprs[-1].lvl:
        out["lvl"] = [round(exprs[-1].lvl[0], 4), round(exprs[-1].lvl[1], 4)]
    if keys:
        out["ratios"] = {k: [round(e.ratios.get(k, 0), 4) for e in exprs] for k in keys}
    return out


PLACEHOLDER = re.compile(r"{{\s*([^}]+?)\s*}}")
