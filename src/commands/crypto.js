const { resolveMention, normJid } = require('../utils/resolveMention');
// ═══════════════════════════════════════════════════════════════════
//  STREET EMPIRE CRYPTO  v4.0
//  • 3% fee on buy/sell/transfer
//  • Confirmation flow on buy/sell (token-based, via commandHandler)
//  • Transaction history per player
//  • Market runs 24/7, no buy caps
//  • Coins themed around real-world events/trends
// ═══════════════════════════════════════════════════════════════════

const BankingCommand = require('./banking');

const FEE_RATE = 0.03; // 3% transaction fee

// ── Coins ─────────────────────────────────────────────────────────────────
// noRug: true → coin will NEVER rug pull
// Prices/volatility/rugChance carried over 1:1 from the old roster —
// only names/emojis/descriptions changed to real-world-event themes.
const COINS = {
  // ── Safe coins (never rug) — same slots as old THUG/DRIP/PLUG/HEAT/Six7/BITCOIN
  SON:    { name:'Son Coin',     emoji:'😭', symbol:'SON',    desc:'Crying in the club — but the bag is real', initialPrice:0.0042,   volatility:0.18, noRug:true,  rugChance:0      },
  WCUP:   { name:'World Cup',    emoji:'⚽', symbol:'WCUP',   desc:'Tournament fever — pumps on match days',   initialPrice:0.055,    volatility:0.12, noRug:true,  rugChance:0      },
  BOYS:   { name:'The Boys',     emoji:'🦸🏽‍♂️', symbol:'BOYS', desc:'Supe-powered gains, zero accountability', initialPrice:0.0023,   volatility:0.15, noRug:true,  rugChance:0      },
  GTA6:   { name:'GTA 6',        emoji:'🚗', symbol:'GTA6',   desc:'Most anticipated coin in the game',        initialPrice:0.012,    volatility:0.20, noRug:true,  rugChance:0      },
  SIXSEVEN:{ name:'Six7',        emoji:'6️⃣7️⃣', symbol:'SIXSEVEN', desc:'12345...67!!!',                     initialPrice:0.0670,   volatility:0.29, noRug:false, rugChance:0.0001 },
  BITCOIN:{ name:'Bitcoin',      emoji:'🪙', symbol:'BTC',    desc:'Pizza coin — the original',                initialPrice:91_268.0, volatility:0.01, noRug:true,  rugChance:0      },

  // ── Volatile / rug-risk coins — same slots as old HEIST/KUSH/BLOCC/TRAP/CHEESE/MOON
  ECLIPSE:{ name:'Eclipse Token',emoji:'🌑', symbol:'ECLIPSE',desc:'Rare event hype — here today, dark tomorrow', initialPrice:0.0001,  volatility:0.28, noRug:false, rugChance:0.0008 },
  ELECT:  { name:'Election Year',emoji:'🗳️', symbol:'ELECT',  desc:'Polls swing it — high stakes degeneracy',  initialPrice:0.00069,  volatility:0.22, noRug:false, rugChance:0.0006 },
  AI:     { name:'AI Boom',      emoji:'🤖', symbol:'AI',     desc:'Built different, runs on hype',            initialPrice:0.0008,   volatility:0.32, noRug:false, rugChance:0.0010 },
  RUGCITY:{ name:'Rug City',     emoji:'🏚️', symbol:'RUGCITY',desc:'Rug guaranteed™',                          initialPrice:0.00001,  volatility:0.55, noRug:false, rugChance:0.0035 },
  OSCARS: { name:'Awards Season',emoji:'🏆', symbol:'OSCARS', desc:'Red carpet pump, after-party dump',        initialPrice:0.00420,  volatility:0.25, noRug:false, rugChance:0.0007 },
  FLARE:  { name:'Solar Flare',  emoji:'🌞', symbol:'FLARE',  desc:'GM ser, wen flare?',                       initialPrice:0.000001, volatility:0.50, noRug:false, rugChance:0.0020 },
};

const TICK_MS         = 15_000;
const RUG_RECOVERY_MS = 8 * 60 * 60 * 1000;
const REVIVAL_CHANCE  = 0.005;
const HISTORY_MAX     = 30;        // ticks kept per coin
const TX_HISTORY_MAX  = 20;        // transactions kept per player

let market   = null;
let lastTick = 0;

// ── _dbRef is set by CryptoCommand constructor for persistence ──
let _dbRef = null;

function saveMarketToDB() {
  try {
    if (_dbRef && market) {
      _dbRef.data.cryptoMarketState = { market, lastTick };
      _dbRef.saveData();
    }
  } catch (e) {}
}

