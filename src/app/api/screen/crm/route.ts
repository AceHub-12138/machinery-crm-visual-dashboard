import { NextResponse } from "next/server";
import { buildMockScreenPayload } from "@/lib/mock";
import { toPublicScreenPayload } from "@/lib/public-screen-payload";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(toPublicScreenPayload(buildMockScreenPayload()), { headers: { "Cache-Control": "no-store" } });
}
