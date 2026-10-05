# 语音对话模式「贾维斯」方案(v2)

- 状态:待评审
- 日期:2026-09-22(v2:交互形态改为「全屏接管 + 粒子中心输出答案卡」,否决 3D 场景库方向)
- 范围:展厅大屏 `/screen/sales` 的语音交互层。**常态视觉基线(step0 已冻结)不动**,对话期间大屏整体隐藏,粒子接管全屏,退场后复原。
- 前序:step5 大屏视觉集成、step6 配置台;本方案为下一阶段(step8)的完整设计。

> 变更记录:v1 为"地图退后 + 核心出现 + 悬浮答案卡";v2 采纳用户方向——唤醒后**大屏整体隐藏**,粒子特效接管全屏,回答时**从粒子中心输出答案卡**;v2 迭代中曾评估"裸眼3D 场景库"(Three.js/全屏 3D 内容),因开发量过大且团队无 3D 技能栈**明确否决**,列为非目标(见 §13)。

---

## 1 体验原则

1. **平时是仪表,召唤时是贾维斯**:常态 100% 保留工业基线(炭黑/铜色省图/黑体金额);唤醒后大屏整体隐入黑暗,粒子场接管全屏——形态切换本身是最大的科技感瞬间。
2. **铜色/琥珀 HUD**:粒子与答案卡配色与既有铜色地图同源,不引入青蓝色。
3. **核心投影输出**:回答不是"浮出来"的,是**从粒子中心发射出来**的——能量环脉冲、粒子束、卡片展开一气呵成,这是贾维斯电影感的本体。
4. **耳朵听结论,眼睛看卡片**:语音只说简短结论,数字与图表看答案卡;卡内金额黑体、锐利、不透视。
5. **生命感反馈**:聆听/思考/播报/待命/退场每个状态都有呼吸与过渡,全程无硬切。
6. **只读红线**:语音系统只能读,不能写;所有数字必须来自工具返回值。
7. **零 3D、零新依赖**:Canvas 2D + CSS/SVG 实现全部效果,栈内现有技能可维护。

## 2 色彩与视觉规范(overlay 作用域)

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ov-core` | `#FFB65C` | 核心/高亮(亮琥珀) |
| `--ov-copper` | `#C97F3D` | 主线框、粒子主体、进度条填充(铜) |
| `--ov-ember` | `#8A4B1F` | 粒子暗部、氛围(暗铜) |
| `--ov-line` | `rgba(255,182,92,.35)` | 细线、环、边框 |
| `--ov-ink` | `#FFE8C7` | 覆盖层文字(暖白) |
| 场底 | 近黑 `#0A0806` | 粒子接管期的全屏底色 |

- 金额一律黑体(Heiti)高亮,延续"黑体金钱"约定;答案卡正文用系统黑体细体。
- 样式类一律 `.overlay-*`,与 `.screen-*` 完全隔离,基线样式零改动。

## 3 唤醒方式:语音唤醒(用户已定)

- **唤醒词**:主唤醒词「贾维斯」;可选副唤醒词英文「Jarvis」(部分引擎内置该词,展厅彩蛋,配置台可开关)。
- **检测方案**:浏览器端本地关键词检测(KWS)——`AudioWorklet` 采集麦克风 + `sherpa-onnx` WASM 关键词模型;检测在本地完成,平时**不向云端推送任何音频**。备选:Porcupine(内置英文 Jarvis 词,商用需授权)。
- **唤醒链路**:KWS 命中 → 播放/合成应答「我在,先生。」→ 大屏基线淡出、粒子场成型(见 §5)→ 实时会话建立 → `listening`。动画时长覆盖会话建连延迟。
- **误触发防护**:能量门限 + 置信度阈值可配置;应答后 5s 冷却;退场后同样冷却。
- **麦克风硬件**:展厅必须配**指向性/阵列麦克风**(降噪、限定拾音锥角),安装在讲解位附近;这是唤醒可靠率的第一决定因素。
- **Kiosk 配置**:Chrome kiosk 模式启动,预授权麦克风与音频(`--autoplay-policy=no-user-gesture-required` + media stream flags),避免授权弹窗。
- **运维后备**(不面向观众):隐藏快捷键(如 `F9`)直接进入 `waking`,用于调试和断网演示,配置台可禁用。

