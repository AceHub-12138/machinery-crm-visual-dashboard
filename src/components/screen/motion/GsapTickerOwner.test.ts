import { describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>{
  const root=()=>{};const callbacks=new Set<()=>void>([root]);
  const ticker={_listeners:[root] as (()=>void)[],fps:vi.fn(),sleep:vi.fn(),add:vi.fn((fn:()=>void)=>{callbacks.add(fn);ticker._listeners=[...callbacks];fn();}),remove:vi.fn((fn:()=>void)=>{callbacks.delete(fn);ticker._listeners=[...callbacks];})};
  return {root,ticker,callbacks,rootChildren:[] as unknown[]};
});
vi.mock('gsap',()=>({gsap:{ticker:mock.ticker,updateRoot:mock.root,globalTimeline:{getChildren:()=>mock.rootChildren}}}));
import {createGsapHost,settleGsapIdle,tickerAudit} from './GsapTickerOwner';
describe('unique ticker owner',()=>{
  it('counts actual invocations including synchronous wake without dispatching synchronously',()=>{
    const host=createGsapHost(), draw=vi.fn();const before=tickerAudit().listenerUpdates;
    const id=host.request(draw);expect(draw).not.toHaveBeenCalled();expect(tickerAudit().listenerUpdates-before).toBe(1);expect(tickerAudit().activeListeners).toBe(1);
    const fn=[...mock.callbacks].find(fn=>fn!==mock.root)!;fn();expect(draw).toHaveBeenCalledOnce();expect(tickerAudit().listenerUpdates-before).toBe(2);
    expect(tickerAudit().activeListeners).toBe(0);host.cancel(id);expect(mock.ticker.fps).toHaveBeenCalledExactlyOnceWith(60);
  });
  it('removes its listener on cancel and never sleeps other consumers or root animations',()=>{
    mock.ticker.sleep.mockClear();const other=()=>{};mock.ticker.add(other);
    const host=createGsapHost();const id=host.request(()=>{});host.cancel(id);settleGsapIdle();
    expect(tickerAudit().activeListeners).toBe(0);expect(mock.callbacks.has(other)).toBe(true);expect(mock.ticker.sleep).not.toHaveBeenCalled();
    mock.ticker.remove(other);mock.rootChildren.push({});settleGsapIdle();expect(mock.ticker.sleep).not.toHaveBeenCalled();
    mock.rootChildren=[];settleGsapIdle();expect(mock.ticker.sleep).toHaveBeenCalledOnce();
  });
  it('repeated suspend/resume retains a single live application listener and no zombies',()=>{
    const host=createGsapHost();for(let i=0;i<30;i++){const id=host.request(()=>{});expect(tickerAudit().activeListeners).toBe(1);host.cancel(id);expect(tickerAudit().activeListeners).toBe(0);}
    expect(mock.ticker._listeners).toEqual([mock.root]);expect(mock.ticker.fps).toHaveBeenCalledTimes(1);
  });
  it('canceling one scoped host never detaches another active host or sleeps the shared ticker',()=>{
    const overlay=createGsapHost(), screen=createGsapHost();
    const overlayId=overlay.request(()=>{}), screenId=screen.request(()=>{});
    mock.ticker.sleep.mockClear(); expect(tickerAudit().activeListeners).toBe(2);
    overlay.cancel(overlayId); expect(tickerAudit().activeListeners).toBe(1);
    expect(mock.ticker.sleep).not.toHaveBeenCalled();
    screen.cancel(screenId); expect(tickerAudit().activeListeners).toBe(0);
  });
});
