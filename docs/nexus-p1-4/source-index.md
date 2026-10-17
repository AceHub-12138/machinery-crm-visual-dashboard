# 源码检索证据索引

扫描三仓库 tracked src/electron 源文件（排除测试）；113 个命中文件，548 个命中行。误命中也保留，例如 PDF Canvas、CAD 文本、打印双 RAF，不把它们算成动画。第三方压缩运行时不反编译；部署端与未检出的远端分支不在本次范围。

重建：`python3 scripts/p1-4/source-audit.py`。版本和文件 SHA-256 见 [source-versions.json](source-versions.json)。完整 machine-readable 结果在 `.review/p1-4/source-hits.json`。

## crm

根目录：`/Users/apple/Desktop/Codex/machinery-crm`；HEAD：`5d6941e0b82a5a46e76cce4227391bac5ea1650e`。

### src/app/(app)/admin/cockpit/page.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/admin/cockpit/page.tsx:26)。

```text
26: import { StaggerContainer } from "@/components/motion/StaggerContainer";
140: <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" delay={MOTION_SEQUENCE.kpi}>
172: </StaggerContainer>
174: <StaggerContainer className="grid gap-4 sm:grid-cols-3" delay={MOTION_SEQUENCE.kpi}>
200: </StaggerContainer>
```

### src/app/(app)/customers/[id]/edit/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/customers/[id]/edit/page.tsx:191)。

```text
191: className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
```

### src/app/(app)/customers/[id]/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/customers/[id]/page.tsx:223)。

```text
223: <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === tab.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>{tab.label}</button>
```

### src/app/(app)/customers/new/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/customers/new/page.tsx:260)。

```text
260: className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${form.interestTags.includes(tag) ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
324: className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50">
328: className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
```

### src/app/(app)/customers/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/customers/page.tsx:130)。

```text
130: <Link href="/customers/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
224: <tr key={customer.id} className="h-12 hover:bg-[var(--surface-hover)] transition-colors">
260: <div key={customer.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
```

### src/app/(app)/dashboard/erp/page.tsx

类别：css, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/dashboard/erp/page.tsx:25)。

```text
25: import { StaggerContainer } from "@/components/motion/StaggerContainer";
226: <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
232: <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" delay={MOTION_SEQUENCE.kpi}>
269: </StaggerContainer>
```

### src/app/(app)/dashboard/page.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/dashboard/page.tsx:23)。

```text
23: import { MotionPage } from "@/components/motion/MotionPage";
24: import { StaggerContainer } from "@/components/motion/StaggerContainer";
215: <MotionPage className="space-y-6" enabled={Boolean(data)}>
295: </MotionPage>
307: <MotionPage delay={MOTION_SEQUENCE.rest} offset={0}>
311: </MotionPage>
432: <StaggerContainer className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" delay={MOTION_SEQUENCE.kpi}>
436: </StaggerContainer>
438: <MotionPage className="space-y-6" delay={MOTION_SEQUENCE.rest}>
440: </MotionPage>
```

### src/app/(app)/erp/inventory/page.tsx

类别：raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/erp/inventory/page.tsx:148)。

```text
148: window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
```

### src/app/(app)/erp/kit-check-results/page.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/erp/kit-check-results/page.tsx:7)。

```text
7: import { MotionPage } from "@/components/motion/MotionPage";
41: <MotionPage className="space-y-5">
55: </MotionPage>
```

### src/app/(app)/erp/production-orders/[id]/page.tsx

类别：gsap, lifecycle, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/erp/production-orders/[id]/page.tsx:5)。

```text
5: import { useGSAP } from "@gsap/react";
6: import { gsap } from "gsap";
11: import { MotionPage } from "@/components/motion/MotionPage";
15: gsap.registerPlugin(useGSAP);
95: useGSAP(
106: gsap.set(rows, { clearProps: "opacity,transform" });
116: gsap.set(rows, { clearProps: "opacity,transform" });
127: gsap.fromTo(
136: onComplete: () => gsap.set(rows, { clearProps: "opacity,transform" }),
147: useGSAP(
159: gsap.set(highlight, { opacity: 0 });
165: gsap.set(highlight, { opacity: 0 });
170: const tween = gsap.fromTo(
182: tween.kill();
282: return <MotionPage className="space-y-4">
293: </MotionPage>;
```

### src/app/(app)/erp/stock-in/page.tsx

类别：raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/erp/stock-in/page.tsx:261)。

```text
261: window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
```

### src/app/(app)/erp/stock-out/page.tsx

类别：raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/erp/stock-out/page.tsx:166)。

```text
166: window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
```

### src/app/(app)/products/[id]/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/products/[id]/page.tsx:121)。