function freshCoinState(coin) {
  return {
    price: coin.initialPrice,
    openPrice: coin.initialPrice,
    history: [coin.initialPrice],
    rugged: false, rugAt: null,
    revived: false, revivedAt: null, revivalCount: 0,
    mooning: false,
    trend: 0,          // -1, 0, 1 — short-term momentum bias, drives believable streaks
    trendTicksLeft: 0,
  };
}

function initMarket(db) {
  if (db) _dbRef = db;
  if (market) return;

  // Try to restore from DB first (survives restarts)
  if (_dbRef && _dbRef.data.cryptoMarketState) {
    try {
      const saved = _dbRef.data.cryptoMarketState;
      market   = saved.market;
      lastTick = saved.lastTick || Date.now();
      // Patch any coins added/removed since the save
      for (const [sym, coin] of Object.entries(COINS)) {
        if (!market[sym]) market[sym] = freshCoinState(coin);
      }
      for (const sym of Object.keys(market)) {
        if (!COINS[sym]) delete market[sym]; // drop retired coins
      }
      console.log('[Crypto] Market restored from DB ✅');
      return;
    } catch (e) {
      console.warn('[Crypto] Failed to restore market, reinitialising:', e.message);
    }
  }

  // Fresh init
  market = {};
  for (const [sym, coin] of Object.entries(COINS)) market[sym] = freshCoinState(coin);
  lastTick = Date.now();
}

// ── Price tick — momentum-biased random walk ──────────────────────────────
// Each coin gets a short "trend" (run of ticks biased the same direction) so
// movement looks like believable market behavior instead of pure noise that
// averages out to ~0%. Trend flips periodically and has its own strength.
function priceTick() {
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;
  lastTick = now;

  // Reset openPrice every 24h so % change is always within a rolling day window
  for (const m of Object.values(market)) {
    if (!m._openPriceSetAt || now - m._openPriceSetAt > 24 * 60 * 60 * 1000) {
      m.openPrice = m.price;
      m._openPriceSetAt = now;
    }
  }

  for (const [sym, coin] of Object.entries(COINS)) {
    const m = market[sym];

    // ── Revival check for rugged coins ──────────────────────────────────
    if (m.rugged) {
      const timeSinceRug = now - (m.rugAt || 0);
      if (timeSinceRug >= RUG_RECOVERY_MS && Math.random() < REVIVAL_CHANCE) {
        const revivalPrice = coin.initialPrice * (0.10 + Math.random() * 0.20);
        m.price = revivalPrice;
        m.history = [revivalPrice];
        m.rugged = false; m.rugAt = null;
        m.revived = true; m.revivedAt = now;
        m.revivalCount = (m.revivalCount || 0) + 1;
        coin._activeVolatility = Math.min(coin.volatility * 1.4, 0.70);
        console.log(`[Crypto] ${sym} REVIVED (revival #${m.revivalCount})`);
      }
      continue;
    }

    // ── Rug check — noRug coins are completely exempt ───────────────────
    if (!coin.noRug && coin.rugChance > 0) {
      const priceRatio  = m.price / coin.initialPrice;
      const adjustedRug = coin.rugChance * (priceRatio < 0.2 ? 1.5 : 1.0);
      if (Math.random() < adjustedRug) {
        m.rugged = true; m.rugAt = now;
        m.price  = coin.initialPrice * 0.001;
        m.history.push(m.price);
        if (m.history.length > HISTORY_MAX) m.history.shift();
        console.log(`[Crypto] ${sym} RUGGED`);
        continue;
      }
    }

    // ── Momentum / trend system ──────────────────────────────────────────
    // When a trend expires, roll a new one: up / down / choppy, with a
    // random duration. This produces visible multi-tick runs instead of
    // every tick canceling the last one out.
    if (m.trendTicksLeft <= 0) {
      const roll = Math.random();
      if      (roll < 0.40) m.trend = 1;   // 40% bullish run
      else if (roll < 0.75) m.trend = -1;  // 35% bearish run
      else                  m.trend = 0;   // 25% choppy/sideways
      m.trendTicksLeft = 4 + Math.floor(Math.random() * 10); // 4–13 ticks (~1–3.5 min)
    }
    m.trendTicksLeft--;

    const v = coin._activeVolatility || coin.volatility;

    // Base noise every tick, then bias it by the active trend.
    let change = (Math.random() - 0.5) * v;
    if (m.trend === 1)  change += v * (0.15 + Math.random() * 0.25); // push up
    if (m.trend === -1) change -= v * (0.15 + Math.random() * 0.25); // push down

    // Rare spike events — moonshot or flash dump, independent of trend
    const spikeRoll = Math.random();
    if (spikeRoll < 0.02)       { change += 0.15 + Math.random() * 0.35; m.mooning = true;  } // 2% moonshot
    else if (spikeRoll < 0.035) { change -= 0.12 + Math.random() * 0.25; m.mooning = false; } // 1.5% flash dump
    else if (Math.abs(change) > 0.02) { m.mooning = change > 0; }

    let newPrice = m.price * (1 + change);

    // ── Price bounds (silent) ────────────────────────────────────────────
    // Ceiling: 600% of initial. Floor: 35% of initial. Keeps coins alive
    // and tradeable without letting any single coin run away forever.
    const initPrice = coin.initialPrice;
    newPrice = Math.max(initPrice * 0.35, Math.min(initPrice * 6.00, newPrice));

    m.price = newPrice;
    m.history.push(m.price);
    if (m.history.length > HISTORY_MAX) m.history.shift();

    if (coin._activeVolatility && now - (m.revivedAt || 0) > 3 * 60 * 60 * 1000) {
      coin._activeVolatility = Math.max(coin._activeVolatility * 0.99, coin.volatility);
    }
  }
}

