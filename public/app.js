const form = document.getElementById("compare-form");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submit");
const historyEl = document.getElementById("history");
const reportWrap = document.getElementById("report-wrap");
const report = document.getElementById("report");

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "";
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
    const row = el("tr");
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
    statusTd.append(el("span", { class: `stamp ${run.status}` }, run.status));
    row.append(statusTd);

    const actions = el("td", { class: "actions" });
    if (run.status === "done") {
      const open = el("a", { class: "ghost", href: `/api/runs/${run._id}/report`, target: "_blank", rel: "noreferrer" }, "Open");
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
      setStatus("Lost the run. Refresh history.", "fail");
      return;
    }
    const run = await res.json();
    if (run.status === "done") {
      const tone = run.summary.fail || run.summary.error ? "fail" : "pass";
      setStatus(`Done. ${run.summary.pass} pass, ${run.summary.fail} fail, ${run.summary.error} error.`, tone);
      report.src = `/api/runs/${runId}/report`;
      reportWrap.hidden = false;
      await loadHistory();
      return;
    }
    if (run.status === "failed") {
      setStatus(run.errorReason || "The comparison failed.", "fail");
      await loadHistory();
      return;
    }
    setStatus(`Comparing ${run.pageCount} page${run.pageCount === 1 ? "" : "s"}…`, "busy");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  setStatus("Timed out waiting for the run.", "fail");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  setStatus("Starting comparison…", "busy");
  try {
    const file = document.getElementById("csv").files[0];
    const mappingCsv = file ? await file.text() : undefined;
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldUrl: document.getElementById("old-url").value,
        newUrl: document.getElementById("new-url").value,
        mappingCsv,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "Could not start the run.", "fail");
      return;
    }
    const queued = `Queued ${data.pageCount} page${data.pageCount === 1 ? "" : "s"} from ${data.source}.`;
    setStatus(data.note ? `${queued} ${data.note}` : queued, "busy");
    await poll(data.runId, data.timeoutMs);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "fail");
  } finally {
    submitBtn.disabled = false;
    await loadHistory();
  }
});

loadHistory().catch((err) => setStatus(err.message, "fail"));
