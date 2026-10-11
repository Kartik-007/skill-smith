import "server-only";
import { MongoClient, type Db } from "mongodb";

// One client per server process; survives Next dev hot reloads via globalThis.
const g = globalThis as unknown as { _skillsmithMongo?: Promise<MongoClient> };

export function hasDbConfig(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const dbName = process.env.MONGODB_DB || "skillsmith";
  // Never touch the hidden-truth database from the web.
  if (dbName.endsWith("_truth")) throw new Error("refusing to read the truth database");
  if (!g._skillsmithMongo) {
    const client = new MongoClient(uri, {
      appName: "skillsmith-web",
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      maxPoolSize: 10,
    });
    g._skillsmithMongo = client.connect().catch((err) => {
      g._skillsmithMongo = undefined; // retry on the next request
      throw err;
    });
  }
  const client = await g._skillsmithMongo;
  return client.db(dbName);
}
