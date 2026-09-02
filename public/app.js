const form = document.getElementById("compare-form");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submit");
const historyEl = document.getElementById("history");
const progressLabel = document.getElementById("run-progress-label");
const reportModal = document.getElementById("report-modal");
const report = document.getElementById("report");
const reportClose = document.getElementById("report-close");
const oldUrlInput = document.getElementById("old-url");
const newUrlInput = document.getElementById("new-url");

let activeRunId = "";

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "";
}

function setBusy(busy, label) {
  form.setAttribute("aria-busy", busy ? "true" : "false");
  submitBtn.disabled = busy;
  if (label) progressLabel.textContent = label;
}

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function originHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (text != null) node.textContent = text;
  return node;
}

function openReport(runId) {
  report.src = `/api/runs/${runId}/report`;
  reportModal.hidden = false;
  document.body.classList.add("modal-open");
  reportClose.focus();
}

function closeReport() {
  reportModal.hidden = true;
  document.body.classList.remove("modal-open");
  report.removeAttribute("src");
}

function renderHistory(runs) {
  historyEl.replaceChildren();
  if (!runs.length) {
    historyEl.append(
      el("p", { class: "empty" }, "No saved runs yet. The first comparison will appear here permanently."),
    );
    return;
  }

  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["When", "Sites", "Pages", "Status", "Downloads"]) {
    headRow.append(el("th", null, label));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const run of runs) {
    const row = el("tr", { "data-run-id": run._id });
    if (run._id === activeRunId) row.setAttribute("data-active", "true");
    row.append(el("td", null, fmtTime(run.createdAt)));

    const sites = el("td");
    sites.append(el("div", { class: "paths" }, `${originHost(run.oldOrigin)} → ${originHost(run.newOrigin)}`));
    const counts = run.summary
      ? `${run.summary.pass} pass · ${run.summary.fail} fail · ${run.summary.error} error`
      : "—";
    sites.append(el("small", null, `${run.source || ""} · ${counts}`));
    row.append(sites);

    row.append(el("td", null, String(run.pageCount ?? 0)));
    const statusTd = el("td");
    const stamp = el("span", { class: `stamp ${run.status}` }, run.status);
    if (run.status === "running") {
      stamp.prepend(el("span", { class: "ring sm", "aria-hidden": "true" }));
    }
    statusTd.append(stamp);
    row.append(statusTd);

    const actions = el("td", { class: "actions" });
    if (run.status === "done") {
      const open = el("button", { type: "button", class: "ghost", "data-open-report": run._id }, "Open");
      const pdf = el("a", { class: "ghost", href: `/api/runs/${run._id}/report.pdf` }, "PDF");
      const json = el("a", { class: "ghost", href: `/api/runs/${run._id}/data.json` }, "JSON");
      actions.append(open, pdf, json);
    } else {
      actions.append(el("span", { class: "empty" }, run.errorReason || "In progress"));
    }
    row.append(actions);
    tbody.append(row);
  }
  table.append(tbody);
  historyEl.append(table);
}

async function loadHistory() {
  const res = await fetch("/api/runs");
  const data = await res.json();
  renderHistory(data.runs || []);
}

async function poll(runId, timeoutMs) {
  const started = Date.now();
  const deadline = Number(timeoutMs) > 0 ? Number(timeoutMs) + 20_000 : 260_000;
  while (Date.now() - started < deadline) {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) {
      setBusy(false);
      setStatus("Lost the run. Refresh history.", "fail");
      return;
    }
    const run = await res.json();
    if (run.status === "done") {
      const tone = run.summary.fail || run.summary.error ? "fail" : "pass";
      setStatus(`Done. ${run.summary.pass} pass, ${run.summary.fail} fail, ${run.summary.error} error.`, tone);
      setBusy(false);
      await loadHistory();
      openReport(runId);
      return;
    }
    if (run.status === "failed") {
      setBusy(false);
      setStatus(run.errorReason || "The comparison failed.", "fail");
      await loadHistory();
      return;
    }
    const pages = `Comparing ${run.pageCount} page${run.pageCount === 1 ? "" : "s"}…`;
    setStatus(pages, "busy");
    progressLabel.textContent = pages;
    await loadHistory();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  setBusy(false);
  setStatus("Timed out waiting for the run.", "fail");
}

