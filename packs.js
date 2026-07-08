const state = {
  data: null,
  lang: "jp",
  selected: null,
  hasExplicitSet: false,
  renderedLang: null,
  view: "hits", // "hits" | "psa"
  hl: "en", // display language: "ko" | "en"
};

function initDisplayLanguage() {
  const params = new URLSearchParams(location.search);
  const urlLang = params.get("hl");
  // 외국인 무조건 영문 보장: 브라우저 주 언어가 한국어인 경우에만 한글 허용.
  // (hl=ko URL로 잘못 들어와도 브라우저가 한국어가 아니면 영문으로 강제)
  const browserKo =
    (navigator.language || "").toLowerCase().startsWith("ko") ||
    (navigator.languages || []).some((l) => (l || "").toLowerCase().startsWith("ko"));
  state.hl = urlLang === "ko" && browserKo ? "ko" : "en";
}

function t(ko, en) {
  return state.hl === "en" ? en : ko;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeEbayUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (!/(^|\.)ebay\./i.test(url.hostname)) return "";
    return url.href;
  } catch (e) {
    return "";
  }
}

// eBay Partner Network(EPN) 추적 파라미터 부착 — 공개 캠페인 ID(비밀 아님)
const EPN_CAMPID = "5339163744";
const EPN_ROTATION = "711-53200-19255-0"; // ebay.com(US)
function epnUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!/(^|\.)ebay\./i.test(url.hostname)) return value;
    if (url.searchParams.get("campid")) return url.href; // 이미 부착됨
    url.searchParams.set("mkcid", "1");
    url.searchParams.set("mkrid", EPN_ROTATION);
    url.searchParams.set("siteid", "0");
    url.searchParams.set("campid", EPN_CAMPID);
    url.searchParams.set("toolid", "10001");
    url.searchParams.set("mkevt", "1");
    return url.href;
  } catch (e) {
    return value;
  }
}

function setText(selector, ko, en) {
  const node = document.querySelector(selector);
  if (node) node.textContent = t(ko, en);
}

function setHtml(selector, ko, en) {
  const node = document.querySelector(selector);
  if (node) node.innerHTML = t(ko, en);
}

function packName(pack) {
  return state.hl === "en" ? pack.nameEn || pack.nameKo || pack.code : pack.nameKo || pack.nameEn || pack.code;
}

function packSubName(pack) {
  return state.hl === "en" ? pack.nameKo || "" : pack.nameEn || "";
}

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

// 글로벌 표기: 달러 메인 + 원화·엔화 병기. 원본 통화는 환산 기준점으로만 사용.
function triMain(value, currency) {
  const fx = (state.data && state.data.fx) || {};
  if (value == null) return { usd: null, krw: null, jpy: null, main: "-", sub: "" };
  const krw = marketKrw(value, currency);
  const usd = currency === "USD" ? value : krw / (fx.usdKrw || 1388.2);
  const jpy = currency === "JPY" ? value : krw / (fx.jpyKrw || 9.1);
  return { usd, krw, jpy, main: fmtUsd(usd), sub: `${fmtKrw(krw)} · ${fmtJpy(jpy)}` };
}

function priceBandRows(market) {
  const rows = [
    ["High", market.high],
    ["Middle", market.middle],
    ["Low", market.low],
  ];

  return rows
    .map(([label, value]) => {
      const t = triMain(value, market.currency);
      return `
        <span class="bandRow">
          <i>${label}</i>
          <b>${t.main}</b>
          <small>${t.sub}</small>
        </span>`;
    })
    .join("");
}

const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='110'><rect width='100%' height='100%' rx='8' fill='%231a1e28'/><text x='50%' y='52%' fill='%23566' font-size='11' text-anchor='middle' font-family='sans-serif'>이미지</text></svg>",
  );

const DATA_URLS = [
  "data/onepiece-packs.json",
  "https://opboxindex.com/data/onepiece-packs.json",
];
const SITE_BASE = "https://opboxindex.com";
const DATA_VERSION = "20260706seo2";

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
  if (state.hasExplicitSet) params.set("set", state.selected);
  if (state.lang !== "jp") params.set("lang", state.lang);
  if (state.view !== "hits") params.set("view", state.view);
  if (state.hl === "en") params.set("hl", "en");
  history[replace ? "replaceState" : "pushState"](
    { selected: state.selected, lang: state.lang, view: state.view, hl: state.hl },
    "",
    location.pathname + "?" + params,
  );
}

function upsertHreflang(pack) {
  document.querySelectorAll('link[rel="alternate"][hreflang]').forEach((node) => node.remove());
  const baseParams = new URLSearchParams();
  if (state.hasExplicitSet) baseParams.set("set", pack.key);
  if (state.lang !== "jp") baseParams.set("lang", state.lang);
  [["en", "en"], ["ko", "ko"], ["x-default", "en"]].forEach(([lang, hl]) => {
    const params = new URLSearchParams(baseParams);
    if (hl) params.set("hl", hl);
    const link = document.createElement("link");
    link.rel = "alternate";
    link.hreflang = lang;
    link.href = SITE_BASE + "/packs.html?" + params;
    link.dataset.ktcgHreflang = "true";
    document.head.appendChild(link);
  });
}

function ebayQueryFor(pack) {
  const parts = ["One Piece Card Game", pack.code, pack.nameEn, "Booster Box", "Japanese", "sealed"];
  return parts.filter(Boolean).join(" ");
}

function ebayLinks(pack) {
  const q = encodeURIComponent(ebayQueryFor(pack));
  const base = `https://www.ebay.com/sch/i.html?_nkw=${q}`;
  const market = pack.set?.boxMarket?.jp?.ebayActive;
  const best = market?.bestListing;
  const bestUrl = epnUrl(safeEbayUrl(best?.url));
  const bestPrice = best?.total != null ? triMain(best.total, best.currency).main : "";
  // 실데이터 기반 할인 배지: 최저 매물이 중간 호가보다 3% 이상 싸면 표시(추정 금지)
  let dealChip = "";
  if (best?.total != null && market?.middle != null) {
    const b = marketKrw(best.total, best.currency);
    const mid = marketKrw(market.middle, market.currency);
    if (b != null && mid != null && b < mid * 0.97) {
      dealChip = `<em class="dealChip">-${Math.round((1 - b / mid) * 100)}% ${t("중간호가 대비", "vs mid ask")}</em>`;
    }
  }
  return `
    <div class="marketLinks" aria-label="eBay market links">
      ${bestUrl ? `<a class="featured" href="${bestUrl}" target="_blank" rel="noopener noreferrer sponsored" title="${t(`${market?.updated || ""} 새벽 수집 매물 — 싼 매물은 빨리 팔려 품절일 수 있습니다`, `Captured ${market?.updated || ""} (daily refresh) — cheap listings sell fast and may be gone`)}">${t("최저가 박스 구매", "Get the lowest box")} · <b>${bestPrice}</b><span class="ctaArrow">↗</span>${dealChip}${market?.updated ? `<em class="asOf">${t(`${market.updated.slice(5)} 기준`, `as of ${market.updated.slice(5)}`)}</em>` : ""}</a>` : ""}
      <a href="${epnUrl(`${base}&LH_Sold=1&LH_Complete=1&_sop=13`)}" target="_blank" rel="noopener noreferrer sponsored">eBay Sold</a>
      <a href="${epnUrl(`${base}&LH_BIN=1&_sop=15`)}" target="_blank" rel="noopener noreferrer sponsored">eBay Active</a>
      <span class="paidLinkTag">Paid Link</span>
    </div>`;
}

