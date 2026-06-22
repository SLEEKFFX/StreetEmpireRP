'use strict';

const WARN_LIMIT = 3;

/**
 * Build the storage key for a (chat, target) pair.
 */
function warnKey(chatJid, targetId) {
  return `${chatJid}:${targetId}`;
}

/**
 * Get current warn count for a member in a group.
 */
function getWarnCount(db, chatJid, targetId) {
  if (!db.data.warns) return 0;
  return db.data.warns[warnKey(chatJid, targetId)] || 0;
}

/**
 * Increment warn count for a member. Returns the new count.
 * If the new count reaches WARN_LIMIT, the counter is reset to 0
 * (caller is responsible for performing the kick).
 */
function addWarn(db, chatJid, targetId) {
  if (!db.data.warns) db.data.warns = {};
  const key = warnKey(chatJid, targetId);
  db.data.warns[key] = (db.data.warns[key] || 0) + 1;
  const count = db.data.warns[key];
  if (count >= WARN_LIMIT) {
    db.data.warns[key] = 0; // reset after triggering kick
  }
  db.saveData();
  return count;
}

/**
 * Reset warn count for a single member in a group.
 */
function resetWarn(db, chatJid, targetId) {
  if (!db.data.warns) db.data.warns = {};
  const key = warnKey(chatJid, targetId);
  const had = db.data.warns[key] || 0;
  delete db.data.warns[key];
  db.saveData();
  return had;
}

/**
 * Reset ALL warn counters for every member in a group.
 * Returns the number of entries that were cleared.
 */
function resetAllWarnsInGroup(db, chatJid) {
  if (!db.data.warns) return 0;
  const prefix = `${chatJid}:`;
  let cleared = 0;
  for (const key of Object.keys(db.data.warns)) {
    if (key.startsWith(prefix)) {
      delete db.data.warns[key];
      cleared++;
    }
  }
  if (cleared > 0) db.saveData();
  return cleared;
}

module.exports = { WARN_LIMIT, getWarnCount, addWarn, resetWarn, resetAllWarnsInGroup, warnKey };
