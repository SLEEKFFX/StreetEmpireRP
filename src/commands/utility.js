'use strict';

const fs   = require('fs');
const path = require('path');
const { resolveMention, normJid, extractMentions } = require('../utils/resolveMention');
const { isOwner } = require('../utils/ownerCheck');

// ── Warn storage (in-memory, persists until bot restart) ─────────────────────
// For persistent warns across restarts, they are also saved to the DB data object
const WARN_LIMIT = 3;

// ── Antilink storage: chatJid → { enabled: bool, action: 'warn'|'kick' } ────
// Persisted to DB data so settings survive restarts
const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|chat\.whatsapp\.com\/[^\s]+/gi;

// ── Feature state (in-memory, toggled by owner commands) ─────────────────────
const featureState = {
  alwaysOnline:   false,
  autoViewStatus: false,
};

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
 * Returns true/false.
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

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITY COMMAND CLASS
// ─────────────────────────────────────────────────────────────────────────────

class UtilityCommand {
  constructor(db) {
    this.db = db;
  }

  // ── Main router ─────────────────────────────────────────────────────────────
  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    // Sticker is triggered by command 's' or 'sticker'
    if (sub === 'sticker' || sub === 's' || sub === '') {
      // Called via .s or .sticker — check for image in message
      return this._sticker(args, sender, chatJid, sock, message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .s / .sticker  — convert image/gif to sticker
  // ─────────────────────────────────────────────────────────────────────────
  async _sticker(args, sender, chatJid, sock, message) {
    const msg    = message.message || {};
    const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;

    // Determine media source — prefer quoted reply, fall back to caption message
    let sourceMsg  = null;
    let mediaType  = null; // 'image' | 'video'
    let isAnimated = false; // true for gif/video → animated webp

    if (msg.imageMessage) {
      sourceMsg = { imageMessage: msg.imageMessage };
      mediaType = 'image';
    } else if (msg.videoMessage) {
      sourceMsg  = { videoMessage: msg.videoMessage };
      mediaType  = 'video';
      isAnimated = true;
    } else if (quoted?.imageMessage) {
      sourceMsg = { imageMessage: quoted.imageMessage };
      mediaType = 'image';
    } else if (quoted?.videoMessage) {
      sourceMsg  = { videoMessage: quoted.videoMessage };
      mediaType  = 'video';
      isAnimated = true;
    }

    if (!sourceMsg) {
      await sock.sendMessage(chatJid, {
        text: [
          `🎨 *STICKER MAKER*`,
          ``,
          `Send an image or short GIF/video with *.s* as the caption,`,
          `or reply to one with *.s*`,
          ``,
          `• Images → static WebP sticker`,
          `• GIF/Video (≤10s) → animated WebP sticker`,
        ].join('\n')
      }, { quoted: message });
      return;
    }

    // Video duration guard
    if (mediaType === 'video') {
      const seconds = (msg.videoMessage || quoted?.videoMessage)?.seconds || 0;
      if (seconds > 10) {
        await sock.sendMessage(chatJid, {
          text: '```video too long — max 10 seconds for stickers```'
        }, { quoted: message });
        return;
      }
    }

    const fs   = require('fs');
    const os   = require('os');
    const path = require('path');
    const { execSync } = require('child_process');

    let tmpIn, tmpOut;

    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const buffer = await downloadMediaMessage(
        { message: sourceMsg },
        'buffer',
        {},
        { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
      );

      // ── Sticker pack metadata — configurable via .env ─────────────────
      const packName   = process.env.STICKER_PACKNAME || 'SE Bot';
      const authorName = process.env.AUTHOR_NAME       || 'SLEEKYODADDY';

      const ext = mediaType === 'image' ? '.png' : '.mp4';
      tmpIn  = path.join(os.tmpdir(), `se_stk_in_${Date.now()}${ext}`);
      tmpOut = path.join(os.tmpdir(), `se_stk_out_${Date.now()}.webp`);

      fs.writeFileSync(tmpIn, buffer);

      if (mediaType === 'image') {
        // ── Static sticker via ffmpeg (more reliable EXIF handling than sharp) ──
        execSync(
          `ffmpeg -y -i "${tmpIn}" ` +
          `-vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba" ` +
          `-vcodec libwebp -lossless 0 -compression_level 6 -quality 80 ` +
          `-preset picture -an -vsync 0 "${tmpOut}"`,
          { timeout: 30000, stdio: 'pipe' }
        );
      } else {
        // ── Animated sticker via ffmpeg ────────────────────────────────────
        execSync(
          `ffmpeg -y -t 10 -i "${tmpIn}" ` +
          `-vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba,fps=15" ` +
          `-vcodec libwebp -lossless 0 -compression_level 6 -quality 50 ` +
          `-loop 0 -preset picture -an -vsync 0 "${tmpOut}"`,
          { timeout: 30000, stdio: 'pipe' }
        );
      }

      let stickerBuffer = fs.readFileSync(tmpOut);

      // ── Inject sticker pack name + author via EXIF using webpmux ──────────
      // webpmux is bundled with libwebp (usually installed alongside ffmpeg).
      // Build the EXIF blob WhatsApp expects in the "Software" field as JSON.
      try {
        const exifJson = JSON.stringify({
          'sticker-pack-id':        'com.streetempire.sebot',
          'sticker-pack-name':      packName,
          'sticker-pack-publisher': authorName,
          'emojis': ['🎮'],
        });

        // EXIF header bytes required by WhatsApp's sticker spec
        const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00]);
        const jsonBuff = Buffer.from(exifJson, 'utf-8');
        const exif     = Buffer.concat([exifAttr, jsonBuff]);

        const tmpExif = path.join(os.tmpdir(), `se_stk_exif_${Date.now()}.exif`);
        const tmpFinal = path.join(os.tmpdir(), `se_stk_final_${Date.now()}.webp`);
        fs.writeFileSync(tmpExif, exif);

        execSync(`webpmux -set exif "${tmpExif}" "${tmpOut}" -o "${tmpFinal}"`, { timeout: 15000, stdio: 'pipe' });
        stickerBuffer = fs.readFileSync(tmpFinal);

        try { fs.unlinkSync(tmpExif);  } catch {}
        try { fs.unlinkSync(tmpFinal); } catch {}
      } catch (exifErr) {
        // webpmux not available — sticker still sends, just without pack metadata
        console.warn('[sticker] webpmux EXIF injection skipped:', exifErr.message);
      }

      await sock.sendMessage(chatJid, { sticker: stickerBuffer }, { quoted: message });

    } catch (err) {
      console.error('[sticker] error:', err.message);
      const isFFmpegErr = /ffmpeg|spawn|ENOENT/.test(err.message || '');
      await sock.sendMessage(chatJid, {
        text: isFFmpegErr
          ? '```sticker: ffmpeg not found on server — required for sticker conversion```'
          : `\`\`\`sticker failed: ${err.message}\`\`\``
      }, { quoted: message });
    } finally {
      try { if (tmpIn)  fs.unlinkSync(tmpIn);  } catch {}
      try { if (tmpOut) fs.unlinkSync(tmpOut); } catch {}
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .gcbio — send current GC description to chat
  // ─────────────────────────────────────────────────────────────────────────
  async gcbio(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const bio = meta.desc || meta.description || '';
    if (!bio) {
      await sock.sendMessage(chatJid, { text: `📋 This group has no bio set.\n\nSet one with *.setgcbio [text]*` }, { quoted: message });
      return;
    }
    await sock.sendMessage(chatJid, {
      text: `📋 *GROUP BIO*\n\n${bio}`
    }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .setgcbio [text] — update the GC description
  // ─────────────────────────────────────────────────────────────────────────
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
      await sock.sendMessage(chatJid, {
        text: `✅ *Group bio updated!*\n\n${newBio}`
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to update bio: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .online — tag all currently online members
  //  Note: WhatsApp does not expose online status via the API for privacy
  //  reasons. This command instead tags all members as a broadcast.
  // ─────────────────────────────────────────────────────────────────────────
  async online(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    // Note: WhatsApp does not expose real-time online status via the API for privacy reasons.
    // This command tags all non-bot members — use it as a group-wide ping/roll-call.
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

    await sock.sendMessage(chatJid, {
      text,
      mentions: members,
    }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .promote @member — promote to admin
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  //  .demote @admin — demote admin to member
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  //  .gcname [text] — rename the group
  // ─────────────────────────────────────────────────────────────────────────
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
      await sock.sendMessage(chatJid, {
        text: `✅ *Group renamed to:* ${newName}`
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to rename group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .lockgc — close the group (only admins can send messages)
  // ─────────────────────────────────────────────────────────────────────────
  async lockgc(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    try {
      await sock.groupSettingUpdate(chatJid, 'announcement');
      await sock.sendMessage(chatJid, {
        text: `🔒 *Group locked.* Only admins can send messages.`
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to lock group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .opengc — open the group (everyone can send messages)
  // ─────────────────────────────────────────────────────────────────────────
  async opengc(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    try {
      await sock.groupSettingUpdate(chatJid, 'not_announcement');
      await sock.sendMessage(chatJid, {
        text: `🔓 *Group opened.* Everyone can send messages.`
      }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to open group: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .warn @member — warn a member (3 strikes = auto-kick)
  // ─────────────────────────────────────────────────────────────────────────
  async warn(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.warn @member*` }, { quoted: message });
      return;
    }

    // Don't warn admins
    if (isGroupAdmin(meta, targetId)) {
      await sock.sendMessage(chatJid, { text: `❌ You can't warn an admin.` }, { quoted: message });
      return;
    }

    // Load or init warn storage from DB
    if (!this.db.data.warns) this.db.data.warns = {};
    const warnKey = `${chatJid}:${targetId}`;
    if (!this.db.data.warns[warnKey]) this.db.data.warns[warnKey] = 0;

    this.db.data.warns[warnKey] += 1;
    const count = this.db.data.warns[warnKey];
    this.db.saveData();

    const targetNum = targetId.split('@')[0];
    const remaining = WARN_LIMIT - count;

    if (count >= WARN_LIMIT) {
      // Auto-kick
      this.db.data.warns[warnKey] = 0;
      this.db.saveData();
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

  // ─────────────────────────────────────────────────────────────────────────
  //  .kick @member — remove from group
  // ─────────────────────────────────────────────────────────────────────────
  async kick(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const targetId = resolveMention(message, args, 0);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: `Usage: *.kick @member*` }, { quoted: message });
      return;
    }

    // Don't kick admins
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
      if (this.db.data.warns) {
        const warnKey = `${chatJid}:${targetId}`;
        delete this.db.data.warns[warnKey];
        this.db.saveData();
      }
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `❌ Failed to kick: ${err.message}` }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .del — delete a replied-to message (admin only)
  // ─────────────────────────────────────────────────────────────────────────
  async deleteMsg(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    // Get the quoted/replied message key
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
      // Delete the replied message
      await sock.sendMessage(chatJid, { delete: targetKey });
      // Also delete the .del command message itself
      await sock.sendMessage(chatJid, { delete: message.key });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: `❌ Delete failed: ${err.message}\n\nMake sure the bot is an admin.`
      }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .antilink [warn|kick|off] — auto-delete links and warn/kick sender
  // ─────────────────────────────────────────────────────────────────────────
  async antilink(args, sender, chatJid, sock, message) {
    const meta = await getGroupMeta(sock, chatJid);
    if (!await requireGroupAdmin(sock, chatJid, sender, message, meta)) return;

    const action = (args[0] || '').toLowerCase();

    if (!this.db.data.antilink) this.db.data.antilink = {};

    if (action === 'off' || action === 'disable') {
      delete this.db.data.antilink[chatJid];
      this.db.saveData();
      await sock.sendMessage(chatJid, {
        text: '🔓 *Antilink disabled.* Links are now allowed.'
      }, { quoted: message });
      return;
    }

    if (action !== 'warn' && action !== 'kick') {
      const current = this.db.data.antilink[chatJid];
      const status = current
        ? `✅ *ON* — action: *${current.action}*`
        : `❌ *OFF*`;
      await sock.sendMessage(chatJid, {
        text: [
          `🔗 *ANTILINK*`,
          ``,
          `Status: ${status}`,
          ``,
          `*.antilink warn* — delete link + warn sender (3 warns = kick)`,
          `*.antilink kick* — delete link + kick sender immediately`,
          `*.antilink off*  — disable antilink`,
        ].join('\n')
      }, { quoted: message });
      return;
    }

    this.db.data.antilink[chatJid] = { enabled: true, action };
    this.db.saveData();

    await sock.sendMessage(chatJid, {
      text: [
        `🔗 *ANTILINK ENABLED*`,
        ``,
        `Action: *${action === 'warn' ? '⚠️ Warn (3 strikes = kick)' : '👢 Instant kick'}*`,
        ``,
        `Any link posted by a non-admin will be deleted automatically.`,
      ].join('\n')
    }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  checkAntilink — called by the message handler for every group message
  //  Returns true if the message was a link and was handled (so caller can skip)
  // ─────────────────────────────────────────────────────────────────────────
  async checkAntilink(sock, chatJid, sender, message) {
    if (!this.db.data.antilink) return false;
    const setting = this.db.data.antilink[chatJid];
    if (!setting || !setting.enabled) return false;

    // Extract text from any message type
    const msg  = message.message || {};
    const text = msg.conversation
      || msg.extendedTextMessage?.text
      || msg.imageMessage?.caption
      || msg.videoMessage?.caption
      || '';

    if (!LINK_REGEX.test(text)) return false;
    LINK_REGEX.lastIndex = 0; // reset stateful regex

    // Fetch meta to check if sender is admin
    const meta = await getGroupMeta(sock, chatJid);
    if (!meta) return false;
    if (isGroupAdmin(meta, sender)) return false; // admins are exempt

    const senderNum = sender.split('@')[0];

    // Delete the offending message
    try { await sock.sendMessage(chatJid, { delete: message.key }); } catch {}

    if (setting.action === 'kick') {
      await sock.sendMessage(chatJid, {
        text: `🔗🚫 *@${senderNum} was kicked for posting a link.*`,
        mentions: [sender],
      });
      try { await sock.groupParticipantsUpdate(chatJid, [sender], 'remove'); } catch {}
    } else {
      // Warn
      if (!this.db.data.warns) this.db.data.warns = {};
      const warnKey = `${chatJid}:${sender}`;
      if (!this.db.data.warns[warnKey]) this.db.data.warns[warnKey] = 0;
      this.db.data.warns[warnKey] += 1;
      const count     = this.db.data.warns[warnKey];
      const remaining = WARN_LIMIT - count;
      this.db.saveData();

      if (count >= WARN_LIMIT) {
        this.db.data.warns[warnKey] = 0;
        this.db.saveData();
        await sock.sendMessage(chatJid, {
          text: `🔗⚠️ *@${senderNum}* posted a link and reached *${WARN_LIMIT} warnings* — kicked!`,
          mentions: [sender],
        });
        try { await sock.groupParticipantsUpdate(chatJid, [sender], 'remove'); } catch {}
      } else {
        await sock.sendMessage(chatJid, {
          text: [
            `🔗 *Link deleted!*`,
            ``,
            `⚠️ @${senderNum} — Warning *${count}/${WARN_LIMIT}*`,
            remaining === 1
              ? `🚨 One more link and you will be *kicked!*`
              : `${remaining} warning(s) before kick.`,
          ].join('\n'),
          mentions: [sender],
        });
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .utilitymenu — show all utility/group commands
  // ─────────────────────────────────────────────────────────────────────────
  async utilitymenu(args, sender, chatJid, sock, message) {
    const text = [
      `╔══════════════════════════╗`,
      `║  🛠️  UTILITY COMMANDS`,
      `╚══════════════════════════╝`,
      ``,
      `━━ 👥 GROUP MANAGEMENT ━━━━━━━━`,
      `*.gcbio*          — Show group bio`,
      `*.setgcbio* [text] — Set group bio`,
      `*.gcname* [text]  — Rename group`,
      `*.lockgc*         — Lock group (admins only)`,
      `*.opengc*         — Open group for all`,
      `*.online*         — Tag all members`,
      ``,
      `━━ 👮 ADMIN TOOLS ━━━━━━━━━━━━━`,
      `*.promote* @member — Make admin`,
      `*.demote* @member  — Remove admin`,
      `*.kick* @member    — Remove from group`,
      `*.warn* @member    — Warn (3 = kick)`,
      `*.del*             — Delete replied msg`,
      `*.antilink warn*   — Auto-delete links + warn`,
      `*.antilink kick*   — Auto-delete links + kick`,
      `*.antilink off*    — Disable antilink`,
      ``,
      `━━ 🎨 MEDIA ━━━━━━━━━━━━━━━━━━`,
      `*.s* / *.sticker*  — Image/GIF → sticker`,
      `*.vv*              — Unlock view-once media`,
      ``,
      `━━ 🤖 BOT OWNER ONLY ━━━━━━━━━`,
      `*.alwaysonline on/off*    — Stay online 24/7`,
      `*.autoviewstatus on/off*  — Auto-view statuses`,
      ``,
      `All group management commands are admin-only.`,
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .vv — unlock a view-once image or video
  //  Usage: reply to a view-once message with .vv
  // ─────────────────────────────────────────────────────────────────────────
  async vv(args, sender, chatJid, sock, message) {
    const msg = message.message || {};

    // Find view-once content — can be in quoted message or the message itself
    const ctx = msg.extendedTextMessage?.contextInfo || msg.viewOnceMessage?.message;

    // Check direct view-once message types
    let voMsg = null;
    if (msg.viewOnceMessage) {
      voMsg = msg.viewOnceMessage.message;
    } else if (msg.viewOnceMessageV2) {
      voMsg = msg.viewOnceMessageV2.message;
    } else if (msg.viewOnceMessageV2Extension) {
      voMsg = msg.viewOnceMessageV2Extension.message;
    }

    // Check quoted message for view-once
    if (!voMsg && ctx?.quotedMessage) {
      const q = ctx.quotedMessage;
      if (q.viewOnceMessage) voMsg = q.viewOnceMessage.message;
      else if (q.viewOnceMessageV2) voMsg = q.viewOnceMessageV2.message;
      else if (q.viewOnceMessageV2Extension) voMsg = q.viewOnceMessageV2Extension.message;
      // Also handle image/video directly in quoted with viewOnce flag
      else if (q.imageMessage?.viewOnce) voMsg = q;
      else if (q.videoMessage?.viewOnce) voMsg = q;
    }

    if (!voMsg) {
      await sock.sendMessage(chatJid, {
        text: '```reply to a view-once message with .vv to unlock it```'
      }, { quoted: message });
      return;
    }

    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const mediaMsg = { message: voMsg };

      if (voMsg.imageMessage || voMsg.imageMessage?.viewOnce) {
        const buffer = await downloadMediaMessage(
          mediaMsg, 'buffer', {},
          { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
        // Strip viewOnce flag by re-sending as regular image
        await sock.sendMessage(chatJid, {
          image: buffer,
          caption: '🔓 *View-once unlocked*',
        }, { quoted: message });

      } else if (voMsg.videoMessage || voMsg.videoMessage?.viewOnce) {
        const buffer = await downloadMediaMessage(
          mediaMsg, 'buffer', {},
          { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
        await sock.sendMessage(chatJid, {
          video: buffer,
          caption: '🔓 *View-once unlocked*',
        }, { quoted: message });

      } else {
        await sock.sendMessage(chatJid, {
          text: '```unsupported view-once type```'
        }, { quoted: message });
      }
    } catch (err) {
      console.error('[vv] error:', err);
      await sock.sendMessage(chatJid, {
        text: `\`\`\`vv failed: ${err.message}\`\`\``
      }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .alwaysonline on/off — keep bot presence as "available" (bot owner only)
  // ─────────────────────────────────────────────────────────────────────────
  async alwaysonline(args, sender, chatJid, sock, message) {
    if (!isOwner(sender)) {
      await sock.sendMessage(chatJid, { text: '```bot owner only```' }, { quoted: message });
      return;
    }

    const action = (args[0] || '').toLowerCase();
    if (action !== 'on' && action !== 'off') {
      const state = featureState.alwaysOnline ? 'ON' : 'OFF';
      await sock.sendMessage(chatJid, {
        text: `\`\`\`alwaysonline is currently ${state}\n.alwaysonline on\n.alwaysonline off\`\`\``
      }, { quoted: message });
      return;
    }

    featureState.alwaysOnline = action === 'on';

    if (featureState.alwaysOnline) {
      // Send available presence immediately and start interval
      await sock.sendPresenceUpdate('available');
      if (!global._alwaysOnlineInterval) {
        global._alwaysOnlineInterval = setInterval(async () => {
          if (featureState.alwaysOnline) {
            try { await sock.sendPresenceUpdate('available'); } catch {}
          } else {
            clearInterval(global._alwaysOnlineInterval);
            global._alwaysOnlineInterval = null;
          }
        }, 10000); // ping every 10 seconds
      }
      await sock.sendMessage(chatJid, {
        text: '```alwaysonline: ON — bot will appear online 24/7```'
      }, { quoted: message });
    } else {
      clearInterval(global._alwaysOnlineInterval);
      global._alwaysOnlineInterval = null;
      await sock.sendPresenceUpdate('unavailable');
      await sock.sendMessage(chatJid, {
        text: '```alwaysonline: OFF```'
      }, { quoted: message });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  .autoviewstatus on/off — auto-view all contact statuses (bot owner only)
  //  The actual status reading is hooked into index.js via the getFeatureState export
  // ─────────────────────────────────────────────────────────────────────────
  async autoviewstatus(args, sender, chatJid, sock, message) {
    if (!isOwner(sender)) {
      await sock.sendMessage(chatJid, { text: '```bot owner only```' }, { quoted: message });
      return;
    }

    const action = (args[0] || '').toLowerCase();
    if (action !== 'on' && action !== 'off') {
      const state = featureState.autoViewStatus ? 'ON' : 'OFF';
      await sock.sendMessage(chatJid, {
        text: `\`\`\`autoviewstatus is currently ${state}\n.autoviewstatus on\n.autoviewstatus off\`\`\``
      }, { quoted: message });
      return;
    }

    featureState.autoViewStatus = action === 'on';
    await sock.sendMessage(chatJid, {
      text: `\`\`\`autoviewstatus: ${action.toUpperCase()} — ${action === 'on' ? 'bot will auto-view all statuses' : 'stopped'}\`\`\``
    }, { quoted: message });
  }
}

// Export feature state so index.js can read it for the status listener
module.exports.featureState = featureState;

module.exports = UtilityCommand;
