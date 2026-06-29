import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city") ?? "Denver County";

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT city, total_population, population_under_18, youth_pct, median_age
      FROM city_demographics
      WHERE city = ${city}
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "City not found" }, { status: 404 });
    }

    const r = rows[0];
    return NextResponse.json({
      city:               r.city,
      total_population:   r.total_population,
      population_under_18: r.population_under_18,
      youth_pct:          r.youth_pct,
      median_age:         r.median_age,
    });
  } catch (err) {
    console.error("[demographics]", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