function cardPsaSearchUrl(card) {
  const query = ["One Piece Card Game", card.number, card.name, "PSA 10", "Japanese"].filter(Boolean).join(" ");
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_BIN=1&_sop=15`;
}

function cardBuyLinks(card) {
  const best = card.psa10Active?.bestListing;
  const bestUrl = epnUrl(safeEbayUrl(best?.url));
  const searchUrl = epnUrl(cardPsaSearchUrl(card));
  if (bestUrl) {
    const price = best.total != null ? triMain(best.total, best.currency).main : "";
    const country = best.country ? ` · ${escapeHtml(best.country)}` : "";
    // 실데이터 기반 배지: 최저 매물이 최근 실거래(Sold) 중간값보다 낮을 때만 표시
    let dealChip = "";
    if (best.total != null && card.psa10Ebay?.soldBased && card.psa10Ebay.middle != null) {
      const b = marketKrw(best.total, best.currency);
      const sold = marketKrw(card.psa10Ebay.middle, card.psa10Ebay.currency);
      if (b != null && sold != null && b < sold) {
        dealChip = `<em class="dealChip">${t("최근 실거래가 아래", "below recent sold")}</em>`;
      }
    }
    return `<div class="buyLinks"><a class="buyLink verified" href="${bestUrl}" target="_blank" rel="noopener noreferrer sponsored">${t("PSA10 최저가 구매", "Buy lowest PSA 10")} · <b>${price}</b><span class="ctaArrow">↗</span>${dealChip}</a><small>Paid Link · ${t("검수 완료 · 배송 포함", "verified · incl. shipping")}${country}${card.psa10Active?.updated ? ` · ${t(`${card.psa10Active.updated.slice(5)} 기준`, `as of ${card.psa10Active.updated.slice(5)}`)}` : ""}</small></div>`;
  }
  return `<div class="buyLinks"><a class="buyLink" href="${searchUrl}" target="_blank" rel="noopener noreferrer sponsored">${t("PSA10 매물 찾기", "Find PSA 10 listings")}<span class="ctaArrow">↗</span></a><small>Paid Link · ${t("검수 매물 수집 대기", "Verified listing pending")}</small></div>`;
}

function scoreLabel(score) {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function scoreClass(score) {
  if (score >= 70) return "good";
  if (score >= 45) return "watch";
  return "risk";
}

function pressureClass(score) {
  if (score >= 80) return "risk";
  if (score >= 60) return "watch";
  return "good";
}

function boxMidKrw(set) {
  const active = set.boxMarket?.jp?.ebayActive;
  const activeMid = active?.middle != null ? marketKrw(active.middle, active.currency) : null;
  if (activeMid != null) {
    return {
      value: activeMid,
      source: "eBay Active",
      sampleSize: active.sampleSize || 0,
      soldBased: false,
      updated: active.updated || "",
    };
  }

  const points = set.boxSeries?.points || [];
  const last = points[points.length - 1];
  if (last?.p != null) {
    return {
      value: last.p,
      source: "eBay Sold",
      sampleSize: last.n || 0,
      soldBased: true,
      updated: last.d || "",
    };
  }

  return null;
}

function recentSoldBoxKrw(set) {
  const points = (set.boxSeries?.points || [])
    .filter((point) => point?.d && Number.isFinite(point.p))
    .slice()
    .sort((a, b) => a.d.localeCompare(b.d));
  const last = points[points.length - 1];
  return last ? { value: last.p, date: last.d, sampleSize: last.n || 0 } : null;
}

function cardComparableKrw(card) {
  if (card.japaneseNmEbay?.sampleSize > 0 && card.japaneseNmEbay.middle != null) {
    return {
      value: marketKrw(card.japaneseNmEbay.middle, card.japaneseNmEbay.currency),
      source: "일본판 NM eBay",
      sampleSize: card.japaneseNmEbay.sampleSize || 0,
      confidence: card.japaneseNmEbay.confidence || "C",
    };
  }
  if (card.nmJpy != null) {
    const fx = (state.data && state.data.fx) || {};
    return {
      value: card.nmJpy * (fx.jpyKrw || 9.1),
      source: "일본판 NM",
      sampleSize: 1,
      confidence: "C",
    };
  }
  return null;
}


function setAnalytics(set) {
  const cards = (set.cards || []).slice(0, 10);
  const box = boxMidKrw(set);
  const soldBox = recentSoldBoxKrw(set);
  const pricedCards = cards
    .map((card) => ({ card, market: cardComparableKrw(card) }))
    .filter((row) => row.market?.value != null)
    .sort((a, b) => b.market.value - a.market.value);

  const top1 = pricedCards[0]?.market.value || 0;
  const top3Avg = pricedCards.slice(0, 3).reduce((sum, row) => sum + row.market.value, 0) / Math.max(1, Math.min(3, pricedCards.length));
  const top10Avg = pricedCards.reduce((sum, row) => sum + row.market.value, 0) / Math.max(1, pricedCards.length);
  const hitPower = top1 * 0.4 + top3Avg * 0.3 + top10Avg * 0.3;
  const supportRatio = box?.value ? hitPower / box.value : null;

  const boxMarket = set.boxMarket?.jp?.ebayActive;
  const spreadRatio = boxMarket?.high != null && boxMarket?.low != null && boxMarket.middle
    ? (marketKrw(boxMarket.high, boxMarket.currency) - marketKrw(boxMarket.low, boxMarket.currency)) / marketKrw(boxMarket.middle, boxMarket.currency)
    : null;

  const liquidityScore = Math.min(100, Math.round(((box?.sampleSize || 0) / 10) * 55 + (pricedCards.length / 10) * 45));
  const cardPowerScore = supportRatio == null ? 0 : Math.min(100, Math.round(supportRatio * 24));
  const demand = soldDemandStats(set);
  const supply = supplyPressureStats(set);
  const valuation = valuationStats({ box, soldBox, supportRatio, demand, supply, spreadRatio });
  const confidencePenalty = pricedCards.filter((row) => row.market.confidence === "C").length * 3;
  const riskPenalty = (spreadRatio != null && spreadRatio > 0.45 ? 12 : 0) + (!box?.soldBased ? 8 : 0) + confidencePenalty;
  const investmentScore = Math.max(0, Math.min(100, Math.round(cardPowerScore * 0.42 + liquidityScore * 0.24 + demand.score * 0.2 + supply.score * 0.14 - riskPenalty)));

  const risks = [];
  if (supply.score >= 82) risks.push(supply.label);
  if (demand.score <= 25) risks.push(demand.label);
  if (!box) risks.push(t("박스가 없음", "No box price"));
  else if (!box.soldBased) risks.push(t("호가 기준(실거래 아님)", "Listing price, not sold"));
  if ((box?.sampleSize || 0) < 3) risks.push(t("박스 표본 부족", "Few box samples"));
  if (spreadRatio != null && spreadRatio > 0.45) risks.push(t("가격 편차 큼", "Wide price spread"));
  if (pricedCards.length < 5) risks.push(t("카드 표본 부족", "Few card samples"));
  if (pricedCards.some((row) => row.market.confidence === "C")) risks.push(t("일부 카드가 불확실", "Some card prices uncertain"));
  if (!risks.length) risks.push(t("큰 리스크 없음", "No notable risks"));

  return { box, soldBox, pricedCards, hitPower, supportRatio, liquidityScore, cardPowerScore, demand, supply, valuation, investmentScore, spreadRatio, risks };
}

function renderBoxSeries(set) {
  const s = set.boxSeries;
  const pts = (s && s.points) || [];
  if (pts.length < 2) return "";
  const W = 600, H = 200, padL = 46, padR = 14, padT = 16, padB = 18;
  const sm = pts.map((p, i) => {
    let sw = 0, sv = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(pts.length - 1, i + 1); j++) {
      const w = (pts[j].n || 1) * (j === i ? 1.6 : 1);
      sw += w; sv += pts[j].p * w;
    }
    return Math.round(sv / sw);
  });
  const xs = pts.map((p) => new Date(p.d).getTime());
  const ys = sm;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const yPad = Math.max(1, (maxY - minY) * 0.12);
  const scaleX = (x) => padL + ((x - minX) / Math.max(1, maxX - minX)) * (W - padL - padR);
  const scaleY = (y) => padT + (1 - (y - (minY - yPad)) / Math.max(1, maxY - minY + yPad * 2)) * (H - padT - padB);
  const coords = xs.map((x, i) => `${scaleX(x).toFixed(1)},${scaleY(ys[i]).toFixed(1)}`);
  const area = `M${coords[0]} L${coords.slice(1).join(" L")} L${scaleX(xs[xs.length - 1]).toFixed(1)},${H - padB} L${scaleX(xs[0]).toFixed(1)},${H - padB} Z`;
  const last = pts[pts.length - 1];
  const fmtD = (d) => d.slice(5).replace("-", "/");
  // Y축 눈금 3줄: 최저·중간·최고 (달러 라벨 + 점선 그리드)
  const yTicks = [minY, Math.round((minY + maxY) / 2), maxY].map((v) => ({ v, y: scaleY(v), label: triMain(v, "KRW").main }));
  const grid = yTicks.map((tk) => `<line x1="${padL}" y1="${tk.y.toFixed(1)}" x2="${W - padR}" y2="${tk.y.toFixed(1)}" class="bcGrid"></line><text x="${padL - 6}" y="${(tk.y + 3.5).toFixed(1)}" class="bcYLabel" text-anchor="end">${tk.label}</text>`).join("");
  // X축 월 눈금: 월이 바뀌는 첫 포인트마다 세로 눈금 + 라벨
  const monthNamesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let prevMonth = -1;
  const monthTicks = pts.map((p, i) => {
    const m = new Date(p.d).getMonth();
    if (m === prevMonth) return "";
    prevMonth = m;
    if (i === 0) return ""; // 시작점 라벨은 하단 축에 이미 있음
    const x = scaleX(xs[i]).toFixed(1);
    return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" class="bcGridV"></line><text x="${x}" y="${H - padB + 11}" class="bcXLabel" text-anchor="middle">${t(`${m + 1}월`, monthNamesEn[m])}</text>`;
  }).join("");
  // 점: Sold=채움, Active=빈원. 점마다 네이티브 툴팁(날짜·가격·표본).
  const dots = pts.map((p, i) => {
    const [x, y] = coords[i].split(",");
    const isActive = p.basis === "active";
    const isLast = i === pts.length - 1;
    const tip = `${fmtD(p.d)} · ${triMain(sm[i], "KRW").main} · ${isActive ? t(`매물 ${p.n}건`, `${p.n} listings`) : t(`판매 ${p.n}건`, `${p.n} sold`)}`;
    return `<circle cx="${x}" cy="${y}" r="${isLast ? 5 : 3.2}" class="bcDot${isActive ? " bcDotActive" : ""}${isLast ? " bcDotLast" : ""}"><title>${tip}</title></circle>`;
  }).join("");
  // 마지막 점 옆 현재가 태그
  const [lx, ly] = coords[coords.length - 1].split(",").map(Number);
  const tagX = Math.min(lx, W - padR - 52);
  const lastTag = `<g class="bcTag"><rect x="${(tagX - 4).toFixed(1)}" y="${(ly - 26).toFixed(1)}" rx="4" width="56" height="17"></rect><text x="${(tagX + 24).toFixed(1)}" y="${(ly - 13.5).toFixed(1)}" text-anchor="middle">${triMain(last.p, "KRW").main}</text></g>`;
  return `<div class="boxChart"><div class="bcHead"><span class="bmLabel">${t("박스 시세 추이 · 최근 6개월", "Box price trend · last 6 months")}</span><strong>${triMain(last.p, "KRW").main} <small style="font-weight:400;opacity:.7">${triMain(last.p, "KRW").sub}</small></strong></div><svg viewBox="0 0 ${W} ${H}" class="bcSvg" role="img" aria-label="${t("박스 시세 추이 그래프", "Box price trend chart")}">${grid}${monthTicks}<path d="${area}" class="bcArea"></path><polyline points="${coords.join(" ")}" class="bcLine"></polyline>${dots}${lastTag}</svg><div class="bcAxis"><span>${fmtD(pts[0].d)}</span><span class="bcLegend"><i class="lgSold"></i>${t("판매 완료(주간 중앙값)", "Sold (weekly median)")}<i class="lgActive"></i>${t("현재 매물 스냅샷", "Active listing snapshot")}</span><span>${fmtD(last.d)}</span></div><p class="note">${t("표본이 적은 주는 변동이 큽니다. 단일 박스·배송 제외 기준. 점에 마우스를 올리면 날짜·가격·표본이 보입니다.", "Weeks with few samples swing more. Single box, excl. shipping. Hover a dot for date, price and sample size.")}</p></div>`;
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

