"use strict";
// 문구 규칙 — "데이터 페이지엔 숫자·표·라벨만"(소유자 결정 2026-10-15), 업체명 금지, 제휴 고지 원문. 사실 파일이 보장하지 못하는 글자. 2026-10-15 분할.
//  S1/S4/VN1 외부 소스·시세 업체명 금지 [영구 규칙·감사 #20] · D18 라벨 = 실제 규칙 [2026-10-14 QA] · DF1/DF2/DF3/NP1/CX1/NC1/UP2/UP3 해설·사유·방어 문장 금지 [2026-10-15 4차·6차]
//  E1 EPN 상단 고지 위치·크기·대비 [2026-08-10 EPN 위반 통지] · EP1 EPN 고지 원문·면책 한 줄 [6차] · AN1 "a 80%" [5차] · EQ1 같은 값 비교 절 [5차] · EL1 글자 없는 링크 [5차]
//  R2(문구) 재입고 줄 단서·옛 문구·방법 문장 [2026-08-13·4차] · KO1/KO2/KO3(문구) 한국어 문답·재판·경매 라벨 [감사 #1~#15] · SP1 NM 없는 카드의 spread 문장 [5차]
//  FQ1 가격 문답의 답은 그 판 판매 중앙값 꼴 [5차] · CL1(문구) 카드리스트에 이미지·효과 텍스트 금지 [2026-10-14 W7]
const { errors, read, exists, PUBLIC_HTML, ldOf, shownText, strip, json, facts, capped } = require("./lib");

const checks = ["PM1", "S1", "S4", "VN1", "D18", "DF1", "DF2", "DF3", "NP1", "CX1", "NC1", "UP2", "UP3", "E1", "EP1", "AN1", "EQ1", "EL1", "R2", "KO1", "KO2", "KO3", "SP1", "FQ1", "CL1"];
// compare.html·market-2026.html 은 2026-10-19 에 더했다 — compare 하단 "Where the numbers come from" 문단에 업체명(Yuyu-tei)과 해설이 남아 있었다.
const DATA_PAGES = ["index.html", "packs.html", "box-prices.html", "weekly.html", "free-data.html", "auction.html", "tcg-auction.html", "compare.html", "market-2026.html"];
const visible = (h) => h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
// 금지 문구 목록을 파일 묶음에 적용(파일당 첫 매치만)
const ban = (id, files, list, text = (h) => h, note = "") => {
  const push = capped(id, 10);
  for (const f of files) { const t = text(read(f), f); for (const re of list) { const m = t.match(re); if (m) { push(`${f} 에 "${m[0]}"${note}`); break; } } }
  push.flush();
};

