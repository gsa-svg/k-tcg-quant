# Threads — 박스 4주 변화 + 임박 경매 레이더 (2026-08-24)

이미지 1080×1350 · 한글 `threads-ending-soon-01-ko.png` / 영문 `threads-ending-soon-01-en.png`

---

## 본문 · 한글

일본판 부스터 박스, 세트마다 갈렸습니다.

저희가 직접 모으는 eBay 판매완료 건의 주간 중앙값입니다. 4주 전과 비교:

내린 세트
· OP-10 로열 블러드 $107 (-24%)
· OP-07 500년 후의 미래 $81 (-17%)
· OP-13 계승되는 의지 $134 (-15%)

오른 세트
· PRB-01 프리미엄 부스터 $150 (+13%)
· OP-14 푸른 바다의 일곱 $101 (+12%)

"박스가 다 떨어졌다"는 아닙니다. 내린 쪽이 5개, 오른 쪽이 3개였습니다.

호가는 희망가, 입찰은 진짜 수요입니다. 저희 홈 화면은 3시간 안에 끝나는 eBay 경매를 실제 입찰 수 순으로 보여줍니다. 어제는 원피스 경매 1,279건이 끝났고 356건이 낙찰됐습니다.

실시간 레이더 + 일일 집계 → opboxindex.com

---

## 본문 · 영문

Japanese booster boxes split over the last four weeks.

Weekly medians of completed eBay sales, from our own ledger. Versus four weeks earlier:

Down
· OP-10 Royal Blood $107 (-24%)
· OP-07 500 Years in the Future $81 (-17%)
· OP-13 Carrying on His Will $134 (-15%)

Up
· PRB-01 Premium Booster $150 (+13%)
· OP-14 the Azure Sea's Seven $101 (+12%)

This is not "boxes crashed." Five sets fell, three rose.

Asking prices are hope. Bids are real demand. Our homepage lists the eBay auctions ending within 3 hours, ranked by actual bids. Yesterday 1,279 One Piece auctions ended; 356 sold.

Live radar + daily results → opboxindex.com

---

## 폐기된 초안 (2026-08-24, 두 번 틀렸다)

**1차 — "하루 만에 -59%"**
유유테이 싱글 호가로 썼는데, 8/23 커밋의 값은 7/28 수집분이 그대로 남아 있던 것이었다.
실제 관측 창은 27일(7/28 → 8/24). 우리 수집 간격을 시장이 움직인 기간으로 말한 셈이다.
(유유테이는 워크플로우 미등록 수동 도구 — 그 27일간 수집이 없었다.)

**2차 — "8/12~23 대비 8/24 하락"**
불가능. 박스 원장에 **8/24자 판매가 0건**이다(오늘 오전 수집이라 당일 체결 미반영).
경매 일별 중앙값은 잡카드 혼합이라 8/24 raw $12.5가 기준 범위($6~30) 안에 있어 신호가 안 된다.

**그래서 최종본은** 사이트가 실제로 게시하는 4주 변화(주간 중앙값 기반)를 쓴다.

## 쓰면 안 되는 문장

- "박스가 다 떨어졌다" — 같은 창에서 PRB-01 +13%, OP-14 +12%였다. 갈렸다고 써야 한다.
- "하루 만에" — 수집 간격과 시장 변동 기간을 혼동한 표현. 위 1차 오류.
- "OP-17 때문에" — 발매(8/22)와 하락 구간이 겹치지 않는다. OP-13은 8/14→8/21에 빠졌다.
- "지금이 바닥" / "역대급 폭락" — 바닥 판정은 예측이다.
- "실시간 최종가" — 위젯은 **현재 입찰가**다.

## 수치 출처

- 4주 변화: `onepiece-packs.json` marketIndex.board. 각 세트 최신 주간 중앙값 vs 4주 전.
  원본은 `box-sold-series.json`(원장 기반 롤링 중앙값, 판매일 기준).
- 경매 행 2건: 홈 AUCTIONS ENDING SOON 위젯 08-24 14:08 실제 표시분.
- 1,279 종료 / 356 낙찰: `auction-series.json` 2026-08-23(완결일).

## 별건 — 원장 언어 오염 (조치 필요)

jp 원장 917건 중 **83건(9%)이 en 중앙값 대역**에 있다. OP-13은 23/91(25%)로 최악
(예: "One Piece OP-13 Japanese Booster Box ... UK Seller" $475 — 실제 일본판은 $120~135대).
eBay Language 패싯이 판매자 신고값이라 영문판이 jp 버킷에 섞인다.
현재는 42일 롤링 중앙값이 정상 무리에 안착해 게시값은 맞지만, 오염이 커지면 중앙값이 뒤집힌다.
→ ingest 판정에 "그 세트 en 중앙값의 0.8배 이상이면 보류" 같은 방어를 넣을 것.
