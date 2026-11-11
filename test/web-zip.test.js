import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createZip, crc32 } from '../web/src/zip.js';

const enc = (s) => new TextEncoder().encode(s);

test('crc32 matches the published check value', () => {
  assert.equal(crc32(enc('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('the archive is deterministic', () => {
  const entries = [{ path: 'a.txt', data: enc('hello') }];
  assert.deepEqual(createZip(entries), createZip(entries));
});

test('an independent reader finds every entry with a valid CRC and the same bytes', () => {
  const entries = [
    { path: 'index.html', data: enc('<!doctype html>\r\n<p>hi</p>\r\n') },
    { path: 'js/app.js', data: enc('const a = 1;\n') },
    { path: 'img/pixel.bin', data: new Uint8Array([0, 1, 2, 255, 254, 253]) },
    { path: 'empty.txt', data: new Uint8Array(0) },
    { path: 'dir/ñandú ✓.txt', data: enc('unicode name') },
  ];
  const zip = createZip(entries);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // End of central directory is the last 22 bytes (no comment).
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  assert.equal(count, entries.length);

  let p = dv.getUint32(eocd + 16, true);
  const read = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(localOffset, true), 0x04034b50);
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + lNameLen;
    const data = zip.subarray(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    read.push({ name, data });
    p += 46 + nameLen;
  }
  assert.deepEqual(read.map((r) => r.name), entries.map((e) => e.path));
  read.forEach((r, i) => assert.deepEqual(Buffer.from(r.data), Buffer.from(entries[i].data)));
});

test('the system archiver extracts the same files (bsdtar, when available)', (t) => {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0 || !/bsdtar/i.test(probe.stdout)) {
    t.skip('bsdtar not available');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-zip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entries = [
    { path: 'a/b.js', data: enc('const x = 1;\r\n') },
    { path: 'c.txt', data: enc('text') },
  ];
  fs.writeFileSync(path.join(dir, 'x.zip'), createZip(entries));
  const res = spawnSync('tar', ['-xf', 'x.zip', '-C', 'out'], { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) {
    fs.mkdirSync(path.join(dir, 'out'));
    const retry = spawnSync('tar', ['-xf', 'x.zip', '-C', 'out'], { cwd: dir, encoding: 'utf8' });
    assert.equal(retry.status, 0, retry.stderr);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'a', 'b.js'), 'utf8'), 'const x = 1;\r\n');
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'c.txt'), 'utf8'), 'text');
});
