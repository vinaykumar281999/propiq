import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type   = searchParams.get("type") ?? "school";
  const swLat  = parseFloat(searchParams.get("sw_lat") ?? "39.3");
  const neLat  = parseFloat(searchParams.get("ne_lat") ?? "40.2");
  const swLng  = parseFloat(searchParams.get("sw_lng") ?? "-105.6");
  const neLng  = parseFloat(searchParams.get("ne_lng") ?? "-104.3");

  if (isNaN(swLat) || isNaN(neLat) || isNaN(swLng) || isNaN(neLng)) {
    return NextResponse.json({ error: "Invalid bounding box parameters" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, osm_id, type, name, lat, lng, h3_7, h3_9
    FROM   amenities
    WHERE  type = ${type}
      AND  lat  BETWEEN ${swLat} AND ${neLat}
      AND  lng  BETWEEN ${swLng} AND ${neLng}
    LIMIT  2000
  `;

  const amenities = rows.map((r) => ({
    id:     r.id     as number,
    osm_id: r.osm_id as string | null,
    type:   r.type   as string,
    name:   r.name   as string | null,
    lat:    r.lat    as number,
    lng:    r.lng    as number,
    h3_7:   r.h3_7   as string | null,
    h3_9:   r.h3_9   as string | null,
  }));

  return NextResponse.json({ amenities });
}
