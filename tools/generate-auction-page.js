// auction.html (영어, 루트) — 원피스 이베이 경매 "실낙찰" 데이터 페이지.
// 소유자 우선순위(2026-08-01): 해외(영어) 유저 유입이 1순위. 경매 데이터셋은 우리만 가진 자산인데
// 영어 지면이 없었다 — "one piece card auction results / ebay sold prices / sell-through" 검색 정조준.
//
// ── 2026-10-13 재설계(승인 목업 "가격판 우선")
// 소유자 지시: 우리가 쓴 문장(요약·해설·FAQ)을 넣지 않는다. 보는 사람이 숫자를 보고 스스로 판단한다.
// 허용 글자: 제목·열 이름·기간 라벨·단위/정의 한 토막·링크 텍스트. 내부 용어(checked/ended/partial …) 금지.
// 구조: ① h1 + 제휴 고지 ② 시장 온도 3칸(최근 7일 vs 직전 7일) ③ 카드 가격판(생카드 변형 단위, PSA 10 별도 열)
//       ④ 주별 낙찰률 막대 ⑤ 종류별 표 ⑥ 세트별 표(최근 30일).
// 원칙: 값은 전부 data/ 파생파일·원장(auction-archive)에서 파생. 추정·하드코딩 금지, 없으면 "—".
//   · 합산(시장 온도·종류별)은 **완전 수집일만** 쓴다(부분수집일은 덜 센 날이라 섞으면 건수는 줄고 비율은 치우친다).
//   · 진행 중인 오늘은 뺀다(2026-08-25 사고: 반쪽 하루가 정상일처럼 실렸다).
//   · 중앙값은 일별 중앙값을 다시 중앙값 내지 않고 원장의 낙찰 건을 한 줄로 세워 자른다(2026-09-01 실측).
// 표는 전부 서버에서 그린다 — JS 없는 크롤러·audit-thin-pages(<td 수)가 내용을 본다. JS 는 탭·더보기·스와이프 힌트만.
// 기존 페이지의 노출 상태(title/canonical/hreflang/robots/JSON-LD/사이트맵)는 건드리지 않는다 — 문구만 다듬는다.
// Run: node tools/generate-auction-page.js
const fs = require("fs");
const path = require("path");
const { navHtml } = require("./site-nav");
const { readRecent } = require("./auction-archive");
const { summarizeKinds, med, perUnit } = require("./auction-aggregate");
const { AFF_TOP, epnUrl } = require("./set-page-shared");
const { variant: imageVariant } = require("./image-variants");
// 변형(tier) 판별은 집계기(auction-card-stats)와 같은 함수 — 썸네일을 번호만 보고 붙이면 다른 변형 그림이 붙는다.
const { ourTier } = require("./cgc-card-pop-ingest");
// 한국어 토글(data-ko)용 사전 — ko/auction.html(generate-ko-topic-pages)과 같은 파일을 쓴다. 두 곳이 다르면 같은 카드가 다른 한글 이름으로 나온다.
const { koCharOf, tierEn, tierKo } = require("./ko-labels");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const d = J("onepiece-packs.json");
const auc = J("auction-sold.json");
// partial 판정은 auction-series.json 만 들고 있다.
let aucSeries = { daily: [] };
try { aucSeries = J("auction-series.json"); } catch (e) {}
const PARTIAL_DAYS = new Set((aucSeries.daily || []).filter((r) => r.partial).map((r) => r.d));
const cardStats = J("auction-card-stats.json");
let setStats = { window: {}, sets: {} };
try { setStats = J("set-auction-stats.json"); } catch (e) {}
const DATA_DATE = d.updated || "";

// ── 짧은 포맷 함수
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-US"));
const pct = (v) => (v == null || !isFinite(v) ? "—" : `${v}%`);
// 돈: 정수면 $9,989, 아니면 $16.26 — 소수 두 자리를 자르지 않는다(낙찰가는 센트 단위다).
const money = (v) => (v == null || !isFinite(v) ? "—" : "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
const bare = (v) => money(v).replace(/^\$/, "");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso) => { if (!iso) return "—"; const [, m, dd] = iso.split("-").map(Number); return `${MON[m - 1]} ${dd}`; };
const mdy = (iso) => (iso ? `${md(iso)}, ${iso.slice(0, 4)}` : "—");
// 한국어 토글용 날짜(ko/auction.html 과 같은 꼴: 7/20, 기준일은 ISO 그대로).
const mdKo = (iso) => { if (!iso) return "—"; const [, m, dd] = iso.split("-").map(Number); return `${m}/${dd}`; };
const q = (arr, f = 0.5) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) * f)]; };

// ── 날짜 창 ──────────────────────────────────────────────────────────────────
// 진행 중인 오늘은 **여기서** 잘라낸다(2026-08-25). 합산은 완전 수집일만(2026-08-26 감사).
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const allDays = (auc.daily || []).filter((x) => x.d < TODAY_ISO);
if (allDays.length < 3) { console.error("일별 집계가 3일 미만 — 페이지 미생성"); process.exit(1); }
const fullAll = allDays.filter((x) => !PARTIAL_DAYS.has(x.d));
const aggDays = fullAll.length >= 3 ? fullAll : allDays;   // 완전일이 너무 적으면 전체로 폴백
const skippedDays = allDays.length - aggDays.length;       // 합산에서 뺀 부분수집일 수(라벨에 적는다)
const aggFrom = aggDays[0].d;
const DATA_THROUGH = aggDays[aggDays.length - 1].d;        // 마지막 완전 수집일 — 화면의 "Data through"
const totN = aggDays.reduce((t, x) => t + x.n, 0);
const totSold = aggDays.reduce((t, x) => t + x.sold, 0);
const st = totN ? Math.round((totSold / totN) * 100) : 0;

