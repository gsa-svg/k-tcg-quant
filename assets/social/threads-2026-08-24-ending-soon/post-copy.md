# Threads — 싱글 호가 하락 + 임박 경매 레이더 (2026-08-24)

이미지 1080×1350 · 한글 `threads-ending-soon-01-ko.png` / 영문 `threads-ending-soon-01-en.png`

---

## 본문 · 한글

원피스 싱글 카드, 싸졌습니다.

추격 카드의 일본 샵 호가입니다. 저희가 7월 28일에 마지막으로 확인한 값과 어제(8/24) 다시 받은 값:

· 나미 OP15-086 알트 ¥59,800 → ¥24,800 (-59%)
· 보아 한콕 OP12-014 SP -45%
· 루피 OP13-118 슈퍼 알트 -42%
· 사카즈키 OP16-065 만화 -40%

그 사이 OP-17이 발매됐습니다. 다만 27일 창이라 어느 시점에 내렸는지는 저희 데이터로 특정할 수 없습니다.

봉인 박스는 같은 기간 세트마다 갈렸습니다 — OP-13 -14%, OP-15는 보합.

호가는 희망가, 입찰은 진짜 수요입니다. 저희 홈 화면은 3시간 안에 끝나는 eBay 경매를 실제 입찰 수 순으로 보여줍니다. 어제는 원피스 경매 1,279건이 끝났고 356건이 낙찰됐습니다.

실시간 레이더 + 일일 집계 → opboxindex.com

---

## 본문 · 영문

One Piece singles just got cheap.

Japanese shop asking prices on chase cards. Our July 28 reading vs yesterday's (Aug 24):

· Nami OP15-086 Alt ¥59,800 → ¥24,800 (-59%)
· Boa Hancock OP12-014 SP -45%
· Luffy OP13-118 Super Alt -42%
· Sakazuki OP16-065 Manga -40%

OP-17 launched in between. It's a 27-day window, so we can't pin exactly when the drop happened.

Sealed boxes split over the same stretch — OP-13 -14%, OP-15 flat.

Asking prices are hope. Bids are real demand. Our homepage lists the eBay auctions ending within 3 hours, ranked by actual bids. Yesterday 1,279 One Piece auctions ended; 356 sold.

Live radar + daily results → opboxindex.com

---

## 쓰면 안 되는 문장 (과장 금지)

- **"하루 만에"** — 8/23 커밋에 남아 있던 값은 7/28 수집분이 그대로 유지된 것이다. 실제 관측 창은 **27일**(7/28 → 8/24). 2026-08-24 초안에서 이 오류를 냈다.
- "OP-17 때문에 떨어졌다" — 발매(8/22)는 재확인 이틀 전이다. 같은 창 안에 있었다는 사실만 말하고 인과는 단정하지 않는다.
- "박스도 같이 폭락" — 아니다. 같은 창에서 OP-15 보합, PRB-01 +4%였다.
- "지금이 바닥" / "역대급 폭락" — 바닥 판정은 예측이다. 우리는 하락 폭만 안다.
- "실시간 최종가" — 위젯은 **현재 입찰가**다. 이미지·본문 모두 "낙찰가가 아님"을 유지한다.

## 수치 출처

- 호가 하락: 遊々亭 싱글 호가. `data/onepiece-packs.json` 의 nmJpy, 2026-07-28 수집분 대비 2026-08-24 수집분.
  (그 사이 27일간 유유테이 수집이 없었다 — 워크플로우 미등록, 수동 실행 도구)
- 박스 비교: `box-sold-series.json` jp 주간 중앙값, 7/28~31 기준점 대비 최신점.
- 경매 행 3건: 홈 AUCTIONS ENDING SOON 위젯 08-24 14:08 실제 표시분.
- 1,279 종료 / 356 낙찰: `auction-series.json` 2026-08-23(완결일).
