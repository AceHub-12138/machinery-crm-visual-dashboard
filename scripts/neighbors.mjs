/**
 * 大屏渲染的邻国清单（EN 名与 Natural Earth 的 ADMIN/NAME 对齐）。
 *
 * 由 build-china-map.mjs（国界面）与 build-neighbor-admin-lines.mjs（一级行政区内边线）
 * 共享，保证两个脚本渲染的是同一批国家；EN 名用于匹配 NE 数据，ZH 名用于标签。
 */
export const NEIGHBORS = [
  ["Mongolia", "蒙古", 0],
  ["Kazakhstan", "哈萨克斯坦", 0],
  ["Kyrgyzstan", "吉尔吉斯斯坦", 0],
  ["Tajikistan", "塔吉克斯坦", 0],
  ["Afghanistan", "阿富汗", 1],
  ["Pakistan", "巴基斯坦", 1],
  ["India", "印度", 1],
  ["Nepal", "尼泊尔", 0],
  ["Bhutan", "不丹", 0],
  ["Myanmar", "缅甸", 0],
  ["Laos", "老挝", 0],
  ["Vietnam", "越南", 0],
  ["Thailand", "泰国", 1],
  ["Cambodia", "柬埔寨", 1],
  ["Bangladesh", "孟加拉国", 1],
  ["Sri Lanka", "斯里兰卡", 2],
  ["Malaysia", "马来西亚", 2],
  ["Indonesia", "印度尼西亚", 2],
  ["Philippines", "菲律宾", 2],
  ["North Korea", "朝鲜", 0],
  ["South Korea", "韩国", 0],
  ["Japan", "日本", 1],
  ["Russia", "俄罗斯", 1],
  ["Uzbekistan", "乌兹别克斯坦", 1],
  ["Turkmenistan", "土库曼斯坦", 2],
  ["Iran", "伊朗", 2],
];
