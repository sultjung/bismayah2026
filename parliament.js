const mpState = {
  members: [],
  filtered: [],
  meta: {}
};

const mpEls = {
  search: document.querySelector("#mpSearchInput"),
  sect: document.querySelector("#mpSectFilter"),
  party: document.querySelector("#mpPartyFilter"),
  alliance: document.querySelector("#mpAllianceFilter"),
  reset: document.querySelector("#mpResetBtn"),
  tableWrap: document.querySelector("#mpTableWrap"),
  totalCount: document.querySelector("#mpTotalCount"),
  filteredCount: document.querySelector("#mpFilteredCount"),
  partyCount: document.querySelector("#mpPartyCount"),
  arrestedCount: document.querySelector("#mpArrestedCount"),
  resultBadge: document.querySelector("#mpResultBadge"),
  partyBars: document.querySelector("#partyBars"),
  sectBars: document.querySelector("#sectBars"),
  minorityNote: document.querySelector("#minorityNote"),
  sourceFile: document.querySelector("#mpSourceFile"),
  lastUpdated: document.querySelector("#mpLastUpdated")
};

async function loadMpData() {
  try {
    const res = await fetch(`./data/mps.json?v=${Date.now()}`);
    if (!res.ok) throw new Error("mps.json not found");
    const data = await res.json();

    mpState.members = Array.isArray(data.members) ? data.members : [];
    mpState.meta = data;

    hydrateMpFilters();
    applyMpFilters();
    renderMpSummary();

    mpEls.sourceFile.textContent = data.source_file || "-";
    mpEls.lastUpdated.textContent = data.last_updated ? formatDateTime(data.last_updated) : "-";
  } catch (err) {
    console.error(err);
    mpEls.tableWrap.innerHTML = `<p class="empty-table">국회의원 데이터를 불러오지 못했습니다. data/mps.json 파일을 확인하세요.</p>`;
  }
}

function hydrateMpFilters() {
  const sects = unique(mpState.members.map(m => m.sect_ko || m.sect_group).filter(Boolean));
  const parties = unique(mpState.members.map(m => m.party_en).filter(Boolean)).sort((a, b) => a.localeCompare(b));
  const alliances = unique(mpState.members.map(m => m.alliance_en || "Independent/None").filter(Boolean)).sort((a, b) => a.localeCompare(b));

  fillSelect(mpEls.sect, sects, "전체");
  fillSelect(mpEls.party, parties, "전체");
  fillSelect(mpEls.alliance, alliances, "전체");
}

function applyMpFilters() {
  const q = mpEls.search.value.trim().toLowerCase();
  const sect = mpEls.sect.value;
  const party = mpEls.party.value;
  const alliance = mpEls.alliance.value;

  let filtered = [...mpState.members];

  if (q) {
    filtered = filtered.filter(m => {
      const haystack = [
        m.no,
        m.name_en,
        m.name_ar,
        m.party_en,
        m.party_ar,
        m.coalition_en,
        m.coalition_ar,
        m.alliance_en,
        m.alliance_ar,
        m.category_raw,
        m.sect_ko,
        m.remarks
      ].join(" ").toLowerCase();

      return haystack.includes(q);
    });
  }

  if (sect !== "all") {
    filtered = filtered.filter(m => (m.sect_ko || m.sect_group) === sect);
  }

  if (party !== "all") {
    filtered = filtered.filter(m => m.party_en === party);
  }

  if (alliance !== "all") {
    filtered = filtered.filter(m => (m.alliance_en || "Independent/None") === alliance);
  }

  mpState.filtered = filtered;
  renderMpTable();
  renderMpStats();
}

function renderMpStats() {
  const partyCount = unique(mpState.members.map(m => m.party_en).filter(Boolean)).length;
  const arrested = mpState.members.filter(m => m.is_arrested).length;

  mpEls.totalCount.textContent = mpState.members.length.toLocaleString();
  mpEls.filteredCount.textContent = mpState.filtered.length.toLocaleString();
  mpEls.partyCount.textContent = partyCount.toLocaleString();
  mpEls.arrestedCount.textContent = arrested.toLocaleString();
  mpEls.resultBadge.textContent = `${mpState.filtered.length.toLocaleString()}명`;
}

