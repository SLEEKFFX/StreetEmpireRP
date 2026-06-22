class InventoryCommand {
  constructor(db) {
    this.db = db;
  }

  async execute(args, sender, chatJid, sock, message) {
    try {
      const player = this.db.getPlayer(sender);
      const displayName = player.nickname || player.name;

      const vehicles = player.vehicles || [];
      const weapons = player.weapons || [];
      const businesses = player.businesses || [];

      let text = `╔══════════════════════════╗\n║  🎒 INVENTORY — ${displayName.substring(0, 10)}\n╚══════════════════════════╝\n\n`;

      text += `🚗 *VEHICLES* (${vehicles.length}):\n`;
      if (vehicles.length > 0) {
        vehicles.forEach((v, i) => {
          text += `  ${i + 1}. ${v.emoji || '🚗'} ${v.name} (Lv.${v.level || 1})\n`;
        });
      } else {
        text += `  None — buy at .vehicle shop\n`;
      }

      text += `\n🔫 *WEAPONS* (${weapons.length}):\n`;
      if (weapons.length > 0) {
        weapons.forEach((w, i) => {
          text += `  ${i + 1}. ${w.name || w}\n`;
        });
      } else {
        text += `  None\n`;
      }

      text += `\n🏢 *BUSINESSES* (${businesses.length}/5):\n`;
      if (businesses.length > 0) {
        businesses.forEach((b, i) => {
          text += `  ${i + 1}. ${b.emoji || '🏢'} ${b.name} Lv.${b.level || 1}\n`;
        });
      } else {
        text += `  None — buy at .business list\n`;
      }

      text += `\n━━━━━━━━━━━━━━━━━━━━\n📊 ${vehicles.length} vehicles • ${businesses.length} businesses`;

      await sock.sendMessage(chatJid, { text }, { quoted: message });
    } catch (err) {
      console.error('Inventory error:', err);
      await sock.sendMessage(chatJid, { text: '❌ Could not load inventory. Please try again.' }, { quoted: message });
    }
  }
}

module.exports = InventoryCommand;
