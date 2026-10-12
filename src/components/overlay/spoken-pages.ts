"use client";
import { useMemo, useSyncExternalStore, type RefObject } from "react";
import { buildSpokenSentences } from "@/lib/voice/spoken-normalize";

export type SpokenPage = { start: number; end: number };
import {textRuns,textNodes} from "@/lib/text-layout";
export const spokenNodes = textNodes;

function createSpokenStore(text: string, paragraph: RefObject<HTMLElement | null>, title = false) {
    const initial: SpokenPage[] = [{start:0,end:text.length}];
    let snapshot = initial;
    let signature = "";
    return {
      getSnapshot: () => snapshot,
      getServerSnapshot: () => initial,
      subscribe: (notify: () => void) => {
        let disposed = false;
        const node = paragraph.current;
        if (!node) return () => {};
        const measure = (force = false) => {
          if (disposed || !node.clientWidth) return;
          const css = getComputedStyle(node);
          const key = [node.clientWidth,css.fontFamily,css.fontWeight, title ? "title" : css.fontSize, title ? "title" : css.lineHeight].join(":");
          if (!force && key === signature) return;
          signature = key;
          const probe = node.cloneNode(false) as HTMLElement;
          probe.removeAttribute("id");
          Object.assign(probe.style,{position:"absolute",visibility:"hidden",pointerEvents:"none",width:`${node.clientWidth}px`,height:"auto",maxHeight:"none",overflow:"visible",margin:"0"});
          node.parentElement!.append(probe);
          if(title) {
            probe.style.display="block";
            probe.style.webkitLineClamp="unset";
            probe.replaceChildren(spokenNodes(text));
            let size=34;probe.style.fontSize=`${size}px`;
            while(size>20 && probe.scrollHeight>44+1){size-=2;probe.style.fontSize=`${size}px`;}
            node.style.fontSize=`${size}px`;
          }
          const lineHeight = parseFloat(getComputedStyle(probe).lineHeight);
          const limit = title ? 44 : lineHeight*3;
          const fits = (start: number, end: number) => {
            probe.replaceChildren(spokenNodes(text.slice(start,end)));
            return probe.scrollHeight <= limit + 1 && probe.scrollWidth <= node.clientWidth + 1;
          };
          const runs=textRuns(text);
          const offsets = [0];
          for(const run of runs) {
            if(run.atomic)offsets.push(run.end);
            else for(const char of run.text)offsets.push(offsets[offsets.length-1]+char.length);
          }
          const endings = buildSpokenSentences(text).map(s=>s.displayEnd);
          const units = runs.filter(run=>run.atomic);
          const pages: SpokenPage[] = [];
          let cursor = 0;
          while (cursor < offsets.length-1) {
            let low = cursor+1, high = offsets.length-1, best = cursor+1;
            while (low <= high) {
              const mid = Math.floor((low+high)/2);
              if (fits(offsets[cursor],offsets[mid])) { best=mid;low=mid+1; }
              else high=mid-1;
            }
            let end = offsets[best];
            // Keep complete sentences together where possible. A long sentence may span pages.
            end = endings.filter(e=>e>offsets[cursor] && e<=end).at(-1) ?? end;
            let endIndex=offsets.indexOf(end);
            while(endIndex>cursor+1 && /^[，。、％！？；：）】》」』]/u.test(text.slice(offsets[endIndex]))) endIndex--;
            end=offsets[endIndex];
            const unit = units.find(u=>u.start<end && u.end>end);
            if (unit && unit.start>offsets[cursor]) end=unit.start;
            const next = offsets.indexOf(end);
            // Every code point advances; no character is dropped to satisfy the geometry.
            const nextCursor = next>cursor ? next : best;
            pages.push({start:offsets[cursor],end:offsets[nextCursor]});cursor=nextCursor;
          }
          probe.remove();
          node.dataset.measured = "true";
          const next = pages.length ? pages : initial;
          if (JSON.stringify(next)!==JSON.stringify(snapshot)) { snapshot=next;notify(); }
        };
        const observer = new ResizeObserver(()=>measure());
        observer.observe(node.parentElement!);
        measure();
        void document.fonts.ready.then(()=>measure(true));
        return () => { disposed=true;observer.disconnect(); };
      },
    };
}

export function useSpokenPages(text: string, paragraph: RefObject<HTMLElement | null>, title = false) {
  const store = useMemo(()=>createSpokenStore(text,paragraph,title),[text,paragraph,title]);
  return useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);
}
