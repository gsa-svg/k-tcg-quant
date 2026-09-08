#!/usr/bin/env node
"use strict";
// 영문판 박스 시세 페이지 — sets/<code>-english.html (2026-09-08 신설).
//
// ── 왜 따로 만드나
// 일본판 세트 페이지(sets/op-13.html)는 제목·본문·구조화데이터가 전부 "Japanese" 로 잡혀 있어
// "OP-13 english booster box price" 같은 검색에는 안 잡힌다. 영문판 시세·호가·주간 실거래·PSA 인구·
// 경매 낙찰률은 이미 원장에 있는데 페이지가 없어서 노출이 0 이었다(소유자 지시 2026-09-08).
//
// ── 무엇을 읽나(전부 기존 원장, 이 파일은 아무것도 수집하지 않는다)
//   data/onepiece-packs.json      set.boxMarket.en (sold·ask·최저가 매물), set.psaFullEn, set.release(영문판 발매일)
//   data/box-sold-series.json     sets[code].en 주간 실거래 시계열(+ enBlue 초판, supply 매물 수)
//   data/set-auction-stats.json   sets[code].byEd.en 영문판 경매 낙찰 통계(build-set-auction-stats.js)
//   data/set-facts.json           jpRelease(일본판 발매일) — 비교 표에만 쓴다
//
// ── 규칙
//   · 값이 없으면 칸을 비운다. 추정·보간 금지("빈 값이 틀린 값보다 낫다").
//   · 표·차트 위주. 문장은 날짜가 박힌 사실문(접힌 Key facts·FAQ)만 — 소유자 규칙.
//   · 일본판 페이지와 <head>·푸터·고지·사이트맵 갱신을 공유한다(set-page-shared.js).
//   · 박스 그림은 싣지 않는다 — 가진 이미지는 반다이 일본판 공식 사진이라 영문판 페이지에 맞지 않는다.
//
// Run: node tools/generate-english-set-pages.js   (generate-set-pages.js 보다 먼저 — 허브·일본판 페이지가 이 파일 존재를 보고 링크를 건다)
const fs = require("fs");
const path = require("path");
const { ROOT, SITE, EPN, BoxChart, esc, usd, intl, monthYear, AFF_TOP, FOOT, pageHead, upsertSitemap } = require("./set-page-shared");

const readJson = (rel, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return fallback; }
};
const data = readJson("data/onepiece-packs.json");
const SOLD = readJson("data/box-sold-series.json", { sets: {} });
const SET_AUCTION = readJson("data/set-auction-stats.json", { sets: {}, window: {}, updated: "" });
const SET_FACTS = readJson("data/set-facts.json", { sets: {} });
const DATA_DATE = data.updated || new Date().toISOString().slice(0, 10);

const slug = (code) => code.toLowerCase();
const fileOf = (code) => `${slug(code)}-english.html`;
const pct1 = (a, b) => (a != null && b ? Math.round((a / b - 1) * 1000) / 10 : null);   // 변화율 %, 소수 1자리
const lastWith = (arr, key) => { const f = (arr || []).filter((p) => p && p[key] != null); return f.length ? f[f.length - 1] : null; };

// ── 세트별 영문판 지표 한 묶음. 페이지 본문과 기준선(중앙값)이 같은 숫자를 쓰도록 한 곳에서 만든다.
function englishMetrics(code) {
  const s = data.sets[code] || {};
  const ser = SOLD.sets?.[code] || {};
  const en = (ser.en || []).filter((p) => p && p.median != null);
  const last = en.length ? en[en.length - 1] : null;
  const prior = en.length >= 5 ? en[en.length - 5] : null;         // 4주 전(점 하나 = 7일)
  const supply = lastWith(ser.supply, "en");
  const windowDays = ser.windowDays?.en || null;
  const sold = s.boxMarket?.en?.ebaySold || null;
  const ask = s.boxMarket?.en?.ebayActive || null;
  const jpLast = lastWith(ser.jp, "median");
  return {
    price: last ? last.median : null,
    priceD: last ? last.d : null,
    chg: last && prior && prior.median ? pct1(last.median, prior.median) : null,
    stock: supply ? supply.en : null,
    stockD: supply ? supply.d : null,
    // 재고일수 = 지금 걸린 매물 ÷ 하루 판매 속도. n 은 평균 창(windowDays, 28~56일) 안의 판매 건수라 창 길이로 나눈다.
    days: supply && supply.en != null && last && last.n && windowDays ? Math.round((supply.en / (last.n / windowDays)) * 10) / 10 : null,
    windowDays,
    sold, ask,
    jpPrice: jpLast ? jpLast.median : null,
    jpPriceD: jpLast ? jpLast.d : null,
    multiple: last && jpLast && jpLast.median ? Math.round((last.median / jpLast.median) * 10) / 10 : null,
    psa: s.psaFullEn?.total ?? null,
    gem: s.psaFullEn?.gemRate ?? null,
    psaD: s.psaFullEn?.updated || null,
  };
}

