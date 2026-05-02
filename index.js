/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  🌟 RTF HOSTING PANEL — Premium Edition v7.0 🌟         ║
 * ║  Developer: @RTFGAMMING                               ║
 * ║  Rewritten in Node.js — High Performance                  ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

import { Telegraf } from 'telegraf';
import express from 'express';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import extract from 'extract-zip';
import multer from 'multer';

import {
  TOKEN, OWNER_ID, BRAND, BRAND_TAG, BRAND_FOOTER, BRAND_VER,
  PLAN_LIMITS, PAYMENT_METHODS, DEFAULT_FORCE_CHANNELS,
  PORT, DIRS, FREE_BOT_MAX_HOURS, MAIN_BOT_AUTO_RESTART_HOURS,
  DAILY_REPORT_HOUR, DAILY_REPORT_MINUTE, REF_BONUS_DAYS, REF_COMMISSION,
} from './config.js';
import { db } from './database.js';
import { state } from './core/state.js';
import { logger } from './core/logger.js';
import {
  initRunner, runBot, stopBot, isRunning, botRunning,
  botRes, runningCount, getBotLogs, detectEntry,
  installDeps, checkExpiry, checkFreeBotLimit,
} from './core/runner.js';
import {
  getUptime, fmtSize, timeLeft, genRefCode, userFolder, sysStats, escHtml,
} from './core/helpers.js';
import {
  mainMenuKb, helpMenuKb, backBtn, backHelpBtn, botActionKb, planKb,
  payMethodKb, payApproveKb, adminKb, channelsManageKb, confirmDeleteKb,
} from './handlers/keyboards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════
//  BOT INIT
// ═══════════════════════════════════════════════════
const bot = new Telegraf(TOKEN);

// Safe send helpers
const safeSend = async (chatId, text, extra = {}) => {
  try { return await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra }); }
  catch (e) { logger.error(`safeSend ${chatId}: ${e.message}`); }
};
const safeEdit = async (ctx, text, extra = {}) => {
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra }); }
  catch { try { await ctx.reply(text, { parse_mode: 'HTML', ...extra }); } catch {} }
};
const forwardError = async (source, err, uid = null) => {
  const msg = `🔴 <b>ERROR</b> [${source}]\n<code>${escHtml(err?.message || err)}</code>`;
  try { await safeSend(OWNER_ID, msg); } catch {}
  if (uid && uid !== OWNER_ID) try { await safeSend(uid, '❌ An error occurred. Admin has been notified.'); } catch {}
};

initRunner(bot, db, safeSend, forwardError);

// ═══════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;

  // Rate limit
  if (!state.rateCheck(uid)) return;

  // Register user
  const rc = genRefCode(uid);
  await db.createUser(uid, ctx.from.username || '', `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(), rc);
  await db.updateLastActive(uid);

  // Bot locked check
  if (state.botLocked && !state.isAdmin(uid)) {
    return ctx.reply('🔒 <b>Bot is temporarily locked for maintenance.</b>\nPlease try again later.', { parse_mode: 'HTML' });
  }

  return next();
});

// ═══════════════════════════════════════════════════
//  FORCE SUBSCRIBE
// ═══════════════════════════════════════════════════
async function checkJoined(uid) {
  if (!state.forceSub || state.isAdmin(uid)) return { ok: true, missing: [] };
  let channels = await db.getActiveChannels();
  if (!channels.length) channels = Object.entries(DEFAULT_FORCE_CHANNELS).map(([u, n]) => ({ channel_username: u, channel_name: n }));
  const missing = [];
  for (const ch of channels) {
    try {
      const m = await bot.telegram.getChatMember(`@${ch.channel_username}`, uid);
      if (['left', 'kicked'].includes(m.status)) missing.push(ch);
    } catch { missing.push(ch); }
  }
  return { ok: missing.length === 0, missing };
}

function forceSubMarkup(missing) {
  const btns = missing.map(ch => [{ text: `📢 Join ${ch.channel_name}`, url: `https://t.me/${ch.channel_username}` }]);
  btns.push([{ text: "✅ I've Joined — Verify", callback_data: 'verify_join' }]);
  return { inline_keyboard: btns };
}

