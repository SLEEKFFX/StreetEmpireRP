const BankingCommand = require('./banking');

class BusinessCommand {
  constructor(db, setPending) {
    this.db = db;
    this.setPending = setPending; // injected from commandHandler
  }

  getBusinesses() {
    return {
      1:  { name: 'Street Food Stand',   price: 15000,   income: 6000,    production: '12hourly', emoji: '🌮', type: 'Legal', risk: 'None',   xpPerHour: 0.25 },
      2:  { name: 'Coffee Shop',         price: 30000,   income: 12000,   production: '12hourly', emoji: '☕', type: 'Legal', risk: 'None',   xpPerHour: 0.25 },
      3:  { name: 'Barbershop',          price: 37500,   income: 15000,   production: '12hourly', emoji: '💈', type: 'Legal', risk: 'None',   xpPerHour: 0.25 },
      4:  { name: 'Laundromat',          price: 45000,   income: 18000,   production: '12hourly', emoji: '🧺', type: 'Legal', risk: 'None',   xpPerHour: 0.25 },
      5:  { name: 'Convenience Store',   price: 60000,   income: 24000,   production: '12hourly', emoji: '🏪', type: 'Legal', risk: 'None',   xpPerHour: 0.5 },
      6:  { name: 'Car Wash',            price: 75000,   income: 30000,   production: '12hourly', emoji: '🚿', type: 'Legal', risk: 'None',   xpPerHour: 0.5 },
      7:  { name: 'Auto Repair Shop',    price: 97500,   income: 39000,   production: '12hourly', emoji: '🔧', type: 'Legal', risk: 'Low',    xpPerHour: 0.5 },
      8:  { name: 'Tattoo Parlour',      price: 112500,   income: 45000,   production: '12hourly', emoji: '🖊️', type: 'Legal', risk: 'None',   xpPerHour: 0.5 },
      9:  { name: 'Pawn Shop',           price: 135000,   income: 54000,   production: '12hourly', emoji: '🏷️', type: 'Legal', risk: 'Low',    xpPerHour: 0.75 },
      10: { name: 'Liquor Store',        price: 150000,  income: 60000,   production: '12hourly', emoji: '🍾', type: 'Legal', risk: 'Low',    xpPerHour: 0.75 },
      11: { name: 'Nightclub',           price: 750000,  income: 300000,  production: '12hourly', emoji: '🌃', type: 'Legal', risk: 'Low',    xpPerHour: 0.5 },
      12: { name: 'Car Dealership',      price: 600000,  income: 270000,  production: '12hourly', emoji: '🚗', type: 'Legal', risk: 'Low',    xpPerHour: 0.5 },
      13: { name: 'Real Estate Agency',  price: 900000,  income: 360000,  production: '12hourly', emoji: '🏢', type: 'Legal', risk: 'Low',    xpPerHour: 1 },
      14: { name: 'Restaurant & Bar',    price: 525000,  income: 240000,  production: '12hourly', emoji: '🍽️', type: 'Legal', risk: 'Low',    xpPerHour: 0.5 },
      15: { name: 'Casino',              price: 1500000, income: 600000,  production: '12hourly', emoji: '🎰', type: 'Legal', risk: 'Medium', xpPerHour: 1 },
      16: { name: 'Drug Lab',            price: 2250000, income: 900000,  production: '12hourly', emoji: '🧪', type: 'Illegal', risk: 'High',    xpPerHour: 1.5 },
      17: { name: 'Bunker',              price: 2250000, income: 900000,  production: '12hourly', emoji: '🏚️', type: 'Illegal', risk: 'High',    xpPerHour: 1.5 },
      18: { name: 'Weapons Trafficking', price: 3000000, income: 1200000, production: '12hourly', emoji: '🔫', type: 'Illegal', risk: 'Extreme', xpPerHour: 2.5 },
      19: { name: 'Money Laundering',    price: 3750000, income: 1500000, production: '12hourly', emoji: '💸', type: 'Illegal', risk: 'Extreme', xpPerHour: 2.5 },
      20: { name: 'Chop Shop',           price: 1200000,  income: 480000,  production: '12hourly', emoji: '🚙', type: 'Illegal', risk: 'High',    xpPerHour: 2 },
      21: { name: 'Streaming Studio',    price: 200000,   income: 80000,   production: '12hourly', emoji: '🎙️', type: 'Legal',   risk: 'None',   xpPerHour: 0.75 },
      22: { name: 'Boxing Gym',          price: 350000,   income: 140000,  production: '12hourly', emoji: '🥊', type: 'Legal',   risk: 'Low',    xpPerHour: 1 },
      23: { name: 'Crypto Exchange',     price: 800000,   income: 320000,  production: '12hourly', emoji: '💻', type: 'Legal',   risk: 'Medium', xpPerHour: 1 },
      24: { name: 'Black Market',        price: 4500000,  income: 1800000, production: '12hourly', emoji: '🕵️', type: 'Illegal', risk: 'Extreme', xpPerHour: 3 },
      25: { name: 'Oil Refinery',        price: 7500000,  income: 3000000, production: '12hourly', emoji: '🛢️', type: 'Legal',   risk: 'Low',    xpPerHour: 2 },
    };
  }

