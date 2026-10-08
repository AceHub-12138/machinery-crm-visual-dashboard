# 语音交互改版修复批2：施工记录

本批功能施工已完成，等待Claude复核和完整真人验收；基线 `codex/voice-8c-task6-7-10` @ `04edf6f`。按Claude的桌面修复文件及Codex施工方案执行。保留当前v6任务书、架构文档、next-env及设计文件原有修改，不合并、不推送，Mac保持开机。

## Step 0：Mac物理回声预实验

用户确认原KZ设备是耳机，并授权本次改用Mac Studio扬声器播放、KZ耳机麦克风收音，允许无人说话实验。只选择独立实验AudioContext/audio元素的输出设备，未更改系统默认设备、正式大屏或产品播放实现。

实验入口：`scripts/voice-echo-check.mjs`、`scripts/voice-echo-browser.ts`。使用已预热的voice-local按default风格合成10条答案，A/B两条路径播放完全相同的PCM；本地原生麦克风→AudioWorklet→Silero，未注入虚假麦克风数据、未保存或上传麦克风录音。只保存设备设置、计数及能量摘要。

| 路径 | 答案数 / 音频时长 | SpeechStart / SpeechRealStart | 让声 / 确认暂停候选 | 收音帧 | 程序门槛 |
| --- | --- | --- | --- | --- | --- |
| A：PcmPlayer AudioContext直出 | 10 / 79.2秒 | 0 / 0 | 0 / 0 | 2747 | 通过 |
| B：MediaStreamDestination→audio元素 | 10 / 79.2秒 | 0 / 0 | 0 / 0 | 2746 | 通过 |

实际输入 `KZ Acoustics M2`，实际输出 `Mac Studio扬声器 (Built-in)`；输入48000Hz/mono，浏览器报告AEC、降噪和AGC都启用。两条路径每帧处理排队最高1帧，无采集积压。VAD正阈值0.8、最短300ms、确认500ms。

让声按SpeechStart候选在80ms内降到0.2，确认按累计语音帧计；本预实验只统计“将会暂停”的确认次数，不真正暂停整轮，以保持完整外放暴露时间。由于所有答案均未触发候选，实际全程正常音量播放。音频时长为实测79.2秒，不以规格“约100秒”替代记录。

逐轮证据：`docs/voice-8c-interaction-echo-step0.json`。原始JSON的passed只表示当轮程序计数，不代表Step0验收。用户复核明确判定**Step0暂不通过**：必须补关AEC拾音证据、真人打断阳性对照和5秒底噪。原0次结果不得单独证明AEC有效，也不得据此进入ASR插队。未验证B路径的暂停/尾音行为，不用它作为正式播放方案。

Windows展厅配置仍须Task9复测。这组安静回声实验也不证明真实用户打断成功率或延迟。

## Step 0首轮时的历史状态

已完成独立Step0工具和首轮A/B实测；按用户新要求补三组配对复测。ASR优先调度、产品打断闭环、8秒/5秒窗口、倒计时和新交互验收尚未施工。正式大屏仍运行 `04edf6f` 的原交互。

独立工具通过 `tsc --noEmit` 和定向ESLint检查，日志分别为 `/tmp/voice-interaction-step0-tsc-final.log`、`/tmp/voice-interaction-step0-lint-final.log`；真实实验进程正常退出。原任务书、架构文档及next-env文件哈希核对不变。本机voice-local仍warm/selfCheck=passed，编排连接1个正式大屏，3015页面返回200。尚未创建本批提交。

复测命令（先确认真实外放与安静条件）：

```bash
node --experimental-strip-types scripts/voice-echo-check.mjs --run
```

实验默认将新一轮结果保存到带时间标识的忽略日志目录，不覆盖已交付的首轮证据。只监听回环地址，使用本地模型与站点本地VAD资源；浏览器只申请麦克风权限，不设置虚假媒体设备。