// 페이지를 만들 세트 = 영문판 실거래 중앙값이 있는 세트(원장 기준, 손목록 없음).
const ORDER = [...(data.jp?.list || []), ...(data.extra?.list || [])]
  .filter((code) => data.sets?.[code]?.boxMarket?.en?.ebaySold?.median != null);
const METRICS = Object.fromEntries(ORDER.map((code) => [code, englishMetrics(code)]));

// 기준선 = 영문판 페이지가 있는 세트들의 중앙값. 라벨의 "N-set" 은 실제 모수로 쓴다.
const BASE = (() => {
  const med = (key) => {
    const a = Object.values(METRICS).map((m) => m[key]).filter((x) => x != null).sort((x, y) => x - y);
    return { v: a.length ? a[Math.floor(a.length / 2)] : null, n: a.length };
  };
  return Object.fromEntries(["price", "chg", "days", "psa", "gem", "multiple"].map((k) => [k, med(k)]));
})();
const baseLabel = (key) => (BASE[key]?.n ? `${BASE[key].n}-set median` : "median");

// ── 화면 조각들 --------------------------------------------------------------------

// 기준선 대비 방향 표시. higherIsBetter=false 면 낮을수록 초록(재고일수).
function cmp(v, b, higherIsBetter = true) {
  if (v == null || b == null || !b) return "";
  const p = Math.round((v / b - 1) * 100);
  if (p === 0) return `<span class="statFlat">= median</span>`;
  const cls = (p > 0) === higherIsBetter ? "statUp" : "statDown";
  return `<span class="${cls}">${p > 0 ? "▲" : "▼"} ${p > 0 ? "+" : ""}${p}%</span>`;
}

function statGrid(code, m) {
  const cells = [], hints = [];
  const card = (label, value, base, hint) => {
    if (hint) hints.push([label, hint]);
    cells.push(`<div class="statCard"${hint ? ` title="${esc(hint)}"` : ""}><div class="statLabel">${label}</div><div class="statValue">${value}</div>${base ? `<div class="statBase">${base}</div>` : ""}</div>`);
  };
  if (m.price != null) card("Box price (EN)", usd(m.price), `${m.priceD ? `as of ${esc(m.priceD)} · ` : ""}${baseLabel("price")} ${usd(BASE.price.v)} ${cmp(m.price, BASE.price.v)}`);
  if (m.chg != null) {
    const cls = m.chg > 0 ? "statUp" : m.chg < 0 ? "statDown" : "statFlat";
    card("4-week change", `<span class="${cls}">${m.chg > 0 ? "+" : ""}${m.chg}%</span>`, `${baseLabel("chg")} ${BASE.chg.v > 0 ? "+" : ""}${BASE.chg.v}%`);
  }
  if (m.ask && m.ask.middle != null && (m.ask.sampleSize || 0) >= 3) card("Asking price (mid)", usd(m.ask.middle), `${m.ask.sampleSize} active listings · ${esc(m.ask.updated || DATA_DATE)}`, "Median asking price of verified active eBay listings — not a completed sale.");
  if (m.days != null) card("Days of inventory", `${m.days}d`, `${m.stock} listed · ${baseLabel("days")} ${BASE.days.v}d ${cmp(m.days, BASE.days.v, false)}`, "How long the listings on sale would last at the current selling pace. Fewer days means stock is clearing faster.");
  if (m.multiple != null) card("vs Japanese box", `${m.multiple}x`, `JP ${usd(m.jpPrice)} as of ${esc(m.jpPriceD)} · ${baseLabel("multiple")} ${BASE.multiple.v}x`, "English completed-sale median divided by the Japanese one. The ratio describes the gap; it does not explain it.");
  if (m.psa != null) card("PSA graded (EN)", intl(m.psa), `${baseLabel("psa")} ${intl(BASE.psa.v)} ${cmp(m.psa, BASE.psa.v)}`);
  if (m.gem != null) card("PSA 10 rate (EN)", `${m.gem}%`, `${baseLabel("gem")} ${BASE.gem.v}% ${cmp(m.gem, BASE.gem.v)}`, "Share of PSA submissions from the English printing that came back a 10.");
  if (cells.length < 3) return "";
  const gloss = hints.length ? `<details class="statGloss"><summary>What these numbers mean</summary><dl>${hints.map(([l, t]) => `<dt>${l}</dt><dd>${t}</dd>`).join("")}</dl></details>` : "";
  return `<section aria-label="English box metrics"><div class="statGrid">${cells.join("")}</div>${gloss}</section>`;
}

