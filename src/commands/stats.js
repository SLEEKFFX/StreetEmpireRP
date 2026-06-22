// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — PLAYER STATS  v1.0
//  Detailed stats: health, heat level, charisma, mentality, etc.
// ═══════════════════════════════════════════════════════════════

class StatsCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const p = this.db.getPlayer(sender);
    this._ensureStats(p);

    const sub = (args[0] || '').toLowerCase();
    if (sub === 'help') return this.showHelp(chatJid, sock, message);

    return this.showStats(p, sender, chatJid, sock, message);
  }

  _ensureStats(p) {
    if (p.health        === undefined) p.health        = 100;
    if (p.heatLevel     === undefined) p.heatLevel     = 0;
    if (p.charisma      === undefined) p.charisma      = this._calcCharisma(p);
    if (p.mentality     === undefined) p.mentality     = this._calcMentality(p);
    if (!p.injuries)                   p.injuries      = [];
    if (!p.stats)                      p.stats         = {};
  }

  async showStats(p, sender, chatJid, sock, message) {
    this._ensureStats(p);

    // Compute dynamic stats
    const charisma  = this._calcCharisma(p);
    const mentality = this._calcMentality(p);
    const heat      = p.heatLevel || 0;
    const hp        = Math.max(0, Math.min(100, p.health || 100));

    const xpForLevel = (l) => l * (l + 1) / 2 * 100;
    let level = 0;
    while (xpForLevel(level + 1) <= (p.experience||0)) level++;

    const injuries   = (p.injuries || []).length;
    const inPrison   = p.prison && p.prison.until > Date.now();
    const prisonTime = inPrison ? Math.ceil((p.prison.until - Date.now())/60000) : 0;

    const lines = [
      `📊 *PLAYER STATS*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `👤 *${this.db.getDisplayName(sender)}*`,
      `🎖️ ${p.role || 'Street Rat'}  •  Level ${level}`,
      ``,
      `━━━━━━━━ ❤️ HEALTH ━━━━━━━━`,
      `HP:          ${hp}/100  ${this._hpBar(hp)}`,
      `Injuries:    ${injuries > 0 ? `${injuries} active injury${injuries>1?'s':''} 🤕` : '✅ None'}`,
      injuries > 0 ? `             *.hospital* to treat` : null,
      ``,
      `━━━━━━ 🌡️ HEAT LEVEL ━━━━━━`,
      `Heat:        ${heat}/10  ${this._heatBar(heat)}`,
      `Status:      ${this._heatLabel(heat)}`,
      heat > 0 ? `Times Busted: ${p.stats?.timesArrested || 0} arrests` : null,
      inPrison ? `🔒 IN PRISON: ${prisonTime}m remaining` : null,
      ``,
      `━━━━━━ 🎭 CHARISMA ━━━━━━`,
      `Charisma:    ${charisma}/100  ${this._statBar(charisma)}`,
      `             ${this._charismaLabel(charisma)}`,
      ``,
      `━━━━━━ 🧠 MENTALITY ━━━━━━`,
      `Mentality:   ${mentality}/100  ${this._statBar(mentality)}`,
      `             ${this._mentalityLabel(mentality)}`,
      ``,
      `━━━━━ 📈 PERFORMANCE ━━━━━`,
      `Heists Done: ${p.stats?.heistsDone || 0}`,
      `Races Won:   ${p.stats?.racesWon || 0}`,
      `Robbed:      ${p.stats?.timesArrested || 0} times caught`,
      `Earned:      $${(p.stats?.moneyEarned || 0).toLocaleString()}`,
      `Lost:        $${(p.stats?.moneyLost || 0).toLocaleString()}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💡 Use *.hospital* to restore HP`,
      `💡 Stay clean to lower heat level`,
    ].filter(l => l !== null).join('\n');

    await sock.sendMessage(chatJid, { text: lines }, { quoted: message });
  }

  async showHelp(chatJid, sock, message) {
    const text = [
      `📊 *STATS SYSTEM GUIDE*`,
      ``,
      `❤️ *HEALTH (HP):*`,
      `• Starts at 100/100`,
      `• Lost in boxing fights`,
      `• Restored at hospital or with food`,
      `• Below 20 HP: can't box or do heists`,
      ``,
      `🌡️ *HEAT LEVEL (0–10):*`,
      `• Rises each time you're arrested`,
      `• Higher heat = more expensive bribes`,
      `• Lower heat = police ignore you more`,
      `• Drops slowly over time`,
      ``,
      `🎭 *CHARISMA (0–100):*`,
      `• Based on reputation & crew status`,
      `• High charisma = better bribe odds`,
      `• Affects social interactions`,
      ``,
      `🧠 *MENTALITY (0–100):*`,
      `• Based on wins, heists & experience`,
      `• High mentality = cooler under pressure`,
      `• Calculated from your game history`,
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  _calcCharisma(p) {
    const rep  = Math.min(50, (p.reputation || 0) / 10);
    const crew = p.crew ? 20 : 0;
    const role = { 'Street Rat':0,'Corner Boy':5,'Soldier':10,'Shot Caller':20,'Crime Lord':30,'Godfather':40 }[p.role] || 0;
    return Math.min(100, Math.floor(rep + crew + role));
  }

  _calcMentality(p) {
    const wins  = Math.min(30, (p.stats?.racesWon || 0) * 2);
    const heist = Math.min(30, (p.stats?.heistsDone || 0) * 3);
    const lvl   = (() => { let l = 0; const xp = p.experience||0; while (l*(l+1)/2*100 <= xp) l++; return l; })();
    const level = Math.min(40, lvl * 2);
    return Math.min(100, Math.floor(wins + heist + level));
  }

  _hpBar(hp) {
    const filled = Math.round((hp/100)*10);
    const color  = hp > 60 ? '🟩' : hp > 30 ? '🟨' : '🟥';
    return color.repeat(filled) + '⬛'.repeat(10-filled);
  }

  _heatBar(heat) {
    const filled = Math.round((heat/10)*10);
    const color  = heat <= 3 ? '🟦' : heat <= 6 ? '🟧' : '🟥';
    return color.repeat(filled) + '⬛'.repeat(10-filled);
  }

  _statBar(val) {
    const filled = Math.round((val/100)*10);
    return '🟪'.repeat(filled) + '⬛'.repeat(10-filled);
  }

  _heatLabel(h) {
    if (h === 0) return 'Squeaky clean 😇';
    if (h <= 2)  return 'Low profile 🕶️';
    if (h <= 4)  return 'Person of interest 👀';
    if (h <= 6)  return 'Hot commodity 🔥';
    if (h <= 8)  return 'Wanted Criminal 🚔';
    return 'PUBLIC ENEMY #1 🚨';
  }

  _charismaLabel(c) {
    if (c < 20) return 'Nobody knows you';
    if (c < 40) return 'Known in the block';
    if (c < 60) return 'Respected hustler';
    if (c < 80) return 'Street legend';
    return 'Untouchable icon 👑';
  }

  _mentalityLabel(m) {
    if (m < 20) return 'Still learning the game';
    if (m < 40) return 'Getting sharper';
    if (m < 60) return 'Street smart';
    if (m < 80) return 'Cold & calculated';
    return 'Criminal mastermind 🧠';
  }
}

module.exports = StatsCommand;
