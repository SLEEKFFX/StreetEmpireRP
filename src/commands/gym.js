// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — GYM SYSTEM  v1.0
//  Train attributes that power up your boxing performance.
//  Each attribute has 5 levels. Costs scale with level.
//  1hr cooldown per attribute per upgrade.
// ═══════════════════════════════════════════════════════════════

const { normJid } = require('../utils/resolveMention');

// ── Attribute definitions ───────────────────────────────────────
const ATTRS = {
  muscles:   { emoji: '💪', name: 'Muscles',   desc: 'Increases raw damage' },
  endurance: { emoji: '🫁', name: 'Endurance', desc: 'Reduces damage taken' },
  reflexes:  { emoji: '⚡', name: 'Reflexes',  desc: 'Improves dodge/counter hit rate' },
  stamina:   { emoji: '🔋', name: 'Stamina',   desc: 'Maintains power in later rounds' },
  agility:   { emoji: '🤸', name: 'Agility',   desc: 'Better chance to land combos' },
  pace:      { emoji: '💨', name: 'Pace',       desc: 'Increases jab/cross speed hit rate' },
};

// Points required to reach each level (cumulative)
// Level 1→2: 5pts, 2→3: 15pts, 3→4: 35pts, 4→5: 70pts
const LEVEL_THRESHOLDS = [0, 5, 15, 35, 70]; // index = level - 1

// Cost per point upgrade (scales with current level)
const UPGRADE_COSTS = [10_000, 50_000, 100_000, 150_000, 200_000]; // cost at level 0,1,2,3,4

const ATTR_COOLDOWN = 60 * 60 * 1000; // 1 hour
const MAX_LEVEL = 5;

// ── Helper: bar using █ / ░ (same as profile/uptime) ───────────
function attrBar(pts, max, width = 10) {
  const filled = Math.round((pts / max) * width);
  const empty  = width - filled;
  return '[' + '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty)) + ']';
}

function getAttrLevel(pts) {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (pts >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
  }
  return Math.min(level, MAX_LEVEL);
}

function ptsForNextLevel(level) {
  return level >= MAX_LEVEL ? null : LEVEL_THRESHOLDS[level]; // threshold[level] = pts needed for level+1
}

function ensureGym(player) {
  if (!player.gym) {
    player.gym = {};
    for (const key of Object.keys(ATTRS)) player.gym[key] = { pts: 0, cooldownUntil: 0 };
  }
  for (const key of Object.keys(ATTRS)) {
    if (!player.gym[key]) player.gym[key] = { pts: 0, cooldownUntil: 0 };
  }
  return player;
}

// ── Export for boxing.js to read stats ─────────────────────────
function getGymStats(player) {
  ensureGym(player);
  const g = player.gym;

  // Overall gym level: average level across all 6 attributes (1–5 each, total possible 30)
  const totalPts   = Object.values(g).reduce((s, a) => s + (a.pts || 0), 0);
  const maxPts     = 70 * 6; // 420 max total
  // Win chance bonus: up to +30% overall win probability at full gym (scales linearly)
  const overallWinBonus = (totalPts / maxPts) * 0.30;

  return {
    dmgBonus:        Math.floor((g.muscles.pts   / 70) * 20),  // up to +20 dmg
    dmgReduction:    Math.floor((g.endurance.pts / 70) * 15),  // up to -15 dmg taken
    reflexBonus:     (g.reflexes.pts / 70) * 0.15,             // up to +15% hit on slip/dodge
    staminaBonus:    (g.stamina.pts  / 70) * 0.10,             // up to +10% dmg in rounds 5-8
    agilityBonus:    (g.agility.pts  / 70) * 0.10,             // up to +10% hit on combo
    paceBonus:       (g.pace.pts     / 70) * 0.15,             // up to +15% hit on jab/cross
    overallWinBonus,                                            // up to +30% base hit chance on every move
    totalPts,
  };
}

class GymCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'menu' || sub === 'help') return this.showMenu(sender, chatJid, sock, message);
    if (sub === 'train') return this.train(args.slice(1), sender, chatJid, sock, message);
    if (sub === 'stats') return this.showStats(sender, chatJid, sock, message);
    if (sub === 'lb' || sub === 'leaderboard') return this.showLeaderboard(chatJid, sock, message);

    // Shortcut: .gym muscles / .gym pace etc.
    if (ATTRS[sub]) return this.train([sub], sender, chatJid, sock, message);

    return this.showMenu(sender, chatJid, sock, message);
  }

  // ── Main menu ────────────────────────────────────────────────
  async showMenu(sender, chatJid, sock, message) {
    const player = ensureGym(this.db.getPlayer(sender));
    const now    = Date.now();

    const lines = [
      `🏋️ *GYM — WHERE LEGENDS ARE MADE*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Earn gym points by boxing — win matches to level up!`,
      `Each attribute has 5 levels. Points earned from box games.`,
      ``,
      `*YOUR ATTRIBUTES:*`,
    ];

    for (const [key, def] of Object.entries(ATTRS)) {
      const stat  = player.gym[key];
      const pts   = stat.pts;
      const level = getAttrLevel(pts);
      const nextPts = ptsForNextLevel(level);
      // FIX: use LEVEL_THRESHOLDS[level-1] as rangeStart and nextPts as rangeEnd
      // so the bar width = nextPts - rangeStart (never 0).
      const rangeStart  = LEVEL_THRESHOLDS[level - 1];           // pts at start of this level
      const ptsInLevel  = pts - rangeStart;                       // progress within level
      const levelWidth  = nextPts !== null ? nextPts - rangeStart : 1; // span of this level
      const bar = nextPts !== null
        ? attrBar(ptsInLevel, levelWidth)
        : attrBar(1, 1); // max level full bar

      const cd = stat.cooldownUntil > now
        ? ` ⏰ ${Math.ceil((stat.cooldownUntil - now) / 60000)}m`
        : '';

      const levelLabel = level >= MAX_LEVEL ? `MAX` : `Lv${level}`;
      lines.push(`${def.emoji} *${def.name}* — ${levelLabel}${cd}`);
      lines.push(`   ${bar} ${pts}pts${nextPts !== null ? ` → next: ${nextPts}pts` : ' (MAX)'}`);
    }

    lines.push(``);
    lines.push(`*COMMANDS:*`);
    lines.push(`*.gym [attr]* — Train an attribute`);
    lines.push(`   e.g. *.gym muscles* *.gym pace* *.gym reflexes*`);
    lines.push(`*.gym stats* — Full stat breakdown`);
    lines.push(`*.gym lb*    — Gym leaderboard`);
    lines.push(`*.box tournament* — Boxing tournament`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── Train an attribute ───────────────────────────────────────
  // Gym points are now earned from boxing — this command just shows stats
  async train(args, sender, chatJid, sock, message) {
    const attr = (args[0] || '').toLowerCase();
    if (!ATTRS[attr]) {
      const list = Object.keys(ATTRS).join(', ');
      await sock.sendMessage(chatJid, { text: `❌ Unknown attribute.\nChoose: ${list}\n\n💡 Gym points are earned from boxing matches, not purchased!` }, { quoted: message }); return;
    }

    await sock.sendMessage(chatJid, {
      text: [
        `🏋️ *GYM — ${ATTRS[attr].name.toUpperCase()}*`,
        ``,
        `Gym points are no longer purchased with cash.`,
        ``,
        `*How to earn gym points:*`,
        `🏆 Win a box match → up to *+5 pts* (random)`,
        `🤝 Draw / close fight → *+3 pts*`,
        `❌ Lose a box match → *+2 pts*`,
        ``,
        `Points are distributed randomly across all 6 attributes after each fight.`,
        ``,
        `💪 *.box @player* — Start earning now!`,
        `📊 *.gym stats*   — View your attributes`,
      ].join('\n')
    }, { quoted: message }); return;
  }

  // ── Internal: award gym points after a box match ─────────────
  // Called by boxing.js after each match resolves
  awardBoxPoints(playerId, outcome) {
    // outcome: 'win' | 'draw' | 'loss'
    const ptMap = { win: 5, draw: 3, loss: 2 };
    const maxPts = ptMap[outcome] || 2;
    // Award random number from 1 up to maxPts
    const ptsToAward = Math.floor(Math.random() * maxPts) + 1;

    const player = ensureGym(this.db.getPlayer(playerId));
    const attrs   = Object.keys(ATTRS);

    // Distribute points randomly across attributes (not yet maxed)
    const available = attrs.filter(a => getAttrLevel(player.gym[a].pts) < MAX_LEVEL);
    if (available.length === 0) return { ptsToAward: 0, distributed: [] };

    const distributed = [];
    let remaining = ptsToAward;
    while (remaining > 0 && available.length > 0) {
      const pick = available[Math.floor(Math.random() * available.length)];
      player.gym[pick].pts += 1;
      distributed.push(pick);
      remaining--;
    }

    this.db.updatePlayer(playerId, player);
    return { ptsToAward, distributed };
  }


  // ── Full stat breakdown ──────────────────────────────────────
  async showStats(sender, chatJid, sock, message) {
    const player = ensureGym(this.db.getPlayer(sender));
    const stats  = getGymStats(player);
    const name   = this.db.getDisplayName(sender);
    const now    = Date.now();

    const lines = [
      `🏋️ *${name}'s GYM STATS*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ];

    for (const [key, def] of Object.entries(ATTRS)) {
      const stat  = player.gym[key];
      const pts   = stat.pts;
      const level = getAttrLevel(pts);
      const nextPts = ptsForNextLevel(level);
      const rangeStart = LEVEL_THRESHOLDS[level - 1];                                           // FIX
      const rangeEnd   = nextPts !== null ? nextPts : LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
      const levelWidth = Math.max(1, rangeEnd - rangeStart);                                    // FIX: never 0
      const bar  = attrBar(pts - rangeStart, levelWidth);
      const cd   = stat.cooldownUntil > now ? ` (⏰ ${Math.ceil((stat.cooldownUntil - now)/60000)}m)` : '';

      lines.push(`${def.emoji} *${def.name}* — Level ${level >= MAX_LEVEL ? 'MAX' : level}${cd}`);
      lines.push(`   ${bar} ${pts}/${nextPts !== null ? nextPts : 70}pts`);
    }

    lines.push(``);
    lines.push(`*BOXING BONUSES:*`);
    lines.push(`💥 Damage bonus:      +${stats.dmgBonus}`);
    lines.push(`🛡️ Damage reduction:  -${stats.dmgReduction}`);
    lines.push(`⚡ Reflex hit bonus:  +${Math.round(stats.reflexBonus * 100)}%`);
    lines.push(`🔋 Stamina (late rnd):+${Math.round(stats.staminaBonus * 100)}%`);
    lines.push(`🤸 Agility hit bonus: +${Math.round(stats.agilityBonus * 100)}%`);
    lines.push(`💨 Pace hit bonus:    +${Math.round(stats.paceBonus * 100)}%`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── Gym leaderboard ──────────────────────────────────────────
  async showLeaderboard(chatJid, sock, message) {
    const players = Object.values(this.db.data.players)
      .filter(p => p.gym)
      .map(p => {
        ensureGym(p);
        const totalPts = Object.values(p.gym).reduce((s, a) => s + a.pts, 0);
        return { id: p.id, name: this.db.getDisplayName(p.id), totalPts, gym: p.gym };
      })
      .filter(p => p.totalPts > 0)
      .sort((a, b) => b.totalPts - a.totalPts)
      .slice(0, 10);

    if (players.length === 0) {
      await sock.sendMessage(chatJid, { text: `🏋️ No gym records yet. Start training: *.gym*` }, { quoted: message }); return;
    }

    const medals = ['🥇','🥈','🥉'];
    const lines  = [`🏋️ *GYM/BOXING LEADERBOARD — TOP FIGHTERS*`, `━━━━━━━━━━━━━━━━━━━━━━━━`, ``];

    players.forEach((p, i) => {
      const bar   = attrBar(p.totalPts, 70 * 6, 8);
      const medal = medals[i] || `${i+1}.`;
      lines.push(`${medal} *${p.name}*  —  ${p.totalPts} total pts`);
      lines.push(`   Overall: ${bar}`);
    });

    lines.push(``);
    lines.push(`💡 Train attributes to climb: *.gym*`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

}

module.exports = { GymCommand, getGymStats, ensureGym, ATTRS, attrBar };