// returns normalized pack list for current language:
// [{key, code, nameKo, nameEn, set}]  (set = the underlying sets[baseCode] record)
function currentPacks() {
  const d = state.data;
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

function bindLangTabs() {
  document.querySelectorAll(".langTab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === state.lang);
    btn.onclick = () => {
      if (state.lang === btn.dataset.lang) return;
      state.lang = btn.dataset.lang;
      state.hasExplicitSet = true;
      document.querySelectorAll(".langTab").forEach((b) => b.classList.toggle("active", b === btn));
      selectFirstOfLang();
      renderPackGrid();
      renderDetail();
      updateUrl();
      trackEvent("select_language", { language: state.lang });
    };
  });
}

function renderHitList(cards) {
  const cells = cards
    .map((c, index) => {
      const color = rarityColor[c.rarity] || "#8d95a7";
      const img = c.img || FALLBACK;
      return `
        <figure class="hitCard" data-card-index="${index}" data-img="${img}" data-name="${(c.name || "").replace(/"/g, "&quot;")}">
          <div class="hitThumb">
            <span class="hitRank">${c.rank}</span>
            ${c.rarity ? `<span class="hitRar" style="--c:${color}">${c.rarity}</span>` : ""}
            <img src="${img}" alt="${c.name}" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" />
          </div>
          <figcaption>
            <span class="hitName">${c.name}</span>
            <span class="hitNo">${c.number || ""}</span>
            ${priceLines(c)}
            ${cardBuyLinks(c)}
          </figcaption>
        </figure>`;
    })
    .join("");
  return `<div class="hitGallery">${cells}</div>`;
}


window.addEventListener("popstate", () => {
  applyRouteState();
  bindLangTabs();
  applyStaticI18n();
  renderPackGrid();
  renderDetail();
});

// Clean display layer override. The dataset is preserved; only UI text/SEO/render labels are normalized.
function applyStaticI18n() {
  document.documentElement.lang = state.hl === "en" ? "en" : "ko";
  document.body?.classList.toggle("hl-en", state.hl === "en");
  setText(".brand small", "원피스 부스터팩 리서치", "One Piece Booster Box Research");
  setText('.topbar .nav a[href="packs.html"]', "부스터팩", "Booster Packs");
  setText('.topbar .nav a[href^="amazon-lottery.html"]', "아마존 응모", "Amazon Raffle");
  setText('.topbar .nav a[href="about.html"]', "운영원칙", "Principles");
  // 아마존 응모 페이지로 현재 표시 언어 전달
  const amazonLink = document.querySelector('.topbar .nav a[href^="amazon-lottery.html"]');
  if (amazonLink) amazonLink.href = state.hl === "ko" ? "amazon-lottery.html?hl=ko" : "amazon-lottery.html";
  setHtml(
    ".packHero .lead",
    '부스터박스를 고르면 <strong>박스 시세</strong>, <strong>히트카드 TOP 10</strong>, NM·PSA10 가격과 PSA 통계를 한 화면에서 비교합니다.',
    'Pick a booster box to compare <strong>box prices</strong>, <strong>Top 10 chase cards</strong>, NM / PSA 10 prices and PSA population data in one view.',
  );
  setHtml(
    ".introPanel",
    `<strong>OP Box Index — 원피스 미개봉 부스터박스 가격·히트카드 리서치</strong>
      <p>일본어판 원피스 부스터박스별 주요 카드, 박스 거래 흐름, PSA 통계, 저평가/고평가 구간을 빠르게 비교합니다.</p>
      <details class="introMore">
        <summary>볼 수 있는 것 · 출처</summary>
        <ul>
          <li><b>박스 시세</b> — eBay Active와 Sold 흐름, High / Middle / Low</li>
          <li><b>히트카드 TOP 10</b> — 박스별 고가 카드 이미지, 번호, 레어도</li>
          <li><b>카드 시세</b> — 일본판 NM, 일본어판 PSA10 eBay Sold, 영문판 NM</li>
          <li><b>PSA 통계</b> — PSA10·PSA9 수량과 PSA10 비율</li>
          <li><b>밸류 구간</b> — 최근 실거래 대비 저평가/고평가 참고 지표</li>
        </ul>
        <p class="introMeta">출처 — TOP10 구성/박스 참고 TCG Quant · 일본판 NM 유유테이/카드러시 · PSA10/박스 eBay · 이미지 TCGplayer · PSA 통계 GemRate. 투자 참고용이며 매수 추천이 아닙니다.</p>
      </details>`,
    `<strong>OP Box Index — One Piece sealed booster box and chase-card research</strong>
      <p>Compare Japanese One Piece booster boxes, key chase cards, box market flow, PSA population stats and valuation ranges.</p>
      <details class="introMore">
        <summary>What you get · sources</summary>
        <ul>
          <li><b>Box prices</b> — eBay Active and Sold flow, High / Middle / Low</li>
          <li><b>Top 10 chase cards</b> — key card images, numbers and rarities by box</li>
          <li><b>Card prices</b> — Japanese NM, Japanese PSA 10 eBay Sold and English NM</li>
          <li><b>PSA stats</b> — PSA 10 / PSA 9 counts and PSA 10 rate</li>
          <li><b>Valuation range</b> — under/overvaluation signal versus recent sold prices</li>
        </ul>
        <p class="introMeta">Sources — TCG Quant for Top 10 / box reference · Yuyu-tei / Cardrush for Japanese NM · eBay for PSA 10 and box market · TCGplayer images · GemRate PSA stats. Reference only, not investment advice.</p>
      </details>`,
  );
  const jpTab = document.querySelector('.langTab[data-lang="jp"]');
  if (jpTab) jpTab.innerHTML = `${t("일본판", "Japanese")} <small id="statJp"></small>`;
  const extraTab = document.querySelector('.langTab[data-lang="extra"]');
  if (extraTab) extraTab.innerHTML = `${t("EB·PRB", "EB / PRB")} <small id="statExtra"></small>`;
  setText("#adsenseTopAd .adLabel", "Google AdSense 광고 자리", "Google AdSense slot");
  document.querySelectorAll(".adDisclosure").forEach((node) => {
    node.textContent = t("이 페이지에는 Google AdSense 광고가 표시될 수 있습니다.", "This page may show Google AdSense ads.");
  });
  setText(".packSection > .note", "신규 세트는 시세 데이터가 준비되는 대로 반영됩니다. 모든 가격은 참고값입니다.", "New sets appear once price data is ready. All prices are reference values.");
  setText(".footer p", "OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.", "OP Box Index is a data-driven research site, not investment advice.");
  setText(
    ".footer .affDisclosure",
    "Paid Link: eBay 링크를 통한 적격 구매가 발생하면 OP Box Index가 수수료를 받을 수 있습니다. 구매 비용은 추가되지 않습니다.",
    "Paid Link: As an eBay Partner, OP Box Index may earn a commission from qualifying purchases made through eBay links, at no extra cost to you.",
  );
  const btn = document.querySelector("#displayLangToggle");
  if (btn) btn.textContent = state.hl === "en" ? "한국어" : "EN";
}

