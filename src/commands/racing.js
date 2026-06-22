const { resolveMention, normJid } = require('../utils/resolveMention');
const BankingCommand = require('./banking');

// ─── Active PvP races store ────────────────────────────────────────────────
const activePvP   = {};   // heistId → race object
const raceInvites = {};   // inviteeId → { raceId, inviterId, bet, expiresAt }

class RacingCommand {
  constructor(db) {
    this.db = db;
    // NPC name pool
    this.npcNames = ['Ghost_NPC','Shadow_Racer','Speed_Devil','Turbo_King','Night_Rider',
      'Drift_Master','Thunder_Run','Blaze_99','Venom_X','Silent_Ace'];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  getEquippedVehicle(player) {
    if (!player.vehicles || player.vehicles.length === 0) return null;
    const idx = Math.min(player.equippedVehicle ?? 0, player.vehicles.length - 1);
    return player.vehicles[idx];
  }

  // FIX: NPC speed is based on player's car speed ±10%, eliminating the exploit
  // where high-speed cars always won because the NPC cap was too low (400 km/h).
  getNPCSpeed(playerSpeed) {
    const variance = playerSpeed * 0.10;                        // ±10%
    const bias     = playerSpeed * 0.02 * (Math.random() - 0.5); // tiny random shift
    return Math.max(50, playerSpeed + bias + (Math.random() * variance * 2 - variance));
  }

  // ── Get vehicle category for fair race matchmaking ─────────────────────────
  // Uses the explicit 'category' field added to VEHICLES in vehicles.js
  getVehicleType(vehicle) {
    if (!vehicle) return null;
    // Prefer explicit category field
    if (vehicle.category) return vehicle.category;
    // Legacy fallback for vehicles stored before v4.0
    const t = vehicle.type || '';
    if (t.includes('Airplane') || t.includes('Jet')) return 'airplane';
    if (t.includes('Bike') || t.includes('bike')) return 'bike';
    if (t.includes('Boat') || t.includes('Yacht') || t.includes('Catamaran') || t.includes('Speedboat')) return 'boat';
    return 'car';
  }

  calcNetworth(player) {
    return (player.cash || 0) + (player.bank || 0)
      + (player.vehicles   || []).reduce((s, v) => s + (v.price || 0), 0)
      + (player.businesses || []).reduce((s, b) => s + (b.price || 0), 0);
  }

  addWin(playerId, bet) {
    const p = this.db.getPlayer(playerId);
    const winnings = Math.floor(bet * 2 * 0.94); // 6% total (3% house + 3% tax nerf)
    p.bank = (p.bank || 0) + winnings;
    p.stats.racesWon = (p.stats.racesWon || 0) + 1;
    p.stats.moneyEarned = (p.stats.moneyEarned || 0) + winnings;
    p.experience = (p.experience || 0) + 15;
    BankingCommand.recordExternal(this.db, playerId, {
      type: 'Race Winnings', amount: winnings,
      sender: 'Race Pot', receiver: this.db.getDisplayName(playerId),
      note: 'Race win — added to bank', balance: p.bank,
    });
    this.db.updatePlayer(playerId, p);
    return winnings;
  }

  deductBet(playerId, bet) {
    const p = this.db.getPlayer(playerId);
    p.cash -= bet;
    p.stats.moneyLost = (p.stats.moneyLost || 0) + bet;
    p.experience = (p.experience || 0) + 5;
    this.db.updatePlayer(playerId, p);
  }

  deductBet(playerId, bet) {
    const p = this.db.getPlayer(playerId);
    p.cash -= bet;
    p.stats.moneyLost = (p.stats.moneyLost || 0) + bet;
    p.experience = (p.experience || 0) + 5;
    this.db.updatePlayer(playerId, p);
  }

  // ── Car Condition System ──────────────────────────────────────────────────
  // After every race, the car accrues realistic wear. Multiple conditions can
  // stack. A car with issues gets a speed penalty until serviced.

  CAR_CONDITIONS() {
    return [
      { id: 'dirty',    label: '🧹 Dirty',           emoji: '🧹', chance: 0.60, speedPenalty: 0,  fixCost: 2000,   fixTime: 0,         msg: 'covered in mud and dust' },
      { id: 'low_fuel', label: '⛽ Low Fuel',         emoji: '⛽', chance: 0.45, speedPenalty: 15, fixCost: 5000,   fixTime: 0,         msg: 'running on fumes' },
      { id: 'flat_tire',label: '🛞 Flat Tyre',        emoji: '🛞', chance: 0.30, speedPenalty: 30, fixCost: 10000,  fixTime: 0,         msg: 'a tyre is flat or needs pumping' },
      { id: 'overheat', label: '🌡️ Overheating',      emoji: '🌡️', chance: 0.25, speedPenalty: 25, fixCost: 20000,  fixTime: 0,         msg: 'engine is overheating — needs cooldown' },
      { id: 'faulty',   label: '🔧 Engine Fault',     emoji: '🔧', chance: 0.20, speedPenalty: 50, fixCost: 50000,  fixTime: 0,         msg: 'engine is making strange noises' },
      { id: 'bodywork', label: '💥 Bodywork Damage',  emoji: '💥', chance: 0.15, speedPenalty: 10, fixCost: 25000,  fixTime: 0,         msg: 'bodywork is scratched and dented' },
    ];
  }

  // Apply random post-race wear to a player's equipped vehicle
  applyRaceWear(playerId) {
    const p   = this.db.getPlayer(playerId);
    const car = this.getEquippedVehicle(p);
    if (!car) return { issues: [], speedLost: 0 };

    if (!car.conditions) car.conditions = [];

    const conditions = this.CAR_CONDITIONS();
    const newIssues  = [];

    for (const cond of conditions) {
      // Don't stack the same condition twice
      if (car.conditions.includes(cond.id)) continue;
      if (Math.random() < cond.chance) {
        car.conditions.push(cond.id);
        newIssues.push(cond);
      }
    }

    // Calculate total speed penalty from all conditions
    const speedLost = car.conditions.reduce((sum, id) => {
      const c = conditions.find(x => x.id === id);
      return sum + (c ? c.speedPenalty : 0);
    }, 0);

    // Update car in player.vehicles array
    const idx = p.equippedVehicle ?? 0;
    if (p.vehicles && p.vehicles[idx]) {
      p.vehicles[idx].conditions = car.conditions;
    }

    this.db.updatePlayer(playerId, p);
    return { issues: newIssues, speedLost, allConditions: car.conditions };
  }

  // Get total speed penalty from car conditions
  getConditionPenalty(player) {
    const car = this.getEquippedVehicle(player);
    if (!car || !car.conditions || car.conditions.length === 0) return 0;
    return car.conditions.reduce((sum, id) => {
      const c = this.CAR_CONDITIONS().find(x => x.id === id);
      return sum + (c ? c.speedPenalty : 0);
    }, 0);
  }

  // Build a condition status string for display
  getConditionStatus(car) {
    if (!car || !car.conditions || car.conditions.length === 0) return '✅ All Good';
    const conditions = this.CAR_CONDITIONS();
    return car.conditions.map(id => {
      const c = conditions.find(x => x.id === id);
      return c ? `${c.emoji} ${c.label.split(' ').slice(1).join(' ')}` : id;
    }).join(', ');
  }

  // ── .race service — fix all car conditions ────────────────────────────────
  async serviceVehicle(player, sender, chatJid, sock, message) {
    const car = this.getEquippedVehicle(player);
    if (!car) { await sock.sendMessage(chatJid, { text: '🔧 No vehicle equipped.' }, { quoted: message }); return; }
    if (!car.conditions || car.conditions.length === 0) {
      await sock.sendMessage(chatJid, { text: `✅ *${car.name}* is in perfect condition — no repairs needed!` }, { quoted: message }); return;
    }

    const conditions = this.CAR_CONDITIONS();
    const totalCost  = car.conditions.reduce((sum, id) => {
      const c = conditions.find(x => x.id === id);
      return sum + (c ? c.fixCost : 0);
    }, 0);

    if ((player.cash || 0) < totalCost) {
      const details = car.conditions.map(id => {
        const c = conditions.find(x => x.id === id);
        return c ? `  ${c.emoji} ${c.label.split(' ').slice(1).join(' ')}: $${c.fixCost.toLocaleString()}` : '';
      }).join('\n');
      await sock.sendMessage(chatJid, {
        text: `🔧 *SERVICE QUOTE: ${car.emoji || '🚗'} ${car.name}*\n\n${details}\n\n💰 Total: $${totalCost.toLocaleString()}\n❌ Not enough cash! (You have $${(player.cash||0).toLocaleString()})`
      }, { quoted: message }); return;
    }

    const fixed = [...car.conditions];
    player.cash -= totalCost;
    car.conditions = [];

    const idx = player.equippedVehicle ?? 0;
    if (player.vehicles && player.vehicles[idx]) player.vehicles[idx].conditions = [];
    this.db.updatePlayer(sender, player);

    const fixedList = fixed.map(id => {
      const c = conditions.find(x => x.id === id);
      return c ? `  ✅ ${c.label}` : '';
    }).join('\n');

    await sock.sendMessage(chatJid, {
      text: `🔧 *VEHICLE SERVICED!*\n\n${car.emoji || '🚗'} *${car.name}*\n\n${fixedList}\n\n💸 Cost: -$${totalCost.toLocaleString()}\n💵 Cash: $${player.cash.toLocaleString()}\n\n🏁 Your car is race-ready!`
    }, { quoted: message });
  }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize once at entry point
    const player     = this.db.getPlayer(sender);
    const subcommand = (args[0] || '').toLowerCase();

    // .race garage
    if (subcommand === 'garage') return this.showGarage(player, sender, chatJid, sock, message);

    // .race service — fix car conditions
    if (subcommand === 'service' || subcommand === 'fix' || subcommand === 'repair') return this.serviceVehicle(player, sender, chatJid, sock, message);

    // .race equip [n]
    if (subcommand === 'equip') return this.equipVehicle(args, player, sender, chatJid, sock, message);

    // .race leaderboard
    if (subcommand === 'leaderboard' || subcommand === 'lb') return this.showLeaderboard(chatJid, sock, message);

    // .race accept / .race decline — named commands (more reliable than .1/.2)
    if (subcommand === 'accept') return this.resolveRaceInvite('1', sender, chatJid, sock, message);
    if (subcommand === 'decline' || subcommand === 'reject') return this.resolveRaceInvite('2', sender, chatJid, sock, message);

    // .race join ffa  /  .race join 2v2
    if (subcommand === 'join') return this.joinPvP(args[1], sender, chatJid, sock, message);

    // .race ffa [bet]
    if (subcommand === 'ffa') return this.startFFA(args.slice(1), sender, chatJid, sock, message);

    // .race @player [bet]  — detect @mention
    if (args[0] && args[0].includes('@') || (args[0] && /^\d{10,}/.test(args[0]))) {
      return this.challengePvP(args, sender, chatJid, sock, message);
    }

    // .race [bet]  — NPC solo race
    const bet = parseInt(subcommand);
    if (!subcommand || isNaN(bet)) return this.showMenu(player, chatJid, sock, message);

    return this.runNPCRace(bet, player, sender, chatJid, sock, message);
  }

