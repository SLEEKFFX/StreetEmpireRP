// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — VEHICLES v5.0
//  Futuristic/Hypercar/Yacht/Jet price hike update
// ═══════════════════════════════════════════════════════════════

const UPGRADES = {
  e1: { name: 'Basic Tune',    emoji: '🔧', speed: 15,  accel: 0,    handling: 0,    price: 5000,   type: 'engine' },
  e2: { name: 'Sport Tune',    emoji: '🔧', speed: 30,  accel: 0,    handling: 0,    price: 15000,  type: 'engine' },
  e3: { name: 'Turbo Boost',   emoji: '⚡', speed: 50,  accel: 0,    handling: 0,    price: 35000,  type: 'engine' },
  e4: { name: 'Beast Engine',  emoji: '🔥', speed: 75,  accel: 0,    handling: 0,    price: 75000,  type: 'engine' },
  t1: { name: 'Sport Tires',   emoji: '🛞', speed: 0,   accel: 0.15, handling: 0,    price: 3000,   type: 'tires' },
  t2: { name: 'Race Slicks',   emoji: '🛞', speed: 0,   accel: 0.30, handling: 0,    price: 10000,  type: 'tires' },
  t3: { name: 'Drift Setup',   emoji: '🛞', speed: 0,   accel: 0.25, handling: 0,    price: 8000,   type: 'tires' },
  s1: { name: 'Lowered Susp',  emoji: '🛡️', speed: 0,   accel: 0,    handling: 0.15, price: 4000,   type: 'suspension' },
  s2: { name: 'Race Susp',     emoji: '🛡️', speed: 0,   accel: 0,    handling: 0.30, price: 12000,  type: 'suspension' },
  s3: { name: 'Offroad Susp',  emoji: '🛡️', speed: 0,   accel: 0,    handling: 0.25, price: 8000,   type: 'suspension' },
  c1: { name: 'Metallic Paint',emoji: '🎨', speed: 0,   accel: 0,    handling: 0,    price: 2000,   type: 'cosmetic' },
  c2: { name: 'Neon Lights',   emoji: '🌈', speed: 0,   accel: 0,    handling: 0,    price: 1500,   type: 'cosmetic' },
  c3: { name: 'Custom Rims',   emoji: '💿', speed: 0,   accel: 0,    handling: 0,    price: 3000,   type: 'cosmetic' },
  c4: { name: 'Spoiler',       emoji: '🏎️', speed: 0,   accel: 0,    handling: 0.10, price: 5000,   type: 'cosmetic' },
};

