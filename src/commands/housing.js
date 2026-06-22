// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — HOUSING  v1.0
//  Buy/rent houses, vault storage, garage, NPC security
// ═══════════════════════════════════════════════════════════════

const BankingCommand = require('./banking');

// ── House Definitions ─────────────────────────────────────────
const HOUSES = {
  studio: {
    name: 'Studio Apartment', emoji: '🏠', type: 'rent',
    rentFee: 150_000,           // per 6 hours
    buyPrice: null,
    cashCapacity: 5_000_000, // max cash in vault
    vaultSlots: 5, garageSlots: 1,
    desc: 'Tiny but yours',
  },
  apartment: {
    name: 'Luxury Apartment', emoji: '🏢', type: 'rent',
    rentFee: 750_000,
    buyPrice: null,
    cashCapacity: 10_000_000, // max cash in vault
    vaultSlots: 10, garageSlots: 2,
    desc: 'Downtown high-rise',
  },
  duplex: {
    name: 'Duplex', emoji: '🏘️', type: 'both',
    rentFee: 1_000_000,
    buyPrice: 5_250_000,
    cashCapacity: 15_000_000, // max cash in vault
    vaultSlots: 15, garageSlots: 3,
    desc: 'Double unit, solid security',
  },
  bungalow: {
    name: 'Bungalow', emoji: '🏡', type: 'both',
    rentFee: 2_000_000,
    buyPrice: 20_000_000,
    cashCapacity: 20_000_000, // max cash in vault
    vaultSlots: 20, garageSlots: 4,
    desc: 'Quiet suburb retreat',
  },
  midcenturyhouse: {
    name: 'Midcentury', emoji: '🏙️', type: 'both',
    rentFee: 3_500_000,
    buyPrice: 50_000_000,
    cashCapacity: 25_000_000, // max cash in vault
    vaultSlots: 25, garageSlots: 5,
    desc: 'Three-floor prestige',
  },
  villa: {
    name: 'Villa', emoji: '🌴', type: 'both',
    rentFee: 5_000_000,
    buyPrice: 100_000_000,
    cashCapacity: 35_000_000, // max cash in vault
    vaultSlots: 35, garageSlots: 8,
    desc: 'Gated compound with pool',
  },
  mansion: {
    name: 'Mansion', emoji: '🏰', type: 'both',
    rentFee: 8_250_000,
    buyPrice: 250_000_000,
    cashCapacity: 50_000_000, // max cash in vault
    vaultSlots: 50, garageSlots: 12,
    desc: 'Full estate, legend territory',
  },
  futuristicmodernmansion: {
    name: 'Futuristic Modern Mansion', emoji: '🌆', type: 'both',
    rentFee: 15_500_000,
    buyPrice: 500_000_000,
    cashCapacity: 600_000_000, // max cash in vault
    vaultSlots: 60, garageSlots: 6,
    desc: 'Sky-top luxury. Top 1%.',
  },
};

// ── NPC Security Agents ────────────────────────────────────────
const SECURITY = {
  watchman: {
    name: 'Watchman', emoji: '👮', level: 1,
    pricePerHour: 50_000, defenseBonus: 5,
    desc: 'Basic patrol',
  },
  guard: {
    name: 'Armed Guard', emoji: '💂', level: 2,
    pricePerHour: 150_000, defenseBonus: 15,
    desc: 'Armed, fast response',
  },
  specialist: {
    name: 'Security Specialist', emoji: '🕵️', level: 3,
    pricePerHour: 400_000, defenseBonus: 30,
    desc: 'Ex-military, full sweep',
  },
  elite: {
    name: 'Elite Unit', emoji: '🦅', level: 4,
    pricePerHour: 1_000_000, defenseBonus: 55,
    desc: 'Black ops crew',
  },
};

const RENT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SECURITY_PAY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SECURITY_GRACE_MS = 10 * 60 * 1000; // 10 min grace

// ── Vault item display names ──────────────────────────────────
const VAULT_ITEMS = {
  gold: { name: 'Gold', emoji: '🥇' },
  silver: { name: 'Silver', emoji: '🥈' },
  diamond: { name: 'Diamond', emoji: '💎' },
  ruby: { name: 'Ruby', emoji: '❤️‍🔥' },
  emerald: { name: 'Emerald', emoji: '💚' },
  platinum: { name: 'Platinum', emoji: '⚪' },
};

// ─────────────────────────────────────────────────────────────
class HousingCommand {
  constructor(db) {
    this.db = db;
    // Start rent & security deduction loop every 5 minutes (checks timestamps)
    this._interval = setInterval(() => this._processRecurringFees(), 5 * 60 * 1000);
  }