```text
121: className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeLang === key ? "bg-gray-900 text-white" : hasTranslation ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-gray-50 text-gray-400"}`}>
```

### src/app/(app)/products/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/products/page.tsx:75)。

```text
75: className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
```

### src/app/(app)/reminders/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/(app)/reminders/page.tsx:43)。

```text
43: className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
71: className="flex items-center justify-between p-3 rounded-lg border border-red-100 hover:bg-red-50 transition-colors"
```

### src/app/globals.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/globals.css:26)。

```text
26: @media (prefers-reduced-motion: no-preference) {
28: transition-duration: 150ms;
29: transition-property: color, background-color, border-color, opacity, box-shadow, transform, translate, scale, rotate;
30: transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
205: transition: background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
```

### src/app/login/page.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/app/login/page.tsx:70)。

```text
70: transition: "transform 0.1s ease-out",
130: className="flex items-center justify-center rounded-full transition-all duration-150"
146: transition: "transform 0.1s ease-out",
368: className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
407: className="absolute bottom-0 transition-all duration-700 ease-in-out"
424: className="absolute flex gap-8 transition-all duration-700 ease-in-out"
464: className="absolute bottom-0 transition-all duration-700 ease-in-out"
483: className="absolute flex gap-6 transition-all duration-700 ease-in-out"
523: className="absolute bottom-0 transition-all duration-700 ease-in-out"
538: className="absolute flex gap-8 transition-all duration-200 ease-out"
564: className="absolute bottom-0 transition-all duration-700 ease-in-out"
580: className="absolute flex gap-6 transition-all duration-200 ease-out"
602: className="absolute h-[4px] w-20 rounded-full bg-[#1f2937] transition-all duration-200 ease-out"
```

### src/components/customers/customer-lifecycle-bar.tsx

类别：gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/customers/customer-lifecycle-bar.tsx:3)。

```text
3: import { useGSAP } from "@gsap/react";
5: import { gsap } from "gsap";
16: gsap.registerPlugin(useGSAP);
56: useGSAP(
80: gsap.set(progressLine, { scaleX: progress });
81: gsap.set(nodes, { clearProps: "opacity,transform" });
83: gsap.set(terminalMarker, { clearProps: "opacity,transform" });
101: gsap.fromTo(
119: const timeline = gsap.timeline({ onComplete: rememberSession });
```

### src/components/dachuan-pet/ChatPanel.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/dachuan-pet/ChatPanel.tsx:168)。

```text
168: className="absolute left-0 top-0 z-10 hidden size-9 touch-none cursor-nwse-resize items-center justify-center rounded-br-xl text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:flex"
199: className="inline-flex size-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
207: className="inline-flex size-9 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
269: className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ee7d2c] text-white transition-colors hover:bg-[#d9691a] disabled:cursor-not-allowed disabled:bg-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
```

### src/components/dachuan-pet/FloatingPet.module.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/dachuan-pet/FloatingPet.module.css:2)。

```text
2: animation: pet-float 3.8s ease-in-out infinite;
13: transition: transform 200ms ease;
32: animation: pet-shadow 3.8s ease-in-out infinite;
36: animation: greeting-pet 2.4s ease-in-out infinite;
59: transition: opacity 180ms ease, transform 220ms ease;
116: @keyframes pet-float {
127: @keyframes pet-shadow {
140: @keyframes greeting-pet {
151: @media (prefers-reduced-motion: reduce) {
155: animation: none;
```

### src/components/dachuan-pet/FloatingPet.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/dachuan-pet/FloatingPet.tsx:191)。

```text
191: className={`relative flex size-[72px] touch-none select-none items-center justify-center overflow-hidden rounded-full border-2 border-white bg-orange-50 shadow-[0_12px_28px_rgba(238,125,44,0.35)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 ${styles.draggablePet}`}
252: className={`h-auto w-full transition-opacity duration-300 ${isGreeting ? "opacity-0" : "opacity-100"}`}
259: className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300 ${isGreeting ? styles.greetingPet : "opacity-0"}`}
266: className="absolute right-0 top-4 inline-flex size-7 items-center justify-center rounded-full border border-orange-100 bg-white/95 text-gray-500 opacity-0 shadow-sm transition-opacity hover:text-gray-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 group-hover:opacity-100"
```

### src/components/dashboard/sales-target-card.tsx

类别：css, graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/dashboard/sales-target-card.tsx:261)。

```text
261: <svg aria-label={`目标完成率 ${selectedTarget.completionRate}%`} className="size-full -rotate-90" role="img" viewBox="0 0 120 120">
308: <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />刷新
```

### src/components/desktop-download.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/desktop-download.tsx:57)。

```text
57: <Loader2 aria-hidden="true" className="size-4 animate-spin" />
83: className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-orange)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
127: className={`inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)] ${open ? "text-[var(--text-primary)]" : ""}`}
150: className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--brand-orange)]"
```

### src/components/layout/app-shell.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/app-shell.tsx:56)。

```text
56: <div className="relative isolate min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] transition-colors print:bg-white print:text-black">
```

### src/components/layout/floating-sidebar.tsx

类别：css, gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/floating-sidebar.tsx:3)。

```text
3: import { useGSAP } from "@gsap/react";
4: import { gsap } from "gsap";
33: gsap.registerPlugin(useGSAP);
145: useGSAP(
154: gsap.set(labels, { clearProps: "opacity,transform" });
168: gsap.to(labels, {
180: gsap.fromTo(
281: "flex size-11 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
309: "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
348: "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
367: className={cn("size-4 transition-transform", groupOpen && "rotate-180")}
387: "relative flex min-h-9 items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
429: : "fixed bottom-4 left-4 top-4 z-30 hidden flex-col rounded-[var(--radius-2xl)] transition-[width] duration-200 motion-reduce:transition-none md:flex",
517: className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
```

### src/components/layout/global-search-dialog.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/global-search-dialog.tsx:193)。

```text
193: className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
```

### src/components/layout/sidebar.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/sidebar.tsx:128)。

```text
128: "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
134: <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", groupOpen && "rotate-180")} />
144: <button type="button" onClick={() => setOpenGroups((open) => ({ ...open, [child.href]: !nestedOpen }))} className={cn("flex w-full items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors", childActive ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900")}>
145: <span className="flex-1 text-left">{child.label}</span><ChevronDown className={cn("h-3.5 w-3.5 transition-transform", nestedOpen && "rotate-180")} />
147: {nestedOpen && <div className="ml-3 mt-1 space-y-1 border-l border-gray-200 pl-2">{visibleNested.map((nested) => <Link key={nested.href} href={nested.href} onClick={() => setMobileOpen(false)} className={cn("block rounded-lg px-3 py-2 text-xs transition-colors", pathname === nested.href ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900")}>{nested.label}</Link>)}</div>}
156: "block px-3 py-2 rounded-lg text-xs font-medium transition-colors",
178: "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
```

### src/components/layout/theme-control.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/theme-control.tsx:72)。

```text
72: "inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]",
```

### src/components/layout/topbar.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/topbar.tsx:154)。

```text
154: className="flex h-10 w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] px-3 text-[var(--text-tertiary)] shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:border-[var(--brand-orange)] focus-visible:outline-none"
167: className="relative inline-flex size-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-solid)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
```

### src/components/layout/user-menu.tsx

类别：css, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/layout/user-menu.tsx:70)。

```text
70: const animationFrame = window.requestAnimationFrame(() => {
111: window.cancelAnimationFrame(animationFrame);
124: className="flex items-center gap-2 rounded-xl p-1 pr-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
140: className={`hidden size-4 transition-transform sm:block ${open ? "rotate-180" : ""}`}
```

### src/components/leads/lead-detail-client.tsx

类别：gsap, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/leads/lead-detail-client.tsx:5)。

```text
5: import { useGSAP } from "@gsap/react";
6: import { gsap } from "gsap";
8: import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
9: import { MotionPage } from "@/components/motion/MotionPage";
10: import { StaggerContainer } from "@/components/motion/StaggerContainer";
38: gsap.registerPlugin(useGSAP);
115: useGSAP(
124: gsap.set(highlight, { opacity: 0 });
130: gsap.set(highlight, { opacity: 0 });
134: gsap.fromTo(
216: <MotionPage>
221: </MotionPage>
227: <StaggerContainer className="space-y-5 xl:col-span-2">
228: <SurfaceCard className="p-5"><h2 className="font-semibold">线索信息</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><InfoItem label="联系人" value={lead.contactName} /><InfoItem label="电话" value={lead.phone} /><InfoItem label="邮箱" value={lead.email} /><InfoItem label="AI 评分" value={lead.aiScore == null ? "未评分" : <AnimatedNumber value={lead.aiScore} />} /><InfoItem label="获客关键词" value={lead.searchKeyword} / … [完整行见源码/JSON]
232: </StaggerContainer>
234: <StaggerContainer className="space-y-5" delay={MOTION_STAGGER_INTERVAL}>
238: </StaggerContainer>
```

### src/components/leads/lead-list-client.tsx

类别：gsap, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/leads/lead-list-client.tsx:5)。

