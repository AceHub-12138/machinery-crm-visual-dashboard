# P1.6 施工前清单与所有权

基线：`cf1a835fbbc4e3f62311987e23677ea3fb862125`。本地隔离分支；不涉及 Task 11。

| 现有入口 | 属性/数据 | 原所有者 | PoC 所有者 |
|---|---|---|---|
| OverlayStage wake/closing | 业务状态、900/800ms 状态期限 | reducer + hub/deadline | 原样保留，GSAP 无 dispatch 权限 |
| overlay-root | opacity，500ms 接管/退出 | CSS transition | 仅 opt-in 时共享 GSAP 标量写 DOM；关闭时完整 Legacy |
| OverlayStage geometry effect | frame.geometry.core x/y，600ms | 独立 rAF | 仅 opt-in 时 GSAP 插值；Canvas 仍只读取 |
| JarvisCore | Canvas 像素、约 2200 核心/3000 氛围/120 光流粒子 | Canvas rAF | 保留；只消费 GSAP pulse/stream/fold/formation/collapse 标量 |
| params.coreVisual | 呼吸、自转、振幅、状态平滑 | 纯函数 + Canvas approach | 保留；播放振幅与输入振幅分别读取 player/microphone |
| AnswerCard | 水平线、纵向 scale、opacity、SVG stroke | card rAF | opt-in 读共享时间轴；Legacy 原循环保留 |
| AnswerCard | 播报文本/句段高亮 | rAF + PcmPlayer onSentenceStart | 原 PCM 事件保留；GSAP live 路径展开后全文可读 |
| overlay-card-corner/bar-fill | 角标透明度/目标进度条 width | CSS transition | 保留（不同属性/元素），不争夺 |
| card header/data/spoken/followups | 内容各层 opacity/translateY | 原先随 card body 一起出现 | 仅 opt-in 增加分层入场，保留布局与分页 |
| caption | opacity 240ms | CSS animation | opt-in GSAP 接管，禁用该 CSS 动画 |
| barge pause | 外层 card opacity | CSS 80ms | opt-in GSAP 平滑让位；已接受打断短暂保留视觉旧卡折叠，业务卡即时清除 |
| MotionDirector / GsapTickerOwner | 主屏策略/全局 ticker | 现有应用所有者 | 零改动；使用 createGsapHost，组件不调 fps/sleep/wake |

最小层采用 paused GSAP Timeline + 应用已有 ticker host 按 performance.now 绝对时钟 seek。
不使用 GSAP 全局播放时钟推进业务；隐藏时释放 host job，恢复时追上当前视觉阶段而非重播。
每个命名 track 替换先 kill，结束即 kill；订阅、visibility、host job 在卸载释放。
先实现发射/内容/折叠，再扩展接管/返回/几何和打断；不重写 OverlayStage 的 hub/播放器。
