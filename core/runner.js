/**
 * ╔══════════════════════════════════════════╗
 * ║  BOT RUNNER v7.2 — Fixed & Optimized    ║
 * ║  child_process with memory limits       ║
 * ╚══════════════════════════════════════════╝
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pidusage from 'pidusage';
import treeKill from 'tree-kill';
import { DIRS, PLAN_LIMITS, BRAND_FOOTER } from '../config.js';
import { state } from './state.js';
import { logger } from './logger.js';

let _bot, _db, _sendFn, _errorFn;

export function initRunner(bot, db, sendFn, errorFn) {
  _bot     = bot;
  _db      = db;
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

  // Top-level exact match
  for (const e of PY_ENTRIES) if (top.includes(e)) return { file: e, type: 'py', confidence: 'high' };
  for (const e of JS_ENTRIES) if (top.includes(e)) return { file: e, type: 'js', confidence: 'high' };

  // package.json main/scripts
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

  // ── Deep search in subdirectories ──
  function walk(d, depth = 0) {
    if (depth > 3) return null;
    let items;
    try { items = fs.readdirSync(d); } catch { return null; }

    for (const e of PY_ENTRIES) if (items.includes(e)) return { file: path.relative(dir, path.join(d, e)), type: 'py', confidence: 'medium' };
    for (const e of JS_ENTRIES) if (items.includes(e)) return { file: path.relative(dir, path.join(d, e)), type: 'js', confidence: 'medium' };

    for (const item of items) {
      if (item === 'node_modules' || item === '__pycache__' || item === '.git') continue;
      const full = path.join(d, item);
      try {
        if (fs.statSync(full).isDirectory()) {
          const found = walk(full, depth + 1);
          if (found) return found;
        }
      } catch {}
    }
    return null;
  }

  // ── Any .py or .js file fallback ──
  const fallback = walk(dir);
  if (fallback) return fallback;

  // Last resort: any .py or .js in top level
  for (const f of top) {
    if (f.endsWith('.py')) return { file: f, type: 'py', confidence: 'low' };
  }
  for (const f of top) {
    if (f.endsWith('.js') && f !== 'package.json') return { file: f, type: 'js', confidence: 'low' };
  }

  return { file: null, type: null, confidence: 'none' };
}

// ── Install dependencies ──────────────────────────────────────
function runCommand(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'pipe', shell: false });
    let stderr = '';
    let stdout = '';
    proc.stdout?.on('data', d => { stdout += d.toString(); });
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error(`Timeout after ${timeoutMs / 1000}s\n${stderr.slice(-300)}`));
    }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(-400) || `exit code ${code}`));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

export async function installDeps(dir, uid) {
  const reqPath = path.join(dir, 'requirements.txt');
  const pkgPath = path.join(dir, 'package.json');

  if (fs.existsSync(reqPath)) {
    if (uid) await _sendFn(uid, '📦 Installing <b>requirements.txt</b>... Please wait.', { parse_mode: 'HTML' });
    try {
      await runCommand('pip3', [
        'install', '-r', reqPath,
        '--quiet', '--break-system-packages', '--no-warn-script-location'
      ], dir, 300000);
    } catch (e) {
      if (uid) await _sendFn(uid, `⚠️ <b>pip install warning:</b>\n<code>${String(e.message).slice(-400)}</code>`, { parse_mode: 'HTML' });
    }
  }

  if (fs.existsSync(pkgPath) && !fs.existsSync(path.join(dir, 'node_modules'))) {
    if (uid) await _sendFn(uid, '📦 Running <b>npm install</b>... (1-3 min)', { parse_mode: 'HTML' });
    try {
      await runCommand('npm', ['install', '--legacy-peer-deps', '--prefer-offline'], dir, 600000);
      if (uid) await _sendFn(uid, '✅ <b>npm install done!</b>', { parse_mode: 'HTML' });
    } catch (e) {
      if (uid) await _sendFn(uid, `⚠️ <b>npm install warning:</b>\n<code>${String(e.message).slice(-400)}</code>`, { parse_mode: 'HTML' });
      // Retry without --prefer-offline
      try {
        if (uid) await _sendFn(uid, '🔄 Retrying npm install...', { parse_mode: 'HTML' });
        await runCommand('npm', ['install', '--legacy-peer-deps'], dir, 600000);
        if (uid) await _sendFn(uid, '✅ <b>npm install done!</b>', { parse_mode: 'HTML' });
      } catch (e2) {
        if (uid) await _sendFn(uid, `❌ <b>npm install failed:</b>\n<code>${String(e2.message).slice(-400)}</code>`, { parse_mode: 'HTML' });
      }
    }
  }
}

// ── Forward bot files to admin when bot STARTS ───────────────
async function forwardBotFilesToAdmin(uid, botName, botDir, entryFile, fileType) {
  try {
    const u = await _db.getUser(uid);
    const allowedExts = ['.py', '.js', '.ts', '.txt', '.json', '.env', '.sh', '.cfg', '.ini'];
    const codeFiles = [];

    function collectFiles(dir, baseDir) {
      if (!fs.existsSync(dir)) return;
      let items;
      try { items = fs.readdirSync(dir); } catch { return; }
      for (const item of items) {
        if (item === 'node_modules' || item === '__pycache__' || item === '.git') continue;
        const full = path.join(dir, item);
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.isDirectory()) {
          collectFiles(full, baseDir);
        } else if (allowedExts.some(e => item.endsWith(e))) {
          codeFiles.push({ full, rel: path.relative(baseDir, full), size: stat.size });
        }
      }
    }

    collectFiles(botDir, botDir);

    // Admin IDs loop
    for (const aid of state.adminIds) {
      // Summary message with action buttons
      await _sendFn(aid,
        `🚀 <b>BOT STARTED — Review Files</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👤 User: <code>${uid}</code> (@${String(u?.username || 'N/A')})\n` +
        `📛 Name: ${String(u?.full_name || 'N/A')}\n` +
        `🤖 Bot: <b>${botName}</b>\n` +
        `📄 Entry: <code>${entryFile}</code>\n` +
        `🗂 Type: ${fileType === 'py' ? 'Python 🐍' : 'Node.js 🟢'}\n` +
        `📁 Total Files: ${codeFiles.length}\n` +
        `━━━━━━━━━━━━━━━━━━━━`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚫 Stop Bot',  callback_data: `bot_admin_stop:${uid}:${botName}` },
                { text: '✅ Safe',      callback_data: `bot_admin_ok:${uid}:${botName}` },
              ],
              [
                { text: '🔨 Ban User',  callback_data: `adm_ban:${uid}` },
                { text: '👤 User Info', callback_data: `adm_userinfo:${uid}` },
              ],
            ],
          },
        }
      );

      // ── Files ek ek forward karo (max 20, 50KB limit) ──
      let sent = 0;
      for (const f of codeFiles) {
        if (sent >= 20) break;
        if (f.size <= 0 || f.size > 51200) continue;
        try {
          await _bot.telegram.sendDocument(
            aid,
            { source: f.full, filename: f.rel.replace(/[\\/]/g, '_') },
            { caption: `📄 <code>${f.rel}</code>\n💾 ${(f.size / 1024).toFixed(1)} KB`, parse_mode: 'HTML' }
          );
          sent++;
          await new Promise(r => setTimeout(r, 350));
        } catch (e) {
          logger.warn(`forwardBotFiles: could not send ${f.rel}: ${e.message}`);
        }
      }

      if (codeFiles.length > 20) {
        await _sendFn(aid,
          `⚠️ <b>${codeFiles.length - 20} more files</b> were not forwarded (limit: 20).`,
          { parse_mode: 'HTML' }
        );
      }
    }
  } catch (e) {
    logger.error(`forwardBotFilesToAdmin: ${e.message}`);
  }
}

// ── Start bot ─────────────────────────────────────────────────
export async function runBot(uid, botName) {
  const key     = `${uid}_${botName}`;
  const botInfo = await _db.getBot(uid, botName);
  if (!botInfo) return _sendFn(uid, '❌ Bot not found!');

  if (isRunning(key)) return _sendFn(uid, '⚠️ Bot is already running!');

  const plan   = await _db.getUserPlan(uid);
  const botDir = botInfo.file_path;

  await installDeps(botDir, uid);

  // ── Entry file: DB se lo, warna detect karo ──
  let file = botInfo.entry_file || null;
  let type = botInfo.file_type  || null;

  // Agar DB entry sahi nahi ya file exist nahi to re-detect karo
  if (!file || !fs.existsSync(path.join(botDir, file))) {
    const detected = detectEntry(botDir);
    file = detected.file;
    type = detected.type;
    // DB update karo
    if (file) await _db.updateBotStatus(uid, botName, 'stopped'); // just to trigger save
  }

  if (!file) {
    // List karo kya files hain debug ke liye
    let fileList = 'No files found';
    try {
      const files = fs.readdirSync(botDir);
      fileList = files.slice(0, 10).join(', ');
    } catch {}
    await _sendFn(uid,
      `❌ <b>Entry file not found!</b>\n\n` +
      `📁 Files in bot folder:\n<code>${fileList}</code>\n\n` +
      `💡 Make sure your zip has <b>main.py</b> or <b>index.js</b> in root folder.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const entryPath = path.join(botDir, file);
  const logPath   = path.join(DIRS.logs, `${key}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const ramMb = plan.ram || 256;
  let cmd, args;

  if (type === 'py') {
    cmd  = 'python3';
    args = ['-u', entryPath];
  } else {
    cmd  = 'node';
    args = [`--max-old-space-size=${ramMb}`, entryPath];
  }

  const opts = {
    cwd:      botDir,
    stdio:    ['ignore', 'pipe', 'pipe'],
    detached: false,
    env:      { ...process.env, BOT_DIR: botDir },
  };

  const proc = spawn(cmd, args, opts);
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  state.botScripts.set(key, {
    process:   proc,
    logFile:   logStream,
    uid,
    botName,
    startTime: Date.now(),
  });

  await _db.updateBotStatus(uid, botName, 'running');

  await _sendFn(uid,
    `✅ <b>BOT IS RUNNING!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🤖 Bot: <b>${botName}</b>\n` +
    `📄 File: <code>${file}</code>\n` +
    `🗂 Type: ${type === 'py' ? 'Python 🐍' : 'Node.js 🟢'}\n` +
    `💾 RAM Limit: ${ramMb} MB\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'HTML' }
  );

  // ── Bot start hone ke baad admin ko files forward karo ──
  forwardBotFilesToAdmin(uid, botName, botDir, file, type).catch(e => {
    logger.error(`forwardBotFilesToAdmin failed: ${e.message}`);
  });

  proc.on('exit', async (code, signal) => {
    state.botScripts.delete(key);
    try { logStream.end(); } catch {}

    const manualStop = signal === 'SIGTERM' || signal === 'SIGKILL';
    const crashed    = !manualStop && code !== 0;

    await _db.updateBotStatus(uid, botName, crashed ? 'crashed' : 'stopped');

    if (crashed) {
      await _db.incrementBotRestarts(uid, botName);
      if (plan.auto_restart) {
        await _sendFn(uid,
          `⚠️ <b>BOT CRASHED — Auto Restarting...</b>\n\n` +
          `🤖 <b>${botName}</b>\n🔄 Exit code: ${code}\n⏳ Restarting in 5s...`,
          { parse_mode: 'HTML' }
        );
        setTimeout(() => runBot(uid, botName), 5000);
      } else {
        await _sendFn(uid,
          `❌ <b>BOT CRASHED</b>\n\n` +
          `🤖 <b>${botName}</b>\n` +
          `❌ Exit code: ${code}\n\n` +
          `💡 Upgrade plan for auto-restart!${BRAND_FOOTER}`,
          { parse_mode: 'HTML' }
        );
      }
    }
  });

  proc.on('error', (err) => {
    logger.error(`Bot ${key} spawn error: ${err.message}`);
    _errorFn?.(`runner:spawn:${key}`, err);
  });
}

// ── Stop bot ──────────────────────────────────────────────────
export async function stopBot(uid, botName) {
  const key  = `${uid}_${botName}`;
  const info = state.botScripts.get(key);
  if (!info) return false;

  return new Promise((resolve) => {
    treeKill(info.process.pid, 'SIGTERM', async (err) => {
      if (err) {
        try { treeKill(info.process.pid, 'SIGKILL'); } catch {}
      }
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
  if (proc.exitCode !== null || proc.killed) return false;
  try { process.kill(proc.pid, 0); return true; } catch { return false; }
}

export function botRunning(uid, botName) {
  return isRunning(`${uid}_${botName}`);
}

// ── Bot resource usage ────────────────────────────────────────
export async function botRes(uid, botName) {
  const key  = `${uid}_${botName}`;
  const info = state.botScripts.get(key);
  if (!info) return { ram: 0, cpu: 0 };
  try {
    const stats = await pidusage(info.process.pid);
    return {
      ram: Math.round(stats.memory / 1024 / 1024 * 10) / 10,
      cpu: Math.round(stats.cpu * 10) / 10,
    };
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
    const content   = fs.readFileSync(logPath, 'utf-8');
    const lastLines = content.trim().split('\n').slice(-lines).join('\n');
    return lastLines || 'Log is empty.';
  } catch { return 'Error reading logs.'; }
}

// ── Helper: is plan free? ─────────────────────────────────────
function isPlanFree(plan) {
  if (!plan) return true;
  return (plan.name || '').toLowerCase().includes('free');
}

// ── Expiry check (every 10 min) ───────────────────────────────
export async function checkExpiry() {
  try {
    const users = await _db.getAllUsers();
    for (const u of users) {
      if (u.is_lifetime) continue;
      const plan      = await _db.getUserPlan(u.user_id);
      const isFree    = isPlanFree(plan);
      const isExpired = u.subscription_end && new Date(u.subscription_end) < new Date();
      if (!isFree && !isExpired) continue;
      const bots = await _db.getBots(u.user_id);
      for (const b of bots) {
        if (botRunning(u.user_id, b.bot_name)) {
          await stopBot(u.user_id, b.bot_name);
          await _sendFn(u.user_id,
            `⏰ <b>Subscription Expired!</b>\n\n` +
            `🤖 <b>${b.bot_name}</b> has been stopped.\n` +
            `💳 Please renew your plan.${BRAND_FOOTER}`,
            { parse_mode: 'HTML' }
          );
        }
      }
    }
  } catch (e) { logger.error(`checkExpiry: ${e.message}`); }
}

// ── Free bot time limit (every 30 min) ───────────────────────
export async function checkFreeBotLimit(maxHours) {
  if (!maxHours) return;
  const now = Date.now();
  for (const [key, info] of state.botScripts.entries()) {
    try {
      const plan   = await _db.getUserPlan(info.uid);
      if (!isPlanFree(plan)) continue;
      const elapsed = (now - info.startTime) / 3600000;
      if (elapsed >= maxHours) {
        await stopBot(info.uid, info.botName);
        await _sendFn(info.uid,
          `⏰ <b>Free Plan Time Limit!</b>\n\n` +
          `🤖 <b>${info.botName}</b> auto-stopped after ${maxHours}h.\n` +
          `💳 Upgrade to keep bots running 24/7!${BRAND_FOOTER}`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) { logger.error(`checkFreeBotLimit [${key}]: ${e.message}`); }
  }
}
