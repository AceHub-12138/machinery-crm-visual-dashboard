import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 字号标尺守卫。
 *
 * 背景（这一版最隐蔽的一个 bug）：Tailwind 4 遇到「text + 方括号任意值 +
 * var(--fs-x)」时，要判断这个任意值是**字号**还是**颜色**，而它看不出 CSS
 * 变量的类型，于是一律当成颜色，生成 `color: var(--fs-x)` —— 字号根本没落地。
 * 整屏 65 处字号声明全部失效，文字退回继承值（16px 起，环心那个手写的
 * 46px），环心文字就是这么压住进度弧的。
 *
 * 修法是把这些字号注册进 Tailwind 的 --text-* 命名空间（globals.css 的
 * `@theme inline` 块），组件改用 `text-label` 这类真实工具类。
 * 这个测试守住两件事：
 *   1. 代码里不许再出现那种任意值写法；
 *   2. 全部字号令牌都已在 @theme 里注册（少一个就退回「颜色」）。
 *
 * ⚠️ 本文件里**不能**把那个坏写法写成完整字面量 —— Tailwind 的候选扫描器
 * 连 .ts 文件一起扫，扫到带 `*` 的非法候选会让整个 CSS 编译失败（实测报
 * "./src/app/globals.css: Parsing CSS source code failed: Unexpected token
 * Delim('*')"，而报错位置指向的却是 CSS，极难定位）。所以下面用拼接构造。
 */

const SRC = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(SRC, "app/globals.css"), "utf8");

/** 拼接构造：避免出现可被 Tailwind 扫到的完整候选字面量。 */
const BAD_PREFIX = "text-[" + "var(--fs-";

