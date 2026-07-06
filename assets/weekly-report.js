/*
 * Weekly Iraq Situation Report Generator
 * - Uses accumulated local JSON data from the dashboard.
 * - Builds a review screen first, then downloads a real .docx file in the
 *   existing weekly-report style: 국내 상황 / 경제 / 국제사회 / 영향.
 * - No API key is exposed in the browser. The report is generated from already
 *   collected titles and Korean summaries.
 */
(() => {
  const REPORT_WINDOW_DAYS = 7;
  const REPORT_SOURCE_FILES = [
    { url: "./data/domestic-news.json", type: "domestic", label: "국내 언론" },
    { url: "./data/overseas-news.json", type: "global", label: "글로벌/현지 언론" },
    { url: "./data/weekly-context-news.json", type: "weekly", label: "이라크 주간 맥락" },
    { url: "./data/com-activities.json", type: "com", label: "COM 주요활동" },
    { url: "./data/sns-activities.json", type: "sns", label: "SNS" },
  ];

  const CATEGORY_LABELS = {
    bismayah: "비스마야 / 한화 / NIC 관련",
    construction: "건설 / 주택 / 인프라",
    politics: "정국 / 정치권",
    security: "치안 / 테러 / 시위",
    economy: "경제 / 유가 / 에너지",
    regional: "국제사회 / 중동 정세",
    other: "기타 참고",
  };

  const CATEGORY_ORDER = [
    "bismayah",
    "construction",
    "politics",
    "security",
    "economy",
    "regional",
    "other",
  ];

  const DEFAULT_PICK_LIMIT = {
    bismayah: 12,
    construction: 8,
    politics: 8,
    security: 8,
    economy: 5,
    regional: 7,
    other: 4,
  };

  const state = {
    items: [],
    selected: new Set(),
    period: null,
    payloadMeta: [],
  };

  function boot() {
    const btn = document.querySelector("#weeklyReportBtn");
    if (!btn) return;

    injectPanel();
    btn.addEventListener("click", openWeeklyReport);
  }

  function injectPanel() {
    if (document.querySelector("#weeklyReportOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "weeklyReportOverlay";
    overlay.className = "weekly-report-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="weekly-report-modal" role="dialog" aria-modal="true" aria-labelledby="weeklyReportTitle">
        <header class="weekly-report-head">
          <div>
            <h2 id="weeklyReportTitle">주간 보고서 생성</h2>
            <p id="weeklyReportDesc">최근 7일간 누적된 기사·COM·SNS 데이터를 기준으로 보고서 후보를 선별합니다.</p>
          </div>
          <button class="weekly-report-close" type="button" aria-label="닫기">×</button>
        </header>
        <div id="weeklyReportBody" class="weekly-report-body">
          <div class="weekly-report-loading">보고서 후보 데이터를 불러오는 중입니다.</div>
        </div>
        <footer class="weekly-report-foot">
          <p id="weeklyReportNote" class="weekly-report-note">불필요한 항목은 체크 해제한 뒤 Word 파일을 내려받으세요.</p>
          <div class="weekly-report-actions">
            <button id="weeklySelectAllBtn" class="ghost-btn" type="button">전체 선택</button>
            <button id="weeklyClearBtn" class="ghost-btn" type="button">전체 해제</button>
            <button id="weeklyRefreshBtn" class="ghost-btn" type="button">다시 불러오기</button>
            <button id="weeklyDownloadDocxBtn" class="primary-btn" type="button">Word 다운로드</button>
          </div>
        </footer>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector(".weekly-report-close").addEventListener("click", closePanel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel();
    });

    overlay.querySelector("#weeklySelectAllBtn").addEventListener("click", () => {
      state.selected = new Set(state.items.map((item) => item.id));
      renderPanel();
    });

    overlay.querySelector("#weeklyClearBtn").addEventListener("click", () => {
      state.selected = new Set();
      renderPanel();
    });

    overlay.querySelector("#weeklyRefreshBtn").addEventListener("click", openWeeklyReport);
    overlay.querySelector("#weeklyDownloadDocxBtn").addEventListener("click", downloadWeeklyDocx);
  }

  async function openWeeklyReport() {
    const overlay = document.querySelector("#weeklyReportOverlay");
    const body = document.querySelector("#weeklyReportBody");
    const note = document.querySelector("#weeklyReportNote");

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    body.innerHTML = `<div class="weekly-report-loading">최근 7일치 기사·COM·SNS 데이터를 취합하는 중입니다.</div>`;
    note.textContent = "보고서 후보 데이터를 불러오는 중입니다.";

    try {
      const { items, meta } = await loadReportItems();
      const period = getReportPeriod(items);
      const weeklyItems = items
        .filter((item) => isWithinPeriod(item.date, period))
        .filter((item) => item.reportScore >= 20)
        .sort((a, b) => b.reportScore - a.reportScore || new Date(b.date) - new Date(a.date));

      state.items = uniqueReportItems(weeklyItems);
      state.payloadMeta = meta;
      state.period = period;
      state.selected = getDefaultSelection(state.items);

      renderPanel();
    } catch (err) {
      console.error("weekly report load failed", err);
      body.innerHTML = `
        <div class="weekly-report-empty">
          주간 보고서 후보 데이터를 불러오지 못했습니다.<br>
          data 폴더의 뉴스 JSON 파일을 확인하세요.
        </div>`;
      note.textContent = "오류가 계속되면 GitHub Actions 데이터 생성 결과를 확인하세요.";
    }
  }

  function closePanel() {
    const overlay = document.querySelector("#weeklyReportOverlay");
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  }

  async function loadReportItems() {
    const all = [];
    const meta = [];

    for (const source of REPORT_SOURCE_FILES) {
      try {
        const data = await fetchJson(source.url);
        if (!data) {
          meta.push({ ...source, ok: false, count: 0 });
          continue;
        }

        const normalized = normalizePayload(data, source);
        all.push(...normalized);
        meta.push({ ...source, ok: true, count: normalized.length });
      } catch (err) {
        console.warn("weekly report source skipped", source.url, err);
        meta.push({ ...source, ok: false, count: 0 });
      }
    }

    return { items: all, meta };
  }

  async function fetchJson(url) {
    const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  }

  function normalizePayload(data, source) {
    if (source.type === "com") return normalizeComPayload(data, source);
    if (source.type === "sns") return normalizeSnsPayload(data, source);
    return normalizeNewsPayload(data, source);
  }

  function normalizeNewsPayload(data, source) {
    const articles = Array.isArray(data.articles) ? data.articles : [];

    return articles.map((article, index) => {
      const titleOriginal = article.title_original || article.title || article.titleKo || article.title_ko || "제목 없음";
      const titleKo = cleanText(article.title_ko || article.titleKo || article.title || titleOriginal);
      const summaryKo = cleanText(article.summary_ko || article.summaryKo || article.description || article.summary || "요약 정보가 없습니다.");
      const date = article.published_date || article.publishedAt || article.date_found || data.generatedAt || "";
      const text = [titleOriginal, titleKo, summaryKo, article.source, article.query, ...(article.keywords || [])].join(" ");
      const category = classifyItem(text, source.type);
      const reportScore = scoreItem({
        text,
        category,
        sourceType: source.type,
        importance: Number(article.importance_score || article.relevanceScore || 50),
      });

      return {
        id: `news-${source.type}-${hashString(`${article.url || titleOriginal}-${date}-${index}`)}`,
        type: source.type,
        date,
        source: article.source || source.label,
        country: article.country || (source.type === "domestic" ? "Korea" : "Iraq"),
        title: normalizeBismayahText(titleKo),
        originalTitle: titleOriginal,
        summary: normalizeBismayahText(summaryKo),
        url: article.url || "#",
        category,
        importance: Number(article.importance_score || article.relevanceScore || 50),
        reportScore,
        keywords: article.keywords || article.matchedRules || [],
      };
    });
  }

  function normalizeComPayload(data, source) {
    const articles = Array.isArray(data.articles)
      ? data.articles
      : Array.isArray(data.sections && data.sections.com)
        ? data.sections.com
        : [];

    const out = [];

    articles.forEach((article, articleIndex) => {
      const ministries = Array.isArray(article.ministries) ? article.ministries : [];

      if (!ministries.length) {
        const text = [article.title_ko, article.summary_ko, article.source].join(" ");
        const category = classifyItem(text, "com");
        out.push({
          id: `com-${hashString(`${article.id || article.url || articleIndex}`)}`,
          type: "com",
          date: article.published_date || article.date_found || data.generated_at || "",
          source: "COM 주요활동",
          country: "Iraq",
          title: cleanText(article.title_ko || "COM 주요활동"),
          originalTitle: article.title_original || "نشرة النشاط الحكومي",
          summary: cleanText(article.summary_ko || "요약 정보가 없습니다."),
          url: article.url || data.source_url || "#",
          category,
          importance: Number(article.importance_score || 70),
          reportScore: scoreItem({ text, category, sourceType: "com", importance: Number(article.importance_score || 70) }),
          keywords: article.keywords || ["COM"],
        });
        return;
      }

      ministries.forEach((ministry, mIndex) => {
        const ministryName = cleanText(displayMinistryName(ministry.ministry_ko, ministry.ministry_ar));
        const summary = cleanText(ministry.summary_ko || article.summary_ko || "요약 정보가 없습니다.");
        const title = `${ministryName || "정부기관"} 주요활동`;
        const text = [title, summary, ministry.category, ministry.ministry_ar, ...(ministry.keyword_hits || [])].join(" ");
        const category = classifyItem(text, "com");
        const importance = Number(ministry.priority_score || article.importance_score || 70);

        out.push({
          id: `com-${hashString(`${article.id || article.url || articleIndex}-${mIndex}-${summary}`)}`,
          type: "com",
          date: article.published_date || article.date_found || data.generated_at || "",
          source: "COM 주요활동",
          country: "Iraq",
          title,
          originalTitle: article.title_original || "نشرة النشاط الحكومي",
          summary,
          url: article.url || data.source_url || "#",
          category,
          importance,
          reportScore: scoreItem({ text, category, sourceType: "com", importance }),
          keywords: ministry.keyword_hits || article.keywords || ["COM"],
        });
      });
    });

    return out;
  }

  function normalizeSnsPayload(data, source) {
    const items = Array.isArray(data.items) ? data.items : [];

    return items
      .filter((item) => {
        const analysis = item.analysis || {};
        if (analysis.is_bismayah_related === false) return false;
        if (analysis.iraq_related === false) return false;
        return true;
      })
      .map((item, index) => {
        const analysis = item.analysis || {};
        const title = cleanText(analysis.title_ko || "SNS 비스마야 동향");
        const summary = cleanText(analysis.summary_ko || analysis.translation_ko || item.original_text || "요약 정보가 없습니다.");
        const text = [title, summary, item.original_text, analysis.issue_type, ...(analysis.keywords_ko || [])].join(" ");
        const category = classifyItem(text, "sns");
        const importance = Number(analysis.importance || analysis.relevance || 30) * 10;

        return {
          id: `sns-${hashString(`${item.id || item.url || index}`)}`,
          type: "sns",
          date: item.created_at || item.collected_at || data.updated_at || "",
          source: item.source || "SNS",
          country: "Iraq",
          title: normalizeBismayahText(title),
          originalTitle: item.original_text || "",
          summary: normalizeBismayahText(summary),
          url: item.url || "#",
          category: category === "other" ? "bismayah" : category,
          importance,
          reportScore: scoreItem({ text, category: category === "other" ? "bismayah" : category, sourceType: "sns", importance }),
          keywords: analysis.keywords_ko || [],
        };
      });
  }

  function getReportPeriod(items) {
    const dates = items
      .map((item) => parseDate(item.date))
      .filter(Boolean)
      .sort((a, b) => b - a);

    const end = dates[0] || new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date(end);
    start.setDate(start.getDate() - (REPORT_WINDOW_DAYS - 1));
    start.setHours(0, 0, 0, 0);

    return { start, end };
  }

  function isWithinPeriod(value, period) {
    const d = parseDate(value);
    if (!d) return false;
    return d >= period.start && d <= period.end;
  }

  function uniqueReportItems(items) {
    const map = new Map();

    for (const item of items) {
      const key = normalizeKey(item.url && item.url !== "#" ? item.url : `${item.title}-${item.summary}`);
      const old = map.get(key);
      if (!old || item.reportScore > old.reportScore) {
        map.set(key, item);
      }
    }

    return [...map.values()].sort((a, b) => {
      const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (categoryDiff) return categoryDiff;
      return b.reportScore - a.reportScore || new Date(b.date) - new Date(a.date);
    });
  }

  function getDefaultSelection(items) {
    const picked = new Set();

    for (const category of CATEGORY_ORDER) {
      const limit = DEFAULT_PICK_LIMIT[category] || 4;
      const group = items
        .filter((item) => item.category === category)
        .sort((a, b) => b.reportScore - a.reportScore)
        .slice(0, limit);

      group.forEach((item) => picked.add(item.id));
    }

    return picked;
  }

  function renderPanel() {
    const body = document.querySelector("#weeklyReportBody");
    const note = document.querySelector("#weeklyReportNote");

    if (!state.items.length) {
      body.innerHTML = `
        <div class="weekly-report-empty">
          최근 7일 기준으로 보고서에 넣을 후보가 없습니다.<br>
          뉴스 수집 workflow를 먼저 실행하거나 기간 필터를 확인하세요.
        </div>`;
      note.textContent = "보고서 생성을 위해 최근 7일치 기사 또는 COM/SNS 데이터가 필요합니다.";
      return;
    }

    const selectedCount = state.selected.size;
    const groups = groupByCategory(state.items);
    const periodText = `${formatDateKo(state.period.start)} ~ ${formatDateKo(state.period.end)}`;
    const sourceText = state.payloadMeta
      .filter((m) => m.ok)
      .map((m) => `${m.label} ${m.count}건`)
      .join(" · ") || "수집 데이터 없음";

    note.textContent = `선택 ${selectedCount}건 / 후보 ${state.items.length}건 · ${periodText}`;

    const groupHtml = CATEGORY_ORDER
      .filter((category) => groups[category] && groups[category].length)
      .map((category) => {
        const items = groups[category];
        const selectedInGroup = items.filter((item) => state.selected.has(item.id)).length;
        return `
          <section class="weekly-report-group">
            <div class="weekly-report-group-head">
              <strong>${escapeHtml(CATEGORY_LABELS[category])}</strong>
              <span>${selectedInGroup}/${items.length}건 선택</span>
            </div>
            <div class="weekly-report-item-list">
              ${items.map(renderReportItem).join("")}
            </div>
          </section>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="weekly-report-summary">
        <div class="weekly-report-summary-card"><span>보고 기간</span><strong>${escapeHtml(periodText)}</strong></div>
        <div class="weekly-report-summary-card"><span>후보 항목</span><strong>${state.items.length.toLocaleString()}건</strong></div>
        <div class="weekly-report-summary-card"><span>선택 항목</span><strong>${selectedCount.toLocaleString()}건</strong></div>
        <div class="weekly-report-summary-card"><span>생성 파일</span><strong>DOCX</strong></div>
      </div>
      <div class="weekly-report-summary-card" style="margin-bottom:16px;"><span>참고 데이터</span><strong style="font-size:14px; line-height:1.55;">${escapeHtml(sourceText)}</strong></div>
      <div class="weekly-report-groups">${groupHtml}</div>
    `;

    body.querySelectorAll("[data-report-item]").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const id = event.target.dataset.reportItem;
        if (event.target.checked) state.selected.add(id);
        else state.selected.delete(id);
        renderPanel();
      });
    });
  }

  function renderReportItem(item) {
    const checked = state.selected.has(item.id) ? "checked" : "";
    return `
      <label class="weekly-report-item">
        <input type="checkbox" data-report-item="${escapeAttr(item.id)}" ${checked} />
        <div>
          <div class="weekly-report-item-meta">
            <span>${escapeHtml(formatMonthDay(item.date))}</span>
            <span>·</span>
            <span>${escapeHtml(item.source)}</span>
            <span>·</span>
            <span>점수 ${Math.round(item.reportScore)}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.summary)}</p>
        </div>
      </label>
    `;
  }

  function downloadWeeklyDocx() {
    const selected = state.items
      .filter((item) => state.selected.has(item.id))
      .sort((a, b) => new Date(a.date) - new Date(b.date) || b.reportScore - a.reportScore);

    if (!selected.length) {
      window.alert("보고서에 넣을 항목을 1개 이상 선택해 주세요.");
      return;
    }

    const report = buildReportModel(selected, state.period);
    const blob = buildDocx(report);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `이라크_주간_종합상황보고_${formatFileDate(report.period.end)}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildReportModel(items, period) {
    const grouped = groupByCategory(items);
    const politicsItems = [
      ...(grouped.bismayah || []),
      ...(grouped.construction || []),
      ...(grouped.politics || []),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    const securityItems = (grouped.security || []).sort((a, b) => new Date(a.date) - new Date(b.date));
    const economyItems = (grouped.economy || []).sort((a, b) => new Date(a.date) - new Date(b.date));
    const regionalItems = (grouped.regional || []).sort((a, b) => new Date(a.date) - new Date(b.date));
    const otherItems = (grouped.other || []).sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      title: `건설, 이라크 주간 종합 상황보고(${formatReportPeriod(period)})`,
      dateText: formatReportDate(new Date()),
      period,
      politicsItems,
      securityItems,
      economyItems,
      regionalItems,
      otherItems,
      impactItems: buildImpactItems(grouped),
      securityTable: buildSecurityIssueTable(securityItems),
    };
  }

  function buildImpactItems(grouped) {
    const impacts = [];

    if ((grouped.security || []).length) {
      impacts.push("이라크 內 치안·테러·시위 관련 이슈가 확인됨에 따라 임직원 외부 업무 시 사전 위협 분석, 이동경호지원 및 안전 통제 강화 필요");
    }

    if ((grouped.bismayah || []).length || (grouped.construction || []).length) {
      impacts.push("비스마야·주택·인프라 및 이라크 정부 사업 관련 동향은 BNCP 재개, 인수, 인프라 공급 및 발주처 협의 일정에 미칠 영향 지속 관찰 필요");
    }

    if ((grouped.politics || []).length) {
      impacts.push("총리실·내각·의회·정당 관련 정치 동향은 투자사업 승인, 예산 집행, 정부 의사결정 일정에 영향을 줄 수 있어 주요 인사 발언 및 내각회의 결과 확인 필요");
    }

    if ((grouped.economy || []).length) {
      impacts.push("국제유가, 예산, 전력·에너지 관련 동향은 이라크 재정 여력 및 공공 프로젝트 집행 환경과 연계되므로 유가·재정 관련 지표 모니터링 지속 필요");
    }

    if ((grouped.regional || []).length) {
      impacts.push("미국·이란·시리아·이스라엘 등 중동 주요 정세 변화가 이라크 안보와 외교적 균형에 영향을 줄 수 있어 지역 확전 가능성 및 이라크 정부 대응 확인 필요");
    }

    impacts.push("각종 언론보도 및 정부 공식자료는 자동 수집·요약 기반이므로 중요 사안은 원문 및 발주처 공식 자료를 통해 재확인 필요");

    return impacts;
  }

  function buildSecurityIssueTable(items) {
    const counts = {
      total: items.length,
      is: 0,
      protest: 0,
      armed: 0,
      crime: 0,
    };

    for (const item of items) {
      const t = normalizeSearchText(`${item.title} ${item.summary} ${item.keywords.join(" ")}`);
      if (/is\b|isis|داعش|테러|terror|폭발|ied/.test(t)) counts.is += 1;
      if (/시위|protest|مظاهرة|احتجاج/.test(t)) counts.protest += 1;
      if (/총격|공습|drone|rocket|armed|militia|무장|اشتباك|قصف|صاروخ/.test(t)) counts.armed += 1;
      if (/납치|kidnap|خطف|범죄|crime|اعتقال|체포/.test(t)) counts.crime += 1;
    }

    return counts;
  }

  function buildDocx(report) {
    const files = {
      "[Content_Types].xml": contentTypesXml(),
      "_rels/.rels": rootRelsXml(),
      "word/_rels/document.xml.rels": documentRelsXml(),
      "word/document.xml": documentXml(report),
      "word/styles.xml": stylesXml(),
      "word/settings.xml": settingsXml(),
    };

    const zipBytes = createZip(files);
    return new Blob([zipBytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  function documentXml(report) {
    const parts = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
    parts.push(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`);
    parts.push(`<w:body>`);

    parts.push(p(report.title, { align: "center", bold: true, size: 32, after: 120 }));
    parts.push(p(report.dateText, { align: "right", size: 24, after: 320 }));

    parts.push(heading("1. 이라크 국내 상황", 1));
    parts.push(heading("1) 정국 / 치안", 2));
    parts.push(p("· 정치권 동향", { bold: true, size: 26, after: 80 }));

    if (report.politicsItems.length) {
      report.politicsItems.forEach((item) => parts.push(...itemToDocxParagraphs(item)));
    } else {
      parts.push(p("· 특이 동향 없음", { indent: 240 }));
    }

    parts.push(p("· 수집 기사 기준 치안 이슈", { bold: true, size: 26, after: 80 }));
    parts.push(securityTableXml(report.securityTable));
    parts.push(p("※ 위 표는 자동 수집 기사·SNS 기준의 참고 건수이며, 공식 테러 통계가 아닙니다.", { size: 22, color: "6B7280", after: 120 }));

    if (report.securityItems.length) {
      report.securityItems.forEach((item) => parts.push(...itemToDocxParagraphs(item)));
    } else {
      parts.push(p("· 특이 동향 없음", { indent: 240 }));
    }

    parts.push(heading("2) 경제", 2));
    parts.push(p("· 국제유가 및 경제 관련 동향", { bold: true, size: 26, after: 80 }));
    if (report.economyItems.length) {
      report.economyItems.forEach((item) => parts.push(...itemToDocxParagraphs(item)));
    } else {
      parts.push(p("· 특이 동향 없음", { indent: 240 }));
    }

    parts.push(heading("2. 국제사회", 1));
    parts.push(p("· 중동 주요 정세", { bold: true, size: 26, after: 80 }));
    if (report.regionalItems.length) {
      report.regionalItems.forEach((item) => parts.push(...itemToDocxParagraphs(item)));
    } else {
      parts.push(p("· 특이 동향 없음", { indent: 240 }));
    }

    if (report.otherItems.length) {
      parts.push(p("· 기타 참고 동향", { bold: true, size: 26, after: 80 }));
      report.otherItems.forEach((item) => parts.push(...itemToDocxParagraphs(item)));
    }

    parts.push(heading("3. 그룹 / 건설에 미치는 영향", 1));
    report.impactItems.forEach((text) => parts.push(p(`· ${text}`, { indent: 120, size: 26, after: 80 })));

    parts.push(sectionPropertiesXml());
    parts.push(`</w:body></w:document>`);

    return parts.join("");
  }

  function itemToDocxParagraphs(item) {
    const dateText = formatMonthDay(item.date);
    const title = normalizeReportSentence(item.title);
    const summary = normalizeReportSentence(item.summary);
    const out = [];

    out.push(p(`· ${dateText}, ${title}`, { indent: 120, size: 26, after: 40 }));
    if (summary && summary !== title) {
      out.push(p(`* ${summary}`, { indent: 360, size: 24, after: 40 }));
    }

    const insight = buildItemInsight(item);
    if (insight) {
      out.push(p(`☞ ${insight}`, { indent: 360, size: 24, after: 100 }));
    }

    return out;
  }

  function buildItemInsight(item) {
    if (item.category === "bismayah") return "BNCP 직접 관련 가능성이 있어 원문 및 발주처 공식 입장 확인 필요";
    if (item.category === "construction") return "주택·인프라 사업 환경 변화 가능성 관찰 필요";
    if (item.category === "security") return "현장 및 바그다드 외부 업무 시 동선·경호 리스크 점검 필요";
    if (item.category === "politics" && item.reportScore >= 75) return "정부 의사결정 및 투자사업 승인 일정에 미칠 영향 관찰 필요";
    if (item.category === "economy" && item.reportScore >= 70) return "정부 재정 여건 및 프로젝트 집행 환경과 연계 가능성 확인 필요";
    if (item.category === "regional" && item.reportScore >= 75) return "이라크 안보·외교 균형에 대한 파급 가능성 지속 모니터링 필요";
    return "";
  }

  function p(text, options = {}) {
    const align = options.align || "left";
    const size = options.size || 26;
    const bold = options.bold ? "<w:b/>" : "";
    const color = options.color ? `<w:color w:val="${options.color}"/>` : "";
    const after = options.after ?? 80;
    const indent = options.indent || 0;
    const jc = align !== "left" ? `<w:jc w:val="${align}"/>` : "";
    const ind = indent ? `<w:ind w:left="${indent}"/>` : "";

    return `<w:p><w:pPr>${jc}${ind}<w:spacing w:after="${after}" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:rPr>${runFonts()}${bold}${color}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  function heading(text, level) {
    return p(text, {
      bold: true,
      size: level === 1 ? 30 : 28,
      after: level === 1 ? 160 : 100,
    });
  }

  function runFonts() {
    return `<w:rFonts w:ascii="Batang" w:hAnsi="Batang" w:eastAsia="바탕" w:cs="Batang"/>`;
  }

  function securityTableXml(counts) {
    const headers = ["구분", "계", "IS/테러", "시위", "무장충돌/공격", "납치/범죄"];
    const values = ["건수", counts.total, counts.is, counts.protest, counts.armed, counts.crime].map(String);
    return tableXml([headers, values]);
  }

  function tableXml(rows) {
    const rowXml = rows.map((row, rowIndex) => {
      const cells = row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${p(cell, { align: "center", bold: rowIndex === 0, size: 22, after: 0 })}</w:tc>`).join("");
      return `<w:tr>${cells}</w:tr>`;
    }).join("");

    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>${rowXml}</w:tbl>`;
  }

  function sectionPropertiesXml() {
    return `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  }

  function contentTypesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  }

  function documentRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${runFonts()}<w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr>${runFonts()}<w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style></w:styles>`;
  }

  function settingsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>`;
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const entries = [];
    let offset = 0;
    const fileParts = [];
    const centralParts = [];

    for (const [name, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(name);
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const crc = crc32(data);
      const mod = dosDateTime(new Date());

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const local = new DataView(localHeader.buffer);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, mod.time, true);
      local.setUint16(12, mod.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      fileParts.push(localHeader, data);
      entries.push({ nameBytes, dataLength: data.length, crc, offset, mod });
      offset += localHeader.length + data.length;
    }

    let centralSize = 0;
    for (const entry of entries) {
      const header = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, entry.mod.time, true);
      view.setUint16(14, entry.mod.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.dataLength, true);
      view.setUint32(24, entry.dataLength, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.offset, true);
      header.set(entry.nameBytes, 46);
      centralParts.push(header);
      centralSize += header.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    const totalLength = fileParts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
    const zip = new Uint8Array(totalLength);
    let cursor = 0;

    for (const part of fileParts) {
      zip.set(part, cursor);
      cursor += part.length;
    }
    for (const part of centralParts) {
      zip.set(part, cursor);
      cursor += part.length;
    }
    zip.set(end, cursor);

    return zip;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = Math.floor(date.getSeconds() / 2);
    return {
      date: ((year - 1980) << 9) | (month << 5) | day,
      time: (hour << 11) | (minute << 5) | second,
    };
  }

  function classifyItem(text, sourceType) {
    const t = normalizeSearchText(text);

    if (/비스마야|bismayah|bismaya|basmaya|bncp|بسماية|بسمايه|بسمایه|hanwha|한화|هانوا|national investment commission|الهيئة الوطنية للاستثمار|\bnic\b/.test(t)) {
      return "bismayah";
    }

    if (/isis|\bis\b|داعش|terror|terrorism|테러|폭발|ied|무장|militia|pmf|الحشد|인민동원군|총격|공습|드론|rocket|로켓|납치|kidnap|시위|protest|치안|보안|border|국경|sdf|sna/.test(t)) {
      return "security";
    }

    if (/oil|opec|brent|wti|dubai|유가|원유|석유|가스|gas|energy|전력|전기|예산|재정|경제|economy|budget|imf|world bank|달러|환율|금융|bank/.test(t)) {
      return "economy";
    }

    if (/housing|residential|new city|construction|infrastructure|project|contract|investment|주택|신도시|건설|인프라|투자|계약|수주|발주|재건|상수도|도로|교량|وزارة الاعمار|وزارة الإعمار|الاسكان|الإسكان|مشروع|استثمار|عقد/.test(t)) {
      return "construction";
    }

    if (/iran|syria|israel|gaza|hamas|houthi|lebanon|yemen|middle east|trump|khamenei|hezbollah|이란|시리아|이스라엘|가자|하마스|후티|헤즈볼라|중동|미국|사우디|튀르키예/.test(t) && !/iraq|العراق|이라크|baghdad|بغداد/.test(t)) {
      return "regional";
    }

    if (/sudani|السوداني|prime minister|cabinet|council of ministers|parliament|election|party|court|정부|총리|내각|의회|선거|정당|대법원|정치|주지사|governor|maliki|sadr|halabousi|시아|수니/.test(t) || sourceType === "com") {
      return "politics";
    }

    if (/iran|syria|israel|gaza|hamas|houthi|lebanon|yemen|middle east|trump|khamenei|hezbollah|이란|시리아|이스라엘|가자|하마스|후티|헤즈볼라|중동|미국|사우디|튀르키예/.test(t)) {
      return "regional";
    }

    return "other";
  }

  function scoreItem({ text, category, sourceType, importance }) {
    let score = Number(importance || 50);
    const t = normalizeSearchText(text);

    if (category === "bismayah") score += 35;
    if (category === "security") score += 22;
    if (category === "politics") score += 18;
    if (category === "construction") score += 18;
    if (category === "economy") score += 12;
    if (category === "regional") score += 10;

    if (sourceType === "com") score += 16;
    if (sourceType === "sns") score -= 8;
    if (sourceType === "weekly") score += 8;

    if (/총리|내각|의회|선거|sudani|cabinet|parliament|prime minister|السوداني/.test(t)) score += 12;
    if (/is\b|isis|داعش|테러|terror|공격|attack|폭발|border|국경/.test(t)) score += 12;
    if (/비스마야|bismayah|بسماية|hanwha|한화|nic|national investment commission/.test(t)) score += 18;
    if (/공식|발표|승인|지시|회의|계약|체결|approved|announced|signed|اجتماع|توقيع/.test(t)) score += 8;

    return Math.max(0, score);
  }

  function groupByCategory(items) {
    return items.reduce((acc, item) => {
      const category = item.category || "other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});
  }

  function displayMinistryName(ko, ar) {
    const text = `${ko || ""} ${ar || ""}`;
    const normalized = normalizeSearchText(text);
    if (/كمارك|جمارك|관세/.test(normalized)) return "관세청";
    if (/وزارة المالية|재무/.test(normalized)) return "재무부";
    if (/وزارة الاعمار|وزارة الإعمار|재건|주택/.test(normalized)) return "재건주택부";
    if (/وزارة التخطيط|기획/.test(normalized)) return "기획부";
    if (/وزارة الكهرباء|전기/.test(normalized)) return "전기부";
    if (/وزارة النفط|석유/.test(normalized)) return "석유부";
    if (/هيئة النزاهة|청렴/.test(normalized)) return "청렴위원회";
    return cleanText(ko || ar || "기관명 미상");
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDateKo(date) {
    const d = parseDate(date);
    if (!d) return "-";
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }

  function formatReportDate(date) {
    const d = parseDate(date);
    if (!d) return "";
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  }

  function formatFileDate(date) {
    const d = parseDate(date) || new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function formatReportPeriod(period) {
    return `${formatShortReportDate(period.start)} ~ ${formatShortReportDate(period.end)}`;
  }

  function formatShortReportDate(date) {
    const d = parseDate(date);
    if (!d) return "-";
    return `΄${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
  }

  function formatMonthDay(value) {
    const d = parseDate(value);
    if (!d) return "날짜미상";
    return `${d.getMonth() + 1}.${d.getDate()}`;
  }

  function cleanText(value) {
    return normalizeBismayahText(String(value || ""))
      .replace(/\s+/g, " ")
      .replace(/\s+([,.])$/g, "$1")
      .trim();
  }

  function normalizeReportSentence(value) {
    const text = cleanText(value)
      .replace(/\.$/, "")
      .replace(/입니다$/, "임")
      .replace(/했습니다$/, "함")
      .replace(/하였습니다$/, "함")
      .replace(/되었습니다$/, "됨")
      .replace(/됐습니다$/, "됨")
      .replace(/있습니다$/, "있음")
      .replace(/없습니다$/, "없음")
      .replace(/강조했습니다$/, "강조")
      .replace(/발표했습니다$/, "발표")
      .replace(/밝혔습니다$/, "밝힘")
      .replace(/논의했습니다$/, "논의")
      .replace(/체결했습니다$/, "체결")
      .replace(/승인했습니다$/, "승인");

    return text || "요약 정보 없음";
  }

  function normalizeBismayahText(value) {
    if (!value) return value;
    return String(value)
      .replace(/(^|[^\u0600-\u06FF])ب[\u0640\s\u064B-\u065F\u0670]*س[\u0640\s\u064B-\u065F\u0670]*م[\u0640\s\u064B-\u065F\u0670]*ا[\u0640\s\u064B-\u065F\u0670]*[يىی][\u0640\s\u064B-\u065F\u0670]*[ةه](?=$|[^\u0600-\u06FF])/g, "$1비스마야")
      .replace(/\bBismayah\b/gi, "비스마야")
      .replace(/\bBismaya\b/gi, "비스마야")
      .replace(/\bBasmaya\b/gi, "비스마야");
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/ـ/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[?#].*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function xmlEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
