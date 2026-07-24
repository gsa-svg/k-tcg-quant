// 인기 카드 개별 페이지 생성 — cards/<slug>.html + cards/index.html 허브 + 사이트맵 idempotent
// 대상: NM가 보유 카드 중 상위 N(중복 변형 제거). 카드당 NM/PSA10/인구/이력/박스대비 배수까지 실데이터.
// Run: node tools/generate-card-pages.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";
const TOP_N = 24;

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const FX = d.fx || {};
const jpyUsd = (jpy) => (Number.isFinite(jpy) ? (jpy * FX.jpyKrw) / FX.usdKrw : null);
const krwUsd = (krw) => (Number.isFinite(krw) ? krw / FX.usdKrw : null);
const toUsd = (v, cur) => (v == null ? null : cur === "USD" ? v : krwUsd(v));
const usd = (n) => (n == null ? null : "$" + Math.round(n).toLocaleString("en-US"));
const jpy = (n) => (n == null ? null : "¥" + Math.round(n).toLocaleString("en-US"));
const intl = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
const DATA_DATE = d.updated || new Date().toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LABEL = (() => { const dt = new Date(DATA_DATE); return Number.isNaN(dt.getTime()) ? "" : `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`; })();

// ---- 후보 수집 + 중복 변형 제거(번호+정규화이름 기준; 홈세트 우선)
const seen = new Map();
for (const [code, s] of Object.entries(d.sets || {})) {
  for (const c of s.cards || []) {
    if (c.nmJpy == null || !c.number) continue;
    const key = c.number + "|" + norm(c.name);
    const isHome = c.number.replace("-", "").toUpperCase().startsWith(code.replace("-", "").toUpperCase());
    const prev = seen.get(key);
    if (!prev || (isHome && !prev.isHome)) seen.set(key, { code, set: s, card: c, isHome });
  }
}
const cands = [...seen.values()].sort((a, b) => b.card.nmJpy - a.card.nmJpy).slice(0, TOP_N);

// PSA pop 매칭(세트 psa 표)
function popOf(setObj, card) {
  for (const r of setObj.psa || []) {
    const numOk = (card.number || "").includes(r.number || "___");
    const nameOk = norm(card.name).includes(norm(r.name).slice(0, 10));
    if (numOk && nameOk) return r;
  }
  return null;
}
// PSA10 표시가(세트 페이지와 동일 규칙: sold n>=3 우선, 아니면 최저 ask)
function psa10Of(card) {
  const sold = card.psa10Ebay;
  if (sold && sold.soldBased && sold.middle != null && (sold.sampleSize || 0) >= 3) {
    const v = toUsd(sold.middle, sold.currency);
    if (v != null) return { v, kind: "sold", n: sold.sampleSize, date: sold.updated };
  }
  const bl = card.psa10Active && card.psa10Active.bestListing;
  if (bl && bl.total != null) {
    const v = toUsd(bl.total, bl.currency);
    if (v != null) return { v, kind: "ask", n: card.psa10Active.sampleSize, date: card.psa10Active.updated, url: bl.url };
  }
  return null;
}

// 셀프호스팅 이미지 맵(tools/fetch-card-images.js 산출). 없으면 원본 CDN URL로 폴백.
const IMG_MAP = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "img", "cards", "map.json"), "utf8")); } catch { return {}; } })();
const localImg = (slug, fallback) => (IMG_MAP[slug] ? `${SITE}/${IMG_MAP[slug]}` : (fallback || null));

const CARDS_DIR = path.join(ROOT, "cards");
fs.mkdirSync(CARDS_DIR, { recursive: true });

