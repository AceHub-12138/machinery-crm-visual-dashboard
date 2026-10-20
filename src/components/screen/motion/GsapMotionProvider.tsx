"use client";
import { gsap } from 'gsap';
import { MotionProvider, type MotionProviderProps } from './MotionProvider';
import { GsapScene } from './GsapScene';
import { createGsapHost, settleGsapIdle, tickerAudit } from './GsapTickerOwner';
const runtime = {
  audit: () => ({ liveScenes: GsapScene.liveScenes, liveTimelines: GsapScene.liveTimelines, rootAnimations: gsap.globalTimeline.getChildren().length, ...tickerAudit() }),
  createHost: createGsapHost, createScene: (orders: number[]) => new GsapScene(orders), settleIdle: settleGsapIdle,
};
export default function GsapMotionProvider(props: MotionProviderProps) {
  return <MotionProvider {...props} runtime={runtime}/>;
}