```text
5: import { useGSAP } from "@gsap/react";
6: import { gsap } from "gsap";
8: import { MotionPage } from "@/components/motion/MotionPage";
31: gsap.registerPlugin(useGSAP);
104: useGSAP(
115: gsap.set(highlights, { opacity: 0 });
121: gsap.set(highlights, { opacity: 0 });
125: gsap.fromTo(
242: <MotionPage className="space-y-5">
345: </MotionPage>
```

### src/components/maps/amap-shipment-map.tsx

类别：css, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/maps/amap-shipment-map.tsx:127)。

```text
127: <div style="position:absolute;inset:-7px;border-radius:999px;background:rgba(103,232,249,.12);box-shadow:0 0 18px rgba(103,232,249,.8);animation:dachuan-map-pulse 1.9s ease-in-out infinite;"></div>
233: cancelAnimationFrame(animationFrameRef.current);
256: await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
399: animationFrameRef.current = requestAnimationFrame(animateFlow);
402: animationFrameRef.current = requestAnimationFrame(animateFlow);
440: cancelAnimationFrame(animationFrameRef.current);
501: @keyframes dachuan-map-pulse {
566: <Loader2 className="h-5 w-5 animate-spin text-cyan-200" />
```

### src/components/motion/AnimatedNumber.tsx

类别：gsap, lifecycle, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/motion/AnimatedNumber.tsx:4)。

```text
4: import { useGSAP } from "@gsap/react";
5: import { gsap } from "gsap";
10: gsap.registerPlugin(useGSAP);
12: type AnimatedNumberProps = {
35: export function AnimatedNumber({
39: }: AnimatedNumberProps) {
47: useGSAP(
63: const tween = gsap.to(counter, {
77: return () => tween.kill();
```

### src/components/motion/MotionPage.tsx

类别：gsap, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/motion/MotionPage.tsx:4)。

```text
4: import { useGSAP } from "@gsap/react";
5: import { gsap } from "gsap";
10: gsap.registerPlugin(useGSAP);
12: type MotionPageProps = {
20: export function MotionPage({
26: }: MotionPageProps) {
30: useGSAP(
36: gsap.set(container, { clearProps: "opacity,transform" });
58: gsap.fromTo(
```

### src/components/motion/StaggerContainer.tsx

类别：gsap, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/motion/StaggerContainer.tsx:4)。

```text
4: import { useGSAP } from "@gsap/react";
5: import { gsap } from "gsap";
16: gsap.registerPlugin(useGSAP);
18: type StaggerContainerProps = {
24: export function StaggerContainer({ children, className, delay = 0 }: StaggerContainerProps) {
28: useGSAP(
34: gsap.set(items, { clearProps: "opacity,transform" });
38: gsap.fromTo(
```

### src/components/screen/AnimatedNumber.tsx

类别：lifecycle, orchestration-consumer, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/AnimatedNumber.tsx:8)。

```text
8: window.matchMedia("(prefers-reduced-motion: reduce)").matches
20: export function AnimatedNumber({
54: if (t < 1) frameRef.current = requestAnimationFrame(tick);
57: frameRef.current = requestAnimationFrame(tick);
58: return () => cancelAnimationFrame(frameRef.current);
```

### src/components/screen/HeaderBar.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/HeaderBar.tsx:114)。

```text
114: className="screen-text-micro rounded-[var(--radius)] border border-[var(--hairline)] px-3.5 py-2 text-[var(--ink-2)] transition-colors duration-[var(--t-fast)] hover:border-[var(--panel-border-strong)] hover:text-[var(--brand-orange)]"
```

### src/components/screen/KpiRail.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/KpiRail.tsx:3)。

```text
3: import { AnimatedNumber } from "./AnimatedNumber";
64: <AnimatedNumber value={value} format={format} />
113: <AnimatedNumber value={Number(kpis.periodContractAmount)} format={formatMoney} />
```

### src/components/screen/ShipmentMap.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/ShipmentMap.tsx:335)。

```text
335: <svg
378: <svg
```

### src/components/screen/TargetRing.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/TargetRing.tsx:22)。

```text
22: <svg viewBox="0 0 180 180" className="size-full" role="img" aria-label={`累计回款率 ${rate.toFixed(1)}%`}>
```

### src/components/screen/sales-screen.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/screen/sales-screen.css:329)。

```text
329: transition: fill var(--t-base) var(--ease-out);
397: animation: screen-flow-dash 4.1s linear infinite;
401: transition: r var(--t-fast) var(--ease-out), fill var(--t-fast) var(--ease-out);
583: transition: background var(--t-base) var(--ease-out);
605: @keyframes screen-flow-dash {
611: @keyframes screen-live-pulse {
623: @keyframes screen-factory-core {
640: animation: screen-live-pulse 2.4s ease-out infinite;
646: animation: screen-factory-core 3.2s ease-in-out infinite;
656: @media (prefers-reduced-motion: reduce) {
660: animation: none !important;
```

### src/components/ui/confirm-dialog.tsx

类别：gsap, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/ui/confirm-dialog.tsx:3)。

```text
3: import { useGSAP } from "@gsap/react";
4: import { gsap } from "gsap";
11: gsap.registerPlugin(useGSAP);
50: useGSAP(
57: gsap.set([overlay, panel], { clearProps: "opacity,transform" });
61: const timeline = gsap.timeline();
92: const animationFrame = window.requestAnimationFrame(() => {
130: window.cancelAnimationFrame(animationFrame);
```

### src/components/ui/dialog.tsx

类别：gsap, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/ui/dialog.tsx:3)。

```text
3: import { useGSAP } from "@gsap/react";
4: import { gsap } from "gsap";
12: gsap.registerPlugin(useGSAP);
41: useGSAP(
48: gsap.set([overlay, panel], { clearProps: "opacity,transform" });
52: const timeline = gsap.timeline();
88: const animationFrame = window.requestAnimationFrame(() => {
118: window.cancelAnimationFrame(animationFrame);
```

### src/components/ui/loading-skeleton.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/ui/loading-skeleton.tsx:16)。

```text
16: className={["animate-pulse space-y-3", className].filter(Boolean).join(" ")}
```

### src/components/ui/metric-card.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/ui/metric-card.tsx:5)。

```text
5: import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
67: <AnimatedNumber
```

### src/components/ui/segmented-control.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/ui/segmented-control.tsx:32)。

