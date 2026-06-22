'use strict';

const { resolveMention, normJid } = require('../utils/resolveMention');
const { getGroupMeta, isGroupAdmin, requireGroupAdmin } = require('../utils/groupHelpers');
const { resetWarn } = require('../utils/warnStore');

class ModerationCommand {
  constructor(db) {
    this.db = db;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .promote @member — promote to admin
  // ─────────────────────────────────────────────────────────────────────
  async promote(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.promote @member*` }, { quoted: message });
      return;
    }

    const targetNum = targetId.split('@')[0];
    try {
      await sock.groupParticipantsUpdate(chatJid, [targetId], 'promote');
      await sock.sendMessage(chatJid, {
        text: `⬆️ *@${targetNum} has been promoted to admin!*`,
        mentions: [targetId],
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to promote: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .demote @admin — demote admin to member
  // ─────────────────────────────────────────────────────────────────────
  async demote(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.demote @admin*` }, { quoted: message });
      return;
    }

    const targetNum = targetId.split('@')[0];
    try {
      await sock.groupParticipantsUpdate(chatJid, [targetId], 'demote');
      await sock.sendMessage(chatJid, {
        text: `⬇️ *@${targetNum} has been demoted to member.*`,
        mentions: [targetId],
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to demote: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .kick @member — remove from group
  // ─────────────────────────────────────────────────────────────────────
  async kick(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.kick @member*` }, { quoted: message });
      return;
    }

    if (isGroupAdmin(meta, targetId)) {
      await sock.sendMessage(chatJid, {
        text: `❌ You can't kick an admin. Demote them first: *.demote @${targetId.split('@')[0]}*`
      }, { quoted: message });
      return;
    }

    const targetNum = targetId.split('@')[0];
    try {
      await sock.sendMessage(chatJid, {
        text: `👢 *@${targetNum} has been kicked from the group.*`,
        mentions: [targetId],
      }, { quoted: message });
      await sock.groupParticipantsUpdate(chatJid, [targetId], 'remove');

      // Clear any warns for this member
      resetWarn(this.db, chatJid, targetId);
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to kick: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .del — delete a replied-to message (admin only)
  // ─────────────────────────────────────────────────────────────────────
  async deleteMsg(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const quoted = message.message?.extendedTextMessage?.contextInfo;
    if (!quoted || !quoted.stanzaId) {
      await sock.sendMessage(chatJid, {
        text: '❌ Reply to the message you want to delete with *.del*'
      }, { quoted: message });
      return;
    }

    const targetKey = {
      remoteJid: chatJid,
      id:        quoted.stanzaId,
      fromMe:    false,
      participant: quoted.participant || quoted.remoteJid,
    };

    try {
      await sock.sendMessage(chatJid, { delete: targetKey });
      await sock.sendMessage(chatJid, { delete: message.key });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: `❌ Delete failed: ${err.message}\n\nMake sure the bot is an admin.`
      }, { quoted: message });
    }
  }
}

module.exports = ModerationCommand;
module.exports.commands = {
  promote: 'promote',
  demote:  'demote',
  kick:    'kick',
  del:     'deleteMsg',
};
