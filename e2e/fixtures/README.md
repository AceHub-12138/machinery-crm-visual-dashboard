These two synthetic Mandarin speech fixtures are from the local macOS Tingting ASR benchmark (`本月销售情况怎么样` / `本月目标完成率是多少`). They contain no real microphone recording or company business data. Used to exercise actual browser resampling and Silero VAD while GPU models are mocked. They do not prove exhibit speech accuracy.

Repair fixtures: `followup-long.wav` is 7.87475s of macOS Tingting Mandarin speech at 150 words/min; `wake.wav` is the same local synthetic voice saying 你好小川. Long followup tests assert PCM payload duration exceeds four seconds. These fixtures contain no human recordings.
