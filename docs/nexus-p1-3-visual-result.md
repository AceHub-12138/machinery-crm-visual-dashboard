# 大川机床 8c · P1.3 视觉收口交付

日期：2026-10-16。本批从 PR #2 HEAD `b451b652a82c0af7cbcceeb26f1c4268478507d0` 新建隔离 worktree，分支 `codex/nexus-p1-3-visual`。仅本地修改、验证；未推送、未合并、未部署，未启动 Task 11。

## 结论与审核边界

本批五项问题均已完成本地修复与验收。最终验收结果见下表。CRM/ERP 数据契约、金额计算、语音状态机、发运分页时钟、NEXUS 外层画布和面板布局均未修改。

PR #2 当前不能直接合并：远端仍是原 HEAD，本批补丁尚未进入该 PR；还须架构审核本批实现与截图，批准后另行整合并运行新 HEAD 的 CI。本地浏览器通过不代替这一过程，也不代表现场设备或真实 TTS 音质验收。

无新增业务口径问题需要产品决策。请审核两项视觉选择：保留“人民币口径”并统一放到标题行右侧；采用暗夜橙光设备轮廓缩略图。轮廓为插床、刨床、插齿设备及通用设备的示意，不冒充精确型号实物照片。

## 问题复现、根因与修复

以下实测坐标均为 1792×832 的浏览器视口 CSS 像素。完整 DOMRect、截图和各页审计保存在本 worktree 的 `.review/p1-3/before/`、`.review/p1-3/after/`。

| 问题 | 修复前场景与证据 | 根因 | 本批处理 |
| --- | --- | --- | --- |
| 发运说明/播报冲突 | `before/card-1792-reduce-long-outage-1.png`：说明区 y=577.78–588.56，播报区从 y=583.94 开始，交叠约 4.62px；分页圆点在数据区外。正常态及三页亦已记录。 | 发运组件有徽标、列表、说明、分页四块内容，CSS 只声明三条网格行；说明行仅 14px 且无独立样式。异常态又把数据区从 302 压到 270 设计像素。 | 四条显式网格行，说明使用 20px 字体、24px 行高；异常态维持 302px 数据区，调整标题区、间隔与追问区。列表裁切窗口加 1px 上下余量，保留严格完整可见检查。 |
| 展厅演示标识 | `before/demo-default.png` 的右上角；`before/demo-default.json`：默认公开数据页面仅因 payload 的 `displayNotice=true` 就显示标识。此图处于入场过程，仅用作页眉标识证据。 | Header 直接把数据字段当作显示开关，没有显式演示模式限制。 | 默认公开页面不显示；`?demo=1`、`?source=mock`、`?voiceDemo=1` 为显式演示入口。`displayNotice` 只决定演示模式内的具体文案。过期数据提示继续独立保留。 |
| 人民币说明位置 | `before/main-1792-reduce-normal.png`：两张卡说明均在 y=348–375；合同卡的说明与内容区域相交。 | 绝对定位贴底，与正常流数字内容无避让关系。 | 两张卡统一移入标题行右侧，使用相同的 18px、常规字重和灰色辅助层级；保留人民币语义和原有金额符号、单位。 |
| 发货动态没有图 | 同一主屏截图及 JSON：五条动态的 visual 均为 null。 | 组件仅渲染序号、型号和底部文字，没有设备资源或图形节点。 | 新增本地 SVG 设备轮廓组件。按已有型号文字选择视觉家族，未知型号使用通用轮廓；不加数据字段，不外链图片。每条动态都有可见且有无障碍名称的缩略图。 |
| 标题与 01 重叠 | 同一主屏：标题区 y=636–678，01 为 y=664–692，侵入标题区 14px。 | 列表上留白 15px，序号相对列表项向上偏移 29px；没有单独的动线高度预算。 | 在原 180px 模块内预留 36px 动线区；标题仍为 42px，序号从 y=684 开始，距标题底部 6px。图片/型号与日期/台数/地区各有自己的行。 |

修复后同分辨率异常卡：数据区底部 y=583.94，播报区顶部 y=593.18，间隔约 9.24px（12 设计像素）；说明区底部 y=573.15，距播报区约 20.03px。说明、分页、播报三者均不相交。

## 自动化验收

| 检查 | 结果 |
| --- | --- |
| `pnpm build` | 通过，含 TypeScript 检查 |
| `pnpm test` | 47 个文件、602 项通过 |
| `pnpm lint` | 0 错误；两条基线已有未使用变量警告：`e2e/screen-data-reconcile.spec.ts`、`src/lib/screen-map-routes.ts` |
| P1.3 专项矩阵 | 49/49 通过；无跳过、无 flaky。116 组最终截图/DOMRect/文字审计均无问题 |
| 现有主屏/文本/答案卡回归 | 115/115 通过；无跳过、无 flaky |
| NEXUS 原专项 | 7/7 通过；无跳过、无 flaky |
| NEXUS 动效回归 | 7/7 通过；无跳过、无 flaky |

