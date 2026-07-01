/*
 * COM Activities UI Patch
 * - app.js는 국내/글로벌 기존 화면을 그대로 담당
 * - 이 파일은 COM 탭을 눌렀을 때만 data/com-activities.json을 읽어 화면에 표시
 */

(() => {
  const COM_DATA_URL = "./data/com-activities.json";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    searchInput: $("#searchInput"),
    periodFilter: $("#periodFilter"),
    countryFilter: $("#countryFilter"),
    orgFilter: $("#orgFilter"),
    sortFilter: $("#sortFilter"),
    downloadBtn: $("#downloadBtn"),
    newsList: $("#newsList"),
    topNews: $("#topNews"),
    totalCount: $("#totalCount"),
    filteredCount: $("#filteredCount"),
    countryCount: $("#countryCount"),
    latestDate: $("#latestDate"),
    resultCountBadge: $("#resultCountBadge"),
    sectionCountBadge: $("#sectionCountBadge"),
    currentSectionTitle: $("#currentSectionTitle"),
    currentSectionDesc: $("#currentSectionDesc"),
    lastUpdated: $("#lastUpdated"),
  };

  let payload = null;
  let loadingPromise = null;
  let orgOptionsHydrated = false;

  function isComActive() {
    const active = $(".source-tab.active");
    return active && active.dataset.section === "com";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    const d = parseDate(value);
    return d ? d.toISOString().slice(0, 10) : "-";
  }

  function getCutoffDate(period) {
    if (period === "all") return null;
    const days = Number(period || 7);
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))];
  }

  async function loadComData() {
    if (payload) return payload;
    if (!loadingPromise) {
      loadingPromise = fetch(`${COM_DATA_URL}?v=${Date.now()}`)
        .then((res) => {
          if (!res.ok) throw new Error("com-activities.json not found");
          return res.json();
        })
        .then((data) => {
          payload = {
            generated_at: data.generated_at || "",
            articles: Array.isArray(data.articles)
              ? data.articles
              : Array.isArray(data.sections?.com)
                ? data.sections.com
                : [],
          };
          return payload;
        });
    }
    return loadingPromise;
  }

  function updateComHeader(data) {
    if (els.currentSectionTitle) els.currentSectionTitle.textContent = "COM 주요활동";
    if (els.currentSectionDesc) {
      els.currentSectionDesc.textContent =
        "이라크 내각사무처의 일일 정부활동 보고서를 날짜별로 수집하고, 부처/기관별 주요 내용을 한국어로 요약합니다.";
    }

    const comSmall = $('.source-tab[data-section="com"] small');
    if (comSmall) comSmall.textContent = "날짜별 · 부처별 주요활동 자동 요약";

    if (els.lastUpdated && data.generated_at) {
      const d = parseDate(data.generated_at);
      if (d) {
        els.lastUpdated.textContent = `COM 업데이트: ${new Intl.DateTimeFormat("ko-KR", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(d)}`;
      }
    }
  }

  function hydrateComFilters(articles) {
    if (!els.countryFilter || !els.orgFilter) return;

    const selectedOrg = els.orgFilter.value || "all";

    els.countryFilter.innerHTML = `
      <option value="all">전체</option>
      <option value="Iraq">Iraq</option>
    `;
    els.countryFilter.value = "all";

    const categories = unique(
      articles.flatMap((a) => (a.ministries || []).map((m) => m.category))
    ).sort();

    const ministries = unique(
      articles.flatMap((a) => (a.ministries || []).map((m) => m.ministry_ko || m.ministry_ar))
    ).sort((a, b) => a.localeCompare(b, "ko"));

    const options = [`<option value="all">전체</option>`]
      .concat(categories.map((c) => `<option value="category::${escapeAttr(c)}">카테고리: ${escapeHtml(c)}</option>`))
      .concat(ministries.map((m) => `<option value="ministry::${escapeAttr(m)}">부처: ${escapeHtml(m)}</option>`));

    els.orgFilter.innerHTML = options.join("");

    if ([...els.orgFilter.options].some((o) => o.value === selectedOrg)) {
      els.orgFilter.value = selectedOrg;
    }

    orgOptionsHydrated = true;
  }

  function filterComArticles(articles) {
    const keyword = (els.searchInput?.value || "").trim().toLowerCase();
    const period = els.periodFilter?.value || "7";
    const orgValue = els.orgFilter?.value || "all";
    const sort = els.sortFilter?.value || "importance";
    const cutoff = getCutoffDate(period);

    let filtered = articles.map((article) => {
      let ministries = Array.isArray(article.ministries) ? [...article.ministries] : [];

      if (keyword) {
        ministries = ministries.filter((m) => {
          const haystack = [
            article.title_ko,
            article.title_original,
            article.summary_ko,
            article.source,
            article.url,
            m.ministry_ko,
            m.ministry_ar,
            m.summary_ko,
            m.category,
            ...(m.keyword_hits || []),
          ].join(" ").toLowerCase();
          return haystack.includes(keyword);
        });
      }

      if (orgValue.startsWith("category::")) {
        const category = orgValue.replace("category::", "");
        ministries = ministries.filter((m) => String(m.category || "") === category);
      }

      if (orgValue.startsWith("ministry::")) {
        const ministry = orgValue.replace("ministry::", "");
        ministries = ministries.filter((m) => String(m.ministry_ko || m.ministry_ar || "") === ministry);
      }

      ministries.sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0));

      return { ...article, ministries };
    });

    if (cutoff) {
      filtered = filtered.filter((a) => {
        const d = parseDate(a.published_date || a.date_found);
        return d && d >= cutoff;
      });
    }

    filtered = filtered.filter((a) => a.ministries.length > 0);

    filtered.sort((a, b) => {
      if (sort === "published" || sort === "found") {
        return (parseDate(b.published_date || b.date_found) || 0) - (parseDate(a.published_date || a.date_found) || 0);
      }
      if (sort === "source") {
        return String(a.source || "").localeCompare(String(b.source || ""));
      }
      const aScore = Math.max(...a.ministries.map((m) => Number(m.priority_score || 0)), 0);
      const bScore = Math.max(...b.ministries.map((m) => Number(m.priority_score || 0)), 0);
      return bScore - aScore;
    });

    return filtered;
  }

  function renderComStats(allArticles, filteredArticles) {
    const ministryCount = filteredArticles.reduce((sum, a) => sum + (a.ministries || []).length, 0);
    const allMinistryCount = allArticles.reduce((sum, a) => sum + ((a.ministries || []).length), 0);
    const latest = [...allArticles]
      .map((a) => parseDate(a.published_date))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];

    if (els.totalCount) els.totalCount.textContent = allArticles.length.toLocaleString();
    if (els.filteredCount) els.filteredCount.textContent = ministryCount.toLocaleString();
    if (els.countryCount) els.countryCount.textContent = "1";
    if (els.latestDate) els.latestDate.textContent = latest ? formatDate(latest.toISOString()) : "-";
    if (els.resultCountBadge) els.resultCountBadge.textContent = `${ministryCount.toLocaleString()}개 부처`;
    if (els.sectionCountBadge) els.sectionCountBadge.textContent = `${allMinistryCount.toLocaleString()}개 항목`;
  }

  function renderComList(articles) {
    if (!els.newsList) return;

    if (!articles.length) {
      els.newsList.innerHTML = `<p class="empty">조건에 맞는 COM 주요활동이 없습니다.</p>`;
      return;
    }

    els.newsList.innerHTML = articles.map((article) => {
      const ministriesHtml = (article.ministries || []).map((m) => `
        <div style="border-top:1px solid rgba(15,23,42,.08); padding:12px 0;">
          <div class="news-meta">
            <span>${escapeHtml(m.ministry_ko || m.ministry_ar || "기관명 없음")}</span>
            <span>·</span>
            <span>${escapeHtml(m.category || "정부활동")}</span>
            <span>·</span>
            <span>중요도 ${escapeHtml(m.priority_score || 50)}</span>
          </div>
          <p class="news-summary" style="margin:.35rem 0 .45rem;">${escapeHtml(m.summary_ko || "요약 정보가 없습니다.")}</p>
          <div class="tag-row">
            <span class="tag">${escapeHtml(m.ministry_ar || "")}</span>
            ${(m.keyword_hits || []).slice(0, 5).map((k) => `<span class="tag">${escapeHtml(k)}</span>`).join("")}
          </div>
        </div>
      `).join("");

      return `
        <article class="news-card">
          <div class="news-meta">
            <span>${escapeHtml(formatDate(article.published_date))}</span>
            <span>·</span>
            <span>${escapeHtml(article.source || "COM")}</span>
            <span>·</span>
            <span>${escapeHtml(article.country || "Iraq")}</span>
            <span>·</span>
            <span>${escapeHtml((article.ministries || []).length)}개 부처/기관</span>
          </div>
          <h3 class="news-title">
            <a href="${escapeAttr(article.url || "#")}" target="_blank" rel="noopener">${escapeHtml(article.title_ko || article.title_original || "COM 주요활동")}</a>
          </h3>
          <p class="news-summary">${escapeHtml(article.summary_ko || "")}</p>
          <div class="tag-row" style="margin-bottom:10px;">
            <span class="tag importance">최고 중요도 ${escapeHtml(article.importance_score || 50)}</span>
            <span class="tag">정부/정책</span>
            <span class="tag">COM</span>
          </div>
          ${ministriesHtml}
        </article>
      `;
    }).join("");
  }

  function renderComTopNews(articles) {
    if (!els.topNews) return;

    const rows = articles.flatMap((article) =>
      (article.ministries || []).map((m) => ({
        ...m,
        date: article.published_date,
        url: article.url,
        title: article.title_ko,
      }))
    ).sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)).slice(0, 8);

    if (!rows.length) {
      els.topNews.innerHTML = `<p class="empty">주요 COM 항목이 없습니다.</p>`;
      return;
    }

    els.topNews.innerHTML = rows.map((m) => `
      <a class="top-item" href="${escapeAttr(m.url || "#")}" target="_blank" rel="noopener">
        <strong>${escapeHtml(m.ministry_ko || m.ministry_ar)} · ${escapeHtml(m.category || "정부활동")}</strong>
        <small>${escapeHtml(formatDate(m.date))} · 중요도 ${escapeHtml(m.priority_score || 50)}</small>
      </a>
    `).join("");
  }

  async function renderCom() {
    if (!isComActive()) return;

    if (els.newsList) {
      els.newsList.innerHTML = `<p class="loading">COM 주요활동 데이터를 불러오는 중입니다.</p>`;
    }

    try {
      const data = await loadComData();
      const articles = data.articles || [];

      updateComHeader(data);
      hydrateComFilters(articles);

      const filtered = filterComArticles(articles);
      renderComStats(articles, filtered);
      renderComList(filtered);
      renderComTopNews(filtered);
    } catch (err) {
      console.error("COM activities load failed:", err);
      if (els.newsList) {
        els.newsList.innerHTML = `
          <div class="news-section-placeholder">
            <strong>COM 데이터를 불러오지 못했습니다</strong>
            <p>먼저 GitHub Actions에서 “COM Activities Update”를 실행해서 data/com-activities.json을 생성하세요.</p>
          </div>`;
      }
      if (els.topNews) els.topNews.innerHTML = `<p class="empty">COM 데이터 연결 대기중입니다.</p>`;
    }
  }

  function downloadComCsv() {
    if (!payload || !isComActive()) return;

    const rows = [];
    for (const article of payload.articles || []) {
      for (const m of article.ministries || []) {
        rows.push({
          published_date: formatDate(article.published_date),
          title_ko: article.title_ko,
          ministry_ko: m.ministry_ko,
          ministry_ar: m.ministry_ar,
          category: m.category,
          priority_score: m.priority_score,
          summary_ko: m.summary_ko,
          keyword_hits: (m.keyword_hits || []).join("|"),
          url: article.url,
        });
      }
    }

    const headers = [
      "published_date", "title_ko", "ministry_ko", "ministry_ar",
      "category", "priority_score", "summary_ko", "keyword_hits", "url"
    ];

    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `com-activities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function hookEvents() {
    $$(".source-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        setTimeout(() => {
          if (btn.dataset.section === "com") {
            orgOptionsHydrated = false;
            renderCom();
          }
        }, 60);
      });
    });

    [els.searchInput, els.periodFilter, els.countryFilter, els.orgFilter, els.sortFilter]
      .filter(Boolean)
      .forEach((el) => {
        el.addEventListener("input", () => {
          if (isComActive()) setTimeout(renderCom, 0);
        });
      });

    if (els.downloadBtn) {
      els.downloadBtn.addEventListener("click", (event) => {
        if (!isComActive()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        downloadComCsv();
      }, true);
    }
  }

  function boot() {
    const comTab = $('.source-tab[data-section="com"] small');
    if (comTab) comTab.textContent = "날짜별 · 부처별 주요활동";
    hookEvents();
    if (isComActive()) renderCom();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
