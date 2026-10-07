# voice-local（8c Task 3–4）

本机 Python ASR/TTS 服务。两个模型共用一个 GPU 工作线程，启动完成后才接受请求。启动脚本固定绑定 `127.0.0.1`，单进程运行，不修改原型或已安装的模型库。

## 启动与配置

```bash
# 仓库根目录；Apple Silicon，Python 3.12
python3 -m venv services/voice-local/.venv
services/voice-local/.venv/bin/pip install -r services/voice-local/requirements.txt
cp services/voice-local/.env.example services/voice-local/.env.local
# 填写模型目录、参考音频和逐字对应的参考文本后：
services/voice-local/.venv/bin/python services/voice-local/run.py
```

已有兼容环境时直接用其 Python 执行 `run.py`。配置文件不入 Git；参考音频及文本必须成对填写，代码和样例不内置本机路径或参考材料。只支持本地完整模型目录，不在请求中下载模型。

`VOICE_TTS_STYLE` 是当前参考音色的名称，`/health.styles` 列出此名称。它不切换声线或情绪；其他 style 返回 400。热词以逗号分隔。温度默认 0.6，静音峰值阈值默认 0.001（int16 满幅归一化），时间预算默认 0.4 秒/字，另加 1.5 秒。

启动合成唤醒句并回送 ASR，忽略标点计算字符错误率；非静音、长度至少 0.3 秒、CER ≤20% 才允许 TTS。自检失败时 `/tts` 返回 503，ASR 继续提供服务。健康检查及日志提供告警；编排服务保持卡片路径。

## 接口

| 接口 | 内容 |
| --- | --- |
| `GET /health` | `warm,selfCheck,selfCheckCer,models,refHash,styles,metrics,activeJobs` |
| `POST /asr` | `audio/pcm`、`application/octet-stream` 或 `audio/wav`；16kHz、mono、int16 PCM，最长15秒；返回 `{text,ms}` |
| `POST /tts` | JSON `{text,style?}`，1–400字；响应 `audio/pcm`，int16 LE、24kHz、mono；格式和任务 ID 见响应头 |
| `GET /jobs/:id` | 最近任务的耗时、重生成、截断、失败、完成/取消状态；用于流结束后的打点，不记录文本或音频 |

首片完整模型输出先检查峰值，静音丢弃后仅重试一次；发送音频后不重试。按 `ceil((字数×0.4+1.5)×12)` 限制 codec token，并限制 PCM 总时长。模型每个采样步骤检查取消，断开连接也会释放阻塞的输出队列；不能中断正在执行的单个 GPU kernel。

最多8个未完成任务；输出队列4片；指标账本最多256条、已完成记录保留120秒。模型实际释放 GPU 后才结束生成器。原始 PCM 不包含重试或截断指标，编排客户端通过任务 ID 读取最终指标。

此服务无对外鉴权，只允许同机编排调用；需要部署到其他机器时须另行设计网络边界。浏览器通过编排服务带 Bearer 的音频接口访问。

## 验证

```bash
services/voice-local/.venv/bin/python -m unittest discover -s services/voice-local -v
# 在热服务上执行30轮真实合成/ASR回环及取消检查：
services/voice-local/.venv/bin/python services/voice-local/calibrate.py --out services/voice-local/logs/calibration.json
```

故障测试覆盖首片静音重试、两次静音拒绝、已发送后失败不重试、失控封顶、取消、参考哈希失效、PCM/WAV格式、请求上限、自检失败。实测结果见仓库 `docs/voice-8c-stage34-result.md`。
