const state = {
  articles: [],
  filtered: [],
  activeSection: "domestic"
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
  syncStatus: document.querySelector("#syncStatus"),
  sectionCountBadge: document.querySelector("#sectionCountBadge"),
  currentSectionTitle: document.querySelector("#currentSectionTitle"),
  currentSectionDesc: document.querySelector("#currentSectionDesc"),
  sectionTabs: [...document.querySelectorAll(".source-tab")]
};


function installComStyles() {
  if (document.querySelector("#comStyles")) return;
  const style = document.createElement("style");
  style.id = "comStyles";
  style.textContent = `
    .com-day-card summary { cursor: pointer; list-style: none; }
    .com-day-card summary::-webkit-details-marker { display: none; }
    .com-ministry-list { margin-top: 16px; display: grid; gap: 12px; }
    .com-ministry-card { border: 1px solid rgba(15,23,42,.10); border-radius: 14px; padding: 14px 16px; background: rgba(248,250,252,.8); }
    .com-ministry-card h4 { margin: 6px 0 4px; color: #0f172a; }
    .com-ministry-card p { margin: 8px 0 0; color: #334155; line-height: 1.65; }
    .com-arabic { display: block; direction: rtl; text-align: right; color: #64748b; line-height: 1.6; }
  `;
  document.head.appendChild(style);
}


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
    category: article.category || "뉴스",
    segment: article.segment || inferSection(article),
    ministries: Array.isArray(article.ministries) ? article.ministries : [],
    collection_method: article.collection_method || ""
  };
}

const SECTION_META = {
  domestic: {
    title: "국내 언론사",
    desc: "구글 한국 뉴스 기준, 최근 1주일 사이 “비스마야 / 한화 이라크 / 이라크 사업” 키워드가 기사에 명시된 결과만 표시합니다."
  },
  global: {
    title: "글로벌 언론사",
    desc: "글로벌·이라크 현지 언론 기준, 최근 1주일 사이 Bismayah, Hanwha Iraq, NIC, مشروع سكني 등 핵심 키워드 결과를 표시합니다."
  },
  sns: {
    title: "SNS",
    desc: "SNS 모니터링 기능은 추후 업데이트 예정입니다."
  },
  com: {
    title: "COM 주요활동",
    desc: "이라크 내각 사무처의 날짜별 주요활동을 수집해 부처별 한국어 요약으로 표시합니다."
  }
};

function inferSection(article) {
  if (article.segment) return article.segment;

  const source = String(article.source || "").toLowerCase();
  const lang = String(article.language || "").toLowerCase();
  const originalTitle = String(article.title_original || "").toLowerCase();
  const originalText = [
    article.title_original || "",
    article.source || "",
    article.url || ""
  ].join(" ").toLowerCase();

  // 중요: title_ko/summary_ko는 AI 번역문이므로 국내/글로벌 판별에 쓰지 않습니다.
  // 이라크/아랍 매체 기사가 한국어로 번역되면 title_ko에 "비스마야"가 들어가도 국내 언론사가 아닙니다.
  const koreanMediaPattern = /newsis|yna|yonhap|연합뉴스|뉴시스|조선|중앙|동아|매일경제|한국경제|머니투데이|헤럴드|서울경제|아주경제|이데일리|파이낸셜뉴스|한국일보|서울신문|매일신문|부산일보|kbs|mbc|sbs|ytn|jtbc|chosun|joongang|donga|mk\.co|hankyung|hankyung\.com/;
  const hasDomesticKeywordInOriginal = /비스마야|한화\s*이라크|이라크\s*사업/.test(originalTitle);
  const isKoreanOriginal = lang === "ko" || /[가-힣]/.test(originalTitle) || koreanMediaPattern.test(source) || koreanMediaPattern.test(originalText);

  if (isKoreanOriginal && hasDomesticKeywordInOriginal) return "domestic";
  return "global";
}

function updateSectionUI() {
  const meta = SECTION_META[state.activeSection] || SECTION_META.global;
  els.currentSectionTitle.textContent = meta.title;
  els.currentSectionDesc.textContent = meta.desc;

  els.sectionTabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === state.activeSection);
  });
}

function hydrateFilters() {
  const base = state.activeSection === "sns"
    ? []
    : state.articles.filter(a => a.segment === state.activeSection);

  const countries = unique(base.map(a => a.country).filter(Boolean)).sort();
  const orgs = unique(base.map(a => a.organization).filter(Boolean)).sort();

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

  if (state.activeSection === "sns") {
    filtered = [];
  } else {
    filtered = filtered.filter(a => a.segment === state.activeSection);
  }

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
        ...(a.keywords || []),
        ...(a.ministries || []).flatMap(m => [m.ministry_ar, m.ministry_ko, m.summary_ko, m.category])
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
  const sectionArticles = state.articles.filter(a => a.segment === state.activeSection);
  const countries = unique(sectionArticles.map(a => a.country).filter(Boolean));
  const latest = [...sectionArticles]
    .map(a => parseDate(a.published_date))
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  els.totalCount.textContent = sectionArticles.length.toLocaleString();
  els.filteredCount.textContent = state.filtered.length.toLocaleString();
  els.countryCount.textContent = countries.length.toLocaleString();
  els.latestDate.textContent = latest ? formatDate(latest.toISOString()) : "-";
  els.resultCountBadge.textContent = `${state.filtered.length.toLocaleString()}건`;
  els.sectionCountBadge.textContent = `${sectionArticles.length.toLocaleString()}건`;
}

