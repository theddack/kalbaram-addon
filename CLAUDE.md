# CLAUDE.md — 칼바람 증강 Addon 작업 안내 (Claude Code 용)

이 저장소에서 작업하는 Claude 가 먼저 읽는 문서. 구조·규칙 상세는 `docs/개발자_문서.md`, 버전별 변경은 `업데이트내역.md`, 보안 원칙은 `SECURITY.md`.
2026-10-18 맥 → 윈도우 PC 로 개발 환경을 옮기면서 그동안의 작업 규칙과 진행 상황을 여기로 모았다.

## 프로젝트

- 롤 칼바람 나락 **증강 모드(게임 모드 이름 KIWI)** 도우미. 모토: "어떤 증강도 재밌게" · 뉴비 친화 · 정확한 지표.
- 윈도우 프로그램(pywebview + 게임 위 표시) + 웹 화면(`web/`, GitHub Pages). 맥 빌드는 웹 화면·연동만.
- 배포: 사용자 본인과 지인. 공식 서비스로 넓히게 되면 라이엇 정책(서드파티 앱 등록·팬 제작물 정책)을 다시 확인한다.

## 반드시 지킬 것

1. **한국어로 답한다.** 중간 진행 보고 한 줄까지 전부.
2. **릴리스(버전 태그)는 사용자 허락을 받은 뒤에만.** 수정은 모아서 한 번에.
3. **main 에 바로 커밋하지 않는다.** 작업마다 브랜치(`fix/…`, `feat/…`, `docs/…`)를 만들어 수정 → 그 브랜치에 커밋·푸시 → main 에 머지. 푸시는 사용자가 모아서 하라고 하면 미룬다.
4. **GitHub 은 개인 계정 `theddack` 만.** 저장소 `theddack/kalbaram-addon`.
5. **게임 메모리를 읽지 않는다** (뱅가드 정지 위험·라이엇 약관). 쓰는 것: 공식 게임 연동 API(127.0.0.1:2999), 롤 클라이언트 API(LCU), 화면 캡처 + 윈도우 글자 인식, 디스크의 공개 게임 데이터.
6. **개인 정보**: 로그·스크린샷·테스트 자료에 소환사 이름·채팅·계정 ID 가 들어가면 안 된다.
   - 기록은 이름을 `플레이어0~9` 로 바꿔 저장한다(`redact_names`, `redact_eog`). 테스트 자료로 커밋하기 전에 다시 확인한다.
   - **경기 결과 파일(`measure/eog_*.json`)은 커밋하지 않는다.** puuid·채팅방 토큰(안에 puuid)이 있었다.
7. **보고 원칙**: 미검증·미해결을 맨 위에. "완료"는 실제로 확인한 것만 (테스트 통과 ≠ 실제 게임 확인). 커밋은 작업 단위로 나눈다.
8. **PC 자원**: 같은 PC 로 게임을 한다. 테스트는 바꾼 테스트 파일만 한 번씩 순서대로(동시 실행 금지), 게임 중엔 무거운 실행을 하지 않는다. 패키지 설치·대량 다운로드는 미리 한 줄로 알린다.

## 커밋 메시지

- 한국어 한 줄 제목 `fix: …` / `feat: …` / `perf: …` / `docs: …` / `release: v0.1.x 릴리스 노트·버전` + 빈 줄 + 근거(어느 판 로그에서 무엇이 보였는지).

## 릴리스 순서 (허락받은 뒤)

1. `desktop.py` 의 `APP_VERSION` 올리기 (태그와 같아야 빌드가 통과).
2. `업데이트내역.md` 맨 위에 새 버전 항목 (쉬운 말로) → `python tools/changelog.py html` (web/changelog.html 생성).
3. 커밋 `release: v0.1.x 릴리스 노트·버전` → `git tag v0.1.x` → main 과 태그 푸시.
4. GitHub Actions `build` 가 윈도우·맥 zip 과 SHA256SUMS 를 릴리스에 올린다. `gh run watch` 로 끝까지 보고 `gh release view v0.1.x` 로 파일 확인.

