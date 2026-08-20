// 경매 정산 — 종료된 경매를 다시 조회해 "실제 낙찰가"를 기록한다.
//
// 왜 이게 가능한가 (2026-07-20 실측): Browse API 의 getItem 은 경매가 끝난 뒤에도 응답한다.
// 종료 항목에서 bidCount(최종 입찰수), currentBidPrice(낙찰가),
// estimatedAvailabilities[].estimatedSoldQuantity(팔렸는지), uniqueBidderCount 를 준다.
// Marketplace Insights(Limited Release) 승인 없이도 실거래를 쌓을 수 있는 유일한 경로다.
//
// 왜 추정으로 때우면 안 되는가: 같은 경매를 종료 21분 전에 봤을 때 20건/$107.2 였는데
// 최종은 26건/$135.04 였다. 마지막 20분에 26% 올랐다. 스나이핑 때문에 "종료 N시간 전 현재가"는
// 낙찰가가 아니다. 끝난 뒤에 읽어야 진짜 값이다.
//
// ⚠️ 반드시 지킬 것
//  - 조회 가능 기간이 무한하지 않을 수 있다. 종료 직후에 정산하도록 자주 돌린다(30분 간격).
//    실패한 건은 재시도하되, 오래된 건 미정산으로 버린다 — 추측값을 채우지 않는다.
//  - soldQuantity 가 0/미상이면 "팔림"으로 적지 않는다. 유찰도 데이터다(낙찰률의 분모).
//  - price 는 마켓플레이스 통화(USD) 기준값을 쓴다. 원 통화는 참고로만 남긴다.
//
// Run: node tools/settle-auctions.js
const fs = require("fs");
const path = require("path");
const { parseLotQuantity, unitPrice } = require("./lot-quantity");
const { extraFields } = require("./auction-fields");
const { appendSales, readRecent } = require("./auction-archive");

const ROOT = path.join(__dirname, "..");
// 게임별 정산 — 2026-08-19. collect-auction-market.js --game=palworld 가 쌓은 감시목록을
// 같은 플래그로 정산한다. 기본은 원피스라 기존 실행(인자 없음)은 그대로다.
const GAME = (process.argv.find((a) => a.startsWith("--game=")) || "--game=onepiece").split("=")[1];
const pre = GAME === "onepiece" ? "" : `${GAME}-`;
const watchPath = path.join(ROOT, "data", `${pre}auction-watch.json`);
const soldPath = path.join(ROOT, "data", `${pre}auction-sold.json`);

// 개별 낙찰 기록은 data/auction-archive/<날짜>.json 이 원장이다(하루가 지나면 다시 안 쓰임).
// auction-sold.json 은 파생 집계 + 최근 창만 담는 얇은 파일로 남긴다 — 2시간마다 재작성되므로
// 여기에 45일치를 넣으면 저장소가 하루 수십 MB씩 불어난다(2026-07-29 실측: 8일치로 blob 20.8MB).
// 이 파일에 개별 판매를 며칠치 실어 둘 것인가. 2026-08-19: 14 → 3.
//
// 왜 줄이나: 이 파일은 2시간마다 통째로 다시 쓰인다(=커밋마다 새 blob). 14일치면 8MB 라
// 저장소 이력에서 이 파일 하나가 1.19GB, 전체 .git 204MB 중 압도적 1위였다.
//
// 줄여도 되는 이유: 개별 판매의 원장은 data/<game>auction-archive/<날짜>.json 이고 그건 하루치를
// 한 번만 쓰고 다시 안 건드린다. 여기 sales 는 파생 창이라 언제든 아카이브에서 되만든다.
// 화면·페이지 생성기(generate-free-data·generate-ko-topic-pages)는 daily 만 읽고,
// 집계(daily)는 별도로 KEEP_SALES_DAYS(45일) 창에서 계산하므로 이 값과 무관하다.
// 실제 소비처는 guard A1 의 "파생이 원장에 없는 기록을 만들지 않았는지" 대조 하나뿐인데,
// 그 검사는 3일치로도 똑같이 동작한다.
const HOT_DAYS = 3;            // 이 파일에 싣는 개별 판매 창(원장은 아카이브)
const KEEP_SALES_DAYS = 45;    // 아카이브 기준 집계 재계산 범위
const KEEP_DAILY_DAYS = 365;   // 일별 집계는 더 오래
const MAX_PER_RUN = 250;       // 한 번에 조회할 최대 건수 (API 한도 보호)
const GIVE_UP_HOURS = 30;      // 종료 후 이만큼 지나도 정산 못 하면 포기(조회 불가 추정)

function loadEnv(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .reduce((v, l) => { const i = l.indexOf("="); if (i > -1) v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); return v; }, {});
}
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";

