import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit  = Math.min(parseInt(searchParams.get("limit")  ?? "10000"), 10000);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0"),     0);

  const [countRow, rows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM neighborhoods`,
    sql`
      SELECT id, name, metro, price, expected_return,
             days_on_market, lat, lng, h3_7, h3_9
      FROM   neighborhoods
      ORDER  BY id
      LIMIT  ${limit}
      OFFSET ${offset}
    `,
  ]);

  const total = countRow[0].count as number;

  const properties = rows.map((r) => ({
    id:              r.id              as number,
    name:            r.name            as string,
    metro:           r.metro           as string | null,
    price:           r.price           as number,
    expected_return: r.expected_return as number,
    roi_pct:         r.price > 0
                       ? Math.round((r.expected_return / r.price) * 10000) / 100
                       : 0,
    days_on_market:  r.days_on_market  as number | null,
    lat:             r.lat             as number | null,
    lng:             r.lng             as number | null,
    h3_7:            r.h3_7            as string | null,
    h3_9:            r.h3_9            as string | null,
    h3_index:        r.h3_7            as string | null,
  }));

  return NextResponse.json({ total, properties });
}
