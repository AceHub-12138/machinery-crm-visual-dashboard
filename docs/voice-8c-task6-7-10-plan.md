# Task 6、7、10 施工计划

2026-10-07，01:41 后施工；基线 Task 5 修复 80a1c9e，分支 codex/voice-8c-task6-7-10。

1. Task 6：screen Bearer HTTP wake/utterance，复用全局提问限流；16kHz AudioWorklet + 本地 Silero VAD，状态门控、15秒封顶、真实播完/outputLatency/300ms后开麦。ASR直接进入同一分类与卡片管线，去掉录音路径上的模拟逐字等待；问候/没听清固定话术保持会话。
2. Task 7：浏览器 Worker sherpa-onnx KWS，本地 wasm/model，离线 ppinyin关键词「你好小川」，能量/阈值/得分与5秒冷却。F9走同一HTTP接口。可选一口气唤醒后提问暂不实现，先交付明确两段式交互。
3. Task 10：每风格参考对启动读入、逐风格回环自检，default失败禁用TTS；统一代码映射，轮内固定风格、独立参考哈希固定缓存、风格回落trace/对话台显示。
4. 修复 Task 5 遗留：断流150ms重缓冲、ambient suspend、静止卡片停rAF、补量词。
5. 验证：安全/状态/收音/分类/缓存单测，现有全量测试/构建/浏览器基线；真模型7风格自检、15次风格评测、至少20轮ASR到浏览器首音分段计时。本机合成录音与自动化不替代展厅真人、远场/噪声、跨机局域网验收。

红线：JarvisCore.tsx与screen基线样式零改动；音频HTTP、WS只状态/当前轮回报；模型资源本地托管；业务数据不送模型、不按模型文字播报。保留原有未提交任务书/架构文档改动。提交施工结果与报告供Claude复核，不自动合并main。施工与验证完成、保存结果后按用户授权关机。
