export type LabelBox = { l: number; r: number; t: number; b: number };
export type CityLabelCandidate = { text: string; x: number; y: number };
export const CITY_LABEL_SIZE = 16;
export function mapCityName(city: string) { return city.replace(/市$/, ""); }
export function boxesOverlap(a: LabelBox, b: LabelBox) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

/** Reserve factory/inset first. Try the right side, then the left; dots survive omissions. */
export function placeCityLabels(candidates: readonly CityLabelCandidate[], bounds: LabelBox, reserved: readonly LabelBox[]) {
  const occupied = [...reserved];
  return candidates.flatMap(candidate => {
    const text = mapCityName(candidate.text), width = text.length * CITY_LABEL_SIZE;
    if (!text) return [];
    for (const side of ["right", "left"] as const) {
      const x = candidate.x + (side === "right" ? 12 : -width - 12), y = candidate.y - 12;
      const box = { l: x - 4, r: x + width + 4, t: y - 3, b: y + 27 };
      if (box.l < bounds.l || box.r > bounds.r || box.t < bounds.t || box.b > bounds.b || occupied.some(o => boxesOverlap(box, o))) continue;
      occupied.push(box);
      return [{ text, x, y, side, box }];
    }
    return [];
  });
}
