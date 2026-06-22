// K-TCG Quant — 데이터는 data/products.json, 환율은 data/fx.json 에서 fetch.
// 모든 카드 메인 가격은 원화(KRW). 원본 통화·전일 환율은 보조줄에 표기.
// 정적 파일을 file:// 로 열면 fetch가 막히므로 HTTP 서버에서 운영할 것.

const filterState = {
  category: "all",
  language: "primary", // primary(국내·일본) | 일본어판 | 한국어판 | reference(해외 참고)
};

let products = [];
let fx = { jpyKrw: 9.45, usdKrw: 1388.2, date: "" };

const formatKrw = (value) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Math.round(value));

const formatJpy = (value) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);

const formatUsd = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);

// 원본 통화 -> 원화 환산 (메인 표시 기준)
const toKrw = (item) => {
  const s = item.sourcePrices || {};
  if (s.krw != null) return s.krw;
  if (s.jpy != null) return s.jpy * fx.jpyKrw;
  if (s.usd != null) return s.usd * fx.usdKrw;
  return 0;
};

// 카드 보조줄: 원본 통화 원본가 + 전일 환율
const getReferencePriceText = (item) => {
  const s = item.sourcePrices || {};
  if (s.jpy != null) {
    return `일본가 ${formatJpy(s.jpy)} · 전일 JPY/KRW ${fx.jpyKrw.toFixed(2)}`;
  }
  if (s.usd != null) {
    return `eBay ${formatUsd(s.usd)} · 전일 USD/KRW ${fx.usdKrw.toFixed(1)}`;
  }
  return "국내 실거래 기준";
};

const getScoreClass = (score) => {
  if (score >= 75) return "gradeA";
  if (score >= 60) return "gradeB";
  return "gradeC";
};

const getMsrpClass = (value) => {
  if (value >= 7) return "msrpHot";
  if (value >= 2) return "msrpWarm";
  return "msrpFair";
};

const sourceTags = (item) => {
  if (item.tier === "reference") {
    return `<span class="sourceButton secondary">해외 참고</span><span class="sourceButton secondary">US</span>`;
  }
  const region = item.language === "일본어판" ? "JP" : "KR";
  return `<span class="sourceButton">국내시세</span><span class="sourceButton secondary">${region}</span>`;
};

function visibleProducts() {
  return products.filter((item) => {
    const categoryMatch =
      filterState.category === "all" || item.category === filterState.category;

    let languageMatch;
    if (filterState.language === "primary") {
      languageMatch = item.tier === "primary";
    } else if (filterState.language === "reference") {
      languageMatch = item.tier === "reference";
    } else {
      languageMatch = item.language === filterState.language;
    }
    return categoryMatch && languageMatch;
  });
}

function renderRows() {
  const rows = document.querySelector("#productCards");
  const data = visibleProducts()
    .slice()
    .sort((a, b) => toKrw(b) - toKrw(a)); // 원화 기준 정렬

  if (!data.length) {
    rows.innerHTML = `<p class="note">해당 조건의 상품이 없습니다.</p>`;
    return;
  }

  rows.innerHTML = data
    .map((item) => {
      const krw = toKrw(item);
      const target = krw * 1.2;
      const upside = target - krw;
      const momentumClass = item.momentum >= 0 ? "momentumUp" : "momentumDown";
      const msrpClass = getMsrpClass(item.msrpMultiple);
      const sign = item.momentum > 0 ? "+" : "";
      const stanceType = item.stanceType || "neutral";
      const stanceLabel = item.stanceLabel || "NEUTRAL";
      const signalType = stanceType === "buy" ? "buy" : stanceType === "watch" ? "watch" : "";
      const refBadge = item.tier === "reference" ? `<span class="refChip">해외 참고</span>` : "";
      const thumb = item.imageUrl
        ? `<div class="productThumb"><img src="${item.imageUrl}" alt="${item.title}" loading="lazy" /></div>`
        : `<div class="productThumb" aria-hidden="true"></div>`;

      return `
        <article class="quantCard ${stanceType} ${item.tier}" style="--thumbA:${item.thumbA}; --thumbB:${item.thumbB}">
          <div>
            <div class="cardTop">
              ${thumb}
              <div>
                <div class="metaLine">${item.category} · ${item.era} · ${item.language}</div>
                <h3>${item.title} ${refBadge}</h3>
                <div class="productType">${item.productType}</div>
              </div>
            </div>
            <div class="priceBlock">
              <div class="priceRow">
                <span class="price">${formatKrw(krw)}</span>
                <span class="${momentumClass}">${sign}${item.momentum}% (${item.momentumWindow})</span>
              </div>
              <div class="target">${getReferencePriceText(item)}</div>
              <div class="target">+20% target ${formatKrw(target)} · <span class="gain">${formatKrw(upside)}</span></div>
              ${item.setup ? `<div class="setupTag ${item.setupLevel === "critical" ? "critical" : ""}">▧ ${item.setup}</div>` : ""}
              <div class="signal ${signalType}">${item.signal}</div>
              <div class="cardActions">
                <span class="miniButton">↗ CAGR <small>&nbsp;준비중</small></span>
                <span class="miniButton">→ Full Analysis <small>&nbsp;준비중</small></span>
              </div>
            </div>
          </div>
          <aside class="cardSide">
            <span class="stance ${stanceType}">⌃ ${stanceLabel} | ${item.quantScore}</span>
            <span class="confidence">Confidence ${item.confidence}</span>
            <span class="msrp ${msrpClass}">${item.msrpMultiple.toFixed(1)}x MSRP</span>
            <span class="updated">Last updated: ${item.updated}</span>
            <div class="sources">${sourceTags(item)}</div>
          </aside>
        </article>
      `;
    })
    .join("");
}

function renderSummary() {
  // 요약 지표는 국내·일본(primary) 카탈로그 기준
  const base = products.filter((p) => p.tier === "primary");
  const avg = base.reduce((sum, item) => sum + item.momentum, 0) / Math.max(base.length, 1);
  const watch = base.filter((item) => item.sealRisk === "높음" || item.quantScore < 60).length;

  document.querySelector("#trackedCount").textContent = base.length;
  document.querySelector("#avgMomentum").textContent = `${avg.toFixed(1)}%`;
  document.querySelector("#watchCount").textContent = watch;
}

function bindFilters() {
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      filterState.category = button.dataset.filter;
      renderRows();
    });
  });

  document.querySelectorAll(".langFilter").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".langFilter").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      filterState.language = button.dataset.lang;
      renderRows();
    });
  });
}

async function init() {
  try {
    const [pRes, fxRes] = await Promise.all([
      fetch("data/products.json", { cache: "no-store" }),
      fetch("data/fx.json", { cache: "no-store" }),
    ]);
    const pJson = await pRes.json();
    fx = await fxRes.json();
    products = pJson.products || [];
  } catch (err) {
    document.querySelector("#productCards").innerHTML =
      `<p class="note">데이터를 불러오지 못했습니다. 이 페이지는 HTTP 서버에서 열어야 합니다. (오류: ${err.message})</p>`;
    return;
  }

  renderSummary();
  renderRows();
  bindFilters();
}

init();
