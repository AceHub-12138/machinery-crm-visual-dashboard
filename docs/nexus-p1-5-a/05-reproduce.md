# 诊断工具与复现命令

在独立 P1.5-A worktree 根目录顺序执行。所有服务只读本地夹具，不连接生产平台。

```sh
pnpm install --frozen-lockfile
node --test scripts/p1-5-a/*.node-test.mjs
pnpm build

P15_BACKEND=headless P15_PHASE=formal P15_FORMAL_MS=60000 P15_CALIBRATION_MS=5000 P15_PORT=3051 node scripts/p1-5-a/benchmark.mjs
P15_BACKEND=headed P15_PHASE=formal P15_FORMAL_MS=60000 P15_CALIBRATION_MS=5000 P15_PORT=3052 node scripts/p1-5-a/benchmark.mjs

P15_BACKEND=headless P15_PHASE=trace P15_TRACE_MS=10000 P15_CALIBRATION_MS=2000 P15_PORT=3051 node scripts/p1-5-a/benchmark.mjs
P15_BACKEND=headed P15_PHASE=trace P15_TRACE_MS=10000 P15_CALIBRATION_MS=2000 P15_PORT=3052 node scripts/p1-5-a/benchmark.mjs
node scripts/p1-5-a/analyze-traces.mjs .review/p1-5-a

P15_BACKEND=headless P15_PHASE=visual P15_CALIBRATION_MS=500 P15_PORT=3051 node scripts/p1-5-a/benchmark.mjs
P15_BACKEND=headed P15_PHASE=visual P15_CALIBRATION_MS=500 P15_PORT=3052 node scripts/p1-5-a/benchmark.mjs

node scripts/p1-5-a/finalize.mjs
node scripts/p1-5-a/plot.mjs
```

端口被占用时脚本拒绝复用；fixture 固定使用 3199。headless/headed 必须顺序执行。正式计时不应与测试、Trace、录屏、截图或其他高负载任务并行。

## 输出

- `.review/p1-5-a/{headless,headed}/benchmark.json`：完整环境、正式结果、Trace/视觉元数据。
- `.review/p1-5-a/{headless,headed}/*.trace.json.gz`：原始 Trace。
- `.review/p1-5-a/{headless,headed}/*-{ambient,pulse}.png`：独立截图。
- `docs/nexus-p1-5-a/evidence/`：可提交的结构化汇总、完整时间序列及原始文件 SHA-256 清单。

原始 Trace/截图被保留在新的 P1.5-A 忽略目录；不会覆盖 `docs/nexus-p1-4/evidence/`。跨机器审核必须连同 [evidence-manifest.json](evidence/evidence-manifest.json) 校验，不能只拿截图或 Markdown 结论。
