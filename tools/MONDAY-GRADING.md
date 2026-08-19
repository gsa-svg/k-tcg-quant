# 월요일 그레이딩 수집 절차

두 층을 모두 갱신한다. 하나만 하면 화면에서 **세트 합계와 카드 합계가 어긋난다**.

| 층 | 무엇 | 어디에 |
|---|---|---|
| 세트 전체 | 그 세트에 여태 들어온 감정 누적(PSA·CGC·TAG 각각) | `psaFull` · `graders` |
| top10 카드 | 우리가 추적하는 카드 10장의 등급 분포 | `psa/cgc/tag-card-pop.json` |

## 순서

```bash
# 1) PSA — 세트 누적
node tools/collect-gemrate-psa-history.js
node tools/import-gemrate-psa-history.js      # → packs.json 의 psaFull
node tools/collect-gemrate-en-totals.js
node tools/collect-psa-edition-weekly.js
node tools/import-gemrate-en-totals.js
node tools/inject-psa-wow.js

# 2) CGC — 카드별(공개 API, 자동)
node tools/collect-cgc-card-pop.js "$TMP/cgc-dump.json"
node tools/cgc-card-pop-api-ingest.js "$TMP/cgc-dump.json"

# 3) 브라우저가 필요한 것 — 아래 "브라우저 수집" 참고
#    CGC 세트 · TAG 세트 · TAG 카드 · PSA 카드

# 4) 세트 누적을 화면에 반영 + 검증
node tools/inject-grader-editions.js          # → packs.json 의 graders (CGC·TAG 누적)
node tools/generate-set-pages.js && node tools/generate-card-pages.js && node tools/generate-ko-pages.js
node tools/audit-grading-numbers.js           # 숫자 검증 — 실패하면 배포 금지
node tools/guard-invariants.js
```

## 브라우저 수집 (실브라우저 필수)

**PSA 카드별** — `collect-psa-card-pop.js` 는 이제 못 쓴다. GemRate 가 헤드리스 크롬을
봇으로 막는다("잠시만 기다리십시오"). 실브라우저에서 `fetch` 로 HTML 을 받아
`var RowData = '...'` 를 파싱한다. 주의 세 가지:
 - **반드시 gemrate.com 페이지 위에서** 실행한다. 다른 탭(eBay 등)에서 fetch 하면
   교차 출처로 전부 실패한다 — 2026-08-18 에 이걸 "요청 한도"로 오진했다.
 - 필드명은 `card_total_grades` 다. `total_graded` 는 없다 — 그걸 찾으면 감정 수가 전부 0 이 된다.
 - `card_number` 는 세트 접두어 없는 `"069"` 형식이다. `"OP05-069"` 와 직접 대조하면 하나도 안 맞는다.

**CGC 세트** — `cgc-pop.js --collector <페이지>` 를 페이지마다 실행. 마지막 페이지가
`hasNext=true` 면 ingest 가 적재를 거부한다(2페이지가 늘어난 걸 놓치지 않으려는 장치).

**TAG 세트·카드** — `tag-pop.js --setup` / `tag-card-pop.js --setup` 후 연도별로 훑는다.
SPA 라 느리고 렌더러가 얼기도 한다. 결과 회수는 다운로드가 막히므로
`document.body` 를 비우고 `<pre>` 에 렌더한 뒤 `get_page_text` 로 읽는다(40KB 까지 안전).

## 왜 두 층을 같이 하나

세트 누적만 갱신하면 카드 합계가 옛 값으로 남고, 카드만 갱신하면 그 반대가 된다.
2026-08-19 점검에서 top10 합계가 세트 전체의 22~64% 로 전 세트 정상이었는데,
이 비율이 100% 를 넘으면 둘 중 하나가 낡았다는 뜻이다. `audit-grading-numbers.js` 가 그걸 잡는다.

## 죽은 필드 주의

`psaTotal` · `psaGem` 은 2026-07-15 수동 기입 후 갱신하는 코드가 없다.
화면은 `psaFull?.total ?? psaTotal` 순서라 지금은 안 쓰이지만, `psaFull` 이 빈 세트가
생기면 한 달 묵은 값이 조용히 나간다. 정리 대상.