const TOKENS = [
  { css: "--fs-display", utility: "text-display", min: 18 },
  { css: "--fs-hero", utility: "text-hero", min: 18 },
  { css: "--fs-metric", utility: "text-metric", min: 18 },
  { css: "--fs-label", utility: "text-label", min: 18 },
  { css: "--fs-caption", utility: "text-caption", min: 18 },
  { css: "--fs-micro", utility: "text-micro", min: 18 },
  { css: "--fs-brand", utility: "text-brand", min: 18 },
  { css: "--fs-brand-sm", utility: "text-brand-sm", min: 18 },
  { css: "--fs-hero-lg", utility: "text-hero-lg", min: 18 },
  { css: "--fs-ring", utility: "text-ring", min: 18 },
  // 头部英文装饰字，跟踪 0.34em 的 kicker，是全屏唯一低于 18px 的文字
  { css: "--fs-kicker", utility: "text-kicker", min: 14 },
] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("font scale", () => {
  it("declares the six size tokens in :root", () => {
    for (const token of TOKENS) {
      expect(CSS).toMatch(new RegExp(`${token.css}:\\s*(?:calc\\()?\\d+px`));
    }
  });

  it("registers every size token in the Tailwind --text-* namespace", () => {
    const theme = CSS.match(/@theme[^{]*\{([^}]*)\}/);
    expect(theme).not.toBeNull();
    for (const token of TOKENS) {
      // --text-label: var(--fs-label);
      const registered = new RegExp(
        `--${token.utility}:\\s*var\\(${token.css.replace(/[-]/g, "\\-")}\\)`,
      );
      expect(theme?.[1] ?? "").toMatch(registered);
    }
  });

  it("never writes the size token as an arbitrary value — Tailwind reads it as a colour", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith("font-scale.test.ts")) continue;
      // 先剥掉注释：globals.css 的注释在讲这个坑，会被自己绊倒
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const line of text.split("\n")) {
        if (line.includes(BAD_PREFIX)) {
          offenders.push(`${path.relative(SRC, file)}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every size on the declared scale — no bare text-[Npx] in components", () => {
    const sizes = new Map(
      [...CSS.matchAll(/(--fs-[a-z-]+):\s*(?:calc\()?([\d.]+)px/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(sizes.size).toBeGreaterThanOrEqual(TOKENS.length);
    for (const token of TOKENS) {
      expect(sizes.get(token.css)).toBeDefined();
      // 字号下限：55 吋屏 / 4m 视距下 18px ≈ 5.1mm 字高，低于它就不可读
      expect(sizes.get(token.css)).toBeGreaterThanOrEqual(token.min);
    }

    // 组件里不许再出现裸字号 —— 一律走令牌，否则审计（按令牌比对计算字号）
    // 会漏掉，标尺也会慢慢失守。
    const bare: string[] = [];
    for (const file of walk(path.join(SRC, "components"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/text-\[(\d+)px\]/g)) {
        bare.push(`${path.basename(file)}: ${m[0]}`);
      }
    }
    expect(bare).toEqual([]);
  });
  it("rejects subminimum font declarations in every CSS and TSX file", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).filter(f => /\.(css|tsx)$/.test(f))) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const floor = file.includes("/overlay/") ? 20 : 18;
      const islandCaption = path.relative(SRC, file) === "app/globals.css" ? text.match(/\.nexus-islands p\s*\{[^}]*\}/) : null;
      if (islandCaption) {
        expect(islandCaption[0]).toMatch(/font-size:\s*14px/);
        expect(islandCaption[0]).toMatch(/color:\s*#8A93A0/);
      }
      const cityLabel = path.relative(SRC, file) === "app/globals.css" ? text.match(/\.nexus-map-labels \.nexus-city-label\s*\{[^}]*\}/) : null;
      if (cityLabel) expect(cityLabel[0]).toMatch(/font-size:\s*16px/);
      const provinceLabel = path.relative(SRC, file) === "app/globals.css" ? text.match(/\.nexus-map-labels \.nexus-province-label\s*\{[^}]*\}/) : null;
      if (provinceLabel) { expect(provinceLabel[0]).toMatch(/font-size:\s*14px/); expect(provinceLabel[0]).toMatch(/color:\s*#8A93A0/); }
      const localSubtitle = path.relative(SRC, file) === "app/globals.css" ? text.match(/\.nexus-map-labels \.nexus-local-units\s*\{[^}]*\}/) : null;
      if (localSubtitle) {
        expect(localSubtitle[0]).toMatch(/font-size:\s*13px;/);
        expect(localSubtitle[0]).toMatch(/color:\s*#EE7D2C;/);
        expect(localSubtitle[0]).toMatch(/opacity:\s*\.85;/);
        expect(localSubtitle[0]).toMatch(/white-space:\s*nowrap;/);
        expect(localSubtitle[0]).toMatch(/-webkit-text-stroke:\s*2px #11151B;/);
        expect(localSubtitle[0]).toMatch(/paint-order:\s*stroke;/);
      }
      for (const m of text.matchAll(/(?:font-size:\s*|fontSize:\s*|fontSize=\{)(\d+(?:\.\d+)?)/g)) {
        const captionException = islandCaption && m.index >= islandCaption.index! && m.index < islandCaption.index! + islandCaption[0].length && Number(m[1]) === 14;
        const cityException = cityLabel && m.index >= cityLabel.index! && m.index < cityLabel.index! + cityLabel[0].length && Number(m[1]) === 16;
        const localSubtitleException = localSubtitle && m.index >= localSubtitle.index! && m.index < localSubtitle.index! + localSubtitle[0].length && Number(m[1]) === 13;
        if (Number(m[1]) < floor && !captionException && !cityException && !localSubtitleException && !(provinceLabel && m.index >= provinceLabel.index! && m.index < provinceLabel.index! + provinceLabel[0].length && Number(m[1]) === 14)) offenders.push(`${path.relative(SRC,file)}: ${m[0]}`);
      }
      for (const m of text.matchAll(/(--(?:ov-)?fs-[a-z-]+):\s*(?:calc\()?([\d.]+)px/g)) {
        if (m[1] !== "--fs-kicker" && Number(m[2]) < floor) offenders.push(`${path.relative(SRC,file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

});