  // ── NPC Race ──────────────────────────────────────────────────────────────

  async runNPCRace(bet, player, sender, chatJid, sock, message) {
    if (bet < 1000 || bet > 1_000_000) {
      await sock.sendMessage(chatJid, { text: ' NPC Race bet: $1,000 – $1,000,000' }, { quoted: message }); return;
    }
    // NPC race cooldown removed — race anytime!
    const car = this.getEquippedVehicle(player);
    if (!car) {
      await sock.sendMessage(chatJid, { text: 'you have no vehicle Buy with *.vehicle shop*' }, { quoted: message }); return;
    }
    if (player.cash < bet) {
      await sock.sendMessage(chatJid, { text: `Not enough cash\n💵 $${player.cash.toLocaleString()}` }, { quoted: message }); return;
    }

    const condPenalty = this.getConditionPenalty(player);
    if (condPenalty > 0) {
      await sock.sendMessage(chatJid, {
        text: [
          `⚠️ *CAR CONDITION WARNING!*`,
          ``,
          `${car.emoji || '🚗'} ${car.name}: ${this.getConditionStatus(car)}`,
          `📉 Speed penalty: -${condPenalty} km/h`,
          ``,
          `🔧 Fix with *.race service* before racing for full speed!`,
        ].join('\n')
      }, { quoted: message });
    }

    const playerSpeed = Math.max(50, car.topSpeed - condPenalty) + (Math.random() * 10 - 5);
    const npcSpeed    = this.getNPCSpeed(car.topSpeed);  // ← FIX: matched to player car
    const npcName     = this.npcNames[Math.floor(Math.random() * this.npcNames.length)];
    const won         = playerSpeed > npcSpeed;

    this.deductBet(sender, bet);
    // NPC race cooldown removed

    // Apply race wear AFTER the race
    const wear = this.applyRaceWear(sender);

    if (won) {
      const winnings = this.addWin(sender, bet);
      const updPlayer = this.db.getPlayer(sender);
      const wearLines = wear.issues.length > 0
        ? [``, `🔩 *POST-RACE CAR REPORT:*`, ...wear.issues.map(i => `  ${i.emoji} ${i.msg}`), `🔧 *.race service* to fix`]
        : [``, `✅ Car still in good shape`];
      await sock.sendMessage(chatJid, {
        text: [
          `🏁 *VICTORY!*`,
          ``,
          `🚗 ${car.emoji || '🚗'} ${car.name}  ⚡${Math.floor(playerSpeed)} km/h`,
          `🤖 ${npcName}  ⚡${Math.floor(npcSpeed)} km/h`,
          ``,
          `💰 Bet: $${bet.toLocaleString()}`,
          `💵 Won: +$${winnings.toLocaleString()} → Bank`,
          `⭐ XP: +15`,
          `🏁 Wins: ${updPlayer.stats.racesWon}`,
          ``,
          `🏦 Bank: $${updPlayer.bank.toLocaleString()}`,
          ...wearLines,
        ].join('\n')
      }, { quoted: message });
    } else {
      const updPlayer = this.db.getPlayer(sender);
      const wearLines = wear.issues.length > 0
        ? [``, `🔩 *POST-RACE CAR REPORT:*`, ...wear.issues.map(i => `  ${i.emoji} ${i.msg}`), `🔧 *.race service* to fix`]
        : [];
      await sock.sendMessage(chatJid, {
        text: [
          `🏁 *DEFEAT!*`,
          ``,
          `🚗 ${car.emoji || '🚗'} ${car.name}  ⚡${Math.floor(playerSpeed)} km/h`,
          `🤖 ${npcName}  ⚡${Math.floor(npcSpeed)} km/h`,
          ``,
          `💸 Lost: -$${bet.toLocaleString()}`,
          `⭐ XP: +5`,
          ``,
          `💵 Cash: $${updPlayer.cash.toLocaleString()}`,
          ...wearLines,
        ].join('\n')
      }, { quoted: message });
    }
  }

