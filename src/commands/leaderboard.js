// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — LEADERBOARD v4.0
//  .lb [page]  |  .lb race [page]
//  Short numbers: 1B / 1.5M / 500K
// ═══════════════════════════════════════════════════════════════

const HOUSE_BUY_PRICES = {
  studio:0, apartment:1_000_000, duplex:3_500_000, bungalow:7_000_000,
  townhouse:15_000_000, villa:40_000_000, mansion:100_000_000, penthouse:200_000_000,
};
const VALUABLE_BASE = {
  gold:85000, silver:4500, diamond:500000, ruby:250000, emerald:180000, platinum:120000,
};

const PAGE_SIZE = 5; // players per page

// Format big numbers: 1,500,000 → $1.5M
function fmt(n) {
  if (n === undefined || n === null) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

class LeaderboardCommand {
  constructor(db) { this.db = db; }

  xpForLevel(level) { return level * (level + 1) / 2 * 100; }
  getLevelFromXP(xp) {
    let level = 0;
    while (this.xpForLevel(level + 1) <= xp) level++;
    return Math.min(level, 50); // Max level 50
  }

  calcNetworth(p) {
    let nw = (p.cash || 0) + (p.bank || 0);

    // ── Crypto wallet free balance (uninvested $) ────────────────────────
    nw += (p.cryptoBalance || 0);

    // ── Vehicles — in garage (player.vehicles) and in house garages ──────
    nw += (p.vehicles || []).reduce((s, v) => s + (v.price || 0), 0);
    // Also count cars stored in house garages
    const allHouses = p.houses || (p.house ? [p.house] : []);
    for (const h of allHouses) {
      nw += (h.garageVehicles || []).reduce((s, v) => s + (v.price || 0), 0);
    }

    // ── Businesses ───────────────────────────────────────────────────────
    nw += (p.businesses || []).reduce((s, b) => s + (b.price || 0), 0);

    // ── Houses — all owned properties ───────────────────────────────────
    for (const h of allHouses) {
      if (h.owned && h.type) nw += HOUSE_BUY_PRICES[h.type] || 0;
      // Cash stored in vault
      nw += (h.vault?._cash || 0);
    }

    // ── Weapons / guns ───────────────────────────────────────────────────
    try {
      const { GUNS } = require('./guns');
      for (const w of (p.weapons || [])) {
        const gun = GUNS[w.id];
        if (gun?.price) nw += gun.price;
      }
    } catch {}

    // ── Valuables — inventory + all vault slots ──────────────────────────
    const vMkt = this.db.data.valuableMarket || {};
    const inv  = p.inventory || {};
    // Inventory
    for (const [k, qty] of Object.entries(inv)) {
      if (VALUABLE_BASE[k] && qty > 0) nw += (vMkt[k]?.price || VALUABLE_BASE[k]) * qty;
    }
    // All house vaults
    for (const h of allHouses) {
      for (const [k, qty] of Object.entries(h.vault || {})) {
        if (k === '_cash') continue;
        if (VALUABLE_BASE[k] && qty > 0) nw += (vMkt[k]?.price || VALUABLE_BASE[k]) * qty;
      }
    }

    // ── Crypto holdings (token value at current market price) ─────────────
    const cryptoMkt = this.db.data.cryptoMarketState?.market || {};
    for (const [sym, pos] of Object.entries(p.crypto || {})) {
      if (pos?.amount > 0 && cryptoMkt[sym]?.price) nw += pos.amount * cryptoMkt[sym].price;
    }

    return Math.round(nw);
  }

  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'race' || sub === 'racing') {
      let page = Math.max(1, parseInt(args[1]) || 1);
      return this._raceBoard(page, sender, chatJid, sock, message);
    }

    const isGroup = chatJid.endsWith('@g.us');
    if (!isGroup) {
      await sock.sendMessage(chatJid, { text: '📊 Leaderboard is only available in groups!' }, { quoted: message });
      return;
    }

    let page = Math.max(1, parseInt(sub) || parseInt(args[1]) || 1);
    return this._mainBoard(page, sender, chatJid, sock, message);
  }

  async _mainBoard(page, sender, chatJid, sock, message) {
    const allPlayers = Object.values(this.db.data.players);
    if (allPlayers.length === 0) {
      await sock.sendMessage(chatJid, { text: '❌ No players yet!' }, { quoted: message }); return;
    }

    const sorted    = [...allPlayers].sort((a, b) => this.calcNetworth(b) - this.calcNetworth(a));
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    page = Math.min(page, totalPages);// already let
    const slice     = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const medals  = ['🥇','🥈','🥉'];
    let text = `╔══════════════════════════════╗\n║  🏆 STREET EMPIRE TOP PLAYERS\n╚══════════════════════════════╝\n`;
    text += `📄 Page ${page}/${totalPages}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    slice.forEach((p, i) => {
      const rank = (page - 1) * PAGE_SIZE + i + 1;
      const medal = medals[rank - 1] || `${rank}.`;
      const nw    = this.calcNetworth(p);
      const name  = p.nickname || p.name || p.id?.split('@')[0] || 'Unknown';
      const lvl   = this.getLevelFromXP(p.experience || 0);
      const crew  = p.crew ? ` [${p.crew}]` : '';

      // Assets summary
      const cars   = (p.vehicles || []).length;
      const biz    = (p.businesses || []).length;
      const house  = p.house?.type ? `${p.house.owned ? '🏠' : '🏡'} ${p.house.type}` : null;

      text += `${medal} *${name}*${crew}\n`;
      text += `   Lv.${lvl} ${p.role || 'Street Rat'}\n`;
      text += `   💵 ${fmt(p.cash||0)}  🏦 ${fmt(p.bank||0)}\n`;

      // Asset line — only show what they have
      const assetParts = [];
      if (cars > 0)  assetParts.push(`🚗 ${cars}`);
      if (biz > 0)   assetParts.push(`🏢 ${biz}`);
      if (house)     assetParts.push(house);
      if (assetParts.length) text += `   ${assetParts.join('  ')}\n`;

      text += `   💎 Net: *${fmt(nw)}*\n\n`;
    });

    const myRank = sorted.findIndex(p => p.id === sender) + 1;
    const me     = this.db.getPlayer(sender);
    const myNW   = this.calcNetworth(me);

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📍 You: #${myRank || '?'} | ${fmt(myNW)}\n`;
    if (totalPages > 1) {
      text += `\n📄 *.lb ${page < totalPages ? page + 1 : 1}* — next page`;
    }
    text += `\n🏁 *.lb race* — race rankings`;

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _raceBoard(page, sender, chatJid, sock, message) {
    const allPlayers = Object.values(this.db.data.players)
      .filter(p => (p.stats?.racesWon || 0) > 0)
      .sort((a, b) => (b.stats?.racesWon || 0) - (a.stats?.racesWon || 0));

    if (allPlayers.length === 0) {
      await sock.sendMessage(chatJid, { text: '🏁 No race wins yet! Start: .race [bet]' }, { quoted: message }); return;
    }

    const totalPages = Math.ceil(allPlayers.length / PAGE_SIZE);
    page = Math.min(page, totalPages);// already let
    const slice = allPlayers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const medals = ['🥇','🥈','🥉'];

    let text = `╔════════════════════════════╗\n║  🏁 RACE LEADERBOARD\n╚════════════════════════════╝\n`;
    text += `📄 Page ${page}/${totalPages}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    slice.forEach((p, i) => {
      const rank  = (page - 1) * PAGE_SIZE + i + 1;
      const medal = medals[rank - 1] || `${rank}.`;
      const name  = p.nickname || p.name || p.id?.split('@')[0] || 'Unknown';
      const car   = p.vehicles?.[p.equippedVehicle ?? 0];
      text += `${medal} *${name}*\n`;
      text += `   🏆 ${p.stats?.racesWon || 0} wins`;
      if (car) text += `  🚗 ${car.name} (${car.topSpeed} km/h)`;
      text += `\n   ⭐ ${(p.experience||0).toLocaleString()} XP\n\n`;
    });

    const myWins = this.db.getPlayer(sender)?.stats?.racesWon || 0;
    const myRank = allPlayers.findIndex(p => p.id === sender) + 1;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🏁 You: ${myWins} wins${myRank > 0 ? ` | #${myRank}` : ''}`;
    if (totalPages > 1) text += `\n📄 *.lb race ${page < totalPages ? page + 1 : 1}* — next page`;

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

module.exports = LeaderboardCommand;
