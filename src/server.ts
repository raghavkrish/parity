import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_PAGES, discoverPairs } from "./discover.js";
import { resolveUploadSite } from "./htmlOrigin.js";
import { executeRun } from "./jobs.js";
import { parseSiteUrl } from "./origins.js";
import type { RunStore } from "./runStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export type AppOptions = {
  store: RunStore;
  allowPrivate?: boolean;
  maxPages?: number;
  runTimeoutMs?: number;
  publicDir?: string;
  execute?: typeof executeRun;
};

export function createApp(options: AppOptions): express.Express {
  const {
    store,
    allowPrivate = process.env.ALLOW_PRIVATE_ORIGINS === "1",
    maxPages = Number(process.env.MAX_PAGES ?? DEFAULT_MAX_PAGES),
    runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS ?? 240_000),
    publicDir = path.resolve(here, "..", "public"),
    execute = executeRun,
  } = options;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16mb" }));
  app.use(express.static(publicDir));

  let busy = false;

  app.get("/api/health", async (_req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, mongo: "up" });
    } catch {
      res.status(503).json({ ok: false, mongo: "down" });
    }
  });

  app.get("/api/runs", async (_req, res) => {
    const runs = await store.listRuns(100);
    res.json({ runs });
  });

  app.get("/api/runs/:id", async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({
      id: run._id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      oldOrigin: run.oldOrigin,
      newOrigin: run.newOrigin,
      source: run.source,
      pageCount: run.pageCount,
      summary: run.summary,
      pairs: run.pairs,
      errorReason: run.errorReason,
      pages: run.results.map((r) => ({
        oldPath: r.oldPath,
        newPath: r.newPath,
        status: r.status,
      })),
    });
  });

  app.get("/api/runs/:id/data.json", async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run || run.status !== "done") {
      res.status(404).json({ error: "Run data is not ready" });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="${run._id}.json"`);
    res.json({
      id: run._id,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      oldOrigin: run.oldOrigin,
      newOrigin: run.newOrigin,
      source: run.source,
      pairs: run.pairs,
      summary: run.summary,
      results: run.results,
    });
  });

  app.get("/api/runs/:id/report", async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run || run.status !== "done") {
      res.status(404).json({ error: "Report is not ready" });
      return;
    }
    const art = await store.openArtifact(run._id, "html");
    if (!art) {
      res.status(404).json({ error: "Missing HTML report" });
      return;
    }
    res.setHeader("Content-Type", art.mime);
    art.stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    art.stream.pipe(res);
  });

  app.get("/api/runs/:id/report.print.html", async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run || run.status !== "done") {
      res.status(404).json({ error: "Print report is not ready" });
      return;
    }
    const art = await store.openArtifact(run._id, "printHtml");
    if (!art) {
      res.status(404).json({ error: "Missing print HTML report" });
      return;
    }
    res.setHeader("Content-Type", art.mime);
    art.stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    art.stream.pipe(res);
  });

  app.get("/api/runs/:id/report.pdf", async (req, res) => {
    const run = await store.getRun(req.params.id);
    if (!run || run.status !== "done") {
      res.status(404).json({ error: "PDF is not ready" });
      return;
    }
    const art = await store.openArtifact(run._id, "pdf");
    if (!art) {
      res.status(404).json({ error: "Missing PDF report" });
      return;
    }
    res.setHeader("Content-Type", art.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${art.filename}"`);
    art.stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    art.stream.pipe(res);
  });

  app.post("/api/runs", async (req, res) => {
    if (busy) {
      res.status(429).json({ error: "A comparison is already running. Try again shortly." });
      return;
    }

    const oldUrl = typeof req.body?.oldUrl === "string" ? req.body.oldUrl : "";
    const newUrl = typeof req.body?.newUrl === "string" ? req.body.newUrl : "";
    const mappingCsv = typeof req.body?.mappingCsv === "string" ? req.body.mappingCsv : undefined;
    const oldHtml = typeof req.body?.oldHtml === "string" ? req.body.oldHtml.trim() : "";
    const newHtml = typeof req.body?.newHtml === "string" ? req.body.newHtml.trim() : "";

    if (Boolean(oldHtml) !== Boolean(newHtml)) {
      res.status(400).json({ error: "Upload both old and new HTML files, or neither." });
      return;
    }

    if (oldHtml && newHtml) {
      const [oldSite, newSite] = await Promise.all([
        resolveUploadSite(oldHtml, oldUrl, { allowPrivate, label: "Old" }),
        resolveUploadSite(newHtml, newUrl, { allowPrivate, label: "New" }),
      ]);
      if (!oldSite.ok) {
        res.status(400).json({ error: oldSite.error });
        return;
      }
      if (!newSite.ok) {
        res.status(400).json({ error: newSite.error });
        return;
      }

      const pairs = [{ oldPath: oldSite.path, newPath: newSite.path }];
      busy = true;
      let runId: string;
      try {
        runId = await store.createRun({
          oldOrigin: oldSite.origin,
          newOrigin: newSite.origin,
          source: "upload",
          pairs,
        });
      } catch (err) {
        busy = false;
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
        return;
      }

      res.status(202).json({
        runId,
        source: "upload",
        pageCount: 1,
        truncated: false,
        timeoutMs: runTimeoutMs,
      });

      void execute({
        store,
        runId,
        oldOrigin: oldSite.origin,
        newOrigin: newSite.origin,
        pairs,
        timeoutMs: runTimeoutMs,
        allowPrivate,
        source: "upload",
        html: { old: oldHtml, new: newHtml },
      }).finally(() => {
        busy = false;
      });
      return;
    }

    const [oldParsed, newParsed] = await Promise.all([
      parseSiteUrl(oldUrl, { allowPrivate }),
      parseSiteUrl(newUrl, { allowPrivate }),
    ]);
    if (!oldParsed.ok) {
      res.status(400).json({ error: `Old site: ${oldParsed.error}` });
      return;
    }
    if (!newParsed.ok) {
      res.status(400).json({ error: `New site: ${newParsed.error}` });
      return;
    }

    const discovered = await discoverPairs({
      oldOrigin: oldParsed.origin,
      oldPath: oldParsed.path,
      newPath: newParsed.path,
      mappingCsv,
      maxPages,
      allowPrivate,
    });
    if ("error" in discovered) {
      res.status(400).json({ error: discovered.error });
      return;
    }

    busy = true;
    let runId: string;
    try {
      runId = await store.createRun({
        oldOrigin: oldParsed.origin,
        newOrigin: newParsed.origin,
        source: discovered.source,
        pairs: discovered.pairs,
      });
    } catch (err) {
      busy = false;
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
      return;
    }

    res.status(202).json({
      runId,
      source: discovered.source,
      pageCount: discovered.pairs.length,
      truncated: discovered.truncated,
      note: discovered.note,
      timeoutMs: runTimeoutMs,
    });

    void execute({
      store,
      runId,
      oldOrigin: oldParsed.origin,
      newOrigin: newParsed.origin,
      pairs: discovered.pairs,
      timeoutMs: runTimeoutMs,
      allowPrivate,
      source: discovered.source,
    }).finally(() => {
      busy = false;
    });
  });

  return app;
}
