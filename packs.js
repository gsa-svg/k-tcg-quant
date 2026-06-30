const state = {
  data: null,
  lang: "jp",
  selected: null,
  renderedLang: null,
  view: "hits", // "hits" | "psa"
};

const rarityColor = {
  L: "#7db7ff",
  SEC: "#ff6683",
  SR: "#10d7a0",
  R: "#f3c74f",
  P: "#bb86fc",
  UC: "#9aa3b2",
  C: "#9aa3b2",
};

// PSA(GemRate) rarity → 짧은 배지 코드 + 색
const psaRarity = {
  "Special Alternate Art": { s: "SAA", c: "#bb86fc" },
  "Manga Alternate Art": { s: "MAA", c: "#ff8a3d" },
  "Alternate Art": { s: "AA", c: "#7db7ff" },
  "Treasure Rare": { s: "TR", c: "#f3c74f" },
  "Secret Rare": { s: "SEC", c: "#ff6683" },
  SEC: { s: "SEC", c: "#ff6683" },
  Leader: { s: "L", c: "#7db7ff" },
  "Pre-Release": { s: "PR", c: "#9aa3b2" },
  Base: { s: "C", c: "#9aa3b2" },
};
const rb = (r) => psaRarity[r] || { s: (r || "").slice(0, 3).toUpperCase(), c: "#9aa3b2" };
const num = (n) => (n == null ? "-" : new Intl.NumberFormat("ko-KR").format(n));

const fmtKrw = (v) =>
  new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.round(v));

const fmtUsd = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);

const fmtJpy = (v) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v);

function fmtOriginalCurrency(value, currency) {
  if (value == null) return "-";
  if (currency === "KRW") return fmtKrw(value);
  if (currency === "JPY") return fmtJpy(value);
  if (currency === "USD") return fmtUsd(value);
  return `${currency || ""} ${num(value)}`.trim();
}

function marketKrw(value, currency) {
  const fx = (state.data && state.data.fx) || {};
  if (value == null) return null;
  if (currency === "KRW") return value;
  if (currency === "JPY") return value * (fx.jpyKrw || 9.1);
  if (currency === "USD") return value * (fx.usdKrw || 1388.2);
  return null;
}

function priceBandRows(market) {
  const rows = [
    ["High", market.high],
    ["Middle", market.middle],
    ["Low", market.low],
  ];

  return rows
    .map(([label, value]) => {
      const krwValue = marketKrw(value, market.currency);
      return `
        <span class="bandRow">
          <i>${label}</i>
          <b>${krwValue == null ? "-" : fmtKrw(krwValue)}</b>
          <small>${fmtOriginalCurrency(value, market.currency)}</small>
        </span>`;
    })
    .join("");
}

function priceVenueLabel(venue) {
  if (!venue) return "유유테이";
  if (venue.includes("遊々亭")) return "유유테이";
  if (/cardrush/i.test(venue) || venue.includes("カードラッシュ")) return "카드러시";
  return venue;
}

function priceLines(c) {
  const fx = (state.data && state.data.fx) || {};
  let h = "";
  if (c.nmJpy != null) {
    const nmVenue = priceVenueLabel(c.nmVenue);
    h += `<span class="pl nm"><i>일본판 NM</i> <b>${fmtKrw(c.nmJpy * (fx.jpyKrw || 9.1))}</b> <small>${fmtJpy(c.nmJpy)} <em>${nmVenue}</em></small></span>`;
  }
  if (c.psa10Usd != null) {
    const d = c.psa10Date ? c.psa10Date.slice(2).replace(/-/g, ".") : "";
    h += `<span class="pl psa"><i>일본어판 PSA10</i> <b>${fmtKrw(c.psa10Usd * (fx.usdKrw || 1388.2))}</b> <small>${fmtUsd(c.psa10Usd)}${d ? " · " + d : ""} <em>${c.psa10Venue || "PSA/eBay"}</em></small></span>`;
  } else if (c.psa10Ebay?.sampleSize > 0) {
    const psa10EbaySourceLabel = c.psa10Ebay.soldBased ? "eBay Sold" : "eBay Active";
    h += `
      <span class="pl psaEbay">
        <i>일본어판 PSA10 eBay</i>
        <span class="bandRows">${priceBandRows(c.psa10Ebay)}</span>
        <small>${psa10EbaySourceLabel} · 표본 ${c.psa10Ebay.sampleSize}건</small>
      </span>`;
  }
  if (c.englishNmEbay?.sampleSize > 0) {
    h += `
      <span class="pl psaEbay">
        <i>영문판 NM eBay</i>
        <span class="bandRows">${priceBandRows(c.englishNmEbay)}</span>
        <small>eBay Active · 표본 ${c.englishNmEbay.sampleSize}건</small>
      </span>`;
  }
  return h ? `<div class="priceLines">${h}</div>` : "";
}

