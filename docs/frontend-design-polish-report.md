# 大屏前端改造施工报告

施工基线 `6f484a0`，分支 `feat/screen-design-polish`，工作目录 `/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish`。本次按《大屏前端修改方案》完成 P0 与已授权的 P1 前端改造；实时追问按 Ace 的决定暂缓。P2 仅提供设计评审稿，尚未接入运行页面。

## 工作结果

| 项目 | 完成内容 |
|---|---|
| 文字基础 | 金额按万/亿显示，数值单位绑定；FitText 按最终数字测量并保留下限；截断有悬停全文和读屏补偿；客户后缀、中间省略和省份简称仅作用于展示 |
| P0-1 | 暂无数据、网络中断、没听清、已打断、服务降级独立表达；声音提示移到卡片顶部；简报可见正文不重复 |
| P0-2/3 | 底屏主读数 64px，最小 44px；环心 56px；语音层信息至少 20px、播报 24px、标题 34px |
| P0-4/5 | 默认隐藏面板英文眉标及调试提示；铜色统一为品牌橙 #ee7d2c |
| P0-6/7 | 读屏逐句通知完整文字；减少动效停止持续 Canvas 刷新，保留音频振幅采样 |
| P1-1 | 实测左列 340px 会让目标文案折行，采用方案允许的 360/940/564；地图扩大，排行和图例移至右下角、宽度不超过 22% |
| P1-2 | 提醒改为大计数与单列两条，按到期时间排序，8 秒翻页，+N 保留余项总量；减少动效停止轮播 |
| P1-3 | 112px 交付时间轴，每页最多 5 个节点；12 条分 5/5/2，可翻页查看全部 |
| P1-5 | 7 根音量柱读取已有 worklet 的 RMS，20Hz 刷新；不另开收音流，不改 VAD/KWS 判定 |
| P1-6 | s/m/l 高度 360/620/720px；实际测量三行播报分页，跟随句子进度，也支持手动查看；字符图标改为 SVG |

详细尺寸见 [screen-design-spec.md](screen-design-spec.md) 第 13、14 节。底屏的 75% 地图占比使用中国轮廓包围盒宽度度量（实测约 78.8%），并非多边形陆地填色面积的比例。

## 两项重点要求

1. 第 5.1 节示意代码没有照抄。新检测器分开处理可见性、字体下限、文字 Range、真实裁剪边界和全文补偿；不使用 offsetParent 作为可见性判断，也不把正常行高差异当作裁剪。故意溢出、行内伪裁剪、无补偿裁剪、固定定位和面板交叠均有负向用例。
2. `voice-cards.spec.ts` 的尺寸断言保留：P0 更新为 700px；P1 按 s/m/l 检查 360/620/720、数据区 0/202/302、播报区 170、底部留白及 1020×scale 底边。CPU 增量 ≤8ms 未放宽；增加 4K、300 字逐页拼接及单省 100% 边界。

截图复核发现里程碑的行内 span 虽有全文提示，却没有真正裁剪，造成长型号伸入相邻节点。已将单行裁剪边界改为受宽度约束的块级元素；检测器只有在裁剪实际生效时才允许补偿例外，新增“行内伪裁剪”负向验证。该问题的历史截图保留在 `.review/design-polish/delivery-shots/long-screen-before-clip-fix.png`。

## 最终验证

- 单测：36 个文件、481 项通过，包括字号守卫。
- 浏览器回归：其他浏览器回归 100 项通过；文字检测 17 项在修正负向夹具后全部复验通过，共 117 项去重覆盖完成；另 1 项截图补采通过。各次均无跳过、无自动重试。整套曾为 116/117，唯一失败为新增“行内伪裁剪”夹具未实际超出父框；收窄父框后复验全部文字用例，产品源码未再变更。。
- 范围：screen、voice-cards、voice-playback、voice-input、text-fit、reminders、milestones；覆盖 1280×720、1920×1080、3840×2160，常规/长字符串、零值、负金额、超额、15/60 条发运、12 条交付、300 字回答、异常状态、减少动效和音量柱。
- Lint、生产构建、`git diff --check` 通过。音频静音测试模式未启用；原 PCM 排程、打断和 VAD 检查保留。
- CPU 指标：1920 与 1280 的增量 P95 均约 1.7ms，低于原 8ms 门槛。。测量为每个 RAF 时间戳内 JS+Canvas 回调 CPU 耗时，不含 GPU/合成器，不代表展厅硬件总帧耗时。
- 主工作目录仍在 main / 6f484a0，既有 next-env 和效果图文件未改动。

