import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeASS, encodeASS } from '../src/ass-encoding.mjs';
import { parseASS, updateASS } from '../src/ass-document.mjs';
const source = '\uFEFF[Events]\r\nFormat: Start, End, Text\r\nDialogue: 0:00:01.00,0:00:02.00,中文 😀,text\r\n';

test('actual File byte import and export retain the UTF-8 BOM and all bytes', async () => {
  const bytes = encodeASS(source);
  const file = new File([bytes], 'bom.ass');
  // File.text() silently strips this marker; byte decoding must not.
  assert.ok(!(await file.text()).startsWith('\uFEFF'));
  const decoded = decodeASS(await file.arrayBuffer());
  assert.equal(decoded.encoding, 'utf-8');
  assert.equal(decoded.source, source);
  const document = parseASS(decoded.source);
  assert.deepEqual(encodeASS(updateASS(document, document.events), decoded.encoding), bytes);
});

test('UTF-8 without BOM round trips without adding a marker', () => {
  const text = source.slice(1), bytes = encodeASS(text);
  assert.equal(decodeASS(bytes).source, text);
  assert.deepEqual(encodeASS(decodeASS(bytes).source), bytes);
});

for (const encoding of ['utf-16le', 'utf-16be']) {
  test(`${encoding} File import, untouched export and edited text preserve encoding`, async () => {
    const bytes = encodeASS(source, encoding), file = new File([bytes], 'unicode.ass');
    const decoded = decodeASS(await file.arrayBuffer());
    assert.equal(decoded.encoding, encoding);
    assert.equal(decoded.source, source);
    assert.deepEqual(encodeASS(decoded.source, decoded.encoding), bytes);
    const doc = parseASS(decoded.source);
    const out = updateASS(doc, [{ ...doc.events[0], text: '新字幕 🧪,ok' }]);
    assert.equal(decodeASS(encodeASS(out, encoding)).source, source.replace('中文 😀,text', '新字幕 🧪,ok'));
  });
}

test('invalid or legacy encoded input is rejected without replacement characters', () => {
  for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xd6,0xd0,0xce,0xc4]), new Uint8Array([0xff,0xfe,0x00]), new Uint8Array([0x5b,0x00,0x45,0x00])]) {
    assert.throws(() => decodeASS(bytes), /UTF-8/);
  }
});