// 날짜 박힌 사실문 — 답변 AI 가 그대로 인용할 수 있는 형태. 화면에서는 접어 둔다.
function keyFacts(code, nameEn, m, s) {
  const facts = [];
  if (m.sold && m.sold.median != null) facts.push(`As of ${esc(m.sold.updated)}, a sealed English ${code} ${esc(nameEn)} booster box has a completed-sale median of about <strong>${usd(m.sold.median)}</strong> (${m.sold.sampleSize} eBay sales in the trailing ${m.sold.windowDays || 28} days).`);
  if (m.ask && m.ask.middle != null && (m.ask.sampleSize || 0) >= 3) facts.push(`Current eBay asking prices run around <strong>${usd(m.ask.middle)}</strong> (${m.ask.sampleSize} active listings, ${esc(m.ask.updated || DATA_DATE)}).`);
  if (m.multiple != null) facts.push(`The English ${code} box trades at about <strong>${m.multiple}x</strong> the Japanese box (${usd(m.jpPrice)} as of ${esc(m.jpPriceD)}).`);
  if (m.psa != null && m.gem != null) facts.push(`PSA has graded <strong>${intl(m.psa)}</strong> English ${code} cards with a <strong>${m.gem}%</strong> PSA 10 rate (as of ${esc(m.psaD || DATA_DATE)}).`);
  if (s.release) facts.push(`The English edition of ${code} released ${esc(monthYear(s.release))}.`);
  if (facts.length < 2) return "";
  return `
      <section id="key-facts" aria-label="Key facts">
        <details class="keyFactsBox"><summary>Key facts in one paragraph</summary>
        <ul class="keyFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul></details>
      </section>`;
}

// 차트 — 영문판(+초판 Blue)만 넘긴다. 일본판 선은 일본판 페이지에 있다.
function chartBlock(code) {
  const ser = SOLD.sets?.[code];
  if (!ser) return "";
  const enOnly = {
    en: ser.en, enBlue: ser.enBlue,
    windowDays: ser.windowDays,
    monthly: { en: ser.monthly?.en, enBlue: ser.monthly?.enBlue },
    daily: { en: ser.daily?.en, enBlue: ser.daily?.enBlue },
    supply: (ser.supply || []).map((p) => ({ d: p.d, en: p.en })),
    reprintPct: ser.reprintPct,
  };
  if (!BoxChart.hasChart(enOnly)) return "";
  return BoxChart.chartHTML(enOnly, { lang: "en", title: `${code} English sealed booster box — median completed eBay sale` });
}

// 지금 걸린 최저가 매물(가격+배송비). "New" 이고 제목이 개봉·빈 박스를 말하지 않을 때만 싣는다 —
// 검색어에 sealed 가 있어도 "Unsealed"·"Open Box" 매물이 최저가로 잡힌다(OP-13 실측).
function cheapestBox(code, m) {
  const bl = m.ask?.bestListing;
  if (!bl || bl.total == null || !/new/i.test(bl.condition || "")) return "";
  if (/unseal|open|empty|no packs|reseal|damaged/i.test(bl.title || "")) return "";
  const id = (String(bl.url || "").match(/\/itm\/(\d+)/) || [])[1];
  if (!id) return "";
  const link = `https://www.ebay.com/itm/${id}?${EPN}`;
  const ship = bl.shipping ? ` (item ${usd(bl.price)} + shipping ${usd(bl.shipping)})` : " (free shipping)";
  return `
      <div class="liveBox">
        <span>Lowest total-cost English ${code} box listed now</span><br />
        <b>${usd(bl.total)}</b>
        <small>${esc(ship.trim())} · ${esc(bl.condition)} · ships from ${esc(bl.country || "—")} · as of ${esc(m.ask.updated || DATA_DATE)} · <a href="${link}" target="_blank" rel="noopener noreferrer sponsored">View listing</a></small>
      </div>`;
}

