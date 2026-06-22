const MenuCommand        = require('./menu');
const ProfileCommand     = require('./profile');
const BusinessCommand    = require('./business');
const HeistCommand       = require('./heists');
const VehicleCommand     = require('./vehicles');
const BankingCommand     = require('./banking');
const GamblingCommand    = require('./gambling');
const RacingCommand      = require('./racing');
const HelpCommand        = require('./help');
const CrewCommand        = require('./crew');
const UptimeCommand      = require('./uptime');
const DailyCommand       = require('./daily');
const InventoryCommand   = require('./inventory');
const UsernameCommand    = require('./username');
const LeaderboardCommand = require('./leaderboard');
const RobCommand         = require('./rob');
const CryptoCommand      = require('./crypto');
const HousingCommand     = require('./housing');
const ValuablesCommand   = require('./valuables');
const GunsCommand        = require('./guns');
const RaidCommand        = require('./raid');
// ── NEW v5 commands ────────────────────────────────────────────
const { HospitalCommand }  = require('./hospital');
const { BoxingCommand }    = require('./boxing');
const { TicTacToeCommand } = require('./tictactoe');
const PoliceCommand        = require('./police');
const StatsCommand         = require('./stats');
const { RaceTournament }   = require('./racing');
const CooldownCommand      = require('./cooldowns');
const { GymCommand }       = require('./gym');
const { normJid: normalizeJid } = require('../utils/resolveMention'); // shared normalization
const PingCommand    = require('./ping');
const UpdateCommand  = require('./update');
// utility.js split into separate files — loaded dynamically

const LEVEL_UP_REWARDS = {
  1:0,2:5000,3:8000,4:12000,5:18000,6:25000,7:35000,8:50000,
  9:70000,10:100000,11:140000,12:180000,13:230000,14:290000,
  15:360000,16:440000,17:530000,18:630000,19:750000,20:1000000,
};

// ── Pending confirmation store — UNIQUE TOKEN SYSTEM (BETA)─────────────────────────
// Each pending action gets a unique 4-digit token (e.g. "confirm 3847").
// This eliminates all conflicts between simultaneous pending confirmations
// from different commands (business, vehicle, crew invite, war, boxing, racing, TTT).
const pendingConfirm = {};

let _tokenCounter = Math.floor(Math.random() * 9000) + 1000;
function _nextToken() {
  _tokenCounter = (_tokenCounter % 9999) + 1;
  return String(_tokenCounter).padStart(4, '0');
}

// setPending now returns the token so callers can include it in the prompt message
function setPending(sender, entry) {
  const token = _nextToken();
  pendingConfirm[`${sender}:${token}`] = { ...entry, token, expiresAt: Date.now() + 2 * 60 * 1000 };
  return token; // caller MUST show this token to the user
}

// Find and pop a pending entry that matches sender + token
function popPending(sender, token) {
  const key = `${sender}:${token}`;
  const p   = pendingConfirm[key];
  if (!p) return null;
  delete pendingConfirm[key];
  if (Date.now() > p.expiresAt) return null;
  return p;
}

// Parse "confirm XXXX" or "cancel XXXX" from raw message text
// Returns { action: 'confirm'|'cancel', token: '0000' } or null
function parseTokenReply(raw) {
  const m = raw.trim().match(/^(confirm|cancel)\s+(\d{4})$/i);
  if (!m) return null;
  return { action: m[1].toLowerCase(), token: m[2] };
}

