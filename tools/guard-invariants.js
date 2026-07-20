// 사이트 불변식 가드 — 과거 실제 사고 유형을 전부 기계 검사로 차단.
// 하나라도 어기면 exit 1 → 야간 워크플로 실패(커밋 안 됨) + GitHub 실패 메일.
// Run: node tools/guard-invariants.js   (로컬 배포 전에도 실행)
//
// 사고 이력과 대응 검사:
//  [2026-07-08 canonical 스왑: 홈 노출 0]  → C1, C2, C3
//  [2026-07-14 DATA_VERSION 미범프: 하루 종일 구데이터] → V1
//  [2026-07-17 야간봇이 시세 시리즈 덮어씀] → D1
//  [영구 규칙: 외부 소스명 공개 금지] → S1
//  [검증파일 삭제 사고 예방] → F1
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const errors = [];
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walkHtml(dirs) {
  const out = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith(".html")) out.push(d ? `${d}/${f}` : f);
  }
  return out;
}
const PUBLIC_HTML = walkHtml(["", "sets", "cards", "articles", "ko"]);

// ── V1. 캐시 버전 일관성: packs.js DATA_VERSION == 모든 ?v= 문자열
const packsJs = read("packs.js");
const ver = (packsJs.match(/DATA_VERSION = "([^"]+)"/) || [])[1];
if (!ver) errors.push("V1: packs.js에서 DATA_VERSION을 찾지 못함");
else {
  for (const f of PUBLIC_HTML) {
    for (const m of read(f).matchAll(/\?v=([0-9a-z]+)/g)) {
      if (m[1] !== ver) { errors.push(`V1: ${f} 의 ?v=${m[1]} ≠ DATA_VERSION ${ver} (동시 범프 안 됨)`); break; }
    }
  }
}

// ── C1. 내부링크에 홈 변형(packs.html?hl=) 금지 — canonical 스왑 사고 원인
for (const f of [...PUBLIC_HTML, "packs.js"]) {
  if (read(f).includes("packs.html?hl=")) errors.push(`C1: ${f} 에 packs.html?hl= 홈 변형 링크 잔존 (홈은 / 로만 링크)`);
}

// ── C2. canonical 자기 일치: 각 페이지 canonical == 자기 URL (홈 별칭 2개만 / 허용)
for (const f of PUBLIC_HTML) {
  const m = read(f).match(/rel="canonical" href="([^"]+)"/);
  if (!m) continue;
  const expected = f === "index.html" || f === "packs.html" ? "https://opboxindex.com/" : `https://opboxindex.com/${f}`;
  const alt = f.endsWith("/index.html") ? `https://opboxindex.com/${f.replace(/index\.html$/, "")}` : null;
  if (m[1] !== expected && m[1] !== alt) errors.push(`C2: ${f} canonical=${m[1]} (기대: ${expected}${alt ? ` 또는 ${alt}` : ""})`);
}

// ── C3. 사이트맵: 홈 변형 등재 금지 + 모든 URL 실파일 존재
const sitemap = read("sitemap.xml");
if (/<loc>https:\/\/opboxindex\.com\/(index\.html|packs\.html)/.test(sitemap)) errors.push("C3: sitemap에 홈 변형(/index.html·/packs.html) 등재됨");
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const pathname = new URL(m[1].replace(/&amp;/g, "&")).pathname;
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)) + (pathname.endsWith("/") ? "index.html" : "");
  if (!exists(rel)) errors.push(`C3: sitemap URL의 실파일 없음: ${m[1]}`);
}

