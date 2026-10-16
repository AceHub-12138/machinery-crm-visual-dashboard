import { matchProvinceKey } from "./geo";
export const REGION_ZONES = {
  华东: ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东", "台湾"],
  华南: ["广东", "广西", "海南", "香港", "澳门"],
  华北: ["北京", "天津", "河北", "山西", "内蒙古"],
  华中: ["河南", "湖北", "湖南"],
  西南: ["重庆", "四川", "贵州", "云南", "西藏"],
  西北: ["陕西", "甘肃", "青海", "宁夏", "新疆"],
  东北: ["辽宁", "吉林", "黑龙江"],
} as const;
const PROVINCE_ZONE = new Map<string, string>(Object.entries(REGION_ZONES).flatMap(([zone, provinces]) => provinces.map(province => [province, zone] as const)));
export function regionZone(province: string) { return PROVINCE_ZONE.get(matchProvinceKey(province)) ?? "地区待确认"; }
