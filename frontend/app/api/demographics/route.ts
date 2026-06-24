import { NextResponse } from "next/server";

// Demographics not yet loaded into Neon.
export async function GET() {
  return NextResponse.json(null);
}
