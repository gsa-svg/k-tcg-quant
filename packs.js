const state = {
  data: null,
  selected: null,
  showPrice: false,
};

const artClassColor = {
  manga: "#ff6683",
  alt: "#10d7a0",
  leader: "#7db7ff",
  event: "#f3c74f",
  promo: "#ff9345",
  full: "#bb86fc",
  special: "#5bd4ff",
};

const krw = (usd) =>
  usd == null
    ? "참고가 미정"
    : new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(
        Math.round(usd * 1388.2),
      );

async function load() {
  try {
    const res = await fetch("data/onepiece-packs.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    document.querySelector("#packList").innerHTML =
      `<p class="note">데이터를 불러오지 못했습니다. (${err.message}) 이 페이지는 웹서버에서 열어야 합니다.</p>`;
    return;
  }
  const ready = state.data.packs.filter((p) => p.status === "ready");
  state.selected = ready.length ? ready[0].code : state.data.packs[0].code;
  renderPackChips();
  renderDetail();
  renderStats();
}

function renderStats() {
  const packs = state.data.packs;
  const ready = packs.filter((p) => p.status === "ready");
  const cards = ready.reduce((n, p) => n + p.hits.length, 0);
  document.querySelector("#statPacks").textContent = packs.length;
  document.querySelector("#statReady").textContent = ready.length;
  document.querySelector("#statCards").textContent = cards;
}

function renderPackChips() {
  const wrap = document.querySelector("#packList");
  wrap.innerHTML = state.data.packs
    .map((p) => {
      const pending = p.status !== "ready";
      const active = p.code === state.selected ? " active" : "";
      return `
        <button class="packChip${active}${pending ? " pending" : ""}" data-code="${p.code}" ${pending ? "disabled" : ""}>
          <span class="packCode">${p.code}</span>
          <span class="packName">${p.nameKo}</span>
          <span class="packEn">${p.nameEn}</span>
          ${pending ? `<span class="packTag">수집 예정</span>` : `<span class="packTag ready">TOP 10</span>`}
        </button>`;
    })
    .join("");

  wrap.querySelectorAll(".packChip:not(.pending)").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selected = btn.dataset.code;
      renderPackChips();
      renderDetail();
      document.querySelector("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderDetail() {
  const pack = state.data.packs.find((p) => p.code === state.selected);
  const el = document.querySelector("#detail");
  if (!pack || pack.status !== "ready") {
    el.innerHTML = `<p class="note">아직 카드 데이터가 수집되지 않은 팩입니다.</p>`;
    return;
  }

  const rows = pack.hits
    .map((c) => {
      const color = artClassColor[c.artClass] || "#8d95a7";
      return `
        <li class="hitRow">
          <span class="hitRank">${c.rank}</span>
          <span class="hitArt" style="--c:${color}">${c.art}</span>
          <span class="hitMain">
            <span class="hitName">${c.name}</span>
            <span class="hitNo">${c.number}</span>
          </span>
          ${state.showPrice ? `<span class="hitPrice">${krw(c.priceUsd)}</span>` : ""}
        </li>`;
    })
    .join("");

  el.innerHTML = `
    <div class="detailHead">
      <div>
        <p class="eyebrow">${pack.code} · Booster Pack</p>
        <h2>${pack.nameKo} <small>${pack.nameEn}</small></h2>
        <p class="note">이 팩의 대표 히트카드 TOP 10 (희귀/체이스 기준). 시세는 추후 단계에서 연결됩니다.</p>
      </div>
      <label class="priceToggle">
        <input type="checkbox" id="priceChk" ${state.showPrice ? "checked" : ""} />
        참고 시세(원화) 보기
      </label>
    </div>
    <ol class="hitList">${rows}</ol>
  `;

  const chk = document.querySelector("#priceChk");
  if (chk) {
    chk.addEventListener("change", () => {
      state.showPrice = chk.checked;
      renderDetail();
    });
  }
}

load();