## 用户补充的三组验证（2026-10-07）

实际摆位描述：“耳机麦克风就在我面前，在Mac的旁边”。尚未量距，也未证明符合屏幕前0.5–1米布置，按**非展厅摆位**记录，不替代桌面/USB麦克风的展厅验收。

新版工具先用同一摆位、同一输出路径和同一组PCM重新做AEC开无人声10次，再关闭AEC、降噪、AGC做前三条答案3次配对对照；之后才开放AEC开真人5次。每次播放前采集5秒安静底噪，逐帧RMS/峰值、dBFS、最大值/中位数、VAD事件、处理帧数均写入JSON；不保存原始麦克风PCM。每条合成PCM记录SHA256，确保开/关对照完全一致。

- 无人声：确认0次、让声≤2次，采集/队列正常。
- 关AEC：完成3条相同PCM的有效配对，整组有SpeechStart或显著增益证据即满足拾音阳性对照；逐条增益仍全部保留。避免两个很小的底噪相差20dB被误判，工具将≤-55dBFS视为“约-60dBFS及以下的弱信号”；无SpeechStart且仍在此区域时不自动通过，保留数值待复核摆位。
- 真人：各次由用户点击，先安静5秒，再在答案播放期间按绿色文字提示说问题；5次至少4次出现确认。按成功提问次数计分，一次里的重复确认不当作多个成功。
- 确认仍为0.8/300ms/500ms，未调整阈值；预实验统计检测确认候选，未接ASR、未实现正式暂停/续播。
- 前两组未通过即停止并保存原因，不开放后续ASR施工。前两组通过后等待真实用户完成5次，禁止用合成注入代替真人。

新版工具类型检查、定向Lint和4项判定单测通过（`/tmp/voice-echo-controls-{tsc,lint,unit}.log`）。判定聚合修正后同样通过，日志后缀为 `tsc2/lint2/unit2`。结果追加如下，不覆盖首轮证据。

### 新摆位安静组与关闭AEC对照结果

安静AEC开10次全部0候选、0确认；每次底噪约156帧，5秒完整采集且无SpeechRealStart。关AEC/降噪/AGC的3条配对结果：

| 答案 | AEC开最大RMS dBFS | AEC关最大RMS dBFS | 差值dB | AEC关SpeechStart / 确认 |
| --- | --- | --- | --- | --- |
| 1 | -56.32 | -48.61 | +7.71 | 0 / 0 |
| 2 | -36.42 | -52.47 | -16.06 | 1 / 1 |
| 3 | -25.99 | -50.01 | -24.02 | 1 / 1 |

没有任何一条达到+20dB，**不宣称增益门槛通过**。按用户“或者能看到SpeechStart”的口径，3条里2条有VAD语音与确认事件，底噪期间0语音，提供整组拾音阳性证据。AEC开窗口中还出现过很高的瞬时峰值，不能未经分析当作持续音箱音量或排除来源，数值全部保留。

工具首版误将“整组三条取证”实现为“三条逐条全部过线”，因此自动停止，原始 `blocked-controls` 记录保留为 `docs/voice-8c-interaction-echo-controls-first.json`。修正的是判定聚合，不改原数据、dB门槛或VAD阈值；新测试引用前序证据文件SHA256并记录纠正原因。没有重新生成或替换开/关两组的配对数据。

真人组完成：5次问题全部出现SpeechStart、SpeechRealStart及确认事件，成功 **5/5**。最大RMS分别为-13.94、-14.66、-15.88、-13.11、-14.48dBFS；各次5秒底噪均完整、无SpeechRealStart。三组达到本机门槛，允许进入ASR插队。当前摆位仍是非展厅摆位，未测距离，不宣称展厅通过。

