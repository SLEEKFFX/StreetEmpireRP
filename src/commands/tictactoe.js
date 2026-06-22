// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — TIC TAC TOE  v2.0
//  PvP + Solo vs AI modes, leaderboard, 3-min auto-forfeit
// ═══════════════════════════════════════════════════════════════

const { resolveMention, normJid } = require('../utils/resolveMention');

const activeGames = {};
const pendingTTT  = {};

// ── Solo difficulty config ──────────────────────────────────────
const SOLO_MODES = {
  easy: { label: 'Easy',   aiLevel: 0, minPrize: 5_000,  maxPrize: 10_000, xp: 0,  cost: 2_000  },
  med:  { label: 'Medium', aiLevel: 1, minPrize: 11_000, maxPrize: 20_000, xp: 5,  cost: 5_000  },
  hard: { label: 'Hard',   aiLevel: 2, minPrize: 21_000, maxPrize: 30_000, xp: 10, cost: 10_000 },
  pro:  { label: 'Pro',    aiLevel: 3, minPrize: 30_000, maxPrize: 100_000,xp: 20, cost: 20_000 },
};

const TURN_TIMEOUT = 3 * 60 * 1000; // 3 minutes

// ── AI move logic ───────────────────────────────────────────────
function aiMove(board, aiMark, aiLevel) {
  const playerMark = aiMark === 'O' ? 'X' : 'O';

  // Level 3 (pro): minimax
  if (aiLevel >= 3) return minimaxBest(board, aiMark);

  // Level 2 (hard): win or block, then center/corner
  if (aiLevel >= 2) {
    const win = findWinMove(board, aiMark);
    if (win !== -1) return win;
    const blk = findWinMove(board, playerMark);
    if (blk !== -1) return blk;
    if (board[4] === null) return 4;
    const corners = [0,2,6,8].filter(i => board[i] === null);
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  }

  // Level 1 (medium): sometimes block, otherwise random
  if (aiLevel >= 1) {
    if (Math.random() > 0.4) {
      const blk = findWinMove(board, playerMark);
      if (blk !== -1) return blk;
    }
  }

  // Random empty cell
  const empty = board.map((v,i) => v === null ? i : -1).filter(i => i !== -1);
  return empty[Math.floor(Math.random() * empty.length)];
}

function findWinMove(board, mark) {
  const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of wins) {
    const line = [board[a], board[b], board[c]];
    if (line.filter(v => v === mark).length === 2 && line.includes(null)) {
      return [a,b,c][line.indexOf(null)];
    }
  }
  return -1;
}

function minimaxBest(board, aiMark) {
  const playerMark = aiMark === 'O' ? 'X' : 'O';
  let best = -Infinity, move = -1;
  board.forEach((v, i) => {
    if (v !== null) return;
    board[i] = aiMark;
    const score = minimax(board, 0, false, aiMark, playerMark);
    board[i] = null;
    if (score > best) { best = score; move = i; }
  });
  return move;
}

function minimax(board, depth, isMax, aiMark, playerMark) {
  const w = checkWinner(board);
  if (w === aiMark)     return 10 - depth;
  if (w === playerMark) return depth - 10;
  if (board.every(c => c !== null)) return 0;
  if (isMax) {
    let best = -Infinity;
    board.forEach((v, i) => { if (v !== null) return; board[i] = aiMark; best = Math.max(best, minimax(board, depth+1, false, aiMark, playerMark)); board[i] = null; });
    return best;
  } else {
    let best = Infinity;
    board.forEach((v, i) => { if (v !== null) return; board[i] = playerMark; best = Math.min(best, minimax(board, depth+1, true, aiMark, playerMark)); board[i] = null; });
    return best;
  }
}

function checkWinner(b) {
  const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,c,d] of wins) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return null;
}

function renderBoard(board) {
  const sym = (v) => v === 'X' ? '❌' : v === 'O' ? '⭕' : '⬜';
  const [a,b,c,d,e,f,g,h,i] = board;
  return [`${sym(a)} ${sym(b)} ${sym(c)}`, `${sym(d)} ${sym(e)} ${sym(f)}`, `${sym(g)} ${sym(h)} ${sym(i)}`].join('\n');
}