```text
32: className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand-orange)] ${
```

### src/components/xiaochuan/XiaochuanChat.tsx

类别：css, graphics, gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/XiaochuanChat.tsx:5)。

```text
5: import gsap from "gsap";
26: // Spline 3D 仅在浏览器端加载（占位用演示机器人，待小川专属场景后替换 SPLINE_SCENE_URL）
27: const SplineScene = nextDynamic(() => import("@/components/xiaochuan/spline-scene").then((mod) => mod.SplineScene), {
33: className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
136: "inline-flex max-w-56 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm transition-colors hover:border-[#ee7d2c]/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
164: "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors",
170: {active ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />}
213: gsap.fromTo(
613: className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
621: className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
640: "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white p-3 pt-14 transition-transform dark:border-zinc-800 dark:bg-zinc-950 md:static md:z-auto md:h-auto md:shrink-0 md:overflow-hidden md:transition-[width,transform] md:duration-300",
662: className="mb-2 flex items-center justify-center gap-2 rounded-xl bg-[#ee7d2c] px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#d96f24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ee7d2c] focus-visible:ring-offset-2"
675: "group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
742: className="rounded-full border border-gray-200 bg-white/80 px-3.5 py-1.5 text-xs text-gray-600 transition-colors hover:border-[#ee7d2c]/60 hover:bg-[#ee7d2c]/10 hover:text-[#b3591a] dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-orange-200"
750: {/* 右：Spline 3D 占位（待替换小川专属模型） */}
752: <SplineScene className="h-full w-full" />
818: <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c] [animation-delay:-0.3s]" />
819: <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c] [animation-delay:-0.15s]" />
820: <span className="size-1.5 animate-bounce rounded-full bg-[#ee7d2c]" />
```

### src/components/xiaochuan/message-actions.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/message-actions.tsx:37)。

```text
37: "rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
```

### src/components/xiaochuan/spline-scene.tsx

类别：css, graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/spline-scene.tsx:5)。

```text
5: // 懒加载 Spline 运行时（约 2-4MB），避免拖慢平台其余页面
6: const Spline = lazy(() => import("@splinetool/react-spline"));
9: * Spline 3D 场景占位。
14: export function SplineScene({ className }: { className?: string }) {
21: className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
26: <Spline scene={SPLINE_SCENE_URL} className={className} />
```

### src/components/xiaochuan/spotlight.tsx

类别：css, other-engine；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/spotlight.tsx:8)。

```text
8: * 用原生 CSS 渐变 + mousemove 实现，不引入 framer-motion，保持平台依赖干净。
41: "pointer-events-none absolute rounded-full opacity-0 blur-2xl transition-opacity duration-300",
```

### src/components/xiaochuan/xiaochuan-input.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/xiaochuan-input.tsx:121)。

```text
121: className="rounded p-0.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
129: <Loader2 className="size-3.5 animate-spin" />
142: "flex items-center gap-1.5 rounded-2xl border p-2 shadow-sm transition-colors",
167: "rounded-lg p-2 transition-colors",
199: "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors",
224: "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800",
249: "flex size-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/10",
260: className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#ee7d2c] text-white shadow-sm transition-colors hover:bg-[#d96f24] disabled:cursor-not-allowed disabled:opacity-40"
```

### src/components/xiaochuan/xiaochuan-login.tsx

类别：css, graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/components/xiaochuan/xiaochuan-login.tsx:11)。

```text
11: // Spline 3D 机器人：与 Agent 首页同一场景（右栏直接引用首页机器人）
12: const SplineScene = nextDynamic(() => import("@/components/xiaochuan/spline-scene").then((mod) => mod.SplineScene), {
18: className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-[#ee7d2c]"
197: {/* 右：与 Agent 首页同款 Spline 3D 机器人（移动端隐藏，突出表单） */}
199: <SplineScene className="h-full w-full" />
```

### src/hooks/useReducedMotion.ts

类别：lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/hooks/useReducedMotion.ts:5)。

```text
5: const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
```

### src/lib/agent/cad/analyze.ts

类别：lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/lib/agent/cad/analyze.ts:59)。

```text
59: child.kill();
```

### src/lib/motion/config.ts

类别：gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/lib/motion/config.ts:1)。

```text
1: import { CustomEase } from "gsap/CustomEase";
2: import { gsap } from "gsap";
4: gsap.registerPlugin(CustomEase);
6: // iOS 风格弹簧曲线（CustomEase 手绘；过冲约 15% 后稳住，视觉等效 iOS 弹簧物理）
7: CustomEase.create("motionEnterSpring", "M0,0 C0.28,1.45 0.5,1 1,1");
```

### src/lib/xiaochuan/pdf-page-render.ts

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm/src/lib/xiaochuan/pdf-page-render.ts:58)。

```text
58: const context = canvas.getContext("2d");
```

## desktop

根目录：`/Users/apple/Desktop/Codex/machinery-crm-desktop`；HEAD：`479a482a8fa2aa395a6abdd1cdd6f0d9249de825`。

### electron/main.ts

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/electron/main.ts:392)。

