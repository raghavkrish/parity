import { GridFSBucket, MongoClient, type Db } from "mongodb";

const DEFAULT_DB = "parity";
const BUCKET_NAME = "reports";

let client: MongoClient | null = null;

export function mongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  return uri;
}

export function mongoDbName(): string {
  return process.env.MONGODB_DB || DEFAULT_DB;
}

export async function connectMongo(uri = mongoUri(), dbName = mongoDbName()): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(dbName);
}

export function reportsBucket(db: Db): GridFSBucket {
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

export async function ensureIndexes(db: Db): Promise<void> {
  const runs = db.collection("runs");
  await runs.createIndex({ createdAt: -1 });
  await runs.createIndex({ status: 1, createdAt: -1 });
}

export async function closeMongo(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
}
