# 功能状态

这份文档列出仓库里实际有什么、到什么程度、你能怎么自己核对。

先说清楚它的性质：下面的等级是我读代码和测试文件得出的，**我没有跑过测试**。所以它说明的是"代码里存在什么、测试覆盖到哪里"，不是"跑通了"。想确认能不能跑，自己执行 `npm test`。

这个区别不是文字游戏。这个项目的卖点就是不肯把"没验过"说成"验过了"，那张表也一样。

## 等级

| 等级 | 意思 |
|---|---|
| `COVERED` | 有实现，也有测试文件覆盖；test 文件列在行里 |
| `IMPLEMENTED` | 有实现，没有专门的测试 |
| `DECLARED` | 只有接口或文档声称支持，没有任何东西证明它 |
| `ABSENT` | 没做 |

`DECLARED` 不是弱化版的 `COVERED`。它的意思就是字面意思：软件会说"我支持"，但没人证明过。

## 证据与知识库

| 功能 | 等级 | 依据 |
|---|---|---|
| 中英文概念解析（中文 → 规范 slug） | `COVERED` | `tests/intelligence.test.ts` 别名用例 |
| 概念查询与建站意图查询走不同路径 | `COVERED` | 同上 |
| 事实只追加，不覆盖历史 | `COVERED` | `tests/database.test.ts`；`lib/ingestion.ts` |
| 没有观测数据不显示为"零新鲜度" | `COVERED` | `tests/intelligence.test.ts` |
| 趋势要求两次相隔 24 小时以上的观测 | `COVERED` | `lib/intelligence.ts:109` 的 86400000 判断 |
| 搜不到就返回空，不编结果 | `COVERED` | `tests/browser/acceptance.spec.ts` |
| 来源白名单、抓取限额、逐跳校验重定向 | `COVERED` | `lib/adapters/http.ts`；`tests/hardening.test.ts` |
| 事实与分析在数据层分开存 | `IMPLEMENTED` | `lib/domain.ts` 的 evidence kind 字段 |
| 入库去重 | `IMPLEMENTED` | `lib/ingestion.ts` |
| 语义检索 / 向量检索 | `ABSENT` | 检索只靠规范 ID 和中英文别名匹配 |

## 决策支持

| 功能 | 等级 | 依据 |
|---|---|---|
| 多项目并排比较，事实与分析分开标注 | `IMPLEMENTED` | `lib/intelligence.ts`；`components/frontier-app.tsx` |
| 按查询里的关键词动态生成需求项，算覆盖率 | `COVERED` | `lib/intelligence.ts:142-154`；`tests/intelligence.test.ts` |
| 需求未知时不当作"零覆盖" | `COVERED` | `tests/intelligence.test.ts` |
| 没有集成证据就不给确定推荐 | `COVERED` | `tests/intelligence.test.ts` 的 OpenClaw 用例 |
| 用户技术档案影响相关度排序 | `COVERED` | `tests/intelligence.test.ts` |
| 每日推荐按日期和档案可复现 | `COVERED` | 同上 |
| 对外部运行时做自动兼容性认证 | `ABSENT` | 见 [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md)，只有 `DECLARED` |

## Radar 与来源

| 功能 | 等级 | 依据 |
|---|---|---|
| 7 / 30 / 90 天时间窗切换 | `IMPLEMENTED` | `components/frontier-app.tsx:1608` 的 `[7, 30, 90]` |
| 按事件类型过滤（全部 / 发布 / 变化 / 讨论） | `IMPLEMENTED` | `components/frontier-app.tsx:1095-1100` |
| GitHub Stars 观测值按时间累积 | `IMPLEMENTED` | `lib/adapters/github.ts` |
| 每个来源的抓取时间与失败原因可见 | `IMPLEMENTED` | `lib/adapters/*`，`/api/sources` |
| 手动刷新 | `IMPLEMENTED` | `lib/scheduler.ts`；`POST /api/radar/refresh` |
| 后台定时调度 | `ABSENT` | 任务是按需跑，没有常驻定时器 |
| 每来源的 TTL | `IMPLEMENTED` | `lib/domain.ts` 的 `ttlHours` |

## 账户、隐私、安全

