/**
 * BNCP News UI Patch v4
 *
 * Fixes:
 * - Correct active state for Domestic / Global / SNS / COM cards.
 * - Domestic/Global/SNS/COM buttons load their own JSON.
 * - Existing app.js may still exist; this patch overrides the visible result area after click.
 * - COM category is rendered date-by-date using <details>.
 */

(function () {
  const CATEGORY_FILES = {
    domestic: "./data/domestic-news.json",
    overseas: "./data/overseas-news.json",
    sns: "./data/sns-news.json",
    com: "./data/com-news.json"
  };

  const CATEGORY_LABELS = {
    domestic: "국내 언론사",
    overseas: "글로벌 언론사",
    sns: "SNS",
    com: "COM 주요활동"
  };

  const CATEGORY_DESCRIPTIONS = {
    domestic: "구글 한국 뉴스 기준, 최근 1주일 사이 관련 키워드가 기사에 명시된 결과를 표시합니다.",
    overseas: "이라크·아랍어권 언론 기준, بسماية / هانوا / الهيئة الوطنية للاستثمار 등 관련 기사를 표시합니다.",
    sns: "SNS는 일반 검색 수집을 중단했습니다. 관련 없는 게시글 방지를 위해 공식/감시 대상 계정 등록이 필요합니다.",
    com: "이라크 내각 사무처의 일일 정부활동 자료를 날짜별로 정리합니다. 건설·투자·주택·인프라 관련 내용을 우선 표시합니다."
  };

  function clean(s) {
    return String(s || "").replace(/\s+/g, "").toLowerCase();
  }

  function detectCategory(target) {
    let el = target;
    for (let i = 0; el && i < 7; i++, el = el.parentElement) {
      const explicit = el.getAttribute?.("data-news-category");
      if (explicit && CATEGORY_FILES[explicit]) return explicit;

      const raw = [
        el.id,
        el.className,
        el.getAttribute?.("data-category"),
        el.getAttribute?.("data-source"),
        el.getAttribute?.("aria-label"),
        el.textContent
      ].join(" ");
      const t = clean(raw);

      // Check precise labels first. Do not detect from the whole body.
      if (t.includes("국내언론사") || t.includes("국내언론") || t.includes("korea")) return "domestic";
      if (t.includes("글로벌언론사") || t.includes("글로벌언론") || t.includes("global")) return "overseas";
      if (t.includes("sns") || t.includes("social")) return "sns";
      if (t.includes("com주요활동") || t === "com" || t.includes("cabinet")) return "com";
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function formatDate(value, dateOnly = false) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", dateOnly ? {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    } : {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(d);
  }

  function categoryCardElements() {
    const candidates = Array.from(document.querySelectorAll("section, article, div, button, a"));
    return candidates.filter((el) => {
      const t = clean(el.textContent);
      return (
        t.includes("국내언론사") ||
        t.includes("글로벌언론사") ||
        t.includes("sns") ||
        t.includes("com주요활동")
      );
    }).filter((el) => {
      // Prefer reasonably card-sized elements, not whole body/main.
      const r = el.getBoundingClientRect();
      return r.width > 120 && r.width < window.innerWidth * 0.6 && r.height > 40 && r.height < 240;
    });
  }

  function setActive(category) {
    for (const el of categoryCardElements()) {
      const c = detectCategory(el);
      if (!c) continue;

      el.setAttribute("data-news-category", c);
      el.style.cursor = "pointer";

      if (c === category) {
        el.style.border = "2px solid #f97316";
        el.style.boxShadow = "0 16px 34px rgba(249, 115, 22, .16)";
      } else {
        el.style.border = "1px solid rgba(15, 23, 42, .10)";
        el.style.boxShadow = "";
      }
    }
  }

  function installStyles() {
    if (document.querySelector("#bncpPatchV4Style")) return;
    const style = document.createElement("style");
    style.id = "bncpPatchV4Style";
    style.textContent = `
      .bncp-patch-card {
        display: block;
        padding: 18px 20px;
        margin: 0 0 14px 0;
        border: 1px solid rgba(15, 23, 42, .10);
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 10px 26px rgba(15, 23, 42, .06);
      }
      .bncp-patch-title {
        color: #0f172a;
        text-decoration: none;
        font-size: 18px;
        font-weight: 850;
        line-height: 1.45;
      }
      .bncp-patch-title:hover { text-decoration: underline; }
      .bncp-patch-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-top: 10px;
        color: #64748b;
        font-size: 13px;
        font-weight: 650;
      }
      .bncp-patch-query { color: #f97316; }
      .bncp-patch-desc {
        margin: 10px 0 0 0;
        color: #475569;
        line-height: 1.55;
        font-size: 14px;
      }
      .bncp-patch-loading,
      .bncp-patch-empty {
        padding: 18px 20px;
        border: 1px solid rgba(15, 23, 42, .10);
        border-radius: 18px;
        background: #fff;
        color: #64748b;
        font-weight: 700;
      }
      .bncp-com-day {
        margin: 0 0 14px 0;
        border: 1px solid rgba(15, 23, 42, .10);
        border-radius: 18px;
        background: #fff;
        overflow: hidden;
        box-shadow: 0 10px 26px rgba(15, 23, 42, .06);
      }
      .bncp-com-day summary {
        cursor: pointer;
        padding: 16px 20px;
        font-weight: 900;
        color: #0f172a;
      }
      .bncp-com-day-inner {
        padding: 0 20px 18px 20px;
      }
      .bncp-com-summary {
        white-space: pre-line;
        line-height: 1.65;
        color: #334155;
        margin-top: 10px;
      }
      .bncp-com-raw {
        direction: rtl;
        text-align: right;
        white-space: pre-line;
        line-height: 1.8;
        color: #475569;
        margin-top: 10px;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureNewsList() {
    let list =
      document.querySelector("#newsList") ||
      document.querySelector("#news-list") ||
      document.querySelector(".news-list") ||
      document.querySelector("[data-news-list]");

    if (list) return list;

    list = document.createElement("div");
    list.id = "newsList";
    list.className = "news-list";

    const main = document.querySelector("main") || document.body;
    main.appendChild(list);
    return list;
  }

  function updateVisibleLabels(category, count) {
    const badge = document.querySelector("#resultCountBadge");
    if (badge) badge.textContent = `${count}건`;

    const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
    const topHeading = headings.find((h) => {
      const t = clean(h.textContent);
      return t.includes("국내언론사") || t.includes("글로벌언론사") || t.includes("sns") || t.includes("com주요활동");
    });
    if (topHeading) topHeading.textContent = CATEGORY_LABELS[category];

    const latestHeading = headings.find((h) => clean(h.textContent).includes("최근뉴스") || clean(h.textContent).includes("글로벌언론사뉴스"));
    if (latestHeading) {
      latestHeading.textContent = category === "com" ? "COM 주요활동 요약" : `${CATEGORY_LABELS[category]} 뉴스`;
    }

    const descCandidates = Array.from(document.querySelectorAll("p, .desc, .subtitle"));
    const desc = descCandidates.find((p) => {
      const t = clean(p.textContent);
      return t.includes("구글") || t.includes("키워드") || t.includes("업데이트예정");
    });
    if (desc) desc.textContent = CATEGORY_DESCRIPTIONS[category];

    // Dashboard stat cards in existing app.js may not have ids, so update only text badges conservatively.
  }

  function renderLoading(category) {
    installStyles();
    setActive(category);
    updateVisibleLabels(category, 0);
    ensureNewsList().innerHTML = `<div class="bncp-patch-loading">${escapeHtml(CATEGORY_LABELS[category])} 데이터를 불러오는 중입니다...</div>`;
  }

  function renderStandard(category, payload) {
    const list = ensureNewsList();
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    updateVisibleLabels(category, articles.length);

    if (!articles.length) {
      list.innerHTML = `<div class="bncp-patch-empty">${escapeHtml(payload?.messageKo || CATEGORY_DESCRIPTIONS[category] || "표시할 데이터가 없습니다.")}</div>`;
      return;
    }

    list.innerHTML = articles.map((item) => {
      const title = item.titleKo || item.title || "제목 없음";
      const summary = item.summaryKo || item.description || "";
      return `
        <article class="bncp-patch-card">
          <a class="bncp-patch-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(title)}
          </a>
          <div class="bncp-patch-meta">
            <span>${escapeHtml(item.source || "출처 미상")}</span>
            <span>${escapeHtml(formatDate(item.publishedAt))}</span>
            ${item.query ? `<span class="bncp-patch-query">${escapeHtml(item.query)}</span>` : ""}
          </div>
          ${summary ? `<p class="bncp-patch-desc">${escapeHtml(summary)}</p>` : ""}
        </article>
      `;
    }).join("");
  }

  function renderCom(payload) {
    const list = ensureNewsList();
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];
    updateVisibleLabels("com", articles.length);

    if (!articles.length) {
      list.innerHTML = `<div class="bncp-patch-empty">COM 주요활동 데이터가 없습니다. cabinet.iq 수집 로그를 확인하세요.</div>`;
      return;
    }

    const byDate = new Map();
    for (const item of articles) {
      const key = formatDate(item.publishedAt, true);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(item);
    }

    list.innerHTML = [...byDate.entries()].map(([date, items], idx) => `
      <details class="bncp-com-day" ${idx === 0 ? "open" : ""}>
        <summary>${escapeHtml(date)} · ${items.length}건</summary>
        <div class="bncp-com-day-inner">
          ${items.map((item) => `
            <article class="bncp-patch-card">
              <a class="bncp-patch-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(item.titleKo || item.title)}
              </a>
              <div class="bncp-patch-meta">
                <span>${escapeHtml(item.source || "cabinet.iq")}</span>
                <span>건설·투자·주택 우선점수 ${escapeHtml(String(item.priorityScore || 0))}</span>
              </div>
              ${item.summaryKo ? `<div class="bncp-com-summary">${escapeHtml(item.summaryKo)}</div>` : ""}
              ${item.rawSummary ? `<div class="bncp-com-raw">${escapeHtml(item.rawSummary)}</div>` : ""}
            </article>
          `).join("")}
        </div>
      </details>
    `).join("");
  }

  async function loadCategory(category) {
    const file = CATEGORY_FILES[category];
    if (!file) return;

    renderLoading(category);

    try {
      const res = await fetch(`${file}?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const payload = await res.json();
      console.info("[BNCP News Patch v4]", category, payload);

      if (category === "com") renderCom(payload);
      else renderStandard(category, payload);
    } catch (err) {
      ensureNewsList().innerHTML = `<div class="bncp-patch-empty">${escapeHtml(file)} 파일을 불러오지 못했습니다. 오류: ${escapeHtml(err.message || err)}</div>`;
      console.error("[BNCP News Patch v4] failed", category, err);
    }
  }

  document.addEventListener("click", function (event) {
    const category = detectCategory(event.target);
    if (!category) return;

    event.preventDefault();
    event.stopPropagation();
    loadCategory(category);
  }, true);

  function boot() {
    installStyles();
    for (const el of categoryCardElements()) {
      const c = detectCategory(el);
      if (c) {
        el.setAttribute("data-news-category", c);
        el.style.cursor = "pointer";
      }
    }
    setTimeout(() => loadCategory("domestic"), 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.BNCPNewsPatch = { loadCategory };
  console.info("[BNCP News Patch v4] loaded");
})();
