"""게임 화면 아래 증강 칸(초상화 왼쪽 2x2)의 아이콘으로 '고른 증강'을 알아낸다.

선택 화면에서 클릭한 카드로 짐작하는 방식은 실제 게임에서 틀렸다 (2026-10-14 나피리 판: 고른 증강을 잘못 잡고,
새로고침 뒤 고른 것은 못 잡음). 증강 칸에는 실제로 고른 증강 아이콘이 계속 떠 있으니 그걸 정답으로 쓴다.

방법: 화면 아래쪽 가운데를 잘라 작게(12x12) 줄인 창들을 증강 아이콘 215개와 비교한다 (아이콘의 투명한 바깥은 빼고,
밝기 차이는 무시하는 정규화 상관). HUD 크기는 설정마다 달라서 처음엔 여러 크기로 찾고, 찾으면 그 크기로 고정한다.
numpy·Pillow 가 필요하다 (없으면 이 기능만 꺼진다).
"""
import os
import time

try:
    import numpy as _np
    LUM = _np.array([0.299, 0.587, 0.114], dtype=_np.float32)
except ImportError:  # numpy 가 없으면 이 기능만 꺼진다 (Templates 만들 때 오류)
    LUM = None

GRID = 12  # 위치 찾기 크기 (흑백 12x12: 빠르게 후보 자리만)
FINE = 24  # 어떤 증강인지 가리기 크기 (흑백 24x24 가운데: 12x12 는 비슷한 아이콘끼리 헷갈렸다)
INNER = 0.12  # 가리기는 가장자리를 이만큼씩 빼고 가운데 그림만 (공통 어두운 테두리 때문에 '미친 과학자'가 모든 아이콘과 닮아 보였다)
# 묶음마다 잠깐 쉰다: 한꺼번에 몰아 계산하면 CPU 상한(작업 개체)을 다 써서 애드온 창까지 잠깐 굳었다
# (2026-10-15 윈도우 가상 PC, 전체 모드 1.8초). 결과는 같고 조금 더 천천히 끝난다
PAUSE = 0.004
CHUNK = 4096  # 한 번에 비교하는 창 수 (메모리 상한: 4096 x 아이콘 174 x 4바이트 ≈ 3MB)
FIND_SCORE = 0.55  # 위치 후보로 볼 닮은 정도 (느슨하게)
REGION = (0.12, 0.70, 0.75, 1.0)  # 찾는 범위 (게임 창 비율: 왼쪽, 위, 오른쪽, 아래). HUD 가 왼쪽으로 치우친 해상도도 (2520x1575)
# 아이콘 크기 후보 (게임 창 높이 비율, 8%씩). 간격이 넓으면 크기가 엇나가 다른 증강으로 읽었다 (맥 실험)
SIZES = tuple(round(0.024 * 1.08 ** i, 4) for i in range(13))
MIN_SCORE = 0.90  # 이만큼 닮아야 같은 아이콘 (흑백 24x24 가운데. 실제 HUD: 정답 0.966~0.972)
MARGIN = 0.01  # 1등이 2등보다 이만큼은 나아야 (점수 문턱을 높인 대신 차이는 작게 허용)
# 흑백 그림이 이만큼 닮으면 같은 그림으로 묶는다. 게임 증강 칸은 등급 색 단색이라 조준경 부착·상급 조준경 부착(0.989),
# 죽음의 춤·광대 대학(1.0)처럼 원본은 달라도 칸에선 구별이 안 된다 → 따로 두면 엉뚱한 쪽을 골랐다 (2026-10-24 코르키 판)
SAME_ICON = 0.98  # 2026-10-24 점수판: 바늘에 실 끼우기·능수능란(0.982)도 칸에선 구별이 안 됐다


def _prep(np, vecs, wts):
    """가중 정규화 상관 준비: 아이콘에서 가중 평균을 빼 두면 창의 평균은 곱셈에서 상쇄된다"""
    W = np.array(wts, dtype=np.float32)
    T = np.array(vecs, dtype=np.float32)
    sw = W.sum(1, keepdims=True)
    mt = (W * T).sum(1, keepdims=True) / sw
    A = W * (T - mt)
    return A.T, W.T, sw.ravel(), np.sqrt((W * (T - mt) ** 2).sum(1))


