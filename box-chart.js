// 부스터 박스 실거래(sold) 시세 그래프 — 일본판/영문판 두 패널.
//
// 이 파일 하나가 **유일한 소스**다. 홈 화면(packs.js, 브라우저)과 정적 세트 페이지
// (tools/generate-set-pages.js, node)가 같은 함수를 쓴다. 예전에 화면마다 차트를 따로 그렸다가
// 같은 세트가 페이지마다 다른 숫자를 보여준 적이 있어, 두 벌로 나누지 않는다.
//
// 설계 결정 (2026-08-13):
//  · **두 패널로 나눈다.** 일본판 $257 · 영문판 $1,525 로 6배 차이라 축을 공유하면
//    일본판 선이 바닥에 눌러붙어 아무 움직임도 안 보인다. 각자 자기 축을 쓴다.
//  · **y축은 중앙값 선 기준.** low~high 전체로 잡으면 선이 축의 5% 만 쓰고 납작해진다(1차 시안 실패).
//  · **x축은 날짜 비례.** 인덱스로 그리면 13일 공백과 1일 간격이 같은 폭이 된다.
//  · **띠(low~high)는 안 그린다.** 축을 선 기준으로 좁히면 띠가 프레임을 덮어 회색 상자가 된다.
//    범위는 훑을 때 툴팁에 숫자로 정확히 나온다.
//  · **표본이 얇은 점은 뺀다.** 몇 건짜리 중앙값은 시세가 아니라 잡음이다.
//    (시계열 자체가 이미 걸러 오지만, 남의 데이터를 그릴 때를 대비해 여기서도 막는다.)
//  · 값은 **판매된 날** 기준이다(수집한 날이 아니라). tools/build-box-sold-series.js 참고 —
//    수집 방식이 바뀌어도 그게 가격 움직임으로 둔갑하지 않게 하려는 것이다.
//  · 선은 단조 3차(monotone cubic) — 일반 스플라인은 점 사이에서 튀어 없던 고점을 만든다.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OPBoxChart = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const W = 680, H = 360, L = 62, R = 18, T = 26, B = 42;
  // 가격 아래에 거래량 막대를 깐다. 주식·TCGplayer 차트의 기본 배치이고,
  // "이 가격이 몇 건에서 나온 값인지"를 선 옆이 아니라 같은 그림에서 바로 보게 하려는 것이다.
  const VOL_H = 46;                    // 막대가 쓰는 세로. 이 아래는 x축 라벨.
  const PRICE_BOTTOM = H - B - VOL_H;  // 가격선이 내려올 수 있는 바닥
  const MIN_N = 5;        // 이 미만의 표본으로 만든 중앙값은 안 그린다
  const MIN_POINTS = 3;   // 점 두 개짜리 "추세"는 추세가 아니다

  const JP_COLOR = "#10d7a0";
  const EN_COLOR = "#5a9bf6";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");

  // 눈금은 사람이 읽는 숫자로 — 1/2/2.5/5 배수에서 고른다. $224 같은 값은 축에 두지 않는다.
  function niceTicks(min, max, want) {
    want = want || 4;
    const span = max - min || 1;
    const raw = span / want;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v));
    return out;
  }

  // 단조 3차 보간 — 점 사이에서 절대 오버슈트하지 않는다(없던 고점·저점을 만들지 않는다).
  function smoothPath(pts) {
    if (pts.length < 3) return pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
    const n = pts.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = Math.hypot(a, b);
      if (h > 3) { m[i] = (3 / h) * a * d[i]; m[i + 1] = (3 / h) * b * d[i]; }
    }
    let out = "M" + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const dx = (pts[i + 1].x - pts[i].x) / 3;
      out += " C" + (pts[i].x + dx).toFixed(1) + " " + (pts[i].y + m[i] * dx).toFixed(1) +
        " " + (pts[i + 1].x - dx).toFixed(1) + " " + (pts[i + 1].y - m[i + 1] * dx).toFixed(1) +
        " " + pts[i + 1].x.toFixed(1) + " " + pts[i + 1].y.toFixed(1);
    }
    return out;
  }

  function clean(points) {
    return (points || [])
      .filter((p) => p && p.d && Number.isFinite(Number(p.median)) && Number(p.median) > 0 && Number(p.n || 0) >= MIN_N)
      .map((p) => ({ d: p.d, median: Number(p.median), low: Number(p.low || p.median), high: Number(p.high || p.median), n: Number(p.n), vol: Number.isFinite(Number(p.vol)) ? Number(p.vol) : null }))
      .sort((a, b) => a.d.localeCompare(b.d));
  }

  const md = (d) => d.slice(5).replace("-", "/");
  // 월간 보기는 날짜가 매달 1일이라 "05/01" 로 찍으면 그날 하루로 오해된다. 달 이름으로 보여준다.
  const monthLabel = (d, lang) => (lang === "ko" ? Number(d.slice(5, 7)) + "월" : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(d.slice(5, 7)) - 1]);

  function panel(rawPts, label, color, gid, lang, windowDays, grain) {
    const pts = clean(rawPts);
    if (pts.length < MIN_POINTS) return "";

    // y축은 중앙값 선 기준으로 잡는다 — low~high 전체로 잡으면 선이 축의 5% 만 쓰고 납작해진다.
    // 다만 **최소 축 폭**을 둔다. 즉시구매만 남기고 나니 OP-01 일본판이 3개월 내내 1% 안에서
    // 움직였는데, 축을 그 폭에 맞추니 $286~$289 짜리 흔들림이 화면을 가득 채워 큰 변동처럼 보였다.
    // 축이 값의 최소 8% 는 담게 하면, 조용한 세트는 조용해 보이고 실제로 움직인 세트만 크게 보인다.
    const meds = pts.map((p) => p.median);
    const mLo = Math.min.apply(null, meds), mHi = Math.max.apply(null, meds);
    const yMid = (mHi + mLo) / 2;
    const ySpan = Math.max((mHi - mLo) * 1.6, yMid * 0.08);
    const yMin = yMid - ySpan / 2, yMax = yMid + ySpan / 2;

    const t0 = Date.parse(pts[0].d), t1 = Date.parse(pts[pts.length - 1].d);
    const span = t1 - t0 || 1;
    const px = (p) => L + ((Date.parse(p.d) - t0) / span) * (W - L - R);
    const py = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (PRICE_BOTTOM - T);

    const XY = pts.map((p) => ({ x: px(p), y: py(p.median) }));
    const line = smoothPath(XY);
    const area = line + " L" + XY[XY.length - 1].x.toFixed(1) + " " + PRICE_BOTTOM +
      " L" + XY[0].x.toFixed(1) + " " + PRICE_BOTTOM + " Z";

    let ticks = niceTicks(yMin, yMax, 4);
    if (ticks.length < 3) ticks = niceTicks(yMin, yMax, 7);
    const grid = ticks.map((v) =>
      '<line class="opbcGrid" x1="' + L + '" y1="' + py(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(v).toFixed(1) + '"/>' +
      '<text class="opbcAx" x="' + (L - 10) + '" y="' + (py(v) + 4).toFixed(1) + '" text-anchor="end">' + money(v) + "</text>").join("");

    // x 라벨은 처음·중간·끝 3개만 — 더 넣으면 축이 데이터보다 시끄러워진다.
    const mid = pts[Math.floor(pts.length / 2)];
    const lab = (p) => (grain === "month" ? monthLabel(p.d, lang) : md(p.d));
    const xl = [pts[0], mid, pts[pts.length - 1]].map((p, i) =>
      '<text class="opbcAx" x="' + px(p).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' +
      (i === 0 ? "start" : i === 2 ? "end" : "middle") + '">' + lab(p) + "</text>").join("");

    const first = pts[0], last = pts[pts.length - 1];
    const chg = Math.round(((last.median / first.median) - 1) * 1000) / 10;
    const up = chg >= 0;
    const sampleWord = lang === "ko" ? "건" : " sales";
    const rangeWord = lang === "ko" ? "범위" : "range";

    // ── 거래량 막대. 값이 1~3 건인 계열도 있는데, 그 사실 자체가 정보다 —
    //    "이 시세는 주 2건에서 나온 값"임을 그림에서 바로 알 수 있어야 한다.
    //    막대 높이는 그 계열 최댓값 기준(절대 개수가 아니라 상대 비교) — 계열끼리 높이를 비교하면 안 되므로
    //    툴팁에 실제 건수를 같이 싣는다.
    const vols = pts.map((p) => (p.vol == null ? 0 : p.vol));
    const volMax = Math.max.apply(null, vols.concat([1]));
    // 막대 폭은 점 간격의 60%. 점이 하나뿐일 때를 대비해 하한을 둔다.
    const gap = pts.length > 1 ? (XY[XY.length - 1].x - XY[0].x) / (pts.length - 1) : 40;
    const bw = Math.max(3, Math.min(26, gap * 0.6));
    const bars = pts.map((p, i) => {
      const v = p.vol == null ? 0 : p.vol;
      if (!v) return "";
      const h = Math.max(2, (v / volMax) * (VOL_H - 8));
      return '<rect class="opbcBar" x="' + (XY[i].x - bw / 2).toFixed(1) + '" y="' + (H - B - h).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + color + '"/>';
    }).join("");
    const volLabel = lang === "ko" ? "거래량" : "Sales";
    // 라벨을 막대 바닥에 두면 첫 막대와 붙어 보인다. 막대 영역 위쪽에 얹는다.
    const volAxis = '<text class="opbcAx opbcVolAx" x="' + (L - 10) + '" y="' + (PRICE_BOTTOM + 14) + '" text-anchor="end">' + volLabel + "</text>" +
      '<line class="opbcGrid" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>';

    const dots = pts.map((p, i) =>
      '<circle class="opbcDot" cx="' + XY[i].x.toFixed(1) + '" cy="' + XY[i].y.toFixed(1) +
      '" r="' + (i === pts.length - 1 ? 5 : 3.2) + '" fill="' + color + '"/>').join("");

    // JS 가 안 돌거나 막힌 환경(일부 인앱 브라우저·미리보기)에서도 숫자가 읽혀야 한다.
    // 넉넉한 투명 원 + <title> 이면 브라우저 기본 툴팁으로 값이 나온다. 아래 스크럽 JS 는 그 위에 얹는 향상일 뿐이다.
    const hits = pts.map((p, i) =>
      '<circle class="opbcHitDot" cx="' + XY[i].x.toFixed(1) + '" cy="' + XY[i].y.toFixed(1) + '" r="14" fill="transparent">' +
      "<title>" + (grain === "month" ? p.d.slice(0, 7) : p.d) + " · " + money(p.median) +
      " (" + rangeWord + " " + money(p.low) + "–" + money(p.high) +
      " · " + p.n + sampleWord + (p.vol == null ? "" : " · " + volLabel + " " + p.vol +
        (lang === "ko" ? "건" : "")) + ")</title></circle>").join("");

    return '<figure class="opbcPane" data-ed="' + gid + '">' +
      '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(label) + "</span>" +
      '<span class="opbcNow">' + money(last.median) + "</span>" +
      '<span class="opbcChg ' + (up ? "up" : "dn") + '">' + (up ? "▲" : "▼") + " " + Math.abs(chg) + "%</span>" +
      '<span class="opbcSpan">' + lab(first) + " – " + lab(last) +
      (grain === "month" ? (lang === "ko" ? " · 월별" : " · monthly")
        : windowDays ? " · " + windowDays + (lang === "ko" ? "일 평균" : "-day avg") : "") +
      " · n=" + last.n + "</span></figcaption>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + " " +
      esc(lang === "ko" ? "박스 실거래 중앙값 추이" : "sealed box median sold price over time") + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity=".30"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      grid + volAxis + bars +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path class="opbcLine" d="' + line + '" stroke="' + color + '"/>' +
      dots +
      '<circle cx="' + XY[XY.length - 1].x.toFixed(1) + '" cy="' + XY[XY.length - 1].y.toFixed(1) +
      '" r="11" fill="' + color + '" opacity=".18"/>' +
      hits +
      '<line class="opbcCross" y1="' + T + '" y2="' + (H - B) + '" stroke="' + color + '" stroke-dasharray="3 3" opacity="0"/>' +
      '<circle class="opbcHl" r="6" fill="' + color + '" stroke="#11141c" stroke-width="3" opacity="0"/>' +
      '<g class="opbcTip" opacity="0" pointer-events="none">' +
      '<rect class="opbcTipBg" rx="7" width="168" height="46"/>' +
      '<text class="opbcTipD" x="10" y="18"></text><text class="opbcTipV" x="10" y="36"></text></g>' +
      xl +
      '<rect class="opbcHit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent"/>' +
      "</svg></figure>";
  }

  // ── 공급 패널: 지금 eBay 에 올라와 있는 밀봉 박스가 몇 개인가.
  //
  // 가격만 보면 시장을 반만 읽는다. 매물이 늘면서 가격이 버티는 것과 매물이 마르면서 오르는 것은
  // 완전히 다른 신호다. 일본판·영문판 개수는 자릿수가 같아(보통 15~30) 한 축에 같이 놓을 수 있다.
  //
  // ⚠️ 이건 "팔린 개수"가 아니라 "올라와 있는 개수"다. 목록에서 사라진 건 판매·취소·만료를
  //    구분할 수 없어 절대 거래량으로 부르지 않는다(update-supply-series.js 원칙 1).
  //
  // 기간이 가격 그래프보다 짧다(수집을 늦게 시작했다). 그래서 같은 축에 겹치지 않고 따로 그린다 —
  // 겹치면 왼쪽 3/4 가 텅 빈 채로 "공급 데이터가 없다"처럼 보인다.
  const SUP_H = 190, SUP_B = 34, SUP_T = 22;
  function supplyPanel(points, lang) {
    const pts = (points || []).filter((p) => p && p.d && (Number.isFinite(p.jp) || Number.isFinite(p.en)));
    if (pts.length < MIN_POINTS) return "";

    const vals = [];
    for (const p of pts) { if (Number.isFinite(p.jp)) vals.push(p.jp); if (Number.isFinite(p.en)) vals.push(p.en); }
    const vMax = Math.max.apply(null, vals), vMin = Math.min.apply(null, vals);
    // 0 부터 그렸더니 19~24 짜리 변동이 축의 위쪽 20% 에 눌려 아무것도 안 보였다(2026-08-13 실측).
    // 가격 패널과 같은 방식으로 실제 범위에 맞춘다. 축에 개수가 그대로 찍히므로 오독 위험은 낮다.
    const pad = Math.max((vMax - vMin) * 0.35, 1);
    const yMax = vMax + pad, yMin = Math.max(0, vMin - pad);
    const t0 = Date.parse(pts[0].d), t1 = Date.parse(pts[pts.length - 1].d);
    const span = t1 - t0 || 1;
    const px = (p) => L + ((Date.parse(p.d) - t0) / span) * (W - L - R);
    const py = (v) => SUP_T + (1 - (v - yMin) / (yMax - yMin)) * (SUP_H - SUP_T - SUP_B);

    // 눈금 3개를 요구하면 범위 18~28 에서 10 단위가 뽑혀 20/30 둘만 남는다. 4개로 요구해 5 단위를 얻는다.
    let ticks = niceTicks(yMin, yMax, 4);
    if (ticks.length < 3) ticks = niceTicks(yMin, yMax, 6);
    const grid = ticks.map((v) =>
      '<line class="opbcGrid" x1="' + L + '" y1="' + py(v).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(v).toFixed(1) + '"/>' +
      '<text class="opbcAx" x="' + (L - 10) + '" y="' + (py(v) + 4).toFixed(1) + '" text-anchor="end">' + v + "</text>").join("");

    const drawLine = (key, color) => {
      const XY = pts.filter((p) => Number.isFinite(p[key])).map((p) => ({ x: px(p), y: py(p[key]) }));
      if (XY.length < 2) return "";
      return '<path class="opbcLine opbcSupLine" d="' + smoothPath(XY) + '" stroke="' + color + '"/>' +
        '<circle cx="' + XY[XY.length - 1].x.toFixed(1) + '" cy="' + XY[XY.length - 1].y.toFixed(1) +
        '" r="4" fill="' + color + '"/>';
    };

    const hits = pts.map((p) =>
      '<circle class="opbcHitDot" cx="' + px(p).toFixed(1) + '" cy="' + (SUP_H - SUP_B) / 2 + '" r="10" fill="transparent">' +
      "<title>" + p.d + " · " + (lang === "ko" ? "일본판 " : "Japanese ") + (p.jp == null ? "-" : p.jp) +
      " · " + (lang === "ko" ? "영문판 " : "English ") + (p.en == null ? "-" : p.en) + "</title></circle>").join("");

    const xl = [pts[0], pts[pts.length - 1]].map((p, i) =>
      '<text class="opbcAx" x="' + px(p).toFixed(1) + '" y="' + (SUP_H - 10) + '" text-anchor="' +
      (i === 0 ? "start" : "end") + '">' + md(p.d) + "</text>").join("");

    const lastP = pts[pts.length - 1];
    const firstP = pts[0];
    const delta = (key) => {
      if (!Number.isFinite(firstP[key]) || !Number.isFinite(lastP[key])) return "";
      const d = lastP[key] - firstP[key];
      return d === 0 ? " ±0" : (d > 0 ? " +" : " ") + d;
    };
    const title = lang === "ko" ? "지금 올라와 있는 매물" : "Listings on sale now";
    const legend = '<span class="opbcLeg"><i style="background:' + JP_COLOR + '"></i>' +
      (lang === "ko" ? "일본판 " : "JP ") + (lastP.jp == null ? "-" : lastP.jp) + delta("jp") + "</span>" +
      '<span class="opbcLeg"><i style="background:' + EN_COLOR + '"></i>' +
      (lang === "ko" ? "영문판 " : "EN ") + (lastP.en == null ? "-" : lastP.en) + delta("en") + "</span>";

    return '<figure class="opbcPane opbcSupply">' +
      '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(title) + "</span>" + legend +
      '<span class="opbcSpan">' + md(firstP.d) + " – " + md(lastP.d) + "</span></figcaption>" +
      '<svg viewBox="0 0 ' + W + " " + SUP_H + '" role="img" aria-label="' + esc(title) + '">' +
      grid + drawLine("jp", JP_COLOR) + drawLine("en", EN_COLOR) + hits + xl + "</svg></figure>";
  }

  // 그릴 만한 데이터가 있는지 — 호출부가 빈 상자를 띄우지 않도록 먼저 물어본다.
  function hasChart(series) {
    if (!series) return false;
    const m = series.monthly || {};
    return clean(series.jp).length >= MIN_POINTS || clean(series.en).length >= MIN_POINTS ||
      clean(m.jp).length >= MIN_POINTS || clean(m.en).length >= MIN_POINTS;
  }

  // series: {jp:[{d,median,low,high,n}], en:[...], windowDays:{jp,en}, monthly:{jp:[],en:[]}}
  // opts: {lang:"ko"|"en", title, note}
  //
  // 주간·월간 두 벌을 **둘 다 서버에서 그려** 내보내고 버튼으로 바꿔 보인다.
  // 눌렀을 때 새로 그리지 않으니 JS 가 없어도 주간은 그대로 읽히고, 전환도 즉시 끝난다.
  function chartHTML(series, opts) {
    opts = opts || {};
    const lang = opts.lang === "en" ? "en" : "ko";
    if (!hasChart(series)) return "";
    const wd = (series && series.windowDays) || {};
    const mo = (series && series.monthly) || {};

    // 표본이 얇아 못 그리는 판은 자리를 비우지 않고 왜 없는지 한 줄로 알린다.
    // 월간을 눌렀는데 한쪽 패널이 소리 없이 사라지면 "고장났나" 로 읽힌다 — 실제로는 그 세트가
    // 그 판으로 한 달에 몇 개 안 팔린다는 뜻이고, 그건 알 만한 정보다.
    const missing = (label, g) => '<figure class="opbcPane opbcPaneEmpty"><figcaption class="opbcHead">' +
      '<span class="opbcLabel">' + esc(label) + "</span></figcaption>" +
      '<p class="opbcEmpty">' + (g === "month"
        ? (lang === "ko" ? "월간은 아직 표본이 얇습니다 — 주간으로 보세요." : "Not enough sales per month yet — use the weekly view.")
        : (lang === "ko" ? "즉시구매 실거래가 아직 얇습니다." : "Not enough fixed-price sales yet."))
      + "</p></figure>";

    const grid = (g, jpPts, enPts, hidden) => {
      const jpLabel = lang === "ko" ? "일본판" : "Japanese";
      const enLabel = lang === "ko" ? "영문판" : "English";
      let jp = panel(jpPts, jpLabel, JP_COLOR, "opbcJp" + g, lang, g === "week" ? wd.jp : null, g);
      let en = panel(enPts, enLabel, EN_COLOR, "opbcEn" + g, lang, g === "week" ? wd.en : null, g);
      if (!jp && !en) return "";
      // 한쪽 판이 소리 없이 사라지면 "고장났나" 로 읽힌다. 왜 없는지 한 줄로 알린다.
      // 주간은 원장에 그 판 기록이 있으면(=파는 세트면) 자리를 지키고,
      // 월간은 주간에 있는 판이면 자리를 지킨다.
      // 판단 기준은 둘 다 같다: 그 판의 기록이 조금이라도 있으면(=파는 세트면) 자리를 지킨다.
      // 주간과 월간이 서로 다른 기준을 쓰면 탭을 오갈 때 패널이 하나씩 생겼다 사라진다.
      const hasAny = (arr) => ((arr || []).length > 0);
      if (!jp && hasAny(series && series.jp)) jp = missing(jpLabel, g);
      if (!en && hasAny(series && series.en)) en = missing(enLabel, g);
      return '<div class="opbcGridWrap" data-grain="' + g + '"' + (hidden ? " hidden" : "") + ">" + jp + en + "</div>";
    };

    const week = grid("week", series && series.jp, series && series.en, false);
    const month = grid("month", mo.jp, mo.en, true);
    // 월간이 없으면(표본이 얇은 세트) 버튼도 내보내지 않는다 — 눌러도 아무 일 없는 버튼은 두지 않는다.
    const tabs = month
      ? '<div class="opbcTabs" role="group" aria-label="' + (lang === "ko" ? "집계 단위" : "Time grain") + '">' +
        '<button type="button" class="opbcTab on" data-grain="week" aria-pressed="true">' + (lang === "ko" ? "주간" : "Weekly") + "</button>" +
        '<button type="button" class="opbcTab" data-grain="month" aria-pressed="false">' + (lang === "ko" ? "월간" : "Monthly") + "</button></div>"
      : "";

    const head = opts.title || tabs
      ? '<div class="opbcTop">' + (opts.title ? '<div class="opbcTitle">' + esc(opts.title) + "</div>" : "<span></span>") + tabs + "</div>"
      : "";
    const note = opts.note === false ? "" : '<p class="opbcNote">' + (lang === "ko"
      ? "선은 우리가 직접 모은 eBay <b>실거래(sold)</b> 중앙값이며, <b>판매된 날</b> 기준입니다. 주간은 거래가 드문 세트일수록 평균 구간을 길게 잡고(위에 표시), 월간은 그 달에 팔린 것 전부를 묶습니다. 표본이 얇은 구간은 그리지 않습니다."
      : "The line is the median of <b>completed eBay sales</b> we collect ourselves, plotted by <b>date of sale</b>. The weekly view widens its averaging window for thinly traded sets (shown above); the monthly view groups every sale within a calendar month. Thin periods are left blank rather than estimated.")
      + "</p>";
    // 공급은 집계 단위(주간·월간)와 무관하다 — 매일 세는 "지금 몇 개"라서 탭 밖에 둔다.
    const supply = supplyPanel(series && series.supply, lang);
    // 고지는 패널 **위**에 둔다. 아래 두면 다 보고 나서야 "이건 팔린 개수가 아니다"를 읽게 된다.
    const supNote = supply ? '<p class="opbcNote opbcSupNote">' + (lang === "ko"
      ? "<b>지금 올라와 있는 매물 수</b>입니다 — 팔린 개수가 아닙니다."
      : "Counts <b>listings currently on sale</b> — not units sold.") + "</p>" : "";
    const supWrap = supply ? '<div class="opbcGridWrap opbcSupWrap">' + supNote + supply + "</div>" : "";
    return '<div class="opbcWrap">' + head + week + month + note + supWrap + "</div>";
  }

  const CSS = [
    ".opbcWrap{margin:16px 0 4px}",
    ".opbcTop{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:760px;margin:0 0 10px}",
    ".opbcTitle{font-size:12px;font-weight:700;color:var(--muted,#8d95a7);letter-spacing:.02em}",
    ".opbcTabs{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--line,#242936);border-radius:9px;background:var(--paper,#11141c)}",
    ".opbcTab{appearance:none;border:0;background:transparent;color:var(--muted,#8d95a7);font:inherit;font-size:12px;font-weight:700;padding:5px 12px;border-radius:7px;cursor:pointer}",
    ".opbcTab:hover{color:var(--ink,#eef2ff)}",
    ".opbcTab.on{background:rgba(16,215,160,.14);color:#10d7a0}",
    ".opbcTab:focus-visible{outline:2px solid #10d7a0;outline-offset:1px}",
    // 두 칸으로 나누지 않는다. 본문 폭이 800px 남짓이라 반으로 쪼개면 차트가 눌려
    // 세로 움직임이 안 보인다(2026-08-13 실측). 세로로 쌓으면 각 차트가 본문 폭을 다 쓴다.
    // 폭 상한을 두는 이유: SVG 가 viewBox 비율을 지키느라 폭이 넓어질수록 세로도 같이 커진다.
    // 홈(본문 1100px 남짓)에서는 차트 하나가 화면을 통째로 덮었다. 상한을 걸면 세트 페이지와 크기도 같아진다.
    ".opbcGridWrap{display:grid;gap:14px;max-width:760px}",
    // display:grid 가 브라우저 기본 [hidden]{display:none} 을 이겨서, 숨겼는데 그대로 보였다(2026-08-13).
    ".opbcGridWrap[hidden]{display:none}",
    ".opbcPane{margin:0;border:1px solid var(--line,#242936);border-radius:14px;background:var(--paper,#11141c);padding:14px 16px 8px;min-width:0}",
    ".opbcHead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
    ".opbcLabel{font-size:12px;font-weight:700;color:var(--muted,#8d95a7)}",
    ".opbcNow{font-size:26px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--ink,#eef2ff)}",
    ".opbcChg{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums}",
    ".opbcChg.up{color:#10d7a0}.opbcChg.dn{color:#e5484d}",
    ".opbcSpan{margin-left:auto;font-size:11px;color:var(--muted,#8d95a7);font-variant-numeric:tabular-nums}",
    ".opbcSupWrap{margin-top:16px}",
    ".opbcSupNote{margin:0 0 8px}",
    ".opbcLeg{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--ink,#eef2ff);font-variant-numeric:tabular-nums}",
    ".opbcLeg i{width:9px;height:9px;border-radius:2px;display:inline-block}",
    ".opbcSupLine{stroke-width:2}",
    ".opbcPane svg{width:100%;height:auto;display:block;margin-top:4px;touch-action:pan-y}",
    ".opbcGrid{stroke:rgba(255,255,255,.055);stroke-width:1}",
    ".opbcAx{fill:var(--muted,#8d95a7);font-size:11px;font-variant-numeric:tabular-nums}",
    ".opbcLine{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}",
    ".opbcDot{stroke:var(--paper,#11141c);stroke-width:1.6}",
    ".opbcBar{opacity:.34;rx:1}",
    ".opbcVolAx{font-size:10px;opacity:.8}",
    ".opbcHitDot{cursor:pointer}.opbcHit{cursor:crosshair}",
    ".opbcTipBg{fill:#151a22;stroke:rgba(255,255,255,.16)}",
    ".opbcTipD{fill:var(--muted,#8d95a7);font-size:11px;font-variant-numeric:tabular-nums}",
    ".opbcTipV{fill:var(--ink,#eef2ff);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}",
    ".opbcPaneEmpty{display:flex;flex-direction:column;justify-content:center;min-height:96px;padding:14px 16px}",
    ".opbcEmpty{margin:6px 0 0;font-size:12.5px;color:var(--muted,#8d95a7)}",
    ".opbcNote{font-size:11.5px;color:var(--muted,#8d95a7);line-height:1.7;margin:10px 0 0}",
    ".opbcNote b{color:var(--ink,#eef2ff);font-weight:700}",
  ].join("");

  // 마우스/터치로 훑을 때 값을 띄우는 향상 기능. 정적 세트 페이지도 이 파일을 <script> 로 불러
  // 같은 코드를 쓴다 — 페이지마다 문자열로 박아 넣으면 두 벌이 되어 언젠가 갈라진다.
  // 서버가 이미 SVG 를 다 그려 보내므로, 이게 안 돌아도 그래프와 숫자는 그대로 읽힌다.
  function bindPane(pane) {
    if (pane.__opbcBound) return;
    pane.__opbcBound = 1;
    const svg = pane.querySelector("svg");
    if (!svg) return;
    const hit = svg.querySelector(".opbcHit"), cross = svg.querySelector(".opbcCross"), hl = svg.querySelector(".opbcHl");
    const tip = svg.querySelector(".opbcTip"), tipD = svg.querySelector(".opbcTipD"), tipV = svg.querySelector(".opbcTipV");
    const dots = [].slice.call(svg.querySelectorAll(".opbcDot"));
    const titles = [].slice.call(svg.querySelectorAll(".opbcHitDot title")).map((t) => t.textContent);
    if (!hit || !dots.length) return;

    function at(clientX) {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * W;
      let best = 0, bd = Infinity;
      dots.forEach((d, i) => { const dd = Math.abs(+d.getAttribute("cx") - x); if (dd < bd) { bd = dd; best = i; } });
      const d = dots[best], cx = +d.getAttribute("cx"), cy = +d.getAttribute("cy");
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("opacity", ".5");
      hl.setAttribute("cx", cx); hl.setAttribute("cy", cy); hl.setAttribute("opacity", "1");
      // 헤드라인(현재가)은 건드리지 않는다 — 훑을 때마다 바뀌면 "지금 얼마"를 잃는다.
      // 문구는 <title> 에서 그대로 뽑는다: "2026-08-02 · $261 (범위 $209–$295 · 27건)"
      const raw = titles[best] || "", parts = raw.split(" · ");
      const tw = 168, tx = Math.min(Math.max(cx - tw / 2, 4), W - tw - 4);
      const ty = cy - 58 < T ? cy + 14 : cy - 58;
      tip.setAttribute("opacity", "1");
      tip.setAttribute("transform", "translate(" + tx + "," + ty + ")");
      const nWord = (raw.match(/\d+(?:건| sales)/) || [""])[0];
      tipD.textContent = parts[0] || "";
      tipV.textContent = (parts[1] || "").replace(/\s*\(.*$/, "") + (nWord ? "  ·  " + nWord : "");
    }
    const off = () => {
      cross.setAttribute("opacity", "0"); hl.setAttribute("opacity", "0"); tip.setAttribute("opacity", "0");
    };
    hit.addEventListener("pointerdown", (e) => { try { hit.setPointerCapture(e.pointerId); } catch (_) { /* 캡처 못 해도 값은 뜬다 */ } at(e.clientX); });
    hit.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) at(e.clientX); });
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("pointercancel", off);
  }

  // 이미 걸린 패널은 건너뛰므로 몇 번을 불러도 안전하다(홈은 세트를 열 때마다 다시 부른다).
  function bindTabs(wrap) {
    if (wrap.__opbcTabs) return;
    wrap.__opbcTabs = 1;
    const tabs = [].slice.call(wrap.querySelectorAll(".opbcTab"));
    const grids = [].slice.call(wrap.querySelectorAll(".opbcGridWrap"));
    if (!tabs.length || grids.length < 2) return;
    tabs.forEach((btn) => btn.addEventListener("click", () => {
      const g = btn.dataset.grain;
      tabs.forEach((b) => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      grids.forEach((gr) => { gr.hidden = gr.dataset.grain !== g; });
      // 숨어 있던 쪽은 아직 훑기 이벤트가 안 걸렸을 수 있다.
      [].slice.call(wrap.querySelectorAll(".opbcPane")).forEach(bindPane);
    }));
  }

  function scrub(root) {
    const scope = root && root.querySelectorAll ? root : (typeof document !== "undefined" ? document : null);
    if (!scope) return;
    [].slice.call(scope.querySelectorAll(".opbcPane")).forEach(bindPane);
    [].slice.call(scope.querySelectorAll(".opbcWrap")).forEach(bindTabs);
  }

  // 브라우저에서 이 파일을 읽으면 스타일도 스스로 넣는다.
  // styles.css 에 복사해 두면 두 벌이 되어 언젠가 갈라진다 — 규칙은 이 파일에만 둔다.
  if (typeof document !== "undefined" && !document.getElementById("opBoxChartCss")) {
    const st = document.createElement("style");
    st.id = "opBoxChartCss";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scrub());
    else scrub();
    if (typeof window !== "undefined") window.OPBoxChartScrub = scrub;
  }

  return { chartHTML, hasChart, CSS, scrub, MIN_N, MIN_POINTS, clean, niceTicks, smoothPath };
});
