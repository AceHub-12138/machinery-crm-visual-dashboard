export type XiaochuanMotionMode = "legacy" | "gsap";
export type XiaochuanMotionSelection = { mode: XiaochuanMotionMode; auditAllowed: boolean };

/** Server-page decision. verifiedBoundary must come from raw socket/ALS attestation,
 * never from Host, forwarded headers, URL flags or a browser-provided assertion.
 * This permission is independent of the main screen quality experiment.
 */
export function resolveXiaochuanMotion(
  params: Record<string, string | string[] | undefined>,
  permission: string | undefined,
  verifiedBoundary = false,
  review = false,
): XiaochuanMotionSelection {
  if (verifiedBoundary !== true || permission !== "local-gsap" || params.xiaochuanMotion !== "gsap") {
    return { mode: "legacy", auditAllowed: false };
  }
  return { mode: "gsap", auditAllowed: review || params.debug === "1" };
}
