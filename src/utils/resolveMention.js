/**
 * resolveMention — extract a target player's JID from a WhatsApp message.
 *
 * ROOT CAUSE OF MENTION BUG:
 * When a user types ".ttt @player 2000" in a WhatsApp group, Baileys receives
 * the message as extendedTextMessage. The mentionedJid array lives at:
 *   message.message.extendedTextMessage.contextInfo.mentionedJid
 *
 * However if mentionedJid is empty/missing (can happen with some Baileys versions
 * or WA clients), the fallback reads the @number from the text args.
 * The @number in the text IS the correct phone number — but must be built into
 * a proper JID: digits + "@s.whatsapp.net".
 *
 * The accept-invite failure happens because the stored key (from targetId) and
 * the replying player's sender JID use different formats. All keys must be
 * normalized to @s.whatsapp.net without :N suffixes.
 */

function normJid(jid) {
  if (!jid) return null;
  // Remove Baileys multi-device suffix (:0, :1, etc.) and harmonize domain
  return jid.replace(/:\d+@/, '@').replace(/@c\.us$/, '@s.whatsapp.net');
}

/**
 * Extract mentionedJid array from ALL known Baileys message paths.
 * Different Baileys versions and message types put contextInfo in different places.
 */
function extractMentions(message) {
  if (!message) return [];
  const msg = message.message || {};

  const paths = [
    // Standard group @mention path (most common)
    msg?.extendedTextMessage?.contextInfo?.mentionedJid,
    // Some Baileys builds put it here directly
    msg?.extendedTextMessage?.mentionedJid,
    // Image/video captions with mentions
    msg?.imageMessage?.contextInfo?.mentionedJid,
    msg?.videoMessage?.contextInfo?.mentionedJid,
    // Button and list message types
    msg?.buttonsMessage?.contextInfo?.mentionedJid,
    msg?.listMessage?.contextInfo?.mentionedJid,
    msg?.templateMessage?.contextInfo?.mentionedJid,
    // Some versions surface contextInfo at the top level
    message?.contextInfo?.mentionedJid,
  ];

  for (const c of paths) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

/**
 * @param {object}   message      — raw Baileys message object
 * @param {string[]} args         — already-split command args (without command itself)
 * @param {number}   argIndex     — which arg position might hold digits (default 0)
 * @param {number}   mentionIndex — which mention to pick if multiple (default 0)
 * @returns {string|null} normalized JID or null
 */
function resolveMention(message, args = [], argIndex = 0, mentionIndex = 0) {
  // ── Source 1: mentionedJid from WhatsApp contextInfo (preferred) ──────────
  const mentions = extractMentions(message);
  if (mentions.length > mentionIndex) {
    return normJid(mentions[mentionIndex]);
  }

  // ── Source 2: @number in args text ───────────────────────────────────────
  // When a user types @someone, WhatsApp encodes it as "@<phonenumber>" in the
  // message text. Strip the @ and build a proper JID from the digits.
  const arg = (args[argIndex] || '');
  const stripped = arg.replace(/^@/, '');       // remove leading @
  const digits = stripped.match(/^\d{5,}$/);    // must be ALL digits (pure phone)
  if (digits) {
    return normJid(digits[0] + '@s.whatsapp.net');
  }

  // ── Source 3: digits anywhere in the arg (looser fallback) ───────────────
  const anyDigits = stripped.match(/\d{5,}/);
  if (anyDigits) {
    return normJid(anyDigits[0] + '@s.whatsapp.net');
  }

  return null;
}

/**
 * Resolve TWO mentions (e.g. .raid @victim @helper)
 * Returns [jid1, jid2] — either may be null
 */
function resolveTwoMentions(message, args = []) {
  const mentions = extractMentions(message);

  const resolve = (mentionIdx, argIdx) => {
    if (mentions[mentionIdx]) return normJid(mentions[mentionIdx]);
    const arg = (args[argIdx] || '').replace(/^@/, '');
    const d = arg.match(/\d{5,}/);
    return d ? normJid(d[0] + '@s.whatsapp.net') : null;
  };

  return [resolve(0, 0), resolve(1, 1)];
}

module.exports = { resolveMention, resolveTwoMentions, normJid, extractMentions };
