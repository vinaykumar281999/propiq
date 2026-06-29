import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// Assign a city name to a lat/lng using approximate longitude thresholds.
// Aurora lies east of ~-104.87; Lakewood lies west of ~-105.03.
function assignCity(lat: number, lng: number): string {
  if (lng > -104.87) return "Aurora";
  if (lng < -105.03) return "Lakewood";
  return "Denver County";
  void lat;
}

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Fetch city-level census data
    const cityRows = await sql`
      SELECT city, total_population, population_under_18, youth_pct, median_age
      FROM city_demographics
    `;

    const cityMap: Record<string, {
      total_population: number;
      population_under_18: number;
      youth_pct: number;
      median_age: number;
    }> = {};
    for (const r of cityRows) {
      cityMap[r.city as string] = {
        total_population:    r.total_population    as number,
        population_under_18: r.population_under_18 as number,
        youth_pct:           r.youth_pct           as number,
        median_age:          r.median_age          as number,
      };
    }

    // Fetch all neighborhoods that have valid Denver-area coordinates + H3
    const neighborhoods = await sql`
      SELECT h3_7, lat, lng
      FROM neighborhoods
      WHERE h3_7  IS NOT NULL
        AND lat   BETWEEN 39.4 AND 40.2
        AND lng   BETWEEN -105.4 AND -104.4
    `;

    const demographics: Record<string, {
      total_pop:     number | null;
      pop_under_18:  number | null;
      pct_under_18:  number | null;
      median_income: null;
      tract_count:   number;
    }> = {};

    for (const n of neighborhoods) {
      const city = assignCity(n.lat as number, n.lng as number);
      const data = cityMap[city];
      if (!data) continue;

      demographics[n.h3_7 as string] = {
        total_pop:     data.total_population,
        pop_under_18:  data.population_under_18,
        pct_under_18:  data.youth_pct,
        median_income: null,
        tract_count:   0,
      };
    }

    return NextResponse.json({ demographics });
  } catch (err) {
    console.error("[demographics/batch]", err);
    return NextResponse.json({ demographics: {} });
  }
}
