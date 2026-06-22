const BankingCommand = require('./banking');

class DailyCommand {
  constructor(db) {
    this.db = db;

    // Day 30 reward pool — mid-range cars from vehicles.js
    this.day30Cars = [
      { id: 4,  name: 'Dodge Mustang',       type: 'Muscle',       topSpeed: 280, price: 200000, maintenance: 4000 },
      { id: 5,  name: 'Chevrolet Camaro',    type: 'Muscle',       topSpeed: 290, price: 220000, maintenance: 4500 },
      { id: 6,  name: 'Ford Charger',        type: 'Muscle',       topSpeed: 300, price: 240000, maintenance: 5000 },
      { id: 7,  name: 'BMW M3',              type: 'Sport Sedan',  topSpeed: 310, price: 280000, maintenance: 6000 },
      { id: 8,  name: 'Audi RS6',            type: 'Sport Sedan',  topSpeed: 320, price: 320000, maintenance: 7000 },
      { id: 9,  name: 'Range Rover',         type: 'SUV',          topSpeed: 220, price: 150000, maintenance: 3500 },
      { id: 13, name: 'Lamburgeny',          type: 'Supercar',     topSpeed: 320, price: 250000, maintenance: 5000 },
      { id: 22, name: 'Nissan GT-R',         type: 'Performance',  topSpeed: 335, price: 380000, maintenance: 7500 },
      { id: 23, name: 'Subaru STI',          type: 'Rally',        topSpeed: 260, price: 180000, maintenance: 3500 },
      { id: 16, name: 'Corvette Sting Ray',  type: 'Coupe',        topSpeed: 310, price: 350000, maintenance: 6000 },
    ];
  }

  // Cash reward per day (day 1–29)
  getDayReward(day) {
    return day * 500; // Day 1 = $500, Day 2 = $1000, ..., Day 29 = $14,500
  }

  // Progress bar for streak
  streakBar(current, max = 30) {
    const filled = Math.round((current / max) * 10);
    const empty  = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);

    // Init daily data if not present
    if (!player.daily) {
      player.daily = { streak: 0, lastClaim: null };
    }

    const now = Date.now();
    const lastClaim = player.daily.lastClaim ? new Date(player.daily.lastClaim).getTime() : 0;
    const hoursSinceLast = (now - lastClaim) / (1000 * 60 * 60);

    // Must wait at least 20 hours between claims
    const CLAIM_COOLDOWN_HOURS = 20;
    // Streak resets if more than 48 hours pass without claiming
    const STREAK_RESET_HOURS   = 48;

    if (lastClaim && hoursSinceLast < CLAIM_COOLDOWN_HOURS) {
      const hoursLeft   = Math.ceil(CLAIM_COOLDOWN_HOURS - hoursSinceLast);
      const minutesLeft = Math.round((CLAIM_COOLDOWN_HOURS - hoursSinceLast) * 60) % 60;
      await sock.sendMessage(chatJid, {
        text: `⏰ *Daily already claimed!*\n\nCome back in *${hoursLeft}h ${minutesLeft}m*\n\n📅 Streak: Day ${player.daily.streak}/30\n${this.streakBar(player.daily.streak)}`
      }, { quoted: message });
      return;
    }

    // Reset streak if they missed more than 48 hours
    if (lastClaim && hoursSinceLast > STREAK_RESET_HOURS) {
      player.daily.streak = 0;
    }

    // Advance streak
    player.daily.streak = (player.daily.streak || 0) + 1;
    player.daily.lastClaim = new Date().toISOString();

    const day = player.daily.streak;
    let rewardText = '';
    let xpGain = day * 10;

    if (day === 30) {
      // Day 30 — random mid-range car
      const car = this.day30Cars[Math.floor(Math.random() * this.day30Cars.length)];

      // Add car to player's vehicles if not already owned
      const alreadyOwned = player.vehicles.some(v => v.name === car.name);
      if (!alreadyOwned) {
        player.vehicles.push({
          ...car,
          purchasedAt: new Date().toISOString(),
          condition: 100,
          mods: [],
          dailyReward: true,
        });
      } else {
        // If they already own it, give cash equivalent instead
        const cashVal = Math.floor(car.price * 0.75);
        player.cash += cashVal;
        rewardText += `\n_(You already own this car — received *$${cashVal.toLocaleString()}* cash instead)_`;
      }

      xpGain = 500;
      player.experience += xpGain;

      rewardText = `
╔════════════════════╗
║  🎁 *DAY 30 — STREAK COMPLETE!*
╚════════════════════╝

🏆 *LEGENDARY REWARD!*

🚗 *${car.name}* added to your garage!
   Type: ${car.type}
   Top Speed: ${car.topSpeed} km/h
   Value: $${car.price.toLocaleString()}
${rewardText}

⭐ XP: *+${xpGain}*
💵 Cash: $${player.cash.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━
🔄 Streak reset — claim again tomorrow for Day 1!
      `.trim();

      // Reset streak after day 30 claim
      player.daily.streak = 0;

    } else {
      // Day 1–29 — cash reward
      const cashReward = this.getDayReward(day);
      player.cash += cashReward;
      player.experience += xpGain;

      BankingCommand.recordExternal(this.db, sender, {
        type: 'Daily Reward', amount: cashReward,
        sender: 'SE Daily Bonus', receiver: player.name,
        note: `Day ${day} streak reward`,
        balance: player.cash,
      });

      const nextReward = day < 29
        ? `💵 Tomorrow (Day ${day + 1}): *$${this.getDayReward(day + 1).toLocaleString()}*`
        : `🚗 Tomorrow (Day 30): *LEGENDARY GIFT* 🔥`;

      rewardText = `
╔════════════════════╗
║  🎁 *DAILY REWARD — DAY ${String(day).padEnd(2)}*
╚════════════════════╝

✅ *Day ${day} claimed!*

💵 *Cash:* +$${cashReward.toLocaleString()}
⭐ *XP:* +${xpGain}

📅 *Streak Progress:*
${this.streakBar(day)} ${day}/30

━━━━━━━━━━━━━━━━━━━━━
${nextReward}

💰 Balance: $${player.cash.toLocaleString()}
⭐ Total XP: ${player.experience}

⚠️ Miss 48hrs and your streak resets!
      `.trim();
    }

    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, { text: rewardText }, { quoted: message });
  }
}

module.exports = DailyCommand;
