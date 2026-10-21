"use client";
import { useState } from "react";
import Link from "next/link";
import { OverlayStage } from "@/components/overlay/OverlayStage";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";
import type { XiaochuanMotionSelection } from "@/components/overlay/motion/permission";
export function XiaochuanReview({payload, selection}:{payload:PublicScreenPayload; selection:XiaochuanMotionSelection}) {
  const [mounted,setMounted]=useState(true);
  const hub=typeof window!=="undefined" ? new URLSearchParams(window.location.search).get("hub")??undefined : undefined;
  return <main style={{background:"#0a0806",minHeight:"100vh",color:"#ffe8c7"}}>
    <nav style={{position:"fixed",zIndex:100,top:8,left:8}}>
      <button onClick={()=>setMounted(v=>!v)}>{mounted?"卸载小川":"重新挂载小川"}</button>{" "}
      <Link href={{pathname:"/poc/xiaochuan",query:{xiaochuanMotion:"legacy",...(hub?{hub}:{})}}}>Legacy 模式</Link>{" "}
      <Link href={{pathname:"/poc/xiaochuan",query:{xiaochuanMotion:"gsap",...(hub?{hub}:{})}}}>GSAP 模式</Link>{" "}
      <Link href="/voice-console">离开原型</Link>
    </nav>
    {mounted ? <OverlayStage key={`${selection.mode}:${selection.auditAllowed}`} xiaochuanMotion={selection.mode} xiaochuanAuditAllowed={selection.auditAllowed} payload={payload} driver="live" hubUrl={hub}/> : null}
  </main>;
}
