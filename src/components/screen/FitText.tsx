"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Measure the final value at the declared size, never the animated intermediate value. */
export function FitText({ children, text, min = 20, max, className = "", measureContent = false }: {
  children: ReactNode; text: string; min?: number; max: number | string; className?: string; measureContent?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let disposed = false;
    const measure = () => {
      if (disposed || !node.clientWidth) return;
      const probe = node.cloneNode(measureContent) as HTMLSpanElement;
      if (!measureContent) probe.textContent = text;
      else probe.querySelectorAll<HTMLElement>('[data-final-number]').forEach(el => { el.textContent = el.dataset.finalNumber ?? el.textContent; });
      probe.removeAttribute("id");
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: "max-content", maxWidth: "none", fontSize: typeof max === "number" ? `${max}px` : max });
      node.append(probe);
      const ceiling = parseFloat(getComputedStyle(probe).fontSize);
      const ratio = Math.min(1, node.clientWidth / Math.max(1, probe.scrollWidth));
      let size = ratio === 1 ? ceiling : Math.max(min, Math.floor(ceiling * ratio / 2) * 2);
      probe.style.fontSize = `${size}px`;
      while (size > min && probe.scrollWidth > node.clientWidth + 1) {
        size = Math.max(min, size - 2);
        probe.style.fontSize = `${size}px`;
      }
      node.dataset.fitEllipsis = String(probe.scrollWidth > node.clientWidth + 1);
      node.style.fontSize = `${size}px`;
      probe.remove();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    measure();
    void document.fonts.ready.then(measure);
    return () => { disposed = true; observer.disconnect(); };
  }, [text, min, max, measureContent]);
  return <span ref={ref} className={`fit-text ${className}`} style={{ fontSize: typeof max === "number" ? `${max}px` : max }} title={text} aria-label={text}>{children}</span>;
}