| 功能 | 等级 | 依据 |
|---|---|---|
| `scrypt` 加盐哈希密码 | `COVERED` | `lib/auth.ts`；`tests/hardening.test.ts` |
| 会话令牌只存 SHA-256 摘要，7 天过期 | `COVERED` | `tests/browser/privacy.spec.ts` |
| 两个账号互相读不到、改不了对方档案 | `COVERED` | `tests/browser/acceptance.spec.ts` |
| 删号和个人数据清除会吊销所有会话 | `COVERED` | `tests/browser/privacy.spec.ts` |
| 写请求校验同源 | `COVERED` | `tests/browser/acceptance.spec.ts` |
| 输入校验拦截超长上下文和短密码 | `COVERED` | `tests/intelligence.test.ts` |
| 请求体超 16000 字节直接拒绝 | `IMPLEMENTED` | `app/api/[...path]/route.ts:94` |
| 邮箱验证、找回密码、OAuth | `ABSENT` | 见 [PRIVACY_DATA_LIFECYCLE.md](PRIVACY_DATA_LIFECYCLE.md) |
| 双因素 | `ABSENT` | — |
| 默认关闭开放注册 | `ABSENT` | 注册是开着的，见下面第 1 条 |

## 可选的模型辅助

| 功能 | 等级 | 依据 |
|---|---|---|
| 单一 `LLMProvider` 边界，厂商不外泄 | `IMPLEMENTED` | `lib/llm/provider.ts` |
| 结构化抽取不会凭空造 claim | `COVERED` | `tests/llm.test.ts` |
| claim 为零或多个时 schema 校验失败 | `COVERED` | `tests/llm.test.ts` |
| 每日全局和用户级预算上限 | `COVERED` | `tests/hardening.test.ts` |
| 成本未知时记 NULL 而不是零 | `IMPLEMENTED` | `lib/llm/provider.ts` |
| 自动降级到别的模型 | `ABSENT` | 刻意没做 |
| 自主联网研究 agent | `ABSENT` | 见 [LLM_STRATEGY.md](LLM_STRATEGY.md) |

## 数据与运维

| 功能 | 等级 | 依据 |
|---|---|---|
| 默认内置 PGlite，配了 `DATABASE_URL` 就用标准 PostgreSQL | `COVERED` | `tests/database.test.ts`，`tests/db-lifecycle.test.ts` |
| 迁移失败会释放锁并干净重试 | `COVERED` | `tests/db-faults.test.ts` |
| 已有锁时拒绝启动，不会删锁强开 | `COVERED` | `tests/db-faults.test.ts` |
| 关闭时等待在途操作，拒绝过期句柄 | `COVERED` | `tests/db-lifecycle.test.ts` |
| JSON 备份 / 恢复，恢复拒绝非空库 | `IMPLEMENTED` | `lib/backup.ts`，`scripts/manage.ts` |
| 打包时拒绝各类环境文件和凭据 | `COVERED` | `tests/release-safety.test.ts` |
| 备份加密 | `ABSENT` | 是明文 JSON，自己保管 |
| 多实例部署 | `ABSENT` | PGlite 不允许并发进程 |

## 界面

| 功能 | 等级 | 依据 |
|---|---|---|
| 主流程：首页 → 概念 → 技术卡 → 比较 → 建站判断 → 来源 → 档案 | `COVERED` | `tests/browser/acceptance.spec.ts` |
| 834×1112 视口无横向溢出 | `COVERED` | 同上 |
| 无障碍 | `DECLARED` | `docs/ARCHITECTURE.md` 提过，没有专门的 a11y 测试 |
| 中英以外的界面语言 | `ABSENT` | — |

## 实际存在的 API

`GET /api/{health, me, snapshot, sources, search, card, build, usage}`，`POST /api/auth/{register, login}`。其他路径一律 404，见 `app/api/[...path]/route.ts`。

---

## 容易被说大的几个地方

写在这里是因为它们最容易被误读。

1. **注册是开着的。** `POST /api/auth/register` 不要邀请码也不要邮箱验证，设计前提是只在本机跑。如果把它放到公网而不关掉注册，这是实打实的漏洞，不是理论风险。
2. **OpenClaw / Mem0 / Supermemory 的兼容性只是 `DECLARED`。** 没起过宿主，没写过记忆，没读过记忆。[COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md) 里那一列写的是 `BLOCKED`。
3. **17 个概念、7 个项目就是全部数据。** 范围小到可以手工复核每一条事实，这不是"覆盖了 AI 生态"。
4. **许可证审查是工程判断，不是法律意见**，也不构成商业分发许可。
5. **没有任何生产认证。** 没有外部安全审计，没有压测，没有故障切换测试，没有 SLA。

## 自己想核一遍的话

```bash
npm test                # 上表所有 COVERED，浏览器那几行除外
npm run build
npm start               # 另开一个终端
npm run test:browser
npm run test:postgres   # 需要一个本地 PostgreSQL 实验环境
```

某个检查在你的环境里跑不起来，正确结论是"这里没验证过"，而不是"通过了"。这条规则对这张表本身同样适用。