## 4 状态机与交互流程

```
ambient ──唤醒词──▶ waking ──▶ listening ⇄ thinking ──▶ answering ──▶ followup ─┬─3s静默─▶ closing ──▶ ambient
                    │                ▲            │(barge-in, 8c)              │
                    └─「我在,先生」    └────────────┴───────(再开口)◀──────────────┘(继续提问)
任意状态出错 ──▶ error-fallback(播报降级话术) ──▶ closing
```

| 状态 | 持续 | 屏幕 | 语音 |
| --- | --- | --- | --- |
| ambient | 常态 | 工业基线轮播 | 仅本地 KWS 监听 |
| waking | ~900ms | 大屏淡出至近黑,粒子场从中心成型 | 「我在,先生。」 |
| listening | 至静音判定 | 核心随麦克风振幅呼吸,外围粒子场缓慢漂移 | VAD 收集提问 |
| thinking | 目标 <2s | 自转加速、粒子内收,琥珀火花上飘 | 静默 |
| answering | 随播报 | **粒子中心输出答案卡**(见 §7);卡内关键数字随播报高亮 | 播报结论(≤3 句) |
| followup | 3s(用户定) | 卡片保持,核心回落呼吸,外圈能量环 3s 递减 | 「先生,还有其他问题需要我帮您处理吗?」 |
| closing | ~800ms | 卡片折叠吸回核心 → 粒子散场 → 大屏基线淡回,轮播无缝继续 | 静默(或「好的,先生。」) |

- **打断规则**:followup 中任何语音输入 → 回 `listening`(多轮,上下文保留;旧卡片折叠回收,新问题重新输出);answering 中允许打断(barge-in,8c 期实现);3s 倒计时环走完即 `closing`。
- **回答完如果用户说"没有了/谢谢"**:播报「为您服务是我的荣幸,先生。」后直接 `closing`。
- **超时兜底**:thinking 超 8s 无结果 → 降级话术「抱歉先生,数据暂时无法调取。」→ closing。
- **多问连续**:第二问不再重播 waking,直接 listening,卡片原地回收再生。

## 5 全屏接管与退场

- **接管(唤醒)**:大屏根容器 CSS `opacity → 0`、亮度压暗(约 500ms,合成层动画),粒子场自屏幕中心向外扩散成型(约 900ms),底色压至近黑 `#0A0806`。不做任何 3D 地图运动。
- **退场**:逆向——答案卡折叠吸回核心(200ms)→ 粒子向中心收拢消散(600ms)→ 基线淡回,轮播在原相位继续,观众无感切换。
- 落位:核心居中 (960, 470);答案卡锚点在核心正下方(约 y 700–880,宽 720);语音转写小字位于核心上方。具体位置 8a 视觉打磨时微调。

## 6 粒子系统(贾维斯本体,Canvas 2D)

- 实现:独立 `<canvas>` + 2D 点粒子(核心约 2200 粒 + 全屏氛围场约 3000 粒,`devicePixelRatio` 封顶 1.5),独立 `requestAnimationFrame`;覆盖层关闭时 canvas 不存在,**基线零开销**。
- 配色:主体 `--ov-copper`,亮部 `--ov-core`,暗部 `--ov-ember`,少量加色混合出金属辉光。

| 状态 | 粒子行为 |
| --- | --- |
| waking | 全屏氛围场从中心扩散铺满,同时汇聚出核心(呼吸脉冲) |
| listening | 核心振幅驱动半径呼吸(±12%),外圈细环常亮;氛围场缓慢漂移 |
| thinking | 自转 3 倍速,核心内收 8%,少量琥珀火花上飘 |
| answering | 发射脉冲(亮度闪 + 能量环),粒子束流向答案卡(见 §7);播报期核心随 TTS 振幅微幅律动 |
| followup | 回落缓慢呼吸;外圈能量环 3s 递减(暗示即将退场) |
| closing | 核心与氛围场向中心收拢消散 |

