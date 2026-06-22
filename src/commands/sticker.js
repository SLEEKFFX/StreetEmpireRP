'use strict';

/**
 * ── STREET EMPIRE STICKER ────────────────────────────────────────────────────
 * .s              → image/gif/video sent WITH caption = make sticker
 * .s img          → reply to a sticker → extract as image (PNG)
 * .s gif          → reply to an animated sticker → extract as GIF
 * .s vid          → reply to an animated sticker → extract as MP4
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec }  = require('child_process');
const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');

// ── ffmpeg wrapper ────────────────────────────────────────────────────────────
function execAsync(cmd, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).split('\n').slice(-3).join(' ').trim()));
      else resolve();
    });
  });
}

// ── Build sticker ffmpeg command ──────────────────────────────────────────────
// Transparent pad: use color=0x00000000 (8-digit hex) — safest cross-version syntax
function stickerCmd(input, output, { fps = 15, quality = 75, maxSecs = null, scale = 512, animated = true } = {}) {
  const pad    = `scale=${scale}:${scale}:force_original_aspect_ratio=decrease,pad=${scale}:${scale}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
  const filter = animated ? `${pad},fps=${fps}` : pad;
  const trim   = maxSecs ? `-t ${maxSecs}` : '';
  const loop   = animated ? '-loop 0' : '';
  // Try without -fps_mode first (works on both old and new ffmpeg)
  return `ffmpeg -y ${trim} -i "${input}" -vf "${filter}" -c:v libwebp ${loop} -pix_fmt yuva420p -quality ${quality} -compression_level 6 "${output}"`;
}

// ── EXIF for WhatsApp sticker pack metadata ───────────────────────────────────
function buildExif() {
  const json    = { 'sticker-pack-id': crypto.randomBytes(16).toString('hex'), 'sticker-pack-name': process.env.STICKER_PACKNAME || 'SE Bot', 'sticker-pack-publisher': process.env.AUTHOR_NAME || 'SLEEKYODADDY', emojis: ['🎮'] };
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const header  = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
  const exif    = Buffer.concat([header, jsonBuf]);
  exif.writeUInt32LE(jsonBuf.length, 14);
  return exif;
}

async function injectExif(buf) {
  const webpmux = require('node-webpmux');
  const img = new webpmux.Image();
  await img.load(buf);
  img.exif = buildExif();
  return img.save(null);
}

// ── Detect if webp buffer is animated ────────────────────────────────────────
function isAnimatedWebP(buf) {
  // Animated WebP has 'WEBPVP8L' or the ANIM chunk marker
  // Simplest: look for 'ANIM' marker in first 100 bytes
  const head = buf.slice(0, 100).toString('binary');
  return head.includes('ANIM') || head.includes('VP8X');
}

// ── Encode sticker with tiered fallback ──────────────────────────────────────
async function encodeSticker(tmpIn, animated) {
  const tmpDir = path.dirname(tmpIn);
  const ts     = path.basename(tmpIn).replace('se_stk_in_', '');

  const tiers = animated
    ? [
        { fps: 15, quality: 80, maxSecs: 8,  scale: 512 },
        { fps: 10, quality: 55, maxSecs: 5,  scale: 512 },
        { fps:  8, quality: 30, maxSecs: 3,  scale: 320 },
      ]
    : [
        { quality: 90, scale: 512, animated: false },
      ];

  for (let i = 0; i < tiers.length; i++) {
    const outPath = path.join(tmpDir, `se_stk_out_${ts}_t${i}.webp`);
    try {
      await execAsync(stickerCmd(tmpIn, outPath, { ...tiers[i], animated }));
      if (!fs.existsSync(outPath)) continue;
      const buf = fs.readFileSync(outPath);
      fs.unlinkSync(outPath);
      if (buf.length > 0) return buf;
    } catch (e) {
      try { fs.unlinkSync(outPath); } catch {}
      // On last tier, rethrow so caller gets the real error
      if (i === tiers.length - 1) throw e;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

class StickerCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    // ── .s img / .s gif / .s vid — sticker → media conversion ──────────────
    if (sub === 'img' || sub === 'gif' || sub === 'vid') {
      return this._stickerToMedia(sub, sender, chatJid, sock, message);
    }

    // ── .s — make sticker ────────────────────────────────────────────────────
    return this._makeSticker(sender, chatJid, sock, message);
  }

  // ── Convert sticker → image / gif / video ─────────────────────────────────
  async _stickerToMedia(type, sender, chatJid, sock, message) {
    // Must be a reply to a sticker
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctx?.quotedMessage;

    if (!quotedMsg?.stickerMessage) {
      await sock.sendMessage(chatJid, {
        text: `\`\`\`Reply to a sticker with .s ${type}\`\`\``
      }, { quoted: message });
      return;
    }

    const targetMessage = {
      key: { remoteJid: chatJid, id: ctx.stanzaId, participant: ctx.participant },
      message: quotedMsg,
    };

    await sock.sendMessage(chatJid, { text: '```⏳ Converting sticker...```' }, { quoted: message });

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const ts     = Date.now();
    const tmpIn  = path.join(tmpDir, `se_stk_src_${ts}.webp`);

    try {
      const buf = await downloadMediaMessage(
        targetMessage, 'buffer', {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );
      if (!buf || buf.length === 0) throw new Error('download failed');
      fs.writeFileSync(tmpIn, buf);

      const isAnim = isAnimatedWebP(buf);

      if (type === 'img') {
        // Extract first frame as PNG
        const outPng = path.join(tmpDir, `se_stk_img_${ts}.png`);
        await execAsync(`ffmpeg -y -i "${tmpIn}" -vframes 1 -f image2 "${outPng}"`);
        const imgBuf = fs.readFileSync(outPng);
        fs.unlinkSync(outPng);
        await sock.sendMessage(chatJid, { image: imgBuf, mimetype: 'image/png', caption: '🖼️ Sticker extracted' }, { quoted: message });

      } else if (type === 'gif') {
        if (!isAnim) {
          await sock.sendMessage(chatJid, { text: '```That sticker is not animated```' }, { quoted: message });
          return;
        }
        const outGif = path.join(tmpDir, `se_stk_gif_${ts}.gif`);
        await execAsync(`ffmpeg -y -i "${tmpIn}" -vf "scale=320:320:force_original_aspect_ratio=decrease" "${outGif}"`, 60000);
        const gifBuf = fs.readFileSync(outGif);
        fs.unlinkSync(outGif);
        await sock.sendMessage(chatJid, { video: gifBuf, mimetype: 'video/mp4', gifPlayback: true, caption: '🎞️ Animated sticker → GIF' }, { quoted: message });

      } else if (type === 'vid') {
        if (!isAnim) {
          await sock.sendMessage(chatJid, { text: '```That sticker is not animated```' }, { quoted: message });
          return;
        }
        const outMp4 = path.join(tmpDir, `se_stk_vid_${ts}.mp4`);
        await execAsync(`ffmpeg -y -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=decrease" -c:v libx264 -pix_fmt yuv420p "${outMp4}"`, 60000);
        const mp4Buf = fs.readFileSync(outMp4);
        fs.unlinkSync(outMp4);
        await sock.sendMessage(chatJid, { video: mp4Buf, mimetype: 'video/mp4', caption: '🎬 Animated sticker → Video' }, { quoted: message });
      }

    } catch (err) {
      console.error('[sticker→media]', err.message);
      const m = err.message || '';
      const errText = /ffmpeg|ENOENT/i.test(m) ? 'ffmpeg not found on server.' : 'Conversion failed — try again.';
      await sock.sendMessage(chatJid, { text: `\`\`\`${errText}\`\`\`` }, { quoted: message });
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
    }
  }

  // ── Make sticker from image / gif / video ────────────────────────────────
  async _makeSticker(sender, chatJid, sock, message) {
    // Resolve quoted or direct media
    let targetMessage = message;
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      targetMessage = {
        key: { remoteJid: chatJid, id: ctx.stanzaId, participant: ctx.participant },
        message: ctx.quotedMessage,
      };
    }

    const mediaMsg =
      targetMessage.message?.imageMessage   ||
      targetMessage.message?.videoMessage   ||
      targetMessage.message?.documentMessage ||
      targetMessage.message?.stickerMessage;

    if (!mediaMsg) {
      await sock.sendMessage(chatJid, {
        text: [
          '🎨 *STICKER MAKER*',
          '',
          'Send an image/GIF/video with *.s* as caption, or reply to one with *.s*',
          '',
          '• *.s*          → make sticker',
          '• *.s img*      → sticker → image (reply to sticker)',
          '• *.s gif*      → animated sticker → GIF (reply to sticker)',
          '• *.s vid*      → animated sticker → video (reply to sticker)',
        ].join('\n')
      }, { quoted: message });
      return;
    }

    // webpmux check early
    try { require('node-webpmux'); } catch {
      await sock.sendMessage(chatJid, { text: '```node-webpmux not installed — run: npm install node-webpmux```' }, { quoted: message });
      return;
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const ts    = Date.now();
    const tmpIn = path.join(tmpDir, `se_stk_in_${ts}`);

    try {
      const mediaBuf = await downloadMediaMessage(
        targetMessage, 'buffer', {},
        { logger: undefined, reuploadRequest: sock.updateMediaMessage }
      );
      if (!mediaBuf || mediaBuf.length === 0) {
        await sock.sendMessage(chatJid, { text: '```Failed to download media — try again```' }, { quoted: message });
        return;
      }
      fs.writeFileSync(tmpIn, mediaBuf);

      const mime      = mediaMsg.mimetype || '';
      const isAnimated = mime.includes('gif') || mime.includes('video') || (mediaMsg.seconds || 0) > 0;

      const webpBuf = await encodeSticker(tmpIn, isAnimated);
      if (!webpBuf) {
        await sock.sendMessage(chatJid, { text: '```Sticker creation failed — try a smaller image or shorter clip```' }, { quoted: message });
        return;
      }

      const final = await injectExif(webpBuf);
      await sock.sendMessage(chatJid, {
        sticker: final,
        ...(isAnimated ? { mimetype: 'image/webp' } : {}),
      }, { quoted: message });

    } catch (err) {
      console.error('[sticker]', err.message);
      const m = err.message || '';
      const errText =
        /ENOENT.*ffmpeg|ffmpeg.*not found/i.test(m) ? 'ffmpeg not found on server.' :
        /download|media/i.test(m)                   ? 'Failed to download media — try again.' :
                                                       'Sticker creation failed — try a different image or shorter clip.';
      await sock.sendMessage(chatJid, { text: `\`\`\`${errText}\`\`\`` }, { quoted: message });
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
    }
  }
}

module.exports = StickerCommand;
module.exports.commands = {
  s:       'execute',
  sticker: 'execute',
};
