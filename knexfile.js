import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  client: 'sqlite3',
  connection: {
    filename: path.resolve(__dirname, 'backend/email_assistant.db'),
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, cb) => {
      conn.run('PRAGMA foreign_keys = ON;', () => {
        conn.run('PRAGMA journal_mode = WAL;', () => {
          conn.run('PRAGMA synchronous = NORMAL;', cb);
        });
      });
    },
  },
  migrations: {
    directory: path.resolve(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
};
