# 大川机床 · 经营指挥舱（一期原型）

独立于 DachuanPro 平台的 CRM 可视化大屏，用于会议室 / 展厅 LED 测试。  
一期只覆盖现有能力：**CRM KPI + 销售目标 + 发货地图**。ERP 车间大屏不在本仓库。

设计规范见 [`docs/screen-design-spec.md`](docs/screen-design-spec.md) —— 字号标尺、配色令牌、
栅格、立体地图做法都在那里，改样式前先读它。

## 怎么看

```bash
pnpm install
pnpm dev
```

浏览器打开：

- [http://localhost:3015/screen/sales](http://localhost:3015/screen/sales) 设计稿 1920×1080，按窗口等比缩放
- [http://localhost:3015/screen/sales?kiosk=1](http://localhost:3015/screen/sales?kiosk=1) 展厅投屏：隐藏光标
- [http://localhost:3015/screen/sales?fit=0](http://localhost:3015/screen/sales?fit=0) 固定 1920×1080，不缩放

Mock 数据接口：`GET /api/screen/crm`

字段形状对齐平台现有 `GET /api/crm/dashboard` 与 `GET /api/crm/sales-targets`，方便测试通过后迁回 v108。

## 这一期有什么

| 区域 | 数据来源 | 说明 |
|---|---|---|
| 左轨 KPI | CRM dashboard stats | 本期合同额 / 回款结构 / 客户 / 发货 / 待处理预警 |
| 中央地图 | shipmentPaths | 滕州工厂 → 客户发光航线，带立体板块与省级热力，不依赖天地图密钥 |
| 地图左右栏 | shipmentPaths | 发货来源、省级排行、状态分布、高度色阶图例（由路由数据实时归并） |
| 右上目标环 | sales-targets | 全公司月度合同额完成率，口径与平台 `visualRate` 一致 |
| 右下发货提醒 | shipmentReminders | 今日应发、7 日内待发、逾期未发 |
| 底部跟进 | recentFollows | 最近 5 条跟进，只读 |

## 架构要点

- **首页是 Server Component**（`src/app/screen/sales/page.tsx`）：数据在服务端取好直接进 HTML，
  首屏不出现黑屏 loading。客户端只负责等比缩放、kiosk 光标与 60s 轮询。
- **地图是手写 SVG，零依赖、零密钥**。国界剪影来自 `src/data/china-raw.json`，
  由 `node scripts/build-china-map.mjs` 生成 `src/data/china-map.json`。
  改了 `scripts/build-china-map.mjs` 的投影参数后必须重新跑一次该脚本。
- **`src/data/*-raw.json` 是纳入版本管理的**（约 2.2MB）—— 它们是上面两个 build 脚本的输入，
  删掉就再也无法重新生成 `china-map.json`。
- 没有引入任何图表库（平台也没有），图表全部手写 SVG + Tailwind。

## 迁回平台时注意

1. 把 `/screen` 做成独立 layout，学 `/xiaochuan` 脱离 AppShell。
2. 把 `page.tsx` 里的 `buildMockScreenPayload()` 换成真实 `getCrmDashboard` /
   `listSalesTargets`，不要另算口径 —— 组件层不需要改动。
3. 权限继续下推：销售看自己区域，外贸按业务线，金额对仓库角色保持隐藏。
   注意**非 SUPER_ADMIN 账号拿不到全公司目标**，kiosk 需要专用账号且 `territories` 要配好。
4. 地理编码走现有 `/api/map/geocode` 并缓存，不要每次全量打天地图。
5. 生产可用 `screen.dachuan.pro` 反代到同一 PM2 服务。

## 开发

```bash
pnpm test     # vitest
pnpm lint     # eslint
pnpm build    # next build
```