function bindDisplayLanguage() {
  const nav = document.querySelector(".topbar .nav");
  if (!nav) return;
  let btn = document.querySelector("#displayLangToggle");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "displayLangToggle";
    btn.type = "button";
    btn.style.cssText = "border:1px solid rgba(255,255,255,.16);background:#14171c;color:#eef2ff;border-radius:8px;padding:8px 10px;font-weight:800;cursor:pointer";
    nav.appendChild(btn);
  }
  btn.onclick = () => {
    state.hl = state.hl === "en" ? "ko" : "en";
    try { localStorage.setItem("ktcg_hl", state.hl); } catch (e) {}
    state.renderedLang = null;
    applyStaticI18n();
    renderPackGrid();
    renderDetail();
    updateUrl(true);
    trackEvent("select_hl", { hl: state.hl });
  };
  applyStaticI18n();
}

function priceVenueLabel(venue) {
  if (!venue) return t("유유테이", "Yuyu-tei");
  if (venue.includes("遊々亭") || venue.includes("유유테이")) return t("유유테이", "Yuyu-tei");
  if (/cardrush|카드러시|カードラッシュ/i.test(venue)) return t("카드러시", "Cardrush");
  return venue;
}

function priceLines(c) {
  let h = "";
  if (c.nmJpy != null) {
    const p = triMain(c.nmJpy, "JPY");
    h += `<span class="pl nm"><i>${t("일본판 NM", "Japanese NM")}</i> <b>${p.main}</b> <small>${p.sub} <em>${priceVenueLabel(c.nmVenue)}</em></small></span>`;
  }
  if (c.psa10Usd != null) {
    const p = triMain(c.psa10Usd, "USD");
    const d = c.psa10Date ? c.psa10Date.slice(2).replace(/-/g, ".") : "";
    h += `<span class="pl psa"><i>${t("일본어판 PSA10", "Japanese PSA 10")}</i> <b>${p.main}</b> <small>${p.sub}${d ? " · " + d : ""} <em>${c.psa10Venue || "PSA/eBay"}</em></small></span>`;
  } else if (c.psa10Ebay?.sampleSize > 0) {
    h += `<span class="pl psaEbay"><i>${t("일본어판 PSA10 eBay", "Japanese PSA 10 eBay")}</i><span class="bandRows">${priceBandRows(c.psa10Ebay)}</span><small>eBay Sold · ${t(`표본 ${c.psa10Ebay.sampleSize}건`, `${c.psa10Ebay.sampleSize} samples`)}</small></span>`;
  } else {
    h += `<span class="pl psaNone"><i>${t("일본어판 PSA10", "Japanese PSA 10")}</i> <small>${t("Sold 표본 없음", "No sold sample")}</small></span>`;
  }
  // PSA10 프리미엄: 같은 카드 PSA10 실거래(Sold) ÷ NM 시세. 실측 나눗셈만 — 표본 3건 미만·비정상 배율은 숨김(정확도 원칙).
  if (c.nmJpy != null && c.psa10Ebay?.soldBased && c.psa10Ebay.middle != null && (c.psa10Ebay.sampleSize || 0) >= 3) {
    const nmK = marketKrw(c.nmJpy, "JPY");
    const p10K = marketKrw(c.psa10Ebay.middle, c.psa10Ebay.currency || "KRW");
    if (nmK > 0 && p10K > 0) {
      const prem = p10K / nmK;
      if (prem >= 0.8 && prem <= 30) {
        h += `<span class="pl premium"><i>${t("PSA10 프리미엄", "PSA 10 premium")}</i> <b>×${prem.toFixed(1)}</b> <small>${t(`NM 대비 · Sold ${c.psa10Ebay.sampleSize}건 기준`, `vs NM raw · ${c.psa10Ebay.sampleSize} solds`)}</small></span>`;
      }
    }
  }
  if (c.englishNmEbay?.sampleSize > 0) {
    h += `<span class="pl psaEbay"><i>${t("영문판 NM eBay", "English NM eBay")}</i><span class="bandRows">${priceBandRows(c.englishNmEbay)}</span><small>eBay Active · ${t(`표본 ${c.englishNmEbay.sampleSize}건`, `${c.englishNmEbay.sampleSize} samples`)}</small></span>`;
  }
  return h ? `<div class="priceLines">${h}</div>` : "";
}

function soldDemandStats(set) {
  const points = (set.boxSeries?.points || []).filter((point) => point?.d && Number.isFinite(point.n)).slice().sort((a, b) => a.d.localeCompare(b.d));
  const recent = points.slice(-4);
  const previous = points.slice(-8, -4);
  const recentSales = recent.reduce((sum, point) => sum + (point.n || 0), 0);
  const previousSales = previous.reduce((sum, point) => sum + (point.n || 0), 0);
  const trend = previousSales > 0 ? (recentSales - previousSales) / previousSales : recentSales > 0 ? 1 : 0;
  const score = Math.max(0, Math.min(100, Math.round(recentSales * 10 + trend * 22)));
  const label = recentSales >= 8 && trend >= 0.15 ? t("수요 강세", "Strong demand") : recentSales >= 5 ? t("수요 양호", "Healthy demand") : recentSales <= 2 ? t("수요 부진", "Weak demand") : trend < -0.25 ? t("수요 둔화", "Cooling demand") : t("수요 보통", "Steady demand");
  return { score, label, recentSales, previousSales, trend };
}

function supplyPressureStats(set) {
  const active = set.boxMarket?.jp?.ebayActive;
  const activeCount = active?.sampleSize || 0;
  const excludedCount = active?.excludedCount || 0;
  const score = activeCount <= 2 ? 95 : activeCount <= 5 ? 82 : activeCount <= 10 ? 65 : activeCount <= 18 ? 42 : 22;
  const label = activeCount <= 2 ? t("매물 희소", "Very scarce") : activeCount <= 5 ? t("매물 부족", "Scarce") : activeCount <= 10 ? t("다소 부족", "Somewhat scarce") : activeCount <= 18 ? t("매물 보통", "Moderate") : t("매물 충분", "Ample");
  return { score, label, activeCount, excludedCount };
}

function valuationStats({ box, soldBox, supportRatio, demand, supply, spreadRatio }) {
  const current = box?.value || null;
  const sold = soldBox?.value || null;
  const soldGap = current && sold ? (sold - current) / sold : null;
  let score = 50;
  if (soldGap != null) score += soldGap >= 0.25 ? 30 : soldGap >= 0.1 ? 18 : soldGap <= -0.25 ? -25 : soldGap <= -0.1 ? -12 : 0;
  if (supportRatio != null) score += supportRatio >= 6 ? 28 : supportRatio >= 3 ? 18 : supportRatio >= 1.5 ? 8 : supportRatio < 0.8 ? -14 : 0;
  if (demand.score >= 70) score += 10; else if (demand.score <= 25) score -= 10;
  if (supply.score >= 65) score += 8; else if (supply.score <= 25) score -= 5;
  if (spreadRatio != null && spreadRatio > 0.45) score -= 12;
  if (box && !box.soldBased) score -= 6;
  const reliabilityRisk = (spreadRatio != null && spreadRatio > 0.45) || (box && !box.soldBased);
  score = Math.max(0, Math.min(reliabilityRisk ? 88 : 100, Math.round(score)));
  const label = score >= 75 && reliabilityRisk ? t("저평가 후보", "Undervalued candidate") : score >= 75 ? t("저평가", "Undervalued") : score >= 62 ? t("저평가 후보", "Undervalued candidate") : score >= 42 ? t("적정 구간", "Fair range") : score >= 28 ? t("고평가 주의", "Overvaluation risk") : t("고평가", "Overvalued");
  const tone = score >= 62 ? "good" : score >= 42 ? "watch" : "risk";
  const gapText = soldGap == null ? t("실거래 비교 없음", "No sold comparison") : `${soldGap >= 0 ? "+" : ""}${Math.round(soldGap * 100)}%`;
  const gapDirectionText = soldGap == null ? t("실거래 비교 없음", "no sold comparison") : soldGap >= 0 ? t(`최근 실거래가보다 ${Math.round(soldGap * 100)}% 낮은`, `${Math.round(soldGap * 100)}% below recent sold`) : t(`최근 실거래가보다 ${Math.abs(Math.round(soldGap * 100))}% 높은`, `${Math.abs(Math.round(soldGap * 100))}% above recent sold`);
  return { score, label, tone, soldGap, gapText, gapDirectionText, current, sold };
}

