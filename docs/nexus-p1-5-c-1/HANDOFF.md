# P1.5-C.1 本地交付与架构审核材料

结论：运行中重新校准的延后机制已实现，本地工程回归通过。等待架构审核；未推送、未合并、未部署、未启用生产 Candidate。

基线：`b35b93c230fc6c084895a4119196779f505bf2fb`。分支：`codex/nexus-p1-5-c-1-deferred-recalibration`。工作树：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-c-1`。最终构建 ID：`jnd-N6QqrV0JPxo-ldtcQ`。本报告、源代码和证据在同一交付提交；精确提交 SHA 见最终答复或本分支 `git log -1 --format=%H`。

## 实现与精确 diff

[实现、测试、取证脚本的完整 Git diff](evidence/review.diff)。文档和媒体也随本提交保存，可用 `git diff --stat b35b93c230fc6c084895a4119196779f505bf2fb HEAD` 查看全部交付文件。

产品改动仅四个文件：

- `DeferredRecalibration.ts`：一份待处理请求，只保留最新版本、首次时间与活动预算；microtask 消费；30 秒预留、45 秒活动总期限；取消、过期结果丢弃及错误回退。
- `MotionDirector.ts`：提供稳定阶段的有限暂停与恢复，保留场景时间、航线状态和下一共振截止；接入请求仲裁和生命周期。当前 INTRO/PULSE 不因排队被截断。
- `MotionProvider.tsx`：首次启动校准完成后才接入运行中队列；resize/orientation/手动事件仅提交请求。回退 Baseline 后停止实验校准。保留原首次启动路径。
- `QualityPolicy.ts`：仅增加内部 `probeAllowed` 调度输入，预留阶段阻止新 probe；已有 probe 和降档保护继续采样。原质量阈值与 backoff 不变。

另有两份单测文件、浏览器专项和取证脚本。主屏美术、粒子数量、航线数据、语音状态机、Task 11、公屏/语音/ERP 数据契约、首次启动采样器及 GSAP ticker 所有者均未修改。[163 个输入的源码核对](evidence/source-invariants.json)，[逐文件 SHA-256](evidence/product-inputs.json)。

## 延后状态图与预算

[完整状态图、优先级及复现命令](README.md#状态与优先级)。

环境可活动时才累计预算；隐藏、小川接管、reduced motion 期间冻结预算。INTRO/PULSE 和实际有限采样时间计入活动预算。累计 30 秒后拒绝新入场/共振，当前 cue 和已有 probe 自然结束；45 秒活动总期限到期明确记录原因并回 Baseline。等待只设一个可取消的一次性期限提醒；测量复用原 30 个 RAF 间隔、3 秒截止，不引入长期 RAF 或轮询计时器。

实际测量只在 AMBIENT/DEGRADED、可见、小川不活跃、非 reduced motion、无 probe 时开始，并在当前 Director tick 退出后的 microtask 再核对条件。稳定场景时钟在有限测量期间暂停，恢复不补跳时间；不伪造页面隐藏，不调用场景重置。

## 修改前失败复现

原始基线由新隔离工作树在产品修改前构建并录制：[构建日志](evidence/baseline/build.txt)、[原始状态记录](evidence/baseline/report.json)。

| 场景 | Legacy | GSAP |
|---|---|---|
| INTRO 中 resize | 立即变成 AMBIENT/paused，入场提前结束 | 同样复现 |
| PULSE 中 resize | 立即变成 AMBIENT/paused，共振提前结束 | 同样复现 |
| 40 次连续 resize | 有限测量不断重启，停止事件后才恢复；此段之前已回退 Baseline，不能作为纯 Candidate 数据 | Candidate 中复现不断重启测量及延期 |

这里复现的是反复取消/重启测量和延后恢复，没有把它编造成已经观察到无限队列或内存泄漏。Legacy 已回退后的 Provider 仍响应 resize，也由本批修复。

## 最终自动检查

| 检查 | 结果 |
|---|---:|
| 类型检查、生产构建 | 通过 |
| 全量 Vitest | 54 文件，703/703 |
| 历史策略/指标/证据 Node 单测 | 31/31 |
| 本批时序、预算、版本、接管、生命周期、Baseline 专项 | 18/18 |
| 原生 1792×832 和实际 Candidate probe 互斥补验 | 4/4 |
| Legacy 原有专项回归 | 63/63 |
| GSAP 原有专项回归 | 63/63 |
| Candidate/Shadow 生命周期（含 GSAP 静态/恢复 30 轮） | 15/15 |
| loopback/伪造请求/代理/权限隔离 | 28/28 |
| 拒绝授权时的 URL 选择 | 5/5 |
| GSAP 功能与视觉专项 | 8/8 |
| lint | 0 错误，2 条既有警告 |

204 次通过的浏览器测试执行，包含原生布局补验的重复覆盖；全部结果均 `skipped=0 / unexpected=0 / flaky=0`。不把重复覆盖计作 204 个独立测试。[汇总](evidence/summary.json)，[最终结果与完整日志](evidence/checks/)，[全部执行历史，含失败后补跑](evidence/checks/runs.json)。

连续重启入场并请求重新校准时，第 32 版请求在 Legacy 31.703 秒、GSAP 31.687 秒活动时间完成，首次请求时间未重置。单测另验证 45 秒活动总期限，包括 Director RAF 意外停止时仍回退；原有限测量 3 秒无结果回退也在浏览器验证。

实际 Candidate probe 的浏览器补验通过：先等待已运行 probe 完成，再开始校准；采样中没有 `probe` 与 `measuring` 同时成立。有效参考变更清除旧窗口与策略证据；旧版本结果不写入新目标。

等待/实际测量两阶段都覆盖小川、隐藏、reduced motion；SPA 引擎切换和回 Baseline 清理旧队列。真实小川通过本地 WebSocket 驱动原覆盖层：接管时校准计时器归零，GSAP listener 归零；语音球本身仍有一个 RAF，与无校准的小川对照一致，未将其误判为泄漏。[各场景资源记录](evidence/runtime/)。

## 连续视频与动态视觉证据

每个视频连续包含运行中重启 INTRO、resize、完整 PULSE、resize、重复 resize；没有剪接。前两组有效修复视频在取证重试时保留，未重跑。8 组修复后视频全部保留 Candidate，页面错误为 0。

| 分辨率 | Legacy | GSAP |
|---|---|---|
| 修改前 1920×1080 | [连续视频](evidence/baseline/legacy-intro-pulse-resize.webm) | [连续视频](evidence/baseline/gsap-intro-pulse-resize.webm) |
| 修复后 1280×720 | [连续视频](evidence/fixed/legacy-1280-intro-pulse-resize.webm) | [连续视频](evidence/fixed/gsap-1280-intro-pulse-resize.webm) |
| 修复后 1792×832 | [连续视频](evidence/fixed/legacy-1792-intro-pulse-resize.webm) | [连续视频](evidence/fixed/gsap-1792-intro-pulse-resize.webm) |
| 修复后 1920×1080 | [连续视频](evidence/fixed/legacy-1920-intro-pulse-resize.webm) | [连续视频](evidence/fixed/gsap-1920-intro-pulse-resize.webm) |
| 修复后 3840×2160 | [连续视频](evidence/fixed/legacy-3840-intro-pulse-resize.webm) | [连续视频](evidence/fixed/gsap-3840-intro-pulse-resize.webm) |

环境：有界面的 Chromium、ANGLE Metal / Apple M1 Ultra，DPR=1；Legacy 不设额外实验帧率上限，GSAP 保留既有 60Hz cap。录像统一为 1280×720、25fps；1792×832 的灰色留边来自录制画布的宽高比。

已查看全部 8 张逐段抽帧图，未观察到校准触发的白闪、布局倒退或共振被撤掉。INTRO 显示进度单调，场景时钟单调，航线/地图/粒子画布/消息数量保持。PULSE 首个结束样本在 10,000.0–10,020.8ms 场景时间，未提前结束。[逐场景状态和构建指纹](evidence/fixed/report.json)、[解码信息与连续性检查](evidence/fixed/decoded.json)。各视频同目录有 `*-contact.png` 抽帧图及 resize 后原尺寸截图。

## 实验许可与 Baseline 等价范围

服务器授权边界文件逐字节未变；只有获批的本地 loopback 启动器加显式实验请求才进入 Candidate/Shadow。普通 Next、伪造 Host/边界头、转发代理、旧 external 参数、重复实验参数均不能获得生产控制权。默认 URL 继续 Baseline，未更改全局环境或生产配置。

以未修改基线工作树与本批构建配对运行，两引擎各 5 个检查点（INTRO、AMBIENT、PULSE、PULSE resize、结束）：场景状态、时钟、样式、数字、航线属性、质量记录与活动资源数量全部相同。[10 个检查点结果](evidence/baseline-equivalence/report.json)。默认 Baseline 不创建队列、不启动校准、不增加定时器。

像素比较没有冒充完全一致：原始动态截图最大差异 0.313%，最大通道差 26/255；另行关闭 CSS 动画的静态对照最大差异 0.068%，仍有少量局部渲染差异。保留原图及统计，不将剩余差异强行归因。[原始像素统计](evidence/baseline-equivalence/pixels.json)、[CSS 受控对照](evidence/baseline-equivalence-css/pixels.json)。上述等价结论指已测行为及源码边界，不是逐像素一致声明。

## 已知风险与回滚

1. 有限测量会使实验模式的稳定场景短暂停住，正常录像约 0.3–0.5 秒，测量上限 3 秒；不承诺校准阶段每帧都持续运动。当前 INTRO/PULSE 在此之前自然结束。
2. JavaScript 事件循环阻塞会延迟一次性期限回调；恢复后按实际活动时长核对，超预算回 Baseline。它不是硬实时调度器。
3. 原首次启动校准保持既有行为，不将本批运行中修复扩大为首次入场重设计。低于既有 52Hz 支持下限的参考仍回退 Baseline。
4. 25fps 视频、虚拟时钟和本机 Metal 证据不能证明显示器每次呈现均无掉帧，也不构成 LED/展厅、人机或生产验收；尚存上述非零像素差异供架构审核。

运行时回滚：删除 `qualityExperiment` 参数，或点击“回到 Baseline”，已验证会销毁旧调度器和计时器。服务级回滚：停止隔离测试服务，使用未修改的基线工作树/构建。代码级回滚：若后续采用本提交，可在审核分支 `git revert <本批提交SHA>`；本轮没有执行回滚，也没有改动主分支。

所有失败、取证脚本修正及一段未接受的中断录屏保存在 `evidence/history/`，不计入最终通过数据。源码和必要证据已本地提交后停止，等待架构审核。
