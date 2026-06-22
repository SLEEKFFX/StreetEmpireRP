/**
 * Text & Number Formatters
 * Formats output for better readability
 */

class Formatter {
  /**
   * Format number as currency with commas
   * @param {number} amount - Amount to format
   * @returns {string} Formatted currency string
   */
  static formatCurrency(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
      return '$0';
    }
    return `$${Math.floor(amount).toLocaleString()}`;
  }

  /**
   * Format large numbers with abbreviations
   * @param {number} num - Number to format
   * @returns {string} Formatted number (e.g., 1.5M, 2.3K)
   */
  static formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format time duration to readable format
   * @param {number} milliseconds - Time in milliseconds
   * @returns {string} Formatted time
   */
  static formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Format date and time
   * @param {Date} date - Date object to format
   * @returns {string} Formatted date and time
   */
  static formatDateTime(date) {
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    return new Date(date).toLocaleString('en-US', options);
  }

  /**
   * Format date only
   * @param {Date} date - Date object to format
   * @returns {string} Formatted date
   */
  static formatDate(date) {
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    return new Date(date).toLocaleString('en-US', options);
  }

  /**
   * Format time only
   * @param {Date} date - Date object to format
   * @returns {string} Formatted time
   */
  static formatTimeOnly(date) {
    const options = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    };
    return new Date(date).toLocaleString('en-US', options);
  }

  /**
   * Create a formatted box/header
   * @param {string} title - Title text
   * @param {number} width - Box width (default: 32)
   * @returns {string} Formatted box
   */
  static createBox(title, width = 32) {
    const padding = Math.floor((width - title.length - 2) / 2);
    const line = '═'.repeat(width);
    const topLine = '╔' + line + '╗';
    const bottomLine = '╚' + line + '╝';
    const titleLine = '║' + ' '.repeat(padding) + title + ' '.repeat(width - padding - title.length) + '║';

    return `${topLine}\n${titleLine}\n${bottomLine}`;
  }

  /**
   * Capitalize first letter of each word
   * @param {string} str - String to capitalize
   * @returns {string} Capitalized string
   */
  static capitalize(str) {
    if (typeof str !== 'string') return str;
    return str
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Truncate text to specific length
   * @param {string} text - Text to truncate
   * @param {number} length - Max length
   * @returns {string} Truncated text with ellipsis
   */
  static truncate(text, length = 50) {
    if (text.length <= length) return text;
    return text.substring(0, length - 3) + '...';
  }

  /**
   * Format percentage with decimal places
   * @param {number} value - Current value
   * @param {number} total - Total value
   * @param {number} decimals - Decimal places (default: 2)
   * @returns {string} Formatted percentage
   */
  static formatPercentage(value, total, decimals = 2) {
    if (total === 0) return '0%';
    const percentage = (value / total) * 100;
    return percentage.toFixed(decimals) + '%';
  }

  /**
   * Create a progress bar
   * @param {number} current - Current value
   * @param {number} total - Total value
   * @param {number} width - Bar width (default: 20)
   * @returns {string} Progress bar
   */
  static createProgressBar(current, total, width = 20) {
    const percentage = current / total;
    const filled = Math.round(percentage * width);
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percent = (percentage * 100).toFixed(0) + '%';

    return `[${bar}] ${percent}`;
  }

  /**
   * Get emoji based on status
   * @param {string} status - Status name
   * @returns {string} Appropriate emoji
   */
  static getStatusEmoji(status) {
    const emojis = {
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'info': 'ℹ️',
      'pending': '⏳',
      'loading': '⌛',
      'money': '💵',
      'bank': '🏦',
      'heist': '🎯',
      'vehicle': '🚗',
      'business': '💼',
      'crew': '👥',
      'rank': '⭐',
      'xp': '⚡',
      'cooldown': '⏰'
    };

    return emojis[status] || '•';
  }

  /**
   * Format rank name with emoji
   * @param {string} rank - Rank name
   * @returns {string} Emoji + Rank name
   */
  static formatRank(rank) {
    const ranks = {
      'Rookie': '👶',
      'Associate': '👤',
      'Lieutenant': '💼',
      'Captain': '👑',
      'Boss': '💎'
    };

    const emoji = ranks[rank] || '•';
    return `${emoji} ${rank}`;
  }

  /**
   * Create a divider line
   * @param {number} length - Line length (default: 32)
   * @returns {string} Divider line
   */
  static createDivider(length = 32) {
    return '━'.repeat(length);
  }

  /**
   * Format array as bullet list
   * @param {array} items - Items to list
   * @param {string} bullet - Bullet character (default: •)
   * @returns {string} Formatted list
   */
  static formatList(items, bullet = '•') {
    return items.map(item => `${bullet} ${item}`).join('\n');
  }

  /**
   * Format object as key-value pairs
   * @param {Object} obj - Object to format
   * @returns {string} Formatted key-value pairs
   */
  static formatObject(obj) {
    return Object.entries(obj)
      .map(([key, value]) => `${this.capitalize(key)}: ${value}`)
      .join('\n');
  }

  /**
   * Colorize text for terminal (if supported)
   * @param {string} text - Text to colorize
   * @param {string} color - Color name
   * @returns {string} Colorized text
   */
  static colorize(text, color) {
    const colors = {
      'green': '\x1b[32m',
      'red': '\x1b[31m',
      'yellow': '\x1b[33m',
      'blue': '\x1b[34m',
      'cyan': '\x1b[36m',
      'magenta': '\x1b[35m',
      'reset': '\x1b[0m'
    };

    const colorCode = colors[color] || '';
    const reset = colors['reset'];

    return `${colorCode}${text}${reset}`;
  }
}

module.exports = Formatter;
