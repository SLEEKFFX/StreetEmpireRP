class HelpCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    // Subcommand pages to keep messages short on WhatsApp
    if (sub === 'house' || sub === 'housing') return this._sendHousing(chatJid, sock, message);
    if (sub === 'guns')   return this._sendGuns(chatJid, sock, message);
    if (sub === 'val')    return this._sendValuables(chatJid, sock, message);
    if (sub === 'crew')   return this._sendCrew(chatJid, sock, message);
    if (sub === 'raid')   return this._sendRaid(chatJid, sock, message);
    if (sub === 'crypto' || sub === 'c') return this._sendCrypto(chatJid, sock, message);
    if (sub === 'boxing' || sub === 'box') return this._sendBoxing(chatJid, sock, message);
    if (sub === 'hospital' || sub === 'hosp') return this._sendHospital(chatJid, sock, message);
    if (sub === 'police' || sub === 'prison') return this._sendPolice(chatJid, sock, message);
    if (sub === 'ttt' || sub === 'tictactoe') return this._sendTTT(chatJid, sock, message);
    if (sub === 'tournament') return this._sendTournament(chatJid, sock, message);

    const helpText = `
╔══════════════════════════════════╗
║  📖 STREET EMPIRE RP v7.0
║  WhatsApp GTA-Style Game
╚══════════════════════════════════╝

🎮 QUICK START:
1. .menu        — Main menu & stats
2. .profile     — Your profile & XP
3. .heist       — Earn cash
4. .daily       — Free daily reward
5. .vehicle shop — Buy your first car

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 EARNING MONEY:
• .heist solo store_robbery   — $5k–$15k
• .heist solo money_heist     — $30k–$100k
• .heist start bank_heist [@p] — $500k (3-5 players)
• .business list / collect    — Passive income
• .race [amount]              — Race for cash
• .gamble roulette [amount]   — Casino
• .crypto buy SON 1000         — Crypto trading

🏠 PROPERTY:
• .house list                 — Browse homes
• .house buy [type]           — Purchase
• .house rent [type]          — Rent ($100k–$5M/6h)
• .house vault store [item]   — Store valuables
• .house sec hire [type]      — Hire security
• .help house                 — Full housing guide

💎 VALUABLES:
• .val market   — Live prices
• .val buy gold 5 / .val sell diamond 2
• .val store gold 3 — Move to vault
• .help val     — Full valuables guide

🔫 GUNS:
• .guns shop / .guns buy [id]
• .guns equip [id] / .guns arsenal
• .help guns    — Full guns guide

👥 CREWS:
• .crew create [name] — Start ($50k)
• .crew war [crew]    — Declare war!
• .crew lb            — Crew leaderboard
• .help crew          — Full crew guide

🏚️ RAIDS:
• .raid @player       — Rob their house (solo)
• .raid @player @crew — Crew raid (more power)
• .help raid          — Full raid guide

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏦 BANKING:
• .bank balance / deposit [amt] / withdraw [amt]
• .bank transfer @player [amt]
• .bank history

📊 RANKS (by XP):
Street Rat → Corner Boy → Soldier → Shot Caller → Crime Lord → 👑 Godfather
🔒 Max Level: 50

HELP PAGES:
• .help house  • .help guns  • .help val
• .help crew   • .help raid  • .help crypto
• .help boxing • .help hospital • .help police
• .help ttt    • .help tournament

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👨‍💻 DEVS: SLEEKYODADDY & EXODIAL
Bugs? Contact +2348131686152
v7.0 | May 2026
    `;
    await sock.sendMessage(chatJid, { text: helpText.trim() }, { quoted: message });
  }

  async _sendHousing(chatJid, sock, message) {
    const text = `🏠 *HOUSING GUIDE*

*House Types:* (rent/6h → buy price)
• studio      — $150k/6h (rent only)
• apartment   — $375k/6h | Buy $1.5M
• duplex      — $750k/6h | Buy $5.25M
• bungalow    — $1.2M/6h | Buy $10.5M
• townhouse   — $1.8M/6h | Buy $22.5M
• villa       — $3M/6h   | Buy $60M
• mansion     — $5.25M/6h | Buy $150M
• penthouse   — $7.5M/6h | Buy $300M

*Commands:*
.house list
.house buy [type] / .house rent [type]
.house info
.house vault view
.house vault store [item] [qty]
.house vault take [item] [qty]
.house garage
.house sec list
.house sec hire [watchman/guard/specialist/elite]
.house sec fire
.house sell / .house leave

*Security (cost/hour, auto-deducted):*
👮 Watchman     — $5k/hr  (+5% def)
💂 Armed Guard  — $15k/hr (+15% def)
🕵️ Specialist   — $40k/hr (+30% def)
🦅 Elite Unit   — $100k/hr (+55% def)

⚠️ Keep funds available! Guards leave if unpaid for 10 min.
Shortcut: .h info | .h vault | .h sec`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sendGuns(chatJid, sock, message) {
    const text = `🔫 *GUNS GUIDE*

*Commands:*
.guns shop           — Browse all weapons
.guns buy [id]       — Purchase gun
.guns equip [id]     — Equip for combat
.guns arsenal        — Your weapons
.guns drop [id]      — Discard
Shortcut: .g shop / .g buy [id]

*Types:* Pistol, SMG, Shotgun, Rifle, Sniper, Heavy

*How guns affect combat:*
• Crew wars: higher firepower = better war score
• House raids: more damage = higher success rate
• Rob: no direct effect (yet)

Buy guns before declaring crew wars or raiding!`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sendValuables(chatJid, sock, message) {
    const text = `💎 *VALUABLES GUIDE*

*Items:* gold | silver | diamond | ruby | emerald | platinum

*Commands:*
.val market           — Live prices
.val buy [item] [qty] — Buy (from bank/cash)
.val sell [item] [qty] — Sell (5% fee)
.val inv              — Your holdings
.val store [item] [qty] — Move to house vault

*Tips:*
• Prices change every 10 min
• Buy low, sell high
• Store in house vault for protection (can't be stolen from raid)
• Vault items can still be raided if attacker rolls lucky

*Price range:* 50%–250% of base value
Base prices:
Gold $127k | Silver $6.75k | Diamond $750k
Ruby $375k | Emerald $270k | Platinum $180k`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sendCrew(chatJid, sock, message) {
    const text = `👥 *CREW GUIDE*

*Create & Join:*
.crew create [name]   — Create ($50k cash)
.crew join [name]     — Join a crew
.crew info            — Your crew stats
.crew members         — Member list

*Leader Commands:*
.crew invite @player  — Send invite
.crew kick @player    — Remove member
.crew promote @player — Set asst. leader
.crew rename [name]   — Rename ($100k)
.crew slang [text]    — Set crew motto ($25k)
.crew war [crew name] — Declare war!

*War System:*
Power = (player levels + guns) × members + crew level
Winner gets +50 crew XP, members get +20 XP

*Crew Leaderboard:*
.crew lb — Ranked by war wins & networth

*Limits:* Max 10 members | Max name 30 chars`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sendRaid(chatJid, sock, message) {
    const text = `🏚️ *RAID GUIDE*

*Commands:*
.raid @player         — Solo raid
.raid @player @crew   — Crew raid (higher power)

*Requirements:*
• Target must have a house (.house list)
• 2-hour cooldown between raids

*Success Chance:*
= 40% + (your level + guns - their security)
• Capped between 10% and 80%
• Crew partner adds 50% of their power

*If successful:*
• Steal 20–30% of their cash
• 40% chance to steal a vault item (30% of 1 stack)

*If failed:*
• You pay a 5% fine on your cash
• 2hr cooldown still applies

*Tips:*
• Level up + buy guns to boost attack power
• Hire security to protect your own house
• Keep cash in bank — it's safer from raids`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _sendCrypto(chatJid, sock, message) {
    const text = `💹 *CRYPTO GUIDE*

*Commands:*
.c m / .crypto market   — Live prices
.c buy [coin] [amount]  — Buy crypto (asks confirm)
.c sell [coin] [amount] — Sell crypto (asks confirm)
.c w / .c wallet        — Your wallet
.c hist                 — Transaction history
.c send @player [amt]   — Transfer

*Coins:* SON WCUP BOYS GTA6 SIXSEVEN BTC ECLIPSE ELECT AI RUGCITY OSCARS FLARE

*Safe coins (no rug pull):*
😭 SON | ⚽ WCUP | 🦸🏽‍♂️ BOYS | 🚗 GTA6 | 🪙 BTC

*Risky coins:* may rug pull (lose all value!)
*Market:* open 24/7

*Fees:* 1% on all transactions
*Market persists across bot restarts*`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

module.exports = HelpCommand;

// Appended help methods for v7 features (after original class closing brace)
const _originalHelpClass = HelpCommand;
// Monkey-patch new methods onto HelpCommand
HelpCommand.prototype._sendBoxing = async function(chatJid, sock, message) {
  const text = `🥊 *STREET BOXING GUIDE*

*HOW TO FIGHT:*
1. Challenge someone: *.box @player [bet]*
2. Target replies: *.box accept* or *.box decline*
3. Fight is automatic — turn-by-turn simulation
4. Commentary, skill moves, and health bars shown

*SKILL MOVES:*
• Lightning Jab — Fast, reliable
• Power Cross — Heavy damage
• Left Hook — Jaw crusher
• Uppercut — Big hit, lower chance
• Body Shot — Rib damage
• Wild Haymaker — HUGE damage, risky
• 3-Hit Combo — Multi-hit burst
• Slip & Counter — Defensive

*OUTCOME TYPES:*
🏆 Flawless Victory — Win with opponent < 20HP remaining
   → +$5,000 bonus + bet winnings
😤 Close Win — Opponent > 75HP remaining when you win
   → +$2,000 bonus + bet winnings
🥊 Normal Win — Standard win
   → Bet winnings
😅 Close Loss — You had 75+ HP when you lose
   → $1,000 consolation prize
😳 Humiliation Loss — You had < 20HP
   → 3 injuries at hospital

*HOSPITAL:*
• Loser always goes to hospital with injuries
• Flawless loss = 3 injuries (concussion, broken rib, broken nose)
• Normal loss = 2 injuries (black eye, bruised ribs)
• Close loss = 1 injury (puffy face)
• Treat injuries with *.hospital treat [n]*

*REQUIREMENTS:*
• Minimum 20 HP to fight
• Cooldown: 20 minutes per fight
• Bet: $500 minimum (or $0 for free match)`;
  await sock.sendMessage(chatJid, { text }, { quoted: message });
};

HelpCommand.prototype._sendHospital = async function(chatJid, sock, message) {
  const text = `🏥 *HOSPITAL GUIDE*

*COMMANDS:*
• *.hospital* — Visit the hospital menu
• *.hospital treat [1-9]* — Pay to treat an injury
• *.hospital food [item]* — Buy food to restore HP
• *.hospital status* — See all your injuries

*INJURIES (from boxing):*
• 🤕 Puffy Face — $1,500 to treat (+5 HP)
• 👁️ Black Eye — $2,000 to treat (+10 HP)
• 👃 Broken Nose — $3,500 to treat (+15 HP)
• 🤝 Sprained Wrist — $4,000 (+20 HP)
• 🩹 Bruised Ribs — $5,000 (+20 HP)
• 🩻 Broken Rib — $8,000 (+30 HP)
• 😮 Dislocated Jaw — $7,000 (+25 HP)
• 🧠 Concussion — $12,000 (+40 HP)

*FOOD SHOP (restore HP without treating injuries):*
• Snack Bar — $500 (+10 HP)
• Sandwich — $1,500 (+25 HP)
• Full Meal — $4,000 (+50 HP)
• Green Smoothie — $3,000 (+40 HP)
• Premium Steak — $12,000 (+100 HP = full recovery)

*HP EFFECTS:*
• Below 20 HP: Cannot box or do heists
• Injuries stay until treated (even after food)
• Food restores HP but doesn't cure injuries`;
  await sock.sendMessage(chatJid, { text }, { quoted: message });
};

HelpCommand.prototype._sendPolice = async function(chatJid, sock, message) {
  const text = `🚔 *POLICE & PRISON GUIDE*

*REPORTING A CRIMINAL:*
• *.police report @player rob* — Report a robber
• *.police report @player raid* — Report a raider
• Cost: $5,000 filing fee
• Effect: Suspect goes to prison for 1 hour
• Cooldown: 30 minutes between reports

*ESCAPING PRISON (if you're arrested):*
• *.police bribe* — Attempt to bribe the officer
• Cost: $10,000 base + $5,000 per heat level
• 40% success — you walk free
• 60% fail — lose cash + 30 min added to sentence!

*PRISON EFFECTS:*
• Cannot earn income from businesses while imprisoned
• Cannot raid or rob others
• Heat level increases with each arrest

*HEAT LEVEL:*
• 0-1: Low Profile — cheapest bribes
• 2-4: Person of Interest
• 5-6: Hot Commodity — expensive bribes
• 7-8: Wanted Criminal
• 9-10: Public Enemy #1 — very costly bribes

*OTHER COMMANDS:*
• *.police status* — Your prison status & heat
• *.police wanted* — See who's currently in prison`;
  await sock.sendMessage(chatJid, { text }, { quoted: message });
};

HelpCommand.prototype._sendTTT = async function(chatJid, sock, message) {
  const text = `⭕ *TIC TAC TOE GUIDE*

*PvP Tic Tac Toe with bets!*

*HOW TO PLAY:*
1. *.ttt @player [bet]* — Challenge someone
2. Target replies *.ttt accept* or *.ttt decline*
3. Take turns with *.ttt [1-9]* to place marks
4. First to get 3 in a row wins!

*BOARD POSITIONS:*
1️⃣ | 2️⃣ | 3️⃣
─────────
4️⃣ | 5️⃣ | 6️⃣
─────────
7️⃣ | 8️⃣ | 9️⃣

*RULES:*
• ❌ = challenger  |  ⭕ = accepter
• Challenger goes first
• Tie = both get bet refunded
• Winner earns opponent's bet
• Minimum bet: $200 (or free match at $0)
• Both players must stay in group to play

*XP REWARDS:*
• Win: +15 XP
• Loss: +5 XP`;
  await sock.sendMessage(chatJid, { text }, { quoted: message });
};

HelpCommand.prototype._sendTournament = async function(chatJid, sock, message) {
  const text = `🏆 *RACE TOURNAMENT GUIDE*

*Bracket-style race tournament with a shared pot!*

*HOW IT WORKS:*
1. *.tournament create [buyIn]* — Host starts recruiting
2. Players join with *.tournament join*
3. 30-minute recruit phase (or fill up to 8 players)
4. Bracket races run automatically
5. Winner takes 70% of the pot!

*REQUIREMENTS:*
• Need an equipped vehicle to join
• Buy-in minimum: $1,000
• 2-8 players (single elimination bracket)
• Host can force-start with *.tournament start*

*PRIZE DISTRIBUTION:*
• 🥇 Champion: 70% of total pot
• 🥈 Runner-up: 20% of total pot
• 🥉 3rd place: 10% of total pot

*OTHER COMMANDS:*
• *.tournament status* — See current players & pot
• *.tournament join* — Enter the active tournament

*NOTES:*
• Buy-in deducted at join time
• If cancelled (< 2 players after 30m), refund issued
• Race results based on vehicle top speed + randomness`;
  await sock.sendMessage(chatJid, { text }, { quoted: message });
};