async function token() {
  const auth = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}`);
  return (await r.json()).access_token;
}

async function getItem(tok, id) {
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, item: await r.json() };
}

const med = (a) => {
  const x = a.filter(Number.isFinite).sort((m, n) => m - n);
  if (!x.length) return null;
  const i = Math.floor(x.length / 2);
  return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(2));
};

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("Missing eBay credentials");

  let watch;
  try { watch = JSON.parse(fs.readFileSync(watchPath, "utf8")); } catch { watch = { pending: [] }; }
  const now = Date.now();

  const due = watch.pending
    .filter((w) => Date.parse(w.endsAt) < now - 60000)   // 종료 1분 뒤부터 (반영 지연 여유)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
    .slice(0, MAX_PER_RUN);

  if (!due.length) {
    console.log(JSON.stringify({ settled: 0, pending: watch.pending.length, note: "nothing due" }));
    return;
  }

  const tok = await token();
  const settled = [];
  const failedIds = new Set();

  for (const w of due) {
    const res = await getItem(tok, w.id);
    if (!res.ok) { failedIds.add(w.id); continue; }
    const j = res.item;
    const bids = Number.isFinite(j.bidCount) ? j.bidCount : 0;
    const price = Number(j.currentBidPrice?.value ?? j.price?.value);
    const avail = (j.estimatedAvailabilities || [])[0] || {};
    // 팔렸다고 단정할 근거가 있을 때만 sold=true. 근거가 없으면 null(모름) — false 로 단정하지 않는다.
    const soldQty = Number.isFinite(avail.estimatedSoldQuantity) ? avail.estimatedSoldQuantity : null;
    const sold = soldQty == null ? (bids > 0 ? null : false) : soldQty > 0;
    const listedDays = j.itemCreationDate
      ? Math.round((Date.parse(j.itemEndDate) - Date.parse(j.itemCreationDate)) / 86400000)
      : null;

    // 다수량(lot) 처리: "3 boxes"/"x2" 는 개수로 나눠 개당가를 만들고, case/lot 처럼 개수를
    // 셀 수 없으면 qty=null → 개당가 없음(가격 통계에서 제외). 3박스 낙찰 총액이 1박스
    // 가격으로 섞이는 오염을 막는다. 제목도 남겨 나중에 재검증할 수 있게 한다.
    const qty = parseLotQuantity(j.title || "", w.kind);
    const total = Number.isFinite(price) && sold !== false ? Number(price.toFixed(2)) : null;

    // 부가 필드(등급·판·변형·배송비·판매국가·판매자 신뢰구간·종료시각·상태).
    // 경매는 끝나면 사라지므로 지금 안 뽑으면 영원히 못 뽑는다. 값이 없는 키는 아예 안 만든다.
    // ed(판)도 여기서 결정된다 — eBay aspects 의 Language 가 제목 추측보다 정확하다.
    const extra = extraFields(j);

    settled.push({
      d: new Date(Date.parse(w.endsAt)).toISOString().slice(0, 10),
      id: w.id,
      kind: w.kind,
      set: w.set,
      cardId: w.cardId,
      title: j.title || "",
      sold,
      price: total,
      qty,
      unitPrice: qty != null && total != null ? unitPrice(total, qty) : null,
      currency: j.currentBidPrice?.currency || j.price?.currency || "USD",
      srcCurrency: j.currentBidPrice?.convertedFromCurrency || null,
      bids,
      bidders: Number.isFinite(j.uniqueBidderCount) ? j.uniqueBidderCount : null,
      listedDays,
      ...extra,
    });
  }

  const settledIds = new Set(settled.map((s) => s.id));
  const giveUpBefore = now - GIVE_UP_HOURS * 3600000;
  watch.pending = watch.pending.filter((w) => {
    if (settledIds.has(w.id)) return false;                       // 정산 완료
    if (Date.parse(w.endsAt) < giveUpBefore) return false;        // 너무 오래됨 — 포기(추측 안 함)
    return true;
  });
  watch.updated = new Date(now).toISOString();
  fs.writeFileSync(watchPath, JSON.stringify(watch) + "\n", "utf8");

  // ── 낙찰 기록 저장: 원장은 일자별 아카이브(하루 지나면 다시 안 쓰임 → 저장소가 안 불어남)
  const archived = appendSales(settled);

  // 파생 집계·최근 창은 아카이브에서 다시 만든다. 원장과 집계가 어긋날 여지를 없앤다.
  let out;
  try { out = JSON.parse(fs.readFileSync(soldPath, "utf8")); } catch { out = { sales: [], daily: [] }; }
  const window = readRecent(KEEP_SALES_DAYS).sort((a, b) => a.d.localeCompare(b.d));
  out.sales = readRecent(HOT_DAYS).sort((a, b) => a.d.localeCompare(b.d));

  // ── 일별 집계 재계산
  const days = [...new Set(window.map((s) => s.d))];
  // 가격 집계는 "개당가" 기준. qty 필드가 있는 새 기록은 unitPrice(수량 모름이면 null→제외),
  // qty 필드가 없는 과거 기록은 종전대로 price 를 쓴다(45일 롤링이라 자연 소멸).
  const perUnit = (r) => ("qty" in r ? r.unitPrice : r.price);
  const agg = (rows) => {
    const soldRows = rows.filter((r) => r.sold === true && Number.isFinite(perUnit(r)));
    const decided = rows.filter((r) => r.sold !== null);      // 팔림/유찰이 확정된 것만 낙찰률 분모
    return {
      n: rows.length,
      sold: rows.filter((r) => r.sold === true).length,
      sellThrough: decided.length ? Number((decided.filter((r) => r.sold).length / decided.length * 100).toFixed(1)) : null,
      medPrice: med(soldRows.map(perUnit)),
      maxPrice: soldRows.length ? Math.max(...soldRows.map(perUnit)) : null,
      medBids: med(soldRows.map((r) => r.bids)),
    };
  };
  const daily = days.map((d) => {
    const rows = window.filter((s) => s.d === d);
    const bySet = {};
    for (const s of new Set(rows.filter((r) => r.set).map((r) => r.set))) {
      const rs = rows.filter((r) => r.set === s);
      if (rs.length < 2) continue;                              // 표본 1건은 잡음
      bySet[s] = agg(rs);
    }
    return {
      d,
      ...agg(rows),
      byKind: Object.fromEntries(["box", "carton", "pack", "card"].map((k) => [k, agg(rows.filter((r) => r.kind === k))])),
      // 박스는 판(JP/EN)별 + 갯수(single/multi)별로도 집계. carton 은 위 byKind.carton 으로 분리됨 — box 에 안 섞임.
      boxByEd: Object.fromEntries(["jp", "en"].map((e) => [e, agg(rows.filter((r) => r.kind === "box" && r.ed === e))])),
      boxByQty: { single: agg(rows.filter((r) => r.kind === "box" && r.qty === 1)), multi: agg(rows.filter((r) => r.kind === "box" && Number.isFinite(r.qty) && r.qty > 1)) },
      // 등급 카드 축 — 2026-08-20 추가. 레코드에는 grade 가 붙어 있었는데(PSA 10 · CGC Pristine 10 …)
      // 일별 집계에 축이 없어서 "등급 카드가 무등급보다 얼마나 비싼가"를 낼 수 없었다.
      // 회사별로 10 의 이름이 다르다(PSA 10 / PSA Gem Mint 10 / CGC 10 / CGC Gem Mint 10 / CGC Pristine 10 …).
      // 여기서는 그걸 회사 단위로만 묶는다 — 등급 라벨끼리 합치면 서로 다른 기준을 한 칸에 뭉개게 된다.
      byGrade: (() => {
        const graded = rows.filter((r) => r.grade);
        const out = { raw: agg(rows.filter((r) => !r.grade)), graded: agg(graded) };
        for (const co of ["PSA", "CGC", "BGS", "TAG"]) {
          const rs = graded.filter((r) => String(r.grade).toUpperCase().startsWith(co));
          if (rs.length) out[co.toLowerCase()] = agg(rs);
        }
        return out;
      })(),
      bySet,
    };
  });
  const cutDaily = new Date(now - KEEP_DAILY_DAYS * 86400000).toISOString().slice(0, 10);
  const priorDaily = (out.daily || []).filter((p) => p.d >= cutDaily && !days.includes(p.d));
  out.daily = [...priorDaily, ...daily].sort((a, b) => a.d.localeCompare(b.d));

  out.note = `Completed eBay auction results for ${GAME === "onepiece" ? "One Piece Card Game" : "Palworld Card Game"} items. The full ledger lives in data/${pre}auction-archive/<date>.json (one file per day, written once and not rewritten); 'sales' here is only the most recent " + HOT_DAYS + " days and 'daily' is the aggregate series. Each record is read from the listing AFTER the auction closed, so 'price' is the final winning bid, not an asking price or a mid-auction bid. 'sold' is taken from eBay's sold-quantity field; where eBay does not report it we store null rather than guessing, and null rows are excluded from the sell-through denominator. Multi-item lots are handled by 'qty' parsed from the title: 'price' is always the lot total, 'unitPrice' is per item, and where the count cannot be determined (case/lot/bulk) qty is null and the record is excluded from price aggregates rather than counted as a single item. Aggregated medPrice/maxPrice are per-unit figures. Sellers and locations excluded from our price data are excluded here too.`;
  out.updated = new Date(now).toISOString();
  fs.writeFileSync(soldPath, JSON.stringify(out) + "\n", "utf8");

  const soldNow = settled.filter((s) => s.sold === true);
  console.log(JSON.stringify({
    due: due.length,
    settled: settled.length,
    failed: failedIds.size,
    soldConfirmed: soldNow.length,
    medPrice: med(soldNow.map((s) => s.unitPrice)),
    pendingLeft: watch.pending.length,
    archived,
    hotSales: out.sales.length,
    ledgerSales: window.length,
    graded: settled.filter((s) => s.grade).length,
    edResolved: settled.filter((s) => s.ed).length,
  }));
})();
