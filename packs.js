const state = {
  data: null,
  lang: "jp",
  selected: null,
  view: "hits", // "hits" | "psa"
};

const rarityColor = {
  L: "#7db7ff",
  SEC: "#ff6683",
  SR: "#10d7a0",
  R: "#f3c74f",
  P: "#bb86fc",
  UC: "#9aa3b2",
  C: "#9aa3b2",
};

// PSA(GemRate) rarity → 짧은 배지 코드 + 색
const psaRarity = {
  "Special Alternate Art": { s: "SAA", c: "#bb86fc" },
  "Manga Alternate Art": { s: "MAA", c: "#ff8a3d" },
  "Alternate Art": { s: "AA", c: "#7db7ff" },
  "Treasure Rare": { s: "TR", c: "#f3c74f" },
  "Secret Rare": { s: "SEC", c: "#ff6683" },
  SEC: { s: "SEC", c: "#ff6683" },
  Leader: { s: "L", c: "#7db7ff" },
  "Pre-Release": { s: "PR", c: "#9aa3b2" },
  Base: { s: "C", c: "#9aa3b2" },
};
const rb = (r) => psaRarity[r] || { s: (r || "").slice(0, 3).toUpperCase(), c: "#9aa3b2" };
const num = (n) => (n == null ? "-" : new Intl.NumberFormat("ko-KR").format(n));

const fmtKrw = (v) =>
  new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.round(v));

const fmtUsd = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v);

const fmtJpy = (v) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v);

function fmtOriginalCurrency(value, currency) {
  if (value == null) return "-";
  if (currency === "JPY") return fmtJpy(value);
  if (currency === "USD") return fmtUsd(value);
  return `${currency || ""} ${num(value)}`.trim();
}

function marketKrw(value, currency) {
  const fx = (state.data && state.data.fx) || {};
  if (value == null) return null;
  if (currency === "JPY") return value * (fx.jpyKrw || 9.1);
  if (currency === "USD") return value * (fx.usdKrw || 1388.2);
  return null;
}

function priceLines(c) {
  const fx = (state.data && state.data.fx) || {};
  let h = "";
  if (c.priceUsd != null) {
    h += `<span class="pl base"><i>기준가</i> <b>${fmtKrw(c.priceUsd * (fx.usdKrw || 1388.2))}</b> <small>${fmtUsd(c.priceUsd)} · TCG Quant</small></span>`;
  }
  if (c.nmJpy != null) {
    const nmVenue = c.nmVenue || "遊々亭";
    h += `<span class="pl"><i>NM</i> <b>${fmtKrw(c.nmJpy * (fx.jpyKrw || 9.1))}</b> <small>${fmtJpy(c.nmJpy)} · ${nmVenue}</small></span>`;
  }
  if (c.psa10Usd != null) {
    const d = c.psa10Date ? c.psa10Date.slice(2).replace(/-/g, ".") : "";
    h += `<span class="pl psa"><i>PSA10</i> <b>${fmtKrw(c.psa10Usd * (fx.usdKrw || 1388.2))}</b> <small>${fmtUsd(c.psa10Usd)}${d ? " · " + d : ""}</small></span>`;
  }
  return h ? `<div class="priceLines">${h}</div>` : "";
}

const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='110'><rect width='100%' height='100%' rx='8' fill='%231a1e28'/><text x='50%' y='52%' fill='%23566' font-size='11' text-anchor='middle' font-family='sans-serif'>이미지</text></svg>",
  );

const DATA_URLS = [
  "data/onepiece-packs.json",
  "https://gsa-svg.github.io/k-tcg-quant/data/onepiece-packs.json",
];

function ebayQueryFor(pack) {
  const language = state.lang === "kr" ? "Korean" : "Japanese";
  const parts = ["One Piece Card Game", pack.code, pack.nameEn, "Booster Box", language, "sealed"];
  return parts.filter(Boolean).join(" ");
}

function ebayLinks(pack) {
  const q = encodeURIComponent(ebayQueryFor(pack));
  const base = `https://www.ebay.com/sch/i.html?_nkw=${q}`;
  return `
    <div class="marketLinks" aria-label="eBay market links">
      <a href="${base}&LH_Sold=1&LH_Complete=1&_sop=13" target="_blank" rel="noopener noreferrer">eBay Sold</a>
      <a href="${base}&LH_BIN=1&_sop=15" target="_blank" rel="noopener noreferrer">eBay Active</a>
    </div>`;
}