// 원장 — 주별 막대·7일 창·종류별 전부 여기서 직접 낸다(일별 값을 다시 평균/중앙값 내지 않는다).
const ledger = readRecent(400).filter((r) => r && r.d && r.d < TODAY_ISO);

// ── ② 시장 온도: 최근 7일 vs 직전 7일(완전 수집일만) ─────────────────────────
// 낙찰률 분모는 결과가 확정된 건(sold !== null)만 — 주별 막대와 같은 식.
function windowStats(days) {
  const set = new Set(days.map((x) => x.d));
  const rows = ledger.filter((r) => set.has(r.d));
  const decided = rows.filter((r) => r.sold !== null);
  const sold = rows.filter((r) => r.sold === true);
  const prices = sold.map(perUnit).filter(Number.isFinite);
  return {
    days: days.length, from: days.length ? days[0].d : null, to: days.length ? days[days.length - 1].d : null,
    closed: rows.length,
    rate: decided.length ? Number(((sold.length / decided.length) * 100).toFixed(1)) : null,
    med: med(prices),
  };
}
const last7 = windowStats(aggDays.slice(-7));
const prev7 = windowStats(aggDays.slice(-14, -7));
// 14개 완전일 사이에 부분수집일이 끼어 달력상 14일보다 긴 창이면 라벨에 적는다.
const spanDays = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1 : 0);
const tempGap = prev7.from && last7.to ? spanDays(prev7.from, last7.to) - (last7.days + prev7.days) : 0;

// ── ④ 주별 낙찰률 — 원장에서 직접, 월요일 시작 ──────────────────────────────────
const weekKey = (iso) => { const t = new Date(iso + "T00:00:00Z"); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); };
const weekEnd = (k) => { const t = new Date(k + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 6); return t.toISOString().slice(0, 10); };
const weekly = (() => {
  const buckets = new Map();
  for (const r of ledger) {
    const k = weekKey(r.d);
    if (!buckets.has(k)) buckets.set(k, { rows: [], missing: false });
    const b = buckets.get(k);
    b.rows.push(r);
    if (PARTIAL_DAYS.has(r.d)) b.missing = true;
  }
  return [...buckets.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, b]) => {
    const decided = b.rows.filter((r) => r.sold !== null);
    const sold = b.rows.filter((r) => r.sold === true);
    return {
      week: k, closed: b.rows.length, sold: sold.length,
      rate: decided.length ? Number(((sold.length / decided.length) * 100).toFixed(1)) : null,
      missing: b.missing,
      now: weekEnd(k) > DATA_THROUGH,   // 아직 다 차지 않은 주 — 흐리게 + "so far"
    };
  }).filter((w) => w.rate != null);
})();

// ── ⑤ 종류별(전 기간 완전 수집일) ─────────────────────────────────────────────
const kindSummary = summarizeKinds(ledger, aggDays.map((x) => x.d));
const KIND_MIN = 25;        // 낙찰률을 말하려면 이만큼은 확인했어야 한다
const KIND_PRICE_MIN = 12;  // 중앙 낙찰가를 말하려면 낙찰 건수가 이만큼
const KIND_LABEL = { card: ["Single card", "싱글 카드"], pack: ["Booster pack", "부스터 팩"], box: ["Sealed box", "밀봉 박스"], carton: ["Sealed case", "밀봉 케이스"] };
const KIND_QUERY = { card: "One Piece Card Game card", pack: "One Piece Card Game booster pack sealed", box: "One Piece Card Game booster box sealed", carton: "One Piece Card Game booster case sealed" };
const kindRows = Object.entries(kindSummary)
  .map(([k, v]) => ({
    key: k, en: (KIND_LABEL[k] || [k, k])[0], ko: (KIND_LABEL[k] || [k, k])[1],
    n: v.n, sold: v.sold,
    rate: v.n >= KIND_MIN ? v.sellThrough : null,
    // 판별 중앙가 — 박스는 일본판과 영문판이 4배 가까이 차이나서 하나로 합치면 어느 쪽도 아닌 수가 된다.
    jp: v.byEd.jp.priceN >= KIND_PRICE_MIN ? v.byEd.jp.med : null,
    en_: v.byEd.en.priceN >= KIND_PRICE_MIN ? v.byEd.en.med : null,
  }))
  .filter((r) => r.n > 0)
  .sort((a, b) => b.n - a.n);

// ── ⑥ 세트별(최근 30일, build-set-auction-stats) ───────────────────────────────
const SET_MIN = Number(setStats.window && setStats.window.minDecided) || 30;
const setRows = Object.entries(setStats.sets || {})
  .map(([code, s]) => ({ code, name: (d.sets[code] || {}).nameEn || null, nameKo: (d.sets[code] || {}).nameKo || null, closed: s.ended, rate: s.thin ? null : s.sellThrough, med: s.medPrice }))
  .filter((s) => s.closed >= SET_MIN)
  .sort((a, b) => b.closed - a.closed);
