# 音色比稿:豆包 vs 智谱 GLM(贾维斯音色定标)

目标:为语音对话模式选定"最接近贾维斯气质"的音色——低沉、沉稳、语速偏缓、有教养的疏离感。测试台在本目录,零依赖(Node 18+,直接 `node`)。

## 一、比稿对象

| 厂商 | 本轮比稿用 | 后续 8c 实时 | 复刻升级路径 |
| --- | --- | --- | --- |
| 豆包(火山引擎) | 豆包语音合成大模型 2.0(V3 接口) | 豆包 S2S 端到端实时语音 | 豆包语音复刻大模型 2.0(需授权材料) |
| 智谱(bigmodel) | GLM-TTS(`glm-tts`) | GLM-Realtime | GLM-TTS-Clone(3 秒样本复刻) |
| ElevenLabs(参照/英文层) | 工作台设计声线转 API(见下) | (无境内实时方案,作英文彩蛋层) | 平台内 Instant Cloning(用自己的生成物) |

**ElevenLabs 参照声线接入(用户已选中候选声线):**

```bash
export ELEVEN_API_KEY=xxx   # 右上角头像 → Profile → API Keys
node generate.mjs list --vendor eleven                          # 列出音色,复制你的 voice_id
node generate.mjs gen  --vendor eleven --voice <voice_id>       # 默认 eleven_multilingual_v2
node generate.mjs gen  --vendor eleven --voice <voice_id> --model eleven_v3   # v3(工作台同款)
```

- 注意:v3 支持 `[serious]` 等音频标签;v2 系模型不支持,标签会被念出来(比稿文案不含标签)。
- API 与工作台共用积分;voice_id 也可在网页「音色 → Jarvis」的浏览器地址栏里直接看到。
- 若声音只存在于"声音设计"预览里,先在工作台点「创建音色/添加到声音库」再取 ID。
- 生产部署硬前提:展厅网络对 `api.elevenlabs.io` 的稳定性需实测(跨境链路),这是它目前定位为"参照+英文层"而非中文主力的原因。

## 二、三阶段流程

**阶段 A:控制台试听初筛(约 30 分钟,零代码)**

> 实测提示(2026-09-23):火山「音频合成 1.0」演示入口默认女声且音色固定,**比稿必须用「豆包语音合成大模型 2.0」**——2.0 音色 ID 为 `zh_male_*_bigtts`,1.0 为 `BV*`;8c 实时语音与 2.0/S2S 同源,1.0 音质结论不具代表性。智谱体验中心只提供 GLM-4-Voice(需充值),不含 GLM-TTS——GLM-TTS 是纯 API 产品,试听走 audio.z.ai 或智谱清言。

1. 火山:控制台 → 语音技术 → 开通「豆包语音合成大模型 2.0」→ 音色试听页按男声筛选,挑 3 个低沉沉稳候选,记下音色 ID(`zh_male_` 开头)。
2. 智谱:audio.z.ai 试听;或给 bigmodel 账户充最低额度后用脚本 `node generate.mjs list --vendor zhipu` 拉全量官方音色再定。挑 2~3 个候选。
3. 初筛标准:低沉、成年、沉稳;**直接排除**萌系/卡通/电音/女声。

**阶段 B:统一脚本生成(约半小时)**
```bash
export ZHIPU_API_KEY=xxx          # bigmodel.cn → 用户中心 → API Keys
export VOLC_TTS_APPID=xxx         # 火山控制台 → 语音技术应用
export VOLC_TTS_TOKEN=xxx
export ELEVEN_API_KEY=xxx

node generate.mjs gen --vendor zhipu --voice xiaochen          # 8 条 wav
node generate.mjs gen --vendor volc  --speaker zh_male_xxx     # 8 条 mp3
node generate.mjs gen --vendor eleven --voice <voice_id> --model eleven_v3 --stability 0.75
node generate.mjs blind                                        # 打乱编号 → out/blind/
```

**归一化与稳定性(2026-09-23 实测教训)**
- 数字念错:TTS 文本一律用 `lines.json` 的 `tts_text`(汉字读法,如「一点二四亿元」),脚本已自动取用;屏幕显示仍是数字形态。生产上这层归一化放在编排服务里。
- 音色漂移:ElevenLabs v3 用 `--stability 0.75` 起步(0~1,越高越稳、表现力越低);不稳定是 TTS 常态,重要话术可一条多生成几次择优,评分表技术项含「一致性」。
- 统一文案 8 条在 `lines.json`,核心是**第 2 条金钱读法**(1.24 亿 / 82% / 2,716 万元)——读错数字是一票否决项。
- 统一默认语速音调,不加情感参数,保证公平。
- 开通与计费:两边都按量计费,本轮比稿 8 条 × 6 个音色,费用可忽略;但需先在控制台开通语音合成服务。
- **Windows PowerShell 注意**:`export` 是 Bash 语法,PowerShell 用 `$env:` 赋值,且必须先 `cd` 到本目录再执行 `node`:
  ```powershell
  cd "E:\Claude\machinery-crm-Visual Dashboard\scripts\voice-bakeoff"
  $env:ELEVEN_API_KEY = "sk_xxx"
  node generate.mjs list --vendor eleven
  node generate.mjs gen --vendor eleven --voice 粘贴list输出的ID --model eleven_v3
  ```

**阶段 C:盲听评分(评分表见下)**
1. 播放 `out/blind/` 副本,对照编号填分,评完再开 `blind_mapping.csv` 对答案;
2. 用外放音箱、退后 2~3 米播放,模拟展厅真实距离;
3. 两人以上独立打分取均值,减少个人偏好;
4. **参照轨**:用户选中的候选声线音频(手剪为 `out/REF.wav`,不参与编号)作为金标准,所有候选与它对听——"像不像它"本身就是贴近度评分的锚。

## 三、评分表(每条音频 1~5 分)

| 维度 | 权重 | 评分要点 |
| --- | --- | --- |
| 贾维斯贴近度 | ×2 | 低沉、沉稳、有教养的疏离感;不能像客服/导游/播新闻 |
| 数字读法准确性 | 硬门槛 | 金额单位(亿/万)、小数、百分数、千分位逗号——**错 1 处该音色直接淘汰** |
| 远场可懂度 | ×1.5 | 2~3 米外放后每个字都听得清 |
| 节奏与停顿 | ×1 | ≤3 句的克制感,不是赶稿 |
| 人设表现力 | ×1 | 听起来像"管家在向先生汇报" |

技术项(非盲听,单独记录到下表):首包延迟、流式支持、wav/mp3 质量、价格、复刻可用性。

| 候选音色 | 贴近度 | 远场 | 节奏 | 人设 | 总分 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## 四、定标规则

1. 每厂商选出 1 首选 + 1 备选;
2. 若全部预设音色都不够贴(很可能:智谱预置少),启动**授权复刻**——找 1 段气质相近的授权男声样本(3 秒起,豆包复刻 2.0 需正式授权材料),两家的复刻结果也进同一评分表;
3. **不复刻电影原声**(肖像/版权风险),目标是气质接近;
4. 定标后音色进入 8c 端到端实时模型复核(延迟+全双工表现),配置台落"音色/人设"设置项。
