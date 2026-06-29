const state = {
  articles: [],
  filtered: []
};

const els = {
  searchInput: document.querySelector("#searchInput"),
  periodFilter: document.querySelector("#periodFilter"),
  countryFilter: document.querySelector("#countryFilter"),
  orgFilter: document.querySelector("#orgFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  resetBtn: document.querySelector("#resetBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  newsList: document.querySelector("#newsList"),
  topNews: document.querySelector("#topNews"),
  totalCount: document.querySelector("#totalCount"),
  filteredCount: document.querySelector("#filteredCount"),
  countryCount: document.querySelector("#countryCount"),
  latestDate: document.querySelector("#latestDate"),
  resultCountBadge: document.querySelector("#resultCountBadge"),
  lastUpdated: document.querySelector("#lastUpdated"),
  syncStatus: document.querySelector("#syncStatus")
};

async function loadNews() {
  try {
    const res = await fetch(`./data/news.json?v=${Date.now()}`);
    if (!res.ok) throw new Error("news.json not found");
    const data = await res.json();

    state.articles = Array.isArray(data.articles) ? data.articles : [];
    state.articles = state.articles.map(normalizeArticle);

    els.lastUpdated.textContent = data.last_updated
      ? `마지막 업데이트: ${formatDateTime(data.last_updated)}`
      : "업데이트 시간 없음";
    els.syncStatus.classList.add("ok");

    hydrateFilters();
    applyFilters();
  } catch (err) {
    console.error(err);
    els.newsList.innerHTML = `<p class="empty">데이터를 불러오지 못했습니다. data/news.json 파일을 확인하세요.</p>`;
    els.lastUpdated.textContent = "데이터 연결 오류";
  }
}

function normalizeArticle(article) {
  return {
    id: article.id || crypto.randomUUID(),
    date_found: article.date_found || "",
    published_date: article.published_date || article.date_found || "",
    source: article.source || "Unknown",
    title_original: article.title_original || article.title || "제목 없음",
    title_ko: article.title_ko || article.title_original || article.title || "제목 없음",
    summary_ko: article.summary_ko || article.summary || "요약 정보가 없습니다.",
    url: article.url || "#",
    language: article.language || "unknown",
    country: article.country || "Unclassified",
    organization: article.organization || "General",
    keywords: Array.isArray(article.keywords) ? article.keywords : [],
    importance_score: Number(article.importance_score || 50),
    category: article.category || "뉴스"
  };
}

function hydrateFilters() {
  const countries = unique(state.articles.map(a => a.country).filter(Boolean)).sort();
  const orgs = unique(state.articles.map(a => a.organization).filter(Boolean)).sort();

  fillSelect(els.countryFilter, countries, "전체");
  fillSelect(els.orgFilter, orgs, "전체");
}

function fillSelect(select, values, firstText) {
  const current = select.value;
  select.innerHTML = `<option value="all">${firstText}</option>`;
  values.forEach(value => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function applyFilters() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const period = els.periodFilter.value;
  const country = els.countryFilter.value;
  const org = els.orgFilter.value;
  const sort = els.sortFilter.value;
  const cutoff = getCutoffDate(period);

  let filtered = [...state.articles];

  if (keyword) {
    filtered = filtered.filter(a => {
      const haystack = [
        a.title_original,
        a.title_ko,
        a.summary_ko,
        a.source,
        a.country,
        a.organization,
        a.category,
        ...(a.keywords || [])
      ].join(" ").toLowerCase();

      return haystack.includes(keyword);
    });
  }

  if (cutoff) {
    filtered = filtered.filter(a => {
      const d = parseDate(a.published_date || a.date_found);
      return d && d >= cutoff;
    });
  }

  if (country !== "all") filtered = filtered.filter(a => a.country === country);
  if (org !== "all") filtered = filtered.filter(a => a.organization === org);

  filtered.sort((a, b) => {
    if (sort === "importance") return b.importance_score - a.importance_score;
    if (sort === "published") return parseDate(b.published_date) - parseDate(a.published_date);
    if (sort === "found") return parseDate(b.date_found) - parseDate(a.date_found);
    if (sort === "source") return a.source.localeCompare(b.source);
    return 0;
  });

  state.filtered = filtered;
  renderStats();
  renderNewsList();
  renderTopNews();
}

function renderStats() {
  const countries = unique(state.articles.map(a => a.country).filter(Boolean));
  const latest = [...state.articles]
    .map(a => parseDate(a.published_date))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  els.totalCount.textContent = state.articles.length.toLocaleString();
  els.filteredCount.textContent = state.filtered.length.toLocaleString();
  els.countryCount.textContent = countries.length.toLocaleString();
  els.latestDate.textContent = latest ? formatDate(latest.toISOString()) : "-";
  els.resultCountBadge.textContent = `${state.filtered.length.toLocaleString()}건`;
}

function renderNewsList() {
  if (!state.filtered.length) {
    els.newsList.innerHTML = `<p class="empty">조건에 맞는 기사가 없습니다.</p>`;
    return;
  }

  const html = state.filtered.slice(0, 200).map(a => `
    <article class="news-card">
      <div class="news-meta">
        <span>${escapeHtml(formatDate(a.published_date))}</span>
        <span>·</span>
        <span>${escapeHtml(a.source)}</span>
        <span>·</span>
        <span>${escapeHtml(a.country)}</span>
        <span>·</span>
        <span>${escapeHtml(a.organization)}</span>
      </div>
      <h3 class="news-title">
        <a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title_ko)}</a>
      </h3>
      <p class="news-summary">${escapeHtml(a.summary_ko)}</p>
      <div class="tag-row">
        <span class="tag importance">중요도 ${a.importance_score}</span>
        <span class="tag">${escapeHtml(a.category)}</span>
        ${(a.keywords || []).slice(0, 6).map(k => `<span class="tag">${escapeHtml(k)}</span>`).join("")}
      </div>
    </article>
  `).join("");

  els.newsList.innerHTML = html;
}

function renderTopNews() {
  const top = [...state.filtered]
    .sort((a, b) => b.importance_score - a.importance_score)
    .slice(0, 6);

  if (!top.length) {
    els.topNews.innerHTML = `<p class="empty">주요 뉴스가 없습니다.</p>`;
    return;
  }

  els.topNews.innerHTML = top.map(a => `
    <a class="top-item" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">
      <strong>${escapeHtml(a.title_ko)}</strong>
      <small>${escapeHtml(a.source)} · ${escapeHtml(formatDate(a.published_date))} · 중요도 ${a.importance_score}</small>
    </a>
  `).join("");
}

function downloadCsv() {
  const headers = [
    "published_date", "source", "title_ko", "title_original", "summary_ko",
    "url", "language", "country", "organization", "keywords", "importance_score", "category"
  ];

  const rows = state.filtered.map(a => headers.map(h => {
    const value = h === "keywords" ? (a.keywords || []).join("|") : a[h];
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bismayah-news-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getCutoffDate(period) {
  if (period === "all") return null;
  const days = Number(period);
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "-";
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  const d = parseDate(value);
  if (!d) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(d);
}

function unique(arr) {
  return [...new Set(arr)];
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

[
  els.searchInput,
  els.periodFilter,
  els.countryFilter,
  els.orgFilter,
  els.sortFilter
].forEach(el => el.addEventListener("input", applyFilters));

els.resetBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  els.periodFilter.value = "7";
  els.countryFilter.value = "all";
  els.orgFilter.value = "all";
  els.sortFilter.value = "importance";
  applyFilters();
});

els.downloadBtn.addEventListener("click", downloadCsv);

loadNews();
