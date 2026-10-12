/** Shared display-only word boundaries; UTF-16 offsets stay compatible with speech. */
export const PROTECTED_WORDS = ["本期新合同欠款", "本期实际回款", "数据待核对", "地区待确认", "数控插齿机", "数控插床", "设备型号", "区域", "距离", "目标"] as const;
const segmenter = new Intl.Segmenter("zh-CN", {granularity:"word"});
const numericUnits = /[¥￥]?-?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿|万|台|单|家|项|[%％])/gu;
export type TextRun = {start:number;end:number;text:string;atomic:boolean;numeric:boolean};
export function textRuns(text:string):TextRun[] {
  const intervals:Array<{start:number;end:number;numeric:boolean}>=[];
  for(const match of text.matchAll(numericUnits))intervals.push({start:match.index,end:match.index+match[0].length,numeric:true});
  for(const word of PROTECTED_WORDS) {
    let at=text.indexOf(word);while(at>=0){intervals.push({start:at,end:at+word.length,numeric:false});at=text.indexOf(word,at+word.length);}
  }
  for(const part of segmenter.segment(text))if(part.isWordLike)intervals.push({start:part.index,end:part.index+part.segment.length,numeric:false});
  intervals.sort((a,b)=>a.start-b.start || b.end-a.end);
  const merged:typeof intervals=[];
  for(const range of intervals){const last=merged.at(-1);if(last && range.start<last.end){last.end=Math.max(last.end,range.end);last.numeric ||= range.numeric;}else merged.push({...range});}
  const runs:TextRun[]=[];let cursor=0;
  for(const range of merged) {
    if(range.start>cursor)runs.push({start:cursor,end:range.start,text:text.slice(cursor,range.start),atomic:false,numeric:false});
    runs.push({...range,text:text.slice(range.start,range.end),atomic:true});cursor=range.end;
  }
  if(cursor<text.length)runs.push({start:cursor,end:text.length,text:text.slice(cursor),atomic:false,numeric:false});
  return runs;
}
export function textNodes(text:string):DocumentFragment {
  const fragment=document.createDocumentFragment();
  for(const run of textRuns(text)) {
    if(!run.atomic){fragment.append(document.createTextNode(run.text));continue;}
    const node=document.createElement("span");node.className=run.numeric ? "text-word num-unit" : "text-word";node.dataset.word=run.text;node.textContent=run.text;fragment.append(node);
  }
  return fragment;
}
