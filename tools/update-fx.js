#!/usr/bin/env node
// 환율(data/fx.json) 갱신 + 일별 이력(data/fx-history.json) 축적 — 2026-08-17 신설.
//
// 왜 만드나: fx.json 은 2026-07-01 값(1548.63)에 47일 동안 멈춰 있었고, 그걸 갱신하는
//   워크플로우도 스크립트도 없었다. 그 사이 실제 환율은 1415 까지 내려서, eBay 가 원화로
//   보여주는 가격을 달러로 환산하는 12개 파일이 전부 8.6% 낮은 값을 쓰고 있었다.
//
// 이력을 같이 쌓는 이유: 원장은 달러값만 저장한다. 나중에 "이 기록은 어느 환율로 환산됐나"를
//   되짚으려면 그날 환율이 필요한데, 무료 API 는 과거를 며칠치밖에 안 준다. 소급이 안 되는
//   데이터는 미리 쌓아 둔다.
//
// 출처: ECB 기준환율(frankfurter). 영업일만 나오므로 주말·공휴일은 직전 영업일 값을 쓴다.
//   USD/KRW 는 ECB 가 EUR 기준으로 고시한 것을 교차 계산한 값이라 은행 매매기준율과 소수점
//   단위로 다를 수 있다. 우리 용도(달러 환산)에는 그 차이가 무의미하다.
const fs = require("node:fs");
const path = require("node:path");

const DATA = path.join(__dirname, "..", "data");
const FX = path.join(DATA, "fx.json");
const HIST = path.join(DATA, "fx-history.json");
const API = "https://api.frankfurter.dev/v1";

const get = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": "opboxindex/1.0" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.json();
};

(async () => {
  const latest = await get(API + "/latest?base=USD&symbols=KRW,JPY");
  const date = latest.date;
  const usdKrw = latest.rates.KRW;
  const jpyKrw = usdKrw / latest.rates.JPY;

  const prev = fs.existsSync(FX) ? JSON.parse(fs.readFileSync(FX, "utf8")) : {};
  const next = {
    date,
    jpyKrw: Number(jpyKrw.toFixed(2)),
    usdKrw: Number(usdKrw.toFixed(2)),
    source: "api.frankfurter.dev (ECB reference rates), USD base",
  };

  // 이력: 최근 90일을 받아 빠진 날만 채운다(append-only, 기존 값은 덮지 않는다).
  const hist = fs.existsSync(HIST)
    ? JSON.parse(fs.readFileSync(HIST, "utf8"))
    : { note: "USD/KRW 일별 ECB 기준환율. 원장의 달러 환산을 나중에 되짚기 위해 쌓는다. 영업일만 존재한다.", source: API, rates: {} };
  const from = new Date(Date.parse(date) - 90 * 864e5).toISOString().slice(0, 10);
  const series = await get(API + "/" + from + ".." + date + "?base=USD&symbols=KRW");
  let added = 0;
  for (const [d, v] of Object.entries(series.rates)) {
    if (hist.rates[d] != null) continue;
    hist.rates[d] = Number(v.KRW.toFixed(2));
    added++;
  }
  hist.updated = date;
  hist.days = Object.keys(hist.rates).length;

  fs.writeFileSync(FX, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.writeFileSync(HIST, JSON.stringify(hist, null, 1) + "\n", "utf8");

  const drift = prev.usdKrw ? ((next.usdKrw / prev.usdKrw - 1) * 100).toFixed(2) : null;
  console.log(JSON.stringify({
    status: "ok",
    was: prev.date ? prev.date + " " + prev.usdKrw : null,
    now: date + " " + next.usdKrw,
    driftPct: drift,
    historyAdded: added,
    historyDays: hist.days,
  }));
})().catch((e) => { console.error(String(e)); process.exit(1); });
