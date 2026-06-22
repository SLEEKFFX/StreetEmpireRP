'use strict';

const { normJid } = require('../utils/resolveMention');
const { getGroupMeta, requireGroupAdmin } = require('../utils/groupHelpers');

class GroupSettingsCommand {
  constructor(db) {
    this.db = db;
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .gcbio — send current GC description to chat
  // ─────────────────────────────────────────────────────────────────────
  async gcbio(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const bio = meta.desc || meta.description || '';
    if (!bio) {
      await sock.sendMessage(chatJid, { text: `📋 This group has no bio set.\n\nSet one with *.setgcbio [text]*` }, { quoted: message });
      return;
    }
    await sock.sendMessage(chatJid, { text: `📋 *GROUP BIO*\n\n${bio}` }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .setgcbio [text] — update the GC description
  // ─────────────────────────────────────────────────────────────────────
  async setgcbio(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const newBio = args.join(' ').trim();
    if (!newBio) {
      await sock.sendMessage(chatJid, { text: `Usage: *.setgcbio [text]*\nExample: *.setgcbio Welcome to the empire!*` }, { quoted: message });
      return;
    }

    try {
      await sock.groupUpdateDescription(chatJid, newBio);
      await sock.sendMessage(chatJid, { text: `✅ *Group bio updated!*\n\n${newBio}` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to update bio: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .gcname [text] — rename the group
  // ─────────────────────────────────────────────────────────────────────
  async gcname(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const newName = args.join(' ').trim();
    if (!newName) {
      await sock.sendMessage(chatJid, { text: `Usage: *.gcname [new name]*` }, { quoted: message });
      return;
    }
    if (newName.length > 100) {
      await sock.sendMessage(chatJid, { text: `❌ Name too long (max 100 characters).` }, { quoted: message });
      return;
    }

    try {
      await sock.groupUpdateSubject(chatJid, newName);
      await sock.sendMessage(chatJid, { text: `✅ *Group renamed to:* ${newName}` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to rename group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .lockgc — close the group (only admins can send messages)
  // ─────────────────────────────────────────────────────────────────────
  async lockgc(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    try {
      await sock.groupSettingUpdate(chatJid, 'announcement');
      await sock.sendMessage(chatJid, { text: `🔒 *Group locked.* Only admins can send messages.` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to lock group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .opengc — open the group (everyone can send messages)
  // ─────────────────────────────────────────────────────────────────────
  async opengc(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    try {
      await sock.groupSettingUpdate(chatJid, 'not_announcement');
      await sock.sendMessage(chatJid, { text: `🔓 *Group opened.* Everyone can send messages.` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to open group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .online — list & tag all members (real-time presence isn't exposed
  //  by the WhatsApp API; this is a group-wide roll-call/ping)
  // ─────────────────────────────────────────────────────────────────────
  async online(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const botJid = normJid(sock.user?.id);
    const members = meta.participants
      .filter(p => normJid(p.id) !== botJid)
      .map(p => normJid(p.id));

    if (members.length === 0) {
      await sock.sendMessage(chatJid, { text: '❌ No members to tag.' }, { quoted: message });
      return;
    }

    const listLines = members.map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`);
    const text = [
      `👥 *ONLINE MEMBERS (${members.length})*`,
      `━━━━━━━━━━━━━━━━━━`,
      ...listLines,
    ].join('\n');

    await sock.sendMessage(chatJid, { text, mentions: members }, { quoted: message });
  }
}

module.exports = GroupSettingsCommand;
module.exports.commands = {
  gcbio:    'gcbio',
  setgcbio: 'setgcbio',
  gcname:   'gcname',
  lockgc:   'lockgc',
  opengc:   'opengc',
  online:   'online',
};
