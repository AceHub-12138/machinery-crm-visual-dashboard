# NEXUS GSAP PoC 架构审计（施工前）

基线：10a5e0b283b6ecae664cc64d44f7a9e88fb061f1；独立分支 codex/nexus-gsap-poc。原 codex/nexus-p1-3-visual 工作区干净。2026-10-16。

## 文件、触发和生命周期

| 文件/组件 | 技术与触发 | 生命周期/依赖 |
| --- | --- | --- |
| motion/MotionDirector.ts | 单一 RAF、INTRO 2200ms、AMBIENT、150s 自动 PULSE（10s）、低帧降级 | Provider 挂载 start，卸载 dispose；不可见/语音活跃/reduced 停止；低于45fps持续5s降级，52fps持续10s恢复 |
| motion/MotionProvider.tsx | matchMedia、visibility、overlay data-phase 观察、调试命令 | 监听随 Provider 清理；不改语音状态机 |
| motion/useSceneMotion.ts | 每帧手写 smoothstep/cosine/SVG 属性、Canvas 绘制 | payload 或回调变化重建；保存飞行/轮播调度；注销 scene 回调 |
| ScreenStage.tsx / globals.css | 入场 CSS 变量：背景0、地图300、面板900、动态1500ms，各600ms | intro 结束值1；外层 scale 属于布局，禁止接管 |
| ShipmentMap.tsx / geo、screen-map-* | SVG 三层地图、投影、弧线、遮罩、标签避让、小地图；getPointAtLength预采样101点 | 依赖 layout、routes、activeKey；这些是渲染/几何，不是动画引擎 |
| useSceneMotion 地图 | 8–12s随机1–2飞线（3s飞行+1s到达）；12–15s轮播，点击/聚焦高亮2s；3s原点呼吸 | 数字变化停飞线；低档只1条；语音/不可见/reduced取消并重排调度；PULSE近到远点亮、最多5城波纹 |
| useSceneMotion 非地图 | 150个Canvas粒子、24s表盘、4s逾期呼吸、20–30s标尺扫描 | 全部共享director；最多8显著动效预算；粒子低档关闭 |
| AnimatedNumber.tsx | 数据实际变化后600–1000ms数字插值 | director注册；暂停直接最终值；PULSE取消；不重新解释业务数值 |
| HeaderBar / ScreenExperience | 1s时钟、60s快照轮询 | 业务计时，不属于动画替换范围 |
| overlay / ReminderRail | 语音卡分页/进出及旧版界面提醒翻页 | 不属于本PoC；保持原技术和时钟 |

## 可替换与保留

可直接换：四组入场插值/编排、地图飞行进度/到达/焦点包络、原点呼吸、共振分段包络。保留：SVG路径、投影/标签/遮罩/层偏移、Canvas、业务选择与随机调度、数字及非地图效果。

GSAP只提供插值与时间轴，本轮不引入MotionPath、DrawSVG、ScrollTrigger或其他插件。地图位置继续由同一条SVG弧线预采样点决定，避免插件改变路径/尾迹朝向。

## 属性控制冲突

- intro变量由 Legacy 或 GSAP 单独写，禁止两个引擎同时写。
- 地图 opacity/r/cx/cy/transform 属性仍由一个渲染出口写；GSAP通过时间轴代理值驱动，不与React静态属性同时按帧竞争。
- CSS reset opacity 280ms与JS每帧opacity潜在冲突：暂停时只写一次终态，CSS负责既有回落；GSAP不增加同属性transition。
- SVG分层translateY、stage scale、标签left/top、地图mask均禁止接管。

## 时钟、清理和回退设计

默认无参数为Legacy；显式 ?motion=gsap 通过独立懒加载模块启用。GSAP模式将director的request/cancel适配到GSAP唯一ticker；不保留原生director RAF再叠加GSAP ticker。所有实验时间轴paused、从globalTimeline移除，director手动seek；GSAP ticker只负责统一节拍。暂停/隐藏/reduced无待执行director回调即sleep，恢复无追帧。effect清理kill全部时间轴，Provider卸载移除ticker监听。调试面板提供重启入场及现有取消共振/语音中断。

回退：移除motion参数或切回legacy并重新挂载；懒加载失败显示提示且可切回legacy。不改默认业务入口。

## 测试与影响

业务payload、金额口径、分页时钟、语音协议不改。原动效测试通过Playwright虚拟RAF控制director，GSAP时钟适配须接受同一虚拟performance.now；不能用GSAP墙钟累计替代。补测开关、重启、中断、reduced动态切换、单RAF、时间轴计数、卸载恢复。重跑原NEXUS、动效、P1.3和单测/build/lint。真实时间性能单独测1080p/4K；虚拟时钟长循环只证明状态稳定，不冒充实机长期性能。

参考：GSAP官方 timeline、context/revert 文档（https://gsap.com/docs/v3/GSAP/Timeline/ 、https://gsap.com/docs/v3/GSAP/gsap.context%28%29/）。
