/** Build reviewable comparisons from browser evidence; ffmpeg must be available. */
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root='docs/nexus-p1-6',media=`${root}/media`;
const run=(args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
for(const engine of ['legacy','gsap']) {
  const evidence=JSON.parse(readFileSync(`${root}/evidence/${engine}-film.json`));
  const offset=(evidence.audio.timeOrigin+evidence.audio.start-evidence.videoStart)/1000;
  run(['-i',`${media}/${engine}-interaction.webm`,'-itsoffset',String(offset),'-i',`${media}/${engine}-browser-audio.webm`,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-af','apad','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart',`${media}/${engine}-interaction.mp4`]);
}
run(['-i',`${media}/legacy-interaction.mp4`,'-i',`${media}/gsap-interaction.mp4`,'-filter_complex','[0:v]scale=960:540[l];[1:v]scale=960:540[r];[l][r]hstack=inputs=2[v]','-map','[v]','-an','-c:v','libx264','-crf','22','-pix_fmt','yuv420p','-shortest',`${media}/side-by-side.mp4`]);
writeFileSync(`${root}/evidence/media-notes.json`,JSON.stringify({audio:'Actual browser gain output captured by MediaStreamDestination/MediaRecorder; audio offset uses wall clock plus performance.timeOrigin; not a physical speaker recording.',comparison:'Same fixture and question, same scripted order. Individual recordings include rendering and event-loop timing differences; use answer-relative phase comparison for precise timings.'},null,2));

const starts=['legacy','gsap'].map(engine=>{const d=JSON.parse(readFileSync(`${root}/evidence/${engine}-film.json`));const at=Number(d.metrics.samples.find(s=>s.state==='answering'&&Number(s.launchAt)>0).launchAt);return(d.audio.timeOrigin+at-d.videoStart)/1000;});
run(['-ss',String(starts[0]),'-i',`${media}/legacy-interaction.mp4`,'-ss',String(starts[1]),'-i',`${media}/gsap-interaction.mp4`,'-filter_complex','[0:v]scale=960:540[l];[1:v]scale=960:540[r];[l][r]hstack=inputs=2[v]','-map','[v]','-an','-c:v','libx264','-crf','22','-pix_fmt','yuv420p','-shortest',`${media}/answer-aligned.mp4`]);
writeFileSync(`${root}/evidence/alignment.json`,JSON.stringify({startsSeconds:starts,reference:'first ANSWER launchAt',precision:'approximate video alignment; source-clock comparison is in comparison-summary.json',left:'Legacy',right:'GSAP'},null,2));