  // ── 1v1 PvP Challenge ─────────────────────────────────────────────────────

  async challengePvP(args, sender, chatJid, sock, message) {
    const _rawRaceTarget = resolveMention(message, args, 0);
    if (!_rawRaceTarget) { await sock.sendMessage(chatJid, { text: ' Tag a player e.g. *.race @player 5000*' }, { quoted: message }); return; }
    const targetId = normJid(_rawRaceTarget);
    if (targetId === sender) { await sock.sendMessage(chatJid, { text: ' Cannot race yourself' }, { quoted: message }); return; }

    const bet = parseInt(args[1]) || parseInt(args[2]); // support both arg positions
    if (isNaN(bet) || bet < 1000 || bet > 1_000_000) { await sock.sendMessage(chatJid, { text: 'Race bet: $1,000 – $1,000,000' }, { quoted: message }); return; }

    const player  = this.db.getPlayer(sender);
    const car     = this.getEquippedVehicle(player);
    if (!car) { await sock.sendMessage(chatJid, { text: 'Equip a vehicle first *.race equip [n]*' }, { quoted: message }); return; }
    if (player.cash < bet) { await sock.sendMessage(chatJid, { text: `Not enough cash. Need $${bet.toLocaleString()}` }, { quoted: message }); return; }

    // Warn challenger about car conditions
    const condPenalty = this.getConditionPenalty(player);
    if (condPenalty > 0) {
      await sock.sendMessage(chatJid, {
        text: `⚠️ *HEADS UP:* Your ${car.name} has issues (${this.getConditionStatus(car)}) — racing at -${condPenalty} km/h penalty!\n🔧 *.race service* to fix first.`
      }, { quoted: message });
    }

    // Resolve names FIRST so they're available for all error messages below
    const senderName = this.db.getDisplayName(sender);
    const targetName = this.db.getDisplayName(targetId);

    // Check that target owns a vehicle and has the SAME vehicle type as sender
    const target    = this.db.getPlayer(targetId);
    const targetCar = this.getEquippedVehicle(target);
    if (!targetCar) {
      await sock.sendMessage(chatJid, { text: `${targetName} has no vehicle equipped.`, mentions: [targetId] }, { quoted: message }); return;
    }

    const senderType = this.getVehicleType(car);
    const targetType = this.getVehicleType(targetCar);
    if (senderType !== targetType) {
      const typeMap = { car: '🚗 cars', bike: '🏍️ bikes', airplane: '✈️ airplanes', boat: '🚤 boats' };
      await sock.sendMessage(chatJid, {
        text: `Vehicle type mismatch\n\nYou: ${typeMap[senderType]}\n${targetName}: ${typeMap[targetType]}\n\n⚠️ Must race the same type of vehicle`,
        mentions: [targetId]
      }, { quoted: message }); return;
    }

    const raceId = `pvp_${Date.now()}`;

    activePvP[raceId] = { id: raceId, type: '1v1', players: [sender], bet, chatJid, status: 'pending' };

    // Store pending BEFORE sending any message so the reply can be resolved immediately
    global._racePending = global._racePending || {};
    global._racePending[targetId] = { type: 'race_invite', raceId, inviterId: sender, bet, chatJid };

    // FIX: Send invite IN THE GROUP with @mention instead of a DM.
    // DMs to the bot are unreliable (often silently dropped) and require the
    // invited player to switch chats.  Posting in the group means they see the
    // notification immediately and can reply right there without leaving the chat.
    const targetPhone = targetId.split('@')[0];
    const inviteText = [
      `🏎️ *RACE CHALLENGE!*`,
      `@${targetPhone} — ${senderName} is challenging you`,
      `🚗 ${car.name} (${car.topSpeed} km/h)`,
      `💰 Bet: $${bet.toLocaleString()} each`,
      `Reply *.race accept*  |  *.race decline*`,
      `⏳ You have 60 seconds`,
    ].join('\n');

    await sock.sendMessage(chatJid, {
      text: inviteText,
      mentions: [targetId],   // ← triggers the WhatsApp @ notification on their phone
    }, { quoted: message });

    setTimeout(() => {
      if (activePvP[raceId]?.status === 'pending') {
        delete activePvP[raceId];
        delete global._racePending[targetId];
        sock.sendMessage(chatJid, {
          text: `⏰ Race challenge expired.`,
          mentions: [targetId],
        }).catch(() => {});
      }
    }, 60000);
  }

