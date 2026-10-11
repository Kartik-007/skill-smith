import { NextResponse, type NextRequest } from "next/server";
import { getDb, hasDbConfig } from "@/lib/mongo";
import { MOCK_PRODUCTS } from "@/lib/mock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A judge taps "Pack it" a few times; keep one request per client every few seconds.
const lastByClient = new Map<string, number>();
const COOLDOWN_MS = 4000;

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad(400, "Body must be JSON: {name, product_id}");
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // strip control characters and collapse whitespace
  const name = String(b.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const productId = String(b.product_id ?? "").trim();
  if (name.length < 1 || name.length > 40) return bad(400, "Name must be 1 to 40 characters");
  if (!productId || productId.length > 120) return bad(400, "Pick a snack");

  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const last = lastByClient.get(client) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return bad(429, "One order at a time, try again in a few seconds");

  if (!hasDbConfig()) return bad(503, "Atlas is not configured on this machine");
  try {
    const db = await getDb();
    const products = db.collection<{ _id: string }>("products");
    const known = (await products.estimatedDocumentCount()) > 0;
    const exists = known
      ? Boolean(await products.findOne({ _id: productId }, { projection: { _id: 1 } }))
      : MOCK_PRODUCTS.some((p) => p.id === productId);
    if (!exists) return bad(400, "Unknown snack");

    lastByClient.set(client, Date.now());
    const res = await db.collection("live_requests").insertOne({
      name,
      product_id: productId,
      status: "new",
      created_at: new Date(),
    });
    return NextResponse.json(
      { ok: true, id: String(res.insertedId), name, product_id: productId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/live-order] insert failed:", (err as Error)?.name, (err as Error)?.message?.slice(0, 200));
    return bad(503, "Could not reach Atlas");
  }
}
