// 카드별 시세 이력 — data/card-series.json. 2026-10-14 packs.json 에서 분리.
//
// 왜 분리했나: card.series 는 packs.json 의 30%(314KB)였고 하루 ~4.2KB 씩 자라 packs 를 가드 T2 상한(1.2MB)으로
// 밀고 있었다(10/28 전후 FAIL → 가드를 도는 수집 7개 정지, 8/27 사고와 같은 모양). 그런데 방문자 화면(packs.js)은
// 이 이력을 한 번도 읽지 않는다 — 읽는 곳은 빌드 도구(카드 페이지 이력표·AI 데이터 관측일)뿐이다.
// 그래서 방문자가 매번 받는 packs.json 에서 빼고, 빌드 도구만 이 파일을 읽는다. 값은 옮기기만 했다.
//
// 구조: { updated, note, sets: { <세트코드>: { "<카드번호>|<카드이름>": { currency, source, updated, points:[{d,nm,psa}], cleaned? } } } }
// 키는 packs.json 의 그 세트 카드(번호+이름)다. 같은 번호의 다른 변형은 이름이 달라 섞이지 않고, 카드가 다른 변형으로
// 바뀌면(repair-op12-verified-variants 등) 새 키라 옛 이력이 따라가지 않는다 — packs 에 붙어 있던 때와 같은 동작.
const fs = require("node:fs");
const path = require("node:path");

const CARD_SERIES_FILE = path.join(__dirname, "..", "data", "card-series.json");

const cardKey = (card) => `${card.number || ""}|${card.name || ""}`;

// 파일이 없으면 던진다 — 조용히 빈 이력으로 넘어가면 카드 페이지 이력표가 전부 사라진 채 배포된다.
function readCardSeries(file = CARD_SERIES_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const seriesOf = (store, code, card) => store?.sets?.[code]?.[cardKey(card)] || null;

module.exports = { CARD_SERIES_FILE, cardKey, readCardSeries, seriesOf };
