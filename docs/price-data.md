# 가격 데이터 수집 메모

## 카드 TOP10 가격

- `기준가`: TCG Quant의 USD market price.
- `NM`: 일본 싱글 미감정 가격. 1차 출처는 遊々亭, 번호 매칭 실패 시 카드러시를 보조 출처로 사용.
- `PSA10`: 실제 낙찰/거래가가 확인된 카드만 표시. 확인되지 않은 카드는 추정 입력하지 않음.

## 수집 스크립트

```powershell
& 'C:\Users\kimtt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tools\update-yuyutei-nm-prices.js
& 'C:\Users\kimtt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tools\update-cardrush-nm-fallback.js
```

## 주의

- PRB/EB 재록 카드는 원 세트 번호와 재록 페이지 번호가 다를 수 있다.
- DON 카드는 유유테이에서 번호가 `-`로 표시되어 이름 기반 보정이 필요하다.
- 일본 NM과 TCG Quant USD 기준가는 같은 지표가 아니다. 화면에는 둘을 분리해서 표시한다.
