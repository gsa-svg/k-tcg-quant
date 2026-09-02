// eBay 하루 호출량(5,000건)을 용도별로 나눈다 — 2026-09-02 신설.
//
// ── 왜 필요했나
// 소유자 지시: "당분간 데일리로 이베이 쿼터는 max 로 다 수집해서 그래프·데이터를 고도화하자."
// 종전에는 settle-auctions 가 회차당 250건으로 못박혀 있었다(하루 12회 = 3,000건 상한).
// 그런데 실제로는 그 상한에 닿지도 못했다 — 2026-09-02 실측으로 정산 대기가 242건뿐이었다.
// 병목은 상한이 아니라 **감시 목록에 들어온 매물 수**였다. 원피스는 하루 1,864건이 끝나는데
// 감시 목록에는 526건만 들어와 있었다(28%). 정산기는 감시 중인 것만 정산할 수 있다.
//
// 그래서 두 가지를 함께 바꾼다.
//   ① 검색(collect-auction-market)을 더 자주 돌려 감시 목록을 채운다 — 검색은 싸다.
//      실측: 12,134건 스캔에 440콜(1콜당 27건). 정산은 1건당 1콜이라 비교가 안 된다.
//   ② 정산 상한을 고정값이 아니라 **그 시점의 잔여 쿼터**에서 계산한다.
//
// ── 배분 원칙
// 이 사이트의 주제는 원피스다. 남는 쿼터는 원피스 커버리지에 먼저 쓴다.
// 다만 TCG 스냅샷·정산이 굶으면 게임 간 비교가 끊기므로 그쪽 몫을 먼저 떼어 둔다.
//
// ⚠️ 잔여량은 eBay 가 알려주는 실제 값을 쓴다. 우리가 센 횟수로 추정하면 다른 워크플로가
//    쓴 몫을 놓쳐 429 를 맞는다(2026-09-02 에 실제로 맞았다).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadEnv(p) {
  const out = {};
  try {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
}
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };

async function token() {
  const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("토큰 발급 실패");
  return j.access_token;
}

// Browse API 의 남은 호출 수. 못 읽으면 null — 부르는 쪽이 보수적으로 굴어야 한다.
async function remaining() {
  try {
    const tok = await token();
    const r = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_name=Browse&api_context=buy", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    for (const a of j.rateLimits || []) {
      for (const res of a.resources || []) {
        for (const r2 of res.rates || []) {
          if (Number.isFinite(r2.remaining)) return r2.remaining;
        }
      }
    }
  } catch {}
  return null;
}

// 용도별로 떼어 두는 몫. 하루 총량 5,000 기준.
const RESERVE = {
  tcg: 1100,      // TCG 스냅샷(게임 17종 × 5페이지)과 TCG 정산
  search: 1000,   // 원피스·팰월드 매물 검색 — 감시 목록을 채우는 곳. 여기가 마르면 정산할 것이 없어진다.
  safety: 200,    // 다른 워크플로(진행 매물·PSA10 링크)와 재시도용
};

// 이번 실행에서 정산에 쓸 수 있는 건수.
//   opts.reserveFor: 이번 실행 뒤에도 남겨 둘 용도들(기본: 전부)
//   opts.share: 남은 몫 중 이번 회차가 가져갈 비율. 2시간마다 도는 정산이 한 번에 다 쓰면
//               그날 나머지 시간대가 굶는다. 기본 0.4 는 실측 없이 정한 값이 아니라,
//               하루 12회 중 앞쪽 몇 회가 몰아 쓰고도 뒤가 남도록 잡은 것이다.
//   opts.min / opts.max: 하한·상한(한 번에 너무 적거나 많이 돌지 않게)
async function settleBudget(opts = {}) {
  const share = opts.share ?? 0.4;
  const min = opts.min ?? 50;
  const max = opts.max ?? 1200;
  const keep = (opts.reserveFor || ["tcg", "search", "safety"]).reduce((t, k) => t + (RESERVE[k] || 0), 0);

  const left = await remaining();
  if (left == null) return { n: min, left: null, note: "잔여량을 못 읽어 하한만 쓴다" };
  const usable = Math.max(0, left - keep);
  const n = Math.max(0, Math.min(max, Math.floor(usable * share)));
  if (n < min) return { n: n > 0 ? n : 0, left, note: `가용 ${usable} — 몫이 하한 미만` };
  return { n, left, note: `잔여 ${left} · 예약 ${keep} · 가용 ${usable} · 이번 회차 ${n}` };
}

module.exports = { remaining, settleBudget, RESERVE };

if (require.main === module) {
  (async () => {
    const left = await remaining();
    const b = await settleBudget();
    console.log(JSON.stringify({ 잔여: left, 예약: RESERVE, 이번회차_정산가능: b.n, 설명: b.note }, null, 1));
  })();
}
