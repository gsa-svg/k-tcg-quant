# 자동 업데이트

`.github/workflows/update-market-data.yml`은 매주 월요일 03:00 KST에 시장 데이터를 갱신한다.

현재 GitHub 푸시 토큰에 `workflow` 권한이 없어서 활성 워크플로우 파일은 원격에 직접 올리지 못했다. 템플릿은 repo에 남겨둔다.

- 실행 주기: 2일마다 03:20 KST
- 수동 실행: GitHub Actions > `Update market data` > `Run workflow`
- 주기: 매주 월요일 03:00 KST
- 주의: PSA10은 eBay Sold 브라우저 검수 기반이라 GitHub Actions에서 Active 호가로 갱신하지 않는다.
- 가격 품질 검수: `tools/audit-price-quality.js`가 차단급 오매칭을 잡으면 커밋을 막는다.
- 현재 자동 갱신 대상:
  - eBay 부스터팩 Active High/Middle/Low
  - eBay PSA10 Active High/Middle/Low
- 검증:
  - `packs.js` 문법
  - eBay 수집기 문법
  - PSA10 eBay 이상치 테스트

GitHub repo Secrets에 아래 값이 있어야 eBay 갱신이 돈다.

```text
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
```

Secret이 없으면 검증만 하고 eBay 갱신은 건너뛴다.