// ── Update leaderboard stats ────────────────────────────────────
function recordTTTResult(db, playerId, won, mode) {
  const p = db.getPlayer(playerId);
  if (!p.tttStats) p.tttStats = { wins: 0, losses: 0, draws: 0, pvpWins: 0, soloWins: 0, earnings: 0 };
  if (won === 'win')   { p.tttStats.wins++;   if (mode === 'solo') p.tttStats.soloWins++;   else p.tttStats.pvpWins++; }
  if (won === 'loss')  { p.tttStats.losses++; }
  if (won === 'draw')  { p.tttStats.draws++;  }
  db.updatePlayer(playerId, p);
}

class TicTacToeCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'help' || sub === 'menu') return this.showMenu(chatJid, sock, message);
    if (sub === 'lb' || sub === 'leaderboard')    return this.showLeaderboard(chatJid, sock, message);
    if (SOLO_MODES[sub])                          return this.startSolo(sub, sender, chatJid, sock, message);
    if (args[0]?.includes('@') || /^\d{5,}/.test(args[0])) return this.challenge(args, sender, chatJid, sock, message);
    if (sub === 'accept')  return this.acceptInvite(sender, chatJid, sock, message);
    if (sub === 'decline') return this.declineInvite(sender, chatJid, sock, message);
    if (/^[1-9]$/.test(sub)) return this.playMove(parseInt(sub), sender, chatJid, sock, message);

    return this.showMenu(chatJid, sock, message);
  }

  async showMenu(chatJid, sock, message) {
    const text = [
      `⭕ *TIC TAC TOE*`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `*SOLO VS AI:*`,
      `*.ttt easy*  — Win $5k–$10k  | Entry $2k`,
      `*.ttt med*   — Win $11k–$20k | Entry $5k  | +5 XP`,
      `*.ttt hard*  — Win $21k–$30k | Entry $10k | +10 XP`,
      `*.ttt pro*   — Win $30k–$100k| Entry $20k | +20 XP`,
      `*PVP:*`,
      `*.ttt @player [bet]* — Challenge someone`,
      `*.ttt accept*        — Accept a challenge`,
      `*.ttt decline*       — Decline`,
      `*.ttt [1-9]*         — Play your move`,
      `*.ttt lb*            — Leaderboard`,
      `*BOARD POSITIONS:*`,
      `1️⃣2️⃣3️⃣  4️⃣5️⃣6️⃣  7️⃣8️⃣9️⃣`,
      `⚠️ 3 minutes to move or auto-forfeit`,
    ].join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  // ── Solo mode ─────────────────────────────────────────────────
  async startSolo(difficulty, sender, chatJid, sock, message) {
    const mode = SOLO_MODES[difficulty];
    const p    = this.db.getPlayer(sender);

    // Check if already in a game
    const existingId = global._tttActive?.[sender];
    if (existingId && activeGames[existingId]) {
      await sock.sendMessage(chatJid, { text: `You're already in a game!\nPlay your move with *.ttt [1-9]*` }, { quoted: message }); return;
    }

    if ((p.cash||0) < mode.cost) {
      await sock.sendMessage(chatJid, { text: `❌ Entry fee: $${mode.cost.toLocaleString()}\nYou have: $${(p.cash||0).toLocaleString()}` }, { quoted: message }); return;
    }

    p.cash -= mode.cost;
    this.db.updatePlayer(sender, p);

    // ── 4-Round Series: track round count and alternate first move ──
    // Rounds 1 & 3: Player goes first (X). Rounds 2 & 4: AI goes first (O plays immediately).
    if (!global._tttSeries) global._tttSeries = {};
    if (!global._tttSeries[sender]) global._tttSeries[sender] = { round: 0, playerWins: 0, aiWins: 0, draws: 0 };
    const series = global._tttSeries[sender];

    // Starting a new 4-round series if round >= 4 or just starting fresh
    if (series.round >= 4) {
      global._tttSeries[sender] = { round: 0, playerWins: 0, aiWins: 0, draws: 0 };
    }
    series.round += 1;
    const currentRound = series.round;

    // Odd rounds (1,3): player first. Even rounds (2,4): AI first.
    const aiGoesFirst = (currentRound % 2 === 0);

    const gameId = `ttt_solo_${Date.now()}`;
    const game = {
      id: gameId, solo: true, difficulty,
      player: sender, aiMark: 'O', playerMark: 'X',
      board: Array(9).fill(null),
      turn: aiGoesFirst ? 'ai' : 'player',
      chatJid, status: 'active',
      mode, cost: mode.cost,
      moveTimeout: null,
      round: currentRound,
    };
    activeGames[gameId] = game;
    if (!global._tttActive) global._tttActive = {};
    global._tttActive[sender] = gameId;

    const seriesSummary = currentRound === 1
      ? `🆕 *4-Round Series begins!*`
      : `📊 Series: 🏆${series.playerWins}W  🤖${series.aiWins}L  🤝${series.draws}D  (Round ${currentRound}/4)`;

    if (aiGoesFirst) {
      // AI makes its first move immediately
      const aiCell = aiMove(game.board, game.aiMark, SOLO_MODES[game.difficulty].aiLevel);
      if (aiCell !== null && aiCell !== undefined && aiCell !== -1) {
        game.board[aiCell] = game.aiMark;
      }
      game.turn = 'player';
      await sock.sendMessage(chatJid, {
        text: [
          `⭕ *TTT — ${mode.label.toUpperCase()} — ROUND ${currentRound}/4*`,
          ``,
          seriesSummary,
          `💰 Entry: $${mode.cost.toLocaleString()}`,
          `🏆 Prize: $${mode.minPrize.toLocaleString()}–$${mode.maxPrize.toLocaleString()} if you win`,
          ``,
          `🤖 *AI goes first this round!*`,
          renderBoard(game.board),
          ``,
          `❌ Your turn! Use *.ttt [1-9]* to play`,
          `⚠️ 3 mins per move or auto-forfeit`,
        ].join('\n')
      }, { quoted: message });
    } else {
      await sock.sendMessage(chatJid, {
        text: [
          `⭕ *TTT — ${mode.label.toUpperCase()} — ROUND ${currentRound}/4*`,
          ``,
          seriesSummary,
          `💰 Entry: $${mode.cost.toLocaleString()}`,
          `🏆 Prize: $${mode.minPrize.toLocaleString()}–$${mode.maxPrize.toLocaleString()} if you win`,
          `${mode.xp > 0 ? `⭐ +${mode.xp} XP on win` : `🆓 No XP (easy mode)`}`,
          ``,
          renderBoard(game.board),
          ``,
          `❌ You go first! Use *.ttt [1-9]* to play`,
          `⚠️ 3 mins per move or auto-forfeit`,
        ].join('\n')
      }, { quoted: message });
    }

    this._startMoveTimeout(gameId, sender, sock);
  }

  // ── PvP challenge ─────────────────────────────────────────────
  async challenge(args, sender, chatJid, sock, message) {
    const existingId = global._tttActive?.[sender];
    if (existingId && activeGames[existingId]) {
      await sock.sendMessage(chatJid, { text: `Already in a game! Finish it first.` }, { quoted: message }); return;
    }

    const _rawTargetId = resolveMention(message, args, 0);
    if (!_rawTargetId) { await sock.sendMessage(chatJid, { text: `❌ Tag a player!\n*.ttt @player [bet]*` }, { quoted: message }); return; }
    const targetId = normJid(_rawTargetId);
    if (targetId === sender) { await sock.sendMessage(chatJid, { text: `❌ Can't play yourself!` }, { quoted: message }); return; }

    const bet = parseInt(args[1]) || 0;
    if (bet < 0 || (bet > 0 && bet < 200)) {
      await sock.sendMessage(chatJid, { text: `❌ Min bet $200 or $0 for free.` }, { quoted: message }); return;
    }

    const p = this.db.getPlayer(sender);
    if (bet > 0 && (p.cash||0) < bet) {
      await sock.sendMessage(chatJid, { text: `❌ Not enough cash!` }, { quoted: message }); return;
    }

    if (pendingTTT[targetId]) {
      await sock.sendMessage(chatJid, { text: `❌ That player already has a pending challenge!` }, { quoted: message }); return;
    }

    pendingTTT[targetId] = { challengerId: sender, bet, chatJid, expiresAt: Date.now() + 90000 };

    const chalName  = this.db.getDisplayName(sender);
    const targPhone = targetId.split('@')[0];

    await sock.sendMessage(chatJid, {
      text: [
        `⭕ *TIC TAC TOE CHALLENGE!*`,
        ``,
        `@${targPhone} — *${chalName}* challenges you!`,
        bet > 0 ? `💰 Bet: $${bet.toLocaleString()} each` : `🆓 Free match`,
        ``,
        `*.ttt accept* to play  |  *.ttt decline* to pass`,
        `⏳ 90 seconds to respond`,
      ].join('\n'),
      mentions: [targetId],
    }, { quoted: message });

    setTimeout(() => {
      if (pendingTTT[targetId]?.challengerId === sender) {
        delete pendingTTT[targetId];
        sock.sendMessage(chatJid, { text: `⏰ TTT challenge from ${chalName} expired.`, mentions: [targetId] }).catch(() => {});
      }
    }, 90000);
  }

  async acceptInvite(sender, chatJid, sock, message) {
    const invite = pendingTTT[sender];
    if (!invite || Date.now() > invite.expiresAt) {
      await sock.sendMessage(chatJid, { text: `❌ No active TTT challenge for you.` }, { quoted: message }); return;
    }
    delete pendingTTT[sender];

    const { challengerId, bet } = invite;
    const challenger = this.db.getPlayer(challengerId);
    const accepter   = this.db.getPlayer(sender);

    if (bet > 0) {
      if ((challenger.cash||0) < bet) { await sock.sendMessage(invite.chatJid, { text: `❌ Challenger no longer has the bet amount!` }); return; }
      if ((accepter.cash||0) < bet)   { await sock.sendMessage(invite.chatJid, { text: `❌ You don't have enough cash!` }); return; }
    }

    const gameId = `ttt_pvp_${Date.now()}`;
    const game = {
      id: gameId, solo: false,
      players: [challengerId, sender],
      names:   [this.db.getDisplayName(challengerId), this.db.getDisplayName(sender)],
      board:   Array(9).fill(null),
      turn:    0, bet,
      chatJid: invite.chatJid,
      status:  'active',
      moveTimeout: null,
    };
    activeGames[gameId] = game;
    if (!global._tttActive) global._tttActive = {};
    global._tttActive[challengerId] = gameId;
    global._tttActive[sender]       = gameId;

    await sock.sendMessage(invite.chatJid, {
      text: [
        `⭕ *TIC TAC TOE — GAME START!*`,
        ``,
        `❌ ${game.names[0]}  vs  ⭕ ${game.names[1]}`,
        bet > 0 ? `💰 Bet: $${bet.toLocaleString()} each` : `🆓 Friendly`,
        ``,
        renderBoard(game.board),
        ``,
        `📌 *${game.names[0]}'s turn!* (❌)`,
        `*.ttt [1-9]* to place your mark`,
        `⚠️ 3 mins per move or auto-forfeit`,
      ].join('\n'),
    });

    this._startMoveTimeout(gameId, challengerId, sock);
  }

  async declineInvite(sender, chatJid, sock, message) {
    const invite = pendingTTT[sender];
    if (!invite) { await sock.sendMessage(chatJid, { text: `❌ No pending TTT challenge.` }, { quoted: message }); return; }
    delete pendingTTT[sender];
    await sock.sendMessage(invite.chatJid, { text: `🚫 *TTT Declined*\n${this.db.getDisplayName(sender)} declined the match.` });
  }

  // ── Play a move ───────────────────────────────────────────────
  async playMove(pos, sender, chatJid, sock, message) {
    const gameId = global._tttActive?.[sender];
    if (!gameId || !activeGames[gameId]) {
      await sock.sendMessage(chatJid, { text: `❌ Not in an active TTT game.\nChallenge: *.ttt @player* or solo: *.ttt easy/med/hard/pro*` }, { quoted: message }); return;
    }

    const game = activeGames[gameId];
    if (game.status !== 'active') { await sock.sendMessage(chatJid, { text: `❌ Game already ended.` }, { quoted: message }); return; }

    const cell = pos - 1;
    if (game.board[cell] !== null) {
      await sock.sendMessage(chatJid, { text: `❌ Cell ${pos} is taken! Pick another.` }, { quoted: message }); return;
    }

    // ── Solo game ────────────────────────────────────────────────
    if (game.solo) {
      if (game.turn !== 'player') {
        await sock.sendMessage(chatJid, { text: `⏳ Not your turn yet!` }, { quoted: message }); return;
      }

      clearTimeout(game.moveTimeout);

      // Player move
      game.board[cell] = game.playerMark;
      const winP = checkWinner(game.board);
      const drawP = !winP && game.board.every(c => c !== null);

      if (winP || drawP) {
        await this._endSoloGame(game, winP === game.playerMark ? 'win' : 'draw', sock);
        return;
      }

      game.turn = 'ai';

      // AI move
      const aiCell = aiMove(game.board, game.aiMark, SOLO_MODES[game.difficulty].aiLevel);
      if (aiCell !== null && aiCell !== undefined && aiCell !== -1) {
        game.board[aiCell] = game.aiMark;
      }

      const winAI  = checkWinner(game.board);
      const drawAI = !winAI && game.board.every(c => c !== null);

      if (winAI || drawAI) {
        await sock.sendMessage(game.chatJid, { text: renderBoard(game.board) });
        await this._endSoloGame(game, winAI === game.aiMark ? 'loss' : 'draw', sock);
        return;
      }

      game.turn = 'player';

      await sock.sendMessage(game.chatJid, {
        text: [
          renderBoard(game.board),
          ``,
          `🤖 AI played. Your turn (❌)!`,
          `*.ttt [1-9]* to continue`,
        ].join('\n')
      });

      this._startMoveTimeout(gameId, sender, sock);
      return;
    }

    // ── PvP game ─────────────────────────────────────────────────
    const currentPlayerId = game.players[game.turn];
    if (sender !== currentPlayerId) {
      await sock.sendMessage(chatJid, { text: `⏳ Not your turn! Wait for ${game.names[game.turn]}.` }, { quoted: message }); return;
    }

    clearTimeout(game.moveTimeout);
    game.board[cell] = game.turn === 0 ? 'X' : 'O';

    const winner = checkWinner(game.board);
    const isDraw = !winner && game.board.every(c => c !== null);
    const lines  = [renderBoard(game.board), ``];

    if (winner || isDraw) {
      game.status = 'finished';
      game.players.forEach(pid => { if (global._tttActive) delete global._tttActive[pid]; });
      delete activeGames[gameId];

      if (isDraw) {
        lines.push(`🤝 *IT'S A DRAW!* Bets refunded.`);
        recordTTTResult(this.db, game.players[0], 'draw', 'pvp');
        recordTTTResult(this.db, game.players[1], 'draw', 'pvp');
      } else {
        const wIdx = winner === 'X' ? 0 : 1;
        const lIdx = 1 - wIdx;
        const wId  = game.players[wIdx];
        const lId  = game.players[lIdx];

        lines.push(`🏆 *${game.names[wIdx]} WINS!*`);

        const wPlayer = this.db.getPlayer(wId);
        const lPlayer = this.db.getPlayer(lId);
        if (game.bet > 0) {
          wPlayer.cash = (wPlayer.cash||0) + game.bet;
          lPlayer.cash = Math.max(0, (lPlayer.cash||0) - game.bet);
          lines.push(`💰 +$${game.bet.toLocaleString()} for ${game.names[wIdx]}`);
        }
        wPlayer.experience = (wPlayer.experience||0) + 15;
        lPlayer.experience = (lPlayer.experience||0) + 5;
        this.db.updatePlayer(wId, wPlayer);
        this.db.updatePlayer(lId, lPlayer);
        recordTTTResult(this.db, wId, 'win', 'pvp');
        recordTTTResult(this.db, lId, 'loss', 'pvp');
        lines.push(`⭐ +15 XP for winner`);
      }
    } else {
      game.turn = 1 - game.turn;
      const nextId   = game.players[game.turn];
      const nextName = game.names[game.turn];
      const mark     = game.turn === 0 ? '❌' : '⭕';
      lines.push(`📌 *${nextName}'s turn!* (${mark})  *.ttt [1-9]*`);
      this._startMoveTimeout(gameId, nextId, sock);
    }

    await sock.sendMessage(game.chatJid || chatJid, { text: lines.join('\n') });
  }

  // ── End solo game ─────────────────────────────────────────────
  async _endSoloGame(game, outcome, sock) {
    game.status = 'finished';
    if (global._tttActive) delete global._tttActive[game.player];
    delete activeGames[game.id];

    const mode = game.mode;
    const p    = this.db.getPlayer(game.player);

    // ── Update 4-round series tracker ────────────────────────────
    if (!global._tttSeries) global._tttSeries = {};
    if (!global._tttSeries[game.player]) global._tttSeries[game.player] = { round: game.round || 1, playerWins: 0, aiWins: 0, draws: 0 };
    const series = global._tttSeries[game.player];
    if (outcome === 'win')  series.playerWins++;
    if (outcome === 'loss') series.aiWins++;
    if (outcome === 'draw') series.draws++;

    const isLastRound = (game.round || 1) >= 4;

    // Build series result line for after round 4
    let seriesResult = '';
    if (isLastRound) {
      if (series.playerWins > series.aiWins) seriesResult = `🏆 *YOU WON THE SERIES ${series.playerWins}–${series.aiWins}!* Dominant!`;
      else if (series.aiWins > series.playerWins) seriesResult = `🤖 *AI WON THE SERIES ${series.aiWins}–${series.playerWins}.* Better luck next time!`;
      else seriesResult = `🤝 *SERIES DRAW ${series.playerWins}–${series.aiWins}!* Even matchup!`;
      // Reset series for next play
      global._tttSeries[game.player] = { round: 0, playerWins: 0, aiWins: 0, draws: 0 };
    }
    const roundTag = `Round ${game.round || 1}/4 | 🏆${series.playerWins} 🤖${series.aiWins} 🤝${series.draws}`;

    if (outcome === 'win') {
      const prize = Math.floor(Math.random() * (mode.maxPrize - mode.minPrize + 1)) + mode.minPrize;
      p.cash = (p.cash||0) + prize;
      p.experience = (p.experience||0) + mode.xp;
      this.db.updatePlayer(game.player, p);
      recordTTTResult(this.db, game.player, 'win', 'solo');

      const lines = [
        `⭕ *TTT — YOU WIN! (${roundTag})*`,
        ``,
        renderBoard(game.board),
        ``,
        `🏆 Beat the AI on *${mode.label}* difficulty!`,
        `💰 Prize: +$${prize.toLocaleString()}`,
        mode.xp > 0 ? `⭐ +${mode.xp} XP` : ``,
        `💵 Cash: $${p.cash.toLocaleString()}`,
      ].filter(l => l !== '');
      if (isLastRound) lines.push(``, seriesResult);
      else lines.push(``, `▶️ Next round starts with *.ttt ${game.difficulty}*`);
      await sock.sendMessage(game.chatJid, { text: lines.join('\n') });

    } else if (outcome === 'loss') {
      recordTTTResult(this.db, game.player, 'loss', 'solo');
      const lines = [
        `⭕ *TTT — AI WINS! (${roundTag})*`,
        ``,
        renderBoard(game.board),
        ``,
        `😔 The AI beat you on *${mode.label}*!`,
        `💸 Entry fee lost: $${game.cost.toLocaleString()}`,
      ];
      if (isLastRound) lines.push(``, seriesResult);
      else lines.push(``, `▶️ Next round: *.ttt ${game.difficulty}*`);
      await sock.sendMessage(game.chatJid, { text: lines.join('\n') });

    } else {
      // Draw — refund entry
      p.cash = (p.cash||0) + game.cost;
      this.db.updatePlayer(game.player, p);
      recordTTTResult(this.db, game.player, 'draw', 'solo');
      const lines = [
        `⭕ *TTT — DRAW! (${roundTag})*`,
        ``,
        renderBoard(game.board),
        ``,
        `🤝 Neither player won. Entry refunded.`,
        `💵 Cash: $${p.cash.toLocaleString()}`,
      ];
      if (isLastRound) lines.push(``, seriesResult);
      else lines.push(``, `▶️ Next round: *.ttt ${game.difficulty}*`);
      await sock.sendMessage(game.chatJid, { text: lines.join('\n') });
    }
  }

  // ── 3-minute move timeout → auto forfeit ─────────────────────
  _startMoveTimeout(gameId, idlePlayerId, sock) {
    const game = activeGames[gameId];
    if (!game) return;

    clearTimeout(game.moveTimeout);
    game.moveTimeout = setTimeout(async () => {
      const g = activeGames[gameId];
      if (!g || g.status !== 'active') return;

      g.status = 'finished';
      const idleName = this.db.getDisplayName(idlePlayerId);

      if (g.solo) {
        // Solo: timeout = forfeit, lose entry
        if (global._tttActive) delete global._tttActive[g.player];
        delete activeGames[gameId];
        recordTTTResult(this.db, g.player, 'loss', 'solo');
        await sock.sendMessage(g.chatJid, {
          text: `⏰ *AUTO-FORFEIT!*\n*${idleName}* didn't move in 3 minutes.\n💸 Entry fee forfeited.`
        }).catch(() => {});

      } else {
        // PvP: timeout = opponent wins
        const idleIdx  = g.players.indexOf(idlePlayerId);
        const winnerId = g.players[1 - idleIdx];
        const winName  = this.db.getDisplayName(winnerId);

        g.players.forEach(pid => { if (global._tttActive) delete global._tttActive[pid]; });
        delete activeGames[gameId];

        // Pay out bet to winner
        if (g.bet > 0) {
          const wPlayer = this.db.getPlayer(winnerId);
          const lPlayer = this.db.getPlayer(idlePlayerId);
          wPlayer.cash = (wPlayer.cash||0) + g.bet;
          lPlayer.cash = Math.max(0, (lPlayer.cash||0) - g.bet);
          this.db.updatePlayer(winnerId, wPlayer);
          this.db.updatePlayer(idlePlayerId, lPlayer);
        }

        recordTTTResult(this.db, winnerId, 'win', 'pvp');
        recordTTTResult(this.db, idlePlayerId, 'loss', 'pvp');

        await sock.sendMessage(g.chatJid, {
          text: [
            `⏰ *AUTO-FORFEIT!*`,
            ``,
            `*${idleName}* didn't move in 3 minutes!`,
            `🏆 *${winName}* wins by forfeit!`,
            g.bet > 0 ? `💰 +$${g.bet.toLocaleString()} awarded to ${winName}` : ``,
          ].filter(Boolean).join('\n')
        }).catch(() => {});
      }
    }, TURN_TIMEOUT);
  }

  // ── Leaderboard ───────────────────────────────────────────────
  async showLeaderboard(chatJid, sock, message) {
    const players = Object.values(this.db.data.players)
      .filter(p => p.tttStats && p.tttStats.wins > 0)
      .map(p => ({ ...p.tttStats, id: p.id, name: this.db.getDisplayName(p.id) }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, 10);

    if (players.length === 0) {
      await sock.sendMessage(chatJid, { text: `⭕ No TTT records yet. Play: *.ttt easy*` }, { quoted: message }); return;
    }

    const rank  = ['🥇','🥈','🥉'];
    const lines = [`⭕ *TTT LEADERBOARD*`, `━━━━━━━━━━━━━━━━━━━━`, ``];

    players.forEach((p, i) => {
      const wr = p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
      lines.push(`${rank[i] || `${i+1}.`} *${p.name}*`);
      lines.push(`   W:${p.wins} L:${p.losses} D:${p.draws || 0} | WR: ${wr}%`);
      lines.push(`   PvP Wins: ${p.pvpWins || 0}  Solo Wins: ${p.soloWins || 0}`);
    });

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }
}

module.exports = { TicTacToeCommand, activeGames, pendingTTT };
