// 인기 카드 개별 페이지 생성 — cards/<slug>.html + cards/index.html 허브 + 사이트맵 idempotent
// 대상: NM가 보유 카드 중 상위 N(중복 변형 제거). 카드당 NM/PSA10/인구/이력/박스대비 배수까지 실데이터.
// Run: node tools/generate-card-pages.js
const CSS_VER = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";  // 하드코딩하면 범프 때 가드 V1 이 배포를 막는다(2026-07-27)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";
const TOP_N = 24;
// EPN 규정(Participation Requirements I.G.) — 제휴 고지는 "명확하고 눈에 띄게".
// 2026-08-10 EPN 위반 통지: 문구 자체는 적절하나 푸터에 있어 잘 보이지 않는다는 지적.
// 그래서 본문 상단(접힘선 위)에도 넣는다. 푸터의 affNote 는 그대로 둔다 — 둘 중 하나를 지우지 말 것.
// 스타일은 styles.css 의 .affTop. 작게 줄이거나 opacity 를 낮추면 위반으로 되돌아간다.
const AFF_TOP = `<p class="affTop"><b>Paid Link:</b> As an eBay Partner Network affiliate, we earn from qualifying purchases.</p>`;

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
// 상위 TOP_N + **이전에 이미 공개한 카드**. 순위는 시세에 따라 흔들린다 — 2026-08-25 실측으로
// 유유테이 갱신 한 번에 80장 값이 바뀌면서 OP-02 에이스 망가가 24위 밖으로 밀려 페이지가 지워졌다.
// 살아 있던 URL 이 시세 등락 때문에 404 가 되면 안 된다(노출 페이지는 추가만, 임의 제거 금지).
// 밀려난 카드도 계속 만들되 **데이터는 매번 최신으로** 다시 쓴다 — 남겨두는 것과 방치는 다르다.
const keyOfCard = (c) => c.number + "|" + norm(c.name);
const CARDS_DIR = path.join(ROOT, "cards");
let publishedBefore = {};
try { publishedBefore = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, "card-map.json"), "utf8")); } catch { publishedBefore = {}; }
if (!Object.keys(publishedBefore).length) throw new Error("card-map.json 을 못 읽었다 — 이전 공개 목록 없이 생성하면 살아 있던 페이지가 빠진다");
const top = [...seen.values()].sort((a, b) => b.card.nmJpy - a.card.nmJpy).slice(0, TOP_N);
const inTop = new Set(top.map((x) => keyOfCard(x.card)));
const keptFromBefore = [...seen.values()]
  .filter((x) => !inTop.has(keyOfCard(x.card)) && publishedBefore[keyOfCard(x.card)])
  .sort((a, b) => b.card.nmJpy - a.card.nmJpy);
