'use strict';

const { normJid } = require('./resolveMention');

/**
 * Fetch group metadata safely. Returns null if not a group or fetch fails.
 */
async function getGroupMeta(sock, chatJid) {
  try {
    if (!chatJid.endsWith('@g.us')) return null;
    return await sock.groupMetadata(chatJid);
  } catch {
    return null;
  }
}

/**
 * Check if a JID is an admin in the group.
 */
function isGroupAdmin(meta, jid) {
  if (!meta) return false;
  const norm = normJid(jid);
  return meta.participants.some(
    p => normJid(p.id) === norm && (p.admin === 'admin' || p.admin === 'superadmin')
  );
}

/**
 * Check if the bot itself is an admin (required for most group actions).
 */
function isBotAdmin(meta, botJid) {
  return isGroupAdmin(meta, botJid);
}

/**
 * Standard group-only + admin guard. Sends a rejection message and returns false
 * if the check fails. Returns true if both conditions are met.
 */
async function requireGroupAdmin(sock, chatJid, sender, message, meta) {
  if (!chatJid.endsWith('@g.us')) {
    await sock.sendMessage(chatJid, { text: '❌ This command only works in group chats.' }, { quoted: message });
    return false;
  }
  if (!meta) {
    await sock.sendMessage(chatJid, { text: '❌ Could not fetch group info. Try again.' }, { quoted: message });
    return false;
  }
  if (!isGroupAdmin(meta, sender)) {
    await sock.sendMessage(chatJid, { text: '🚫 *Admins only.*' }, { quoted: message });
    return false;
  }
  return true;
}

module.exports = { getGroupMeta, isGroupAdmin, isBotAdmin, requireGroupAdmin };
