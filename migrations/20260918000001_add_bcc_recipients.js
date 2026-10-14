/** Additive upgrade only: preserve existing mail, tables and migration history. */
export async function up(knex) {
  if (!(await knex.schema.hasTable('email_records'))) {
    throw new Error('email_records is missing; stop and check the database target');
  }
  if (await knex.schema.hasColumn('email_records', 'bcc_recipients')) {
    const columns = await knex.raw('PRAGMA table_info(email_records)');
    const column = columns.find((item) => item.name === 'bcc_recipients');
    if (column?.type?.toUpperCase() !== 'TEXT') {
      throw new Error('bcc_recipients has an unexpected type; no changes made');
    }
    return;
  }
  await knex.schema.alterTable('email_records', (table) => {
    table.text('bcc_recipients').notNullable().defaultTo('');
  });
}

export async function down() {
  throw new Error('Destructive rollback is disabled; retain bcc_recipients and migration history');
}