function bindHtmlDrop(zone, input) {
  const nameEl = zone.querySelector(".drop-name");
  const clearBtn = zone.querySelector(".drop-clear");
  const placeholder = nameEl.textContent;
  let html = "";

  function syncUrlRequired() {
    const both = Boolean(oldHtmlDrop.get() && newHtmlDrop.get());
    oldUrlInput.required = !both;
    newUrlInput.required = !both;
  }

  function clear() {
    html = "";
    input.value = "";
    nameEl.textContent = placeholder;
    clearBtn.hidden = true;
    zone.removeAttribute("data-filled");
    syncUrlRequired();
  }

  async function setFile(file) {
    if (!file) {
      clear();
      return;
    }
    if (!/\.html?$/i.test(file.name)) {
      setStatus("Use an .html or .htm file.", "fail");
      return;
    }
    html = await file.text();
    nameEl.textContent = file.name;
    clearBtn.hidden = false;
    zone.setAttribute("data-filled", "true");
    syncUrlRequired();
  }

  zone.addEventListener("click", (event) => {
    if (event.target.closest(".drop-clear")) return;
    input.click();
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.setAttribute("data-over", "true");
  });
  zone.addEventListener("dragleave", () => {
    zone.removeAttribute("data-over");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.removeAttribute("data-over");
    const file = event.dataTransfer?.files?.[0];
    void setFile(file);
  });
  input.addEventListener("change", () => {
    void setFile(input.files[0]);
  });
  input.addEventListener("click", (event) => event.stopPropagation());
  clearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    clear();
  });

  return {
    get() {
      return html;
    },
    syncUrlRequired,
  };
}

const oldHtmlDrop = bindHtmlDrop(
  document.getElementById("old-html-zone"),
  document.getElementById("old-html"),
);
const newHtmlDrop = bindHtmlDrop(
  document.getElementById("new-html-zone"),
  document.getElementById("new-html"),
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true, "Starting comparison…");
  setStatus("Starting comparison…", "busy");
  try {
    const file = document.getElementById("csv").files[0];
    const mappingCsv = file ? await file.text() : undefined;
    const oldHtml = oldHtmlDrop.get();
    const newHtml = newHtmlDrop.get();
    const body = {};
    const oldUrl = oldUrlInput.value.trim();
    const newUrl = newUrlInput.value.trim();
    if (oldUrl) body.oldUrl = oldUrl;
    if (newUrl) body.newUrl = newUrl;
    if (mappingCsv) body.mappingCsv = mappingCsv;
    if (oldHtml && newHtml) {
      body.oldHtml = oldHtml;
      body.newHtml = newHtml;
    }
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setBusy(false);
      setStatus(data.error || "Could not start the run.", "fail");
      return;
    }
    activeRunId = data.runId;
    const queued = `Queued ${data.pageCount} page${data.pageCount === 1 ? "" : "s"} from ${data.source}.`;
    setStatus(data.note ? `${queued} ${data.note}` : queued, "busy");
    progressLabel.textContent = `Comparing ${data.pageCount} page${data.pageCount === 1 ? "" : "s"}…`;
    await loadHistory();
    await poll(data.runId, data.timeoutMs);
  } catch (err) {
    setBusy(false);
    setStatus(err instanceof Error ? err.message : String(err), "fail");
  } finally {
    submitBtn.disabled = false;
    await loadHistory();
  }
});

historyEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-report]");
  if (!button) return;
  openReport(button.getAttribute("data-open-report"));
});

reportClose.addEventListener("click", closeReport);
reportModal.addEventListener("click", (event) => {
  if (event.target === reportModal) closeReport();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !reportModal.hidden) closeReport();
});

loadHistory().catch((err) => setStatus(err.message, "fail"));
