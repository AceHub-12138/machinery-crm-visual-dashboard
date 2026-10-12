import {textRuns} from "@/lib/text-layout";
export function WordText({text}:{text:string}) {
  return textRuns(text).map(run=>run.atomic ? <span className={run.numeric ? "text-word num-unit" : "text-word"} data-word={run.text} key={run.start}>{run.text}</span> : run.text);
}
