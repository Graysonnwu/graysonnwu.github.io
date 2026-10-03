import test from 'node:test';
import assert from 'node:assert/strict';
import { parseASS, parseTime, updateASS, validateEvents } from '../src/ass-document.mjs';

const standard = '[Script Info]\r\nPlayResX: 1920\r\n[V4+ Styles]\r\nFormat: Name, Fontname\r\nStyle: Default,Arial\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\nComment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,KEEP\r\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,  Hello, world!  \r\n';

test('untouched ASS is byte-identical including BOM, CRLF, commas and Text whitespace', () => {
  const source = '\uFEFF' + standard;
  const doc = parseASS(source);
  assert.equal(doc.events[0].text, '  Hello, world!  ');
  assert.equal(updateASS(doc, doc.events), source);
});

test('editing Text keeps styles, comments, unknown fields and line endings', () => {
  const doc = parseASS(standard);
  const edited = [{ ...doc.events[0], text: '{\\c&H123456&}你好,世界' }];
  assert.equal(updateASS(doc, edited), standard.replace('  Hello, world!  ', '{\\c&H123456&}你好,世界'));
});

test('reordered event Format is honored and custom fields survive editing', () => {
  const source = '[Events]\nFormat: Style, CustomField, End, Start, Text, Layer\nDialogue: Fancy,KEEP,0:00:03.00,0:00:01.00,A,B,C,9';
  const doc = parseASS(source), event = doc.events[0];
  assert.equal(event.layer, '9');
  assert.equal(event.text, 'A,B,C');
  assert.equal(updateASS(doc, [{ ...event, start: '0:00:02.00' }]), source.replace('0:00:01.00', '0:00:02.00'));
});

test('multiple Format lines use each event original format', () => {
  const source = '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:01.00,0:00:02.00,one\nFormat: Text, End, Start\nDialogue: two,0:00:04.00,0:00:03.00';
  const doc = parseASS(source);
  assert.equal(updateASS(doc, doc.events.map(event => ({ ...event, text: event.text.toUpperCase() }))), source.replace('one', 'ONE').replace('two', 'TWO'));
});

test('section and format names are case insensitive', () => {
  const doc = parseASS('[eVeNtS]\nformat: start,end,text\ndialogue: 0:00:01.00,0:00:02.00,x');
  assert.equal(doc.events.length, 1);
  assert.equal(doc.events[0].id, 2);
  assert.equal(doc.events[0].start, '0:00:01.00');
});

test('table newlines become ASS line breaks without adding an event', () => {
  const doc = parseASS(standard);
  const out = updateASS(doc, [{ ...doc.events[0], text: 'a\r\nb\nc' }]);
  assert.equal(parseASS(out).events[0].text, 'a\\Nb\\Nc');
  assert.equal(parseASS(out).events.length, 1);
});

test('editing incomplete times is safe; invalid intervals are reported', () => {
  for (const value of ['', '0:', undefined, '0:60:00.00', '0:00:60.00', '0:00:01.1234']) assert.ok(Number.isNaN(parseTime(value)));
  assert.equal(parseTime('12:34:56.789'), 45296.789);
  assert.equal(validateEvents([{ id: 4, start: '', end: '0:00:01.00' }]).length, 1);
  assert.equal(validateEvents([{ id: 4, start: '0:00:01.00', end: '0:00:01.00' }]).length, 1);
});

test('unknown style names stay selectable', () => {
  const doc = parseASS(standard.replaceAll(',Default,,0', ',MissingStyle,,0'));
  assert.ok(doc.styles.includes('Default'));
  assert.ok(doc.styles.includes('MissingStyle'));
});

test('malformed field counts produce warnings and untouched output is preserved', () => {
  const source = '[Events]\nFormat: Start,End,Text\nDialogue: 0:00:01.00';
  const doc = parseASS(source);
  assert.equal(doc.warnings.length, 1);
  assert.equal(updateASS(doc, doc.events), source);
});

test('non-Text commas and newlines cannot inject additional fields or events', () => {
  const doc = parseASS(standard);
  const out = updateASS(doc, [{ ...doc.events[0], name: 'x,y\nDialogue: bad' }]);
  assert.equal(parseASS(out).events.length, 1);
  assert.equal(parseASS(out).events[0].name, 'xyDialogue: bad');
});
