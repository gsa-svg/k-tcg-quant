#!/usr/bin/env node
// eBay Browse API 의 남은 호출 수를 확인한다 — 2026-09-01 신설.
//
// ── 왜
// 2026-09-01, settle 이 due 391건 중 390건을 429 로 놓쳤다. 경매는 소급 조회가 안 되므로
// 그 시간대 낙찰가는 영영 빈다. 원인은 우리가 하루 예산의 2배를 예약하고 있었던 것이다:
//   Browse 한도 5,000/일  vs  settle 만 900건 × 12회 = 10,800콜
// 한도는 개발자 analytics API 가 알려주는데, 아무도 물어본 적이 없었다.
//
// ── 쓰는 법
//   node tools/check-ebay-quota.js            남은 콜을 출력
//   node tools/check-ebay-quota.js --min 300  남은 콜이 그 아래면 exit 1 (워크플로에서 게이트로)
//   node tools/check-ebay-quota.js --min 400 --reserve tcgSnapshot
//        다른 소비자 몫(tools/ebay-budget.js reserveFor 키, 쉼표로 여럿)을 더해 문턱을 올린다 — 2026-10-14.
//        창 끝 잔여가 모자란 날 00:18 TCG 스냅샷이 리셋 뒤 07:18 로 밀렸다(9/5~9/8·10/8~10/10). 진행 매물 갱신
//        (update-active-listings)은 한 번에 ~700콜을 쓰면서 문턱 400 만 보고 그 몫을 남기지 않았다.
//        그 몫이 아직 필요할 때만 더한다(그날 점이 생기면 0).
//
// 워크플로 앞에 두면, 한도가 바닥일 때 수집을 시작해 실패로 원장을 더럽히는 대신
// 그 회차를 건너뛴다. 감시목록은 그대로 남아 다음 회차에 재시도된다.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { reserveFor, nextReset } = require("./ebay-budget");

function loadEnv(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .reduce((acc, l) => { const i = l.indexOf("="); if (i > 0) acc[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); return acc; }, {});
}
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };

const minIdx = process.argv.indexOf("--min");
const MIN = minIdx > -1 ? Number(process.argv[minIdx + 1]) || 0 : 0;
const reserveIdx = process.argv.indexOf("--reserve");
const RESERVE_KEYS = reserveIdx > -1 ? String(process.argv[reserveIdx + 1] || "").split(",").map((k) => k.trim()).filter(Boolean) : [];

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("eBay 자격증명 없음");
  const auth = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");

  const tokRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const tok = (await tokRes.json()).access_token;
  if (!tok) throw new Error("토큰 발급 실패");

  const r = await fetch("https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=browse",
    { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`한도 조회 실패 ${r.status}`);
  const j = await r.json();

  const out = [];
  for (const a of j.rateLimits || []) {
    for (const res of a.resources || []) {
      for (const rate of res.rates || []) {
        out.push({ name: res.name, limit: rate.limit, remaining: rate.remaining, reset: rate.reset });
      }
    }
  }
  const browse = out.find((x) => x.name === "buy.browse") || out[0];
  const now = Date.now();
  const resetMs = Date.parse(browse?.reset || "");
  const keep = Object.fromEntries(RESERVE_KEYS.map((k) => [k, reserveFor(k, now, Number.isFinite(resetMs) ? resetMs : nextReset(now))]));
  const need = MIN + Object.values(keep).reduce((a, b) => a + b, 0);
  const report = { checked: new Date().toISOString(), resources: out, remaining: browse ? browse.remaining : null, limit: browse ? browse.limit : null, ...(RESERVE_KEYS.length ? { min: MIN, reserve: keep, need } : {}) };
  console.log(JSON.stringify(report, null, 1));

  if (need && browse && browse.remaining < need) {
    console.error(`남은 호출 ${browse.remaining} < 요구 ${need}(최소 ${MIN}${RESERVE_KEYS.length ? ` + 남길 몫 ${JSON.stringify(keep)}` : ""}) — 이 회차는 건너뛴다(한도 리셋 ${browse.reset}).`);
    process.exit(1);
  }
})();
