'use strict';

const fs   = require('fs');
const path = require('path');

// ── Owner files ─────────────────────────────────────────────────────────────
// Either of these files (at the project root) can list bot owner numbers.
// Both are read and merged, so it doesn't matter which name is used.
const OWNER_FILES = [
  path.join(__dirname, '..', '..', 'ownerNumber.json'),
  path.join(__dirname, '..', '..', 'botnumber.json'),
];

let cachedOwners = null;
let lastLoad     = 0;
const CACHE_MS   = 5000; // re-read files every 5s in case they're edited live

/**
 * Load and merge owner numbers from all known owner files (cached for 5s).
 * Returns an array of bare phone numbers (digits only).
 */
function loadOwners() {
  const now = Date.now();
  if (cachedOwners && (now - lastLoad) < CACHE_MS) return cachedOwners;

  const numbers = new Set();

  for (const file of OWNER_FILES) {
    try {
      const raw  = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);

      // Accept either { "owners": [...] } or a bare array [...]
      const list = Array.isArray(data) ? data : (data.owners || data.owner || []);
      for (const n of list) {
        const digits = String(n).replace(/\D/g, '');
        if (digits) numbers.add(digits);
      }
    } catch {
      // file missing or invalid — ignore and continue to the next one
    }
  }

  cachedOwners = Array.from(numbers);
  lastLoad = now;
  return cachedOwners;
}

/**
 * Check if a JID (or bare number) belongs to a bot owner, per the
 * ownerNumber.json / botnumber.json allowlist.
 *
 * Handles JIDs like:
 *   "2348140266965@s.whatsapp.net"
 *   "2348140266965:5@s.whatsapp.net"
 *   "123456789012345@lid"  (matches only if that LID happens to be listed)
 */
function isOwner(jidOrNumber) {
  if (!jidOrNumber) return false;
  const owners = loadOwners();
  if (owners.length === 0) return false;

  const num = String(jidOrNumber).replace(/\D/g, '');
  if (!num) return false;

  return owners.some(o => num === o || num.endsWith(o) || o.endsWith(num));
}

/**
 * The most reliable "is this the bot owner" check.
 *
 * WhatsApp's newer LID (linked identifier) system means `sender` in groups
 * is often NOT the real phone number, so a plain JID comparison against
 * ownerNumber.json can fail even for the real owner.
 *
 * Baileys sets `message.key.fromMe = true` whenever the message was sent by
 * the SAME ACCOUNT the bot is logged in as — regardless of LID/phone format —
 * because Baileys itself resolves that internally. Since the "bot number" is
 * the owner's own linked WhatsApp account, fromMe=true reliably identifies
 * the owner typing a command.
 *
 * This function returns true if EITHER:
 *   - message.key.fromMe is true (the linked account itself), OR
 *   - sender's phone number is listed in ownerNumber.json / botnumber.json
 *     (lets you add CO-OWNERS who aren't the linked account)
 */
function isOwnerOrSelf(sender, message) {
  if (message?.key?.fromMe === true) return true;
  return isOwner(sender);
}

module.exports = { isOwner, isOwnerOrSelf, loadOwners, OWNER_FILES };
