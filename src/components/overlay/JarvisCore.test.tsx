import { afterEach, describe, expect, it, vi } from "vitest";
import { overlayGeometry } from "@/lib/voice/params";
import { JarvisCore } from "./JarvisCore";
const hooks = vi.hoisted(() => ({ canvas: null as unknown, effects: [] as Array<() => (() => void) | void> }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: () => ({current: hooks.canvas}),
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
}));
afterEach(() => { hooks.effects=[];hooks.canvas=null;vi.unstubAllGlobals(); });
function mount(reduced: boolean) {
  const fillRect=vi.fn();
  const context=(main=false)=>new Proxy({fillRect:main ? fillRect : vi.fn()}, {
    get(target,key) {
      if(key in target)return target[key as keyof typeof target];
      if(String(key).startsWith("create"))return ()=>({addColorStop:vi.fn()});
      return vi.fn();
    },
  });
  const canvas={width:0,height:0,getContext:()=>context(true)};
  hooks.canvas=canvas;
  const frames=new Map<number,FrameRequestCallback>();let id=0;
  const raf=vi.fn((callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;});
  vi.stubGlobal("window",Object.assign(new EventTarget(),{innerWidth:1920,innerHeight:1080,devicePixelRatio:1}));
  vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>context()})});
  vi.stubGlobal("requestAnimationFrame",raf);
  vi.stubGlobal("cancelAnimationFrame",(key:number)=>frames.delete(key));
  const render=(JarvisCore as unknown as {type:(props:Parameters<typeof JarvisCore>[0])=>unknown}).type;
  render({reduced,stateKey:"listening",frameRef:{current:{name:"listening",since:0,amplitude:()=>.5,launchAt:null,foldAt:null,geometry:overlayGeometry(1920,1080)}}});
  const dispose=hooks.effects[0]();
  // The resize clear is setup, not a rendered core frame.
  fillRect.mockClear();
  const tick=(now:number)=>{const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);};
  return {fillRect,frames,raf,tick,dispose};
}
describe("JarvisCore animation scheduling",()=>{
  it("reduced motion paints one static frame and never schedules a continuing loop",()=>{
    const core=mount(true);expect(core.frames.size).toBe(1);
    core.tick(16);expect(core.fillRect).toHaveBeenCalledTimes(1);expect(core.frames.size).toBe(0);
    for(let now=32;now<=1000;now+=16)core.tick(now);
    expect(core.fillRect).toHaveBeenCalledTimes(1);expect(core.raf).toHaveBeenCalledTimes(1);
    core.dispose?.();
  });
  it("the same probe detects continuing frames in normal motion",()=>{
    const core=mount(false);core.tick(16);core.tick(32);
    expect(core.fillRect).toHaveBeenCalledTimes(2);expect(core.frames.size).toBe(1);
    core.dispose?.();expect(core.frames.size).toBe(0);
  });
});