function renderSetAnalytics(set) {
  const a = setAnalytics(set);
  const support = a.supportRatio == null ? "-" : `${a.supportRatio.toFixed(1)}x`;
  const spread = a.spreadRatio == null ? "-" : `${Math.round(a.spreadRatio * 100)}%`;
  const demandTrend = a.demand.trend > 0 ? `+${Math.round(a.demand.trend * 100)}%` : `${Math.round(a.demand.trend * 100)}%`;
  const valuationSentence = a.valuation.soldGap == null ? t("최근 Sold 자료가 부족해 카드값·공급·수요 중심으로 봅니다.", "Recent sold data is limited, so the signal leans on card value, supply and demand.") : t(`현재 박스가는 ${a.valuation.gapDirectionText} 수준입니다.`, `The current box price is ${a.valuation.gapDirectionText}.`);
  return `<div class="quantPanel">
    <div class="valuationBanner ${a.valuation.tone}"><span>${t("밸류 구간", "Valuation range")}</span><strong>${a.valuation.label}<small>${a.valuation.score}/100</small></strong><p>${valuationSentence}</p><small>${t("현재", "Current")} ${a.valuation.current ? triMain(a.valuation.current, "KRW").main : "-"} · ${t("최근 Sold", "Recent sold")} ${a.valuation.sold ? triMain(a.valuation.sold, "KRW").main : "-"}</small></div>
    <div class="quantMetric ${scoreClass(a.investmentScore)}"><span>${t("투자 매력도", "Investment appeal")}</span><strong>${a.investmentScore}<small>/100 · ${scoreLabel(a.investmentScore)}</small></strong><small>${t("카드값·수요·공급·위험 종합", "Card value, demand, supply and risk")}</small></div>
    <div class="quantMetric ${scoreClass(a.cardPowerScore)}"><span>${t("카드 지지력", "Card support")}</span><strong>${support}</strong><small>${t("박스값 대비 TOP10 카드 시세", "Top 10 card value vs. box price")}</small></div>
    <div class="quantMetric ${scoreClass(a.liquidityScore)}"><span>${t("데이터 신뢰도", "Data confidence")}</span><strong>${a.liquidityScore}<small>/100 · ${scoreLabel(a.liquidityScore)}</small></strong><small>${t(`표본: 박스 ${a.box?.sampleSize || 0}건 · 카드 ${a.pricedCards.length}장`, `Samples: ${a.box?.sampleSize || 0} boxes · ${a.pricedCards.length} cards`)}</small></div>
    <div class="quantMetric ${pressureClass(a.supply.score)}"><span>${t("매물 희소성", "Scarcity")}</span><strong>${a.supply.score}<small>/100 · ${a.supply.label}</small></strong><small>${t(`현재 매물 ${a.supply.activeCount}건`, `${a.supply.activeCount} active listings`)}</small></div>
    <div class="quantMetric ${scoreClass(a.demand.score)}"><span>${t("수요 강도", "Demand")}</span><strong>${a.demand.score}<small>/100 · ${a.demand.label}</small></strong><small>${t(`최근 4주 ${a.demand.recentSales}건 · ${demandTrend}`, `${a.demand.recentSales} sold in 4 weeks · ${demandTrend}`)}</small></div>
    <div class="quantMetric ${a.spreadRatio != null && a.spreadRatio > 0.45 ? "risk" : "watch"}"><span>${t("가격 편차", "Price spread")}</span><strong>${spread}</strong><small>${t("동일 박스 최고·최저가 차이", "High-low gap for the same box")}</small></div>
    <div class="analysisSummary"><h3>${t("분석 요약", "Analysis summary")}</h3><p>${valuationSentence}</p><p>${t(`최근 4주 판매 ${a.demand.recentSales}건, 이전 대비 ${demandTrend}.`, `${a.demand.recentSales} sold in the last 4 weeks, ${demandTrend} vs. prior.`)}</p><p>${t(`현재 매물 ${a.supply.activeCount}건으로 ${a.supply.label} 상태입니다.`, `${a.supply.activeCount} active listings: ${a.supply.label}.`)}</p><p>${t(`카드 지지력은 박스값의 ${support}입니다.`, `Card support is ${support} of the box price.`)}</p></div>
    <div class="analysisBreakdown"><span><b>${t("매물", "Supply")}</b><small>${t(`현재 ${a.supply.activeCount}건 · 제외 ${a.supply.excludedCount}건`, `${a.supply.activeCount} listed · ${a.supply.excludedCount} excluded`)}</small></span><span><b>${t("수요", "Demand")}</b><small>${t(`최근 4주 ${a.demand.recentSales}건`, `4wk ${a.demand.recentSales}`)}</small></span><span><b>${t("주의", "Watch")}</b><small>${a.risks.slice(0, 3).join(" · ")}</small></span></div>
    <p class="quantNote">${t("모든 지표는 투자 참고용입니다. 가격 표본이 적거나 Active 호가 비중이 크면 보수적으로 해석하세요.", "All signals are for reference only. Treat them conservatively when samples are thin or listings dominate.")}</p>
  </div>`;
}

function renderBoxMarket(set) {
  const market = set.boxMarket?.jp?.ebayActive;
  if (!market) return `<div class="boxMarket"><div class="bmHead"><span class="bmLabel">${t("일본판 박스 eBay", "Japanese box · eBay")}</span><strong>${t("가격 수집 대기", "Collecting price")}</strong></div></div>`;
  return `<div class="boxMarket"><div class="bmHead"><span class="bmLabel">${t("일본판 박스 eBay Active", "Japanese box · eBay Active")}</span><small>${market.updated || t("업데이트일 미상", "date unknown")} · ${t(`표본 ${market.sampleSize || 0}건`, `${market.sampleSize || 0} samples`)}${market.excludedCount ? t(` · 제외 ${market.excludedCount}건`, ` · ${market.excludedCount} excluded`) : ""}</small></div><div class="bmRows">${priceBandRows(market)}</div><p>${t("정렬 후 하위/중앙/상위 가격대입니다. 중국권 발송지와 명확한 오탐은 제외합니다.", "Low/mid/high bands after sorting. China-region sellers and obvious mismatches are excluded.")}</p></div>`;
}

function renderSourceLegend(set) {
  const hasPsa10 = (set.cards || []).some((card) => card.psa10Usd != null || card.psa10Ebay?.sampleSize > 0);
  const hasEnglishNmEbay = (set.cards || []).some((card) => card.englishNmEbay?.sampleSize > 0);
  return `<div class="sourceLegend" aria-label="${t("가격 출처 요약", "Price sources")}"><span><b>${t("일본판 NM", "Japanese NM")}</b><small>${t("유유테이 우선 · 카드러시 보조", "Yuyu-tei first · Cardrush backup")}</small></span><span class="${hasPsa10 ? "" : "muted"}"><b>${t("일본어판 PSA10", "Japanese PSA 10")}</b><small>${hasPsa10 ? t("eBay Sold 기준", "eBay Sold") : t("확인된 가격 없음", "No verified price")}</small></span><span><b>${t("영문판 NM", "English NM")}</b><small>${hasEnglishNmEbay ? "eBay Active" : t("매칭 없음", "No match")}</small></span><span><b>${t("박스가", "Box price")}</b><small>eBay Active / Sold</small></span></div>`;
}

async function load() {
  initDisplayLanguage();
  bindDisplayLanguage();
  const isCompareOnly = !document.querySelector("#packList") && document.querySelector("#compareTable");
  try {
    state.data = await fetchPackData();
  } catch (err) {
    const target = document.querySelector("#packList") || document.querySelector("#compareTable");
    if (target) target.innerHTML = `<p class="note">${t("데이터를 불러오지 못했습니다.", "Could not load data.")} (${err.message})</p>`;
    return;
  }
  // 비교 전용 페이지(compare.html): 비교표만 렌더하고 종료
  if (isCompareOnly) {
    renderCompareTable();
    return;
  }
  applyRouteState();
  bindLangTabs();
  bindDisplayLanguage();
  renderStats();
  renderMarketStatus();
  renderTodayDeals();
  renderPackGrid();
  renderDetail();
  updateUrl(true);
}

function applyRouteState() {
  const params = new URLSearchParams(location.search);
  const requestedHl = params.get("hl");
  if (requestedHl === "en" || requestedHl === "ko") state.hl = requestedHl;
  const requestedLang = params.get("lang");
  if (["jp", "extra"].includes(requestedLang)) state.lang = requestedLang;
  const requestedSet = (params.get("set") || "").toUpperCase();
  const initialLang = state.lang;
  let pack = currentPacks().find((p) => p.key === requestedSet && (p.set.cards || []).length > 0);
  if (!pack && requestedSet) {
    for (const lang of ["jp", "extra"]) {
      state.lang = lang;
      pack = currentPacks().find((p) => p.key === requestedSet && (p.set.cards || []).length > 0);
      if (pack) break;
    }
  }
  state.hasExplicitSet = Boolean(pack && requestedSet);
  if (pack) state.selected = pack.key;
  else {
    state.lang = initialLang;
    selectFirstOfLang();
  }
  state.view = params.get("view") === "psa" ? "psa" : "hits";
}