const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='110'><rect width='100%' height='100%' rx='8' fill='%231a1e28'/><text x='50%' y='52%' fill='%23566' font-size='11' text-anchor='middle' font-family='sans-serif'>이미지</text></svg>",
  );

const DATA_URLS = [
  "data/onepiece-packs.json",
  "https://gsa-svg.github.io/k-tcg-quant/data/onepiece-packs.json",
];
const SITE_BASE = "https://gsa-svg.github.io/k-tcg-quant";
const DATA_VERSION = "20260629order1";

function withVersion(url) {
  return `${url}${url.includes("?") ? "&" : "?"}v=${DATA_VERSION}`;
}

function trackEvent(name, params = {}) {
  if (typeof window.gtag === "function") {
    window.gtag("event", name, params);
    return;
  }
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: name, ...params });
}

function setJsonLd(id, data) {
  let script = document.querySelector(`#${id}`);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

function updateUrl(replace = false) {
  if (!state.selected) return;
  const params = new URLSearchParams();
  params.set("set", state.selected);
  if (state.lang !== "jp") params.set("lang", state.lang);
  if (state.view !== "hits") params.set("view", state.view);
  history[replace ? "replaceState" : "pushState"]({ selected: state.selected, lang: state.lang, view: state.view }, "", `${location.pathname}?${params}`);
}

function updateSeo(pack) {
  if (!pack) return;
  const title = `${pack.code} ${pack.nameKo} ${pack.nameEn} 부스터팩 시세·히트카드 TOP10 | K-TCG Quant`;
  const description = `${pack.code} ${pack.nameKo}(${pack.nameEn}) 부스터팩 박스 가격, eBay Active, TOP10 히트카드, NM, PSA10, PSA 통계를 비교합니다.`;
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    description,
  );
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  const params = new URLSearchParams();
  params.set("set", pack.key);
  if (state.lang !== "jp") params.set("lang", state.lang);
  canonical.href = `${SITE_BASE}/packs.html?${params}`;
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonical.href);

  const set = pack.set || {};
  const image = set.box ? new URL(set.box, location.href).href : undefined;
  setJsonLd("packStructuredData", {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title.replace(" | K-TCG Quant", ""),
    description,
    url: canonical.href,
    image,
    inLanguage: "ko-KR",
    isAccessibleForFree: true,
    creator: {
      "@type": "Organization",
      name: "K-TCG Quant",
      url: `${SITE_BASE}/`,
    },
    dateModified: state.data?.updated || undefined,
    variableMeasured: ["Booster box price", "Top 10 hit cards", "NM price", "PSA10 price", "PSA population"],
    keywords: [`${pack.code}`, pack.nameKo, pack.nameEn, "원피스 카드게임", "부스터팩 시세", "PSA10", "eBay"],
  });
}

function ebayQueryFor(pack) {
  const language = state.lang === "kr" ? "Korean" : "Japanese";
  const parts = ["One Piece Card Game", pack.code, pack.nameEn, "Booster Box", language, "sealed"];
  return parts.filter(Boolean).join(" ");
}

