"""커뮤니티드래곤 데이터 대조.

  python tools/local_wad.py compare                   → 기본 대상(맵·증강 모드·아이템 + 대표 챔피언) 대조
  python tools/local_wad.py compare Jinx Vayne items  → 고른 대상만 대조
  python tools/local_wad.py compare --all-champions   → 챔피언 전부 대조
  python tools/local_wad.py dump Jinx [출력.json]     → 커뮤니티드래곤과 같은 모양의 JSON 으로

게임 폴더는 --game <폴더> 또는 환경 변수 LOL_DIR. 없으면 흔한 설치 위치를 찾는다.
이름 해시 목록·커뮤니티드래곤 응답은 .cache/ 에 저장한다.
필요한 패키지: zstandard, xxhash (requirements-data.txt).
"""
import json
import math
import os
import struct
import sys
import urllib.request
from pathlib import Path

import xxhash
import zstandard

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
CDRAGON = "https://raw.communitydragon.org/latest"
HASH_URL = "https://raw.communitydragon.org/data/hashes/lol"
GAME_DIRS = [r"C:\Riot Games\League of Legends", r"D:\Riot Games\League of Legends",
             r"E:\D_Program\Riot Games\League of Legends", "/Applications/League of Legends.app/Contents/LoL"]
DEFAULT_CHAMPS = ["Jinx", "Vayne", "Kaisa", "Samira", "Tristana", "Kayle", "Ahri", "Garen"]
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.lower().encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def xxh64(s):
    return xxhash.xxh64_intdigest(s.lower().encode("utf-8"))


# ---------------------------------------------------------------- WAD (RW 3.x)

class Wad:
    """WAD 3.x: 헤더 + 목차(경로 xxh64 → 위치·압축). 경로 이름은 파일에 없어서 경로를 알아야 꺼낼 수 있다."""

    def __init__(self, path):
        self.path = Path(path)
        with open(self.path, "rb") as f:
            head = f.read(4)
            if head[:2] != b"RW" or head[2] != 3:
                raise ValueError(f"WAD 3.x 가 아님: {self.path.name} ({head!r})")
            f.seek(4 + 256 + 8)  # 서명 256 + 체크섬 8
            (n,) = struct.unpack("<I", f.read(4))
            toc = f.read(32 * n)
        self.entries = {}
        for i in range(n):
            h, off, csize, size, typ, _dup, sub, _ck = struct.unpack_from("<QIIIBBHQ", toc, 32 * i)
            self.entries[h] = (off, csize, size, typ)

    def has(self, path):
        return xxh64(path) in self.entries

    def read(self, path):
        e = self.entries.get(path if isinstance(path, int) else xxh64(path))
        if e is None:
            raise KeyError(f"{self.path.name} 에 없음: {path}")
        off, csize, size, typ = e
        with open(self.path, "rb") as f:
            f.seek(off)
            raw = f.read(csize)
        kind = typ & 0x0F
        if kind == 0:
            return raw
        if kind == 1:
            import gzip
            return gzip.decompress(raw)
        if kind == 3:
            return zstandard.ZstdDecompressor().decompress(raw, max_output_size=size)
        if kind == 4:  # 조각 묶음: 압축 안 된 조각과 zstd 조각이 섞여 있다
            out, i, magic = bytearray(), 0, b"\x28\xb5\x2f\xfd"
            while i < len(raw):
                j = raw.find(magic, i)
                if j < 0:
                    out += raw[i:]
                    break
                out += raw[i:j]
                obj = zstandard.ZstdDecompressor().decompressobj()
                out += obj.decompress(raw[j:])
                i = len(raw) - len(obj.unused_data)
            return bytes(out)
        raise ValueError(f"모르는 압축 {kind}: {path}")


# ---------------------------------------------------------------- BIN (PROP)

class H(int):
    """해시 값. kind: 'fnv'(32비트 이름) · 'link'(다른 항목) · 'path'(64비트 파일 경로)."""

    def __new__(cls, v, kind):
        o = int.__new__(cls, v)
        o.kind = kind
        return o


BOOL, S8, U8, S16, U16, S32, U32, S64, U64, F32, VEC2, VEC3, VEC4, MTX44, RGBA, STRING, HASH, PATH = range(1, 19)
LIST, LIST2, POINTER, EMBED, LINK, OPTION, MAP, FLAG = range(0x80, 0x88)
_FIXED = {BOOL: "?", S8: "b", U8: "B", S16: "h", U16: "H", S32: "i", U32: "I", S64: "q", U64: "Q", F32: "f", FLAG: "?"}
_VEC = {VEC2: 2, VEC3: 3, VEC4: 4, MTX44: 16}


class Obj(dict):
    """embed·pointer 값. cls 는 클래스 이름 해시."""

    def __init__(self, cls, fields):
        super().__init__(fields)
        self.cls = cls


