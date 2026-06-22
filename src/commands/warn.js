'use strict';

const { resolveMention } = require('../utils/resolveMention');
const { getGroupMeta, isGroupAdmin, requireGroupAdmin } = require('../utils/groupHelpers');
const { WARN_LIMIT, getWarnCount, addWarn, resetWarn, resetAllWarnsInGroup } = require('../utils/warnStore');

class WarnCommand {
  constructor(db) {
    this.db = db;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .warn @member — warn a member (3 strikes = auto-kick)
  // ─────────────────────────────────────────────────────────────────────
  async warn(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.warn @member*` }, { quoted: message });
      return;
    }

    if (isGroupAdmin(meta, targetId)) {
      await sock.sendMessage(chatJid, { text: `❌ You can't warn an admin.` }, { quoted: message });
      return;
    }

    const targetNum = targetId.split('@')[0];
    const count     = addWarn(this.db, chatJid, targetId);
    const remaining = WARN_LIMIT - count;

    if (count >= WARN_LIMIT) {
      try {
        await sock.sendMessage(chatJid, {
          text: `⚠️ *@${targetNum} has reached ${WARN_LIMIT} warnings and has been kicked from the group!*`,
          mentions: [targetId],
        }, { quoted: message });
        await sock.groupParticipantsUpdate(chatJid, [targetId], 'remove');
      } catch (err) {
        await sock.sendMessage(chatJid, {
          text: `⚠️ *@${targetNum}* reached max warnings but kick failed: ${err.message}`,
          mentions: [targetId],
        }, { quoted: message });
      }
    } else {
      const warnEmojis = '⚠️'.repeat(count) + '▪️'.repeat(WARN_LIMIT - count);
      await sock.sendMessage(chatJid, {
        text: [
          `⚠️ *WARNING ${count}/${WARN_LIMIT}*`,
          ``,
          `@${targetNum} — you have been warned by an admin.`,
          `${warnEmojis}`,
          ``,
          remaining === 1
            ? `🚨 *One more warning and you will be kicked!*`
            : `${remaining} warnings remaining before kick.`,
        ].join('\n'),
        mentions: [targetId],
      }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .resetwarn @member — clear warnings for a single member
  // ─────────────────────────────────────────────────────────────────────
  async resetwarn(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.resetwarn @member*` }, { quoted: message });
      return;
    }

    const had = resetWarn(this.db, chatJid, targetId);
    const targetNum = targetId.split('@')[0];

    if (had === 0) {
      await sock.sendMessage(chatJid, {
        text: `ℹ️ @${targetNum} has no warnings to reset.`,
        mentions: [targetId],
      }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatJid, {
      text: `✅ Warnings reset for @${targetNum}. (was ${had}/${WARN_LIMIT})`,
      mentions: [targetId],
    }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .resetallwarns — clear warnings for everyone in this group
  // ─────────────────────────────────────────────────────────────────────
  async resetallwarns(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const cleared = resetAllWarnsInGroup(this.db, chatJid);
    await sock.sendMessage(chatJid, {
      text: cleared > 0
        ? `✅ Cleared warnings for ${cleared} member${cleared > 1 ? 's' : ''} in this group.`
        : `ℹ️ No active warnings to clear in this group.`
    }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .warnings @member — check a member's current warning count
  // ─────────────────────────────────────────────────────────────────────
  async warnings(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!chatJid.endsWith('@g.us')) {
      await sock.sendMessage(chatJid, { text: '❌ This command only works in group chats.' }, { quoted: message });
      return;
    }

    const targetId = resolveMention(message, args, 0) || sender;
    const count    = getWarnCount(this.db, chatJid, targetId);
    const targetNum = targetId.split('@')[0];

    await sock.sendMessage(chatJid, {
      text: `⚠️ @${targetNum} has *${count}/${WARN_LIMIT}* warnings in this group.`,
      mentions: [targetId],
    }, { quoted: message });
  }
}

module.exports = WarnCommand;
module.exports.commands = {
  warn:          'warn',
  resetwarn:     'resetwarn',
  resetallwarns: 'resetallwarns',
  warnings:      'warnings',
};
