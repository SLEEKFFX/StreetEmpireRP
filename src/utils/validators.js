/**
 * Input & Data Validators
 * Validates user input and game data
 */

class Validator {
  /**
   * Validate if input is a valid number
   * @param {*} input - Input to validate
   * @returns {boolean} true if valid number
   */
  static isValidNumber(input) {
    const num = Number(input);
    return !isNaN(num) && isFinite(num);
  }

  /**
   * Validate if amount is within range
   * @param {number} amount - Amount to validate
   * @param {number} min - Minimum amount
   * @param {number} max - Maximum amount
   * @returns {boolean} true if within range
   */
  static isAmountValid(amount, min = 0, max = Infinity) {
    return this.isValidNumber(amount) && amount >= min && amount <= max;
  }

  /**
   * Validate WhatsApp user ID format
   * @param {string} userId - User ID to validate
   * @returns {boolean} true if valid format
   */
  static isValidUserId(userId) {
    return typeof userId === 'string' && userId.includes('@s.whatsapp.net');
  }

  /**
   * Validate player name
   * @param {string} name - Name to validate
   * @returns {boolean} true if valid name
   */
  static isValidName(name) {
    if (typeof name !== 'string') return false;
    return name.length > 0 && name.length <= 50;
  }

  /**
   * Validate command syntax
   * @param {string} command - Command to validate
   * @returns {boolean} true if valid command
   */
  static isValidCommand(command) {
    if (typeof command !== 'string') return false;
    return command.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  }

  /**
   * Validate array is not empty
   * @param {array} arr - Array to validate
   * @returns {boolean} true if array has items
   */
  static isArrayValid(arr) {
    return Array.isArray(arr) && arr.length > 0;
  }

  /**
   * Validate player has enough money
   * @param {number} playerMoney - Player's money
   * @param {number} requiredAmount - Required amount
   * @returns {boolean} true if player has enough
   */
  static hasEnoughMoney(playerMoney, requiredAmount) {
    return this.isValidNumber(playerMoney) && 
           this.isValidNumber(requiredAmount) && 
           playerMoney >= requiredAmount;
  }

  /**
   * Validate player level/rank
   * @param {number} level - Player's level
   * @returns {boolean} true if valid level
   */
  static isValidLevel(level) {
    return this.isValidNumber(level) && level >= 1 && level <= 100;
  }

  /**
   * Validate business ID
   * @param {number} businessId - Business ID to validate
   * @returns {boolean} true if valid ID (1-10)
   */
  static isValidBusinessId(businessId) {
    const id = Number(businessId);
    return !isNaN(id) && id >= 1 && id <= 10;
  }

  /**
   * Validate vehicle ID
   * @param {number} vehicleId - Vehicle ID to validate
   * @returns {boolean} true if valid ID (1-37)
   */
  static isValidVehicleId(vehicleId) {
    const id = Number(vehicleId);
    return !isNaN(id) && id >= 1 && id <= 37;
  }

  /**
   * Validate heist type
   * @param {string} heistType - Heist type to validate
   * @returns {boolean} true if valid heist type
   */
  static isValidHeistType(heistType) {
    const validHeists = [
      'store_robbery',
      'money_heist',
      'car_robbery',
      'jewelry_heist',
      'bank_heist',
      'casino_heist'
    ];
    return validHeists.includes(heistType);
  }

  /**
   * Validate gambling game type
   * @param {string} gameType - Game type to validate
   * @returns {boolean} true if valid game
   */
  static isValidGameType(gameType) {
    const validGames = ['roulette', 'slots', 'coin', 'bet'];
    return validGames.includes(gameType);
  }

  /**
   * Validate player data structure
   * @param {Object} player - Player object to validate
   * @returns {boolean} true if valid player data
   */
  static isValidPlayer(player) {
    return (
      typeof player === 'object' &&
      player.id &&
      typeof player.name === 'string' &&
      this.isValidNumber(player.cash) &&
      this.isValidNumber(player.bank) &&
      this.isValidNumber(player.rank) &&
      this.isValidNumber(player.experience) &&
      Array.isArray(player.vehicles) &&
      Array.isArray(player.businesses)
    );
  }

  /**
   * Validate vehicle data structure
   * @param {Object} vehicle - Vehicle object to validate
   * @returns {boolean} true if valid vehicle data
   */
  static isValidVehicle(vehicle) {
    return (
      typeof vehicle === 'object' &&
      typeof vehicle.name === 'string' &&
      this.isValidNumber(vehicle.price) &&
      this.isValidNumber(vehicle.topSpeed) &&
      typeof vehicle.type === 'string'
    );
  }

