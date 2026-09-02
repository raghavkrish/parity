import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createRunStore } from "../src/runStore.js";
import { createApp } from "../src/server.js";

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

async function postRun(origin: string, body: Record<string, unknown>) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 429) return res;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server stayed busy");
}

describe("web API", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let server: ReturnType<typeof import("node:http").createServer>;
  let origin: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("parity-api");
    const store = createRunStore(db);
    const app = createApp({
      store,
      allowPrivate: false,
      execute: async ({ store: runStore, runId }) => {
        await runStore.completeRun(runId, {
          results: [{ oldPath: "/", newPath: "/", status: "pass", mismatches: [] }],
          summary: { pass: 1, fail: 0, error: 0 },
          artifacts: {
            html: Buffer.from("<html>ok</html>"),
            printHtml: Buffer.from("<html>print</html>"),
            pdf: Buffer.from("%PDF-1.4"),
          },
        });
      },
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    origin = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await client.close();
    await mongod.stop();
  });

  it("rejects a private old origin", async () => {
    const res = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldUrl: "http://127.0.0.1:4173/",
        newUrl: "https://example.com/",
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/Old site/i);
  });

  it("creates a run, lists it, and serves downloads after done", async () => {
    const created = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldUrl: "https://example.com/index.html",
        newUrl: "https://example.org/index.html",
        mappingCsv: "old_path,new_path\n/index.html,/index.html\n",
      }),
    });
    expect(created.status).toBe(202);
    const payload = await json(created);
    const runId = String(payload.runId);
    expect(runId).toBeTruthy();

    let status = "running";
    for (let i = 0; i < 40; i++) {
      const detail = await fetch(`${origin}/api/runs/${runId}`);
      const body = (await detail.json()) as { status: string };
      status = body.status;
      if (status === "done" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("done");

    const listed = await fetch(`${origin}/api/runs`);
    const listBody = (await listed.json()) as { runs: Array<{ _id: string; status: string }> };
    expect(listBody.runs[0]._id).toBe(runId);
    expect(listBody.runs[0].status).toBe("done");

    const html = await fetch(`${origin}/api/runs/${runId}/report`);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("ok");

    const pdf = await fetch(`${origin}/api/runs/${runId}/report.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toMatch(/pdf/);

    const print = await fetch(`${origin}/api/runs/${runId}/report.print.html`);
    expect(print.status).toBe(200);
    expect(await print.text()).toContain("print");
  });

  it("exposes health and returns timeoutMs on create", async () => {
    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, mongo: "up" });

    const created = await fetch(`${origin}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        oldUrl: "https://example.com/",
        newUrl: "https://example.org/",
        mappingCsv: "old_path,new_path\n/index.html,/index.html\n",
      }),
    });
    expect(created.status).toBe(202);
    const payload = await json(created);
    expect(payload.timeoutMs).toBeTypeOf("number");
  });

  it("creates an upload run from two HTML snapshots", async () => {
    const created = await postRun(origin, {
      oldHtml: `<html><head><link rel="canonical" href="https://example.com/old/"></head><body>old</body></html>`,
      newHtml: `<html><head><link rel="canonical" href="https://example.org/new/"></head><body>new</body></html>`,
    });
    expect(created.status).toBe(202);
    const payload = await json(created);
    expect(payload.source).toBe("upload");
    expect(payload.pageCount).toBe(1);

    const detail = await fetch(`${origin}/api/runs/${String(payload.runId)}`);
    const body = (await detail.json()) as { source: string; pageCount: number };
    expect(body.source).toBe("upload");
    expect(body.pageCount).toBe(1);
  });

  it("rejects a single uploaded HTML file", async () => {
    const res = await postRun(origin, {
      oldHtml: "<html><body>old only</body></html>",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/both old and new/i);
  });

  it("rejects uploaded HTML with no inferable origin", async () => {
    const res = await postRun(origin, {
      oldHtml: "<html><body>old</body></html>",
      newHtml: "<html><body>new</body></html>",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(String(body.error)).toMatch(/canonical or base URL/i);
  });
});