function run() {
  const F = facts();
  const upFiles = Object.values(F.upcoming).map((u) => `sets/${u.slug}.html`).filter(exists);
  const setPages = PUBLIC_HTML.filter((p) => /^sets\/(?:op|eb|prb)-\d+(?:-english)?\.html$/.test(p) && !upFiles.includes(p));
  const koSet = PUBLIC_HTML.filter((p) => /^ko\/(?:op|eb|prb)-\d+\.html$/.test(p));
  const cards = PUBLIC_HTML.filter((p) => /^cards\/(?!index\.html$)[^/]+\.html$/.test(p));
  const packsJs = read("packs.js");
  // PM1 — 공개 HTML·robots.txt 에 작업 메모 0(과정 비공개, 2026-10-19). HTML 주석(<script>·<style> 밖)에 한글·'소유자'·AdSense, robots.txt 주석 줄에 한글.
  //   주입 마커(<!-- HOME_SUMMARY:START --> 등)·영문 일반 주석은 허용. 배포본에서는 inject-nav 가 지운다(withoutMemoComments).
  {
    const push = capped("PM1", 10), MEMO = /[ㄱ-ㆎ가-힣]|소유자|adsense|애드센스/i;
    for (const f of PUBLIC_HTML) {
      const outside = read(f).split(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/i).join(" ");
      for (const m of outside.matchAll(/<!--([\s\S]*?)-->/g)) if (MEMO.test(m[1])) { push(`${f} 주석 "${m[1].replace(/\s+/g, " ").trim().slice(0, 50)}…" — 작업 메모는 배포본에 두지 않는다`); break; }
    }
    if (exists("robots.txt")) for (const line of read("robots.txt").split(/\r?\n/)) if (/^\s*#/.test(line) && /[ㄱ-ㆎ가-힣]|소유자/.test(line)) { push(`robots.txt 주석 "${line.slice(0, 50)}" — 영문 라벨로(지시문은 그대로)`); break; }
    push.flush();
  }
  // S1 · S4 · VN1
  for (const f of [...PUBLIC_HTML, "packs.js", "data/onepiece-packs.json", "data/card-series.json", "opbox-ai-data.json", "llms.txt", "feed.xml"].filter(exists)) if (/collectr/i.test(read(f))) errors.push(`S1: ${f} 에 외부 소스명 노출 (Weekly ungraded market 라벨 사용)`);
  const VENDOR = /tcgplayer|yuyu-?tei|遊々亭|pricecharting|cardmarket|cardrush|カードラッシュ|snkrdunk|\bgemrate\b|collectr|tcg quant/i;
  ban("S4", [...PUBLIC_HTML.filter((x) => /^(?:sets|cards|ko|ja)\//.test(x)), "llms.txt", "llms-full.txt"].filter(exists), [VENDOR], (h) => h.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, " "), " — 중립 라벨(TCG · Weekly ungraded market)");
  ban("VN1", [...DATA_PAGES, ...upFiles].filter(exists), [VENDOR], (h) => visible(h).replace(/<head>[\s\S]*?<\/head>/i, " "), " — 중립 라벨(JP retail · TCG market · PSA)");
  if (/TCGplayer|Yuyu-tei|遊々亭|PriceCharting|Cardmarket|Cardrush|カードラッシュ|SNKRDUNK|GemRate|Collectr|TCG Quant|유유테이|카드러시/.test(packsJs.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1"))) errors.push("VN1: packs.js 화면 문자열에 외부 시세 업체명");
  // D18 — n 은 창 전체 건수, "—" 는 '28일 안에 날짜가 찍힌 중앙값 없음', 값의 날짜는 중앙값 점의 날짜
  ban("D18", [...PUBLIC_HTML, "llms.txt", "llms-full.txt"].filter(exists), [/\bn \(week\)/i, /n = sales that week/i, /no completed sale in the last 28 days|sale in the last 28 days|sold in the last 28 days/i, /last-sale date, sample size/i, /그 주 거래 수/], (h) => h, " — 라벨이 실제 규칙과 다르다");
  if (exists("box-prices.html")) {
    const h = read("box-prices.html"), heads = (re) => { const t = h.match(re); return t ? [...t[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1])) : null; };
    const cheap = heads(/<table class="homeSummaryTable[^"]*" data-cheapest>[\s\S]*?<\/thead>/), all = heads(/<table class="homeSummaryTable[^"]*" data-all-sets>[\s\S]*?<\/thead>/);
    if (cheap && (cheap[2] !== "As of" || !/^n \/ window$/.test(cheap[3] || ""))) errors.push(`D18: box-prices 최저가 표 머리 ${JSON.stringify(cheap)} — "As of"·"n / window"`);
    if (all && all[3] !== "As of n / window") errors.push(`D18: box-prices 전체 표 날짜 칸 머리 "${all[3]}" — "As of n / window"`);
  }
  // DF1/DF2/DF3/NP1/CX1 — 지운 해설·사유·방어 문장의 꼬리표
  ban("DF1", PUBLIC_HTML.filter((p) => /^(?:ko|sets|cards)\//.test(p)), [/표시하지 않습니다/, /포함하지 않습니다/, /대비가 아닙니다/, /재판이라 부르지 않/, /has no completed eBay sales median/, /No dated Japanese near-mint price is shown/, /does not call these reprints/, /we do not either/], (h) => h, " — 값이 없으면 문장 대신 문답을 빼거나 \"—\"");
  ban("DF2", [...setPages, "sets/index.html", "psa10-ranking.html"].filter(exists), [/This ratio does not explain why/, /not a forecast/, /not opening (?:expected value|EV)/, /Past peaks do not set future floors/, /highly concentrated/, /Official pull rates are unpublished/, /Grades are not a box-opening count/, /running near its peak|cooling off from its peak/, /entered our tracking/, /The chase in \S+ is led by/, /Fewer days means/, /More means demand/, /rides on one pull/, /without hitting the big one/, /does not explain it/, /thin weeks borrow/, /never averaged together/, /always confirm on eBay/, /Are these asking prices\?/, /Why Japanese cards only\?/], (h) => h, " — 숫자·표·라벨만");
  ban("DF3", PUBLIC_HTML.filter((p) => p.startsWith("ko/")), [/우리가 종료 후 다시 조회/, /호가가 아니라 실제 낙찰 결과/, /판매처와 밀봉 상태에 따라/, /합산하지 않고 각 표본을 따로/, /일본판과 합산하지 않습니다/, /매수세가 가격을 끌어올리고/, /가치를 끌고 가는 카드/, /박스 기대값의 골격/, /시장 읽는 법/, /시세를 움직이는 힘/, /추정치가 아니라/, /추정치로 채우지 않습니다/, /자체 수집 데이터로/, /판단의 책임은 본인에게/, /반다이 공식 발표가 아닌 유통 기록/, /세트별 공식 발표가 아니라/, /카드 자체로 구분되지 않습니다/, /비율은 싣지 않습니다/, /경매만 집계합니다/, /세트 코드를 누르면/, /세트 이름을 누르면/, /상품 페이지가 기준입니다/, /그레이딩 데이터 읽는 법/, /인기 카드가 말해주는 것/, /약 —/, /발매 시점|발매 초기 대비/], (h) => h, " — 숫자·표·라벨만(2026-10-15 소유자 결정)");
  ban("NP1", [...[...DATA_PAGES, ...upFiles].filter(exists).map((f) => f), "packs.js"], [/we collect ourselves|collected by us/i, /The table above lists/, /They move set by set/, /worth buying sealed\?/, /New sets (?:are reflected|appear) (?:as soon as|once) price data is ready/, /Static guides with each set/, /Use OP Box Index to research/, /measure submission activity/, /not a same-item price index/, /same figure as the home page/, /dropping them would flatter/, /cheap listings sell fast/, /wait signal|대기 신호/, /Across the full set, <b>/, /Neither equals a PSA 10/, /about 3% of all TAG grades/, /Buyers must verify seller/, /Treat them conservatively/, /Retailer listings are not treated as official/, /not counted in sold-price tables/, /Same filters as the <a/, /Prices are references, not offers/, /<h2[^>]*>(?:How it's built|Update frequency)<\/h2>/, /Undervalued|Overvaluation|Investment appeal|저평가|고평가/], (h, f) => (f === "packs.js" ? h.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1") : visible(h)), " — 데이터 페이지는 숫자·표·라벨만");
  ban("CX1", PUBLIC_HTML.filter((p) => /^cards\/[^/]+\.html$/.test(p) || /^(?:sets|ko)\/[^/]+-card-list\.html$/.test(p)), [/which helps explain|materially smaller than|missing cells remain unestimated|A current premium is not computed|not a guaranteed grading return|no measurable slab premium|carries a narrow|No PSA 10 figure is shown|Fallback estimate|never summed|intervals are uneven|each read again after it closed|can be a different kind of card|Same figures as the|printing does this page track|no PSA 10 figure met|cross-set heavy hitters|where we have both prices|prints are never combined|Numbers appear only where|are not reproduced|Leaders show Life|두 판을 합치지 않음|규칙으로 맞을 때만 숫자를|싣지 않습니다|리더는 코스트 칸에/], shownText, " — 카드·카드리스트 페이지는 숫자·표·라벨만");
  // NC1 — 수기 해설 복귀 금지(set-commentary·priority-set-seo 해설 칸·setStory·hubTail)
  for (const f of ["tools/generate-set-pages.js", "tools/generate-english-set-pages.js", "tools/set-page-shared.js"]) if (exists(f) && /set-commentary\.json/.test(read(f).replace(/^\s*\/\/.*$/gm, ""))) errors.push(`NC1: ${f} 가 set-commentary.json 을 읽는다 — 세트 페이지에 수기 해설을 싣지 않는다`);
  for (const [code, v] of Object.entries(json("data/priority-set-seo.json", { sets: {} }).sets || {})) { const extra = Object.keys(v || {}).filter((k) => k !== "title"); if (extra.length) errors.push(`NC1: priority-set-seo.json ${code} 에 해설 칸 ${extra.join("·")} — title 만 둔다`); }
  ban("NC1", [...setPages, "sets/index.html"].filter(exists), [/<section class="setStory"/, /<section class="searchIntent"/, /<details class="setMore"/, /Set notes —/, /stand out from other One Piece sets\?/, /class="hubTail"/], (h) => h, " — 수기 해설 흔적");
  // UP2/UP3 — 발매 전 페이지: 펼쳐진 산문 <p>·해설 <section> 금지, 해설 필드 금지, 문답은 데이터 사실만
  const UP = json("data/upcoming-set-pages.json", { pages: [] }).pages || [];
  const stripDetails = (h) => { let out = "", depth = 0, i = 0; for (const m of h.matchAll(/<details\b[^>]*>|<\/details>/g)) { if (depth === 0) out += h.slice(i, m.index); depth += m[0][1] === "/" ? -1 : 1; i = m.index + m[0].length; } return out + (depth === 0 ? h.slice(i) : ""); };
  for (const p of UP) {
    const f = `sets/${p.slug}.html`;
    for (const k of ["introHtml", "sections", "description"]) if (p[k] != null) errors.push(`UP2: upcoming-set-pages ${p.slug} 에 해설 필드 "${k}" — 쓰지 않는다`);
    for (const [q, a] of p.faq || []) { if (/\bseal\b|predict|pre-order .*now\?|worth/i.test(q)) errors.push(`UP3: ${p.slug} 문답 "${q}" — 조언·예측·절차 문항은 넣지 않는다`); if (/\b(?:should|cannot establish|substitute|is free)\b/i.test(a)) errors.push(`UP3: ${p.slug} 문답 "${q}" 의 답이 조언·해석 문장이다`); }
    if (!exists(f)) continue;
    const html = read(f), main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/) || [])[1] || "", open = stripDetails(main);
    for (const m of open.matchAll(/<p(?:\s+class="([^"]*)")?[^>]*>([\s\S]{0,80})/g)) { if (/^(?:eyebrow|articleMeta|sourceNoteA|revCount|affTop|relBuy)$/.test(m[1] || "")) continue; errors.push(`UP2: ${f} 펼쳐진 산문 <p${m[1] ? ` class="${m[1]}"` : ""}> "${strip(m[2]).slice(0, 60)}…"`); break; }
    for (const m of open.matchAll(/<section(?:\s+class="([^"]*)")?[^>]*>\s*(?:<h2[^>]*>([^<]*))?/g)) if (!/^(?:relBox|setFaq)$/.test(m[1] || "")) errors.push(`UP2: ${f} 펼쳐진 해설 섹션 "${m[2] || m[1] || "?"}"`);
    if (/<details class="setMore"/.test(main)) errors.push(`UP2: ${f} 에 접은 해설(details.setMore)이 남아 있다`);
    if (/\bNot listed\b/i.test(html)) errors.push(`UP1: ${f} 에 "Not listed" 가 남아 있다 — 공식 값이 있으면 값을, 없으면 "Not stated … (checked 날짜)"`);
  }
  // E1 · EP1 — 제휴 고지(위치·크기·대비·원문)와 면책 한 줄
  const CAMPID = "5339163744", TOP_EN = "Paid Link: As an eBay Partner Network affiliate, we earn from qualifying purchases.", TOP_KO = "Paid Link: eBay 파트너 네트워크(EPN) 제휴사로서 eBay 링크를 통한 적격 구매가 발생하면 OP Box Index가 수수료를 받습니다.";
  const NOTE = /As an eBay Partner,? we may earn a commission from qualifying purchases (?:made )?through eBay links(?: on this (?:page|site))?(?: —|,) at no extra cost to you\./;
  const DATA = (p) => DATA_PAGES.includes(p) || /^sets\/[^/]+\.html$/.test(p) || /^cards\/[^/]+\.html$/.test(p) || /^ko\/[^/]+\.html$/.test(p) || p === "psa10-ranking.html";
  const injected = packsJs.includes(CAMPID);
  let checked = 0;
  for (const f of PUBLIC_HTML) {
    const html = read(f), baked = html.includes(CAMPID);
    if (baked || (injected && html.includes("packs.js"))) {
      const iNote = html.indexOf('class="affTop"');
      if (iNote < 0) errors.push(`E1: ${f} 에 제휴 링크가 있는데 상단 고지(.affTop)가 없다 — EPN I.G. 위반`);
      else if (baked && iNote > html.indexOf(CAMPID)) errors.push(`E1: ${f} 의 고지가 첫 제휴 링크보다 뒤에 있다 — 접힘선 위로`);
    }
    const t = visible(html.replace(/<head[\s\S]*?<\/head>/, " ")).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    if (baked && !t.includes(f.startsWith("ko/") ? TOP_KO : TOP_EN)) errors.push(`EP1: ${f} 상단 고지 원문이 없다 — 문구를 바꾸거나 줄이지 않는다`);
    const notes = [...html.matchAll(/<p class="affNote">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1]));
    for (const nt of notes) if (/eBay/.test(nt) && !NOTE.test(nt)) errors.push(`EP1: ${f} 하단 제휴 고지(affNote) EPN 문장이 바뀌었다: "${nt.slice(0, 70)}…"`);
    if (baked && (setPages.includes(f) || cards.includes(f)) && !notes.some((nt) => NOTE.test(nt))) errors.push(`EP1: ${f} 하단 affNote 에 EPN 문장이 없다`);
    if (!DATA(f)) continue;
    checked++;
    const re = f.startsWith("ko/") ? /투자 권유가 아닌/g : /not investment advice/gi, n = (t.match(re) || []).length;
    const inFoot = new RegExp(re.source, "i").test((html.match(/<footer[\s\S]*?<\/footer>/) || [""])[0].replace(/<[^>]+>/g, " "));
    if (cards.includes(f) ? n > 1 || (n === 1 && !inFoot) : n !== 1 || !inFoot) errors.push(`EP1: ${f} 면책 "${re.source}" ${n}회${n && !inFoot ? "(푸터 밖)" : ""} — 푸터 한 줄만`);
  }
  if (!checked) errors.push("EP1: 데이터 페이지를 0장 읽었다");
  for (const s of ["Paid Link: we may earn a commission from qualifying purchases made through eBay links.", "Paid Link: As an eBay Partner, OP Box Index may earn a commission from qualifying purchases made through eBay links, at no extra cost to you.", "Paid Link: eBay 링크를 통해 적격 구매가 발생하면 OP Box Index가 수수료를 받을 수 있습니다."]) if (!packsJs.includes(s)) errors.push(`EP1: packs.js 에서 제휴 고지 문장이 바뀌었다: "${s.slice(0, 50)}…"`);
  const css = read("styles.css"), rule = (css.match(/\.affTop\s*\{[^}]*\}/) || [])[0] || "";
  if (!rule) errors.push("E1: styles.css 에 .affTop 규칙이 없다");
  else {
    const size = parseFloat((rule.match(/font-size:\s*([\d.]+)px/) || [])[1] || "0"), op = (rule.match(/opacity:\s*([\d.]+)/) || [])[1];
    if (size < 12.5) errors.push(`E1: .affTop font-size ${size}px — 12.5px 미만이면 "눈에 띄지 않는다"는 지적으로 되돌아간다`);
    if (op && parseFloat(op) < 1) errors.push(`E1: .affTop opacity ${op} — 고지를 흐리게 하면 안 된다`);
    const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
    const lum = (rgb) => rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const varOf = (name) => (css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i")) || [])[1];
    let fg = (rule.match(/color:\s*(#[0-9a-f]{6})/i) || [])[1]; if (!fg) { const v = (rule.match(/color:\s*var\((--[\w-]+)\)/) || [])[1]; if (v) fg = varOf(v); }
    const bg = varOf("--bg");
    if (fg && bg) { const [a, b] = [lum(hex(fg)), lum(hex(bg))].sort((x, y) => y - x); if ((a + 0.05) / (b + 0.05) < 4.5) errors.push(`E1: .affTop 대비 ${((a + 0.05) / (b + 0.05)).toFixed(1)}:1 — 4.5:1 미만이면 고지를 숨긴 것으로 본다`); }
  }
  // AN1 · EQ1 · EL1
  ban("AN1", PUBLIC_HTML, [/\b[Aa] \$?(?:8[\d,]*|11|18)(?:\.\d+)?(?:%|-[a-z]|x\b| percent\b)/], (h) => h, ' — "an"');
  ban("EQ1", PUBLIC_HTML.filter((p) => /^(?:sets|ko)\//.test(p)), [/\((\$[\d,]+) vs peak \1[,)]|\b0% under its tracked peak|(?:저점|고점) 대비 [+-]?0\.0%/], (h) => h, " — 두 쪽이 같은 값이면 비교 절을 뺀다");
  ban("EL1", PUBLIC_HTML, [/<a\b[^>]*>\s*<\/a>/], (h) => h, " — 글자 없는 링크");
  // R2(문구) — 재입고 줄 단서, 옛 문구, 방법 설명 문장(페이지·packs.js)
  for (const f of PUBLIC_HTML.filter((p) => /^sets\/(op|eb|prb)-\d+\.html$/.test(p))) {
    const html = read(f), m = html.match(/Retailer-reported restocks:[\s\S]{0,400}?<\/li>/);
    if (m && !/not a Bandai reprint announcement/.test(m[0])) errors.push(`R2: ${f} 매장 재입고 줄에 "공식 발표가 아님" 단서가 빠졌다`);
    if (/Retailer\/distributor reprint records/.test(html)) errors.push(`R2: ${f} 옛 문구(Retailer/distributor reprint records)가 남아 있다`);
    if (/does not call these reprints|we do not either/.test(html)) errors.push(`R2: ${f} 에 방법 설명 문장이 남아 있다 — 줄은 라벨·날짜만`);
  }
  if (/does not call these reprints|'재판'이라 부르지 않습니다/.test(packsJs)) errors.push("R2: packs.js 배지 툴팁에 방법 설명 문장이 남아 있다");
  // KO1/KO2/KO3(문구) — 문답 사유·방어 문장 금지, 보이는 FAQ = 구조화데이터(답까지), 재판 분류 설명 꼬리, 경매 문장형 금액·내부 키·null%
  const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  for (const f of [...koSet, "ko/index.html"].filter(exists)) {
    const html = read(f), faq = (ldOf(html).find((j) => j["@type"] === "FAQPage") || {}).mainEntity || [];
    for (const q of faq) {
      const a = String((q.acceptedAnswer || {}).text || "");
      if (/표시하지 않습니다|대비가 아닙니다|포함하지 않습니다/.test(a)) errors.push(`KO1: ${f} 문답 "${q.name}" 에 사유·방어 문장 "${a.slice(0, 40)}"`);
      if (f !== "ko/index.html" && !html.includes(`<p>${escH(a)}</p>`)) errors.push(`KO1: ${f} FAQPage 답 "${q.name}" 이 본문 FAQ 와 다르다`);
    }
    if (/재판이라 부르지 않|재판 횟수에 포함하지 않|재판으로 세지 않고/.test(html)) errors.push(`KO2: ${f} 에 재판 분류를 설명하는 문장이 남아 있다 — 라벨("— 재판 아님")만`);
    if (f === "ko/index.html") { const a = String(((faq.find((q) => /변동률은 발매일 대비/.test(q.name)) || {}).acceptedAnswer || {}).text || ""); if (!a || /1월 대비|발매 시점/.test(a) || !/28일 전 중앙값/.test(a)) errors.push(`KO1: ko/index.html 변동률 문답 "${a.slice(0, 60)}" — 범례와 같은 정의(28일 전 중앙값 대비)여야 한다`); if (/1월 대비 변동률/.test(html)) errors.push("KO1: ko/index.html 에 \"1월 대비 변동률\"(옛 정의)이 남아 있다"); continue; }
    const sec = (html.match(/<section aria-label="경매 실적">[\s\S]*?<\/section>/) || [])[0];
    if (sec) {
      if (/거래액은 |중앙 낙찰가는 /.test(sec)) errors.push(`KO3: ${f} 경매 절에 문장형 금액("거래액은 …") — 라벨 줄로`);
      if (/null%/.test(sec)) errors.push(`KO3: ${f} 경매 표에 "null%" — 값이 없으면 "—"`);
      for (const m of sec.matchAll(/<td class="l">([^<]*)<\/td>/g)) if (/^[a-z_-]+$/.test(m[1])) errors.push(`KO3: ${f} 경매 유형 칸에 내부 키 "${m[1]}" — 한국어 라벨(catKo)에 추가할 것`);
    }
    const lst = (html.match(/재판이 \d+회<\/strong> 확인됐습니다\(([^)]*)\)/) || [])[1];
    if (lst && /추첨/.test(lst)) errors.push(`KO2: ${f} 재판 목록 "(${lst})" 에 추첨판매가 섞였다`);
  }
  // SP1 · FQ1
  for (const f of cards) { const h = read(f); if ((h.match(/<span>Japanese NM \(raw\)<\/span><b>([^<]*)<\/b>/) || [])[1] !== "—") continue; const m = shownText(h).match(/raw-to-slab spread|slab premium|raw (?:NM )?reference/); if (m) errors.push(`SP1: ${f} NM 칸이 "—" 인데 "${m[0]}" 문장이 있다`); }
  for (const f of setPages) for (const q of ((ldOf(read(f)).find((j) => j["@type"] === "FAQPage") || {}).mainEntity || [])) {
    const ed = (String(q.name).match(/ (Japanese|English) booster box\?$/) || [])[1], a = String((q.acceptedAnswer || {}).text || "");
    if (/^How much is a sealed /.test(q.name) && ed && !new RegExp(`^As of \\d{4}-\\d{2}-\\d{2}, completed eBay sales ${ed === "Japanese" ? "of the Japanese " : ""}`).test(a)) errors.push(`FQ1: ${f} "${q.name}" 의 답이 그 판 판매 중앙값이 아니다: "${a.slice(0, 90)}…" — 값이 없으면 문답을 뺀다`);
  }
  // CL1(문구) — 카드리스트 페이지·CSV·JSON: 이미지·공식 이미지 주소·효과 텍스트 0, 빈 파워 "-" 금지
  const EFFECT = /【(?:登場時|起動メイン|アタック時|ブロッカー|カウンター|トリガー|自分のターン中|相手のターン中|KO時|ドン!!×\d)】|\[(?:On Play|Activate: ?Main|When Attacking|Blocker|Trigger|Counter|Your Turn|Opponent's Turn|On K\.O\.|DON!! x\d|Rush|Double Attack|Banish)\]/;
  for (const c of F.cardLists) for (const f of [`sets/${c.slug}-card-list.html`, `ko/${c.slug}-card-list.html`, `sets/${c.slug}-card-list.csv`, `sets/${c.slug}-card-list.json`].filter(exists)) {
    const t = read(f);
    if (/\.html$/.test(f) && (/<img\b/i.test(t) || /onepiece-cardgame\.com\/images/i.test(t))) errors.push(`CL1: ${f} 에 이미지 — 카드 이미지는 쓰지 않는다`);
    if (EFFECT.test(t)) errors.push(`CL1: ${f} 에 효과 텍스트 표식(${(t.match(EFFECT) || [])[0]})`);
    if (/\.html$/.test(f) && /Power -(?:<| ·)/.test(t)) errors.push(`CL1: ${f} 빈 파워가 "-" 로 나간다 — 값이 없으면 "—" 또는 생략`);
  }
}

module.exports = { checks, run };