浏览器合计 178 项通过（49 + 115 + 7 + 7）。最后修正辅助说明行高后，NEXUS 原专项、动效专项和完整 P1.3 矩阵均重新验收通过；最终 116 组证据对应最后构建。

结果文件：[专项](../.review/p1-3/results.json)、[现有回归](../.review/p1-3/regression-results.json)、[NEXUS](../.review/p1-3/nexus-results.json)、[动效](../.review/p1-3/motion-results.json)、[汇总](../.review/p1-3/verification-manifest.json)。

专项命令：`NEXUS_TEST_PORT=3043 pnpm exec playwright test -c e2e/p1-3.config.ts`。

专项矩阵覆盖 1280×720、1792×832、1920×1080、3840×2160 × 正常动效/reduced motion × 常规/长内容。发运卡再交叉正常展示/真实音频不可用提示，逐页记录三页内容。主屏使用 17 条长型号记录和长金额；答案卡使用 15 条长设备名称、长型号及两行分页标题。

长型号保留既有摘要显示，完整内容仍通过 title/aria 提供；金额没有省略，明细行与分页区域均完整可见。

每次记录检查：数据区与播报区、说明与播报区、说明与分页区的间隔；活动页每行在数据区内、整卡在视口内；每条明细 100% 可见；全文文字裁切审计；标题与序号矩形不相交；图片存在可见且不压文字；币种说明不覆盖数据，两个说明样式一致。另测 payload `displayNotice=true` 时默认、显式 demo、mock、显式 public 非 demo 四种入口。

正常无提示卡通过现有的非音频拥有者镜像会话展示；异常卡由真实 WebSocket `session.start` 和缺失 speech manifest 触发既有音频不可用路径，未修改 DOM 伪造提示。此处验收视觉布局，不声称本地 GPU TTS 或扬声器路径通过。

历史失败未丢弃：`.review/p1-3/history/` 保存初期测试夹具时间推进错误，以及第一版修复的裁切边界失败、JSON、trace、截图，以及辅助说明行高 18px / 字体度量 21px 的 NEXUS 严格验收失败。最终结果与这些历史记录分开。翻页采样现从第一页开始，普通动效等待真实 compositor 过渡结束；裁切误差通过实际增加留白修复，没有放宽 100% 可见断言。文本审计器对横向平移 strip 的检查改用其真实 clipping window，仍检查活动页的所有文字。

## 修改文件清单

产品文件：

- `src/components/overlay/cards/CustomersShipmentsCard.tsx`：发运说明区命名。
- `src/components/overlay/overlay.css`：发运四行布局、裁切窗口余量、异常态高度预算。
- `src/components/screen/MachineThumbnail.tsx`：本地设备轮廓视觉。
- `src/components/screen/NexusPanels.tsx`：币种说明位置与设备图引用。
- `src/app/globals.css`：底部动线、图片/型号行、辅助说明层级。
- `src/components/screen/HeaderBar.tsx`：显式 demo 条件。
- `src/components/screen/ScreenStage.tsx`、`ScreenExperience.tsx`、`src/app/screen/sales/page.tsx`：演示展示开关传递。

验收与文档：

- `e2e/p1-3.spec.ts`、`e2e/p1-3.config.ts`：49 个专项用例及本地审计/截图。
- `e2e/nexus-layout-audit.ts`：横向 strip 的真实裁切边界审计。
- `e2e/nexus.spec.ts`：默认不显示演示标识的断言更新。
- `src/lib/nexus-fields.test.tsx`：标识显式模式与数据字段独立组合测试。
- 本交付文档。

截图、JSON、对照页、trace 均在忽略目录 `.review/p1-3/`，不混入产品资源或公开提交。构建生成的 `next-env.d.ts` 变动不纳入本批。

## 截图索引

完整本地对照页：`../.review/p1-3/review.html`。

| 内容 | 修复前 | 修复后 |
| --- | --- | --- |
| 主屏、币种说明、设备图、标题/序号 | [前](../.review/p1-3/before/main-1792-reduce-normal.png) | [后](../.review/p1-3/after/main-1792-reduce-normal.png) |
| 发运卡正常态第一页 | [前](../.review/p1-3/before/card-1792-reduce-normal-normal-1.png) | [后](../.review/p1-3/after/card-1792-reduce-normal-normal-1.png) |
| 长内容、音频异常第一页 | [前](../.review/p1-3/before/card-1792-reduce-long-outage-1.png) | [后](../.review/p1-3/after/card-1792-reduce-long-outage-1.png) |
| 长内容、音频异常第二页 | [前](../.review/p1-3/before/card-1792-reduce-long-outage-2.png) | [后](../.review/p1-3/after/card-1792-reduce-long-outage-2.png) |
| 长内容、音频异常第三页 | [前](../.review/p1-3/before/card-1792-reduce-long-outage-3.png) | [后](../.review/p1-3/after/card-1792-reduce-long-outage-3.png) |
| 默认页眉的演示提示 | [前](../.review/p1-3/before/demo-default.png) | [后](../.review/p1-3/after/demo-default.png) |

交付后停止，不推进 Task 11，不改 main，不合并 PR #2，等待架构审核。