const SET_SHOW = 15;
// 세트 코드 → 세트 가이드 링크(있는 페이지만) — 표의 링크는 첫 칸에 둔다(소유자 규칙).
const setHref = (code) => (fs.existsSync(path.join(ROOT, "sets", code.toLowerCase() + ".html")) ? `sets/${code.toLowerCase()}.html` : null);

// ── ③ 카드 가격판 — 생카드 변형(번호|판|변형) 단위, suspect 제외 ──────────────────
// auction-card-stats.js 가 contestedSold<3 또는 PSA10 2배 초과를 suspect 로 표시한다(2026-10-13). 그 값은 아직 확인되지 않은 가격이라 순위에서 뺀다.
const CARD_WINDOW_DAYS = (String(cardStats.window || "").match(/(\d+)\s*d/) || [])[1] || null;
const IMG_DIR = path.join(ROOT, "img", "cards");
let IMG_FILES = [];
try { IMG_FILES = fs.readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort(); } catch (e) {}
// 썸네일은 번호 + 변형이 같은 파일만 쓴다. 번호만 맞추면 base 행에 SP 금박 그림이 붙는다(OP05-119 는 파일이 4개).
function cardImg(id, tier) {
  const pre = id.toLowerCase() + "-";
  const hit = IMG_FILES.find((f) => f.startsWith(pre) && ourTier(f.slice(pre.length).replace(/\.[^.]+$/, "").replace(/-/g, " ")) === tier);
  if (!hit) return null;
  const v = imageVariant("img/cards/" + hit, "thumb");
  return v ? v.src : "img/cards/" + hit;
}
const setCodeOf = (id, c) => (c && c.set) || id.replace(/^([A-Z]+)(\d+)-.*$/i, "$1-$2").toUpperCase();
// 진행 중 eBay 경매(종료 임박순). customid 는 EPN 보고서에서 자리별 클릭·수익을 가르는 꼬리표(auc-card / auc-kind).
const liveAuctionUrl = (query, spot) => epnUrl(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Auction=1&_sop=1&customid=${spot}`);
const variants = Object.entries(cardStats.variants || {})
  .map(([key, v]) => {
    const [id, ed, tier] = key.split("|");
    const c = (cardStats.cards || {})[id];
    return {
      id, ed, tier, tierLabel: tierEn(tier), tierKo: tierKo(tier),
      set: setCodeOf(id, c),
      name: v.name || id,
      nameKo: koCharOf(v.name),   // 사전에 있는 캐릭터명만 — 없으면 토글해도 영문 그대로

      price: v.medPriceContested != null ? v.medPriceContested : v.medPrice,
      low: v.low, high: v.high, rate: v.sellThrough, sold: v.sold, n: v.n,
      psa10Med: v.psa10Med, psa10Sold: v.psa10Sold,
      suspect: !!v.suspect,
      img: cardImg(id, tier),
      ebay: liveAuctionUrl(`One Piece ${id}`, "auc-card"),
    };
  })
  .filter((v) => !v.suspect && (v.ed === "jp" || v.ed === "en") && v.price != null);
const CARD_TOP = 20, CARD_SHOW = 10;
const byPrice = variants.slice().sort((a, b) => b.price - a.price || b.sold - a.sold).slice(0, CARD_TOP);
const bySales = variants.slice().sort((a, b) => b.sold - a.sold || b.price - a.price).slice(0, CARD_TOP);
// PSA 10 열은 가격판 행 가운데 한 줄이라도 값이 있을 때만 그린다(2026-10-13 QA: 40행 전부 "—" 인 죽은 열이 폭만 차지했다).
// 값이 생기면(같은 변형 PSA 10 낙찰 3건 이상) 열·정의 토막·스와이프 힌트가 저절로 돌아온다. ko/auction.html 도 같은 규칙.
const HAS_PSA = [...byPrice, ...bySales].some((v) => v.psa10Med != null);

// ── HTML 조각 ────────────────────────────────────────────────────────────────
const live = (url) => (url ? `<a class="live" href="${esc(url)}" target="_blank" rel="noopener noreferrer sponsored" data-ko="진행 경매 →">Live auctions →</a>` : "");
const thumb = (v, i) => (v.img
  ? `<img class="thumb" src="${esc(v.img)}" alt="" width="36" height="50"${i >= 3 ? ' loading="lazy"' : ""} />`
  : `<span class="thumb ph" aria-hidden="true">${v.set.split("-").map((p) => `<span>${esc(p)}</span>`).join("")}</span>`);
function boardRow(v, i) {
  const ed = v.ed === "jp" ? "JP" : "EN";
  const range = v.low != null && v.high != null ? `${money(v.low)}–${bare(v.high)}` : "—";
  const psa = v.psa10Med == null ? "—" : `<span class="pv psa">${money(v.psa10Med)}</span><span class="sub2" data-ko="${num(v.psa10Sold)}건">${num(v.psa10Sold)} sold</span>`;
  return `<tr${i >= CARD_SHOW ? " hidden" : ""}>
  <td class="l"><div class="cardCell"><span class="rank">${i + 1}</span>${thumb(v, i)}<div class="info">
    <div class="nameLine"><span class="name"${v.nameKo ? ` data-ko="${esc(v.nameKo)}"` : ""}>${esc(v.name)}</span><span class="chip var" data-ko="${esc(v.id)} · ${esc(v.tierKo)}">${esc(v.id)} · ${esc(v.tierLabel)}</span><span class="chip ed dOnly">${ed}</span></div>
    <div class="meta mOnly" data-ko="${ed} · ${num(v.n)}건 중 ${num(v.sold)}건 낙찰 · ${pct(v.rate)}">${ed} · ${num(v.sold)} of ${num(v.n)} sold · ${pct(v.rate)}</div>
    ${live(v.ebay)}
  </div></div></td>
  <td><span class="pv">${money(v.price)}</span><span class="sub2 mOnly">${range}</span>${v.psa10Med != null ? `<span class="sub2 mOnly psaM">PSA 10 <b>${money(v.psa10Med)}</b></span>` : ""}</td>
  <td class="dOnly"><span class="range">${range}</span></td>
  <td class="dOnly">${pct(v.rate)}</td>
  <td class="dOnly">${num(v.sold)}<span class="sub2" data-ko="${num(v.n)}건 중">of ${num(v.n)}</span></td>${HAS_PSA ? `
  <td class="dOnly">${psa}</td>` : ""}
</tr>`;
}
const boardBody = (rows, id, hidden) => `<tbody id="${id}"${hidden ? " hidden" : ""}>\n${rows.map(boardRow).join("\n")}\n</tbody>`;

const kindTr = kindRows.map((k) => `<tr>
  <td class="l"><span class="kind" data-ko="${esc(k.ko)}">${esc(k.en)}</span><br />${live(liveAuctionUrl(KIND_QUERY[k.key] || `One Piece Card Game ${k.key}`, "auc-kind"))}</td>
  <td>${pct(k.rate)}${k.rate != null ? `<div class="bar" aria-hidden="true"><i style="width:${k.rate}%"></i></div>` : ""}</td>
  <td>${money(k.jp)}</td>
  <td>${money(k.en_)}</td>
</tr>`).join("\n");

const setTr = setRows.map((s, i) => `<tr${i >= SET_SHOW ? " hidden" : ""}>
  <td class="l">${setHref(s.code) ? `<a class="setCode" href="${setHref(s.code)}">${esc(s.code)}</a>` : `<span class="setCode">${esc(s.code)}</span>`}${s.name && s.name !== s.code ? `<span class="setName"${s.nameKo ? ` data-ko="${esc(s.nameKo)}"` : ""}>${esc(s.name)}</span>` : ""}</td>
  <td>${num(s.closed)}</td>
  <td>${pct(s.rate)}</td>
  <td>${money(s.med)}</td>
</tr>`).join("\n");

// 시장 온도 칸 — 화살표·차이·직전값. 종료 건수의 증감은 좋고 나쁨이 없어 색을 입히지 않는다.
const tenth = (x) => Math.round(x * 10) / 10;
// deltaFmtKo 가 있으면 차이 칸에 data-ko 를 붙인다(단위가 다른 "pts" ↔ "%p" 만 해당, 돈·건수는 양쪽이 같다).
function kpi(labelEn, labelKo, cur, prev, fmt, deltaFmt, colored, deltaFmtKo) {
  const has = cur != null && prev != null;
  const diff = has ? cur - prev : null;
  const arrow = diff == null ? "" : diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
  const cls = colored && diff != null ? (diff > 0 ? " up" : diff < 0 ? " down" : "") : "";
  const delta = diff == null ? "—" : `${arrow} ${deltaFmt(Math.abs(diff))}`;
  const deltaKo = diff != null && deltaFmtKo ? ` data-ko="${esc(`${arrow} ${deltaFmtKo(Math.abs(diff))}`)}"` : "";
  return `<div class="kpi"><span class="lbl" data-ko="${esc(labelKo)}">${esc(labelEn)}</span><b>${fmt(cur)}</b><span class="delta${cls}"${deltaKo}>${delta}</span><span class="was"><span data-ko="직전">was</span> ${fmt(prev)}</span></div>`;
}
const strip = [
  kpi("Sell rate", "낙찰률", last7.rate, prev7.rate, pct, (x) => `${tenth(x)} pts`, true, (x) => `${tenth(x)}%p`),
  kpi("Median sold price", "중앙 낙찰가", last7.med, prev7.med, money, (x) => money(Math.round(x * 100) / 100), true),
  kpi("Auctions closed", "종료 경매", last7.closed, prev7.closed, num, num, false),
].join("\n        ");
const tempRange = last7.from && prev7.from ? `${md(last7.from)} – ${md(last7.to)} vs ${md(prev7.from)} – ${md(prev7.to)}` : "";
const tempRangeKo = last7.from && prev7.from ? `${mdKo(last7.from)}–${mdKo(last7.to)} vs ${mdKo(prev7.from)}–${mdKo(prev7.to)}` : "";

// 주별 막대 — 축 하나, 눈금은 최고값을 10 단위로 올린 값과 그 절반. 값 라벨은 데스크톱 전부, 모바일은 처음·끝·최고·최저만.
const WK_TOP = Math.max(10, Math.ceil(Math.max(...weekly.map((w) => w.rate)) / 10) * 10);
const wkRates = weekly.map((w) => w.rate);
const wkHi = Math.max(...wkRates), wkLo = Math.min(...wkRates);
const wkCols = weekly.map((w, i) => {
  const key = i === 0 || i === weekly.length - 1 || w.rate === wkHi || w.rate === wkLo;
  const title = `Week of ${md(w.week)}: ${pct(w.rate)} sold (${num(w.sold)} of ${num(w.closed)})${w.now ? " — so far" : ""}${w.missing ? " — some days missing" : ""}`;
  return `<div class="col${key ? " key" : ""}${w.now ? " now" : ""}" style="--h:${tenth((w.rate / WK_TOP) * 100)}%" title="${esc(title)}"><span class="v">${w.rate}</span><i></i></div>`;
}).join("");
const wkMid = weekly[Math.floor(weekly.length / 2)];
const wkLast = weekly[weekly.length - 1];
const axisDate = (iso) => `<span data-ko="${mdKo(iso)}">${md(iso)}</span>`;
const wkAxis = weekly.length ? `<span>${axisDate(weekly[0].week)}</span><span>${axisDate(wkMid.week)}</span><span>${axisDate(wkLast.week)}${wkLast.now ? ` · <span data-ko="진행 중">so far</span>` : ""}</span>` : "";
const wkRange = weekly.length ? `${weekly.length} weeks · ${md(weekly[0].week)} – ${md(DATA_THROUGH)}` : "";
const wkRangeKo = weekly.length ? `${weekly.length}주 · ${mdKo(weekly[0].week)}–${mdKo(DATA_THROUGH)}` : "";

// 제휴 고지 — 공용 AFF_TOP(가드 E1 이 보는 .affTop)에 한국어 토글용 data-ko-html 만 얹는다(굵은 글씨가 있어 data-ko 로는 못 바꾼다). 문구는 ko/auction.html 과 같다.
const AFF_TOP_KO = `<b>Paid Link:</b> eBay 파트너 네트워크(EPN) 제휴사로서 eBay 링크를 통한 적격 구매가 발생하면 OP Box Index가 수수료를 받습니다.`;
const affTop = AFF_TOP.replace('<p class="affTop">', `<p class="affTop" data-ko-html="${esc(AFF_TOP_KO)}">`);

// ── <head> — 노출 상태 불가침(title/canonical/hreflang/robots/JSON-LD). 문구만 새 구조에 맞춘다.
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece Card Game completed eBay auction results",
  description: `Daily completed-auction results for One Piece Card Game items: auctions tracked to close, how many sold, sell-through rate, median final winning bid and bid counts, split by sealed box, single card and pack. ${num(totN)} auctions tracked over ${aggDays.length} full days${skippedDays ? ` (${skippedDays} incomplete days excluded)` : ""}.`,
  url: `${SITE}/auction.html`, license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-auction-daily.csv` }],
});
const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
  { "@type": "ListItem", position: 2, name: "Auction Data", item: `${SITE}/auction.html` },
] });

