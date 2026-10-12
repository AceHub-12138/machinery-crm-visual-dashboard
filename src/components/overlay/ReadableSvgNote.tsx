"use client";
import {useLayoutEffect,useRef} from "react";
/** SVG user units shrink again inside the map; compensate to the 20px design floor. */
export function ReadableSvgNote({children}:{children:string}) {
  const ref=useRef<SVGTextElement>(null);
  useLayoutEffect(()=>{
    const node=ref.current;const svg=node?.ownerSVGElement;if(!node || !svg)return;
    const update=()=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const card=svg.closest<HTMLElement>(".overlay-card");
      const stageScale=card ? card.getBoundingClientRect().width/card.offsetWidth : 1;
      const localScale=Math.hypot(matrix.a,matrix.b)/stageScale;if(!localScale)return;
      const size=20/localScale;
      node.style.fontSize=`${size}px`;
      node.setAttribute("x",String(svg.viewBox.baseVal.x+12/localScale));
      node.setAttribute("y",String(svg.viewBox.baseVal.y+size+12/localScale));
      node.dataset.svgMeasured="true";
    };
    const observer=new ResizeObserver(update);observer.observe(svg);window.addEventListener("resize",update);update();
    void document.fonts.ready.then(update);
    return()=>{observer.disconnect();window.removeEventListener("resize",update);};
  },[]);
  return <text ref={ref} fontSize="20" fill="#ffe8c788" data-readable-svg>{children}</text>;
}
