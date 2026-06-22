// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — VALUABLES  v1.0
//  Buy/sell gold, silver, diamonds, rubies, emeralds, platinum
//  Prices fluctuate every 10 minutes
// ═══════════════════════════════════════════════════════════════

const BankingCommand = require('./banking');
const { VAULT_ITEMS } = require('./housing');

// ── Market State (persisted in db.data.valuableMarket) ────────
const BASE_PRICES = {
  gold:     { name: 'Gold',     emoji: '🥇', base: 127_000,   volatility: 0.08 },
  silver:   { name: 'Silver',   emoji: '🥈', base: 6_500,    volatility: 0.06 },
  diamond:  { name: 'Diamond',  emoji: '💎', base: 750_000,  volatility: 0.12 },
  ruby:     { name: 'Ruby',     emoji: '❤️‍🔥', base: 375_000,  volatility: 0.10 },
  emerald:  { name: 'Emerald',  emoji: '💚', base: 270_000,  volatility: 0.09 },
  platinum: { name: 'Platinum', emoji: '⚪', base: 180_000,  volatility: 0.07 },
};

const TICK_MS = 10 * 60 * 1000; // 10 minutes

// ─────────────────────────────────────────────────────────────
class ValuablesCommand {
  constructor(db) {
    this.db = db;
    this._ensureMarket();
    this._interval = setInterval(() => this._tick(), TICK_MS);
  }

  _ensureMarket() {
    if (!this.db.data.valuableMarket) {
      this.db.data.valuableMarket = {};
      for (const [id, v] of Object.entries(BASE_PRICES)) {
        this.db.data.valuableMarket[id] = {
          price: v.base,
          history: [v.base],
          lastTick: Date.now(),
        };
      }
      this.db.saveData();
    }
    // Patch missing keys
    for (const [id, v] of Object.entries(BASE_PRICES)) {
      if (!this.db.data.valuableMarket[id]) {
        this.db.data.valuableMarket[id] = { price: v.base, history: [v.base], lastTick: Date.now() };
      }
    }
  }

  _tick() {
    this._ensureMarket();
    for (const [id, v] of Object.entries(BASE_PRICES)) {
      const m = this.db.data.valuableMarket[id];
      const change = (Math.random() * 2 - 1) * v.volatility;
      let newPrice = m.price * (1 + change);
      // Keep price within 30% of base
      newPrice = Math.max(v.base * 0.50, Math.min(v.base * 2.50, newPrice));
      m.price = Math.round(newPrice);
      m.history.push(m.price);
      if (m.history.length > 8) m.history.shift();
      m.lastTick = Date.now();
    }
    this.db.saveData();
  }

  _getMarket() {
    this._ensureMarket();
    return this.db.data.valuableMarket;
  }

