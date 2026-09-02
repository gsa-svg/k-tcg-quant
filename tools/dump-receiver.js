#!/usr/bin/env node
// 브라우저 수집 덤프 수신기 — 2026-09-02 신설(그전엔 매번 임시로 만들어 썼다).
//
// 왜 필요한가: eBay sold 는 실브라우저로만 긁을 수 있는데, 그 결과(2MB 안팎)를 노드로 가져올 길이
// 마땅치 않다. javascript_tool 의 반환값은 잘리고, Blob 다운로드는 파일명·경로가 매번 다르다.
// 그래서 브라우저가 localhost 로 POST 하고 이 서버가 파일로 쓴다 — 검증된 경로다.
// (GemRate·TAG 는 이 방법이 막혀 Blob 다운로드를 쓴다. 기억: opbox-browser-collection-exfil)
//
// 127.0.0.1 에만 바인딩한다 — 외부에서 접근할 수 없다.
// 이미 떠 있으면(EADDRINUSE) 그 서버를 그대로 쓰면 된다. 새로 띄울 필요 없다.
//
// Run: node tools/dump-receiver.js <저장할 경로.json>
//   브라우저에서: await window.__opPost()   (기본 http://127.0.0.1:8377/dump 로 보낸다)
const http = require("node:http");
const fs = require("node:fs");

const OUT = process.argv[2];
if (!OUT) {
  console.error("사용법: node tools/dump-receiver.js <저장할 경로.json>");
  process.exit(1);
}
const PORT = 8377;

const server = http.createServer((req, res) => {
  // 브라우저가 ebay.com 등 다른 출처에서 보내므로 CORS 를 열어준다(로컬 전용이라 안전).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { res.writeHead(405); res.end("POST only"); return; }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    // 깨진 JSON 을 파일로 쓰면 ingest 가 죽는다. 여기서 걸러 브라우저에 알린다.
    try { JSON.parse(body); } catch (e) {
      console.error("JSON 이 아니다 — 저장하지 않음: " + String(e.message).slice(0, 80));
      res.writeHead(400); res.end("bad json"); return;
    }
    fs.writeFileSync(OUT, body, "utf8");
    console.log(`받음 ${body.length} bytes -> ${OUT}`);
    res.writeHead(200); res.end("ok");
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`포트 ${PORT} 가 이미 쓰이고 있다 — 먼저 띄운 수신기가 살아있다면 그걸 쓰면 된다.`);
    process.exit(2);
  }
  throw e;
});

server.listen(PORT, "127.0.0.1", () => console.log(`대기 중 127.0.0.1:${PORT} -> ${OUT}`));