最终证据：`docs/voice-8c-interaction-echo-controls-human-first.json`，内含三组数据、前序文件SHA256、判定聚合修正原因和5次真人结果。日志 `/tmp/voice-echo-controls-human-first.log`；实验浏览器/回环服务器已正常退出，正式大屏未改动。确认的是检测阳性，不是实际打断暂停/ASR回答；后两项属于随后施工与验收。

## Step 1：单GPU线程ASR优先调度

新增协作优先队列，在TTS采样及PCM输出检查点执行待识别ASR，再回到原TTS生成器；仍只有一个GPU线程。ASR/TTS取消对象分离，任务异常、排队取消和关闭不遗留future。返回并记录asrQueueMs，另记interleavedTts，验证识别确实发生在合成内。不可中断的预填充/kernel不宣称可强抢占。

真模型10次全部在TTS进行中执行ASR：排队P50 **19.65ms**、P95 **24.165ms**；ASR执行约184–193ms。10轮TTS均完整、0失败、0截断、0重生成。原始 `docs/voice-8c-asr-priority-calibration.json`；脚本 `scripts/voice-asr-priority-check.mjs`；日志 `/tmp/voice-asr-priority-real.log`。使用合成WAV测队列，不作为真人交互或展厅延迟验收。

24项Python测试、406项TS测试、tsc、Lint和production build通过。日志 `/tmp/voice-asr-priority-python3.log`、`/tmp/voice-asr-priority-ts-tests.log`、`/tmp/voice-asr-priority-tsc.log`、`/tmp/voice-asr-priority-full-lint.log`、`/tmp/voice-asr-priority-build.log`。重启本机voice-local加载新实现，7种风格自检均通过，未改模型/参考/阈值。Stage0本地提交 `0cf0ecb`；未合并、未推送。

以上为Step 1阶段记录；后续打断与长短窗已在本批接通，最新状态见下文。

## Step 2–3：播放器打断与长短聆听窗口

完成以下正式交互：

- 答案真正耗尽后即进入followup，连续采集；尾音保护期保留barge，随后vad实际ready开启8秒长窗。长窗静默才播追问；提示播完、vad就绪开启5秒短窗，继续静默播warm的idle_exit后退出。
- 普通答案、wake、followup、unheard、idle_exit可打断；goodbye、fallback及thinking不收音。候选SpeechStart将增益降到0.2，累计500ms语音确认后挂起原生AudioContext；保持源节点、PCM、句边界。300ms以下误触发不上传ASR；300–500ms候选未达到暂停资格也恢复原播放。
- 播放器、编排播放期限及覆盖层播放看门狗冻结／按剩余预算恢复。说话最长16秒、ASR判定另给6秒，从语音结束上传后计，不从暂停时计。
- Barge租约绑定所属屏、会话、当前音频轮；每次尝试使用UUID及实际播放句索引。旧尝试重放、跨屏、旧会话、并发判定均拒绝。有效问题才取消旧音频、接受新问题；无效／空识别／回声／超时续播，不增加unheard次数或业务提问额度。有效但受限则歉意提示后再听。
- 文本按NFKC、去标点、转小写后计算字符编辑相似度，分母为两者最大长度；与当前句及上一句任一相似度≥0.5则视为回声。新请求不额外落盘原始ASR文本或麦克风录音。
- barge↔vad及租约变化保留VAD段与500ms句首缓冲；只有会话边界、thinking／关闭等真实结束和被拒绝的尝试才重置。跨越最终样本的语音沿用原尝试。
- `input.open`／`input.progress`同步真实开启、剩余时间和暂停状态；浏览器从本机事件到达时刻推进，不相减异机时钟。提示播放隐藏倒计时；8秒长窗不会提前显示追问文字。局部暂停保留并调暗答案卡、核心呈聆听状态，没有新全局状态。
- 窗口／打断事件写入 `voice-trace.jsonl.interaction.jsonl`，保留一轮多次尝试及拒绝原因。原turn记录仍只追加一次。失败卡片独立保留至少8秒，无声安装与demo都有有界收尾。

