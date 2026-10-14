// Pure frontend validation tests; no browser, service, credentials or database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = requireFrontend('typescript');
const source = await readFile(new URL('../frontend/src/lib/mailRecipients.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { normalizeRecipients } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.deepEqual(normalizeRecipients('Alice <a@EXAMPLE.com>；b@example.com', 'a@example.com，c@example.com', 'c@example.com;d@example.com'),
  { to_email: 'a@example.com, b@example.com', cc_email: 'c@example.com', bcc_email: 'd@example.com' });
assert.equal(normalizeRecipients('"Doe, Jane" <Jane@example.com>;jane@example.com').to_email, 'Jane@example.com, jane@example.com');
for (const bad of ['bad', 'a@example.com\r\nBcc: injected@example.com', 'a@bad..com', 'a@-bad.com', 'a b@example.com', '<broken>']) {
  for (let index = 0; index < 3; index++) {
    const values = ['a@example.com', '', ''];
    values[index] = bad;
    assert.throws(() => normalizeRecipients(...values));
  }
}
assert.throws(() => normalizeRecipients('', '', 'private@example.com'));
console.log('PASS: frontend address normalization, deduplication, quoted names and invalid input in all three fields');
