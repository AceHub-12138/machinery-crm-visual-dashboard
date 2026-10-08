# Voice 8c 打断修复批结果（P1＋P2）

2026-10-08。依据 Claude 的 `~/Desktop/voice-8c-barge-review.md`，用户确认施工方案后执行。本批仅修清单 1–10、10b；P3 的 11–15 留待后续。

## 分支与演示版本

- 代码提交：`dd9b010`（fix(voice): repair echo gating and reversible barge lifecycle）。报告与校准 JSON 单独做本地交付提交。
- 修复分支：`codex/voice-8c-barge-fix`，基线 `f1e05596539f2c0562ec090be257bbf7a12a7a12`。
- 独立工作目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-barge-fix`。
- 原演示目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard`，仍在 `codex/voice-8c-task6-7-10` / `f1e0559`。原有两个任务文档、`next-env.d.ts` 和 `docs/design/` 未提交改动保留在原目录。
- 本地保底 tag `demo-2026-10-09` 已创建，固定指向 `f1e0559`，未推送、未移动。
- 本批不合并、不推送、不部署，未替换演示服务，也未开始 Task 12／11／9。

## 修复与对应验证

| 清单 | 最终行为 | 主要验证 |
| --- | --- | --- |
| 1 | ASR 对任意播报子串做编辑距离对齐，以 ASR 长度归一化；当前、上、下句连成有序参考窗口，允许跨句匹配；对应片段没有的疑问成分强制判为新问题，保留问号 | 清单四个固定案例、完整句、跨句、低重合、疑问词出现在参考其他位置的反例；编排下一句／跨句回声拒绝；真模型 30 段／10 追问 |
| 2 | 独立 `pendingAttempt` 保存本轮打断结果身份；上传清空 `segment` 后仍能续播；新会话／新播放租约使旧身份失效 | HTTP 先到和 WS 结果先到两种顺序；重复、旧会话结果不影响新轮 |
| 3 | 普通 ASR 有有效文本后才限流记账；噪声不占额度；限流播 apologetic 没听清并重开聆听，不增加识别失败次数；打断限流先取消旧音频，客户端不先续播 | 噪声后最后一个有效额度；普通／打断限流后首个真识别失败不误退场；广播拒绝时旧音频已取消 |
| 4 | 尾音期使用当前普通租约和普通 VAD 门槛，不要求 500ms 打断确认；未达到确认时跨越播放结束的语音转交普通租约 | 真实 FrameProcessor 的 .6 概率／224ms 语音、独立 200ms 普通门槛测试；跨 drain 提交不带 attemptId |
| 5 | `clearBarge()` 恢复仍有效的全部冻结截止计时器，包括尝试期间新建者 | 普通尾音上传与旧打断报告交错，第二次没听清启动 idle_exit；不发 drain，新的 failFixed 截止仍能执行并回 ambient |
| 6 | SpeechStart 只保留语音段，SpeechRealStart 才让声／创建服务端尝试；128 次上限只阻止新打断，普通收音仍可提交 | 短噪声无让声、真实语音让声；第 129 次拒绝后普通提问成功；上限拒绝与 drain 交错仍提交当前普通租约 |
| 7 | 真正重置处理器时同步清空残留 segment；会话内 barge ↔ vad 切换不重置语音历史 | thinking 重置后下一句使用新租约；既有模式切换测试与浏览器跨尾音场景 |
| 8 | input.listen 普通窗口先置暂停满环，input.open 后按本地收到事件时刻推进；提示播放隐藏环 | params 满环／递减／暂停／隐藏测试；浏览器原有静默长短窗回归 |
| 9 | 接回 VOICE_LISTEN_TIMEOUT_MS，只影响普通 listening，默认 5000；追问仍是 8000／5000；协议解析接受有效的 1–60000ms 预算 | 配置、协议边界、2000ms 普通窗口和 8000ms 长窗单测；新增浏览器自定义窗口验证 |
| 10 | ListenWindow 的语音看门狗遇到重叠打断时，转交该尝试的拒绝／恢复，不关闭会话；没有打断的普通语音看门狗保留原有边界 | 无上传 16 秒超时；第 15 秒上传后、ASR 尚未完成时第 16 秒拒绝并保留长窗；窗口独立委托与剩余时间验证 |
| 10b | 倒计时计算移入 params.ts 的纯函数；JarvisCore 只向 coreVisual 传 listenClock | 相对 04edf6f 的 JarvisCore 差异仅多传一个输入参数，绘制、粒子、样式代码均未改动；params 单测、类型检查和构建 |

