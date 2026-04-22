/**
 * ╔══════════════════════════════════════════╗
 * ║  BOT RUNNER v7.0 — RAM Optimized        ║
 * ║  child_process with memory limits       ║
 * ╚══════════════════════════════════════════╝
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pidusage from 'pidusage';
import treeKill from 'tree-kill';
import { DIRS, PLAN_LIMITS, MODULES_MAP, BRAND_FOOTER } from '../config.js';
import { state } from './state.js';
import { logger } from './logger.js';

let _bot, _db, _sendFn, _errorFn;

export function initRunner(bot, db, sendFn, errorFn) {
  _bot = bot;
  _db  = db;
  _sendFn  = sendFn;
  _errorFn = errorFn;
}

// ── Smart entry detector ──────────────────────────────────────
const PY_ENTRIES = ['main.py','app.py','bot.py','run.py','start.py','server.py','index.py','__main__.py'];
const JS_ENTRIES = ['index.js','app.js','bot.js','main.js','server.js','start.js','run.js'];

export function detectEntry(dir) {
  if (!fs.existsSync(dir)) return { file: null, type: null, confidence: 'none' };
  if (fs.statSync(dir).isFile()) {
    const ext = dir.split('.').pop().toLowerCase();
    return { file: path.basename(dir), type: ext === 'js' ? 'js' : 'py', confidence: 'exact' };
  }
  const top = fs.readdirSync(dir);
  for (const e of PY_ENTRIES) if (top.includes(e)) return { file: e, type: 'py', confidence: 'high' };
  for (const e of JS_ENTRIES) if (top.includes(e)) return { file: e, type: 'js', confidence: 'high' };

  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.main && fs.existsSync(path.join(dir, pkg.main)))
        return { file: pkg.main, type: 'js', confidence: 'high' };
      if (pkg.scripts?.start) {
        const m = pkg.scripts.start.match(/node\s+(\S+\.js)/);
        if (m && fs.existsSync(path.join(dir, m[1])))
          return { file: m[1], type: 'js', confidence: 'high' };
      }
    } catch {}
  }

  // Deep search
  function walk(d, depth = 0) {
    if (depth > 2) return null;
    const items = fs.readdirSync(d);
    for (const e of PY_ENTRIES) if (items.includes(e)) return { file: path.relative(dir, path.join(d, e)), type: 'py', confidence: 'medium' };
    for (const e of JS_ENTRIES) if (items.includes(e)) return { file: path.relative(dir, path.join(d, e)), type: 'js', confidence: 'medium' };
    for (const item of items) {
      const full = path.join(d, item);
      if (fs.statSync(full).isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  return walk(dir) || { file: null, type: null, confidence: 'none' };
}

// ── Install dependencies ──────────────────────────────────────
export async function installDeps(dir, uid) {
  const reqPath = path.join(dir, 'requirements.txt');
  const pkgPath = path.join(dir, 'package.json');

  if (fs.existsSync(reqPath)) {
    if (uid) _sendFn(uid, '📦 Installing <b>requirements.txt</b>... Please wait.');
    try {
      execSync(`pip3 install -r ${reqPath} --quiet --break-system-packages --no-warn-script-location`, {
        cwd: dir, timeout: 300000, stdio: 'pipe'
      });
    } catch (e) {
      if (uid) _sendFn(uid, `⚠️ <b>Install warning:</b>\n<code>${String(e.stderr || e.message).slice(-400)}</code>`);
    }
  }

  if (fs.existsSync(pkgPath) && !fs.existsSync(path.join(dir, 'node_modules'))) {
    if (uid) _sendFn(uid, '📦 Running <b>npm install</b>...');
    try {
      execSync('npm install --production', { cwd: dir, timeout: 300000, stdio: 'pipe' });
    } catch (e) {
      if (uid) _sendFn(uid, `⚠️ <b>npm install warning:</b>\n<code>${String(e.stderr || e.message).slice(-400)}</code>`);
    }
  }
}

// ── Start bot ─────────────────────────────────────────────────
export async function runBot(uid, botName) {
  const key = `${uid}_${botName}`;
  const botInfo = await _db.getBot(uid, botName);
  if (!botInfo) return _sendFn(uid, '❌ Bot not found!');

  if (isRunning(key)) return _sendFn(uid, '⚠️ Bot is already running!');

  const plan = await _db.getUserPlan(uid);
  const botDir = botInfo.file_path;

  await installDeps(botDir, uid);

  const { file, type } = detectEntry(botDir);
  if (!file) return _sendFn(uid, '❌ Could not detect entry file. Make sure <b>main.py</b> or <b>index.js</b> exists.');

  const entryPath = path.join(botDir, file);
  const logPath   = path.join(DIRS.logs, `${key}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // ── RAM limit via ulimit (Linux) ────────────────
  const ramMb = plan.ram || 256;
  let cmd, args, opts;

  if (type === 'py') {
    cmd  = 'python3';
    args = ['-u', entryPath];
  } else {
    cmd  = 'node';
    args = [`--max-old-space-size=${ramMb}`, entryPath];
  }

  opts = {
    cwd:     botDir,
    stdio:   ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, BOT_DIR: botDir },
  };

  const proc = spawn(cmd, args, opts);
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  state.botScripts.set(key, { process: proc, logFile: logStream, uid, botName, startTime: Date.now() });
  await _db.updateBotStatus(uid, botName, 'running');
  _sendFn(uid, `✅ <b>BOT IS RUNNING!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n🤖 Bot: <b>${botName}</b>\n📄 File: <code>${file}</code>\n🗂 Type: ${type === 'py' ? 'Python' : 'Node.js'}\n💾 RAM Limit: ${ramMb} MB\n━━━━━━━━━━━━━━━━━━━━`);

  proc.on('exit', async (code, signal) => {
    const info = state.botScripts.get(key);
    state.botScripts.delete(key);
    try { logStream.end(); } catch {}

    const crashed = code !== 0 && signal !== 'SIGTERM';
    await _db.updateBotStatus(uid, botName, crashed ? 'crashed' : 'stopped');

    if (crashed && plan.auto_restart) {
      await _db.incrementBotRestarts(uid, botName);
      _sendFn(uid, `⚠️ <b>BOT CRASHED — Auto restarting...</b>\n🤖 ${botName}\n🔄 Exit: ${code}`);
      setTimeout(() => runBot(uid, botName), 3000);
    } else if (crashed) {
      _sendFn(uid, `❌ <b>BOT CRASHED</b>\n🤖 ${botName}\n❌ Exit code: ${code}\n💡 Auto-restart: Plan upgrade needed`);
    }
  });

  proc.on('error', (err) => {
    logger.error(`Bot ${key} spawn error: ${err.message}`);
  });
}

// ── Stop bot ──────────────────────────────────────────────────
export async function stopBot(uid, botName) {
  const key = `${uid}_${botName}`;
  const info = state.botScripts.get(key);
  if (!info) return false;

  return new Promise((resolve) => {
    treeKill(info.process.pid, 'SIGTERM', async (err) => {
      if (err) treeKill(info.process.pid, 'SIGKILL');
      state.botScripts.delete(key);
      try { info.logFile.end(); } catch {}
      await _db.updateBotStatus(uid, botName, 'stopped');
      resolve(true);
    });
  });
}

// ── Check running ─────────────────────────────────────────────
export function isRunning(key) {
  const info = state.botScripts.get(key);
  if (!info) return false;
  const proc = info.process;
  if (proc.exitCode !== null) return false;
  try { process.kill(proc.pid, 0); return true; } catch { return false; }
}

export function botRunning(uid, botName) { return isRunning(`${uid}_${botName}`); }

// ── Bot resource usage ────────────────────────────────────────
export async function botRes(uid, botName) {
  const key = `${uid}_${botName}`;
  const info = state.botScripts.get(key);
  if (!info) return { ram: 0, cpu: 0 };
  try {
    const stats = await pidusage(info.process.pid);
    return { ram: Math.round(stats.memory / 1024 / 1024 * 10) / 10, cpu: Math.round(stats.cpu * 10) / 10 };
  } catch { return { ram: 0, cpu: 0 }; }
}

// ── Running count ─────────────────────────────────────────────
export function runningCount() {
  return [...state.botScripts.keys()].filter(k => isRunning(k)).length;
}

// ── Get bot logs ──────────────────────────────────────────────
export function getBotLogs(uid, botName, lines = 30) {
  const logPath = path.join(DIRS.logs, `${uid}_${botName}.log`);
  if (!fs.existsSync(logPath)) return 'No logs yet.';
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lastLines = content.trim().split('\n').slice(-lines).join('\n');
    return lastLines || 'Log is empty.';
  } catch { return 'Error reading logs.'; }
}

// ── Expiry check (every 10 min) ───────────────────────────────
export async function checkExpiry() {
  try {
    const users = await _db.getAllUsers();
    for (const u of users) {
      const plan = await _db.getUserPlan(u.user_id);
      if (plan === PLAN_LIMITS.free) {
        const bots = await _db.getBots(u.user_id);
        for (const b of bots) {
          if (botRunning(u.user_id, b.bot_name)) {
            await stopBot(u.user_id, b.bot_name);
            _sendFn(u.user_id, `⏰ <b>Subscription Expired!</b>\n\n🤖 <b>${b.bot_name}</b> has been stopped.\n💳 Please renew your plan.${BRAND_FOOTER}`);
          }
        }
      }
    }
  } catch (e) { logger.error(`checkExpiry: ${e.message}`); }
}

// ── Free bot time limit ───────────────────────────────────────
export async function checkFreeBotLimit(maxHours) {
  if (!maxHours) return;
  const now = Date.now();
  for (const [key, info] of state.botScripts.entries()) {
    const elapsed = (now - info.startTime) / 3600000;
    if (elapsed >= maxHours) {
      const u = await _db.getUser(info.uid);
      if (u && u.plan === 'free') {
        await stopBot(info.uid, info.botName);
        _sendFn(info.uid, `⏰ <b>Free Plan Time Limit!</b>\n\n🤖 <b>${info.botName}</b> auto-stopped after ${maxHours}h.\n💳 Upgrade to keep bots running 24/7.${BRAND_FOOTER}`);
      }
    }
  }
}