MIN_STD = 0.04  # 창의 밝기 표준편차가 이보다 작으면(거의 단색: 바닥·빈 칸) 비교하지 않는다


def _score(np, X, prep):
    """가중 정규화 상관 (-1~1). 거의 단색인 창은 0.
    v0.1.15 실제 게임: 단색 영역에서 0 에 가까운 수로 나눠 점수가 7.4 까지 터졌고, 바닥을 '존야 업그레이드'로 읽었다"""
    A, W, sw, tnorm = prep
    num = X @ A
    sx = X @ W
    sxx = (X * X) @ W
    var = np.maximum(sxx - sx * sx / sw, 0.0)  # 가중 분산 × 가중치 합
    std = np.sqrt(var / sw)
    out = num / (np.sqrt(var) * tnorm + 1e-6)
    out[std < MIN_STD] = 0.0
    return np.clip(out, -1.0, 1.0)


class Templates:
    """증강 아이콘들을 비교용으로 준비. 게임 증강 칸 아이콘은 등급 색(분홍·보라)으로 칠한 단색 그림이라 색 말고 모양(밝기)으로 비교한다
    (2026-10-14 실제 HUD 캡처: 컬러 비교는 틀리고 밝기 비교는 골드 강탈 0.966 · 앙파상 0.972 로 정답).
    같은 그림을 쓰는 증강이 많아서(돌진=앙파상, 강타자=불을 밝혀 …) 그림이 같은 것끼리 한 묶음(group)으로 비교한다.
    위치 찾기: 흑백 12x12 전체, 가리기: 흑백 24x24 가운데(테두리 INNER 만큼 빼고)"""

    def __init__(self, icon_dir, names):
        """icon_dir: icons/augment 폴더, names: {증강 id: 이름}"""
        import numpy as np
        from PIL import Image
        self.np = np
        groups, g_v, f_v, keys, units = [], [], [], {}, []
        for aid, name in names.items():
            path = next((os.path.join(icon_dir, f"{aid}{ext}") for ext in (".webp", ".png")
                         if os.path.exists(os.path.join(icon_dir, f"{aid}{ext}"))), None)
            if not path:
                continue
            im = Image.open(path).convert("RGBA")
            flat = Image.new("RGBA", im.size, (0, 0, 0, 255))  # 투명한 바깥은 검정 (게임 칸 바탕도 검정)
            flat.alpha_composite(im)
            a = np.asarray(flat.convert("RGB").resize((GRID, GRID), Image.BILINEAR), dtype=np.float32) @ LUM / 255.0
            m = int(flat.size[0] * INNER)
            b = np.asarray(flat.convert("RGB").crop((m, m, flat.size[0] - m, flat.size[1] - m)).resize((FINE, FINE), Image.BILINEAR),
                           dtype=np.float32) @ LUM / 255.0
            if a.std() < 0.03:  # 거의 비어 있는 아이콘은 비교 못 함
                continue
            key = np.round(b, 2).tobytes()
            if key in keys:  # 같은 그림 → 같은 묶음
                groups[keys[key]].append(aid)
                continue
            u = b.ravel() - b.mean()
            u = u / (np.linalg.norm(u) + 1e-6)
            near = next((k for k, v in enumerate(units) if float(u @ v) >= SAME_ICON), None)
            if near is not None:  # 칸에서 구별 안 되는 그림 → 같은 묶음 (이름은 선택 화면·클릭으로 가린다)
                groups[near].append(aid)
                keys[key] = near
                continue
            units.append(u)
            keys[key] = len(groups)
            groups.append([aid])
            g_v.append(a.ravel())
            f_v.append(b.ravel())
        self.groups = [tuple(g) for g in groups]
        self.ids = self.groups  # find_icons 결과의 '증강' 자리에 묶음이 들어간다
        self.names = names
        self.coarse = _prep(np, g_v, [np.ones(GRID * GRID, np.float32)] * len(g_v))
        self.fine = _prep(np, f_v, [np.ones(FINE * FINE, np.float32)] * len(f_v))

    def scores(self, X):
        """X: (창 수, 144) 흑백 → (창 수, 묶음 수) 닮은 정도 (-1~1)"""
        return _score(self.np, X, self.coarse)

    def identify(self, X):
        """X: (창 수, 24*24) 흑백 가운데 → (창 수, 묶음 수)"""
        return _score(self.np, X, self.fine)


