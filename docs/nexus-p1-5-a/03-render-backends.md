# 软件 / Metal 渲染后端记录

## 共同环境

- Chromium `153.0.8010.12`
- macOS Darwin `24.6.0`，arm64
- Apple M1 Ultra，20 个逻辑 CPU，64GiB 内存
- Node `v24.21.0`
- 物理显示器：`27E2N1110`，`1920×1080 @ 100.00Hz`（刷新率从 `system_profiler` 分辨率字符串解析）
- 视口：1920×1080 / 3840×2160，DPR=1
- 完整浏览器命令行、GPU feature status、WebGL 信息见 [backend-records.json](evidence/backend-records.json)。不在文档中删减后声称为完整参数。

## SwiftShader 软件后端

- `headless=true`
- SystemInfo device：`ANGLE (Google, Vulkan ... SwiftShader Device ...), SwANGLE 5.0.0`
- WebGL unmasked renderer 同样指向 SwiftShader
- 分类：软件渲染，置信度高
- 空白页 RAF 调度估计约 60Hz；这不是物理显示刷新率。无头环境的实际呈现帧率不可获取，标为未知。

## ANGLE Metal 硬件后端

- `headless=false`
- SystemInfo device：`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Ultra, Version 15.7.8)`
- WebGL unmasked renderer：`ANGLE Metal Renderer: Apple M1 Ultra`
- 分类：硬件渲染，置信度高
- 空白页 RAF 调度估计约 100Hz，与 `system_profiler` 的 100Hz 报告一致；仍不能据此断言每个 RAF 均实际呈现。

Playwright 命令行含有允许 SwiftShader 备用的参数，但有头运行的实际 SystemInfo/WebGL renderer 均为 Metal。分类逻辑以实际 renderer/device 证据为准，不因“允许备用”参数误判成软件渲染。

## Trace 成本摘要

每项为约 10 秒独立 Trace 的 inclusive event duration；事件可能嵌套和跨线程重叠，不能相加，也不能与正式窗口横向做绝对值比较。

| 后端 | 场景 | Renderer Main | Script/动画 | Layout/Style | Paint | Composite/Raster | GPU Process |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SwiftShader | Legacy 1080p | 10.137s | 0.346s | 0.588s | 1.088s | 10.338s | 32.391s |
| SwiftShader | GSAP 1080p | 10.238s | 0.367s | 0.570s | 1.069s | 10.388s | 31.779s |
| SwiftShader | Legacy 4K | 5.015s | 0.218s | 0.120s | 0.495s | 4.609s | 32.745s |
| SwiftShader | GSAP 4K | 4.914s | 0.223s | 0.116s | 0.477s | 4.671s | 32.193s |
| Metal | Legacy 1080p | 14.679s | 0.521s | 0.987s | 1.899s | 1.078s | 32.892s |
| Metal | GSAP 1080p | 8.732s | 0.374s | 0.567s | 1.068s | 0.683s | 18.382s |
| Metal | Legacy 4K | 15.495s | 0.595s | 1.024s | 1.997s | 1.123s | 33.258s |
| Metal | GSAP 4K | 9.284s | 0.398s | 0.586s | 1.118s | 0.700s | 17.750s |

GPU Process 时长大于墙钟时长，是因为跨线程/嵌套 inclusive 事件被累计；绝不能把它解释为“GPU 使用率超过 100%”。完整事件分组与 top events 见 [trace-summary.json](evidence/trace-summary.json)。
