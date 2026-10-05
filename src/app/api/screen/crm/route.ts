import { NextResponse } from "next/server";
import { buildMockScreenPayload } from "@/lib/mock";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildMockScreenPayload());
}