def _windows(np, lum):
    """밝기 이미지 → 모든 12x12 창 (창 수, 144)과 각 창의 왼쪽 위 좌표"""
    h, w = lum.shape
    if h < GRID or w < GRID:
        return np.zeros((0, GRID * GRID), np.float32), []
    v = np.lib.stride_tricks.sliding_window_view(lum, (GRID, GRID))  # (h-11, w-11, 12, 12)
    ys, xs = v.shape[:2]
    return v.reshape(ys * xs, GRID * GRID), (ys, xs)


def find_icons(tpl, rgb, size_px, max_cands=5, min_score=MIN_SCORE, unique=True):
    """rgb: (H, W, 3) 0~255 화면 조각, size_px: 아이콘 한 변 픽셀 → [(증강 id, 점수, x, y)] (조각 기준 좌표)
    1) 흑백 12x12 로 아이콘이 있을 만한 자리 후보 → 2) 그 자리를 컬러 24x24 로 몇 픽셀·크기 흔들어 가며 어떤 증강인지.
    max_cands: 후보 자리 수 (증강 칸은 4~6칸이라 5), unique: 같은 그림은 한 번만 (점수판은 여러 사람이 같은 증강을 고를 수 있어 False)"""
    np = tpl.np
    from PIL import Image
    f = GRID / size_px
    H, W = rgb.shape[:2]
    img = Image.fromarray(rgb.astype(np.uint8))
    small = img.resize((max(GRID, int(W * f)), max(GRID, int(H * f))), Image.BILINEAR)
    lum = np.asarray(small, dtype=np.float32) @ LUM / 255.0
    # 창들을 한꺼번에 펼치면 큰 화면에서 수백 MB 를 잡았다 놓아 PC 가 순간 멈췄다 (측정: 순간 900MB).
    # 줄 단위로 나눠서 각 창의 '가장 닮은 점수'만 남긴다 (결과는 같다)
    h, w = lum.shape
    if h < GRID or w < GRID:
        return []
    v = np.lib.stride_tricks.sliding_window_view(lum, (GRID, GRID))
    ys, xs = v.shape[:2]
    top = np.empty(ys * xs, np.float32)
    rows_per = max(1, CHUNK // max(1, xs))
    for y0 in range(0, ys, rows_per):
        block = v[y0:y0 + rows_per].reshape(-1, GRID * GRID)
        top[y0 * xs: y0 * xs + len(block)] = tpl.scores(block).max(1)
        time.sleep(PAUSE)
    cands = []
    for i in np.argsort(-top)[:max(200, 40 * max_cands)]:
        if top[i] < FIND_SCORE:
            break
        y, x = divmod(int(i), xs)
        if any(abs(x - cx) < GRID * 0.7 and abs(y - cy) < GRID * 0.7 for cx, cy in cands):
            continue
        cands.append((x, y))
        if len(cands) >= max_cands:  # 증강 칸은 최대 4~6칸 (후보를 줄여 가볍게)
            break
    hits = []
    step = max(1, round(size_px / 24))  # 위치를 아이콘 크기의 1/24 씩 (1/12 씩이면 몇 픽셀 엇나가 점수가 확 떨어졌다)
    for cx, cy in cands:
        ox, oy = cx / f, cy / f  # 조각 기준 원래 픽셀
        crops, where = [], []
        for k in (0.93, 1.0, 1.07):
            sp = size_px * k
            for dy in range(-3 * step, 3 * step + 1, step):
                for dx in range(-3 * step, 3 * step + 1, step):
                    x0 = ox + dx - (sp - size_px) / 2
                    y0 = oy + dy - (sp - size_px) / 2
                    if x0 < 0 or y0 < 0 or x0 + sp > W or y0 + sp > H:
                        continue
                    m = sp * INNER
                    c = img.crop((int(x0 + m), int(y0 + m), int(x0 + sp - m), int(y0 + sp - m))).resize((FINE, FINE), Image.BILINEAR)
                    crops.append((np.asarray(c, dtype=np.float32) @ LUM).ravel() / 255.0)
                    where.append((x0, y0))
        if not crops:
            continue
        S = tpl.identify(np.array(crops))
        time.sleep(PAUSE)
        j = np.unravel_index(int(S.argmax()), S.shape)
        sc = float(S[j])
        row = S[j[0]].copy()
        row[j[1]] = -1
        if sc >= min_score and sc - float(row.max()) >= MARGIN:
            x0, y0 = where[j[0]]
            aid = tpl.ids[j[1]]
            if not (unique and any(h[0] == aid for h in hits)):
                hits.append((aid, sc, x0, y0))
    return hits




class HudReader:
    """증강 칸 읽기. scan(rgb_of_game_window) 을 몇 초마다 부르면 picked(고른 증강 id 목록, 칸 순서)를 갱신한다"""

    CONFIRM = 2  # 연속으로 이만큼 보여야 고른 것으로
    # 정한 크기로 이만큼 읽어도 확인된 증강이 하나도 없으면 크기가 틀린 것으로 보고 다시 찾는다.
    # 첫 회차에 능력치 아이콘 같은 것이 우연히 맞으면 그 판 내내(다음 판 hint 까지) 엇나간 크기로만 찾았다 (2026-10-23 점검)
    SIZE_RETRY = 8

    def __init__(self, tpl):
        self.tpl = tpl
        self.size = None  # 찾은 아이콘 크기 (게임 창 높이 비율). 찾기 전엔 여러 크기로
        self.hint = None  # 지난 게임에서 찾은 크기 (같은 해상도). 먼저 이 크기로만 찾고, 없으면 여러 크기로
        self.picked = []
        self._seen = {}
        self.last = []
        self._miss = 0
        self.hint_bad = False

    def scan(self, crop, H, offset=(0, 0)):
        """crop: 게임 창의 REGION 부분 (h, w, 3), H: 게임 창 높이, offset: crop 의 게임 창 기준 왼쪽 위"""
        np = self.tpl.np
        # 크기를 모르면 13가지 크기로 다 찾아야 해서 무겁다 → 지난 게임 크기(hint)부터
        tries = [[self.size]] if self.size else ([[self.hint], SIZES] if self.hint else [SIZES])
        best, best_size = [], None
        best_mean = 0.0
        for sizes in tries:
            for s in sizes:
                hits = find_icons(self.tpl, crop, max(GRID, s * H))
                m = float(np.mean([h[1] for h in hits])) if hits else 0.0
                # 크기가 맞으면 점수가 확 오른다 → 평균 점수가 가장 높은 크기 (개수로 고르면 엇나간 크기의 오답이 이겼다)
                if m > best_mean:
                    best, best_size, best_mean = hits, s, m
            if best:
                break
        if best and not self.size:
            self.size = best_size
        if self.size:
            # 찾은 크기 앞뒤로도 한 번씩 (아이콘마다 몇 % 씩 크기가 달라 한 크기로는 하나를 놓쳤다) → 증강마다 가장 닮은 것
            merged = {h[0]: h for h in best}
            for k in (0.92, 1.08):
                for h in find_icons(self.tpl, crop, max(GRID, self.size * k * H)):
                    if h[0] not in merged or h[1] > merged[h[0]][1]:
                        merged[h[0]] = h
            best = list(merged.values())
        x0, y0 = offset
        self.last = [(aid, sc, x + x0, y + y0) for aid, sc, x, y in best]
        now = {aid for aid, *_ in self.last}
        for aid in list(self._seen):
            if aid not in now:
                del self._seen[aid]
        for aid in now:
            self._seen[aid] = self._seen.get(aid, 0) + 1
        confirmed = [h for h in self.last if self._seen.get(h[0], 0) >= self.CONFIRM]
        # 칸 순서: 위 줄 왼쪽부터 (2x2 칸)
        confirmed.sort(key=lambda h: (round(h[3] / max(1.0, (self.size or 0.04) * H)), h[2]))
        ids = [h[0] for h in confirmed]
        # 한 번 확인된 증강은 잠깐 가려져도(죽음·상점 창) 지우지 않는다. 새로 보이면 더한다
        for aid in ids:
            if aid not in self.picked:
                self.picked.append(aid)
        if self.size and not self.picked:
            self._miss += 1
            if self._miss >= self.SIZE_RETRY:
                self.size = self.hint = None
                self.hint_bad = True  # 이 판에선 지난 판 크기(hint)를 다시 쓰지 않는다
                self._miss = 0
        else:
            self._miss = 0
        return self.picked

    def reset(self):
        self.size = None
        self.picked = []
        self._seen = {}
        self._miss = 0
        self.hint_bad = False


# ---------------------------------------------------------------- Tab 점수판: 플레이어가 고른 증강 (시험)
# 2026-10-19 실제 Tab 점수판 스크린샷(1680x1050) + 기록(2520x1575)으로 맞춘 배치:
# - 증강 아이콘은 점수판 양옆 패널에 플레이어마다 3칸 × 2줄. 왼쪽 패널 = 우리 팀, 오른쪽 패널 = 적 팀
# - 줄 순서 = 게임 연동(allPlayers)의 팀별 플레이어 순서. 줄 간격은 게임 창 높이의 7.05%, 첫 줄 위끝은 높이의 28.7%
# - 적 초상화는 시야에 없으면 '?' 로 가려져 초상화로 줄을 찾던 예전 방식은 아군 증강을 적에게 붙였다 (3개 중 1개만 맞음)
#   → 초상화를 쓰지 않고 '패널(팀) + 높이(줄 번호)'로 붙인다. 같은 판 스크린샷 12장: 맞음 56 · 틀림 20 (틀림은 아이콘 착각)
BOARD_SIDE = (0.47, 0.72)  # 패널 가로 범위: 게임 창 가운데에서 떨어진 거리 / 게임 창 높이 (해상도·화면비와 상관없게)
BOARD_YS = (0.27, 0.70)  # 패널 세로 범위 (게임 창 높이 비율)
BOARD_ROW0, BOARD_STEP = 0.287, 0.0705  # 첫 줄 위끝, 줄 간격 (게임 창 높이 비율)
BOARD_SURE = 0.95  # 한 번만 봐도 인정하는 점수 (아니면 두 번 보여야)
# 점수판 증강 칸은 정해진 격자: 한 사람당 위·아래 2줄 × 3칸. 칸 가운데 = 게임 창 가운데에서 떨어진 거리 / 창 높이 (해상도·화면비와 상관없게).
# 2026-10-24 스몰더 판 1680x1050 스크린샷 · 2520x1575 기록이 같은 비율. 예전엔 패널 전체에서 후보 몇 자리만 찾아 한 사람 5~6칸 중
# 1~2칸만 읽었고(세 판 맞음 0), 한 번에 3~13초를 썼다 → 칸 자리만 본다 (같은 스크린샷 0.4초)
BOARD_COLS = {"ally": (-0.6114, -0.5838, -0.5581), "enemy": (0.5552, 0.5810, 0.6105)}
BOARD_CELL_Y0, BOARD_CELL_SUB = 0.3071, 0.0290  # 첫 사람 위 줄 칸 가운데, 아래 줄까지 (창 높이 비율). 사람 간격은 BOARD_STEP
BOARD_ICON = 0.024  # 칸 안 증강 그림 한 변 / 창 높이
BOARD_MIN_SCORE = 0.88  # 칸 자리를 아니까 자유 찾기(MIN_SCORE)보다 조금 느슨하게
BOARD_COLORFUL = 0.3  # 진한 색 화소가 이 비율을 넘으면 컬러 그림 칸 (핏빛 코발트·전환: 프리즘 등은 점수판에 원래 그림으로 나와
#                       단색 아이콘 그림과 엉뚱하게 맞았다) → 읽지 않는다. 단색 칸은 0.03 이하


def board_cells(cx, h):
    """[(팀, 줄 0~4, 칸 가운데 x, y)] (게임 창 픽셀). cx = 게임 창 가운데 x"""
    return [(side, row, cx + rx * h, (BOARD_CELL_Y0 + row * BOARD_STEP + sub * BOARD_CELL_SUB) * h)
            for side, xs in BOARD_COLS.items() for row in range(5) for sub in range(2) for rx in xs]


def board_bands(w, h):
    """점수판 양옆 패널 자리 → [("ally"|"enemy", (x0, y0, x1, y1))] (게임 창 픽셀)"""
    cx = w / 2
    y0, y1 = int(BOARD_YS[0] * h), int(BOARD_YS[1] * h)
    left = (int(max(0, cx - BOARD_SIDE[1] * h)), y0, int(max(0, cx - BOARD_SIDE[0] * h)), y1)
    right = (int(min(w, cx + BOARD_SIDE[0] * h)), y0, int(min(w, cx + BOARD_SIDE[1] * h)), y1)
    return [("ally", left), ("enemy", right)]


def board_row(cy, h):
    """아이콘 가운데 높이(게임 창 픽셀) → 줄 번호 0~4 (범위 밖이면 None)"""
    r = int((cy / h - BOARD_ROW0) // BOARD_STEP)
    return r if 0 <= r < 5 else None


class BoardReader:
    """scan(양옆 패널 그림들, 게임 창 높이, 적 챔피언 순서, 아군 챔피언 순서) → picked {적 챔피언 id: [증강 그림 묶음]}"""

    CONFIRM = 2

    def __init__(self, aug_tpl):
        self.aug_tpl = aug_tpl
        self.picked = {}
        self._seen = {}
        self.last = {"augs": []}

    def _vec(self, img, x0, y0, sp):
        np = self.aug_tpl.np
        from PIL import Image
        m = sp * INNER
        c = img.crop((int(x0 + m), int(y0 + m), int(x0 + sp - m), int(y0 + sp - m))).resize((FINE, FINE), Image.BILINEAR)
        return (np.asarray(c, dtype=np.float32) @ LUM).ravel() / 255.0

    def scan(self, bands, h, enemies, allies=(), mine_left=True):
        """bands: [("ally"|"enemy", 그림(h, w, 3), (x0, y0) 게임 창 기준 왼쪽 위)] — "ally" = 왼쪽 패널, "enemy" = 오른쪽 패널.
        mine_left: 내 팀이 왼쪽(블루)인가. 점수판은 블루팀이 늘 왼쪽이라 레드팀이면 적이 왼쪽이다 → 기록·결과의 팀 이름을 바꿔 단다"""
        team = {"ally": "ally", "enemy": "enemy"} if mine_left else {"ally": "enemy", "enemy": "ally"}
        np = self.aug_tpl.np
        from PIL import Image
        found = []  # (팀, 줄, 묶음, 점수, x, y)
        size = BOARD_ICON * h
        step = max(1, round(h / 1050))  # 위치 흔들기 (1050 높이에서 1픽셀)
        for side, rgb, (x0, y0) in bands:
            # 띠 위치로 게임 창 가운데를 되짚는다 (board_bands: 왼쪽 띠 오른쪽 끝 = 가운데 − BOARD_SIDE[0]·h, 오른쪽 띠 왼쪽 끝 = 가운데 + …)
            cx = x0 + rgb.shape[1] + BOARD_SIDE[0] * h if side == "ally" else x0 - BOARD_SIDE[0] * h
            img = Image.fromarray(rgb.astype(np.uint8))
            H, W = rgb.shape[:2]
            for s2, row, px, py in board_cells(cx, h):
                if s2 != side:
                    continue
                lx, ly = px - x0, py - y0
                if lx - size < 0 or ly - size < 0 or lx + size > W or ly + size > H:
                    continue
                core = rgb[int(ly - size * 0.38):int(ly + size * 0.38), int(lx - size * 0.38):int(lx + size * 0.38)].astype(np.int16)
                mx, mn = core.max(2), core.min(2)
                if float(((mx - mn > 90) & (mx > 60)).mean()) > BOARD_COLORFUL:
                    continue  # 컬러 그림 칸
                crops, where = [], []
                for k in (0.92, 1.0, 1.08):
                    sp = size * k
                    for dy in range(-3 * step, 3 * step + 1, step):
                        for dx in range(-3 * step, 3 * step + 1, step):
                            cx0, cy0 = lx - sp / 2 + dx, ly - sp / 2 + dy
                            crops.append(self._vec(img, cx0, cy0, sp))
                            where.append((cx0, cy0))
                X = np.array(crops)
                if float(X.std(1).max()) < MIN_STD:
                    continue  # 빈 칸
                S = self.aug_tpl.identify(X)
                time.sleep(PAUSE)
                j = np.unravel_index(int(S.argmax()), S.shape)
                sc = float(S[j])
                rest = S[j[0]].copy()
                rest[j[1]] = -1
                if sc >= BOARD_MIN_SCORE and sc - float(rest.max()) >= MARGIN:
                    wx, wy = where[j[0]]
                    found.append((team[side], row, self.aug_tpl.ids[j[1]], sc, wx + x0, wy + y0))
        self.last = {"augs": found, "size": BOARD_ICON}
        now = {}
        for side, row, g, sc, *_ in found:
            if side != "enemy" or row >= len(enemies):
                continue
            cid = enemies[row]
            now.setdefault(cid, {})
            now[cid][g] = max(sc, now[cid].get(g, 0.0))
        for cid, gs in now.items():
            for g, sc in gs.items():
                k = (cid, g)
                self._seen[k] = self._seen.get(k, 0) + 1
                if (self._seen[k] >= self.CONFIRM or sc >= BOARD_SURE) and g not in self.picked.setdefault(cid, []):
                    self.picked[cid].append(g)
        return self.picked

    def reset(self):
        """새 게임: 읽은 증강만 비운다 (찾은 크기는 같은 창 크기면 그대로 쓴다)"""
        self.picked, self._seen = {}, {}
        self.last = {"augs": []}


# ---------------------------------------------------------------- 상점 창 안 아이템 위치 (시험: 기록만, 화면 표시는 실제 그림으로 확인한 뒤)
SHOP_GRID = 16  # 아이템 아이콘을 이 크기(흑백)로 줄여 비교
SHOP_SIZES = tuple(round(0.030 * 1.1 ** i, 4) for i in range(9))  # 상점 아이콘 한 변 / 게임 창 높이 후보 (0.030~0.064)
SHOP_SURE = 0.85  # 이만큼 닮아야 그 자리로 본다 (실제 그림으로 다시 맞출 것)


def item_templates(paths):
    """{아이템 id: 아이콘 경로} → (ids, 준비된 비교값). 상점에 표시할 몇 개(추천·바꿀 것)만이라 가볍다"""
    import numpy as np
    from PIL import Image
    ids, vecs = [], []
    for iid, path in paths.items():
        try:
            im = Image.open(path).convert("RGB").resize((SHOP_GRID, SHOP_GRID), Image.BILINEAR)
        except (OSError, ValueError):
            continue
        a = np.asarray(im, dtype=np.float32) @ LUM / 255.0
        if a.std() < 0.03:
            continue
        ids.append(iid)
        vecs.append(a.ravel())
    if not ids:
        return [], None
    return ids, _prep(np, vecs, [np.ones(SHOP_GRID * SHOP_GRID, np.float32)] * len(vecs))


def locate_items(paths, rgb, icon_px_list):
    """상점 그림(rgb: H×W×3)에서 아이템 아이콘 자리 찾기 → {id: {"score", "x", "y", "size"}} (그림 기준 픽셀, 가장 닮은 곳).
    icon_px_list: 그림 안 아이콘 한 변 후보(픽셀). 줄 단위로 나눠 계산한다 (메모리를 크게 잡지 않게)"""
    import numpy as np
    from PIL import Image
    ids, prep = item_templates(paths)
    if not ids:
        return {}
    H, W = rgb.shape[:2]
    img = Image.fromarray(rgb.astype(np.uint8))
    best = {}
    for px in icon_px_list:
        f = SHOP_GRID / max(px, 1.0)
        sw, sh = int(W * f), int(H * f)
        if sw < SHOP_GRID or sh < SHOP_GRID:
            continue
        lum = np.asarray(img.resize((sw, sh), Image.BILINEAR), dtype=np.float32) @ LUM / 255.0
        v = np.lib.stride_tricks.sliding_window_view(lum, (SHOP_GRID, SHOP_GRID))
        ys, xs = v.shape[:2]
        rows_per = max(1, CHUNK // max(1, xs))
        for y0 in range(0, ys, rows_per):
            S = _score(np, v[y0:y0 + rows_per].reshape(-1, SHOP_GRID * SHOP_GRID), prep)
            j = S.argmax(0)
            for k, iid in enumerate(ids):
                sc = float(S[j[k], k])
                if sc > best.get(iid, {"score": -1})["score"]:
                    yy, xx = divmod(int(j[k]), xs)
                    best[iid] = {"score": round(sc, 3), "x": round(xx / f), "y": round((yy + y0) / f), "size": round(px)}
            time.sleep(PAUSE)
    return best
