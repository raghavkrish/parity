import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { Db, GridFSBucket, ObjectId } from "mongodb";
import { reportsBucket } from "./db/mongo.js";
import type { DiscoverSource } from "./discover.js";
import type { MappingPair, PageResult } from "./types.js";

export type RunStatus = "running" | "done" | "failed";

export type RunSummary = {
  pass: number;
  fail: number;
  error: number;
};

export type RunArtifacts = {
  html?: ObjectId;
  printHtml?: ObjectId;
  pdf?: ObjectId;
};

export type RunDoc = {
  _id: string;
  createdAt: Date;
  finishedAt?: Date;
  status: RunStatus;
  oldOrigin: string;
  newOrigin: string;
  source: DiscoverSource;
  pageCount: number;
  summary: RunSummary;
  pairs: MappingPair[];
  results: PageResult[];
  artifacts: RunArtifacts;
  errorReason?: string;
};

export type RunListItem = Omit<RunDoc, "results">;

export type CreateRunInput = {
  oldOrigin: string;
  newOrigin: string;
  source: DiscoverSource;
  pairs: MappingPair[];
};

export type ArtifactBuffers = {
  html: Buffer;
  printHtml: Buffer;
  pdf: Buffer;
};

export type ArtifactKind = keyof ArtifactBuffers;

const ARTIFACT_META: Record<ArtifactKind, { mime: string; ext: string }> = {
  html: { mime: "text/html; charset=utf-8", ext: "html" },
  printHtml: { mime: "text/html; charset=utf-8", ext: "print.html" },
  pdf: { mime: "application/pdf", ext: "pdf" },
};

export type ArtifactDownload = {
  stream: Readable;
  mime: string;
  filename: string;
};

function newRunId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${ts}-${randomBytes(4).toString("hex")}`;
}

async function uploadBuffer(
  bucket: GridFSBucket,
  runId: string,
  kind: ArtifactKind,
  bytes: Buffer,
): Promise<ObjectId> {
  const meta = ARTIFACT_META[kind];
  const filename = `${runId}.${meta.ext}`;
  const stream = bucket.openUploadStream(filename, {
    metadata: { runId, kind, mime: meta.mime },
  });
  Readable.from(bytes).pipe(stream);
  await finished(stream);
  return stream.id;
}

export function createRunStore(db: Db) {
  const runs = db.collection<RunDoc>("runs");
  const bucket = reportsBucket(db);

  async function createRun(input: CreateRunInput): Promise<string> {
    const id = newRunId();
    const doc: RunDoc = {
      _id: id,
      createdAt: new Date(),
      status: "running",
      oldOrigin: input.oldOrigin,
      newOrigin: input.newOrigin,
      source: input.source,
      pageCount: input.pairs.length,
      summary: { pass: 0, fail: 0, error: 0 },
      pairs: input.pairs,
      results: [],
      artifacts: {},
    };
    await runs.insertOne(doc);
    return id;
  }

  async function completeRun(
    id: string,
    payload: { results: PageResult[]; summary: RunSummary; artifacts: ArtifactBuffers },
  ): Promise<void> {
    const html = await uploadBuffer(bucket, id, "html", payload.artifacts.html);
    const printHtml = await uploadBuffer(bucket, id, "printHtml", payload.artifacts.printHtml);
    const pdf = await uploadBuffer(bucket, id, "pdf", payload.artifacts.pdf);

    await runs.updateOne(
      { _id: id },
      {
        $set: {
          status: "done",
          finishedAt: new Date(),
          results: payload.results,
          summary: payload.summary,
          pageCount: payload.results.length,
          artifacts: { html, printHtml, pdf },
        },
      },
    );
  }

  async function failRun(id: string, reason: string): Promise<void> {
    await runs.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          errorReason: reason,
        },
      },
    );
  }

  async function listRuns(limit = 50): Promise<RunListItem[]> {
    return runs
      .find({}, { projection: { results: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async function getRun(id: string): Promise<RunDoc | null> {
    return runs.findOne({ _id: id });
  }

  async function failStaleRuns(reason = "interrupted"): Promise<number> {
    const result = await runs.updateMany(
      { status: "running" },
      { $set: { status: "failed", finishedAt: new Date(), errorReason: reason } },
    );
    return result.modifiedCount;
  }

  async function ping(): Promise<void> {
    await runs.findOne({}, { projection: { _id: 1 } });
  }

  async function openArtifact(id: string, kind: ArtifactKind): Promise<ArtifactDownload | null> {
    const run = await getRun(id);
    const fileId = run?.artifacts[kind];
    if (!fileId) return null;
    const meta = ARTIFACT_META[kind];
    return {
      stream: bucket.openDownloadStream(fileId),
      mime: meta.mime,
      filename: `${id}.${meta.ext}`,
    };
  }

  return { createRun, completeRun, failRun, failStaleRuns, ping, listRuns, getRun, openArtifact };
}

export type RunStore = ReturnType<typeof createRunStore>;