class _Reader:
    def __init__(self, data):
        self.d, self.i = data, 0

    def take(self, fmt):
        v = struct.unpack_from("<" + fmt, self.d, self.i)
        self.i += struct.calcsize("<" + fmt)
        return v if len(v) > 1 else v[0]

    def string(self):
        n = self.take("H")
        s = self.d[self.i:self.i + n].decode("utf-8", errors="replace")
        self.i += n
        return s

    def value(self, t):
        if t in _FIXED:
            return self.take(_FIXED[t])
        if t == MTX44:
            m = self.take("16f")
            return [list(m[i:i + 4]) for i in range(0, 16, 4)]
        if t in _VEC:
            return list(self.take("f" * _VEC[t]))
        if t == RGBA:
            return list(self.take("4B"))
        if t == STRING:
            return self.string()
        if t == HASH:
            return H(self.take("I"), "fnv")
        if t == PATH:
            return H(self.take("Q"), "path")
        if t == LINK:
            return H(self.take("I"), "link")
        if t in (LIST, LIST2):
            vt, _size, n = self.take("BII")
            return [self.value(vt) for _ in range(n)]
        if t in (POINTER, EMBED):
            cls = self.take("I")
            if cls == 0:
                return None
            _size, n = self.take("IH")
            return Obj(H(cls, "fnv"), self.fields(n))
        if t == OPTION:
            vt, n = self.take("BB")
            return self.value(vt) if n else None
        if t == MAP:
            kt, vt, _size, n = self.take("BBII")
            return [(self.value(kt), self.value(vt)) for _ in range(n)]
        raise ValueError(f"모르는 값 종류 {t} (위치 {self.i})")

    def fields(self, n):
        out = {}
        for _ in range(n):
            name, t = self.take("IB")
            out[H(name, "fnv")] = self.value(t)
        return out


def parse_bin(data):
    """bin → {항목 해시: Obj}. 이름은 해시 그대로 둔다 (named() 로 이름 붙이기)."""
    r = _Reader(data)
    magic = r.d[:4]
    r.i = 4
    if magic == b"PTCH":
        r.i += 8
        magic, r.i = r.d[r.i:r.i + 4], r.i + 4
    if magic != b"PROP":
        raise ValueError(f"bin 이 아님: {magic!r}")
    version = r.take("I")
    if version >= 2:
        for _ in range(r.take("I")):
            r.string()
    n = r.take("I")
    types = [r.take("I") for _ in range(n)]
    entries = {}
    for cls in types:
        size = r.take("I")
        end = r.i + size
        path, nf = r.take("IH")
        entries[H(path, "link")] = Obj(H(cls, "fnv"), r.fields(nf))
        r.i = end
    return entries


# ---------------------------------------------------------------- 이름 해시

class Names:
    """커뮤니티드래곤(CDTB) 해시 목록으로 해시 → 이름. 없으면 '{8자리}' 처럼 해시를 그대로 쓴다."""

    FILES = ("binentries", "binfields", "bintypes", "binhashes")

    def __init__(self):
        self.fnv = {}
        d = CACHE / "hashes"
        d.mkdir(parents=True, exist_ok=True)
        for name in self.FILES:
            p = d / f"hashes.{name}.txt"
            if not p.exists():
                print(f"해시 목록 받는 중: {p.name}", file=sys.stderr)
                urllib.request.urlretrieve(f"{HASH_URL}/{p.name}", p)
            with open(p, encoding="utf-8", errors="replace") as f:
                for line in f:
                    h, _, s = line.rstrip("\n").partition(" ")
                    if s:
                        self.fnv.setdefault(int(h, 16), s)

    def name(self, h):
        if h.kind == "path":
            return f"{{{int(h):016x}}}"
        return self.fnv.get(int(h)) or f"{{{int(h):08x}}}"


def named(v, names):
    """parse_bin 결과 → 커뮤니티드래곤 .bin.json 과 같은 모양 (dict·list·이름 문자열)."""
    if isinstance(v, Obj):
        out = {names.name(k): named(x, names) for k, x in v.items()}
        out["__type"] = names.name(v.cls)
        return out
    if isinstance(v, dict):  # parse_bin 결과 (항목 해시 → Obj)
        return {names.name(k): named(x, names) for k, x in v.items()}
    if isinstance(v, H):
        return names.name(v)
    if isinstance(v, list):
        if v and isinstance(v[0], tuple):
            return {_key(k, names): named(x, names) for k, x in v}
        return [named(x, names) for x in v]
    if isinstance(v, float):
        return _f32(v)
    return v


def _key(k, names):
    if isinstance(k, H):
        return names.name(k)
    return str(k).lower() if isinstance(k, bool) else str(k)