const cands = [...top, ...keptFromBefore];

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
  // c.img 는 옛 TCGplayer 원격 URL 이다. 오늘 자체호스팅한 c.image 가 있으면 그쪽을 쓴다 —
  // 원격을 그대로 박으면 가드 I1(외부 이미지 핫링크)이 배포를 막는다(2026-07-27 실사고).
  // cards/ 깊이라 상대경로엔 ../ 를 붙인다(가드 I2), og:image 는 절대 URL 이어야 한다.
  const selfHosted = c.image && !/^https?:/.test(c.image) ? c.image.replace(/^\.?\//, "") : null;
  const imgAbs = IMG_MAP[slug] ? `${SITE}/${IMG_MAP[slug]}` : (selfHosted ? `${SITE}/${selfHosted}` : (c.image || c.img || null));
  const imgRel = IMG_MAP[slug] ? `../${IMG_MAP[slug]}` : (selfHosted ? `../${selfHosted}` : (c.image || c.img || null));
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
      verdict = `${c.name} (${c.number}) currently has no measurable slab premium: PSA 10 ${p10.kind === "sold" ? "sales center" : "listings start"} near ${usd(p10.v)}, versus ${usd(nmUsd)} for raw NM${pop ? `, with ${intl(pop.psa10)} PSA 10 copies already reported` : ""}.`;
    } else if (ratio < 1.5) {
      verdict = `${c.name} (${c.number}) carries a narrow ${usd(premium)} PSA 10 premium (${Math.round((ratio - 1) * 100)}%) over its ${usd(nmUsd)} raw reference, before grading fees, shipping or the risk of a lower grade.`;
    } else {
      verdict = `${c.name} (${c.number}) shows a ${usd(premium)} PSA 10 premium, or ${ratio.toFixed(1)}x its raw reference${pop ? `, alongside a ${pop.gem}% exact-variant gem rate` : ""}; this is a market spread, not a guaranteed grading return.`;
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
      <p class="srcNoteA">Exact-printing PSA report for ${esc(c.name)} ${esc(c.number)}; population is cumulative, while price observations are dated.</p>` : ""}`;
  } else {
    // PSA10 실거래·인구가 아직 없는 변형(금·은 SP 등) — 빈 채로 두면 페이지가 얇아지고,
    // 추정치를 넣는 건 금지다. 대신 "왜 없는지"와 세트 맥락(검증된 값만)을 설명한다. 2026-07-30.
    const sf = s.psaFull;
    gradeSection = `
      <h2>${esc(c.name)} PSA 10 market status</h2>
      <p>No PSA 10 figure is shown for ${esc(c.name)} (${esc(c.number)}) because fewer than three completed sales of this exact artwork and label passed our variant check.</p>
      <ul class="factList">
        <li>Required exact-printing sales: 3</li>
        <li>Fallback estimate: none</li>
        ${sf && sf.total ? `<li>${esc(code)} Japanese PSA submissions: ${intl(sf.total)} · gem rate: ${sf.gemRate}%${sf.wowAdd != null ? ` · latest recorded week: +${intl(sf.wowAdd)}` : ""}</li>` : ""}
        <li><a href="../sets/${setSlug}.html">Open the ${esc(code)} set-level grading and box record</a></li>
      </ul>`;
  }

  // 타이틀은 실제 검색 문구("<카드> psa 10 price") 매칭 + 월 표기 자동 갱신(야간 재생성)
  const title = `${c.name} (${c.number}) PSA 10 Price & Population — ${MON_LABEL} | OP Box Index`;
  const desc = `${c.name} ${c.number} current prices: raw Japanese NM ${usd(nmUsd)}${p10 ? `, PSA 10 ${p10.kind === "sold" ? "sold" : "listed"} near ${usd(p10.v)}` : ""}${pop ? `, PSA population ${intl(pop.total)} (${pop.gem}% gem rate)` : ""}. Variant-verified, updated ${DATA_DATE}.`;

  const faq = [
    { q: `How much is ${c.name} (${c.number}) worth?`, a: `On ${DATA_DATE}, ${c.name} ${c.number} was tracked near ${usd(nmUsd)} in Japanese near-mint condition${p10 ? `; its PSA 10 ${p10.kind === "sold" ? "sold median was" : "lowest verified listing was"} ${usd(p10.v)}` : "; no PSA 10 figure met the exact-variant sales rule"}.` },
    ...(pop ? [{ q: `How rare is a PSA 10 ${c.name}?`, a: `PSA reports ${intl(pop.total)} graded copies of the tracked ${c.name} ${c.number} printing, including ${intl(pop.psa10)} in PSA 10 for a ${pop.gem}% gem rate.` }] : []),
    { q: `Which ${c.name} printing does this page track?`, a: `The ${c.name} value on this page applies only to the ${c.number} artwork shown above; buyers should match its artwork, finish, card number and graded-label variant.` },
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
    <script defer src="/track.js"></script>
    <!-- No AdSense on noindex card detail pages; eBay EPN links remain active. -->
    <!-- Card details remain noindex and ad-free through the AdSense review window.
         Reconsider indexing separately after enough exact-variant sale history accumulates. -->
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
    <link rel="stylesheet" href="../styles.css?v=${CSS_VER}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .cardHero { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; margin: 14px 0 6px; }
      .cardHero img { width: 200px; height: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,.1); }
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
      .factList { max-width: 680px; color: #9aa4b6; line-height: 1.7; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../cards/index.html" data-ko="카드">Cards</a><a href="../auction.html" data-ko="경매">Auctions</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="index.html" style="color:inherit;">Card Prices</a> · ${esc(code)}</p>
      <h1>${esc(c.name)} <small style="color:#7d8698;font-size:.55em;">${esc(c.number)}${c.rarity ? " · " + esc(c.rarity) : ""}</small></h1>
      ${AFF_TOP}
      <div class="cardHero">
        ${imgRel ? `<img src="${esc(imgRel)}" alt="${esc(`${c.name} ${c.number} One Piece card`)}" width="716" height="1000" loading="eager" decoding="async" fetchpriority="high" />` : ""}
        <div style="flex:1;min-width:260px;">
          <div class="priceCards">
            <!-- 표기는 달러 하나로 통일한다(2026-08-17). 엔화 원본은 화면에서 빼고 데이터(CSV/JSON)에 남긴다 —
                 한 줄에 통화가 둘이면 정작 비교해야 할 달러 값이 묻힌다. -->
            <div class="pc hl"><span>Japanese NM (raw)</span><b>${usd(nmUsd)}</b><small>Japanese retail · as of ${esc(DATA_DATE)}</small></div>
            ${p10 ? `<div class="pc"><span>PSA 10 ${p10.kind === "sold" ? "(sold median)" : "(lowest listing)"}</span><b>${usd(p10.v)}</b><small>${p10.kind === "sold" ? `${p10.n} sales` : "ask, not a sale"} · ${esc(p10.date || "")}</small></div>` : ""}
            ${pop ? `<div class="pc"><span>PSA population</span><b>${intl(pop.total)}</b><small>${intl(pop.psa10)} in PSA 10 · ${pop.gem}% gem rate</small></div>` : ""}
          </div>
          <p>${esc(c.name)} is ${rank ? `the <strong>#${rank} chase card</strong> in` : "one of the top chase cards in"} <a href="../sets/${setSlug}.html">${esc(code)} ${esc(s.nameEn || "")}</a>.${boxMult && boxMult > 0.8 ? ` One raw ${esc(c.name)} is currently worth about <strong>${boxMult >= 10 ? Math.round(boxMult) : boxMult.toFixed(1)}x a sealed ${esc(code)} box</strong> (${usd(boxUsd)}).` : ""} ${pop && pop.gem >= 85 ? `${esc(c.name)} has a ${pop.gem}% exact-variant gem rate, which helps explain its raw-to-slab spread.` : pop ? `${esc(c.name)} has a ${pop.gem}% exact-variant gem rate, so PSA 10 supply is materially smaller than total submissions.` : ""}</p>
          <div class="ctaRow">
            <a class="primary" href="${ebayRaw}" target="_blank" rel="noopener noreferrer sponsored">Raw copies on eBay</a>
            <a href="${ebayPsa}" target="_blank" rel="noopener noreferrer sponsored">PSA 10 on eBay</a>
          </div>
        </div>
      </div>

      ${serRows ? `<h2>Recent price checkpoints</h2>
      <table class="dataTable"><thead><tr><th>Date</th><th>NM (raw)</th><th>PSA 10</th></tr></thead><tbody>${serRows}</tbody></table>
      <p class="srcNoteA">${esc(c.name)} checkpoints use Japanese-retail NM observations and exact-variant eBay sold medians; missing cells remain unestimated.</p>` : ""}

      ${gradeSection}

      <h2>${esc(c.name)} variant record</h2>
      <ul class="factList">
        <li>Tracked card number: ${esc(c.number)}</li>
        <li>Tracked name: ${esc(c.name)}</li>
        <li>Rarity label: ${esc(c.rarity || "not supplied")}</li>
        <li>Required listing match: artwork, finish, number and PSA label</li>
        <li><a href="../articles/one-piece-card-price-guide.html">Variant-matching method</a> · <a href="../articles/psa-10-vs-nm-card-prices.html">PSA 10 vs NM method</a></li>
      </ul>

      <h2>FAQ</h2>
      ${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("\n      ")}
    </main>
    <footer class="articleFooter">
      <p class="relatedHead">Related</p>
      <nav class="relatedLinks">
        <a href="../sets/${setSlug}.html">${esc(code)} set guide &amp; box price</a>
        <a href="../psa10-ranking.html">Most valuable PSA 10 cards</a>
        <a href="index.html">All tracked cards</a>
        <a href="../about.html">About the research</a>
        <a href="../methodology.html">Methodology</a>
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

// 이번 실행에서 안 만든 카드 페이지 — **지우지 않고 보고만 한다**(2026-08-25).
// 종전엔 바로 unlink 했다. 그 결과 시세가 조금 움직이면 살아 있던 URL 이 404 가 됐다.
// 실제로 남는 경우는 카드 이름이 바뀌어 슬러그가 갈린 때다. 사람이 보고 정리한다: --prune
const currentCardFiles = new Set(written);
const orphans = [];
for (const file of fs.readdirSync(CARDS_DIR)) {
  if (file === "index.html" || !file.endsWith(".html") || currentCardFiles.has(file)) continue;
  orphans.push(file);
}
const pruned = [];
if (process.argv.includes("--prune")) {
  for (const file of orphans) { fs.unlinkSync(path.join(CARDS_DIR, file)); pruned.push(file); }
}

// 세트 페이지가 체이스 표에 링크 걸 수 있게 슬러그 맵 출력 (generate-set-pages.js가 읽음)
const cardMap = {};
for (const it of hubItems) cardMap[it.number + "|" + norm(it.name)] = it.slug;
fs.writeFileSync(path.join(CARDS_DIR, "card-map.json"), JSON.stringify(cardMap, null, 1));

// ---- 허브(cards/index.html)
const hubLd = JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "One Piece card prices — top tracked cards", itemListElement: hubItems.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: `${it.name} (${it.number})`, url: `${SITE}/cards/${it.slug}` })) });
const ebayCardHub = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent("One Piece Card Game Japanese")}&_sop=15&${EPN}`;
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
    <script defer src="/track.js"></script>
    <!-- Navigation hubs stay ad-free during AdSense site approval. -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/cards/" />
    <link rel="alternate" hreflang="en" href="${SITE}/cards/" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/cards.html" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/cards/" />
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
    <link rel="stylesheet" href="../styles.css?v=${CSS_VER}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .cardGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 18px; }
      .cardGrid a { display: block; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 10px; background: rgba(20,23,28,.6); text-align: center; }
      .cardGrid a:hover { border-color: #10d7a0; }
      .cardGrid img { display: block; width: 100%; height: auto; border-radius: 8px; }
      .cardGrid b { display: block; font-size: 13px; margin-top: 7px; color: #eef2ff; line-height: 1.3; }
      .cardGrid small { color: #7d8698; font-size: 11.5px; }
      .cardGrid .pr { display: block; color: #50dad9; font-family: "JetBrains Mono", monospace; font-weight: 800; margin-top: 3px; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../cards/index.html" data-ko="카드">Cards</a><a href="../auction.html" data-ko="경매">Auctions</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">Card Prices</p>
      <h1>One Piece card prices: the top ${hubItems.length} tracked cards</h1>
      <p>Individual price pages for the most valuable Japanese One Piece Card Game cards we track — raw NM prices from Japanese retail, PSA 10 prices from verified eBay data, and PSA population stats. Every page is variant-specific: a manga rare and its plain parallel are different cards with very different prices. Prices refresh with our tracking runs (as of ${DATA_DATE}).</p>
      ${AFF_TOP}
      <div class="cardGrid">
        ${hubItems.map((it) => `<a href="${it.slug}">${it.img ? `<img src="${esc(it.img)}" alt="${esc(it.name)}" width="716" height="1000" loading="lazy" decoding="async" />` : ""}<b>${esc(it.name)}</b><small>${esc(it.number)} · ${esc(it.code)}</small><span class="pr">$${it.usd.toLocaleString("en-US")}</span></a>`).join("\n        ")}
      </div>
      <p class="srcNoteA" style="color:#7d8698;font-size:12.5px;margin-top:14px;">NM = raw near-mint Japanese single at Japanese retail. Set pages carry the full top-10 tables; this hub covers the cross-set heavy hitters.</p>
      <p><a href="${ebayCardHub}" target="_blank" rel="noopener noreferrer sponsored">Browse current Japanese One Piece card listings on eBay</a></p>
      <section style="max-width:720px" aria-label="How these prices are built">
        <h2 style="font-size:19px;margin:26px 0 8px">How these card prices are built</h2>
        <p style="color:#9aa4b6;font-size:14px;line-height:1.7">The most expensive card tracked here is currently <strong>${esc(hubItems[0].name)}</strong> (${esc(hubItems[0].code)} ${esc(hubItems[0].number)}) at about $${hubItems[0].usd.toLocaleString("en-US")} raw, and the entry point for this top ${hubItems.length} sits near $${hubItems[hubItems.length - 1].usd.toLocaleString("en-US")}. Raw NM prices come from Japanese retail stock we check directly; PSA 10 figures come from completed eBay sales (minimum three per card), never from asking prices. Where a variant has no verified sales, its page says so instead of showing a guess.</p>
        <p style="color:#9aa4b6;font-size:14px;line-height:1.7">Variant matching is the whole game. The same card number can exist as a base print, an alternate art, a manga art and an SP — and they can differ in price by a factor of ten or more. Every page here is pinned to one exact printing, verified against the official Japanese card list, so the image you see is the printing the numbers describe. If a listing you find looks cheaper than our figure, first check that the artwork matches.</p>
        <p style="color:#9aa4b6;font-size:14px;line-height:1.7">To go deeper: the <a href="../psa10-ranking.html">PSA 10 value ranking</a> orders every tracked card by graded sold price, <a href="../psa-grading.html">the population page</a> shows how much of each set has been graded, and each <a href="../sets/index.html">set guide</a> ties the cards back to the sealed box market they come from.</p>
      </section>
    </main>
    <footer class="articleFooter">
      <p class="relatedHead">Related</p>
      <nav class="relatedLinks">
        <a href="../psa10-ranking.html">Most valuable PSA 10 cards</a>
        <a href="../articles/one-piece-card-price-guide.html">Card price guide</a>
        <a href="../sets/index.html">All set guides</a>
        <a href="../about.html">About the research</a>
        <a href="../methodology.html">Methodology</a>
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
console.log(JSON.stringify({ cards: written.length, keptFromBefore: keptFromBefore.length, orphans, pruned, sitemapRemoved: removed }));