function weeklyTable(code) {
  const pts = (SOLD.sets?.[code]?.en || []).filter((p) => p && p.median != null);
  if (pts.length < 3) return "";
  const rows = [...pts].reverse().map((p) => `<tr><td>${esc(p.d)}</td><td class="num">${usd(p.median)}</td><td class="num">${usd(p.low)}</td><td class="num">${usd(p.high)}</td><td class="num">${intl(p.n)}</td><td class="num">${p.vol != null ? intl(p.vol) : "—"}</td></tr>`).join("\n            ");
  return `
      <h2>English ${code} box — weekly completed-sale median</h2>
      <div class="chaseTableWrap">
        <table class="chaseTable">
          <thead><tr><th>Week ending</th><th>Median</th><th>Low (P25)</th><th>High (P75)</th><th>Sales in window</th><th>Sales that week</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <p class="priceNote">Completed eBay sales of sealed English boxes, dated by sale date. Each row's median uses the sales inside its averaging window (${SOLD.sets?.[code]?.windowDays?.en || 28}+ days), so thin weeks borrow neighbours. <a href="../methodology.html">Source rules</a> · ${esc(DATA_DATE)}</p>`;
}

function compareTable(code, m, s) {
  const jpSold = s.boxMarket?.jp?.ebaySold, jpAsk = s.boxMarket?.jp?.ebayActive;
  const sup = lastWith(SOLD.sets?.[code]?.supply, "en");
  const jpRel = SET_FACTS.sets?.[code]?.jpRelease?.date || null;
  const row = (label, en, jp) => (en == null && jp == null ? "" : `<tr><td>${label}</td><td class="num">${en ?? "—"}</td><td class="num">${jp ?? "—"}</td></tr>`);
  const rows = [
    row("Completed-sale median", m.sold?.median != null ? `${usd(m.sold.median)} <span class="psaKind">${esc(m.sold.updated)}</span>` : null, jpSold?.median != null ? `${usd(jpSold.median)} <span class="psaKind">${esc(jpSold.updated)}</span>` : null),
    row("Sales in window", m.sold?.sampleSize ?? null, jpSold?.sampleSize ?? null),
    row("Asking median (active)", m.ask?.middle != null && (m.ask.sampleSize || 0) >= 3 ? `${usd(m.ask.middle)} <span class="psaKind">${m.ask.sampleSize} listings</span>` : null, jpAsk?.middle != null && (jpAsk.sampleSize || 0) >= 3 ? `${usd(jpAsk.currency === "USD" ? jpAsk.middle : jpAsk.middle / (data.fx?.usdKrw || 1))} <span class="psaKind">${jpAsk.sampleSize} listings</span>` : null),
    row("Listings on sale now", sup?.en ?? null, sup?.jp ?? null),
    row("PSA graded (full set)", m.psa != null ? `${intl(m.psa)}${m.gem != null ? ` <span class="psaKind">${m.gem}% PSA 10</span>` : ""}` : null, s.psaFull?.total != null ? `${intl(s.psaFull.total)}${s.psaFull.gemRate != null ? ` <span class="psaKind">${s.psaFull.gemRate}% PSA 10</span>` : ""}` : null),
    row("Release date", s.release ? esc(s.release) : null, jpRel ? esc(jpRel) : null),
    m.multiple != null ? `<tr><td>English ÷ Japanese (completed-sale medians)</td><td class="num" colspan="2"><strong>${m.multiple}x</strong></td></tr>` : "",
  ].filter(Boolean).join("\n            ");
  if (!rows) return "";
  return `
      <h2>English vs Japanese ${code} box</h2>
      <div class="chaseTableWrap">
        <table class="chaseTable">
          <thead><tr><th>Metric</th><th>English</th><th>Japanese</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <p class="priceNote">Japanese figures come from the <a href="${slug(code)}.html">${code} Japanese box guide</a>. Printings are never averaged together.</p>`;
}

