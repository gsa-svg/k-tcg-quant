"use strict";
// AI 파일 규칙 — 사실 파일이 보장하지 못하는 파일 안 일관성. 2026-10-15 분할. (값 대조는 pages-vs-facts)
//  AS1 기준일 ≥ 실린 관측일, 경과일 = 기준일 − 관측일 [2026-10-15 감사 #11: 10-14 파일에 10-15 표본, 경과일 -1 이 0]
//  AB1 AI 경매 bySet = 알려진·발매된 세트만, llms-full 표·auction.html 세트 표와 같은 목록 [감사 #9·#17·#18: 없는 코드 12개·미발매 OP-18]
const { errors, read, exists, json, ISO, facts } = require("./lib");

const checks = ["AS1", "AB1"];
const KEYS = new Set(["observedOn", "sampleCollectedOn", "fxObservedOn", "checkedOn", "releaseCheckedOn", "specCheckedOn", "date", "to"]);

function run() {
  for (const f of ["opbox-ai-data.json", "opbox-ai-cards.json", "opbox-ai-grading.json", "opbox-ai-auctions.json"].filter(exists)) {
    const o = json(f, null); if (!o) { errors.push(`AS1: ${f} 를 읽을 수 없다`); continue; }
    let late = 0, badAge = 0, first = "";
    const walk = (nd) => {
      if (Array.isArray(nd)) return nd.forEach(walk);
      if (!nd || typeof nd !== "object") return;
      for (const [k, v] of Object.entries(nd)) { if (KEYS.has(k) && ISO.test(v || "") && v > o.datasetUpdatedOn) { late++; first = first || `${k}=${v}`; } else if (v && typeof v === "object") walk(v); }
      const d = nd.observedOn || nd.sampleCollectedOn;
      if (ISO.test(d || "") && "ageDaysAtDatasetUpdate" in nd && nd.ageDaysAtDatasetUpdate !== Math.round((Date.parse(o.datasetUpdatedOn) - Date.parse(d)) / 864e5)) badAge++;
    };
    walk(o);
    if (late) errors.push(`AS1: ${f} 에 기준일 ${o.datasetUpdatedOn} 보다 늦은 관측일 ${late}건(예: ${first})`);
    if (badAge) errors.push(`AS1: ${f} 경과일(ageDaysAtDatasetUpdate) ${badAge}건이 기준일 − 관측일과 다르다`);
  }
  try {
    const AU = json("opbox-ai-auctions.json").onePiece.bySet, F = facts();
    const RF = Object.fromEntries(F.releaseFacts.map((r) => [r.setCode, r]));
    const rel = (c) => (RF[c] ? RF[c].japanese.releaseDate || RF[c].english.releaseDate : null), min = Number(AU.minEnded) || 30;
    for (const s of AU.sets || []) {
      const c = s.setCode;
      if (/^ST-\d{2}$/.test(c)) { if (!(s.ended >= min)) errors.push(`AB1: AI 경매 bySet ${c} 종료 ${s.ended}건 < 경매 페이지 기준 ${min}`); continue; }
      if (!RF[c]) { errors.push(`AB1: AI 경매 bySet 에 없는 세트 코드 ${c}(releaseFacts 에 없음)`); continue; }
      if (!rel(c) || rel(c) > AU.to) errors.push(`AB1: AI 경매 bySet 에 미발매 세트 ${c}(발매 ${rel(c) || "—"} > 창 끝 ${AU.to}) — sold ${s.sold}, amountUsd ${s.amountUsd}`);
    }
    const feedCodes = (AU.sets || []).map((s) => s.setCode);
    const sect = (read("llms-full.txt").match(/\nPer set, last \d+ days[^\n]*\n([\s\S]*?)\n\n/) || [null, ""])[1];
    const llmsCodes = sect.split("\n").map((l) => l.split(" | ")[0]).filter(Boolean);
    if (llmsCodes.join(",") !== feedCodes.join(",")) errors.push(`AB1: llms-full 세트별 경매 표(${llmsCodes.length}행)가 AI 피드 bySet(${feedCodes.length}행)과 다르다`);
    const h = read("auction.html"), i = h.indexOf('id="setBody"');
    const page = new Set([...h.slice(i, h.indexOf("</tbody>", i)).matchAll(/\b(?:OP|EB|PRB|ST)-\d{2}\b/g)].map((m) => m[0]));
    for (const c of feedCodes) if (!page.has(c)) errors.push(`AB1: AI 피드 bySet 의 ${c} 가 auction.html 세트 표에 없다`);
    for (const c of page) if (!/^ST-/.test(c) && (!RF[c] || !rel(c) || rel(c) > AU.to)) errors.push(`AB1: auction.html 세트 표에 없는/미발매 세트 ${c}(발매 ${rel(c) || "—"})`);
  } catch (e) { errors.push("AB1: AI 경매 세트별 검사 실패 — " + e.message); }
}

module.exports = { checks, run };