function ebayLinks(pack) {
  const q = encodeURIComponent(ebayQueryFor(pack));
  const base = `https://www.ebay.com/sch/i.html?_nkw=${q}`;
  return `
    <div class="marketLinks" aria-label="eBay market links">
      <a href="${base}&LH_Sold=1&LH_Complete=1&_sop=13" target="_blank" rel="noopener noreferrer">eBay Sold</a>
      <a href="${base}&LH_BIN=1&_sop=15" target="_blank" rel="noopener noreferrer">eBay Active</a>
    </div>`;
}

function renderBoxSeries(set) {
  const s = set.boxSeries;
  const pts = (s && s.points) || [];
  if (pts.length < 2) return "";
  const W = 600, H = 190, padL = 8, padR = 14, padT = 14, padB = 8;
  const xs = pts.map((p) => new Date(p.d).getTime());
  const ys = pts.map((p) => p.p);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = maxY - minY || maxY;
  minY -= span * 0.15; maxY += span * 0.15;
  const X = (t) => padL + ((t - minX) / (maxX - minX || 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const line = pts.map((p, i) => (i ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(p.p).toFixed(1)).join(" ");
  const area = `${line} L${X(maxX).toFixed(1)} ${H - padB} L${X(minX).toFixed(1)} ${H - padB} Z`;
  const last = pts[pts.length - 1];
  const fmtD = (d) => d.slice(5).replace("-", "/");
  return `
    <div class="boxChart">
      <div class="bcHead"><span class="bmLabel">박스 시세 추이 · 최근 3개월 (eBay Sold)</span><strong>${fmtKrw(last.p)}</strong></div>
      <svg viewBox="0 0 ${W} ${H}" class="bcSvg" role="img" aria-label="박스 시세 추이 그래프">
        <defs><linearGradient id="bcg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#10d7a0" stop-opacity=".35"/><stop offset="1" stop-color="#10d7a0" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#bcg)"/>
        <path d="${line}" fill="none" stroke="#10d7a0" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${X(maxX).toFixed(1)}" cy="${Y(last.p).toFixed(1)}" r="4.5" fill="#10d7a0"/>
      </svg>
      <div class="bcAxis"><span>${fmtD(pts[0].d)}</span><span>최고 ${fmtKrw(Math.max(...ys))} · 최저 ${fmtKrw(Math.min(...ys))}</span><span>${fmtD(last.d)}</span></div>
      <p class="note">${s.source}. 주간 중앙값이며, 표본이 적은 주는 변동이 큽니다. 단일 박스 기준(케이스·로트 제외).</p>
    </div>`;
}

function renderBoxMarket(set) {
  const market = set.boxMarket?.jp?.ebayActive;
  if (!market) {
    return `
      <div class="boxMarket empty">
        <span class="bmLabel">일본판 박스 eBay</span>
        <strong>가격 수집 대기</strong>
        <small>Active 매물 기준 · 중국/홍콩/마카오 발송지 제외 예정</small>
      </div>`;
  }

  return `
    <div class="boxMarket">
      <div class="bmHead">
        <span class="bmLabel">일본판 박스 eBay Active</span>
        <small>${market.updated || "업데이트일 미상"} · 표본 ${market.sampleSize || 0}건${
          market.excludedCount ? ` · 제외 ${market.excludedCount}건` : ""
        }</small>
      </div>
      <div class="bmRows">
        ${priceBandRows(market)}
      </div>
      <p>정렬 후 하위/중앙/상위 가격대. 재밀봉 리스크를 줄이기 위해 중국권 발송지는 제외합니다.</p>
    </div>`;
}

function renderSourceLegend(set) {
  const hasPsa10 = (set.cards || []).some((card) => card.psa10Usd != null || card.psa10Ebay?.sampleSize > 0);
  const hasEnglishNmEbay = (set.cards || []).some((card) => card.englishNmEbay?.sampleSize > 0);
  return `
    <div class="sourceLegend" aria-label="가격 출처 요약">
      <span><b>일본판 NM</b><small>유유테이 우선 · 카드러시 보조</small></span>
      <span class="${hasPsa10 ? "" : "muted"}"><b>일본어판 PSA10</b><small>${hasPsa10 ? "공식값 우선 · 없으면 eBay" : "확인된 가격 없음"}</small></span>
      <span><b>영문판 NM</b><small>${hasEnglishNmEbay ? "eBay Active 기준" : "eBay 매칭 없음"}</small></span>
      <span><b>박스가</b><small>eBay Active 호가</small></span>
    </div>`;
}

async function fetchPackData() {
  let lastError;

  for (const url of DATA_URLS) {
    try {
      const res = await fetch(withVersion(url), { cache: "default" });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

async function load() {
  try {
    state.data = await fetchPackData();
  } catch (err) {
    document.querySelector("#packList").innerHTML =
      `<p class="note">데이터를 불러오지 못했습니다. (${err.message}) 잠시 후 다시 시도해주세요.</p>`;
    return;
  }
  applyRouteState();
  bindLangTabs();
  renderStats();
  renderMarketStatus();
  renderPackGrid();
  renderDetail();
  updateUrl(true);
}

// returns normalized pack list for current language:
// [{key, code, nameKo, nameEn, set}]  (set = the underlying sets[baseCode] record)
function currentPacks() {
  const d = state.data;
  if (state.lang === "kr") {
    return d.kr.list.map((it) => {
      const set = d.sets[it.base] || {};
      const pendingSet = { ...set, cards: [], psa: [], boxMarket: null };
      return { key: it.opk, code: it.opk, nameKo: it.nameKo, nameEn: set.nameEn || "", set: pendingSet };
    });
  }
  const list = state.lang === "extra" ? d.extra.list : d.jp.list;
  return list.map((code) => {
    const set = d.sets[code] || {};
    return { key: code, code, nameKo: set.nameKo || code, nameEn: set.nameEn || "", set };
  });
}

function selectFirstOfLang() {
  const packs = currentPacks();
  const ready = packs.find((p) => (p.set.cards || []).length > 0);
  state.selected = (ready || packs[0]).key;
}

function applyRouteState() {
  const params = new URLSearchParams(location.search);
  const requestedLang = params.get("lang");
  if (["jp", "extra", "kr"].includes(requestedLang)) state.lang = requestedLang;

  const requestedSet = params.get("set");
  let pack = currentPacks().find((p) => p.key === requestedSet && (p.set.cards || []).length > 0);
  if (!pack && requestedSet) {
    for (const lang of ["jp", "extra", "kr"]) {
      state.lang = lang;
      pack = currentPacks().find((p) => p.key === requestedSet && (p.set.cards || []).length > 0);
      if (pack) break;
    }
  }

  if (pack) state.selected = pack.key;
  else selectFirstOfLang();
  state.view = params.get("view") === "psa" ? "psa" : "hits";
}

function renderStats() {
  const d = state.data;
  const readyCount = (codes) => codes.filter((c) => (d.sets[c]?.cards || []).length > 0).length;
  const jpReady = readyCount(d.jp.list);
  const extraReady = readyCount(d.extra.list);
  document.querySelector("#statJp").textContent = `${jpReady}/${d.jp.list.length}`;
  document.querySelector("#statExtra").textContent = `${extraReady}/${d.extra.list.length}`;
  document.querySelector("#statKr").textContent = `준비중`;
}

function renderMarketStatus() {
  const el = document.querySelector("#marketStatus");
  if (!el || !state.data) return;

  const sets = Object.values(state.data.sets || {});
  const pricedSets = sets.filter((set) => (set.cards || []).length > 0).length;
  const cardCount = sets.reduce((sum, set) => sum + (set.cards || []).length, 0);
  const boxSamples = sets.reduce((sum, set) => sum + (set.boxMarket?.jp?.ebayActive?.sampleSize || 0), 0);
  const updated = state.data.updated || "확인중";

  el.innerHTML = `
    <span><i></i>Market Live</span>
    <span>Sets ${pricedSets}</span>
    <span>Cards ${cardCount}</span>
    <span>Box Samples ${boxSamples}</span>
    <span>Update ${updated}</span>
  `;
}

function bindLangTabs() {
  document.querySelectorAll(".langTab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === state.lang);
    btn.onclick = () => {
      if (state.lang === btn.dataset.lang) return;
      state.lang = btn.dataset.lang;
      document.querySelectorAll(".langTab").forEach((b) => b.classList.toggle("active", b === btn));
      selectFirstOfLang();
      renderPackGrid();
      renderDetail();
      updateUrl();
      trackEvent("select_language", { language: state.lang });
    };
  });
}

function renderPackGrid() {
  const wrap = document.querySelector("#packList");
  if (state.renderedLang === state.lang && wrap.children.length) {
    wrap.querySelectorAll(".packChip").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.key === state.selected);
    });
    return;
  }

  state.renderedLang = state.lang;
  const packs = currentPacks();
  wrap.innerHTML = packs
    .map((p) => {
      const has = (p.set.cards || []).length > 0;
      const active = p.key === state.selected ? " active" : "";
      const box = p.set.box || FALLBACK;
      return `
        <button class="packChip${active}${has ? "" : " pending"}" data-key="${p.key}" ${has ? "" : "disabled"}>
          <img class="packBox" src="${box}" alt="${p.code} 박스" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" />
          <span class="packMeta">
            <span class="packCode">${p.code}</span>
            <span class="packName">${p.nameKo}</span>
            <span class="packEn">${p.nameEn}</span>
            <span class="packTag${has ? " ready" : ""}">${has ? "TOP 10" : "준비중"}</span>
          </span>
        </button>`;
    })
    .join("");

  wrap.querySelectorAll(".packChip:not(.pending)").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.selected === btn.dataset.key) return;
      state.selected = btn.dataset.key;
      renderPackGrid();
      renderDetail();
      updateUrl();
      trackEvent("select_pack", { pack_code: state.selected, language: state.lang });
      document.querySelector("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderHitList(cards) {
  const cells = cards
    .map((c) => {
      const color = rarityColor[c.rarity] || "#8d95a7";
      const img = c.img || FALLBACK;
      return `
        <figure class="hitCard" data-img="${img}" data-name="${(c.name || "").replace(/"/g, "&quot;")}">
          <div class="hitThumb">
            <span class="hitRank">${c.rank}</span>
            ${c.rarity ? `<span class="hitRar" style="--c:${color}">${c.rarity}</span>` : ""}
            <img src="${img}" alt="${c.name}" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" />
          </div>
          <figcaption>
            <span class="hitName">${c.name}</span>
            <span class="hitNo">${c.number || ""}</span>
            ${priceLines(c)}
          </figcaption>
        </figure>`;
    })
    .join("");
  return `<div class="hitGallery">${cells}</div>`;
}

function openLightbox(src, name) {
  let lb = document.querySelector("#lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.innerHTML = `<div class="lbInner"><img id="lbImg" alt=""/><p id="lbCap"></p><button id="lbClose" aria-label="닫기">✕</button></div>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.id === "lbClose") lb.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") lb.classList.remove("open"); });
  }
  // 큰 이미지: TCGplayer CDN 400w → 1000x1000 시도
  const big = src.replace(/_(\d+)w\.jpg/, "_1000x1000.jpg");
  const imgEl = lb.querySelector("#lbImg");
  imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = src; };
  imgEl.src = big;
  lb.querySelector("#lbCap").textContent = name || "";
  lb.classList.add("open");
}

