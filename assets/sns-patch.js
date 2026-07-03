(function () {
  const SNS_DATA_URL = "./data/sns-activities.json";

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

  function number(value) {
    return Number(value || 0).toLocaleString("ko-KR");
  }

  function getMetric(item, key) {
    return number(item?.metrics?.[key] || 0);
  }

  function getSentimentClass(value) {
    if (value === "positive") return "positive";
    if (value === "negative") return "negative";
    if (value === "mixed") return "mixed";
    if (value === "neutral") return "neutral";
    return "unknown";
  }

  function installStyles() {
    if (document.getElementById("sns-patch-style")) return;

    const style = document.createElement("style");
    style.id = "sns-patch-style";
    style.textContent = `
      #sns-auto-section,
      #sns-auto-section * {
        box-sizing: border-box;
      }

      #sns-auto-section {
        width: min(1180px, calc(100% - 40px));
        margin: 36px auto 60px;
        padding: 0;
        display: block;
        clear: both;
      }

      .sns-header-card {
        background: linear-gradient(135deg, #111827, #374151);
        color: white;
        border-radius: 22px;
        padding: 26px 28px;
        margin-bottom: 18px;
        box-shadow: 0 18px 40px rgba(15, 23, 42, .18);
      }

      .sns-header-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 8px;
      }

      .sns-header-card h2 {
        margin: 0;
        font-size: 28px;
        line-height: 1.25;
        letter-spacing: -0.04em;
      }

      .sns-header-card p {
        margin: 0;
        color: rgba(255, 255, 255, .78);
        line-height: 1.65;
        font-size: 15px;
      }

      .sns-source-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 7px 11px;
        background: rgba(255, 255, 255, .12);
        color: rgba(255, 255, 255, .9);
        font-size: 12px;
        font-weight: 800;
        white-space: nowrap;
      }

      .sns-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0 22px;
      }

      .sns-stat {
        background: white;
        border: 1px solid rgba(15, 23, 42, .08);
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, .06);
      }

      .sns-stat strong {
        display: block;
        font-size: 25px;
        color: #111827;
        margin-bottom: 4px;
        line-height: 1.1;
      }

      .sns-stat span {
        color: #6b7280;
        font-size: 14px;
        line-height: 1.4;
      }

      .sns-list {
        display: grid;
        gap: 14px;
      }

      .sns-card {
        background: white;
        border: 1px solid rgba(15, 23, 42, .08);
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, .06);
      }

      .sns-card-head {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .sns-title {
        margin: 0;
        font-size: 21px;
        line-height: 1.4;
        letter-spacing: -0.03em;
        color: #111827;
      }

      .sns-meta {
        color: #6b7280;
        font-size: 13px;
        margin-top: 6px;
        line-height: 1.45;
      }

      .sns-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-end;
        min-width: 220px;
      }

      .sns-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        line-height: 1;
        font-weight: 800;
        background: #f3f4f6;
        color: #374151;
        white-space: nowrap;
      }

      .sns-badge.negative {
        background: #fee2e2;
        color: #991b1b;
      }

      .sns-badge.positive {
        background: #dcfce7;
        color: #166534;
      }

      .sns-badge.neutral,
      .sns-badge.mixed,
      .sns-badge.unknown {
        background: #fef3c7;
        color: #92400e;
      }

      .sns-summary {
        margin: 12px 0 12px;
        color: #1f2937;
        line-height: 1.7;
        font-size: 16px;
        font-weight: 600;
      }

      .sns-translation {
        background: #f8fafc;
        border: 1px solid rgba(15, 23, 42, .06);
        border-radius: 14px;
        padding: 13px 15px;
        color: #374151;
        line-height: 1.7;
        font-size: 14px;
        margin: 10px 0;
        white-space: pre-wrap;
      }

      .sns-original-wrap {
        margin-top: 10px;
      }

      .sns-original-wrap summary {
        cursor: pointer;
        color: #6b7280;
        font-size: 13px;
        font-weight: 800;
      }

      .sns-original {
        margin-top: 8px;
        background: #fff7ed;
        border: 1px solid rgba(249, 115, 22, .16);
        border-radius: 14px;
        padding: 12px 14px;
        color: #7c2d12;
        line-height: 1.7;
        font-size: 14px;
        direction: auto;
        white-space: pre-wrap;
      }

      .sns-note {
        margin: 10px 0 0;
        color: #6b7280;
        line-height: 1.6;
        font-size: 13px;
      }

      .sns-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 13px;
        color: #4b5563;
        font-size: 13px;
      }

      .sns-metric {
        background: #f9fafb;
        border: 1px solid rgba(15, 23, 42, .06);
        border-radius: 999px;
        padding: 7px 10px;
        line-height: 1;
        white-space: nowrap;
      }

      .sns-actions {
        margin-top: 14px;
      }

      .sns-actions a {
        color: #f97316;
        font-weight: 900;
        text-decoration: none;
      }

      .sns-actions a:hover {
        text-decoration: underline;
      }

      .sns-empty {
        background: white;
        border: 1px dashed rgba(15, 23, 42, .18);
        border-radius: 18px;
        padding: 30px;
        text-align: center;
        color: #6b7280;
        line-height: 1.7;
      }

      @media (max-width: 900px) {
        #sns-auto-section {
          width: min(100% - 28px, 1180px);
          margin-top: 28px;
        }

        .sns-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .sns-card-head {
          display: block;
        }

        .sns-badges {
          justify-content: flex-start;
          min-width: 0;
          margin-top: 12px;
        }

        .sns-header-top {
          display: block;
        }

        .sns-source-badge {
          margin-top: 12px;
        }
      }

      @media (max-width: 520px) {
        .sns-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .sns-header-card {
          padding: 22px;
        }

        .sns-header-card h2 {
          font-size: 24px;
        }

        .sns-card {
          padding: 16px;
        }

        .sns-title {
          font-size: 18px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createMountNode() {
    let root = document.getElementById("sns-auto-section");

    if (!root) {
      root = document.createElement("section");
      root.id = "sns-auto-section";
    }

    root.className = "sns-section";
    root.setAttribute("aria-label", "X SNS 동향");

    const footer = document.querySelector("footer");

    if (footer && footer.parentElement === document.body) {
      document.body.insertBefore(root, footer);
    } else {
      document.body.appendChild(root);
    }

    return root;
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
      <div class="sns-stats">
        <div class="sns-stat">
          <strong>${number(total)}</strong>
          <span>표시 게시글</span>
        </div>
        <div class="sns-stat">
          <strong>${number(negative)}</strong>
          <span>부정 반응</span>
        </div>
        <div class="sns-stat">
          <strong>${number(important)}</strong>
          <span>중요도 4 이상</span>
        </div>
        <div class="sns-stat">
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
    const sentimentClass = getSentimentClass(sentiment);
    const title = analysis.title_ko || "비스마야 관련 X 게시글";
    const summary = analysis.summary_ko || "";
    const translation = analysis.translation_ko || "";
    const original = item.original_text || "";
    const note = analysis.action_note_ko || "";

    return `
      <article class="sns-card">
        <div class="sns-card-head">
          <div>
            <h3 class="sns-title">${escapeHtml(title)}</h3>
            <div class="sns-meta">
              X · ${escapeHtml(author)} · ${formatDate(item.created_at)}
            </div>
          </div>

          <div class="sns-badges">
            <span class="sns-badge ${escapeHtml(sentimentClass)}">${escapeHtml(sentimentLabel(sentiment))}</span>
            <span class="sns-badge">${escapeHtml(issueLabel(analysis.issue_type))}</span>
            <span class="sns-badge">관련도 ${escapeHtml(analysis.relevance || "-")}</span>
            <span class="sns-badge">중요도 ${escapeHtml(analysis.importance || "-")}</span>
          </div>
        </div>

        ${summary ? `<p class="sns-summary">${escapeHtml(summary)}</p>` : ""}

        ${
          translation
            ? `<div class="sns-translation">${escapeHtml(translation)}</div>`
            : ""
        }

        ${
          original
            ? `
              <details class="sns-original-wrap">
                <summary>원문 보기</summary>
                <div class="sns-original">${escapeHtml(original)}</div>
              </details>
            `
            : ""
        }

        ${note ? `<p class="sns-note">${escapeHtml(note)}</p>` : ""}

        <div class="sns-metrics">
          <span class="sns-metric">조회 ${getMetric(item, "impressions")}</span>
          <span class="sns-metric">좋아요 ${getMetric(item, "likes")}</span>
          <span class="sns-metric">댓글 ${getMetric(item, "replies")}</span>
          <span class="sns-metric">재게시 ${getMetric(item, "reposts")}</span>
          <span class="sns-metric">인용 ${getMetric(item, "quotes")}</span>
        </div>

        <div class="sns-actions">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">X 원문 보기 →</a>
        </div>
      </article>
    `;
  }

  function renderLoading(root) {
    root.innerHTML = `
      <div class="sns-header-card">
        <div class="sns-header-top">
          <h2>X SNS 동향</h2>
          <span class="sns-source-badge">SOCIAL</span>
        </div>
        <p>이라크 비스마야 관련 X 게시글을 자동 수집하고, 한국어 번역·감성·이슈 유형으로 정리합니다.</p>
      </div>
      <div class="sns-empty">SNS 데이터를 불러오는 중입니다...</div>
    `;
  }

  function renderEmpty(root, data) {
    root.innerHTML = `
      <div class="sns-header-card">
        <div class="sns-header-top">
          <h2>X SNS 동향</h2>
          <span class="sns-source-badge">SOCIAL</span>
        </div>
        <p>마지막 업데이트: ${formatDate(data && data.updated_at)}</p>
      </div>
      <div class="sns-empty">
        표시할 SNS 게시글이 없습니다.<br>
        검색어 또는 관련도 기준을 확인하세요.
      </div>
    `;
  }

  function renderError(root, err) {
    root.innerHTML = `
      <div class="sns-header-card">
        <div class="sns-header-top">
          <h2>X SNS 동향</h2>
          <span class="sns-source-badge">SOCIAL</span>
        </div>
        <p>이라크 비스마야 관련 X 게시글 자동 수집 현황</p>
      </div>
      <div class="sns-empty">
        SNS 데이터를 불러오지 못했습니다.<br>
        ${escapeHtml(err && err.message ? err.message : String(err))}
      </div>
    `;
  }

  async function renderSns() {
    installStyles();

    const root = createMountNode();
    renderLoading(root);

    try {
      const response = await fetch(`${SNS_DATA_URL}?v=${Date.now()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];

      const sorted = items
        .slice()
        .sort(function (a, b) {
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });

      if (!sorted.length) {
        renderEmpty(root, data);
        return;
      }

      root.innerHTML = `
        <div class="sns-header-card">
          <div class="sns-header-top">
            <h2>X SNS 동향</h2>
            <span class="sns-source-badge">SOCIAL</span>
          </div>
          <p>
            마지막 업데이트: ${formatDate(data.updated_at)}
            · 검색 출처: ${escapeHtml(data.source || "X Recent Search API")}
            ${data.min_relevance ? `· 표시 기준: 관련도 ${escapeHtml(data.min_relevance)} 이상` : ""}
          </p>
        </div>

        ${buildStats(sorted)}

        <div class="sns-list">
          ${sorted.map(renderCard).join("")}
        </div>
      `;
    } catch (err) {
      renderError(root, err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderSns);
  } else {
    renderSns();
  }
})();
