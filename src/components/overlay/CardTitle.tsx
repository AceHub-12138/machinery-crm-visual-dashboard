"use client";
import {useRef,useState} from "react";
import {WordText} from "@/components/screen/WordText";
import {useSpokenPages} from "./spoken-pages";
/** At most two lines, shrink to 20px; extreme titles remain available page by page. */
export function CardTitle({text}:{text:string}) {
  const ref=useRef<HTMLHeadingElement>(null);
  const pages=useSpokenPages(text,ref,true);
  const [index,setIndex]=useState(0);const page=Math.min(index,pages.length-1);
  return <div className="overlay-title-wrap">
    <h2 ref={ref} className="overlay-card-title" title={text} aria-label={text} data-word-audit data-title-page={page+1} data-title-pages={pages.length}><WordText text={text.slice(pages[page].start,pages[page].end)} /></h2>
    {pages.length>1 ? <button type="button" className="overlay-title-next" aria-label="下一页标题" onClick={()=>setIndex((page+1)%pages.length)}>{page+1}/{pages.length} ›</button> : null}
  </div>;
}