  _priceChange(history) {
    if (history.length < 2) return 0;
    const old = history[history.length - 2];
    const cur = history[history.length - 1];
    return old > 0 ? ((cur - old) / old * 100) : 0;
  }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'market' || sub === 'm') return this._showMarket(player, chatJid, sock, message);
    if (sub === 'buy')  return this._buy(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'sell') return this._sell(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'inv' || sub === 'inventory') return this._showInv(player, chatJid, sock, message);
    if (sub === 'store') return this._storeToVault(args.slice(1), sender, player, chatJid, sock, message);

    await sock.sendMessage(chatJid, {
      text: `💎 *VALUABLES*\n\n.val market — live prices\n.val buy [item] [qty] — purchase\n.val sell [item] [qty] — sell\n.val inv — your holdings\n.val store [item] [qty] — move to house vault`
    }, { quoted: message });
  }

  async _showMarket(player, chatJid, sock, message) {
    const market = this._getMarket();
    let text = `╔═════════════════╗\n║ 💎 VALUABLES MARKET\n╚═════════════════╝\n\n`;
    for (const [id, v] of Object.entries(BASE_PRICES)) {
      const m = market[id];
      const pct = this._priceChange(m.history);
      const arrow = pct > 0 ? '📈' : pct < 0 ? '📉' : '➡️';
      const sign = pct >= 0 ? '+' : '';
      text += `${v.emoji} *${v.name}*\n`;
      text += `   $${m.price.toLocaleString()} ${arrow} ${sign}${pct.toFixed(1)}%\n`;
      const inv = player.inventory?.[id] || 0;
      if (inv > 0) text += `   You own: ${inv}\n`;
      text += `\n`;
    }
    text += `Buy: .val buy gold 5\nSell: .val sell diamond 2\nInventory: .val inv`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _buy(args, sender, player, chatJid, sock, message) {
    const item = (args[0] || '').toLowerCase();
    const qty  = parseInt(args[1]) || 1;
    const v    = BASE_PRICES[item];
    if (!v) {
      await sock.sendMessage(chatJid, { text: `❌ Unknown item.\nItems: ${Object.keys(BASE_PRICES).join(', ')}` }, { quoted: message }); return;
    }
    const market = this._getMarket();
    const price  = market[item].price;
    const total  = price * qty;

    // ── Daily spend cap: $500K per item per 24hrs ──────────────────────────
    const DAILY_CAP = 500_000;
    const now       = Date.now();
    if (!player.valDailySpend)         player.valDailySpend = {};
    if (!player.valDailySpend[item])   player.valDailySpend[item] = { spent: 0, resetAt: 0 };
    const tracker = player.valDailySpend[item];
    if (now >= tracker.resetAt) {
      tracker.spent   = 0;
      tracker.resetAt = now + 24 * 60 * 60 * 1000;
    }
    const remaining = DAILY_CAP - tracker.spent;
    if (remaining <= 0) {
      const hrsLeft = Math.ceil((tracker.resetAt - now) / 3600000);
      await sock.sendMessage(chatJid, { text: `*Sorry ${v.name} is sold out*\n\nResets in: ${hrsLeft}h` }, { quoted: message }); return;
    }
    if (total > remaining) {
      const maxQty  = Math.floor(remaining / price);
      const hrsLeft = Math.ceil((tracker.resetAt - now) / 3600000);
      await sock.sendMessage(chatJid, {
        text: `🚫 *Valuable almost sold out*\n\n${v.emoji} ${v.name} @ $${price.toLocaleString()} each\nYou can still buy: ${maxQty} units ($${remaining.toLocaleString()} left)\nResets in: ${hrsLeft}h`
      }, { quoted: message }); return;
    }
    // ── End cap ────────────────────────────────────────────────────────────

    const payFrom = (player.bank || 0) >= total ? 'bank' : (player.cash || 0) >= total ? 'cash' : null;
    if (!payFrom) {
      await sock.sendMessage(chatJid, { text: `Not enough funds\nTotal: $${total.toLocaleString()}\nCash: $${(player.cash||0).toLocaleString()} | Bank: $${(player.bank||0).toLocaleString()}` }, { quoted: message }); return;
    }

    if (payFrom === 'bank') player.bank -= total;
    else player.cash -= total;

    tracker.spent += total;
    player.valDailySpend[item] = tracker;
    if (!player.inventory) player.inventory = {};
    player.inventory[item] = (player.inventory[item] || 0) + qty;
    player.experience = (player.experience || 0) + qty;
    this.db.updatePlayer(sender, player);

    const spentLeft = DAILY_CAP - tracker.spent;
    await sock.sendMessage(chatJid, {
      text: `✅ *PURCHASED!*\n\n${v.emoji} ${v.name} x${qty}\n💰 Paid: $${total.toLocaleString()} (${payFrom})\n📦 You now own: ${player.inventory[item]}\n📅 Daily limit left: $${spentLeft.toLocaleString()}\n\n.val store ${item} ${qty} — move to vault`
    }, { quoted: message });
  }

  async _sell(args, sender, player, chatJid, sock, message) {
    const item = (args[0] || '').toLowerCase();
    const qty  = parseInt(args[1]) || 1;
    const v    = BASE_PRICES[item];
    if (!v) {
      await sock.sendMessage(chatJid, { text: `❌ Unknown item.\nItems: ${Object.keys(BASE_PRICES).join(', ')}` }, { quoted: message }); return;
    }
    const inv = player.inventory?.[item] || 0;
    if (inv < qty) {
      await sock.sendMessage(chatJid, { text: `❌ You only have ${inv} ${v.name}.` }, { quoted: message }); return;
    }
    const market = this._getMarket();
    const price  = market[item].price;
    const total  = Math.floor(price * qty * 0.95); // 5% sell fee

    player.inventory[item] = inv - qty;
    player.cash += total;
    player.experience = (player.experience || 0) + qty;
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: `💸 *SOLD!*\n\n${v.emoji} ${v.name} x${qty}\n💰 Received: $${total.toLocaleString()} (cash, 5% fee)\n📦 Remaining: ${player.inventory[item]}`
    }, { quoted: message });
  }

  async _showInv(player, chatJid, sock, message) {
    const inv = player.inventory || {};
    const market = this._getMarket();
    let text = `📦 *YOUR VALUABLES*\n\n`;
    let totalVal = 0;
    let hasItems = false;
    for (const [id, v] of Object.entries(BASE_PRICES)) {
      const qty = inv[id] || 0;
      if (qty > 0) {
        const val = market[id].price * qty;
        totalVal += val;
        text += `${v.emoji} ${v.name}: ${qty} (≈$${val.toLocaleString()})\n`;
        hasItems = true;
      }
    }
    if (!hasItems) text += `No valuables\n*cricket sounds* \nBuy some: .val buy gold 1\n`;
    else text += `\n💰 Total Value: ~$${totalVal.toLocaleString()}\n`;
    text += `\n.val store [item] [qty] — move to house vault`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _storeToVault(args, sender, player, chatJid, sock, message) {
    if (!player.house) {
      await sock.sendMessage(chatJid, { text: `❌ You need a home with a vault first!\n.house list` }, { quoted: message }); return;
    }
    // Delegate to housing vault store
    const HousingCommand = require('./housing');
    const hc = new HousingCommand(this.db);
    await hc.execute(['vault', 'store', ...args], sender, chatJid, sock, message);
  }
}

ValuablesCommand.BASE_PRICES = BASE_PRICES;
module.exports = ValuablesCommand;
