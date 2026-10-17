# 全平台动效技术清单

本轮只读审计三份已检出的平台仓库，不声称覆盖服务器正在部署的版本或 GitHub 未检出的分支。CRM HEAD `5d6941e`，桌面 HEAD `479a482`，NEXUS 基线/诊断 HEAD `1f9e9cd`。原 PoC 与 P1.3 均为干净工作区。精确版本与命中文件哈希在 [source-versions.json](source-versions.json)，逐行证据在 [source-index.md](source-index.md)。索引保留打印、PDF 等误命中，不把它们冒充动画。

路径前缀：`C` = `/Users/apple/Desktop/Codex/machinery-crm`；`D` = `/Users/apple/Desktop/Codex/machinery-crm-desktop`；`N` = 当前独立诊断 worktree。下表路径均为相对对应仓库的真实路径，完整可点击路径在索引中。

## 实际目录结构与审计边界

- CRM：`src/app` 路由、`src/components` 展示/交互、`src/modules` 业务；`prisma` 数据；`public/vendor/leaflet` 是随仓库分发的地图第三方运行时。组件名仍叫 amap-shipment-map，但代码加载 Leaflet 与天地图代理，不能按文件名误判。
- 桌面：`src` React renderer、`electron` 主进程、`index.html` Vite入口；测试在 `test`，未发现独立 apps/packages 动画工程。
- NEXUS：`src/app`、`src/components/screen`、`src/components/overlay`；`services` 为语音服务；`public/voice` 包含音频 worklet/KWS worker 和第三方 WASM 胶水，音频处理调度不属于视觉 RAF；`scripts/e2e/docs` 为工具、测试、说明。
- `public/vendor/leaflet/leaflet.js` 为第三方分发代码，库内部也有地图交互/缩放帧调度。只登记依赖边界，不将其内部每个 RAF 都迁移到 GSAP。PDF/WASM/Leaflet/Spline 第三方内部未做完整运行时泄漏审计。目录清单在原始证据 `structure.json`。

## 依赖、插件与实际入口

| 范围 | 声明 / 锁定 | 插件 / 初始化 | 实际调用关系 |
| --- | --- | --- | --- |
| CRM | `gsap ^3.15.0` / lock 3.15.0；`@gsap/react ^2.1.2` / lock 2.1.2 | `src/lib/motion/config.ts:1–8` 注册 CustomEase、命名 spring；10 个 useGSAP 调用文件各自注册 React hook | 页面 → MotionPage / StaggerContainer / AnimatedNumber → config；业务亮显、生命周期、弹窗、侧栏直接 useGSAP |
| 桌面 | `gsap ^3.15.0` / package-lock 3.15.0 | `src/lib/motion.ts:2–12` 注册 CustomEase | Sidebar 导入 SPRING_CSS，带入 GSAP 配置模块；**没有找到 gsap.to/fromTo/timeline 动画调用**。有依赖不等于已使用 GSAP 编排 |
| NEXUS PoC | `gsap 3.15.0`，无 @gsap/react | 无额外 GSAP 插件；`GsapMotionProvider.tsx` 懒加载；`GsapScene.ts` 创建暂停且脱离 root 的 proxy timelines | `page.tsx:13` 依 motion 参数选 Experience → MotionProvider/GSAP provider → Director → useSceneMotion → GsapScene（可选）→ 同一 DOM/Canvas writer |

未发现项目自写的 ScrollTrigger、Flip、MotionPathPlugin、Lottie、Framer Motion、react-spring 调用。CRM 的 Spline 是实际挂载的第三方 3D 运行时；本轮不反编译其渲染内核，不宣称已审计它的内部 RAF/GPU 资源管理。

## 动画模块登记

“清理存在”是静态代码证据，不自动等于已完成该模块的运行时泄漏验证。“保留 CSS”也属于统一架构边界：统一编排，不要求每个 hover 都改成 timeline。

