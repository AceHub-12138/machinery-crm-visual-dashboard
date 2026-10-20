# 本机启停与回滚

工作目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-c-safety`。所有示例只绑定 `127.0.0.1`，使用 fixture，不连接生产。

默认启动无需许可：删除实验参数，运行正常的 `pnpm start` 即为 Baseline + Legacy。`debug=1&qualityExperiment=external` 不再关闭自动保护。

## 本地 Candidate

先在独立终端运行 `node e2e/nexus-fixture-server.mjs`；另一个终端：

```sh
cd /Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-5-c-safety
SCREEN_PLATFORM_URL=http://127.0.0.1:3199 SCREEN_PUBLIC_ID=fixture-only NEXUS_QUALITY_PERMISSION=local-candidate node scripts/p1-5-c/local-server.mjs --port 3071
```

浏览器访问 `http://127.0.0.1:3071/screen/sales?debug=1&qualityExperiment=candidate`。显式 GSAP PoC 加 `&motion=gsap`，不改变默认引擎。将参数改为 `qualityExperiment=shadow` 只观察候选决策，实际仍由 Baseline 控制。

只有观察权限时用 `NEXUS_QUALITY_PERMISSION=local-shadow` 启动；此许可无法开启 Candidate，也不能通过手动按钮改档。缺少许可、许可拼错、非回环 Host、模式拼错/多值、缺少 debug、历史 external 参数均回退 Baseline。许可由服务端读取，还必须具有专用启动器从真实 listener/socket 及原始请求生成的请求级证明。普通 `next start` 即使带上述环境变量和 localhost Host 也拒绝实验与手动控制。已知代理/转发头在进入 Next 前拒绝，不信任 HTTP 头自称的边界证明。无 `NEXT_PUBLIC` 变量，无写入 localStorage、用户数据或生产配置。

## 关闭

点击调试面板“回到 Baseline”或删除 `qualityExperiment` 参数后导航。客户端同引擎模式变化会销毁并重建 Director，不保留旧策略。需要撤销本机许可时停止本地服务，明确移除该进程的许可后重启：

```sh
env -u NEXUS_QUALITY_PERMISSION SCREEN_PLATFORM_URL=http://127.0.0.1:3199 SCREEN_PUBLIC_ID=fixture-only node scripts/p1-5-c/local-server.mjs --port 3071
```

这样即使父 shell 曾 export 许可，再次使用 Candidate URL 也会得到 Baseline。对所有已打开的实验标签页执行完整刷新，或关闭后重新打开；服务端环境变更不会自动撤销已加载页面中的客户端实例。完整刷新后核对 `data-quality-automation=baseline`。

自动回退会记录原因；若修复环境后需要重新进入实验，重新导航/刷新受许可的实验 URL。回退不会偷偷重新授权 Candidate。

## 本次安全补强的回滚

原 `b3d5c11` 工作区保留未动。撤销本地实验只需移除许可、重启并完整刷新实验标签页。代码回滚可停止安全补强工作区服务，回到已保留的 `b3d5c1133e5809e272529d5b2c6cff8595f1d3d6` 工作区；仅在不带 `NEXUS_QUALITY_PERMISSION` 的 Baseline 模式运行，不在回滚版本重开实验，因为它仍包含本次修复的 Host 判断缺口。不要对其它未提交工作区 reset/clean。

需要独立副本时，从 `b3d5c1133e5809e272529d5b2c6cff8595f1d3d6` 新建 detached worktree 后独立构建。普通 Next 示例（仅本机 fixture、无许可）：

```sh
env -u NEXUS_QUALITY_PERMISSION SCREEN_PLATFORM_URL=http://127.0.0.1:3199 SCREEN_PUBLIC_ID=fixture-only pnpm exec next start --hostname 127.0.0.1 --port 3071
```

没有数据库迁移、用户数据删除或生产配置需要撤销。更早 P1.5-B 的历史回滚指令保留在 `b3d5c11` 的文档中；不作为本次安全回滚目标。[本轮安全边界与重校准提案](07-safety-boundary.md)。

## 验证复现

```sh
pnpm install --offline --frozen-lockfile
pnpm build
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm lint
python3 scripts/p1-5-c/regression.py
pnpm exec playwright test -c e2e/gsap-poc.config.ts
P15C_PHASE=soak P15C_ENGINE=gsap P15C_DURATION_MS=1800000 P15C_RELIEF_AT_MS=1500000 node scripts/p1-5-c/run.mjs
P15C_PHASE=soak P15C_ENGINE=legacy P15C_DURATION_MS=600000 P15C_RELIEF_AT_MS=480000 node scripts/p1-5-c/run.mjs
node scripts/p1-5-c/visual.mjs
```

以上浏览器命令必须依次运行，不能争用 fixture 3199，视觉视频采集与正式长稳计时分开。脚本遇到已占用端口会拒绝启动，不终止其它工作区服务。完成后脚本释放自己的 Chromium 与本地服务。原始数据/视频/失败 trace 在 `.review/p1-5-c/`，可通过清单核实。