// 영문판 경매 낙찰 통계 — 종료 후 재조회한 우리 원장에서만 나오는 축. 표본 30건 미만이면 비율을 비운다.
function auctionSection(code) {
  const a = SET_AUCTION.sets?.[code]?.byEd?.en;
  if (!a || a.ended < 30) return "";
  const w = SET_AUCTION.window || {};
  const catName = { card: "single cards", box: "sealed boxes", pack: "loose packs", graded: "graded slabs", lot: "multi-card lots" };
  const cats = Object.entries(a.byCat || {}).sort((x, y) => y[1].ended - x[1].ended).slice(0, 5);
  const rows = cats.map(([k, v]) => `<tr><td>${esc(catName[k] || k)}</td><td class="num">${intl(v.ended)}</td><td class="num">${intl(v.sold)}</td><td class="num">${v.sellThrough}%</td></tr>`).join("\n            ");
  const total = `<tr><td><strong>All English ${code} auctions</strong></td><td class="num"><strong>${intl(a.ended)}</strong></td><td class="num"><strong>${intl(a.sold)}</strong></td><td class="num"><strong>${a.sellThrough != null ? `${a.sellThrough}%` : "—"}</strong></td></tr>`;
  return `
      <h2>English ${code} cards at eBay auction — last ${w.days || 30} days</h2>
      <div class="chaseTableWrap">
        <table class="chaseTable">
          <thead><tr><th>Listing type</th><th>Ended</th><th>Sold</th><th>Sell-through</th></tr></thead>
          <tbody>
            ${rows}
            ${total}
          </tbody>
        </table>
      </div>
      <p class="priceNote">Auctions carrying English-printing ${code} items, ${esc(w.from || "")} to ${esc(w.to || "")}, every one read again after it closed.${a.medPrice != null ? ` Median winning bid ${usd(a.medPrice)}.` : ""} Sell-through counts only auctions whose outcome eBay reported; unsold auctions stay in the denominator. Buy-it-now listings are not included.</p>`;
}

// FAQ — 화면과 JSON-LD 가 같은 문답을 써야 한다(가드 L2). 값은 전부 원장에서, 판단 문장은 없다.
function faqItems(code, nameEn, m) {
  const items = [];
  if (m.sold && m.sold.median != null) {
    items.push({
      q: `How much is a sealed ${code} ${nameEn} English booster box?`,
      a: `As of ${m.sold.updated}, completed eBay sales put the median at about $${Math.round(m.sold.median)} (${m.sold.sampleSize} sales in the trailing ${m.sold.windowDays || 28} days, from $${Math.round(m.sold.low)} to $${Math.round(m.sold.high)}).${m.ask && m.ask.middle != null && (m.ask.sampleSize || 0) >= 3 ? ` Active asking prices center near $${Math.round(m.ask.middle)} across ${m.ask.sampleSize} listings.` : ""}`,
    });
  }
  if (m.multiple != null) {
    items.push({
      q: `How does the English ${code} box price compare with the Japanese box?`,
      a: `English $${Math.round(m.price)} (as of ${m.priceD}) versus Japanese $${Math.round(m.jpPrice)} (as of ${m.jpPriceD}): the English box trades at about ${m.multiple}x the Japanese box.`,
    });
  }
  if (m.psa != null && m.gem != null) {
    items.push({
      q: `How many English ${code} cards have been graded by PSA?`,
      a: `PSA reports ${intl(m.psa)} graded English ${code} cards as of ${m.psaD || DATA_DATE}, and ${m.gem}% of them received a PSA 10.`,
    });
  }
  return items;
}

function faqHtml(code, nameEn, items) {
  if (!items.length) return "";
  return `
      <section class="setFaq" aria-label="${esc(`${code} ${nameEn} English box frequently asked questions`)}">
        <h2>${code} ${esc(nameEn)} English box — frequently asked questions</h2>
        ${items.map((x) => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join("\n        ")}
      </section>`;
}

