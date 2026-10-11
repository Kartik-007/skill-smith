// Shape of the Storage page: every place the system keeps state, with a sample of what's in it.
// Built server-side (load.ts) from Atlas; a copy is saved as public/storage_snapshot.json as a stage fallback.

export type StoreGroup = "atlas" | "truth" | "raindrop";

export interface Column {
  key: string;
  label: string;
  /** render as code */
  mono?: boolean;
  /** let this column take the spare width */
  wide?: boolean;
}

export interface Row {
  id: string;
  cells: Record<string, string>;
  tone?: "ok" | "bad" | null;
  /** the stored document, with long vectors and blobs shortened */
  raw: unknown;
}

export interface Store {
  id: string;
  group: StoreGroup;
  label: string;
  /** where it lives, e.g. "skillsmith.memory  {kind: lesson}" */
  location: string;
  count: number | null;
  what: string;
  writes: string;
  reads: string;
  /** the database feature doing the work, e.g. "Vector Search, pre-filtered by kind" */
  feature?: string;
  facets: { label: string; value: string }[];
  columns: Column[];
  rows: Row[];
  /** rows shown are a sample of count */
  sampled?: boolean;
  locked?: boolean;
}

export interface StorageSnapshot {
  source: "live" | "snapshot";
  db: string;
  taken_at: string;
  stores: Store[];
  error?: string;
}