function renderBoxMarket(set) {
  const market = set.boxMarket?.jp?.ebayActive;
  if (!market) {
    return `
      <div class="boxMarket empty">
        <span class="bmLabel">일본판 박스 eBay</span>
        <strong>가격 수집 대기</strong>
        <small>Active 매물 기준 · 중국/홍콩/마카오 발송지 제외 예정</small>
      </div>`;
  }

  const rows = [
    ["High", market.high],
    ["Middle", market.middle],
    ["Low", market.low],
  ];

  return `
    <div class="boxMarket">
      <div class="bmHead">
        <span class="bmLabel">일본판 박스 eBay Active</span>
        <small>${market.updated || "업데이트일 미상"} · 표본 ${market.sampleSize || 0}건${
          market.excludedCount ? ` · 제외 ${market.excludedCount}건` : ""
        }</small>
      </div>
      <div class="bmRows">
        ${rows
          .map(([label, value]) => {
            const krwValue = marketKrw(value, market.currency);
            return `
              <span class="bmRow">
                <i>${label}</i>
                <b>${krwValue == null ? "-" : fmtKrw(krwValue)}</b>
                <small>${fmtOriginalCurrency(value, market.currency)}</small>
              </span>`;
          })
          .join("")}
      </div>
      <p>정렬 후 하위/중앙/상위 가격대. 재밀봉 리스크를 줄이기 위해 중국권 발송지는 제외합니다.</p>
    </div>`;
}

async function fetchPackData() {
  let lastError;

  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

async function load() {
  try {
    state.data = await fetchPackData();
  } catch (err) {
    document.querySelector("#packList").innerHTML =
      `<p class="note">데이터를 불러오지 못했습니다. (${err.message}) 잠시 후 다시 시도해주세요.</p>`;
    return;
  }
  bindLangTabs();
  selectFirstOfLang();
  renderStats();
  renderPackGrid();
  renderDetail();
}

// returns normalized pack list for current language:
// [{key, code, nameKo, nameEn, set}]  (set = the underlying sets[baseCode] record)
function currentPacks() {
  const d = state.data;
  if (state.lang === "kr") {
    return d.kr.list.map((it) => {
      const set = d.sets[it.base] || {};
      const pendingSet = { ...set, cards: [], psa: [], boxMarket: null };
      return { key: it.opk, code: it.opk, nameKo: it.nameKo, nameEn: set.nameEn || "", set: pendingSet };
    });
  }
  const list = state.lang === "extra" ? d.extra.list : d.jp.list;
  return list.map((code) => {
    const set = d.sets[code] || {};
    return { key: code, code, nameKo: set.nameKo || code, nameEn: set.nameEn || "", set };
  });
}

function selectFirstOfLang() {
  const packs = currentPacks();
  const ready = packs.find((p) => (p.set.cards || []).length > 0);
  state.selected = (ready || packs[0]).key;
}

function renderStats() {
  const d = state.data;
  const readyCount = (codes) => codes.filter((c) => (d.sets[c]?.cards || []).length > 0).length;
  const jpReady = readyCount(d.jp.list);
  const extraReady = readyCount(d.extra.list);
  document.querySelector("#statJp").textContent = `${jpReady}/${d.jp.list.length}`;
  document.querySelector("#statExtra").textContent = `${extraReady}/${d.extra.list.length}`;
  document.querySelector("#statKr").textContent = `준비중`;
}

function bindLangTabs() {
  document.querySelectorAll(".langTab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === state.lang);
    btn.onclick = () => {
      state.lang = btn.dataset.lang;
      document.querySelectorAll(".langTab").forEach((b) => b.classList.toggle("active", b === btn));
      selectFirstOfLang();
      renderPackGrid();
      renderDetail();
    };
  });
}

