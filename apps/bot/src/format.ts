import { formatProbability } from "@goalfi/core";

/** Escape text for Telegram HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function timeLeft(end: Date, now = new Date()): string {
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "ended";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

export function priceLine(yes: number | null | undefined): string {
  if (yes === null || yes === undefined || !Number.isFinite(yes)) return "no price yet";
  return `YES ${formatProbability(yes)} · NO ${formatProbability(1 - yes)}`;
}
