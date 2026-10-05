# 贾维斯声线画像(Voice Brief)

> 用途:描述"气质风格"用于生成/挑选相似音色(声音设计模型、配音演员、预设音色调参),不针对任何真实人物的声音复刻。
> 配套:`lines.json` 比稿文案;评分表见 README。

## 一、四维拆解

**1. 音质(Timbre)**
- 男性中低音区,男中音(baritone)下沿;成熟感来自共鸣位置,而不是压喉的低音堆砌。
- 声音干净、清朗,像打磨过的金属:无气声、无沙哑、无烟嗓。
- 共鸣是口腔+胸腔混合,"清瘦的贵气"——**不是**配音里粗壮的大叔浑厚,而是绅士的清亮低音。
- 表面带一丝"电子润泽"(电影里由混音给出,生成后可用轻 EQ+混响补)。

**2. 语速与节奏(Pace)**
- 语速中等偏慢:中文约 140~160 字/分钟;句间停顿从容,像在等对方消化。
- 语调整体平缓,陈述句尾自然下沉,句尾不上飘;重音克制,不夸张抑扬顿挫。
- 节奏感是"通报",不是"推销"——像管家向主人汇报,而非客服接待。

**3. 腔调与措辞(Accent & Persona)**
- 原版为标准英式 RP 腔;中文对应物:字正腔圆的普通话,轻微播音质感但**不是**新闻腔。
- 永远礼貌、称"先生",克制、疏离、略带干燥的幽默感;报错误时也不慌不忙。

**4. 情绪温度(Affect)**
- 低唤醒度:从不兴奋、从不急躁、从不讨好。
- 微妙的"类人而非人":得体但保持距离感——这是"AI 管家"气质的核心。

## 二、声音生成模型提示词(直接粘贴用)

**中文版:**
> 40 岁左右的成熟男声,男中音偏低音区,声音干净清朗、无沙哑无气声;标准普通话,轻微播音质感;语速偏慢、从容,句尾自然下沉不夸张;礼貌克制、有距离感,像受过高等教育、讲英式做派的管家;冷静沉稳,略带电子润泽感,像高级 AI 助理。

**英文版(ElevenLabs Voice Design / 国际模型用):**
> Deep male voice, 40s, refined and articulate. Calm, composed baritone with clean precise enunciation, no rasp and no breathiness. Measured, unhurried pace with deliberate pauses; level intonation with natural falling sentence endings. Polite and formal but slightly detached, like a highly educated English butler. Feels lightly studio-polished with a subtle high-frequency sheen, like a sophisticated AI assistant.

**⚠️ 实测教训(2026-09-23):上面英文版描述会生成"英国人"底子,中文输出带外国腔。中文场景必须用下面的"中文母语底子"版:**

**中文底子版(推荐,ElevenLabs Voice Design 用):**
> Native Mandarin Chinese male voice, late 30s to 40s, low composed baritone, clean precise enunciation with no rasp. Speaks Mandarin natively and flawlessly; unhurried measured pace with deliberate pauses; level intonation with falling sentence endings. Polite, formal, slightly detached — the composure of a high-end butler. Light studio polish, subtle electronic sheen, like a sophisticated AI assistant. English, when spoken, carries a light, elegant non-native polish.

要点:开头锚定 Native Mandarin Chinese;气质词(composed / butler / detached)全部保留;英文能力放句尾作锦上添花,不作身份底色。

**架构提示:正式形态建议中英分流**——中文播报走豆包/GLM 母语音色(比稿选出)+ DSP 润色;英文彩蛋(唤醒词 Jarvis、英文短句)走 ElevenLabs 英伦声线。两层混音统一做 DSP,气质即可对齐。另:不要把 ElevenLabs 生成音频拿去其他平台做声音复刻(违反其服务条款的风险)。

## 三、生成/调参锚点

| 维度 | 起点 | 说明 |
| --- | --- | --- |
| 音高 | 比普通男声低 10~15% | 豆包 API `pitch_rate` 从 -3 起试,区间 -3 ~ -6 |
| 语速 | 慢 5~10% | `speech_rate` 从 -5 起试(比稿时保持默认,定标后再调) |
| EQ | 抬 100~250Hz 暖感;提 2~4kHz 清晰度 | Web Audio BiquadFilter 即可 |
| 混响 | 小房间/板式,干湿比 8~12% | ConvolverNode;宁少勿多,过了就变"广播剧" |

## 四、试金石台词(30 秒判断像不像)

1. 「我在,先生。请讲。」——听沉稳与礼貌
2. 「先生,本月销售额 1.24 亿元,完成月度目标的 82%,距离目标还差 2,716 万元。」——听数字读法与节奏
3. "At your service, sir. All systems are operational." ——英式腔调参考

## 五、若走配音演员录制(复刻样本规格)

- 文本:上述试金石台词 + `lines.json` 全部 8 条,另录 30 秒自由发挥(管家用语)
- 录音:干声、无伴奏无混响;24bit/48kHz 或不低于 16bit/44.1kHz;安静房间,近讲距 10~15cm
- 情绪要求:全篇保持"平静通报"基调,允许在告别句加一丝暖意
- 授权:签声音授权书(授权范围:本公司展厅大屏语音系统用途;期限;是否独占)
