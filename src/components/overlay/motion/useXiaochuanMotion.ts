"use client";
import { useEffect, useState } from "react";
import type { XiaochuanTimeline } from "./XiaochuanTimeline";
import type { XiaochuanMotionMode } from "./permission";
type AuditWindow = Window & { __xiaochuanMotionAudit?: () => ReturnType<XiaochuanTimeline["audit"]> | null };
/** Server-selected experiment. Legacy does not load the GSAP overlay module. */
export function useXiaochuanMotion(reduced: boolean, mode: XiaochuanMotionMode = "legacy", auditAllowed = false) {
  const [motion, setMotion] = useState<XiaochuanTimeline | null>(null);
  useEffect(() => {
    if (mode !== "gsap") return;
    let cancelled = false;
    let instance: XiaochuanTimeline | null = null;
    const target = window as AuditWindow;
    const audit = () => instance?.audit() ?? null;
    const visibility = () => instance?.visibility(document.hidden);
    void import("./XiaochuanTimeline").then(({ XiaochuanTimeline }) => {
      if (cancelled) return;
      instance = new XiaochuanTimeline(); instance.visibility(document.hidden);
      document.addEventListener("visibilitychange", visibility); setMotion(instance);
      if (auditAllowed) target.__xiaochuanMotionAudit = audit;
    }).catch(() => { /* module load failure keeps the complete Legacy path */ });
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      // An overlapping old cleanup must not remove a newer registration.
      if (target.__xiaochuanMotionAudit === audit) delete target.__xiaochuanMotionAudit;
      instance?.dispose(); instance = null; // revoke saved closures and release their controller reference
      setMotion(null);
    };
  }, [mode, auditAllowed]);
  useEffect(() => { motion?.setReduced(reduced); }, [motion, reduced]);
  return mode === "gsap" ? motion : null;
}
