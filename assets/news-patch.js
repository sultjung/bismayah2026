/**
 * BNCP News UI Patch v3
 *
 * Stronger version:
 * - Catches clicks on any element, not only buttons.
 * - Detects Domestic / Global / SNS / COM cards by visible text.
 * - Renders articles into existing #newsList if present.
 * - Updates resultCountBadge and dashboard count boxes when possible.
 * - Auto-loads domestic news once on page load because the Domestic card is the default active tab.
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

  function clean(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function detectCategory(target) {
    let el = target;
    for (let i = 0; el && i < 8; i += 1, el = el.parentElement) {
      const attrs = [
        el.id,
        el.className,
        el.getAttribute?.("data-category"),
        el.getAttribute?.("data-news-category"),
        el.getAttribute?.("data-source"),
        el.getAttribute?.("data-type"),
        el.getAttribute?.("aria-label"),
        el.textContent
      ].join(" ");

      const t = clean(attrs);

      // Domestic
      if (
        t.includes("domestic") ||
        t.includes("korea") ||
        t.includes("kr") ||
        t.includes("국내언론") ||
        t.includes("국내언론사") ||
        t.includes("국내뉴스") ||
        t.includes("korea국내")
      ) return "domestic";

      // Overseas / Global
      if (
        t.includes("overseas") ||
        t.includes("global") ||
        t.includes("world") ||
        t.includes("foreign") ||
        t.includes("글로벌언론") ||
        t.includes("글로벌언론사") ||
        t.includes("해외언론") ||
        t.includes("해외")
      ) return "overseas";

      // SNS
      if (
        t.includes("sns") ||
        t.includes("social") ||
        t.includes("소셜")
      ) return "sns";

      // COM
      if (
        t.includes("com") ||
        t.includes("cabinet") ||
        t.includes("council") ||
        t.includes("주요활동") ||
        t.includes("مجلس")
      ) return "com";
    }
    return null;
  }

  function label(category) {
    return CATEGORY_LABELS[category] || category;
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

  function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(d);
  }

  function findNewsListContainer() {
    return (
      document.querySelector("#newsList") ||
      document.querySelector("#news-list") ||
      document.querySelector("[data-news-list]") ||
      document.querySelector(".news-list") ||
      document.querySelector("#articles") ||
      document.querySelector("#article-list")
    );
  }

  function ensureFallbackContainer() {
    let c = document.querySelector("#newsList");
    if (c) return c;

    c = document.createElement("div");
    c.id = "newsList";
    c.className = "news-list";
    const main = document.querySelector("main") || document.body;
    main.appendChild(c);
    return c;
  }

  function installStyles() {
    if (document.querySelector("#bncpPatchV3Style")) return;
    const style = document.createElement("style");
    style.id = "bncpPatchV3Style";
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
      .bncp-patch-card a {
        color: #0f172a;
        text-decoration: none;
        font-size: 18px;
        font-weight: 850;
        line-height: 1.45;
      }
      .bncp-patch-card a:hover { text-decoration: underline; }
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
    `;
    document.head.appendChild(style);
  }

  function updateHeader(category, count) {
    const h2s = Array.from(document.querySelectorAll("h1,h2,h3"));
    const target = h2s.find(h => clean(h.textContent).includes("최근뉴스")) ||
                   h2s.find(h => clean(h.textContent).includes("국내언론사")) ||
                   h2s.find(h => clean(h.textContent).includes("국내언론"));

    if (target && target.textContent) {
      // Keep it simple: do not destroy surrounding panel layout.
      target.textContent = category === "domestic" ? "최근 뉴스" : `${label(category)} 뉴스`;
    }

    const badge = document.querySelector("#resultCountBadge");
    if (badge) badge.textContent = `${count}건`;

    // Update the visible small stat cards where possible.
    const statLabels = Array.from(document.querySelectorAll("*")).filter(el => {
      const t = clean(el.textContent);
      return t === "전체기사수" || t === "필터적용후" || t === "국가수";
    });

    // Conservative: only update explicit known count badge above.
  }

  function renderLoading(category) {
    installStyles();
    const c = ensureFallbackContainer();
    c.innerHTML = `<div class="bncp-patch-loading">${escapeHtml(label(category))} 데이터를 불러오는 중입니다...</div>`;
  }

  function renderArticles(category, payload) {
    installStyles();
    const c = ensureFallbackContainer();
    const articles = Array.isArray(payload?.articles) ? payload.articles : [];

    updateHeader(category, articles.length);

    if (!articles.length) {
      c.innerHTML = `<div class="bncp-patch-empty">${escapeHtml(label(category))} 결과가 없습니다. data JSON의 articles를 확인하세요.</div>`;
      return;
    }

    c.innerHTML = articles.map(item => `
      <article class="bncp-patch-card">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(item.title)}
        </a>
        <div class="bncp-patch-meta">
          <span>${escapeHtml(item.source || "출처 미상")}</span>
          <span>${escapeHtml(formatDate(item.publishedAt))}</span>
          ${item.query ? `<span class="bncp-patch-query">${escapeHtml(item.query)}</span>` : ""}
        </div>
        ${item.description ? `<p class="bncp-patch-desc">${escapeHtml(item.description)}</p>` : ""}
      </article>
    `).join("");

    console.info("[BNCP News Patch v3] rendered", category, articles.length, "articles");
  }

  async function loadCategory(category) {
    const file = CATEGORY_FILES[category];
    if (!file) return;

    renderLoading(category);

    try {
      const res = await fetch(`${file}?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const payload = await res.json();
      console.info("[BNCP News Patch v3] loaded", category, payload);
      renderArticles(category, payload);
    } catch (err) {
      console.error("[BNCP News Patch v3] load failed", category, err);
      const c = ensureFallbackContainer();
      c.innerHTML = `<div class="bncp-patch-empty">${escapeHtml(file)} 파일을 불러오지 못했습니다. 오류: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  // Catch all clicks. This is intentionally broad because the cards may be divs, not buttons.
  document.addEventListener("click", function (event) {
    const category = detectCategory(event.target);
    if (!category) return;

    event.preventDefault();
    event.stopPropagation();

    loadCategory(category);
  }, true);

  // Add explicit data attributes to likely source cards for future clicks.
  function tagCards() {
    Array.from(document.querySelectorAll("div, section, article, button, a")).forEach(el => {
      const category = detectCategory(el);
      if (category) el.setAttribute("data-news-category", category);
    });
  }

  function boot() {
    installStyles();
    tagCards();

    // Auto-load domestic if the current page already shows the domestic panel.
    // This directly fixes the visible "0건" default state.
    setTimeout(() => {
      const pageText = clean(document.body.textContent);
      if (pageText.includes("국내언론사") || pageText.includes("국내언론")) {
        loadCategory("domestic");
      }
    }, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.BNCPNewsPatch = { loadCategory };
  console.info("[BNCP News Patch v3] loaded");
})();