function renderMarketStatus() {
  const el = document.querySelector("#marketStatus");
  if (!el || !state.data) return;
  const sets = Object.values(state.data.sets || {});
  const pricedSets = sets.filter((set) => (set.cards || []).length > 0).length;
  const cardCount = sets.reduce((sum, set) => sum + (set.cards || []).length, 0);
  const boxSamples = sets.reduce((sum, set) => sum + (set.boxMarket?.jp?.ebayActive?.sampleSize || 0), 0);
  const updated = state.data.updated || t("확인중", "checking");
  el.innerHTML = `<span><i></i>Market Live</span><span>Sets ${pricedSets}</span><span>Cards ${cardCount}</span><span>Box Samples ${boxSamples}</span><span>Update ${updated}</span>`;
}

// 전 세트 비교 랭킹: 20개 박스를 한 표로. 지표는 setAnalytics 실측 계산 재사용(추정 없음).
// 투자 매력도 내림차순. 박스가 없는 세트는 하단으로. 행 클릭 시 해당 세트 상세로 이동.
function renderCompareTable() {
  const el = document.querySelector("#compareTable");
  if (!el || !state.data) return;
  const packs = [...(state.data.jp?.list || []), ...(state.data.extra?.list || [])]
    .map((code) => ({ code, set: state.data.sets?.[code] }))
    .filter((p) => p.set && (p.set.cards || []).length > 0);
  if (packs.length < 3) { el.hidden = true; return; }

  const rows = packs.map((p) => {
    const a = setAnalytics(p.set);
    // top1 쏠림: 상위 카드 1장이 TOP10 시세 합의 몇 %인지 (50%+ 이면 경고)
    const vals = a.pricedCards.map((r) => r.market.value);
    const valSum = vals.reduce((s, v) => s + v, 0);
    const topShare = valSum > 0 ? vals[0] / valSum : 0;
    // 최고가 카드의 eBay 실거래(PSA10 sold, 표본 3+) — 모두가 납득하는 sold 기준 값
    let topSold = null;
    for (const c of (p.set.cards || []).slice(0, 10)) {
      if (c.psa10Ebay?.soldBased && c.psa10Ebay.middle != null && (c.psa10Ebay.sampleSize || 0) >= 3) {
        const v = marketKrw(c.psa10Ebay.middle, c.psa10Ebay.currency || "KRW");
        if (v != null && (!topSold || v > topSold.v)) topSold = { v, num: c.number || "", n: c.psa10Ebay.sampleSize };
      }
    }
    return {
      code: p.code,
      name: p.set.nameEn || p.set.nameKo || p.code,
      boxKrw: a.box?.value ?? null,
      boxSold: !!a.box?.soldBased,
      support: a.supportRatio,
      topShare,
      topSold,
      invest: a.investmentScore,
      demand: a.demand,
      supply: a.supply,
      samples: a.box?.sampleSize || 0,
    };
  }).sort((x, y) => (y.invest - x.invest) || ((y.boxKrw || 0) - (x.boxKrw || 0)));

  const scoreClassLocal = (s) => (s >= 66 ? "sHigh" : s >= 40 ? "sMid" : "sLow");
  const head = `<div class="ctHead"><span class="bmLabel">${t("전 세트 비교 · 투자 매력도 순", "All sets compared · by investment appeal")}</span><small>${t("모든 점수는 실거래·매물 데이터 기반 참고 지표", "All scores are reference signals from live sold/listing data")}</small></div>`;
  const legend = `<dl class="ctLegend">
    <div><dt>${t("박스가", "Box price")}</dt><dd>${t("현재 일본판 미개봉 박스 시세(중간값). 'ask'는 실거래가 아닌 판매자 호가 기준.", "Current Japanese sealed box price (median). 'ask' means seller listing price, not a completed sale.")}</dd></div>
    <div><dt>${t("투자 매력도", "Invest")} <em>0–100</em></dt><dd>${t("카드값·수요·희소성·데이터 신뢰도를 종합한 점수. 높을수록 데이터상 매력적. 매수 추천이 아닙니다.", "Combined score of card value, demand, scarcity and data confidence. Higher = more appealing on the data. Not buying advice.")}</dd></div>
    <div><dt>${t("최고 카드 실거래", "Top card sold")}</dt><dd>${t("이 박스 히트카드 중 최고가의 eBay 실제 판매가(PSA10, 판매 3건 이상). 호가가 아닌 진짜 팔린 값 — 가장 신뢰할 수 있는 기준.", "The box's highest chase card by actual eBay sold price (PSA 10, 3+ sales). Real completed sales, not asking prices — the most credible number here.")}</dd></div>
    <div><dt>${t("카드 지지력", "Card support")} <em>×</em></dt><dd>${t("박스 안 TOP10 카드의 '판매자 호가' 합이 박스가의 몇 배인지. 실거래가 아닌 참고치이며, '1장 쏠림' 표시는 카드 한 장이 절반 이상을 차지한다는 뜻. 봉입률 비공개라 개봉 이득 보장 아님.", "How many times the top-10 cards' seller asking prices cover the box price. Reference only (not sold data); 'top-heavy' means a single card makes up over half. Pull rates aren't public — no guaranteed open value.")}</dd></div>
    <div><dt>${t("수요", "Demand")} <em>0–100</em></dt><dd>${t("최근 4주 판매 건수와 추세. 높을수록 잘 팔리는 박스.", "Recent 4-week sold count and trend. Higher = the box is selling faster.")}</dd></div>
    <div><dt>${t("희소성", "Scarcity")} <em>0–100</em></dt><dd>${t("현재 시장에 올라온 매물이 얼마나 적은지. 높을수록 지금 구하기 어려움.", "How few boxes are listed right now. Higher = harder to find at the moment.")}</dd></div>
  </dl>`;
  const thead = `<tr>
    <th>#</th><th class="ctSet">${t("세트", "Set")}</th>
    <th>${t("박스가", "Box price")}</th>
    <th>${t("투자 매력도", "Invest")}</th>
    <th>${t("최고 카드 실거래", "Top card sold")}</th>
    <th>${t("카드 지지력", "Card support")}</th>
    <th>${t("수요", "Demand")}</th>
    <th>${t("희소성", "Scarcity")}</th></tr>`;
  const body = rows.map((r, i) => {
    const box = r.boxKrw != null ? triMain(r.boxKrw, "KRW").main : "–";
    const boxTag = r.boxKrw != null ? (r.boxSold ? "" : ` <em class="ctListing">${t("호가", "ask")}</em>`) : "";
    const topHeavy = r.support != null && r.topShare > 0.5 ? ` <em class="ctWarn" title="${t("상위 1장이 TOP10 시세 합의 절반 이상 — 한 장 의존 큼", "One card makes up over half of the top-10 value — highly top-heavy")}">${t("1장 쏠림", "top-heavy")}</em>` : "";
    const support = r.support == null ? "–" : `×${r.support.toFixed(1)}${topHeavy}`;
    const topSold = r.topSold ? `${triMain(r.topSold.v, "KRW").main} <small class="ctSoldMeta">${r.topSold.num} · PSA10 · ${t(`판매 ${r.topSold.n}건`, `${r.topSold.n} solds`)}</small>` : "–";
    return `<tr data-code="${r.code}" tabindex="0" role="button">
      <td class="ctRank">${i + 1}</td>
      <td class="ctSet"><b>${r.code}</b> <span>${r.name}</span></td>
      <td class="ctBox">${box}${boxTag}</td>
      <td><span class="ctScore ${scoreClassLocal(r.invest)}">${r.invest}</span></td>
      <td class="ctTopSold">${topSold}</td>
      <td class="ctSupport">${support}</td>
      <td><span class="ctScore ${scoreClassLocal(r.demand.score)}">${r.demand.score}</span></td>
      <td><span class="ctScore ${scoreClassLocal(r.supply.score)}">${r.supply.score}</span></td>
    </tr>`;
  }).join("");

  el.hidden = false;
  el.innerHTML = `${head}${legend}<div class="ctScroll"><table class="ctTable"><thead>${thead}</thead><tbody>${body}</tbody></table></div><p class="note">${t("클릭하면 해당 박스 상세로 이동합니다. 매수 추천이 아니라 리서치용 참고 지표입니다.", "Click a row to open that box. These are research reference signals, not buying advice.")}</p>`;

  el.querySelectorAll("tr[data-code]").forEach((tr) => {
    const go = () => {
      const code = tr.dataset.code;
      // 비교 전용 페이지(홈 상세 요소 없음)에서는 홈으로 이동
      if (!document.querySelector("#detail")) {
        location.href = `packs.html?set=${code}${state.hl === "ko" ? "&hl=ko" : ""}`;
        return;
      }
      const lang = (state.data.extra?.list || []).includes(code) ? "extra" : "jp";
      if (state.lang !== lang) { state.lang = lang; document.querySelectorAll(".langTab").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang)); }
      state.selected = code;
      state.hasExplicitSet = true;
      renderPackGrid();
      renderDetail();
      updateUrl();
      trackEvent("compare_select", { pack_code: code });
      document.querySelector("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

// 오늘의 딜: 검수된 최저 매물(배송 포함)이 중간호가보다 3%+ 낮은 박스만. 실측 나눗셈 — 표본 5건 미만 제외(정확도 원칙).
function renderTodayDeals() {
  const el = document.querySelector("#todayDeals");
  if (!el || !state.data) return;
  const deals = [];
  const codes = [...(state.data.jp?.list || []), ...(state.data.extra?.list || [])];
  for (const code of codes) {
    const set = state.data.sets?.[code];
    const m = set?.boxMarket?.jp?.ebayActive;
    const b = m?.bestListing;
    if (!m || !b || !b.url || m.middle == null || (m.sampleSize || 0) < 5) continue;
    if (!(b.total < m.middle * 0.97)) continue;
    deals.push({ code, name: set.nameEn || set.nameKo || code, total: b.total, mid: m.middle, currency: m.currency || "USD", url: b.url, off: 1 - b.total / m.middle, samples: m.sampleSize });
  }
  if (!deals.length) { el.hidden = true; el.innerHTML = ""; return; }
  deals.sort((a, b) => b.off - a.off);
  const fmt = (v, cur) => (cur === "USD" ? `$${Math.round(v).toLocaleString("en-US")}` : `${Math.round(v).toLocaleString()} ${cur}`);
  el.hidden = false;
  el.innerHTML = `
    <div class="dealsHead"><span>${t("오늘의 박스 딜", "Today's box deals")}</span><small>${t("중간호가 대비 · 배송 포함 · 검수된 매물", "vs mid ask · incl. shipping · verified listings")}</small></div>
    <div class="dealsRow">${deals.slice(0, 3).map((d) => `
      <a class="dealCard" href="${epnUrl(d.url)}" target="_blank" rel="noopener noreferrer sponsored">
        <span class="dealPct">-${Math.round(d.off * 100)}%</span>
        <span class="dealMeta"><b>${d.code}</b> ${d.name}</span>
        <span class="dealPrice">${fmt(d.total, d.currency)} <small>${t("중간호가", "mid")} ${fmt(d.mid, d.currency)} · ${t(`표본 ${d.samples}건`, `${d.samples} listings`)}</small></span>
        <span class="ctaArrow">↗</span>
      </a>`).join("")}
    </div>`;
}

function renderPackGrid() {
  const wrap = document.querySelector("#packList");
  if (state.renderedLang === `${state.lang}:${state.hl}` && wrap.children.length) {
    wrap.querySelectorAll(".packChip").forEach((btn) => btn.classList.toggle("active", btn.dataset.key === state.selected));
    return;
  }
  state.renderedLang = `${state.lang}:${state.hl}`;
  wrap.innerHTML = currentPacks().map((p) => {
    const has = (p.set.cards || []).length > 0;
    const active = p.key === state.selected ? " active" : "";
    const box = p.set.box || FALLBACK;
    return `<button class="packChip${active}${has ? "" : " pending"}" data-key="${p.key}" ${has ? "" : "disabled"}><img class="packBox" src="${box}" alt="${p.code} ${t("박스", "box")}" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" /><span class="packMeta"><span class="packCode">${p.code}</span><span class="packName">${packName(p)}</span><span class="packEn">${packSubName(p)}</span><span class="packTag${has ? " ready" : ""}">${has ? "TOP 10" : t("준비중", "Coming soon")}</span></span></button>`;
  }).join("");
  wrap.querySelectorAll(".packChip:not(.pending)").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.selected === btn.dataset.key) return;
      state.selected = btn.dataset.key;
      state.hasExplicitSet = true;
      renderPackGrid();
      renderDetail();
      updateUrl();
      trackEvent("select_pack", { pack_code: state.selected, language: state.lang });
      document.querySelector("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function historyChart(history, market) {
  const points = Array.isArray(history) ? history.filter((row) => row.middle != null) : [];
  if (points.length < 2) return `<div class="cardChartEmpty">${t("6개월 그래프는 eBay NM 업데이트가 2회 이상 쌓이면 표시됩니다.", "The 6-month chart appears after at least two eBay NM updates.")}</div>`;
  const values = points.map((row) => marketKrw(row.middle, row.currency || market.currency)).filter((value) => value != null);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const coords = values.map((value, index) => ({ x: (points.length === 1 ? 300 : 24 + (index * 552) / (points.length - 1)).toFixed(1), y: (150 - ((value - min) / span) * 112).toFixed(1) }));
  return `<div class="cardChart"><div class="cardChartHead"><strong>${t("6개월 NM 추이", "6-month NM trend")}</strong><span>${points[0].date} ~ ${points[points.length - 1].date}</span></div><svg viewBox="0 0 600 180" role="img" aria-label="${t("6개월 NM 시세 추이", "6-month NM price trend")}"><path d="M24 150H576" class="chartAxis"></path><polyline points="${coords.map((p) => `${p.x},${p.y}`).join(" ")}" class="chartLine"></polyline>${coords.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" class="chartDot"></circle>`).join("")}</svg><div class="cardChartRange"><span>${triMain(min, "KRW").main}</span><span>${triMain(max, "KRW").main}</span></div></div>`;
}

function cardMarketPanel(card) {
  const market = card.japaneseNmEbay;
  if (!market?.sampleSize) return `<div class="cardChartEmpty">${t("일본판 NM eBay 표본이 아직 없습니다.", "No Japanese NM eBay samples yet.")}</div>`;
  return `<div class="cardMarketPanel"><h3>${t("일본판 NM eBay", "Japanese NM eBay")}</h3><div class="bandRows cardMarketRows">${priceBandRows(market)}</div><p>eBay Active · ${t(`표본 ${market.sampleSize}건`, `${market.sampleSize} samples`)} · ${t("신뢰", "confidence")} ${market.confidence || "C"} · ${market.updated || ""}</p>${historyChart(market.history, market)}</div>`;
}

function openLightbox(src, name, card) {
  let lb = document.querySelector("#lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.innerHTML = `<div class="lbInner"><button id="lbClose" aria-label="${t("닫기", "Close")}">x</button><div class="lbGrid"><img id="lbImg" alt=""/><div><p id="lbCap"></p><div id="lbMarket"></div></div></div></div>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.id === "lbClose") lb.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") lb.classList.remove("open"); });
  }
  const big = src.replace(/_(\d+)w\.jpg/, "_1000x1000.jpg");
  const imgEl = lb.querySelector("#lbImg");
  imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = src; };
  imgEl.src = big;
  lb.querySelector("#lbCap").textContent = name || "";
  lb.querySelector("#lbMarket").innerHTML = cardMarketPanel(card || {});
  lb.classList.add("open");
}

