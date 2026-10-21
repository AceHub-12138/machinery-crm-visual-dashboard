# DACHUAN NEXUS · P1.6.1 技术收口

日期：2026-10-21。A/B 边界修复及其专项通过；**GSAP 扩展回归仍有两项来源提交已存在的失败，未达到全绿，不能作为正式集成放行结论。** 仅本地施工、测试和提交，等待架构审核。未推送、合并、部署，未启动 Task 11。

## 基线和隔离

- 来源：`codex/nexus-p1-6-xiaochuan-gsap`，`1c09242cfb7c8a51fd34d687e67c24f475135372`。
- 来源工作区施工前和复查时均干净；原分支和 HEAD 保持不变。
- 对本地已有远端引用执行 `git log HEAD --not --remotes`，来源有 9 个尚未包含在任何本地远端引用中的提交；没有 fetch、push 或修改远端。
- 施工：`codex/nexus-p1-6-1-gsap-hardening`。
- 工作区：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-6-1`。独立 node_modules，离线锁文件安装；未复制任何业务配置或密钥。
- 桌面工具因当前聊天目录不是 Git 仓库而不能创建 managed worktree，改用来源仓库的 `git worktree add -b … <path> <完整来源SHA>`，未清理其他工作区。
- 交付提交完整 SHA 以本轮最终回复及 `git rev-parse codex/nexus-p1-6-1-gsap-hardening` 为准。本文件包含在该提交内，不尝试写入自身提交 SHA。

## 权限边界

两个服务端页面计算模式，再将结果作为属性传入 ScreenExperience / OverlayStage。Hook 不再读取 URL 判断权限。只有以下条件同时满足才选择 GSAP：

1. 进程环境精确设置 `XIAOCHUAN_MOTION_PERMISSION=local-gsap`。
2. 当前请求具有现有 loopback launcher 建立的可信服务端上下文：原始监听 socket、实际本地/对端地址和端口校验通过，转发头检查通过，AsyncLocalStorage 中本次请求得到认证。
3. `xiaochuanMotion` 为唯一标量 `gsap`。缺省、旧值、大小写变体、重复值全部回退 Legacy。

普通 `next start` 没有上述请求上下文，即使环境变量设置了许可、Host 伪装为 localhost、URL 带 debug 或伪造许可/边界请求头，仍为 Legacy。客户端变量不参与服务端判定。

复用的是现有底层可信回环上下文，不是 P1.5-C 的质量许可策略。小川使用独立环境变量，不要求也不会授予 `NEXUS_QUALITY_PERMISSION`；不读取质量模式或主屏引擎参数授权。主屏 quality-permission、MotionDirector、MotionProvider 和 GsapTickerOwner 源码保持原样。

审计只在获批 GSAP 模式中再满足精确 `debug=1`，或处于服务端批准的专用审核页时注册。合法 GSAP 未启用调试时仍运行视觉编排，但没有全局审计入口。

专用 `/poc/xiaochuan` 额外要求 `XIAOCHUAN_POC_REVIEW=1` 和同一可信请求上下文，否则 404；其数据仍只来自仓内固定脱敏 fixture。原型导航增加 Legacy/GSAP 的 Next Link，专门验证软导航切换；链接不提供许可，也没有新增 API、控制命令或业务数据来源。

## 生命周期

- 动态 import 完成前卸载：取消标记阻止实例创建和审计注册。
- 卸载或模式/调试属性切换：移除 visibility listener，按函数身份比较删除本实例审计入口，dispose 本实例，再将闭包中的实例变量置为 null。
- 已保存的旧审计函数被撤销后返回 null，不再通过该闭包持有已销毁 controller。若新实例已注册，旧实例清理不会删除新函数。
- ScreenExperience 和审核页用模式/审计属性作为 OverlayStage 的 key，使路由变更时新旧实例边界明确。
- Timeline 继续只释放自身 tracks、host job 和 subscribers；销毁后拒绝新订阅及 visibility/reduced 更新，已从 host 队列取出的迟到回调也不能恢复任务或订阅。
- 不新增 ticker 的 sleep/wake/fps 调用；保留现有 host 的 scoped cancel 和 idle 安全检查。测试覆盖两个 host 共存时清理其中一个不会停止另一个。

关闭一次会话但 OverlayStage 仍待命时，保留一个 controller 是正常行为；本轮要求卸载后**没有审计函数**，不再通过残留函数读取已销毁实例。这里的闭包断引用与计数/绘制停止证据不等同于堆快照或强制 GC 验证。

## 修改文件

| 产品文件 | 修改 |
|---|---|
| `src/components/overlay/motion/permission.ts` | 新增严格模式选择，独立小川许可及审计条件 |
| `src/app/screen/sales/page.tsx` | 在服务端计算并传递小川模式/审计属性 |
| `src/app/poc/xiaochuan/page.tsx` | 固定 fixture 审核页增加可信请求隔离与服务端选择 |
| `src/app/poc/xiaochuan/review.tsx` | 传递审核选择及按模式重新挂载；增加仅本地审核页的切换导航 |
| `src/components/screen/ScreenExperience.tsx` | 传递服务端属性及模式/审计 key |
| `src/components/overlay/OverlayStage.tsx` | 将服务端属性接入 Hook；其余主体未改 |
| `src/components/overlay/motion/useXiaochuanMotion.ts` | 移除客户端 URL 自授权，限制审计注册并清理闭包 |
| `src/components/overlay/motion/XiaochuanTimeline.ts` | 销毁后拒绝订阅和状态更新；编排段未改 |

验证文件：`permission.test.ts`、`useXiaochuanMotion.test.ts`、`XiaochuanTimeline.test.ts`、`GsapTickerOwner.test.ts`；`e2e/p1-6.config.ts`、`e2e/p1-6.spec.ts`、新增 `e2e/p1-6-1.config.ts`、`e2e/p1-6-1.spec.ts`、`e2e/p1-6-1-regression.config.ts`、`e2e/xiaochuan-test.ts`；`e2e/audio-test.ts`、`e2e/voice-cards.spec.ts`、`e2e/p1-3.spec.ts` 仅接入可选双模式测试 fixture；`playwright.config.ts` 排除需要专用服务器的新专项；`scripts/p1-6-1-evidence.mjs` 生成源码一致性和结果摘要。

本目录包含报告、失败日志、回归 JSON、几何记录、截图及视频等交付资料。[changed-files.txt](changed-files.txt) 列出全部源码/测试/资料文件；[artifact-manifest.json](artifact-manifest.json) 记录本目录各证据文件的 SHA-256。

## 测试与失败历史

完整结果以 [验证摘要](evidence/validation-summary.json) 和原始日志为准。

| 检查 | 结果 / 证据 |
|---|---|
| 全量单测 | 58 文件、738 项通过：[日志](evidence/unit-all.txt) |
| TypeScript / 生产构建 | [类型检查](evidence/typecheck.txt)、[构建](evidence/build.txt) |
| lint | 0 错误、2 条未改文件的既有警告：[日志](evidence/lint.txt) |
| P1.6 原有专项 | 16/16 通过，Legacy/GSAP、四尺寸、真实中文 PCM、打断/追问、异常音频、隐藏恢复/导航、P1.3 模板、共享 ticker：[首次完整报告](evidence/browser-initial.json)中的 `p1-6.spec.ts` |
| 权限及路由/模式切换 | 7/7 通过：[复验报告](evidence/browser-hardening.json)、[日志](evidence/browser-hardening.txt) |
| Legacy 扩展回归 | 144/144 通过、0 跳过：[报告](evidence/legacy-regression.json)、[日志](evidence/legacy-regression.txt) |
| Legacy 多屏模式覆盖复验 | 2/2 通过：[报告](evidence/legacy-context-recheck.json)、[日志](evidence/legacy-context-recheck.txt) |
| GSAP 扩展回归 | 142/144 通过、2 失败、0 跳过：[报告](evidence/gsap-regression.json)、[日志](evidence/gsap-regression.txt)。失败未被删除，后续来源对照见下文 |

新增失败验证先在未修复源码上执行。最初 effect 测试没有等动态 import 完成，产生测试时序问题，保留为 [red-unit.txt](evidence/red-unit.txt)。将等待改为 Vitest 的 dynamicImportSettled 后，得到可解释的 5 个失败：URL 自行启用、非调试审计注册、卸载入口残留、旧审计仍能访问已销毁实例、销毁后接受订阅；见 [red-unit-settled.txt](evidence/red-unit-settled.txt)。修复后针对性测试通过；之后补充迟到 job 回调测试，并纳入 738 项全量结果。

第一次构建暴露新增测试中异构请求头数组的 TypeScript 类型错误，已修复类型标注；保留 [原日志](evidence/build-initial-type-error.txt)。没有修改产品断言。

首次浏览器完整轮次 20 通过、3 失败、0 跳过。3 项失败来自新增权限测试解析器误读 Next 路由树中回显的 URL 参数：实际组件属性已是 Legacy/audit=false。解析器改为读取相邻的服务端模式/审计属性后，同样权限断言 7/7 通过。首次 [JSON](evidence/browser-initial.json) / [日志](evidence/browser-initial.txt) 与修复后 [JSON](evidence/browser-hardening.json) 均保留；没有把首次失败报告覆盖成通过。

双模式回归的选择器在完整 Legacy 轮次后由 page.route 扩展为 context.route，让多屏测试中新建的第二页面也使用被测模式。模式结果按每个导航响应的真实服务端属性核验。Legacy 多屏两项随后定点复验通过；完整 GSAP 轮次使用覆盖所有页面的新选择器。既有业务、几何、音频断言没有改动。

### GSAP 扩展回归的两项未闭环问题

完整轮次保留 142 通过、2 失败，不把后续对照改写成 144 通过。失败上下文和 trace 已归档到 [gsap-failures](evidence/gsap-failures/)。

1. `overlay RAF callback CPU increment stays within 8ms at both resolutions`：完整轮次测得 P95 增量约 9.1ms，上限仍为 8ms。来源版独立构建同断言在 1280×720 测得约 9.4ms；1920×1080 约 3.2ms。见 [来源报告](evidence/baseline-cpu.json)、[原始样本](evidence/baseline-cpu-samples.json)。未调粒子、缓动、DPR、ticker cap 或预算断言。
2. `normal motion live region never announces a partial sentence`：该用例使用没有 PCM speech 元数据的 live fixture，要求先发布第一句、再发布第二句。P1.6 `AnswerCard.tsx` 中 `motion && liveAudio` 会让 typed 直接成为全文长度，从而一次写入两句。来源提交和本轮均失败于相同文本断言；见 [来源报告](evidence/baseline-live.json)。实际 PCM 播放/句段高亮/打断/追问的其他用例通过，不能因此把此无障碍兼容性失败隐去。

来源复现另建本轮专用 detached 工作区 `/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-6-1-baseline`，HEAD 精确为 `1c09242cfb7c8a51fd34d687e67c24f475135372`，`src/`、package 和锁文件均无 diff；只调整测试 import、加入 URL 选择器和执行配置，[记录](evidence/baseline-reproduction.json)、[fixture](baseline-harness/fixture.ts.txt)、[config](baseline-harness/config.ts.txt)。原始来源工作区未被改动。基线对照装置保留在该独立工作区，未提交。

基线适配第一次只用 route.continue 改写服务端请求，浏览器 window.location 未改变，因此来源版实际没有启用 GSAP；装置的审计入口自检将其判为失败，此两次数据不参与模式对照。保留 [CPU 初次装置记录](evidence/baseline-cpu-url-harness-initial.json)、[读屏初次装置记录](evidence/baseline-live-url-harness-initial.json)。随后在 hydration 前补齐浏览器 URL，并通过原审计函数存在性验证 GSAP 实际启用，再得到上述有效来源失败证据。

本轮的行为保持要求与这两项历史断言存在未解决的兼容性问题。改变 live 无障碍发布方式或视觉采样/性能路径超出 A/B 收口范围，留待架构审核决定；本轮没有通过放宽断言、删除用例或改写历史来取得通过。

修复版隔离复测仍复现相同两项：[CPU](evidence/gsap-cpu-recheck.json) / [样本](evidence/gsap-cpu-recheck-samples.json)，1920×1080 增量约 3.2ms、1280×720 约 9.6ms；[逐句读屏](evidence/gsap-live-recheck.json)仍收到全文。上述数字为现有测试测量口径，不是 GPU 时间或现场验收。本轮没有将两项失败当成偶发重跑通过。

## 与 P1.6 的行为对照

[逐文件及局部源码 SHA-256](evidence/behavior-source-equivalence.json) 校验 79 个受保护源码文件完全相同；另校验 XiaochuanTimeline 的 answer/fold/takeover/close/exit/caption/presence/geometry 编排段、OverlayStage 从 rootRef 开始的整个视觉/语音主体完全相同。粒子数量、缓动、视觉时序、卡片布局、语音 reducer、ASR/TTS 和 PCM 调度均未修改。

[P1.3 双模式几何对照](evidence/p13-comparison.json)：Legacy/GSAP 各 116 份原始几何记录，越界/碰撞和文字检查均为 0 个问题；所有记录中的矩形 x/y/width/height 逐值比较，差异为 0，未额外引入验收容差。原始数据分别在 [Legacy](evidence/legacy-p13/) 和 [GSAP](evidence/gsap-p13/)；完整截图留在本工作区忽略目录 `.review/p1-6-1/{legacy,gsap}-p13`。

[对照记录](evidence/p16-comparison.json) 使用来源提交中已有 P1.6 证据与本轮同场景新录制对照。两模式均记录了相同的 playback.started/drained 顺序、正常句段高亮、真实音频输出能量、打断停止 source 及再次回答。首轮 PCM 入队：P1.6 Legacy/GSAP 约 48.6/47.6ms，本轮约 52.7/63.0ms；排定声音时间线起点分别约 198.6/197.6ms 与 202.7/213.0ms。这些是不同轮次的短样本，不能视为响应时间 SLA 或统计显著性结论；实现参数和调用链保持不变，动画仍不阻塞音频。

新录制和原始样本位于 [p16/media](p16/media/) 与 [p16/evidence](p16/evidence/)，原 P1.6 资料未改写。审核可查看 [Legacy 视频](p16/media/legacy-interaction.webm)、[GSAP 视频](p16/media/gsap-interaction.webm) 和对应 browser-audio.webm 声轨；未将后处理声轨冒充物理扬声器录音。

本轮主屏专项为了取得受保护的审计入口显式加了 `debug=1`，因此截图右下角会出现主屏已有的调试框；这是测试输入差异，不是新增产品视觉。调试框中的 Legacy/GSAP 标识属于主屏引擎，小川模式另由服务端属性和专属 audit 核验。来源和本轮截图采集时刻、计数动画进度也有差异，未将这些截图当作逐像素一致或性能等价证明。

测试仅使用本地脱敏 fixture。页面隐藏测试模拟 document.hidden/visibilitychange；没有将其当成系统休眠或实际后台音频策略验收。本轮不重新宣称 Metal、真实 4K LED、物理麦克风、人声 barge、现场听感或全天稳定性已验收。

## 复现与回滚

```sh
pnpm install --frozen-lockfile --offline
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm lint
pnpm exec playwright test --config e2e/p1-6-1.config.ts
P161_OVERLAY_MODE=legacy pnpm exec playwright test --config e2e/p1-6-1-regression.config.ts
P161_OVERLAY_MODE=gsap pnpm exec playwright test --config e2e/p1-6-1-regression.config.ts
node scripts/p1-6-1-evidence.mjs
git diff --check
```

测试自动启动并关闭 fixture 3199、测试服务器 3066–3069，服务器不复用；两个音频回归轮次串行执行。未启用 silentAudio 替换物理输出策略。

紧急回退 GSAP 实验：移除服务进程的 `XIAOCHUAN_MOTION_PERMISSION` 后重启，本轮实现会安全选择 Legacy；审核页可另外移除 `XIAOCHUAN_POC_REVIEW`。完整代码回滚：在本施工分支对最终交付提交执行 `git revert <交付SHA>`；若只是查看原版，直接打开保留的来源工作区。不 reset、不覆盖、不清理其他工作区。

完整代码 revert 也会恢复 P1.6 原有的 URL 入口和审计残留行为，因此只需要停用实验时应优先撤销服务端许可。

源代码和测试的精确差异见 [code-diff.patch](code-diff.patch)；含报告与二进制证据的完整交付差异使用 `git show --binary --format=fuller <交付SHA>`。修改文件明细及证据摘要见交付目录内的清单。最终提交后停止，等待架构审核。

`code-diff.patch` 使用 `--unified=0`，避免将上下文空白当作新资料文件的行尾空白；在来源提交上复现应用需用 `git apply --unidiff-zero`。
