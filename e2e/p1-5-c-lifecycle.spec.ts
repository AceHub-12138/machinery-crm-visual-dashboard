import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
test('GSAP reduced-motion resume: immediate scheduling window versus real progress across 30 cycles',async({page})=>{
  test.setTimeout(180000);
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.addInitScript(()=>{
    const request=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),pending=new Set<number>();let max=0;
    window.requestAnimationFrame=fn=>{const id=request(t=>{pending.delete(id);fn(t);});pending.add(id);max=Math.max(max,pending.size);return id;};
    window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
    Object.assign(window,{resumeLoopAudit:()=>({pending:pending.size,max})});
  });
  await page.goto('/screen/sales?debug=1&motion=gsap&qualityExperiment=candidate');await page.clock.runFor(1500);
  const debug=page.locator('.nexus-motion-debug');await expect(debug).toHaveAttribute('data-quality-automation','candidate');
  const read=()=>page.evaluate(()=>({loop:(window as unknown as{resumeLoopAudit:()=>{pending:number,max:number}}).resumeLoopAudit(),ticker:JSON.parse(document.querySelector('[data-gsap-audit]')!.textContent!),paused:document.querySelector('.nexus-motion-debug')!.getAttribute('data-paused')}));
  const evidence=[];
  for(let i=0;i<30;i++){
    await page.emulateMedia({reducedMotion:'reduce'});await page.clock.runFor(300);await expect(debug).toHaveAttribute('data-level','static');const staticState=await read();expect(staticState.loop.pending).toBe(0);expect(staticState.ticker.activeListeners).toBe(0);
    await page.emulateMedia({reducedMotion:'no-preference'});const immediate=await read();
    // Media emulation returns before its async change event. Start the measured active second only after resume.
    await expect(debug).toHaveAttribute('data-paused','false');await page.clock.runFor(1000);const settled=await read();
    // Keep the historical post-resume RAF assertion intact; transient snapshots are recorded separately.
    expect(settled.loop).toEqual({pending:1,max:1});expect(settled.ticker.activeListeners).toBe(1);expect(settled.ticker.listenerUpdates).toBeGreaterThan(staticState.ticker.listenerUpdates+30);expect(settled.ticker.liveScenes).toBe(1);expect(settled.ticker.rootAnimations).toBe(0);
    evidence.push({cycle:i+1,staticState,immediate,settled});
  }
  mkdirSync('.review/p1-5-c',{recursive:true});writeFileSync('.review/p1-5-c/reduced-resume-30.json',JSON.stringify(evidence,null,2));
});