// ── N1. 메인 네비 일관성: 모든 nav 보유 페이지는 6개 링크를 전부 가져야 함.
//    (반복 사고: Compare 등 눌렀을 때 Market Index가 사라지는 페이지 존재 → 링크 누락 차단)
//    상대경로가 폴더마다 달라서(../market.html vs market.html) data-ko 라벨로 판정한다.
const NAV_REQUIRED = ["부스터 박스", "비교", "PSA10 랭킹", "마켓 지수", "세트 가이드", "아마존 응모"];
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const navM = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navM) continue; // 네비 없는 페이지는 검사 대상 아님
  const nav = navM[1];
  for (const label of NAV_REQUIRED) {
    if (!nav.includes(`data-ko="${label}"`)) errors.push(`N1: ${f} 메인 네비에 "${label}" 링크 누락 (6개 링크 전부 필요)`);
  }
}

// ── D1. 시세 시리즈 보호: 기준 매니페스트(2026-07-17 검증 상태)와 대조.
// wm였던 시리즈가 eBay로 바뀌거나 사라지면 = 야간봇 덮어쓰기 재발 → 실패.
// 정당하게 새 세트를 추가/전환할 땐 매니페스트를 의도적으로 갱신할 것(tools/series-source-manifest.json).
const data = JSON.parse(read("data/onepiece-packs.json"));
const manifest = JSON.parse(read("tools/series-source-manifest.json"));
for (const [k, kind] of Object.entries(manifest)) {
  const [code, key] = k.split("|");
  const src = data.sets?.[code]?.[key]?.source;
  if (!src) { errors.push(`D1: ${code}.${key} 시리즈가 사라짐 (매니페스트엔 ${kind}로 존재)`); continue; }
  if (kind === "wm" && !/Weekly ungraded/i.test(src)) errors.push(`D1: ${code}.${key}.source="${src}" — wm 시리즈가 덮어써짐(eBay 스냅샷은 ${key}Ebay로 가야 함)`);
}

// ── D2. 마켓 인덱스 정합성(build-market-index.js 산출) — 이상값이면 배포 차단
{
  const mi = data.marketIndex;
  if (!mi) errors.push("D2: data.marketIndex 없음 (build-market-index.js 미실행)");
  else {
    const v = mi.index && mi.index.value;
    if (!(v > 50 && v < 1000)) errors.push(`D2: 지수값 이상 (${v}) — 계산 오류 의심`);
    if (!Array.isArray(mi.constituents) || mi.constituents.length < 10) errors.push(`D2: 구성종목 부족 (${mi.constituents ? mi.constituents.length : 0})`);
    if (!mi.index || !Array.isArray(mi.index.series) || mi.index.series.length < 5) errors.push("D2: 지수 시계열 부족");
    if (!mi.board || mi.board.length < 15) errors.push(`D2: 성적표 부족 (${mi.board ? mi.board.length : 0})`);
    if (!mi.meter || !mi.meter.latestWeek) errors.push("D2: 개봉 미터 없음");
    // 정가·재판 팩트: 성적표에 msrp 배수가 대부분 있어야 함(set-facts.json 로드 확인)
    const withMsrp = (mi.board || []).filter((b) => b.vsMsrp).length;
    if (withMsrp < 15) errors.push(`D2: 정가 배수(vsMsrp) 부족 (${withMsrp}) — data/set-facts.json 로드 실패 의심`);
    if (!mi.reprints || typeof mi.reprints.bandaiAnnounces !== "boolean") errors.push("D2: 재판 데이터(reprints) 없음");
    // market.html에 구운 지수값이 데이터와 일치해야 함(엇갈리면 stale)
    if (exists("market.html") && v != null) {
      const baked = (read("market.html").match(/class="big">([\d.]+)</) || [])[1];
      if (baked && Math.abs(parseFloat(baked) - v) > 0.05) errors.push(`D2: market.html 구운값 ${baked} ≠ 데이터 ${v} (재생성 필요)`);
    }
  }
}

// ── S1. 외부 소스명 공개 금지 (영구 규칙)
for (const f of [...PUBLIC_HTML, "packs.js", "data/onepiece-packs.json", "llms.txt", "feed.xml"]) {
  if (!exists(f)) continue;
  if (/collectr/i.test(read(f))) errors.push(`S1: ${f} 에 외부 소스명 노출 (Weekly ungraded market 라벨 사용)`);
}

