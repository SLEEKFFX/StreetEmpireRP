// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — POLICE REPORT & PRISON  v2.0
//  • Players can report raiders/robbers to police
//    - Report is ONLY accepted if the suspect actually robbed/raided the reporter
//  • Reported players go to prison (locked from most commands)
//  • Allowed while in prison: .menu, .profile, .police (bribe/break/status/wanted)
//  • Bribe and prison break can only be attempted ONCE per sentence
// ═══════════════════════════════════════════════════════════════

const { resolveMention, normJid } = require('../utils/resolveMention');
const BankingCommand = require('./banking');

const REPORT_COST      = 100_000; // $100k to file
const REPORT_MIN_LEVEL = 20;       // Must be level 20+
const PRISON_DURATION  = 60 * 60 * 1000;  // 1 hour
const BRIBE_SUCCESS    = 0.40;             // 40% escape chance
const BREAK_SUCCESS    = 0.25;             // 25% prison break chance
const BREAK_COST_HP    = 30;               // HP lost on attempt

// Commands allowed while in prison (lowercase, no dot)
const PRISON_ALLOWED = new Set(['menu','moneymenu','crimemenu','propmenu','pvpmenu','socialmenu','utilitymenu','profile','police','cop']);

class PoliceCommand {
  constructor(db) { this.db = db; }

  // ── Static gate used by commandHandler ────────────────────────────────────
  static isInPrison(db, playerId) {
    const p = db.data.players[playerId];
    if (!p || !p.prison) return false;
    return p.prison.until > Date.now();
  }

  static isPrisonAllowed(command) {
    return PRISON_ALLOWED.has(command.toLowerCase());
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  async execute(args, sender, chatJid, sock, message) {
    sender    = normJid(sender);
    const p   = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'help' || sub === 'menu') return this.showMenu(p, sender, chatJid, sock, message);
    if (sub === 'report')  return this.fileReport(args.slice(1), p, sender, chatJid, sock, message);
    if (sub === 'bribe')   return this.bribeCops(p, sender, chatJid, sock, message);
    if (sub === 'break')   return this.prisonBreak(p, sender, chatJid, sock, message);
    if (sub === 'status')  return this.checkPrisonStatus(p, sender, chatJid, sock, message);
    if (sub === 'wanted')  return this.showWantedList(chatJid, sock, message);

    return this.showMenu(p, sender, chatJid, sock, message);
  }

  // ── Menu ──────────────────────────────────────────────────────────────────
  async showMenu(p, sender, chatJid, sock, message) {
    const inPrison = this._isInPrison(p);
    const lines = [
      `🚔 *SEPD — POLICE STATION*`,
      `━━━━━━━━━━━━━━━━━━━━━`,
      ``,
    ];

    if (inPrison) {
      const rem = Math.ceil((p.prison.until - Date.now()) / 60000);
      lines.push(`🔒 *YOU ARE IN PRISON!*`);
      lines.push(`Sentence: ${rem} minute(s) remaining`);
      lines.push(`Reason: ${p.prison.reason || 'Criminal activity'}`);
      lines.push(``);
      if (!p.prison.bribeUsed) {
        lines.push(`💰 *.police bribe* — Bribe a cop (40% success)`);
        lines.push(`   Cost: $${this._bribeCost(p).toLocaleString()}`);
      } else {
        lines.push(`💰 Bribe — ❌ Already attempted`);
      }
      if (!p.prison.breakUsed) {
        lines.push(`🏃 *.police break* — Prison break attempt (25% success)`);
        lines.push(`   Risk: -${BREAK_COST_HP} HP on failure`);
      } else {
        lines.push(`🏃 Prison Break — ❌ Already attempted`);
      }
      lines.push(``);
      lines.push(`⚠️ You cannot use other commands while imprisoned.`);
    } else {
      lines.push(`✅ You are free.`);
      lines.push(``);
      lines.push(`📋 *REPORT A CRIMINAL:*`);
      lines.push(`*.police report @player [rob/raid]* — File a report`);
      lines.push(`Cost: $${REPORT_COST.toLocaleString()} | Min Level: ${REPORT_MIN_LEVEL} | Sends suspect to prison 1hr`);
      lines.push(`⚠️ You can only report someone who actually robbed/raided you!`);
      lines.push(``);
      lines.push(`⚠️ Suspects can bribe or break out!`);
      lines.push(`🔍 *.police wanted* — See who's in prison`);
      lines.push(`📊 *.police status* — Check your status`);
    }

    lines.push(``);
    lines.push(`🌡️ Your Heat Level: ${this._getHeatLevel(p)} 🔥`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── File Report ───────────────────────────────────────────────────────────
  async fileReport(args, reporter, reporterId, chatJid, sock, message) {
    const _rawPoliceTarget = resolveMention(message, args, 0);
    const targetId = normJid(_rawPoliceTarget);

    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `❌ Tag a player!\n*.police report @player [rob/raid]*` }, { quoted: message }); return;
    }
    if (targetId === reporterId) {
      await sock.sendMessage(chatJid, { text: `❌ Can't report yourself!` }, { quoted: message }); return;
    }

