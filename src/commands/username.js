class UsernameCommand {
  constructor(db) {
    this.db = db;
  }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);

    if (!args[0]) {
      const current = player.nickname || player.name;
      await sock.sendMessage(chatJid, {
        text: `👑 *SET YOUR NICKNAME*\n\nCurrent name: *${current}*\n\nUsage: .name [nickname]\nDigits, symbols and emojis allowed!\n\nExample: .name SleekBoss99 🔥`
      }, { quoted: message });
      return;
    }

    const nickname = args.join(' ').trim();

    if (nickname.length < 2) {
      await sock.sendMessage(chatJid, { text: '❌ Nickname too short! Min 2 characters.' }, { quoted: message }); return;
    }
    if (nickname.length > 24) {
      await sock.sendMessage(chatJid, { text: '❌ Nickname too long! Max 24 characters.' }, { quoted: message }); return;
    }

    // Check for uniqueness across all players
    const taken = Object.values(this.db.data.players).some(
      p => p.id !== sender && p.nickname && p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (taken) {
      await sock.sendMessage(chatJid, { text: `❌ The name *${nickname}* is already taken! Choose another.` }, { quoted: message }); return;
    }

    const old = player.nickname || player.name;
    player.nickname = nickname;
    // Also update .name so it shows everywhere
    player.name = nickname;
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: `✅ *Nickname Updated!*\n\n${old} → *${nickname}*\n\nYour new name will appear across the game!`
    }, { quoted: message });
  }
}

module.exports = UsernameCommand;