```text
392: const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#2a2d33"/><circle cx="240" cy="140" r="58" fill="#4c8dff" opacity="0.5"/><text x="240" y="250" fill="#c9ced6" font-family="sans-serif" font-size="18" text-anchor="middle">预览模式示例图片</text></svg>`;
```

### src/App.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/App.tsx:4)。

```text
4: import { AmbientBackground } from "./components/fx";
171: <AmbientBackground />
```

### src/components/ParticleField.tsx

类别：graphics, lifecycle, orchestration-consumer, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/ParticleField.tsx:13)。

```text
13: export default function ParticleField({
27: const ctx = canvas.getContext("2d");
35: const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
91: if (!reduced) raf = requestAnimationFrame(step);
102: cancelAnimationFrame(raf);
107: return <canvas ref={ref} className={`w-full h-full ${className}`} />;
```

### src/components/Sidebar.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/Sidebar.tsx:149)。

```text
149: className={`px-2 pb-1.5 text-[10px] font-medium tracking-[0.2em] text-faint transition-opacity duration-200 ${
165: className={`group relative mb-0.5 flex w-full items-center gap-2.5 rounded-xl border py-2 text-sm transition-all ${
199: className={`mb-1 flex w-full items-center justify-center gap-2 py-2 text-xs text-faint transition-colors hover:bg-panel2 hover:text-ink ${
227: className={`flex h-7 w-7 items-center justify-center rounded-lg text-faint transition-colors hover:bg-bad/10 hover:text-bad ${
```

### src/components/TerritoryPicker.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/TerritoryPicker.tsx:73)。

```text
73: className="text-xs text-brand transition-colors hover:text-brandhi disabled:opacity-50"
```

### src/components/TitleBar.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/TitleBar.tsx:23)。

```text
23: "no-drag-region flex h-full w-11 items-center justify-center text-faint transition-colors";
44: className="mr-1 flex h-6 w-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-panel2 hover:text-brand"
```

### src/components/fx.tsx

类别：css, graphics, orchestration-consumer, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/fx.tsx:2)。

```text
2: import ParticleField from "./ParticleField";
6: export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
20: if (p < 1) raf = requestAnimationFrame(tick);
23: raf = requestAnimationFrame(tick);
24: return () => cancelAnimationFrame(raf);
58: <svg width={size} height={size}>
78: transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
94: export function AmbientBackground() {
102: <ParticleField key={theme} density={0.35} mode={theme} />
```

### src/components/sales-screen-config.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/sales-screen-config.tsx:258)。

```text
258: className="mt-1 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brandhi disabled:cursor-not-allowed disabled:opacity-50"
```

### src/components/shipment-detail.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/shipment-detail.tsx:166)。

```text
166: <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.percent ?? 0}%` }} />
```

### src/components/ui.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/ui.tsx:410)。

```text
410: className={`block w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-brand/10 ${
```

### src/components/update-banner.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/components/update-banner.tsx:34)。

```text
34: className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
65: className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
72: className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:text-ink"
105: className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
120: className="absolute right-2.5 top-2.5 rounded-md p-1 text-faint transition-colors hover:text-ink"
```

### src/lib/motion.ts

类别：gsap, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/lib/motion.ts:2)。

```text
2: import { CustomEase } from "gsap/CustomEase";
3: import { gsap } from "gsap";
5: gsap.registerPlugin(CustomEase);
9: CustomEase.create("motionEnterSpring", "M0,0 C0.28,1.45 0.5,1 1,1");
33: return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

### src/lib/pdf-pages.ts

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/lib/pdf-pages.ts:79)。

```text
79: const context = canvas.getContext("2d");
```

### src/styles.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/styles.css:81)。

```text
81: transition: background-color 0.35s ease, color 0.35s ease;
120: animation: aurora-a 16s ease-in-out infinite alternate;
128: animation: aurora-b 20s ease-in-out infinite alternate;
136: animation: aurora-a 24s ease-in-out infinite alternate-reverse;
147: @keyframes aurora-a {
155: @keyframes aurora-b {
192: @apply transition-all duration-200;
201: placeholder:text-faint transition-all;
211: transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97];
215: transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96]
225: transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]
248: @apply hover:bg-panel2/70 cursor-pointer transition-colors;
280: transition: all 0.2s var(--spring, cubic-bezier(0.28, 1.45, 0.5, 1));
300: transition: background 0.25s ease;
313: transition: left 0.25s cubic-bezier(0.28, 1.45, 0.5, 1);
331: animation: backdrop-in 0.22s ease-out both;
336: @keyframes backdrop-in {
356: animation: sheet-up 0.34s cubic-bezier(0.28, 1.45, 0.5, 1) both;
360: @keyframes sheet-up {
406: animation: confirm-in 0.24s cubic-bezier(0.28, 1.45, 0.5, 1) both;
408: @keyframes confirm-in {
442: animation: toast-in 0.32s cubic-bezier(0.28, 1.45, 0.5, 1) both;
444: @keyframes toast-in {
461: animation: page-in 0.42s cubic-bezier(0.28, 1.45, 0.5, 1) both;
463: @keyframes page-in {
474: animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
476: @keyframes fade-up {
489: animation: login-drop 0.7s cubic-bezier(0.28, 1.45, 0.5, 1) both;
491: @keyframes login-drop {
506: animation: login-card-in 0.55s cubic-bezier(0.28, 1.45, 0.5, 1) 0.12s both;
508: @keyframes login-card-in {
519: animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.4s both;
530: animation: orbit-spin 0.8s linear infinite;
532: @keyframes orbit-spin {
544: animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
546: @keyframes pulse-ring {
561: animation: caret 1s steps(1) infinite;
563: @keyframes caret {
569: @keyframes drawer-in {
580: animation: drawer-in 0.18s ease-out;
583: @keyframes msg-in {
594: animation: msg-in 0.16s ease-out;
598: animation: logo-breath 2.2s ease-in-out infinite;
600: @keyframes logo-breath {
610: @media (prefers-reduced-motion: reduce) {
616: transition-duration: 0.01ms !important;
```

### src/views/AdminAgentView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/AdminAgentView.tsx:176)。

```text
176: className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brandhi"
184: className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
186: <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
256: className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brandhi disabled:cursor-not-allowed disabled:opacity-50"
332: className="inline-flex items-center gap-1.5 rounded-xl border border-good/50 bg-good/10 px-3 py-2 text-sm font-medium text-good transition-colors hover:bg-good/20 disabled:cursor-not-allowed disabled:opacity-50"
340: className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2"
348: className="inline-flex items-center gap-1.5 rounded-xl border border-bad/50 bg-bad/5 px-3 py-2 text-sm font-medium text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-50"
```

### src/views/AdminCockpitView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/AdminCockpitView.tsx:90)。

```text
90: className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
204: className="w-full rounded-xl border border-line bg-panel2/60 px-3.5 py-2.5 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
213: className="w-full rounded-xl px-3.5 py-2 text-center text-xs font-medium text-brand transition-colors hover:bg-brand/5"
```

### src/views/AdminConfigView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/AdminConfigView.tsx:208)。

```text
208: className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
```

### src/views/AdminHealthView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/AdminHealthView.tsx:96)。

```text
96: className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
98: <RefreshCw size={16} className={loading || refreshing ? "animate-spin" : ""} />
```

### src/views/AdminMasterDataView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/AdminMasterDataView.tsx:85)。

```text
85: className="flex w-full items-center gap-3 rounded-xl bg-panel2/60 px-3.5 py-2.5 text-left text-sm text-ink transition-colors hover:bg-brand/10"
```

### src/views/ChatView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/ChatView.tsx:118)。

```text
118: className={`rounded-md p-1 text-faint transition-colors hover:bg-panel2 hover:text-dim ${
211: <button className="shrink-0 text-faint transition-colors hover:text-bad" onClick={onRemove} title="移除">
639: className={`group relative mb-0.5 rounded-md border transition-colors ${
654: className="absolute right-1 top-1/2 -translate-y-1/2 hidden p-1 rounded text-faint transition-colors hover:text-bad group-hover:block disabled:cursor-not-allowed"
684: className="p-1.5 rounded hover:bg-panel2 transition-colors text-faint hover:text-dim"
701: className={`px-2.5 py-1 rounded text-xs transition-colors ${
721: className="text-left text-xs text-dim panel px-3.5 py-2.5 hover:border-brand/40 hover:text-ink transition-colors"
747: <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-faint transition-colors hover:text-dim">
748: <Brain size={11} className={m.streaming ? "text-brand animate-pulse" : ""} />
750: {!m.streaming && <ChevronDown size={10} className="transition-transform group-open/think:rotate-180" />}
819: <div className="max-w-3xl mx-auto panel flex flex-col gap-1 p-2.5 focus-within:border-brand/50 transition-colors">
```

### src/views/ContractDeleteRequestsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/ContractDeleteRequestsView.tsx:215)。

```text
215: className="inline-flex items-center gap-1.5 text-base font-semibold text-ink transition-colors hover:text-brand"
303: className="inline-flex items-center gap-2 rounded-xl bg-bad px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-bad/90 disabled:cursor-not-allowed disabled:opacity-50"
311: className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
```

### src/views/ContractUnlockRequestsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/ContractUnlockRequestsView.tsx:192)。

```text
192: className="inline-flex items-center gap-1.5 text-base font-semibold text-ink transition-colors hover:text-brand"
263: className="inline-flex items-center gap-2 rounded-xl bg-good px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-good/90 disabled:cursor-not-allowed disabled:opacity-50"
271: className="inline-flex items-center gap-2 rounded-xl border border-bad bg-bad/5 px-4 py-2 text-sm font-medium text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-50"
```

### src/views/ContractsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/ContractsView.tsx:289)。

```text
289: className="rounded-xl bg-bad px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-bad/90"
413: <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
```

### src/views/DashboardView.tsx

类别：css, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/DashboardView.tsx:9)。

```text
9: import { CountUp, Ring } from "../components/fx";
192: {amounts ? <CurrencyAmounts rows={amounts} primarySize={22} /> : <CountUp value={value} format={format} />}
419: className="h-full rounded-full bg-gradient-to-r from-ok/70 to-ok transition-all duration-1000"
431: className="h-full rounded-full bg-gradient-to-r from-warn/60 to-warn transition-all duration-1000"
654: <div key={f.id} className="rounded-xl px-2.5 py-2 transition-colors hover:bg-panel2/70">
```

### src/views/LoginView.tsx

类别：css, lifecycle, orchestration-consumer, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/LoginView.tsx:3)。

```text
3: import ParticleField from "../components/ParticleField";
19: useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
24: if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
27: cancelAnimationFrame(rafRef.current);
28: rafRef.current = requestAnimationFrame(() => {
67: <ParticleField mode={theme} />
76: <div ref={tiltRef} className="relative z-10 will-change-transform" style={{ transition: "transform 0.18s ease-out" }}>
```

### src/views/OperationLogsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/OperationLogsView.tsx:198)。

```text
198: className="grid w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-panel2 md:grid-cols-[140px_110px_1fr_160px]"
```

### src/views/RemindersView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/RemindersView.tsx:105)。

```text
105: className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
107: <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
172: className="flex w-full items-center justify-between gap-4 rounded-2xl border border-line bg-panel p-4 text-left transition-all hover:border-brand/50 hover:bg-brand/5 hover:shadow-sm"
212: className="flex w-full items-center justify-between gap-4 rounded-2xl border border-line bg-panel p-4 text-left transition-all hover:border-brand/50 hover:bg-brand/5 hover:shadow-sm"
252: className="flex w-full items-center justify-between gap-4 rounded-2xl border border-bad/30 bg-bad/5 p-4 text-left transition-all hover:border-bad/50 hover:bg-bad/10 hover:shadow-sm"
```

### src/views/SettingsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/SettingsView.tsx:166)。

```text
166: <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50">
219: className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
222: <RefreshCw size={15} className={updateEvent.type === "checking" ? "animate-spin" : undefined} />
241: className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
262: className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
297: className="flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-ink"
```

### src/views/ShipmentsView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/ShipmentsView.tsx:272)。

```text
272: <ChevronDown size={13} className={expanded === s.id ? "rotate-180 transition-transform" : "transition-transform"} />
```

### src/views/TasksView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/TasksView.tsx:103)。

```text
103: className={`relative rounded-2xl border p-4 transition-all ${
227: className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand transition-colors hover:text-brandhi"
445: className="mx-auto mt-4 block rounded-xl bg-brand px-4 py-2 text-sm text-white transition-colors hover:bg-brandhi"
```

### src/views/UsersView.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/UsersView.tsx:289)。

```text
289: className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
299: className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brandhi"
362: className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-[var(--bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
368: className="rounded-xl border border-line bg-panel px-4 py-2 text-sm text-ink transition-colors hover:bg-panel2"
385: className="rounded-lg p-1.5 text-faint transition-colors hover:text-ink"
431: className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-[var(--bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
437: className="rounded-xl border border-line bg-panel px-4 py-2 text-sm text-ink transition-colors hover:bg-panel2"
454: className="rounded-lg p-1.5 text-faint transition-colors hover:text-ink"
472: className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-[var(--bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
478: className="rounded-xl border border-line bg-panel px-4 py-2 text-sm text-ink transition-colors hover:bg-panel2"
493: className="rounded-lg p-1.5 text-faint transition-colors hover:text-ink"
521: className="rounded-xl bg-ink px-4 py-2 text-sm text-[var(--bg)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
527: className="rounded-xl border border-line px-4 py-2 text-sm transition-colors hover:bg-panel2"
605: className="inline-flex items-center gap-1 text-xs text-dim transition-colors hover:text-ink"
612: className="inline-flex items-center gap-1 text-xs text-dim transition-colors hover:text-ink"
620: className="text-xs text-dim transition-colors hover:text-ink disabled:opacity-50"
627: className="inline-flex items-center gap-1 text-xs text-bad transition-colors hover:text-bad/80 disabled:opacity-50"
```

### src/views/erp/DashboardPage.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/erp/DashboardPage.tsx:121)。

```text
121: <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
```

### src/views/erp/WarehousePage.tsx

类别：css；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/erp/WarehousePage.tsx:79)。

```text
79: <button className="text-faint transition-colors hover:text-ink" title="编辑" onClick={() => setForm({ mode: "edit", warehouse })}>
83: <button className="text-faint transition-colors hover:text-bad" title="停用" onClick={() => setDisableTarget(warehouse)}>
```

### src/views/erp/print-sheet.tsx

类别：raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-desktop/src/views/erp/print-sheet.tsx:19)。

```text
19: const frame = window.requestAnimationFrame(() =>
20: window.requestAnimationFrame(() => window.print()),
23: window.cancelAnimationFrame(frame);
```

## nexus

根目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit`；HEAD：`1f9e9cd6d78e12f85eee47d087c87191f90a0460`。

### src/app/globals.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/app/globals.css:364)。

```text
364: transition: fill var(--t-base) var(--ease-out);
431: animation: flow-dash 4.1s linear infinite;
435: transition: r var(--t-fast) var(--ease-out), fill var(--t-fast) var(--ease-out);
638: transition: background var(--t-base) var(--ease-out);
660: @keyframes flow-dash {
666: @keyframes live-pulse {
678: @keyframes factory-core {
695: animation: live-pulse 2.4s ease-out infinite;
701: animation: factory-core 3.2s ease-in-out infinite;
709: @media (prefers-reduced-motion: reduce) {
713: animation: none !important;
918: .nexus-stage[data-motion-reset="true"] .nexus-pulse-map { transition: opacity 280ms ease-out; }
921: @media (prefers-reduced-motion: reduce) { .nexus-stage *, .nexus-stage *::before, .nexus-stage *::after { transition: none !important; } }
943: @media (prefers-reduced-motion: reduce) { .nexus-stage { --intro-background: 1 !important; --intro-map: 1 !important; --intro-panels: 1 !important; --intro-feed: 1 !important; } }
```

### src/app/screen/sales/page.tsx

类别：gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/app/screen/sales/page.tsx:13)。

```text
13: const Experience = params.motion === "gsap" ? GsapScreenExperience : ScreenExperience;
```

### src/components/overlay/AnswerCard.tsx

类别：graphics, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/AnswerCard.tsx:175)。

```text
175: raf = requestAnimationFrame(paint);
240: raf = requestAnimationFrame(paint);
244: else raf = requestAnimationFrame(paint);
247: cancelAnimationFrame(raf);
265: <svg ref={svgRef} className="overlay-card-frame" aria-hidden="true">
```

### src/components/overlay/JarvisCore.tsx

类别：graphics, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/JarvisCore.tsx:99)。

```text
99: const ctx = canvas.getContext("2d");
115: const g = c.getContext("2d");
203: const g = c.getContext("2d");
238: const g = c.getContext("2d");
295: if (!reduced) raf = requestAnimationFrame(loop);
704: repaintStatic = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
705: raf = requestAnimationFrame(loop);
708: cancelAnimationFrame(raf);
713: return <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />;
```

### src/components/overlay/OverlayStage.tsx

类别：raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/OverlayStage.tsx:152)。

```text
152: cancelAnimationFrame(raf);
159: if (p < 1) raf = requestAnimationFrame(paint);
162: else raf = requestAnimationFrame(paint);
167: return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", apply); };
507: const raf = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("on")));
508: return () => cancelAnimationFrame(raf);
```

### src/components/overlay/cards/CardMetrics.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/cards/CardMetrics.tsx:12)。

```text
12: <svg className="overlay-ring" viewBox="0 0 160 160" role="img" aria-label={`${label} ${rate}%`}>
```

### src/components/overlay/cards/CompletionRingCard.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/cards/CompletionRingCard.tsx:9)。

```text
9: {[["已完成", card.collectedText, "M5 17V9h3v8 M11 17V5h3v12 M17 17v-6h3v6"], ["月度目标", card.targetText, "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8"], [exceeded ? "已超额" : "距目标还差", card.remainingText.replace(/^已超额\s*/, ""), "M4 5h16v14H4z M8 9h8 M8 13h8"]].map(([label, value, icon]) => <div key={label}><i aria-hidden="true"><svg viewBox="0 0 24 24"><path d={icon} /></svg></i><p><span>{label}</sp … [完整行见源码/JSON]
```

### src/components/overlay/cards/RegionCard.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/cards/RegionCard.tsx:25)。

```text
25: <svg className="overlay-region-map" viewBox={viewBox} role="img" aria-label={`发运地图，共 ${points.length} 个落点`}>
```

### src/components/overlay/overlay.css

类别：css, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/overlay/overlay.css:46)。

```text
46: transition: opacity var(--ov-takeover-ms) ease-out;
86: @keyframes overlay-caption-in {
96: animation: overlay-caption-in 240ms ease-out both;
146: .overlay-card-corner { position: absolute; width: 42px; height: 18px; border: 2px solid var(--ov-core); opacity: 0; transition: opacity 260ms ease-out; box-shadow: 0 0 12px #ffb65c33; }
164: .overlay-card-bar-fill, .overlay-collection-bar > span { display: block; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--ov-ember), var(--ov-copper) 50%, #ffe8c7); box-shadow: 0 0 16px #ffb65c66; transition: width var(--ov-card-bar-ms) ease-out; }
232: .overlay-pages-track { display: flex; height: 100%; transition: transform 400ms ease-in-out; }
245: .overlay-root[data-barge-paused="true"] .overlay-card { opacity: .45; transition: opacity 80ms linear; }
246: @media (prefers-reduced-motion: reduce) { .overlay-card-bar-fill, .overlay-card-corner, .overlay-pages-track { transition: none; } }
257: @media (prefers-reduced-motion: reduce) { .overlay-root, .overlay-root * { animation: none !important; transition-duration: 0ms !important; } }
```

### src/components/screen/AnimatedNumber.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/AnimatedNumber.tsx:6)。

```text
6: export function AnimatedNumber({ value, format, duration = motionConfig.numberDuration }: { value: number; format: (value: number) => string; duration?: number }) {
```

### src/components/screen/KpiRail.tsx

类别：orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/KpiRail.tsx:5)。

```text
5: import { AnimatedNumber } from "@/components/screen/AnimatedNumber";
64: <FitText text={format(value)} min={value < 0 || money ? 18 : 20} max={value < 0 || money ? "var(--fs-label)" : "var(--fs-metric)"}><AnimatedNumber value={value} format={format} /></FitText>
111: <FitText text={formatMoney(stats.periodContractAmount)} min={44} max="var(--fs-hero-lg)"><AnimatedNumber value={stats.periodContractAmount} format={formatMoney} /></FitText>
```

### src/components/screen/MachineThumbnail.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/MachineThumbnail.tsx:7)。

```text
7: return <svg className="nexus-machine-thumb" data-machine-family={family} viewBox="0 0 120 76" role="img" aria-label={`${model || '设备'}轮廓示意图`}>
```

### src/components/screen/NexusPanels.tsx

类别：graphics, orchestration-consumer；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/NexusPanels.tsx:3)。

```text
3: import { AnimatedNumber } from "./AnimatedNumber";
14: return <FitText measureContent text={text} min={18} max={max ?? (hero ? 72 : 34)} className={`nexus-money ${hero ? "nexus-money-hero" : ""}`}><span className="nexus-money-currency">{parts.currency}</span><span className="nexus-money-number"><AnimatedNumber key={parts.unit} value={Number(value)} format={n => formatMoneyParts(n).number}/></span><span className="nexus-money-unit">{parts.unit}</span></FitText>;
29: <div><p>达成</p><FitText min={18} max={30} text={target ? formatPercent(c.targetRate) : "—"} className={target ? "nexus-orange" : "nexus-unset"}>{target ? <AnimatedNumber value={c.targetRate} format={formatPercent}/> : "—"}</FitText></div>
30: <div><p>新签</p><strong className="nexus-orange"><AnimatedNumber value={k.periodNewContracts} format={formatCount}/><small> 份</small></strong></div>
35: return <svg className="nexus-alert-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
40: return <svg className="nexus-metric-icon" viewBox="0 0 96 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
53: <div><MetricIcon kind="people"/><p>客户总数</p><strong><FitText text={formatCount(k.totalCustomers)} min={18} max={34} className="nexus-customer-count"><AnimatedNumber value={k.totalCustomers} format={formatCount}/></FitText></strong><p>新增 <AnimatedNumber value={k.periodNewCustomers} format={formatCount}/></p></div>
54: <div><MetricIcon kind="truck"/><p>本期发货</p><strong><AnimatedNumber value={d.unitCount} format={formatCount}/><small> 台</small></strong><p className="nexus-seven-day">7 日内待发 {formatCount(d.sevenDayDue)} 单</p></div>
67: <svg className="nexus-dial-scale" viewBox="0 0 240 240" aria-hidden="true">
78: </svg><div className="nexus-dial-center"><p>累计回款率</p><strong>{invalid ? "数据待核对" : <AnimatedNumber value={c.collectionRate} format={formatPercent}/>}</strong></div>
```

### src/components/screen/ScreenStage.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/ScreenStage.tsx:36)。

```text
36: <canvas className="nexus-particles" aria-hidden="true"/><div className="nexus-pulse-top" aria-hidden="true"/><div className="nexus-pulse-base" aria-hidden="true"/>
```

### src/components/screen/ShipmentMap.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/ShipmentMap.tsx:55)。

```text
55: <div className="nexus-map-frame" data-map-frame="true" data-viewport-west={g.west} data-viewport-east={g.east} data-viewport-south={g.south} data-viewport-north={g.north} data-mask="ellipse" data-mask-solid={MAP_MASK_SOLID} data-endpoint-radius={MAP_ENDPOINT_RADIUS}>{[2, 1, 0].map(layer => <svg key={layer} className={`map-svg nexus-map-layer nexus-map-layer-${layer}`} data-map-layer={layer} viewBox={`${g.viewportX} $ … [完整行见源码/JSON]
77: <aside className="nexus-islands nexus-minimap"><svg viewBox="72 0 65 56" aria-label="全国地图（含台湾及南海诸岛）" className="nexus-islands-svg" fill="#2A2E35" stroke="#adc2d2" strokeWidth=".18">{islandPaths.map((d, i) => <path d={d} key={i} data-national-polygon={i}/>)}<path data-minimap-taiwan="true" d={chinaMap.provinces.find(p => p.short === "台湾")!.d} transform={`translate(${chinaMap.lonLat.lon.min} ${56 - chinaMap.lonLat.lat. … [完整行见源码/JSON]
```

### src/components/screen/TargetRing.tsx

类别：graphics；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/TargetRing.tsx:23)。

```text
23: <svg viewBox="0 0 180 180" className="size-full" role="img" aria-label={`累计回款率 ${rate.toFixed(1)}%`}>
```

### src/components/screen/motion/GsapMotionProvider.tsx

类别：gsap, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/motion/GsapMotionProvider.tsx:2)。

```text
2: import { gsap } from 'gsap';
8: /** The experimental runtime is lazy-loaded: Legacy never starts GSAP's ticker. */
13: if (requesting) return; // ticker.wake() may tick synchronously; request must behave like rAF.
16: if (!jobs.size) gsap.ticker.sleep();
21: if (!attached) { attached = true; gsap.ticker.fps(60); gsap.ticker.add(tick); }
25: cancel: id => { jobs.delete(id); if (!jobs.size) { gsap.ticker.remove(tick); attached = false; gsap.ticker.sleep(); } },
31: const runtime = { sleep: () => gsap.ticker.sleep(), audit: () => ({ liveScenes: GsapScene.liveScenes, liveTimelines: GsapScene.liveTimelines, rootAnimations: gsap.globalTimeline.getChildren().length }), createHost, createScene: (orders: number[]) => new GsapScene(orders) };
```

### src/components/screen/motion/GsapScene.ts

类别：gsap, lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/motion/GsapScene.ts:1)。

```text
1: import { gsap } from 'gsap';
10: private timelines: gsap.core.Timeline[] = [];
15: private introTl: gsap.core.Timeline;
16: private pulseTl: gsap.core.Timeline;
17: private breathTl: gsap.core.Timeline;
18: private routeTls: { pulse: gsap.core.Timeline; flight: gsap.core.Timeline }[];
20: const tl = gsap.timeline({ paused: true, defaults: { ease: 'none', lazy: false } });
21: gsap.globalTimeline.remove(tl); this.timelines.push(tl); GsapScene.liveTimelines++; return tl;
50: dispose() { if (this.disposed) return; this.disposed = true; this.timelines.forEach(tl => tl.kill()); GsapScene.liveTimelines -= this.timelines.length; GsapScene.liveScenes--; this.timelines = []; }
```

### src/components/screen/motion/MotionProvider.tsx

类别：gsap, lifecycle, raf；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/motion/MotionProvider.tsx:13)。

```text
13: request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id),
18: const media = window.matchMedia('(prefers-reduced-motion: reduce)');
31: document.addEventListener('visibilitychange', sync); media.addEventListener('change', sync);
34: return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync); media.removeEventListener('change', sync); window.removeEventListener('nexus-debug-voice', simulate); director.dispose(); };
48: <Link href={engineUrl("legacy")}>切换 Legacy</Link>{" · "}<Link href={engineUrl("gsap")}>切换 GSAP</Link>
54: <output hidden data-gsap-audit>{JSON.stringify(runtime?.audit() ?? null)}</output>
```

### src/components/screen/motion/useSceneMotion.ts

类别：graphics, gsap；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/components/screen/motion/useSceneMotion.ts:21)。

```text
21: const ctx = canvas?.getContext('2d');
34: root.dataset.motionEngine = gsapScene ? "gsap" : "legacy";
```

### src/lib/use-reduced-motion.ts

类别：lifecycle；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/lib/use-reduced-motion.ts:3)。

```text
3: const query = "(prefers-reduced-motion: reduce)";
```

### src/lib/voice/card-presentation.ts

类别：other-engine；证据：[打开源码](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit/src/lib/voice/card-presentation.ts:33)。

```text
33: /** At most three pages, five slots per page, including the overflow summary. */
```