  calculateAccumulatedXP(business) {
    const now = new Date();
    const collectedAt = new Date(business.collectedAt);
    const hoursElapsed = Math.floor((now - collectedAt) / (1000 * 60 * 60));
    return hoursElapsed * business.xpPerHour;
  }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const subcommand = args[0];
    const businesses = this.getBusinesses();

    // FIX: handle .option 1 / .option 2 for pending bank purchase
    if (subcommand === 'option' || args[0] === 'option') {
      // This is handled by commandHandler as a separate command — skip
    }

    if (!subcommand || subcommand === 'list') {
      let text = `╔════════════════╗\n║  💼* BUSINESS HUB*\n║  Total: ${Object.keys(businesses).length} businesses\n╚════════════════╝\n\n`;
      text += `*🟡 STARTER ($10k–$100k)*:\n\n`;
      for (let i = 1; i <= 10; i++) {
        const b = businesses[i];
        text += `${i}. ${b.emoji} ${b.name} — $${(b.price/1000).toFixed(0)}k | $${(b.income/1000).toFixed(0)}k/6h | XP:${b.xpPerHour}/h\n`;
      }
      text += `\n*🟢 MID-LEGAL ($350k–$1M)*:\n\n`;
      for (let i = 11; i <= 15; i++) {
        const b = businesses[i];
        text += `${i}. ${b.emoji} ${b.name} — $${(b.price/1000).toFixed(0)}k | $${(b.income/1000).toFixed(0)}k/6h\n`;
      }
      text += `\n*🔴 ILLEGAL (HIGH RISK)*:\n\n`;
      for (let i = 16; i <= 20; i++) {
        const b = businesses[i];
        text += `${i}. ${b.emoji} ${b.name} — $${(b.price/1000000).toFixed(1)}M | $${(b.income/1000).toFixed(0)}k/6h\n`;
      }
      text += `\n*🟣 EMPIRE TIER (TOP EARNERS)*:\n\n`;
      for (let i = 21; i <= 25; i++) {
        const b = businesses[i];
        const priceStr = b.price >= 1000000 ? `$${(b.price/1000000).toFixed(1)}M` : `$${(b.price/1000).toFixed(0)}k`;
        text += `${i}. ${b.emoji} ${b.name} — ${priceStr} | $${(b.income/1000).toFixed(0)}k/6h | Risk:${b.risk}\n`;
      }
      text += `\n━━━━━━━━━━━━━━━━━\n`;
      text += `COMMANDS:\n.business buy [num]\n.business own\n.business collect\n.business upgrade [num]\n.business sell [num]`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    if (subcommand === 'info') {
      const b = businesses[args[1]];
      if (!b) { await sock.sendMessage(chatJid, { text: 'Invalid Business name' }, { quoted: message }); return; }
      let text = `╔════════════════╗\n║  💼 ${b.name.toUpperCase()}\n╚══════════════╝\n\n`;
      text += `${b.emoji} ${b.name}\n`;
      text += `💰 Price: $${b.price.toLocaleString()}\n`;
      text += `💵 Income: $${b.income.toLocaleString()}/6h\n`;
      text += `⭐ XP: +${b.xpPerHour}/hr\n`;
      text += `📊 Type: ${b.type} | Risk: ${b.risk}\n\n`;
      text += `Reply: .business buy ${args[1]}`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    if (subcommand === 'buy') {
      const businessId = args[1];
      const business = businesses[businessId];
      if (!business) { await sock.sendMessage(chatJid, { text: '❌ Business not found' }, { quoted: message }); return; }

      if (player.businesses.some(b => b.name === business.name)) {
        await sock.sendMessage(chatJid, { text: '❌ You already own this business!' }, { quoted: message }); return;
      }
      // No cap on business ownership — players can own as many as they can afford

      const hasCash = player.cash >= business.price;
      const hasBank = player.bank >= business.price;

      if (!hasCash && !hasBank) {
        const neededCash = business.price - player.cash;
        const neededBank = business.price - player.bank;
        await sock.sendMessage(chatJid, {
          text: `❌ Not enough funds!\n💵 Cash short: $${neededCash.toLocaleString()}\n🏦 Bank short: $${neededBank.toLocaleString()}\n\nDeposit money to your bank first.`
        }, { quoted: message });
        return;
      }

      if (!hasCash && hasBank) {
        // Prompt player to confirm bank purchase — handled globally in commandHandler
        const token = this.setPending(sender, {
          type: 'business_buy',
          payload: { business, businessId }
        });
        await sock.sendMessage(chatJid, {
          text: `❌ Not enough cash!\n💵 Cash: $${player.cash.toLocaleString()} (need $${business.price.toLocaleString()})\n\n🏦 Buy from bank instead?\nType *.accept* to confirm or *.decline* to cancel`
        }, { quoted: message });
        return;
      }

      // Buy with cash
      this._doBuy(sender, player, business, businessId, 'cash', chatJid, sock, message);
      return;
    }

    if (subcommand === 'own') {
      if (player.businesses.length === 0) {
        await sock.sendMessage(chatJid, { text: '❌ No businesses yet!\nUse .business list' }, { quoted: message }); return;
      }

      let text = `╔════════════════════╗\n║  *💼 YOUR BUSINESSES (${player.businesses.length}/20)*\n╚══════════════════════╝\n\n`;
      let totalIncome = 0, totalXP = 0;
      player.businesses.forEach((b, i) => {
        totalIncome += b.income;
        totalXP += b.xpPerHour;
        const xp = this.calculateAccumulatedXP(b);
        const raid = b.raided ? ' *⚠️ RAIDED*' : '';
        text += `${i + 1}. ${b.emoji} ${b.name}${raid}\n   Lv.${b.level} | $${b.income.toLocaleString()}/6h | XP:${b.xpPerHour}/h\n   Pending XP: +${xp}\n\n`;
      });
      text += `━━━━━━━━━━━━━━━━━━━\n`;
      text += `*💰 Total/6h: $${totalIncome.toLocaleString()}*\n⭐ XP/h: ${totalXP}`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    if (subcommand === 'collect') {
      if (player.businesses.length === 0) {
        await sock.sendMessage(chatJid, { text: 'You have no business' }, { quoted: message }); return;
      }

      // FIX: enforce 6-hour cooldown on collection
      if (this.db.checkCooldown(sender, 'business_collect')) {
        const rem = this.db.getCooldownRemaining(sender, 'business_collect');
        const h = Math.floor(rem / 3600);
        const m = Math.ceil((rem % 3600) / 60);
        await sock.sendMessage(chatJid, { text: `⏰ Income on cooldown!\nNext income in: *${h}h ${m}m*` }, { quoted: message }); return;
      }

      let totalIncome = 0, totalXP = 0, raidedCount = 0;
      player.businesses.forEach(b => {
        const xp = this.calculateAccumulatedXP(b);
        totalXP += xp;
        if (b.type === 'Illegal' && Math.random() < 0.15) {
          b.raided = true;
          b.raidDate = new Date();
          totalIncome += Math.floor(b.income * 0.7);
          raidedCount++;
        } else {
          b.raided = false;
          totalIncome += b.income;
        }
        b.accumulatedXP = 0;
        b.collectedAt = new Date();
      });

      // FIX: 5% tax on business income
      const tax = Math.floor(totalIncome * 0.05);
      const netIncome = totalIncome - tax;

      // FIX: income goes to bank, not cash
      player.bank += netIncome;
      player.experience += totalXP;

      BankingCommand.recordExternal(this.db, sender, {
        type: 'Business Income', amount: netIncome,
        sender: player.businesses.map(b => b.name).join(', '),
        receiver: player.name,
        note: `Collected from ${player.businesses.length} business(es). Tax: $${tax.toLocaleString()}${raidedCount > 0 ? ` | ${raidedCount} raided` : ''}`,
        balance: player.bank,
      });

      // FIX: set 6-hour cooldown
      this.db.addCooldown(sender, 'business_collect', 12 * 60 * 60 * 1000);
      this.db.updatePlayer(sender, player);

      let text = `💰 *INCOME COLLECTED!*\n\nGross: $${totalIncome.toLocaleString()}\n5% Tax: -$${tax.toLocaleString()}\nNet (to Bank): +$${netIncome.toLocaleString()}\n⭐ XP: +${totalXP}`;
      if (raidedCount > 0) text += `\n\n*⚠️ POLICE RAID!* ${raidedCount} illegal biz raided! Lost *30%*`;
      text += `\n\n🏦 Bank: $${player.bank.toLocaleString()}\nNext collect in 12 hours!`;

      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    if (subcommand === 'upgrade') {
      const idx = parseInt(args[1]) - 1;
      if (idx < 0 || idx >= player.businesses.length) {
        await sock.sendMessage(chatJid, { text: '❌ Invalid business number' }, { quoted: message }); return;
      }
      const b = player.businesses[idx];
      const cost = Math.floor(b.price * 0.3 * (b.level + 1));
      if (b.level >= 10) { await sock.sendMessage(chatJid, { text: '❌ Max level (10)!' }, { quoted: message }); return; }

      if (player.cash < cost) {
        if (player.bank >= cost) {
          const token = this.setPending(sender, { type: 'business_upgrade', payload: { idx, cost } });
          await sock.sendMessage(chatJid, { text: `❌ Not enough cash!\n\n🏦 Upgrade from bank ($${cost.toLocaleString()})?\nType *.accept* to confirm or *.decline* to cancel` }, { quoted: message });
        } else {
          await sock.sendMessage(chatJid, { text: `❌ Not enough funds! Cost: $${cost.toLocaleString()}` }, { quoted: message });
        }
        return;
      }

      player.cash -= cost;
      b.level++;
      b.income = Math.floor(b.income * 1.2);
      b.xpPerHour = Math.min(b.xpPerHour + 1, 10);
      b.upgrades++;
      player.experience += 5; // nerfed
      this.db.updatePlayer(sender, player);

      await sock.sendMessage(chatJid, { text: `⬆️ *UPGRADED!*\n\n${b.emoji} ${b.name}\nCost: $${cost.toLocaleString()}\nLevel: ${b.level}/10\n💵 New Income: $${b.income.toLocaleString()}/6h\n⭐ XP Rate: ${b.xpPerHour}/hr` }, { quoted: message });
      return;
    }

    if (subcommand === 'sell') {
      const idx = parseInt(args[1]) - 1;
      if (idx < 0 || idx >= player.businesses.length) {
        await sock.sendMessage(chatJid, { text: '❌ Invalid business number' }, { quoted: message }); return;
      }
      const b = player.businesses[idx];
      const sale = Math.floor(b.price * 0.6);
      player.cash += sale;
      player.businesses.splice(idx, 1);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, { text: `✅ *SOLD!*\n\n${b.emoji} ${b.name}\n💰 Sale: $${sale.toLocaleString()}\n💵 Cash: $${player.cash.toLocaleString()}` }, { quoted: message });
      return;
    }
  }

  _doBuy(sender, player, business, businessId, source, chatJid, sock, message) {
    if (source === 'cash') player.cash -= business.price;
    else player.bank -= business.price;

    player.businesses.push({
      ...business, id: businessId,
      purchasedAt: new Date(), collectedAt: new Date(),
      upgrades: 0, level: 1, raided: false, raidDate: null, accumulatedXP: 0
    });
    player.experience += 5; // nerfed // nerfed
    this.db.updatePlayer(sender, player);

    const src = source === 'bank' ? '🏦 Bank' : '💵 Cash';
    const bal = source === 'bank' ? `🏦 Bank: $${player.bank.toLocaleString()}` : `💵 Cash: $${player.cash.toLocaleString()}`;
    sock.sendMessage(chatJid, {
      text: `🎉 *BUSINESS PURCHASED!*\n\n${business.emoji} ${business.name}\n💰 Price: $${business.price.toLocaleString()} (${src})\n💵 Income: $${business.income.toLocaleString()}/6h\n⭐ XP: +${business.xpPerHour}/hr\n\n${bal}\n\nCollect with: .business collect\n${business.type === 'Illegal' ? '⚠️ Beware police raids!' : ''}`
    }, message ? { quoted: message } : {});
  }
}

module.exports = BusinessCommand;
