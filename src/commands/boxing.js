// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — STREET BOXING  v2.0  (Interactive)
//  Players take real turns choosing fight moves each round.
//  Available move commands are shown as prompts after each round.
//  Match is live — both players must send their moves.
// ═══════════════════════════════════════════════════════════════

const { resolveMention, normJid } = require('../utils/resolveMention');
const BankingCommand      = require('./banking');
const { HospitalCommand, INJURIES } = require('./hospital');

// ── Active match store ──────────────────────────────────────────
// matchId → match object
const activeMatches = {};

const TURN_TIMEOUT_BOX = 3 * 60 * 1000; // 3 minutes → auto forfeit

// ── Move definitions ────────────────────────────────────────────
const MOVES = {
  jab:  { cmd: '.jab',  emoji: '⚡', name: 'Lightning Jab',  dmg: [8,14],  hit: 0.80, commentary: ['snaps a fast jab!','lands a crisp jab to the face!'] },
  cross:{ cmd: '.cross',emoji: '💥', name: 'Power Cross',    dmg: [12,20], hit: 0.65, commentary: ['fires a heavy right hand!','throws a thunderous cross!'] },
  hook: { cmd: '.hook', emoji: '🌀', name: 'Left Hook',      dmg: [15,25], hit: 0.55, commentary: ['swings a vicious hook!','connects with a crushing hook to the jaw!'] },
  upc:  { cmd: '.upc',  emoji: '⬆️', name: 'Uppercut',       dmg: [18,30], hit: 0.45, commentary: ['drills an uppercut from downtown!','rips an uppercut to the chin!'] },
  bh:   { cmd: '.bh',   emoji: '🫁', name: 'Body Hit',       dmg: [10,18], hit: 0.70, commentary: ['digs a hard body shot!','punches right to the ribs!'] },
  hay:  { cmd: '.hay',  emoji: '💫', name: 'Haymaker',       dmg: [25,40], hit: 0.25, commentary: ['winds up a wild haymaker!','throws a looping overhand!'] },
  combo:{ cmd: '.combo',emoji: '🔥', name: '3-Hit Combo',    dmg: [20,35], hit: 0.35, commentary: ['unleashes a blistering combo!','lands a lightning 1-2-3!'] },
  slip: { cmd: '.slip', emoji: '💨', name: 'Slip & Counter', dmg: [5,12],  hit: 0.90, commentary: ['slips the punch and counters!','ducks under and fires back!'] },
};

const MOVE_PROMPT = [
  ``,
  `🥊 *YOUR MOVE:*`,
  `⚡ .jab   💥 .cross  🌀 .hook`,
  `⬆️ .upc   🫁 .bh     💫 .hay`,
  `🔥 .combo 💨 .slip`,
  `⏳ 45 seconds to move or you forfeit the round`,
].join('\n');

const COMMENTATORS = ['Big Mike','DJ Smokey','Muhammad Lali','Don the Narrator'];

const LOSS_INJURIES = {
  flawless_loss: ['concussion','broken_nose','broken_rib'],
  normal_loss:   ['black_eye','bruised_ribs'],
  close_loss:    ['puffy_face'],
};

function hpBar(hp, max = 100) {
  const pct    = Math.max(0, hp) / max;
  const filled = Math.round(pct * 10);
  const color  = pct > 0.6 ? '🟩' : pct > 0.3 ? '🟨' : '🟥';
  const empty  = 10 - filled;
  return color.repeat(filled) + '⬛'.repeat(empty);
}