function renderPsaTable(psa) {
  const rows = psa
    .map((c) => {
      const b = rb(c.rarity);
      const gem = c.gem == null ? "-" : `${c.gem}%`;
      const gemClass = c.gem >= 90 ? "gemHi" : c.gem >= 80 ? "gemMid" : "gemLo";
      return `
        <tr>
          <td class="pCard">
            <span class="pName">${c.name}</span>
            <span class="pNo">#${c.number}</span>
          </td>
          <td class="pRar"><span class="pBadge" style="--c:${b.c}">${b.s}</span></td>
          <td class="pNumv">${num(c.psa10)}</td>
          <td class="pNumv dim">${num(c.psa9)}</td>
          <td class="pNumv">${num(c.total)}</td>
          <td class="pNumv ${gemClass}">${gem}</td>
        </tr>`;
    })
    .join("");
  return `
    <div class="psaWrap">
      <table class="psaTable">
        <thead>
          <tr>
            <th class="pCard">카드</th>
            <th class="pRar">등급</th>
            <th>PSA 10</th>
            <th>PSA 9</th>
            <th>총계</th>
            <th>PSA10확률</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">PSA 등급 인구 데이터 (출처: GemRate / PSA 집계). PSA10확률 = 감정 카드 중 PSA10 비율.</p>
    </div>`;
}