## 테스트

- 화면·계산: `node --test tests/ui.test.js` · `tests/calc.test.js` · `tests/replay.test.js` (실제 경기 기록 재생, `node tests/replay.js` 로 표 보기)
- 파이썬: `python -m unittest tests.test_python` (증강 칸 그림 테스트 21개는 numpy·Pillow 가 있어야 돈다 — 윈도우에선 `requirements-build.txt` 로 설치됨)
- CI(`.github/workflows/test.yml`)가 전부 돈다. 빌드·페이지 배포 전에 불린다.

## 로그 분석 (사용자가 data.zip 을 보내면)

- 내용: `logs/diag.log`(진단), `logs/games/<날짜_챔피언>/events.json`(+ 그림, 끝나면 zip), `logs/game_*_<초>s.json`(5분마다 게임 연동 원본, 이름 가림), `measure/eog_*.json`(경기 결과), `measure/match_*.json`(전적 10명 증강·아이템·승패, 이름 없음).
- **적 증강 정답** = `match_*.json` 적 팀 `augments` (번호). 프로그램이 판 끝에 점수판에서 읽은 것과 대조해 diag.log 에 "점수판 적 증강 대조" 를 남긴다.
- 추천 대조: 롤 클라이언트를 켜고 `python tools/match_review.py` → `node tools/match_check.js` (내 전적 판, `.cache/matches/` 는 커밋 안 함).
- **고른 증강 정답** = eog `localPlayer.stats.playerAugment1~6` 숫자 → `web/data.json` 증강의 `num` (kiwi AugmentPlatformId). 프로그램이 판 끝에 자동 대조해 diag.log 에 "경기 결과와 고른 증강 대조: 모두 맞음/다름" 을 남긴다.
- **능력치 대조** = events.json `statcheck` 의 rows `[계산, 실제]`. 잠깐 켜지는 효과(중간에 같아지는 차이)와 계속 남는 차이를 구분한다.
- 새 판 기록으로 재생 테스트를 만들 땐 `tests/data/games/<챔피언_날짜>/` 에 `live_<초>s.json` + `game.json` (고른 증강·시각, 아는 차이 `known`, 기준 `gaps`).
- '개선용 기록 남기기'(⚙ 더보기)를 켜야 기록이 쌓인다 (v0.1.42 부터 기본 꺼짐).

## 지금 상태 (2026-10-18, v0.1.46 배포)

v0.1.46 에 들어간 것: 라이엇 공식 칼바람 추천 아이템 가산점(`officialItems`, `OFFICIAL_BOOST`), 전적으로 점수판 적 증강 대조(`board_check`), 클라이언트 증강 번호표, 점수판 6칸. 개발용: `tools/official_check.js`, `tools/match_review.py`·`tools/match_check.js`.
v0.1.45 에 들어간 것: Tab 점수판 적 증강 읽기 (시험, `hudicons.BoardReader`). 개발용: `tools/local_wad.py`, 파이썬 테스트 utf-8 (한국어 윈도우).
v0.1.44 에 들어간 것: 상점 추천(아이템 세트) 막판 대기석 교체·로딩 중 반영, 진 속삭임 (rules `asFixed`, 레벨별 % 표는 7레벨까지만 실측 일치).

실제 게임에서 확인된 것: 경기 결과 대조, 증강 칸 읽기 줄이기, 기록 설정, 경기 결과 토큰 가리기.
아직 실제 게임 미확인: 클릭 따로 지켜보기·모루 능력치(v0.1.43), 상점 추천 막판 교체·진 계산(v0.1.44), Tab 점수판 적 증강(v0.1.45: 아이콘 크기·초상화 문턱·그려지는 시간, 첫 판 `board` 기록으로 맞춘다), 판 끝 전적 대조 한 줄(v0.1.46: diag.log '점수판 적 증강 대조').

