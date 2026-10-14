// Synthetic SQLite databases only. Never imports knexfile.js or application configuration.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import knex from 'knex';
import * as migration from '../migrations/20260918000001_add_bcc_recipients.js';
import * as initial from '../migrations/20260904000001_init_email_schema.js';
import * as users from '../migrations/20260904000002_add_dingtalk_fields_to_users.js';
import * as folders from '../migrations/20260904000003_add_folders_support.js';

const directory = await mkdtemp(path.join(tmpdir(), 'mail-bcc-migration-test-'));
const clients = [];
function database(name) {
  const client = knex({ client: 'sqlite3', connection: { filename: path.join(directory, name) }, useNullAsDefault: true });
  clients.push(client);
  return client;
}

try {
  const db = database('upgrade.db');
  for (const step of [initial, users, folders]) await step.up(db);
  await db('users').insert({ id: 1, username: 'synthetic', hashed_password: 'TEST_ONLY' });
  await db('mail_accounts').insert({ id: 1, user_id: 1, email_address: 'test@example.com',
    encrypted_password: 'TEST_ONLY', imap_host: 'mock.invalid', smtp_host: 'mock.invalid' });
  await db('email_records').insert({ id: 1, user_id: 1, account_id: 1, sender: 'test@example.com',
    body_text: 'Preserve this synthetic historical message', cc_recipients: 'cc@example.com' });
  const before = await db('email_records').first();
  const queries = [];
  db.on('query', ({ sql }) => queries.push(sql));
  await db.transaction((trx) => migration.up(trx));
  await db.transaction((trx) => migration.up(trx));
  const after = await db('email_records').first();
  assert.equal(after.bcc_recipients, '');
  delete after.bcc_recipients;
  assert.deepEqual(after, before);
  assert.equal(queries.some((sql) => /\b(drop|delete|truncate)\b/i.test(sql)), false);
  assert.equal(queries.filter((sql) => /alter table/i.test(sql)).length, 1);
  console.log('PASS: old rows preserved, one additive ALTER, repeated upgrade unchanged');

  const fresh = database('fresh.db');
  await fresh.migrate.latest({ directory: path.resolve('migrations') });
  assert.equal(await fresh.schema.hasColumn('email_records', 'bcc_recipients'), true);
  assert.equal((await fresh('knex_migrations')).length, 4);
  await fresh.migrate.latest({ directory: path.resolve('migrations') });
  assert.equal((await fresh('knex_migrations')).length, 4);
  await assert.rejects(fresh.migrate.rollback({ directory: path.resolve('migrations') }), /Destructive rollback/);
  assert.equal((await fresh('knex_migrations')).length, 4);
  console.log('PASS: fresh install and repeat latest; rollback refuses without removing history');

  const missing = database('missing.db');
  await assert.rejects(migration.up(missing), /email_records is missing/);
  assert.equal(await missing.schema.hasTable('email_records'), false);
  const mismatch = database('mismatch.db');
  await mismatch.schema.createTable('email_records', (table) => table.integer('bcc_recipients'));
  await mismatch('email_records').insert({ bcc_recipients: 123 });
  await assert.rejects(migration.up(mismatch), /unexpected type/);
  assert.equal((await mismatch('email_records').first()).bcc_recipients, 123);
  console.log('PASS: missing table / wrong column type stop without repair or deletion');
} finally {
  await Promise.all(clients.map((client) => client.destroy()));
  // Remove only the unique directory this test created, never discover files by extension.
  await rm(directory, { recursive: true });
}