// ── S2. AI/검색 접근성 보호 — 구글·Bing·AI 답변엔진 접근을 실수로 막으면 배포 차단
{
  const robots = read("robots.txt");
  // 전면 차단(Disallow: /) 금지 — 어떤 그룹에서든
  const groups = robots.split(/\n\s*\n/);
  for (const g of groups) {
    const ua = (g.match(/User-agent:\s*(\S+)/) || [])[1];
    if (!ua) continue;
    if (/^Disallow:\s*\/\s*$/m.test(g) && !["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Bytespider", "Applebot-Extended", "Amazonbot"].includes(ua))
      errors.push(`S2: robots.txt에서 ${ua} 전면 차단됨 — 훈련 전용 봇 외에는 금지`);
  }
  // AI 답변/검색 봇 허용 그룹이 반드시 존재해야 함
  for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-User", "Claude-SearchBot", "Google-Extended", "Bingbot", "Googlebot"]) {
    if (!new RegExp(`User-agent:\\s*${bot}`).test(robots)) errors.push(`S2: robots.txt에 ${bot} 그룹이 사라짐 (AI/검색 접근성)`);
  }
  if (!robots.includes("Sitemap: https://opboxindex.com/sitemap.xml")) errors.push("S2: robots.txt에 Sitemap 선언 누락");
  // S2b. 답변/검색 AI가 llms.txt에서 안내하는 데이터 경로(/data/, CSV)에 접근 가능해야 함.
  // robots.txt는 전용 그룹이 있으면 * 를 무시하므로, 각 봇 그룹 자체에 /data/ 차단이 없어야 한다.
  {
    const noComment = robots.replace(/^\s*#.*$/gm, "");
    const ANSWER_BOTS = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-User", "Claude-SearchBot", "GrokBot", "xAI-Crawler", "Google-Extended", "Googlebot", "Bingbot", "Yeti"];
    const blocks = noComment.split(/\n\s*\n/);
    for (const bot of ANSWER_BOTS) {
      const blk = blocks.find((b) => new RegExp(`User-agent:\\s*${bot}\\s*$`, "m").test(b));
      if (!blk) { errors.push(`S2: robots.txt에 ${bot} 전용 그룹 없음 — * 상속으로 /data/ 가 막힘`); continue; }
      const dis = [...blk.matchAll(/Disallow:\s*(\S+)/g)].map((m) => m[1]);
      if (dis.some((d) => d === "/" || d.startsWith("/data"))) errors.push(`S2: ${bot} 가 /data/ 차단됨 — llms.txt가 안내하는 데이터 경로는 열려 있어야 함`);
    }
  }
  // 주요 페이지에 noindex가 끼어들면 안 됨
  for (const f of ["index.html", "sets/op-16.html", "cards/index.html", "articles/index.html"]) {
    if (/<meta[^>]+robots[^>]+noindex/i.test(read(f))) errors.push(`S2: ${f} 에 noindex — 검색/AI 노출 차단됨`);
  }
}

// ── F1. 삭제 금지 파일 존재 확인
for (const f of ["googlee0d71bc0695b5651.html", "google1d76c313bd3d0b59.html", "naver933afc5e4330d8e58701ba45b0319b4a.html", "3d439f302e46fc08f76ddba4eee3726f.txt", "robots.txt", "sitemap.xml", "llms.txt", "data/set-facts.json"]) {
  if (!exists(f)) errors.push(`F1: 필수 파일 삭제됨: ${f}`);
}

