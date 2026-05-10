import { Markup } from 'telegraf';
import { PLAN_LIMITS, PAYMENT_METHODS } from '../config.js';

// ── Main Menu ─────────────────────────────────────────────────
export const mainMenuKb = () => Markup.keyboard([
  ['🤖 My Bots',    '📤 Upload Bot'],
  ['💎 My Plan',    '💰 Wallet'],
  ['💳 Buy Plan',   '👥 Referral'],
  ['📊 Stats',      '🎫 Support'],
  ['ℹ️ Help'],
]).resize();

export const helpMenuKb = () => Markup.keyboard([
  ['📘 How to Use', '❓ FAQ'],
  ['📢 Updates',    '📞 Contact'],
  ['🔙 Back'],
]).resize();

// ── Back Button ───────────────────────────────────────────────
export const backBtn   = (cb = 'menu_main',  text = '🔙 Back') => Markup.inlineKeyboard([[Markup.button.callback(text, cb)]]);
export const backHelpBtn = () => backBtn('menu_help', '🔙 Help Menu');

// ── Bot Actions ───────────────────────────────────────────────
export const botActionKb = (botName, isRunning) => Markup.inlineKeyboard([
  [
    isRunning
      ? Markup.button.callback('⏹ Stop',    `bot_stop:${botName}`)
      : Markup.button.callback('▶️ Start',   `bot_start:${botName}`),
    Markup.button.callback('🔄 Restart', `bot_restart:${botName}`),
  ],
  [
    Markup.button.callback('📋 Logs',  `bot_logs:${botName}`),
    Markup.button.callback('📊 Stats', `bot_stats:${botName}`),
  ],
  [
    Markup.button.callback('🗑 Delete', `bot_delete_confirm:${botName}`),
    Markup.button.callback('🔙 My Bots', 'menu_bots'),
  ],
]);

// ── Plan Keyboard ─────────────────────────────────────────────
export const planKb = () => {
  const btns = Object.entries(PLAN_LIMITS)
    .filter(([k]) => k !== 'free')
    .map(([k, v]) => [Markup.button.callback(`${v.name} — ${v.price} RS`, `plan_select:${k}`)]);
  btns.push([Markup.button.callback('🔙 Back', 'menu_main')]);
  return Markup.inlineKeyboard(btns);
};

// ── Payment Method ────────────────────────────────────────────
export const payMethodKb = (plan) => {
  const btns = Object.entries(PAYMENT_METHODS).map(([k, v]) =>
    [Markup.button.callback(`${v.icon} ${v.name}`, `pay_method:${plan}:${k}`)]
  );
  btns.push([Markup.button.callback('🔙 Back', 'buy_plan')]);
  return Markup.inlineKeyboard(btns);
};

// ── Payment Approve ───────────────────────────────────────────
export const payApproveKb = (payId) => Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Approve', `pay_approve:${payId}`),
    Markup.button.callback('❌ Reject',  `pay_reject:${payId}`),
  ],
]);

// ── Admin Panel ───────────────────────────────────────────────
export const adminKb = () => Markup.inlineKeyboard([
  [Markup.button.callback('👥 Users',           'adm_users'),
   Markup.button.callback('💳 Payments',        'adm_payments')],
  [Markup.button.callback('📢 Broadcast',       'adm_broadcast'),
   Markup.button.callback('🎫 Tickets',         'adm_tickets')],
  [Markup.button.callback('📢 Channels',        'adm_channels'),
   Markup.button.callback('🎟 Promos',          'adm_promos')],
  [Markup.button.callback('🔒 Toggle Lock',     'adm_toggle_lock'),
   Markup.button.callback('🔔 Toggle ForceSub', 'adm_toggle_force')],
  [Markup.button.callback('📊 Full Stats',      'adm_stats'),
   Markup.button.callback('💾 Backup DB',       'adm_backup')],
  [Markup.button.callback('🤖 All Users Files', 'adm_all_bots')],
  [Markup.button.callback('🔙 Close',           'menu_main')],
]);

// ── Admin All Bots Keyboard ───────────────────────────────────
export const admAllBotsKb = (bots) => {
  const btns = bots.map(b => [
    Markup.button.callback(
      `${b.running ? '🟢' : '🔴'} ${b.botName} — @${b.username || 'N/A'}`,
      `adm_bot_detail:${b.uid}:${b.botName}`
    )
  ]);
  btns.push([Markup.button.callback('🔙 Admin', 'menu_admin')]);
  return Markup.inlineKeyboard(btns);
};

// ── Admin Bot Detail Keyboard ─────────────────────────────────
export const admBotDetailKb = (uid, botName) => Markup.inlineKeyboard([
  [
    Markup.button.callback('⏹ Stop Bot',  `adm_stop_bot:${uid}:${botName}`),
    Markup.button.callback('🚫 Ban User', `adm_ban:${uid}`),
  ],
  [Markup.button.callback('🔙 All Bots', 'adm_all_bots')],
]);

// ── Channels Manage ───────────────────────────────────────────
export const channelsManageKb = (channels) => {
  const btns = channels.map(c =>
    [Markup.button.callback(`❌ Remove @${c.channel_username}`, `ch_remove:${c.channel_username}`)]
  );
  btns.push([Markup.button.callback('➕ Add Channel',   'ch_add')]);
  btns.push([Markup.button.callback('🔙 Admin Panel', 'menu_admin')]);
  return Markup.inlineKeyboard(btns);
};

// ── Confirm Delete ────────────────────────────────────────────
export const confirmDeleteKb = (botName) => Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Yes, Delete', `bot_delete:${botName}`),
    Markup.button.callback('❌ Cancel',      `bot_actions:${botName}`),
  ],
]);