  /**
   * Validate business data structure
   * @param {Object} business - Business object to validate
   * @returns {boolean} true if valid business data
   */
  static isValidBusiness(business) {
    return (
      typeof business === 'object' &&
      typeof business.name === 'string' &&
      this.isValidNumber(business.price) &&
      this.isValidNumber(business.income) &&
      typeof business.production === 'string' &&
      typeof business.type === 'string'
    );
  }

  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} true if valid email
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate phone number format
   * @param {string} phone - Phone number to validate
   * @returns {boolean} true if valid phone number
   */
  static isValidPhone(phone) {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Validate string length
   * @param {string} str - String to validate
   * @param {number} minLength - Minimum length
   * @param {number} maxLength - Maximum length
   * @returns {boolean} true if valid length
   */
  static isValidStringLength(str, minLength = 1, maxLength = 1000) {
    return typeof str === 'string' && 
           str.length >= minLength && 
           str.length <= maxLength;
  }

  /**
   * Validate URL format
   * @param {string} url - URL to validate
   * @returns {boolean} true if valid URL
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate JSON format
   * @param {string} jsonStr - JSON string to validate
   * @returns {boolean} true if valid JSON
   */
  static isValidJson(jsonStr) {
    try {
      JSON.parse(jsonStr);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate date format
   * @param {*} date - Date to validate
   * @returns {boolean} true if valid date
   */
  static isValidDate(date) {
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Validate cooldown duration
   * @param {number} duration - Duration in milliseconds
   * @returns {boolean} true if valid duration
   */
  static isValidCooldown(duration) {
    return this.isValidNumber(duration) && duration > 0 && duration <= 86400000; // Max 24 hours
  }

  /**
   * Sanitize user input (remove special characters)
   * @param {string} input - Input to sanitize
   * @returns {string} Sanitized input
   */
  static sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input
      .replace(/[^\w\s@.-]/g, '')
      .trim()
      .substring(0, 1000);
  }

  /**
   * Validate bet amount
   * @param {number} amount - Amount to validate
   * @returns {boolean} true if valid bet amount
   */
  static isValidBetAmount(amount) {
    const MIN_BET = 1000;
    const MAX_BET = 1000000;
    return this.isAmountValid(amount, MIN_BET, MAX_BET);
  }

  /**
   * Validate transaction amount
   * @param {number} amount - Amount to validate
   * @returns {boolean} true if valid transaction amount
   */
  static isValidTransactionAmount(amount) {
    const MIN_TRANSFER = 1000;
    const MAX_TRANSFER = 50000000;
    return this.isAmountValid(amount, MIN_TRANSFER, MAX_TRANSFER);
  }

  /**
   * Get validation error message
   * @param {string} type - Validation type
   * @returns {string} Error message
   */
  static getErrorMessage(type) {
    const messages = {
      'invalid_amount': '❌ Invalid amount! Please enter a valid number.',
      'insufficient_funds': '❌ Insufficient funds!',
      'invalid_command': '❌ Invalid command syntax!',
      'invalid_player': '❌ Player not found!',
      'invalid_business': '❌ Invalid business ID!',
      'invalid_vehicle': '❌ Invalid vehicle ID!',
      'invalid_heist': '❌ Invalid heist type!',
      'invalid_bet': '❌ Bet must be between $1,000 and $1,000,000!',
      'on_cooldown': '⏰ Action is on cooldown! Please wait.',
      'low_level': '❌ Your level is too low for this action!',
      'not_owned': '❌ You do not own this item!',
      'already_owned': '❌ You already own this item!',
      'invalid_email': '❌ Invalid email format!',
      'invalid_phone': '❌ Invalid phone number format!'
    };

    return messages[type] || '❌ Invalid input!';
  }
}

module.exports = Validator;

// ── JID normalization helper (fixes multi-device suffix bug) ───────────────
// Strips :X device suffix and harmonises @c.us → @s.whatsapp.net
// Use this everywhere a targetId is built from phone digits extracted from a mention
function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.replace(/:\d+@/, '@').replace(/@c\.us$/, '@s.whatsapp.net');
}

// Build a proper WhatsApp JID from raw digits extracted from a @mention
function phoneToJid(digits) {
  return normalizeJid(digits + '@s.whatsapp.net');
}

module.exports.normalizeJid = normalizeJid;
module.exports.phoneToJid   = phoneToJid;
