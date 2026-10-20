# P1.5-B 复现命令与证据边界

所有命令在独立 P1.5-B worktree 根目录顺序执行，不连接生产平台。

```sh
pnpm install --frozen-lockfile
pnpm build
node --test scripts/p1-5-b/*.node-test.mjs
node scripts/p1-5-b/replay-p1-5-a.mjs

# 每个 backend/profile 均执行三次；示例为无头 SwiftShader 相同60Hz。
P15B_BACKEND=headless-swiftshader P15B_PHASE=frequency P15B_PROFILE=shared60 \
  P15B_REPEATS=3 P15B_DURATION_MS=9000 P15B_CALIBRATION_MS=2000 P15B_PORT=3061 \
  node scripts/p1-5-b/benchmark.mjs

# 候选策略三次重复。
P15B_BACKEND=headless-swiftshader P15B_PHASE=strategy P15B_PROFILE=candidate60 \
  P15B_REPEATS=3 P15B_DURATION_MS=45000 P15B_CALIBRATION_MS=2000 P15B_PORT=3061 \
  node scripts/p1-5-b/benchmark.mjs

# GPT-6 Luna 执行的正式30分钟长稳；最后5分钟降负载。
P15B_BACKEND=headless-swiftshader P15B_PHASE=long P15B_PROFILE=candidate60 \
  P15B_REPEATS=1 P15B_DURATION_MS=1800000 P15B_RELIEF_AT_MS=1500000 \
  P15B_RESOURCE_SAMPLE_MS=60000 P15B_CALIBRATION_MS=3000 \
  P15B_WIDTHS=3840 P15B_ENGINES=legacy P15B_PORT=3061 \
  node scripts/p1-5-b/benchmark.mjs
node scripts/p1-5-b/analyze-long.mjs

# 独立Trace三次重复；不混入正式计时。
P15B_BACKEND=headless-swiftshader P15B_PHASE=trace P15B_PROFILE=shared60 \
  P15B_REPEATS=3 P15B_DURATION_MS=8000 P15B_CALIBRATION_MS=2000 P15B_PORT=3061 \
  node scripts/p1-5-b/benchmark.mjs
node scripts/p1-5-b/analyze-traces.mjs .review/p1-5-b

node scripts/p1-5-b/aggregate.mjs
node scripts/p1-5-b/finalize.mjs
```

后端参数：

- `headless-swiftshader`：无头软件渲染。
- `headed-metal`：有头 ANGLE Metal。
- `headed-swiftshader`：有头模式强制 ANGLE SwiftShader，用于拆分运行模式混杂。

## 回归命令

```sh
NEXUS_TEST_PORT=3064 pnpm exec playwright test -c e2e/p1-5-b.config.ts
GSAP_REGRESSION=1 NEXUS_TEST_PORT=3064 NEXUS_MOTION_ENGINE=legacy pnpm exec playwright test -c e2e/gsap-poc.config.ts
GSAP_REGRESSION=1 NEXUS_TEST_PORT=3064 NEXUS_MOTION_ENGINE=gsap pnpm exec playwright test -c e2e/gsap-poc.config.ts
NEXUS_TEST_PORT=3064 pnpm exec playwright test -c e2e/gsap-poc.config.ts
pnpm test
pnpm lint
```

## 证据边界

- `.review/p1-5-b/`：正式频率/策略矩阵、30 分钟逐秒数据、资源曲线和原始 Trace。
- `.review/gsap-poc/`：原 PoC 回归及保留失败 trace。
- `docs/nexus-p1-5-b/evidence/`：可提交汇总、长稳下采样、完整切换记录、Trace 聚合和原始文件 SHA-256。
- RAF 是调度代理；Trace inclusive 时间不可相加；浏览器自动化不替代真实 LED/展厅验收。
