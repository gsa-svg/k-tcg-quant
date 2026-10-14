// 원피스 경매 페이지의 숫자 — 영문 auction.html(generate-auction-page.js)과 ko/auction.html(generate-ko-topic-pages.js)이 같이 쓴다.
//
// ── 왜 따로 두나 (2026-10-13)
// 두 생성기가 같은 계산(7일 창·주별 버킷·종류별·카드 가격판 선별·세트 표)을 각자 복제하고 있었다.
// 규칙을 한쪽만 고치면 같은 데이터가 영문판과 한국어판에서 다른 숫자로 나온다. 계산은 여기 한 곳에서만 한다.
// 이 모듈은 숫자·링크 대상·두 페이지가 공유하는 숫자 꼴만 만든다. 화면 글자(영문/한국어 라벨, 영문 날짜)는 각 생성기 몫이다.
//
// ── 규칙
//   · 진행 중인 오늘은 뺀다(2026-08-25 사고: 반쪽 하루가 정상일처럼 실렸다).
//   · 합산(시장 온도·주별 막대·종류별)은 완전 수집일만(부분수집일은 덜 센 날이라 섞으면 건수는 줄고 비율은 치우친다).
//     완전일이 3일 미만이면 전체로 폴백. 일별 집계가 3일 미만이면 null — 페이지를 만들지 않는다.
//   · 중앙값은 일별 중앙값을 다시 중앙값 내지 않고 원장의 낙찰 건을 한 줄로 세워 자른다(2026-09-01 실측).
//   · 낙찰률 분모는 결과가 확정된 건(sold !== null)만 — 7일 창과 주별 막대가 같은 식.
//   · 카드 가격판은 suspect(contestedSold<3, PSA10 2배 초과, 가운데 절반 구간 10배 초과 — auction-card-stats.js) 를 뺀다 — 아직 확인되지 않은 가격.
// 경로(썸네일·세트 가이드)는 루트 기준 — ko/ 페이지는 앞에 ../ 를 붙인다.
const fs = require("fs");
const path = require("path");
const { readRecent } = require("./auction-archive");
const { summarizeKinds, med, perUnit } = require("./auction-aggregate");
const { epnUrl } = require("./set-page-shared");
const { variant: imageVariant } = require("./image-variants");
// 변형(tier) 판별은 집계기(auction-card-stats)와 같은 함수 — 썸네일을 번호만 보고 붙이면 다른 변형 그림이 붙는다.
const { ourTier } = require("./cgc-card-pop-ingest");
// 한글 캐릭터명·변형 라벨 사전도 한 곳(ko-labels) — 영문판 토글과 ko/ 페이지가 같은 이름을 쓴다.
const { koCharOf, tierEn, tierKo } = require("./ko-labels");

const ROOT = path.join(__dirname, "..");

const CARD_TOP = 20, CARD_SHOW = 10;   // 가격판: 탭마다 20장, 처음엔 10장만 펼친다
const SET_SHOW = 15;                   // 세트 표: 처음엔 15줄만 펼친다
const KIND_MIN = 25;                   // 낙찰률을 말하려면 이만큼은 확인했어야 한다
const KIND_PRICE_MIN = 12;             // 중앙 낙찰가를 말하려면 낙찰 건수가 이만큼
const KIND_LABEL = { card: ["Single card", "싱글 카드"], pack: ["Booster pack", "부스터 팩"], box: ["Sealed box", "밀봉 박스"], carton: ["Sealed case", "밀봉 케이스"] };
const KIND_QUERY = { card: "One Piece Card Game card", pack: "One Piece Card Game booster pack sealed", box: "One Piece Card Game booster box sealed", carton: "One Piece Card Game booster case sealed" };

