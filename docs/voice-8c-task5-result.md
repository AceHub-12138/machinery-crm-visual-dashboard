# 8c Task 5：浏览器 PCM 播放与状态同步交付

> 本文记录 `232bc85` 的原始交付结果。Claude 复核后发现 3 个中优先级问题及 1 个遗漏的容量泄漏问题，修复及最新验证见 [Task 5 审核修复报告](./voice-8c-task5-repair-result.md)。下述原报告中的 Esc/顶替 E2E 仅覆盖操作、停播及 DOM 退场，未直接断言 hub 退场或浏览器 fetch 取消；本次修复批已补强。上轮要求补修的 voice-local 容量泄漏与首包延迟拆解此前遗漏说明，前者在修复批处理，后者明确留给 Task 6。

- 日期：2026-10-07（施工于10月6日开始）。
- 仓库：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard`。
- 施工分支：`codex/voice-8c-task5-playback`，起点 `ea888fb`（Task 1–4 修复批）。
- 状态：本地开发与验证完成，待 Claude 复核；未合并、未推送、未部署。没有修改数据库或本机模型配置。

## 行为与实现

| 项目 | 结果 |
| --- | --- |
| PCM 播放 | 独立 `src/lib/voice/pcm-player.ts`；s16le/24kHz/mono转换为float32 AudioBuffer，共用AudioContext时间轴。首块预缓冲150ms，50ms音频块首尾排程；读到奇数字节保留半样本，不丢数据。 |
| 顺序与预取 | 当前句开始排程后预取下一句；按句消费、连续播放；总下载上限8MiB。网络迟到时从新的可播放时刻继续，不把“下载完”当“播完”。 |
| 振幅与高亮 | 所有音频经过同一AnalyserNode；live粒子使用RMS，demo仍使用模拟振幅。句子高亮由AudioContext.currentTime达到首样本排程时间触发；卡片数字、文字和读法保持原口径。`JarvisCore.tsx`零改动。 |
| 播完再追问 | 全部句子流EOF且音频时钟达到最后一块结束时刻后才回报`playback.drained`。普通回答由hub进入followup，再开始3秒倒计时；告别播完退场。浏览器同步hub，不按打字速度抢先追问。 |
| 首音回报 | `playback.started`仅首句开始播放时发送；`playbackStartMs`记录hub从提问到收到该回报的耗时，包含回传网络耗时。不同机器时钟不混算。 |
| 顶替/退出/断链 | abort下载、立即stop/disconnect排程音源；旧轮回报不影响新轮。强制关闭与普通播放失败/超时取消服务端合成；正常播完和正常追问超时保留音频缓存。 |
| 异常与兜底 | 格式非法、半样本残留、空音频、HTTP异常、断流和自动播放受限均显示提示并保留卡片，不伪装成成功播完。合成失败/截断在发头前返回503，发200后断开body。音频挂起使用预计时长×2＋2秒兜底；覆盖层另留2秒保障。 |
| 自动播放 | 首次唤醒/点击/键盘尝试resume；普通浏览器被拦截会提示点击，下次回答可恢复。`scripts/start-voice-kiosk.sh`带`--autoplay-policy=no-user-gesture-required`。未实际开启展厅Kiosk或麦克风授权。 |
| 安全边界 | 播放回报仅screen角色、当前answering轮有效；console/unknown/旧轮及重复终态忽略。screen仍不能提问、唤醒或强制关闭；音频仍走Bearer与Origin校验，WS不传二进制。 |
| Trace | 合成完成与播放终态都确定后每轮仅追加一条最终JSONL，包含播放首音/结果和TTS重试/失败指标。取消、失败、无回报兜底均有结果；对话台及报告脚本同步展示。 |

普通回答的兜底时长用归一化文本的合成上限：0.4秒/字＋1.5秒/句，再×2＋2秒；告别用已缓存PCM的实际时长×2＋2秒。没有降低静音阈值或修改合成策略。

联调额外发现并修复原有覆盖层退出缺陷：`CLOSED→ambient`会清掉状态计时器，也清掉原本负责卸载覆盖层的淡出计时器。现在淡出由独立phase effect管理，避免透明覆盖层残留；测试明确检查DOM卸载与1920×1080基线几何恢复。

## 自动验证

- TypeScript/Vitest：**341/341**，包括16项播放器测试、20项音频/编排测试，以及增量协议快照。
- Python语音服务：**12/12**回归通过。
- Chromium E2E：**10/10**；真实hub、Bearer/CORS HTTP、AudioContext/Analyser，只将GPU换成确定性PCM。覆盖多句高亮、8秒长音频不抢先追问、告别零新合成、顶替停播、音频失败、Esc、断链重连、suspended AudioContext故障注入及点击恢复；包含原4项大屏基线/隐私回归。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build`通过，`git diff --check`通过。
- 本机自动化工具会为页面附加用户激活，无法可靠复现原生自动播放拦截；该异常用挂起真实AudioContext、阻止resume直到点击的故障注入验证。原生权限行为仍需展厅浏览器核对。
- 人工检查两张Chromium截图：第一句与第二句分别高亮，粒子/答案卡布局正常。截图为自动生成的测试产物，位于忽略的`test-results/`；不是人工听感验收。

