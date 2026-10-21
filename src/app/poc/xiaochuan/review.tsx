"use client";
import { useState } from "react";
import Link from "next/link";
import { OverlayStage } from "@/components/overlay/OverlayStage";
import type { PublicScreenPayload } from "@/lib/public-screen-payload";
export function XiaochuanReview({payload}:{payload:PublicScreenPayload}) {
  const [mounted,setMounted]=useState(true);
  const hub=typeof window!=="undefined" ? new URLSearchParams(window.location.search).get("hub")??undefined : undefined;
  return <main style={{background:"#0a0806",minHeight:"100vh",color:"#ffe8c7"}}>
    <nav style={{position:"fixed",zIndex:100,top:8,left:8}}>
      <button onClick={()=>setMounted(v=>!v)}>{mounted?"卸载小川":"重新挂载小川"}</button>{" "}
      <Link href="/voice-console">离开原型</Link>
    </nav>
    {mounted ? <OverlayStage payload={payload} driver="live" hubUrl={hub}/> : null}
  </main>;
}
