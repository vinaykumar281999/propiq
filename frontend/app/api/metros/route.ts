import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  const rows = await sql`
    SELECT DISTINCT metro FROM neighborhoods
    WHERE metro IS NOT NULL
    ORDER BY metro
  `;
  return NextResponse.json({ metros: rows.map((r) => r.metro as string) });
}
