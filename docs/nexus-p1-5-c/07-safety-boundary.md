# P1.5-C 最终安全边界补强

基线：`b3d5c1133e5809e272529d5b2c6cff8595f1d3d6`。施工分支：`codex/nexus-p1-5-c-safety-boundary`。

本批只修复本地实验授权路径，补充拒绝测试及启动工具兼容。重校准延迟方案在下文提出，未修改动画时序。原 `b3d5c11` 工作区、审核包、测试结果和失败历史保留不动；本轮使用独立工作区及独立结果目录。

## 安全问题与修复

基线把回环形式的 HTTP Host 当成网络边界。真实 HTTP 复现得到：普通 Next 服务设置 `local-candidate` 后，携带 `Host: localhost` 的实验请求返回 `qualityMode=candidate`、`manualQualityAllowed=true`。新增拒绝断言在基线失败，失败记录保留；不是用放宽旧断言取得通过。

现在必须同时满足：

1. 进程使用专用 `scripts/p1-5-c/local-server.mjs` 启动，固定监听 `127.0.0.1`；不接受 hostname 参数，不以环境中的 HOSTNAME 自证安全。
2. 每个原始请求的实际 listener 地址、socket 本地地址和对端地址都为回环；listener 端口为有效数值并与 socket 本地端口一致。地址、端口缺失或不能核对时拒绝。
3. 进入 Next 之前检查原始头：Forwarded、Via、X-Forwarded-*、X-Real-IP、Proxy-Connection 及伪造 X-Nexus-Quality-* 头均拒绝实验。Next 后续自行填充的转发默认值不作为可信来源，也不误判合法直接请求。
4. 启动器通过 AsyncLocalStorage 保存本请求的校验结果。只在服务端进程内安装只读 reader，入口使用 `server-only` 模块读取；不增加客户端 API、边界证明头、外部服务或持久密钥。
5. 原服务端许可、Host 附加过滤、debug 和模式参数仍须合法。`local-shadow` 不能开启 Candidate 或手动改档；旧 external、非法/多值参数和默认入口仍为 Baseline。

普通 `next start` 无请求上下文，许可环境变量和伪造 localhost Host 均不能放行 Candidate/Shadow 或手动改档。并发请求分别携带证明，不使用进程全局 true/false 开关；真实 Next 响应的并发正反请求用于检查授权是否串用。

### 适用范围

这证明的是受控测试服务的 TCP 回环边界，不是用户身份认证。禁止将本服务通过反向代理、端口转发或隧道公开。携带已知转发标识的请求会被拒绝；任意删掉全部标识的本机中继无法仅靠最终 TCP 连接辨识，不能据此宣称它适用于这种部署。未知网络边界、普通启动方式、未来框架环境无法传递上下文时均拒绝实验。生产灰度仍须另行授权设计。

## 重新校准的最小兼容提案（未施工）

现状调用链：resize/orientation/手动事件 → MotionProvider.recalibrate → sync → `setEnvironment(pageVisible=false)` → Director.stop/stable。它会立即结束当前 INTRO/PULSE，也会清理在途视觉调度。只延迟 `setCalibration()` 不能解决这个问题，因为结束共振发生得更早。

建议仅把**运行中的重新校准**改为排队，初始校准先保持现状：

1. ScreenStage 的现有 resize/fit 立即执行，保持新视口正确。固定逻辑画布和地图布局不等待刷新率测量，不把布局与校准绑成一个暂停动作。
2. MotionProvider 合并重新校准请求，只记录最新版本和首次排队时刻。连续 resize 不反复重置首次截止时刻，不为每次事件新增长期 RAF/计时器。
3. 由 Director 的既有时钟/稳定阶段通知消费请求；在 AMBIENT/DEGRADED、页面可见、小川不活跃、非 reduced motion 且没有正在执行的 probe 时，启动一次有限校准。把消费安排到当前 tick 完成之后，避免帧内重入 stop/draw。
4. 对持续的新 INTRO/PULSE 请求预留校准机会：建议累计 30 秒可活动时间后拒绝新的入场/共振，当前一段自然结束，再校准。加上当前最长 10 秒共振及 3 秒校准截止，正常可调度条件下预算约 43 秒；250ms 通知不是硬实时保证，仍需记录事件循环延迟。必要时只使用可取消的一次性截止提醒，不能增加长期时钟；若到期仍无法满足可校准条件，记录原因并退出实验回 Baseline，不为赶截止强行打断 cue。这是排队/退出预算提案，不是质量阈值改动，需架构确认。
5. 隐藏、小川接管、reduced motion 始终优先；中断有限校准、清除旧证据，恢复后重新消费请求。等待预算按可活动时间计算，不为满足截止强行唤醒动画。小川持续活跃期间允许等待，退出后在首个稳定机会处理。
6. 校准中再次 resize 只标记后续版本，不连续取消每一次有限采样；完成后检查版本并按需要再测。保留原自动保护和失败回退，不通过等待校准关闭保护或调低阈值。

