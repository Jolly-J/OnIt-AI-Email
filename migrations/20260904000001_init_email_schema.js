/**
 * 初始数据架构迁移脚本 (Knex 管理)
 * 核心安全准则：
 * 1. 使用 hasTable 幂等探测，绝不覆盖或重置已有数据；
 * 2. 所有外键均配置 onDelete('RESTRICT')，彻底杜绝级联删除；
 * 3. down 脚本严禁做破坏性 dropTable，保护生产业务数据资产。
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // 1. 员工用户表
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username', 64).notNullable().unique();
      table.string('hashed_password', 255).notNullable();
      table.string('display_name', 64).defaultTo('');
      table.string('dingtalk_userid', 64).nullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. 邮箱绑定配置表（外键绑定用户，使用 RESTRICT 拦截误删）
  if (!(await knex.schema.hasTable('mail_accounts'))) {
    await knex.schema.createTable('mail_accounts', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('provider', 32).defaultTo('custom');
      table.string('name', 64).defaultTo('');
      table.string('email_address', 128).notNullable();
      table.string('encrypted_password', 255).notNullable();
      table.string('imap_host', 128).notNullable();
      table.integer('imap_port').defaultTo(993);
      table.boolean('imap_ssl').defaultTo(true);
      table.string('smtp_host', 128).notNullable();
      table.integer('smtp_port').defaultTo(465);
      table.boolean('smtp_ssl').defaultTo(true);
      table.boolean('is_active').defaultTo(true);
      table.timestamp('last_sync_at').nullable();
      table.string('last_uid', 64).defaultTo('0');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. 邮件记录表（外键绑定用户与邮箱，使用 RESTRICT 拦截误删）
  if (!(await knex.schema.hasTable('email_records'))) {
    await knex.schema.createTable('email_records', (table) => {
      table.increments('id').primary();
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.integer('account_id').notNullable().references('id').inTable('mail_accounts').onDelete('RESTRICT');
      table.string('uid', 64).nullable();
      table.string('message_id', 255).nullable();
      table.string('subject', 512).nullable();
      table.string('sender', 255).notNullable();
      table.text('to_recipients').nullable();
      table.text('cc_recipients').nullable();
      table.string('sent_date', 64).nullable();
      table.text('body_text').nullable();
      table.text('body_html').nullable();
      table.string('language_detected', 32).defaultTo('en');
      table.text('summary_zh').nullable();
      table.text('key_points_json').nullable();
      table.text('action_items_json').nullable();
      table.text('ai_guided_question').nullable();
      table.text('initial_reply_draft').nullable();
      table.boolean('is_read').defaultTo(false);
      table.string('status', 32).defaultTo('inbox');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 4. AI 多轮对话表（外键绑定邮件与用户，使用 RESTRICT 拦截误删）
  if (!(await knex.schema.hasTable('chat_messages'))) {
    await knex.schema.createTable('chat_messages', (table) => {
      table.increments('id').primary();
      table.integer('email_id').notNullable().references('id').inTable('email_records').onDelete('RESTRICT');
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('role', 16).notNullable();
      table.text('content').notNullable();
      table.text('draft_reply').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  // 严格杜绝破坏性回滚删除业务数据表
}