    const rawReason = (args[1] || '').toLowerCase();
    const reason    = (rawReason === 'rob' || rawReason === 'robbery') ? 'rob'
                    : (rawReason === 'raid') ? 'raid'
                    : null;

    if (!reason) {
      await sock.sendMessage(chatJid, { text: `❌ Specify a crime: *rob* or *raid*\n*.police report @player rob*\n*.police report @player raid*` }, { quoted: message }); return;
    }

    // ── Validate: did the suspect actually commit this unreported crime against the reporter? ──
    let verified = false;
    if (reason === 'rob') {
      try { verified = require('./rob').didRob(targetId, reporterId); } catch(e) {}
    } else if (reason === 'raid') {
      try { verified = require('./raid').didRaid(targetId, reporterId); } catch(e) {}
    }

    if (!verified) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *REPORT REJECTED — NO EVIDENCE*`,
          ``,
          `Officers could not verify that ${this.db.getDisplayName(targetId)} committed an unreported *${reason}* against you in the last 24 hours.`,
          ``,
          `Either the crime didn't happen, it was already reported, or the suspect already served jail for it.`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    // Cooldown check
    if (this.db.checkCooldown(reporterId, 'police_report')) {
      const rem = this.db.getCooldownRemaining(reporterId, 'police_report');
      await sock.sendMessage(chatJid, { text: `⏰ Report cooldown: ${Math.ceil(rem/60)}m` }, { quoted: message }); return;
    }

    // Level requirement — level is derived from XP, never stored directly
    const _xpForLvl = (l) => l * (l + 1) / 2 * 100;
    const _lvlFromXP = (xp) => { let l = 0; while (_xpForLvl(l + 1) <= xp) l++; return Math.min(l, 50); };
    const reporterLevel = _lvlFromXP(reporter.experience || 0);
    if (reporterLevel < REPORT_MIN_LEVEL) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *INSUFFICIENT RANK*`,
          ``,
          `Filing a police report requires *Level ${REPORT_MIN_LEVEL}+*`,
          `Your level: *${reporterLevel}*`,
          ``,
          `Only high-ranking players have the clout to get officers moving.`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    if ((reporter.cash||0) < REPORT_COST) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *NOT ENOUGH CASH*`,
          ``,
          `Filing a report costs *$${REPORT_COST.toLocaleString()}*`,
          `💵 You have: $${(reporter.cash||0).toLocaleString()}`,
          ``,
          `Reports cost serious money — bribery, processing fees, paperwork.`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    if (!this.db.data.players[targetId]) {
      await sock.sendMessage(chatJid, { text: `❌ Player not found.` }, { quoted: message }); return;
    }
    const suspect = this.db.getPlayer(targetId);

    if (this._isInPrison(suspect)) {
      const rem = Math.ceil((suspect.prison.until - Date.now()) / 60000);
      await sock.sendMessage(chatJid, { text: `ℹ️ ${this.db.getDisplayName(targetId)} is already in prison (${rem}m remaining).` }, { quoted: message }); return;
    }

    // Deduct cost
    reporter.cash -= REPORT_COST;
    this.db.updatePlayer(reporterId, reporter);