class CommandHandler {
  constructor(db, botStats) {
    this.db        = db;
    this.botStats  = botStats;
    this.sock      = null;
    this.groupJid  = null;

    this.commands = {
      menu:         new MenuCommand(db),
      moneymenu:    null,
      crimemenu:    null,
      propmenu:     null,
      pvpmenu:      null,
      socialmenu:   null,
      utilitymenu:  null,
      profile:      new ProfileCommand(db),
      business:     new BusinessCommand(db, setPending),
      heist:        new HeistCommand(db),
      vehicle:      new VehicleCommand(db, setPending),
      bank:         new BankingCommand(db),
      gamble:       new GamblingCommand(db),
      race:         new RacingCommand(db),
      help:         new HelpCommand(db),
      crew:         new CrewCommand(db),
      uptime:       new UptimeCommand(db, botStats),
      daily:        new DailyCommand(db),
      inventory:    new InventoryCommand(db),
      name:         new UsernameCommand(db),
      leaderboard:  new LeaderboardCommand(db),
      rob:          new RobCommand(db),
      crypto:       new CryptoCommand(db),
      house:        new HousingCommand(db),
      val:          new ValuablesCommand(db),
      guns:         new GunsCommand(db),
      raid:         new RaidCommand(db),
      // ── v5 new commands ──────────────────────────────────────────
      hospital:     new HospitalCommand(db),
      box:          new BoxingCommand(db),
      ttt:          new TicTacToeCommand(db),
      police:       new PoliceCommand(db),
      stats:        new StatsCommand(db),
      tournament:   new RaceTournament(db),
      cooldown:     new CooldownCommand(db),
      gym:          new GymCommand(db),
      ping:         new PingCommand(db),
      // utility commands now loaded dynamically from split files
      update:       null, // set below after self-reference
      cd:           null,
      // aliases
      lb:           null,
      hosp:         null,
      boxing:       null,
      tictactoe:    null,
      cop:          null,
      c:            null,
      h:            null,
      g:            null,
      t:            null,
    };
    this.commands.lb = this.commands.leaderboard;
    // Sub-menu aliases — delegate to MenuCommand with a pre-set arg
    ['moneymenu','crimemenu','propmenu','pvpmenu','socialmenu','utilitymenu'].forEach(k => {
      this.commands[k] = { execute: (args, sender, chatJid, sock, message) =>
        this.commands.menu.execute([k.replace('menu','')], sender, chatJid, sock, message) };
    });
    this.commands.c  = this.commands.crypto;
    // Update command needs reference to this commandHandler instance for hot-reload
    this.commands.update = new UpdateCommand(db, this);

    // utility split commands (sticker, warn, antilink, moderation, botstatus, groupsettings)
    // are all loaded automatically by loadDynamicCommands() — no manual wiring needed here
    this.commands.h    = this.commands.house;
    this.commands.move = { execute: (a,s,c,sk,m) => this.commands.house.execute(['move',...a], s, c, sk, m) };

    // botstatus extra commands
    if (this.commands.botstatus) {
      const bs = this.commands.botstatus;
      this.commands.setpp  = { execute: (a,s,c,sk,m) => bs.setpp(a,s,c,sk,m) };
      this.commands.setbio = { execute: (a,s,c,sk,m) => bs.setbio(a,s,c,sk,m) };
    }
    this.commands.g  = this.commands.guns;
    this.commands.t  = this.commands.tournament;
    this.commands.hosp       = this.commands.hospital;
    this.commands.boxing     = this.commands.box;
    this.commands.tictactoe  = this.commands.ttt;
    this.commands.cop        = this.commands.police;
    this.commands.cd         = this.commands.cooldown;

    // .accept trans / .decline trans — handled by banking
    this.commands.accept  = { execute: (a,s,ch,sk,m) => {
      if ((a[0]||'').toLowerCase() === 'trans') return this.commands.bank.execute(['accept','trans'],s,ch,sk,m);
      return sk.sendMessage(ch,{text:'```unknown command — try .menu```'},{quoted:m});
    }};
    this.commands.decline = { execute: (a,s,ch,sk,m) => {
      if ((a[0]||'').toLowerCase() === 'trans') return this.commands.bank.execute(['decline','trans'],s,ch,sk,m);
      return sk.sendMessage(ch,{text:'```unknown command — try .menu```'},{quoted:m});
    }};

    this._startDailyPrizeScheduler();

    // ── Auto-migrate existing players to have boxStats ──────────
    // Runs once on startup; safe to call every time (no-op if already migrated)
    setImmediate(() => {
      try { this.commands.box.migrateExistingPlayers(); } catch(e) {}
    });

    // ── Dynamic command auto-loader ──────────────────────────────────────
    // Scans /src/commands/ for any .js files NOT already registered above.
    // This lets new feature files (e.g. a downloader) be dropped in and
    // picked up automatically — no manual wiring needed.
    this.loadDynamicCommands();
  }

