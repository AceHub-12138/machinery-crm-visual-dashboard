import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Effect harness: real async hook setup/cleanup, without importing a browser renderer.
const rig = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  instances: [] as Array<{ dispose: ReturnType<typeof vi.fn>; audit: ReturnType<typeof vi.fn> }>,
}));
vi.mock("react", () => ({
  useState: () => [null, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => { rig.effects.push(effect); },
}));
vi.mock("./XiaochuanTimeline", () => ({ XiaochuanTimeline: class {
  dispose = vi.fn(); audit = vi.fn(() => ({ alive: !this.dispose.mock.calls.length }));
  visibility = vi.fn(); setReduced = vi.fn();
  constructor() { rig.instances.push(this); }
} }));
import { useXiaochuanMotion } from "./useXiaochuanMotion";
type AuditWindow = { location: { search: string }; __xiaochuanMotionAudit?: () => unknown };
let target: AuditWindow;
const cleanups: Array<() => void> = [];
async function mount(mode = "gsap", audit = true) {
  rig.effects.length = 0;
  // This also exercises the pre-hardening hook, whose extra arguments are ignored at runtime.
  (useXiaochuanMotion as (...args: unknown[]) => unknown)(false, mode, audit);
  const cleanup = rig.effects[0]() ?? (() => {}); cleanups.push(cleanup);
  await vi.dynamicImportSettled();
  return cleanup;
}
beforeEach(() => {
  rig.instances.length = 0;
  target = { location: { search: "?xiaochuanMotion=gsap" } };
  vi.stubGlobal("window", target);
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });
describe("server-selected Xiaochuan effect lifecycle", () => {
  it("cannot enable GSAP from a URL when the server selects Legacy", async () => {
    await mount("legacy", false);
    expect(rig.instances).toHaveLength(0); expect(target.__xiaochuanMotionAudit).toBeUndefined();
  });
  it("runs authorized GSAP without publishing diagnostics outside approved debug", async () => {
    await mount("gsap", false);
    expect(rig.instances).toHaveLength(1); expect(target.__xiaochuanMotionAudit).toBeUndefined();
  });
  it("removes the global entry and revokes a saved audit closure on unmount", async () => {
    const cleanup = await mount(); const saved = target.__xiaochuanMotionAudit!;
    expect(saved()).toEqual({ alive: true }); cleanup();
    expect(target.__xiaochuanMotionAudit).toBeUndefined(); expect(saved()).toBeNull();
    expect(rig.instances[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("old cleanup cannot delete a newer instance audit and no old closure can read it", async () => {
    const oldCleanup = await mount(); const oldAudit = target.__xiaochuanMotionAudit!;
    const newCleanup = await mount(); const newAudit = target.__xiaochuanMotionAudit!;
    oldCleanup(); expect(target.__xiaochuanMotionAudit).toBe(newAudit);
    expect(oldAudit()).toBeNull(); expect(newAudit()).toEqual({ alive: true });
    newCleanup(); expect(target.__xiaochuanMotionAudit).toBeUndefined(); expect(newAudit()).toBeNull();
  });
  it("cancels an unmounted asynchronous import before it can register or create an instance", async () => {
    rig.effects.length = 0;
    (useXiaochuanMotion as (...args: unknown[]) => unknown)(false, "gsap", true);
    rig.effects[0]()!(); await vi.dynamicImportSettled();
    expect(rig.instances).toHaveLength(0); expect(target.__xiaochuanMotionAudit).toBeUndefined();
  });
});
