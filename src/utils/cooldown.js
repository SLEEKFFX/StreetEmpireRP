/**
 * Cooldown Manager
 * Handles command cooldowns and rate limiting
 */

class CooldownManager {
  constructor() {
    this.cooldowns = new Map();
  }

  /**
   * Add a cooldown for a specific action
   * @param {string} userId - Player's WhatsApp ID
   * @param {string} action - Action name (e.g., 'heist', 'gamble')
   * @param {number} duration - Duration in milliseconds
   */
  addCooldown(userId, action, duration) {
    const key = `${userId}_${action}`;
    const expirationTime = Date.now() + duration;
    this.cooldowns.set(key, expirationTime);
  }

  /**
   * Check if a cooldown is active
   * @param {string} userId - Player's WhatsApp ID
   * @param {string} action - Action name
   * @returns {boolean} true if cooldown is active
   */
  isOnCooldown(userId, action) {
    const key = `${userId}_${action}`;
    
    if (!this.cooldowns.has(key)) {
      return false;
    }

    const expirationTime = this.cooldowns.get(key);
    
    if (Date.now() > expirationTime) {
      this.cooldowns.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time in seconds
   * @param {string} userId - Player's WhatsApp ID
   * @param {string} action - Action name
   * @returns {number} Remaining time in seconds
   */
  getRemainingTime(userId, action) {
    const key = `${userId}_${action}`;

    if (!this.cooldowns.has(key)) {
      return 0;
    }

    const expirationTime = this.cooldowns.get(key);
    const remaining = expirationTime - Date.now();

    if (remaining <= 0) {
      this.cooldowns.delete(key);
      return 0;
    }

    return Math.ceil(remaining / 1000);
  }

  /**
   * Remove a cooldown manually
   * @param {string} userId - Player's WhatsApp ID
   * @param {string} action - Action name
   */
  removeCooldown(userId, action) {
    const key = `${userId}_${action}`;
    this.cooldowns.delete(key);
  }

  /**
   * Clear all cooldowns for a user
   * @param {string} userId - Player's WhatsApp ID
   */
  clearUserCooldowns(userId) {
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(userId)) {
        this.cooldowns.delete(key);
      }
    }
  }

  /**
   * Format cooldown time to human readable format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  formatTime(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${secs}s`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${hours}h ${mins}m`;
  }

  /**
   * Get formatted cooldown message
   * @param {string} userId - Player's WhatsApp ID
   * @param {string} action - Action name
   * @returns {string} Formatted cooldown message
   */
  getCooldownMessage(userId, action) {
    const remaining = this.getRemainingTime(userId, action);
    const formatted = this.formatTime(remaining);
    return `⏰ Action on cooldown! Wait ${formatted}`;
  }

  /**
   * Clear expired cooldowns (cleanup)
   */
  clearExpired() {
    const now = Date.now();
    
    for (const [key, expirationTime] of this.cooldowns.entries()) {
      if (now > expirationTime) {
        this.cooldowns.delete(key);
      }
    }
  }

  /**
   * Get all active cooldowns for a user
   * @param {string} userId - Player's WhatsApp ID
   * @returns {Object} Object with action names and remaining times
   */
  getUserCooldowns(userId) {
    const userCooldowns = {};

    for (const [key, expirationTime] of this.cooldowns.entries()) {
      if (key.startsWith(userId)) {
        const action = key.substring(userId.length + 1);
        const remaining = expirationTime - Date.now();

        if (remaining > 0) {
          userCooldowns[action] = Math.ceil(remaining / 1000);
        }
      }
    }

    return userCooldowns;
  }
}

// Predefined cooldown durations
const COOLDOWN_DURATIONS = {
  HEIST: 3600000,              // 1 hour
  ROBBERY: 1800000,            // 30 minutes
  GAMBLE: 0,                   // No cooldown
  RACE: 300000,                // 5 minutes
  MISSION: 1800000,            // 30 minutes
  MONEY_REQUEST: 600000,       // 10 minutes
  BUSINESS_UPGRADE: 0,         // No cooldown
  VEHICLE_BUY: 0,              // No cooldown
  TRANSFER: 0,                 // No cooldown
};

module.exports = {
  CooldownManager,
  COOLDOWN_DURATIONS
};
