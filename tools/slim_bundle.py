"""빌드 결과 폴더의 파일 수를 줄인다 (2026-10-25 요청: 예전 버전 폴더 6개를 휴지통에 넣자 '파일 24,000개 삭제 중').

  python tools/slim_bundle.py <빌드 폴더>

- 화면 엔진(Tcl/Tk) 데이터 중 안 쓰는 것을 지운다: 시간대(tzdata)·번역(msgs)·Tk 그림·대부분의 문자표.
  게임 화면 표시(overlay.py)는 Tk 캔버스에 글자·도형·그림만 그린다 (날짜 계산·대화 상자·다른 나라 문자표를 안 쓴다)
- 아이콘(web/icons, 600여 개)은 zip 한 파일(web/icons.zip, 압축 안 함: webp 라 더 안 줄어든다)로 묶는다.
  프로그램을 켜면 desktop.prepare_web 이 data/web/icons 로 푼다
"""
import shutil
import sys
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 남기는 문자표: 한국어 윈도우 기본(cp949) · 서양 기본(cp1252) · 기본 몇 개 (UTF-8 은 Tcl 안에 들어 있다)
KEEP_ENCODINGS = {"ascii.enc", "cp1252.enc", "cp949.enc", "euc-kr.enc", "iso8859-1.enc", "cp437.enc", "macRoman.enc"}


def slim(root):
    root = Path(root)
    before = sum(1 for p in root.rglob("*") if p.is_file())
    for tcl in [p for p in root.rglob("*") if p.is_dir() and p.name in ("_tcl_data", "_tk_data")]:
        for sub in ("tzdata", "msgs", "images"):
            shutil.rmtree(tcl / sub, ignore_errors=True)
        enc = tcl / "encoding"
        if enc.is_dir():
            for f in enc.iterdir():
                if f.name not in KEEP_ENCODINGS:
                    f.unlink()
    for icons in [p for p in root.rglob("icons") if p.is_dir() and p.parent.name == "web" and (p / "augment").is_dir()]:
        with zipfile.ZipFile(icons.parent / "icons.zip", "w", zipfile.ZIP_STORED) as z:
            for f in sorted(icons.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(icons).as_posix())
        shutil.rmtree(icons)
    after = sum(1 for p in root.rglob("*") if p.is_file())
    print(f"파일 {before} → {after}")
    return before, after


if __name__ == "__main__":
    slim(sys.argv[1])