  // ── Recurring fee processor ───────────────────────────────
  async _processRecurringFees() {
    const now = Date.now();
    for (const [pid, player] of Object.entries(this.db.data.players)) {
      if (!player.house) continue;
      const house = player.house;

      // Rent deduction
      if (house.owned === false && house.nextRentDue && now >= house.nextRentDue) {
        const hdef = HOUSES[house.type];
        if (!hdef) continue;
        const fee = hdef.rentFee;
        const paid = this._deductFromAny(pid, player, fee);
        if (!paid) {
          // Can't afford rent — evict
          player.house = null;
          this.db.updatePlayer(pid, player);
          // Try notify (best-effort)
          continue;
        }
        house.nextRentDue = now + RENT_INTERVAL_MS;
        this.db.updatePlayer(pid, player);
      }

      // Security pay
      if (house.security) {
        const sec = house.security;
        if (sec.nextPayDue && now >= sec.nextPayDue) {
          const sdef = SECURITY[sec.type];
          if (!sdef) continue;
          const hourlyFee = sdef.pricePerHour;
          const paid = this._deductFromAny(pid, player, hourlyFee);
          if (!paid) {
            // Grace: mark unpaid time
            if (!sec.unpaidSince) {
              sec.unpaidSince = now;
            } else if (now - sec.unpaidSince >= SECURITY_GRACE_MS) {
              // Withdraw security
              house.security = null;
              house.securityActive = false;
              this.db.updatePlayer(pid, player);
            }
          } else {
            sec.unpaidSince = null;
            sec.nextPayDue = now + SECURITY_PAY_INTERVAL_MS;
            this.db.updatePlayer(pid, player);
          }
        }
      }
    }
  }

  // Deduct from cash → bank → crypto in that order
  _deductFromAny(pid, player, amount) {
    if ((player.cash || 0) >= amount) {
      player.cash -= amount;
      this.db.updatePlayer(pid, player);
      return true;
    }
    if ((player.bank || 0) >= amount) {
      player.bank -= amount;
      this.db.updatePlayer(pid, player);
      return true;
    }
    if ((player.cryptoBalance || 0) >= amount) {
      player.cryptoBalance -= amount;
      this.db.updatePlayer(pid, player);
      return true;
    }
    return false;
  }

