# 8c 阶段 1–2 本地意图分类验收

- 数据源：本仓公开 fixture；真实本机 OpenAI 兼容模型，strict JSON Schema，禁思考，temperature=0。
- 采样：8 条对话台问题 + 原型 13 条问题，各 2 轮，共 42 轮；预热不计入。
- 分类与播报检查通过：42/42。
- 完整分类耗时：P50 **412.9ms**，P95 **462.7ms**；P50 ≤500ms：通过。
- 数字检查：42/42；中文读法检查：42/42。
- 模型不接收业务快照；卡片和显示播报由同一 builder 生成；TTS 读法单独生成。
- 本阶段未接入库存，两条库存提问预期为 unanswerable。此处不代表 ASR、TTS、首音延迟或展厅现场验收。
- 分类计时从适配器调用开始到完整 JSON 解析结束，不含对话台动画或逐字效果。

| 轮次 | 问题 | 预期 | 实际 | 分类耗时 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 本月销售情况怎么样? | sales_progress | sales_progress | 637.2ms | 通过 |
| 1 | 本月目标完成率是多少? | target_rate | target_rate | 463.1ms | 通过 |
| 1 | 各区域发货分布怎么样? | region_shipments | region_shipments | 455.7ms | 通过 |
| 1 | 近期有哪些发货安排? | upcoming_shipments | upcoming_shipments | 469.3ms | 通过 |
| 1 | 本月新增了多少客户? | new_customers | new_customers | 445.5ms | 通过 |
| 1 | 今天有多少跟进待办? | followup_todo | followup_todo | 411.7ms | 通过 |
| 1 | 本月回款情况怎么样? | collection | collection | 388.3ms | 通过 |
| 1 | 华南退货率是多少? | unanswerable | unanswerable | 417.1ms | 通过 |
| 1 | 本月销售情况怎么样 | sales_progress | sales_progress | 397.8ms | 通过 |
| 1 | 这个月卖得咋样 | sales_progress | sales_progress | 403.2ms | 通过 |
| 1 | 目标完成了百分之多少 | target_rate | target_rate | 402.0ms | 通过 |
| 1 | 哪个省发的货最多 | region_shipments | region_shipments | 416.3ms | 通过 |
| 1 | 最近几天有哪些设备要发出去 | upcoming_shipments | upcoming_shipments | 435.6ms | 通过 |
| 1 | 这个月来了几个新客户 | new_customers | new_customers | 413.4ms | 通过 |
| 1 | 今天还有多少客户没跟进 | followup_todo | followup_todo | 413.4ms | 通过 |
| 1 | 钱收回来多少了 | collection | collection | 380.9ms | 通过 |
| 1 | 成品仓还有多少台 | unanswerable | unanswerable | 427.1ms | 通过 |
| 1 | 有没有什么料快不够了 | unanswerable | unanswerable | 419.8ms | 通过 |
| 1 | 华南退货率是多少 | unanswerable | unanswerable | 408.6ms | 通过 |
| 1 | 利润是多少 | unanswerable | unanswerable | 407.5ms | 通过 |
| 1 | 好的谢谢,没有了 | chitchat_or_end | chitchat_or_end | 454.9ms | 通过 |
| 2 | 本月销售情况怎么样? | sales_progress | sales_progress | 398.7ms | 通过 |
| 2 | 本月目标完成率是多少? | target_rate | target_rate | 399.8ms | 通过 |
| 2 | 各区域发货分布怎么样? | region_shipments | region_shipments | 427.0ms | 通过 |
| 2 | 近期有哪些发货安排? | upcoming_shipments | upcoming_shipments | 425.4ms | 通过 |
| 2 | 本月新增了多少客户? | new_customers | new_customers | 409.3ms | 通过 |
| 2 | 今天有多少跟进待办? | followup_todo | followup_todo | 417.1ms | 通过 |
| 2 | 本月回款情况怎么样? | collection | collection | 381.5ms | 通过 |
| 2 | 华南退货率是多少? | unanswerable | unanswerable | 412.4ms | 通过 |
| 2 | 本月销售情况怎么样 | sales_progress | sales_progress | 394.9ms | 通过 |
| 2 | 这个月卖得咋样 | sales_progress | sales_progress | 393.9ms | 通过 |
| 2 | 目标完成了百分之多少 | target_rate | target_rate | 396.4ms | 通过 |
| 2 | 哪个省发的货最多 | region_shipments | region_shipments | 418.7ms | 通过 |
| 2 | 最近几天有哪些设备要发出去 | upcoming_shipments | upcoming_shipments | 440.1ms | 通过 |
| 2 | 这个月来了几个新客户 | new_customers | new_customers | 414.5ms | 通过 |
| 2 | 今天还有多少客户没跟进 | followup_todo | followup_todo | 411.8ms | 通过 |
| 2 | 钱收回来多少了 | collection | collection | 373.7ms | 通过 |
| 2 | 成品仓还有多少台 | unanswerable | unanswerable | 411.8ms | 通过 |
| 2 | 有没有什么料快不够了 | unanswerable | unanswerable | 412.0ms | 通过 |
| 2 | 华南退货率是多少 | unanswerable | unanswerable | 412.4ms | 通过 |
| 2 | 利润是多少 | unanswerable | unanswerable | 417.7ms | 通过 |
| 2 | 好的谢谢,没有了 | chitchat_or_end | chitchat_or_end | 440.9ms | 通过 |
