import { describe, expect, it } from "vitest";
import { resolveXiaochuanMotion } from "./permission";
const legacy = { mode: "legacy", auditAllowed: false };
describe("independent server Xiaochuan permission", () => {
  it.each([undefined, "", "1", "true", "local-candidate", "local-shadow", "LOCAL-GSAP", "local-gsap "])("denies missing/invalid/unrelated grant %s", grant => {
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap", debug: "1" }, grant, true, true)).toEqual(legacy);
  });
  it("denies URL-only authorization without an attested request even with server flags", () => {
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap", debug: "1" }, "local-gsap")).toEqual(legacy);
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap" }, "local-gsap", false, true)).toEqual(legacy);
  });
  it.each([undefined, "", "legacy", "GSAP", "true", "1", "gsap ", ["gsap"], ["gsap", "gsap"], ["gsap", "legacy"]])("rejects absent, old, malformed or repeated modes %j", mode => {
    expect(resolveXiaochuanMotion({ xiaochuanMotion: mode, debug: "1" }, "local-gsap", true, true)).toEqual(legacy);
  });
  it("requires the explicit Xiaochuan parameter, independent of main engine/quality/debug flags", () => {
    expect(resolveXiaochuanMotion({ motion: "gsap", qualityExperiment: "candidate", debug: "1" }, "local-gsap", true)).toEqual(legacy);
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap" }, "local-gsap", true)).toEqual({ mode: "gsap", auditAllowed: false });
  });
  it("grants audit only to exact debug=1 or the server-approved review page", () => {
    for (const debug of [undefined, "true", "0", ["1", "1"]]) {
      expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap", debug }, "local-gsap", true).auditAllowed).toBe(false);
    }
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap", debug: "1" }, "local-gsap", true)).toEqual({ mode: "gsap", auditAllowed: true });
    expect(resolveXiaochuanMotion({ xiaochuanMotion: "gsap" }, "local-gsap", true, true)).toEqual({ mode: "gsap", auditAllowed: true });
  });
});