const VEHICLES = {
  // ── STANDARD CARS ──────────────────────────────────────────────────────────
  1:  { name: 'Honda Civic',           price: 67_500,       topSpeed: 180, type: 'Sedan',        category: 'car',      maintenance: 2250 },
  2:  { name: 'Toyota Corolla',        price: 82_500,       topSpeed: 190, type: 'Sedan',        category: 'car',      maintenance: 2700 },
  3:  { name: 'Nissan Altima',         price: 97_500,       topSpeed: 200, type: 'Sedan',        category: 'car',      maintenance: 3000 },
  4:  { name: 'Dodge Mustang',         price: 300_000,      topSpeed: 280, type: 'Muscle',       category: 'car',      maintenance: 6000 },
  5:  { name: 'Chevrolet Camaro',      price: 330_000,      topSpeed: 290, type: 'Muscle',       category: 'car',      maintenance: 6750 },
  6:  { name: 'Ford Charger',          price: 360_000,      topSpeed: 300, type: 'Muscle',       category: 'car',      maintenance: 7500 },
  7:  { name: 'BMW M3',                price: 420_000,      topSpeed: 310, type: 'Sport Sedan',  category: 'car',      maintenance: 9000 },
  8:  { name: 'Audi RS6',              price: 480_000,      topSpeed: 320, type: 'Sport Sedan',  category: 'car',      maintenance: 10_500 },
  9:  { name: 'Range Rover',           price: 225_000,      topSpeed: 220, type: 'SUV',          category: 'car',      maintenance: 5250 },
  10: { name: 'Jeep Grand Cherokee',   price: 180_000,      topSpeed: 210, type: 'SUV',          category: 'car',      maintenance: 4500 },
  11: { name: 'Tesla Model X',         price: 525_000,      topSpeed: 270, type: 'Electric SUV', category: 'car',      maintenance: 3000 },
  12: { name: 'Mercedes-Benz GLE',     price: 600_000,      topSpeed: 280, type: 'Luxury SUV',   category: 'car',      maintenance: 12_000 },
  13: { name: 'Lamborghini Huracán',   price: 375_000,      topSpeed: 320, type: 'Supercar',     category: 'car',      maintenance: 7500 },
  14: { name: 'Ferrari F8',            price: 750_000,      topSpeed: 340, type: 'Supercar',     category: 'car',      maintenance: 12_000 },
  15: { name: 'Porsche GT3 RS',        price: 675_000,      topSpeed: 330, type: 'Supercar',     category: 'car',      maintenance: 10_500 },
  16: { name: 'Corvette StingRay',     price: 525_000,      topSpeed: 310, type: 'Coupe',        category: 'car',      maintenance: 9000 },
  17: { name: 'Nissan GT-R',           price: 570_000,      topSpeed: 335, type: 'Performance',  category: 'car',      maintenance: 11_250 },
  18: { name: 'Subaru STI',            price: 270_000,      topSpeed: 260, type: 'Rally',        category: 'car',      maintenance: 5250 },
  19: { name: 'Ford F-150 Raptor',     price: 142_500,      topSpeed: 170, type: 'Truck',        category: 'car',      maintenance: 5250 },
  20: { name: 'Armored Truck',         price: 1_800_000,    topSpeed: 160, type: 'Armored',      category: 'car',      maintenance: 22_500 },
  // ── HYPERCARS ──────────────────────────────────────────────────────────────
  21: { name: 'Bugatti Chiron',        price: 3_750_000,    topSpeed: 420, type: 'Hypercar',     category: 'car',      maintenance: 37_500 },
  22: { name: 'Koenigsegg Jesko',      price: 4_500_000,    topSpeed: 445, type: 'Hypercar',     category: 'car',      maintenance: 45_000 },
  23: { name: 'Pagani Huayra',         price: 3_300_000,    topSpeed: 410, type: 'Hypercar',     category: 'car',      maintenance: 33_000 },
  24: { name: 'McLaren Speedtail',     price: 2_700_000,    topSpeed: 403, type: 'Hypercar',     category: 'car',      maintenance: 27_000 },
  25: { name: 'Ferrari LaFerrari',     price: 3_000_000,    topSpeed: 390, type: 'Hypercar',     category: 'car',      maintenance: 30_000 },
  26: { name: 'Lamborghini Revuelto',  price: 2_400_000,    topSpeed: 380, type: 'Hypercar',     category: 'car',      maintenance: 24_000 },
  // ── FUTURISTIC / HYBRID SUPERCARS ─────────────────────────────────────────
  27: { name: 'Tesla Roadster 2',      price: 50_000_000,   topSpeed: 400, type: 'Futuristic',   category: 'car',      maintenance: 150_000 },
  28: { name: 'NIO EP9 Hyper',         price: 75_000_000,   topSpeed: 430, type: 'Futuristic',   category: 'car',      maintenance: 225_000 },
  29: { name: 'Rimac Nevera X',        price: 120_000_000,  topSpeed: 460, type: 'Futuristic',   category: 'car',      maintenance: 360_000 },
  30: { name: 'Hennessey Venom F7',    price: 180_000_000,  topSpeed: 490, type: 'Futuristic',   category: 'car',      maintenance: 540_000 },
  31: { name: 'SSC Tuatara Evo',       price: 250_000_000,  topSpeed: 520, type: 'Futuristic',   category: 'car',      maintenance: 750_000 },
  32: { name: 'Devel Sixteen Ultra',   price: 350_000_000,  topSpeed: 560, type: 'Futuristic',   category: 'car',      maintenance: 1_050_000 },
  33: { name: 'Aspark Owl X',          price: 450_000_000,  topSpeed: 600, type: 'Futuristic',   category: 'car',      maintenance: 1_350_000 },
  34: { name: '🦇 BatMobile Supreme',  price: 10_000_000_000, topSpeed: 999, type: 'Legendary',  category: 'car',      maintenance: 50_000_000 },
  // ── BIKES ──────────────────────────────────────────────────────────────────
  35: { name: 'Harley Davidson',       price: 75_000,       topSpeed: 250, type: 'Bike',         category: 'bike',     maintenance: 3000 },
  36: { name: 'Kawasaki Ninja ZX',     price: 112_500,      topSpeed: 300, type: 'Sport Bike',   category: 'bike',     maintenance: 3750 },
  37: { name: 'Ducati Panigale V4',    price: 180_000,      topSpeed: 320, type: 'Superbike',    category: 'bike',     maintenance: 6000 },
  38: { name: 'BMW S1000RR',           price: 165_000,      topSpeed: 315, type: 'Superbike',    category: 'bike',     maintenance: 5700 },
  // ── PRIVATE JETS & PLANES ──────────────────────────────────────────────────
  39: { name: 'Cessna Citation XLS',   price: 5_000_000,    topSpeed: 600, type: 'Private Jet',  category: 'airplane', maintenance: 30_000 },
  40: { name: 'Bombardier CRJ',        price: 12_000_000,   topSpeed: 650, type: 'Private Jet',  category: 'airplane', maintenance: 72_000 },
  41: { name: 'Gulfstream G400',       price: 28_000_000,   topSpeed: 700, type: 'Private Jet',  category: 'airplane', maintenance: 168_000 },
  42: { name: 'Dassault Falcon 10X',   price: 55_000_000,   topSpeed: 750, type: 'VIP Jet',      category: 'airplane', maintenance: 330_000 },
  43: { name: 'Airbus ACJ Neo',        price: 100_000_000,  topSpeed: 850, type: 'VIP Airliner', category: 'airplane', maintenance: 600_000 },
  44: { name: 'Boeing BBJ Max',        price: 200_000_000,  topSpeed: 900, type: 'VIP Airliner', category: 'airplane', maintenance: 1_080_000 },
  45: { name: 'Concorde Reborn',       price: 350_000_000,  topSpeed: 2200, type: 'Supersonic',  category: 'airplane', maintenance: 2_100_000 },
  46: { name: 'Space Empire X1',       price: 600_000_000,  topSpeed: 7900, type: 'Spacecraft',  category: 'airplane', maintenance: 5_000_000 },
  // ── YACHTS & BOATS ─────────────────────────────────────────────────────────
  47: { name: 'Sea Raider 45',         price: 750_000,      topSpeed: 90,  type: 'Speedboat',    category: 'boat',     maintenance: 15_000 },
  48: { name: 'Azimut S6',            price: 3_000_000,    topSpeed: 120, type: 'Motor Yacht',  category: 'boat',     maintenance: 30_000 },
  49: { name: 'Sunseeker Predator',    price: 7_500_000,    topSpeed: 140, type: 'Sport Yacht',  category: 'boat',     maintenance: 75_000 },
  50: { name: 'Benetti Delfino 93',    price: 15_000_000,   topSpeed: 130, type: 'Superyacht',   category: 'boat',     maintenance: 150_000 },
  51: { name: 'Feadship Royale',       price: 35_000_000,   topSpeed: 120, type: 'Superyacht',   category: 'boat',     maintenance: 350_000 },
  52: { name: 'Lürssen Legend',        price: 80_000_000,   topSpeed: 115, type: 'Megayacht',    category: 'boat',     maintenance: 800_000 },
  53: { name: 'Oceanco Luminance',     price: 180_000_000,  topSpeed: 110, type: 'Megayacht',    category: 'boat',     maintenance: 1_800_000 },
  54: { name: 'Blohm+Voss Titanis',   price: 400_000_000,  topSpeed: 105, type: 'Gigayacht',    category: 'boat',     maintenance: 4_000_000 },
  55: { name: 'Azzam Empire',         price: 800_000_000,  topSpeed: 100, type: 'Gigayacht',    category: 'boat',     maintenance: 8_000_000 },
  56: { name: 'History Supreme Ultra',price: 4_000_000_000,topSpeed: 95,  type: 'Legendary',    category: 'boat',     maintenance: 40_000_000 },
};

