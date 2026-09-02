import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Mismatch, PageResult } from "./types.js";

export type ReportOptions = { printMode?: boolean };

export function printTerminalReport(results: PageResult[]): void {
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const error = results.filter((r) => r.status === "error").length;

  console.log("\n=== Content Parity Report ===\n");
  for (const r of results) {
    const label = `${r.oldPath} ↔ ${r.newPath}`;
    if (r.status === "pass") {
      console.log(`PASS  ${label}`);
      continue;
    }
    if (r.status === "error") {
      console.log(`ERROR ${label}`);
      console.log(`      ${r.errorReason ?? "unknown error"}`);
      continue;
    }
    console.log(`FAIL  ${label}`);
    for (const m of r.mismatches) {
      const bits = [
        m.kind,
        m.index !== undefined ? `@${m.index}` : "",
        m.oldValue !== undefined ? `old=${JSON.stringify(m.oldValue)}` : "",
        m.newValue !== undefined ? `new=${JSON.stringify(m.newValue)}` : "",
        m.detail ? `detail=${m.detail}` : "",
      ].filter(Boolean);
      console.log(`      - ${bits.join(" ")}`);
    }
  }
  console.log(`\nSummary: ${pass} pass, ${fail} fail, ${error} error (${results.length} pages)\n`);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function kindFamily(kind: string): "text" | "link" | "image" | "layout" | "other" {
  if (kind.startsWith("text_")) return "text";
  if (kind.startsWith("link_")) return "link";
  if (kind.startsWith("image_")) return "image";
  if (kind.startsWith("layout_")) return "layout";
  return "other";
}

function kindCounts(results: PageResult[]): Record<string, number> {
  const counts: Record<string, number> = { text: 0, link: 0, image: 0, layout: 0 };
  for (const r of results) {
    for (const m of r.mismatches) {
      const family = kindFamily(m.kind);
      if (family in counts) counts[family] += 1;
    }
  }
  return counts;
}

function pageFamilies(r: PageResult): string {
  const set = new Set<string>();
  for (const m of r.mismatches) {
    const family = kindFamily(m.kind);
    if (family !== "other") set.add(family);
  }
  return [...set].join(" ");
}

function renderMismatch(m: Mismatch): string {
  const family = kindFamily(m.kind);
  const hasBoth = m.oldValue !== undefined && m.newValue !== undefined;
  const indexLabel = m.index !== undefined ? `<span class="idx">#${m.index}</span>` : "";

  if (hasBoth) {
    return `
<article class="mismatch family-${family}" data-family="${family}">
  <header class="mismatch-head">
    <span class="kind-chip">${escapeHtml(m.kind)}</span>
    ${indexLabel}
  </header>
  <div class="compare">
    <div class="pane old">
      <div class="pane-label">Old</div>
      <code>${escapeHtml(m.oldValue!)}</code>
    </div>
    <div class="pane new">
      <div class="pane-label">New</div>
      <code>${escapeHtml(m.newValue!)}</code>
    </div>
  </div>
  ${m.detail ? `<p class="detail">${escapeHtml(m.detail)}</p>` : ""}
</article>`;
  }

  return `
<article class="mismatch family-${family}" data-family="${family}">
  <header class="mismatch-head">
    <span class="kind-chip">${escapeHtml(m.kind)}</span>
    ${indexLabel}
  </header>
  <div class="single">
    <code>${escapeHtml(m.oldValue ?? m.newValue ?? "")}</code>
  </div>
  ${m.detail ? `<p class="detail">${escapeHtml(m.detail)}</p>` : ""}
</article>`;
}

function renderPage(r: PageResult, index: number, printMode: boolean): string {
  const families = pageFamilies(r);
  const mismatchHtml =
    r.status === "error"
      ? `<div class="error-box"><p>${escapeHtml(r.errorReason ?? "Unknown error")}</p></div>`
      : r.mismatches.length === 0
        ? `<div class="pass-box"><p>Color-only differences allowed. Content, images, and layout match.</p></div>`
        : `<div class="mismatch-list">${r.mismatches.map(renderMismatch).join("")}</div>`;

  const countLabel =
    r.status === "fail"
      ? `${r.mismatches.length} mismatch${r.mismatches.length === 1 ? "" : "es"}`
      : r.status === "error"
        ? "blocked"
        : "aligned";

  const openAttr = printMode || r.status !== "pass" ? "open" : "";

  return `
<section class="page-card status-${r.status}" data-status="${r.status}" data-families="${escapeHtml(families)}" style="--i:${index}">
  <details ${openAttr}>
    <summary>
      <span class="stamp">${r.status}</span>
      <div class="paths">
        <span class="path">${escapeHtml(r.oldPath)}</span>
        <span class="swap" aria-hidden="true">↔</span>
        <span class="path">${escapeHtml(r.newPath)}</span>
      </div>
      <span class="meta">${countLabel}</span>
      <span class="chevron" aria-hidden="true"></span>
    </summary>
    <div class="page-body">${mismatchHtml}</div>
  </details>
</section>`;
}

export function renderHtmlReport(results: PageResult[], options: ReportOptions = {}): string {
  const printMode = options.printMode === true;
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const error = results.filter((r) => r.status === "error").length;
  const total = results.length || 1;
  const passPct = Math.round((pass / total) * 100);
  const families = kindCounts(results);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const rows = results.map((r, i) => renderPage(r, i, printMode)).join("\n");
  const shown = (n: number) => (printMode ? String(n) : "0");
  const gsapTag = printMode
    ? ""
    : `  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>\n`;
  const fontTags = printMode
    ? ""
    : `  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet" />
`;
  const printCss = printMode
    ? `
    @page { margin: 14mm; }
    .page-card { break-inside: avoid; }
    .toolbar, .bg-grid { display: none !important; }
`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Parity Dossier</title>
${fontTags}${gsapTag}  <style>
    :root {
      --ink: #141c24;
      --muted: #5b6b7c;
      --paper: #eef2f4;
      --panel: rgba(255, 252, 248, 0.92);
      --line: rgba(20, 28, 36, 0.12);
      --pass: #0f7a57;
      --pass-soft: #d8f3e8;
      --fail: #c0392b;
      --fail-soft: #fde8e4;
      --error: #a15c00;
      --error-soft: #ffe9c8;
      --text: #1d4e89;
      --image: #6b3fa0;
      --layout: #0b6e6a;
      --link: #8a4b08;
      --shadow: 0 24px 60px rgba(15, 28, 40, 0.12);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      font-family: "Manrope", sans-serif;
      background:
        radial-gradient(900px 420px at 8% -5%, rgba(15, 122, 87, 0.14), transparent 55%),
        radial-gradient(700px 380px at 100% 0%, rgba(192, 57, 43, 0.1), transparent 50%),
        linear-gradient(165deg, #e8eef2 0%, var(--paper) 45%, #e4ebe7 100%);
      position: relative;
      overflow-x: hidden;
    }

    .bg-grid {
      position: fixed;
      inset: -10%;
      pointer-events: none;
      opacity: 0.45;
      background-image:
        linear-gradient(rgba(20, 28, 36, 0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(20, 28, 36, 0.04) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: radial-gradient(circle at 50% 20%, black, transparent 75%);
      will-change: transform;
      z-index: 0;
    }

    .wrap {
      width: min(1080px, calc(100% - 2rem));
      margin: 0 auto;
      padding: 2.5rem 0 4.5rem;
      position: relative;
      z-index: 1;
    }

    .hero {
      display: grid;
      grid-template-columns: 1.4fr 0.9fr;
      gap: 1.5rem;
      align-items: stretch;
      margin-bottom: 1.75rem;
    }

    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; }
    }

    .hero-copy, .hero-score {
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      border-radius: 18px;
      padding: 1.6rem 1.7rem;
      will-change: transform, opacity;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 0.7rem;
    }

    .eyebrow::before {
      content: "";
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 999px;
      background: ${fail + error > 0 ? "var(--fail)" : "var(--pass)"};
      box-shadow: 0 0 0 4px ${fail + error > 0 ? "rgba(192,57,43,0.15)" : "rgba(15,122,87,0.15)"};
    }

    h1 {
      margin: 0;
      font-family: "Fraunces", serif;
      font-weight: 700;
      font-size: clamp(2rem, 4vw, 2.75rem);
      letter-spacing: -0.03em;
      line-height: 1.05;
    }

    .lede {
      margin: 0.85rem 0 0;
      color: var(--muted);
      max-width: 38rem;
      line-height: 1.55;
    }

    .generated {
      margin-top: 1.1rem;
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.78rem;
      color: var(--muted);
    }

    .hero-score {
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 0.85rem;
      text-align: center;
    }

    .ring {
      --p: 0;
      width: 148px;
      height: 148px;
      border-radius: 50%;
      background:
        radial-gradient(closest-side, #fffaf4 72%, transparent 73% 100%),
        conic-gradient(var(--pass) calc(var(--p) * 1%), rgba(20,28,36,0.12) 0);
      display: grid;
      place-items: center;
      will-change: transform;
    }

    .ring strong {
      font-family: "Fraunces", serif;
      font-size: 2.1rem;
      line-height: 1;
    }

    .ring span {
      display: block;
      margin-top: 0.2rem;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }

    .stat-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.7rem;
      width: 100%;
    }

    .stat {
      border-radius: 12px;
      padding: 0.65rem 0.4rem;
      background: rgba(20, 28, 36, 0.04);
      transition: transform 0.2s ease, background 0.2s ease;
    }

    .stat:hover { transform: translateY(-2px); background: rgba(20, 28, 36, 0.07); }

    .stat b {
      display: block;
      font-family: "Fraunces", serif;
      font-size: 1.35rem;
    }

    .stat small {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .stat.pass b { color: var(--pass); }
    .stat.fail b { color: var(--fail); }
    .stat.error b { color: var(--error); }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      margin-bottom: 1.1rem;
      align-items: center;
    }

    .filter {
      border: 1px solid var(--line);
      background: rgba(255,252,248,0.75);
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      font-size: 0.82rem;
      padding: 0.5rem 0.9rem;
      border-radius: 999px;
      cursor: pointer;
      will-change: transform;
      box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset;
    }

    .filter.active {
      background: var(--ink);
      color: #f6f8fa;
      border-color: var(--ink);
    }

    .family-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin-left: auto;
    }

    .family-filter.text { color: var(--text); border-color: rgba(29,78,137,0.28); background: #eaf2ff; }
    .family-filter.image { color: var(--image); border-color: rgba(107,63,160,0.28); background: #f4ecff; }
    .family-filter.layout { color: var(--layout); border-color: rgba(11,110,106,0.28); background: #e6f7f5; }
    .family-filter.link { color: var(--link); border-color: rgba(138,75,8,0.28); background: #fff1df; }

    .family-filter.text.active { background: var(--text); color: #fff; border-color: var(--text); }
    .family-filter.image.active { background: var(--image); color: #fff; border-color: var(--image); }
    .family-filter.layout.active { background: var(--layout); color: #fff; border-color: var(--layout); }
    .family-filter.link.active { background: var(--link); color: #fff; border-color: var(--link); }

    .pages { position: relative; min-height: 4rem; }

    .page-card {
      margin-bottom: 0.85rem;
      border-radius: 16px;
      background: var(--panel);
      border: 1px solid var(--line);
      box-shadow: 0 10px 28px rgba(15, 28, 40, 0.06);
      overflow: hidden;
      will-change: transform, opacity;
      transform-origin: center top;
    }

    .page-card.status-pass { border-left: 4px solid var(--pass); }
    .page-card.status-fail { border-left: 4px solid var(--fail); }
    .page-card.status-error { border-left: 4px solid var(--error); }
    .page-card.is-hidden { display: none; }

    summary {
      list-style: none;
      cursor: pointer;
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      gap: 0.85rem;
      align-items: center;
      padding: 1rem 1.15rem;
    }

    summary::-webkit-details-marker { display: none; }

    .stamp {
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 0.38rem 0.55rem;
      border-radius: 8px;
      min-width: 3.6rem;
      text-align: center;
    }

    .status-pass .stamp { background: var(--pass-soft); color: var(--pass); }
    .status-fail .stamp { background: var(--fail-soft); color: var(--fail); }
    .status-error .stamp { background: var(--error-soft); color: var(--error); }

    .paths {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }

    .path {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.86rem;
      font-weight: 500;
      background: rgba(20, 28, 36, 0.05);
      padding: 0.2rem 0.45rem;
      border-radius: 6px;
    }

    .swap { color: var(--muted); font-weight: 700; }

    .meta {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .chevron {
      width: 0.55rem;
      height: 0.55rem;
      border-right: 2px solid var(--muted);
      border-bottom: 2px solid var(--muted);
      transform: rotate(45deg);
      transition: transform 0.25s ease;
      margin-right: 0.2rem;
    }

    details[open] .chevron { transform: rotate(225deg); }

    .page-body {
      padding: 0 1.15rem 1.2rem;
      border-top: 1px solid var(--line);
      overflow: hidden;
    }

    .pass-box, .error-box {
      margin-top: 1rem;
      padding: 0.95rem 1rem;
      border-radius: 12px;
    }

    .pass-box {
      background: var(--pass-soft);
      color: var(--pass);
      font-weight: 600;
    }

    .error-box {
      background: var(--error-soft);
      color: var(--error);
      font-weight: 600;
    }

    .mismatch-list {
      display: grid;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .mismatch {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 0.85rem;
      background: rgba(255,255,255,0.65);
      will-change: transform, opacity;
    }

    .mismatch.is-hidden { display: none; }

    .mismatch-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.7rem;
    }

    .kind-chip {
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.28rem 0.5rem;
      border-radius: 999px;
    }

    .family-text .kind-chip { background: #eaf2ff; color: var(--text); }
    .family-image .kind-chip { background: #f4ecff; color: var(--image); }
    .family-layout .kind-chip { background: #e6f7f5; color: var(--layout); }
    .family-link .kind-chip { background: #fff1df; color: var(--link); }
    .family-other .kind-chip { background: #eee; color: var(--muted); }

    .idx {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.75rem;
      color: var(--muted);
    }

    .compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.65rem;
    }

    @media (max-width: 720px) {
      summary { grid-template-columns: auto 1fr auto; }
      .meta { display: none; }
      .compare { grid-template-columns: 1fr; }
      .family-pills { margin-left: 0; width: 100%; }
    }

    .pane, .single {
      border-radius: 10px;
      padding: 0.7rem 0.75rem;
      min-width: 0;
    }

    .pane.old { background: #f3f0ea; border: 1px solid rgba(20,28,36,0.08); }
    .pane.new { background: #eaf4f1; border: 1px solid rgba(15,122,87,0.18); }
    .single { background: rgba(20,28,36,0.04); }

    .pane-label {
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 0.35rem;
    }

    code {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.8rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--ink);
    }

    .detail {
      margin: 0.55rem 0 0;
      color: var(--muted);
      font-size: 0.85rem;
    }

    .empty-state {
      display: none;
      text-align: center;
      padding: 2.5rem 1.5rem;
      border-radius: 18px;
      border: 1px dashed var(--line);
      background: rgba(255,252,248,0.7);
      color: var(--muted);
      margin-bottom: 0.85rem;
    }

    .empty-state.visible { display: block; }

    .empty-state strong {
      display: block;
      font-family: "Fraunces", serif;
      font-size: 1.35rem;
      color: var(--ink);
      margin-bottom: 0.35rem;
    }

    .foot {
      margin-top: 1.75rem;
      color: var(--muted);
      font-size: 0.85rem;
      text-align: center;
    }
    ${printCss}
  </style>
</head>
<body${printMode ? ' class="print-mode"' : ""}>
  ${printMode ? "" : '<div class="bg-grid" aria-hidden="true"></div>'}
  <div class="wrap">
    <header class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Website parity dossier</div>
        <h1>Content · Image · Layout</h1>
        <p class="lede">
          Color rebrands are allowed. Everything else must match the source of truth.
          Filter by status or mismatch type, then expand a page for side-by-side detail.
        </p>
        <div class="generated">Generated ${escapeHtml(generatedAt)}</div>
      </div>
      <div class="hero-score">
        <div class="ring" aria-label="${passPct}% pages passed" data-target="${passPct}">
          <div>
            <strong class="count-pct" data-target="${passPct}">${shown(passPct)}</strong><span class="pct-suffix">%</span>
            <span>pass rate</span>
          </div>
        </div>
        <div class="stat-row">
          <div class="stat pass"><b class="count-num" data-target="${pass}">${shown(pass)}</b><small>Pass</small></div>
          <div class="stat fail"><b class="count-num" data-target="${fail}">${shown(fail)}</b><small>Fail</small></div>
          <div class="stat error"><b class="count-num" data-target="${error}">${shown(error)}</b><small>Error</small></div>
        </div>
      </div>
    </header>

    ${printMode ? "" : `<div class="toolbar" role="toolbar" aria-label="Filter results">
      <button type="button" class="filter status-filter active" data-filter="all">All ${results.length}</button>
      <button type="button" class="filter status-filter" data-filter="pass">Pass ${pass}</button>
      <button type="button" class="filter status-filter" data-filter="fail">Fail ${fail}</button>
      <button type="button" class="filter status-filter" data-filter="error">Error ${error}</button>
      <div class="family-pills" role="group" aria-label="Mismatch categories">
        <button type="button" class="filter family-filter text" data-family="text">Text ${families.text}</button>
        <button type="button" class="filter family-filter image" data-family="image">Image ${families.image}</button>
        <button type="button" class="filter family-filter layout" data-family="layout">Layout ${families.layout}</button>
        <button type="button" class="filter family-filter link" data-family="link">Link ${families.link}</button>
      </div>
    </div>`}

    <div class="pages">
      <div class="empty-state" id="empty-state" aria-live="polite">
        <strong>No pages match</strong>
        <span>Try another status or category filter.</span>
      </div>
      ${rows}
    </div>

    <p class="foot">Parity checker POC · geometry ε = 2px · colors ignored</p>
  </div>
  ${printMode ? "" : `<script>
    (function () {
      const statusFilters = document.querySelectorAll(".status-filter");
      const familyFilters = document.querySelectorAll(".family-filter");
      const cards = Array.from(document.querySelectorAll(".page-card"));
      const emptyState = document.getElementById("empty-state");
      const ring = document.querySelector(".ring");
      const bgGrid = document.querySelector(".bg-grid");
      let activeStatus = "all";
      let activeFamily = "all";
      let filterTween = null;

      function cardMatches(card) {
        const status = card.getAttribute("data-status");
        const families = (card.getAttribute("data-families") || "").split(/\\s+/).filter(Boolean);
        const statusOk = activeStatus === "all" || status === activeStatus;
        const familyOk = activeFamily === "all" || families.includes(activeFamily);
        return statusOk && familyOk;
      }

      function applyMismatchVisibility(card) {
        card.querySelectorAll(".mismatch").forEach((m) => {
          const family = m.getAttribute("data-family");
          const show = activeFamily === "all" || family === activeFamily;
          m.classList.toggle("is-hidden", !show);
        });
      }

      function animateFilter() {
        if (typeof gsap === "undefined") {
          cards.forEach((card) => {
            const show = cardMatches(card);
            card.classList.toggle("is-hidden", !show);
            applyMismatchVisibility(card);
            if (show && activeFamily !== "all" && card.getAttribute("data-status") === "fail") {
              const details = card.querySelector("details");
              if (details) details.open = true;
            }
          });
          const anyVisible = cards.some((c) => !c.classList.contains("is-hidden"));
          emptyState.classList.toggle("visible", !anyVisible);
          return;
        }

        if (filterTween) filterTween.kill();

        const toHide = [];
        const toShow = [];
        cards.forEach((card) => {
          const shouldShow = cardMatches(card);
          const isHidden = card.classList.contains("is-hidden");
          if (shouldShow && isHidden) toShow.push(card);
          else if (!shouldShow && !isHidden) toHide.push(card);
          applyMismatchVisibility(card);
          if (shouldShow && activeFamily !== "all" && card.getAttribute("data-status") === "fail") {
            const details = card.querySelector("details");
            if (details) details.open = true;
          }
        });

        filterTween = gsap.timeline({
          defaults: { duration: 0.28, ease: "power2.out" },
          onComplete: () => {
            const anyVisible = cards.some((c) => !c.classList.contains("is-hidden"));
            emptyState.classList.toggle("visible", !anyVisible);
            if (!anyVisible) {
              gsap.fromTo(emptyState, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
            }
          },
        });

        if (toHide.length) {
          filterTween.to(toHide, {
            opacity: 0,
            y: -8,
            scale: 0.98,
            stagger: 0.03,
            onComplete: () => {
              toHide.forEach((card) => {
                card.classList.add("is-hidden");
                gsap.set(card, { clearProps: "opacity,transform" });
              });
            },
          });
        }

        if (toShow.length) {
          toShow.forEach((card) => card.classList.remove("is-hidden"));
          filterTween.fromTo(
            toShow,
            { opacity: 0, y: 14, scale: 0.98 },
            { opacity: 1, y: 0, scale: 1, stagger: 0.05, clearProps: "opacity,transform" },
            toHide.length ? "-=0.05" : 0,
          );
        }

        const visible = cards.filter((c) => cardMatches(c) && !toHide.includes(c));
        if (visible.length && !toShow.length) {
          filterTween.fromTo(
            visible,
            { y: 4 },
            { y: 0, duration: 0.25, stagger: 0.02, ease: "power2.out" },
            0,
          );
        }
      }

      function pulseChip(btn) {
        if (typeof gsap === "undefined") return;
        gsap.fromTo(btn, { scale: 0.94 }, { scale: 1, duration: 0.35, ease: "back.out(2.2)" });
      }

      statusFilters.forEach((btn) => {
        btn.addEventListener("click", () => {
          statusFilters.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          activeStatus = btn.getAttribute("data-filter") || "all";
          pulseChip(btn);
          applyFilter();
        });
      });

      familyFilters.forEach((btn) => {
        btn.addEventListener("click", () => {
          const family = btn.getAttribute("data-family") || "all";
          if (activeFamily === family) {
            activeFamily = "all";
            familyFilters.forEach((b) => b.classList.remove("active"));
          } else {
            activeFamily = family;
            familyFilters.forEach((b) => b.classList.toggle("active", b === btn));
          }
          pulseChip(btn);
          applyFilter();
        });
      });

      function applyFilter() {
        animateFilter();
      }

      function wireHover(el, scale) {
        if (typeof gsap === "undefined") return;
        el.addEventListener("pointerenter", () => {
          gsap.to(el, { y: -3, scale: scale || 1.03, duration: 0.22, ease: "power2.out" });
        });
        el.addEventListener("pointerleave", () => {
          gsap.to(el, { y: 0, scale: 1, duration: 0.28, ease: "power2.out" });
        });
      }

      document.querySelectorAll(".filter").forEach((el) => wireHover(el, 1.04));
      cards.forEach((card) => {
        card.addEventListener("pointerenter", () => {
          if (typeof gsap === "undefined") return;
          gsap.to(card, { y: -4, boxShadow: "0 18px 40px rgba(15,28,40,0.12)", duration: 0.25, ease: "power2.out" });
        });
        card.addEventListener("pointerleave", () => {
          if (typeof gsap === "undefined") return;
          gsap.to(card, { y: 0, boxShadow: "0 10px 28px rgba(15,28,40,0.06)", duration: 0.3, ease: "power2.out" });
        });

        const details = card.querySelector("details");
        const body = card.querySelector(".page-body");
        if (!details || !body || typeof gsap === "undefined") return;

        details.addEventListener("toggle", () => {
          if (details.open) {
            gsap.fromTo(
              body,
              { opacity: 0, y: -6 },
              { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
            );
            const panes = body.querySelectorAll(".pane, .single, .mismatch:not(.is-hidden)");
            gsap.fromTo(
              panes,
              { opacity: 0, y: 10 },
              { opacity: 1, y: 0, duration: 0.35, stagger: 0.04, ease: "power2.out", delay: 0.05 },
            );
          }
        });
      });

      if (bgGrid && typeof gsap !== "undefined") {
        window.addEventListener("mousemove", (e) => {
          const x = (e.clientX / window.innerWidth - 0.5) * 18;
          const y = (e.clientY / window.innerHeight - 0.5) * 18;
          gsap.to(bgGrid, { x, y, duration: 0.8, ease: "power3.out" });
        });
      }

      function countUp(el, target, suffix) {
        if (typeof gsap === "undefined") {
          el.textContent = String(target) + (suffix || "");
          return;
        }
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 1.1,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = Math.round(obj.val) + (suffix || "");
          },
        });
      }

      function boot() {
        if (typeof gsap === "undefined") {
          document.querySelectorAll(".count-pct").forEach((el) => {
            el.textContent = el.getAttribute("data-target") || "0";
          });
          document.querySelectorAll(".count-num").forEach((el) => {
            el.textContent = el.getAttribute("data-target") || "0";
          });
          if (ring) ring.style.setProperty("--p", ring.getAttribute("data-target") || "0");
          return;
        }

        gsap.set([".hero-copy", ".hero-score", ".toolbar", ".page-card", ".foot"], { opacity: 0, y: 18 });

        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.to(".hero-copy", { opacity: 1, y: 0, duration: 0.55 })
          .to(".hero-score", { opacity: 1, y: 0, duration: 0.55 }, "-=0.35")
          .to(".ring", { scale: 1, duration: 0.55, ease: "back.out(1.6)" }, "-=0.4")
          .add(() => {
            document.querySelectorAll(".count-pct").forEach((el) => {
              countUp(el, Number(el.getAttribute("data-target") || 0));
            });
            document.querySelectorAll(".count-num").forEach((el) => {
              countUp(el, Number(el.getAttribute("data-target") || 0));
            });
            if (ring) {
              const target = Number(ring.getAttribute("data-target") || 0);
              const obj = { p: 0 };
              gsap.to(obj, {
                p: target,
                duration: 1.15,
                ease: "power2.out",
                onUpdate: () => ring.style.setProperty("--p", String(obj.p)),
              });
            }
          }, "-=0.35")
          .to(".toolbar", { opacity: 1, y: 0, duration: 0.4 }, "-=0.45")
          .from(".toolbar .filter", { scale: 0.92, duration: 0.28, stagger: 0.035, ease: "back.out(1.7)" }, "-=0.25")
          .to(".page-card", { opacity: 1, y: 0, duration: 0.4, stagger: 0.06 }, "-=0.2")
          .to(".foot", { opacity: 1, y: 0, duration: 0.35 }, "-=0.15");
      }

      boot();
    })();
  </script>`}
</body>
</html>`;
}

export async function writeHtmlReport(
  results: PageResult[],
  outPath: string,
  options?: ReportOptions,
): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, renderHtmlReport(results, options), "utf8");
}