    // Send to prison
    suspect.prison = {
      until:      Date.now() + PRISON_DURATION,
      reason:     reason === 'rob' ? 'Armed Robbery' : 'Home Invasion / Raid',
      reportedBy: reporterId,
      bribeUsed:  false,   // one-attempt flag
      breakUsed:  false,   // one-attempt flag
    };
    suspect.stats               = suspect.stats || {};
    suspect.stats.timesArrested = (suspect.stats.timesArrested || 0) + 1;
    suspect.heatLevel           = Math.min(10, (suspect.heatLevel || 0) + 1);
    suspect.lastHeatIncreaseAt  = Date.now();
    this.db.updatePlayer(targetId, suspect);

    this.db.addCooldown(reporterId, 'police_report', 30 * 60 * 1000);

    // ── Mark the crime as reported so it cannot be filed again after jail ──
    if (reason === 'rob') {
      try { require('./rob').markRobReported(targetId, reporterId); } catch(e) {}
    } else if (reason === 'raid') {
      try { require('./raid').markRaidReported(targetId, reporterId); } catch(e) {}
    }

    BankingCommand.recordExternal(this.db, reporterId, {
      type: 'Police Report Fee', amount: REPORT_COST,
      sender: this.db.getDisplayName(reporterId), receiver: 'SEPD',
      note: `Filed ${reason} report against ${this.db.getDisplayName(targetId)}`, balance: reporter.cash,
    });

    await sock.sendMessage(chatJid, {
      text: [
        `🚔 *REPORT FILED — SUSPECT ARRESTED!*`,
        ``,
        `👮 Officers verify the ${reason} evidence...`,
        `✅ Evidence confirmed! *${this.db.getDisplayName(targetId)}* has been arrested!`,
        `📋 Charge: ${suspect.prison.reason}`,
        `⏰ Sentence: 1 hour`,
        ``,
        `💸 Filing fee: -$${REPORT_COST.toLocaleString()}`,
        `💵 Your cash: $${reporter.cash.toLocaleString()}`,
        ``,
        `⚠️ They can attempt bribe (40%) or prison break (25%) — each once!`,
      ].join('\n')
    }, { quoted: message });

