import { chinaMap } from './geo';
import { boxesOverlap, type LabelBox } from './screen-map-labels';
type Point = { x: number; y: number };
export function polygonArea(points: readonly Point[]) {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
/** Sutherland–Hodgman area clipping of the committed straight-line province geometry. */
export function clippedPolygon(points: readonly Point[], bounds: LabelBox) {
  let result = [...points];
  for (const [axis, edge, sign] of [['x', bounds.l, 1], ['x', bounds.r, -1], ['y', bounds.t, 1], ['y', bounds.b, -1]] as const) {
    const input = result; result = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const insideA = (a[axis] - edge) * sign >= 0, insideB = (b[axis] - edge) * sign >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) { const ratio = (edge - a[axis]) / (b[axis] - a[axis]); result.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }); }
    }
  }
  return result;
}
const provinces = chinaMap.provinces.map(p => ({ ...p, polygons: p.d.split('Z').flatMap(ring => {
  const pairs = [...ring.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  return pairs.length ? [pairs] : [];
}) }));
export function visibleProvinceFraction(adcode: string, bounds: LabelBox) {
  const polygons = provinces.find(p => p.adcode === adcode)?.polygons ?? [];
  const total = polygons.reduce((sum, p) => sum + polygonArea(p), 0);
  return total ? polygons.reduce((sum, p) => sum + polygonArea(clippedPolygon(p, bounds)), 0) / total : 0;
}
export function placeProvinceLabels(bounds: LabelBox, toPixel: (x: number, y: number) => Point, screen: LabelBox, occupied: readonly LabelBox[]) {
  const reserved = [...occupied];
  return provinces.flatMap(p => {
    const visible = visibleProvinceFraction(p.adcode, bounds);
    if (visible <= .6) return [];
    const center = toPixel(p.x, p.y), width = p.short.length * 14;
    const x = center.x - width / 2, y = center.y - 10;
    const box = { l: x, r: x + width, t: y, b: y + 20 };
    if (box.l < screen.l || box.r > screen.r || box.t < screen.t || box.b > screen.b || reserved.some(other => boxesOverlap(box, other))) return [];
    reserved.push(box);
    return [{ text: p.short, adcode: p.adcode, visible, x, y, box }];
  });
}