function renderPsaTable(psa) {
  const rows = psa.map((c) => {
    const b = rb(c.rarity);
    const gem = c.gem == null ? "-" : `${c.gem}%`;
    const gemClass = c.gem >= 90 ? "gemHi" : c.gem >= 80 ? "gemMid" : "gemLo";
    return `<tr><td class="pCard"><span class="pName">${c.name}</span><span class="pNo">#${c.number}</span></td><td class="pRar"><span class="pBadge" style="--c:${b.c}">${b.s}</span></td><td class="pNumv">${num(c.psa10)}</td><td class="pNumv dim">${num(c.psa9)}</td><td class="pNumv">${num(c.total)}</td><td class="pNumv ${gemClass}">${gem}</td></tr>`;
  }).join("");
  return `<div class="psaWrap"><table class="psaTable"><thead><tr><th class="pCard">${t("카드", "Card")}</th><th class="pRar">${t("등급", "Rarity")}</th><th>PSA 10</th><th>PSA 9</th><th>${t("총계", "Total")}</th><th>${t("PSA10 비율", "PSA10 rate")}</th></tr></thead><tbody>${rows}</tbody></table><p class="note">${t("PSA 등급 인구 데이터입니다. PSA10 비율은 감정 카드 중 PSA10 비율입니다.", "PSA population data. PSA10 rate is the share of PSA 10 among graded copies.")}</p></div>`;
}

function renderDataNotice() {
  return `<div class="dataNotice"><b>${t("데이터 기준", "Data notes")}</b> ${t(
    "eBay Active는 현재 호가이며 실거래가가 아닙니다. 검수 최저 박스와 PSA10 매물 링크는 매일 03:00(KST)에 재검수합니다. Paid Link: eBay 링크를 통해 적격 구매가 발생하면 OP Box Index가 수수료를 받을 수 있습니다. 판매자, 배송비, 세금, 정품 여부, 재밀봉 리스크는 구매 전 본인이 최종 확인해야 합니다.",
    "eBay Active shows listing prices, not sold prices. Verified lowest box and PSA 10 listing links are rechecked daily at 03:00 KST. Paid Link: we may earn a commission from qualifying purchases made through eBay links. Buyers must verify seller, shipping, tax, authenticity and reseal risk before purchase.",
  )}</div>`;
}

