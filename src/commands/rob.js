const { resolveMention, normJid } = require('../utils/resolveMention');
const BankingCommand = require('./banking');

// Track recent rob victims: robberId → [{ victimId, timestamp, reportedAt }]
// Used by police.js to validate reports
// reportedAt: set when a police report is filed — prevents re-reporting same crime after jail served
const robVictimLog = {};

function logRob(robberId, victimId) {
  if (!robVictimLog[robberId]) robVictimLog[robberId] = [];
  robVictimLog[robberId].push({ victimId, timestamp: Date.now(), reportedAt: null });
  // Keep only last 20 entries
  if (robVictimLog[robberId].length > 20) robVictimLog[robberId].shift();
}

function didRob(robberId, victimId) {
  const log = robVictimLog[robberId] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // within 24h
  // Only match entries that have NOT already been reported
  return log.some(e => e.victimId === victimId && e.timestamp > cutoff && !e.reportedAt);
}

// Called by police.js when a report is successfully filed — marks the crime as reported
function markRobReported(robberId, victimId) {
  const log = robVictimLog[robberId] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const entry = log.find(e => e.victimId === victimId && e.timestamp > cutoff && !e.reportedAt);
  if (entry) entry.reportedAt = Date.now();
}

class RobCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize once at entry point
    const robber = this.db.getPlayer(sender);

    if (!args[0]) {
      await sock.sendMessage(chatJid, {
        text: `🔫 *ROB A PLAYER*\n\nUsage: *.rob @player*\n\n• 20% success rate\n• Steal 5–15% of their cash\n• Failure: you get caught, pay a fine\n• Cooldown: 30 minutes`
      }, { quoted: message });
      return;
    }

    if (this.db.checkCooldown(sender, 'rob')) {
      const rem = this.db.getCooldownRemaining(sender, 'rob');
      await sock.sendMessage(chatJid, { text: `⏰ Lay low! Cooldown: ${Math.ceil(rem / 60)}m` }, { quoted: message }); return;
    }

    const _rawRobTarget = resolveMention(message, args, 0);
    const targetId = _rawRobTarget ? normJid(_rawRobTarget) : null;
    if (!targetId) { await sock.sendMessage(chatJid, { text: '❌ Tag a valid player: .rob @player' }, { quoted: message }); return; }
    if (targetId === sender) { await sock.sendMessage(chatJid, { text: '❌ Cannot rob yourself!' }, { quoted: message }); return; }

    const victim = this.db.getPlayer(targetId);
    const robberName = this.db.getDisplayName(sender);
    const victimName = this.db.getDisplayName(targetId);

    this.db.addCooldown(sender, 'rob', 1800000); // 30 min

    const success = Math.random() < 0.20; // 20% success

    if (success) {
      const pct    = 0.05 + Math.random() * 0.10; // 5–15%
      const stolen = Math.min(100_000, Math.max(100, Math.floor((victim.cash || 0) * pct))); // $100k cap

      if ((victim.cash || 0) < 100) {
        await sock.sendMessage(chatJid, {
          text: `😅 *ROB ATTEMPT*\n\n${victimName} is broke! Nothing to steal.\n💸 Walk away empty-handed.`
        }, { quoted: message }); return;
      }

      this.db.data.players[targetId].cash  = Math.max(0, (victim.cash || 0) - stolen);
      this.db.data.players[sender].cash    = (robber.cash || 0) + stolen;
      this.db.data.players[sender].experience = (robber.experience || 0) + 10;
      this.db.data.players[sender].stats.moneyEarned = (robber.stats?.moneyEarned || 0) + stolen;
      this.db.data.players[targetId].stats.moneyLost = (victim.stats?.moneyLost || 0) + stolen;
      this.db.saveData();

      // Log this robbery so police reports can be validated
      logRob(sender, targetId);

      BankingCommand.recordExternal(this.db, sender, {
        type: 'Robbery', amount: stolen,
        sender: robberName, receiver: robberName,
        note: `Robbed ${victimName}`, balance: this.db.data.players[sender].cash,
      });
      BankingCommand.recordExternal(this.db, targetId, {
        type: 'Robbed', amount: stolen,
        sender: 'Unknown', receiver: victimName,
        note: `Stolen by unknown assailant`, balance: this.db.data.players[targetId].cash,
      });

      await sock.sendMessage(chatJid, {
        text: `🔫 *SUCCESSFUL ROBBERY!*\n\n💰 Stole: +$${stolen.toLocaleString()} from ${victimName}\n💵 Cash: $${this.db.data.players[sender].cash.toLocaleString()}\n⭐ +10 XP\n\n⏰ Cooldown: 30 minutes`
      }, { quoted: message });

      // Notify victim in DM
      try {
        await sock.sendMessage(targetId, {
          text: `🚨 *YOU WERE ROBBED!*\n\nSomeone stole *$${stolen.toLocaleString()}* from you!\n💵 Cash: $${this.db.data.players[targetId].cash.toLocaleString()}\n\n💡 Keep cash in bank to stay safe: *.bank deposit*\n💡 Report them: *.police report @player rob*`
        });
      } catch (e) {}

    } else {
      // Failed — pay a fine
      const fine = Math.max(500, Math.floor((robber.cash || 0) * 0.05));
      this.db.data.players[sender].cash = Math.max(0, (robber.cash || 0) - fine);
      this.db.data.players[sender].stats.timesArrested = (robber.stats?.timesArrested || 0) + 1;
      this.db.saveData();

      BankingCommand.recordExternal(this.db, sender, {
        type: 'Rob Fine', amount: fine,
        sender: robberName, receiver: 'LSPD',
        note: `Failed robbery on ${victimName}`, balance: this.db.data.players[sender].cash,
      });

      await sock.sendMessage(chatJid, {
        text: `🚨 *ROB FAILED — BUSTED!*\n\n${victimName} fought back!\n💸 Fine: -$${fine.toLocaleString()}\n👮 Arrests: ${this.db.data.players[sender].stats.timesArrested}\n\n💵 Cash: $${this.db.data.players[sender].cash.toLocaleString()}`
      }, { quoted: message });
    }
  }
}

module.exports = RobCommand;
module.exports.didRob = didRob;
module.exports.markRobReported = markRobReported;