def _f32(x):
    """f32 를 짧은 십진수로 (0.10000000149 → 0.1)."""
    if not math.isfinite(x):
        return x
    for p in range(6, 10):
        y = float(f"{x:.{p}g}")
        if struct.unpack("<f", struct.pack("<f", y))[0] == x:
            return y
    return x


# ---------------------------------------------------------------- 게임 폴더 · 대상

class Game:
    def __init__(self, folder=None):
        cands = [folder] if folder else [os.environ.get("LOL_DIR")] + GAME_DIRS
        for c in filter(None, cands):
            if (Path(c) / "Game" / "DATA" / "FINAL").is_dir():
                self.root = Path(c)
                break
        else:
            raise SystemExit("롤 게임 폴더를 못 찾았어요. --game <폴더> 또는 LOL_DIR 로 알려 주세요.")
        self.final = self.root / "Game" / "DATA" / "FINAL"
        self._wads = {}

    @property
    def version(self):
        return json.loads((self.root / "Game" / "content-metadata.json").read_text(encoding="utf-8"))["version"]

    def wad(self, rel):
        if rel not in self._wads:
            self._wads[rel] = Wad(self.final / rel)
        return self._wads[rel]

    def champions(self):
        return sorted(p.name.split(".")[0] for p in (self.final / "Champions").glob("*.wad.client")
                      if p.name.count(".") == 2)

    def target(self, name):
        """대상 이름 → (wad 상대 경로, wad 안 경로, 커뮤니티드래곤 주소)."""
        low = name.lower()
        if low == "map12":
            return "Maps/Shipping/Map12.wad.client", "data/maps/shipping/map12/map12.bin", \
                f"{CDRAGON}/game/data/maps/shipping/map12/map12.bin.json"
        if low == "kiwi":
            return "Maps/Shipping/Map12.wad.client", "maps/modespecificdata/kiwi.bin", \
                f"{CDRAGON}/game/maps/modespecificdata/kiwi.bin.json"
        if low == "items":
            # 확장자 없는 경로 'items' (아이템 2,800여 항목이 한 bin). 커뮤니티드래곤은 items.cdtb.bin 으로 내보낸다
            return "Global.wad.client", "items", f"{CDRAGON}/game/items.cdtb.bin.json"
        champ = next((c for c in self.champions() if c.lower() == low), None)
        if not champ:
            raise SystemExit(f"모르는 대상: {name} (map12 · kiwi · items · 챔피언 이름)")
        return f"Champions/{champ}.wad.client", f"data/characters/{low}/{low}.bin", \
            f"{CDRAGON}/game/data/characters/{low}/{low}.bin.json"

    def read(self, name):
        rel, inner, _ = self.target(name)
        return parse_bin(self.wad(rel).read(inner))


def fetch_cd(url):
    p = CACHE / "local_wad" / "cdragon" / url.split("/latest/", 1)[1]
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "kalbaram-addon"})
        with urllib.request.urlopen(req, timeout=120) as r:
            p.write_bytes(r.read())
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- 대조

def _canon_name(s):
    """커뮤니티드래곤의 이름 또는 '{8자리}' → 32비트 해시."""
    if isinstance(s, str) and len(s) == 10 and s[0] == "{" and s[-1] == "}":
        try:
            return int(s[1:-1], 16)
        except ValueError:
            pass
    return fnv1a(s)


def _canon_path(s):
    if isinstance(s, str) and len(s) == 18 and s[0] == "{" and s[-1] == "}":
        return int(s[1:-1], 16)
    return xxh64(s)


