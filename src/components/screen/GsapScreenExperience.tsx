"use client";
import { ScreenExperience, type ScreenExperienceProps } from './ScreenExperience';
import GsapMotionProvider from './motion/GsapMotionProvider';
/** Separate server-selected client entry: normal pages never import the GSAP runtime. */
export function GsapScreenExperience(props: ScreenExperienceProps) {
  return <ScreenExperience {...props} MotionComponent={GsapMotionProvider}/>;
}
