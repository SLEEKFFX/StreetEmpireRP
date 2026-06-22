// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — GUNS  v1.0
//  Buy guns, view arsenal, equip weapon for crew wars & raids
// ═══════════════════════════════════════════════════════════════

const GUNS = {
  // ── Pistols ───────────────────────────────────────────────
  glock: {
    name: 'Glock 17', emoji: '🔫', type: 'Pistol',
    price: 25_000, damage: 10, fireRate: 2,
    desc: 'Standard sidearm',
  },
  desert_eagle: {
    name: 'Desert Eagle', emoji: '🔫', type: 'Pistol',
    price: 80_000, damage: 22, fireRate: 1,
    desc: 'Hard-hitting semi-auto',
  },
  // ── SMGs ──────────────────────────────────────────────────
  uzi: {
    name: 'Uzi', emoji: '🔫', type: 'SMG',
    price: 60_000, damage: 12, fireRate: 4,
    desc: 'Spray and pray',
  },
  mp5: {
    name: 'MP5', emoji: '🔫', type: 'SMG',
    price: 120_000, damage: 15, fireRate: 5,
    desc: 'Compact and lethal',
  },
  // ── Shotguns ──────────────────────────────────────────────
  pump_shotgun: {
    name: 'Pump Shotgun', emoji: '🔫', type: 'Shotgun',
    price: 90_000, damage: 35, fireRate: 1,
    desc: 'Room cleaner',
  },
  spas12: {
    name: 'SPAS-12', emoji: '🔫', type: 'Shotgun',
    price: 180_000, damage: 50, fireRate: 2,
    desc: 'Semi-auto devastation',
  },
  // ── Rifles ────────────────────────────────────────────────
  ak47: {
    name: 'AK-47', emoji: '🔫', type: 'Rifle',
    price: 250_000, damage: 30, fireRate: 4,
    desc: 'The classic. Never jams.',
  },
  m4: {
    name: 'M4A1', emoji: '🔫', type: 'Rifle',
    price: 350_000, damage: 28, fireRate: 6,
    desc: 'Military grade',
  },
  // ── Snipers ───────────────────────────────────────────────
  awp: {
    name: 'AWP Sniper', emoji: '🔫', type: 'Sniper',
    price: 500_000, damage: 90, fireRate: 1,
    desc: 'One shot, one kill',
  },
  // ── Heavy ─────────────────────────────────────────────────
  minigun: {
    name: 'Minigun', emoji: '🔫', type: 'Heavy',
    price: 2_000_000, damage: 25, fireRate: 10,
    desc: 'Unstoppable force',
  },
  rpg: {
    name: 'RPG-7', emoji: '💥', type: 'Heavy',
    price: 3_500_000, damage: 150, fireRate: 1,
    desc: 'End the whole crew',
  },
};

// ── Gun power score for wars/raids ────────────────────────────
function gunScore(gun) {
  return (gun.damage * gun.fireRate);
}

