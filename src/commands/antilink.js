'use strict';

const { getGroupMeta, isGroupAdmin } = require('../utils/groupHelpers');
const { WARN_LIMIT, addWarn } = require('../utils/warnStore');

const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|chat\.whatsapp\.com\/[^\s]+/gi;

class AntilinkCommand {
  constructor(db) {
    this.db = db;
  }

  async antilink(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!chatJid.endsWith('@g.us')) {
      await sock.sendMessage(chatJid, { text: '❌ This command only works in group chats.' }, { quoted: message });
      return;
    }
    if (!meta || !isGroupAdmin(meta, sender)) {
      await sock.sendMessage(chatJid, { text: '🚫 *Admins only.*' }, { quoted: message });
      return;
    }

    const action = (args[0] || '').toLowerCase();
    if (!this.db.data.antilink) this.db.data.antilink = {};

    if (action === 'off' || action === 'disable') {
      delete this.db.data.antilink[chatJid];
      this.db.saveData();
      await sock.sendMessage(chatJid, { text: '🔓 *Antilink disabled.* Links are now allowed.' }, { quoted: message });
      return;
    }

    if (action !== 'warn' && action !== 'kick') {
      const current = this.db.data.antilink[chatJid];
      const status  = current ? `✅ *ON* — action: *${current.action}*` : `❌ *OFF*`;
      await sock.sendMessage(chatJid, {
        text: [`🔗 *ANTILINK*`, ``, `Status: ${status}`, ``,
          `*.antilink warn* — delete link + warn sender (3 warns = kick)`,
          `*.antilink kick* — delete link + kick sender immediately`,
          `*.antilink off*  — disable antilink`].join('\n')
      }, { quoted: message });
      return;
    }

    this.db.data.antilink[chatJid] = { enabled: true, action };
    this.db.saveData();
    await sock.sendMessage(chatJid, {
      text: [`🔗 *ANTILINK ENABLED*`, ``,
        `Action: *${action === 'warn' ? '⚠️ Warn (3 strikes = kick)' : '👢 Instant kick'}*`, ``,
        `\`\`\`Any link posted by a non-admin will be deleted automatically.\`\`\``].join('\n')
    }, { quoted: message });
  }

  async checkAntilink(sock, chatJid, sender, message) {
    if (!this.db.data.antilink) return false;
    const setting = this.db.data.antilink[chatJid];
    if (!setting || !setting.enabled) return false;

    const msg  = message.message || {};
    const text = msg.conversation
      || msg.extendedTextMessage?.text
      || msg.imageMessage?.caption
      || msg.videoMessage?.caption
      || '';

    if (!LINK_REGEX.test(text)) { LINK_REGEX.lastIndex = 0; return false; }
    LINK_REGEX.lastIndex = 0;

    const meta = await getGroupMeta(sock, chatJid);
    if (!meta || isGroupAdmin(meta, sender)) return false;

    const senderNum = sender.split('@')[0];
    try { await sock.sendMessage(chatJid, { delete: message.key }); } catch {}

    if (setting.action === 'kick') {
      await sock.sendMessage(chatJid, { text: `🔗🚫 *@${senderNum} was kicked for posting a link.*`, mentions: [sender] });
      try { await sock.groupParticipantsUpdate(chatJid, [sender], 'remove'); } catch {}
    } else {
      const count     = addWarn(this.db, chatJid, sender);
      const remaining = WARN_LIMIT - count;
      if (count >= WARN_LIMIT) {
        await sock.sendMessage(chatJid, { text: `🔗⚠️ *@${senderNum}* posted a link and reached *${WARN_LIMIT} warnings* — kicked!`, mentions: [sender] });
        try { await sock.groupParticipantsUpdate(chatJid, [sender], 'remove'); } catch {}
      } else {
        await sock.sendMessage(chatJid, {
          text: [`\`\`\`🔗 Link detected and deleted\`\`\``, ``, `\`\`\`⚠️ @${senderNum} Warning ${count}/${WARN_LIMIT}\`\`\``,
            remaining === 1 ? `\`\`\`🚨 One more link and you will be *kicked*\`\`\`` : `${remaining} warning(s) before kick.`].join('\n'),
          mentions: [sender],
        });
      }
    }
    return true;
  }
}

module.exports = AntilinkCommand;
module.exports.commands = { antilink: 'antilink' };