// ── H1. hreflang 정합성 — 2026-07-19 사고: 홈이 "한국어판=/?hl=ko"로 선언해
//    파라미터 변형(packs.html?hl=)을 우리가 정당화 → 홈 노출이 변형들로 갈라짐.
//    규칙: (a)hreflang 타겟에 ?hl= 파라미터 금지 (b)타겟은 실재 파일 (c)ko↔en 상호확인.
{
  const hrefOf = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)"/g)].map((m) => ({ lang: m[1], url: m[2] }));
  const toRel = (u) => {
    let p;
    try { p = new URL(u).pathname; } catch { return null; }
    return p === "/" ? "index.html" : decodeURIComponent(p.slice(1)) + (p.endsWith("/") ? "index.html" : "");
  };
  const declared = new Map(); // rel파일 -> {lang:url}
  // canonical이 자기 자신이 아닌 페이지(예: 홈 별칭 packs.html)는 언어신호를 canonical 대상이 대표하므로 제외
  const selfCanonical = (f, html) => {
    const m = html.match(/rel="canonical" href="([^"]+)"/);
    if (!m) return true;
    const rel = toRel(m[1]);
    return rel === f || rel === null;
  };
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    if (!selfCanonical(f, html)) continue;
    const list = hrefOf(html);
    if (!list.length) continue;
    const map = {};
    for (const { lang, url } of list) {
      if (/[?&]hl=/.test(url)) errors.push(`H1: ${f} hreflang ${lang} 이 파라미터 변형을 가리킴 (${url}) — 실 디렉터리 URL만 허용`);
      const rel = toRel(url);
      if (rel && !exists(rel)) errors.push(`H1: ${f} hreflang ${lang} 타겟 파일 없음 (${url})`);
      map[lang] = url;
    }
    declared.set(f, map);
  }
  // 상호확인: A가 B를 ko/en으로 지목하면 B도 A를 되가리켜야 구글이 인정
  for (const [f, map] of declared) {
    for (const [lang, url] of Object.entries(map)) {
      if (lang === "x-default") continue;
      const rel = toRel(url);
      if (!rel || rel === f || !declared.has(rel)) continue; // 자기참조·미선언 페이지는 대상 아님
      const back = declared.get(rel);
      const pointsBack = Object.values(back).some((u) => { const r = toRel(u); return r === f; });
      if (!pointsBack) errors.push(`H1: ${f} → ${rel} (${lang}) 단방향 hreflang — 상대가 되가리키지 않음`);
    }
  }
}

// ── L1. 구조화 데이터(JSON-LD) 파싱 유효성 — 깨진 스키마는 리치결과·AI 인용에서 통째로 무시됨
for (const f of PUBLIC_HTML) {
  for (const m of read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { errors.push(`L1: ${f} JSON-LD 파싱 실패 (${e.message.slice(0, 60)})`); }
  }
}

// ── I1. 이미지 외부 핫링크 금지 — 2026-07-19: 카드 이미지 48건이 외부 CDN 직링크라
//    이미지검색 유입을 남에게 주고, CDN이 끊기면 페이지가 통째로 깨짐. 자체 호스팅만 허용.
for (const f of PUBLIC_HTML) {
  for (const m of read(f).matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)) {
    if (!/^https?:\/\/opboxindex\.com\//.test(m[1])) errors.push(`I1: ${f} 외부 이미지 핫링크 (${m[1].slice(0, 60)}) — /img/ 또는 /card-img/ 로 자체 호스팅할 것`);
  }
}

// ── R1. 홈 정적 렌더 보장 — 2026-07-19: 홈 시세표가 JS 전용이라 JS 미실행 크롤러/AI가
//    가격을 못 읽었음. 홈은 색인된 핵심 자산이므로 JS 없이도 최소 본문·가격이 있어야 함.
for (const f of ["index.html", "packs.html"]) {
  if (!exists(f)) continue;
  const body = read(f).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const prices = (text.match(/\$[0-9][0-9,]{2,}/g) || []).length;
  if (text.length < 4000) errors.push(`R1: ${f} JS 없는 본문이 ${text.length}자 — 정적 콘텐츠 부족(4000자 이상 필요)`);
  if (prices < 8) errors.push(`R1: ${f} JS 없는 본문의 가격 표기가 ${prices}개 — 정적 시세표 누락 의심(8개 이상 필요)`);
}

