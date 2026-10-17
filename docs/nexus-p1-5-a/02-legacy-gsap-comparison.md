# Legacy / GSAP 对照报告

## 正式计时结果

下面的“RAF 代理”与“底层回调”不是实际呈现 FPS；P95/P99 也是底层回调间隔。GSAP ticker/Director 是另一列。

| 后端 | 分辨率 | 引擎 | 浏览器 RAF 代理 Hz | 引擎底层回调 Hz | ticker listener 估计 Hz | Director 更新 Hz | 底层间隔 P95/P99 | 回调机会损失 | 降/升档 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SwiftShader | 1080p | Legacy | 60.003 | 60.003 | — | 60.000 | 16.7/16.8ms | 0.000% | 0/0 |
| SwiftShader | 1080p | GSAP | 60.003 | 60.003 | 59.970 | 59.970 | 16.8/16.8ms | 0.000% | 0/0 |
| SwiftShader | 4K | Legacy | 46.684 | 46.684 | — | 46.615 | 50.0/50.1ms | 22.197% | 4/3 |
| SwiftShader | 4K | GSAP | 47.153 | 47.153 | 45.839 | 45.839 | 50.0/50.1ms | 21.416% | 4/3 |
| Metal | 1080p | Legacy | 99.885 | 99.885 | — | 99.849 | 11.0/11.0ms | 0.101% | 0/0 |
| Metal | 1080p | GSAP | 99.978 | 99.978 | 59.977 | 59.977 | 10.9/11.0ms | 0.017% | 0/0 |
| Metal | 4K | Legacy | 99.908 | 99.908 | — | 99.884 | 11.0/11.0ms | 0.084% | 0/0 |
| Metal | 4K | GSAP | 99.987 | 99.987 | 59.959 | 59.959 | 10.9/11.0ms | 0.000% | 0/0 |

每组正式窗口约 60 秒；全部 8 组长任务为 0、TBT 为 0。这不等于绘制/合成没有成本，独立 Trace 明确记录到了 Paint、Composite/Raster 与 GPU Process 活动。

## 解释

1. 在 100Hz Metal 环境，Legacy 跟随浏览器约 100Hz 更新；GSAP 的底层 RAF 也约 100Hz，但 `gsap.ticker.fps(60)` 使 listener/Director 约 60Hz。旧字段如果只写“GSAP 100 FPS”，会直接误导。
2. SwiftShader 4K 的两个引擎都出现相近振荡：低负载档约 60Hz，恢复正常档后约 20–21Hz，再次触发降档。60 秒内均为 4 次降档、3 次恢复。
3. SwiftShader 4K 的平均 Director 更新率 46.615/45.839Hz 被周期性振荡抬高，不能描述正常档体验；时间序列比平均值更重要。
4. Legacy/GSAP 在 SwiftShader 4K 的差值不足以证明任一引擎更快。单机单次样本没有统计显著性；本轮也没有修改实现追求更高数值。
5. Metal 4K 没有触发降档，但仍不能据此承诺 LED 现场、其他浏览器、其他刷新率或长时间运行。

## Main Thread 正式窗口

| 后端/分辨率 | 引擎 | Task | Script | Layout | RecalcStyle |
| --- | --- | ---: | ---: | ---: | ---: |
| SwiftShader 1080p | Legacy | 8.716s | 0.943s | 0.130s | 2.415s |
| SwiftShader 1080p | GSAP | 8.743s | 1.017s | 0.130s | 2.422s |
| SwiftShader 4K | Legacy | 3.868s | 0.691s | 0.102s | 0.486s |
| SwiftShader 4K | GSAP | 3.896s | 0.718s | 0.097s | 0.533s |
| Metal 1080p | Legacy | 14.341s | 1.972s | 0.317s | 4.567s |
| Metal 1080p | GSAP | 8.742s | 1.371s | 0.173s | 2.654s |
| Metal 4K | Legacy | 15.257s | 2.286s | 0.342s | 4.810s |
| Metal 4K | GSAP | 9.251s | 1.511s | 0.186s | 2.747s |

这里 GSAP 的 Task/Layout 等较少，主要与其约 60Hz 更新上限、Legacy 约 100Hz 有关，不能直接写成“同更新率下 GSAP 更省”。P1.5-B 若要比较单位更新成本，应增加受控的同更新频率实验，且不能改变生产默认引擎。

完整结构化数据：[comparison.json](evidence/comparison.json)、[formal-results.json](evidence/formal-results.json)。