// ═══════════════════════════════════════════════════
//  /START
// ═══════════════════════════════════════════════════
bot.start(async (ctx) => {
  const uid = ctx.from.id;
  const { ok, missing } = await checkJoined(uid);
  if (!ok) {
    return ctx.reply(
      `🔒 <b>CHANNEL VERIFICATION REQUIRED</b>\n━━━━━━━━━━━━━━━━━━━━\n\n⚠️ You must join our channels to use this bot!\n━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'HTML', reply_markup: forceSubMarkup(missing) }
    );
  }

  // Referral
  const payload = ctx.startPayload;
  if (payload && payload.startsWith('ref_')) {
    const refCode = payload.replace('ref_', '');
    const refUser = await db.getUserByRefCode(refCode);
    if (refUser && refUser.user_id !== uid) {
      const u = await db.getUser(uid);
      if (!u?.referred_by) {
        await db.updateUser(uid, { referred_by: refUser.user_id });
        await db.addReferral(refUser.user_id, uid, REF_BONUS_DAYS, REF_COMMISSION);
        // Give bonus days to referrer
        const ru = await db.getUser(refUser.user_id);
        if (ru) {
          const currentEnd = ru.subscription_end ? new Date(ru.subscription_end) : new Date();
          const newEnd = new Date(Math.max(currentEnd, Date.now()) + REF_BONUS_DAYS * 86400000);
          await db.updateUser(refUser.user_id, { subscription_end: newEnd });
          await safeSend(refUser.user_id, `🎉 <b>Referral Bonus!</b>\n\n👤 A new user joined via your link!\n🎁 You got <b>${REF_BONUS_DAYS} bonus days!</b>${BRAND_FOOTER}`);
        }
      }
    }
  }

  const u = await db.getUser(uid);
  const plan = await db.getUserPlan(uid);
  await ctx.reply(
    `👋 <b>Welcome to ${BRAND_TAG}!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Hello, <b>${escHtml(ctx.from.first_name)}</b>! 🌟\n\n` +
    `🤖 Host your Telegram bots 24/7\n` +
    `📦 Plan: <b>${plan.name}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Use the menu below to get started!`,
    { parse_mode: 'HTML', ...mainMenuKb() }
  );
});

// ═══════════════════════════════════════════════════
//  MENU TEXT HANDLERS
// ═══════════════════════════════════════════════════
bot.hears('🤖 My Bots', async (ctx) => {
  const uid = ctx.from.id;
  const { ok, missing } = await checkJoined(uid);
  if (!ok) return ctx.reply('🔒 Join required!', { reply_markup: forceSubMarkup(missing) });

  const bots = await db.getBots(uid);
  if (!bots.length) {
    return ctx.reply(
      `🤖 <b>My Bots</b>\n━━━━━━━━━━━━━━━━━━━━\n\n❌ No bots uploaded yet.\n\n📤 Use <b>Upload Bot</b> to add your first bot!${BRAND_FOOTER}`,
      { parse_mode: 'HTML', ...backBtn('menu_main') }
    );
  }
  const plan = await db.getUserPlan(uid);
  let text = `🤖 <b>My Bots</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📦 Plan: ${plan.name} | Slots: ${bots.length}/${plan.max_bots === -1 ? '∞' : plan.max_bots}\n\n`;
  const btns = [];
  for (const b of bots) {
    const running = botRunning(uid, b.bot_name);
    const { ram } = await botRes(uid, b.bot_name);
    text += `${running ? '🟢' : '🔴'} <b>${escHtml(b.bot_name)}</b> ${running ? `(${ram}MB)` : ''}\n`;
    btns.push([{ text: `${running ? '🟢' : '🔴'} ${b.bot_name}`, callback_data: `bot_actions:${b.bot_name}` }]);
  }
  btns.push([{ text: '🔙 Back', callback_data: 'menu_main' }]);
  await ctx.reply(text + BRAND_FOOTER, { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } });
});

bot.hears('📤 Upload Bot', async (ctx) => {
  const uid = ctx.from.id;
  const { ok, missing } = await checkJoined(uid);
  if (!ok) return ctx.reply('🔒 Join required!', { reply_markup: forceSubMarkup(missing) });

  const plan = await db.getUserPlan(uid);
  const count = await db.botCount(uid);
  if (plan.max_bots !== -1 && count >= plan.max_bots) {
    return ctx.reply(
      `❌ <b>Bot Limit Reached!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📦 Plan: ${plan.name}\n🤖 Limit: ${plan.max_bots} bots\n\n💳 Upgrade your plan for more slots!${BRAND_FOOTER}`,
      { parse_mode: 'HTML', ...planKb() }
    );
  }
  state.setState(uid, 'wait_bot_name');
  await ctx.reply(
    `📤 <b>Upload Bot</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📝 Step 1: Enter a name for your bot\n\n💡 Example: <code>MyTelegramBot</code>\n\n❌ /cancel to abort`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

bot.hears('💎 My Plan', async (ctx) => {
  const uid = ctx.from.id;
  const u = await db.getUser(uid);
  const plan = await db.getUserPlan(uid);
  const bots = await db.getBots(uid);
  const running = bots.filter(b => botRunning(uid, b.bot_name)).length;
  await ctx.reply(
    `💎 <b>My Plan</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📦 Plan: <b>${plan.name}</b>\n` +
    `📅 Expires: ${timeLeft(u?.subscription_end)}\n` +
    `👑 Lifetime: ${u?.is_lifetime ? '✅ Yes' : '❌ No'}\n\n` +
    `🤖 Bots: ${bots.length}/${plan.max_bots === -1 ? '∞' : plan.max_bots} (🟢 ${running})\n` +
    `💾 RAM/bot: ${plan.ram} MB\n` +
    `🔄 Auto-restart: ${plan.auto_restart ? '✅' : '❌'}\n\n` +
    `💳 Upgrade for more features!${BRAND_FOOTER}`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '💳 Upgrade Plan', callback_data: 'buy_plan' }, { text: '🔙 Back', callback_data: 'menu_main' }]] } }
  );
});

bot.hears('💰 Wallet', async (ctx) => {
  const uid = ctx.from.id;
  const u = await db.getUser(uid);
  await ctx.reply(
    `💰 <b>My Wallet</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💵 Balance: <b>${u?.wallet_balance || 0} BDT</b>\n` +
    `💳 Total Spent: ${u?.total_spent || 0} BDT${BRAND_FOOTER}`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

bot.hears('💳 Buy Plan', async (ctx) => {
  await ctx.reply(
    `💳 <b>Buy Plan</b>\n━━━━━━━━━━━━━━━━━━━━\n\nChoose a plan:`,
    { parse_mode: 'HTML', ...planKb() }
  );
});

bot.hears('👥 Referral', async (ctx) => {
  const uid = ctx.from.id;
  const u = await db.getUser(uid);
  const link = `https://t.me/${(await bot.telegram.getMe()).username}?start=ref_${u?.referral_code || genRefCode(uid)}`;
  await ctx.reply(
    `👥 <b>Referral Program</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔗 Your Link:\n<code>${link}</code>\n\n` +
    `👤 Total Referrals: <b>${u?.referral_count || 0}</b>\n` +
    `💰 Earnings: <b>${u?.referral_earnings || 0} BDT</b>\n\n` +
    `🎁 Each referral gives you <b>${REF_BONUS_DAYS} bonus days!</b>\n` +
    `💸 Commission: <b>${REF_COMMISSION}%</b>${BRAND_FOOTER}`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

bot.hears('📊 Stats', async (ctx) => {
  const uid = ctx.from.id;
  const { ok, missing } = await checkJoined(uid);
  if (!ok) return ctx.reply('🔒 Join required!', { reply_markup: forceSubMarkup(missing) });
  const sys = await sysStats();
  const rn  = runningCount();
  await ctx.reply(
    `📊 <b>System Stats</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⏱ Uptime: <b>${sys.up}</b>\n` +
    `💻 CPU: <b>${sys.cpu}%</b>\n` +
    `🧠 RAM: <b>${sys.mem}%</b> (${sys.mem_used}/${sys.mem_total})\n` +
    `💾 Disk: <b>${sys.disk}%</b> (${sys.disk_used}/${sys.disk_total})\n` +
    `🤖 Running Bots: <b>${rn}</b>${BRAND_FOOTER}`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

bot.hears('🎫 Support', async (ctx) => {
  const uid = ctx.from.id;
  state.setState(uid, 'wait_ticket_subject');
  await ctx.reply(
    `🎫 <b>Open Support Ticket</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📝 Enter your ticket subject:\n\n❌ /cancel to abort`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

bot.hears('ℹ️ Help', async (ctx) => {
  await ctx.reply(
    `ℹ️ <b>Help Center</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📤 <b>Upload Bot</b> — Upload a .zip or .py/.js file\n` +
    `▶️ <b>Start Bot</b> — Run your bot 24/7\n` +
    `⏹ <b>Stop Bot</b> — Stop your running bot\n` +
    `📋 <b>Logs</b> — View last 30 lines of bot output\n` +
    `💳 <b>Buy Plan</b> — Upgrade for more bots/RAM\n` +
    `👥 <b>Referral</b> — Earn bonus days by inviting friends\n\n` +
    `📞 Contact: ${process.env.YOUR_USERNAME || '@RTFGAMMING'}${BRAND_FOOTER}`,
    { parse_mode: 'HTML', ...backBtn('menu_main') }
  );
});

// ═══════════════════════════════════════════════════
//  /ADMIN
// ═══════════════════════════════════════════════════
bot.command('admin', async (ctx) => {
  const uid = ctx.from.id;
  if (!state.isAdmin(uid)) return ctx.reply('❌ Access denied!');
  await showAdminPanel(ctx, uid);
});

async function showAdminPanel(ctx, uid) {
  const s   = await db.stats();
  const rn  = runningCount();
  const tickets = (await db.openTickets()).length;
  const text =
    `👑 <b>ADMIN PANEL</b>\n${BRAND_TAG}\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👥 Total Users: ${s.users} (+${s.today} today)\n` +
    `🤖 Running Bots: ${rn}\n` +
    `💎 Active Subs: ${s.active_subs}\n` +
    `🚫 Banned: ${s.banned}\n` +
    `💳 Pending Payments: ${s.pending}\n` +
    `🎫 Open Tickets: ${tickets}\n` +
    `💰 Total Revenue: ${s.revenue} BDT\n\n` +
    `🔐 Force Sub: ${state.forceSub ? '🟢 ON' : '🔴 OFF'}\n` +
    `🔒 Bot Lock: ${state.botLocked ? '🔒 LOCKED' : '🔓 OPEN'}\n` +
    `━━━━━━━━━━━━━━━━━━━━`;
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...adminKb() }); }
  catch { await safeSend(uid, text, adminKb()); }
}

// ═══════════════════════════════════════════════════
//  CALLBACK QUERIES
// ═══════════════════════════════════════════════════
bot.on('callback_query', async (ctx) => {
  const uid  = ctx.from.id;
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery().catch(() => {});

  // ── Verify join ──────────────────────────────────
  if (data === 'verify_join') {
    const { ok, missing } = await checkJoined(uid);
    if (ok) {
      await safeEdit(ctx, `✅ <b>Verified! Welcome!</b>\n\nUse the menu below.${BRAND_FOOTER}`, { parse_mode: 'HTML' });
      return safeSend(uid, '👋 Welcome!', mainMenuKb());
    }
    return ctx.answerCbQuery('❌ Still not joined all channels!', { show_alert: true });
  }

  // ── Menu navigation ──────────────────────────────
  if (data === 'menu_main') return safeSend(uid, `${BRAND_TAG}\n\nChoose an option:`, mainMenuKb());
  if (data === 'menu_admin') return showAdminPanel(ctx, uid);
  if (data === 'buy_plan') return safeEdit(ctx, `💳 <b>Choose a Plan</b>`, { parse_mode: 'HTML', ...planKb() });

  // ── Plan select ──────────────────────────────────
  if (data.startsWith('plan_select:')) {
    const plan = data.split(':')[1];
    const pl = PLAN_LIMITS[plan];
    if (!pl) return;
    await safeEdit(ctx,
      `💳 <b>${pl.name}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🤖 Max Bots: ${pl.max_bots === -1 ? 'Unlimited' : pl.max_bots}\n` +
      `💾 RAM/bot: ${pl.ram} MB\n🔄 Auto-restart: ${pl.auto_restart ? '✅' : '❌'}\n` +
      `💰 Price: <b>${pl.price} BDT/month</b>\n\n` +
      `Choose payment method:`,
      { parse_mode: 'HTML', ...payMethodKb(plan) }
    );
  }

  // ── Payment method selected ──────────────────────
  if (data.startsWith('pay_method:')) {
    const [, plan, method] = data.split(':');
    const pl = PLAN_LIMITS[plan];
    const pm = PAYMENT_METHODS[method];
    if (!pl || !pm) return;
    state.setPayState(uid, { step: 'wait_trx', plan, method, amount: pl.price });
    await safeEdit(ctx,
      `${pm.icon} <b>Payment: ${pm.name}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 Plan: ${pl.name}\n💰 Amount: <b>${pl.price} BDT</b>\n\n` +
      `📲 Send to:\n<b>${pm.number}</b>\n🔖 Type: ${pm.type}\n\n` +
      `✅ After payment, send your <b>Transaction ID</b> here:`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Payment approve/reject ───────────────────────
  if (data.startsWith('pay_approve:') && state.isAdmin(uid)) {
    const payId = data.split(':')[1];
    const p = await db.approvePayment(payId, uid);
    if (!p) return ctx.answerCbQuery('❌ Payment not found!', { show_alert: true });
    await db.setPlan(p.user_id, p.plan, p.duration_days);
    await db.updateUser(p.user_id, { $inc: { total_spent: p.amount } });
    await safeSend(p.user_id,
      `✅ <b>PAYMENT APPROVED!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 Plan: <b>${PLAN_LIMITS[p.plan]?.name || p.plan}</b>\n💰 Amount: ${p.amount} BDT\n` +
      `📅 Duration: ${p.duration_days} days\n\nThank you! Enjoy your plan!${BRAND_FOOTER}`
    );
    await safeEdit(ctx, `✅ Payment #${payId} approved!`, { parse_mode: 'HTML' });
    await db.adminLog(uid, 'approve_payment', p.user_id, `payId:${payId}`);
  }

  if (data.startsWith('pay_reject:') && state.isAdmin(uid)) {
    const payId = data.split(':')[1];
    const p = await db.rejectPayment(payId, uid);
    if (!p) return ctx.answerCbQuery('❌ Payment not found!', { show_alert: true });
    await safeSend(p.user_id,
      `❌ <b>PAYMENT REJECTED!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n🆔 #${payId}\n\n⚠️ Contact admin if you believe this is an error.${BRAND_FOOTER}`
    );
    await safeEdit(ctx, `❌ Payment #${payId} rejected.`, { parse_mode: 'HTML' });
    await db.adminLog(uid, 'reject_payment', p.user_id, `payId:${payId}`);
  }

  // ── Bot actions ──────────────────────────────────
  if (data.startsWith('bot_actions:')) {
    const botName = data.split(':')[1];
    const b = await db.getBot(uid, botName);
    if (!b) return ctx.answerCbQuery('❌ Bot not found!', { show_alert: true });
    const running = botRunning(uid, botName);
    const { ram, cpu } = await botRes(uid, botName);
    await safeEdit(ctx,
      `🤖 <b>${escHtml(botName)}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 Status: ${running ? '🟢 Running' : '🔴 Stopped'}\n` +
      `📄 Entry: <code>${b.entry_file}</code>\n` +
      `🗂 Type: ${b.file_type === 'py' ? 'Python' : 'Node.js'}\n` +
      `💾 RAM: ${running ? ram + ' MB' : '-'}\n` +
      `⚙️ CPU: ${running ? cpu + '%' : '-'}\n` +
      `🔄 Restarts: ${b.total_restarts}\n` +
      `📅 Started: ${b.last_started ? new Date(b.last_started).toLocaleString() : 'Never'}\n` +
      `━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'HTML', ...botActionKb(botName, running) }
    );
  }

  if (data.startsWith('bot_start:')) {
    const botName = data.split(':')[1];
    await ctx.answerCbQuery('▶️ Starting...');
    await runBot(uid, botName);
  }

  if (data.startsWith('bot_stop:')) {
    const botName = data.split(':')[1];
    const ok = await stopBot(uid, botName);
    await ctx.answerCbQuery(ok ? '⏹ Stopped!' : '❌ Not running');
    if (ok) await safeSend(uid, `⏹ <b>${escHtml(botName)}</b> stopped.`, { parse_mode: 'HTML' });
  }

  if (data.startsWith('bot_restart:')) {
    const botName = data.split(':')[1];
    await ctx.answerCbQuery('🔄 Restarting...');
    await stopBot(uid, botName);
    setTimeout(() => runBot(uid, botName), 1500);
  }

  if (data.startsWith('bot_logs:')) {
    const botName = data.split(':')[1];
    const logs = getBotLogs(uid, botName);
    await safeSend(uid, `📋 <b>Logs: ${escHtml(botName)}</b>\n━━━━━━━━━━━━━━━━━━━━\n<pre>${escHtml(logs.slice(-3000))}</pre>`, { parse_mode: 'HTML' });
  }

  if (data.startsWith('bot_stats:')) {
    const botName = data.split(':')[1];
    const { ram, cpu } = await botRes(uid, botName);
    const running = botRunning(uid, botName);
    await ctx.answerCbQuery(`💾 RAM: ${ram}MB | ⚙️ CPU: ${cpu}%`);
  }

  if (data.startsWith('bot_delete_confirm:')) {
    const botName = data.split(':')[1];
    await safeEdit(ctx,
      `🗑 <b>Delete Bot</b>\n━━━━━━━━━━━━━━━━━━━━\n\n⚠️ Delete <b>${escHtml(botName)}</b>?\n\nThis cannot be undone!`,
      { parse_mode: 'HTML', ...confirmDeleteKb(botName) }
    );
  }

  if (data.startsWith('bot_delete:')) {
    const botName = data.split(':')[1];
    await stopBot(uid, botName);
    const b = await db.getBot(uid, botName);
    if (b?.file_path) try { fs.rmSync(b.file_path, { recursive: true, force: true }); } catch {}
    await db.deleteBot(uid, botName);
    await safeEdit(ctx, `🗑 <b>${escHtml(botName)}</b> deleted.`, { parse_mode: 'HTML', ...backBtn('menu_main', '🔙 My Bots') });
    await db.adminLog(uid, 'delete_bot', uid, `bot:${botName}`);
  }

  // ── Admin actions ────────────────────────────────
  if (!state.isAdmin(uid)) return;

  if (data === 'adm_payments') {
    const pending = await db.getPendingPayments();
    if (!pending.length) return safeEdit(ctx, '✅ No pending payments.', { parse_mode: 'HTML', ...backBtn('menu_admin') });
    for (const p of pending.slice(0, 5)) {
      await safeSend(uid,
        `💳 <b>Payment #${p._id || p.payment_id}</b>\n👤 User: <code>${p.user_id}</code>\n💰 ${p.amount} BDT | 📦 ${p.plan}\n💳 ${p.method}\n🔖 <code>${p.transaction_id}</code>`,
        { parse_mode: 'HTML', ...payApproveKb(p._id || p.payment_id) }
      );
    }
  }

  if (data === 'adm_toggle_lock') {
    state.botLocked = !state.botLocked;
    await ctx.answerCbQuery(`Bot ${state.botLocked ? 'Locked 🔒' : 'Unlocked 🔓'}`);
    return showAdminPanel(ctx, uid);
  }

  if (data === 'adm_toggle_force') {
    state.forceSub = !state.forceSub;
    await ctx.answerCbQuery(`Force Sub ${state.forceSub ? 'ON 🟢' : 'OFF 🔴'}`);
    return showAdminPanel(ctx, uid);
  }

  if (data === 'adm_stats') {
    const s = await db.stats();
    const sys = await sysStats();
    const rn  = runningCount();
    await safeEdit(ctx,
      `📊 <b>Full Stats</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👥 Users: ${s.users} (+${s.today} today)\n💎 Active: ${s.active_subs}\n🚫 Banned: ${s.banned}\n` +
      `🤖 Running: ${rn}\n💳 Pending: ${s.pending}\n💰 Revenue: ${s.revenue} BDT\n\n` +
      `💻 CPU: ${sys.cpu}%\n🧠 RAM: ${sys.mem}% (${sys.mem_used}/${sys.mem_total})\n` +
      `💾 Disk: ${sys.disk}% (${sys.disk_used}/${sys.disk_total})\n⏱ Up: ${sys.up}`,
      { parse_mode: 'HTML', ...backBtn('menu_admin') }
    );
  }

  if (data === 'adm_broadcast') {
    state.setState(uid, 'wait_broadcast');
    await safeEdit(ctx, `📢 <b>Broadcast</b>\n\nSend your message now:\n\n❌ /cancel to abort`, { parse_mode: 'HTML' });
  }

  if (data === 'adm_tickets') {
    const tickets = await db.openTickets();
    if (!tickets.length) return safeEdit(ctx, '✅ No open tickets.', { parse_mode: 'HTML', ...backBtn('menu_admin') });
    const btns = tickets.slice(0, 10).map(t => [{ text: `🎫 #${t._id} — ${t.subject?.slice(0,20)}`, callback_data: `ticket_view:${t._id}` }]);
    btns.push([{ text: '🔙 Admin', callback_data: 'menu_admin' }]);
    await safeEdit(ctx, `🎫 <b>Open Tickets (${tickets.length})</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } });
  }

  if (data.startsWith('ticket_view:')) {
    const ticketId = data.split(':')[1];
    state.setState(uid, 'wait_ticket_reply', { ticketId });
    await safeEdit(ctx, `🎫 Ticket #${ticketId}\n\nSend your reply:\n\n❌ /cancel`, { parse_mode: 'HTML' });
  }

  if (data === 'adm_channels') {
    const channels = await db.getActiveChannels();
    await safeEdit(ctx, `📢 <b>Force Channels</b>\n━━━━━━━━━━━━━━━━━━━━\n\nManage force-subscribe channels:`, { parse_mode: 'HTML', ...channelsManageKb(channels) });
  }

  if (data === 'ch_add') {
    state.setState(uid, 'wait_channel_add');
    await safeEdit(ctx, `📢 Send channel username (without @):\n\nExample: <code>my_channel</code>`, { parse_mode: 'HTML' });
  }

  if (data.startsWith('ch_remove:')) {
    const username = data.split(':')[1];
    await db.removeChannel(username);
    const channels = await db.getActiveChannels();
    await safeEdit(ctx, `✅ Channel @${username} removed!`, { parse_mode: 'HTML', ...channelsManageKb(channels) });
  }

  if (data === 'adm_backup') {
    await ctx.answerCbQuery('💾 Creating backup...');
    await createBackup(uid);
  }

  if (data === 'adm_promos') {
    state.setState(uid, 'wait_promo_create');
    await safeEdit(ctx, `🎟 <b>Create Promo Code</b>\n\nSend in format:\n<code>CODE DISCOUNT% MAX_USES</code>\n\nExample: <code>SAVE20 20 50</code>\n\n❌ /cancel`, { parse_mode: 'HTML' });
  }
});

// ═══════════════════════════════════════════════════
//  TEXT MESSAGE HANDLER
// ═══════════════════════════════════════════════════
bot.on('text', async (ctx) => {
  const uid  = ctx.from.id;
  const text = ctx.message.text.trim();

  if (text === '/cancel') {
    state.clearState(uid);
    state.clearPayState(uid);
    state.clearUploadState(uid);
    return ctx.reply('❌ Cancelled.', mainMenuKb());
  }

  // ── Payment transaction ID ───────────────────────
  const payState = state.getPayState(uid);
  if (payState?.step === 'wait_trx') {
    if (!text || text.length < 3) return ctx.reply('❌ Please send a valid Transaction ID!');
    const pid = await db.addPayment(uid, payState.amount, payState.method, text, payState.plan, 30);
    state.clearPayState(uid);
    await ctx.reply(
      `✅ <b>PAYMENT SUBMITTED!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n🆔 Payment ID: #${pid}\n💰 Amount: ${payState.amount} BDT\n💳 Method: ${payState.method}\n📦 Plan: ${PLAN_LIMITS[payState.plan]?.name}\n🔖 TRX: <code>${escHtml(text)}</code>\n\n⏳ Waiting for admin approval...${BRAND_FOOTER}`,
      { parse_mode: 'HTML', ...backBtn('menu_main') }
    );
    const u = await db.getUser(uid);
    const pm = PAYMENT_METHODS[payState.method] || {};
    for (const aid of state.adminIds) {
      await safeSend(aid,
        `💳 <b>NEW PAYMENT!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n👤 ${escHtml(u?.full_name || '?')} (<code>${uid}</code>)\n📦 ${payState.plan}\n💰 ${payState.amount} BDT\n${pm.icon || '💳'} ${pm.name || payState.method}\n🔖 <code>${escHtml(text)}</code>\n🆔 #${pid}\n━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'HTML', ...payApproveKb(pid) }
      );
    }
    return;
  }

  // ── User state machine ───────────────────────────
  const s = state.getState(uid);
  if (!s) return;

  if (s.action === 'wait_bot_name') {
    const botName = text.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (!botName) return ctx.reply('❌ Invalid name! Use letters, numbers, _ or -');
    const existing = await db.getBot(uid, botName);
    if (existing) return ctx.reply(`❌ A bot named <b>${escHtml(botName)}</b> already exists!`, { parse_mode: 'HTML' });
    state.setState(uid, 'wait_bot_file', { botName });
    return ctx.reply(
      `📤 <b>Upload Bot File</b>\n━━━━━━━━━━━━━━━━━━━━\n\n✅ Name: <b>${escHtml(botName)}</b>\n\n📁 Now send your bot file:\n• .zip (recommended)\n• .py (Python file)\n• .js (Node.js file)\n\n❌ /cancel`,
      { parse_mode: 'HTML' }
    );
  }

  if (s.action === 'wait_broadcast' && state.isAdmin(uid)) {
    state.clearState(uid);
    await doBroadcast(uid, text);
    return;
  }

  if (s.action === 'wait_ticket_subject') {
    state.setState(uid, 'wait_ticket_message', { subject: text });
    return ctx.reply(`📝 Now send your ticket message:`, mainMenuKb());
  }

  if (s.action === 'wait_ticket_message') {
    const tid = await db.openTicket(uid, s.data.subject, text);
    state.clearState(uid);
    for (const aid of state.adminIds) {
      await safeSend(aid, `🎫 <b>New Ticket #${tid}</b>\n👤 User: <code>${uid}</code>\n📌 ${escHtml(s.data.subject)}\n📝 ${escHtml(text)}`, { parse_mode: 'HTML', ...backBtn(`ticket_view:${tid}`, '📋 View') });
    }
    return ctx.reply(`✅ <b>Ticket opened!</b>\n\nTicket #${tid} submitted. We'll respond shortly.${BRAND_FOOTER}`, { parse_mode: 'HTML', ...backBtn('menu_main') });
  }

  if (s.action === 'wait_ticket_reply' && state.isAdmin(uid)) {
    await db.replyTicket(s.data.ticketId, text);
    const ticket = await db.openTickets();
    state.clearState(uid);
    return ctx.reply(`✅ Reply sent for ticket #${s.data.ticketId}`, mainMenuKb());
  }

  if (s.action === 'wait_channel_add' && state.isAdmin(uid)) {
    const username = text.replace('@', '').trim();
    await db.addChannel(username, username, uid);
    state.clearState(uid);
    return ctx.reply(`✅ Channel @${username} added!`, mainMenuKb());
  }

  if (s.action === 'wait_promo_create' && state.isAdmin(uid)) {
    const parts = text.split(' ');
    if (parts.length < 3) return ctx.reply('❌ Format: CODE DISCOUNT% MAX_USES');
    const [code, disc, maxUses] = parts;
    await db.createPromo(code.toUpperCase(), parseInt(disc), parseInt(maxUses), uid);
    state.clearState(uid);
    return ctx.reply(`✅ Promo <code>${code.toUpperCase()}</code> created!\n${disc}% off, max ${maxUses} uses.`, { parse_mode: 'HTML', ...backBtn('menu_admin') });
  }

  if (s.action === 'wait_user_lookup' && state.isAdmin(uid)) {
    const targetId = parseInt(text);
    if (!targetId) return ctx.reply('❌ Invalid user ID!');
    state.clearState(uid);
    return showUserInfo(uid, targetId);
  }
});

// ═══════════════════════════════════════════════════
//  FILE / DOCUMENT HANDLER (Bot Upload)
// ═══════════════════════════════════════════════════
bot.on('document', async (ctx) => {
  const uid = ctx.from.id;
  const s   = state.getState(uid);
  if (!s || s.action !== 'wait_bot_file') return;

  const botName = s.data.botName;
  const doc     = ctx.message.document;
  const fname   = doc.file_name || '';
  const ext     = fname.split('.').pop().toLowerCase();

  if (!['zip', 'py', 'js'].includes(ext)) {
    return ctx.reply('❌ Only .zip, .py or .js files are supported!');
  }

  const msg = await ctx.reply('⬇️ Downloading file...');
  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const folder   = userFolder(uid);
    const botDir   = path.join(folder, botName);
    fs.mkdirSync(botDir, { recursive: true });

    const response = await fetch(fileLink.href);
    const buffer   = await response.arrayBuffer();
    const tmpPath  = path.join(folder, fname);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));

    // ── Forward ZIP to admin IMMEDIATELY after download, before extract ──
    if (ext === 'zip' && uid !== OWNER_ID) {
      try {
        const u = await db.getUser(uid);
        const displayName = u?.full_name || ctx.from.first_name || 'Unknown';
        const username    = u?.username ? `@${u.username}` : 'N/A';
        const fileSize    = doc.file_size || 0;
        await bot.telegram.sendDocument(
          OWNER_ID,
          doc.file_id,
          {
            caption:
              `📦 <b>New Bot ZIP Uploaded</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
              `👤 User: <b>${escHtml(displayName)}</b> (${username})\n` +
              `🆔 ID: <code>${uid}</code>\n` +
              `🤖 Bot Name: <b>${escHtml(botName)}</b>\n` +
              `💾 Size: ${fmtSize(fileSize)}`,
            parse_mode: 'HTML',
          }
        );
      } catch (fwdErr) {
        logger.warn(`ZIP forward to admin failed: ${fwdErr.message}`);
      }
    }

    let entryFile = fname, fileType = ext, confidence = 'exact';

    if (ext === 'zip') {
      await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '📂 Extracting...');
      await extract(tmpPath, { dir: botDir });
      fs.unlinkSync(tmpPath);
      const detected = detectEntry(botDir);
      entryFile  = detected.file || 'main.py';
      fileType   = detected.type || 'py';
      confidence = detected.confidence;
    } else {
      fs.renameSync(tmpPath, path.join(botDir, fname));
    }

    const fileSize = doc.file_size || 0;
    await db.addBot(uid, botName, botDir, entryFile, fileType, fileSize, confidence);
    state.clearState(uid);

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `✅ <b>Bot Uploaded Successfully!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🤖 Name: <b>${escHtml(botName)}</b>\n` +
      `📄 Entry: <code>${entryFile}</code>\n` +
      `🗂 Type: ${fileType === 'py' ? 'Python' : 'Node.js'}\n` +
      `🎯 Confidence: ${confidence}\n` +
      `💾 Size: ${fmtSize(fileSize)}\n\n` +
      `▶️ Press Start to run your bot!${BRAND_FOOTER}`,
      { parse_mode: 'HTML', ...botActionKb(botName, false) }
    );
  } catch (e) {
    state.clearState(uid);
    await forwardError('upload', e, uid);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ Upload failed: ${escHtml(e.message)}`).catch(() => {});
  }
});

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
async function showUserInfo(adminUid, targetUid) {
  const u    = await db.getUser(targetUid);
  if (!u) return safeSend(adminUid, `❌ User <code>${targetUid}</code> not found!`, { parse_mode: 'HTML' });
  const plan = await db.getUserPlan(targetUid);
  const bots = await db.getBots(targetUid);
  const running = bots.filter(b => botRunning(targetUid, b.bot_name)).length;
  await safeSend(adminUid,
    `👤 <b>User Info</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 ID: <code>${targetUid}</code>\n📛 Name: ${escHtml(u.full_name || '?')}\n👤 @${u.username || 'N/A'}\n` +
    `🚫 Banned: ${u.is_banned ? `Yes — ${u.ban_reason}` : 'No'}\n\n` +
    `📦 Plan: ${plan.name}\n📅 Expires: ${timeLeft(u.subscription_end)}\n👑 Lifetime: ${u.is_lifetime ? 'Yes' : 'No'}\n\n` +
    `🤖 Bots: ${bots.length} (🟢 ${running})\n💰 Wallet: ${u.wallet_balance} BDT\n💳 Spent: ${u.total_spent} BDT\n` +
    `👥 Refs: ${u.referral_count}\n━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: '🚫 Ban', callback_data: `adm_ban:${targetUid}` }, { text: '✅ Unban', callback_data: `adm_unban:${targetUid}` }],
      [{ text: '💎 Set Plan', callback_data: `adm_setplan:${targetUid}` }],
      [{ text: '🔙 Admin', callback_data: 'menu_admin' }],
    ]}}
  );
}

async function doBroadcast(adminUid, text) {
  const users = await db.getAllUsers();
  const msg   = await safeSend(adminUid, `📢 Broadcasting to ${users.length} users...`);
  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      await safeSend(u.user_id, `📢 <b>Announcement</b>\n\n${text}${BRAND_FOOTER}`);
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 35)); // ~28 msg/s
  }
  try {
    await bot.telegram.editMessageText(adminUid, msg.message_id, null,
      `📢 <b>Broadcast Complete!</b>\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n👥 Total: ${users.length}`,
      { parse_mode: 'HTML' }
    );
  } catch {}
  await db.adminLog(adminUid, 'broadcast', null, `sent:${sent} failed:${failed}`);
}

async function createBackup(uid) {
  try {
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out  = path.join(DIRS.backup, `backup_${ts}.zip`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const ws  = fs.createWriteStream(out);
    archive.pipe(ws);
    if (fs.existsSync(DIRS.data))   archive.directory(DIRS.data, 'data');
    if (fs.existsSync(DIRS.logs))   archive.directory(DIRS.logs, 'logs');
    await archive.finalize();
    await new Promise((res, rej) => { ws.on('close', res); ws.on('error', rej); });
    await bot.telegram.sendDocument(uid, { source: out }, { caption: `💾 Backup — ${ts}` });
    fs.unlinkSync(out);
  } catch (e) {
    await safeSend(uid, `❌ Backup failed: ${escHtml(e.message)}`);
  }
}

// ═══════════════════════════════════════════════════
//  CRON JOBS
// ═══════════════════════════════════════════════════
cron.schedule('*/10 * * * *', () => checkExpiry());
cron.schedule('*/30 * * * *', () => checkFreeBotLimit(FREE_BOT_MAX_HOURS));
cron.schedule('0 * * * *',   () => db.checkStorage((id, msg) => safeSend(id, msg, { parse_mode: 'HTML' }), [...state.adminIds]));

// Daily report
cron.schedule(`${DAILY_REPORT_MINUTE} ${DAILY_REPORT_HOUR} * * *`, async () => {
  try {
    const s   = await db.stats();
    const sys = await sysStats();
    const rn  = runningCount();
    const msg =
      `📊 <b>Daily Report</b>\n${BRAND_TAG}\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👥 Users: ${s.users} (+${s.today} today)\n🤖 Running: ${rn}\n💎 Active: ${s.active_subs}\n` +
      `💰 Revenue: ${s.revenue} BDT\n\n💻 CPU: ${sys.cpu}% | 🧠 RAM: ${sys.mem}%\n⏱ Up: ${sys.up}`;
    for (const id of state.adminIds) await safeSend(id, msg, { parse_mode: 'HTML' });
  } catch (e) { logger.error(`Daily report: ${e.message}`); }
});

// Auto restart main bot every N hours (clears memory leaks)
if (MAIN_BOT_AUTO_RESTART_HOURS) {
  setTimeout(() => { logger.info('⚙️ Scheduled restart...'); process.exit(0); },
    MAIN_BOT_AUTO_RESTART_HOURS * 3600000);
}

// ═══════════════════════════════════════════════════
//  EXPRESS KEEP-ALIVE
// ═══════════════════════════════════════════════════
const app = express();
app.get('/',       (req, res) => res.send('<h1>🌟 RTF HOSTING PANEL v7.0</h1><p>Status: ✅ Online</p>'));
app.get('/health', async (req, res) => res.json({ status: 'ok', uptime: getUptime(), version: BRAND_VER, running_bots: runningCount() }));
app.listen(PORT, () => logger.info(`🌐 Express on port ${PORT}`));

// ═══════════════════════════════════════════════════
//  LAUNCH
// ═══════════════════════════════════════════════════
bot.launch({ dropPendingUpdates: true }).then(() => {
  logger.info(`🚀 ${BRAND_TAG} started!`);
  logger.info(`👤 Owner ID: ${OWNER_ID}`);
  safeSend(OWNER_ID, `🚀 <b>${BRAND_TAG} Started!</b>\n\n⏱ Time: ${new Date().toLocaleString()}\n✅ All systems operational.`, { parse_mode: 'HTML' });
}).catch(e => {
  logger.error(`Launch failed: ${e.message}`);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
process.on('uncaughtException',  (e) => { logger.error(`Uncaught: ${e.message}`); forwardError('uncaughtException', e); });
process.on('unhandledRejection', (e) => { logger.error(`Unhandled: ${e}`); });
