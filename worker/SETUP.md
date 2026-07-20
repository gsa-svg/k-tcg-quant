# 경매 중계기 설치 (Cloudflare Worker) — 5~10분

우리 사이트는 정적 호스팅이라 스스로 실시간 데이터를 못 가져온다. 브라우저에서 eBay를 직접 부르면
API 키가 노출되므로, 키를 서버 쪽에 두고 결과만 넘겨주는 **중계기**가 필요하다.
무료 한도(하루 10만 요청)로 충분하고 카드 등록도 필요 없다.

## 1. 계정 만들기
<https://dash.cloudflare.com/sign-up> 에서 가입 (이메일 인증만. 무료 플랜)

## 2. Worker 만들기
1. 왼쪽 메뉴 **Workers & Pages** → **Create** → **Start with Hello World!** → **Deploy**
2. 이름은 `opbox-deals` 정도로. (배포되면 `opbox-deals.<계정이름>.workers.dev` 주소가 생김)
3. 배포 후 **Edit code** 클릭
4. 편집기의 기존 코드를 **전부 지우고**, 이 저장소의 `worker/auction-deals-worker.js` 내용을 **그대로 붙여넣기**
5. 우측 상단 **Deploy**

## 3. eBay 키 넣기 (⚠️ 직접 입력할 것)
Worker 화면 → **Settings** → **Variables and Secrets** → **Add**

| 이름 | 값 |
|---|---|
| `EBAY_CLIENT_ID` | 프로젝트 `.env` 의 EBAY_CLIENT_ID 값 |
| `EBAY_CLIENT_SECRET` | 프로젝트 `.env` 의 EBAY_CLIENT_SECRET 값 |

둘 다 **Type을 `Secret`** 으로 선택해야 값이 가려진다. 저장 후 **Deploy**.

> 이 값은 사이트 소유자가 직접 입력한다. 자격증명은 대화나 코드에 남기지 않는다.

## 4. 동작 확인
브라우저에서 `https://opbox-deals.<계정이름>.workers.dev` 접속.
아래처럼 JSON이 나오면 성공:

```json
{ "generatedAt": "...", "windowMinutes": 180, "candidates": 7, "items": [ ... ] }
```

`items` 가 비어 있어도 정상일 수 있다(그 시각에 3시간 내 종료 경매가 없을 때).
`"error"` 필드가 보이면 키 입력이 잘못된 것이다.

## 5. 주소 알려주기
위 주소를 알려주면 사이트에 연결한다.

---

## 설계 메모 (수정 시 지킬 것)
- **60초 캐시**: 방문자가 몇 명이든 eBay 호출은 분당 1회. 할당량 안전장치이므로 줄이지 말 것.
- **CORS 제한**: `opboxindex.com` 에서만 호출 가능. 남이 우리 중계기를 퍼가지 못하게 하는 장치.
- **필터 일치**: `tools/fetch-auction-deals.js` 와 같은 기준(제외 지역, OPTCG 판별, 정렬)을 유지해야
  사이트에 표시되는 것과 우리가 쌓는 통계가 어긋나지 않는다. 한쪽만 고치지 말 것.
- **실패 시 빈 목록**: 에러가 나도 200으로 빈 `items` 를 돌려준다. 프런트가 섹션을 조용히 숨기고
  페이지 전체가 깨지지 않게 하기 위함.
