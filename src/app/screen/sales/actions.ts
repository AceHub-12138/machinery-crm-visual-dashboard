"use server";
import { createSnapshotReader } from "@/lib/screen-snapshot";
import { buildMockScreenPayload } from "@/lib/mock";
import { toPublicScreenPayload } from "@/lib/public-screen-payload";

const readSnapshot = createSnapshotReader();
export async function refreshScreenSnapshot(source: "mock" | "public") {
  if (source === "mock") return toPublicScreenPayload(buildMockScreenPayload());
  const platformUrl = process.env.SCREEN_PLATFORM_URL;
  const publicId = process.env.SCREEN_PUBLIC_ID;
  return readSnapshot(platformUrl && publicId ? { platformUrl, publicId } : null);
}

export async function screenRequestTime() { return Date.now(); }
