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

  function getMetric(item, key) {
    return Number(item?.metrics?.[key] || 0).toLocaleString("ko-KR");
  }

  function installStyles() {
    if (document.getElementById("sns-patch-style")) return;

    const style = document.createElement("style");
    style.id = "sns-patch-style";
    style.textContent = `
      .sns-section {
        margin-top: 28px;
      }

      .sns-header-card {
        background: linear-gradient(135deg, #111827, #374151);
        color: white;
        border-radius: 22px;
        padding: 24px;
        margin-bottom: 18px;
        box-shadow: 0 18px 40px rgba(15, 23, 42, .18);
      }

      .sns-header-card h2 {
        margin: 0 0 8px;
        font-size: 26px;
        letter-spacing: -0.03em;
      }

      .sns-header-card p {
        margin: 0;
        color: rgba(255,255,255,.78);
        line-height: 1.6;
      }

      .sns-stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin: 16px 0 22px;
      }

      .sns-stat {
        background: white;
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(15,23,42,.06);
      }

      .sns-stat strong {
        display: block;
        font-size: 24px;
        color: #111827;
        margin-bottom: 4px;
      }

      .sns-stat span {
        color: #6b7280;
        font-size: 14px;
      }

      .sns-card {
        background: white;
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 18px;
        padding: 18px;
        margin-bottom: 14px;
        box-shadow: 0 10px 28px rgba(15,23,42,.06);
      }

      .sns-card-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
        margin-bottom: 10px;
      }

      .sns-title {
        margin: 0;
        font-size: 20px;
        line-height: 1.4;
        letter-spacing: -0.02em;
        color: #111827;
      }

      .sns-meta {
        color: #6b7280;
        font-size: 13px;
        margin-top: 6px;
      }

      .sns-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-end;
      }

      .sns-badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 5px 9px;
        font-size: 12px;
        font-weight: 700;
        background: #f3f4f6;
        color: #374151;
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
        margin: 10px 0 12px;
        color: #1f2937;
        line-height: 1.65;
        font-size: 16px;
      }

      .sns-original {
        background: #f8fafc;
        border-radius: 14px;
        padding: 12px 14px;
        color: #374151;
        line-height: 1.65;
        font-size: 14px;
        margin: 10px 0;
        direction: auto;
        white-space: pre-wrap;
      }

      .sns-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
        color: #4b5563;
        font-size: 13px;
      }

      .sns-metric {
        background: #f9fafb;
        border: 1px solid rgba(15,23,42,.06);
        border-radius: 999px;
        padding: 6px 9px;
      }

      .sns-actions {
        margin-top: 12px;
      }

      .sns-actions a {
        color: #f97316;
        font-weight: 700;
        text-decoration: none;
      }

      .sns-empty {
        background: white;
        border: 1px dashed rgba(15,23,42,.18);
        border-radius: 18px;
        padding: 28px;
        text-align: center;
        color: #6b7280;
      }

      @media (max-width: 800px) {
        .sns-stats {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .sns-card-head {
          display: block;
        }

        .sns-badges {
          justify-content: flex-start;
          margin-top: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildStats(items) {
    const total = items.length;
    const negative = items.filter((x) => x.analysis?.sentiment === "negative").length;
    const important = items.filter((x) => Number(x.analysis?.importance || 0) >= 4).length;
    const impressions = items.reduce((sum, x) => sum + Number(x.metrics?.impressions || 0), 0);

    return `
      <div class="sns-stats">
        <div class="sns-stat"><strong>${total}</strong><span>표시 게시글</span></div>
        <div class="sns-stat"><strong>${negative}</strong><span>부정 반응</span></div>
        <div class="sns-stat"><strong>${important}</strong><span>중요도 4 이상</span></div>
        <div class="sns-stat"><strong>${impressions.toLocaleString("ko-KR")}</strong><span>총 조회/노출</span></div>
      </div>
    `;
  }

  function renderCard(item) {
    const a = item.analysis || {};
    const author = item.author?.username ? `@${item.author.username}` : "작성자 미상";

    return `
      <article class="sns-card">
        <div class="sns-card-head">
          <div>
            <h3 class="sns-title">${escapeHtml(a.title_ko || "비스마야 관련 X 게시글")}</h3>
            <div class="sns-meta">
              X · ${escapeHtml(author)} · ${formatDate(item.created_at)}
            </div>
          </div>
          <div class="sns-badges">
            <span class="sns-badge ${escapeHtml(a.sentiment || "unknown")}">${sentimentLabel(a.sentiment)}</span>
            <span class="sns-badge">${issueLabel(a.issue_type)}</span>
            <span class="sns-badge">관련도 ${escapeHtml(a.relevance || "-")}</span>
            <span class="sns-badge">중요도 ${escapeHtml(a.importance || "-")}</span>
          </div>
        </div>

        <p class="sns-summary">${escapeHtml(a.summary_ko || "")}</p>

        <div class="sns-original">${escapeHtml(a.translation_ko || item.original_text || "")}</div>

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

  function findContainer() {
    const candidates = [
      "#sns",
      "#sns-section",
      "#sns-content",
      "#sns-panel",
      "[data-section='sns']",
      "[data-tab-panel='sns']",
      "main",
      ".container",
      "body",
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el) return el;
    }

    return document.body;
  }

  async function renderSns() {
    installStyles();

    const container = findContainer();

    let root = document.getElementById("sns-auto-section");
    if (!root) {
      root = document.createElement("section");
      root.id = "sns-auto-section";
      root.className = "sns-section";
      container.appendChild(root);
    }

    root.innerHTML = `
      <div class="sns-header-card">
        <h2>X SNS 동향</h2>
        <p>이라크 비스마야 관련 X 게시글을 자동 수집하고, 한국어 번역·감성·이슈 유형으로 정리합니다.</p>
      </div>
      <div class="sns-empty">SNS 데이터를 불러오는 중입니다...</div>
    `;

    try {
      const res = await fetch(`${SNS_DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const items = Array.isArray(data.items) ? data.items : [];
      const sorted = items
        .slice()
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      if (!sorted.length) {
        root.innerHTML = `
          <div class="sns-header-card">
            <h2>X SNS 동향</h2>
            <p>마지막 업데이트: ${formatDate(data.updated_at)}</p>
          </div>
          <div class="sns-empty">표시할 SNS 게시글이 없습니다. 검색어 또는 관련도 기준을 확인하세요.</div>
        `;
        return;
      }

      root.innerHTML = `
        <div class="sns-header-card">
          <h2>X SNS 동향</h2>
          <p>마지막 업데이트: ${formatDate(data.updated_at)} · 검색 출처: ${escapeHtml(data.source || "X")}</p>
        </div>
        ${buildStats(sorted)}
        <div class="sns-list">
          ${sorted.map(renderCard).join("")}
        </div>
      `;
    } catch (err) {
      root.innerHTML = `
        <div class="sns-header-card">
          <h2>X SNS 동향</h2>
          <p>이라크 비스마야 관련 X 게시글 자동 수집 현황</p>
        </div>
        <div class="sns-empty">SNS 데이터를 불러오지 못했습니다: ${escapeHtml(err.message)}</div>
      `;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderSns);
  } else {
    renderSns();
  }
})();
