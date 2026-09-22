// 日付（YYYY-MM-DD）の扱い。入力チェックと保存データの検証の両方で使う。

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 実在する日付か（2026-02-30 などは不可） */
export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** 端末のタイムゾーンでの今日（YYYY-MM-DD） */
export function localDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
