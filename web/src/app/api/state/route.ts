import { NextResponse, type NextRequest } from "next/server";
import { loadState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const forceMock = req.nextUrl.searchParams.get("mock") === "1";
  const state = await loadState({ forceMock });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
