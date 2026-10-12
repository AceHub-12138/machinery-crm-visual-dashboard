import type { Page } from "@playwright/test";

/** Evaluate actual text ranges in viewport coordinates, including inline/fixed nodes.
 * Visibility, compensation and containment are separate decisions; no offsetParent heuristic.
 */
export async function auditText(page: Page, root = "#screen-stage, .overlay-root") {
  return page.evaluate((selector) => {
    const canvas = document.createElement("canvas");
    const inkContext = canvas.getContext("2d")!;
    const failures: { kind: string; cls: string; text: string; detail?: string }[] = [];
    const visible = (el: Element) => {
      if (el.closest('.sr-only, [hidden], .overlay-shipment-page[aria-hidden="true"]')) return false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const css = getComputedStyle(n);
        if (css.display === "none" || css.visibility === "hidden" || Number(css.opacity) === 0) return false;
      }
      return el.getClientRects().length > 0;
    };
    const compensated = (el: Element) => {
      const full = el.getAttribute("title")?.trim();
      if (!full) return false;
      const css = getComputedStyle(el);
      const hasTruncation = css.textOverflow === "ellipsis" || Number(css.webkitLineClamp) > 0 || el.hasAttribute("data-fit-ellipsis");
      const accessible = el.getAttribute("aria-label") === full || el.querySelector(".sr-only")?.textContent === full || el.textContent?.trim() === full;
      const clips = css.display !== "inline" && css.display !== "contents" && /hidden|clip/.test(css.overflowX);
      return hasTruncation && accessible && clips;
    };
    const add = (el: Element, kind: string, text: string, detail?: string) => {
      if (!failures.some(f => f.kind === kind && f.cls === el.getAttribute("class") && f.text === text.slice(0,80))) failures.push({ kind, cls: el.getAttribute("class") ?? el.tagName, text: text.slice(0,80), detail });
    };
    for (const stage of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        const host = node.parentElement;
        if (!host || !text.trim() || !visible(host) || host.closest("script, style, title, desc")) continue;
        const css = getComputedStyle(host);
        const minimum = host.closest(".overlay-root") ? 20 : 18;
        if (!host.closest(".text-kicker") && parseFloat(css.fontSize) < minimum - .01) add(host, "font", text, css.fontSize);
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        inkContext.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const ink = inkContext.measureText(text.trim());
        const fontHeight = ink.fontBoundingBoxAscent + ink.fontBoundingBoxDescent;
        const painted = rects.map(r => {
          const scale = fontHeight > 0 ? r.height / fontHeight : 1;
          const baseline = r.top + ink.fontBoundingBoxAscent * scale;
          return { left:r.left, right:r.right, width:r.width, top:baseline - ink.actualBoundingBoxAscent * scale, bottom:baseline + ink.actualBoundingBoxDescent * scale };
        });
        // SVG text uses its geometric bounding box; HTML uses rendered line fragments.
        if (host instanceof SVGElement) continue;
        for (let container: HTMLElement | null = host as HTMLElement; container; container = container.parentElement) {
          const style = getComputedStyle(container);
          if (compensated(container)) break;
          const box = container.getBoundingClientRect();
          const block = style.display !== "inline" && style.display !== "contents";
          const clippedY = /hidden|clip|auto|scroll/.test(style.overflowY);
          const clippedX = /hidden|clip|auto|scroll/.test(style.overflowX);
          // overflow:visible may let a line exceed its own line-height; only real clipping
          // counts vertically. Horizontal containment still catches overlapping siblings.
          if (painted.some(r => r.width > 0 && ((block || clippedX) && (r.left < box.left - 1 || r.right > box.right + 1) || clippedY && (r.top < box.top - 1 || r.bottom > box.bottom + 1)))) {
            add(host, "overflow", text, container.className); break;
          }
          if (container === stage) break;
        }
      }
      for (const unit of stage.querySelectorAll<HTMLElement>(".num-unit")) {
        if (!visible(unit)) continue;
        const lines: DOMRect[] = [];
        const walker = document.createTreeWalker(unit,NodeFilter.SHOW_TEXT);
        for(let n=walker.nextNode();n;n=walker.nextNode()) {
          if(!n.parentElement || !visible(n.parentElement)) continue;
          const range=document.createRange();range.selectNodeContents(n);
          lines.push(...[...range.getClientRects()].filter(r=>r.width>0 && r.height>0));
        }
        // Nested currency/number/unit spans produce several rects on the same line.
        if (lines.length && Math.max(...lines.map(r => r.top)) > Math.min(...lines.map(r => r.bottom)) + 1) add(unit, "unit-wrap", unit.textContent ?? "");
      }
    }
    return failures;
  }, root);
}

export async function auditPanels(page: Page) {
  return page.evaluate(() => {
    const failures: string[] = [];
    const stage = document.querySelector("#screen-stage")!.getBoundingClientRect();
    const panels = [...document.querySelectorAll<HTMLElement>("[data-screen-panel]")].map(el => ({ name: el.dataset.screenPanel!, box: el.getBoundingClientRect() }));
    const intersection = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left)) * Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    for (let i = 0; i < panels.length; i++) {
      const { name, box } = panels[i];
      if (box.left < stage.left-1 || box.top < stage.top-1 || box.right > stage.right+1 || box.bottom > stage.bottom+1) failures.push(`${name} outside stage`);
      for (const next of panels.slice(i+1)) if (intersection(box,next.box) > .5) failures.push(`${name} overlaps ${next.name}`);
    }
    const card = document.querySelector(".overlay-card")?.getBoundingClientRect();
    if (card) for (const el of document.querySelectorAll(".overlay-status, .overlay-partial")) if (intersection(card, el.getBoundingClientRect()) > .5) failures.push(`card overlaps ${el.className}`);
    return failures;
  });
}