class VehicleCommand {
  constructor(db) { this.db = db; }

  getVehicles() { return VEHICLES; }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const sub    = (args[0] || '').toLowerCase();

    if (!sub || sub === 'shop')   return this._shop(args.slice(1), chatJid, sock, message);
    if (sub === 'buy')            return this._buy(args.slice(1), player, sender, chatJid, sock, message);
    if (sub === 'list')           return this._list(player, chatJid, sock, message);
    if (sub === 'sell')           return this._sell(args.slice(1), player, sender, chatJid, sock, message);
    if (sub === 'info')           return this._info(args.slice(1), chatJid, sock, message);
    if (sub === 'equip')          return this._equip(args.slice(1), player, sender, chatJid, sock, message);
    if (sub === 'upgrade')        return this._upgrade(args.slice(1), player, sender, chatJid, sock, message);
    if (sub === 'mods' || sub === 'upgrades') return this._mods(args.slice(1), player, chatJid, sock, message);

    await sock.sendMessage(chatJid, {
      text: `🚗 *VEHICLES*\n\n.vehicle shop [car|bike|jet|boat] — browse\n.vehicle buy [#] — purchase\n.vehicle list — your fleet\n.vehicle equip [#] — equip for racing\n.vehicle upgrade [#] [code] — tune\n.vehicle mods [#] — installed mods\n.vehicle sell [#] — sell (70%)\n.vehicle info [#] — details\n\n💡 Shortcuts: .v shop boat | .v buy 50`
    }, { quoted: message });
  }

  _fmtPrice(n) {
    if (n >= 1e9)  return `$${(n/1e9).toFixed(1).replace(/\.0$/,'')}B`;
    if (n >= 1e6)  return `$${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`;
    if (n >= 1000) return `$${(n/1000).toFixed(0)}K`;
    return `$${n}`;
  }

  async _shop(args, chatJid, sock, message) {
    const filter = (args[0] || '').toLowerCase();
    const cats   = { car: '🚗 CARS', bike: '🏍️ BIKES', airplane: '✈️ JETS & PLANES', boat: '🚤 YACHTS & BOATS' };
    const catKeys = filter && cats[filter] ? [filter] : Object.keys(cats);

    let text = `╔═════════════════════╗\n║  🚗 STREET EMPIRE DEALERSHIP\n╚═════════════════════╝\n`;
    if (filter) text += `Showing: ${cats[filter] || 'all'}\n`;
    text += `\n`;

    for (const cat of catKeys) {
      const list = Object.entries(VEHICLES).filter(([,v]) => v.category === cat);
      if (!list.length) continue;
      text += `*${cats[cat]}*\n`;
      list.forEach(([id, v]) => {
        text += `[${id}] ${v.name} — ${this._fmtPrice(v.price)} | ${v.topSpeed}km/h\n`;
      });
      text += '\n';
    }
    text += `💡 .vehicle info [#] | .vehicle buy [#]`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _buy(args, player, sender, chatJid, sock, message) {
    const vid  = parseInt(args[0]);
    const vdef = VEHICLES[vid];
    if (!vdef) { await sock.sendMessage(chatJid, { text: `❌ Invalid vehicle #\n.vehicle shop to browse` }, { quoted: message }); return; }

    if ((player.cash || 0) >= vdef.price)       player.cash -= vdef.price;
    else if ((player.bank || 0) >= vdef.price)  player.bank -= vdef.price;
    else {
      await sock.sendMessage(chatJid, {
        text: `❌ Not enough funds!\n💵 Cash: ${this._fmtPrice(player.cash||0)}\n🏦 Bank: ${this._fmtPrice(player.bank||0)}\n💰 Need: ${this._fmtPrice(vdef.price)}`
      }, { quoted: message }); return;
    }

    if (!player.vehicles) player.vehicles = [];
    player.vehicles.push({ ...vdef, id: vid, purchasedAt: new Date(), mileage: 0, condition: 100, modifications: {} });
    player.experience = (player.experience || 0) + 5;
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, {
      text: `✅ *VEHICLE PURCHASED!*\n\n${vdef.name}\n💰 ${this._fmtPrice(vdef.price)} | ${vdef.topSpeed} km/h\n📦 ${vdef.type}\n⭐ +5 XP\n\n.vehicle equip ${player.vehicles.length} to race it`
    }, { quoted: message });
  }

  async _list(player, chatJid, sock, message) {
    if (!player.vehicles || player.vehicles.length === 0) {
      await sock.sendMessage(chatJid, { text: `🚗 No vehicles!\n.vehicle shop — browse dealership` }, { quoted: message }); return;
    }
    const equipped = player.equippedVehicle ?? 0;
    let text = `╔══════════════════╗\n║  🚗 YOUR FLEET (${player.vehicles.length})\n╚══════════════════╝\n\n`;
    player.vehicles.forEach((v, i) => {
      const eq   = i === equipped ? ' ✅ EQUIPPED' : '';
      const mods = Object.keys(v.modifications || {}).length;
      text += `${i+1}. ${v.name}${eq}\n   ${this._fmtPrice(v.price)} | ${v.topSpeed}km/h | ${v.type}\n`;
      if (mods > 0) text += `   🔧 ${mods} upgrades\n`;
      text += '\n';
    });
    text += `💡 .vehicle equip [#] | .vehicle upgrade [#] [code]`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _equip(args, player, sender, chatJid, sock, message) {
    const idx = parseInt(args[0]) - 1;
    if (isNaN(idx) || idx < 0 || idx >= (player.vehicles || []).length) {
      await sock.sendMessage(chatJid, { text: `❌ Invalid #. .vehicle list to see your fleet` }, { quoted: message }); return;
    }
    player.equippedVehicle = idx;
    this.db.updatePlayer(sender, player);
    const v = player.vehicles[idx];
    await sock.sendMessage(chatJid, { text: `✅ *${v.name}* equipped!\n${v.topSpeed} km/h | ${v.type}` }, { quoted: message });
  }

  async _upgrade(args, player, sender, chatJid, sock, message) {
    if (!args[0]) {
      let text = `🔧 *UPGRADE SHOP*\nUsage: *.vehicle upgrade [car#] [code]*\n\n`;
      const sections = { engine:'🔧 ENGINE (speed)', tires:'🛞 TIRES (accel)', suspension:'🛡️ SUSPENSION (handling)', cosmetic:'🎨 COSMETICS' };
      for (const [type, label] of Object.entries(sections)) {
        text += `*${label}*\n`;
        Object.entries(UPGRADES).filter(([,u]) => u.type === type).forEach(([code, u]) => {
          const stat = u.speed ? `+${u.speed}km/h` : u.accel ? `+${(u.accel*100).toFixed(0)}% accel` : u.handling ? `+${(u.handling*100).toFixed(0)}% handling` : 'cosmetic';
          text += `  [${code}] ${u.emoji} ${u.name} — $${u.price.toLocaleString()} | ${stat}\n`;
        });
        text += '\n';
      }
      text += `Example: .vehicle upgrade 1 e3`;
      await sock.sendMessage(chatJid, { text }, { quoted: message }); return;
    }

    const carIdx = parseInt(args[0]) - 1;
    const code   = (args[1] || '').toLowerCase();
    if (isNaN(carIdx) || carIdx < 0 || carIdx >= (player.vehicles||[]).length) {
      await sock.sendMessage(chatJid, { text: `❌ Invalid car #.\n.vehicle list` }, { quoted: message }); return;
    }
    const upg = UPGRADES[code];
    if (!upg) { await sock.sendMessage(chatJid, { text: `❌ Invalid code.\n.vehicle upgrade — view shop` }, { quoted: message }); return; }
    const car = player.vehicles[carIdx];
    if (!car.modifications) car.modifications = {};
    if (car.modifications[code]) { await sock.sendMessage(chatJid, { text: `❌ Already installed on ${car.name}!` }, { quoted: message }); return; }
    const conflict = Object.keys(car.modifications).find(k => UPGRADES[k]?.type === upg.type && upg.type !== 'cosmetic');
    if (conflict) { await sock.sendMessage(chatJid, { text: `❌ Already have a ${upg.type} upgrade. Remove it first.` }, { quoted: message }); return; }

    if ((player.cash||0) >= upg.price)      player.cash -= upg.price;
    else if ((player.bank||0) >= upg.price) player.bank -= upg.price;
    else { await sock.sendMessage(chatJid, { text: `❌ Need $${upg.price.toLocaleString()}` }, { quoted: message }); return; }

    car.modifications[code] = true;
    if (upg.speed)    car.topSpeed     = (car.topSpeed||0) + upg.speed;
    if (upg.accel)    car.accelBonus   = (car.accelBonus||0) + upg.accel;
    if (upg.handling) car.handlingBonus = (car.handlingBonus||0) + upg.handling;
    player.vehicles[carIdx] = car;
    player.experience = (player.experience||0) + 3;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, {
      text: `✅ *${upg.emoji} ${upg.name}* on *${car.name}*!\n🏎️ Speed: ${car.topSpeed} km/h | +3 XP`
    }, { quoted: message });
  }

  async _mods(args, player, chatJid, sock, message) {
    const idx = parseInt(args[0]) - 1;
    if (isNaN(idx) || idx < 0 || idx >= (player.vehicles||[]).length) {
      await sock.sendMessage(chatJid, { text: `❌ Usage: .vehicle mods [#]` }, { quoted: message }); return;
    }
    const car  = player.vehicles[idx];
    const mods = Object.keys(car.modifications||{}).filter(k => car.modifications[k]);
    let text = `🔧 *${car.name} — MODS*\n🏎️ ${car.topSpeed} km/h\n\n`;
    text += mods.length ? mods.map(k => { const u=UPGRADES[k]; return u?`✅ [${k}] ${u.emoji} ${u.name}`:`✅ ${k}`; }).join('\n') : 'No mods installed.';
    text += `\n\n.vehicle upgrade — shop`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sell(args, player, sender, chatJid, sock, message) {
    const idx = parseInt(args[0]) - 1;
    if (isNaN(idx) || idx < 0 || idx >= (player.vehicles||[]).length) {
      await sock.sendMessage(chatJid, { text: `❌ Usage: .vehicle sell [#]` }, { quoted: message }); return;
    }
    const v = player.vehicles[idx];
    const refund = Math.floor(v.price * 0.7);
    player.vehicles.splice(idx, 1);
    if ((player.equippedVehicle||0) >= player.vehicles.length && player.vehicles.length > 0) player.equippedVehicle = 0;
    player.cash = (player.cash||0) + refund;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, { text: `💸 *${v.name}* sold for ${this._fmtPrice(refund)} (70%)` }, { quoted: message });
  }

  async _info(args, chatJid, sock, message) {
    const vid = parseInt(args[0]);
    const v   = VEHICLES[vid];
    if (!v) { await sock.sendMessage(chatJid, { text: `❌ Invalid vehicle #` }, { quoted: message }); return; }
    await sock.sendMessage(chatJid, {
      text: `🚗 *${v.name}*\n💰 ${this._fmtPrice(v.price)} | ${v.topSpeed} km/h\n📦 ${v.type} (${v.category})\n🔧 Maintenance: ${this._fmtPrice(v.maintenance)}/service\n\n.vehicle buy ${vid}`
    }, { quoted: message });
  }
}

module.exports = VehicleCommand;
module.exports.VEHICLES = VEHICLES;