- 振幅来源:Web Audio `AnalyserNode` 同时挂麦克风流与 TTS 音频流,粒子层只吃数值。
- 性能预算:覆盖层开启时帧增量 ≤8ms;全部缓动/振幅→参数映射写成纯函数,进单测。

## 7 答案卡:从粒子中心输出(本方案灵魂)

**发射编排(总时长约 700ms,与语音播报首字衔接):**

1. 核心亮度脉冲(120ms)并向外扩散一圈能量环——"要出东西了"的前兆;
2. 约 120 粒子从核心沿弧线流向卡片锚点(350ms)——"输出"的具象化;
3. 卡片在锚点先成一条水平细线(琥珀色),随后纵向展开、边框 SVG 描边绘制(250ms);
4. 打字机逐字出正文,关键金额黑体 + `--ov-core` 高亮;
5. TTS 句级边界事件驱动卡内对应数字高亮(取不到句级事件则按 `answer.delta` 近似同步)。

**卡片模板库(数量被 MCP 只读工具封顶,均为纯 DOM 组件):**

| 模板 | 内容 | 复用资产 |
| --- | --- | --- |
| 目标进度卡(首个精做) | 大额黑体数字 + **2D 铜色进度条**(动画填充)+ 距目标差额 | `target.ts` 口径 |
| 区域对比卡 | 两列数值 + 迷你横向条 | 区域数据契约 |
| 完成率环卡 | SVG 圆环 + 百分比 | TargetRing 语义 |
| 客户/发货卡 | 3~5 行紧凑列表 | ReminderRail / DeliveryMilestones 数据面 |

- 数据一致性:模板只消费 MCP 工具返回的同一格式化字符串,与屏幕基线口径永远同源。
- 开发量参照:单模板 0.5~1 天,无 3D。

## 8 语音方案(音色向贾维斯看齐)

**链路**:语音唤醒(本地 KWS)→ 端到端实时语音模型(ASR+LLM+TTS 一体,function calling)→ MCP 只读服务 → 语音播报 + 屏幕事件。

**模型选型(需同题试听比稿后定标)**:

> 比稿范围已定(用户指定 2026-09-23):**豆包 + 智谱**两家;MiniMax 暂不参与。比稿测试台已建:`scripts/voice-bakeoff/`(统一文案 8 条、零依赖生成脚本、盲听评分表;数字读法为硬门槛)。

| 候选 | 优势 | 备注 |
| --- | --- | --- |
| 豆包端到端实时语音(推荐主选) | 音色库最广,含低沉成熟男声;支持授权声音复刻 | 复刻路径最接近贾维斯质感 |
| 智谱 GLM Realtime(备选) | 生态一致,接入简单 | 音色较少 |
| MiniMax 实时语音(备选) | 中文 TTS 表现力强 | 实时会话能力需验证 |

**音色三步走**:

1. **预设比稿**:各候选取 3~5 个低沉、沉稳、语速偏缓的成熟男声,同一组问答脚本试听定标。
2. **授权声音复刻(可选加分项)**:用气质相近的**授权**男声样本复刻"沉稳管家"音色;**不复刻电影原声**(肖像/版权风险),目标是气质接近而非山寨。
3. **DSP 润色(必做,零成本)**:Web Audio `ConvolverNode` 轻板式混响 + 低频 warmth EQ + 极轻饱和,任何音色立刻获得"AI 管家"质感。

**人设 prompt 要点**:人设暂定名**「小川」**(2026-09-23;"贾维斯"仅为气质参照,不代表角色名);称呼「先生」;每次 ≤3 句,先结论后数字;克制礼貌中带情感微表情——报好消息语尾微扬、说差距略放沉、告别加暖意、缺数据带轻歉;实时 v3 音色可用音频标签(`[calm]`/`[serious]`/`[warmly]`/`[sighs]` 等,每条回复至多 1 个);表现力与稳定性的滑杆互斥(稳定性调低则更生动但更易漂移);**数字只允许使用工具返回值**。

