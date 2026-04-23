/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  RTF GAMINGHOSTING PANEL v7.0 — Config                        ║
 * ║  Developer: @RTFGAMMING                               ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = __dirname;

// ── Directories ──────────────────────────────────────────────
export const DIRS = {
  base:    BASE_DIR,
  upload:  path.join(BASE_DIR, 'upload_bots'),
  data:    path.join(BASE_DIR, 'data'),
  logs:    path.join(BASE_DIR, 'logs'),
  backup:  path.join(BASE_DIR, 'backups'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

// ── Tokens ───────────────────────────────────────────────────
export const TOKEN       = process.env.BOT_TOKEN       || '';
export const ERROR_TOKEN = process.env.ERROR_BOT_TOKEN || '';
if (!TOKEN) throw new Error('❌ BOT_TOKEN is not set in .env!');

// ── Owner ────────────────────────────────────────────────────
export const OWNER_ID     = parseInt(process.env.OWNER_ID || '0');
export const BOT_USERNAME = process.env.BOT_USERNAME || 'apon_vps_bot';
export const YOUR_USERNAME  = '@rtfgamming';
export const UPDATE_CHANNEL = 'https://t.me/RTFGAMINGHACK0';

// ── MongoDB ──────────────────────────────────────────────────
export const MONGO_URL        = process.env.MONGO_URL        || '';
export const MONGO_URL_BACKUP = process.env.MONGO_URL_BACKUP || '';
export const DB_NAME          = 'apon_hosting';
export const DB_STORAGE_WARN_MB  = parseInt(process.env.DB_STORAGE_WARN_MB  || '400');
export const DB_STORAGE_LIMIT_MB = parseInt(process.env.DB_STORAGE_LIMIT_MB || '490');

// ── Branding ─────────────────────────────────────────────────
export const BRAND = '🌟 RTF HOSTING PANEL';
export const BRAND_VER = 'v7.0';
export const BRAND_TAG = `${BRAND} ${BRAND_VER}`;
export const BRAND_FOOTER = `\n━━━━━━━━━━━━━━━━━━━━\n${BRAND_TAG}`;

// ── Timing ───────────────────────────────────────────────────
export const FREE_BOT_MAX_HOURS = parseInt(process.env.FREE_BOT_MAX_HOURS || '24');
export const MAIN_BOT_AUTO_RESTART_HOURS = parseInt(process.env.MAIN_BOT_AUTO_RESTART_HOURS || '24');
export const DAILY_REPORT_HOUR = parseInt(process.env.DAILY_REPORT_HOUR || '0');
export const DAILY_REPORT_MINUTE = parseInt(process.env.DAILY_REPORT_MINUTE || '0');
export const REF_BONUS_DAYS = 3;
export const REF_COMMISSION = 20;
// ── Module map ───────────────────────────────────────────────
export const MODULES_MAP = {
  telebot: 'pytelegrambotapi', telegram: 'python-telegram-bot',
  pyrogram: 'pyrogram', telethon: 'telethon', aiogram: 'aiogram',
  PIL: 'Pillow', cv2: 'opencv-python', sklearn: 'scikit-learn',
  bs4: 'beautifulsoup4', dotenv: 'python-dotenv', yaml: 'pyyaml',
  aiohttp: 'aiohttp', numpy: 'numpy', pandas: 'pandas',
  requests: 'requests', flask: 'flask', fastapi: 'fastapi',
  motor: 'motor', pymongo: 'pymongo', httpx: 'httpx',
};

// ── Force Subscribe ──────────────────────────────────────────
export const DEFAULT_FORCE_CHANNELS = {
  RTFGAMINGHACK0: 'RTFGAMINGHACK0',
};

// ── Plans ────────────────────────────────────────────────────
export const PLAN_LIMITS = {
  free:       { name: '🆓 Free',       max_bots: 1,  ram: 128,  auto_restart: false, price: 0    },
  starter:    { name: '🟢 Starter',    max_bots: 2,  ram: 256,  auto_restart: true,  price: 99   },
  basic:      { name: '⭐ Basic',       max_bots: 5,  ram: 512,  auto_restart: true,  price: 199  },
  pro:        { name: '💎 Pro',         max_bots: 15, ram: 2048, auto_restart: true,  price: 499  },
  enterprise: { name: '🏢 Enterprise',  max_bots: 50, ram: 4096, auto_restart: true,  price: 999  },
  lifetime:   { name: '👑 Lifetime',    max_bots: -1, ram: 8192, auto_restart: true,  price: 1999 },
};

// ── Payment Methods ──────────────────────────────────────────
export const PAYMENT_METHODS = {
  bank:    { name: 'Bank',        number: '027210168522',          type: 'Transfer',         icon: '🏦' },
  upi:     { name: 'UPI',         number: '70497398@axl',          type: 'UPI Payment',      icon: '🔵' },
};

// ── Server ───────────────────────────────────────────────────
export const PORT = parseInt(process.env.PORT || '8080');
