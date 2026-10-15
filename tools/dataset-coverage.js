"use strict";
// 같은 배포 파일(opbox-ai-data.json · opbox-set-prices.csv · opbox-grading-population.csv)을 가리키는 Dataset 노드의
// 기간(temporalCoverage)·수정일은 이 함수들에서만 계산한다 — 2026-10-14 QA 신설.
// 왜: 같은 opbox-ai-data.json 이 free-data 에선 2026-06-29/10-14, 홈에선 2026-07-07/10-13 이었다(페이지마다 따로 셌다).
//     등급 CSV 도 psa-grading 09-30 · free-data 10-07 로 갈렸다. 기간 = 그 파일에 실린 관측일 전체의 첫날/마지막 날.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { buildAiData } = require("./ai-data-model");
const { buildBoxRecords, buildGradeRecords } = require("./free-data-records");

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
const span = (dates) => { const v = dates.filter((x) => ISO.test(x || "")).sort(); return v.length ? { from: v[0], to: v.at(-1), coverage: `${v[0]}/${v.at(-1)}` } : null; };

// Dataset 수정일 = 받은 날짜들(데이터일·기간 끝 등) 중 가장 늦은 날 — 2026-10-15 감사(#4).
// 홈·box-prices·free-data·ko·weekly 의 Dataset 이 dateModified 2026-10-14(packs 데이터일)인데 temporalCoverage 는 …/2026-10-15 였다.
// 기간 안에 수정일보다 늦은 관측이 있으면 안 된다 — 수정일은 늘 기간 끝 이상이다(가드 DS1).
const latestDate = (...ds) => ds.filter((x) => ISO.test(x || "")).sort().at(-1) || null;

// opbox-ai-data.json — 세트 박스 시장(판매 표본·호가 관측일)과 Top 7 카드의 관측일 전부.
// modified = 그 파일의 datasetUpdatedOn(실린 관측일 중 가장 늦은 날, ai-data-model.datasetAsOf) — 이 파일을 가리키는 Dataset 은 전부 이 날을 쓴다.
function aiDataSpan(packs) {
  const ai = buildAiData(packs);
  const dates = [];
  for (const set of ai.sets) {
    for (const market of Object.values(set.boxMarket)) dates.push(market.sold?.sampleCollectedOn, market.activeAsk?.observedOn);
    for (const hit of set.topHits) dates.push(hit.rawNmAsk?.observedOn, hit.psa10Sold?.sampleCollectedOn, hit.psaPopulation?.observedOn);
  }
  const sp = span(dates);
  return sp && { ...sp, modified: latestDate(ai.datasetUpdatedOn, sp.to) };
}
// opbox-set-prices.csv
function boxCsvSpan(packs) { return span(buildBoxRecords(packs).dates); }
// opbox-grading-population.csv · opbox-ai-grading.json
function gradingSpan(packs) { return span(buildGradeRecords(packs, readJson("data/cgc-grading-history.json"), readJson("data/tag-grading-history.json")).dates); }

// AI 확장 파일(opbox-ai-cards·opbox-ai-grading·opbox-ai-auctions.json) — 2026-10-15(3차).
// 기간 = 그 파일 안 관측 행 날짜(observedOn·sampleCollectedOn·date)의 첫날/마지막 날, modified = 그 파일의 datasetUpdatedOn.
// 파일과 같은 함수(generate-ai-extras.buildExtraDocs)로 같은 객체를 만들어 센다 — 생성 순서상 파일은 free-data·psa-grading 뒤에 써진다.
// 왜: free-data #ai-grading-json·#ai-auctions-json 이 CSV 날짜로 셈해 dateModified 10-14 · 파일 datasetUpdatedOn 10-15 였다(가드 DS1).
let EXTRA = null;
const ROW_KEYS = new Set(["observedOn", "sampleCollectedOn", "date"]);
function rowDates(doc) {
  const out = [];
  const walk = (o, key) => {
    if (Array.isArray(o)) o.forEach((v) => walk(v, key));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
    else if (ROW_KEYS.has(key)) out.push(o);
  };
  walk(doc, "");
  return out;
}
function extraSpan(file) {
  if (!EXTRA) EXTRA = require("./generate-ai-extras").buildExtraDocs();
  const doc = EXTRA[file];
  const sp = doc ? span(rowDates(doc)) : null;
  return sp && { ...sp, modified: doc.datasetUpdatedOn };
}

module.exports = { span, latestDate, aiDataSpan, boxCsvSpan, gradingSpan, extraSpan };