function renderNewsList() {
  if (state.activeSection === "sns") {
    els.newsList.innerHTML = `
      <div class="news-section-placeholder">
        <strong>SNS 섹션 준비중</strong>
        <p>추후 X, Telegram, Facebook 등 주요 SNS 채널 모니터링 기능을 추가할 예정입니다.</p>
      </div>`;
    return;
  }

  if (state.activeSection === "com") {
    renderComList();
    return;
  }

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


function renderComList() {
  if (!state.filtered.length) {
    els.newsList.innerHTML = `<p class="empty">수집된 COM 주요활동이 없습니다. GitHub Actions 실행 로그 또는 data/news.json의 segment: com 여부를 확인하세요.</p>`;
    return;
  }

  const html = state.filtered.slice(0, 60).map((a, index) => {
    const ministries = Array.isArray(a.ministries) ? a.ministries : [];
    const ministryHtml = ministries.length
      ? ministries
          .slice()
          .sort((x, y) => Number(y.priority_score || 0) - Number(x.priority_score || 0))
          .map(m => `
            <div class="com-ministry-card">
              <div class="news-meta">
                <span>${escapeHtml(m.category || "정부활동")}</span>
                <span>·</span>
                <span>우선도 ${escapeHtml(m.priority_score || "-")}</span>
              </div>
              <h4>${escapeHtml(m.ministry_ko || m.ministry_ar || "부처명 미상")}</h4>
              ${m.ministry_ar ? `<small class="com-arabic">${escapeHtml(m.ministry_ar)}</small>` : ""}
              <p>${escapeHtml(m.summary_ko || "요약 정보가 없습니다.")}</p>
            </div>
          `).join("")
      : `<p class="empty">부처별 세부 요약이 없습니다.</p>`;

    return `
      <details class="news-card com-day-card" ${index === 0 ? "open" : ""}>
        <summary>
          <div>
            <div class="news-meta">
              <span>${escapeHtml(formatDate(a.published_date))}</span>
              <span>·</span>
              <span>${escapeHtml(a.source)}</span>
              <span>·</span>
              <span>${ministries.length}개 부처</span>
            </div>
            <h3 class="news-title">${escapeHtml(a.title_ko || a.title_original)}</h3>
            <p class="news-summary">${escapeHtml(a.summary_ko)}</p>
          </div>
        </summary>
        <div class="com-ministry-list">
          ${ministryHtml}
          <a class="source-link" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">원문 보기</a>
        </div>
      </details>
    `;
  }).join("");

  els.newsList.innerHTML = html;
}

function renderComTopNews() {
  const top = [...state.filtered].slice(0, 6);
  if (!top.length) {
    els.topNews.innerHTML = `<p class="empty">COM 주요활동이 없습니다.</p>`;
    return;
  }

  els.topNews.innerHTML = top.map(a => {
    const topMinistry = (a.ministries || [])
      .slice()
      .sort((x, y) => Number(y.priority_score || 0) - Number(x.priority_score || 0))[0];

    return `
      <a class="top-item" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(formatDate(a.published_date))} COM 주요활동</strong>
        <small>${escapeHtml(topMinistry?.ministry_ko || a.summary_ko || "부처별 활동 요약")} · 우선도 ${escapeHtml(a.importance_score)}</small>
      </a>
    `;
  }).join("");
}


function renderTopNews() {
  if (state.activeSection === "sns") {
    els.topNews.innerHTML = `<p class="empty">해당 섹션은 준비중입니다.</p>`;
    return;
  }

  if (state.activeSection === "com") {
    renderComTopNews();
    return;
  }

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

els.sectionTabs.forEach(btn => {
  btn.addEventListener("click", () => {
    state.activeSection = btn.dataset.section;
    updateSectionUI();

    // 섹션 전환 시 기본 기간은 1주일로 유지
    els.countryFilter.value = "all";
    els.orgFilter.value = "all";
    els.periodFilter.value = "7";
    hydrateFilters();
    applyFilters();
  });
});

els.resetBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  els.periodFilter.value = "7";
  els.countryFilter.value = "all";
  els.orgFilter.value = "all";
  els.sortFilter.value = "importance";
  state.activeSection = "domestic";
  updateSectionUI();
  hydrateFilters();
  applyFilters();
});

els.downloadBtn.addEventListener("click", downloadCsv);

installComStyles();
updateSectionUI();
loadNews();
