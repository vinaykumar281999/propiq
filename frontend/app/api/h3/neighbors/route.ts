import { NextResponse } from "next/server";

// H3 spatial queries not yet available without the backend.
export async function GET() {
  return NextResponse.json({ cells: [], neighborhoods: [] });
}
