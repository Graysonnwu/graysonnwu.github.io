// CSV dates are Beijing calendar days, not instants in the visitor's timezone.
const DAY_MS = 86_400_000;

export function parseCalendarDay(value) {
  const date = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return { date, timestamp };
}

export function normalizeFollowers(rows) {
  const unique = new Map();
  for (const row of rows) {
    const day = parseCalendarDay(row.date);
    const value = String(row.follower ?? '').trim();
    if (!day || !/^\d+$/.test(value)) continue;
    const follower = Number(value);
    if (!Number.isSafeInteger(follower)) continue;
    // The repository CSV is newest first, including repeated same-day runs.
    if (!unique.has(day.date)) unique.set(day.date, { ...day, follower });
  }
  const data = [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  return data.map((point, index) => {
    const previous = data[index - 1];
    const intervalDays = previous ? (point.timestamp - previous.timestamp) / DAY_MS : null;
    const change = previous ? point.follower - previous.follower : null;
    const avgChange = previous ? Math.round(change / intervalDays) : null;
    return { ...point, change, intervalDays, avgChange,
      logAvgChange: avgChange === null ? null : Math.sign(avgChange) * Math.log10(Math.abs(avgChange) + 1) };
  });
}

export function summarizeFollowers(data, startIndex = 0, endIndex = data.length - 1) {
  if (!data.length) return { totalGrowth: 0, daysTracked: 0, avgDailyGrowth: 0 };
  const start = Math.max(0, Math.min(data.length - 1, Math.floor(startIndex)));
  const end = Math.max(start, Math.min(data.length - 1, Math.floor(endIndex)));
  const firstData = data[start];
  const latestData = data[end];
  const totalGrowth = latestData.follower - firstData.follower;
  const daysTracked = (latestData.timestamp - firstData.timestamp) / DAY_MS;
  return { firstData, latestData, totalGrowth, daysTracked,
    avgDailyGrowth: daysTracked > 0 ? Math.round(totalGrowth / daysTracked) : 0 };
}

export async function loadFollowers(url, parser, signal, fetcher = fetch) {
  const response = await fetcher(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`获取数据失败（HTTP ${response.status}），请稍后再试`);
  const csv = await response.text();
  const parsed = parser.parse(csv, { header: true, skipEmptyLines: 'greedy',
    transformHeader: value => value.replace(/^\uFEFF/, '').trim() });
  if (!parsed.meta.fields?.includes('date') || !parsed.meta.fields?.includes('follower')) {
    throw new Error('CSV 缺少 date 或 follower 列');
  }
  const points = normalizeFollowers(parsed.data);
  if (!points.length) throw new Error('未找到有效的日期与粉丝数记录');
  return points;
}
