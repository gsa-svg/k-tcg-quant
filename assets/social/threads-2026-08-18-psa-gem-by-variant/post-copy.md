# Threads — PSA 10 rate by art variant (2026-08-18)

이미지 2장 (1080×1350):
1. `threads-psa-gem-01-en.png` — 변형별 젬률
2. `threads-psa-gem-02-en.png` — 개별 카드 최저 5장 + 최고 1장

## 본문 (확정)

Sending manga art to PSA? Budget for a 9.

We grouped 95 Japanese chase cards — 184,648 graded copies — by the art variant printed on the PSA label. Manga Alternate Art returns a 10 in 85.0% of submissions. Plain Alternate Art: 91.5%. Base prints: 92.1%.

The floor is Trafalgar Law OP05-069. Of 2,903 graded, 71% came back a 10 and 25% came back a 9. The ceiling is Perona OP06-021 at 98%.

Japanese printings only — we keep English separate, since it's a different print run. Population read Aug 10, 2026.

Why manga art grades lower isn't something population data can answer. That it does, it can.

opboxindex.com/psa-grading.html

## 본문이 이미지와 맞는지 대조
| 본문 문장 | 이미지 근거 |
| --- | --- |
| 85.0 / 91.5 / 92.1% | 슬라이드 1 막대 |
| 95 cards · 184,648 graded | 슬라이드 1 푸터 |
| 71% a 10, 25% a 9 | 슬라이드 2 출처줄 |
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
