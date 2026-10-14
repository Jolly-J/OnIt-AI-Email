# 数据迁移指南

继承[根级指南](../AGENTS.md)。本目录使用 ESM Knex 迁移，配置在 [knexfile.js](../knexfile.js)。

## 当前结构来源

| 文件 | 内容 |
| --- | --- |
| `20260904000001_init_email_schema.js` | 四张业务表；仅在表不存在时建表，不会修复已存在的旧表 |
| `20260904000002_add_dingtalk_fields_to_users.js` | users 的头像、unionid、联系方式、部门及管理员字段；检查表存在，但未逐列判断 |
| `20260904000003_add_folders_support.js` | email_records.folder 及索引、mail_accounts.folder_uids_json；逐列检查 |

此外 `backend/main.py` 在启动时补 `chat_messages.draft_reply_zh/explanation` 与 `email_records.dingtalk_card_out_track_id/dingtalk_card_status`。只执行 Knex 迁移并不等于已得到当前 ORM 的所有列。

## 执行目标与命令

- `knexfile.js` 固定连接 `backend/email_assistant.db`，使用 WAL、NORMAL，并在 Knex 连接启用 foreign_keys。
- 从根目录 `npm run migrate` 执行 latest；根开发脚本与后端 lifespan 也会执行 latest。它们不是只读命令。
- 从根目录 `npm run migrate:make -- <迁移名称>` 创建迁移文件；文件命名沿用当前时间戳加描述形式。
- 不通过清空 `knex_migrations`、直接重跑旧文件或回滚迁移验证幂等性。前三个 `down()` 为空；rollback 可能改变迁移记录，却不会撤销列/表，后续重跑可能失败。

## 修改规范

- 已应用的迁移作为历史保留；新增增量迁移处理升级，不在旧文件中偷偷改变已有库的预期。
- 先比对实际表/列/索引与 ORM；旧库可能早于 Knex，不能假设 initial 迁移曾重新创建旧表。
- 新迁移需考虑已有字段、默认值、回填、旧记录、锁和删除限制；不要只写 `hasTable` 后声称逐列幂等。
- 结构整理如把启动补列迁入 Knex，需要用户批准后同时更新两处，不借文档任务迁移数据库。
- 验证用明确指定目标的隔离副本和新空库，覆盖升级与首次安装；简单设置后端 `DATABASE_URL` 不会改变 Knex 的目标。

## 密送字段增量迁移

20260918000001_add_bcc_recipients.js 仅增加 email_records.bcc_recipients（TEXT，非空，默认空串）。已有 TEXT 同名列时跳过；缺表或列类型异常直接失败，不重建表、不删除数据、不清空迁移历史。down 直接拒绝，避免丢失密送数据或移除迁移记录。

根目录 `node scripts/test_bcc_migration.mjs` 用独立临时合成库检查旧库升级、新装、重复执行、缺表/类型异常与拒绝回滚，不导入根 Knex 配置、不连接主库。主库升级须先一致性备份并明确目标，不能用仅设置 DATABASE_URL 的方式隔离 Knex。
