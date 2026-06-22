const fs   = require('fs');
const path = require('path');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '../gamedata.json');
    this.data   = this.loadData();
    this.ensureDataStructure();
  }

  loadData() {
    if (fs.existsSync(this.dbPath)) {
      try { return JSON.parse(fs.readFileSync(this.dbPath, 'utf8')); }
      catch (e) { console.error('DB parse error:', e.message); return this.getDefaultData(); }
    }
    return this.getDefaultData();
  }

  getDefaultData() {
    return {
      players: {}, transactions: [], gangs: {}, crews: {},
      gameStats: { totalCash: 0, totalHeists: 0, totalRaces: 0, activePlayers: 0 },
      cryptoMarketState: null,   // persisted crypto market prices
      valuableMarket: null,      // persisted valuables market prices
    };
  }

  // Strip Baileys multi-device suffix (:N) from a JID
  static normJid(jid) {
    if (!jid) return jid;
    return jid.replace(/:\d+@/, '@').replace(/@c\.us$/, '@s.whatsapp.net');
  }

  ensureDataStructure() {
    if (!this.data.players)      this.data.players = {};
    if (!this.data.transactions) this.data.transactions = [];
    if (!this.data.gangs)        this.data.gangs = {};
    if (!this.data.crews || Array.isArray(this.data.crews)) this.data.crews = {};
    if (!this.data.gameStats)    this.data.gameStats = this.getDefaultData().gameStats;
    // cryptoMarketState & valuableMarket start as null — initialized by their modules

    // ── Migrate: normalize all stored player keys & crew member IDs ──────
    // Removes :N device suffixes left over from older Baileys versions
    const rawPlayers = this.data.players;
    const normPlayers = {};
    for (const [k, v] of Object.entries(rawPlayers)) {
      const nk = Database.normJid(k);
      v.id = nk;
      normPlayers[nk] = v;
    }
    this.data.players = normPlayers;

    for (const crew of Object.values(this.data.crews)) {
      if (crew.leader)          crew.leader          = Database.normJid(crew.leader);
      if (crew.assistantLeader) crew.assistantLeader = Database.normJid(crew.assistantLeader);
      if (crew.members) crew.members = crew.members.map(m => ({ ...m, id: Database.normJid(m.id) }));
    }

    this.saveData();
  }

  saveData() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  // ── Player CRUD ────────────────────────────────────────────────────────────

  getPlayer(playerId) {
    playerId = Database.normJid(playerId);
    if (!this.data.players[playerId]) this.createPlayer(playerId);
    const p = this.data.players[playerId];
    // Patch fields that may be missing on older accounts
    if (p.nickname   === undefined) p.nickname   = null;
    if (p.username   === undefined) p.username   = null;
    if (p.bank       === undefined) p.bank       = 1000;
    if (!p.groups)                  p.groups     = [];
    if (!p.transactions)            p.transactions = [];
    if (!p.stats)                   p.stats      = { heistsDone:0, missionsDone:0, racesWon:0, moneyEarned:0, moneyLost:0, timesArrested:0 };
    if (!p.cooldowns)               p.cooldowns  = {};
    if (!p.vehicles)                p.vehicles   = [];
    if (!p.businesses)              p.businesses = [];
    if (!p.weapons)                 p.weapons    = [];
    if (!p.guns)                    p.guns       = [];
    if (!p.cryptoDailySpend)        p.cryptoDailySpend = {};
    if (!p.valDailySpend)           p.valDailySpend    = {};
    if (p.equippedGun  === undefined) p.equippedGun = null;
    if (!p.inventory)               p.inventory  = {};
    if (p.house        === undefined) p.house      = null;
    // Crypto fields
    if (p.cryptoBalance === undefined) p.cryptoBalance = 0;
    if (!p.crypto)                     p.crypto        = {};

    // ── Passive heat decay — 1 point per full 24h since last heat increase ──
    if (p.heatLevel > 0) {
      if (!p.lastHeatIncreaseAt) p.lastHeatIncreaseAt = Date.now();
      const elapsed = Date.now() - p.lastHeatIncreaseAt;
      const DAY_MS  = 24 * 60 * 60 * 1000;
      if (elapsed >= DAY_MS) {
        const drops = Math.floor(elapsed / DAY_MS);
        p.heatLevel = Math.max(0, p.heatLevel - drops);
        // Advance the timestamp by the whole days consumed, not to now —
        // keeps decay accurate even if the bot was offline for a while.
        p.lastHeatIncreaseAt += drops * DAY_MS;
      }
    }

    return p;
  }

  createPlayer(playerId) {
    playerId = Database.normJid(playerId);
    const rawName = playerId.split('@')[0];
    this.data.players[playerId] = {
      id: playerId,
      name:       rawName,
      nickname:   null,
      username:   null,
      role:       'Street Rat',
      cash:       500,
      bank:       1000,
      rank:       1,
      reputation: 0,
      experience: 0,
      cryptoBalance: 0,
      crypto:     {},
      stats: { heistsDone:0, missionsDone:0, racesWon:0, moneyEarned:0, moneyLost:0, timesArrested:0 },
      inventory:   {},
      vehicles:    [],
      businesses:  [],
      safeHouses:  [],
      weapons:     [],
      guns:        [],
      equippedGun: null,
      house:       null,
      gang:        null,
      crew:        null,
      cooldowns:   {},
      groups:      [],
      transactions:[],
      equippedVehicle: 0,
      createdAt:   new Date().toISOString(),
      lastActive:  new Date().toISOString(),
    };
    this.saveData();
    return this.data.players[playerId];
  }

  updatePlayer(playerId, updates) {
    playerId = Database.normJid(playerId);
    const player = this.getPlayer(playerId);
    Object.assign(player, updates);
    player.lastActive = new Date().toISOString();
    // FIX: Always recalculate role on every update so it never stays stuck at Rookie
    this._applyRole(player);
    this.saveData();
    return player;
  }

  getDisplayName(playerId) {
    playerId = Database.normJid(playerId);
    const p = this.data.players[playerId];
    if (!p) return playerId.split('@')[0];
    return p.nickname || p.username || p.name || playerId.split('@')[0];
  }

  trackGroup(playerId, groupJid) {
    const p = this.getPlayer(playerId);
    if (!p.groups) p.groups = [];
    if (!p.groups.includes(groupJid)) { p.groups.push(groupJid); this.saveData(); }
  }

  // ── Money helpers ────────────────────────────────────────────────────────────

  addCash(playerId, amount) {
    const p = this.getPlayer(playerId);
    p.cash = (p.cash || 0) + amount;
    if (amount > 0) p.stats.moneyEarned = (p.stats.moneyEarned || 0) + amount;
    else            p.stats.moneyLost   = (p.stats.moneyLost   || 0) + Math.abs(amount);
    this.saveData();
  }

  addBank(playerId, amount) {
    const p = this.getPlayer(playerId);
    p.bank = (p.bank || 0) + amount;
    if (amount > 0) p.stats.moneyEarned = (p.stats.moneyEarned || 0) + amount;
    else            p.stats.moneyLost   = (p.stats.moneyLost   || 0) + Math.abs(amount);
    this.saveData();
  }

  // ── XP & Role ────────────────────────────────────────────────────────────────

  addExperience(playerId, amount) {
    const p = this.getPlayer(playerId);
    p.experience = (p.experience || 0) + amount;
    p.reputation = (p.reputation || 0) + Math.floor(amount / 10);
    this._applyRole(p);
    this.saveData();
  }

  // Internal: mutates player object in-place; does NOT save — caller must save.
  _applyRole(p) {
    const xp = p.experience || 0;
    if      (xp >= 335000) p.role = 'Godfather';
    else if (xp >= 133000) p.role = 'Crime Lord';
    else if (xp >= 42000)  p.role = 'Shot Caller';
    else if (xp >= 9000)   p.role = 'Soldier';
    else if (xp >= 1500)   p.role = 'Corner Boy';
    else                   p.role = 'Street Rat';
  }

  // Public alias (used by commands that call it directly)
  updatePlayerRole(playerId) {
    const p = this.getPlayer(playerId);
    this._applyRole(p);
    this.saveData();
  }

  // ── Cooldowns ─────────────────────────────────────────────────────────────────

  addCooldown(playerId, action, duration) {
    const p = this.getPlayer(playerId);
    if (!p.cooldowns) p.cooldowns = {};
    p.cooldowns[action] = Date.now() + duration;
    this.saveData();
  }

  checkCooldown(playerId, action) {
    const p = this.getPlayer(playerId);
    if (!p.cooldowns || !p.cooldowns[action]) return false;
    if (Date.now() > p.cooldowns[action]) { delete p.cooldowns[action]; this.saveData(); return false; }
    return true;
  }

  getCooldownRemaining(playerId, action) {
    const p = this.getPlayer(playerId);
    if (!p.cooldowns || !p.cooldowns[action]) return 0;
    return Math.ceil((p.cooldowns[action] - Date.now()) / 1000);
  }

  connect() { return Promise.resolve(); }
}

module.exports = Database;