// ── T1. 데이터 신선도 — 야간 파이프라인이 조용히 죽으면 구데이터가 계속 서빙됨
{
  const upd = data.updated;
  if (!upd) errors.push("T1: data.updated 없음");
  else {
    const days = Math.round((Date.now() - new Date(upd + "T00:00:00Z").getTime()) / 86400000);
    if (days > 4) errors.push(`T1: 데이터가 ${days}일 경과 (${upd}) — 야간 파이프라인 점검 필요`);
  }
}

// ── P1. 공급 시계열 무결성 — 'gone(사라진 매물)'을 판매(sold)로 표기하면 허위 데이터가 된다.
//    eBay Browse API로는 판매/취소/만료 구분이 불가능하므로 라벨은 영구히 "delisted or sold".
{
  if (exists("data/supply-series.json")) {
    const sp = JSON.parse(read("data/supply-series.json"));
    const days = Math.round((Date.now() - new Date((sp.updated || "1970-01-01") + "T00:00:00Z").getTime()) / 86400000);
    if (days > 4) errors.push(`P1: 공급 시계열이 ${days}일 경과 (${sp.updated}) — update-supply-series.js 점검`);
    // 순서 무관하게 "판매인지 내림인지 구분 불가"라는 고지가 남아 있는지 확인
    const note = sp.note || "";
    if (!(/delisted/i.test(note) && /\bsold\b/i.test(note) && /cannot distinguish|not.*a sale|never.*sale/i.test(note)))
      errors.push("P1: supply-series.note 에 '판매/내림 구분 불가' 고지 누락 — gone을 판매로 오해시킬 수 있음");
    const codes = Object.keys(sp.sets || {});
    if (codes.length < 15) errors.push(`P1: 공급 시계열 세트 부족 (${codes.length})`);
  }
  // 공개 산출물에서 gone을 sold로 표기하지 않았는지 확인(라벨 오염 차단)
  for (const f of [...PUBLIC_HTML, "opbox-set-prices.csv", "llms.txt"]) {
    if (!exists(f)) continue;
    const t = read(f);
    if (/(sold|판매)\s*(count|건수|volume|량)/i.test(t) && /gone|delist/i.test(t))
      errors.push(`P1: ${f} 에서 사라진 매물을 판매량처럼 표기한 정황 — 라벨 재확인`);
  }
}