function jsonLd(code, nameEn, m, s, items, canonical) {
  const ld = [];
  if (items.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) });
  ld.push({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Set Guides", item: `${SITE}/sets/index.html` },
      { "@type": "ListItem", position: 3, name: `${code} Guide`, item: `${SITE}/sets/${slug(code)}.html` },
      { "@type": "ListItem", position: 4, name: `${code} English box`, item: canonical },
    ],
  });
  ld.push({ "@context": "https://schema.org", "@type": "WebPage", url: canonical, dateModified: DATA_DATE });
  // Product 스키마는 유효한 호가 구간이 있을 때만 — 불완전한 Product 는 서치콘솔 경고가 된다.
  const a = m.ask;
  if (a && a.middle != null && (a.sampleSize || 0) >= 3) {
    const offers = a.low != null && a.high != null && a.high >= a.low
      ? { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: Math.round(a.low), highPrice: Math.round(a.high), offerCount: a.sampleSize, availability: "https://schema.org/InStock", url: canonical }
      : { "@type": "Offer", priceCurrency: "USD", price: Math.round(a.middle), availability: "https://schema.org/InStock", url: canonical };
    ld.push({
      "@context": "https://schema.org", "@type": "Product",
      name: `One Piece Card Game ${code} ${nameEn} Booster Box (English)`,
      image: [`${SITE}/og-image.png`],
      description: `English sealed ${code} ${nameEn} One Piece Card Game booster box — completed eBay sale median, active asking prices, weekly price history, English PSA population and settled auction results.`,
      brand: { "@type": "Brand", name: "Bandai" },
      category: "Trading Card Games",
      ...(s.release ? { releaseDate: s.release } : {}),
      offers,
    });
  }
  return ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n    ");
}

// 이 페이지들에만 쓰는 스타일(일본판 페이지와 같은 클래스 이름을 쓴다 — 보는 사람에게 같은 화면이어야 한다).
const PAGE_CSS = `      .setHero { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
      .setHero > div { flex: 1 1 320px; min-width: 0; }
      .liveBox { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: rgba(16,215,160,.05); }
      .liveBox b { font-size: 20px; color: var(--accent); }
      .liveBox small { color: var(--muted); display: block; margin-top: 4px; }
      .ctaRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .ctaRow a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); font-weight: 800; }
      .ctaRow a.primary { background: rgba(16,215,160,.14); border-color: rgba(16,215,160,.5); color: var(--accent); }
      .setNavLinks { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; color: var(--muted); font-size: 14px; }
      .affNote { margin-top: 16px; color: var(--muted); font-size: 11px; opacity: .8; }
      .affTop { display: block; margin: 12px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--line); color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 760px; }
      .affTop b { color: inherit; font-weight: 600; }
      .dataSummary { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
      .dataSummary b { color: var(--accent); font-weight: 800; }
      .pageUpdated { margin: 6px 0 0; color: var(--muted); font-size: 12.5px; }
      .statGloss { margin: 8px 0 0; max-width: 760px; font-size: 12.5px; color: var(--muted, #9aa4b6); }
      .statGloss > summary { cursor: pointer; color: var(--muted, #9aa4b6); }
      .statGloss dl { margin: 8px 0 0; display: grid; gap: 6px 14px; grid-template-columns: max-content 1fr; }
      .statGloss dt { font-weight: 700; color: var(--fg, #e8edf6); }
      .statGloss dd { margin: 0; line-height: 1.5; }
      .keyFactsBox > summary { cursor: pointer; color: var(--muted, #9aa4b6); font-size: 13px; }
      @media (max-width: 640px) { .statGloss dl { grid-template-columns: 1fr; } .statGloss dd { margin-bottom: 4px; } }
      .statGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; margin: 16px 0 6px; max-width: 760px; }
      .statCard { padding: 12px 14px; border: 1px solid rgba(255,255,255,.10); border-radius: 12px; background: rgba(255,255,255,.02); }
      .statLabel { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted, #9aa4b6); font-weight: 700; }
      .statValue { margin-top: 5px; font-size: 28px; font-weight: 700; line-height: 1.12; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
      .statBase { margin-top: 5px; font-size: 12px; color: var(--muted, #9aa4b6); line-height: 1.45; }
      .statUp { color: #00e5a0; font-weight: 700; }
      .statDown { color: #ff5f6e; font-weight: 700; }
      .statFlat { color: #8090b0; font-weight: 700; }
      .keyFacts { margin: 14px 0 4px; padding: 12px 16px 12px 32px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 680px; font-size: 14px; line-height: 1.65; }
      .keyFacts li { margin: 3px 0; }
      .keyFacts strong { color: var(--accent); }
      .chaseTableWrap { overflow-x: auto; margin: 14px 0 6px; }
      .chaseTable { width: 100%; border-collapse: collapse; font-size: 14px; }
      .chaseTable th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .chaseTable td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.05); vertical-align: top; }
      .chaseTable .psaKind { color: var(--muted); font-size: 10px; text-transform: uppercase; }
      .chaseTable td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .priceNote { color: var(--muted); font-size: 12px; margin: 2px 0 0; }`;

