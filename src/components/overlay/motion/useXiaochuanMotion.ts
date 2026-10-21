"use client";
import { useEffect, useState } from "react";
import type { XiaochuanTimeline } from "./XiaochuanTimeline";
/** Explicit local PoC switch. Legacy does not load the GSAP overlay module. */
export function useXiaochuanMotion(reduced: boolean) {
  const [motion, setMotion] = useState<XiaochuanTimeline | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("xiaochuanMotion") !== "gsap") return;
    let cancelled = false;
    let instance: XiaochuanTimeline | null = null;
    const visibility = () => instance?.visibility(document.hidden);
    void import("./XiaochuanTimeline").then(({ XiaochuanTimeline }) => {
      if (cancelled) return;
      instance = new XiaochuanTimeline(); instance.visibility(document.hidden);
      document.addEventListener("visibilitychange", visibility); setMotion(instance);
      // Read-only diagnostics are exposed only with the explicit PoC switch.
      Object.assign(window, { __xiaochuanMotionAudit: () => instance!.audit() });
    }).catch(() => { /* module load failure keeps the complete Legacy path */ });
    return () => { cancelled = true; document.removeEventListener("visibilitychange", visibility); instance?.dispose(); };
  }, []);
  useEffect(() => { motion?.setReduced(reduced); }, [motion, reduced]);
  return motion;
}