function formatPrice(p) {
  if (p >= 1)        return `$${p.toFixed(4).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  if (p >= 0.001)    return `$${p.toFixed(6)}`;
  if (p >= 0.000001) return `$${p.toFixed(8)}`;
  return `$${p.toFixed(10)}`;
}

function priceChange(history, openPrice) {
  if (!history || history.length < 1) return 0;
  const curr = history[history.length - 1];
  const ref  = openPrice || (history.length >= 2 ? history[0] : null);
  if (!ref || ref <= 0) return 0;
  return ((curr - ref) / ref) * 100;
}

function changeEmoji(pct) {
  if (pct > 30) return '🚀'; if (pct > 10) return '📈'; if (pct > 1) return '↗️';
  if (pct < -20) return '💀'; if (pct < -8) return '📉'; if (pct < -1) return '↘️';
  return '➡️';
}

function formatTimeSince(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
class CryptoCommand {
  constructor(db) {
    this.db = db;
    initMarket(db);
    this._interval = setInterval(() => { priceTick(); saveMarketToDB(); }, TICK_MS);
  }

  getWallet(player) {
    if (!player.crypto) player.crypto = {};
    return player.crypto;
  }

  getHistory(player) {
    if (!player.cryptoHistory) player.cryptoHistory = [];
    return player.cryptoHistory;
  }

  logTx(player, entry) {
    const hist = this.getHistory(player);
    hist.unshift({ ...entry, at: Date.now() });
    if (hist.length > TX_HISTORY_MAX) hist.length = TX_HISTORY_MAX;
    player.cryptoHistory = hist;
  }

  totalCryptoValue(player) {
    const wallet = this.getWallet(player);
    let total = 0;
    for (const [sym, pos] of Object.entries(wallet)) {
      if (!pos?.amount) continue;
      total += pos.amount * (market[sym]?.price || 0);
    }
    return total;
  }

  applyFee(amount) {
    const fee = amount * FEE_RATE;
    return { net: amount - fee, fee };
  }

  // ── Main router ─────────────────────────────────────────────────────────
  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender);
    priceTick();
    const player = this.db.getPlayer(sender);
    const sub    = (args[0] || '').toLowerCase();

    if (!sub || sub === 'm' || sub === 'market' || sub === 'refresh') return this.showMarket(args, player, sender, chatJid, sock, message);
    if (sub === 'pg' || sub === 'page')      return this.showMarket(args, player, sender, chatJid, sock, message);
    if (sub === 'b' || sub === 'buy')        return this.buy(args, player, sender, chatJid, sock, message);
    if (sub === 's' || sub === 'sell')       return this.sell(args, player, sender, chatJid, sock, message);
    if (sub === 'w' || sub === 'wallet')     return this.showWallet(player, sender, chatJid, sock, message);
    if (sub === 'cv' || sub === 'convert')   return this.convert(args, player, sender, chatJid, sock, message);
    if (sub === 'i' || sub === 'info')       return this.coinInfo(args[1], player, chatJid, sock, message);
    if (sub === 'send' || sub === 'transfer')return this.sendCrypto(args, player, sender, chatJid, sock, message);
    if (sub === 'hist' || sub === 'history') return this.showHistory(args, player, chatJid, sock, message);

    await sock.sendMessage(chatJid, { text: this.menuText() }, { quoted: message });
  }

  menuText() {
    return [
      `╔═══════════════════════╗`,
      `║  💹 SE CRYPTO GUIDE`,
      `╚═══════════════════════╝`,
      `📊 Market: OPEN 24/7`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `SHORT  =>  FULL COMMAND`,
      `.c m       =>  market page 1`,
      `.c pg 2    =>  page 2 of coins`,
      `.c b COIN $amt   => buy instantly`,
      `.c s COIN [amt|all] => sell instantly`,
      `.c w       =>  wallet`,
      `.c i COIN  =>  coin info`,
      `.c hist    =>  transaction history`,
      `.c cv in [$]   bank → wallet`,
      `.c cv out [$]  wallet → bank`,
      `.c send @player $amt  =>  transfer`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `3% fee on all transactions`,
      `🟢 Safe coins never rug`,
      `⚠️  Other coins can rug — trade smart`,
    ].join('\n');
  }

  // ── Market display (paginated) ───────────────────────────────────────────
  async showMarket(args, player, sender, chatJid, sock, message) {
    priceTick();
    const wallet   = this.getWallet(player);
    const totalVal = this.totalCryptoValue(player);
    const now      = Date.now();

    const pageArg   = parseInt(args[1]) || 1;
    const allSyms   = Object.keys(COINS);
    const PAGE_SIZE = 6;
    const totalPages = Math.ceil(allSyms.length / PAGE_SIZE);
    const page      = Math.max(1, Math.min(pageArg, totalPages));
    const startIdx  = (page - 1) * PAGE_SIZE;
    const pageSyms  = allSyms.slice(startIdx, startIdx + PAGE_SIZE);

    let text = `╔═════════════════╗\n║  💹 CRYPTO MARKET  (Pg ${page}/${totalPages})\n╚═════════════════╝\n\n`;
    text += `📊 OPEN 24/7\n`;
    text += `💼 Holdings: $${totalVal.toLocaleString('en', {maximumFractionDigits: 2})}  🏦 Wallet: $${(player.cryptoBalance || 0).toLocaleString('en', {maximumFractionDigits: 2})}\n\n`;

    for (const sym of pageSyms) {
      const coin = COINS[sym];
      const m    = market[sym];
      if (m.rugged) {
        const since     = formatTimeSince(now - (m.rugAt || now));
        const canRevive = (now - (m.rugAt || 0)) >= RUG_RECOVERY_MS;
        text += `${coin.emoji} *${sym}* ☠️ RUGGED (${since} ago)${canRevive ? ' 👀' : ''}\n\n`;
        continue;
      }
      const pct     = priceChange(m.history, m.openPrice);
      const owned   = wallet[sym]?.amount || 0;
      const safeTag = coin.noRug ? ' 🟢' : '';
      const revTag  = m.revived && (now - (m.revivedAt || 0)) < 6 * 3600000 ? ' 🔄' : '';
      text += `${coin.emoji} *${sym}*${safeTag}${revTag}  ${changeEmoji(pct)} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%\n`;
      text += `   ${formatPrice(m.price)}\n`;
      if (owned > 0) text += `   💼 ${owned.toLocaleString('en', {maximumFractionDigits: 2})} tokens\n`;
      text += '\n';
    }

    text += `━━━━━━━━━━━━━━━━━━\n`;
    if (totalPages > 1) {
      const others = Array.from({length: totalPages}, (_, i) => i + 1).filter(p => p !== page).map(p => `.c pg ${p}`).join(' | ');
      text += `📄 ${others}\n`;
    }
    text += `.c b COIN $amt | .c s COIN all`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── Resolve coin symbol from raw arg ──────────────────────────────────────
  _resolveCoin(rawSym) {
    const sym = Object.keys(COINS).find(k => k.toLowerCase() === (rawSym || '').toLowerCase()) || (rawSym || '').toUpperCase();
    return { sym, coin: COINS[sym] };
  }

  // ── Buy — prompts confirmation ────────────────────────────────────────────
  // ── Buy — direct, no confirmation ─────────────────────────────────────────
  async buy(args, player, sender, chatJid, sock, message) {
    const { sym, coin } = this._resolveCoin(args[1]);
    if (!coin) {
      const list = Object.entries(COINS).map(([s, c]) => `${c.emoji} *${s}*`).join('\n');
      await sock.sendMessage(chatJid, { text: `\`\`\`Unknown coin: ${args[1] || '?'}\`\`\`\n${list}` }, { quoted: message }); return;
    }
    const m = market[sym];
    if (m.rugged) {
      await sock.sendMessage(chatJid, { text: `☠️ *${sym}* got RUGGED — nobody's buying that 💀` }, { quoted: message }); return;
    }

    const cryptoBal = player.cryptoBalance || 0;
    const dollarAmt = args[2] === 'all' ? cryptoBal : parseFloat(args[2]);
    if (isNaN(dollarAmt) || dollarAmt <= 0) {
      await sock.sendMessage(chatJid, { text: `\`\`\`Usage: .c b ${sym} [amount|all]\`\`\`` }, { quoted: message }); return;
    }
    if (dollarAmt > cryptoBal) {
      await sock.sendMessage(chatJid, { text: `\`\`\`Not enough wallet balance\n💼 $${cryptoBal.toFixed(2)}\nFund: .c cv in [amount]\`\`\`` }, { quoted: message }); return;
    }

    const { net: netSpend, fee } = this.applyFee(dollarAmt);
    const tokensReceived = netSpend / m.price;
    const wallet = this.getWallet(player);
    if (!wallet[sym]) wallet[sym] = { amount: 0, avgBuy: 0 };
    const ex = wallet[sym];
    const totalSpent = (ex.avgBuy * ex.amount) + netSpend;
    ex.amount += tokensReceived;
    ex.avgBuy  = totalSpent / ex.amount;
    player.cryptoBalance = cryptoBal - dollarAmt;
    player.crypto = wallet;

    this.logTx(player, {
      type: 'buy', sym, amount: dollarAmt, tokens: tokensReceived, fee, price: m.price,
    });

    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: [
        `✅ *BUY SUCCESSFUL*`,
        `━━━━━━━━━━━━━━━━━━`,
        `${coin.emoji} *${sym}* — ${coin.name}`,
        `💰 Spent:    $${dollarAmt.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `🏦 Fee (3%): -$${fee.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `🪙 Tokens:   ${tokensReceived.toLocaleString('en', {maximumFractionDigits: 4})}`,
        `📊 Price:    ${formatPrice(m.price)}`,
        `💼 Wallet:   $${player.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `${coin.noRug ? '🟢 Safe coin — no rug risk' : '⚠️ Rug risk present'}`,
      ].join('\n')
    }, { quoted: message });
  }

  // ── Sell — direct, no confirmation ────────────────────────────────────────
  async sell(args, player, sender, chatJid, sock, message) {
    const { sym, coin } = this._resolveCoin(args[1]);
    if (!coin) {
      await sock.sendMessage(chatJid, { text: `\`\`\`Unknown coin: ${args[1] || '?'}\`\`\`` }, { quoted: message }); return;
    }
    const wallet = this.getWallet(player);
    const pos    = wallet[sym];
    if (!pos?.amount || pos.amount <= 0) {
      await sock.sendMessage(chatJid, { text: `\`\`\`You don't hold any ${sym}!\`\`\`` }, { quoted: message }); return;
    }

    let tokensToSell = args[2] === 'all' ? pos.amount : parseFloat(args[2]);
    if (isNaN(tokensToSell) || tokensToSell <= 0) {
      await sock.sendMessage(chatJid, { text: `\`\`\`Usage: .c s ${sym} [amount|all]\`\`\`` }, { quoted: message }); return;
    }
    if (tokensToSell > pos.amount) tokensToSell = pos.amount;

    const m         = market[sym];
    const grossSell = tokensToSell * m.price;
    const { net: sellValue, fee } = this.applyFee(grossSell);
    const buyValue  = tokensToSell * (pos.avgBuy || 0);
    const pnl       = sellValue - buyValue;
    const pnlPct    = buyValue > 0 ? ((sellValue / buyValue) - 1) * 100 : 0;
    const sign      = pnl >= 0 ? '+' : '';

    pos.amount -= tokensToSell;
    if (pos.amount < 0.000001) delete wallet[sym];
    player.crypto = wallet;
    player.cryptoBalance = (player.cryptoBalance || 0) + sellValue;

    this.logTx(player, {
      type: 'sell', sym, amount: sellValue, tokens: tokensToSell, fee, price: m.price, pnl, pnlPct,
    });

    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: [
        `${pnl >= 0 ? '💰' : '📉'} *SELL SUCCESSFUL*`,
        `━━━━━━━━━━━━━━━━━━`,
        `${coin.emoji} *${sym}* sold`,
        `🪙 Tokens:   ${tokensToSell.toLocaleString('en', {maximumFractionDigits: 4})}`,
        `💵 Gross:    $${grossSell.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `🏦 Fee (3%): -$${fee.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `💵 Net:      $${sellValue.toLocaleString('en', {maximumFractionDigits: 2})}`,
        `📊 P&L:      ${sign}$${pnl.toLocaleString('en', {maximumFractionDigits: 2})} (${sign}${pnlPct.toFixed(1)}%)`,
        `💼 Wallet:   $${player.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}`,
      ].join('\n')
    }, { quoted: message });
  }

  // ── Wallet ──────────────────────────────────────────────────────────────────
  async showWallet(player, sender, chatJid, sock, message) {
    const wallet        = this.getWallet(player);
    const cryptoBal     = player.cryptoBalance || 0;
    const totalHoldings = this.totalCryptoValue(player);

    let text = `╔═══════════════════════╗\n║   💼 CRYPTO WALLET\n╚═══════════════════════╝\n\n`;
    text += `💵 Free Cash:  $${cryptoBal.toLocaleString('en', {maximumFractionDigits: 2})}\n`;
    text += `📊 Holdings:   $${totalHoldings.toLocaleString('en', {maximumFractionDigits: 2})}\n`;
    text += `💎 Net Worth:  $${(cryptoBal + totalHoldings).toLocaleString('en', {maximumFractionDigits: 2})}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const positions = Object.entries(wallet).filter(([, p]) => p?.amount > 0);
    if (!positions.length) {
      text += `📭 No positions yet.\nTry *.c m* to browse the market.\n`;
    } else {
      text += `*YOUR POSITIONS*\n\n`;
      for (const [sym, pos] of positions) {
        const coin = COINS[sym]; const m = market[sym];
        if (!coin || !m) continue;
        const currVal = pos.amount * m.price;
        const pnl     = currVal - pos.amount * (pos.avgBuy || 0);
        const pnlPct  = pos.avgBuy > 0 ? ((currVal / (pos.amount * pos.avgBuy)) - 1) * 100 : 0;
        const sign    = pnl >= 0 ? '+' : '';
        const bar     = pnl >= 0 ? '🟩' : '🟥';
        text += `${coin.emoji} *${sym}*${m.rugged ? ' ☠️' : ''}\n`;
        text += `   ${pos.amount.toLocaleString('en', {maximumFractionDigits: 2})} tokens — $${currVal.toLocaleString('en', {maximumFractionDigits: 2})}\n`;
        text += `   ${bar} ${sign}${pnlPct.toFixed(1)}% (${sign}$${Math.abs(pnl).toLocaleString('en', {maximumFractionDigits: 2})})\n\n`;
      }
    }
    text += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `.c hist          → transaction history\n`;
    text += `.c cv out [amt]  → withdraw to bank\n`;
    text += `.c send @p [amt] → transfer to player`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── Transaction history ──────────────────────────────────────────────────
  async showHistory(args, player, chatJid, sock, message) {
    const hist = this.getHistory(player);
    if (!hist.length) {
      await sock.sendMessage(chatJid, { text: '```No crypto transactions yet.```' }, { quoted: message }); return;
    }

    const PAGE_SIZE = 8;
    const pageArg   = parseInt(args[1]) || 1;
    const totalPages = Math.ceil(hist.length / PAGE_SIZE);
    const page      = Math.max(1, Math.min(pageArg, totalPages));
    const slice     = hist.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    let text = `╔═══════════════════════╗\n║  📜 TX HISTORY  (Pg ${page}/${totalPages})\n╚═══════════════════════╝\n\n`;

    for (const tx of slice) {
      const coin = COINS[tx.sym];
      const emoji = coin?.emoji || '🪙';
      const when  = formatTimeAgo(tx.at);

      if (tx.type === 'buy') {
        text += `🛒 *BUY* ${emoji} ${tx.sym} — ${when}\n`;
        text += `   $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})} → ${tx.tokens.toLocaleString('en', {maximumFractionDigits: 4})} tokens\n\n`;
      } else if (tx.type === 'sell') {
        const sign = tx.pnl >= 0 ? '+' : '';
        text += `📤 *SELL* ${emoji} ${tx.sym} — ${when}\n`;
        text += `   ${tx.tokens.toLocaleString('en', {maximumFractionDigits: 4})} tokens → $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})}\n`;
        text += `   P&L: ${sign}$${Math.abs(tx.pnl).toLocaleString('en', {maximumFractionDigits: 2})} (${sign}${tx.pnlPct.toFixed(1)}%)\n\n`;
      } else if (tx.type === 'transfer_out') {
        text += `📨 *SENT* — ${when}\n   $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})} to ${tx.to}\n\n`;
      } else if (tx.type === 'transfer_in') {
        text += `📥 *RECEIVED* — ${when}\n   $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})} from ${tx.from}\n\n`;
      } else if (tx.type === 'convert_in') {
        text += `🏦➡️💼 *DEPOSIT* — ${when}\n   $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})}\n\n`;
      } else if (tx.type === 'convert_out') {
        text += `💼➡️🏦 *WITHDRAW* — ${when}\n   $${tx.amount.toLocaleString('en', {maximumFractionDigits: 2})}\n\n`;
      }
    }

    text += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    if (totalPages > 1) {
      const others = Array.from({length: totalPages}, (_, i) => i + 1).filter(p => p !== page).map(p => `.c hist ${p}`).join(' | ');
      text += `📄 ${others}`;
    }
    await sock.sendMessage(chatJid, { text: text.trim() }, { quoted: message });
  }

  // ── Convert (bank ↔ wallet) ───────────────────────────────────────────────
  async convert(args, player, sender, chatJid, sock, message) {
    const dir    = args[1]?.toLowerCase();
    const isAll  = args[2] === 'all';
    const rawAmt = isAll ? null : parseFloat(args[2]);

    if (dir !== 'in' && dir !== 'out') {
      await sock.sendMessage(chatJid, { text: '```Usage:\n.c cv in [amt|all]  — Bank=>Wallet\n.c cv out [amt|all] — Wallet=>Bank```' }, { quoted: message }); return;
    }

    if (dir === 'in') {
      const amt = isAll ? (player.bank || 0) : rawAmt;
      if (!amt || isNaN(amt) || amt <= 0) { await sock.sendMessage(chatJid, { text: 'Invalid amount' }, { quoted: message }); return; }
      if (amt > (player.bank || 0)) { await sock.sendMessage(chatJid, { text: `Not enough money in bank\n🏦 $${player.bank.toLocaleString()}` }, { quoted: message }); return; }
      const { net, fee } = this.applyFee(amt);
      player.bank -= amt;
      player.cryptoBalance = (player.cryptoBalance || 0) + net;
      this.logTx(player, { type: 'convert_in', amount: net, fee });
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, { text: `💹 *Bank => Wallet*\n\n💸 $${amt.toLocaleString()}\n🏦 Fee (3%): -$${fee.toLocaleString('en', {maximumFractionDigits: 2})}\n💼 Wallet: $${player.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}` }, { quoted: message });

    } else {
      const cryptoBal = player.cryptoBalance || 0;
      const amt       = isAll ? cryptoBal : rawAmt;
      if (!amt || isNaN(amt) || amt <= 0) { await sock.sendMessage(chatJid, { text: 'Invalid amount' }, { quoted: message }); return; }
      if (amt > cryptoBal) { await sock.sendMessage(chatJid, { text: `Not enough wallet balance\n💼 $${cryptoBal.toFixed(2)}` }, { quoted: message }); return; }
      const { net, fee } = this.applyFee(amt);
      player.cryptoBalance = cryptoBal - amt;
      player.bank = (player.bank || 0) + net;
      BankingCommand.recordExternal(this.db, sender, {
        type: 'Transfer Received', amount: Math.floor(net),
        sender: 'SE Crypto Exchange', receiver: player.nickname || player.name,
        note: `Crypto -> Bank (3% fee: $${fee.toFixed(2)})`, balance: player.bank,
      });
      this.logTx(player, { type: 'convert_out', amount: net, fee });
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, { text: `🏦 *Wallet => Bank*\n\n💸 $${amt.toLocaleString('en', {maximumFractionDigits: 2})}\n🏦 Fee (3%): -$${fee.toLocaleString('en', {maximumFractionDigits: 2})}\n🏦 Bank: $${player.bank.toLocaleString()}\n💼 Wallet: $${player.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}` }, { quoted: message });
    }
  }

  // ── Send / transfer between players ─────────────────────────────────────
  async sendCrypto(args, player, sender, chatJid, sock, message) {
    const _rawCryptoTarget = resolveMention(message, args, 1);
    const targetId = normJid(_rawCryptoTarget);
    if (!targetId) {
      await sock.sendMessage(chatJid, { text: '```Usage: .c send @player [$amount]\nTransfers from your crypto wallet.```' }, { quoted: message }); return;
    }
    if (targetId === sender) { await sock.sendMessage(chatJid, { text: '❌ Cannot send to yourself!' }, { quoted: message }); return; }

    const amt = parseFloat(args[2]) || parseFloat(args[1]);
    if (isNaN(amt) || amt <= 0) { await sock.sendMessage(chatJid, { text: '```Specify amount: .c send @player [amount]```' }, { quoted: message }); return; }

    const cryptoBal = player.cryptoBalance || 0;
    if (amt > cryptoBal) { await sock.sendMessage(chatJid, { text: `\`\`\`Not enough wallet balance!\n💼 $${cryptoBal.toFixed(2)}\`\`\`` }, { quoted: message }); return; }

    const { net: received, fee } = this.applyFee(amt);

    player.cryptoBalance = cryptoBal - amt;
    const targetName = this.db.getDisplayName(targetId);
    this.logTx(player, { type: 'transfer_out', amount: amt, fee, to: targetName });
    this.db.updatePlayer(sender, player);

    const target = this.db.getPlayer(targetId);
    target.cryptoBalance = (target.cryptoBalance || 0) + received;
    const senderName = this.db.getDisplayName(sender);
    this.logTx(target, { type: 'transfer_in', amount: received, from: senderName });
    this.db.updatePlayer(targetId, target);

    await sock.sendMessage(chatJid, {
      text: `💹 *Crypto Transfer Sent!*\n\n📤 To: ${targetName}\n💸 Sent: $${amt.toLocaleString('en', {maximumFractionDigits: 2})}\n🏦 Fee (3%): -$${fee.toLocaleString('en', {maximumFractionDigits: 2})}\n✅ Received: $${received.toLocaleString('en', {maximumFractionDigits: 2})}\n\n💼 Your Wallet: $${player.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}`
    }, { quoted: message });

    try {
      await sock.sendMessage(targetId, {
        text: `💹 *Crypto Received!*\n\n📥 From: ${senderName}\n💸 Amount: $${received.toLocaleString('en', {maximumFractionDigits: 2})} (after fee)\n\n💼 Your Wallet: $${target.cryptoBalance.toLocaleString('en', {maximumFractionDigits: 2})}`
      });
    } catch (e) {}
  }

  // ── Coin info ─────────────────────────────────────────────────────────────
  async coinInfo(symArg, player, chatJid, sock, message) {
    const { sym, coin } = this._resolveCoin(symArg);
    if (!coin) {
      const list = Object.entries(COINS).map(([s, c]) => `${c.emoji} *${s}*`).join('\n');
      await sock.sendMessage(chatJid, { text: `\`\`\`Unknown coin!\n\n${list}\`\`\`` }, { quoted: message }); return;
    }
    const m    = market[sym];
    const now  = Date.now();
    const pct  = priceChange(m.history, m.openPrice);
    const sign = pct >= 0 ? '+' : '';
    const wallet = this.getWallet(player);
    const pos    = wallet[sym];

    const rugLabel = coin.noRug ? '🟢 NEVER RUG' :
      (coin.rugChance < 0.0008 ? '🟡 Low' : coin.rugChance < 0.0020 ? '🟠 High' : '🔴 Very High');

    let statusBlock = '';
    if (m.rugged) {
      const since  = formatTimeSince(now - (m.rugAt || now));
      const canRev = (now - (m.rugAt || 0)) >= RUG_RECOVERY_MS;
      statusBlock = `\n☠️ *RUGGED* (${since} ago)\n${canRev ? '👀 Revival window open' : `⏳ Revival in ${formatTimeSince(RUG_RECOVERY_MS - (now - (m.rugAt || 0)))}`}`;
    } else if (m.revived) {
      statusBlock = `\n🔄 *REVIVED v${m.revivalCount}* (${formatTimeSince(now - (m.revivedAt || now))} ago)`;
    }

    await sock.sendMessage(chatJid, {
      text: [
        `${coin.emoji} *${coin.name}* (${sym})`,
        coin.desc,
        statusBlock,
        ``,
        `💰 Price:      ${formatPrice(m.price)}`,
        `📊 Change:     ${sign}${pct.toFixed(2)}%  ${changeEmoji(pct)}`,
        `⚠️ Rug Risk:   ${rugLabel}`,
        `💥 Volatility: ${((coin._activeVolatility || coin.volatility) * 100).toFixed(0)}%`,
        ``,
        `📈 Last 5 ticks:`,
        m.history.slice(-5).map(p => formatPrice(p)).join(' => '),
        ``,
        pos?.amount > 0
          ? `💼 Your position:\n   ${pos.amount.toLocaleString('en', {maximumFractionDigits: 2})} tokens @ ${formatPrice(pos.avgBuy || 0)}\n   Value: $${(pos.amount * m.price).toLocaleString('en', {maximumFractionDigits: 2})}`
          : 'No position.',
        ``,
        `.c b ${sym} [amount]`,
      ].filter(x => x !== undefined).join('\n')
    }, { quoted: message });
  }
}

CryptoCommand.market     = market;
CryptoCommand.COINS      = COINS;
CryptoCommand.initMarket = initMarket;

module.exports = CryptoCommand;
