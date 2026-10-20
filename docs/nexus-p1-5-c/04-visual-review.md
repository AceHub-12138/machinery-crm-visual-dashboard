# 正常负载探测的视觉证据

视频/截图由 `scripts/p1-5-c/visual.mjs` 单独采集，使用有头 Chromium，GPU/后端记录于 [visual.json](evidence/visual.json)。同引擎先完成资源/字体预热；通过 85ms/100ms 短时合成主线程负载触发真实 Candidate 降档/失败探测，随后停止合成负载触发三窗口恢复；没有手动点击质量按钮，没有隐藏地图或删除模块。视频阶段不产出正式性能数字。

矩阵为 Legacy/GSAP × 1280/1792/1920/3840，DPR=1，16:9。每组依次记录 normal、low、probe、failed-low、recover-probe、recovered-normal、reduced-motion。两个 1920 场景额外保留连续视频（编码输出 1280×720，完整视口等比缩放；细节以对应原分辨率 PNG 为准）（开头含资源预热及进入受许可实验的画面），包含 normal → low → probe → low 和 probe → normal。原始视频在 `.review/p1-5-c/visual/videos/`；可审核片段和精选帧见交付的 `media/`。

自动检查所有阶段的地图路径数、航线数、发货行数、粒子 Canvas 存在和业务数字文本一致；probe 的实际渲染档位为 normal。逐帧状态、旅行光点位置和场景时钟保留在结构化证据。地图投影、路线几何、视觉设计、布局、业务数字口径没有改动。

## 人工审核清单

| 项目 | 自动化/代码证据 | 人工审核重点 |
| --- | --- | --- |
| 探测是否明显停顿 | 真实时钟不重置；失败探测尽早回低档 | 在目标设备观看正常负载段是否有可感卡顿；软件渲染超载时探测本身仍可能短暂变慢 |
| 地图航线/发货瞬跳 | probe 切档不重建场景、不 reset 路线；第二光流 280ms 渐退 | 观察在途光点和发货聚焦是否连续 |
| 中断共振 | 探测只在稳定阶段开始，原低档共振拒绝规则保留 | 审核共振与探测调度是否符合展厅节奏 |
| 小川接管/退场冲突 | 真实 overlay 唤醒、speaking、退出专项 | 实机同时播放语音并查看退场后的主屏视觉 |
| 数字/地图闪烁 | 文本和几何不变；没有重置数字 tween | 观察数值、地图底图与标签有无闪烁 |
| 失败回低档突兀 | 280ms 粒子/第二光流渐退；第一在途路线保留进度 | 确认淡出自然，并接受正常负载探测的短暂成本 |

自动通过只代表结构、数值、调度与采集条件满足；人眼结论待用户/架构审核，未宣布“无明显停顿”或展厅 LED 验收完成。尤其软件后端 4K 正常负载确有更新率下降，不能以截图完整替代流畅性判断。


## 审核媒体

- [Legacy 连续探测视频，41.44 秒](media/legacy-probe-cycle.webm)
- [GSAP 连续探测视频，41.56 秒](media/gsap-probe-cycle.webm)

| 引擎 | normal | 失败探测开始 | failed low | 恢复 normal | 4K 完整正常负载 probe |
| --- | --- | --- | --- | --- | --- |
| Legacy | [截图](media/legacy-1920-normal.png) | [截图](media/legacy-1920-probe.png) | [截图](media/legacy-1920-failed-low.png) | [截图](media/legacy-1920-recovered-normal.png) | [截图](media/legacy-3840-recover-probe.png) |
| GSAP | [截图](media/gsap-1920-normal.png) | [截图](media/gsap-1920-probe.png) | [截图](media/gsap-1920-failed-low.png) | [截图](media/gsap-1920-recovered-normal.png) | [截图](media/gsap-3840-recover-probe.png) |

56 张原始截图的开始/结束状态均保留。两张 4K **失败**探测截图在截图期间从 probe 转为 low，因此只作为过渡证据，不标作纯 probe 静态图；同分辨率的 `recover-probe` 截图开始/结束均为 probe，可核实完整正常负载。连续视频与结构化序列用于动态审核，静态图不能证明没有停顿。

normal/probe 保留正常粒子绘制；low/static 仍遵守既有保护档粒子规则，Canvas 组件没有被删除。所有档位都保留地图和航线路径。软件/人工严重负载时正常负载探测本身会降低更新频率，这一成本需要人工接受，不能把自动结构检查当作“切换完全无感”。
