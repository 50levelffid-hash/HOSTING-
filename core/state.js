/**
 * STATE MODULE — Global in-memory state
 * Using Map for O(1) access, no external dependency
 */

import { OWNER_ID } from '../config.js';

class State {
  constructor() {
    this.botStartTime    = new Date();
    this.forceSub        = true;
    this.botLocked       = false;
    this.adminIds        = new Set([OWNER_ID]);
    this.userStates      = new Map();   // uid → { action, data }
    this.payStates       = new Map();   // uid → { step, plan, amount, method }
    this.uploadStates    = new Map();   // uid → { step, botName }
    this.userMsgTimes    = new Map();   // uid → [timestamps]
    this.botScripts      = new Map();   // key → { process, logFile, uid, botName, startTime }
  }

  isAdmin(uid) { return this.adminIds.has(uid); }

  // ── User state ──────────────────────────────────
  setState(uid, action, data = {}) { this.userStates.set(uid, { action, data }); }
  getState(uid) { return this.userStates.get(uid) || null; }
  clearState(uid) { this.userStates.delete(uid); }

  // ── Payment state ───────────────────────────────
  setPayState(uid, obj) { this.payStates.set(uid, obj); }
  getPayState(uid) { return this.payStates.get(uid) || null; }
  clearPayState(uid) { this.payStates.delete(uid); }

  // ── Upload state ────────────────────────────────
  setUploadState(uid, obj) { this.uploadStates.set(uid, obj); }
  getUploadState(uid) { return this.uploadStates.get(uid) || null; }
  clearUploadState(uid) { this.uploadStates.delete(uid); }

  // ── Rate limit ──────────────────────────────────
  rateCheck(uid) {
    const now = Date.now();
    if (!this.userMsgTimes.has(uid)) this.userMsgTimes.set(uid, []);
    const times = this.userMsgTimes.get(uid);
    while (times.length && now - times[0] > 60000) times.shift();
    if (times.length >= 30) return false;
    if (times.length && now - times[times.length - 1] < 200) return false;
    times.push(now);
    return true;
  }
}

export const state = new State();