**开源项目对照调研(2026-09-23)**:开源圈"JARVIS 声音"只有三种解法——① 通用低沉男声预设(gbaptista/ion 用 OpenAI onyx/Polly Matthew 等,零克隆零风险);② ElevenLabs 社区 JARVIS 音色(AlexandreSajus/JARVIS 等,英文、灰色地带、随时可能被下架);③ 手训电影原声克隆(HA 社区 Piper 版:3 周手工训练、仅英文、发音有瑕疵需调 length_scale 降速、帖内已现 DMCA 争议)。**结论:没有可直接复用的中文贾维斯;社区共识配方=低沉男声+降速+混音润色,与本项目 DSP 路径一致;中文商用唯一合规解=授权配音样本→豆包复刻**。

**音色/人设切换**:接入 step6 配置台新增设置项(音色、人设、唤醒词开关、置信度阈值);切换音色=重建会话(1~2s),低频操作,可接受。

## 9 架构与事件协议

```
麦克风 ─ KWS(本地) ─▶ 端到端实时语音模型(云端 WS)
                              │ function calling
                     编排服务(本机 Node: WS hub + 会话状态)
                              │ 只读工具
                        MCP 服务(复用 target.ts 口径)
                              │
        大屏页 overlay(WS 订阅:状态机驱动粒子/卡片) + Web Audio(麦/TTS 分析)
```

- WS 事件(全部 TS 类型化):`session.start` / `state.change` / `asr.partial` / `tool.invoke{card?}` / `answer.delta` / `tts.boundary` / `session.end` / `error`。
- `tool.invoke` 携带卡片模板 id,驱动答案卡选型;状态机与粒子层不感知数据来源,未来若升级 3D 渲染层,协议不变。
- **读法归一化(比稿实测验证,2026-09-23)**:编排服务送 TTS 前,把数字/金额归一为汉字读法(「1.24 亿元」→「一点二四亿元」),屏幕卡片仍显示数字形态;ElevenLabs 中文实测数字误读,证明该层必要。豆包可另配发音词条(词表最多 5000 条)兜底专名。

## 10 防幻觉与只读(红线)

1. MCP 服务只暴露只读工具,无任何写操作;凭证只读。
2. system prompt 硬约束:只用工具返回的数字;没有数据就直说没有;金额直接引用工具返回的格式化字符串。
3. 日志脱敏沿用 step3 约定(不落 publicId 等敏感字段)。

## 11 分期与验收

**8a 视觉壳(纯前端,不含语音)**
- 内容:overlay 作用域样式、粒子系统、全屏接管/退场、**答案卡发射编排** + 目标进度卡、纯 reducer 状态机、脚本回放器(`?voiceDemo=1` 循环演示全流程)。
- 验收:全流程 60fps;关闭覆盖层基线无回归(现有测试全过);状态机单测覆盖全生命周期/3s 超时/打断/错误路径;发射编排各步时序参数化可调。

**8b 数据通路(MCP + 文字对话)**
- 内容:MCP 只读服务(复用 target.ts)、文字测试台驱动同一状态机、补齐其余卡片模板。
- 验收:答案数字与 `/api/screen/crm` 完全一致;幻觉约束用例通过;错误路径降级话术。

**8c 实时语音(唤醒 + 对话闭环)**
- 内容:KWS 唤醒、端到端实时模型接入、DSP 润色、配置台音色/人设/唤醒词设置、barge-in、tts.boundary 高亮同步。
- 验收:唤醒→「我在,先生」≤1.5s;提问→首音 ≤2.5s;followup 3s 退场;断网/超时降级;比稿定音;展厅实测唤醒可靠率达标。

## 12 风险与对策

| 风险 | 对策 |
| --- | --- |
| 音色无法完全等于电影贾维斯 | 预期管理:目标是"气质接近";比稿+授权复刻+DSP 三层逼近;不复刻原声避版权 |
| 展厅噪声导致误触/漏听 | 指向性/阵列麦克风;置信度阈值与能量门限可配置;唤醒应答+冷却 |
| 延迟破坏"贾维斯感" | 粒子中间态遮盖等待;端到端实时模型;thinking 超 8s 降级 |
| kiosk 麦克风/音频授权 | kiosk 启动参数预授权;首次部署 checklist |
| 覆盖层与基线争抢性能 | 独立 canvas、8ms 帧预算、关闭即零开销;基线回归测试护住冻结基线 |
| 网络故障 | 任意环节失败→降级话术→closing,基线轮播永不受影响 |