整套记录：`.review/design-polish/delivery-clipping-regression.json`；最终文字复验及截图补采：`.review/design-polish/delivery-text-final.json`；单测、Lint、构建分别为 `delivery-unit.log`、`delivery-clip-lint.log`、`delivery-clip-build.log`。P0/P1 中间失败、误报和修复过程保留在 `.review/design-polish/`，最终结论以最后一轮为准。截图补采脚本最初因虚拟时钟倒退失败，随后修正并成功补采；它与产品回归结果分开记录。

## 截图与预览

[修改前后对比](screenshots/before-after-design-polish.png)；原 `docs/screenshots/before-after.png` 保留。

- [默认底屏](screenshots/design-polish/default-screen.png) / [长数据底屏](screenshots/design-polish/long-screen.png)
- 八张卡片：`docs/screenshots/design-polish/实现_1_*.png` 至 `实现_8_*.png`
- 五种异常：`status-no-data.png`、`status-offline.png`、`status-asr-miss.png`、`status-interrupted.png`、`status-degraded.png`
- [减少动效](screenshots/design-polish/reduced-motion.png)
- 进入三帧：`transition-0ms.png`、`transition-250ms.png`、`transition-500ms.png`；使用受控浏览器时钟，时间元数据在 `transition-times.json`，各帧铜色和核心色一致。
- 本地预览：[底屏](http://127.0.0.1:3021/screen/sales?fit=1) / [语音演示](http://127.0.0.1:3021/screen/sales?voiceDemo=1&lite=1)。该端口运行本分支生产构建，原 3015 演示未改动。

## 暂缓与验收边界

- P1-4：Ace 已确认“保持服务不变，实时追问暂缓；完成其余前端改造”。屏幕连接是只读角色，对话台 question.submit 有控制权限限制；现阶段保留追问提示。
- P2：[设计评审稿](design/p2-design-review.md) 已完成，并提供常规/超宽两种布局与低配、减少动效、语音覆盖、空闲聚焦、光环的概念预览。按原方案第 4 节，Ace 确认设计后再实施。正式 ?layout=wide、空闲轮播、粒子光环和模糊过渡尚未实现；P2-5 逐张效果图对照尚未验收。
- 服务没有增加“无数据”的自动业务判定。前端支持显式原因元数据，不会把 0 判为无数据；未提供元数据时沿用原会话标签。
- 未修改语音编排服务、公开接口结构、生产数据口径或运行依赖。长客户名只在展示工具单测验证，未加入公开 API。
- 本地浏览器音频路径测试已通过；实际扬声器/麦克风、人声交互、4–8 米可读性、Windows 和展厅噪声环境尚未人工验收。
- 全部为本地提交，未合并、未推送、未开 PR、未部署。P0/P1 可先本地审阅；P2 需另行确认设计。

## 本地提交

- `4138681 feat(screen): 建立缩字与全文补偿工具，避免长值撑破布局`
- `5fd0db3 feat(voice-ui): 独立表达异常原因并把声音提示放入卡片`
- `f3eba02 feat(voice-ui): 提升语音字号并保留新尺寸几何断言`
- `006ffe8 feat(screen): 放大主读数和回款环并限制缩字下限`
- `40e8257 feat(screen): 默认隐藏英文眉标与语音调试提示`
- `14033cf feat(voice-ui): 将覆盖层主线框统一为品牌橙`
- `d414d97 feat(voice-ui): 读屏只播完整句并避免逐字重复通知`
- `e8c353d feat(voice-ui): 减少动效时静态绘制并保留真实音量采样`
- `fdd8b11 test(e2e): 重写溢出检测并扩充长字符串和异常状态回归`
- `bd6effd feat(screen): 扩大地图并外移浮层，同步更新几何验收`
- `31bb322 feat(screen): 提醒以数字为主，按紧急程度单列翻页`
- `4f4981b feat(screen): 交付里程碑改为横向时间轴并保留全部分页记录`
- `805c5d7 feat(voice-ui): 聆听时展示真实音量，并保留原有收音判定`
- `312c2ec feat(voice-ui): 卡片按内容分档，长播报按三行测量翻页`
- `db8503c feat(screen): 补齐大金额与长标签边界，保持数字单位同一行`
- `0e2b180 feat(screen): 提交 P2 超宽与过渡设计稿，待确认后实施`
- `de5d1a5 feat(screen): 让长标签裁剪真正生效，防止时间轴相邻文字重叠`

随后交付提交保存截图与本报告；完整列表可运行 `git log --reverse --oneline 6f484a0..HEAD` 查看。
