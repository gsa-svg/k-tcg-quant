# eBay API 호출 한도 상향 신청서 (Application Growth Check)

2026-09-02 작성. **사장님이 직접 제출해야 합니다** — 개발자 계정 소유자만 넣을 수 있습니다.

## 왜 필요한가

지금 Browse API 한도가 **하루 5,000콜**입니다. 오늘 4,700콜을 쓰고 소진돼 정산이 멈췄습니다.
통과하면 **하루 150만콜**까지 올라갑니다(무료, 3~5영업일).

한도가 올라가면 바뀌는 것:

| | 지금 (5,000/일) | 통과 후 |
|---|---|---|
| 원피스 커버리지 | 19~59% (날마다 흔들림) | 100% 고정 |
| TCG 17종 | 게임당 하루 200건 표본 | 게임당 수천 건 — 게임 간 비교가 성립 |
| 거래액 순위 | 표본량을 따라가 오해를 부름 | 실제 시장 규모 |

## 제출 경로

<https://developer.ebay.com/my/support/tickets?tab=app-check>

개발자 계정으로 로그인 → **Application Growth Check** 탭 → 양식 작성 → Submit.
`Save as Draft` 로 중간 저장이 됩니다.

## 양식에 넣을 내용

빨간 별표 항목은 전부 채워야 합니다. 아래는 우리 실제 사용량을 그대로 적은 것입니다.

### 애플리케이션 용도

> OP Box Index (https://opboxindex.com) is a public research site that publishes settled
> auction outcomes for trading card games. We re-read each auction listing **after it closes**
> and record whether it sold, the final winning bid, and the bidder count, then publish daily
> aggregates — sell-through rates, median winning bids and price ranges — free under CC BY 4.0.
> We publish derived aggregates only; we never republish raw listing data, seller names or
> listing IDs. We are an eBay Partner Network affiliate and link back to eBay listings.

### 사용하는 API 호출

| 호출 | 용도 | 현재 일 사용량 | 요청량(일) |
|---|---|---|---|
| `buy/browse/v1/item_summary/search` | 종료 임박 경매 발견 | 약 3,900 | 20,000 |
| `buy/browse/v1/item/{id}` | 종료 후 낙찰 결과 재조회 | 약 800 (한도 때문에 억제됨) | 60,000 |
| `developer/analytics/v1_beta/rate_limit` | 잔여량 확인 | 약 30 | 500 |

### 예상 피크

- **시간당 최대**: 약 4,000콜 (정산 워크플로가 2시간마다 도는데, 그 사이 종료된 경매를 한 번에 읽습니다)
- **일별**: 약 80,000콜
- 근거: 원피스만 하루 1,900건이 종료되고, TCG 17종을 합치면 하루 6만 건대가 종료됩니다.
  전부 정산하려면 종료 건수만큼 `getItem` 이 필요합니다.

### 호출을 아끼는 방법 (물어보면 답할 내용)

- 종료 후 30시간이 지난 건은 포기합니다 — 무한 재시도를 하지 않습니다.
- 잔여량을 매 실행 전에 확인하고, 남지 않으면 건너뜁니다 (`tools/ebay-budget.js`).
- 검색 결과는 하루 단위 원장에 append-only 로 쌓고 다시 조회하지 않습니다.
- 429 를 받으면 즉시 중단합니다.

## 통과 후 우리가 할 일

한도가 올라가면 `tools/ebay-budget.js` 의 `RESERVE` 값만 키우면 됩니다.
수집기 세 개(`settle-auctions` · `settle-tcg` · `collect-auction-market`)가 모두 그 파일을
보고 움직이므로, 코드를 더 고칠 곳은 없습니다.

승인 결과가 나오면 알려 주세요 — 배분을 새 한도에 맞춰 다시 잡겠습니다.
