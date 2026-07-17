// 최저가(bestListing) 셀러 국가 자동검증 — eBay 피드백 프로필의 "Member since ... in <국가>" 파싱
// 중국 위장창고 다계정망 대응(2026-07 확인: greatestplc/wzxc2024/ajwu2024/dndy2024/dcfonew/obtr2024/
// chuangxinhe/onpiececard/newcardscoming/ygmvtion 전부 US창고 발송 China 셀러).
// Run: node tools/verify-best-sellers.js   (로컬 주간 실행 권장 — 데이터센터 IP는 eBay가 차단할 수 있음)
// 결과: China/HK/MO 셀러가 bestListing에 있으면 목록 출력 + exit 1 → 필터에 추가 후 수집기 재실행할 것.
const fs = require("fs");
const path = require("path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");

const DATA = path.join(__dirname, "..", "data", "onepiece-packs.json");
const d = JSON.parse(fs.readFileSync(DATA, "utf8"));

const sellers = new Map(); // seller -> [where...]
for (const [code, s] of Object.entries(d.sets || {})) {
  for (const lang of ["jp", "en"]) {
    const b = s.boxMarket && s.boxMarket[lang] && s.boxMarket[lang].ebayActive && s.boxMarket[lang].ebayActive.bestListing;
    if (b && b.seller) {
      if (!sellers.has(b.seller)) sellers.set(b.seller, []);
      sellers.get(b.seller).push(`${code} 박스(${lang}) $${b.total}`);
    }
  }
  for (const c of s.cards || []) {
    const b = c.psa10Active && c.psa10Active.bestListing;
    if (b && b.seller) {
      if (!sellers.has(b.seller)) sellers.set(b.seller, []);
      sellers.get(b.seller).push(`${code} ${c.number || c.name} PSA10 $${b.total}`);
    }
  }
}

async function countryOf(seller) {
  try {
    const r = await fetch(`https://www.ebay.com/fdbk/feedback_profile/${encodeURIComponent(seller)}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", accept: "text/html" },
    });
    const html = await r.text();
    const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = txt.match(/[Mm]ember since:?\s*[^|<]{0,40}?in\s+([A-Za-z ]{3,25})/);
    return m ? m[1].trim().replace(/\s+(Top|Member).*$/i, "") : null;
  } catch (e) {
    return "ERR:" + e.message.slice(0, 30);
  }
}

(async () => {
  const flagged = [];
  const list = [...sellers.keys()];
  console.log(`bestListing 셀러 ${list.length}명 검증 시작...`);
  for (const seller of list) {
    const country = await countryOf(seller);
    const bad = country && /^(China|Hong Kong|Macau)/i.test(country);
    if (bad) flagged.push({ seller, country, where: sellers.get(seller) });
    console.log(`  ${bad ? "🚫" : "  "} ${seller.padEnd(26)} ${country || "?"}`);
    await new Promise((r) => setTimeout(r, 1200)); // 봇차단 회피용 간격
  }
  if (flagged.length) {
    console.log("\n=== 차단 필요(China/HK/MO) ===");
    for (const f of flagged) console.log(`"${f.seller}", // fdbk: ${f.country} — ${f.where.join("; ")}`);
    console.log("\n위 항목을 tools/ebay-listing-filters.js excludedSellerUsernames에 추가 후 수집기 재실행.");
    process.exit(1);
  }
  console.log("\n전원 통과 — 중국권 bestListing 없음.");
})();
