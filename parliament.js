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

    mpState.members = Array.isArray(data.members) ? data.members.map(normalizeMember) : [];
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

function normalizeMember(member) {
  const m = { ...member };
  ["name_en", "party_en", "coalition_en", "alliance_en", "remarks", "arrest_status"].forEach(field => {
    if (m[field]) m[field] = normalizeAl(m[field]);
  });
  m.name_short_en = m.name_short_en ? normalizeAl(m.name_short_en) : makeShortName(m.name_en);
  return m;
}

function normalizeAl(text) {
  return String(text ?? "")
    .replace(/\b[aA][lL]-/g, "Al-")
    .replace(/\s+/g, " ")
    .trim();
}

function makeShortName(name) {
  const clean = normalizeAl(name);
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length <= 2) return clean;
  return `${parts[0]} ${parts[parts.length - 1]}`;
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
        m.name_short_en,
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

  mpEls.totalCount.textContent = mpState.members.length.toLocaleString();
  mpEls.filteredCount.textContent = mpState.filtered.length.toLocaleString();
  mpEls.partyCount.textContent = partyCount.toLocaleString();
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
        <span class="member-name" title="${escapeAttr(m.name_en || "")}">${escapeHtml(m.name_short_en || makeShortName(m.name_en) || "-")}</span>
        <span class="muted-line arabic-text">${escapeHtml(m.name_ar || "")}</span>
      </td>
      <td><span class="sect-pill sect-${escapeAttr(m.sect_group)}">${escapeHtml(m.sect_ko || m.sect_group || "-")}</span></td>
      <td>
        ${escapeHtml(m.coalition_en || "-")}
        <span class="muted-line arabic-text">${escapeHtml(m.coalition_ar || "")}</span>
      </td>
      <td>
        ${escapeHtml(m.alliance_en || "-")}
        <span class="muted-line arabic-text">${escapeHtml(m.alliance_ar || "")}</span>
      </td>
    </tr>
  `).join("");

  mpEls.tableWrap.innerHTML = `
    <table class="parliament-table">
      <thead>
        <tr>
          <th>No.</th>
          <th>의원명</th>
          <th>종파</th>
          <th>Coalition</th>
          <th>Alliance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMpSummary() {
  const members = mpState.members;
  const total = members.length || 1;
  const palette = ["#1686a0", "#a30000", "#f6a21a", "#bd6500", "#0d5362", "#77797d"];
  const parties = countBy(members, m => m.party_en || "미분류").sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const top4 = parties.slice(0, 4);
  const rest = Math.max(0, members.length - top4.reduce((s, x) => s + x.count, 0));
  const partyItems = [...top4, { name: "기타 정당", count: rest }].filter(x => x.count > 0);
  const legend = partyItems.map((x, i) => '<div class="seat-legend-item"><span class="seat-legend-swatch" style="--seat-color:' + palette[i] + '"></span><span class="seat-legend-name" title="' + escapeAttr(x.name) + '">' + escapeHtml(x.name) + '</span><strong>' + x.count + '석</strong></div>').join("");
  const segments = partyItems.map((x, i) => '<span class="seat-stack-segment" style="width:' + (x.count / total * 100) + '%;background:' + palette[i] + '" title="' + escapeAttr(x.name) + ': ' + x.count + '석"></span>').join("");
  const colors = []; partyItems.forEach((p, i) => { for (let n = 0; n < p.count; n++) colors.push(palette[i]); });
  const points = [];
  for (let ring = 0; ring < 10; ring++) { const r = 1 - (ring + .5) / 10; const slots = Math.max(8, Math.round(14 + r * 35)); for (let k = 0; k < slots; k++) { const angle = Math.PI * (k + .5) / slots; points.push({x:180 + Math.cos(angle) * r * 155, y:166 - Math.sin(angle) * r * 135}); } }
  points.sort((a,b) => b.y - a.y || a.x - b.x);
  const dots = colors.slice(0, members.length).map((color, i) => '<circle cx="' + points[i].x.toFixed(1) + '" cy="' + points[i].y.toFixed(1) + '" r="5.4" fill="' + color + '"><title>' + escapeHtml(members[i]?.party_en || "미분류") + '</title></circle>').join("");
  mpEls.partyBars.innerHTML = '<div class="party-infographic"><div class="seat-legend">' + legend + '</div><div class="seat-stacked-bar" role="img" aria-label="정당별 의석 비율">' + segments + '</div><div class="seat-chart-title">정당별 전체 의석 구성</div><svg class="seat-dots-chart" viewBox="0 0 360 180" role="img" aria-label="정당별 의원 의석 분포">' + dots + '</svg><div class="seat-total-label">전체 <strong>' + members.length.toLocaleString() + '석</strong></div></div>';
  const defs = [{name:"시아파",key:"Shia",color:"#1686a0"},{name:"순니파",key:"Sunni",color:"#a30000"},{name:"쿠르드",key:"Kurd",color:"#f6a21a"},{name:"기타·소수 종파",key:"Minority",color:"#77797d"}];
  const sects = defs.map(x => ({...x,count:members.filter(m => m.sect_group === x.key || (x.key === "Minority" && !["Shia","Sunni","Kurd"].includes(m.sect_group))).length})).filter(x => x.count > 0);
  const sectSegments = sects.map(x => '<span class="sect-stack-segment" style="width:' + (x.count / total * 100) + '%;background:' + x.color + '" title="' + x.name + ': ' + x.count + '명"></span>').join("");
  const sectLegend = sects.map(x => '<div class="sect-legend-item"><span class="seat-legend-swatch" style="--seat-color:' + x.color + '"></span><span>' + x.name + '</span><strong>' + x.count + '명 <small>(' + Math.round(x.count / total * 100) + '%)</small></strong></div>').join("");
  mpEls.sectBars.innerHTML = '<div class="sect-infographic"><div class="sect-stacked-bar" role="img" aria-label="종파별 의원 구성">' + sectSegments + '</div><div class="sect-legend">' + sectLegend + '</div></div>';
  mpEls.minorityNote.textContent = "";
}
function barRow(label, count, maxForBar, totalForPercent, maxLabelLength = 16) {
  const pctOfMax = Math.max(2, Math.round((count / maxForBar) * 100));
  const pctOfTotal = Math.round((count / Math.max(totalForPercent, 1)) * 100);
  const shortLabel = truncateText(label, maxLabelLength);

  return `
    <div class="bar-row">
      <div class="bar-row-head">
        <span class="bar-label" title="${escapeAttr(label)}">${escapeHtml(shortLabel)}</span>
        <strong class="bar-value">${Number(count).toLocaleString()}명 <small>(${pctOfTotal}%)</small></strong>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pctOfMax}%"></div></div>
    </div>
  `;
}

function truncateText(text, maxLength) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
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
  return escapeHtml(str).replaceAll("`", "&#096;");
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
