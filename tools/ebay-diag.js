#!/usr/bin/env node
// eBay 자격증명·API 진단 — GitHub Actions에서 실제 OAuth/Browse 상태를 뽑아 logs/ebay-diag.json 에 기록.
// 비밀값은 절대 출력 안 함(해시·길이·상태코드만). idHash를 로컬 지문과 비교해 "키가 같은지" 확인.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const id = process.env.EBAY_CLIENT_ID || "";
const sec = process.env.EBAY_CLIENT_SECRET || "";
const h = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
const redact = (s) => String(s || "").replace(/[A-Za-z0-9_.-]{20,}/g, "[redacted]").slice(0, 240);
const out = { ranAt: new Date().toISOString(), idLen: id.length, secLen: sec.length, idHash: h(id), secHash: h(sec) };
(async () => {
  try {
    const auth = Buffer.from(`${id}:${sec}`).toString("base64");
    const tr = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    out.oauthStatus = tr.status;
    const tb = await tr.text();
    if (!tr.ok) {
      out.oauthError = redact(tb);
    } else {
      const token = JSON.parse(tb).access_token;
      const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
      u.searchParams.set("q", "One Piece OP-01 booster box");
      u.searchParams.set("limit", "3");
      const sr = await fetch(u, { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
      out.browseStatus = sr.status;
      const sb = await sr.text();
      if (!sr.ok) out.browseError = redact(sb);
      else out.browseCount = (JSON.parse(sb).itemSummaries || []).length;
    }
  } catch (e) {
    out.exception = String(e.message).slice(0, 200);
  }
  fs.mkdirSync(path.join(__dirname, "..", "logs"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "logs", "ebay-diag.json"), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out));
})();
