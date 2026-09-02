import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createRunStore } from "../src/runStore.js";
import type { PageResult } from "../src/types.js";

const sampleResults: PageResult[] = [
  { oldPath: "/a.html", newPath: "/a.html", status: "pass", mismatches: [] },
  {
    oldPath: "/b.html",
    newPath: "/b.html",
    status: "fail",
    mismatches: [{ kind: "text_changed", oldValue: "x", newValue: "y" }],
  },
];

describe("runStore", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("parity-test");
  }, 60_000);

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it("creates a running document and only marks it done after artifacts upload", async () => {
    const store = createRunStore(db);
    const id = await store.createRun({
      oldOrigin: "https://old.example.com",
      newOrigin: "https://new.example.com",
      source: "single",
      pairs: [{ oldPath: "/a.html", newPath: "/a.html" }],
    });

    const created = await store.getRun(id);
    expect(created?.status).toBe("running");
    expect(created?.results).toEqual([]);

    await store.completeRun(id, {
      results: sampleResults,
      summary: { pass: 1, fail: 1, error: 0 },
      artifacts: {
        html: Buffer.from("<html>interactive</html>"),
        printHtml: Buffer.from("<html>print</html>"),
        pdf: Buffer.from("%PDF-1.4"),
      },
    });

    const done = await store.getRun(id);
    expect(done?.status).toBe("done");
    expect(done?.results).toHaveLength(2);
    expect(done?.artifacts.html).toBeTruthy();
    expect(done?.artifacts.pdf).toBeTruthy();

    const pdf = await store.openArtifact(id, "pdf");
    expect(pdf).not.toBeNull();
    if (!pdf) return;
    expect(pdf.mime).toBe("application/pdf");
    const chunks: Buffer[] = [];
    for await (const chunk of pdf.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("%PDF-1.4");
  });

  it("lists summary rows without embedding results", async () => {
    const store = createRunStore(db);
    const listed = await store.listRuns(10);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]).not.toHaveProperty("results");
    expect(listed[0].status).toBe("done");
  });

  it("records a failed run without flipping it to done", async () => {
    const store = createRunStore(db);
    const id = await store.createRun({
      oldOrigin: "https://old.example.com",
      newOrigin: "https://new.example.com",
      source: "sitemap",
      pairs: [],
    });
    await store.failRun(id, "sitemap timed out");
    const failed = await store.getRun(id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorReason).toBe("sitemap timed out");
  });

  it("marks leftover running documents as interrupted", async () => {
    const store = createRunStore(db);
    const id = await store.createRun({
      oldOrigin: "https://old.example.com",
      newOrigin: "https://new.example.com",
      source: "single",
      pairs: [],
    });
    const n = await store.failStaleRuns("interrupted");
    expect(n).toBeGreaterThan(0);
    const stale = await store.getRun(id);
    expect(stale?.status).toBe("failed");
    expect(stale?.errorReason).toBe("interrupted");
  });
});