  // Called from commandHandler when target replies 1/2
  async resolveRaceInvite(reply, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize at entry
    if (!global._racePending) global._racePending = {};
    const pending = global._racePending[sender];
    if (!pending || pending.type !== 'race_invite') return false;
    delete global._racePending[sender];

    // Always reply to the group where the invite was posted
    const replyChat = pending.chatJid;

    const race = activePvP[pending.raceId];
    if (!race || race.status !== 'pending') {
      await sock.sendMessage(replyChat, { text: '⏰ Race invite already expired.' }); return true;
    }

    if (reply === '2') {
      race.status = 'cancelled';
      delete activePvP[pending.raceId];
      const declinerName = this.db.getDisplayName(sender);
      await sock.sendMessage(replyChat, {
        text: `🚫 *Race Declined*\n\n${declinerName} turned down the challenge.`
      });
      return true;
    }

    // ── Accepted ──────────────────────────────────────────────────────────
    await sock.sendMessage(replyChat, {
      text: `✅ *Race Accepted.* Engines revving... 🏎️💨`
    });

    const inviter     = this.db.getPlayer(pending.inviterId);
    const accepter    = this.db.getPlayer(sender);
    const inviterCar  = this.getEquippedVehicle(inviter);
    const accepterCar = this.getEquippedVehicle(accepter);

    if (!inviterCar || !accepterCar) {
      await sock.sendMessage(replyChat, { text: 'Race cancelled — one player has no vehicle equipped' });
      delete activePvP[pending.raceId]; return true;
    }
    if (accepter.cash < pending.bet) {
      await sock.sendMessage(replyChat, { text: `Race cancelled — ${this.db.getDisplayName(sender)} is too broke to race` });
      delete activePvP[pending.raceId]; return true;
    }

    race.status = 'running';

    // Apply condition penalties to each racer's speed
    const inviterPenalty  = this.getConditionPenalty(inviter);
    const accepterPenalty = this.getConditionPenalty(accepter);

    // Add skill variance: each car gets ±15 km/h random offset
    const inviterSpeed  = Math.max(50, inviterCar.topSpeed  - inviterPenalty)  + (Math.random() * 30 - 15);
    const accepterSpeed = Math.max(50, accepterCar.topSpeed - accepterPenalty) + (Math.random() * 30 - 15);
    const inviterName   = this.db.getDisplayName(pending.inviterId);
    const accepterName  = this.db.getDisplayName(sender);

    this.deductBet(pending.inviterId, pending.bet);
    this.deductBet(sender, pending.bet);

    // Apply race wear to both drivers
    const inviterWear  = this.applyRaceWear(pending.inviterId);
    const accepterWear = this.applyRaceWear(sender);

    const winnerId   = inviterSpeed >= accepterSpeed ? pending.inviterId : sender;
    const loserId    = winnerId === pending.inviterId ? sender : pending.inviterId;
    const winnerName = winnerId === pending.inviterId ? inviterName : accepterName;
    const loserName  = winnerId === pending.inviterId ? accepterName : inviterName;
    const winnerCar  = winnerId === pending.inviterId ? inviterCar  : accepterCar;
    const loserCar   = winnerId === pending.inviterId ? accepterCar : inviterCar;
    const winnerSpd  = winnerId === pending.inviterId ? inviterSpeed  : accepterSpeed;
    const loserSpd   = winnerId === pending.inviterId ? accepterSpeed : inviterSpeed;
    const winnerWear = winnerId === pending.inviterId ? inviterWear : accepterWear;

    const totalPot     = pending.bet * 2;
    const winnerPayout = Math.floor(totalPot * 0.97);
    this.addWin(winnerId, pending.bet);

    const wearLines = winnerWear.issues.length > 0
      ? [``, `🔩 *POST-RACE (${winnerName}'s car):*`, ...winnerWear.issues.map(i => `  ${i.emoji} ${i.msg}`), `🔧 *.race service* to fix`]
      : [];

    // Warn if either car had conditions during the race
    const condWarnings = [];
    if (inviterPenalty > 0) condWarnings.push(`⚠️ ${inviterName}'s car had issues (-${inviterPenalty} km/h)`);
    if (accepterPenalty > 0) condWarnings.push(`⚠️ ${accepterName}'s car had issues (-${accepterPenalty} km/h)`);

    const resultText = [
      `🏁 *1v1 RACE RESULT!*`,
      ``,
      `🥇 *${winnerName}*`,
      `   ${winnerCar.emoji || '🚗'} ${winnerCar.name}  ⚡${Math.floor(winnerSpd)} km/h`,
      ``,
      `🥈 ${loserName}`,
      `   ${loserCar.emoji || '🚗'} ${loserCar.name}  ⚡${Math.floor(loserSpd)} km/h`,
      ``,
      `🏆 Winner: *${winnerName}*`,
      `💰 +$${winnerPayout.toLocaleString()} to Bank`,
      `⭐ +15 XP`,
      ...condWarnings,
      ...wearLines,
    ].join('\n');

    await sock.sendMessage(replyChat, { text: resultText });
    delete activePvP[pending.raceId];
    return true;
  }

