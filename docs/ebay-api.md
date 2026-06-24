# eBay API 연동 메모

## 현재 상태

- Production keyset은 생성됨.
- 화면 캡처에 `Cert ID(Client Secret)`가 노출됐으므로 현재 Secret은 사용하지 않는 것이 맞음.
- `Rotate (Reset) Cert ID`로 새 Secret을 만든 뒤 `.env`에만 저장해야 함.
- `.env`와 eBay 키 화면 캡처는 `.gitignore`에 추가되어 공개 저장소에 올라가지 않음.

## 로컬 설정

프로젝트 루트에서 `.env.example`을 `.env`로 복사한 뒤 새로 발급한 값을 입력한다.

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` 형식:

```dotenv
EBAY_CLIENT_ID=새_App_ID_Client_ID
EBAY_CLIENT_SECRET=새로_Rotate한_Cert_ID_Client_Secret
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_SEARCH_LIMIT=10
```

## 테스트

```powershell
& 'C:\Users\kimtt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tools\ebay-search.js
```

다른 검색어 테스트:

```powershell
& 'C:\Users\kimtt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tools\ebay-search.js "One Piece Card Game OP-01 Romance Dawn Booster Box Japanese sealed"
```

## 일본판 부스터팩 High/Middle/Low 업데이트

Active 매물을 조회해 일본판 부스터팩별 `High / Middle / Low`를 `data/onepiece-packs.json`에 저장한다.
중국/홍콩/마카오 발송지 또는 중국권 판매자명으로 추정되는 매물은 계산에서 제외한다.

```powershell
& 'C:\Users\kimtt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tools\update-ebay-pack-prices.js OP-01 OP-02 OP-03
```

코드를 지정하지 않으면 준비된 일본판 전체 세트를 순서대로 갱신한다.

## 사용 API

- OAuth Client Credentials로 앱 토큰 발급
- Browse API `item_summary/search`로 Active 고정가 매물 조회
- Sold 데이터는 Browse API만으로는 부족하므로 이후 별도 API/대체 소스 검토 필요
