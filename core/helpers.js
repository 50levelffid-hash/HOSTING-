import si from 'systeminformation';
import { DIRS } from '../config.js';
import { state } from './state.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// ── Uptime ────────────────────────────────────────────────────
export function getUptime() {
  const ms   = Date.now() - state.botStartTime.getTime();
  const d    = Math.floor(ms / 86400000);
  const h    = Math.floor((ms % 86400000) / 3600000);
  const m    = Math.floor((ms % 3600000) / 60000);
  const s    = Math.floor((ms % 60000) / 1000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m ${s}s`);
  return parts.join(' ');
}

// ── Format size ───────────────────────────────────────────────
export function fmtSize(bytes) {
  const units = ['B','KB','MB','GB','TB'];
  let b = bytes;
  for (const u of units) {
    if (b < 1024) return `${b.toFixed(1)} ${u}`;
    b /= 1024;
  }
  return `${b.toFixed(1)} PB`;
}

// ── Time left ─────────────────────────────────────────────────
export function timeLeft(endDate) {
  if (!endDate) return '♾️ Lifetime';
  const end = new Date(endDate);
  if (end <= new Date()) return '❌ Expired';
  const ms = end - Date.now();
  const d  = Math.floor(ms / 86400000);
  const h  = Math.floor((ms % 86400000) / 3600000);
  const m  = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

// ── Referral code ─────────────────────────────────────────────
export function genRefCode(uid) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = uid, enc = '';
  if (n === 0) enc = '0';
  else while (n > 0) { enc = chars[n % 36] + enc; n = Math.floor(n / 36); }
  const salt = crypto.createHash('md5').update(`${uid}_rtf_hosting`).digest('hex').slice(0, 2).toUpperCase();
  return `AHP${enc}${salt}`;
}

// ── User folder ───────────────────────────────────────────────
export function userFolder(uid) {
  const f = path.join(DIRS.upload, String(uid));
  fs.mkdirSync(f, { recursive: true });
  return f;
}

// ── System stats ─────────────────────────────────────────────
export async function sysStats() {
  try {
    const [cpu, mem, disk] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);
    const d = disk[0] || { used: 0, size: 1 };
    return {
      cpu:        Math.round(cpu.currentLoad * 10) / 10,
      mem:        Math.round(mem.used / mem.total * 100 * 10) / 10,
      disk:       Math.round(d.used / d.size * 100 * 10) / 10,
      up:         getUptime(),
      mem_total:  fmtSize(mem.total),
      mem_used:   fmtSize(mem.used),
      disk_total: fmtSize(d.size),
      disk_used:  fmtSize(d.used),
    };
  } catch {
    return { cpu: 0, mem: 0, disk: 0, up: getUptime(), mem_total: '?', mem_used: '?', disk_total: '?', disk_used: '?' };
  }
}

// ── Escape HTML ───────────────────────────────────────────────
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
