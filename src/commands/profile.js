class ProfileCommand {
  constructor(db) {
    this.db = db;
  }

  getRoleEmoji(role) {
    const emojis = { 'Noobie': '👶', 'Corner Boy': '👤', 'Soldier': '💼', 'Shot Caller': '👑', 'Crime Lord': '💎' };
    return emojis[role] || '👤';
  }

  xpForLevel(level) {
    // Cumulative XP needed to reach this level
    // Level 1 = 100, Level 2 = 300 (100+200), Level 3 = 600 (100+200+300) ...
    return level * (level + 1) / 2 * 100;
  }

  getLevelFromXP(xp) {
    let level = 0;
    while (this.xpForLevel(level + 1) <= xp) level++;
    return Math.min(level, 50); // Max level 50
  }

  xpBar(experience) {
    const level = this.getLevelFromXP(experience);
    const currentThreshold = this.xpForLevel(level);
    const nextThreshold = this.xpForLevel(level + 1);
    const xpInLevel = experience - currentThreshold;
    const xpNeeded = nextThreshold - currentThreshold;
    const filled = Math.min(10, Math.floor((xpInLevel / xpNeeded) * 10));
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    return `[${bar}] ${xpInLevel}/${xpNeeded} XP → Lv${level + 1}`;
  }

  async execute(args, sender, chatJid, sock, message) {
    let targetId = sender;
    let isOwnProfile = true;

    if (args.length > 0) {
      // Priority: mentionedJid from WhatsApp context (works for @mentions in groups)
      const mentions =
        message?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      if (mentions.length > 0) {
        targetId = mentions[0];
      } else {
        // Fallback: strip all non-digits from the argument to get phone number
        const digits = args[0].replace(/\D/g, '');
        if (digits.length >= 5) {
          const { normJid } = require('../utils/resolveMention');
          targetId = normJid(digits + '@s.whatsapp.net');
        }
      }
      isOwnProfile = (targetId === sender);
    } else if (message?.message?.extendedTextMessage?.contextInfo?.participant) {
      targetId = message.message.extendedTextMessage.contextInfo.participant;
      isOwnProfile = (targetId === sender);
    }

    // FIX: do NOT call getPlayer (auto-creates ghost accounts).
    // Check the raw players store first.
    if (targetId !== sender && !this.db.data.players[targetId]) {
      await sock.sendMessage(chatJid, {
        text: `❌ Player not found!\n\nThat player hasn't started playing yet.\nThey need to send *.menu* first.`
      }, { quoted: message });
      return;
    }

    const p = this.db.getPlayer(targetId); // safe now
    const level = this.getLevelFromXP(p.experience || 0);
    const _HP = {apartment:1e6,duplex:3.5e6,bungalow:7e6,townhouse:15e6,villa:40e6,mansion:100e6,penthouse:200e6};
    const _VB = {gold:85000,silver:4500,diamond:500000,ruby:250000,emerald:180000,platinum:120000};
    let networth = (p.cash||0) + (p.bank||0)
      + (p.vehicles||[]).reduce((s,v)=>s+(v.price||0),0)
      + (p.businesses||[]).reduce((s,b)=>s+(b.price||0),0);
    if (p.house?.owned && p.house?.type) networth += _HP[p.house.type]||0;
    const _cMkt = this.db.data.cryptoMarketState?.market||{};
    for (const [sym,pos] of Object.entries(p.crypto||{})) if (pos?.amount>0&&_cMkt[sym]?.price) networth+=pos.amount*_cMkt[sym].price;
    const _vMkt = this.db.data.valuableMarket||{};
    for (const loc of [p.inventory||{}, p.house?.vault||{}])
      for (const [k,qty] of Object.entries(loc)) if (_VB[k]&&qty>0) networth+=(_vMkt[k]?.price||_VB[k])*qty;
    networth = Math.round(networth);

    const displayName = p.nickname || p.name;

    const text = `
╔══════════════════════╗
║  ${this.getRoleEmoji(p.role)} ${displayName.toUpperCase()}
║  Rank ${p.rank || 1} • Rep: ${p.reputation || 0}
╚══════════════════════╝

💰 Cash:  $${(p.cash || 0).toLocaleString()}
🏦 Bank:  $${(p.bank || 0).toLocaleString()}
💎 Worth: $${networth.toLocaleString()}

🎖️ Role: ${p.role || 'Street Rat'}
⭐ Level ${level}
${this.xpBar(p.experience || 0)}

━━━━━━━━━━━━━━━━━━━━━━
📊 STATS:
  Heists Done:   ${p.stats?.heistsDone || 0}
  Races Won:     ${p.stats?.racesWon || 0}
  Money Earned:  $${(p.stats?.moneyEarned || 0).toLocaleString()}
  Money Lost:    $${(p.stats?.moneyLost || 0).toLocaleString()}
  Arrested:      ${p.stats?.timesArrested || 0}

━━━━━━━━━━━━━━━━━━━━━━━
🚗 ASSETS:
  Vehicles:   ${(p.vehicles || []).length}
  Businesses: ${(p.businesses || []).length}
  Weapons:    ${(p.weapons || []).length}
${(() => {
  const vlist = p.vehicles || [];
  const eqIdx = p.equippedVehicle ?? 0;
  const eq    = vlist[eqIdx];
  if (!eq) return '';
  const catIcon = eq.category === 'airplane' ? '✈️' : eq.category === 'boat' ? '🚤' : eq.category === 'bike' ? '🏍️' : '🚗';
  return `  ${catIcon} Equipped:  ${eq.name} (${eq.topSpeed} km/h)`;
})()}

👥 Crew: ${p.crew || 'None'}
🏢 Gang: ${p.gang || 'None'}

━━━━━━━━━━━━━━━━━━━━━━━
Last Active: ${new Date(p.lastActive).toLocaleString()}
${isOwnProfile ? '✅ Your profile' : '👤 Viewing: ' + displayName}
    `.trim();

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

module.exports = ProfileCommand;
