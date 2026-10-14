/**
 * 增量数据迁移：为 users 表扩充钉钉组织与管理员权限字段
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable('users');
  if (hasUsersTable) {
    await knex.schema.alterTable('users', (table) => {
      // 安全幂等添加字段
      table.string('avatar', 512).defaultTo('');
      table.string('unionid', 64).nullable();
      table.string('mobile', 32).defaultTo('');
      table.string('email', 128).defaultTo('');
      table.string('job_number', 64).defaultTo('');
      table.string('department_id', 64).nullable();
      table.string('department_name', 128).defaultTo('');
      table.boolean('is_admin').defaultTo(false);
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  // 杜绝破坏性回滚
}
