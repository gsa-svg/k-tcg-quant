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
  const MIN_N_DAY = 3;    // 일별은 빌더가 이미 하루 3건 이상만 내보낸다 — 여기서 또 5건을 요구하면 통째로 빈다
  const MIN_POINTS = 3;        // 점 두 개짜리 "추세"는 추세가 아니다
  // 월간만 예외로 2점을 허용한다. 한 점이 9~15건짜리 두꺼운 표본이라 "6월 → 7월" 두 점도 읽을 값이 있고,
  // 3점을 요구하면 거래가 얇은 세트(OP-03·EB-01)에서 월간 패널이 통째로 빠져
  // [주간|월간] 탭까지 사라진다 — 다른 세트엔 있는 탭이 여기만 없으면 고장으로 읽힌다.
  const MIN_POINTS_MONTH = 2;

  const JP_COLOR = "#10d7a0";
  const EN_COLOR = "#5a9bf6";
  // 초판(Blue Bottom)은 재판과 다른 상품이라 선 색도 나눈다. 파랑끼리 두면 구분이 안 된다.
  const BLUE_COLOR = "#c9a227";

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

  // minN 을 넘겨 받으면 그걸 쓴다 — 일별은 애초에 하루 3건 이상인 날만 빌더가 내보내므로
  // 여기서 5건을 다시 요구하면 일간 보기가 통째로 비어버린다.
  function clean(points, minN) {
    const floor = Number.isFinite(minN) ? minN : MIN_N;
    return (points || [])
      .filter((p) => p && p.d && Number.isFinite(Number(p.median)) && Number(p.median) > 0 && Number(p.n || 0) >= floor)
      .map((p) => ({ d: p.d, median: Number(p.median), low: Number(p.low || p.median), high: Number(p.high || p.median), n: Number(p.n), vol: Number.isFinite(Number(p.vol)) ? Number(p.vol) : null }))
      .sort((a, b) => a.d.localeCompare(b.d));
  }

  const md = (d) => d.slice(5).replace("-", "/");
  // 월간 보기는 날짜가 매달 1일이라 "05/01" 로 찍으면 그날 하루로 오해된다. 달 이름으로 보여준다.
  const monthLabel = (d, lang) => (lang === "ko" ? Number(d.slice(5, 7)) + "월" : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(d.slice(5, 7)) - 1]);

  function panel(rawPts, label, color, gid, lang, windowDays, grain, badge, supplyPts, today, lastSaleD) {
    const pts = clean(rawPts, grain === "day" ? MIN_N_DAY : null);
    if (pts.length < (grain === "month" ? MIN_POINTS_MONTH : MIN_POINTS)) return "";
    // 2026-08-27 시각 개편(소유자 확정안): 가격축을 오른쪽으로 옮기고 현재가 플래그를 축에 꽂는다
    // (증권 차트 문법). 왼쪽 여백은 라벨이 사라지므로 좁힌다. 전역 L/R 은 공급 패널이 계속 쓰므로
    // 여기서만 지역 상수를 쓴다.
    const PL = 16, PR = 64;

    // y축은 중앙값 선 기준으로 잡는다 — low~high 전체로 잡으면 선이 축의 5% 만 쓰고 납작해진다.
    // 다만 **최소 축 폭**을 둔다. 즉시구매만 남기고 나니 OP-01 일본판이 3개월 내내 1% 안에서
    // 움직였는데, 축을 그 폭에 맞추니 $286~$289 짜리 흔들림이 화면을 가득 채워 큰 변동처럼 보였다.
    // 축이 값의 최소 8% 는 담게 하면, 조용한 세트는 조용해 보이고 실제로 움직인 세트만 크게 보인다.
    const meds = pts.map((p) => p.median);
    const mLo = Math.min.apply(null, meds), mHi = Math.max.apply(null, meds);
    const yMid = (mHi + mLo) / 2;
    const ySpan = Math.max((mHi - mLo) * 1.6, yMid * 0.08);
    const yMin = yMid - ySpan / 2, yMax = yMid + ySpan / 2;

    const tLast = Date.parse(pts[pts.length - 1].d);
    const t0 = Date.parse(pts[0].d);
    // 축을 마지막 거래일이 아니라 오늘(또는 더 늦은 공급 관측)까지 연다.
    // 그래야 거래가 끊긴 구간이 빈칸으로 드러난다 — 선이 끝나는 곳이 축 끝이면
    // 11일째 멈춘 값도 "최신"처럼 보인다.
    const supArr = (supplyPts || []).filter((p) => p && p.v != null && Date.parse(p.d) >= t0);
    const tSup = supArr.length ? Date.parse(supArr[supArr.length - 1].d) : 0;
    const tNow = today ? Date.parse(today) : 0;
    const t1 = Math.max(tLast, tSup, tNow);
    const span = t1 - t0 || 1;
    const px = (p) => PL + ((Date.parse(p.d) - t0) / span) * (W - PL - PR);
    const py = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (PRICE_BOTTOM - T);

    const XY = pts.map((p) => ({ x: px(p), y: py(p.median) }));
    const line = smoothPath(XY);
    const area = line + " L" + XY[XY.length - 1].x.toFixed(1) + " " + PRICE_BOTTOM +
      " L" + XY[0].x.toFixed(1) + " " + PRICE_BOTTOM + " Z";

    let ticks = niceTicks(yMin, yMax, 4);
    if (ticks.length < 3) ticks = niceTicks(yMin, yMax, 7);
    // 마지막 값과 겹치는 눈금 라벨은 지운다 — 현재가 플래그가 그 자리에 앉는다.
    const lastY = py(pts[pts.length - 1].median);
    const grid = ticks.map((v) =>
      '<line class="opbcGrid" x1="' + PL + '" y1="' + py(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + py(v).toFixed(1) + '"/>' +
      (Math.abs(py(v) - lastY) < 16 ? "" :
        '<text class="opbcAx" x="' + (W - PR + 8) + '" y="' + (py(v) + 4).toFixed(1) + '">' + money(v) + "</text>")).join("");

    // x 라벨은 처음·중간·끝 3개만 — 더 넣으면 축이 데이터보다 시끄러워진다.
    const mid = pts[Math.floor(pts.length / 2)];
    const lab = (p) => (grain === "month" ? monthLabel(p.d, lang) : md(p.d));
    const grainWord = grain === "month" ? (lang === "ko" ? "월별" : "monthly")
      : grain === "day" ? (lang === "ko" ? "일별" : "daily") : null;
    // 점이 3개 미만이면 중간 라벨이 끝 라벨과 같은 점을 가리킨다 — 월간 2개월치가 "Jun Jul Jul" 로 나왔다.
    const xPts = pts.length >= 3 ? [pts[0], mid, pts[pts.length - 1]] : [pts[0], null, pts[pts.length - 1]];
    const xl = xPts.filter(Boolean).map((p) => p).map((p, i, arr) =>
      '<text class="opbcAx" x="' + px(p).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="' +
      (i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle") + '">' + lab(p) + "</text>").join("");

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
    // 거래량 막대는 전 구간 대비 중앙값 방향으로 칠한다(상승=초록·하락=적·보합=회색).
    // 주식 차트의 거래량 문법 — 색이 "그 주에 가격이 어느 쪽으로 갔나"를 겹쳐 준다.
    const bars = pts.map((p, i) => {
      const v = p.vol == null ? 0 : p.vol;
      if (!v) return "";
      const h = Math.max(2, (v / volMax) * (VOL_H - 8));
      const dir = i === 0 ? 0 : p.median - pts[i - 1].median;
      const bc = dir > 0 ? "#10d7a0" : dir < 0 ? "#e5484d" : "#3a4152";
      return '<rect class="opbcBar" x="' + (XY[i].x - bw / 2).toFixed(1) + '" y="' + (H - B - h).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + bc +
        '" opacity="' + (dir === 0 ? ".3" : ".55") + '"/>';
    }).join("");
    const volLabel = lang === "ko" ? "거래량" : "Sales";   // 툴팁 문구용. 축에는 쓰지 않는다 — 아래 범례가 이름을 댄다.
    const volAxis = '<line class="opbcGrid" x1="' + PL + '" y1="' + (H - B) + '" x2="' + (W - PR) + '" y2="' + (H - B) + '"/>';

    // ── 매물수 겹쳐그리기는 2026-08-27 소유자 확정으로 제거 — 회색 점선이 가격선과 엉켜
    //    "이게 무슨 그래프인지 모르겠다"는 피드백. 매물수는 아래 전용 공급 패널이 담당한다.

    // ── 거래가 끊긴 구간. 억지로 선을 이어 그리면 없는 거래를 만드는 셈이라 칠하고 이름을 붙인다.
    let staleLayer = "", staleBadge = "";
    if (t1 > tLast + 86400000 * 2) {
      const gx0 = px({ d: pts[pts.length - 1].d }), gx1 = W - PR;
      const tSale = lastSaleD ? Date.parse(lastSaleD) : tLast;
      const days = Math.round((t1 - tSale) / 86400000);
      staleLayer =
        '<rect class="opbcStale" x="' + gx0.toFixed(1) + '" y="' + T + '" width="' + (gx1 - gx0).toFixed(1) +
        '" height="' + (PRICE_BOTTOM - T) + '"/>' +
        '<line class="opbcStaleEdge" x1="' + gx0.toFixed(1) + '" y1="' + T + '" x2="' + gx0.toFixed(1) + '" y2="' + PRICE_BOTTOM + '"/>' +
        (gx1 - gx0 > 70 ? '<text class="opbcStaleTx" x="' + ((gx0 + gx1) / 2).toFixed(1) + '" y="' + (T + 14) +
          '" text-anchor="middle">' + (lang === "ko" ? "거래 없음" : "no sales") + "</text>" : "");
      staleBadge = lang === "ko" ? days + "일째 거래 없음" : days + "d since last sale";
    }

    // 계열 이름표. 거래량은 색이 방향을 뜻하므로 두 색을 같이 보여준다.
    const kPrice = lang === "ko" ? "가격" : "Price";
    const kVol = lang === "ko" ? "거래량 (상승·하락)" : "Sales (up · down)";
    const keyRow = '<div class="opbcKey">' +
      '<span><i class="kLine" style="background:' + color + '"></i>' + kPrice + "</span>" +
      '<span><i class="kBar" style="background:#10d7a0"></i><i class="kBar" style="background:#e5484d"></i>' + kVol + "</span>" +
      "</div>";

    // 점은 마지막 것만 보인다 — 선 위 점들이 시각 소음이라는 확정안. 좌표는 스크럽 JS 가
    // 스냅용으로 계속 쓰므로 요소 자체는 남기고 투명 처리한다.
    const dots = pts.map((p, i) =>
      '<circle class="opbcDot" cx="' + XY[i].x.toFixed(1) + '" cy="' + XY[i].y.toFixed(1) +
      '" r="' + (i === pts.length - 1 ? 4.5 : 3) + '" fill="' + color + '"' +
      (i === pts.length - 1 ? "" : ' opacity="0"') + "/>").join("");

    // JS 가 안 돌거나 막힌 환경(일부 인앱 브라우저·미리보기)에서도 숫자가 읽혀야 한다.
    // 넉넉한 투명 원 + <title> 이면 브라우저 기본 툴팁으로 값이 나온다. 아래 스크럽 JS 는 그 위에 얹는 향상일 뿐이다.
    // 툴팁 문구를 data-* 로 싣는다 — 종전엔 <title> 문자열을 스크럽 JS 가 다시 쪼갰는데
    // 그 파싱이 언어·형식이 바뀔 때마다 깨질 자리였다. <title> 은 무JS 폴백으로 유지.
    const hits = pts.map((p, i) =>
      '<circle class="opbcHitDot" cx="' + XY[i].x.toFixed(1) + '" cy="' + XY[i].y.toFixed(1) + '" r="14" fill="transparent"' +
      ' data-d="' + (grain === "month" ? p.d.slice(0, 7) : p.d) + '" data-v="' + money(p.median) +
      '" data-r="' + rangeWord + " " + money(p.low) + "–" + money(p.high) +
      '" data-n="' + p.n + sampleWord + (p.vol == null || p.vol === p.n ? "" : " · " + volLabel + " " + p.vol + (lang === "ko" ? "건" : "")) +
      '" data-x="' + md(p.d) + '">' +
      "<title>" + (grain === "month" ? p.d.slice(0, 7) : p.d) + " · " + money(p.median) +
      " (" + rangeWord + " " + money(p.low) + "–" + money(p.high) +
      " · " + p.n + sampleWord + (p.vol == null || p.vol === p.n ? "" : " · " + volLabel + " " + p.vol +
        (lang === "ko" ? "건" : "")) + ")</title></circle>").join("");

    // ── 새 시각 요소(2026-08-27 확정안): 현재가 플래그·고점/저점 라벨.
    const flagY = py(last.median);
    const flagTx = money(last.median);
    const flag =
      '<line x1="' + PL + '" y1="' + flagY.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + flagY.toFixed(1) +
      '" stroke="' + color + '" stroke-dasharray="2 4" opacity=".45"/>' +
      '<g><rect x="' + (W - PR + 3) + '" y="' + (flagY - 11).toFixed(1) + '" width="' + (PR - 8) + '" height="22" rx="5" fill="' + color + '"/>' +
      '<text x="' + (W - PR + 3 + (PR - 8) / 2) + '" y="' + (flagY + 4).toFixed(1) +
      '" text-anchor="middle" font-size="12" font-weight="800" fill="#0a0f14">' + flagTx + "</text></g>";
    const hiWord = lang === "ko" ? "고점 " : "High ";
    const loWord = lang === "ko" ? "저점 " : "Low ";
    const clampX = (x) => Math.max(PL + 36, Math.min(W - PR - 36, x));
    const hiI = meds.indexOf(mHi), loI = meds.indexOf(mLo);
    const hlLabels =
      (hiI === pts.length - 1 ? "" : '<text class="opbcAx" x="' + clampX(XY[hiI].x).toFixed(1) + '" y="' + (py(mHi) - 9).toFixed(1) +
        '" text-anchor="middle" fill="#b6c0d4">' + hiWord + money(mHi) + "</text>") +
      (loI === pts.length - 1 || loI === hiI ? "" : '<text class="opbcAx" x="' + clampX(XY[loI].x).toFixed(1) + '" y="' + (py(mLo) + 17).toFixed(1) +
        '" text-anchor="middle" fill="#b6c0d4">' + loWord + money(mLo) + "</text>");

    return '<figure class="opbcPane" data-ed="' + gid + '">' +
      '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(label) + "</span>" +
      (badge ? '<span class="opbcBadge">' + esc(badge) + "</span>" : "") +
      '<span class="opbcNow">' + money(last.median) + "</span>" +
      '<span class="opbcChg ' + (up ? "up" : "dn") + '">' + (up ? "▲" : "▼") + " " + Math.abs(chg) + "%</span>" +
      '<span class="opbcSpan">' + lab(first) + " – " + lab(last) +
      (grainWord ? " · " + grainWord
        : windowDays ? " · " + windowDays + (lang === "ko" ? "일 평균" : "-day avg") : "") +
      " · n=" + last.n + "</span>" +
      (staleBadge ? '<span class="opbcStaleBadge">' + staleBadge + "</span>" : "") + "</figcaption>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + " " +
      esc(lang === "ko" ? "박스 실거래 중앙값 추이" : "sealed box median sold price over time") + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity=".30"/>' +
      '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      staleLayer + grid + volAxis + bars +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path class="opbcLine" d="' + line + '" stroke="' + color + '"/>' +
      hlLabels + flag + dots +
      '<circle cx="' + XY[XY.length - 1].x.toFixed(1) + '" cy="' + XY[XY.length - 1].y.toFixed(1) +
      '" r="11" fill="' + color + '" opacity=".18"/>' +
      hits +
      '<line class="opbcCross" y1="' + T + '" y2="' + (H - B) + '" stroke="' + color + '" stroke-dasharray="3 3" opacity="0"/>' +
      '<g class="opbcDateTag" opacity="0" pointer-events="none"><rect width="46" height="18" rx="4" fill="#242936"/>' +
      '<text class="opbcAx" x="23" y="13" text-anchor="middle" fill="#cfd6e4"></text></g>' +
      '<circle class="opbcHl" r="6" fill="' + color + '" stroke="#11141c" stroke-width="3" opacity="0"/>' +
      '<g class="opbcTip" opacity="0" pointer-events="none">' +
      '<rect class="opbcTipBg" rx="7" width="186" height="62"/>' +
      '<text class="opbcTipD" x="10" y="17"></text><text class="opbcTipV" x="10" y="36"></text>' +
      '<text class="opbcTipR" x="10" y="53"></text></g>' +
      xl +
      '<rect class="opbcHit" x="' + PL + '" y="' + T + '" width="' + (W - PL - PR) + '" height="' + (H - T - B) + '" fill="transparent"/>' +
      "</svg>" + keyRow + "</figure>";
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

    // 훑기용 앵커. 가격 패널의 .opbcDot 자리를 대신한다 — 눈에 보이는 점은 아니지만
    // 같은 방식으로 "가장 가까운 x" 를 찾을 수 있게 한다. 값은 data 속성에 실어 보낸다.
    const jpWord = lang === "ko" ? "일본판" : "Japanese";
    const enWord = lang === "ko" ? "영문판" : "English";
    const anchors = pts.map((p) =>
      '<circle class="opbcSupDot" cx="' + px(p).toFixed(1) + '" cy="' + (SUP_H - SUP_B) / 2 + '" r="0" fill="none"' +
      ' data-d="' + p.d + '"' +
      ' data-jp="' + (p.jp == null ? "" : p.jp) + '" data-en="' + (p.en == null ? "" : p.en) + '"' +
      ' data-jpy="' + (p.jp == null ? "" : py(p.jp).toFixed(1)) + '" data-eny="' + (p.en == null ? "" : py(p.en).toFixed(1)) + '"/>').join("");

    // JS 가 안 돌아도 값이 읽히도록 기본 툴팁도 남긴다.
    const hits = pts.map((p) =>
      '<circle class="opbcHitDot" cx="' + px(p).toFixed(1) + '" cy="' + (SUP_H - SUP_B) / 2 + '" r="10" fill="transparent">' +
      "<title>" + p.d + " · " + jpWord + " " + (p.jp == null ? "-" : p.jp) +
      " · " + enWord + " " + (p.en == null ? "-" : p.en) + "</title></circle>").join("");

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

    return '<figure class="opbcPane opbcSupply" data-jpword="' + esc(jpWord) + '" data-enword="' + esc(enWord) + '">' +
      '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(title) + "</span>" + legend +
      '<span class="opbcSpan">' + md(firstP.d) + " – " + md(lastP.d) + "</span></figcaption>" +
      '<svg viewBox="0 0 ' + W + " " + SUP_H + '" role="img" aria-label="' + esc(title) + '">' +
      grid + drawLine("jp", JP_COLOR) + drawLine("en", EN_COLOR) + anchors + hits +
      '<line class="opbcCross" y1="' + SUP_T + '" y2="' + (SUP_H - SUP_B) + '" stroke="#8d95a7" stroke-dasharray="3 3" opacity="0"/>' +
      '<circle class="opbcHl opbcHlJp" r="5" fill="' + JP_COLOR + '" stroke="#11141c" stroke-width="3" opacity="0"/>' +
      '<circle class="opbcHl opbcHlEn" r="5" fill="' + EN_COLOR + '" stroke="#11141c" stroke-width="3" opacity="0"/>' +
      '<g class="opbcTip" opacity="0" pointer-events="none">' +
      '<rect class="opbcTipBg" rx="7" width="150" height="58"/>' +
      '<text class="opbcTipD" x="10" y="17"></text>' +
      '<text class="opbcTipV opbcTipJp" x="10" y="35"></text>' +
      '<text class="opbcTipV opbcTipEn" x="10" y="51"></text></g>' +
      xl +
      '<rect class="opbcHit" x="' + L + '" y="' + SUP_T + '" width="' + (W - L - R) + '" height="' + (SUP_H - SUP_T - SUP_B) + '" fill="transparent"/>' +
      "</svg></figure>";
  }

  // 선을 그릴 만큼은 아니지만 값이 있는 계열(초판처럼 몇 달에 몇 건)을 위한 카드.
  // 빈칸으로 두면 "없는 상품" 으로 읽힌다 — 실제로는 3배 비싼 별개 상품이 존재한다.
  function spotPane(rawPts, label, color, lang, note) {
    const pts = (rawPts || []).filter((p) => p && p.d && Number(p.median) > 0);
    if (!pts.length) return "";
    const last = pts[pts.length - 1];
    return '<figure class="opbcPane opbcPaneSpot">' +
      '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(label) + "</span>" +
      '<span class="opbcNow" style="color:' + color + '">' + money(last.median) + "</span>" +
      '<span class="opbcSpan">' + md(last.d) + " · n=" + last.n + "</span></figcaption>" +
      '<p class="opbcEmpty">' + esc(note) + "</p></figure>";
  }

  // 그릴 만한 데이터가 있는지 — 호출부가 빈 상자를 띄우지 않도록 먼저 물어본다.
  function hasChart(series) {
    if (!series) return false;
    const m = series.monthly || {};
    return clean(series.jp).length >= MIN_POINTS || clean(series.en).length >= MIN_POINTS ||
      clean(m.jp).length >= MIN_POINTS_MONTH || clean(m.en).length >= MIN_POINTS_MONTH;
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
    //
    // ⚠️ 안내는 **실제로 데이터가 있는 탭**을 가리켜야 한다 — 2026-08-26.
    //    종전엔 무조건 "주간으로 보세요"였는데, OP-17 일본판은 주간이 1점뿐이라 그것도 비고
    //    정작 일간에는 선이 있었다. 안내를 따라갔는데 막다른 곳이면 안내가 없느니만 못하다.
    const drawableGrain = (ed, g) => {
      const arr = g === "month" ? (mo[ed] || [])
        : g === "day" ? (((series && series.daily) || {})[ed] || [])
        : ((series && series[ed]) || []);
      return clean(arr, g === "day" ? MIN_N_DAY : null).length >= (g === "month" ? MIN_POINTS_MONTH : MIN_POINTS);
    };
    const grainName = (g) => (g === "day" ? (lang === "ko" ? "일간" : "the daily view")
      : g === "month" ? (lang === "ko" ? "월간" : "the monthly view")
      : (lang === "ko" ? "주간" : "the weekly view"));
    const missing = (label, g, ed) => {
      const alt = ["week", "day", "month"].find((x) => x !== g && drawableGrain(ed, x));
      const why = g === "month"
        ? (lang === "ko" ? "월간은 아직 표본이 얇습니다" : "Not enough sales per month yet")
        : g === "day"
        ? (lang === "ko" ? "하루에 3건 넘게 팔리는 날이 거의 없습니다" : "Rarely more than 3 sales on any single day")
        : (lang === "ko" ? "주간으로 그릴 만큼 쌓이지 않았습니다" : "Not enough weeks of sales to plot yet");
      const hint = alt
        ? (lang === "ko" ? " — " + grainName(alt) + "으로 보세요." : " — use " + grainName(alt) + ".")
        : (lang === "ko" ? " — 즉시구매 실거래가 아직 얇습니다." : " — fixed-price sales are still thin.");
      // 거대한 빈 상자로 두지 않는다 — "데이터가 아예 없나?"로 읽힌다(2026-08-28 소유자 지적).
      // 주간 최신값이 있으면 헤드라인으로 채워서, 이 판이 죽은 게 아니라 집계 단위만 다름을 보인다.
      const wk = clean((series && series[ed]) || []);
      const wkLast = wk.length ? wk[wk.length - 1] : null;
      const head = '<figcaption class="opbcHead"><span class="opbcLabel">' + esc(label) + "</span>" +
        (wkLast ? '<span class="opbcNow">' + money(wkLast.median) + "</span>" +
          '<span class="opbcSpan">' + (lang === "ko" ? "주간 기준 " : "weekly · ") + md(wkLast.d) + " · n=" + wkLast.n + "</span>" : "") +
        "</figcaption>";
      return '<figure class="opbcPane opbcPaneEmpty">' + head +
        '<p class="opbcEmpty">' + why + hint + "</p></figure>";
    };

    // 초판(Blue)은 시세가 2~3배라 선에서 빠져 있다. 남은 선이 재판 위주면 그렇다고 적는다 —
    // 안 적으면 어느 판본 시세를 보고 있는지 알 수 없다.
    const rp = (series && series.reprintPct) || {};
    const badgeFor = (ed) => (rp[ed] >= 60 ? (lang === "ko" ? "재판 White" : "reprint (White)") : null);

    // 공급 관측을 판본별로 갈라 각 패널에 넘긴다. 그날 기준 "지금 걸려 있는 매물 수"다.
    // 마지막으로 팔린 날. 뷰(일/주/월)와 무관하게 하나여야 한다 — 집계 단위가 사실을 바꾸지는 않는다.
    // 시리즈마다 커버 범위가 다르므로(OP-01 은 daily 가 06-13 한 점뿐, weekly 는 08-09 까지)
    // 가장 촘촘한 것이 아니라 가장 최근 것을 고른다.
    const lastSale = (() => {
      const out = {};
      for (const ed of ["jp", "en"]) {
        for (const src of [((series && series.daily) || {})[ed], series && series[ed]]) {
          const f = (src || []).filter((p) => p && p.median != null);
          if (!f.length) continue;
          const d = f[f.length - 1].d;
          if (!out[ed] || d > out[ed]) out[ed] = d;
        }
      }
      return out;
    })();
    const supRaw = (series && series.supply) || [];
    const supOf = (ed) => supRaw.map((p) => ({ d: p.d, v: p && p[ed] != null ? p[ed] : null })).filter((p) => p.v != null);
    const today = new Date().toISOString().slice(0, 10);

    const grid = (g, jpPts, enPts, hidden) => {
      const jpLabel = lang === "ko" ? "일본판" : "Japanese";
      const enLabel = lang === "ko" ? "영문판" : "English";
      let jp = panel(jpPts, jpLabel, JP_COLOR, "opbcJp" + g, lang, g === "week" ? wd.jp : null, g, badgeFor("jp"), supOf("jp"), today, lastSale.jp);
      let en = panel(enPts, enLabel, EN_COLOR, "opbcEn" + g, lang, g === "week" ? wd.en : null, g, badgeFor("en"), supOf("en"), today, lastSale.en);
      // 실제 선이 하나도 없는 단위는 탭 자체를 내지 않는다 — 2026-08-27 소유자 지적.
      // 종전엔 "왜 없는지" 안내 카드만 있는 빈 화면이 떴는데, 그건 고장으로 읽힌다.
      const realLine = !!(jp || en);
      // 한쪽 판이 소리 없이 사라지면 "고장났나" 로 읽힌다. 왜 없는지 한 줄로 알린다.
      // 기준은 단위마다 같다: 그 판의 기록이 조금이라도 있으면(=파는 세트면) 자리를 지킨다.
      // 서로 다른 기준을 쓰면 탭을 오갈 때 패널이 하나씩 생겼다 사라진다.
      //
      // 일간은 특히 그렇다 — 21세트 중 8개만 하루 3건을 넘긴다. 나머지 13개에서 탭을 통째로
      // 없애면 "이 세트만 일간이 없네" 가 되고, 세트를 옮길 때마다 탭 개수가 바뀐다.
      // 칸은 만들고 왜 못 그리는지 적는 편이 낫다.
      const hasAny = (arr) => ((arr || []).length > 0);
      if (!jp && hasAny(series && series.jp)) jp = missing(jpLabel, g, "jp");
      if (!en && hasAny(series && series.en)) en = missing(enLabel, g, "en");
      if (!jp && !en) return "";
      // 초판(Blue)은 별개 상품이라 칸을 따로 준다. 선을 그릴 만큼 쌓이면 선이, 아니면 숫자 카드가 뜬다.
      const bluePts = g === "month" ? ((series && series.monthly) || {}).enBlue
        : g === "day" ? ((series && series.daily) || {}).enBlue
        : (series && series.enBlue);
      const blueLabel = lang === "ko" ? "영문판 초판 Blue" : "English 1st print (Blue)";
      let blue = panel(bluePts, blueLabel, BLUE_COLOR, "opbcBlue" + g, lang,
        g === "week" ? wd.enBlue : null, g, null);
      if (!realLine && !blue) return "";
      if (!blue) {
        blue = spotPane(bluePts, blueLabel, BLUE_COLOR, lang, lang === "ko"
          ? "거래가 드물어 선을 그리지 못합니다 — 최근 실거래 값입니다."
          : "Too few sales to plot a line — this is the latest completed sale level.");
      }
      return '<div class="opbcGridWrap" data-grain="' + g + '"' + (hidden ? " hidden" : "") + ">" + jp + en + blue + "</div>";
    };

    const da = (series && series.daily) || {};
    const week = grid("week", series && series.jp, series && series.en, false);
    const month = grid("month", mo.jp, mo.en, true);
    const day = grid("day", da.jp, da.en, true);
    // 눌러도 아무것도 안 뜨는 버튼은 만들지 않는다 — 그릴 게 있는 단위만 탭으로 낸다.
    const tabDefs = [
      day ? ["day", lang === "ko" ? "일간" : "Daily"] : null,
      ["week", lang === "ko" ? "주간" : "Weekly"],
      month ? ["month", lang === "ko" ? "월간" : "Monthly"] : null,
    ].filter(Boolean);
    const tabs = tabDefs.length > 1
      ? '<div class="opbcTabs" role="group" aria-label="' + (lang === "ko" ? "집계 단위" : "Time grain") + '">' +
        tabDefs.map(([g, label]) =>
          '<button type="button" class="opbcTab' + (g === "week" ? " on" : "") + '" data-grain="' + g +
          '" aria-pressed="' + (g === "week" ? "true" : "false") + '">' + label + "</button>").join("") + "</div>"
      : "";

    // 3초 안에 읽혀야 하는 것: 두 판이 지금 얼마이고 몇 배 차이인가.
    // 패널이 위아래로 떨어져 있어 스크롤하지 않으면 비교가 안 된다 — 맨 위에 숫자로 못박는다.
    const lastOf = (arr) => { const c = clean(arr); return c.length ? c[c.length - 1].median : null; };
    const jpNow = lastOf(series && series.jp), enNow = lastOf(series && series.en);
    let compare = "";
    if (jpNow && enNow) {
      const times = (Math.max(jpNow, enNow) / Math.min(jpNow, enNow)).toFixed(1).replace(/\.0$/, "");
      const dearer = enNow >= jpNow ? (lang === "ko" ? "영문판" : "English") : (lang === "ko" ? "일본판" : "Japanese");
      compare = '<div class="opbcCompare">' +
        '<span class="opbcCmp"><i style="background:' + JP_COLOR + '"></i>' +
        (lang === "ko" ? "일본판" : "Japanese") + " <b>" + money(jpNow) + "</b></span>" +
        '<span class="opbcCmp"><i style="background:' + EN_COLOR + '"></i>' +
        (lang === "ko" ? "영문판" : "English") + " <b>" + money(enNow) + "</b></span>" +
        '<span class="opbcCmpX">' + (lang === "ko" ? dearer + "이 " + times + "배" : dearer + " " + times + "x") + "</span>" +
        "</div>";
    }

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
    return '<div class="opbcWrap">' + head + compare + day + week + month + note + supWrap + "</div>";
  }

  const CSS = [
    ".opbcWrap{margin:16px 0 4px}",
    ".opbcTop{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:760px;margin:0 0 10px}",
    ".opbcTitle{font-size:12px;font-weight:700;color:var(--muted,#8d95a7);letter-spacing:.02em}",
    ".opbcCompare{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;max-width:760px;margin:0 0 12px;padding:12px 16px;border:1px solid var(--line,#242936);border-radius:12px;background:var(--paper,#11141c)}",
    ".opbcCmp{display:inline-flex;align-items:baseline;gap:7px;font-size:14px;color:var(--muted,#8d95a7)}",
    ".opbcCmp i{width:9px;height:9px;border-radius:2px;display:inline-block;align-self:center}",
    ".opbcCmp b{font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink,#eef2ff);font-variant-numeric:tabular-nums}",
    ".opbcCmpX{margin-left:auto;font-size:14px;font-weight:800;color:var(--ink,#eef2ff);font-variant-numeric:tabular-nums}",
    ".opbcCmpAlt{flex-basis:100%;padding-top:9px;border-top:1px solid var(--line,#242936);font-size:12px}",
    ".opbcCmpAlt b{font-size:16px}",
    ".opbcCmpAlt small{color:var(--muted,#8d95a7);font-size:11px;margin-left:5px}",
    ".opbcBadge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.07);color:var(--muted,#8d95a7);white-space:nowrap}",
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
    // 넓은 화면에서는 일본판·영문판을 나란히 둔다 — 2026-08-27.
    // 세로로만 쌓으면 세트 페이지에서 차트 구역만 1,425px(2화면)가 되고, 두 판을 비교하려면
    // 스크롤해야 한다. 2026-08-13 에 좌우 배치를 접었던 이유는 본문이 800px 남짓이라
    // 반으로 쪼개면 한 칸이 380px 로 눌려서였다 — 그건 지금도 맞다.
    // 그래서 폭이 실제로 남을 때만(뷰포트 1240px+) 차트 구역을 본문 밖으로 넓혀
    // 한 칸을 590px 로 만든다. 그 아래에서는 예전 그대로 세로로 쌓인다.
    // 폭은 CSS 로 정하지 않는다 — 컨테이너가 좌측정렬(세트 페이지)인지 가운데정렬(ko·홈)인지에
    // 따라 100vw 계산식이 오른쪽으로 넘쳐 영문판 패널이 잘렸다(2026-08-27 실사고, ko 페이지).
    // sizeWraps() JS 가 각 wrap 의 실제 left 를 재서 뷰포트 안에 들어가는 폭만 준다.
    // [data-grain] 한정 — 공급 패널 구역(opbcSupWrap)까지 2열로 가르면 안내문이 왼쪽 칸,
    // 그래프가 오른쪽 칸이 되어 왼쪽 아래가 통째로 빈다(2026-08-28 소유자 발견).
    // 2026-08-28 최종형: 본문 컨테이너를 넓혔으므로(홈 1520·bodyPage 1320 @1240+)
    // 2열 여부는 순수 미디어쿼리로 정한다. JS 측정(opbcWide 토글)은 렌더 타이밍에 따라
    // 실배포에서 네 번 무력화됐다 — 측정 기반 방식 재도입 금지.
    "@media (min-width:1240px){.opbcGridWrap[data-grain]{max-width:none;grid-template-columns:repeat(2,minmax(0,1fr))}}",
    // display:grid 가 브라우저 기본 [hidden]{display:none} 을 이겨서, 숨겼는데 그대로 보였다(2026-08-13).
    ".opbcGridWrap[hidden]{display:none}",
    ".opbcPane{margin:0;border:1px solid var(--line,#242936);border-radius:14px;background:var(--paper,#11141c);padding:14px 16px 8px;min-width:0}",
    ".opbcHead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}",
    ".opbcLabel{font-size:12px;font-weight:700;color:var(--muted,#8d95a7)}",
    ".opbcNow{font-size:28px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--ink,#eef2ff)}",
    ".opbcChg{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}",
    ".opbcChg.up{color:#10d7a0}.opbcChg.dn{color:#e5484d}",
    ".opbcSpan{margin-left:auto;font-size:11px;color:var(--muted,#8d95a7);font-variant-numeric:tabular-nums}",
    ".opbcSupWrap{margin-top:16px}",
    ".opbcSupNote{margin:0 0 8px}",
    ".opbcLeg{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--ink,#eef2ff);font-variant-numeric:tabular-nums}",
    ".opbcLeg i{width:9px;height:9px;border-radius:2px;display:inline-block}",
    ".opbcSupLine{stroke-width:2}",
    ".opbcPane svg{width:100%;height:auto;display:block;margin-top:4px;touch-action:pan-y}",
    ".opbcGrid{stroke:rgba(255,255,255,.055);stroke-width:1}",
    ".opbcAx{fill:var(--muted,#8d95a7);font-size:11px;font-variant-numeric:tabular-nums}",
    ".opbcLine{fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}",
    ".opbcDot{stroke:var(--paper,#11141c);stroke-width:1.6}",
    ".opbcSupFill{fill:rgba(128,144,176,.10)}",
    ".opbcSupLine{fill:none;stroke:rgba(128,144,176,.55);stroke-width:1.4;stroke-dasharray:5 3;stroke-linejoin:round}",
    ".opbcSupAx{fill:#8090b0}",
    ".opbcStale{fill:rgba(245,200,66,.05)}",
    ".opbcStaleEdge{stroke:rgba(245,200,66,.4);stroke-width:1;stroke-dasharray:3 3}",
    ".opbcStaleTx{fill:#f5c842;font-size:10px;font-weight:700}",
    ".opbcStaleBadge{margin-left:8px;padding:2px 8px;border-radius:20px;background:rgba(245,200,66,.12);color:#f5c842;font-size:10px;font-weight:800;white-space:nowrap}",
    ".opbcKey{display:flex;gap:14px;margin:6px 0 0;padding:0 4px;font-size:11px;color:var(--muted,#8d95a7)}",
    ".opbcKey span{display:inline-flex;align-items:center;gap:5px}",
    ".opbcKey i{display:inline-block;width:12px;height:2px;border-radius:1px}",
    ".opbcKey .kDash{background:rgba(128,144,176,.7);height:0;border-top:2px dashed rgba(128,144,176,.7)}",
    ".opbcKey .kBar{width:8px;height:8px;border-radius:1px;opacity:.55}",
    ".opbcHitDot{cursor:pointer}.opbcHit{cursor:crosshair}",
    ".opbcTipBg{fill:#151a22;stroke:rgba(255,255,255,.16)}",
    ".opbcTipD{fill:var(--muted,#8d95a7);font-size:11px;font-variant-numeric:tabular-nums}",
    ".opbcTipV{fill:var(--ink,#eef2ff);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}",
    ".opbcTipR{fill:var(--muted,#8d95a7);font-size:11px;font-variant-numeric:tabular-nums}",
    ".opbcPaneEmpty{display:flex;flex-direction:column;justify-content:center;min-height:96px;padding:14px 16px}",
    ".opbcPaneSpot{padding:14px 16px}",
    ".opbcPaneSpot .opbcEmpty{margin-top:8px}",
    ".opbcEmpty{margin:6px 0 0;font-size:12px;color:var(--muted,#8d95a7)}",
    ".opbcNote{font-size:12px;color:var(--muted,#8d95a7);line-height:1.7;margin:10px 0 0}",
    ".opbcNote b{color:var(--ink,#eef2ff);font-weight:700}",
    // ── 모바일 — 2026-08-26 UI/UX 감사 확정 2건.
    // 1) SVG 가 viewBox 680 고정이라 375px 폰에서 ~0.47배로 축소돼 축 라벨 11px 이 ~5px 로
    //    렌더됐다(읽기 불가). SVG 안 글자는 CSS font-size 도 viewBox 단위로 먹으므로 값 자체를
    //    키운다. 툴팁 배경은 고정 rect(168×46)라 글자만 키우면 넘친다 — 상자도 같이 키운다
    //    (SVG2 기하 속성이라 CSS width/height 가 rect 에 적용된다).
    // 2) 일/주/월 탭이 높이 ~25px 라 오터치가 잦았다 — 패딩을 키워 ~40px 로.
    "@media (max-width:600px){",
    ".opbcAx{font-size:15px}",
    ".opbcStaleTx{font-size:13px}",
    ".opbcTipD{font-size:15px}",
    ".opbcTipV{font-size:19px}",
    ".opbcTipR{font-size:14px}",
    ".opbcTipBg{width:216px;height:74px}",
    ".opbcTab{padding:11px 14px;font-size:13px}",
    ".opbcTabs{gap:4px}",
    "}",
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
    const tipR = svg.querySelector(".opbcTipR");
    const dtag = svg.querySelector(".opbcDateTag");
    const dots = [].slice.call(svg.querySelectorAll(".opbcDot"));
    const hitDots = [].slice.call(svg.querySelectorAll(".opbcHitDot"));
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
      const hd = hitDots[best] ? hitDots[best].dataset : {};
      const tw = 186, tx = Math.min(Math.max(cx - tw / 2, 4), W - tw - 4);
      const ty = cy - 74 < T ? cy + 14 : cy - 74;
      tip.setAttribute("opacity", "1");
      tip.setAttribute("transform", "translate(" + tx + "," + ty + ")");
      tipD.textContent = (hd.d || "") + (hd.n ? " · " + hd.n : "");
      tipV.textContent = hd.v || "";
      if (tipR) tipR.textContent = hd.r || "";
      if (dtag) {
        dtag.setAttribute("transform", "translate(" + Math.min(Math.max(cx - 23, 2), W - 48) + "," + (H - B + 3) + ")");
        dtag.setAttribute("opacity", "1");
        dtag.querySelector("text").textContent = hd.x || (hd.d || "").slice(5);
      }
    }
    const off = () => {
      cross.setAttribute("opacity", "0"); hl.setAttribute("opacity", "0"); tip.setAttribute("opacity", "0");
      if (dtag) dtag.setAttribute("opacity", "0");
    };
    hit.addEventListener("pointerdown", (e) => { try { hit.setPointerCapture(e.pointerId); } catch (_) { /* 캡처 못 해도 값은 뜬다 */ } at(e.clientX); });
    hit.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) at(e.clientX); });
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("pointercancel", off);
  }

  // 공급 패널은 선이 둘이라 값도 둘이다. 가격 패널과 이벤트 처리는 같지만
  // 하이라이트와 툴팁 줄이 판마다 하나씩 붙는다.
  function bindSupply(pane) {
    if (pane.__opbcBound) return;
    pane.__opbcBound = 1;
    const svg = pane.querySelector("svg");
    if (!svg) return;
    const hit = svg.querySelector(".opbcHit"), cross = svg.querySelector(".opbcCross");
    const hlJp = svg.querySelector(".opbcHlJp"), hlEn = svg.querySelector(".opbcHlEn");
    const tip = svg.querySelector(".opbcTip"), tipD = svg.querySelector(".opbcTipD");
    const tipJp = svg.querySelector(".opbcTipJp"), tipEn = svg.querySelector(".opbcTipEn");
    const dots = [].slice.call(svg.querySelectorAll(".opbcSupDot"));
    if (!hit || !dots.length) return;
    const jpWord = pane.dataset.jpword || "JP", enWord = pane.dataset.enword || "EN";

    function at(clientX) {
      const r = svg.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * W;
      let best = 0, bd = Infinity;
      dots.forEach((d, i) => { const dd = Math.abs(+d.getAttribute("cx") - x); if (dd < bd) { bd = dd; best = i; } });
      const d = dots[best], cx = +d.getAttribute("cx");
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("opacity", ".45");
      const put = (el, y) => {
        if (y === "") { el.setAttribute("opacity", "0"); return; }
        el.setAttribute("cx", cx); el.setAttribute("cy", y); el.setAttribute("opacity", "1");
      };
      put(hlJp, d.dataset.jpy); put(hlEn, d.dataset.eny);
      tipD.textContent = d.dataset.d;
      tipJp.textContent = d.dataset.jp === "" ? jpWord + " -" : jpWord + " " + d.dataset.jp;
      tipEn.textContent = d.dataset.en === "" ? enWord + " -" : enWord + " " + d.dataset.en;
      const tw = 150, tx = Math.min(Math.max(cx - tw / 2, 4), W - tw - 4);
      tip.setAttribute("opacity", "1");
      tip.setAttribute("transform", "translate(" + tx + "," + (SUP_T + 4) + ")");
    }
    const off = () => {
      cross.setAttribute("opacity", "0"); hlJp.setAttribute("opacity", "0");
      hlEn.setAttribute("opacity", "0"); tip.setAttribute("opacity", "0");
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
    // data-grain 이 있는 격자만 탭 대상이다. 매물 패널도 레이아웃 때문에 .opbcGridWrap 을 쓰는데,
    // 그것까지 잡으면 탭을 누르는 순간 매물 그래프가 숨겨진다(2026-08-13 실측 — 일간 탭 추가하며 드러남).
    const grids = [].slice.call(wrap.querySelectorAll(".opbcGridWrap[data-grain]"));
    if (!tabs.length || grids.length < 2) return;
    tabs.forEach((btn) => btn.addEventListener("click", () => {
      const g = btn.dataset.grain;
      tabs.forEach((b) => { const on = b === btn; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      grids.forEach((gr) => { gr.hidden = gr.dataset.grain !== g; });
      // 숨어 있던 쪽은 아직 훑기 이벤트가 안 걸렸을 수 있다.
      [].slice.call(wrap.querySelectorAll(".opbcPane")).forEach(bindPane);
    }));
  }

  // 2열 배치는 순수 CSS 미디어쿼리가 담당한다(위 CSS 참조). JS 측정·마진 조작 방식은
  // 렌더 타이밍에 따라 실배포에서 네 번 무력화됐다 — 재도입 금지. 여기서는 과거 버전이
  // 남긴 인라인 스타일만 청소한다(캐시된 옛 JS 가 심은 width/marginLeft 잔재 방어).
  function sizeWraps(scope) {
    [].slice.call(scope.querySelectorAll(".opbcWrap")).forEach((wrap) => {
      wrap.style.width = "";
      wrap.style.marginLeft = "";
      wrap.classList.remove("opbcWide");
    });
  }

  function scrub(root) {
    const scope = root && root.querySelectorAll ? root : (typeof document !== "undefined" ? document : null);
    if (!scope) return;
    [].slice.call(scope.querySelectorAll(".opbcPane")).forEach((p) => {
      if (p.classList.contains("opbcSupply")) bindSupply(p); else bindPane(p);
    });
    [].slice.call(scope.querySelectorAll(".opbcWrap")).forEach(bindTabs);
    sizeWraps(scope);
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
