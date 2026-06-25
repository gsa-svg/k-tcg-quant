# Agent Brief

짧게 읽고 바로 작업한다.

- 답변은 한국어 반말, 짧게, 핵심만.
- 사용자가 시키면 직접 수정, 검증, 커밋, 푸시까지 한다.
- 비밀값, `.env`, eBay 키, 캡처는 출력/커밋 금지.
- 메인 파일: `packs.html`, `packs.js`, `data/onepiece-packs.json`.
- 배포 URL: `https://gsa-svg.github.io/k-tcg-quant/packs.html`.
- 테스트:
  - `node --check packs.js`
  - `node --check tools/update-ebay-psa10-prices.js`
  - `node tools/test-price-outliers.js`
- 자동 업데이트 템플릿: `docs/workflow-templates/update-market-data.yml`
- 작업 후 품질 점수와 남은 TODO만 짧게 말한다.
