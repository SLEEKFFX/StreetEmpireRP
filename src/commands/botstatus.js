'use strict';

const { isOwnerOrSelf } = require('../utils/ownerCheck');

// Shared feature state — exported so index.js can read it for the status listener
const featureState = {
  alwaysOnline:   false,
  autoViewStatus: false,
};

class BotStatusCommand {
  constructor(db) {
    this.db = db;
  }

  // ── .alwaysonline on/off ─────────────────────────────────────────────────
  async alwaysonline(args, sender, chatJid, sock, message) {
    if (!isOwnerOrSelf(sender, message)) {
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
      await sock.sendPresenceUpdate('available');
      if (!global._alwaysOnlineInterval) {
        global._alwaysOnlineInterval = setInterval(async () => {
          if (featureState.alwaysOnline) {
            try { await sock.sendPresenceUpdate('available'); } catch {}
          } else {
            clearInterval(global._alwaysOnlineInterval);
            global._alwaysOnlineInterval = null;
          }
        }, 10000);
      }
      await sock.sendMessage(chatJid, { text: '```alwaysonline: ON — bot will appear online 24/7```' }, { quoted: message });
    } else {
      clearInterval(global._alwaysOnlineInterval);
      global._alwaysOnlineInterval = null;
      await sock.sendPresenceUpdate('unavailable');
      await sock.sendMessage(chatJid, { text: '```alwaysonline: OFF```' }, { quoted: message });
    }
  }

  // ── .autoviewstatus on/off ───────────────────────────────────────────────
  async autoviewstatus(args, sender, chatJid, sock, message) {
    if (!isOwnerOrSelf(sender, message)) {
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

  // ── .vv — unlock a view-once image or video ──────────────────────────────
  async vv(args, sender, chatJid, sock, message) {
    const msg = message.message || {};

    let voMsg = null;
    if (msg.viewOnceMessage)           voMsg = msg.viewOnceMessage.message;
    else if (msg.viewOnceMessageV2)    voMsg = msg.viewOnceMessageV2.message;
    else if (msg.viewOnceMessageV2Extension) voMsg = msg.viewOnceMessageV2Extension.message;

    const ctx = msg.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!voMsg && ctx) {
      if (ctx.viewOnceMessage)            voMsg = ctx.viewOnceMessage.message;
      else if (ctx.viewOnceMessageV2)     voMsg = ctx.viewOnceMessageV2.message;
      else if (ctx.viewOnceMessageV2Extension) voMsg = ctx.viewOnceMessageV2Extension.message;
      else if (ctx.imageMessage?.viewOnce) voMsg = ctx;
      else if (ctx.videoMessage?.viewOnce) voMsg = ctx;
    }

    if (!voMsg) {
      await sock.sendMessage(chatJid, { text: '```reply to a view-once message with .vv to unlock it```' }, { quoted: message });
      return;
    }

    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      const mediaMsg = { message: voMsg };

      if (voMsg.imageMessage) {
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {},
          { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        await sock.sendMessage(chatJid, { image: buffer, caption: '🔓 *View-once unlocked*' }, { quoted: message });
      } else if (voMsg.videoMessage) {
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {},
          { logger: require('pino')({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        await sock.sendMessage(chatJid, { video: buffer, caption: '🔓 *View-once unlocked*' }, { quoted: message });
      } else {
        await sock.sendMessage(chatJid, { text: '```unsupported view-once type```' }, { quoted: message });
      }
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `\`\`\`vv failed: ${err.message}\`\`\`` }, { quoted: message });
    }
  }

  // ── .setpp — set bot profile picture (owner only) ───────────────────────
  async setpp(args, sender, chatJid, sock, message) {
    if (!isOwnerOrSelf(sender, message)) {
      await sock.sendMessage(chatJid, { text: '```bot owner only```' }, { quoted: message });
      return;
    }

    const msg    = message.message || {};
    const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;

    const imgMsg = msg.imageMessage || quoted?.imageMessage;
    if (!imgMsg) {
      await sock.sendMessage(chatJid, { text: '```reply to an image with .setpp to set it as the bot profile picture```' }, { quoted: message });
      return;
    }

    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys');
      let targetMsg = message;
      if (!msg.imageMessage && quoted?.imageMessage) {
        const ctx = msg.extendedTextMessage.contextInfo;
        targetMsg = {
          key:     { remoteJid: chatJid, id: ctx.stanzaId, participant: ctx.participant },
          message: quoted,
        };
      }
      const buffer = await downloadMediaMessage(targetMsg, 'buffer', {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage });

      // Resize to 640x640 for profile pic if sharp is available
      let finalBuffer = buffer;
      try {
        const sharp = require('sharp');
        finalBuffer = await sharp(buffer).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
      } catch {}

      await sock.updateProfilePicture(sock.user.id, finalBuffer);
      await sock.sendMessage(chatJid, { text: '✅ *Profile picture updated!*' }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `\`\`\`setpp failed: ${err.message}\`\`\`` }, { quoted: message });
    }
  }

  // ── .setbio [text] — set bot status/bio (owner only) ─────────────────────
  async setbio(args, sender, chatJid, sock, message) {
    if (!isOwnerOrSelf(sender, message)) {
      await sock.sendMessage(chatJid, { text: '```bot owner only```' }, { quoted: message });
      return;
    }

    const bio = args.join(' ').trim();
    if (!bio) {
      await sock.sendMessage(chatJid, { text: '```Usage: .setbio [text]```' }, { quoted: message });
      return;
    }
    if (bio.length > 139) {
      await sock.sendMessage(chatJid, { text: '```bio too long — max 139 characters```' }, { quoted: message });
      return;
    }

    try {
      await sock.updateProfileStatus(bio);
      await sock.sendMessage(chatJid, { text: `✅ *Bot bio updated!*\n\n_${bio}_` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(chatJid, { text: `\`\`\`setbio failed: ${err.message}\`\`\`` }, { quoted: message });
    }
  }
}

module.exports = BotStatusCommand;
module.exports.featureState = featureState;
module.exports.commands = {
  alwaysonline:   'alwaysonline',
  autoviewstatus: 'autoviewstatus',
  vv:             'vv',
  setpp:          'setpp',
  setbio:         'setbio',
};
