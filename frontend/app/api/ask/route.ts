import { NextResponse } from "next/server";

// AI advisor not yet available in production.
export async function POST() {
  return NextResponse.json({ answer: "AI advisor not available in production yet." });
}
