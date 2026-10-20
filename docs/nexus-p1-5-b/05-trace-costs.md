# 相同 60Hz 独立 Trace 成本

每组约 8 秒独立 Trace、3 次重复，和正式频率计时分开。表中为 inclusive event duration 中位数 `[IQR]`；事件存在嵌套和跨线程重叠，禁止相加为总耗时。GPU Process 时间不是 GPU 利用率、功耗或实际呈现帧率。

| 后端 | 分辨率 | 引擎 | Script/动画 | Layout/Style | Paint | Composite/Raster | GPU Process |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 无头 SwiftShader | 1080p | Legacy | 0.167s [0.011] | 0.279s [0.004] | 0.665s [0.006] | 6.319s [0.035] | 25.229s [0.167] |
| 无头 SwiftShader | 1080p | GSAP | 0.173s [0.004] | 0.283s [0.003] | 0.678s [0.003] | 6.405s [0.007] | 25.246s [0.277] |
| 无头 SwiftShader | 4K | Legacy | 0.108s [0.010] | 0.096s [0.004] | 0.238s [0.007] | 4.452s [0.069] | 70.477s [3.765] |
| 无头 SwiftShader | 4K | GSAP | 0.108s [0.008] | 0.097s [0.002] | 0.238s [0.003] | 4.496s [0.070] | 70.583s [1.527] |
| 有头 Metal | 1080p | Legacy | 0.193s [0.027] | 0.285s [0.006] | 0.804s [0.160] | 0.508s [0.023] | 12.815s [0.900] |
| 有头 Metal | 1080p | GSAP | 0.190s [0.009] | 0.273s [0.016] | 0.764s [0.066] | 0.512s [0.012] | 13.202s [0.534] |
| 有头 Metal | 4K | Legacy | 0.217s [0.039] | 0.305s [0.022] | 0.872s [0.133] | 0.543s [0.033] | 12.251s [0.879] |
| 有头 Metal | 4K | GSAP | 0.223s [0.019] | 0.303s [0.012] | 0.838s [0.049] | 0.534s [0.018] | 12.327s [0.558] |
| 有头 SwiftShader | 1080p | Legacy | 0.176s [0.006] | 0.266s [0.008] | 0.665s [0.011] | 6.326s [0.069] | 21.590s [0.177] |
| 有头 SwiftShader | 1080p | GSAP | 0.177s [0.003] | 0.268s [0.005] | 0.665s [0.025] | 6.347s [0.028] | 21.550s [0.152] |
| 有头 SwiftShader | 4K | Legacy | 0.149s [0.004] | 0.230s [0.005] | 0.560s [0.006] | 10.184s [0.073] | 76.411s [1.570] |
| 有头 SwiftShader | 4K | GSAP | 0.156s [0.003] | 0.216s [0.006] | 0.521s [0.007] | 9.664s [0.025] | 67.913s [2.276] |

## 解读

- 同一后端/分辨率/60Hz 目标下，Legacy 与 GSAP 的 Script、Layout、Paint、Composite/Raster 大体接近；差异与 IQR 同量级时不判定优劣。
- 无头 SwiftShader 4K 的调用频率约 21Hz，因而 Main/Script/Paint 累计值较低不代表更流畅；Composite/Raster 与 GPU 事件仍很重。
- Metal 的 Composite/Raster inclusive 时间远低于 SwiftShader；这与正式矩阵的稳定 60Hz 一致，但不能只凭 Trace 事件归因到某个单一 CSS/SVG 模块。
- 有头 SwiftShader 4K 仍有高 Composite/Raster/GPU 成本，说明运行模式改善了调度，但没有把软件后端变成硬件加速。

完整 36 个 Trace 摘要、P95/P99 和每组离散度见 `evidence/trace-analysis.json`；原始 `.trace.json.gz` 留在 `.review/p1-5-b/` 并由 manifest 记录 SHA-256。