  // ── FFA Race ──────────────────────────────────────────────────────────────

  async startFFA(args, sender, chatJid, sock, message) {
    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet < 1000) {
      await sock.sendMessage(chatJid, { text: 'Usage: *.race ffa [bet]*\nExample: *.race ffa 5000*' }, { quoted: message }); return;
    }
    const player = this.db.getPlayer(sender);
    const car    = this.getEquippedVehicle(player);
    if (!car) { await sock.sendMessage(chatJid, { text: 'Equip a vehicle' }, { quoted: message }); return; }
    if (this.getVehicleType(car) === 'airplane') { await sock.sendMessage(chatJid, { text: `✈️ Planes are not allowed in FFA races!\nEquip a car, bike, or boat.` }, { quoted: message }); return; }
    if (player.cash < bet) { await sock.sendMessage(chatJid, { text: `Not enough cash` }, { quoted: message }); return; }

    const existing = Object.values(activePvP).find(r => r.chatJid === chatJid && r.type === 'ffa' && r.status === 'recruiting');
    if (existing) { await sock.sendMessage(chatJid, { text: 'A FFA race is already recruiting in this chat\nJoin with *.race join ffa*' }, { quoted: message }); return; }

    const raceId = `ffa_${Date.now()}`;
    activePvP[raceId] = {
      id: raceId, type: 'ffa', status: 'recruiting',
      players: [sender], bet, chatJid,
      maxPlayers: 3, createdAt: Date.now(),
    };

    await sock.sendMessage(chatJid, {
      text: [
        `🏎️ *FREE FOR ALL RACE!*`,
        `👤 Host: ${this.db.getDisplayName(sender)}`,
        `💰 Bet: $${bet.toLocaleString()} each`,
        `👥 Players: 1/3`,
        `📣 Others join with *.race join ffa*`,
        `⏳ Race starts when 3 players join (or 2 min)`,
      ].join('\n')
    }, { quoted: message });