该提案会改变实验模式下新入场/共振的接受时机，属于视觉调度变化；本批没有实施。当前文件哈希证明 MotionProvider、Director、渲染 hook、布局、策略参数和 GSAP ticker 所有者均未变化。初始校准是否也应让完整 INTRO 先结束，是单独的待审核项，不能默认延伸施工。

若批准，下一批至少验证：INTRO/PULSE resize 不因校准提前结束、布局同次 resize 即更新、连续 resize/重启入场不能无限推迟、排队/采样时小川接管、reduced motion、卸载及引擎切换取消、参考变化丢弃旧窗口且自动保护持续有效。不把方案说明当成这些新行为已经验收。

## 本轮验证

本轮结果记录于 [summary.json](evidence/safety-boundary/summary.json)。原有 evidence/manifest.json 是 b3d5c11 一轮的归档，应从该 Git 对象核对；本轮有独立的 [manifest.json](evidence/safety-boundary/manifest.json)。原有 196 项通用回归、30/10 分钟长稳和视觉视频属于 `b3d5c11` 历史证据；本批没有重跑它们，也不把旧结果写成本次通过。

| 范围 | 本轮状态 |
| --- | --- |
| 全项目单测（含策略/权限/socket/ticker） | 686 / 686，0 失败 |
| 普通 Next、伪造 Host、真实代理、请求并发、非法/旧 URL | 28 / 28，含无参数生产入口、实际本地转发代理及 20 个并发正反请求 |
| 原 P1.5-C 生命周期、真实 overlay 状态、30 次 GSAP 恢复 | 15 / 15；30 次恢复均保持单 RAF |
| 无许可入口 / P1.5-B 历史入口 | 5 / 5；3 / 3 |
| 原 GSAP PoC 8 项 | 8 / 8，原断言不变 |
| Legacy / GSAP 同套 63 项 | Legacy 63 / 63；GSAP 63 / 63 |
| 构建 / 类型检查 / lint | 全部通过；lint 0 错误、2 条既有警告 |

原 `e2e/gsap-poc.spec.ts` 和生命周期断言保持原样。既有 P1.5-B 旧 trace 缺失及 P1.5-C 的恢复测量、探测饥饿失败历史不删除。新增 Host 缺口的基线失败另存本轮历史摘要；新测试失败也必须留存后再修正。

## 开启、关闭与回滚

本地 fixture 启动后，在本次工作区运行：

```sh
SCREEN_PLATFORM_URL=http://127.0.0.1:3199 SCREEN_PUBLIC_ID=fixture-only NEXUS_QUALITY_PERMISSION=local-candidate node scripts/p1-5-c/local-server.mjs --port 3071
```

访问回环 URL 的 `debug=1&qualityExperiment=candidate`；Shadow 用 shadow 参数，或仅授予 `local-shadow`。普通 `pnpm start` 不再是实验启动入口。关闭时点“回到 Baseline”，或移除许可、重启并完整刷新已有实验页面；不改用户数据或数据库。

代码回滚至 `b3d5c11` 时，仅在无 `NEXUS_QUALITY_PERMISSION` 的 Baseline 下运行。原工作区保留，可直接停止本工作区服务后返回原工作区，或从该 SHA 新建独立副本。不要在回滚版本重开实验；那会恢复已知 Host 判断缺口。不要对其它工作区执行 reset/clean。完整操作见 [02-operation.md](02-operation.md)。

本地提交完成后停止。未改 main，未推送、合并、部署、启用生产灰度或启动 Task 11。


## 精确差异与证据入口

- [全部修改文件](evidence/safety-boundary/changed-files.txt)
- [源码、测试和启动工具零上下文差异](evidence/safety-boundary/source.diff)，用于逐行审核；完整文件可从本地提交读取。
- [14 个受保护文件哈希](evidence/safety-boundary/source-invariants.json)
- [基线 Host 缺口失败摘要](evidence/safety-boundary/history/baseline-host-failure.json)
- [原基线工作区及测试结果未变](evidence/safety-boundary/baseline-preserved.json)
- [本轮证据与原始本地报告哈希](evidence/safety-boundary/manifest.json)

提交 SHA 在最终交付消息给出。可用 `git log --oneline b3d5c11..HEAD` 查看本次提交，用 `git diff b3d5c11..HEAD` 获取完整差异。没有修改本批之外的 main、原工作区或历史审核 ZIP。
