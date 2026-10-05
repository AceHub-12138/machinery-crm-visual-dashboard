# Design QA — 展厅经营指挥舱 Rev 5

## Comparison target

- Source visual truth: `E:\Claude\machinery-crm-Visual Dashboard\.review\source-before.png`
- Implementation screenshot: `E:\Claude\machinery-crm-Visual Dashboard\.review\codex-dashboard-1920.png`
- Full-view comparison: `E:\Claude\machinery-crm-Visual Dashboard\.review\dashboard-comparison.png`
- Focused comparison: `E:\Claude\machinery-crm-Visual Dashboard\.review\dashboard-comparison-focus.png`
- Intended CSS stage: 1920 × 1080, responsive fit enabled
- Source pixels: 1920 × 911, density 1; the supplied source is vertically cropped before the bottom milestone strip
- Implementation capture: 1936 × 1048 browser surface, density 1; the 1920 × 1080 stage is scaled proportionally to fit
- State: dark showroom theme, September 2026 sample data, default map state, no development overlay

## Findings

No actionable P0, P1, or P2 visual differences remain. The implementation intentionally redesigns the source rather than reproducing it pixel-for-pixel.

- Typography: the existing Chinese sans and condensed HUD face are retained. KPI, panel title, caption, and decorative English sizes remain on the registered token scale; no business text falls below 18px.
- Spacing and layout: the 360 / 880 / 624 three-column structure and 838 / 112 row budget are preserved. The left rail now uses its available height; the right collection block no longer repeats the same values in three competing arrangements.
- Colors and tokens: brand orange remains the contract/target color. Cyan is reserved for geographic flow and collection, green for received/completed, amber for pending, and red for overdue risk. Panel glow was reduced while the map retained edge light, graticule, and route motion.
- Image and asset quality: no raster placeholder was introduced. The existing generated China vector data, routes, labels, and map interaction remain intact and render sharply at the showroom stage size.
- Copy and content: "合同与回款", "全国交付态势", and "交付预警" make the screen understandable without internal implementation context. Customer company names were replaced with contract numbers for the public showroom surface.
- Accessibility: contrast tokens remain above the documented 4.5:1 threshold for information-bearing text, headings are semantic, the fullscreen control is keyboard reachable, motion respects `prefers-reduced-motion`, and map routes expose labels plus keyboard handlers. The map's pointer highlight is an enhancement; all decision data is duplicated in visible text.
- Viewport resilience: the stage uses proportional fit, preventing panel collapse or overlap. The supplied fixed-screen use case does not require a separate mobile layout.

## Comparison history

### Pass 1

- [P1] Showroom privacy exposure: delivery reminders displayed customer company names. Fixed by displaying `contractNo` while retaining date, equipment, and model.
- [P2] Weak hierarchy: the map had no title or top-line situation summary. Fixed with a restrained glass title bar and route / coverage / completed counters.
- [P2] Repeated collection information: the dial, target line, and two large bars competed for attention. Fixed by separating rate, received/unreceived amounts, and contract structure into one reading sequence.
- [P2] Dead space in the KPI rail: the four supporting metrics stopped early in the column. Fixed by allowing that grid to consume the remaining height.
- [P2] Browser warnings: SVG used the React-incompatible `pointer-events` property and dial trigonometry produced server/client float-tail differences. Fixed with `pointerEvents` and deterministic four-decimal coordinates.

### Pass 2

- Re-captured the browser-rendered screen and focused left/right comparisons.
- Confirmed the Next.js issue overlay no longer appears after reload.
- Tested fullscreen entry and exit successfully.
- No remaining P0/P1/P2 findings.

## Follow-up polish

- [P3] A real 55–86 inch display may need one venue-specific brightness pass because ambient showroom lighting cannot be simulated from the browser capture.
- [P3] Dense east-coast place labels are intentionally retained for geographic credibility; if the physical display makes them shimmer, reduce inactive province-label opacity rather than shrinking text.

final result: passed
