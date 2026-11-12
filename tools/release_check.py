"""태그를 붙이기 전 확인: 버전이 세 곳(desktop.py APP_VERSION · 업데이트내역.md 맨 위 · web/changelog.html)에서 같고,
지금 커밋이 최종 머지된 main 이며, 그 태그가 아직 없는지 본다. (2026-11-12 릴리스 PR 통합: 수정 PR 하나에 버전·내역을 같이 넣는다)

  python tools/release_check.py v0.1.90     → 문제 없으면 '태그 붙여도 돼요' (종료 코드 0), 있으면 이유를 적고 1
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def app_version(text):
    m = re.search(r'APP_VERSION = "([^"]+)"', text)
    return m.group(1) if m else None


def top_changelog_version(text):
    m = re.search(r"^## (v[\d.]+)", text, re.M)
    return m.group(1) if m else None


def version_problems(tag, desktop_text, changelog_md, changelog_html):
    """버전 세 곳이 태그와 같은지 (git 없이 확인할 수 있는 부분)"""
    out = []
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag or ""):
        return [f"태그 형식이 vX.Y.Z 가 아니에요: {tag}"]
    if f"v{app_version(desktop_text)}" != tag:
        out.append(f"desktop.py APP_VERSION {app_version(desktop_text)} ≠ {tag}")
    if top_changelog_version(changelog_md) != tag:
        out.append(f"업데이트내역.md 맨 위 항목 {top_changelog_version(changelog_md)} ≠ {tag}")
    if tag not in changelog_html:
        out.append(f"web/changelog.html 에 {tag} 가 없어요 → python tools/changelog.py html")
    return out


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.strip()


def git_problems(tag):
    out = []
    git("fetch", "-q", "origin", "main", "--tags")
    if git("rev-parse", "--abbrev-ref", "HEAD") != "main":
        out.append("main 브랜치가 아니에요 (태그는 최종 머지된 main 커밋에)")
    if git("rev-parse", "HEAD") != git("rev-parse", "origin/main"):
        out.append("지금 커밋이 origin/main 과 달라요 → git pull")
    if git("status", "--porcelain", "--untracked-files=no"):
        out.append("커밋 안 한 변경이 있어요")
    if git("tag", "-l", tag):
        out.append(f"태그 {tag} 가 이미 있어요")
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    tag = sys.argv[1]
    probs = version_problems(tag, (ROOT / "desktop.py").read_text(encoding="utf-8"),
                             (ROOT / "업데이트내역.md").read_text(encoding="utf-8"),
                             (ROOT / "web" / "changelog.html").read_text(encoding="utf-8")) + git_problems(tag)
    if probs:
        print("태그 붙이기 전에 고칠 것:")
        for p in probs:
            print(" -", p)
        sys.exit(1)
    print(f"{tag}: 버전 세 곳이 같고 지금 커밋이 최종 main 이에요. 태그 붙여도 돼요.")


if __name__ == "__main__":
    main()
