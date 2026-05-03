# ABD 智能锁平台 — 完整需求方案 v2.3

> 版本：v2.3 终版 ｜ 鸿哥已审核 + 技术决策已确认 ｜ 2026-05-02
> 
> 飞书文档：https://feishu.cn/docx/FNxVdPCqoombk1x1gLLcyJOVnBg
> 
> 31项功能 + 3个技术决策，注册→测试→三库→发货→授权→部署→审批全链路

---

## 鸿哥给 Claude 的技术决策（v2.3 新增）

Claude 问了三个问题，鸿哥已回复：

### Q1: 三库如何分离？
**A: 用设备状态区分，不是加字段。** 加新状态值 `repairing`。

| status | 库 |
|---|---|
| `manufactured` | 🏭 新生产 |
| `in_warehouse` | 📦 待移交 |
| `repairing` | 🔧 维修中 |

### Q2: 手动注册走哪个 API？
**A: POST /devices 就行。** 和自动注册共用，手动注册时前端改成手输字段。能注册就行。

### Q3: 维修流程数据结构？
**A: 新建独立表 `device_repair`**，不是只在 device 表加字段。

| 字段 | 说明 |
|---|---|
| device_id | 关联设备 |
| source_company_id | 退回公司 |
| fault_reason | 故障原因 |
| repair_status | 待修/维修中/已修好 |
| repaired_by | 维修员 |
| notes | 备注 |

用途：隔离管理、方便查询、溯源。修好后自动移到待移交区，备注原公司信息自动跟踪。

---

完整需求内容见飞书文档或 docs/requirements-v2.2.md。
