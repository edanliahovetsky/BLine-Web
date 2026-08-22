export function parseProjectTimestamp(value: string): Date | null {
  const millis = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const timestamp = new Date(Number.isFinite(millis) ? millis : value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