新增环境配置 `VOICE_VAD_MIN_SPEECH_MS`，默认 300ms；与 `VOICE_BARGE_MIN_SPEECH_MS` 独立。普通门槛未统一降低。尾音期现在会按实际启用的普通收音租约立即报告 ready。

## 验证结果

- TypeScript 单元／服务测试：33 个文件、453 项通过（基线 420 项，本批新增 33 项）。
- Python：24 项通过；voice-local 源码未修改。测试中的 self-check 失败日志来自预期的负向模拟用例；真实服务健康检查为 passed。
- 既有浏览器语音回归：27 项通过，包含真实 AudioWorklet／Silero、暂停／续播、跨尾音、短噪声、Esc／断线／重新唤醒、播放归属、PCM EOF／时钟、音频故障等。
- 新增浏览器验证：自定义 2 秒普通窗口、普通限流道歉后重新聆听，两项均通过；合计 29 个不同的语音场景。限流测试首次因预期缩略话术与固定话术不一致而失败，改为引用 FIXED_LINES.unheard 后复测通过，未因此修改产品话术。
- `pnpm exec tsc --noEmit`、全仓 ESLint、production build、`git diff --check` 通过。
- 浏览器用独立 18817 端口运行修复目录的 production build，不复用演示目录的 3015 服务。隔离配置保留在本地忽略目录 `.review/playwright.barge.config.ts`。
- 首次构建因目录外 node_modules 链接被 Turbopack 拒绝；使用锁文件从本机缓存安装独立依赖后恢复，未修改依赖版本或锁文件。

真模型指标：10 个合成答案，每个固定截取 3 段实际 PCM，再重采样送本机 ASR；30/30 段判为回声（要求 ≥28/30）。另外 10 条疑问追问经 TTS／ASR 后均保留疑问成分，0/10 被误判为回声。片段约 2.28–2.87 秒。

- 证据：`docs/voice-8c-barge-fix-echo-calibration.json`，含原文、固定裁切位置、音频摘要、ASR 文本、判定分数、参考风格哈希和 echo 源码哈希。
- 可复跑：`node --experimental-strip-types scripts/voice-barge-echo-check.mjs`。默认只连接回环 voice-local 8810，不录制真人麦克风、不外放。测试数字是明确标注的合成基准数据。
- 当次模型：Qwen3-TTS 1.7B Base / Qwen3-ASR 0.6B。测量时源代码尚未提交，JSON 的 commit 为基线 f1e0559；echoSourceSha256 锁定实际使用的修复算法。
- 测试后真实 voice-local：warm=true、selfCheck=passed、activeJobs=0、failedStyles=[]。

## 风格、范围与后续门槛

`~/voxlab/ref/styles_v1/cheerful.wav` 未修改、未重新生成。施工前后原文件 SHA256 均为 `12e98c0d9c48d3d3f2754fc461d854ac42a5f11fe4d3ce8062f4756be278b7ca`。

P3 五项均未施工：GPU 提交失败释放名额、已生成 PCM 块发送顺序、BaseException 捕获范围、完整准备／收尾阶段排队校准、HTTP 并发／断连测试。

本报告供 Claude 复查。Claude 复查通过后，用户仍须按 `~/Desktop/明日演示流程-小川语音.md` 第三节真人彩排；两项都通过才替换演示版本。本次不宣称真人、展厅／Windows、跨机部署或生产数据验收通过，也未重新测量并行负载下的打断首音 P95。

若修复版本尚未获准用于演示，继续使用原演示目录的 f1e0559。确需恢复已切换的服务时，先保留该目录未提交改动，再切回保底 tag 并按既有启动脚本重启；不要直接覆盖工作目录。