// ── 두 페이지가 같은 꼴로 찍는 숫자
const pct = (v) => (v == null || !isFinite(v) ? "—" : `${v}%`);
// 돈: 정수면 $9,989, 아니면 $16.26 — 소수 두 자리를 자르지 않는다(낙찰가는 센트 단위다). 원본 통화(달러) 그대로.
const money = (v) => (v == null || !isFinite(v) ? "—" : "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
const bare = (v) => money(v).replace(/^\$/, "");
const tenth = (x) => Math.round(x * 10) / 10;
// 한국어 날짜 꼴(7/20) — ko/auction.html 본문과 영문판의 한국어 토글이 같이 쓴다.
const mdKo = (iso) => { if (!iso) return "—"; const [, m, dd] = iso.split("-").map(Number); return `${m}/${dd}`; };

// 진행 중 eBay 경매(종료 임박순). customid 는 EPN 보고서에서 자리별 클릭·수익을 가르는 꼬리표(auc-card / auc-kind).
const liveAuctionUrl = (query, spot) => epnUrl(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Auction=1&_sop=1&customid=${spot}`);

// 직전 대비 — 둘 중 하나라도 없으면 diff 는 null. dir 은 색을 입힐 때 쓴다(종료 건수처럼 좋고 나쁨이 없는 값은 호출 쪽이 무시).
function compare(cur, prev) {
  const diff = cur != null && prev != null ? cur - prev : null;
  return {
    cur, prev, diff,
    arrow: diff == null ? "" : diff > 0 ? "▲" : diff < 0 ? "▼" : "•",
    dir: diff == null ? "" : diff > 0 ? "up" : diff < 0 ? "down" : "",
  };
}

function buildAuctionModel() {
  const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
  const Jopt = (f, fallback) => { try { return J(f); } catch (e) { return fallback; } };
  const d = J("onepiece-packs.json");
  const auc = J("auction-sold.json");
  const cardStats = J("auction-card-stats.json");
  // partial 판정은 auction-series.json 만 들고 있다.
  const PARTIAL_DAYS = new Set((Jopt("auction-series.json", { daily: [] }).daily || []).filter((r) => r.partial).map((r) => r.d));
  const setStats = Jopt("set-auction-stats.json", { window: {}, sets: {} });

  // ── 날짜 창 — 진행 중인 오늘은 여기서 잘라낸다.
  const TODAY_ISO = new Date().toISOString().slice(0, 10);
  const allDays = (auc.daily || []).filter((x) => x.d < TODAY_ISO);
  if (allDays.length < 3) return null;
  const fullAll = allDays.filter((x) => !PARTIAL_DAYS.has(x.d));
  const aggDays = fullAll.length >= 3 ? fullAll : allDays;
  const dataThrough = aggDays[aggDays.length - 1].d;   // 마지막 완전 수집일 — 화면의 "Data through"/"기준일"
  const totN = aggDays.reduce((t, x) => t + x.n, 0);
  const totSold = aggDays.reduce((t, x) => t + x.sold, 0);

  // 원장 — 7일 창·주별 막대·종류별 전부 여기서 직접 낸다(일별 값을 다시 평균/중앙값 내지 않는다).
  const ledger = readRecent(400).filter((r) => r && r.d && r.d < TODAY_ISO);

  // ── 시장 온도: 최근 7일 vs 직전 7일(완전 수집일만)
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
  // 14개 완전일 사이에 부분수집일이 끼어 달력상 14일보다 긴 창이면 라벨에 빠진 날 수를 적는다.
  const spanDays = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1 : 0);
  const tempGap = prev7.from && last7.to ? spanDays(prev7.from, last7.to) - (last7.days + prev7.days) : 0;

  // ── 주별 낙찰률 — 원장에서 직접, 월요일 시작. 상단 7일 창과 같은 규칙: 완전 수집일(aggDays)만 센다.
  // 2026-10-14 감사: 부분수집일 행을 그대로 더해 8/31 주가 37.8%(부분일 8/31 하루 50.8%)로 튀었다 — 완전일만 33.1%.
  // days = 그 주에서 센 날(완전 수집일) 수 → 막대 아래 'n/7'. 7 미만인 주도 값은 그대로 싣는다 — 빈 날을 메우지 않는다(보간·요일 가중 없음).
  // 진행 중인 주(일요일이 아직 안 지난 주)는 막대에서 뺀다 — 최근 며칠은 상단 7일 창이 보여준다(월·화만 든 주는 요일 효과로 튄다).
  // 주는 첫 주부터 마지막 완전한 주까지 빠짐없이 깐다 — 통째로 빈 주도 '0/7' 빈 칸으로 남겨 축이 눌리지 않게.
  const addDays = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const weekKey = (iso) => addDays(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));
  const weekEnd = (k) => addDays(k, 6);
  const COUNTED = new Set(aggDays.map((x) => x.d));
  const buckets = new Map();
  for (let k = weekKey(allDays[0].d); weekEnd(k) < TODAY_ISO; k = addDays(k, 7)) buckets.set(k, { rows: [], days: 0 });
  for (const x of aggDays) { const b = buckets.get(weekKey(x.d)); if (b) b.days += 1; }
  for (const r of ledger) { const b = COUNTED.has(r.d) && buckets.get(weekKey(r.d)); if (b) b.rows.push(r); }
  const weekly = [...buckets.entries()].map(([k, b]) => {
    const decided = b.rows.filter((r) => r.sold !== null);
    const sold = b.rows.filter((r) => r.sold === true);
    return {
      week: k, end: weekEnd(k), closed: b.rows.length, sold: sold.length,
      rate: decided.length ? Number(((sold.length / decided.length) * 100).toFixed(1)) : null,
      days: b.days,   // 센 날 n(/7) — 7 미만이면 화면에 점선 윗변
    };
  });
  // 막대 축 하나 — 눈금은 최고값을 10 단위로 올린 값. 값 라벨(key)은 모바일에서 처음·끝·최고·최저만 남긴다.
  const wkRates = weekly.map((w) => w.rate).filter((v) => v != null);
  const wkTop = Math.max(10, Math.ceil(Math.max(0, ...wkRates) / 10) * 10);
  const wkHi = Math.max(...wkRates), wkLo = Math.min(...wkRates);
  weekly.forEach((w, i) => {
    w.key = w.rate != null && (i === 0 || i === weekly.length - 1 || w.rate === wkHi || w.rate === wkLo);
    w.h = w.rate == null ? 0 : tenth((w.rate / wkTop) * 100);
  });

  // ── 종류별(전 기간 완전 수집일)
  const kindRows = Object.entries(summarizeKinds(ledger, aggDays.map((x) => x.d)))
    .map(([k, v]) => ({
      key: k, labelEn: (KIND_LABEL[k] || [k, k])[0], labelKo: (KIND_LABEL[k] || [k, k])[1],
      n: v.n, sold: v.sold,
      rate: v.n >= KIND_MIN ? v.sellThrough : null,
      // 판별 중앙가 — 박스는 일본판과 영문판이 4배 가까이 차이나서 하나로 합치면 어느 쪽도 아닌 수가 된다.
      medJp: v.byEd.jp.priceN >= KIND_PRICE_MIN ? v.byEd.jp.med : null,
      medEn: v.byEd.en.priceN >= KIND_PRICE_MIN ? v.byEd.en.med : null,
      live: liveAuctionUrl(KIND_QUERY[k] || `One Piece Card Game ${k}`, "auc-kind"),
    }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);

  // ── 세트별(최근 30일, build-set-auction-stats). page = 세트 가이드(있는 것만) — 표의 링크는 첫 칸에 둔다.
  const SET_MIN = Number(setStats.window && setStats.window.minDecided) || 30;
  const setRows = Object.entries(setStats.sets || {})
    .map(([code, s]) => ({
      code, nameEn: (d.sets[code] || {}).nameEn || null, nameKo: (d.sets[code] || {}).nameKo || null,
      closed: s.ended, rate: s.thin ? null : s.sellThrough, med: s.medPrice,
      page: fs.existsSync(path.join(ROOT, "sets", code.toLowerCase() + ".html")) ? `sets/${code.toLowerCase()}.html` : null,
    }))
    .filter((s) => s.closed >= SET_MIN)
    .sort((a, b) => b.closed - a.closed);
  const sw = setStats.window || {};

  // ── 카드 가격판 — 생카드 변형(번호|판|변형) 단위, suspect 제외
  let IMG_FILES = [];
  try { IMG_FILES = fs.readdirSync(path.join(ROOT, "img", "cards")).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort(); } catch (e) {}
  // 썸네일은 번호 + 변형이 같은 파일만 쓴다. 번호만 맞추면 base 행에 SP 금박 그림이 붙는다(OP05-119 는 파일이 4개).
  function cardImg(id, tier) {
    const pre = id.toLowerCase() + "-";
    const hit = IMG_FILES.find((f) => f.startsWith(pre) && ourTier(f.slice(pre.length).replace(/\.[^.]+$/, "").replace(/-/g, " ")) === tier);
    if (!hit) return null;
    const v = imageVariant("img/cards/" + hit, "thumb");
    return v ? v.src : "img/cards/" + hit;
  }
  const setCodeOf = (id, c) => (c && c.set) || id.replace(/^([A-Z]+)(\d+)-.*$/i, "$1-$2").toUpperCase();
  const variants = Object.entries(cardStats.variants || {})
    .map(([key, v]) => {
      const [id, ed, tier] = key.split("|");
      const name = v.name || id;
      return {
        id, ed, tier, tierEn: tierEn(tier), tierKo: tierKo(tier),
        set: setCodeOf(id, (cardStats.cards || {})[id]),
        name,
        nameKo: koCharOf(name),   // 사전에 있는 캐릭터명만 — 없으면 null(화면은 영문만)
        price: v.medPriceContested != null ? v.medPriceContested : v.medPrice,
        low: v.low, high: v.high, rate: v.sellThrough, sold: v.sold, n: v.n,
        psa10Med: v.psa10Med, psa10Sold: v.psa10Sold,
        suspect: !!v.suspect,
        img: cardImg(id, tier),
        ebay: liveAuctionUrl(`One Piece ${id}`, "auc-card"),
      };
    })
    .filter((v) => !v.suspect && (v.ed === "jp" || v.ed === "en") && v.price != null);
  const byPrice = variants.slice().sort((a, b) => b.price - a.price || b.sold - a.sold).slice(0, CARD_TOP);
  const bySales = variants.slice().sort((a, b) => b.sold - a.sold || b.price - a.price).slice(0, CARD_TOP);

  return {
    dataDate: d.updated || "",
    dataThrough,
    aggFrom: aggDays[0].d,
    fullDays: aggDays.length,
    skippedDays: allDays.length - aggDays.length,   // 합산에서 뺀 부분수집일 수(라벨에 적는다)
    totN,
    sellThrough: totN ? Math.round((totSold / totN) * 100) : 0,
    last7, prev7, tempGap,
    kpis: { rate: compare(last7.rate, prev7.rate), med: compare(last7.med, prev7.med), closed: compare(last7.closed, prev7.closed) },
    weekly, wkTop,
    kindRows,
    setRows,
    setWindow: { days: sw.days || 30, from: sw.from, to: sw.to },
    cardWindowDays: (String(cardStats.window || "").match(/(\d+)\s*d/) || [])[1] || null,
    eligible: variants.length,
    byPrice, bySales,
    // PSA 10 열은 가격판 행 가운데 한 줄이라도 값이 있을 때만 그린다(2026-10-13 QA: 40행 전부 "—" 인 죽은 열이 폭만 차지했다).
    // 값이 생기면(같은 변형 PSA 10 낙찰 3건 이상) 열·정의 토막·스와이프 힌트가 저절로 돌아온다.
    hasPsa: [...byPrice, ...bySales].some((v) => v.psa10Med != null),
  };
}

module.exports = { buildAuctionModel, CARD_SHOW, SET_SHOW, pct, money, bare, tenth, mdKo };
