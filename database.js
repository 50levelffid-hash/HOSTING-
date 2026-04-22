/**
 * ╔══════════════════════════════════════════╗
 * ║  DATABASE MODULE v7.0                   ║
 * ║  MongoDB Primary → Backup → Memory      ║
 * ╚══════════════════════════════════════════╝
 */

import mongoose from 'mongoose';
import { MONGO_URL, MONGO_URL_BACKUP, DB_NAME, OWNER_ID, PLAN_LIMITS, DB_STORAGE_WARN_MB, DB_STORAGE_LIMIT_MB } from './config.js';
import { logger } from './core/logger.js';

// ── Connection state ─────────────────────────────────────────
let isMongoConnected = false;
let isBackupMongo   = false;
let storageWarnLevel = 0;

async function connectMongo(url, label = 'PRIMARY') {
  if (!url) return false;
  try {
    await mongoose.connect(url, {
      dbName: DB_NAME,
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isMongoConnected = true;
    logger.info(`✅ MongoDB ${label} connected!`);
    return true;
  } catch (e) {
    logger.warn(`⚠️ MongoDB ${label} failed: ${e.message}`);
    return false;
  }
}

if (!(await connectMongo(MONGO_URL, 'PRIMARY'))) {
  if (await connectMongo(MONGO_URL_BACKUP, 'BACKUP')) {
    isBackupMongo = true;
  } else {
    logger.warn('⚠️ Both MongoDB URLs failed. Using in-memory fallback.');
  }
}

// ═══════════════════════════════════════════════════
//  SCHEMAS
// ═══════════════════════════════════════════════════
const userSchema = new mongoose.Schema({
  user_id:          { type: Number, required: true, unique: true },
  username:         { type: String, default: '' },
  full_name:        { type: String, default: '' },
  plan:             { type: String, default: 'free' },
  wallet_balance:   { type: Number, default: 0 },
  total_spent:      { type: Number, default: 0 },
  is_banned:        { type: Boolean, default: false },
  ban_reason:       { type: String, default: '' },
  is_lifetime:      { type: Boolean, default: false },
  subscription_end: { type: Date, default: null },
  referral_code:    { type: String, default: '' },
  referred_by:      { type: Number, default: null },
  referral_count:   { type: Number, default: 0 },
  referral_earnings:{ type: Number, default: 0 },
  referral_level:   { type: String, default: 'bronze' },
  last_active:      { type: Date, default: Date.now },
  created_at:       { type: Date, default: Date.now },
}, { timestamps: false });

const botSchema = new mongoose.Schema({
  user_id:       { type: Number, required: true, index: true },
  bot_name:      { type: String, required: true },
  file_path:     { type: String, required: true },
  entry_file:    { type: String, default: 'main.py' },
  file_type:     { type: String, default: 'py' },
  bot_token:     { type: String, default: '' },
  status:        { type: String, default: 'stopped', index: true },
  total_restarts:{ type: Number, default: 0 },
  file_size:     { type: Number, default: 0 },
  detection_confidence: { type: String, default: '' },
  last_started:  { type: Date, default: null },
  last_stopped:  { type: Date, default: null },
  last_crash:    { type: Date, default: null },
  created_at:    { type: Date, default: Date.now },
});

const paymentSchema = new mongoose.Schema({
  user_id:       { type: Number, required: true },
  amount:        { type: Number, required: true },
  method:        { type: String, required: true },
  transaction_id:{ type: String, required: true },
  plan:          { type: String, required: true },
  duration_days: { type: Number, default: 30 },
  status:        { type: String, default: 'pending', index: true },
  approved_by:   { type: Number, default: null },
  created_at:    { type: Date, default: Date.now },
  processed_at:  { type: Date, default: null },
});

const referralSchema = new mongoose.Schema({
  referrer_id: { type: Number, required: true },
  referred_id: { type: Number, required: true },
  bonus_days:  { type: Number, default: 0 },
  commission:  { type: Number, default: 0 },
  created_at:  { type: Date, default: Date.now },
});

const walletTxSchema = new mongoose.Schema({
  user_id:     { type: Number, required: true },
  amount:      { type: Number, required: true },
  tx_type:     { type: String, required: true },
  description: { type: String, default: '' },
  created_at:  { type: Date, default: Date.now },
});

const forceChannelSchema = new mongoose.Schema({
  channel_username: { type: String, unique: true, required: true },
  channel_name:     { type: String, default: '' },
  is_active:        { type: Boolean, default: true },
  added_by:         { type: Number, default: null },
  created_at:       { type: Date, default: Date.now },
});

const ticketSchema = new mongoose.Schema({
  user_id:     { type: Number, required: true },
  subject:     { type: String, default: '' },
  message:     { type: String, default: '' },
  admin_reply: { type: String, default: '' },
  status:      { type: String, default: 'open' },
  created_at:  { type: Date, default: Date.now },
});

const notifSchema = new mongoose.Schema({
  user_id:    { type: Number, required: true, index: true },
  title:      { type: String, default: '' },
  message:    { type: String, default: '' },
  is_read:    { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

const promoSchema = new mongoose.Schema({
  code:        { type: String, unique: true, required: true },
  discount_pct:{ type: Number, default: 0 },
  max_uses:    { type: Number, default: 1 },
  used_count:  { type: Number, default: 0 },
  is_active:   { type: Boolean, default: true },
  created_by:  { type: Number, default: null },
  created_at:  { type: Date, default: Date.now },
});

const adminLogSchema = new mongoose.Schema({
  admin_id:   { type: Number, required: true },
  action:     { type: String, required: true },
  target_user:{ type: Number, default: null },
  details:    { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
});

// ── Models ───────────────────────────────────────────────────
const User      = mongoose.model('User',       userSchema);
const Bot       = mongoose.model('Bot',        botSchema);
const Payment   = mongoose.model('Payment',    paymentSchema);
const Referral  = mongoose.model('Referral',   referralSchema);
const WalletTx  = mongoose.model('WalletTx',   walletTxSchema);
const ForceChannel = mongoose.model('ForceChannel', forceChannelSchema);
const Ticket    = mongoose.model('Ticket',     ticketSchema);
const Notif     = mongoose.model('Notif',      notifSchema);
const Promo     = mongoose.model('Promo',      promoSchema);
const AdminLog  = mongoose.model('AdminLog',   adminLogSchema);

// In-memory fallback store
const memStore = { users: new Map(), bots: new Map(), payments: [] };

// ═══════════════════════════════════════════════════
//  DB CLASS
// ═══════════════════════════════════════════════════
class Database {

  // ── Users ──────────────────────────────────────
  async getUser(uid) {
    if (!isMongoConnected) return memStore.users.get(uid) || null;
    return await User.findOne({ user_id: uid }).lean();
  }

  async getUserByRefCode(code) {
    if (!isMongoConnected) {
      for (const u of memStore.users.values()) if (u.referral_code === code) return u;
      return null;
    }
    return await User.findOne({ referral_code: code }).lean();
  }

  async createUser(uid, username = '', fullName = '', refCode = '', referredBy = null) {
    if (!isMongoConnected) {
      if (!memStore.users.has(uid)) {
        memStore.users.set(uid, { user_id: uid, username, full_name: fullName, plan: 'free',
          wallet_balance: 0, total_spent: 0, is_banned: false, ban_reason: '',
          is_lifetime: false, subscription_end: null, referral_code: refCode,
          referred_by: referredBy, referral_count: 0, referral_earnings: 0,
          referral_level: 'bronze', last_active: new Date(), created_at: new Date() });
      }
      return;
    }
    await User.findOneAndUpdate(
      { user_id: uid },
      { $setOnInsert: { user_id: uid, username, full_name: fullName,
        plan: 'free', wallet_balance: 0, total_spent: 0, is_banned: false,
        ban_reason: '', is_lifetime: false, subscription_end: null,
        referral_code: refCode, referred_by: referredBy,
        referral_count: 0, referral_earnings: 0, referral_level: 'bronze',
        last_active: new Date(), created_at: new Date() }},
      { upsert: true }
    );
  }

  async updateUser(uid, fields) {
    if (!isMongoConnected) {
      const u = memStore.users.get(uid);
      if (u) memStore.users.set(uid, { ...u, ...fields });
      return;
    }
    await User.updateOne({ user_id: uid }, { $set: fields });
  }

  async updateLastActive(uid) {
    await this.updateUser(uid, { last_active: new Date() });
  }

  async getAllUsers() {
    if (!isMongoConnected) return [...memStore.users.values()];
    return await User.find({}, { _id: 0, user_id: 1, username: 1, full_name: 1 }).lean();
  }

  async banUser(uid, reason = '') {
    await this.updateUser(uid, { is_banned: true, ban_reason: reason });
  }

  async unbanUser(uid) {
    await this.updateUser(uid, { is_banned: false, ban_reason: '' });
  }

  // ── Plans ──────────────────────────────────────
  async setPlan(uid, plan, days = 30) {
    const end = new Date(Date.now() + days * 86400000);
    const isLifetime = plan === 'lifetime';
    await this.updateUser(uid, { plan, subscription_end: isLifetime ? null : end, is_lifetime: isLifetime });
  }

  async getUserPlan(uid) {
    const u = await this.getUser(uid);
    if (!u) return PLAN_LIMITS.free;
    if (u.is_lifetime) return PLAN_LIMITS[u.plan] || PLAN_LIMITS.lifetime;
    if (u.subscription_end && new Date(u.subscription_end) < new Date()) {
      await this.updateUser(uid, { plan: 'free' });
      return PLAN_LIMITS.free;
    }
    return PLAN_LIMITS[u.plan] || PLAN_LIMITS.free;
  }

  // ── Bots ───────────────────────────────────────
  async getBots(uid) {
    if (!isMongoConnected) return (memStore.bots.get(uid) || []);
    return await Bot.find({ user_id: uid }, { _id: 0 }).lean();
  }

  async getBot(uid, botName) {
    if (!isMongoConnected) {
      return (memStore.bots.get(uid) || []).find(b => b.bot_name === botName) || null;
    }
    return await Bot.findOne({ user_id: uid, bot_name: botName }, { _id: 0 }).lean();
  }

  async botCount(uid) {
    if (!isMongoConnected) return (memStore.bots.get(uid) || []).length;
    return await Bot.countDocuments({ user_id: uid });
  }

  async addBot(uid, botName, filePath, entryFile = 'main.py', fileType = 'py', fileSize = 0, confidence = '') {
    if (!isMongoConnected) {
      const list = memStore.bots.get(uid) || [];
      list.push({ user_id: uid, bot_name: botName, file_path: filePath, entry_file: entryFile,
        file_type: fileType, status: 'stopped', total_restarts: 0, file_size: fileSize,
        detection_confidence: confidence, created_at: new Date() });
      memStore.bots.set(uid, list);
      return;
    }
    await Bot.findOneAndUpdate(
      { user_id: uid, bot_name: botName },
      { $set: { file_path: filePath, entry_file: entryFile, file_type: fileType,
        file_size: fileSize, detection_confidence: confidence, status: 'stopped' }},
      { upsert: true }
    );
  }

  async updateBotStatus(uid, botName, status) {
    const now = new Date();
    const update = { status };
    if (status === 'running') update.last_started = now;
    if (status === 'stopped') update.last_stopped = now;
    if (status === 'crashed') update.last_crash = now;
    if (!isMongoConnected) {
      const list = memStore.bots.get(uid) || [];
      const b = list.find(b => b.bot_name === botName);
      if (b) Object.assign(b, update);
      return;
    }
    await Bot.updateOne({ user_id: uid, bot_name: botName }, { $set: update });
  }

  async incrementBotRestarts(uid, botName) {
    if (!isMongoConnected) return;
    await Bot.updateOne({ user_id: uid, bot_name: botName }, { $inc: { total_restarts: 1 } });
  }

  async deleteBot(uid, botName) {
    if (!isMongoConnected) {
      const list = (memStore.bots.get(uid) || []).filter(b => b.bot_name !== botName);
      memStore.bots.set(uid, list);
      return;
    }
    await Bot.deleteOne({ user_id: uid, bot_name: botName });
  }

  async getAllRunningBots() {
    if (!isMongoConnected) {
      const all = [];
      for (const list of memStore.bots.values()) all.push(...list.filter(b => b.status === 'running'));
      return all;
    }
    return await Bot.find({ status: 'running' }, { _id: 0 }).lean();
  }

  // ── Payments ───────────────────────────────────
  async addPayment(uid, amount, method, trxId, plan, days = 30) {
    if (!isMongoConnected) {
      const id = memStore.payments.length + 1;
      memStore.payments.push({ payment_id: id, user_id: uid, amount, method,
        transaction_id: trxId, plan, duration_days: days, status: 'pending',
        created_at: new Date() });
      return id;
    }
    const p = await Payment.create({ user_id: uid, amount, method,
      transaction_id: trxId, plan, duration_days: days, status: 'pending' });
    return p._id.toString();
  }

  async getPendingPayments() {
    if (!isMongoConnected) return memStore.payments.filter(p => p.status === 'pending');
    return await Payment.find({ status: 'pending' }, { _id: 1, user_id: 1, amount: 1, method: 1, transaction_id: 1, plan: 1, duration_days: 1, created_at: 1 }).lean();
  }

  async approvePayment(payId, adminId) {
    if (!isMongoConnected) {
      const p = memStore.payments.find(p => String(p.payment_id) === String(payId));
      if (p) { p.status = 'approved'; p.approved_by = adminId; p.processed_at = new Date(); }
      return p || null;
    }
    const p = await Payment.findByIdAndUpdate(payId,
      { $set: { status: 'approved', approved_by: adminId, processed_at: new Date() }},
      { new: true }
    ).lean();
    return p;
  }

  async rejectPayment(payId, adminId) {
    if (!isMongoConnected) {
      const p = memStore.payments.find(p => String(p.payment_id) === String(payId));
      if (p) { p.status = 'rejected'; p.approved_by = adminId; p.processed_at = new Date(); }
      return p || null;
    }
    const p = await Payment.findByIdAndUpdate(payId,
      { $set: { status: 'rejected', approved_by: adminId, processed_at: new Date() }},
      { new: true }
    ).lean();
    return p;
  }

  // ── Wallet ─────────────────────────────────────
  async addWallet(uid, amount, type, desc = '') {
    await this.updateUser(uid, { $inc: { wallet_balance: amount } });
    if (isMongoConnected) await WalletTx.create({ user_id: uid, amount, tx_type: type, description: desc });
  }

  async deductWallet(uid, amount, desc = '') {
    const u = await this.getUser(uid);
    if (!u || u.wallet_balance < amount) return false;
    await this.updateUser(uid, { wallet_balance: u.wallet_balance - amount });
    if (isMongoConnected) await WalletTx.create({ user_id: uid, amount: -amount, tx_type: 'deduct', description: desc });
    return true;
  }

  // ── Referrals ──────────────────────────────────
  async addReferral(referrerId, referredId, bonusDays = 3, commission = 0) {
    if (!isMongoConnected) return;
    await Referral.create({ referrer_id: referrerId, referred_id: referredId, bonus_days: bonusDays, commission });
    await User.updateOne({ user_id: referrerId }, { $inc: { referral_count: 1, referral_earnings: commission } });
  }

  // ── Force Channels ─────────────────────────────
  async getActiveChannels() {
    if (!isMongoConnected) return [];
    return await ForceChannel.find({ is_active: true }, { _id: 0 }).lean();
  }

  async addChannel(username, name, addedBy) {
    if (!isMongoConnected) return;
    await ForceChannel.findOneAndUpdate(
      { channel_username: username },
      { $set: { channel_name: name, is_active: true, added_by: addedBy }},
      { upsert: true }
    );
  }

  async removeChannel(username) {
    if (!isMongoConnected) return;
    await ForceChannel.deleteOne({ channel_username: username });
  }

  // ── Tickets ────────────────────────────────────
  async openTicket(uid, subject, message) {
    if (!isMongoConnected) return null;
    const t = await Ticket.create({ user_id: uid, subject, message });
    return t._id.toString();
  }

  async openTickets() {
    if (!isMongoConnected) return [];
    return await Ticket.find({ status: 'open' }, { _id: 1, user_id: 1, subject: 1, created_at: 1 }).lean();
  }

  async replyTicket(ticketId, reply) {
    if (!isMongoConnected) return;
    await Ticket.findByIdAndUpdate(ticketId, { $set: { admin_reply: reply, status: 'closed' } });
  }

  // ── Notifications ──────────────────────────────
  async addNotif(uid, title, message) {
    if (!isMongoConnected) return;
    await Notif.create({ user_id: uid, title, message });
  }

  async getNotifs(uid) {
    if (!isMongoConnected) return [];
    return await Notif.find({ user_id: uid, is_read: false }).sort({ created_at: -1 }).limit(10).lean();
  }

  async markNotifsRead(uid) {
    if (!isMongoConnected) return;
    await Notif.updateMany({ user_id: uid, is_read: false }, { $set: { is_read: true } });
  }

  // ── Promo Codes ────────────────────────────────
  async createPromo(code, discountPct, maxUses, createdBy) {
    if (!isMongoConnected) return;
    await Promo.create({ code, discount_pct: discountPct, max_uses: maxUses, created_by: createdBy });
  }

  async usePromo(code) {
    if (!isMongoConnected) return null;
    const p = await Promo.findOne({ code, is_active: true });
    if (!p || p.used_count >= p.max_uses) return null;
    await Promo.updateOne({ code }, { $inc: { used_count: 1 } });
    if (p.used_count + 1 >= p.max_uses) await Promo.updateOne({ code }, { $set: { is_active: false } });
    return p;
  }

  // ── Admin Logs ─────────────────────────────────
  async adminLog(adminId, action, targetUser = null, details = '') {
    if (!isMongoConnected) return;
    await AdminLog.create({ admin_id: adminId, action, target_user: targetUser, details });
  }

  // ── Stats ──────────────────────────────────────
  async stats() {
    if (!isMongoConnected) {
      return { users: memStore.users.size, bots: 0, active_subs: 0,
               banned: 0, pending: 0, revenue: 0, today: 0 };
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const [users, active_subs, banned, pending, revenue, today_users] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ $or: [{ is_lifetime: true }, { subscription_end: { $gt: new Date() } }] }),
      User.countDocuments({ is_banned: true }),
      Payment.countDocuments({ status: 'pending' }),
      Payment.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      User.countDocuments({ created_at: { $gte: today } }),
    ]);
    return { users, active_subs, banned, pending, revenue: revenue[0]?.total || 0, today: today_users };
  }

  // ── Storage Monitor ────────────────────────────
  async checkStorage(sendFn, adminIds) {
    try {
      if (!isMongoConnected) return;
      const conn = mongoose.connection.db;
      const dbStats = await conn.stats();
      const sizeMb = Math.round(dbStats.storageSize / (1024 * 1024) * 10) / 10;
      const dbLabel = `MongoDB ${isBackupMongo ? '(Backup)' : '(Primary)'}`;

      if (sizeMb >= DB_STORAGE_LIMIT_MB && storageWarnLevel < 2) {
        storageWarnLevel = 2;
        let failoverOk = false;
        if (!isBackupMongo && MONGO_URL_BACKUP) {
          failoverOk = await connectMongo(MONGO_URL_BACKUP, 'BACKUP-FAILOVER');
          if (failoverOk) isBackupMongo = true;
        }
        const msg = failoverOk
          ? `🔴 <b>DATABASE STORAGE CRITICAL!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📊 ${dbLabel}: <b>${sizeMb} MB</b>\n\n✅ <b>Auto-switched to Secondary MongoDB!</b>\n⚠️ Please free up space on Primary DB.\n🤖 Bot is running normally.\n━━━━━━━━━━━━━━━━━━━━`
          : `🔴 <b>DATABASE STORAGE CRITICAL!</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📊 ${dbLabel}: <b>${sizeMb} MB</b>\n\n⚠️ No backup DB available.\n🛠 Action required!\n━━━━━━━━━━━━━━━━━━━━`;
        for (const id of adminIds) try { await sendFn(id, msg); } catch {}
      } else if (sizeMb >= DB_STORAGE_WARN_MB && storageWarnLevel < 1) {
        storageWarnLevel = 1;
        const msg = `🟡 <b>DATABASE STORAGE WARNING</b>\n━━━━━━━━━━━━━━━━━━━━\n\n📊 ${dbLabel}: <b>${sizeMb} MB</b>\n⚠️ Getting close to limit (${DB_STORAGE_LIMIT_MB} MB).\n━━━━━━━━━━━━━━━━━━━━`;
        for (const id of adminIds) try { await sendFn(id, msg); } catch {}
      } else if (sizeMb < DB_STORAGE_WARN_MB * 0.9) {
        storageWarnLevel = 0;
      }
    } catch (e) {
      logger.error(`StorageMonitor error: ${e.message}`);
    }
  }
}

export const db = new Database();