function renderPackGrid() {
  const wrap = document.querySelector("#packList");
  const packs = currentPacks();
  wrap.innerHTML = packs
    .map((p) => {
      const has = (p.set.cards || []).length > 0;
      const active = p.key === state.selected ? " active" : "";
      const box = p.set.box || FALLBACK;
      return `
        <button class="packChip${active}${has ? "" : " pending"}" data-key="${p.key}" ${has ? "" : "disabled"}>
          <img class="packBox" src="${box}" alt="${p.code} 박스" loading="lazy" onerror="this.src='${FALLBACK}'" />
          <span class="packMeta">
            <span class="packCode">${p.code}</span>
            <span class="packName">${p.nameKo}</span>
            <span class="packEn">${p.nameEn}</span>
            <span class="packTag${has ? " ready" : ""}">${has ? "TOP 10" : "준비중"}</span>
          </span>
        </button>`;
    })
    .join("");

  wrap.querySelectorAll(".packChip:not(.pending)").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selected = btn.dataset.key;
      renderPackGrid();
      renderDetail();
      document.querySelector("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderHitList(cards) {
  const cells = cards
    .map((c) => {
      const color = rarityColor[c.rarity] || "#8d95a7";
      const img = c.img || FALLBACK;
      return `
        <figure class="hitCard" data-img="${img}" data-name="${(c.name || "").replace(/"/g, "&quot;")}">
          <div class="hitThumb">
            <span class="hitRank">${c.rank}</span>
            ${c.rarity ? `<span class="hitRar" style="--c:${color}">${c.rarity}</span>` : ""}
            <img src="${img}" alt="${c.name}" onerror="this.src='${FALLBACK}'" />
          </div>
          <figcaption>
            <span class="hitName">${c.name}</span>
            <span class="hitNo">${c.number || ""}</span>
            ${priceLines(c)}
          </figcaption>
        </figure>`;
    })
    .join("");
  return `<div class="hitGallery">${cells}</div>`;
}

function openLightbox(src, name) {
  let lb = document.querySelector("#lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox";
    lb.innerHTML = `<div class="lbInner"><img id="lbImg" alt=""/><p id="lbCap"></p><button id="lbClose" aria-label="닫기">✕</button></div>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.id === "lbClose") lb.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") lb.classList.remove("open"); });
  }
  // 큰 이미지: TCGplayer CDN 400w → 1000x1000 시도
  const big = src.replace(/_(\d+)w\.jpg/, "_1000x1000.jpg");
  const imgEl = lb.querySelector("#lbImg");
  imgEl.onerror = () => { imgEl.onerror = null; imgEl.src = src; };
  imgEl.src = big;
  lb.querySelector("#lbCap").textContent = name || "";
  lb.classList.add("open");
}

function renderPsaTable(psa) {
  const rows = psa
    .map((c) => {
      const b = rb(c.rarity);
      const gem = c.gem == null ? "-" : `${c.gem}%`;
      const gemClass = c.gem >= 90 ? "gemHi" : c.gem >= 80 ? "gemMid" : "gemLo";
      return `
        <tr>
          <td class="pCard">
            <span class="pName">${c.name}</span>
            <span class="pNo">#${c.number}</span>
          </td>
          <td class="pRar"><span class="pBadge" style="--c:${b.c}">${b.s}</span></td>
          <td class="pNumv">${num(c.psa10)}</td>
          <td class="pNumv dim">${num(c.psa9)}</td>
          <td class="pNumv">${num(c.total)}</td>
          <td class="pNumv ${gemClass}">${gem}</td>
        </tr>`;
    })
    .join("");
  return `
    <div class="psaWrap">
      <table class="psaTable">
        <thead>
          <tr>
            <th class="pCard">카드</th>
            <th class="pRar">희박</th>
            <th>PSA 10</th>
            <th>PSA 9</th>
            <th>총계</th>
            <th>보석확률</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">PSA 등급 인구 데이터 (출처: GemRate / PSA 집계). 보석확률 = PSA10 비율.</p>
    </div>`;
}

function renderDetail() {
  const pack = currentPacks().find((p) => p.key === state.selected);
  const el = document.querySelector("#detail");
  if (!pack) return;
  const set = pack.set;
  const cards = set.cards || [];
  if (!cards.length) {
    el.innerHTML = `<p class="note">${pack.code} ${pack.nameKo} — 아직 카드 데이터가 준비되지 않았습니다(신규 세트).</p>`;
    return;
  }

  const hasPsa = (set.psa || []).length > 0;
  if (state.view === "psa" && !hasPsa) state.view = "hits";

  let body;
  if (state.view === "psa") {
    body = renderPsaTable(set.psa);
  } else {
    const nmSource = set.nmSource || "遊々亭(유유테이)";
    const psaSource = set.psaSource || "PSA APR";
    const srcNote = set.priced
      ? `<p class="srcNote">원화 환산가를 우선 표시합니다. NM 출처 · ${nmSource} &nbsp;|&nbsp; PSA/물량 출처 · ${psaSource} &nbsp;|&nbsp; 환율 ¥${state.data.fx.jpyKrw}/$${state.data.fx.usdKrw}</p>`
      : `<p class="srcNote">JPY NM/PSA10 보강 데이터가 있는 세트부터 원화 환산가를 표시합니다. 일부 세트는 순차 적용 중입니다.</p>`;
    body = srcNote + renderHitList(cards);
  }

  el.innerHTML = `
    <div class="detailHead">
      <img class="detailBox" src="${set.box || FALLBACK}" alt="${pack.code} 박스" onerror="this.src='${FALLBACK}'" />
      <div class="detailInfo">
        <p class="eyebrow">${pack.code} · Booster Box</p>
        <h2>${pack.nameKo} <small>${pack.nameEn}</small></h2>
        <div class="viewTabs">
          <button class="viewTab ${state.view === "hits" ? "active" : ""}" data-view="hits">시세 TOP 10</button>
          <button class="viewTab ${state.view === "psa" ? "active" : ""}" data-view="psa" ${hasPsa ? "" : "disabled"}>
            PSA 통계
          </button>
        </div>
        ${ebayLinks(pack)}
        ${state.lang !== "kr" ? renderBoxMarket(set) : ""}
        ${hasPsa && state.view === "psa" ? `<p class="note">세트 평균 보석확률 ${set.psaGem ?? "-"}% · 누적 ${num(set.psaTotal)}장</p>` : ""}
      </div>
    </div>
    ${body}
  `;

  el.querySelectorAll(".viewTab:not([disabled])").forEach((b) =>
    b.addEventListener("click", () => { state.view = b.dataset.view; renderDetail(); }),
  );
  el.querySelectorAll(".hitCard").forEach((f) =>
    f.addEventListener("click", () => openLightbox(f.dataset.img, f.dataset.name)),
  );
}

load();
