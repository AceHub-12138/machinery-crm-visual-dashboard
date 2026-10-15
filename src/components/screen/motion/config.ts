/** V1.0 §9. All durations use milliseconds and the same director clock. */
export const motionConfig = {
  intro: 2200, pulseInterval: 150_000, pulseDuration: 10_000, reset: 280,
  // Resonance storyboard, in seconds of the 10s cue.
  pulseMapRise: 1.5, pulseRoutesFull: 3, pulseRouteRamp: .3, pulseHoldEnd: 6.5, pulseRippleCycle: 1.75,
  routeInterval: [8000, 12000], routeTravel: 3000, arrival: 1000,
  originCycle: 3000, particles: 150, particleSize: [1, 2], particleSpeed: 3,
  rulerInterval: [20_000, 30_000], rulerSweep: 1400,
  dialCycle: 24_000, overdueCycle: 4000,
  focusInterval: [12_000, 15_000], focusHighlight: 2000, numberDuration: 800,
  maxSignificant: 8, fpsWindow: 1000, lowFps: 45, lowDuration: 5000,
  recoveryFps: 52, recoveryDuration: 10_000, logInterval: 600_000,
} as const;
export type MotionConfig = typeof motionConfig;