    try {
      await sock.sendMessage(targetId, {
        text: [
          `🚔 *YOU'VE BEEN ARRESTED!*`,
          ``,
          `${this.db.getDisplayName(reporterId)} filed a report against you for *${suspect.prison.reason}*!`,
          `🔒 Prison time: 1 hour`,
          `⚠️ Most commands are locked while in prison!`,
          ``,
          `You have ONE chance at each escape option:`,
          `💰 *.police bribe* — 40% success (cost: $${this._bribeCost(suspect).toLocaleString()})`,
          `🏃 *.police break* — 25% success (risk: -${BREAK_COST_HP} HP on fail)`,
        ].join('\n')
      });
    } catch (e) {}
  }

  // ── Bribe ─────────────────────────────────────────────────────────────────
  async bribeCops(prisoner, prisonerId, chatJid, sock, message) {
    const p = this.db.getPlayer(prisonerId);

    if (!this._isInPrison(p)) {
      await sock.sendMessage(chatJid, { text: `✅ You're not in prison! You're a free person.` }, { quoted: message }); return;
    }

    if (p.prison.bribeUsed) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *BRIBE ALREADY ATTEMPTED*`,
          ``,
          `You've already tried to bribe your way out this sentence.`,
          `The officers are onto you now — try *.police break* if you haven't yet.`,
          `⏰ Time remaining: ${Math.ceil((p.prison.until - Date.now())/60000)}m`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    const cost = this._bribeCost(p);
    if ((p.cash||0) < cost) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *NOT ENOUGH CASH TO BRIBE!*`,
          ``,
          `Bribe cost: $${cost.toLocaleString()}`,
          `Your cash: $${(p.cash||0).toLocaleString()}`,
          ``,
          `⏰ Serve your time: ${Math.ceil((p.prison.until - Date.now())/60000)}m remaining`,
          `🏃 Or try *.police break* for a prison break (25% chance, no cash needed)`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    // Mark attempt used BEFORE the roll
    p.prison.bribeUsed = true;
    p.cash -= cost;

    BankingCommand.recordExternal(this.db, prisonerId, {
      type: 'Police Bribe', amount: cost,
      sender: this.db.getDisplayName(prisonerId), receiver: 'SEPD Officer',
      note: `Bribe attempt — ${Math.random() < BRIBE_SUCCESS ? 'SUCCESS' : 'FAILED'}`, balance: p.cash,
    });

    const success = Math.random() < BRIBE_SUCCESS;

    if (success) {
      p.prison    = null;
      p.heatLevel = Math.max(0, (p.heatLevel || 0) - 1);
      this.db.updatePlayer(prisonerId, p);

      await sock.sendMessage(chatJid, {
        text: [
          `🤝 *BRIBE SUCCESSFUL!*`,
          ``,
          `💰 The officer pockets $${cost.toLocaleString()} and looks the other way...`,
          `🔓 You walk out the back door. You're FREE!`,
          ``,
          `⚠️ Stay low. Heat Level: ${this._getHeatLevel(p)} 🔥`,
          `💵 Cash: $${p.cash.toLocaleString()}`,
        ].join('\n')
      }, { quoted: message });
    } else {
      p.prison.until += 30 * 60 * 1000; // +30 min penalty
      p.heatLevel = Math.min(10, (p.heatLevel || 0) + 2);
      p.lastHeatIncreaseAt = Date.now();
      this.db.updatePlayer(prisonerId, p);

      await sock.sendMessage(chatJid, {
        text: [
          `🚨 *BRIBE ATTEMPT FAILED!*`,
          ``,
          `The officer wasn't interested in your dirty money...`,
          `💸 Lost: -$${cost.toLocaleString()} (confiscated)`,
          `⛓️ +30 minutes added to sentence!`,
          `🌡️ Heat Level: ${this._getHeatLevel(p)} 🔥 (rising!)`,
          ``,
          p.prison.breakUsed
            ? `❌ Prison break already used. Serve your time.`
            : `🏃 One option left: *.police break* (25% chance, no cash needed)`,
          `⏰ Time remaining: ${Math.ceil((p.prison.until - Date.now())/60000)}m`,
          `💵 Cash: $${p.cash.toLocaleString()}`,
        ].join('\n')
      }, { quoted: message });
    }
  }

  // ── Prison Break ──────────────────────────────────────────────────────────
  async prisonBreak(p, prisonerId, chatJid, sock, message) {
    p = this.db.getPlayer(prisonerId);

    if (!this._isInPrison(p)) {
      await sock.sendMessage(chatJid, { text: `✅ You're already free! No need to break out.` }, { quoted: message }); return;
    }

    if (p.prison.breakUsed) {
      await sock.sendMessage(chatJid, {
        text: [
          `❌ *PRISON BREAK ALREADY ATTEMPTED*`,
          ``,
          `You already made your escape attempt this sentence — and it failed.`,
          p.prison.bribeUsed
            ? `Both escape options are used up. Serve your remaining time.`
            : `Try *.police bribe* if you have the cash.`,
          `⏰ Time remaining: ${Math.ceil((p.prison.until - Date.now())/60000)}m`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    // Mark attempt used BEFORE the roll
    p.prison.breakUsed = true;

    const success = Math.random() < BREAK_SUCCESS;

    if (success) {
      p.prison    = null;
      p.heatLevel = Math.min(10, (p.heatLevel || 0) + 1); // heat goes up even on success
      p.lastHeatIncreaseAt = Date.now();
      this.db.updatePlayer(prisonerId, p);

      await sock.sendMessage(chatJid, {
        text: [
          `🏃 *PRISON BREAK — SUCCESSFUL!*`,
          ``,
          `You slipped past the guards and scaled the wall!`,
          `🔓 You're FREE! But the heat is rising...`,
          ``,
          `🌡️ Heat Level: ${this._getHeatLevel(p)} 🔥`,
          `⚠️ Lay low — police are searching for you.`,
        ].join('\n')
      }, { quoted: message });
    } else {
      const hp = p.health || 100;
      p.health = Math.max(1, hp - BREAK_COST_HP);
      p.prison.until += 15 * 60 * 1000; // +15 min penalty
      p.heatLevel = Math.min(10, (p.heatLevel || 0) + 1);
      p.lastHeatIncreaseAt = Date.now();
      this.db.updatePlayer(prisonerId, p);

      await sock.sendMessage(chatJid, {
        text: [
          `🚨 *PRISON BREAK — FAILED!*`,
          ``,
          `Guards caught you at the fence and beat you back!`,
          `❤️ HP: -${BREAK_COST_HP} (now ${p.health}/100)`,
          `⛓️ +15 minutes added to sentence!`,
          `🌡️ Heat Level: ${this._getHeatLevel(p)} 🔥`,
          ``,
          p.prison.bribeUsed
            ? `❌ Bribe already used too. Serve your time.`
            : `💰 One option left: *.police bribe* (40% chance, costs $${this._bribeCost(p).toLocaleString()})`,
          `⏰ Time remaining: ${Math.ceil((p.prison.until - Date.now())/60000)}m`,
        ].join('\n')
      }, { quoted: message });
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────
  async checkPrisonStatus(p, sender, chatJid, sock, message) {
    p = this.db.getPlayer(sender);
    const lines = [`📊 *POLICE STATUS*`, `━━━━━━━━━━━━━━━━━━`, ``];

    if (this._isInPrison(p)) {
      const rem = Math.ceil((p.prison.until - Date.now()) / 60000);
      lines.push(`🔒 STATUS: IN PRISON`);
      lines.push(`⏰ Time left: ${rem} minute(s)`);
      lines.push(`📋 Charge: ${p.prison.reason || 'Criminal activity'}`);
      lines.push(``);
      lines.push(`Escape options:`);
      lines.push(`💰 Bribe: ${p.prison.bribeUsed ? '❌ Used' : `Available — $${this._bribeCost(p).toLocaleString()} (40%)`}`);
      lines.push(`🏃 Break: ${p.prison.breakUsed ? '❌ Used' : 'Available — no cost (25%)'}`);
    } else {
      lines.push(`✅ STATUS: FREE`);
    }

    lines.push(``);
    lines.push(`🌡️ Heat Level: ${this._getHeatLevel(p)} 🔥`);
    lines.push(`👮 Times Arrested: ${p.stats?.timesArrested || 0}`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── Wanted List ───────────────────────────────────────────────────────────
  async showWantedList(chatJid, sock, message) {
    const now       = Date.now();
    const prisoners = Object.values(this.db.data.players)
      .filter(p => p.prison && p.prison.until > now)
      .sort((a, b) => b.prison.until - a.prison.until)
      .slice(0, 10);

    if (prisoners.length === 0) {
      await sock.sendMessage(chatJid, { text: `🏙️ *WANTED LIST*\n\nThe streets are clean for now. No one is in prison.` }, { quoted: message }); return;
    }

    const lines = [`🚔 *MOST WANTED — IN PRISON*`, `━━━━━━━━━━━━━━━━━━━━━━━━━━`, ``];
    prisoners.forEach((p, i) => {
      const rem  = Math.ceil((p.prison.until - now) / 60000);
      const name = this.db.getDisplayName(p.id);
      lines.push(`${i+1}. *${name}*  —  ${rem}m remaining`);
      lines.push(`   📋 Charge: ${p.prison.reason || 'unknown'}`);
    });

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _isInPrison(p) {
    return p.prison && p.prison.until > Date.now();
  }

  _bribeCost(p) {
    const base = 10000;
    return base + ((p.heatLevel || 0) * 5000);
  }

  _getHeatLevel(p) {
    const heat = p.heatLevel || 0;
    if (heat <= 1) return `${heat}/10 (Low)`;
    if (heat <= 3) return `${heat}/10 (Moderate)`;
    if (heat <= 6) return `${heat}/10 (Hot)`;
    if (heat <= 8) return `${heat}/10 (Very Hot)`;
    return `${heat}/10 (MAXIMUM 🚨)`;
  }
}

module.exports = PoliceCommand;