function renderDataNotice() {
  return `
    <div class="dataNotice">
      <b>데이터 기준</b>
      eBay Active는 현재 호가이며 실거래가가 아닙니다. 일본어판 PSA10 eBay는 공식 일본어판 PSA10 가격이 없을 때만 보조로 표시합니다.
      영문판 NM eBay와 박스가는 중국권 발송지와 명확한 오탐을 제외한 참고값입니다. 일본판 NM은 일본 매장 기준입니다.
    </div>`;
}

function renderDetail() {
  const pack = currentPacks().find((p) => p.key === state.selected);
  const el = document.querySelector("#detail");
  if (!pack) return;
  updateSeo(pack);
  const set = pack.set;
  const cards = set.cards || [];
  if (!cards.length) {
    el.innerHTML = `<p class="note">${pack.code} ${pack.nameKo} — 아직 카드 데이터가 준비되지 않았습니다(신규 세트).</p>`;
    return;
  }

  const hasPsa = (set.psa || []).length > 0;
  if (state.view === "psa" && !hasPsa) state.view = "hits";

  let body;
  if (state.view === "psa") {
    body = renderPsaTable(set.psa);
  } else {
    const fxNote = `<p class="srcNote">환율 기준: ¥${state.data.fx.jpyKrw} / $${state.data.fx.usdKrw}. 원화는 비교용 환산값입니다.</p>`;
    body = renderSourceLegend(set) + fxNote + renderHitList(cards);
  }

  el.innerHTML = `
    <div class="detailHead">
      <img class="detailBox" src="${set.box || FALLBACK}" alt="${pack.code} 박스" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" />
      <div class="detailInfo">
        <p class="eyebrow">${pack.code} · Booster Box</p>
        <h2>${pack.nameKo} <small>${pack.nameEn}</small></h2>
        <div class="viewTabs">
          <button class="viewTab ${state.view === "hits" ? "active" : ""}" data-view="hits">시세 TOP 10</button>
          <button class="viewTab ${state.view === "psa" ? "active" : ""}" data-view="psa" ${hasPsa ? "" : "disabled"}>
            PSA 통계
          </button>
        </div>
        ${ebayLinks(pack)}
        ${state.lang !== "kr" ? renderBoxSeries(set) : ""}
        ${state.lang !== "kr" && !set.boxSeries ? renderBoxMarket(set) : ""}
        ${renderDataNotice()}
        ${hasPsa && state.view === "psa" ? `<p class="note">세트 평균 PSA10확률 ${set.psaGem ?? "-"}% · 누적 ${num(set.psaTotal)}장</p>` : ""}
      </div>
    </div>
    ${body}
  `;

  el.querySelectorAll(".viewTab:not([disabled])").forEach((b) =>
    b.addEventListener("click", () => {
      if (state.view === b.dataset.view) return;
      state.view = b.dataset.view;
      renderDetail();
      updateUrl();
      trackEvent("select_view", { pack_code: state.selected, view: state.view });
    }),
  );
  el.querySelectorAll(".marketLinks a").forEach((a) =>
    a.addEventListener("click", () =>
      trackEvent("outbound_click", { pack_code: state.selected, label: a.textContent.trim(), url: a.href }),
    ),
  );
  el.querySelectorAll(".hitCard").forEach((f) =>
    f.addEventListener("click", () => {
      trackEvent("image_zoom", { pack_code: state.selected, card_name: f.dataset.name });
      openLightbox(f.dataset.img, f.dataset.name);
    }),
  );
}

window.addEventListener("popstate", () => {
  applyRouteState();
  bindLangTabs();
  renderPackGrid();
  renderDetail();
});

load();