function renderDetail() {
  const pack = currentPacks().find((p) => p.key === state.selected);
  const el = document.querySelector("#detail");
  if (!pack) return;
  updateSeo(pack);
  const set = pack.set;
  const cards = set.cards || [];
  if (!cards.length) {
    el.innerHTML = `<p class="note">${pack.code} ${packName(pack)} — ${t("아직 카드 데이터가 준비되지 않았습니다.", "Card data is not ready yet.")}</p>`;
    return;
  }
  const hasPsa = (set.psa || []).length > 0;
  if (state.view === "psa" && !hasPsa) state.view = "hits";
  const body = state.view === "psa" ? renderPsaTable(set.psa) : renderSourceLegend(set) + `<p class="srcNote">${t("가격은 USD 메인 표기이며 KRW·JPY 환산값을 함께 표시합니다.", "Prices use USD as the main display with KRW and JPY conversions.")} ${t("환율", "FX")}: $1 = ₩${state.data.fx.usdKrw} / ¥1 = ₩${state.data.fx.jpyKrw}.</p>` + renderHitList(cards);
  el.innerHTML = `<div class="detailHead"><img class="detailBox" src="${set.box || FALLBACK}" alt="${pack.code} ${t("박스", "box")}" loading="lazy" decoding="async" onerror="this.src='${FALLBACK}'" /><div class="detailInfo"><p class="eyebrow">${pack.code} · Booster Box</p><h2>${packName(pack)} <small>${packSubName(pack)}</small></h2><div class="viewTabs"><button class="viewTab ${state.view === "hits" ? "active" : ""}" data-view="hits">${t("시세 TOP 10", "Top 10 prices")}</button><button class="viewTab ${state.view === "psa" ? "active" : ""}" data-view="psa" ${hasPsa ? "" : "disabled"}>${t("PSA 통계", "PSA stats")}</button></div>${ebayLinks(pack)}${renderSetAnalytics(set)}${renderBoxSeries(set)}${!set.boxSeries ? renderBoxMarket(set) : ""}${renderDataNotice()}${hasPsa && state.view === "psa" ? `<p class="note">${t(`세트 평균 PSA10 비율 ${set.psaGem ?? "-"}% · 누적 ${num(set.psaTotal)}장`, `Set average PSA10 rate ${set.psaGem ?? "-"}% · ${num(set.psaTotal)} graded total`)}</p>` : ""}</div></div>${body}`;
  el.querySelectorAll(".viewTab:not([disabled])").forEach((b) => b.addEventListener("click", () => { if (state.view === b.dataset.view) return; state.view = b.dataset.view; renderDetail(); updateUrl(); trackEvent("select_view", { pack_code: state.selected, view: state.view }); }));
  el.querySelectorAll(".marketLinks a, .buyLink").forEach((a) => a.addEventListener("click", (event) => {
    event.stopPropagation();
    trackEvent("outbound_click", { pack_code: state.selected, label: a.textContent.trim(), url: a.href });
  }));
  el.querySelectorAll(".hitCard").forEach((f) => f.addEventListener("click", () => { const card = cards[Number(f.dataset.cardIndex)] || {}; trackEvent("image_zoom", { pack_code: state.selected, card_name: f.dataset.name }); openLightbox(f.dataset.img, f.dataset.name, card); }));
}

function renderStats() {
  const d = state.data;
  const readyCount = (codes) => codes.filter((c) => (d.sets[c]?.cards || []).length > 0).length;
  const jpReady = readyCount(d.jp.list);
  const extraReady = readyCount(d.extra.list);
  const jp = document.querySelector("#statJp");
  const extra = document.querySelector("#statExtra");
  if (jp) jp.textContent = `OP ${jpReady}/${d.jp.list.length}`;
  if (extra) extra.textContent = `${extraReady}/${d.extra.list.length}`;
}

function updateSeo(pack) {
  if (!pack) return;
  const koName = pack.nameKo || pack.nameEn || pack.code;
  const enName = pack.nameEn || pack.nameKo || pack.code;
  const isSetPage = state.hasExplicitSet;
  const title = isSetPage ? t(
    `${pack.code} ${koName} ${enName} \uBD80\uC2A4\uD130\uBC15\uC2A4 \uC2DC\uC138\u00B7\uD788\uD2B8\uCE74\uB4DC TOP10 | OP Box Index`,
    `${pack.code} ${enName} One Piece Card Prices & Booster Box Price | OP Box Index`,
  ) : t(
    "\uC6D0\uD53C\uC2A4 \uBD80\uC2A4\uD130\uBC15\uC2A4 \uC2DC\uC138\u00B7PSA10 \uCE74\uB4DC \uC2DC\uC138\u00B7\uBD80\uC2A4\uD130\uD329 \uC2DC\uC138\uC815\uBCF4 | OP Box Index",
    "One Piece Booster Box Prices & PSA 10 Card Prices | OP Box Index",
  );
  const description = isSetPage ? t(
    `${pack.code} ${koName}(${enName}) \uBD80\uC2A4\uD130\uBC15\uC2A4 \uAC00\uACA9, eBay \uC2DC\uC138, TOP10 \uD788\uD2B8\uCE74\uB4DC, NM, PSA10, PSA \uD1B5\uACC4\uB97C \uBE44\uAD50\uD569\uB2C8\uB2E4.`,
    `Compare ${pack.code} ${enName} One Piece card prices, Japanese booster box prices, eBay sold and active market data, Top 10 chase cards, NM prices, PSA 10 prices and PSA population stats.`,
  ) : t(
    "\uC6D0\uD53C\uC2A4 \uBD80\uC2A4\uD130\uBC15\uC2A4 \uC2DC\uC138, \uC6D0\uD53C\uC2A4 PSA10 \uCE74\uB4DC \uC2DC\uC138, \uBD80\uC2A4\uD130\uD329 \uC2DC\uC138\uC815\uBCF4, eBay \uCD5C\uC800\uAC00\u00B7\uD310\uB9E4\uC644\uB8CC \uAE30\uC900, \uD788\uD2B8\uCE74\uB4DC TOP10\uACFC PSA \uD1B5\uACC4\uB97C \uD55C \uBC88\uC5D0 \uBE44\uAD50\uD569\uB2C8\uB2E4.",
    "Track One Piece booster box prices, One Piece PSA 10 card prices, booster pack market data, eBay lowest listings, sold-price trends, Top 10 chase cards and PSA population stats.",
  );
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  const params = new URLSearchParams();
  if (isSetPage) params.set("set", pack.key);
  if (state.lang !== "jp") params.set("lang", state.lang);
  params.set("hl", state.hl);
  canonical.href = `${SITE_BASE}/packs.html?${params}`;
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonical.href);
  document.documentElement.lang = state.hl === "en" ? "en" : "ko";
  document.querySelector('meta[property="og:locale"]')?.setAttribute("content", state.hl === "en" ? "en_US" : "ko_KR");
  document.querySelectorAll('meta[property="og:locale:alternate"]').forEach((node) => node.remove());
  const altLocale = document.createElement("meta");
  altLocale.setAttribute("property", "og:locale:alternate");
  altLocale.setAttribute("content", state.hl === "en" ? "ko_KR" : "en_US");
  document.head.appendChild(altLocale);
  upsertHreflang(pack);
  setJsonLd("packStructuredData", {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title.replace(" | OP Box Index", ""),
    description,
    url: canonical.href,
    image: isSetPage && pack.set?.box ? new URL(pack.set.box, location.href).href : undefined,
    inLanguage: state.hl === "en" ? "en-US" : "ko-KR",
    isAccessibleForFree: true,
    license: `${SITE_BASE}/disclaimer.html#data-license`,
    usageInfo: `${SITE_BASE}/disclaimer.html#data-license`,
    creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE_BASE}/` },
    dateModified: state.data?.updated || undefined,
    spatialCoverage: ["United States", "Japan", "Singapore", "Malaysia", "Philippines", "Thailand", "Vietnam", "Indonesia"],
    variableMeasured: ["Booster box price", "Top 10 hit cards", "NM price", "PSA10 price", "PSA population"],
    keywords: [
      ...(isSetPage ? [`${pack.code}`, koName, enName] : []),
      "One Piece Card Game",
      "One Piece card prices",
      "One Piece card price",
      "One Piece booster box prices",
      "Japanese booster box price",
      "One Piece booster box investment",
      "One Piece sealed box",
      "PSA 10 population",
      "eBay sold prices",
      "TCG Southeast Asia",
      "Singapore TCG",
      "Malaysia TCG",
      "Philippines TCG",
      "Thailand TCG",
      "Vietnam TCG",
      "\uC6D0\uD53C\uC2A4 \uCE74\uB4DC\uAC8C\uC784",
      "\uBD80\uC2A4\uD130\uBC15\uC2A4 \uC2DC\uC138",
      "PSA10",
      "eBay",
    ],
  });
}

initDisplayLanguage();
load();