function renderMpTable() {
  if (!mpState.filtered.length) {
    mpEls.tableWrap.innerHTML = `<p class="empty-table">조건에 맞는 의원이 없습니다.</p>`;
    return;
  }

  const rows = mpState.filtered.map(m => `
    <tr>
      <td>${escapeHtml(m.no)}</td>
      <td>
        <span class="member-name">${escapeHtml(m.name_en || "-")}</span>
        <span class="muted-line arabic-text">${escapeHtml(m.name_ar || "")}</span>
      </td>
      <td><span class="sect-pill sect-${escapeAttr(m.sect_group)}">${escapeHtml(m.sect_ko || m.sect_group || "-")}</span></td>
      <td>
        ${escapeHtml(m.party_en || "-")}
        <span class="muted-line arabic-text">${escapeHtml(m.party_ar || "")}</span>
      </td>
      <td>
        ${escapeHtml(m.coalition_en || "-")}
        <span class="muted-line arabic-text">${escapeHtml(m.coalition_ar || "")}</span>
      </td>
      <td>
        ${escapeHtml(m.alliance_en || "-")}
        <span class="muted-line arabic-text">${escapeHtml(m.alliance_ar || "")}</span>
      </td>
      <td>${m.is_arrested ? `<span class="arrest-pill">${escapeHtml(m.arrest_status)}</span>` : ""}</td>
      <td>${escapeHtml(m.remarks || "")}</td>
    </tr>
  `).join("");

  mpEls.tableWrap.innerHTML = `
    <table class="parliament-table">
      <thead>
        <tr>
          <th>No.</th>
          <th>의원명</th>
          <th>종파/구분</th>
          <th>정당</th>
          <th>Coalition</th>
          <th>Alliance</th>
          <th>체포</th>
          <th>비고</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMpSummary() {
  const parties = countBy(mpState.members, m => m.party_en || "Unknown")
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const topPartyMax = Math.max(...parties.map(x => x.count), 1);
  mpEls.partyBars.innerHTML = parties.map(x => barRow(x.name, x.count, topPartyMax)).join("");

  const sectWanted = [
    ["시아파", mpState.members.filter(m => m.sect_group === "Shia").length],
    ["순니파", mpState.members.filter(m => m.sect_group === "Sunni").length],
    ["쿠르드", mpState.members.filter(m => m.sect_group === "Kurd").length]
  ];
  const maxSect = Math.max(...sectWanted.map(x => x[1]), 1);
  mpEls.sectBars.innerHTML = sectWanted.map(([name, count]) => barRow(name, count, maxSect)).join("");

  const minority = mpState.members.filter(m => !["Shia", "Sunni", "Kurd"].includes(m.sect_group)).length;
  mpEls.minorityNote.textContent = minority
    ? `참고: 기독교·야지디·투르크멘 등 기타/소수 쿼터 ${minority}명은 위 3개 종파 그래프에는 포함하지 않았습니다.`
    : "";
}

function barRow(label, count, max) {
  const pct = Math.max(2, Math.round((count / max) * 100));
  return `
    <div class="bar-row">
      <div class="bar-row-head">
        <span>${escapeHtml(label)}</span>
        <strong>${Number(count).toLocaleString()}명</strong>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

function countBy(items, fn) {
  const map = new Map();
  items.forEach(item => {
    const key = fn(item);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].map(([name, count]) => ({ name, count }));
}

function fillSelect(select, values, firstText) {
  select.innerHTML = `<option value="all">${firstText}</option>`;
  values.forEach(value => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
}

function unique(arr) {
  return [...new Set(arr)];
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(d);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("`", "&#096;").replaceAll(" ", "-");
}

[mpEls.search, mpEls.sect, mpEls.party, mpEls.alliance].forEach(el => {
  el.addEventListener("input", applyMpFilters);
});

mpEls.reset.addEventListener("click", () => {
  mpEls.search.value = "";
  mpEls.sect.value = "all";
  mpEls.party.value = "all";
  mpEls.alliance.value = "all";
  applyMpFilters();
});

loadMpData();