## 13 非目标(已明确否决,避免返工)

- **不引入 Three.js/WebGL 3D 场景**:v2 迭代中评估过"裸眼3D 场景库"(全屏 3D 进度条/地图升起),因开发量庞大且团队无 3D 技能栈否决。保留升级路径:事件协议与状态机与渲染层解耦,未来若需要,可将 canvas 渲染层替换为 WebGL,卡片模板升级为 3D 场景,协议不动。
- 不做数字人/虚拟形象(成本高,半吊子拟人反而掉价)。
- 不做写操作(只读红线)。

## 14 预落地文件布局(8a 起)

```
src/lib/voice/session-machine.ts      # 纯 reducer 状态机 + 单测
src/lib/voice/params.ts               # 振幅/缓动→粒子参数 纯函数 + 单测
src/lib/voice/demo-script.ts          # 8a 脚本回放数据
src/components/overlay/OverlayStage.tsx
src/components/overlay/JarvisCore.tsx # canvas 粒子系统(核心+氛围场)
src/components/overlay/AnswerCard.tsx # 卡片发射编排 + 模板容器
src/components/overlay/cards/         # 各卡片模板(ProgressCard 等)
services/voice-orchestrator/          # 8b/8c:WS hub + MCP 客户端 + 实时模型客户端
```

## 15 开源参考(8a 视觉壳,2026-09-23 调研)

