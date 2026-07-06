/*
 * COM Activities UI Patch
 * - app.js는 국내/글로벌 기존 화면을 그대로 담당
 * - 이 파일은 COM 탭을 눌렀을 때만 data/com-activities.json을 읽어 화면에 표시
 * - 같은 부처/기관의 활동은 하나의 묶음 안에 표시
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

  function cleanComText(value) {
    return String(value ?? "")
      .replace(/\\n/g, " ")
      .replace(/\n/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/^["'\s,]+|["'\s,]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeArabicLite(value) {
    return cleanComText(value)
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/ـ/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const COM_MINISTRY_NAME_MAP = [
    { ko: "관세청", ar: ["الهيئة العامة للكمارك", "الهيئة العامة للجمارك", "هيئة الكمارك", "هيئة الجمارك"] },
    { ko: "재건주택부", ar: ["وزارة الإعمار", "وزارة الاعمار"] },
    { ko: "재무부", ar: ["وزارة المالية"] },
    { ko: "법무부", ar: ["وزارة العدل"] },
    { ko: "기획부", ar: ["وزارة التخطيط"] },
    { ko: "전기부", ar: ["وزارة الكهرباء"] },
    { ko: "석유부", ar: ["وزارة النفط"] },
    { ko: "청렴위원회", ar: ["هيئة النزاهة"] },
    { ko: "국경출입국위원회", ar: ["هيئة المنافذ الحدودية"] },
  ];

  function translateComMinistryName(value) {
    const text = normalizeArabicLite(value);
    if (!text) return "";

    for (const item of COM_MINISTRY_NAME_MAP) {
      if ((item.ar || []).some((ar) => text.includes(normalizeArabicLite(ar)))) {
        return item.ko;
      }
    }

    return "";
  }

  function displayComMinistryName(ministryKo, ministryAr) {
    const ko = cleanComText(ministryKo);
    const ar = cleanComText(ministryAr);
    const translated = translateComMinistryName(`${ko} ${ar}`);

    if (translated) return translated;
    if (ko && !/[؀-ۿ]/.test(ko)) return ko;
    if (ar && !/[؀-ۿ]/.test(ar)) return ar;
    return ko || ar || "기관명 없음";
  }

  function normalizeComSummaryText(value) {
    let text = cleanComText(value);
    if (!text) return "요약 정보 없음";

    const replacements = [
      ["발급 및 갱신 업무를 완료했습니다", "발급·갱신 업무 완료"],
      ["발급 및 갱신 업무를 완료하였습니다", "발급·갱신 업무 완료"],
      ["완료했습니다", "완료"],
      ["완료하였습니다", "완료"],
      ["약속했습니다", "의지 표명"],
      ["약속하였습니다", "의지 표명"],
      ["부인했습니다", "부인"],
      ["부인하였습니다", "부인"],
      ["밝혔습니다", "밝힘"],
      ["강조했습니다", "강조"],
      ["강조하였습니다", "강조"],
      ["논의했습니다", "논의"],
      ["논의하였습니다", "논의"],
      ["검토했습니다", "검토"],
      ["검토하였습니다", "검토"],
      ["추진했습니다", "추진"],
      ["추진하였습니다", "추진"],
      ["확인했습니다", "확인"],
      ["확인하였습니다", "확인"],
      ["발표했습니다", "발표"],
      ["발표하였습니다", "발표"],
      ["지시했습니다", "지시"],
      ["지시하였습니다", "지시"],
      ["요청했습니다", "요청"],
      ["요청하였습니다", "요청"],
      ["승인했습니다", "승인"],
      ["승인하였습니다", "승인"],
      ["개최했습니다", "개최"],
      ["개최하였습니다", "개최"],
      ["진행했습니다", "진행"],
      ["진행하였습니다", "진행"],
      ["시작했습니다", "시작"],
      ["시작하였습니다", "시작"],
      ["서명했습니다", "서명"],
      ["서명하였습니다", "서명"],
      ["체결했습니다", "체결"],
      ["체결하였습니다", "체결"],
      ["개선했습니다", "개선"],
      ["개선하였습니다", "개선"],
      ["마련했습니다", "마련"],
      ["마련하였습니다", "마련"],
      ["설명했습니다", "설명"],
      ["설명하였습니다", "설명"],
      ["공유했습니다", "공유"],
      ["공유하였습니다", "공유"],
      ["협의했습니다", "협의"],
      ["협의하였습니다", "협의"],
      ["됐습니다", "됨"],
      ["되었습니다", "됨"],
      ["됩니다", "됨"],
      ["있습니다", "있음"],
      ["없습니다", "없음"],
      ["했습니다", "함"],
      ["하였습니다", "함"],
      ["합니다", "함"],
      ["입니다", "임"],
    ];

    for (const [from, to] of replacements) {
      text = text.replaceAll(from, to);
    }

    return text
      .replace(/함\./g, "함")
      .replace(/됨\./g, "됨")
      .replace(/임\./g, "임")
      .replace(/음\./g, "음")
      .replace(/다\./g, "")
      .replace(/\s+/g, " ")
      .trim();
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
    if (els.currentSectionTitle) {
      els.currentSectionTitle.textContent = "COM 주요활동";
    }

    if (els.currentSectionDesc) {
      els.currentSectionDesc.textContent =
        "이라크 내각사무처의 일일 정부활동 보고서를 날짜별로 수집하고, 부처/기관별 주요 내용을 한국어로 요약합니다.";
    }

    const comSmall = $('.source-tab[data-section="com"] small');
    if (comSmall) {
      comSmall.textContent = "날짜별 · 부처별 주요활동 자동 요약";
    }

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
      articles.flatMap((a) => (a.ministries || []).map((m) => cleanComText(m.category)))
    ).sort();

    const ministries = unique(
      articles.flatMap((a) =>
        (a.ministries || []).map((m) => displayComMinistryName(m.ministry_ko, m.ministry_ar))
      )
    ).sort((a, b) => a.localeCompare(b, "ko"));

    const options = [`<option value="all">전체</option>`]
      .concat(
        categories.map((c) => {
          const label = String(c || "").length > 14 ? String(c || "").slice(0, 14) + "…" : String(c || "");
          return `<option title="${escapeAttr(c)}" value="category::${escapeAttr(c)}">카테고리: ${escapeHtml(label)}</option>`;
        })
      )
      .concat(
        ministries.map((m) => {
          const label = String(m || "").length > 14 ? String(m || "").slice(0, 14) + "…" : String(m || "");
          return `<option title="${escapeAttr(m)}" value="ministry::${escapeAttr(m)}">부처: ${escapeHtml(label)}</option>`;
        })
      );

    els.orgFilter.innerHTML = options.join("");

    if ([...els.orgFilter.options].some((o) => o.value === selectedOrg)) {
      els.orgFilter.value = selectedOrg;
    }
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
        const category = cleanComText(orgValue.replace("category::", ""));
        ministries = ministries.filter((m) => cleanComText(m.category || "") === category);
      }

      if (orgValue.startsWith("ministry::")) {
        const ministry = cleanComText(orgValue.replace("ministry::", ""));
        ministries = ministries.filter((m) => displayComMinistryName(m.ministry_ko, m.ministry_ar) === ministry);
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

    filtered = filtered.filter((a) => (a.ministries || []).length > 0);

    filtered.sort((a, b) => {
      if (sort === "published" || sort === "found") {
        return (
          (parseDate(b.published_date || b.date_found) || 0) -
          (parseDate(a.published_date || a.date_found) || 0)
        );
      }

      if (sort === "source") {
        return String(a.source || "").localeCompare(String(b.source || ""));
      }

      const aScore = Math.max(...(a.ministries || []).map((m) => Number(m.priority_score || 0)), 0);
      const bScore = Math.max(...(b.ministries || []).map((m) => Number(m.priority_score || 0)), 0);

      return bScore - aScore;
    });

    return filtered;
  }

  function groupMinistriesByName(ministries) {
    const grouped = new Map();

    for (const m of ministries || []) {
      const ministryAr = cleanComText(m.ministry_ar || "");
      const ministryKo = displayComMinistryName(m.ministry_ko, ministryAr);
      const key = ministryKo || ministryAr || "기관명 없음";

      if (!grouped.has(key)) {
        grouped.set(key, {
          ministry_ko: ministryKo || "기관명 없음",
          ministry_ar: ministryAr,
          priority_score: Number(m.priority_score || 50),
          rows: [],
        });
      }

      const group = grouped.get(key);

      group.priority_score = Math.max(
        group.priority_score,
        Number(m.priority_score || 50)
      );

      if (!group.ministry_ar && ministryAr) {
        group.ministry_ar = ministryAr;
      }

      group.rows.push(m);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)
    );
  }

  function renderComStats(allArticles, filteredArticles) {
    const activityCount = filteredArticles.reduce(
      (sum, a) => sum + ((a.ministries || []).length),
      0
    );

    const groupedMinistryCount = filteredArticles.reduce(
      (sum, a) => sum + groupMinistriesByName(a.ministries || []).length,
      0
    );

    const allActivityCount = allArticles.reduce(
      (sum, a) => sum + ((a.ministries || []).length),
      0
    );

    const latest = [...allArticles]
      .map((a) => parseDate(a.published_date))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];

    if (els.totalCount) els.totalCount.textContent = allArticles.length.toLocaleString();
    if (els.filteredCount) els.filteredCount.textContent = activityCount.toLocaleString();
    if (els.countryCount) els.countryCount.textContent = "1";
    if (els.latestDate) els.latestDate.textContent = latest ? formatDate(latest.toISOString()) : "-";
    if (els.resultCountBadge) els.resultCountBadge.textContent = `${groupedMinistryCount.toLocaleString()}개 부처`;
    if (els.sectionCountBadge) els.sectionCountBadge.textContent = `${allActivityCount.toLocaleString()}개 항목`;
  }

  function renderComList(articles) {
    if (!els.newsList) return;

    if (!articles.length) {
      els.newsList.innerHTML = `<p class="empty">조건에 맞는 COM 주요활동이 없습니다.</p>`;
      return;
    }

    els.newsList.innerHTML = articles.map((article) => {
      const ministryGroups = groupMinistriesByName(article.ministries || []);
      const totalActivityCount = (article.ministries || []).length;

      const ministriesHtml = ministryGroups.map((group) => {
        const rowsHtml = group.rows
          .slice()
          .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
          .map((m) => `
            <li class="com-activity-row">
              <div class="news-meta">
                <span>${escapeHtml(cleanComText(m.category || "정부활동"))}</span>
                <span>·</span>
                <span>중요도 ${escapeHtml(m.priority_score || 50)}</span>
              </div>

              <p class="news-summary">
                ${escapeHtml(normalizeComSummaryText(m.summary_ko || "요약 정보 없음"))}
              </p>

              ${(m.keyword_hits || []).length ? `
                <div class="tag-row">
                  ${(m.keyword_hits || [])
                    .slice(0, 5)
                    .map((k) => `<span class="tag">${escapeHtml(cleanComText(k))}</span>`)
                    .join("")}
                </div>
              ` : ""}
            </li>
          `).join("");

        return `
          <div class="com-ministry-group">
            <div class="com-ministry-head">
              <div>
                <h4>${escapeHtml(group.ministry_ko || group.ministry_ar || "기관명 없음")}</h4>
                ${group.ministry_ar ? `
                  <small class="com-arabic">${escapeHtml(group.ministry_ar)}</small>
                ` : ""}
              </div>
              <span class="tag importance">${group.rows.length}건</span>
            </div>

            <ul class="com-activity-list">
              ${rowsHtml}
            </ul>
          </div>
        `;
      }).join("");

      return `
        <article class="news-card">
          <div class="news-meta">
            <span>${escapeHtml(formatDate(article.published_date))}</span>
            <span>·</span>
            <span>${escapeHtml(article.source || "COM")}</span>
            <span>·</span>
            <span>${escapeHtml(article.country || "Iraq")}</span>
            <span>·</span>
            <span>${escapeHtml(ministryGroups.length)}개 부처/기관</span>
            <span>·</span>
            <span>${escapeHtml(totalActivityCount)}개 활동</span>
          </div>

          <h3 class="news-title com-day-title">
            <a href="${escapeAttr(article.url || "#")}" target="_blank" rel="noopener">
              ${escapeHtml(article.title_ko || article.title_original || "COM 주요활동")}
            </a>
          </h3>

          <p class="news-summary">${escapeHtml(normalizeComSummaryText(article.summary_ko || ""))}</p>

          <div class="tag-row com-main-tags">
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

    const rows = articles
      .flatMap((article) =>
        groupMinistriesByName(article.ministries || []).map((group) => ({
          ministry_ko: group.ministry_ko,
          ministry_ar: group.ministry_ar,
          priority_score: group.priority_score,
          count: group.rows.length,
          date: article.published_date,
          url: article.url,
        }))
      )
      .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
      .slice(0, 8);

    if (!rows.length) {
      els.topNews.innerHTML = `<p class="empty">주요 COM 항목이 없습니다.</p>`;
      return;
    }

    els.topNews.innerHTML = rows.map((m) => `
      <a class="top-item" href="${escapeAttr(m.url || "#")}" target="_blank" rel="noopener">
        <strong>${escapeHtml(m.ministry_ko || m.ministry_ar)} · ${escapeHtml(m.count)}건</strong>
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
            <p>data/com-activities.json 파일 생성 여부와 assets/com-patch.js 문법 오류 여부를 확인하세요.</p>
          </div>`;
      }

      if (els.topNews) {
        els.topNews.innerHTML = `<p class="empty">COM 데이터 연결 대기중입니다.</p>`;
      }
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
          ministry_ko: displayComMinistryName(m.ministry_ko, m.ministry_ar),
          ministry_ar: cleanComText(m.ministry_ar),
          category: cleanComText(m.category),
          priority_score: m.priority_score,
          summary_ko: normalizeComSummaryText(m.summary_ko),
          keyword_hits: (m.keyword_hits || []).map(cleanComText).join("|"),
          url: article.url,
        });
      }
    }

    const headers = [
      "published_date",
      "title_ko",
      "ministry_ko",
      "ministry_ar",
      "category",
      "priority_score",
      "summary_ko",
      "keyword_hits",
      "url",
    ];

    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });

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
            renderCom();
          }
        }, 80);
      });
    });

    [
      els.searchInput,
      els.periodFilter,
      els.countryFilter,
      els.orgFilter,
      els.sortFilter,
    ]
      .filter(Boolean)
      .forEach((el) => {
        el.addEventListener("input", () => {
          if (isComActive()) {
            setTimeout(renderCom, 0);
          }
        });
      });

    if (els.downloadBtn) {
      els.downloadBtn.addEventListener(
        "click",
        (event) => {
          if (!isComActive()) return;

          event.preventDefault();
          event.stopImmediatePropagation();

          downloadComCsv();
        },
        true
      );
    }
  }

  function installComPatchStyles() {
    if (document.querySelector("#comPatchStyles")) return;

    const style = document.createElement("style");
    style.id = "comPatchStyles";

    style.textContent = `
      .com-main-tags {
        margin-bottom: 4px !important;
      }

      .com-day-title {
        font-size: 23px;
        line-height: 1.25;
        margin-bottom: 4px !important;
      }

      .com-ministry-group {
        border-top: 1px solid rgba(15,23,42,.08);
        padding: 3px 0 !important;
      }

      .com-ministry-group:first-of-type {
        border-top: 0;
      }

      .com-ministry-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 0 !important;
      }

      .com-ministry-head h4 {
        margin: 0 0 1px !important;
        font-size: 20px;
        line-height: 1.2;
        color: #1f2937;
      }

      .com-arabic {
        display: block;
        direction: rtl;
        text-align: right;
        color: #64748b;
        line-height: 1.25;
        font-size: 12px;
        margin: 0 !important;
      }

      .com-activity-list {
        list-style: none;
        padding: 0;
        margin: 0 !important;
        display: grid;
        gap: 1px !important;
      }

      .com-activity-row {
        padding: 5px 10px !important;
        margin: 0 !important;
        border-radius: 8px;
        background: rgba(248,250,252,.85);
      }

      .com-activity-row .news-meta {
        margin: 0 0 1px !important;
      }

      .com-activity-row .news-summary {
        margin: 0 !important;
        font-size: 17px;
        line-height: 1.34 !important;
      }

      .com-activity-row .tag-row {
        margin-top: 2px !important;
        margin-bottom: 0 !important;
      }

      .com-activity-row .tag {
        margin-bottom: 0 !important;
      }
    `;

    document.head.appendChild(style);
  }

  function boot() {
    installComPatchStyles();

    const comTab = $('.source-tab[data-section="com"] small');
    if (comTab) {
      comTab.textContent = "날짜별 · 부처별 주요활동";
    }

    hookEvents();

    if (isComActive()) {
      renderCom();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
