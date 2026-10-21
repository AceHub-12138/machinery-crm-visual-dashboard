import { notFound } from "next/navigation";
import { fromPublicSalesScreenPayload } from "@/lib/public-screen-payload";
import { validatePublicPayload } from "@/lib/voice/public-payload";
import seed from "../../../../services/voice-orchestrator/fixtures/public-sales-screen.json";
import { XiaochuanReview } from "./review";
export const dynamic = "force-dynamic";
/** Local review harness: fixed synthetic fixture and no production fetch. */
export default function XiaochuanReviewPage() {
  if (process.env.XIAOCHUAN_POC_REVIEW !== "1") notFound();
  const fixture = validatePublicPayload(seed)!;
  return <XiaochuanReview payload={fromPublicSalesScreenPayload(fixture)}/>;
}
