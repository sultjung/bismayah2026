(function () {
  const SNS_DATA_URL = "./data/sns-activities.json";
  const MAX_DISPLAY_ITEMS = 12;

  let snsDataCache = null;
  let renderTimer = null;
  let isRendering = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "-";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;

    return d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function number(value) {
    return Number(value || 0).toLocaleString("ko-KR");
  }

  function sentimentLabel(value) {
    const map = {
      positive: "긍정",
      neutral: "중립",
      negative: "부정",
      mixed: "혼합",
      unknown: "불명",
    };

    return map[value] || value || "불명";
  }

  function sentimentClass(value) {
    if (value === "positive") return "positive";
    if (value === "negative") return "negative";
    if (value === "mixed") return "mixed";
    if (value === "neutral") return "neutral";
    return "unknown";
  }

  function issueLabel(value) {
    const map = {
      drainage: "배수",
      electricity: "전기",
      water: "수도",
      maintenance: "유지보수",
      defects: "하자",
      security: "보안",
      transportation: "교통",
      price: "요금/가격",
      occupancy: "입주",
      policy: "정책",
      general: "일반",
      other: "기타",
    };

    return map[value] || value || "기타";
  }

  function getMetric(item, key) {
    return number(item && item.metrics ? item.metrics[key] : 0);
  }

  function normalizeBismayahText(value) {
    if (!value) return value;

    return String(value)
      // بسماية / بسمايه / بسمایه 등 현지식 표기 대응
      // 단, بسما 같은 다른 단어는 건드리지 않음
      .replace(
        /(^|[^\u0600-\u06FF])ب[\u0640\s\u064B-\u065F\u0670]*س[\u0640\s\u064B-\u065F\u0670]*م[\u0640\s\u064B-\u065F\u0670]*ا[\u0640\s\u064B-\u065F\u0670]*[يىی][\u0640\s\u064B-\u065F\u0670]*[ةه](?=$|[^\u0600-\u06FF])/g,
        "$1비스마야"
      )
      .replace(/\bBismayah\b/gi, "비스마야")
      .replace(/\bBismaya\b/gi, "비스마야")
      .replace(/\bBasmaya\b/gi, "비스마야");
  }

  function installStyles() {
    if (document.getElementById("sns-inline-style")) return;

    const style = document.createElement("style");
    style.id = "sns-inline-style";
    style.textContent = `
      #sns-inline-results,
      #sns-inline-results * {
        box-sizing: border-box;
      }

      #sns-inline-results {
        width: 100%;
        max-width: 100%;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        background: transparent !important;
        text-align: left !important;
      }

      .sns-inline-header {
        background: linear-gradient(135deg, #111827, #374151);
        color: #fff;
        border-radius: 18px;
        padding: 22px 24px;
        margin-bottom: 16px;
        box-shadow: 0 14px 30px rgba(15, 23, 42, .14);
      }

      .sns-inline-header-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .sns-inline-header h3 {
        margin: 0;
        color: #fff;
        font-size: 24px;
        line-height: 1.28;
        letter-spacing: -0.04em;
      }

      .sns-inline-header p {
        margin: 0;
        color: rgba(255,255,255,.78);
        font-size: 14px;
        line-height: 1.6;
      }

      .sns-inline-source {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 6px 10px;
        background: rgba(255,255,255,.12);
        color: rgba(255,255,255,.9);
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }

      .sns-inline-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }

      .sns-inline-stat {
        background: #fff;
        border: 1px solid rgba(15, 23, 42, .08);
        border-radius: 14px;
        padding: 14px;
        box-shadow: 0 8px 20px rgba(15, 23, 42, .05);
      }

      .sns-inline-stat strong {
        display: block;
        color: #111827;
        font-size: 23px;
        line-height: 1;
        margin-bottom: 5px;
      }

      .sns-inline-stat span {
        color: #64748b;
        font-size: 13px;
        line-height: 1.35;
      }

      .sns-inline-list {
        display: grid;
        gap: 14px;
      }

      .sns-inline-card {
        background: #fff;
        border: 1px solid rgba(15, 23, 42, .08);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 10px 26px rgba(15, 23, 42, .06);
      }

      .sns-inline-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 10px;
      }

      .sns-inline-title {
        margin: 0;
        color: #111827;
        font-size: 20px;
        line-height: 1.4;
        letter-spacing: -0.03em;
      }

      .sns-inline-meta {
        margin-top: 6px;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.4;
      }

      .sns-inline-badges {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
        min-width: 210px;
      }

      .sns-inline-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 6px 9px;
        background: #f3f4f6;
        color: #374151;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        white-space: nowrap;
      }

      .sns-inline-badge.negative {
        background: #fee2e2;
        color: #991b1b;
      }

      .sns-inline-badge.positive {
        background: #dcfce7;
        color: #166534;
      }

      .sns-inline-badge.neutral,
      .sns-inline-badge.mixed,
      .sns-inline-badge.unknown {
        background: #fef3c7;
        color: #92400e;
      }

      .sns-inline-summary {
        margin: 10px 0 12px;
        color: #1f2937;
        line-height: 1.65;
        font-size: 15px;
        font-weight: 700;
      }

      .sns-inline-translation {
        background: #f8fafc;
        border: 1px solid rgba(15, 23, 42, .06);
        border-radius: 14px;
        padding: 12px 14px;
        color: #374151;
        line-height: 1.65;
        font-size: 14px;
        white-space: pre-wrap;
      }

      .sns-inline-note {
        margin: 10px 0 0;
        color: #64748b;
        line-height: 1.55;
        font-size: 13px;
      }

      .sns-inline-original-wrap {
        margin-top: 10px;
      }

      .sns-inline-original-wrap summary {
        cursor: pointer;
        color: #6b7280;
        font-size: 13px;
        font-weight: 800;
      }

      .sns-inline-original {
        margin-top: 8px;
        background: #fff7ed;
        border: 1px solid rgba(249, 115, 22, .18);
        border-radius: 14px;
        padding: 12px 14px;
        color: #7c2d12;
        line-height: 1.65;
        font-size: 14px;
        white-space: pre-wrap;
        direction: auto;
      }

      .sns-inline-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .sns-inline-metric {
        background: #f9fafb;
        border: 1px solid rgba(15, 23, 42, .06);
        border-radius: 999px;
        padding: 7px 9px;
        color: #4b5563;
        font-size: 13px;
        line-height: 1;
        white-space: nowrap;
      }

      .sns-inline-actions {
        margin-top: 12px;
      }

      .sns-inline-actions a {
        color: #f97316;
        font-weight: 900;
        text-decoration: none;
      }

      .sns-inline-actions a:hover {
        text-decoration: underline;
      }

      .sns-inline-empty {
        background: #fff;
        border: 1px dashed rgba(249, 115, 22, .35);
        border-radius: 18px;
        padding: 28px;
        text-align: center;
        color: #64748b;
        line-height: 1.7;
      }

      @media (max-width: 900px) {
        .sns-inline-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .sns-inline-card-head {
          display: block;
        }

        .sns-inline-badges {
          justify-content: flex-start;
          min-width: 0;
          margin-top: 12px;
        }

        .sns-inline-header-top {
          display: block;
        }

        .sns-inline-source {
          margin-top: 10px;
        }
      }

      @media (max-width: 520px) {
        .sns-inline-header {
          padding: 20px;
        }

        .sns-inline-header h3 {
          font-size: 22px;
        }

        .sns-inline-card {
          padding: 16px;
        }

        .sns-inline-title {
          font-size: 18px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  async function loadSnsData() {
    if (snsDataCache) return snsDataCache;

    const response = await fetch(`${SNS_DATA_URL}?v=${Date.now()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`SNS 데이터 로드 실패: HTTP ${response.status}`);
    }

    snsDataCache = await response.json();
    return snsDataCache;
  }

  function findSnsPlaceholder() {
    const existing = document.getElementById("sns-inline-results");
    if (existing) return existing;

    const nodes = Array.from(document.querySelectorAll("div, section, article"));

    const candidates = nodes
      .filter(function (node) {
        if (!node || !node.textContent) return false;
        if (node.closest("#sns-inline-results")) return false;

        const text = node.textContent.replace(/\s+/g, " ").trim();

        return (
          text.includes("SNS 섹션 준비중") &&
          (
            text.includes("추후 X") ||
            text.includes("SNS 모니터링") ||
            text.includes("주요 SNS")
          )
        );
      })
      .sort(function (a, b) {
        return a.textContent.length - b.textContent.length;
      });

    return candidates[0] || null;
  }

  function buildStats(items) {
    const total = items.length;

    const negative = items.filter(function (item) {
      return item.analysis && item.analysis.sentiment === "negative";
    }).length;

    const important = items.filter(function (item) {
      return Number(item.analysis && item.analysis.importance ? item.analysis.importance : 0) >= 4;
    }).length;

    const impressions = items.reduce(function (sum, item) {
      return sum + Number(item.metrics && item.metrics.impressions ? item.metrics.impressions : 0);
    }, 0);

    return `
      <div class="sns-inline-stats">
        <div class="sns-inline-stat">
          <strong>${number(total)}</strong>
          <span>표시 게시글</span>
        </div>
        <div class="sns-inline-stat">
          <strong>${number(negative)}</strong>
          <span>부정 반응</span>
        </div>
        <div class="sns-inline-stat">
          <strong>${number(important)}</strong>
          <span>중요도 4 이상</span>
        </div>
        <div class="sns-inline-stat">
          <strong>${number(impressions)}</strong>
          <span>총 조회/노출</span>
        </div>
      </div>
    `;
  }

  function renderCard(item) {
    const analysis = item.analysis || {};
    const author = item.author && item.author.username ? "@" + item.author.username : "작성자 미상";
    const sentiment = analysis.sentiment || "unknown";

    const title = normalizeBismayahText(analysis.title_ko || "비스마야 관련 X 게시글");
    const summary = normalizeBismayahText(analysis.summary_ko || "");
    const translation = normalizeBismayahText(analysis.translation_ko || "");

    // 원문은 검증용으로 그대로 보존
    const original = item.original_text || "";

    const note = normalizeBismayahText(analysis.action_note_ko || "");

    return `
      <article class="sns-inline-card">
        <div class="sns-inline-card-head">
          <div>
            <h4 class="sns-inline-title">${escapeHtml(title)}</h4>
            <div class="sns-inline-meta">
              X · ${escapeHtml(author)} · ${formatDate(item.created_at)}
            </div>
          </div>

          <div class="sns-inline-badges">
            <span class="sns-inline-badge ${escapeHtml(sentimentClass(sentiment))}">
              ${escapeHtml(sentimentLabel(sentiment))}
            </span>
            <span class="sns-inline-badge">${escapeHtml(issueLabel(analysis.issue_type))}</span>
            <span class="sns-inline-badge">관련도 ${escapeHtml(analysis.relevance || "-")}</span>
            <span class="sns-inline-badge">중요도 ${escapeHtml(analysis.importance || "-")}</span>
          </div>
        </div>

        ${summary ? `<p class="sns-inline-summary">${escapeHtml(summary)}</p>` : ""}

        ${translation ? `<div class="sns-inline-translation">${escapeHtml(translation)}</div>` : ""}

        ${
          original
            ? `
              <details class="sns-inline-original-wrap">
                <summary>아랍어 원문 보기</summary>
                <div class="sns-inline-original">${escapeHtml(original)}</div>
              </details>
            `
            : ""
        }

        ${note ? `<p class="sns-inline-note">${escapeHtml(note)}</p>` : ""}

        <div class="sns-inline-metrics">
          <span class="sns-inline-metric">조회 ${getMetric(item, "impressions")}</span>
          <span class="sns-inline-metric">좋아요 ${getMetric(item, "likes")}</span>
          <span class="sns-inline-metric">댓글 ${getMetric(item, "replies")}</span>
          <span class="sns-inline-metric">재게시 ${getMetric(item, "reposts")}</span>
          <span class="sns-inline-metric">인용 ${getMetric(item, "quotes")}</span>
        </div>

        <div class="sns-inline-actions">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">X 원문 보기 →</a>
        </div>
      </article>
    `;
  }

  function renderEmpty(target, data) {
    target.innerHTML = `
      <div class="sns-inline-header">
        <div class="sns-inline-header-top">
          <h3>X SNS 동향</h3>
          <span class="sns-inline-source">SOCIAL</span>
        </div>
        <p>마지막 업데이트: ${formatDate(data && data.updated_at)}</p>
      </div>

      <div class="sns-inline-empty">
        표시할 SNS 게시글이 없습니다.<br>
        검색어 또는 관련도 기준을 확인하세요.
      </div>
    `;
  }

  function renderError(target, error) {
    target.innerHTML = `
      <div class="sns-inline-header">
        <div class="sns-inline-header-top">
          <h3>X SNS 동향</h3>
          <span class="sns-inline-source">SOCIAL</span>
        </div>
        <p>이라크 비스마야 관련 X 게시글 자동 수집 현황</p>
      </div>

      <div class="sns-inline-empty">
        SNS 데이터를 불러오지 못했습니다.<br>
        ${escapeHtml(error && error.message ? error.message : String(error))}
      </div>
    `;
  }

  function renderResults(target, data) {
    const items = Array.isArray(data.items) ? data.items : [];

    const sorted = items
      .slice()
      .sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });

    const displayItems = sorted.slice(0, MAX_DISPLAY_ITEMS);

    if (!displayItems.length) {
      renderEmpty(target, data);
      return;
    }

    target.innerHTML = `
      <div class="sns-inline-header">
        <div class="sns-inline-header-top">
          <h3>X SNS 동향</h3>
          <span class="sns-inline-source">SOCIAL</span>
        </div>
        <p>
          마지막 업데이트: ${formatDate(data.updated_at)}
          · 검색 출처: ${escapeHtml(data.source || "X Recent Search API")}
          ${data.min_relevance ? `· 표시 기준: 관련도 ${escapeHtml(data.min_relevance)} 이상` : ""}
          · 총 ${number(sorted.length)}건 중 최신 ${number(displayItems.length)}건 표시
        </p>
      </div>

      ${buildStats(sorted)}

      <div class="sns-inline-list">
        ${displayItems.map(renderCard).join("")}
      </div>
    `;
  }

  async function mountSnsResults() {
    if (isRendering) return;

    installStyles();

    const oldFloatingSection = document.getElementById("sns-auto-section");
    if (oldFloatingSection) {
      oldFloatingSection.remove();
    }

    const target = findSnsPlaceholder();

    if (!target) {
      return;
    }

    isRendering = true;

    try {
      target.id = "sns-inline-results";
      target.classList.add("sns-inline-panel");

      target.innerHTML = `
        <div class="sns-inline-empty">
          SNS 데이터를 불러오는 중입니다...
        </div>
      `;

      const data = await loadSnsData();
      renderResults(target, data);
    } catch (error) {
      renderError(target, error);
    } finally {
      isRendering = false;
    }
  }

  function scheduleMount() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(mountSnsResults, 120);
  }

  function observePageChanges() {
    const observer = new MutationObserver(function () {
      scheduleMount();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function boot() {
    scheduleMount();
    observePageChanges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
