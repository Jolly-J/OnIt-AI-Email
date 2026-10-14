/**
 * 增量数据迁移：为 email_records 表增加 folder 字段，为 mail_accounts 表增加 folder_uids_json 字段
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  const hasEmailRecords = await knex.schema.hasTable('email_records');
  if (hasEmailRecords) {
    const hasFolder = await knex.schema.hasColumn('email_records', 'folder');
    if (!hasFolder) {
      await knex.schema.alterTable('email_records', (table) => {
        table.string('folder', 32).defaultTo('inbox').index();
      });
    }
  }

  const hasMailAccounts = await knex.schema.hasTable('mail_accounts');
  if (hasMailAccounts) {
    const hasFolderUids = await knex.schema.hasColumn('mail_accounts', 'folder_uids_json');
    if (!hasFolderUids) {
      await knex.schema.alterTable('mail_accounts', (table) => {
        table.text('folder_uids_json').defaultTo('{}');
      });
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  // 杜绝破坏性回滚
}
