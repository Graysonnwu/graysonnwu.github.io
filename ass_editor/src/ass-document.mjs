/** Lossless ASS table editing. Unchanged lines, comments, line endings and BOM stay intact. */
export const DEFAULT_FORMAT = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
const defaults = { layer: '0', start: '', end: '', style: 'Default', name: '', marginl: '0', marginr: '0', marginv: '0', effect: '', text: '' };

export function parseTime(value) {
  const match = String(value ?? '').trim().match(/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || '0'}`);
}

function splitFields(body, format) {
  const parts = body.split(',');
  const textIndex = format.findIndex(key => key.toLowerCase() === 'text');
  if (parts.length > format.length && textIndex !== -1) {
    const textLength = parts.length - format.length + 1;
    parts.splice(textIndex, textLength, parts.slice(textIndex, textIndex + textLength).join(','));
  }
  return parts;
}

export function parseASS(source) {
  const chunks = String(source).split(/(\r\n|\n|\r)/);
  const events = [], styles = new Set(), warnings = [];
  let section = '', eventFormat = DEFAULT_FORMAT, styleFormat = ['Name'];
  for (let index = 0; index < chunks.length; index += 2) {
    const raw = chunks[index], line = raw.replace(/^\uFEFF/, '').trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1].toLowerCase(); continue; }
    if (!line || line.startsWith(';')) continue;
    const entry = line.match(/^([^:]+)\s*:\s?(.*)$/);
    if (!entry) continue;
    const kind = entry[1].trim().toLowerCase();
    if (kind === 'format') {
      const format = entry[2].split(',').map(key => key.trim()).filter(Boolean);
      if (section === 'events') eventFormat = format;
      if (section === 'v4+ styles' || section === 'v4 styles') styleFormat = format;
      continue;
    }
    if ((section === 'v4+ styles' || section === 'v4 styles') && kind === 'style') {
      const nameIndex = styleFormat.findIndex(key => key.toLowerCase() === 'name');
      const name = entry[2].split(',')[nameIndex]?.trim();
      if (name) styles.add(name);
    }
    if (section !== 'events' || kind !== 'dialogue') continue;
    const prefixMatch = raw.match(/^(\s*Dialogue\s*:\s?)(.*)$/i);
    const values = splitFields(prefixMatch[2], eventFormat);
    const event = { ...defaults, id: index / 2, _chunk: index, _format: [...eventFormat], _values: values, _prefix: prefixMatch[1], _original: {} };
    eventFormat.forEach((field, i) => {
      const key = field.toLowerCase();
      // Text spaces are meaningful, unlike spacing around numeric metadata.
      if (Object.hasOwn(defaults, key)) event[key] = key === 'text' ? (values[i] ?? '') : (values[i] ?? '').trim();
    });
    event._original = Object.fromEntries(Object.keys(defaults).map(key => [key, event[key]]));
    if (values.length !== eventFormat.length) warnings.push(`第 ${event.id + 1} 行字段数量与 Format 不一致`);
    events.push(event);
  }
  events.forEach(event => styles.add(event.style));
  return { source: String(source), chunks, events, styles: [...styles], warnings };
}

export function updateASS(document, editedEvents) {
  const chunks = [...document.chunks];
  for (const event of editedEvents) {
    const changed = Object.keys(defaults).filter(key => event[key] !== event._original[key]);
    if (!changed.length) continue;
    const values = [...event._values];
    for (const key of changed) {
      const position = event._format.findIndex(field => field.toLowerCase() === key);
      if (position < 0) continue;
      let value = String(event[key] ?? '');
      if (key === 'text') value = value.replace(/\r\n|\r|\n/g, '\\N');
      else value = value.replace(/[,\r\n]/g, '');
      values[position] = value;
    }
    chunks[event._chunk] = event._prefix + values.join(',');
  }
  return chunks.join('');
}

export function validateEvents(events) {
  return events.flatMap(event => {
    const start = parseTime(event.start), end = parseTime(event.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [`第 ${event.id + 1} 行时间格式无效（h:mm:ss.cc）`];
    if (end <= start) return [`第 ${event.id + 1} 行结束时间须晚于开始时间`];
    return [];
  });
}
