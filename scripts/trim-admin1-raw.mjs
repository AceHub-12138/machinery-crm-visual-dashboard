// 一次性裁剪脚本：从 NE 10m admin-1 全量数据中提取 26 个邻国，
// 只保留 admin/name 两个属性，写入 src/data/ne-admin1-neighbors-raw.json。
// 用法：node scripts/trim-admin1-raw.mjs <全量geojson路径>
import fs from "node:fs";
import { NEIGHBORS } from "./neighbors.mjs";

const [, , input] = process.argv;
if (!input) {
  console.error("usage: node scripts/trim-admin1-raw.mjs <full-geojson>");
  process.exit(1);
}

const names = new Set(NEIGHBORS.map(([en]) => en));
const full = JSON.parse(fs.readFileSync(input, "utf8"));
const keep = full.features.filter((f) => names.has(f.properties.admin));
const out = {
  type: "FeatureCollection",
  features: keep.map((f) => ({
    type: "Feature",
    properties: { admin: f.properties.admin, name: f.properties.name },
    geometry: f.geometry,
  })),
};
fs.writeFileSync(
  new URL("../src/data/ne-admin1-neighbors-raw.json", import.meta.url),
  JSON.stringify(out),
);
console.log("kept features:", keep.length, "of", full.features.length);
const byAdmin = {};
for (const f of keep) byAdmin[f.properties.admin] = (byAdmin[f.properties.admin] || 0) + 1;
console.log(JSON.stringify(byAdmin));