| 参考 | 用途 | 许可证 | 借鉴方式 |
| --- | --- | --- | --- |
| [elevenlabs/ui](https://github.com/elevenlabs/ui) | **Orb**(语音律动核心)+ **Waveform** + Transcript 组件,shadcn registry 分发 | MIT | 改铜/琥珀配色、接自有振幅数值源,快速立起 8a 骨架;后期被自研粒子核心逐帧替换 |
| [kopiro/siriwave](https://github.com/kopiro/siriwave) | Siri 经典波形(canvas) | MIT | 答案卡内波形装饰备选 |
| [DataV-Team/DataV-React](https://github.com/DataV-Team/DataV-React) | 大屏 HUD 边框/装饰组件(9.7k star Vue 版的 React 版) | MIT | 取边框/装饰组件改铜色 token,做答案卡 HUD 边框 |
| [LKO-Mark-3.4](https://github.com/shubhransh-gupta/LKO-Mark-3.4) | JARVIS 风格 Flightdeck:3D 反应堆/雷达/遥测表盘;static 前端 + HTTP 后端,与"overlay + 编排服务"同构 | MIT | HUD 元素清单与分层结构参考 |
| [elevenlabs/examples](https://github.com/elevenlabs/examples) | 实时语音 agent 完整示例(Next.js) | MIT | idle/listening/thinking 状态流转模式参考 |

**8a 实施顺序建议**:先用 Orb(改色)+ DataV 边框快速立骨架跑通状态机 → 自研粒子核心(params.ts 纯函数驱动)逐帧替换 Orb → SiriWave 作为卡片波形备选。全部 MIT 合规;视觉密度与字号不照抄(它们都不是 1080p LED 展厅场景),青色系一律换铜/琥珀。

## 16 施工总览与 8b 细化方案(2026-09-27,8a 视觉过审定稿 @9a5d588)

### 16.1 施工总览图

```
════════════ 小川语音对话模式 · 施工总览(step8:8a ✓ → 8b ▶ → 8c 排队)═══════════

┌─ ① 展厅大屏(Next.js :3015)───────────────────────────────────────────────┐
│  /screen/sales 基线(.screen-*,冻结)     /screen/sales?voiceDemo=1(8a ✓)  │
│    工业指挥舱视觉                          OverlayStage                     │
│    KpiRail / ShipmentMap / ReminderRail      ├─ JarvisCore   粒子核心        │
│                                              ├─ AnswerCard   发射编排+模板   │
│                                              └─ session-machine 纯 reducer │
│  8a 现状:脚本回放器驱动(无语音无数据) ▶ 8b 后由编排服务事件流驱动          │
└──────────────▲────────────────────────────────────────────────────────────┘
               │  WS 事件流(8b 起):session.start / state.change /
               │  tool.invoke{card} / answer.delta / tts.boundary / session.end / error
┌──────────────┴────────────────────────────────────────────────────────────┐
│ ② 编排服务 services/voice-orchestrator(本机 Node)                          │
│   8b ▶ WS hub + LLM function-calling 适配器 + 会话编排 + 文字对话台入口     │
│   8c(排队)+ KWS 唤醒(sherpa-onnx WASM)+ 实时语音客户端 + DSP 润色        │
└──────────────┬────────────────────────────────────────────────────────────┘
               │ 只读工具(function calling → MCP)
┌──────────────┴────────────────────────────────────────────────────────────┐
│ ③ MCP 只读服务(8b ▶,红线:无任何写)                                       │
│   query_sales_summary → 目标进度卡   query_region_data → 区域对比卡        │
│   query_completion → 完成率环卡      query_customers_shipments → 客户发货卡 │
│   复用 lib/target.ts + lib/format.ts 口径;数据源=本仓 mock(平台迁移换真实)│
└──────────────┬────────────────────────────────────────────────────────────┘
               │ 完全同源
        ④ 数据面 /api/screen/crm(DachuanPro 契约,step5 已定)

─── 测试轨(贯穿)────────────────────────────────────────────────────────
 状态机/参数纯函数单测(8a ✓)· 口径一致性 diff 测试(8b)· 防幻觉用例(8b)
 比稿盲听表(scripts/voice-bakeoff)· Agent 模拟测试 7 例(平台侧 ✓ 暂定)

─── 三期状态 ────────────────────────────────────────────────────────────
 8a 视觉壳   ✓ @9a5d588 视觉过审(2026-09-27)
 8b 数据通路 ▶ 下一步,约 7~8 个工作日
 8c 语音闭环 排队,约 5 天 + 展厅实测(语音后端:豆包S2S/GLM-Realtime/Eleven 三选一,Eleven 已暂定通过但境内稳定性待实测)
 上线        kiosk 参数 / 阵列麦克风 / 展厅实测(唤醒率·首音≤2.5s·3s 退场)
```

### 16.2 8b 细化施工方案(数据通路)v2

> **v2 修订(2026-09-27,平台仓审核后定稿,用户拍板)**:平台仓(k3/sales-screen-platform @520b5a11)已合入小川 Agent 第 1 期全引擎——`src/lib/agent/*`(LLM 循环+工具执行+审计+限流)、`/api/mcp`(标准 MCP 端点,API Key 鉴权,full-read-only 模式=独立只读查询库+审计库,16 个业务只读工具)、`/api/agent-gateway/chat`(FastGPT 网关)。**大屏数据源 `GET /api/screen/sales/[publicId]` 的 `PublicSalesScreenPayload`(kpis/collection/delivery 三段白名单)单一来源即覆盖全部 4 个语音工具**,口径与屏幕物理同源。故:自建 MCP 读 mock 的原任务 B 废止;"口径视图"降级为备选(仅当 payload+MCP 均表达不了某聚合时再议)。
>
> **两条用户顾虑的处理**:①延迟——协议开销为毫秒级,真正的大头是 LLM 工具轮(1.5~3s);**主路径改用"payload 预取+注入"**(提问时并行预取 payload、注入 LLM 上下文、零工具轮直接作答),平台 MCP 仅兜长尾且长连接复用;②覆盖缺口——按既有模式补平台 MCP 工具(0.5~1d/个,全渠道受益),v1 展厅话域限定+缺口走降级话术,缺口清单化(`docs/voice-coverage-backlog.md`)。

**目标**:覆盖层从"脚本回放"升级为"真实数据驱动",打通 文字对话台 → 编排服务 → 数据源(payload 预取 + 平台 MCP)→ 状态机/大屏 全链路;语音仍不接入(8c 等租用设备)。

| # | 任务 | 产出 | 工期 |
| --- | --- | --- | --- |
| A | 事件协议类型包 | `src/lib/voice/protocol.ts`(§9 全部事件 TS 类型,大屏/编排共用)+ 序列快照单测 | 0.5d |
| B | 数据源适配层 | ① payload 适配器:本地 fixture(字段结构对齐平台 `PublicSalesScreenPayload`,只读参考平台仓 `src/modules/screen/public-types.ts`)+ fetch 接口(迁移=换 URL+publicId);② **预取+注入**:提问并行预取、注入上下文、零工具轮;③ 平台 MCP 客户端(API Key,长连接复用,feature flag 可关);④ **全程打点**:question→prefetch→llm_first_token→tool_exec→answer_full | 1.5d |
| C | 编排服务 | `services/voice-orchestrator/`:WS hub + **LLM 适配器接口化**(OpenAI 兼容;8b 默认智谱,key 走环境变量不落仓)+ 会话编排 + 降级路径 | 1.5d |
| D | 文字对话台 | `/voice-console` 调试页:输入问题→编排→大屏动效,显示事件流与各阶段耗时打点;取代 voiceDemo 成为验收演示入口 | 1d |
| E | 卡片模板补齐 | RegionCard(数据=delivery.routes)/ CompletionRingCard(数据=collection)/ CustomersShipmentsCard(数据=delivery.milestones+reminders),复用 8a 发射管线,模板注册表化 | 2d |
| F | 防幻觉与红线 + 缺口清单 | 数字只准引用注入 payload 的用例;问 payload/MCP 都没有的数据必须降级话术;日志脱敏(沿用 step3 约定);`docs/voice-coverage-backlog.md` 种子清单 | 0.5d |

**平台侧前置(运维,非代码)**:生产 `/api/mcp` 确认 full-read-only 模式与独立查询库就绪,为编排服务签发 API Key(N8N/FastGPT 已在用,大概率已就绪)。视觉仓阶段(8b)不依赖此项——fixture 为主、MCP 客户端 feature flag 关闭。

**验收(= §11 的 8b)**:文字台 8 条问题全链路演示;答案数字与注入 payload 完全一致(diff 测试全绿);幻觉用例通过(无数据必降级);编排进程 kill、LLM 超时、数据源异常三条错误路径下大屏优雅降级、基线无感;打点数据齐全并有一份延迟报告。

**给 8c 留的接口**:事件协议与渲染层解耦(§9),语音后端在编排服务内被适配器隔离——8c 无论选豆包 S2S、GLM-Realtime 还是 ElevenLabs Agents,大屏与 MCP 层零改动。

> **8b 实施完成(2026-09-28)**:A~F 六任务全交付——`src/lib/voice/protocol.ts`(§9 事件协议+快照单测)、`services/voice-orchestrator/`(零依赖 Node TS 直跑:手写 RFC6455 WS hub、预取+注入、OpenAI 兼容/离线 scripted 双 LLM 适配器、平台 MCP 客户端 flag 默认关、全程打点)、`/voice-console` 验收台、Region/CompletionRing/CustomersShipments/Brief 四卡+模板注册表、防幻觉数字护栏与缺口清单(`docs/voice-coverage-backlog.md`)。验收:8 问全链路数字与 fixture 一致、三条错误路径(数据源500/LLM超时/编排kill)大屏优雅退场、延迟报告见 `docs/voice-8b-latency-report.md`。fixture 字段=平台 `PublicSalesScreenPayload` 逐字段对齐,迁移平台=改 VOICE_PAYLOAD_URL/PUBLIC_ID 两个值。


## 2026-10-05 源码复核补充（优先于历史完成描述）

8b 文字主路径已有实现。平台 MCP 未启用，代码保留：缺 initialize 调用与 LLM 工具目录下发，开启 flag 也不会使长尾链路自动工作。采用修复方案 5.2 的方案 B，默认保持关闭，待单独接线和联调。
8c 的 ASR/TTS/唤醒/真实音频振幅尚未实现；最终本地或云端方案仍需产品决策和设备验收。
历史 8b 离线报告是 scripted 模拟，不能证明真实模型或端到端语音达到延迟指标。实际运行配置见 services/voice-orchestrator/README.md。