| 模块 / 业务 | 实际代码位置 | 技术 / 作用 | 触发来源 | 生命周期 | 属性所有权 | 后续建议 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CRM 页面入场 | C `src/components/motion/MotionPage.tsx:25–79` | GSAP opacity/y | 挂载、enabled/delay、reduced | useGSAP scope；revertOnUpdate | wrapper transform/opacity | 保留并接 scope 接口 | 页面 wrapper 和子层应分开写属性 |
| CRM 卡片错峰 | C `src/components/motion/StaggerContainer.tsx:24–67` | GSAP opacity/y/scale/stagger | 挂载、delay/reduced | useGSAP 自动 context 清理 | 容器直接 children | 保留；补写入约定 | 直接 child 本身有 hover transform 时须检查 |
| CRM 通用数字 | C `src/components/motion/AnimatedNumber.tsx:46–96` | GSAP proxy→React setState | 实际目标数变化/首次入场 | kill + context revert | proxy.value；React owns text | 共享编排；先测再决定 DOM sink | 每帧 React 更新；业务最终值独立 |
| 客户生命周期 | C `src/components/customers/customer-lifecycle-bar.tsx:56–168` | GSAP progress scaleX、节点入场/强调 | customer/status变化 | scoped context；模块 Map 记忆客户阶段 | 进度/节点 transform opacity | 保留状态与 Map 语义，接统一 scope | React 初值 transform + GSAP 后续所有权；Map 无上界属缓存审查项 |
| 线索指派亮显 | C `src/components/leads/lead-list-client.tsx:104–148`、`lead-detail-client.tsx:115–156` | GSAP opacity 淡退 | 成功指派后的 run/id | useGSAP revertOnUpdate | 单独 highlight span | 保留，不迁移指派业务计算 | 不得把 onComplete 当业务成功标记 |
| ERP 齐套 / 采购亮显 | C `src/app/(app)/erp/production-orders/[id]/page.tsx:95–190` | GSAP rows opacity/y、highlight opacity | 齐套检查 replay、采购成功反馈 | run 去重；超行数静态；context 清理 | 行 wrapper / highlight | 保留已有限制与权限业务 | 动画结束回调不能成为工单/库存状态来源 |
| CRM 弹窗 / 确认框 | C `src/components/ui/dialog.tsx:40–78`、`confirm-dialog.tsx:48–87` | GSAP 同步遮罩、面板缩放平移 | open/reduced | context revert；focus RAF取消、监听器清理 | 遮罩 opacity、面板 transform opacity | 共享 enter/exit 协议；保留焦点/权限 | 关闭当前直接卸载，无真正 exit 时间轴；不能让退场阻断确认业务 |
| CRM 浮动侧栏 | C `src/components/layout/floating-sidebar.tsx:145–198,265–274,429–432` | GSAP 标签 opacity + CSS 宽度 | 折叠状态机、width transitionend | context；transition fallback timer | GSAP 标签 opacity；CSS aside width/箭头 transform | 保留状态机；统一编排适配 | 属性分工基本明确；reduced 需收敛到最终状态 |
| 小川 hero/对话切换 | C `src/components/xiaochuan/XiaochuanChat.tsx:209–219` | GSAP opacity/y/scale | messages 从空到非空 | 普通 useEffect，**未 return kill/context.revert** | viewRef wrapper | 优先补 context 生命周期 | 450ms 转场可跨卸载/偏好切换继续；静态风险，未在登录运行态复现 |
| 小川 3D | C `src/components/xiaochuan/spline-scene.tsx:5–31`；Chat:752、login:199挂载 | lazy Spline / 3D；spinner CSS | 页面/hero挂载 | React lazy/Suspense；内部资源待查 | Spline owns Canvas/3D scene | 保留渲染器；仅接可见性契约 | 远端 scene、运行时体积、后台循环未知；不能混称 NEXUS WebGL |
| 小川追光 | C `src/components/xiaochuan/spotlight.tsx:20–64` | mousemove + React + CSS opacity | 指针 | 注册/移除 parent listener | left/top；CSS opacity | 保留；如实测频繁提交再节流 | 每次事件读 bounds、更新 React；尚未测为热点 |
| CRM 天地图流光 | C `src/components/maps/amap-shipment-map.tsx:223–447,501` | Leaflet marker RAF + CSS pulse | 地理编码、shipments变化 | token/active guards；cancel RAF、map.remove | Leaflet owns marker position；CSS marker pulse | 保留地图；接统一时钟适配可后置 | 一张图一个独立持续 RAF；未监听 hidden/reduced；fit timeout未取消但有guard |
| CRM 内嵌销售屏数字 | C `src/components/screen/AnimatedNumber.tsx:28–53` | 每实例原生 RAF textContent | value变化 | cleanup cancel；只读系统 reduced | span textContent | 数字 tween 优先统一，但保留真实最终值 | 多个数字可有多条RAF；format依赖变化可重启 |
| CRM 内嵌屏地图/状态灯 | C `src/components/screen/ShipmentMap.tsx`、`HeaderBar.tsx`、`sales-screen.css:397,605–660` | SVG + CSS dash、pulse、factory-core | 挂载/交互 | DOM卸载终止；CSS reduced | CSS owns dashoffset / opacity / r | SVG保留；需要跨模块暂停的循环后迁移 | 与NEXUS是不同实现，不能混用验收结果 |
| CRM 内嵌屏回款环 | C `src/components/screen/TargetRing.tsx:20–74` | 静态 SVG strokeDashoffset | 业务数据 | React render | React owns ring geometry | 保留渲染与服务端口径 | 不为统一GSAP新增无需求动画 |
| CRM 常规交互/骨架 | C `src/app/globals.css:26–36,205`；`src/components/ui/{surface-card,segmented-control,loading-skeleton}.tsx`、layout、customers/products页面等 | CSS/Tailwind hover、active、spin、pulse | hover/active/loading/theme | DOM生命周期；部分 motion-reduce | CSS owns颜色、阴影、独立scale | 保留轻量CSS；建立属性白名单 | 全局button transition覆盖transform/opacity，未来GSAP作用到button时潜在争写 |
| CRM 悬浮宠物/聊天面板 | C `src/components/dachuan-pet/FloatingPet.tsx`、`FloatingPet.module.css:1–202`、`ChatPanel.tsx` | CSS float/greeting/shadow/hover；拖拽React | pointer、mode、未读 | resize监听清理；CSS reduced覆盖循环 | 拖拽 bottom/right；CSS translate/transform | 保留；跨模块收起只接状态协议 | reduced未统一覆盖所有hover transition；blur阴影需实测 |
| CRM焦点/打印调度 | C `ui/{dialog,confirm-dialog}.tsx`、layout/user-menu；ERP inventory/stock-in/stock-out | 一次/双 RAF，**不是动画循环** | open或打印 | 焦点RAF取消；打印双RAF无完整取消 | focus / window.print | 不迁移到GSAP | 不应为了“零RAF”破坏焦点和打印时序 |
| 桌面全局粒子/登录粒子 | D `src/components/ParticleField.tsx:24–106`；`fx.tsx:94–110`；`App.tsx:171`；`LoginView.tsx:67` | Canvas 2D；每实例RAF、O(n²)短距离连线 | 挂载、theme、density | cancel RAF + ResizeObserver disconnect；reduced只在effect开始读一次 | Canvas buffer | 保留Canvas；可接frame订阅 | App登录/已登录分支互斥；每个挂载实例单独RAF；无hidden/动态reduced监听 |
| 桌面数字 | D `src/components/fx.tsx:6–25`、`views/DashboardView.tsx:192` | RAF + React setDisplay | value变化 | cancel RAF | React owns display text | 数字tween适合统一GSAP | 不监听reduced；中途换目标from仍可能是上次完成值 |
| 桌面环图 | D `src/components/fx.tsx:31–90` | timeout触发CSS stroke-dashoffset | pct变化 | clearTimeout；CSS随DOM销毁 | React target；CSS interpolation | 保留或共享编排 | 未单独尊重reduced；不是GSAP环 |
| 桌面登录倾斜 | D `src/views/LoginView.tsx:19–31,76` | 单帧RAF节流 + CSS transform transition | mousemove | 取消前帧与卸载取消；事件时查reduced | RAF写target transform；CSS追随 | 保留交互；不要二次GSAP写同属性 | 目标写入与transition是有意配合，非两个独立tween |
| 桌面CSS入场/氛围/界面 | D `src/styles.css:120–163,331–610`；各views/UI/Sidebar | aurora、page/login/fade、drawer/sheet/dialog/toast/msg、orbit/pulse/caret/logo | 挂载/状态/hover | DOM卸载；全局reduced覆盖情况见索引 | CSS opacity/transform/filter/left | 简单CSS保留；跨模块序列逐步接编排 | blur/全屏氛围成本未测；不要直接删 |
| 桌面GSAP配置 | D `src/lib/motion.ts:2–35` | 仅注册CustomEase/常量 | Sidebar import | 模块级 | 命名ease注册 | 配置统一、避免误报已迁移 | 常量定义未代表动画调用 |
| NEXUS业务导演 | N `src/components/screen/motion/MotionDirector.ts:16–121` | 原生RAF或注入host；INTRO/AMBIENT/PULSE/DEGRADED | 生命周期、数据动画、语音/可见性、性能窗口 | start幂等；dispose清callbacks/listeners并cancel | frame状态/逻辑时钟/显著预算8 | **保留业务调度层** | 性能策略闭环振荡；与绘制实现仍有耦合 |
| NEXUS GSAP host | N `motion/GsapMotionProvider.tsx:9–31` | GSAP ticker adapter | director.request/cancel | attached guard；remove tick；sleep全局 | ticker.fps / ticker.sleep | 改为应用级时钟所有权 | 当前隔离PoC可用，跨模块直接复用会互相停钟 |
| NEXUS GSAP场景 | N `motion/GsapScene.ts:19–50` | 3+2×route数的detached paused timelines | Director按时间seek | 27条（12组合路线）；dispose幂等kill计数 | 仅proxy，不直接写DOM | 适合保留编排实验 | 数量有上界不是零泄漏证明；避免自播+手动seek双驱动 |
| NEXUS入场/共振 | N `motion/useSceneMotion.ts:48–75,91–118`；globals.css:900–943 | Legacy数学或GSAP采样 → CSS vars、SVG attrs | Director state/time | scene register/unregister；返回静止态 | 唯一writer写--intro/--pulse、r、opacity、transform | 可优先统一proxy时间轴 | reset CSS opacity transition与JS target是当前有意交接，不能再加GSAP DOM tween |
| NEXUS主屏粒子 | N `motion/useSceneMotion.ts:20–24,124–132`；`ScreenStage.tsx:35` | 150粒Canvas fillRect；全stage clearRect | 正常档且未暂停且预算允许 | 共用Director，不自建RAF；清canvas | scene ownsCanvas | **保留粒子与Canvas，优先诊断绘制路径** | 正常/低档Canvas显示状态不同，是性能因果候选 |
| NEXUS地图光流/呼吸/标签 | N `screen/ShipmentMap.tsx:26–95`；`useSceneMotion.ts:26–34,83–118`；globals.css:811–820,924–928 | 三SVG层、预采样路径、渐变、椭圆mask、静态DOM标签 | route/focus/pulse/点击/键盘 | 路径采样只在effect建立；unregister/dispose | React初始几何/标签；scene动态attrs；mask CSS | SVG/投影/标签保留；编排可GSAP | 非每帧投影；旧layer2 drop-shadow已被后规则none覆盖，不能当现存热点 |
| NEXUS数据卡/回款盘/扫光 | N `screen/NexusPanels.tsx`；`motion/useSceneMotion.ts:119–123` | SVG dial transform、CSS告警变量、left扫光 | 时间/业务告警/定时 | Director循环 | scene writes ticks/--overdue-alpha/left；React目标值 | 共享编排；left改transform仅在测得需要后 | 告警背景属于paint；扫描left可触发布局，但间歇，不能先认定主因 |
| NEXUS数字 | N `screen/AnimatedNumber.tsx:13–29` | Director注册tween→textContent | **实际业务值变化** | 结束/cleanup unregister；SSR真实最终值 | span textContent；formatter ref | 保留数据语义；可换proxy插值器 | 取消共振/显著预算已验证，不能改成每次render从0滚 |
| NEXUS语音接管 | N `overlay/OverlayStage.tsx:149–167,505–516`；`motion/MotionProvider.tsx:19–34` | 独立600ms几何RAF、CSS500ms淡入淡出；MutationObserver传递voiceActive | voice reducer / phase / resize | RAF取消、监听清理；双RAF第二层ID未保存 | frameRef.geometry vs overlay CSS opacity | 后期GSAP编排适配；保留reducer | 双RAF有卸载竞争风险；多个动画RAF可能并发，基准max1只涵盖主屏 |
| NEXUS粒子核心 | N `overlay/JarvisCore.tsx:99–295,294–709` | Canvas2D RAF；sprites/离屏烘焙；自适应EMA | VoiceFrame状态/幅度 | disposed+cancel RAF；resize清理；reduced静态重绘 | Canvas及内部平滑参数 | **保留渲染**；帧订阅后置 | 独立于主屏降档策略；4K主屏基准未开启voice，不能归因于它 |
| NEXUS答案卡 | N `overlay/AnswerCard.tsx:78–117,142–249`；overlay.css:146,164,232 | RAF线/卡体/描边/打字；CSS宽度/角标/翻页；100ms句段/分页钟 | ANSWER/launchAt/foldAt/audio句段/手动翻页 | disposed+cancel；完成停帧；interval clear；reduced最终态 | RAF transform/opacity/stroke；CSS bar.width；React分页/模板 | 优先只迁移视觉展开折叠；声音/句段保持独立 | launch动画时间与音频播完不能共用GSAP完成事件 |
| NEXUS答案模板/提醒/电平 | N `overlay/cards/{CardMetrics,CompletionRingCard,RegionCard}.tsx`；screen/ReminderRail.tsx:32；overlay/LevelMeter.tsx:20 | SVG静态目标；8秒业务分页、50ms电平计时器 | 卡片数据/页数/音量 | React渲染；interval清理 | 模板数据、分页、meter高度 | 保留；不强迫业务timer进GSAP | 不是持续绘图loop；音量采样非动画完成信号 |
| NEXUS旧样式/未挂载组件 | N globals.css:431,660–713；`TargetRing.tsx`等 | 旧CSS flow/live/factory | 只有匹配DOM时才运行 | DOM生命周期 | 旧class属性 | 标记可达性再整理，非本轮删除 | NEXUS主屏真实地图无map-flow，不能仅凭全文搜索计作并发CSS时钟 |
| PDF/打印/后端误命中 | C `lib/xiaochuan/pdf-page-render.ts`；D `lib/pdf-pages.ts`、`views/erp/print-sheet.tsx`、`electron/main.ts`；C `lib/agent/cad/analyze.ts` | Canvas文档栅格化、打印调度、文本含WebGL等 | 文档/业务操作 | 不属于主屏动画调度 | PDF renderer/print | 排除迁移 | 不能将Canvas出现次数直接当动画负载 |