const hubItems = [];
const written = [];
for (const { code, set: s, card: c } of cands) {
  const nmUsd = jpyUsd(c.nmJpy);
  const p10 = psa10Of(c);
  const pop = popOf(s, c);
  const slug = slugify(c.number + "-" + c.name);
  const fname = slug + ".html";
  const canonical = `${SITE}/cards/${fname}`;
  const imgAbs = localImg(slug, c.img);
  const imgRel = IMG_MAP[slug] ? `../${IMG_MAP[slug]}` : (c.img || null);
  const setSlug = code.toLowerCase();
  const boxPts = s.boxSeries && s.boxSeries.points || [];
  const boxUsd = boxPts.length ? krwUsd(boxPts[boxPts.length - 1].p) : null;
  const boxMult = boxUsd && nmUsd ? (nmUsd / boxUsd) : null;
  const rank = c.rank || null;
  const ebayRaw = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece ${c.number} ${c.name} Japanese`)}&_sop=15&${EPN}`;
  const ebayPsa = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece ${c.number} PSA 10 Japanese`)}&_sop=15&${EPN}`;

  // 시리즈(가격 이력) 표 — 체크포인트가 2개 이상 쌓인 카드만 표시(1점짜리 무의미한 표 방지).
  // ※ 2026-07-14 이전 초기 수집은 변형매칭 미성숙으로 오염되어 폐기됨(그 이후부터 신뢰 축적).
  const ser = (c.series && c.series.points || []).filter((p) => p.nm != null || p.psa != null);
  const serRows = ser.length >= 2 ? ser.slice(-6).map((p) => `<tr><td>${esc(p.d)}</td><td class="num">${p.nm != null ? usd(krwUsd(p.nm)) : "—"}</td><td class="num">${p.psa != null ? usd(krwUsd(p.psa)) : "—"}</td></tr>`).join("") : "";

  // 그레이딩 경제성(전부 실데이터 파생 — 추정치 없음)
  let gradeSection = "";
  if (p10 && nmUsd) {
    const ratio = p10.v / nmUsd;
    const premium = p10.v - nmUsd;
    let verdict;
    if (ratio <= 1.05) {
      verdict = `Right now a PSA 10 ${p10.kind === "sold" ? "sells" : "is listed"} at roughly the same price as — or below — a raw NM copy. At today's numbers, grading this card adds fees, shipping and months of turnaround for no price upside. That happens with high-supply modern cards: when ${pop ? intl(pop.psa10) + " PSA 10s already exist" : "graded supply is deep"}, the slab premium collapses.`;
    } else if (ratio < 1.5) {
      verdict = `The PSA 10 premium over raw is currently about ${usd(premium)} (${Math.round((ratio - 1) * 100)}%). After grading fees and shipping, the margin is thin — and a PSA 9 result usually lands below the raw NM price, so the downside of an imperfect grade outweighs the upside unless your copy is flawless.`;
    } else {
      verdict = `A PSA 10 currently carries a premium of about ${usd(premium)} over raw (${ratio.toFixed(1)}x). ${pop && pop.gem >= 80 ? `With an ${pop.gem}% gem rate, clean copies convert to PSA 10 often, so the math can work if the card is truly near-mint.` : pop ? `But the ${pop.gem}% gem rate means a meaningful share of submissions come back PSA 9 or lower, where most of that premium disappears — factor that risk in before submitting.` : `Factor in the risk of a PSA 9 result, where most of that premium disappears.`}`;
    }
    const p8 = pop ? Math.max(0, (pop.total || 0) - (pop.psa10 || 0) - (pop.psa9 || 0)) : 0;
    gradeSection = `
      <h2>Raw vs PSA 10: is grading worth it here?</h2>
      <p>${esc(verdict)}</p>
      ${pop ? `<table class="dataTable"><thead><tr><th>Grade</th><th>Population</th><th>Share</th></tr></thead><tbody>
        <tr><td>PSA 10</td><td class="num">${intl(pop.psa10)}</td><td class="num">${pop.total ? Math.round((pop.psa10 / pop.total) * 100) : 0}%</td></tr>
        <tr><td>PSA 9</td><td class="num">${intl(pop.psa9)}</td><td class="num">${pop.total ? Math.round((pop.psa9 / pop.total) * 100) : 0}%</td></tr>
        <tr><td>PSA 8 or lower</td><td class="num">${intl(p8)}</td><td class="num">${pop.total ? Math.max(0, 100 - Math.round((pop.psa10 / pop.total) * 100) - Math.round((pop.psa9 / pop.total) * 100)) : 0}%</td></tr>
      </tbody></table>
      <p class="srcNoteA">PSA population report for this exact variant. Population only grows — every new PSA 10 adds supply pressure on the graded price.</p>` : ""}`;
  }

  // 타이틀은 실제 검색 문구("<카드> psa 10 price") 매칭 + 월 표기 자동 갱신(야간 재생성)
  const title = `${c.name} (${c.number}) PSA 10 Price & Population — ${MON_LABEL} | OP Box Index`;
  const desc = `${c.name} ${c.number} current prices: raw Japanese NM ${jpy(c.nmJpy)} (about ${usd(nmUsd)})${p10 ? `, PSA 10 ${p10.kind === "sold" ? "sold" : "listed"} near ${usd(p10.v)}` : ""}${pop ? `, PSA population ${intl(pop.total)} (${pop.gem}% gem rate)` : ""}. Variant-verified, updated ${DATA_DATE}.`;

  const faq = [
    { q: `How much is ${c.name} (${c.number}) worth?`, a: `As of ${DATA_DATE}, the raw Japanese near-mint copy runs about ${jpy(c.nmJpy)} (${usd(nmUsd)}) at Japanese retail${p10 ? `, and PSA 10 copies ${p10.kind === "sold" ? "have sold" : "are listed"} near ${usd(p10.v)}` : ""}. Prices move with the market; the figures on this page update with our data refreshes.` },
    ...(pop ? [{ q: `How rare is a PSA 10 of this card?`, a: `PSA has graded ${intl(pop.total)} copies of this exact variant, of which ${intl(pop.psa10)} earned PSA 10 — a ${pop.gem}% gem rate.` }] : []),
    { q: `Which exact printing is this price for?`, a: `This page tracks the "${c.name}" printing only. Other printings of ${c.number} trade at very different prices, so match the artwork and finish exactly before comparing a listing to these numbers.` },
  ];
  const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const artLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: `${c.name} (${c.number}) price guide`, description: desc, image: imgAbs || `${SITE}/og-image.png`, datePublished: "2026-07-17", dateModified: DATA_DATE, inLanguage: "en-US", mainEntityOfPage: { "@type": "WebPage", "@id": canonical }, author: { "@type": "Organization", name: "OP Box Index", url: SITE + "/" }, publisher: { "@type": "Organization", name: "OP Box Index", url: SITE + "/" }, isAccessibleForFree: true });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: SITE + "/" },
    { "@type": "ListItem", position: 2, name: "Card prices", item: SITE + "/cards/" },
    { "@type": "ListItem", position: 3, name: `${c.name} (${c.number})`, item: canonical }] });

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-P73SE1WVD0');
    </script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <!-- 2026-07-24 애드센스 재심사 대비 임시 noindex: 카드 상세는 템플릿 비중이 높아 "얇은 대량 유사페이지"
         판정 위험(감사 확정 이슈). 카드별 고유 서술+실거래 데이터가 쌓이면 index,follow 로 되돌릴 것. -->
    <meta name="robots" content="noindex,follow" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${esc(imgAbs || SITE + "/og-image.png")}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${artLd}</script>
    <script type="application/ld+json">${faqLd}</script>
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="../styles.css?v=20260722e" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .cardHero { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; margin: 14px 0 6px; }
      .cardHero img { width: 200px; border-radius: 12px; border: 1px solid rgba(255,255,255,.1); }
      .priceCards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 12px 0; max-width: 560px; }
      .pc { border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 12px 14px; background: rgba(20,23,28,.6); }
      .pc span { display: block; color: #7d8698; font-size: 12px; margin-bottom: 3px; }
      .pc b { font-size: 21px; color: #eef2ff; font-family: "JetBrains Mono", monospace; }
      .pc small { display: block; color: #7d8698; font-size: 11.5px; margin-top: 3px; }
      .pc.hl b { color: #50dad9; }
      .dataTable { width: 100%; max-width: 560px; border-collapse: collapse; margin: 10px 0 6px; font-size: 14px; }
      .dataTable th { text-align: right; padding: 6px 8px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-weight: 600; }
      .dataTable th:first-child, .dataTable td:first-child { text-align: left; }
      .dataTable td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.06); }
      .dataTable td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .ctaRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .ctaRow a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14); font-weight: 800; }
      .ctaRow a.primary { background: rgba(16,215,160,.14); border-color: rgba(16,215,160,.5); color: #10d7a0; }
      .srcNoteA { color: #7d8698; font-size: 12.5px; margin: 4px 0 16px; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../market.html" data-ko="마켓 지수">Market Index</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow"><a href="index.html" style="color:inherit;">Card Prices</a> · ${esc(code)}</p>
      <h1>${esc(c.name)} <small style="color:#7d8698;font-size:.55em;">${esc(c.number)}${c.rarity ? " · " + esc(c.rarity) : ""}</small></h1>
      <div class="cardHero">
        ${imgRel ? `<img src="${esc(imgRel)}" alt="${esc(`${c.name} ${c.number} One Piece card`)}" loading="eager" decoding="async" />` : ""}
        <div style="flex:1;min-width:260px;">
          <div class="priceCards">
            <div class="pc hl"><span>Japanese NM (raw)</span><b>${usd(nmUsd)}</b><small>${jpy(c.nmJpy)} · Japanese retail${c.nmVenue ? "" : ""} · as of ${esc(DATA_DATE)}</small></div>
            ${p10 ? `<div class="pc"><span>PSA 10 ${p10.kind === "sold" ? "(sold median)" : "(lowest listing)"}</span><b>${usd(p10.v)}</b><small>${p10.kind === "sold" ? `${p10.n} sales` : "ask, not a sale"} · ${esc(p10.date || "")}</small></div>` : ""}
            ${pop ? `<div class="pc"><span>PSA population</span><b>${intl(pop.total)}</b><small>${intl(pop.psa10)} in PSA 10 · ${pop.gem}% gem rate</small></div>` : ""}
          </div>
          <p>${esc(c.name)} is ${rank ? `the <strong>#${rank} chase card</strong> in` : "one of the top chase cards in"} <a href="../sets/${setSlug}.html">${esc(code)} ${esc(s.nameEn || "")}</a>.${boxMult && boxMult > 0.8 ? ` A single raw copy is currently worth about <strong>${boxMult >= 10 ? Math.round(boxMult) : boxMult.toFixed(1)}x a sealed ${esc(code)} box</strong> (${usd(boxUsd)}) — the kind of hit that drives the whole box market.` : ""} ${pop && pop.gem >= 85 ? `Its ${pop.gem}% gem rate means clean copies grade PSA 10 often, which keeps the graded premium over raw in check.` : pop ? `Its ${pop.gem}% gem rate is on the lower side, which makes true PSA 10 copies scarcer than the raw supply suggests.` : ""}</p>
          <div class="ctaRow">
            <a class="primary" href="${ebayRaw}" target="_blank" rel="noopener noreferrer sponsored">Raw copies on eBay</a>
            <a href="${ebayPsa}" target="_blank" rel="noopener noreferrer sponsored">PSA 10 on eBay</a>
          </div>
        </div>
      </div>

      ${serRows ? `<h2>Recent price checkpoints</h2>
      <table class="dataTable"><thead><tr><th>Date</th><th>NM (raw)</th><th>PSA 10</th></tr></thead><tbody>${serRows}</tbody></table>
      <p class="srcNoteA">Checkpoints from our tracking runs (Japanese retail NM; PSA 10 from verified eBay sold medians where available). Sparse rows mean no verified data that day — we leave gaps rather than estimate. Early PSA 10 checkpoints can reflect smaller sold samples than the current figure, so treat the latest row as the most reliable.</p>` : ""}

      ${gradeSection}

      <h2>Verify the variant before you buy</h2>
      <p>${esc(c.number)} exists in multiple printings, and they do <em>not</em> trade at the same price. This page tracks the <strong>${esc(c.name)}</strong> printing specifically. When comparing a listing: match the artwork and finish to the image above, check the card number in the corner, and for graded copies read the PSA label variant line. Our <a href="../articles/one-piece-card-price-guide.html">card price guide</a> covers variant matching in detail, and the <a href="../articles/psa-10-vs-nm-card-prices.html">PSA 10 vs NM guide</a> explains when grading is worth it.</p>

      <h2>FAQ</h2>
      ${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("\n      ")}
    </main>
    <footer class="articleFooter">
      <p class="relatedHead">Related</p>
      <nav class="relatedLinks">
        <a href="../sets/${setSlug}.html">${esc(code)} set guide &amp; box price</a>
        <a href="../psa10-ranking.html">Most valuable PSA 10 cards</a>
        <a href="index.html">All tracked cards</a>
      </nav>
      <p class="affNote">Prices are research references, not offers. As an eBay Partner we may earn a commission from qualifying purchases through eBay links, at no extra cost to you.</p>
    </footer>
  </body>
</html>
`;
  fs.writeFileSync(path.join(CARDS_DIR, fname), html);
  written.push(fname);
  // 허브(cards/index.html)도 개별 카드 페이지와 같은 cards/ 깊이라 ../ 를 유지해야 한다.
  // (과거 .replace("../","") 로 벗겨서 허브 썸네일 24개가 전부 /cards/img/... 404 났음 — 2026-07-21 감사)
  hubItems.push({ slug: fname, name: c.name, number: c.number, code, usd: Math.round(nmUsd), img: imgRel || c.img });
}

// 세트 페이지가 체이스 표에 링크 걸 수 있게 슬러그 맵 출력 (generate-set-pages.js가 읽음)
const cardMap = {};
for (const it of hubItems) cardMap[it.number + "|" + norm(it.name)] = it.slug;
fs.writeFileSync(path.join(CARDS_DIR, "card-map.json"), JSON.stringify(cardMap, null, 1));

// ---- 허브(cards/index.html)
const hubLd = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "One Piece card prices — top tracked cards", itemListElement: hubItems.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: `${it.name} (${it.number})`, url: `${SITE}/cards/${it.slug}` })) });
const hub = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-P73SE1WVD0');
    </script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/cards/" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>One Piece Card Prices — Top ${hubItems.length} Tracked Cards (NM &amp; PSA 10) | OP Box Index</title>
    <meta name="description" content="Individual price pages for the most valuable Japanese One Piece cards: raw NM prices, PSA 10 prices and PSA population, variant-verified and updated with our tracking runs." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="One Piece Card Prices — Top Tracked Cards" />
    <meta property="og:description" content="Raw NM, PSA 10 and population data for the most valuable Japanese One Piece cards." />
    <meta property="og:url" content="${SITE}/cards/" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <script type="application/ld+json">${hubLd}</script>
    <link rel="stylesheet" href="../styles.css?v=20260722e" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .cardGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 18px; }
      .cardGrid a { display: block; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 10px; background: rgba(20,23,28,.6); text-align: center; }
      .cardGrid a:hover { border-color: #10d7a0; }
      .cardGrid img { width: 100%; border-radius: 8px; }
      .cardGrid b { display: block; font-size: 13px; margin-top: 7px; color: #eef2ff; line-height: 1.3; }
      .cardGrid small { color: #7d8698; font-size: 11.5px; }
      .cardGrid .pr { display: block; color: #50dad9; font-family: "JetBrains Mono", monospace; font-weight: 800; margin-top: 3px; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../market.html" data-ko="마켓 지수">Market Index</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow">Card Prices</p>
      <h1>One Piece card prices: the top ${hubItems.length} tracked cards</h1>
      <p>Individual price pages for the most valuable Japanese One Piece Card Game cards we track — raw NM prices from Japanese retail, PSA 10 prices from verified eBay data, and PSA population stats. Every page is variant-specific: a manga rare and its plain parallel are different cards with very different prices. Prices refresh with our tracking runs (as of ${DATA_DATE}).</p>
      <div class="cardGrid">
        ${hubItems.map((it) => `<a href="${it.slug}">${it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="lazy" decoding="async" />` : ""}<b>${esc(it.name)}</b><small>${esc(it.number)} · ${esc(it.code)}</small><span class="pr">$${it.usd.toLocaleString("en-US")}</span></a>`).join("\n        ")}
      </div>
      <p class="srcNoteA" style="color:#7d8698;font-size:12.5px;margin-top:14px;">NM = raw near-mint Japanese single at Japanese retail. Set pages carry the full top-10 tables; this hub covers the cross-set heavy hitters.</p>
    </main>
    <footer class="articleFooter">
      <p class="relatedHead">Related</p>
      <nav class="relatedLinks">
        <a href="../psa10-ranking.html">Most valuable PSA 10 cards</a>
        <a href="../articles/one-piece-card-price-guide.html">Card price guide</a>
        <a href="../sets/index.html">All set guides</a>
      </nav>
      <p class="affNote">OP Box Index is a data-driven research site, not investment advice.</p>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(path.join(CARDS_DIR, "index.html"), hub);

// ---- 사이트맵: 카드 상세는 noindex(2026-07-24 임시) → 사이트맵에서 제거하고 허브(/cards/)만 유지.
//      noindex 페이지를 사이트맵에 두면 GSC 가 "제출됨+색인안됨" 모순으로 계속 표시한다.
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
let removed = 0;
const dropLocs = new Set(written.map((f) => `<loc>${SITE}/cards/${f}</loc>`));
sm = sm.replace(/[ \t]*<url>[\s\S]*?<\/url>\r?\n?/g, (block) => {
  for (const loc of dropLocs) if (block.includes(loc)) { removed++; return ""; }
  return block;
});
const today = new Date().toISOString().slice(0, 10);
if (!sm.includes(`<loc>${SITE}/cards/</loc>`)) {
  sm = sm.replace("</urlset>", `  <url>\n    <loc>${SITE}/cards/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
}
fs.writeFileSync(smPath, sm);
console.log(JSON.stringify({ cards: written.length, sitemapRemoved: removed }));