function rollDmg(move, hit = true) {
  if (!hit) return 0;
  const [min, max] = move.dmg;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Boxing stats helper ─────────────────────────────────────────
// Ensures every player has a boxStats object, migrating any legacy
// data (e.g. from gamedata.json players who fought before v2).
function ensureBoxStats(player) {
  if (!player.boxStats) {
    player.boxStats = {
      wins:        0,
      draws:       0,
      losses:      0,
      currentStreak: 0,   // positive = win streak, negative = lose streak
      bestStreak:  0,     // highest win streak ever reached
      medals: {
        gold:   0,   // Flawless Victory
        silver: 0,   // Close Win
        bronze: 0,   // Normal Win
      },
    };
  }
  // Back-fill any missing sub-fields (for players created before medals existed)
  const bs = player.boxStats;
  if (bs.currentStreak === undefined) bs.currentStreak = 0;
  if (bs.bestStreak    === undefined) bs.bestStreak    = 0;
  if (!bs.medals) bs.medals = { gold: 0, silver: 0, bronze: 0 };
  if (bs.medals.gold   === undefined) bs.medals.gold   = 0;
  if (bs.medals.silver === undefined) bs.medals.silver = 0;
  if (bs.medals.bronze === undefined) bs.medals.bronze = 0;
  return player;
}

// Apply a fight result to a player's boxStats
function applyBoxResult(player, result, outcome) {
  // result: 'win' | 'loss' | 'draw'
  // outcome: 'FLAWLESS_VICTORY' | 'CLOSE_WIN' | 'NORMAL_WIN' | 'TIE' | null (for loss)
  ensureBoxStats(player);
  const bs = player.boxStats;

  if (result === 'win') {
    bs.wins++;
    bs.currentStreak = bs.currentStreak > 0 ? bs.currentStreak + 1 : 1;
    if (bs.currentStreak > bs.bestStreak) bs.bestStreak = bs.currentStreak;
    if (outcome === 'FLAWLESS_VICTORY') bs.medals.gold++;
    else if (outcome === 'CLOSE_WIN')   bs.medals.silver++;
    else                                bs.medals.bronze++;
  } else if (result === 'draw') {
    bs.draws++;
    bs.currentStreak = 0;  // streak resets on draw
  } else {
    bs.losses++;
    bs.currentStreak = bs.currentStreak < 0 ? bs.currentStreak - 1 : -1;
  }
  return player;
}

class BoxingCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'menu' || sub === 'help') return this.showMenu(sender, chatJid, sock, message);
    if (sub === 'lb' || sub === 'leaderboard') return this.showLeaderboard(chatJid, sock, message);
    if (sub === 'h2h') return this.showH2H(args.slice(1), sender, chatJid, sock, message);

    // Tournament
    if (sub === 'tournament' || sub === 'tourney' || sub === 't') {
      const { GymTournament } = require('./gymTournament');
      const gt = new GymTournament(this.db);
      return gt.execute(args.slice(1), sender, chatJid, sock, { quoted: message });
    }

    // Move commands — player is in a match
    if (MOVES[sub]) return this.submitMove(sub, sender, chatJid, sock, message);

    if (sub === 'challenge' || args[0]?.includes('@') || /^\d{5,}/.test(args[0])) {
      return this.challenge(args, sender, chatJid, sock, message);
    }
    if (sub === 'accept')  return this.resolveInvite('1', sender, chatJid, sock, message);
    if (sub === 'decline') return this.resolveInvite('2', sender, chatJid, sock, message);
    if (sub === 'forfeit') return this.forfeit(sender, chatJid, sock, message);

    return this.showMenu(sender, chatJid, sock, message);
  }

  async showMenu(sender, chatJid, sock, message) {
    const p = this.db.getPlayer(sender);
    if (!p.health) p.health = 100;

    // Check if player is in an active match
    const match = this._getPlayerMatch(sender);

    const text = [
      `🥊 *STREET EMPIRE BOXING*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `❤️ Your HP: ${p.health}/100  ${hpBar(p.health)}`,
      ``,
      match
        ? [`⚡ *YOU'RE IN A MATCH NOW!*`,
           `Round ${match.round} of ${match.maxRounds}`,
           `⏳ Use a move command to fight`,
           MOVE_PROMPT].join('\n')
        : [`*COMMANDS:*`,
           `*.box @player [bet]* — Challenge someone`,
           `*.box accept*        — Accept`,
           `*.box decline*       — Decline`,
           `*.box forfeit*       — Surrender active match`,
           `*.box lb*            — Boxing leaderboard 🏆`,
           `*.box h2h @player*   — Detailed H2H history 📊`,
           `*.box tournament*    — Tournament`,
           `*.hospital*          — Treat injuries`,
           ``,
           `*MOVES (in-fight):*`,
           `⚡ .jab  💥 .cross  🌀 .hook  ⬆️ .upc`,
           `🫁 .bh   💫 .hay    🔥 .combo 💨 .slip`,
           `⚠️ Cooldown: 20 minutes per fight`].join('\n'),
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async challenge(args, sender, chatJid, sock, message) {
    if (this.db.checkCooldown(sender, 'boxing')) {
      const rem = this.db.getCooldownRemaining(sender, 'boxing');
      await sock.sendMessage(chatJid, { text: `⏰ Boxing cooldown: ${Math.ceil(rem/60)}m` }, { quoted: message }); return;
    }

    if (this._getPlayerMatch(sender)) {
      await sock.sendMessage(chatJid, { text: `You're already in a match. Use a move or *.box forfeit*` }, { quoted: message }); return;
    }

    const _rawTargetId = resolveMention(message, args, 0);
    if (!_rawTargetId) { await sock.sendMessage(chatJid, { text: `Tag a player\n*.box @player [bet]*` }, { quoted: message }); return; }
    const targetId = normJid(_rawTargetId);
    if (targetId === sender) { await sock.sendMessage(chatJid, { text: `You can't fight yourself` }, { quoted: message }); return; }

    const bet = parseInt(args[1]) || 0;
    if (bet < 0 || (bet > 0 && bet < 500)) {
      await sock.sendMessage(chatJid, { text: `Min bet is $500 or $0 for free match.` }, { quoted: message }); return;
    }

    const challenger = this.db.getPlayer(sender);
    if (!challenger.health) challenger.health = 100;
    if (challenger.health < 20) {
      await sock.sendMessage(chatJid, { text: `Too injured to fight (${challenger.health}/100 HP)\n🏥 Heal at *.hospital* first.` }, { quoted: message }); return;
    }
    if (bet > 0 && (challenger.cash||0) < bet) {
      await sock.sendMessage(chatJid, { text: `Not enough cash for bet. Need $${bet.toLocaleString()}` }, { quoted: message }); return;
    }

    if (!global._boxPending) global._boxPending = {};
    global._boxPending[targetId] = { challengerId: sender, bet, chatJid, expiresAt: Date.now() + 90000 };

    const chalName  = this.db.getDisplayName(sender);
    const targPhone = targetId.split('@')[0];

    await sock.sendMessage(chatJid, {
      text: [
        `🥊 *BOXING CHALLENGE!*`,
        ``,
        `@${targPhone} — *${chalName}* wants to fight`,
        bet > 0 ? `💰 Bet: $${bet.toLocaleString()} each` : `🆓 Friendly match (no bet)`,
        ``,
        `Reply *.box accept* or *.box decline*`,
        `⏳ *60 seconds* to respond`,
      ].join('\n'),
      mentions: [targetId],
    }, { quoted: message });

    setTimeout(() => {
      const pending = global._boxPending?.[targetId];
      if (pending && pending.challengerId === sender) {
        delete global._boxPending[targetId];
        sock.sendMessage(chatJid, { text: `⏰ Boxing challenge from ${chalName} expired.`, mentions: [targetId] }).catch(() => {});
      }
    }, 60000);
  }

  async resolveInvite(reply, sender, chatJid, sock, message) {
    if (!global._boxPending) global._boxPending = {};
    const pending = global._boxPending[sender];
    if (!pending || Date.now() > pending.expiresAt) {
      await sock.sendMessage(chatJid, { text: `No active boxing challenge.` }, { quoted: message }); return true;
    }
    delete global._boxPending[sender];

    if (reply === '2') {
      await sock.sendMessage(pending.chatJid, {
        text: `🚫 *Fight Declined*\n\n${this.db.getDisplayName(sender)} folded.`
      });
      return true;
    }

    const challenger = this.db.getPlayer(pending.challengerId);
    const accepter   = this.db.getPlayer(sender);
    if (!challenger.health) challenger.health = 100;
    if (!accepter.health)   accepter.health   = 100;

    if (accepter.health < 20) {
      await sock.sendMessage(pending.chatJid, { text: `${this.db.getDisplayName(sender)} is too injured to fight! (${accepter.health}/100 HP)` });
      return true;
    }
    if (pending.bet > 0) {
      if ((challenger.cash||0) < pending.bet) {
        await sock.sendMessage(pending.chatJid, { text: `Fight cancelled — ${this.db.getDisplayName(pending.challengerId)} doesn't have the bet amount.` });
        return true;
      }
      if ((accepter.cash||0) < pending.bet) {
        await sock.sendMessage(pending.chatJid, { text: `Fight cancelled — ${this.db.getDisplayName(sender)} doesn't have the bet amount.` });
        return true;
      }
    }

    this.db.addCooldown(pending.challengerId, 'boxing', 20 * 60 * 1000);
    this.db.addCooldown(sender, 'boxing', 20 * 60 * 1000);

    // Create interactive match
    await this.createMatch(pending.challengerId, sender, pending.bet, pending.chatJid, sock);
    return true;
  }

  // ── Create a live match ─────────────────────────────────────────
  async createMatch(p1Id, p2Id, bet, chatJid, sock) {
    const matchId = `box_${Date.now()}`;
    const commentator = COMMENTATORS[Math.floor(Math.random() * COMMENTATORS.length)];

    // Load gym stats for both players
    let p1Gym = { dmgBonus:0, dmgReduction:0, reflexBonus:0, staminaBonus:0, agilityBonus:0, paceBonus:0, overallWinBonus:0, totalPts:0 };
    let p2Gym = { dmgBonus:0, dmgReduction:0, reflexBonus:0, staminaBonus:0, agilityBonus:0, paceBonus:0, overallWinBonus:0, totalPts:0 };
    try {
      const { getGymStats, ensureGym } = require('./gym');
      p1Gym = getGymStats(ensureGym(this.db.getPlayer(p1Id)));
      p2Gym = getGymStats(ensureGym(this.db.getPlayer(p2Id)));
    } catch(e) {}

    // ── COMPARATIVE GYM ADVANTAGE ─────────────────────────────────────────
    // Instead of each player just getting their own absolute bonus, we calculate
    // a RELATIVE advantage based on the gap between the two fighters' gym levels.
    // This makes gym training genuinely matter: a higher-trained fighter should
    // consistently beat a lower-trained one, not just get a flat bonus that the
    // lower fighter can overcome with lucky swings.
    //
    // Formula:
    //  - Raw bonus stays (their own gym level still counts)
    //  - PLUS a relative bonus proportional to how much better trained they are
    //  - The weaker fighter gets a corresponding penalty to their move hit rates
    //
    // Max gap bonus: ±0.25 (25%) when one fighter has full gym and other has 0
    // This stacks with the individual overallWinBonus (max 0.30) making a fully
    // trained fighter vs untrained one very dominant, as players expect.

    const MAX_PTS = 420;
    const p1Pts   = p1Gym.totalPts || 0;
    const p2Pts   = p2Gym.totalPts || 0;
    const gymGap  = p1Pts - p2Pts; // positive = p1 better trained

    // Relative hit rate modifier from gym gap (max ±0.25)
    const GYM_GAP_SCALE = 0.25 / MAX_PTS;
    p1Gym.gymGapBonus = gymGap > 0 ? gymGap * GYM_GAP_SCALE : 0;
    p2Gym.gymGapBonus = gymGap < 0 ? Math.abs(gymGap) * GYM_GAP_SCALE : 0;

    // The weaker fighter also takes a small accuracy penalty
    p1Gym.gymGapPenalty = gymGap < 0 ? Math.abs(gymGap) * (GYM_GAP_SCALE * 0.5) : 0;
    p2Gym.gymGapPenalty = gymGap > 0 ? gymGap * (GYM_GAP_SCALE * 0.5) : 0;

    const match = {
      id: matchId,
      p1: p1Id, p2: p2Id,
      p1Hp: 100, p2Hp: 100,
      p1Gym, p2Gym,
      bet, chatJid,
      commentator,
      round: 1,
      maxRounds: 8,
      moves: {},
      status: 'active',
      createdAt: Date.now(),
      roundTimeout: null,
      lastMoveAt: Date.now(),
    };

    activeMatches[matchId] = match;

    const p1Name = this.db.getDisplayName(p1Id);
    const p2Name = this.db.getDisplayName(p2Id);

    // Show gym bonuses if any
    const gymLines = [];
    const p1TotalPts = p1Gym.totalPts || 0;
    const p2TotalPts = p2Gym.totalPts || 0;
    if (p1TotalPts > 0 || p2TotalPts > 0) {
      gymLines.push(`🏋️ *Gym Stats:*`);
      gymLines.push(`  ${p1Name}: ${p1TotalPts}pts (+${Math.round(p1Gym.overallWinBonus * 100)}% acc, +${p1Gym.dmgBonus} dmg)`);
      gymLines.push(`  ${p2Name}: ${p2TotalPts}pts (+${Math.round(p2Gym.overallWinBonus * 100)}% acc, +${p2Gym.dmgBonus} dmg)`);
      if (Math.abs(gymGap) > 30) {
        const adv = gymGap > 0 ? p1Name : p2Name;
        const gapBonus = Math.round(Math.abs(gymGap) * (0.25 / MAX_PTS) * 100);
        gymLines.push(`⚖️ *${adv} has a +${gapBonus}% training edge!*`);
      }
    }

    await sock.sendMessage(chatJid, {
      text: [
        `🥊 *STREET BOXING BEGINS!*`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `🎙️ *${commentator}:* "Ladies and gentlemen, LIVE from the SE downtown..."`,
        ``,
        `🔴 *${p1Name}* vs 🔵 *${p2Name}*`,
        bet > 0 ? `💰 Stakes: $${bet.toLocaleString()} each` : `🆓 Friendly Match`,
        ...gymLines,
        ``,
        `📋 Up to ${match.maxRounds} rounds. 3 mins to move or auto-forfeit.`,
        MOVE_PROMPT,
      ].join('\n')
    });

    this._startRoundTimeout(matchId, sock);
  }

  // ── Player submits a move ───────────────────────────────────────
  async submitMove(moveId, sender, chatJid, sock, message) {
    const match = this._getPlayerMatch(sender);
    if (!match) {
      // Not in a match — silently ignore, could be a command in another context
      return;
    }
    if (match.chatJid !== chatJid) return; // wrong chat

    if (match.moves[sender]) {
      await sock.sendMessage(chatJid, { text: `⏳ Already chose *${MOVES[match.moves[sender]].name}* — waiting for opponent...` }, { quoted: message });
      return;
    }

    match.moves[sender] = moveId;
    const moveName = MOVES[moveId].name;

    // Reset the forfeit timer — the OTHER player now has 3 mins
    clearTimeout(match.roundTimeout);

    // Confirm to the player quietly
    await sock.sendMessage(chatJid, { text: `✅ Move locked in: *${MOVES[moveId].emoji} ${moveName}*\n⏳ Waiting for opponent...` }, { quoted: message });

    const opponentId = match.p1 === sender ? match.p2 : match.p1;

    // If both players have moved, resolve the round
    if (match.moves[match.p1] && match.moves[match.p2]) {
      clearTimeout(match.roundTimeout);
      await this._resolveRound(match, sock);
    } else {
      // Only one player moved — start timer for the idle opponent
      this._startRoundTimeout(match.id, sock);
    }
  }

  // ── Resolve a round once both players have moved ────────────────
  async _resolveRound(match, sock) {
    const p1Move = MOVES[match.moves[match.p1]];
    const p2Move = MOVES[match.moves[match.p2]];

    // Apply gym bonuses to hit chance
    // overallWinBonus applies to EVERY move — higher gym level = higher base hit rate
    // gymGapBonus/Penalty: comparative advantage from being better/worse trained
    const isLateRound = match.round >= 5;
    const p1HitBonus = match.p1Gym.overallWinBonus
                     + (match.p1Gym.gymGapBonus    || 0)
                     - (match.p1Gym.gymGapPenalty   || 0)
                     + (p1Move.cmd === '.jab'   || p1Move.cmd === '.cross' ? match.p1Gym.paceBonus    : 0)
                     + (p1Move.cmd === '.slip'                              ? match.p1Gym.reflexBonus  : 0)
                     + (p1Move.cmd === '.combo'                             ? match.p1Gym.agilityBonus : 0)
                     + (isLateRound                                         ? match.p1Gym.staminaBonus : 0);
    const p2HitBonus = match.p2Gym.overallWinBonus
                     + (match.p2Gym.gymGapBonus    || 0)
                     - (match.p2Gym.gymGapPenalty   || 0)
                     + (p2Move.cmd === '.jab'   || p2Move.cmd === '.cross' ? match.p2Gym.paceBonus    : 0)
                     + (p2Move.cmd === '.slip'                              ? match.p2Gym.reflexBonus  : 0)
                     + (p2Move.cmd === '.combo'                             ? match.p2Gym.agilityBonus : 0)
                     + (isLateRound                                         ? match.p2Gym.staminaBonus : 0);

    // ── ANTI-COMEBACK FIX ──────────────────────────────────────────────────
    // When a player has a dominant HP lead (65+ ahead, opp < 20HP),
    // give them a finishing bonus so their moves don't randomly miss streak.
    // Also apply a soft nerf to the losing fighter's big swings to prevent
    // miracle comebacks from pure luck on haymakers/combos.
    let p1FinishBonus = 0, p2FinishBonus = 0;
    let p1SwingNerf  = 0, p2SwingNerf   = 0;

    const hpGap = match.p1Hp - match.p2Hp;
    if (hpGap >= 65 && match.p2Hp < 20) {
      // p1 is dominating — boost their accuracy, nerf opp big swings
      p1FinishBonus = 0.20;
      if (p2Move.hit < 0.50) p2SwingNerf = 0.20; // nerf haymaker/combo/upc only
    } else if (-hpGap >= 65 && match.p1Hp < 20) {
      // p2 is dominating
      p2FinishBonus = 0.20;
      if (p1Move.hit < 0.50) p1SwingNerf = 0.20;
    }

    const p1FinalHit = Math.min(0.98, (p1Move.hit + p1HitBonus + p1FinishBonus - p1SwingNerf));
    const p2FinalHit = Math.min(0.98, (p2Move.hit + p2HitBonus + p2FinishBonus - p2SwingNerf));

    const p1Hit = Math.random() < p1FinalHit;
    const p2Hit = Math.random() < p2FinalHit;

    let p1Dmg = rollDmg(p1Move, p1Hit);
    let p2Dmg = rollDmg(p2Move, p2Hit);

    // Apply gym damage bonus / reduction
    if (p1Dmg > 0) { p1Dmg = Math.max(1, p1Dmg + match.p1Gym.dmgBonus - match.p2Gym.dmgReduction); }
    if (p2Dmg > 0) { p2Dmg = Math.max(1, p2Dmg + match.p2Gym.dmgBonus - match.p1Gym.dmgReduction); }

    match.p2Hp = Math.max(0, match.p2Hp - p1Dmg);
    match.p1Hp = Math.max(0, match.p1Hp - p2Dmg);

    const p1Name = this.db.getDisplayName(match.p1);
    const p2Name = this.db.getDisplayName(match.p2);

    const p1Comment = p1Move.commentary[Math.floor(Math.random() * p1Move.commentary.length)];
    const p2Comment = p2Move.commentary[Math.floor(Math.random() * p2Move.commentary.length)];

    const lines = [
      `🔔 *Round ${match.round}*`,
      ``,
      p1Hit
        ? `🔴 *${p1Name}* — ${p1Move.emoji} ${p1Move.name}: ${p1Comment} *-${p1Dmg} HP*`
        : `🔴 *${p1Name}* — ${p1Move.emoji} ${p1Move.name}: MISSED! 💨`,
      p2Hit
        ? `🔵 *${p2Name}* — ${p2Move.emoji} ${p2Move.name}: ${p2Comment} *-${p2Dmg} HP*`
        : `🔵 *${p2Name}* — ${p2Move.emoji} ${p2Move.name}: MISSED! 💨`,
      ``,
      `❤️ ${p1Name}: ${match.p1Hp}/100  ${hpBar(match.p1Hp)}`,
      `❤️ ${p2Name}: ${match.p2Hp}/100  ${hpBar(match.p2Hp)}`,
    ];

    // Clear moves for next round
    match.moves = {};
    match.round++;

    const knockedOut = match.p1Hp <= 0 || match.p2Hp <= 0;
    const maxReached = match.round > match.maxRounds;

    if (knockedOut || maxReached) {
      lines.push(``, knockedOut ? `💥 *KNOCKOUT!*` : `🏁 *Final round complete!*`);
      await sock.sendMessage(match.chatJid, { text: lines.join('\n') });
      await this._endFight(match, sock);
    } else {
      lines.push(MOVE_PROMPT);
      await sock.sendMessage(match.chatJid, { text: lines.join('\n') });
      this._startRoundTimeout(match.id, sock);
    }
  }

  // ── Round timeout — 3 minutes: idle player auto-forfeits ───────
  _startRoundTimeout(matchId, sock) {
    const match = activeMatches[matchId];
    if (!match) return;
    clearTimeout(match.roundTimeout);
    match.roundTimeout = setTimeout(async () => {
      const m = activeMatches[matchId];
      if (!m || m.status !== 'active') return;

      // Find who hasn't moved
      const idle = [m.p1, m.p2].filter(pid => !m.moves[pid]);
      if (idle.length === 0) return; // both moved, race condition

      // If both idle (neither moved at all this round)
      if (idle.length === 2) {
        // Double forfeit — both lose, no payout
        m.status = 'done';
        delete activeMatches[matchId];
        for (const pid of [m.p1, m.p2]) {
          if (global._tttActive) delete global._tttActive[pid]; // safety
        }
        await sock.sendMessage(m.chatJid, {
          text: `⏰ *AUTO-FORFEIT FOR BOTH FIGHTERS.*\n\nNeither player moved in 3 minutes.\nFight cancelled. No payout.`
        }).catch(() => {});
        return;
      }

      // One idle — they forfeit, opponent wins
      const idleId   = idle[0];
      const winnerId = m.p1 === idleId ? m.p2 : m.p1;
      const idleName = this.db.getDisplayName(idleId);
      const winName  = this.db.getDisplayName(winnerId);

      m.status = 'done';
      // Force HP so _endFight picks correct winner
      if (m.p1 === idleId) { m.p1Hp = 0; } else { m.p2Hp = 0; }

      await sock.sendMessage(m.chatJid, {
        text: `⏰ *AUTO-FORFEIT*\n\n*${idleName}* didn't move for 3 minutes\n🏆 *${winName}* wins by default.`
      }).catch(() => {});

      await this._endFight(m, sock);
    }, TURN_TIMEOUT_BOX);
  }

  // ── End fight, determine winner, pay out ────────────────────────
  async _endFight(match, sock) {
    delete activeMatches[match.id];
    match.status = 'done';

    const p1Name = this.db.getDisplayName(match.p1);
    const p2Name = this.db.getDisplayName(match.p2);

    let winnerId, loserId, winnerHp, loserHp;
    if (match.p1Hp > match.p2Hp || (match.p1Hp === match.p2Hp && Math.random() < 0.5)) {
      winnerId = match.p1; loserId = match.p2;
      winnerHp = match.p1Hp; loserHp = match.p2Hp;
    } else {
      winnerId = match.p2; loserId = match.p1;
      winnerHp = match.p2Hp; loserHp = match.p1Hp;
    }

    const tie     = match.p1Hp === match.p2Hp;
    const winName = this.db.getDisplayName(winnerId);
    const loseName= this.db.getDisplayName(loserId);
    const gap     = winnerHp - loserHp;

    let outcome, injuries, reward = 0, consolation = 0;
    if (tie) {
      outcome = 'TIE'; injuries = ['puffy_face'];
    } else if (winnerHp >= 80 && loserHp <= 10) {
      outcome = 'FLAWLESS_VICTORY'; injuries = LOSS_INJURIES.flawless_loss; reward = match.bet + 5000;
    } else if (gap < 20) {
      outcome = 'CLOSE_WIN'; injuries = LOSS_INJURIES.close_loss; reward = match.bet + 2000; consolation = 1000;
    } else {
      outcome = 'NORMAL_WIN'; injuries = LOSS_INJURIES.normal_loss; reward = match.bet;
    }

    const outcomeLabels = {
      FLAWLESS_VICTORY: `👑 *FLAWLESS VICTORY!* *${winName}* was untouchable!`,
      CLOSE_WIN:        `😤 *CLOSE FIGHT!* *${winName}* edges it on points!`,
      NORMAL_WIN:       `🏆 *${winName} WINS!*`,
      TIE:              `🤝 *SPLIT DECISION — TIE!* Both fighters were equal!`,
    };

    const finalLines = [
      `━━━━━━━━━━━━━━━━━`,
      `🎙️ *${match.commentator}:* "${this._commentOnOutcome(outcome, winName, loseName)}"`,
      `━━━━━━━━━━━━━━━━━`,
      ``,
      outcomeLabels[outcome],
      ``,
    ];

    if (!tie) {
      finalLines.push(`🏅 Winner: *${winName}* (${winnerHp} HP left)`);
      finalLines.push(`💔 Loser:  *${loseName}* (${loserHp} HP left)`);
    }

    const winner = this.db.getPlayer(winnerId);
    const loser  = this.db.getPlayer(loserId);

    if (match.bet > 0 && !tie) {
      winner.cash = (winner.cash||0) + match.bet;
      loser.cash  = Math.max(0, (loser.cash||0) - match.bet);
      finalLines.push(``, `💰 ${winName} wins: +$${match.bet.toLocaleString()}`);
    }
    if (reward > match.bet && !tie) {
      winner.cash = (winner.cash||0) + (reward - match.bet);
      finalLines.push(`🎁 Bonus: +$${(reward - match.bet).toLocaleString()}`);
    }
    if (consolation > 0 && !tie) {
      loser.cash = (loser.cash||0) + consolation;
      finalLines.push(`😅 ${loseName} consolation: +$${consolation.toLocaleString()}`);
    }

    winner.experience = (winner.experience||0) + 30;
    loser.experience  = (loser.experience||0)  + 10;
    finalLines.push(``, `⭐ ${winName}: +30 XP  |  ${loseName}: +10 XP`);

    // ── Record boxing stats ─────────────────────────────────────
    if (!tie) {
      applyBoxResult(winner, 'win',  outcome);
      applyBoxResult(loser,  'loss', null);
    } else {
      applyBoxResult(winner, 'draw', null);
      applyBoxResult(loser,  'draw', null);
    }

    // Announce new best streak milestones
    if (!tie && winner.boxStats.currentStreak > 1) {
      finalLines.push(`🔥 ${winName} is on a *${winner.boxStats.currentStreak}-fight win streak!*`);
    }

    if (!tie) {
      HospitalCommand.admitPlayer(this.db, loserId, injuries);
      finalLines.push(``, `🏥 *${loseName} has been rushed to hospital!*`);
      injuries.forEach(inj => {
        const def = INJURIES[inj];
        if (def) finalLines.push(`  → ${def.label}`);
      });
      finalLines.push(`💊 *.hospital* to treat`);
    } else {
      HospitalCommand.admitPlayer(this.db, match.p1, ['puffy_face']);
      HospitalCommand.admitPlayer(this.db, match.p2, ['puffy_face']);
      finalLines.push(``, `🤕 Both fighters got puffy faces treat with*.hospital*`);
    }

    this.db.updatePlayer(winnerId, winner);
    this.db.updatePlayer(loserId, loser);

    // ── Award gym points from boxing result ──────────────────────────────
    // Win = up to 5pts, draw = 3pts, loss = 2pts — distributed randomly across attributes
    try {
      const { GymCommand } = require('./gym');
      const gymCmd = new GymCommand(this.db);
      if (!tie) {
        const winnerGym = gymCmd.awardBoxPoints(winnerId, 'win');
        const loserGym  = gymCmd.awardBoxPoints(loserId,  'loss');
        if (winnerGym.ptsToAward > 0) finalLines.push(`💪 ${winName} earned +${winnerGym.ptsToAward} gym pt${winnerGym.ptsToAward > 1 ? 's' : ''}!`);
        if (loserGym.ptsToAward > 0)  finalLines.push(`💪 ${loseName} earned +${loserGym.ptsToAward} gym pt${loserGym.ptsToAward > 1 ? 's' : ''} from the loss.`);
      } else {
        // Draw / close fight
        const p1Gym = gymCmd.awardBoxPoints(match.p1, 'draw');
        const p2Gym = gymCmd.awardBoxPoints(match.p2, 'draw');
        const p1N   = this.db.getDisplayName(match.p1);
        const p2N   = this.db.getDisplayName(match.p2);
        if (p1Gym.ptsToAward > 0) finalLines.push(`💪 ${p1N} earned +${p1Gym.ptsToAward} gym pt${p1Gym.ptsToAward > 1 ? 's' : ''}!`);
        if (p2Gym.ptsToAward > 0) finalLines.push(`💪 ${p2N} earned +${p2Gym.ptsToAward} gym pt${p2Gym.ptsToAward > 1 ? 's' : ''}!`);
      }
    } catch(e) {}

    // ── Record H2H match history ─────────────────────────────────────────
    const matchRecord = {
      ts:       Date.now(),
      p1:       match.p1,
      p2:       match.p2,
      p1Hp:     match.p1Hp,
      p2Hp:     match.p2Hp,
      winner:   tie ? null : winnerId,
      loser:    tie ? null : loserId,
      winnerHp: tie ? match.p1Hp : winnerHp,
      loserHp:  tie ? match.p2Hp : loserHp,
      outcome,
      bet:      match.bet,
    };
    if (!this.db.data.boxHistory) this.db.data.boxHistory = [];
    this.db.data.boxHistory.push(matchRecord);
    if (this.db.data.boxHistory.length > 2000) {
      this.db.data.boxHistory = this.db.data.boxHistory.slice(-2000);
    }
    this.db.saveData();

    await sock.sendMessage(match.chatJid, { text: finalLines.join('\n') });
  }

  // ── Forfeit active match ────────────────────────────────────────
  async forfeit(sender, chatJid, sock, message) {
    // Check active match
    const match = this._getPlayerMatch(sender);
    if (match) {
      clearTimeout(match.roundTimeout);
      const opponentId = match.p1 === sender ? match.p2 : match.p1;
      const forfeitName = this.db.getDisplayName(sender);
      const oppName     = this.db.getDisplayName(opponentId);
      // Force loser outcome
      if (match.p1 === sender) { match.p1Hp = 0; } else { match.p2Hp = 0; }
      await sock.sendMessage(match.chatJid, { text: `🚩 *${forfeitName}* forfeits the fight!\n\n🏆 *${oppName}* wins by forfeit!` });
      await this._endFight(match, sock);
      return;
    }
    // Check pending challenge
    const isPending = Object.entries(global._boxPending || {}).find(([, p]) => p.challengerId === sender);
    if (isPending) {
      delete global._boxPending[isPending[0]];
      await sock.sendMessage(chatJid, { text: `🚫 Boxing challenge cancelled.` }, { quoted: message });
      return;
    }
    await sock.sendMessage(chatJid, { text: `No active boxing match to forfeit.` }, { quoted: message });
  }

  // ── Helpers ─────────────────────────────────────────────────────
  _getPlayerMatch(playerId) {
    return Object.values(activeMatches).find(
      m => m.status === 'active' && (m.p1 === playerId || m.p2 === playerId)
    ) || null;
  }

  _commentOnOutcome(outcome, winName, loseName) {
    const lines = {
      FLAWLESS_VICTORY: [`*${winName}* made it look EASY. *${loseName}* never stood a chance!`, `DOMINANT! *${winName}* was on another level tonight!`],
      CLOSE_WIN:        [`What a fight! *${winName}* barely scraped through — give it up!`, `*${winName}* by a fraction! Both warriors left everything in the ring!`],
      NORMAL_WIN:       [`*${winName}* put in work! *${loseName}* fought hard but that wasn't enough!.`, `Lights out for *${loseName}*. *${winName}* showed us who the boss is!`],
      TIE:              [`I've never seen anything like it! Both fighters are LEGENDS!`, `The judges can't separate these two. Respect to both!`],
    };
    const opts = lines[outcome] || lines.NORMAL_WIN;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // ── Boxing Leaderboard ──────────────────────────────────────────
  async showLeaderboard(chatJid, sock, message) {
    const allPlayers = Object.values(this.db.data.players);

    // Auto-migrate any player who has fought (wins+losses+draws > 0 in legacy
    // stats) but has no boxStats yet — seeds them with zeros so they appear.
    // Also ensures any player already in gamedata.json gets the field.
    allPlayers.forEach(p => ensureBoxStats(p));

    // Build ranked list: only fighters who have at least one fight recorded
    const fighters = allPlayers
      .filter(p => (p.boxStats.wins + p.boxStats.losses + p.boxStats.draws) > 0)
      .map(p => {
        const bs    = p.boxStats;
        const total = bs.wins + bs.losses + bs.draws;
        const winPct = total > 0 ? Math.round((bs.wins / total) * 100) : 0;
        const totalMedals = bs.medals.gold + bs.medals.silver + bs.medals.bronze;
        return {
          id:        p.id,
          name:      this.db.getDisplayName(p.id),
          wins:      bs.wins,
          draws:     bs.draws,
          losses:    bs.losses,
          streak:    bs.currentStreak,
          bestStreak:bs.bestStreak,
          gold:      bs.medals.gold,
          silver:    bs.medals.silver,
          bronze:    bs.medals.bronze,
          totalMedals,
          winPct,
          // Sort key: wins first, then win %, then best streak
          sortKey:   bs.wins * 1000 + winPct * 10 + bs.bestStreak,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 10);

    if (fighters.length === 0) {
      await sock.sendMessage(chatJid, {
        text: [
          `🥊 *BOXING LEADERBOARD*`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          ``,
          `No fighters on record yet.`,
          `Start a fight: *.box @player*`,
        ].join('\n')
      }, { quoted: message });
      return;
    }

    const rankEmoji = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

    const lines = [
      `🥊 *BOXING LEADERBOARD*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
    ];

    fighters.forEach((f, i) => {
      // Medal string — only show medal types the fighter actually has
      const medalParts = [];
      if (f.gold   > 0) medalParts.push(`${f.gold}🥇`);
      if (f.silver > 0) medalParts.push(`${f.silver}🥈`);
      if (f.bronze > 0) medalParts.push(`${f.bronze}🥉`);
      const medalStr = medalParts.length > 0 ? `, ${medalParts.join(' ')} medal${f.totalMedals !== 1 ? 's' : ''}` : '';

      // Streak display
      let streakStr = '';
      if (f.streak > 1)       streakStr = `, ${f.streak} win streak 🔥`;
      else if (f.streak < -1) streakStr = `, ${Math.abs(f.streak)} loss streak 📉`;
      else if (f.bestStreak > 1) streakStr = `, best streak ${f.bestStreak} 🔥`;

      lines.push(
        `${rankEmoji[i]} *${f.name}*  ${f.wins}W ${f.draws}D ${f.losses}L${medalStr}${streakStr}`
      );
    });

    lines.push(``);
    lines.push(`🏆 Rankings by wins → win rate → best streak`);
    lines.push(`💊 *.box @player [bet]* — Challenge someone`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── H2H Match History ──────────────────────────────────────────────────
  async showH2H(args, sender, chatJid, sock, message) {
    const _rawTarget = resolveMention(message, args, 0);
    if (!_rawTarget) {
      await sock.sendMessage(chatJid, { text: `Usage: *.box h2h @player*\nCheck your detailed match history with any opponent.` }, { quoted: message });
      return;
    }
    const targetId = normJid(_rawTarget);
    if (targetId === sender) {
      await sock.sendMessage(chatJid, { text: `You can't check H2H with yourself.` }, { quoted: message }); return;
    }

    const history = this.db.data.boxHistory || [];

    // Filter only matches between sender and target
    const h2hMatches = history.filter(r =>
      (r.p1 === sender && r.p2 === targetId) ||
      (r.p1 === targetId && r.p2 === sender)
    ).sort((a, b) => b.ts - a.ts); // newest first

    const myName     = this.db.getDisplayName(sender);
    const oppName    = this.db.getDisplayName(targetId);

    if (h2hMatches.length === 0) {
      await sock.sendMessage(chatJid, {
        text: `🥊 *H2H: ${myName} vs ${oppName}*\n━━━━━━━━━━━━━━━━━\n\nNo recorded fights between you two yet.\nChallenge: *.box @player*`
      }, { quoted: message });
      return;
    }

    let myWins = 0, myLosses = 0, draws = 0;
    let myBestWin  = null; // biggest HP gap win (my HP - opp HP)
    let myWorstLoss = null; // biggest HP gap loss

    for (const r of h2hMatches) {
      const iAmP1     = r.p1 === sender;
      const myHp      = iAmP1 ? r.p1Hp : r.p2Hp;
      const oppHp     = iAmP1 ? r.p2Hp : r.p1Hp;
      const iWon      = r.winner === sender;
      const iLost     = r.loser  === sender;
      const isDraw    = r.winner === null;

      if (isDraw) { draws++; continue; }
      if (iWon) {
        myWins++;
        const gap = myHp - oppHp;
        if (!myBestWin || gap > (myBestWin.myHp - myBestWin.oppHp)) {
          myBestWin = { myHp, oppHp, ts: r.ts, outcome: r.outcome };
        }
      } else if (iLost) {
        myLosses++;
        const gap = oppHp - myHp;
        if (!myWorstLoss || gap > (myWorstLoss.oppHp - myWorstLoss.myHp)) {
          myWorstLoss = { myHp, oppHp, ts: r.ts, outcome: r.outcome };
        }
      }
    }

    const total = h2hMatches.length;
    const winPct = total > 0 ? Math.round((myWins / total) * 100) : 0;

    // Recent 5 matches log
    const recentLog = h2hMatches.slice(0, 5).map(r => {
      const iWon   = r.winner === sender;
      const isDraw = r.winner === null;
      const iAmP1  = r.p1 === sender;
      const myHp   = iAmP1 ? r.p1Hp : r.p2Hp;
      const oppHp  = iAmP1 ? r.p2Hp : r.p1Hp;
      const icon   = isDraw ? '🤝' : iWon ? '✅' : '❌';
      const date   = new Date(r.ts).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
      return `  ${icon} ${date} — ${iWon ? 'Win' : isDraw ? 'Draw' : 'Loss'} (${myHp}HP vs ${oppHp}HP)`;
    });

    // Match facts
    const facts = [];
    if (myWins > myLosses) facts.push(`🔥 You lead this rivalry!`);
    else if (myLosses > myWins) facts.push(`💀 ${oppName} has the edge on you.`);
    else if (myWins === myLosses && myWins > 0) facts.push(`⚖️ Dead even — this rivalry is spicy!`);
    if (myWins >= 3 && myLosses === 0) facts.push(`👑 You're UNDEFEATED against ${oppName}!`);
    if (myLosses >= 3 && myWins === 0) facts.push(`😭 You've never beaten ${oppName} — time to train!`);
    if (draws > 0) facts.push(`🤝 ${draws} draw${draws > 1 ? 's' : ''} — you two are evenly matched.`);

    const lines = [
      `🥊 *H2H: ${myName} vs ${oppName}*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `📊 *OVERALL RECORD*`,
      `🏆 Wins: ${myWins}   ❌ Losses: ${myLosses}   🤝 Draws: ${draws}`,
      `📈 Win Rate: ${winPct}%   🎮 Total: ${total} fights`,
      ``,
    ];

    if (myBestWin) {
      lines.push(`🏅 *BIGGEST WIN*`);
      lines.push(`  You: ${myBestWin.myHp}HP vs ${oppName}: ${myBestWin.oppHp}HP (${myBestWin.outcome?.replace(/_/g,' ')})`);
      lines.push(``);
    }
    if (myWorstLoss) {
      lines.push(`💔 *BIGGEST LOSS*`);
      lines.push(`  You: ${myWorstLoss.myHp}HP vs ${oppName}: ${myWorstLoss.oppHp}HP`);
      lines.push(``);
    }

    lines.push(`📋 *RECENT FIGHTS*`);
    lines.push(...recentLog);
    if (h2hMatches.length > 5) lines.push(`  ...and ${h2hMatches.length - 5} more fights`);

    if (facts.length > 0) {
      lines.push(``, `💬 *MATCH FACTS*`);
      facts.forEach(f => lines.push(`  ${f}`));
    }

    lines.push(``, `🔁 Rematch: *.box @${targetId.split('@')[0]}*`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  // ── Migration: call once on bot startup to ensure all existing ──
  // ── players in gamedata.json have a boxStats field.            ──
  migrateExistingPlayers() {
    let migrated = 0;
    Object.values(this.db.data.players).forEach(p => {
      if (!p.boxStats) {
        ensureBoxStats(p);
        migrated++;
      }
    });
    if (migrated > 0) {
      this.db.saveData();
      console.log(`[Boxing] Migrated ${migrated} player(s) — boxStats field added.`);
    }
  }
}

module.exports = { BoxingCommand, activeMatches };
