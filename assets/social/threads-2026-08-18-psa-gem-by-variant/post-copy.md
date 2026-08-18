# Threads — PSA 10 rate by art variant (2026-08-18)

이미지 2장 (1080×1350):
1. `threads-psa-gem-01-en.png` — 변형별 젬률
2. `threads-psa-gem-02-en.png` — 개별 카드 최저 5장 + 최고 1장

## 본문 (확정 · 8/18 재수집 반영)

PSA 10 rates by art variant

96 Japanese chase cards, 195,075 graded, grouped by the art variant on the PSA label.

Median 90% — most gem fine. But the variants split.

· Base 91.9%
· Alternate Art 91.4%
· Special Alt 88.6%
· Manga Alt 85.0%

Manga art sits 6.4 points lower, across 72,121 graded copies.

Lowest: Trafalgar Law OP05-069 — 2,915 graded, 71% a 10, 25% a 9.
Highest: Perona OP06-021 — 98%.

JP · Aug 18, 2026
opboxindex.com/psa-grading.html

(454자 — 스레드 500자 제한 안. 처음 562자였던 초안에서 제목 부연·이음말·마지막 문단을
줄여 맞췄다. 숫자는 하나도 빼지 않았다.)

## 본문이 이미지와 맞는지 대조
| 본문 문장 | 이미지 근거 |
| --- | --- |
| 85.0 / 91.4 / 91.9% | 슬라이드 1 막대 |
| 96 cards · 195,075 graded | 슬라이드 1 푸터 |
| 71% a 10, 25% a 9 (2,915장) | 슬라이드 2 출처줄 |
| Perona 98% | 슬라이드 2 비교 항목 |
| Japanese only | 두 장 eyebrow |

본문에서 뺀 것: Red Manga(88.1%)·Special Alt(88.8%). 표본이 1,894 / 13,963장으로 작고,
넣으면 본문만 길어진다 — 이미지에 있으니 읽는 사람은 어차피 본다.

## 쓰면 안 되는 문장 (실제로 한 번 틀렸던 것)
- ❌ "three in ten come back a 9" — 10을 못 받는 게 29%이고, 그중 9는 25%다. 둘은 다른 수다.
- ❌ "one card in four misses the 10" — 최저 카드가 29% 미스라 1/4(25%)이 아니다.
- ❌ "manga art is cut worse at the factory" — 원인은 인구 데이터로 알 수 없다.
  감정 전 취급이 섞였을 가능성도 배제 못 한다.

## 검증한 것
- 일본판만 — psa-card-pop.json 의 sets[code].jp 경로. 영문판은 인쇄 로트가 달라 섞지 않았다.
- 표본 300장 미만 카드 제외(95장 남음). 변형별 수치는 카드 평균이 아니라 감정 장수 가중.
- 슬라이드 1 막대는 82~93% 스케일. 전 구간으로 그리면 6.5%p 가 안 보인다. 그 사실을 카드에 적었다.
- 재현: node tools/... 없이도 data/psa-card-pop.json + onepiece-packs.json + ourTier() 로 다시 뽑힌다.

## 톤 규칙 (2026-08-18 확립)
- 데이터보다 세게 말하지 않는다. 젬률 85% 는 높은 수치다 — "9 받을 각오" 같은 훅은 과장이다.
  중앙값(90%) 을 먼저 밝히고 그 다음에 차이를 말한다.
- "이 데이터로는 알 수 없습니다" 류 방어 문장을 넣지 않는다. 정확하려고 붙인 말인데
  읽는 쪽에는 근거가 빈약해 보인다. 모르는 건 안 쓰면 된다.
- 조건은 라벨로 짧게. "일본판만 집계했습니다. 영문판은 인쇄 로트가 달라…" → "JP · Aug 18, 2026".
  왜 그렇게 집계했는지는 이 파일과 커밋 메시지에만 남긴다.

## 수집 메모 (2026-08-18)
GemRate 카드별 인구는 헤드리스 크롬이 막힌다("잠시만 기다리십시오" = 봇 검사).
실브라우저에서 fetch 로 HTML 을 받아 `var RowData = '...'` 를 파싱하면 통과한다.
필드명 실측: card_number(세트 접두어 없는 "069" 형식) · name · parallel ·
card_total_grades · g10 · g9. tools/collect-psa-card-pop.js 는 total_graded 를
찾는데 그런 필드는 없다 — 그대로 두면 감정 수가 전부 0 으로 들어간다.
연속 40회를 넘기면 요청이 막히기 시작한다(오늘 후반 7세트가 그렇게 실패했다).