const title = "One Piece Card Auction Results — eBay Winning Bids"; // 60자 이내(2026-09-17)
const desc = `${num(totN)} completed eBay auctions for One Piece cards and sealed boxes over ${aggDays.length} days, ${st}% sell-through, median winning bids by card, by week and by set.`; // 155자 이내

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/auction.html" />
    <link rel="alternate" hreflang="en" href="${SITE}/auction.html" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/auction.html" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/auction.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${SITE}/auction.html" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${dsLd}</script>
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
    <style>
      /* 가격판 우선 레이아웃(2026-10-13 승인 목업). 색은 styles.css 토큰만, 모션 없음, 글자 최소 11.5px. */
      .wrap { max-width: 1040px; margin: 0 auto; padding: 22px 16px 60px; }
      .wrap h1 { max-width: none; margin: 0 0 6px; font-size: clamp(30px, 5vw, 46px); line-height: 1.1; }
      .sub { margin: 0 0 6px; color: var(--muted); font-size: 14px; }
      .wrap .affTop { margin: 0 0 20px; }
      .wrap section { margin: 0 0 38px; }
      .secHead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin: 0 0 6px; }
      .secHead h2 { margin: 0; font-size: 18px; }
      .nt { color: var(--muted); font-size: 12.5px; }
      .line { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; line-height: 1.6; max-width: 760px; }
      .line b { color: var(--ink); font-weight: 600; }

      /* ② 시장 온도 — 숫자 3칸 */
      .strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 760px; margin: 0 0 8px; }
      .kpi { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
      .kpi .lbl { display: block; color: var(--muted); font-size: 12.5px; }
      .kpi b { display: block; margin: 4px 0 2px; font-family: var(--font-display); font-size: clamp(22px, 5.5vw, 30px); font-weight: 800; letter-spacing: -.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
      .kpi .delta { display: block; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
      .kpi .delta.up { color: var(--green); }
      .kpi .delta.down { color: var(--red); }
      .kpi .was { display: block; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }

      /* 탭·버튼 */
      .tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 12px; }
      .btn { font: inherit; font-size: 13.5px; font-weight: 700; min-height: 40px; padding: 0 14px; border-radius: 8px;
        border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
      .btn[aria-pressed="true"] { border-color: var(--accent-line); background: var(--accent-dim); color: var(--accent); }
      .btn:hover { color: var(--ink); border-color: var(--muted); }
      .btn[aria-pressed="true"]:hover { color: var(--accent); border-color: var(--accent-line); }
      .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .swipe { margin-left: auto; color: var(--muted); font-size: 12.5px; }
      .more { margin-top: 10px; color: var(--accent); }
      .more[hidden] { display: none; }

      /* 표 공통 */
      .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
      table.t { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
      .t th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12.5px; font-weight: 600; white-space: nowrap; vertical-align: bottom; }
      .t th.l, .t td.l { text-align: left; }
      .t th.c { text-align: center; }
      .t td { text-align: right; padding: 10px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
      .t tbody tr:hover td { background: var(--paper); }
      .t tr[hidden], .t tbody[hidden] { display: none; }
      .t .sub2 { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 400; }
      /* 터치 대상: 링크 높이를 32px 이상으로(2026-10-13 QA) — 색·모션 없이 크기만 */
      a.live { display: inline-block; margin-top: 4px; padding: 7px 0; color: var(--accent); font-size: 12.5px; font-weight: 600; }
      a.live:hover, a.live:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
      .narrow { max-width: 760px; }

      /* ③ 가격판 — 데스크톱 6열, 모바일(≤640)은 2열(카드·낙찰가)로 접어 가로 스크롤 없음 */
      .cardCell { display: flex; gap: 10px; align-items: flex-start; }
      .rank { flex: 0 0 auto; min-width: 18px; padding-top: 2px; color: var(--muted); font-size: 12.5px; }
      .thumb { flex: 0 0 auto; width: 36px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); background: var(--paper); box-sizing: border-box; }
      .thumb.ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: var(--muted); font-size: 11.5px; font-weight: 700; line-height: 1.1; }
      .info { min-width: 0; }
      .nameLine { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
      .name { color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.3; }
      .chip { display: inline-block; padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--ink); font-size: 12px; line-height: 18px; white-space: nowrap; }
      .chip.var { font-weight: 700; }
      .chip.ed { color: var(--muted); }
      .meta { margin-top: 4px; color: var(--muted); font-size: 12.5px; }
      .pv { color: var(--ink); font-size: 16px; font-weight: 700; }
      .pv.psa { font-size: 15px; }
      .range { color: var(--muted); font-size: 13px; }
      .psaM b { color: var(--ink); font-weight: 700; font-size: 12.5px; }
      @media (min-width: 641px) {
        .board { min-width: 680px; table-layout: fixed; }
        .board th.l { width: 300px; }
        .board th:nth-child(2) { width: 100px; }
        .board th:nth-child(3) { width: 126px; }
        .board th:nth-child(4) { width: 76px; }
        .board th:nth-child(5) { width: 68px; }
        .board th:nth-child(6) { width: 98px; }
        .board th.l, .board td.l { position: sticky; left: 0; z-index: 1; background: var(--bg); white-space: normal; box-shadow: 1px 0 0 var(--line); }
        .board tbody tr:hover td.l { background: var(--paper); }
        .mOnly { display: none !important; }
      }
      @media (max-width: 640px) {
        .board .dOnly { display: none; }
        .board th, .board td { padding-left: 6px; padding-right: 6px; }
        .board td.l { white-space: normal; }
        .board td:nth-child(2) { width: 1%; }
        .cardCell { gap: 8px; }
        .thumb { width: 32px; height: 44px; }
        .nameLine { gap: 3px 5px; }
      }

      /* ④ 주별 낙찰률 — CSS 막대, 축 하나 */
      .wk { padding: 12px 14px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); max-width: 760px; }
      .wkHead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 22px; font-size: 13.5px; font-weight: 600; }
      .wkHead .nt { font-weight: 400; }
      .wkPlot { position: relative; height: 170px; margin-left: 34px; border-bottom: 1px solid var(--line); }
      .guide { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--line); }
      .guide span, .zero { position: absolute; left: -34px; width: 30px; text-align: right; color: var(--muted); font-size: 11.5px; line-height: 1; }
      .guide span { top: -6px; }
      .zero { bottom: -6px; }
      .cols { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 3px; }
      .col { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
      .col i { position: absolute; left: 0; right: 0; bottom: 0; height: var(--h); background: var(--accent); border-radius: 3px 3px 0 0; }
      .col.now i { background: rgba(var(--accent-rgb), .38); }
      .col:hover i { background: var(--ink); }
      .col .v { position: absolute; left: -8px; right: -8px; bottom: calc(var(--h) + 3px); text-align: center; color: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
      .wkAxis { display: flex; justify-content: space-between; margin: 6px 0 0 34px; color: var(--muted); font-size: 12px; }
      @media (max-width: 640px) {
        .wkPlot { height: 150px; }
        .col:not(.key) .v { display: none; }
        .strip { gap: 6px; }
        .kpi { padding: 10px 8px; }
        /* 390px 에서 "Median sold price" 만 두 줄이 돼 숫자 줄이 어긋났다 — 라벨 높이를 두 줄로 맞춘다. */
        .kpi .lbl { min-height: 2.5em; line-height: 1.25; }
      }

      /* ⑤ 종류별 · ⑥ 세트별 */
      .bar { height: 6px; margin-top: 5px; border-radius: 3px; background: var(--line); }
      .bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
      .kind { color: var(--ink); font-weight: 700; }
      .setCode { color: var(--ink); font-weight: 700; }
      a.setCode { display: inline-block; padding: 5px 0; text-decoration: underline; text-decoration-color: rgba(var(--accent-rgb), .55); text-underline-offset: 3px; }
      a.setCode:hover, a.setCode:focus-visible { color: var(--accent); text-decoration-color: currentColor; }
      .setName { display: block; margin-top: 0; color: var(--muted); font-size: 12.5px; white-space: normal; }
      .foot { margin-top: 16px; font-size: 12.5px; color: var(--muted); }
      .foot a { display: inline-block; padding: 7px 0; color: var(--accent); }
      @media (max-width: 480px) { .t td, .t th { padding-left: 8px; padding-right: 8px; } }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("", "auction.html")}
    </header>
    <main id="main-content" class="wrap">
      <h1 data-ko="원피스 카드 경매 시세">One Piece card auction prices</h1>
      <p class="sub"><span data-ko="eBay 실제 낙찰가 · 기준일">Real winning bids on eBay · Data through</span> <span data-ko="${esc(DATA_THROUGH)}">${esc(mdy(DATA_THROUGH))}</span></p>
      ${affTop}

      <section id="week" aria-label="Last 7 days">
        <div class="strip">
        ${strip}
        </div>
        <p class="nt"><span data-ko="최근 7일 vs 직전 7일">Last 7 days vs the 7 before</span>${tempRange ? ` · <span data-ko="${esc(tempRangeKo)}">${esc(tempRange)}</span>` : ""}${tempGap > 0 ? ` · <span data-ko="빠진 날 ${tempGap}일">${tempGap} day${tempGap > 1 ? "s" : ""} missing</span>` : ""}</p>
      </section>

      <section id="prices">
        <div class="secHead"><h2 data-ko="카드 경매 시세">Card auction prices</h2><span class="nt" data-ko="${CARD_WINDOW_DAYS ? `최근 ${CARD_WINDOW_DAYS}일 · ` : ""}생카드 · 낙찰 3건 이상">${CARD_WINDOW_DAYS ? `Last ${CARD_WINDOW_DAYS} days · ` : ""}ungraded cards with 3 or more sold</span></div>
        <p class="line"><b data-ko="낙찰가">Sold price</b> <span data-ko="= 생카드 낙찰가 중앙값 ·">= middle winning bid, ungraded ·</span> ${HAS_PSA ? `<b>PSA 10</b> <span data-ko="= 같은 카드 PSA 10 낙찰가 중앙값 ·">= same card graded PSA 10 ·</span> ` : ""}<b data-ko="범위">Range</b> <span data-ko="= 낙찰가 가운데 절반 구간">= middle half of sales</span></p>
        <div class="tabs" role="group" aria-label="Rank by">
          <button class="btn" type="button" data-tab="price" aria-pressed="true" data-ko="최고가">Highest prices</button>
          <button class="btn" type="button" data-tab="sales" aria-pressed="false" data-ko="많이 팔린">Most sold</button>
          <span class="swipe" id="swipe" hidden data-ko="옆으로 밀기 → 범위 · 낙찰률${HAS_PSA ? " · PSA 10" : ""}">Swipe → range · sell rate${HAS_PSA ? " · PSA 10" : ""}</span>
        </div>
        <div class="scroll" id="boardScroll">
          <table class="t board" id="boardTable">
            <thead><tr>
              <th class="l" data-ko="카드">Card</th><th data-ko="낙찰가">Sold price</th><th class="dOnly" data-ko="범위">Range</th><th class="dOnly" data-ko="낙찰률">Sell rate</th><th class="dOnly" data-ko="낙찰">Sold</th>${HAS_PSA ? '<th class="dOnly">PSA 10</th>' : ""}
            </tr></thead>
            ${boardBody(byPrice, "boardPrice", false)}
            ${boardBody(bySales, "boardSales", true)}
          </table>
        </div>
        <button class="btn more" type="button" id="moreCards" aria-expanded="false" data-ko="${byPrice.length}장 모두 보기"${byPrice.length <= CARD_SHOW ? " hidden" : ""}>Show all ${byPrice.length} cards</button>
      </section>

      <section id="trend">
        <div class="secHead"><h2 data-ko="주별 낙찰률">Sell rate by week</h2><span class="nt" data-ko="${esc(wkRangeKo)}">${esc(wkRange)}</span></div>
        <div class="wk">
          <div class="wkHead"><span data-ko="종료 경매 중 낙찰 비율">Share of closed auctions that sold</span><span class="nt" data-ko="연한 막대 = 이번 주(진행 중)">Lighter bar = this week so far</span></div>
          <div class="wkPlot">
            <div class="guide" style="bottom:100%"><span>${WK_TOP}%</span></div>
            <div class="guide" style="bottom:50%"><span>${WK_TOP / 2}%</span></div>
            <span class="zero">0</span>
            <div class="cols">${wkCols}</div>
          </div>
          <div class="wkAxis">${wkAxis}</div>
        </div>
      </section>

      <section id="kinds">
        <div class="secHead"><h2 data-ko="무엇이 팔리나">What sells</h2><span class="nt" data-ko="${esc(aggFrom)} ~ ${esc(DATA_THROUGH)}${skippedDays ? ` · 미완 수집 ${skippedDays}일 제외` : ""}">${esc(md(aggFrom))} – ${esc(mdy(DATA_THROUGH))}${skippedDays ? ` · ${skippedDays} incomplete day${skippedDays > 1 ? "s" : ""} left out` : ""}</span></div>
        <div class="scroll narrow">
          <table class="t">
            <thead>
              <tr><th class="l" rowspan="2" data-ko="종류">Kind</th><th rowspan="2" data-ko="낙찰률">Sell rate</th><th class="c" colspan="2" data-ko="중앙 낙찰가">Median sold price</th></tr>
              <tr><th data-ko="일본판">Japanese</th><th data-ko="영문판">English</th></tr>
            </thead>
            <tbody>
${kindTr}
            </tbody>
          </table>
        </div>
      </section>

      <section id="sets">
        <div class="secHead"><h2 data-ko="세트별, 최근 ${setStats.window && setStats.window.days ? setStats.window.days : 30}일">By set, last ${setStats.window && setStats.window.days ? setStats.window.days : 30} days</h2><span class="nt"${setStats.window && setStats.window.from ? ` data-ko="${esc(mdKo(setStats.window.from))}–${esc(mdKo(setStats.window.to))}"` : ""}>${setStats.window && setStats.window.from ? `${esc(md(setStats.window.from))} – ${esc(mdy(setStats.window.to))}` : ""}</span></div>
        <div class="scroll narrow">
          <table class="t">
            <thead><tr><th class="l" data-ko="세트">Set</th><th data-ko="종료">Closed</th><th data-ko="낙찰률">Sell rate</th><th data-ko="중앙 낙찰가">Median price</th></tr></thead>
            <tbody id="setBody">
${setTr}
            </tbody>
          </table>
        </div>
        <button class="btn more" type="button" id="moreSets" aria-expanded="false" data-ko="${setRows.length}개 세트 모두 보기"${setRows.length <= SET_SHOW ? " hidden" : ""}>Show all ${setRows.length} sets</button>
      </section>

      <p class="foot"><a href="free-data.html" data-ko="무료 CSV">Free CSV</a> · <a href="methodology.html" data-ko="집계 방법">How we count</a> · <a href="cards/" data-ko="카드 시세">Card prices</a> · <a href="sets/index.html" data-ko="세트 가이드">Set guides</a></p>
    </main>
    <script>
      // 탭·더보기·스와이프 힌트만 — 표는 서버가 그려 두었다(JS 없이도 보인다). 라벨은 lang-toggle 의 data-ko 규약을 따른다.
      (function () {
        var KO = function () { return document.documentElement.lang === "ko"; };
        var setLabel = function (el, en, ko) { el.dataset.en = en; el.dataset.ko = ko; el.textContent = KO() ? ko : en; };
        var SHOW_CARDS = ${CARD_SHOW}, SHOW_SETS = ${SET_SHOW};
        var sc = document.getElementById("boardScroll"), swipe = document.getElementById("swipe"), moreCards = document.getElementById("moreCards");
        var bodies = { price: document.getElementById("boardPrice"), sales: document.getElementById("boardSales") };
        var tab = "price", cardsOpen = false;
        function rowsOf() { return bodies[tab] ? bodies[tab].querySelectorAll("tr") : []; }
        function applyCards() {
          var rows = rowsOf();
          for (var i = 0; i < rows.length; i++) rows[i].hidden = !cardsOpen && i >= SHOW_CARDS;
          if (moreCards) {
            moreCards.hidden = rows.length <= SHOW_CARDS;
            moreCards.setAttribute("aria-expanded", String(cardsOpen));
            setLabel(moreCards, cardsOpen ? "Show top " + SHOW_CARDS : "Show all " + rows.length + " cards", cardsOpen ? "상위 " + SHOW_CARDS + "장만" : rows.length + "장 모두 보기");
          }
        }
        function hint() {
          if (!sc || !swipe) return;
          swipe.hidden = !(sc.scrollWidth > sc.clientWidth + 2);
        }
        var tabs = document.querySelectorAll(".tabs .btn[data-tab]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            tab = b.getAttribute("data-tab"); cardsOpen = false;
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            for (var k in bodies) if (bodies[k]) bodies[k].hidden = k !== tab;
            applyCards(); hint();
          });
        });
        if (moreCards) moreCards.addEventListener("click", function () { cardsOpen = !cardsOpen; applyCards(); });
        if (sc) sc.addEventListener("scroll", hint, { passive: true });
        window.addEventListener("resize", hint);

        var moreSets = document.getElementById("moreSets"), setBody = document.getElementById("setBody");
        var setsOpen = false;
        function applySets() {
          if (!moreSets || !setBody) return;
          var rows = setBody.querySelectorAll("tr");
          for (var i = 0; i < rows.length; i++) rows[i].hidden = !setsOpen && i >= SHOW_SETS;
          moreSets.hidden = rows.length <= SHOW_SETS;
          moreSets.setAttribute("aria-expanded", String(setsOpen));
          setLabel(moreSets, setsOpen ? "Show top " + SHOW_SETS : "Show all " + rows.length + " sets", setsOpen ? "상위 " + SHOW_SETS + "개만" : rows.length + "개 세트 모두 보기");
        }
        if (moreSets) moreSets.addEventListener("click", function () { setsOpen = !setsOpen; applySets(); });

        // 언어가 바뀌면 버튼 글자만 다시 쓴다(표는 data-ko 로 lang-toggle 이 바꾼다).
        document.addEventListener("opboxlang", function () { applyCards(); applySets(); });
        applyCards(); applySets(); hint();
      })();
    </script>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Free data (CSV)</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "auction.html"), html, "utf8");

// 사이트맵: 추가만(제거 금지 — 소유자 절대 지시)
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/auction.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    fs.writeFileSync(smPath, sm, "utf8");
    added = 1;
  }
  console.log(JSON.stringify({ wrote: "auction.html", through: DATA_THROUGH, fullDays: aggDays.length, tracked: totN, sellThrough: st + "%", last7: last7, prev7: prev7, weeks: weekly.length, cards: { byPrice: byPrice.length, bySales: bySales.length, eligible: variants.length }, kinds: kindRows.length, sets: setRows.length, sitemapAdded: added }));
}