// ─────────────────────────────────────────────────────────────
class GunsCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'shop' || sub === 'list') return this._shop(player, chatJid, sock, message);
    if (sub === 'buy')    return this._buy(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'equip')  return this._equip(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'arsenal' || sub === 'inv') return this._arsenal(player, chatJid, sock, message);
    if (sub === 'drop')   return this._drop(args.slice(1), sender, player, chatJid, sock, message);

    await sock.sendMessage(chatJid, {
      text: `🔫 *GUNS*\n\n.guns shop — browse weapons\n.guns buy [id] — purchase\n.guns equip [id] — equip for combat\n.guns arsenal — your weapons\n.guns drop [id] — discard`
    }, { quoted: message });
  }

  async _shop(player, chatJid, sock, message) {
    const types = [...new Set(Object.values(GUNS).map(g => g.type))];
    let text = `╔════════════════╗\n║ 🔫 GUN SHOP\n╚════════════════╝\n\n`;

    for (const type of types) {
      text += `*── ${type.toUpperCase()} ─────────────*\n`;
      for (const [id, g] of Object.entries(GUNS)) {
        if (g.type !== type) continue;
        const owned = (player.weapons || []).some(w => w.id === id);
        text += `${g.emoji} *${g.name}* ${owned ? '✅' : ''}\n`;
        text += `   💰 $${g.price.toLocaleString()} | DMG: ${g.damage} | Rate: ${g.fireRate}\n`;
        text += `   .guns buy ${id}\n\n`;
      }
    }
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _buy(args, sender, player, chatJid, sock, message) {
    const gid = (args[0] || '').toLowerCase();
    const gdef = GUNS[gid];
    if (!gdef) {
      await sock.sendMessage(chatJid, { text: `❌ Unknown gun ID.\nSee: .guns shop` }, { quoted: message }); return;
    }
    if ((player.weapons || []).some(w => w.id === gid)) {
      await sock.sendMessage(chatJid, { text: `❌ You already own a ${gdef.name}.` }, { quoted: message }); return;
    }
    const payFrom = (player.bank || 0) >= gdef.price ? 'bank' : (player.cash || 0) >= gdef.price ? 'cash' : null;
    if (!payFrom) {
      await sock.sendMessage(chatJid, { text: `❌ Not enough funds!\nCost: $${gdef.price.toLocaleString()}` }, { quoted: message }); return;
    }
    if (payFrom === 'bank') player.bank -= gdef.price;
    else player.cash -= gdef.price;
    if (!player.weapons) player.weapons = [];
    player.weapons.push({ id: gid, name: gdef.name, type: gdef.type, purchasedAt: Date.now() });
    if (!player.equippedGun) player.equippedGun = gid; // auto-equip if none equipped
    player.experience = (player.experience || 0) + 5;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, {
      text: `🔫 *PURCHASED!*\n\n${gdef.emoji} ${gdef.name}\n💰 Paid: $${gdef.price.toLocaleString()} (${payFrom})\n🎯 Damage: ${gdef.damage} | Rate: ${gdef.fireRate}\n${!player.equippedGun ? '✅ Auto-equipped' : ''}\n⭐ +5 XP`
    }, { quoted: message });
  }

  async _equip(args, sender, player, chatJid, sock, message) {
    const gid = (args[0] || '').toLowerCase();
    if (!player.weapons?.some(w => w.id === gid)) {
      await sock.sendMessage(chatJid, { text: `❌ You don't own that gun.\nCheck: .guns arsenal` }, { quoted: message }); return;
    }
    player.equippedGun = gid;
    this.db.updatePlayer(sender, player);
    const gdef = GUNS[gid];
    await sock.sendMessage(chatJid, { text: `🔫 *Equipped: ${gdef.name}*\nUsed in crew wars & house raids.` }, { quoted: message });
  }

  async _arsenal(player, chatJid, sock, message) {
    const weapons = player.weapons || [];
    if (weapons.length === 0) {
      await sock.sendMessage(chatJid, { text: `🔫 No weapons!\nBuy some: .guns shop` }, { quoted: message }); return;
    }
    let text = `🔫 *YOUR ARSENAL*\n\n`;
    let totalScore = 0;
    weapons.forEach(w => {
      const gdef = GUNS[w.id];
      if (!gdef) return;
      const score = gunScore(gdef);
      totalScore += score;
      const equipped = player.equippedGun === w.id ? ' ✅ Equipped' : '';
      text += `${gdef.emoji} *${gdef.name}*${equipped}\n`;
      text += `   Type: ${gdef.type} | DMG: ${gdef.damage} | Rate: ${gdef.fireRate} | Power: ${score}\n\n`;
    });
    text += `💪 Total Firepower: ${totalScore}\n`;
    text += `\n.guns equip [id] — change weapon`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _drop(args, sender, player, chatJid, sock, message) {
    const gid = (args[0] || '').toLowerCase();
    if (!player.weapons?.some(w => w.id === gid)) {
      await sock.sendMessage(chatJid, { text: `❌ You don't own that gun.` }, { quoted: message }); return;
    }
    player.weapons = player.weapons.filter(w => w.id !== gid);
    if (player.equippedGun === gid) player.equippedGun = player.weapons[0]?.id || null;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, { text: `🗑️ Dropped ${GUNS[gid]?.name || gid}.` }, { quoted: message });
  }
}

GunsCommand.GUNS = GUNS;
GunsCommand.gunScore = gunScore;
module.exports = GunsCommand;