  // ─────────────────────────────────────────────────────────────────────
  //  DYNAMIC COMMAND LOADER
  // ─────────────────────────────────────────────────────────────────────
  //
  //  Any .js file in /src/commands/ that exports a `commands` map will be
  //  auto-registered, e.g.:
  //
  //    class DownloaderCommand {
  //      async execute(args, sender, chatJid, sock, message) { ... }
  //      async ytDownload(args, sender, chatJid, sock, message) { ... }
  //    }
  //    module.exports = DownloaderCommand;
  //    module.exports.commands = {
  //      dl:       'execute',     // .dl       → instance.execute()
  //      download: 'execute',     // .download → instance.execute()
  //      yt:       'ytDownload',  // .yt       → instance.ytDownload()
  //    };
  //
  //  Files already wired manually above are skipped automatically (their
  //  command keys already exist in this.commands).
  // ─────────────────────────────────────────────────────────────────────
  loadDynamicCommands() {
    const fs   = require('fs');
    const path = require('path');
    const dir  = __dirname;

    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'commandHandler.js');
    } catch (e) {
      console.error('[dynamic-loader] could not read commands dir:', e.message);
      return;
    }

    for (const filename of files) {
      const fullPath = path.join(dir, filename);
      let mod;
      try {
        mod = require(fullPath);
      } catch (e) {
        console.error(`[dynamic-loader] failed to load ${filename}:`, e.message);
        continue;
      }

      const cmdMap = mod?.commands;
      if (!cmdMap || typeof cmdMap !== 'object') continue; // no dynamic export — skip

      // Find the class constructor (default export, or first function export)
      let Cls = null;
      if (typeof mod === 'function') Cls = mod;
      else {
        Cls = Object.values(mod).find(v => typeof v === 'function');
      }
      if (!Cls) {
        console.error(`[dynamic-loader] ${filename} exports 'commands' but no class found`);
        continue;
      }

      let instance;
      try {
        instance = new Cls(this.db);
      } catch (e) {
        console.error(`[dynamic-loader] failed to instantiate ${filename}:`, e.message);
        continue;
      }

      let registered = 0;
      for (const [cmdKey, methodName] of Object.entries(cmdMap)) {
        const key = cmdKey.toLowerCase();
        if (this.commands[key]) continue; // don't override existing commands

        const method = instance[methodName];
        if (typeof method !== 'function') {
          console.error(`[dynamic-loader] ${filename}: method '${methodName}' not found for .${key}`);
          continue;
        }

        this.commands[key] = {
          execute: (...callArgs) => method.apply(instance, callArgs),
        };
        registered++;
      }

      if (registered > 0) {
        console.log(`[dynamic-loader] loaded ${filename}: ${Object.keys(cmdMap).map(k => '.' + k).join(', ')}`);
      }
    }
  }

  // ── Daily Prize Scheduler ─────────────────────────────────────────────────
  _startDailyPrizeScheduler() {
    const WAT_OFFSET = 1 * 60 * 60 * 1000;

    const msUntil2000WAT = () => {
      const nowUTC  = Date.now();
      const nowWAT  = new Date(nowUTC + WAT_OFFSET);
      const target  = new Date(nowWAT);
      target.setHours(20, 0, 0, 0);
      let diff = target.getTime() - nowWAT.getTime();
      if (diff <= 0) diff += 24 * 60 * 60 * 1000;
      return diff;
    };

    const schedulePrize = () => {
      const delay = msUntil2000WAT();
      console.log(`[Daily Prize] Next payout in ${Math.round(delay / 60000)} minutes`);
      setTimeout(async () => {
        await this._payDailyPrizes();
        setTimeout(schedulePrize, 60_000);
      }, delay);
    };

    schedulePrize();
  }

  async _payDailyPrizes() {
    try {
      const allPlayers = Object.values(this.db.data.players);
      if (allPlayers.length === 0) return;

      const HOUSE_PRICES = {apartment:1e6,duplex:3.5e6,bungalow:7e6,townhouse:15e6,villa:40e6,mansion:100e6,penthouse:200e6};
      const VAL_BASE = {gold:85000,silver:4500,diamond:500000,ruby:250000,emerald:180000,platinum:120000};
      const calcNW = (p) => {
        let n = (p.cash||0) + (p.bank||0)
          + (p.vehicles||[]).reduce((s,v)=>s+(v.price||0),0)
          + (p.businesses||[]).reduce((s,b)=>s+(b.price||0),0);
        if (p.house?.owned && p.house?.type) n += HOUSE_PRICES[p.house.type]||0;
        const cMkt = this.db.data.cryptoMarketState?.market||{};
        for (const [sym,pos] of Object.entries(p.crypto||{})) if (pos?.amount>0&&cMkt[sym]?.price) n+=pos.amount*cMkt[sym].price;
        const vMkt = this.db.data.valuableMarket||{};
        for (const loc of [p.inventory||{}, p.house?.vault||{}])
          for (const [k,qty] of Object.entries(loc)) if (VAL_BASE[k]&&qty>0) n+=(vMkt[k]?.price||VAL_BASE[k])*qty;
        return Math.round(n);
      };

      const sorted = [...allPlayers].sort((a, b) => calcNW(b) - calcNW(a)).slice(0, 3);
      const prizes = [
        { cash: 200_000, xp: 100, label: '🥇 Rank 1' },
        { cash: 100_000, xp:  75, label: '🥈 Rank 2' },
        { cash:  50_000, xp:  50, label: '🥉 Rank 3' },
      ];

      let announcement = `🏆 *DAILY LEADERBOARD PRIZES!* 🏆\n\n20:00 WAT — Today's top earners rewarded!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      sorted.forEach((p, i) => {
        const prize       = prizes[i];
        const displayName = p.nickname || p.name || p.id?.split('@')[0] || 'Unknown';
        p.bank            = (p.bank || 0) + prize.cash;
        p.experience      = (p.experience || 0) + prize.xp;
        this.db._applyRole(p);
        this.db.updatePlayer(p.id, p);
        BankingCommand.recordExternal(this.db, p.id, {
          type: 'Daily Prize', amount: prize.cash,
          sender: 'Street Empire HQ', receiver: displayName,
          note: `${prize.label} Daily Leaderboard Prize`, balance: p.bank,
        });
        announcement += `${prize.label}: *${displayName}*\n`;
        announcement += `   💰 +$${prize.cash.toLocaleString()}  ⭐ +${prize.xp} XP\n`;
        announcement += `   💎 Net: $${calcNW(p).toLocaleString()}\n\n`;
      });

      announcement += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGrind harder tomorrow! 💪\n.leaderboard — see full rankings`;

      const groups = new Set();
      for (const p of allPlayers) {
        if (p.groups) p.groups.forEach(g => groups.add(g));
      }
      if (this.groupJid) groups.add(this.groupJid);

      // ⛔ Group announcements disabled — prizes credited silently (no more spam).
      // To re-enable, uncomment below:
      // if (this.sock) {
      //   for (const gid of groups) {
      //     try { await this.sock.sendMessage(gid, { text: announcement }); } catch (e) {}
      //   }
      // }
      console.log('[Daily Prize] Prizes credited silently (announcements OFF).');
    } catch (err) {
      console.error('[Daily Prize] Error:', err.message);
    }
  }

  setSock(sock) { this.sock = sock; }
  setGroupJid(jid) { this.groupJid = jid; }

  xpForLevel(level) { return level * (level + 1) / 2 * 100; }

  getLevelFromXP(xp) {
    let level = 0;
    while (this.xpForLevel(level + 1) <= xp) level++;
    return Math.min(level, 50); // Max level 50
  }

  async checkLevelUp(sender, oldXP, newXP, sock, chatJid) {
    const oldLevel = this.getLevelFromXP(oldXP);
    const newLevel = this.getLevelFromXP(newXP);
    if (newLevel <= oldLevel) return;

    const player      = this.db.getPlayer(sender);
    const displayName = player.nickname || player.name;

    for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
      const reward = LEVEL_UP_REWARDS[lvl] || Math.floor(lvl * 50000 * 1.2);
      const nextXP = this.xpForLevel(lvl + 1);
      if (reward > 0) {
        player.bank += reward;
        BankingCommand.recordExternal(this.db, sender, {
          type: 'Level Up Reward', amount: reward,
          sender: 'Street Empire', receiver: displayName,
          note: `Level ${lvl} achieved!`, balance: player.bank,
        });
        this.db.updatePlayer(sender, player);
        await sock.sendMessage(chatJid, {
          text: `🌟 *LEVEL UP!*\n\n👑 ${displayName} reached *Level ${lvl}*!\n🎁 Reward: +$${reward.toLocaleString()} (Bank)\n\n⭐ Next level: ${nextXP.toLocaleString()} total XP`
        });
      }
    }
  }

  async resolvePending(raw, sender, chatJid, sock, message) {
    const parsed = parseTokenReply(raw);
    if (!parsed) return false;

    const pending = popPending(sender, parsed.token);
    if (!pending) {
      // Token format was right but no matching pending action — expired or wrong token
      await sock.sendMessage(chatJid, { text: `\`\`\` Confirmation token *${parsed.token}* not found or expired. Please re-issue the command.\`\`\`` }, { quoted: message });
      return true;
    }

    if (parsed.action === 'cancel') {
      await sock.sendMessage(chatJid, { text: '```🚫 Purchase cancelled.```' }, { quoted: message });
      return true;
    }

    // action === 'confirm'
    const player = this.db.getPlayer(sender);

    if (pending.type === 'business_buy') {
      const { business, businessId } = pending.payload;
      if (player.bank < business.price) {
        await sock.sendMessage(chatJid, { text: `\`\`\`Bank balance insufficient.\n🏦 Bank: $${player.bank.toLocaleString()}\`\`\`` }, { quoted: message });
        return true;
      }
      this.commands.business._doBuy(sender, player, business, businessId, 'bank', chatJid, sock, message);
      return true;
    }

    if (pending.type === 'business_upgrade') {
      const { idx, cost } = pending.payload;
      if (player.bank < cost) {
        await sock.sendMessage(chatJid, { text: `\`\`\`Bank balance insufficient.\n🏦 Bank: $${player.bank.toLocaleString()}\`\`\`` }, { quoted: message });
        return true;
      }
      const b = player.businesses[idx];
      player.bank -= cost;
      b.level++;
      b.income     = Math.floor(b.income * 1.2);
      b.xpPerHour  = Math.min(b.xpPerHour + 1, 10);
      b.upgrades++;
      player.experience += 10;
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `⬆️ *UPGRADED!*\n\n${b.emoji} ${b.name}\nCost: $${cost.toLocaleString()} (Bank)\nLevel: ${b.level}/10\n💵 New Income: $${b.income.toLocaleString()}/6h\n⭐ XP Rate: ${b.xpPerHour}/hr`
      }, { quoted: message });
      return true;
    }

    if (pending.type === 'vehicle_buy') {
      const { vehicle, vehicleId } = pending.payload;
      if (player.bank < vehicle.price) {
        await sock.sendMessage(chatJid, { text: `\`\`\`Bank balance insufficient.\n🏦 Bank: $${player.bank.toLocaleString()}\`\`\`` }, { quoted: message });
        return true;
      }
      player.bank -= vehicle.price;
      player.vehicles.push({ ...vehicle, id: vehicleId, purchasedAt: new Date(), mileage: 0, condition: 100 });
      player.experience += 5;
      this.db.updatePlayer(sender, player);
      await sock.sendMessage(chatJid, {
        text: `🎉 *VEHICLE PURCHASED!* (Bank)\n\n🚗 ${vehicle.name}\n💰 $${vehicle.price.toLocaleString()}\n🏁 Speed: ${vehicle.topSpeed} km/h\n\n🏦 Bank: $${player.bank.toLocaleString()}\n⭐ XP +5`
      }, { quoted: message });
      return true;
    }

    return true;
  }

  // ── Main handle ────────────────────────────────────────────────────────────
  async handle(rawText, command, args, sender, chatJid, sock, message) {

    if (chatJid.endsWith('@g.us')) {
      this.setGroupJid(chatJid);
      this.db.trackGroup(sender, chatJid);
    }

    // Dev commands
    if (command === 'devmodeon') {
      const p = this.db.getPlayer(sender);
      p.cash += 0; p.bank += 0;
      this.db.updatePlayer(sender, p);
      await sock.sendMessage(chatJid, { text: '🛠️ *DEV MODE WILL NO LONGER WORK*\n' }, { quoted: message });
      return;
    }
    if (command === 'devmodeoff') {
      await sock.sendMessage(chatJid, { text: '🛠️ *ADIOS*' }, { quoted: message });
      return;
    }

    if (command === 'refresh') {
      await this.commands.crypto.execute(['m'], sender, chatJid, sock, message);
      return;
    }

    // ── Token-based confirmation replies (confirm XXXX / cancel XXXX) ────────
    const handled = await this.resolvePending(rawText, sender, chatJid, sock, message);
    if (handled) return;

    const cleanReply    = rawText.trim();
    const senderNormJid = normalizeJid(sender);

    // ── PvP invite accept/decline — crew war ─────────────────────────────────
    // These commands use their own internal pending maps keyed by player,
    // so they still use '1'/'2'. They are safe from cross-conflicts because
    // each resolver checks its own map and returns false if nothing is pending.
    if (cleanReply === '1' || cleanReply === '2') {
      const warHandled = await this.commands.crew.resolveWarReply(cleanReply, senderNormJid, chatJid, sock);
      if (warHandled) return;
    }

    // ── Crew invite accept/decline ────────────────────────────────────────────
    if (cleanReply === '1' || cleanReply === '2') {
      const invHandled = await this.commands.crew.resolveInviteReply(cleanReply, senderNormJid, chatJid, sock);
      if (invHandled) return;
    }

    // ── Boxing invite accept/decline ──────────────────────────────────────────
    if (cleanReply === '1' || cleanReply === '2') {
      const boxHandled = await this.commands.box.resolveInvite(cleanReply, senderNormJid, chatJid, sock, message);
      if (boxHandled) return;
    }

    // ── TTT invite accept/decline ─────────────────────────────────────────────
    if ((cleanReply === '1' || cleanReply === '2') && require('./tictactoe').pendingTTT[senderNormJid]) {
      if (cleanReply === '1') await this.commands.ttt.acceptInvite(senderNormJid, chatJid, sock, message);
      else await this.commands.ttt.declineInvite(senderNormJid, chatJid, sock, message);
      return;
    }

    // ── Race invite accept/decline ────────────────────────────────────────────
    if (cleanReply === '1' || cleanReply === '2') {
      const raceHandled = await this.commands.race.resolveRaceInvite(cleanReply, senderNormJid, chatJid, sock, message);
      if (raceHandled) return;
    }

    // ── Coin flip reply ───────────────────────────────────────────────────────
    const coinReplyLower = rawText.trim().toLowerCase();
    if (coinReplyLower === 'heads' || coinReplyLower === 'tails') {
      const { coinChallenges, handleCoinReply } = require('./gambling');
      if (coinChallenges[senderNormJid]) {
        const coinHandled = handleCoinReply(this.db, coinReplyLower, senderNormJid, chatJid, sock, message);
        if (coinHandled) return;
      }
    }

    // ── Prison gate — block non-allowed commands ──────────────────────────────
    {
      const normSender = normalizeJid(sender);
      if (PoliceCommand.isInPrison(this.db, normSender) && !PoliceCommand.isPrisonAllowed(command)) {
        const p   = this.db.getPlayer(normSender);
        const rem = Math.ceil((p.prison.until - Date.now()) / 60000);
        await sock.sendMessage(chatJid, {
          text: [
            `🔒 *YOU ARE IN PRISON!*`,
            ``,
            `You can't use *.${command}* while serving time.`,
            `⏰ Sentence: ${rem} minute(s) remaining`,
            ``,
            `*Allowed commands:*`,
            `📋 *.menu* | 👤 *.profile*`,
            p.prison.bribeUsed ? null : `💰 *.police bribe* — bribe a cop (40%)`,
            p.prison.breakUsed ? null : `🏃 *.police break* — prison break (25%)`,
            `📊 *.police status* | 🔍 *.police wanted*`,
          ].filter(l => l !== null).join('\n')
        }, { quoted: message });
        return;
      }
    }

    const cmd = this.commands[command];

    // ── Boxing move commands — route to box even if not registered ─
    const BOX_MOVES = new Set(['jab','cross','hook','upc','bh','hay','combo','slip']);
    if (!cmd && BOX_MOVES.has(command)) {
      return this.commands.box.execute([command], sender, chatJid, sock, message);
    }

    // ── .accept / .decline for business/vehicle pending confirmations ─
    if (command === 'accept' || command === 'decline') {
      // Find any pending entry for this sender
      const pendingKey = Object.keys(pendingConfirm).find(k => k.startsWith(`${normalizeJid(sender)}:`));
      if (pendingKey) {
        const token = pendingKey.split(':')[1];
        const fakeRaw = command === 'accept' ? `confirm ${token}` : `cancel ${token}`;
        return this.resolvePending(fakeRaw, sender, chatJid, sock, message);
      }
      await sock.sendMessage(chatJid, { text: `\`\`\`No pending confirmation to ${command}.\`\`\`` }, { quoted: message });
      return;
    }

    if (!cmd) {
      await sock.sendMessage(chatJid, { text: '```unknown command try .menu```' });
      return;
    }

    const playerBefore = this.db.data.players[sender];
    const xpBefore     = playerBefore ? (playerBefore.experience || 0) : 0;

    await cmd.execute(args, sender, chatJid, sock, message);

    const playerAfter = this.db.data.players[sender];
    if (playerAfter) {
      const xpAfter = playerAfter.experience || 0;
      if (xpAfter > xpBefore) await this.checkLevelUp(sender, xpBefore, xpAfter, sock, chatJid);
    }
  }
}

module.exports = CommandHandler;