## 다음 할 일 (우선순위)

1. **추천이 챔피언마다 거의 같다** (원딜 16명 중 7명이 6칸 순서까지 같음: 크라켄·윤 탈·루난·도미닉…). 원인은 역할별 공통 가중치(`web/scoring.js` ROLE_PRESET).
   - **2026-10-18 ①② 함**: build_data `official_items` → champ `officialItems`, scoring `OFFICIAL_BOOST` 3 (변칙 제외). `node tools/official_check.js`: 공식 핵심 담기 24 → 76 / 108, 같은 역할 똑같은 구성 137 → 100 / 173, 몰빵 점검 98.4% 유지. 남은 것: ③ 없는 54명(원딜 다수) ④는 도구로 대체.
   - 별개로 발견: 탱커를 상대로 고르면 18레벨 추천 빌드가 방어 6칸이라 시온·갈리오 마법 저항력 287~365 처럼 지나치게 단단하다 (이번 변경 전부터).
   - **라이엇 공식 챔피언별 추천 아이템**이 게임 파일에 있다: 챔피언 bin(`game/data/characters/<id>/<id>.bin.json`)의 `ItemRecommendationOverrideSet` → `mOverrides[]` 중 `mOverrideContexts` 가 `mMapID 12 · mModeNameStringId "ARAM"` 인 것의 `mRecItemRanges`(핵심 → 신발 → 상황별). 173명 중 ARAM 108명, 일반 게임만 11명, **없음 54명**(징크스·진·베인·케이틀린·트리스타나 등 원딜 다수).
   - 공통 파일 `game/items.cdtb.bin.json` 에도 이름 없는 묶음 37개(ARAM 32개)가 있으나 어느 챔피언 것인지 연결 고리를 못 찾음 (hashes.binentries 에 이름 없음, 챔피언·맵 bin 에서 참조 없음).
   - 할 일: ① build_data 에서 공식 추천을 뽑아 champ 에 넣고 출처에 기록 ② 추천 점수에 가산점(목록으로만 고르게 하지는 않음 — 증강 맞춤이 우리 장점) ③ 없는 54명은 챔피언별 평타/스킬 피해 비율로 가중치 조정 ④ 108명으로 "우리 기본 추천이 공식 핵심을 몇 개 담나" 점수 매겨 검증.
   - **54명 공식 추천을 서버에서 받는지 확인**: 롤 클라이언트 API 목록(`/help`)에서 recommend·item 관련 요청 이름 찾기 (읽기만). 룬은 `/lol-perks/v1/recommended-pages/...` 가 있다.
   - OP.GG 같은 외부 통계 사이트는 쓰지 않는다 (사용자 결정: 우리와 목적이 다름).
2. **Tab 점수판 적 증강 읽기** — `feat/scoreboard-augs` 에 만듦(가짜 점수판 테스트만, 실제 게임 미확인. 개발자 문서 'Tab 점수판 적 증강'). 원래 메모: 점수판 양옆 칸(플레이어마다 3+2칸)에 고른 증강 아이콘이 보인다 (진 판 캡처에서 '취약' 아이콘 확인, 1680×1050 에서 약 26px). 점수판엔 소환사 이름이 안 보인다. Tab 키를 누를 때 그 칸만 잘라 `hudicons` 로 비교 → 적 구성 조언·상대 능력치·다음 구매에 반영. 지금 공식 데이터로는 215개 중 9개만 보인다.
3. 보류 (사용자 결정): 증강 칸 그림 확인 제거, 우리 상자 글자가 상점 인식에 섞이는 것.
4. 원인 모르는 계산 차이: 베인 스킬 가속·공속, 케일 모드 체력, 근접 추가 방어 15, 바드 공속 +0.33(잠깐), 세나 테스트 화면 치명타 +10%p·공속 −0.05.
5. 하다 만 것: 변신형 패시브(니달리·엘리스 등), 내 증강 점수에 적 증강 반영, `web/app.js` 나누기.