## 调用关系与六项专项结论

1. **多条独立 RAF 存在**：NEXUS主屏只有一个Director待执行回调；语音核心、答案卡、几何过渡有各自RAF；CRM每个screen AnimatedNumber和Leaflet图、桌面每个ParticleField/CountUp也是独立循环。焦点/打印双RAF是一次性调度。PoC的“max pending=1”不可推广为平台结论。
2. **同属性竞争**：NEXUS reset opacity transition + scene写target opacity、桌面登录 transform transition + RAF目标，是明确的混合实现；当前GSAP只写proxy，不与CSS争写NEXUS DOM。CRM通用button CSS包含transform/opacity、StaggerContainer直接children属性是未来混用风险，当前业务highlight为独立span，未找到已证实的GSAP+CSS双时间轴互相覆盖。客户进度React inline transform与GSAP需要保留初值/运行时交接约定。
3. **卸载后运行**：主要useGSAP/context与NEXUS dispose可找到清理；小川Chat普通effect没清理是明确代码缺口（有界450ms）；OverlayStage双RAF只取消外层是有界竞争风险。没有凭静态代码断言存在无界动画泄漏；软导航实验证据另见内存报告。
4. **重复ticker/timeline**：NEXUS host的attached和Director start guard阻止同host重复add；GsapScene每effect 27条且cleanup dispose；新旧数据刷新会重建场景但不是自动等于累积。运行时核对见内存报告。
5. **全局ticker状态**：三仓库仅NEXUS PoC直接改fps/sleep；CRM/桌面没有找到相关调用。不同网页/桌面进程并不共享同一GSAP实例。**将PoC推广到同一页面多模块时**才会暴露全局停钟风险，不能报告成当前三进程互相干扰。
6. **业务耦合**：Director适合保留INTRO/PULSE/voice优先级/显著预算；useSceneMotion同时承担调度、选中、SVG写入、粒子绘制，拆adapter有维护价值。语音reducer、音频drained、句段、业务快照和金额计算必须继续独立。现有CRM业务run触发动画，不能反过来依赖动画onComplete落业务数据。

所有CSS-only页面与调用位置见完整索引；网页端包装器调用者原始检索保留于 `.review/p1-4/gsap-callers.txt`。本轮未运行CRM登录业务、Spline或Electron GPU实测，因此相应性能与卸载结论限定为源码审计。