def compare(mine, cd, names, limit=30):
    """내 parse_bin 결과와 커뮤니티드래곤 JSON 을 해시 기준으로 맞춰 본다. 차이 목록을 돌려준다."""
    diffs = []

    def add(path, what):
        diffs.append(f"{path}: {what}")

    def same_float(a, b):
        return a == b or abs(a - b) <= max(1e-6, 1e-5 * max(abs(a), abs(b)))

    def walk(a, b, path):
        if len(diffs) > 5000:
            return
        if isinstance(a, Obj):
            if not isinstance(b, dict):
                return add(path, f"객체인데 커뮤니티드래곤은 {type(b).__name__}")
            if "__type" in b and _canon_name(b["__type"]) != int(a.cls):
                add(path, f"클래스 다름 {names.name(a.cls)} ≠ {b['__type']}")
            bk = {_canon_name(k): v for k, v in b.items() if k != "__type"}
            for k, x in a.items():
                p = f"{path}.{names.name(k)}"
                if int(k) not in bk:
                    if x not in (None, [], {}):
                        add(p, "커뮤니티드래곤에 없음")
                    continue
                walk(x, bk.pop(int(k)), p)
            for k, v in bk.items():
                if v not in (None, [], {}):
                    add(f"{path}.{names.fnv.get(k, f'{{{k:08x}}}')}", "게임 파일에 없음")
        elif isinstance(a, H):
            if b is None:
                return add(path, "커뮤니티드래곤에 없음")
            if not isinstance(b, (str, int)):
                return add(path, f"해시인데 커뮤니티드래곤은 {type(b).__name__}")
            want = b if isinstance(b, int) else (_canon_path(b) if a.kind == "path" else _canon_name(b))
            if want != int(a) and not (a.kind == "fnv" and isinstance(b, str) and xxh64(b) & 0xFFFFFFFF == int(a)):
                add(path, f"{names.name(a)} ≠ {b}")
        elif isinstance(a, list) and a and isinstance(a[0], tuple):
            if not isinstance(b, dict):
                return add(path, f"맵인데 커뮤니티드래곤은 {type(b).__name__}")
            bk = {}
            for k, v in b.items():
                bk[k] = v
                if k.startswith("{") or not k.lstrip("-").isdigit():
                    bk[str(_canon_name(k))] = v
            for k, x in a:
                key = str(int(k)) if isinstance(k, H) else _key(k, names)
                if key not in bk:
                    add(f"{path}[{_key(k, names)}]", "커뮤니티드래곤에 없음")
                else:
                    walk(x, bk[key], f"{path}[{_key(k, names)}]")
            if len(b) != len(a):
                add(path, f"맵 크기 {len(a)} ≠ {len(b)}")
        elif isinstance(a, list):
            if not isinstance(b, list):
                return add(path, f"목록인데 커뮤니티드래곤은 {type(b).__name__}")
            if len(a) != len(b):
                add(path, f"목록 길이 {len(a)} ≠ {len(b)}")
            for i, (x, y) in enumerate(zip(a, b)):
                walk(x, y, f"{path}[{i}]")
        elif isinstance(a, float):
            if not isinstance(b, (int, float)) or isinstance(b, bool) or not same_float(a, float(b)):
                add(path, f"{_f32(a)} ≠ {b}")
        elif a is None:
            if b not in (None, [], {}):
                add(path, f"비어 있음 ≠ {json.dumps(b, ensure_ascii=False)[:60]}")
        elif a != b:
            add(path, f"{a!r} ≠ {b!r}")

    bk = {_canon_name(k): v for k, v in cd.items() if k != "__linked"}  # __linked: 커뮤니티드래곤이 붙인 연결 파일 목록
    for k, e in mine.items():
        nm = names.name(k)
        if int(k) not in bk:
            add(nm, "항목이 커뮤니티드래곤에 없음")
            continue
        walk(e, bk.pop(int(k)), nm)
    for k in bk:
        add(names.fnv.get(k, f"{{{k:08x}}}"), "항목이 게임 파일에 없음")
    return diffs


def cmd_compare(game, targets, limit):
    names = Names()
    cd_ver = fetch_cd(f"{CDRAGON}/content-metadata.json")["version"]
    print(f"게임 파일 버전   : {game.version}")
    print(f"커뮤니티드래곤   : {cd_ver}{'  (같음)' if cd_ver == game.version else '  ⚠️ 다름 — 차이는 버전 차이일 수 있어요'}")
    total = 0
    for t in targets:
        try:
            mine = game.read(t)
            cd = fetch_cd(game.target(t)[2])
        except (KeyError, SystemExit, ValueError, OSError) as e:
            print(f"\n[{t}] ❔ 읽지 못함: {e}")
            total += 1
            continue
        diffs = compare(mine, cd, names)
        total += bool(diffs)
        print(f"\n[{t}] 항목 {len(mine)}개 · " + ("✅ 같음" if not diffs else f"⚠️ 차이 {len(diffs)}곳"))
        for d in diffs[:limit]:
            print("  " + d)
        if len(diffs) > limit:
            print(f"  … 외 {len(diffs) - limit}곳")
    return 1 if total else 0


def main(argv):
    args, game_dir, limit = [], None, 20
    it = iter(argv)
    for a in it:
        if a == "--game":
            game_dir = next(it)
        elif a == "--limit":
            limit = int(next(it))
        else:
            args.append(a)
    if not args or args[0] not in ("compare", "dump"):
        print(__doc__)
        return 2
    game = Game(game_dir)
    if args[0] == "dump":
        if len(args) < 2:
            print(__doc__)
            return 2
        out = json.dumps(named(game.read(args[1]), Names()), ensure_ascii=False, indent=1)
        if len(args) > 2:
            Path(args[2]).write_text(out, encoding="utf-8")
        else:
            print(out)
        return 0
    targets = args[1:]
    if "--all-champions" in targets:
        targets = [t for t in targets if t != "--all-champions"] + game.champions()
    return cmd_compare(game, targets or ["map12", "kiwi", "items"] + DEFAULT_CHAMPS, limit)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