// ── W1. 야간 산출물 커밋 누락 방지 — 2026-07-20 실사고.
//    fetch-auction-deals.js 가 만든 data/auction-deals.json 이 워크플로 커밋 목록에 없어
//    작업트리에 미스테이징 변경이 남았고, 푸시 충돌 시 `git rebase` 가 "unstaged changes"로
//    실패해 야간 배포가 통째로 죽었다. 같은 유형으로 data/price-quality-audit.json 도 누락돼 있었다.
// 2026-07-20 2차: 워크플로가 늘어나면서 이 검사가 야간 파일 하나만 보고 있다는 게 드러났다.
// 새 워크플로(경매 수집·정산)는 검사 밖이었다 — 같은 사고가 그대로 재현될 자리였다. 전 워크플로로 넓힌다.
{
  const wfDir = path.join(ROOT, ".github", "workflows");
  const CURATED = new Set(["set-facts.json"]);   // 사람이 관리하는 읽기 전용 — 산출물이 아님
  const dataFiles = fs.existsSync(path.join(ROOT, "data"))
    ? fs.readdirSync(path.join(ROOT, "data")).filter((n) => n.endsWith(".json"))
    : [];

  for (const wf of fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)) : []) {
    const y = read(`.github/workflows/${wf}`);
    const addLine = (y.match(/git add ([^\n]+)/) || [])[1] || "";
    const diffLine = (y.match(/git diff --quiet ([^\n]+?);\s*then/) || [])[1] || "";
    if (!addLine && !diffLine) continue;    // 커밋하지 않는 워크플로는 대상 아님

    // 두 목록이 어긋나면 "변경은 감지되는데 커밋은 안 되는" 구멍이 생긴다.
    // `--` 는 경로 구분자일 뿐 대상 목록이 아니다. 빼고 비교하지 않으면 오탐이 난다.
    const norm = (t) => t.trim().split(/\s+/).filter((x) => x && x !== "--").sort().join(" ");
    if (addLine && diffLine && norm(addLine) !== norm(diffLine)) {
      errors.push(`W1: ${wf} 의 git diff 목록과 git add 목록 불일치 — 커밋 누락 구멍`);
    }

    // 이 워크플로가 돌리는 도구가 기록하는 data/*.json 은 전부 커밋 목록에 있어야 한다.
    const tools = [...y.matchAll(/node tools\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
    const src = [...new Set(tools)]
      .filter((f) => exists(`tools/${f}`))
      .map((f) => read(`tools/${f}`))
      .join("\n");
    if (!src) continue;
    for (const f of dataFiles) {
      if (CURATED.has(f)) continue;
      // 도구가 "쓰는" 파일만 대상 — 읽기만 하는 파일도 소스에 이름이 나오므로 writeFileSync 로 판별한다.
      const writes = new RegExp(`writeFileSync\\([^)]*${f.replace(/[.]/g, "\\.")}`).test(src)
        || new RegExp(`"${f.replace(/[.]/g, "\\.")}"[^\\n]*\\n?[^\\n]*writeFileSync`).test(src)
        || (src.includes(`"${f}"`) && /writeFileSync/.test(src) && new RegExp(`Path[^\\n]*"${f.replace(/[.]/g, "\\.")}"`).test(src));
      if (!writes) continue;
      if (!addLine.includes(`data/${f}`)) {
        errors.push(`W1: data/${f} 는 ${wf} 의 산출물인데 커밋 목록에 없음 — rebase 실패를 유발함`);
      }
    }
  }
}

// ── X1. 외부로 fetch 하는 주소는 CSP connect-src 에 있어야 한다 — 2026-07-20 실사고.
// 경매 중계기를 붙였는데 connect-src 에 안 넣어서 브라우저가 조용히 막았다. 서버는 200을 주고
// 콘솔에도 CSP 위반은 우리 코드 에러로 안 잡히니, 위젯이 "그냥 안 보이는" 형태로 실패했다.
// 새 외부 엔드포인트를 붙일 때마다 같은 함정이 있으므로 자동 검사한다.
{
  const js = exists("packs.js") ? read("packs.js") : "";
  // packs.js 안의 절대 https 주소 중 fetch 대상이 될 수 있는 상수들
  const relays = [...js.matchAll(/const\s+\w*RELAY\w*\s*=\s*"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of relays) {
    let origin;
    try { origin = new URL(url).origin; } catch { continue; }
    for (const page of ["index.html", "packs.html"]) {
      if (!exists(page)) continue;
      const html = read(page);
      if (!/Content-Security-Policy/i.test(html)) continue;   // CSP 없는 페이지는 대상 아님
      const connect = (html.match(/connect-src ([^;"]+)/) || [])[1] || "";
      if (!connect.includes(origin)) {
        errors.push(`X1: ${page} 의 CSP connect-src 에 ${origin} 없음 — 브라우저가 조용히 차단함`);
      }
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ guard: "FAIL", errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ guard: "OK", checkedPages: PUBLIC_HTML.length, version: ver, checks: ["V1", "C1", "C2", "C3", "N1", "D1", "D2", "S1", "S2", "F1", "H1", "L1", "I1", "R1", "T1", "P1", "W1", "X1"] }));