    setTimeout(async () => {
      const race = activePvP[raceId];
      if (!race || race.status !== 'recruiting') return;
      if (race.players.length < 2) {
        delete activePvP[raceId];
        await sock.sendMessage(chatJid, { text: 'FFA race cancelled — not enough players joined.' }).catch(() => {});
        return;
      }
      await this.runFFA(raceId, sock);
    }, 120000);
  }

  async joinPvP(type, sender, chatJid, sock, message) {
    if (!type) { await sock.sendMessage(chatJid, { text: 'Usage: *.race join ffa*' }, { quoted: message }); return; }
    type = type.toLowerCase();

    if (type === 'ffa') {
      const race = Object.values(activePvP).find(r => r.chatJid === chatJid && r.type === 'ffa' && r.status === 'recruiting');
      if (!race) { await sock.sendMessage(chatJid, { text: 'No FFA race recruiting right now.' }, { quoted: message }); return; }
      if (race.players.includes(sender)) { await sock.sendMessage(chatJid, { text: 'Already in this race' }, { quoted: message }); return; }

      const player = this.db.getPlayer(sender);
      const car    = this.getEquippedVehicle(player);
      if (!car) { await sock.sendMessage(chatJid, { text: 'Equip a vehicle first' }, { quoted: message }); return; }
      if (this.getVehicleType(car) === 'airplane') { await sock.sendMessage(chatJid, { text: `✈️ Planes are not allowed in FFA races!\nEquip a car, bike, or boat.` }, { quoted: message }); return; }
      if (player.cash < race.bet) { await sock.sendMessage(chatJid, { text: `Need $${race.bet.toLocaleString()} cash` }, { quoted: message }); return; }

      race.players.push(sender);
      await sock.sendMessage(chatJid, {
        text: `✅ ${this.db.getDisplayName(sender)} joined the FFA!\n👥 Players: ${race.players.length}/${race.maxPlayers}`
      }, { quoted: message });

      if (race.players.length >= race.maxPlayers) await this.runFFA(race.id, sock);
      return;
    }

    await sock.sendMessage(chatJid, { text: 'Unknown race type. Use *.race join ffa*' }, { quoted: message });
  }

  async runFFA(raceId, sock) {
    const race = activePvP[raceId];
    if (!race || race.status !== 'recruiting') return;
    race.status = 'running';

    const results = race.players.map(pid => {
      const p   = this.db.getPlayer(pid);
      const car = this.getEquippedVehicle(p) || { name: 'No Car', topSpeed: 100 };
      const spd = car.topSpeed + (Math.random() * 30 - 15);
      return { pid, name: this.db.getDisplayName(pid), car: car.name, speed: spd };
    }).sort((a, b) => b.speed - a.speed);

    const medals  = ['🥇', '🥈', '🥉'];
    const totalPot = race.bet * results.length;
    const payout   = Math.floor(totalPot * 0.97);
    const winner   = results[0];

    results.forEach(r => this.deductBet(r.pid, race.bet));
    this.addWin(winner.pid, race.bet * results.length / 2); // winner takes ~half the total pot

    let text = `🏁 *FFA RACE RESULTS!*\n💰 Pot: $${totalPot.toLocaleString()}\n\n`;
    results.forEach((r, i) => {
      text += `${medals[i] || `${i + 1}.`} ${r.name}  ⚡${Math.floor(r.speed)} km/h  (${r.car})\n`;
    });
    text += `\n🏆 Winner: *${winner.name}*\n💵 Payout: +$${payout.toLocaleString()} → Bank`;

    await sock.sendMessage(race.chatJid, { text }).catch(() => {});
    delete activePvP[raceId];
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────

  async showLeaderboard(chatJid, sock, message) {
    const all = Object.values(this.db.data.players)
      .filter(p => (p.stats?.racesWon || 0) > 0)
      .sort((a, b) => (b.stats?.racesWon || 0) - (a.stats?.racesWon || 0))
      .slice(0, 10);

    if (all.length === 0) {
      await sock.sendMessage(chatJid, { text: '🏆 No race data yet. Run *.race [bet]* to start!' }, { quoted: message }); return;
    }

    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
    let text = `🏆 *RACE LEADERBOARD*\n━━━━━━━━━━━━━━━━━\n\n`;
    all.forEach((p, i) => {
      const car = this.getEquippedVehicle(p);
      text += `${medals[i]} *${this.db.getDisplayName(p.id)}*\n`;
      text += `   🏁 ${p.stats.racesWon} wins  💰 $${(p.stats.moneyEarned||0).toLocaleString()} earned\n`;
      text += `   🚗 ${car ? car.name : 'No car'}\n\n`;
    });
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  async showGarage(player, sender, chatJid, sock, message) {
    if (!player.vehicles || player.vehicles.length === 0) {
      await sock.sendMessage(chatJid, { text: '🏠 Garage empty!\nBuy a car: *.vehicle shop*' }, { quoted: message }); return;
    }
    const idx = player.equippedVehicle ?? 0;
    let text = `🏠 *GARAGE* (${player.vehicles.length} cars)\n━━━━━━━━━━━━━━\n\n`;
    player.vehicles.forEach((v, i) => {
      const condStatus = this.getConditionStatus(v);
      const penalty    = v.conditions?.length > 0 ? this.CAR_CONDITIONS().filter(c => v.conditions.includes(c.id)).reduce((s,c)=>s+c.speedPenalty,0) : 0;
      text += `${i + 1}. ${v.emoji || '🚗'} *${v.name}*${i === idx ? ' ✅' : ''}\n`;
      text += `   ⚡ ${v.topSpeed} km/h  •  ${v.type}\n`;
      text += `   🔧 ${condStatus}${penalty > 0 ? ` (-${penalty} km/h)` : ''}\n\n`;
    });
    text += `Equip: *.race equip [n]*\nService: *.race service* — fix car issues`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async equipVehicle(args, player, sender, chatJid, sock, message) {
    if (!player.vehicles || player.vehicles.length === 0) {
      await sock.sendMessage(chatJid, { text: ' No vehicles!' }, { quoted: message }); return;
    }
    const num = parseInt(args[1]);
    if (isNaN(num) || num < 1 || num > player.vehicles.length) {
      await sock.sendMessage(chatJid, { text: ` Enter 1–${player.vehicles.length}` }, { quoted: message }); return;
    }
    player.equippedVehicle = num - 1;
    this.db.updatePlayer(sender, player);
    const v = player.vehicles[num - 1];
    await sock.sendMessage(chatJid, { text: `✅ Equipped: ${v.emoji || '🚗'} *${v.name}* (${v.topSpeed} km/h)` }, { quoted: message });
  }

  async showMenu(player, chatJid, sock, message) {
    const car = this.getEquippedVehicle(player);
    const text = [
      `🏎️ *STREET EMPIRE RACING*`,
      ``,
      `COMMANDS:`,
      `.race [bet]           — vs NPC  ($1k–$1M)`,
      `.race @player [bet]   — 1v1 challenge ($1k–$1M)`,
      `.race ffa [bet]       — Free For All (3 players)`,
      `.race join ffa        — Join active FFA`,
      `.race garage          — Your cars & condition`,
      `.race equip [n]       — Equip a car`,
      `.race service         — 🔧 Fix car after race`,
      `.race leaderboard     — Top racers`,
      ``,
      `🚗 Equipped: ${car ? `${car.name} (${car.topSpeed} km/h)` : 'None'}`,
      `🏁 Wins: ${player.stats?.racesWon || 0}`,
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

// Export activePvP and helpers for commandHandler to access
RacingCommand.activePvP   = activePvP;
RacingCommand.raceInvites = raceInvites;

module.exports = RacingCommand;

// ── TOURNAMENT SYSTEM ──────────────────────────────────────────────────────────
// Appended below the existing RacingCommand class

const activeTournaments = {}; // chatJid → tournament object

class RaceTournament {
  constructor(db) { this.db = db; this.racingCmd = null; }

  setRacingCmd(rc) { this.racingCmd = rc; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'menu' || sub === 'help') return this.showMenu(chatJid, sock, message);
    if (sub === 'create' || sub === 'new' || sub === 'c') return this.createTournament(args.slice(1), sender, chatJid, sock, message);
    if (sub === 'join'   || sub === 'j')                  return this.joinTournament(sender, chatJid, sock, message);
    if (sub === 'start'  || sub === 's')                  return this.forceTournamentStart(sender, chatJid, sock, message);
    if (sub === 'status' || sub === 'info')               return this.showStatus(chatJid, sock, message);
    if (sub === 'cancel' || sub === 'end')                return this.cancelTournament(sender, chatJid, sock, message);

    return this.showMenu(chatJid, sock, message);
  }

  async cancelTournament(sender, chatJid, sock, message) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: `No active tournament to cancel.` }, { quoted: message }); return; }
    if (t.hostId !== sender) { await sock.sendMessage(chatJid, { text: `Only the host can cancel the tournament.` }, { quoted: message }); return; }
    // Refund all players
    for (const pid of t.players) {
      const p = this.db.getPlayer(pid);
      p.cash = (p.cash || 0) + t.buyIn;
      this.db.updatePlayer(pid, p);
    }
    delete activeTournaments[chatJid];
    await sock.sendMessage(chatJid, { text: `🚫 Tournament cancelled. All buy-ins refunded.` }, { quoted: message });
  }

  async showMenu(chatJid, sock, message) {
    const t = activeTournaments[chatJid];
    const text = [
      `🏆 *RACE TOURNAMENT*`,
      `━━━━━━━━━━━━━━━━━━━`,
      `Bracket-style race. Up to 8 players, winner-takes-all.`,
      ``,
      `*COMMANDS:*`,
      `*.t c [buyIn]* — Create tournament`,
      `*.t j*         — Join tournament`,
      `*.t s*         — Start (host only)`,
      `*.t info*      — View bracket`,
      `*.t end*       — Cancel (host, refunds all)`,
      ``,
      `🚗 Cars only — planes not allowed!`,
      ``,
      t ? `⚡ ACTIVE: ${t.players.length} players | $${t.buyIn.toLocaleString()} buy-in` : `No active tournament in this chat.`,
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async createTournament(args, sender, chatJid, sock, message) {
    if (activeTournaments[chatJid]) {
      const t = activeTournaments[chatJid];
      await sock.sendMessage(chatJid, { text: `A tournament is already recruiting (${t.players.length} joined)\nUse *.tournament join*` }, { quoted: message }); return;
    }

    const buyIn = parseInt(args[0]) || 5000;
    if (buyIn < 1000) { await sock.sendMessage(chatJid, { text: `Min buy-in: $1,000` }, { quoted: message }); return; }

    const host = this.db.getPlayer(sender);
    if ((host.cash||0) < buyIn) {
      await sock.sendMessage(chatJid, { text: `Not enough cash for the buy-in` }, { quoted: message }); return;
    }

    // Planes not allowed in tournaments
    const tempRC = new (require('./racing'))(this.db);
    const hostCar = tempRC.getEquippedVehicle(host);
    if (!hostCar) { await sock.sendMessage(chatJid, { text: `You need a vehicle equipped to host!\n*.vehicle equip*` }, { quoted: message }); return; }
    const hostType = tempRC.getVehicleType(hostCar);
    if (hostType === 'airplane') { await sock.sendMessage(chatJid, { text: `✈️ Planes are not allowed in tournaments!\nEquip a car, bike, or boat.` }, { quoted: message }); return; }

    const t = {
      hostId:    sender,
      buyIn,
      players:   [sender],
      chatJid,
      status:    'recruiting',
      createdAt: Date.now(),
      maxPlayers: 8,
    };

    activeTournaments[chatJid] = t;

    // Deduct buy-in
    host.cash -= buyIn;
    this.db.updatePlayer(sender, host);

    await sock.sendMessage(chatJid, {
      text: [
        `🏆 *RACE TOURNAMENT CREATED!*`,
        ``,
        `🎙️ ${this.db.getDisplayName(sender)} is hosting!`,
        `💰 Buy-in: $${buyIn.toLocaleString()} each`,
        `👥 Players: 1/${t.maxPlayers}`,
        `⏳ Recruit phase: 30 minutes`,
        ``,
        `📣 Join with *.tournament join*`,
        `🏎️ Need a vehicle to enter!`,
      ].join('\n')
    }, { quoted: message });

    // Auto-start after 30 minutes
    setTimeout(async () => {
      const cur = activeTournaments[chatJid];
      if (!cur || cur.createdAt !== t.createdAt) return; // stale ref
      if (cur.status !== 'recruiting') return;
      if (cur.players.length < 2) {
        // Refund host
        const hPlayer = this.db.getPlayer(cur.hostId);
        hPlayer.cash = (hPlayer.cash||0) + cur.buyIn;
        this.db.updatePlayer(cur.hostId, hPlayer);
        delete activeTournaments[chatJid];
        await sock.sendMessage(chatJid, { text: `Tournament cancelled — not enough players joined after 30 minutes. Buy-in refunded.` }).catch(() => {});
        return;
      }
      await this.runTournament(chatJid, sock);
    }, 30 * 60 * 1000);
  }

  async joinTournament(sender, chatJid, sock, message) {
    const t = activeTournaments[chatJid];
    if (!t || t.status !== 'recruiting') {
      await sock.sendMessage(chatJid, { text: `No active tournament recruiting.\nStart one: *.tournament create [buyIn]*` }, { quoted: message }); return;
    }
    if (t.players.includes(sender)) {
      await sock.sendMessage(chatJid, { text: ` Already in the tournament!` }, { quoted: message }); return;
    }
    if (t.players.length >= t.maxPlayers) {
      await sock.sendMessage(chatJid, { text: ` Tournament is full! (${t.maxPlayers} players)` }, { quoted: message }); return;
    }

    const p = this.db.getPlayer(sender);
    const RacingCommandClass = require('./racing');
    const tempRC = new RacingCommandClass(this.db);
    const car = tempRC.getEquippedVehicle(p);
    if (!car) { await sock.sendMessage(chatJid, { text: ` You need a vehicle to race!\n*.vehicle shop*` }, { quoted: message }); return; }

    // Planes not allowed in tournaments
    const carType = tempRC.getVehicleType(car);
    if (carType === 'airplane') { await sock.sendMessage(chatJid, { text: `✈️ Planes are not allowed in tournaments!\nEquip a car, bike, or boat.` }, { quoted: message }); return; }

    if ((p.cash||0) < t.buyIn) {
      await sock.sendMessage(chatJid, { text: ` Need $${t.buyIn.toLocaleString()} to join!` }, { quoted: message }); return;
    }

    p.cash -= t.buyIn;
    this.db.updatePlayer(sender, p);
    t.players.push(sender);

    await sock.sendMessage(chatJid, {
      text: [
        `✅ *${this.db.getDisplayName(sender)} joined the tournament!*`,
        `👥 Players: ${t.players.length}/${t.maxPlayers}`,
        `💸 Buy-in paid: $${t.buyIn.toLocaleString()}`,
        t.players.length >= t.maxPlayers ? `\n⚡ Tournament full! Starting soon...` : ``,
      ].join('\n')
    }, { quoted: message });

    if (t.players.length >= t.maxPlayers) {
      await this.runTournament(chatJid, sock);
    }
  }

  async forceTournamentStart(sender, chatJid, sock, message) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: ` No active tournament.` }, { quoted: message }); return; }
    if (t.hostId !== sender) { await sock.sendMessage(chatJid, { text: ` Only the tournament host can force-start.` }, { quoted: message }); return; }
    if (t.players.length < 2) { await sock.sendMessage(chatJid, { text: ` Need at least 2 players to start!` }, { quoted: message }); return; }
    await this.runTournament(chatJid, sock);
  }

  async showStatus(chatJid, sock, message) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: `🏆 No active tournament in this chat.` }, { quoted: message }); return; }
    const lines = [
      `🏆 *TOURNAMENT STATUS*`,
      `💰 Buy-in: $${t.buyIn.toLocaleString()} | Pot: $${(t.buyIn * t.players.length).toLocaleString()}`,
      `👥 Players (${t.players.length}):`,
    ];
    t.players.forEach((pid, i) => lines.push(`  ${i+1}. ${this.db.getDisplayName(pid)}`));
    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  async runTournament(chatJid, sock) {
    const t = activeTournaments[chatJid];
    if (!t || t.status !== 'recruiting') return;
    t.status = 'running';

    const RacingCommandClass = require('./racing');
    const tempRC = new RacingCommandClass(this.db);

    // Shuffle players for bracket
    const players = [...t.players].sort(() => Math.random() - 0.5);
    const totalPot = t.buyIn * players.length;

    await sock.sendMessage(chatJid, {
      text: [
        `🏆 *TOURNAMENT STARTING!*`,
        `💰 Total Pot: $${totalPot.toLocaleString()}`,
        `👥 ${players.length} racers locked in`,
        ``,
        `🏁 Bracket races commencing...`,
      ].join('\n')
    });

    let currentRound = [...players];
    let roundNum = 1;

    while (currentRound.length > 1) {
      const nextRound = [];
      const roundText = [`\n🔔 *ROUND ${roundNum}*`];

      // Pair up racers; if odd, last player gets a bye
      for (let i = 0; i < currentRound.length; i += 2) {
        if (i + 1 >= currentRound.length) {
          // Bye
          nextRound.push(currentRound[i]);
          roundText.push(`⚡ ${this.db.getDisplayName(currentRound[i])} — AUTO-ADVANCE (bye)`);
          continue;
        }

        const p1Id = currentRound[i];
        const p2Id = currentRound[i+1];
        const p1   = this.db.getPlayer(p1Id);
        const p2   = this.db.getPlayer(p2Id);
        const p1Car = tempRC.getEquippedVehicle(p1) || { topSpeed: 100 };
        const p2Car = tempRC.getEquippedVehicle(p2) || { topSpeed: 100 };

        const p1Speed = p1Car.topSpeed + (Math.random() * 30 - 15);
        const p2Speed = p2Car.topSpeed + (Math.random() * 30 - 15);

        const winnerId = p1Speed >= p2Speed ? p1Id : p2Id;
        const loserId  = p1Speed >= p2Speed ? p2Id : p1Id;
        nextRound.push(winnerId);

        const wName = this.db.getDisplayName(winnerId);
        const lName = this.db.getDisplayName(loserId);
        roundText.push(`🏁 ${this.db.getDisplayName(p1Id)} (${Math.floor(p1Speed)}km/h) vs ${this.db.getDisplayName(p2Id)} (${Math.floor(p2Speed)}km/h)`);
        roundText.push(`   ✅ ${wName} advances |  ${lName} eliminated`);
      }

      await sock.sendMessage(chatJid, { text: roundText.join('\n') });
      currentRound = nextRound;
      roundNum++;
    }

    // Champion!
    const champId   = currentRound[0];
    const champ     = this.db.getPlayer(champId);
    const champName = this.db.getDisplayName(champId);

    // Award prizes: 1st=70%, 2nd=20%, 3rd=10% (approximate)
    const prize1 = Math.floor(totalPot * 0.70);
    champ.cash  = (champ.cash||0) + prize1;
    champ.experience = (champ.experience||0) + 100;
    champ.stats = champ.stats || {};
    champ.stats.racesWon = (champ.stats.racesWon||0) + 1;
    this.db.updatePlayer(champId, champ);

    await sock.sendMessage(chatJid, {
      text: [
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🏆 *TOURNAMENT CHAMPION*`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `👑 *${champName}* takes the crown`,
        ``,
        `💰 Prize Pool: $${totalPot.toLocaleString()}`,
        `🥇 Champion payout: +$${prize1.toLocaleString()}`,
        `⭐ +100 XP`,
        ``,
        `💵 Cash: $${champ.cash.toLocaleString()}`,
        `🏁 Total Race Wins: ${champ.stats.racesWon}`,
      ].join('\n')
    });

    delete activeTournaments[chatJid];
  }
}

module.exports.RaceTournament = RaceTournament;
