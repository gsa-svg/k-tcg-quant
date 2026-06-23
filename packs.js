const state = {
  data: null,
  lang: "jp",
  selected: null,
  showPrice: false,
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

const krw = (usd) =>
  usd == null
    ? "-"
    : new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(
        Math.round(usd * (state.data?.fx?.usdKrw || 1388.2)),
      );

const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='110'><rect width='100%' height='100%' rx='8' fill='%231a1e28'/><text x='50%' y='52%' fill='%23566' font-size='11' text-anchor='middle' font-family='sans-serif'>이미지</text></svg>",
  );

async function load() {
  try {
    const res = await fetch("data/onepiece-packs.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    document.querySelector("#packList").innerHTML =
      `<p class="note">데이터를 불러오지 못했습니다. (${err.message}) 웹서버에서 열어야 합니다.</p>`;
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
      return { key: it.opk, code: it.opk, nameKo: it.nameKo, nameEn: set.nameEn || "", set };
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
  const krReady = d.kr.list.filter((it) => (d.sets[it.base]?.cards || []).length > 0).length;
  document.querySelector("#statJp").textContent = `${jpReady}/${d.jp.list.length}`;
  document.querySelector("#statKr").textContent = `${krReady}/${d.kr.list.length}`;
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

  const rows = cards
    .map((c) => {
      const color = rarityColor[c.rarity] || "#8d95a7";
      return `
        <li class="hitRow">
          <span class="hitRank">${c.rank}</span>
          <img class="hitImg" src="${c.img || FALLBACK}" alt="${c.name}" loading="lazy" onerror="this.src='${FALLBACK}'" />
          <span class="hitMain">
            <span class="hitName">${c.name}</span>
            <span class="hitNo">${c.number || ""} ${c.rarity ? `· <b style="color:${color}">${c.rarity}</b>` : ""}</span>
          </span>
          ${state.showPrice ? `<span class="hitPrice">${krw(c.priceUsd)}</span>` : ""}
        </li>`;
    })
    .join("");

  el.innerHTML = `
    <div class="detailHead">
      <img class="detailBox" src="${set.box || FALLBACK}" alt="${pack.code} 박스" onerror="this.src='${FALLBACK}'" />
      <div class="detailInfo">
        <p class="eyebrow">${pack.code} · Booster Box</p>
        <h2>${pack.nameKo} <small>${pack.nameEn}</small></h2>
        <p class="note">이 팩의 대표 히트카드 TOP 10 (시세 높은 순). 출처: TCG Quant · 이미지: TCGplayer.</p>
        <label class="priceToggle">
          <input type="checkbox" id="priceChk" ${state.showPrice ? "checked" : ""} />
          참고 시세(원화) 보기
        </label>
      </div>
    </div>
    <ol class="hitList">${rows}</ol>
  `;

  const chk = document.querySelector("#priceChk");
  if (chk) chk.addEventListener("change", () => { state.showPrice = chk.checked; renderDetail(); });
}

load();
