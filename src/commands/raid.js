const { resolveMention, resolveTwoMentions, normJid } = require('../utils/resolveMention');
// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — RAID  v1.0
//  Raid a tagged player's house (solo or with crew member)
//  Steal up to 30% of their cash/valuables

// Track recent raid victims: raiderId → [{ victimId, timestamp, reportedAt }]
// Used by police.js to validate reports
const raidVictimLog = {};

function logRaid(raiderId, victimId) {
  if (!raidVictimLog[raiderId]) raidVictimLog[raiderId] = [];
  raidVictimLog[raiderId].push({ victimId, timestamp: Date.now(), reportedAt: null });
  if (raidVictimLog[raiderId].length > 20) raidVictimLog[raiderId].shift();
}

function didRaid(raiderId, victimId) {
  const log = raidVictimLog[raiderId] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // within 24h
  // Only match entries that have NOT already been reported (prevents re-reporting same crime)
  return log.some(e => e.victimId === victimId && e.timestamp > cutoff && !e.reportedAt);
}

function markRaidReported(raiderId, victimId) {
  const log = raidVictimLog[raiderId] || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const entry = log.find(e => e.victimId === victimId && e.timestamp > cutoff && !e.reportedAt);
  if (entry) entry.reportedAt = Date.now();
}
//  Success chance based on: player level + guns + vs security
// ═══════════════════════════════════════════════════════════════

const BankingCommand = require('./banking');

const RAID_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

function calcAttackPower(player) {
  const level = Math.min(50, Math.floor((player.experience || 0) / 100));
  let gunPower = 0;
  try {
    const { gunScore, GUNS } = require('./guns');
    const rawGunPower = (player.weapons || []).reduce((s, w) => s + gunScore(GUNS[w.id] || { damage: 0, fireRate: 0 }), 0);
    // ── Hard cap on gun contribution ───────────────────────────────────────
    // Without a cap, high-firepower players (RPG etc) could push attackPower
    // so high that successChance = 40% + (huge number * 0.01) → near 100%.
    // Cap gun contribution so even max armament gives ≤ 30 extra attack points.
    // This means level is the primary driver, not weapons stockpiling.
    gunPower = Math.min(90, rawGunPower); // raw score capped at 90 before dividing
  } catch(e) {}
  return level * 3 + Math.floor(gunPower / 9); // level weight reduced, gun weight reduced
}

function calcDefensePower(houseData) {
  if (!houseData) return 0;
  let defense = 10;
  if (houseData.security?.type) {
    try {
      const { SECURITY } = require('./housing');
      const sdef = SECURITY[houseData.security.type];
      if (sdef && houseData.securityActive) defense += sdef.defenseBonus;
    } catch(e) {}
  }
  return defense;
}

class RaidCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize once at entry point
    const player = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    // .raid help or no args
    if (!sub || sub === 'help') {
      await sock.sendMessage(chatJid, {
        text: [
          `╔══════════════════════╗`,
          `║ 🏚️ HOUSE RAID`,
          `╚══════════════════════╝`,
          ``,
          `Raid a player's house to steal 30% of their cash!`,
          ``,
          `*Solo raid:*`,
          `.raid @player`,
          ``,
          `*Crew raid (extra power):*`,
          `.raid @player @crewmate`,
          ``,
          `• Success = your level + guns vs their security`,
          `• Steal up to 30% cash + some valuables`,
          `• Cooldown: 2 hours`,
          `• Target must own/rent a house`,
        ].join('\n')
      }, { quoted: message }); return;
    }

    // Parse target — read from WhatsApp mentionedJid, fall back to bare digits
    const [_rawRaidTarget, _rawPartner] = resolveTwoMentions(message, [sub, ...(args.slice(1))]);
    const targetId   = normJid(_rawRaidTarget);
    const _partnerIdEarly = normJid(_rawPartner);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `❌ Tag a player to raid!\nUsage: .raid @player` }, { quoted: message }); return;
    }
    if (targetId === sender) {
      await sock.sendMessage(chatJid, { text: `❌ Can't raid yourself!` }, { quoted: message }); return;
    }

    // Cooldown check
    if (this.db.checkCooldown(sender, 'raid')) {
      const rem = this.db.getCooldownRemaining(sender, 'raid');
      const mins = Math.ceil(rem / 60);
      await sock.sendMessage(chatJid, { text: `⏰ Lay low! Raid cooldown: ${mins}m` }, { quoted: message }); return;
    }

    const victim = this.db.getPlayer(targetId);
    if (!victim.house) {
      await sock.sendMessage(chatJid, { text: `❌ That player doesn't have a house to raid!` }, { quoted: message }); return;
    }

    // Optional crew partner (second mention or second bare number)
    let crewPartner = null;
    {
      const partnerId = _partnerIdEarly || normJid(resolveMention(message, args, 1, 1));
      if (partnerId) {
        const partnerData = this.db.data.players[partnerId];
        // Verify same crew
        if (partnerData && partnerData.crew && player.crew && partnerData.crew.toLowerCase() === player.crew.toLowerCase()) {
          crewPartner = partnerData;
        }
      }
    }

    // Set cooldown
    this.db.addCooldown(sender, 'raid', RAID_COOLDOWN_MS);

    // ── Power calculation ─────────────────────────────────
    let attackPower = calcAttackPower(player);
    if (crewPartner) attackPower += Math.floor(calcAttackPower(crewPartner) * 0.5); // crew bonus
    const defensePower = calcDefensePower(victim.houses ? victim.houses[0] : victim.house);

    // ── Success rate formula (rebalanced) ───────────────────────────────────
    // Base is now 25% (was 40%) — raids are genuinely risky by default.
    // Power difference has reduced weight (0.005 per point vs old 0.01).
    // This prevents high-firepower players from reaching near-100% success.
    const powerDiff   = attackPower - defensePower;
    let successChance = 0.25 + (powerDiff * 0.005);

    // ── Security level hard caps (tightened) ─────────────────────────────
    // No security:    max 55% (was 80%)
    // Level 1 (Watchman):   max 50%
    // Level 2 (Guard):      max 40%
    // Level 3 (Specialist): max 25%  (was 50%)
    // Level 4 (Elite):      max 15%  (was 30%)
    let maxSuccess = 0.55;
    const houseForRaid = victim.houses ? victim.houses[0] : victim.house;
    if (houseForRaid?.security?.type) {
      try {
        const { SECURITY } = require('./housing');
        const sdef = SECURITY[houseForRaid.security.type];
        if (sdef && houseForRaid.securityActive) {
          if (sdef.level === 1) maxSuccess = 0.50;
          if (sdef.level === 2) maxSuccess = 0.40;
          if (sdef.level === 3) maxSuccess = 0.25;
          if (sdef.level === 4) maxSuccess = 0.15;
        }
      } catch(e) {}
    }
    successChance = Math.max(0.05, Math.min(maxSuccess, successChance));

    const success = Math.random() < successChance;

    const robberName = this.db.getDisplayName(sender);
    const victimName = this.db.getDisplayName(targetId);

    if (success) {
      // Steal up to 30% cash
      const cashAvail = victim.cash || 0;
      const pct = 0.20 + Math.random() * 0.10; // 20-30%
      const cashStolen = Math.max(0, Math.floor(cashAvail * pct));

      // Steal up to 1 vault item (if they have a house vault)
      const vault = victim.house.vault || {};
      const vaultEntries = Object.entries(vault).filter(([, qty]) => qty > 0);
      let stolenValuable = null;

      if (vaultEntries.length > 0 && Math.random() < 0.4) {
        const [item, qty] = vaultEntries[Math.floor(Math.random() * vaultEntries.length)];
        const stealQty = Math.max(1, Math.floor(qty * 0.3));
        victim.house.vault[item] -= stealQty;
        stolenValuable = { item, qty: stealQty };
        if (!player.inventory) player.inventory = {};
        player.inventory[item] = (player.inventory[item] || 0) + stealQty;
      }

      victim.cash = Math.max(0, cashAvail - cashStolen);
      player.cash = (player.cash || 0) + cashStolen;
      player.experience = (player.experience || 0) + 25;
      player.stats = player.stats || {};
      player.stats.moneyEarned = (player.stats.moneyEarned || 0) + cashStolen;
      victim.stats = victim.stats || {};
      victim.stats.moneyLost = (victim.stats.moneyLost || 0) + cashStolen;

      this.db.updatePlayer(sender, player);
      this.db.updatePlayer(targetId, victim);

      // Log this raid so police reports can be validated
      logRaid(sender, targetId);

      let resultText = [
        `🏚️ *RAID SUCCESSFUL!*`,
        ``,
        `🎯 Target: ${victimName}`,
        crewPartner ? `👥 Crew assist: ${crewPartner.nickname || crewPartner.name}` : null,
        ``,
        `💰 Cash stolen: +$${cashStolen.toLocaleString()}`,
        stolenValuable ? `💎 Valuable stolen: ${stolenValuable.qty}x ${stolenValuable.item}` : null,
        `⭐ +25 XP`,
        ``,
        `Your cash: $${player.cash.toLocaleString()}`,
        `⏰ Cooldown: 2 hours`,
      ].filter(l => l !== null).join('\n');

      await sock.sendMessage(chatJid, { text: resultText }, { quoted: message });

      // Notify victim
      try {
        await sock.sendMessage(targetId, {
          text: `🚨 *YOUR HOUSE WAS RAIDED!*\n\nYou lost $${cashStolen.toLocaleString()} cash${stolenValuable ? ` + ${stolenValuable.qty}x ${stolenValuable.item}` : ''}!\n\n💡 Hire security: .house sec hire\n💡 Store cash in bank: .bank deposit\n💡 Report them: *.police report @player raid*`
        });
      } catch(e) {}

    } else {
      // Failed — fine
      const fine = Math.max(1000, Math.floor((player.cash || 0) * 0.05));
      player.cash = Math.max(0, (player.cash || 0) - fine);
      player.stats = player.stats || {};
      player.stats.timesArrested = (player.stats.timesArrested || 0) + 1;
      this.db.updatePlayer(sender, player);

      await sock.sendMessage(chatJid, {
        text: [
          `🚨 *RAID FAILED — CAUGHT!*`,
          ``,
          `${victimName}'s security held you back!`,
          `💸 Fine: -$${fine.toLocaleString()}`,
          ``,
          `💡 Level up & buy better guns for a higher success rate.`,
          `⏰ Cooldown: 2 hours`,
        ].join('\n')
      }, { quoted: message });
    }
  }
}

module.exports = RaidCommand;
module.exports.didRaid = didRaid;
module.exports.markRaidReported = markRaidReported;