// ── 페이지 한 장 ----------------------------------------------------------------
function englishPage(code, prev, next) {
  const s = data.sets[code];
  const m = METRICS[code];
  const nameEn = s.nameEn || code;
  const canonical = `${SITE}/sets/${fileOf(code)}`;
  const items = faqItems(code, nameEn, m);
  const title = `${code} ${nameEn} English Booster Box Price — eBay Sold & Asking | OP Box Index`;
  const descBits = [];
  if (m.sold?.median != null) descBits.push(`completed eBay sale median $${Math.round(m.sold.median)} (${m.sold.sampleSize} sales to ${m.sold.updated})`);
  if (m.ask?.middle != null && (m.ask.sampleSize || 0) >= 3) descBits.push(`asking mid $${Math.round(m.ask.middle)}`);
  if (m.multiple != null) descBits.push(`${m.multiple}x the Japanese box`);
  if (m.gem != null) descBits.push(`English PSA 10 rate ${m.gem}%`);
  const desc = `English ${code} ${nameEn} sealed booster box: ${descBits.join(", ")}. Weekly price history and settled auction results, updated daily.`;
  const ebaySearch = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece Card Game ${code} ${nameEn} Booster Box English sealed`)}&LH_BIN=1&_sop=15&${EPN}`;

  const summaryBits = [];
  if (m.sold?.median != null) summaryBits.push(`Sold median <b>${usd(m.sold.median)}</b> (${m.sold.sampleSize} sales · ${esc(m.sold.updated)})`);
  if (m.ask?.middle != null && (m.ask.sampleSize || 0) >= 3) summaryBits.push(`Asking <b>${usd(m.ask.middle)}</b> (${m.ask.sampleSize} listings)`);
  if (m.gem != null) summaryBits.push(`English PSA 10 rate <b>${m.gem}%</b>${m.psa != null ? ` (${intl(m.psa)} graded)` : ""}`);
  const summaryLine = summaryBits.length ? `<p class="dataSummary">${summaryBits.join(" · ")}</p>` : "";

  return `${pageHead({ title, desc, canonical, extraLd: jsonLd(code, nameEn, m, s, items, canonical), extraCss: PAGE_CSS })}
      <p class="eyebrow">Set Guide · English edition</p>
      <div class="setHero">
        <div>
          <h1>${code} ${esc(nameEn)} — English booster box price</h1>
          <p class="eyebrow">English edition${s.release ? ` · released ${esc(s.release)}` : ""} · <a href="${slug(code)}.html">Japanese box guide</a></p>
          ${summaryLine}
          <p class="pageUpdated">Data updated <time datetime="${DATA_DATE}">${DATA_DATE}</time> · refreshed daily</p>
        </div>
      </div>
      ${AFF_TOP}
      ${statGrid(code, m)}
      ${keyFacts(code, nameEn, m, s)}
      ${chartBlock(code)}
      ${cheapestBox(code, m)}
      <div class="ctaRow">
        <a class="primary" href="${ebaySearch}" target="_blank" rel="noopener noreferrer sponsored">Browse English ${code} boxes on eBay</a>
        <a href="../?set=${encodeURIComponent(code)}&amp;hl=en">Open live ${code} tracker</a>
        <a href="${slug(code)}.html">Japanese ${code} box guide</a>
      </div>
      ${weeklyTable(code)}
      ${compareTable(code, m, s)}
      ${auctionSection(code)}
      ${faqHtml(code, nameEn, items)}
      <div class="setNavLinks">
        ${prev ? `<a href="${fileOf(prev)}">← ${prev} English box</a>` : ""}
        <a href="index.html">All set guides</a>
        ${next ? `<a href="${fileOf(next)}">${next} English box →</a>` : ""}
      </div>${FOOT}`;
}

// ── 쓰기 + 사이트맵 ---------------------------------------------------------------
const outDir = path.join(ROOT, "sets");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
let written = 0;
ORDER.forEach((code, i) => {
  fs.writeFileSync(path.join(outDir, fileOf(code)), englishPage(code, ORDER[i - 1], ORDER[i + 1]), "utf8");
  written++;
});
const { added } = upsertSitemap(ORDER.map((c) => `${SITE}/sets/${fileOf(c)}`), { priority: "0.7" });
console.log(JSON.stringify({ pagesWritten: written, sets: ORDER.length, sitemapAdded: added }));