  // ── Main execute ──────────────────────────────────────────
  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'list') return this._showList(player, chatJid, sock, message);
    if (sub === 'buy')    return this._buy(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'rent')   return this._rent(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'info')   return this._info(player, chatJid, sock, message);
    if (sub === 'sell')   return this._sell(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'leave')  return this._leave(sender, player, chatJid, sock, message);

    // ── Plain ".house [number]" — completes a pending action from the picker ──
    // After ".house sec hire elite" shows a picker, the user replies with
    // ".house 1" or ".house 2" to pick the property and the original action
    // is replayed automatically against that property.
    if (/^\d+$/.test(sub)) {
      return this._resumePendingAction(sub, sender, player, chatJid, sock, message);
    }

    // .house move [n] — move primary house pointer to property #n
    if (sub === 'move') {
      return this._moveHome(args.slice(1), sender, player, chatJid, sock, message);
    }

    // ── Multi-house property selection ──────────────────────────────────────
    // Syntax: .house vault [#n] <action ...>   or   .house sec [#n] <action ...>
    // If the user has multiple properties, they must specify which one with #1–#5
    // e.g. .house vault 2 store gold 3   →  vault of house #2
    //      .house sec 1 hire elite        →  security for house #1
    // If they only have one house, the number is optional. If ambiguous,
    // a picker is shown and the action is remembered for ".house [n]".
    if (sub === 'vault' || sub === 'garage' || sub === 'security' || sub === 'sec') {
      const subArgs    = args.slice(1);
      const houseIndex = this._resolveHouseIndex(player, subArgs);
      if (houseIndex === null) {
        // Ambiguous — remember the action and show a picker
        this._setPendingAction(sender, sub, subArgs);
        return this._showHousePicker(player, sub, chatJid, sock, message);
      }
      const { house, remaining } = houseIndex;
      if (sub === 'vault')                     return this._vault   (remaining, sender, player, house, chatJid, sock, message);
      if (sub === 'garage')                    return this._garage  (remaining, sender, player, house, chatJid, sock, message);
      if (sub === 'security' || sub === 'sec') return this._security(remaining, sender, player, house, chatJid, sock, message);
    }

    await sock.sendMessage(chatJid, {
      text: `❌ Unknown subcommand.\nUsage: .house list | buy | rent | info | vault | garage | security`
    }, { quoted: message });
  }

  // ── List houses ───────────────────────────────────────────
  async _showList(player, chatJid, sock, message) {
    let text = `╔═══════════════╗\n║ 🏠 SE REAL ESTATE MARKET\n╚═══════════════╝\n\n`;
    text += `Current Home: ${player.house ? (HOUSES[player.house.type]?.emoji + ' ' + HOUSES[player.house.type]?.name) : 'None'}\n\n`;
    text += `*── RENT ─────────────────*\n`;
    for (const [id, h] of Object.entries(HOUSES)) {
      if (h.type === 'buy') continue;
      text += `${h.emoji} *${h.name}*\n`;
      text += `   Rent: $${h.rentFee.toLocaleString()}/6h\n`;
      text += `   Vault: ${h.vaultSlots} slots | Garage: ${h.garageSlots} cars\n`;
      text += `   .house rent ${id}\n\n`;
    }
    text += `*── BUY ──────────────────*\n`;
    for (const [id, h] of Object.entries(HOUSES)) {
      if (!h.buyPrice) continue;
      text += `${h.emoji} *${h.name}*\n`;
      text += `   Price: $${h.buyPrice.toLocaleString()}\n`;
      text += `   Vault: ${h.vaultSlots} slots | Garage: ${h.garageSlots} cars\n`;
      text += `   .house buy ${id}\n\n`;
    }
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── Buy house (up to 5 properties) ──────────────────────
  async _buy(args, sender, player, chatJid, sock, message) {
    const hid = (args[0] || '').toLowerCase();
    const hdef = HOUSES[hid];
    if (!hdef || !hdef.buyPrice) {
      await sock.sendMessage(chatJid, { text: `❌ Invalid house type.\nSee: .house list` }, { quoted: message }); return;
    }
    // Migrate legacy single house to array
    if (player.house && !Array.isArray(player.houses)) {
      player.houses = [player.house];
    }
    if (!player.houses) player.houses = [];

    const MAX_HOUSES = 5;
    if (player.houses.length >= MAX_HOUSES) {
      await sock.sendMessage(chatJid, { text: `❌ You own ${player.houses.length} properties (max ${MAX_HOUSES}).\nSell one: *.house sell [1-${player.houses.length}]*` }, { quoted: message }); return;
    }
    if (player.houses.some(h => h.type === hid)) {
      await sock.sendMessage(chatJid, { text: `❌ You already own a ${hdef.name}!\nBuy a different type.` }, { quoted: message }); return;
    }
    // Can't buy while renting (only blocks if they have a rented non-owned house and no owned ones)
    if (player.house && !player.house.owned && player.houses.length === 0) {
      await sock.sendMessage(chatJid, { text: `❌ Move out of your rented place first: .house leave` }, { quoted: message }); return;
    }
    if ((player.bank || 0) < hdef.buyPrice) {
      await sock.sendMessage(chatJid, { text: `❌ Not enough in bank!\nNeed: $${hdef.buyPrice.toLocaleString()}\nBank: $${(player.bank||0).toLocaleString()}` }, { quoted: message }); return;
    }

    player.bank -= hdef.buyPrice;
    const newHouse = {
      type: hid, owned: true, purchasedAt: Date.now(),
      vault: {}, garageVehicles: [],
      security: null, securityActive: false,
    };
    player.houses.push(newHouse);
    player.house = player.houses[0]; // primary = first in array
    player.experience = (player.experience || 0) + 50;
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: `🏠 *PROPERTY PURCHASED!*\n\n${hdef.emoji} ${hdef.name}\n💰 Paid: $${hdef.buyPrice.toLocaleString()} (Bank)\n🔒 Vault: ${hdef.vaultSlots} slots\n🚗 Garage: ${hdef.garageSlots} cars\n⭐ +50 XP\n\n📋 Properties: ${player.houses.length}/${MAX_HOUSES}\n.house info — view your properties`
    }, { quoted: message });
  }

  // ── Rent house ────────────────────────────────────────────
  async _rent(args, sender, player, chatJid, sock, message) {
    const hid = (args[0] || '').toLowerCase();
    const hdef = HOUSES[hid];
    if (!hdef) {
      await sock.sendMessage(chatJid, { text: `❌ Invalid house type.\nSee: .house list` }, { quoted: message }); return;
    }
    if (player.house) {
      await sock.sendMessage(chatJid, { text: `❌ You already have a home!\nLeave first: .house leave` }, { quoted: message }); return;
    }
    const firstPay = hdef.rentFee;
    if ((player.bank || 0) < firstPay && (player.cash || 0) < firstPay) {
      await sock.sendMessage(chatJid, { text: `❌ Not enough funds!\nFirst rent: $${firstPay.toLocaleString()}` }, { quoted: message }); return;
    }
    this._deductFromAny(sender, player, firstPay);

    player.house = {
      type: hid, owned: false, rentedAt: Date.now(),
      nextRentDue: Date.now() + RENT_INTERVAL_MS,
      vault: {}, garageVehicles: [],
      security: null, securityActive: false,
    };
    player.experience = (player.experience || 0) + 20;
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: `🏠 *RENTING!*\n\n${hdef.emoji} ${hdef.name}\n💰 First payment: $${firstPay.toLocaleString()}\n⏰ Next due: every 6 hours\n🔒 Vault: ${hdef.vaultSlots} slots\n🚗 Garage: ${hdef.garageSlots} cars\n⭐ +20 XP\n\n.house info — view your property`
    }, { quoted: message });
  }

  // ── House info (shows all owned properties) ──────────────
  async _info(player, chatJid, sock, message) {
    // Migrate legacy
    if (player.house && !Array.isArray(player.houses)) player.houses = [player.house];
    const allHouses = player.houses || (player.house ? [player.house] : []);

    if (allHouses.length === 0) {
      await sock.sendMessage(chatJid, { text: `🏠 You don't have a home!\n.house list — browse properties` }, { quoted: message }); return;
    }

    let text = `╔════════════════╗\n║ 🏠 YOUR PROPERTIES (${allHouses.length}/5)\n╚════════════════╝\n\n`;

    allHouses.forEach((h, i) => {
      const hdef = HOUSES[h.type];
      if (!hdef) return;
      const vaultUsed  = Object.values(h.vault || {}).filter(v => v > 0).length;
      const garageUsed = (h.garageVehicles || []).length;
      const secDef     = h.security ? SECURITY[h.security.type] : null;
      const owned      = h.owned ? '✅ Owned' : '🔑 Rented';
      text += `*${i + 1}. ${hdef.emoji} ${hdef.name}* — ${owned}\n`;
      text += `   🔒 Vault: ${vaultUsed}/${hdef.vaultSlots}  🚗 Garage: ${garageUsed}/${hdef.garageSlots}\n`;
      text += `   🛡️ Security: ${secDef ? `${secDef.emoji} ${secDef.name}` : 'None'}\n`;
      if (!h.owned && h.nextRentDue) {
        text += `   💸 Next Rent: ${new Date(h.nextRentDue).toLocaleTimeString()}\n`;
      }
      text += `\n`;
    });

    text += `Commands:\n.house vault — manage vault\n.house garage — move cars\n.house security — hire guards\n.house sell [n] — sell property #n`;

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── Sell owned house ──────────────────────────────────────
  async _sell(args, sender, player, chatJid, sock, message) {
    // Migrate legacy
    if (player.house && !Array.isArray(player.houses)) player.houses = [player.house];
    if (!player.houses) player.houses = [];
    const ownedHouses = player.houses.filter(h => h.owned);
    if (ownedHouses.length === 0) {
      await sock.sendMessage(chatJid, { text: `❌ You don't own any property to sell.` }, { quoted: message }); return;
    }

    // If multiple properties, require index
    let targetHouse;
    if (player.houses.length === 1) {
      targetHouse = player.houses[0];
    } else {
      const idx = parseInt(args[0]);
      if (isNaN(idx) || idx < 1 || idx > player.houses.length) {
        let listText = `❌ Specify which property to sell (1-${player.houses.length}):\n`;
        player.houses.forEach((h, i) => {
          const hd = HOUSES[h.type];
          listText += `  ${i+1}. ${hd?.emoji} ${hd?.name} (${h.owned ? 'Owned' : 'Rented'})\n`;
        });
        listText += `\nExample: *.house sell 2*`;
        await sock.sendMessage(chatJid, { text: listText }, { quoted: message }); return;
      }
      targetHouse = player.houses[idx - 1];
      if (!targetHouse.owned) {
        await sock.sendMessage(chatJid, { text: `❌ Property #${idx} is rented, not owned. Use *.house leave* to move out.` }, { quoted: message }); return;
      }
    }

    const hdef = HOUSES[targetHouse.type];
    const sellPrice = Math.floor(hdef.buyPrice * 0.75); // 75% resale
    player.bank += sellPrice;
    player.houses = player.houses.filter(h => h !== targetHouse);
    player.house  = player.houses[0] || null;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, {
      text: `🏠 *PROPERTY SOLD!*\n\n${hdef.emoji} ${hdef.name}\n💰 Received: $${sellPrice.toLocaleString()} (75% value)\n🏦 Bank: $${player.bank.toLocaleString()}\n\n📋 Properties remaining: ${player.houses.length}/5`
    }, { quoted: message });
  }

  // ── Leave rented house ────────────────────────────────────
  async _leave(sender, player, chatJid, sock, message) {
    if (!player.house) {
      await sock.sendMessage(chatJid, { text: `❌ You don't have a rental.` }, { quoted: message }); return;
    }
    if (player.house.owned) {
      await sock.sendMessage(chatJid, { text: `❌ You OWN this property. Use .house sell` }, { quoted: message }); return;
    }
    const hdef = HOUSES[player.house.type];
    player.house = null;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, { text: `👋 You moved out of your ${hdef.name}.` }, { quoted: message });
  }

  // ── Vault management ──────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  //  Resolve which house to operate on from args
  //  Returns { house, remaining } or null (picker needed) or throws
  // ─────────────────────────────────────────────────────────────────────
  _resolveHouseIndex(player, args) {
    const houses = player.houses || (player.house ? [player.house] : []);
    if (houses.length === 0) return { house: null, remaining: args };
    if (houses.length === 1) return { house: houses[0], remaining: args };

    // Check if first arg is a number (1–5)
    const num = parseInt(args[0]);
    if (!isNaN(num) && num >= 1 && num <= houses.length) {
      return { house: houses[num - 1], remaining: args.slice(1) };
    }

    // Multiple houses but no number given — need picker
    return null;
  }

  async _showHousePicker(player, sub, chatJid, sock, message) {
    const houses = player.houses || [player.house];
    let text = `🏠 *Which property?*\n\nYou own ${houses.length} properties:\n\n`;
    houses.forEach((h, i) => {
      const hdef = HOUSES[h.type] || {};
      text += `  *${i+1}.* ${hdef.emoji || '🏠'} ${hdef.name} ${h.owned ? '✅' : '🔑'}\n`;
    });
    text += `\n👉 Reply *.house 1* or *.house 2* etc to continue.\n(Or: *.house ${sub} 2 ...* directly)`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Pending action storage — in-memory, keyed by sender JID
  //  Stores the sub-command + args that triggered the picker, so
  //  ".house [n]" can replay it against the chosen property.
  //  Expires after 2 minutes to avoid stale state.
  // ─────────────────────────────────────────────────────────────────────
  _setPendingAction(sender, sub, args) {
    if (!global._housePending) global._housePending = {};
    global._housePending[sender] = { sub, args, ts: Date.now() };
  }

  async _resumePendingAction(numStr, sender, player, chatJid, sock, message) {
    const pending = global._housePending?.[sender];
    const houses  = player.houses || (player.house ? [player.house] : []);

    if (!pending || (Date.now() - pending.ts) > 2 * 60 * 1000) {
      // No pending action — just show property list/info
      if (houses.length === 0) {
        await sock.sendMessage(chatJid, { text: `❌ You don't own any property.\n.house list` }, { quoted: message });
        return;
      }
      return this._info(player, chatJid, sock, message);
    }

    const idx = parseInt(numStr);
    if (isNaN(idx) || idx < 1 || idx > houses.length) {
      await sock.sendMessage(chatJid, { text: `❌ Invalid property number. You have ${houses.length} properties.` }, { quoted: message });
      return;
    }

    const house = houses[idx - 1];
    delete global._housePending[sender]; // consume it

    if (pending.sub === 'vault')                     return this._vault   (pending.args, sender, player, house, chatJid, sock, message);
    if (pending.sub === 'garage')                    return this._garage  (pending.args, sender, player, house, chatJid, sock, message);
    if (pending.sub === 'security' || pending.sub === 'sec') return this._security(pending.args, sender, player, house, chatJid, sock, message);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Vault — now accepts explicit house object as 4th arg
  // ─────────────────────────────────────────────────────────────────────
  async _vault(args, sender, player, house, chatJid, sock, message) {
    // house may be undefined if called from old path — fall back to player.house
    const activeHouse = house || player.house;
    if (!activeHouse) {
      await sock.sendMessage(chatJid, { text: `❌ You need a home first!\n.house list` }, { quoted: message }); return;
    }
    const hdef  = HOUSES[activeHouse.type];
    const vault = activeHouse.vault || (activeHouse.vault = {});
    const sub   = (args[0] || '').toLowerCase();

    if (!sub || sub === 'view') {
      const items     = Object.entries(vault).filter(([k, v]) => k !== '_cash' && v > 0);
      const cashVault = vault._cash || 0;
      const used      = items.length;
      const hLabel    = hdef ? hdef.name : activeHouse.type;
      let text = `🔒 *VAULT — ${hLabel}*\n`;
      text += `Slots: ${used}/${hdef?.vaultSlots || '?'}  💰 Cash: $${cashVault.toLocaleString()}/$${(hdef?.cashCapacity||0).toLocaleString()}\n\n`;
      if (items.length === 0 && cashVault === 0) text += `Empty vault.\n`;
      else items.forEach(([k, qty]) => {
        const vi = VAULT_ITEMS[k];
        text += `${vi?.emoji || '📦'} ${vi?.name || k}: ${qty}\n`;
      });
      text += `\nCommands:\n.house vault store [item] [qty]\n.house vault take [item] [qty]\n.house vault deposit [amount]\n.house vault withdraw [amount]`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    // ── Cash deposit ──────────────────────────────────────────────────
    if (sub === 'deposit') {
      const amount = parseInt(args[1]);
      if (!amount || amount < 1) {
        await sock.sendMessage(chatJid, { text: `Usage: *.house vault deposit [amount]*` }, { quoted: message }); return;
      }
      const cap       = hdef?.cashCapacity || 0;
      const current   = vault._cash || 0;
      const space     = cap - current;
      if (space <= 0) {
        await sock.sendMessage(chatJid, { text: `❌ Cash vault full!\n💰 ${current.toLocaleString()} / ${cap.toLocaleString()}` }, { quoted: message }); return;
      }
      const toDeposit = Math.min(amount, space);
      if ((player.cash || 0) < toDeposit) {
        await sock.sendMessage(chatJid, { text: `❌ Not enough cash!\n💵 You have: $${(player.cash||0).toLocaleString()}` }, { quoted: message }); return;
      }
      player.cash -= toDeposit;
      vault._cash  = current + toDeposit;
      activeHouse.vault = vault;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `🔒 Deposited *$${toDeposit.toLocaleString()}* into vault.\n💰 Vault cash: $${vault._cash.toLocaleString()}/$${cap.toLocaleString()}`
      }, { quoted: message });
      return;
    }

    // ── Cash withdraw ─────────────────────────────────────────────────
    if (sub === 'withdraw') {
      const amount  = parseInt(args[1]);
      const current = vault._cash || 0;
      if (!amount || amount < 1 || current < amount) {
        await sock.sendMessage(chatJid, { text: `❌ Not enough cash in vault.\n💰 Vault: $${current.toLocaleString()}` }, { quoted: message }); return;
      }
      vault._cash   = current - amount;
      player.cash   = (player.cash || 0) + amount;
      activeHouse.vault = vault;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `📤 Withdrew *$${amount.toLocaleString()}* from vault.\n💵 Cash: $${player.cash.toLocaleString()}`
      }, { quoted: message });
      return;
    }

    if (sub === 'store') {
      const item = (args[1] || '').toLowerCase();
      const qty  = parseInt(args[2]) || 1;
      if (!VAULT_ITEMS[item]) {
        await sock.sendMessage(chatJid, { text: `❌ Invalid item.\nItems: ${Object.keys(VAULT_ITEMS).join(', ')}` }, { quoted: message }); return;
      }
      const used = Object.keys(vault).filter(k => k !== '_cash' && vault[k] > 0).length;
      if (used >= (hdef?.vaultSlots || 0)) {
        await sock.sendMessage(chatJid, { text: `❌ Vault full! (${hdef?.vaultSlots} slots)` }, { quoted: message }); return;
      }
      const invQty = player.inventory?.[item] || 0;
      if (invQty < qty) {
        await sock.sendMessage(chatJid, { text: `❌ You only have ${invQty}x ${item} in inventory.` }, { quoted: message }); return;
      }
      player.inventory[item] = invQty - qty;
      vault[item] = (vault[item] || 0) + qty;
      activeHouse.vault = vault;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      const vi = VAULT_ITEMS[item];
      await sock.sendMessage(chatJid, { text: `🔒 Stored ${qty}x ${vi.emoji} ${vi.name} in vault.` }, { quoted: message });
      return;
    }

    if (sub === 'take') {
      const item = (args[1] || '').toLowerCase();
      const qty  = parseInt(args[2]) || 1;
      if (!VAULT_ITEMS[item] || !vault[item] || vault[item] < qty) {
        await sock.sendMessage(chatJid, { text: `❌ Not enough ${item} in vault.` }, { quoted: message }); return;
      }
      vault[item] -= qty;
      if (!player.inventory) player.inventory = {};
      player.inventory[item] = (player.inventory[item] || 0) + qty;
      activeHouse.vault = vault;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      const vi = VAULT_ITEMS[item];
      await sock.sendMessage(chatJid, { text: `📤 Took ${qty}x ${vi.emoji} ${vi.name} from vault.` }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatJid, { text: `Usage:\n.house vault view\n.house vault deposit [amount]\n.house vault withdraw [amount]\n.house vault store [item] [qty]\n.house vault take [item] [qty]` }, { quoted: message });
  }

  // Helper — write activeHouse changes back into player.houses array
  _syncHouseBack(player, activeHouse) {
    if (Array.isArray(player.houses)) {
      const idx = player.houses.indexOf(activeHouse);
      if (idx !== -1) player.houses[idx] = activeHouse;
    }
    if (player.house === activeHouse || (player.house && player.house.type === activeHouse.type)) {
      player.house = activeHouse;
    }
  }


  // ── Garage management ──────────────────────────────────────
  async _garage(args, sender, player, house, chatJid, sock, message) {
    const activeHouse = house || activeHouse;
    if (!activeHouse) {
      await sock.sendMessage(chatJid, { text: `❌ You need a home first! .house list` }, { quoted: message }); return;
    }
    const hdef = HOUSES[activeHouse.type];
    if (!activeHouse.garageVehicles) activeHouse.garageVehicles = [];
    const garage    = activeHouse.garageVehicles;
    const ownedCars = player.vehicles || [];
    const action    = (args[0] || '').toLowerCase();

    // ── View garage ──────────────────────────────────────────────────────
    if (!action || action === 'view') {
      let text = `🚗 *HOUSE GARAGE*\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `Slots: ${garage.length}/${hdef.garageSlots}\n\n`;

      if (garage.length === 0) {
        text += `Empty garage.\n`;
      } else {
        text += `*Stored cars:*\n`;
        garage.forEach((v, i) => text += `${i + 1}. 🚘 ${v.name} (${v.topSpeed} km/h)\n`);
      }

      if (ownedCars.length > 0) {
        text += `\n*Your cars (available to store):*\n`;
        ownedCars.forEach((v, i) => text += `${i + 1}. 🚗 ${v.name}\n`);
      }

      text += `\n.house garage store [#] — move car in\n.house garage take [#] — move car out`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    // ── Store a car into garage ───────────────────────────────────────────
    if (action === 'store' || action === 'add') {
      const idx = parseInt(args[1]) - 1;
      if (isNaN(idx) || idx < 0 || idx >= ownedCars.length) {
        let list = `❌ Invalid car number.\n\n*Your cars:*\n`;
        ownedCars.forEach((v, i) => list += `${i + 1}. ${v.name}\n`);
        list += `\nUsage: .house garage store [#]`;
        await sock.sendMessage(chatJid, { text: list }, { quoted: message }); return;
      }
      if (garage.length >= hdef.garageSlots) {
        await sock.sendMessage(chatJid, { text: `❌ Garage full! (${hdef.garageSlots} slots)\nTake a car out first: .house garage take [#]` }, { quoted: message }); return;
      }
      const car = ownedCars[idx];
      // Check car isn't already in garage
      if (garage.some(g => g.name === car.name && g.topSpeed === car.topSpeed)) {
        await sock.sendMessage(chatJid, { text: `❌ That car is already in the garage!` }, { quoted: message }); return;
      }
      // Remove from player inventory, add to garage
      player.vehicles.splice(idx, 1);
      // If equipped index shifts, adjust it
      if ((player.equippedVehicle || 0) >= player.vehicles.length && player.vehicles.length > 0) {
        player.equippedVehicle = player.vehicles.length - 1;
      }
      garage.push({ ...car, storedAt: Date.now() });
      activeHouse.garageVehicles = garage;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `✅ *${car.name}* stored in garage!\n🚗 Garage: ${garage.length}/${hdef.garageSlots}\n\n.house garage take [#] to retrieve`
      }, { quoted: message });
      return;
    }

    // ── Take a car out of garage ──────────────────────────────────────────
    if (action === 'take' || action === 'get') {
      if (garage.length === 0) {
        await sock.sendMessage(chatJid, { text: `❌ Garage is empty.` }, { quoted: message }); return;
      }
      const idx = parseInt(args[1]) - 1;
      if (isNaN(idx) || idx < 0 || idx >= garage.length) {
        let list = `❌ Invalid garage slot.\n\n*Stored cars:*\n`;
        garage.forEach((v, i) => list += `${i + 1}. ${v.name}\n`);
        list += `\nUsage: .house garage take [#]`;
        await sock.sendMessage(chatJid, { text: list }, { quoted: message }); return;
      }
      const car = garage[idx];
      garage.splice(idx, 1);
      delete car.storedAt;
      player.vehicles.push(car);
      activeHouse.garageVehicles = garage;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `✅ *${car.name}* retrieved from garage!\n🚗 It's back in your vehicle list.\n\n.race equip [#] to equip it`
      }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatJid, {
      text: `🚗 *GARAGE COMMANDS*\n.house garage — view\n.house garage store [#] — store car\n.house garage take [#] — retrieve car`
    }, { quoted: message });
  }

  // ── Security ──────────────────────────────────────────────
  async _security(args, sender, player, house, chatJid, sock, message) {
    const activeHouse = house || activeHouse;
    if (!activeHouse) {
      await sock.sendMessage(chatJid, { text: `❌ You need a home first!` }, { quoted: message }); return;
    }
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'list') {
      let text = `🛡️ *SECURITY SERVICES*\n\n`;
      for (const [id, s] of Object.entries(SECURITY)) {
        text += `${s.emoji} *${s.name}* (Lv.${s.level})\n`;
        text += `   ${s.desc}\n`;
        text += `   💰 $${s.pricePerHour.toLocaleString()}/hr (auto-deducted)\n`;
        text += `   🛡️ Defense Bonus: +${s.defenseBonus}%\n`;
        text += `   .house sec hire ${id}\n\n`;
      }
      const cur = activeHouse.security;
      text += cur ? `\nActive: ${SECURITY[cur.type]?.emoji} ${SECURITY[cur.type]?.name}` : `\nNo security hired.`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    if (sub === 'hire') {
      const secId = (args[1] || '').toLowerCase();
      const sdef = SECURITY[secId];
      if (!sdef) {
        await sock.sendMessage(chatJid, { text: `❌ Invalid security type.\nSee: .house sec list` }, { quoted: message }); return;
      }
      // Check can afford first hour
      const canPay = (player.cash || 0) >= sdef.pricePerHour || (player.bank || 0) >= sdef.pricePerHour;
      if (!canPay) {
        await sock.sendMessage(chatJid, { text: `❌ Need $${sdef.pricePerHour.toLocaleString()} for first hour.` }, { quoted: message }); return;
      }
      this._deductFromAny(sender, player, sdef.pricePerHour);
      activeHouse.security = {
        type: secId,
        hiredAt: Date.now(),
        nextPayDue: Date.now() + SECURITY_PAY_INTERVAL_MS,
        unpaidSince: null,
      };
      activeHouse.securityActive = true;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `🛡️ *SECURITY HIRED!*\n\n${sdef.emoji} ${sdef.name} (Lv.${sdef.level})\n💰 $${sdef.pricePerHour.toLocaleString()}/hr (auto-deducted)\n🛡️ Defense Bonus: +${sdef.defenseBonus}%\n\n⚠️ Keep funds available or guards withdraw!`
      }, { quoted: message });
      return;
    }

    if (sub === 'fire') {
      if (!activeHouse.security) {
        await sock.sendMessage(chatJid, { text: `❌ No security hired.` }, { quoted: message }); return;
      }
      activeHouse.security = null;
      activeHouse.securityActive = false;
      this._syncHouseBack(player, activeHouse);
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, { text: `👋 Security dismissed.` }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatJid, { text: `Usage: .house sec list | hire [type] | fire` }, { quoted: message });
  }

  // ─────────────────────────────────────────────────────────────────────
  //  .house move [n] — change which property is the primary home
  //  Primary home is used for vault/security/garage when no # is given
  //  and is shown first in .house info
  // ─────────────────────────────────────────────────────────────────────
  async _moveHome(args, sender, player, chatJid, sock, message) {
    // Migrate legacy
    if (player.house && !Array.isArray(player.houses)) player.houses = [player.house];
    const houses = player.houses || [];

    if (houses.length === 0) {
      await sock.sendMessage(chatJid, { text: `❌ You don't own any properties.\n.house list` }, { quoted: message });
      return;
    }
    if (houses.length === 1) {
      const hdef = HOUSES[houses[0].type] || {};
      await sock.sendMessage(chatJid, {
        text: `ℹ️ You only own one property — ${hdef.emoji || '🏠'} ${hdef.name}. Nothing to move to.`
      }, { quoted: message });
      return;
    }

    const num = parseInt(args[0]);
    if (isNaN(num) || num < 1 || num > houses.length) {
      // Show list
      let text = `🏠 *MOVE HOME*\n\nChoose your primary residence:\n\n`;
      houses.forEach((h, i) => {
        const hdef = HOUSES[h.type] || {};
        const isPrimary = player.house?.type === h.type;
        text += `  *${i + 1}.* ${hdef.emoji || '🏠'} ${hdef.name}${isPrimary ? ' ✅ *(current)*' : ''}\n`;
      });
      text += `\nType: *.house move [number]*`;
      await sock.sendMessage(chatJid, { text }, { quoted: message });
      return;
    }

    const chosen = houses[num - 1];
    // Reorder houses array so chosen is first (primary)
    const reordered = [chosen, ...houses.filter((_, i) => i !== num - 1)];
    player.houses = reordered;
    player.house  = chosen;
    this.db.updatePlayer(sender, player);

    const hdef = HOUSES[chosen.type] || {};
    await sock.sendMessage(chatJid, {
      text: `🏠 *Moved in!*\n\n${hdef.emoji || '🏠'} *${hdef.name}* is now your primary residence.\n\n.house info — view your properties`
    }, { quoted: message });
  }
}

HousingCommand.HOUSES   = HOUSES;
HousingCommand.SECURITY = SECURITY;
HousingCommand.VAULT_ITEMS = VAULT_ITEMS;

module.exports = HousingCommand;