## Step 4：验证与延迟证据

常规检查：420项TS单元／服务测试、24项Python测试、TypeScript、全仓ESLint和production build通过。浏览器完整语音回归26项通过；最终小改后再定向复测6项（含新增200ms短语音、尾音交界、暂停中Esc／断线、不可打断的告别／降级、连续长问题）。两批合计覆盖27个独立语音浏览器场景；不把重复执行计作新增场景。

实测采用仓库预录音注入MediaStream，经真实AudioWorklet、Silero、loopback HTTP、Qwen ASR、LM Studio分类、Qwen TTS与Web Audio时钟；音频输出图保持时钟但静音。包含约500ms VAD尾部静音和150ms预缓冲，不能等同真人拾音或展厅验证。测试LLM、参考音色及KWS门槛未改变。

| 组别 | 次数／接受数 | 让声P95 | 暂停P95 | 末音→新首音P95 | ASR排队P95 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 首组，与浏览器回归并行 | 10／10 | 67.9ms | 580.8ms | 1463.1ms | 45.8ms | 当组达标 |
| 第二组，与浏览器回归并行 | 10／10 | 80.3ms | 591.7ms | **1617.8ms** | 38.3ms | **延迟门槛未通过** |
| 回归结束后的单页对照 | 10／10 | 70.7ms | 583.9ms | **1450.3ms** | 41.4ms | 正常单页条件达标 |

第二组最慢一轮末音→首音1731.4ms，ASR执行321ms；常见ASR约190–210ms。第二组并行执行了浏览器回归，含额外VAD、KWS与多标签；顺序执行对照消除了这项测试负载，但不足以证明所有慢尾都由它导致，也不宣称高负载下稳定达标。不能删除失败轮、降低门槛或把计时起点移到SpeechEnd之后。

三组原始记录分别为 `voice-8c-barge-calibration-first.json`、`voice-8c-barge-calibration-parallel.json`、`voice-8c-barge-calibration.json`。最后一组另保留80条窗口／打断阶段事件、classifyMs／ttsFirstByteMs／预缓冲等分项。浏览器取消旧流时出现的ERR_INCOMPLETE_CHUNKED_ENCODING网络提示保留在原始errors中；所有10次旧轮均被取消，新轮首音实际排入Web Audio，未把取消提示当作ASR有效性证据。

验证日志：`/tmp/voice-redesign-unit8.log`、`/tmp/voice-redesign-python.log`、`/tmp/voice-redesign-tsc8.log`、`/tmp/voice-redesign-lint8.log`、`/tmp/voice-redesign-build-final2.log`、`/tmp/voice-redesign-e2e-final.log`、`/tmp/voice-redesign-e2e-target-final.log`。本地临时日志可能在重启后消失，核心数字与原始JSON已保存在仓库。

## 交付边界与真人测试

本机Step0物理回声门槛已通过（非展厅摆位）；ASR插队及单页打断延迟实测达标；交互功能自动检查通过。并行负载组延迟仍失败，完整真人问答与Windows展厅验收未通过／未执行，不将这些阶段混为“全部通过”。真人步骤见 `docs/voice-8c-interaction-human-checklist.md`。

本轮发现本机旧服务未运行，已按原本机配置恢复LM Studio 1234、voice-local 8810、编排3210与最新构建网页3015。voice-local七种风格warm/selfCheck=passed；编排开启原有TTS，数据源仍fixture，未修改平台或部署到服务器。默认系统音频设备未改，Step0的扬声器选择仅属于独立实验。

施工分支 `codex/voice-8c-task6-7-10`；已有Step0提交 `0cf0ecb`、Step1提交 `195b3c4`，本阶段单独本地提交。未合并、未推送、未部署。保留v6任务书、架构文档、next-env和设计目录原有修改，前三文件哈希检查一致。Mac保持开机，供Claude复核后完整真人测试。