## 真实模型与浏览器联测

独立临时voice-local端口18810、临时hub随机回环端口、临时Next端口18815；分类使用本机已加载模型，TTS和ASR模型预热常驻。未修改/停止原服务。公开fixture输入对话台8题＋“谢谢，没有了”，由真实分类模型与TTS生成，Chromium完整消费播放。

- **9/9轮完整播完**；分类/卡片显示一致，振幅均非零。
- 所有流EOF和末样本结束后才回报耗尽；9轮音频块的最大排程间隙均为**0ms**。
- 音频时长2.56–10.40秒；失败0、截断0。8条普通问题中1轮发送前静音重生成成功；告别取缓存，不触发新的GPU合成。
- 8条普通问题的“提问→hub收到首音回报”：P50 **1069.5ms**，P95 **1268.2ms**；告别767ms。只有8条普通问题，属于接线联测，不作为分布验收样本。
- 联测中编排侧TTS首包P50约405.4ms，较单服务直测更高；不得以单服务结果替代浏览器链路结果。Task 6需在接入ASR后重新测L1并检查同机模型调度预算。

数据：`docs/voice-8c-task5-browser-calibration.json`；可复跑 `node --experimental-strip-types scripts/voice-playback-check.mjs`（真实模型ID通过环境变量提供，先build并启动voice-local）。脚本创建隔离回环服务，输出不包含模型ID、参考材料或凭证。

为检查联测小样本中1次重生成是否持续异常，追加30轮voice-local热状态直测，包含重试与独立ASR回环：

- 首包P50 **304.35ms**、P95 **374.53ms**、最大580.9ms；满足P50≤350/P95≤600ms。
- 重生成**1/30（3.3%）**；失败0、截断0，回环CER均为0。仍维持静音阈值0.001、0.4秒/字＋1.5秒策略。
- 流中/预填充取消至worker结束28.6–42.0ms。
- 数据：`docs/voice-8c-task5-direct-calibration.json`。本测量是单服务指标，不能替代麦克风、浏览器与音箱整机验收。

## 留给 Task 6 的边界

- 当前问题仍由文字对话台输入；没有接麦克风、VAD/ASR上行或唤醒检测。
- wake/followup/fallback/unheard固定缓存接口保持可用，其提示播放与开麦等待300ms将在收音阶段接线；Task 5本批播放器消费回答及告别音频。
- **L1/L2未验收**：必须接入VAD后，至少20轮、三个模型常驻条件下测VAD结束→首样本播放；现场人工确认音箱听感、逐句高亮与余音抑制。当前headless浏览器验证的是Web Audio时间轴，未人工试听物理音箱。
- HTTPS/跨机展厅部署留在后续任务，本批只新增Kiosk启动脚本，未部署。

实现依据：[Web Audio AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)的排程时间轴。以上结论以本仓单测、Chromium联调和随附真实模型数据为证据。
