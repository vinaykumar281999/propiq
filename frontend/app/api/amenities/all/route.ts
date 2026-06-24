import { NextResponse } from "next/server";

// Amenities not yet loaded into Neon.
export async function GET() {
  return NextResponse.json({ amenities: [] });
}
