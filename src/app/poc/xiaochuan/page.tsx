import { notFound } from "next/navigation";
import { fromPublicSalesScreenPayload } from "@/lib/public-screen-payload";
import { validatePublicPayload } from "@/lib/voice/public-payload";
import seed from "../../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { XiaochuanReview } from "./review";
import { hasVerifiedLocalQualityBoundary } from "@/server/local-quality-request";
import { resolveXiaochuanMotion } from "@/components/overlay/motion/permission";
export const dynamic = "force-dynamic";
/** Local review harness: fixed synthetic fixture and no production fetch. */
export default async function XiaochuanReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const verifiedBoundary = hasVerifiedLocalQualityBoundary();
  if (process.env.XIAOCHUAN_POC_REVIEW !== "1" || !verifiedBoundary) notFound();
  const selection = resolveXiaochuanMotion(await searchParams, process.env.XIAOCHUAN_MOTION_PERMISSION, verifiedBoundary, true);
  const fixture = validatePublicPayload(seed)!;
  return <XiaochuanReview selection={selection} payload={fromPublicSalesScreenPayload(fixture)}/>;
}
