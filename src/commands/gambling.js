const { resolveMention, normJid } = require('../utils/resolveMention');
const BankingCommand = require('./banking');

// Active multiplayer blackjack sessions
const bjSessions = {};

// Active 1v1 coin flip challenges: targetId → { fromId, fromName, bet, expiresAt }
const coinChallenges = {};

class GamblingCommand {
  constructor(db) {
    this.db = db;
    this.MIN_BET = 10;
    this.MAX_BET = 1_000_000; // Raised to $1M
  }

  // ── Card helpers ──────────────────────────────────────────────────────────
  newDeck() {
    const suits  = ['♠','♥','♦','♣'];
    const values = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const deck   = [];
    for (const s of suits) for (const v of values) deck.push({ s, v });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  cardVal(card) {
    if (['J','Q','K'].includes(card.v)) return 10;
    if (card.v === 'A') return 11;
    return parseInt(card.v);
  }

  handValue(hand) {
    let total = 0, aces = 0;
    for (const c of hand) { total += this.cardVal(c); if (c.v === 'A') aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  showHand(hand, hideSecond = false) {
    if (hideSecond && hand.length >= 2) return `[${hand[0].v}${hand[0].s}] [?]`;
    return hand.map(c => `[${c.v}${c.s}]`).join(' ');
  }

  // ── MAIN EXECUTE ─────────────────────────────────────────────────────────
  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize once at entry point
    const game = (args[0] || '').toLowerCase();

    if (!game) { await sock.sendMessage(chatJid, { text: this.getMenu() }, { quoted: message }); return; }

    if (game === 'blackjack' || game === 'bj') {
      return this.handleBlackjack(args.slice(1), sender, chatJid, sock, message);
    }

    // Coin flip 1v1 challenge
    if (game === 'coin') {
      return this.handleCoin(args.slice(1), sender, chatJid, sock, message);
    }

    const validGames = ['roulette','slots','bet'];
    if (!validGames.includes(game)) {
      await sock.sendMessage(chatJid, { text: `Unknown game.\nGames: roulette, slots, coin, bet, blackjack` }, { quoted: message }); return;
    }

    const bet = parseInt(args[1]);
    if (!args[1]) { await sock.sendMessage(chatJid, { text: `Enter a bet\nExample: *.gamble ${game} 500*` }, { quoted: message }); return; }
    if (isNaN(bet) || bet < this.MIN_BET || bet > this.MAX_BET) {
      await sock.sendMessage(chatJid, { text: `❌ Bet: $${this.MIN_BET}–$${this.MAX_BET.toLocaleString()}` }, { quoted: message }); return;
    }

    const player = this.db.getPlayer(sender);
    if (player.cash < bet) {
      await sock.sendMessage(chatJid, { text: `❌ Not enough cash!\n💵 $${player.cash.toLocaleString()}` }, { quoted: message }); return;
    }

    let won = false, winnings = 0, result = '';

    if (game === 'roulette') {
      won = Math.random() < 0.45;
      if (won) { winnings = Math.floor(bet * 3 * 0.97); result = `🎡 *ROULETTE WIN!*\n+$${winnings.toLocaleString()}`; }
      else       result = `🎡 *ROULETTE LOSS*\n-$${bet.toLocaleString()}`;
    } else if (game === 'slots') {
      const sym = ['🍒','🍋','🔔','⭐','💎','7️⃣'];
      const [s1,s2,s3] = [sym[~~(Math.random()*6)],sym[~~(Math.random()*6)],sym[~~(Math.random()*6)]];
      won = s1===s2 && s2===s3;
      if (won) { winnings = Math.floor(bet*6*0.97); result = `🎰 *JACKPOT!*\n[${s1}][${s2}][${s3}]\n+$${winnings.toLocaleString()}`; }
      else       result = `🎰 *NO MATCH*\n[${s1}][${s2}][${s3}]\n-$${bet.toLocaleString()}`;
    } else if (game === 'bet') {
      won = Math.random() < 0.5;
      if (won) { winnings = Math.floor(bet*2*0.97); result = `🎲 *HIGH ROLL WIN!*\n+$${winnings.toLocaleString()}`; }
      else       result = `🎲 *LOW ROLL LOSS*\n-$${bet.toLocaleString()}`;
    }

    player.cash -= bet;
    if (won) {
      player.bank = (player.bank||0) + winnings;
      player.stats.moneyEarned = (player.stats.moneyEarned||0) + winnings;
      BankingCommand.recordExternal(this.db, sender, { type:'Betting Win', amount:winnings, sender:'SE Casino', receiver:this.db.getDisplayName(sender), note:`${game} win => bank`, balance:player.bank });
    } else {
      player.stats.moneyLost = (player.stats.moneyLost||0) + bet;
    }
    player.experience = (player.experience||0) + (won ? 2 : 0);
    this.db.updatePlayer(sender, player);
    this.db.updatePlayerRole(sender);

    await sock.sendMessage(chatJid, {
      text: `${result}\n\n💵 Cash: $${player.cash.toLocaleString()}${won ? `\n🏦 Bank: $${player.bank.toLocaleString()}` : ''}`
    }, { quoted: message });
  }

  // ── COIN FLIP (choose heads/tails + optional 1v1) ─────────────────────────
  async handleCoin(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // ensure normalized
    const sub = (args[0] || '').toLowerCase();

    // .gamble coin @player [bet] — 1v1 challenge
    const _gcTarget = resolveMention(message, args, 0);
    if (sub.startsWith('@') || sub.match(/^\d{7,}/) || _gcTarget) {
      const targetId = normJid(_gcTarget);
      if (!targetId) { await sock.sendMessage(chatJid, { text: '❌ Usage: .gamble coin @player [bet]' }, { quoted: message }); return; }
      const bet = parseInt(args[1]);
      if (isNaN(bet) || bet < this.MIN_BET) { await sock.sendMessage(chatJid, { text: `❌ Provide a valid bet! Min: $${this.MIN_BET}` }, { quoted: message }); return; }
      const player = this.db.getPlayer(sender);
      if (player.cash < bet) { await sock.sendMessage(chatJid, { text: `❌ Not enough cash!` }, { quoted: message }); return; }
      if (targetId === sender) { await sock.sendMessage(chatJid, { text: '❌ Cannot challenge yourself!' }, { quoted: message }); return; }

      coinChallenges[targetId] = { fromId: sender, fromName: player.name || sender.split('@')[0], bet, expiresAt: Date.now() + 120000 };
      await sock.sendMessage(chatJid, { text: `🪙 *COIN FLIP CHALLENGE SENT!*\n\n${player.name} challenged you to a coin flip!\n💰 Bet: $${bet.toLocaleString()} each\n\n⏳ They must reply:\n*heads* or *tails* to pick a side\n\nExpires in 2 minutes` }, { quoted: message });
      try {
        await sock.sendMessage(targetId, { text: `🪙 *COIN FLIP CHALLENGE!*\n\n👤 *${player.name}* challenges you!\n💰 Bet: $${bet.toLocaleString()} each\n\nPick your side:\n*heads* — to pick Heads\n*tails* — to pick Tails\n\n⏳ Expires in 2 minutes` });
      } catch(e) {}
      return;
    }

    // .gamble coin [heads|tails] [bet] — solo with choice
    const choice = sub; // 'heads' or 'tails'
    const bet = parseInt(args[1]);

    if (!choice || (choice !== 'heads' && choice !== 'tails') || isNaN(bet)) {
      await sock.sendMessage(chatJid, { text: [
        `🪙 *COIN FLIP*`,
        ``,
        `SOLO (pick your side):`,
        `.gamble coin heads [bet]`,
        `.gamble coin tails [bet]`,
        ``,
        `1v1 CHALLENGE:`,
        `.gamble coin @player [bet]`,
        `(opponent picks heads or tails to accept)`,
        ``,
        `💰 50/50 — Win: 2x bet => Bank`,
        `Min: $${this.MIN_BET}`,
      ].join('\n') }, { quoted: message });
      return;
    }

    if (bet < this.MIN_BET || bet > this.MAX_BET) { await sock.sendMessage(chatJid, { text: `❌ Bet: $${this.MIN_BET}–$${this.MAX_BET.toLocaleString()}` }, { quoted: message }); return; }
    const player = this.db.getPlayer(sender);
    if (player.cash < bet) { await sock.sendMessage(chatJid, { text: `❌ Not enough cash!` }, { quoted: message }); return; }

    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = flip === choice;
    const winnings = won ? Math.floor(bet * 2 * 0.97) : 0;

    player.cash -= bet;
    if (won) {
      player.bank = (player.bank || 0) + winnings;
      player.stats.moneyEarned = (player.stats.moneyEarned || 0) + winnings;
      BankingCommand.recordExternal(this.db, sender, { type:'Betting Win', amount:winnings, sender:'SE Casino', receiver:player.name, note:'Coin flip win => bank', balance:player.bank });
    } else {
      player.stats.moneyLost = (player.stats.moneyLost || 0) + bet;
    }
    player.experience = (player.experience || 0) + (won ? 2 : 0);
    this.db.updatePlayer(sender, player);
    this.db.updatePlayerRole(sender);

    const coinAnim = flip === 'heads' ? '🟡' : '⚪';
    await sock.sendMessage(chatJid, {
      text: won
        ? `🪙 *COIN FLIP — ${flip.toUpperCase()}!*\n\n${coinAnim} Result: *${flip.toUpperCase()}*\nYour pick: *${choice.toUpperCase()}* ✅\n\n🏆 *YOU WIN!*\n💵 +$${winnings.toLocaleString()} => Bank\n\n💵 Cash: $${player.cash.toLocaleString()}\n🏦 Bank: $${player.bank.toLocaleString()}`
        : `🪙 *COIN FLIP — ${flip.toUpperCase()}!*\n\n${coinAnim} Result: *${flip.toUpperCase()}*\nYour pick: *${choice.toUpperCase()}* ❌\n\n💸 *YOU LOSE!*\n-$${bet.toLocaleString()}\n\n💵 Cash: $${player.cash.toLocaleString()}`
    }, { quoted: message });
  }

  // Called from commandHandler when a pending coin challenge opponent replies
  static handleCoinReply(db, reply, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize at entry
    const challenge = coinChallenges[sender];
    if (!challenge || Date.now() > challenge.expiresAt) return false;
    const r = reply.toLowerCase().trim();
    if (r !== 'heads' && r !== 'tails') return false;

    delete coinChallenges[sender];

    const accepter = db.getPlayer(sender);
    const challenger = db.getPlayer(challenge.fromId);

    if (accepter.cash < challenge.bet) {
      sock.sendMessage(chatJid, { text: `Not enough cash! Need $${challenge.bet.toLocaleString()}` }, { quoted: message });
      return true;
    }
    if (challenger.cash < challenge.bet) {
      sock.sendMessage(chatJid, { text: `Challenger no longer has enough cash!` }, { quoted: message });
      return true;
    }

    // Challenger always gets the opposite side
    const accepterPick = r; // heads or tails
    const challengerPick = r === 'heads' ? 'tails' : 'heads';
    const flip = Math.random() < 0.5 ? 'heads' : 'tails';
    const accepterWins = flip === accepterPick;

    const winner = accepterWins ? accepter : challenger;
    const loser  = accepterWins ? challenger : accepter;
    const winnerId = accepterWins ? sender : challenge.fromId;
    const loserId  = accepterWins ? challenge.fromId : sender;
    const winnings = Math.floor(challenge.bet * 2 * 0.97);

    winner.cash -= challenge.bet;
    loser.cash  -= challenge.bet;
    winner.bank = (winner.bank || 0) + winnings;
    winner.stats.moneyEarned = (winner.stats.moneyEarned || 0) + winnings;
    loser.stats.moneyLost = (loser.stats.moneyLost || 0) + challenge.bet;

    db.updatePlayer(winnerId, winner);
    db.updatePlayer(loserId, loser);
    db.updatePlayerRole(winnerId);

    const coinAnim = flip === 'heads' ? '🟡' : '⚪';
    const text = `🪙 *1v1 COIN FLIP RESULT!*\n\n${coinAnim} Flip: *${flip.toUpperCase()}*\n\n${challenge.fromName}: ${challengerPick.toUpperCase()}\n${accepter.name}: ${accepterPick.toUpperCase()}\n\n🏆 *Winner: ${winner.name}!*\n💰 +$${winnings.toLocaleString()} => Bank\n\n💵 Cash — ${challenge.fromName}: $${challenger.cash.toLocaleString()} | ${accepter.name}: $${accepter.cash.toLocaleString()}`;

    sock.sendMessage(chatJid, { text }, { quoted: message });
    try { sock.sendMessage(challenge.fromId, { text }); } catch(e) {}
    return true;
  }

  // ── BLACKJACK ─────────────────────────────────────────────────────────────
  async handleBlackjack(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'join') {
      const session = Object.values(bjSessions).find(s => s.chatJid === chatJid && s.status === 'waiting');
      if (!session) { await sock.sendMessage(chatJid, { text: '❌ No open blackjack table.\nStart one: *.gamble blackjack [bet]*' }, { quoted: message }); return; }
      if (session.players.some(p => p.id === sender)) { await sock.sendMessage(chatJid, { text: '❌ Already at the table!' }, { quoted: message }); return; }
      if (session.players.length >= 4) { await sock.sendMessage(chatJid, { text: '❌ Table full (4 players max).' }, { quoted: message }); return; }
      const player = this.db.getPlayer(sender);
      if (player.cash < session.bet) { await sock.sendMessage(chatJid, { text: `❌ Need $${session.bet.toLocaleString()} cash!` }, { quoted: message }); return; }
      session.players.push({ id: sender, name: this.db.getDisplayName(sender), hand: [], status: 'active' });
      await sock.sendMessage(chatJid, { text: `✅ ${this.db.getDisplayName(sender)} joined!\n👥 Players: ${session.players.length}/4\n\nHost starts: *.gamble bj start*` }, { quoted: message }); return;
    }

    if (sub === 'start') {
      const session = Object.values(bjSessions).find(s => s.chatJid === chatJid && s.status === 'waiting' && s.host === sender);
      if (!session) { await sock.sendMessage(chatJid, { text: '❌ No table to start.' }, { quoted: message }); return; }
      await this.dealBlackjack(session, sock); return;
    }

    if (sub === 'hit') {
      const session = Object.values(bjSessions).find(s => s.chatJid === chatJid && s.status === 'playing' && s.currentTurn === sender);
      if (!session) { await sock.sendMessage(chatJid, { text: '❌ Not your turn!' }, { quoted: message }); return; }
      await this.bjHit(session, sender, sock, message); return;
    }

    if (sub === 'stand') {
      const session = Object.values(bjSessions).find(s => s.chatJid === chatJid && s.status === 'playing' && s.currentTurn === sender);
      if (!session) { await sock.sendMessage(chatJid, { text: '❌ Not your turn!' }, { quoted: message }); return; }
      await this.bjStand(session, sender, sock, message); return;
    }

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet < this.MIN_BET) {
      await sock.sendMessage(chatJid, { text: [`🃏 *BLACKJACK*`, ``, `SOLO:  *.gamble blackjack [bet]*`, ``, `MULTIPLAYER:`, `1. Host: *.gamble blackjack [bet]*`, `2. Others: *.gamble bj join*`, `3. Host starts: *.gamble bj start*`, ``, `IN GAME:`, `*.gamble bj hit*   — draw a card`, `*.gamble bj stand* — hold hand`, ``, `Goal: beat dealer, don't go over 21`, `Blackjack (A+10) pays 1.5x`].join('\n') }, { quoted: message }); return;
    }

    if (bet > this.MAX_BET) { await sock.sendMessage(chatJid, { text: `❌ Max bet: $${this.MAX_BET.toLocaleString()}` }, { quoted: message }); return; }
    const player = this.db.getPlayer(sender);
    if (player.cash < bet) { await sock.sendMessage(chatJid, { text: `❌ Not enough cash!` }, { quoted: message }); return; }

    const isGroup = chatJid.endsWith('@g.us');
    if (isGroup) {
      for (const [id, s] of Object.entries(bjSessions)) { if (s.host === sender && s.status === 'waiting') delete bjSessions[id]; }
      const sessionId = `bj_${Date.now()}`;
      bjSessions[sessionId] = { id: sessionId, chatJid, host: sender, bet, status: 'waiting', players: [{ id: sender, name: this.db.getDisplayName(sender), hand: [], status: 'active' }], deck: [], dealer: [], currentTurn: null };
      await sock.sendMessage(chatJid, { text: [`🃏 *BLACKJACK TABLE OPEN!*`, ``, `Host: ${this.db.getDisplayName(sender)}`, `💰 Bet: $${bet.toLocaleString()} each`, `👥 Players: 1/4`, ``, `Join: *.gamble bj join*`, `Start (host only): *.gamble bj start*`, ``, `Table open for 3 minutes`].join('\n') }, { quoted: message });
      setTimeout(() => { const s = bjSessions[sessionId]; if (s && s.status === 'waiting') { delete bjSessions[sessionId]; sock.sendMessage(chatJid, { text: '⏰ Blackjack table expired.' }).catch(()=>{}); } }, 180000);
      return;
    }

    const sessionId = `bj_${Date.now()}`;
    bjSessions[sessionId] = { id: sessionId, chatJid, host: sender, bet, status: 'waiting', players: [{ id: sender, name: this.db.getDisplayName(sender), hand: [], status: 'active' }], deck: [], dealer: [], currentTurn: null };
    await this.dealBlackjack(bjSessions[sessionId], sock, message);
  }

  async dealBlackjack(session, sock, message) {
    session.status = 'playing';
    session.deck = this.newDeck();
    session.dealer = [session.deck.pop(), session.deck.pop()];
    session.players.forEach(p => {
      p.hand = [session.deck.pop(), session.deck.pop()];
      p.status = 'active';
      const dbPlayer = this.db.getPlayer(p.id);
      dbPlayer.cash -= session.bet;
      this.db.updatePlayer(p.id, dbPlayer);
    });

    let text = `🃏 *BLACKJACK — DEALT!*\n\n`;
    text += `🏦 Dealer: ${this.showHand(session.dealer, true)}\n\n`;
    session.players.forEach(p => { text += `👤 ${p.name}: ${this.showHand(p.hand)} = ${this.handValue(p.hand)}\n`; });
    session.currentTurn = session.players[0].id;
    text += `\n📣 ${session.players[0].name}'s turn!\n*.gamble bj hit* or *.gamble bj stand*`;
    await sock.sendMessage(session.chatJid, { text });

    for (const p of session.players) { if (this.handValue(p.hand) === 21) p.status = 'blackjack'; }
    if (session.players.every(p => p.status !== 'active')) await this.resolveBlackjack(session, sock);
  }

  async bjHit(session, sender, sock, message) {
    const pData = session.players.find(p => p.id === sender);
    pData.hand.push(session.deck.pop());
    const val = this.handValue(pData.hand);
    if (val > 21) {
      pData.status = 'bust';
      await sock.sendMessage(session.chatJid, { text: `💥 *${pData.name} BUST!*\n${this.showHand(pData.hand)} = ${val}` });
      await this.advanceTurn(session, sock);
    } else if (val === 21) {
      pData.status = 'stand';
      await sock.sendMessage(session.chatJid, { text: `🎯 *${pData.name} hits 21!*\n${this.showHand(pData.hand)}` });
      await this.advanceTurn(session, sock);
    } else {
      await sock.sendMessage(session.chatJid, { text: `🃏 ${pData.name}: ${this.showHand(pData.hand)} = ${val}\n\n*.gamble bj hit* or *.gamble bj stand*` });
    }
  }

  async bjStand(session, sender, sock, message) {
    const pData = session.players.find(p => p.id === sender);
    pData.status = 'stand';
    await sock.sendMessage(session.chatJid, { text: `✋ ${pData.name} stands with ${this.handValue(pData.hand)}` });
    await this.advanceTurn(session, sock);
  }

  async advanceTurn(session, sock) {
    const next = session.players.find(p => p.status === 'active');
    if (next) {
      session.currentTurn = next.id;
      await sock.sendMessage(session.chatJid, { text: `📣 ${next.name}'s turn!\n${this.showHand(next.hand)} = ${this.handValue(next.hand)}\n\n*.gamble bj hit* or *.gamble bj stand*` });
    } else {
      await this.resolveBlackjack(session, sock);
    }
  }

  async resolveBlackjack(session, sock) {
    session.status = 'done';
    while (this.handValue(session.dealer) < 17) session.dealer.push(session.deck.pop());
    const dealerVal = this.handValue(session.dealer);
    const dealerBust = dealerVal > 21;

    let text = `🃏 *BLACKJACK RESULTS*\n\n`;
    text += `🏦 Dealer: ${this.showHand(session.dealer)} = ${dealerBust ? 'BUST' : dealerVal}\n\n`;

    for (const p of session.players) {
      const pVal = this.handValue(p.hand);
      let outcome = '';
      if (p.status === 'bust') {
        outcome = `💥 BUST — Lost $${session.bet.toLocaleString()}`;
      } else if (p.status === 'blackjack' && dealerVal !== 21) {
        const prize = Math.floor(session.bet * 2.5 * 0.97);
        outcome = `🃏 BLACKJACK! +$${prize.toLocaleString()} => Bank`;
        const dbp = this.db.getPlayer(p.id);
        dbp.bank = (dbp.bank||0) + prize;
        dbp.stats.moneyEarned = (dbp.stats.moneyEarned||0) + prize;
        BankingCommand.recordExternal(this.db, p.id, { type:'Betting Win', amount:prize, sender:'SE Casino', receiver:p.name, note:'Blackjack => bank', balance:dbp.bank });
        this.db.updatePlayer(p.id, dbp);
      } else if (dealerBust || pVal > dealerVal) {
        const prize = Math.floor(session.bet * 2 * 0.97);
        outcome = `✅ WIN! +$${prize.toLocaleString()} => Bank`;
        const dbp = this.db.getPlayer(p.id);
        dbp.bank = (dbp.bank||0) + prize;
        dbp.stats.moneyEarned = (dbp.stats.moneyEarned||0) + prize;
        BankingCommand.recordExternal(this.db, p.id, { type:'Betting Win', amount:prize, sender:'SE Casino', receiver:p.name, note:'Blackjack win => bank', balance:dbp.bank });
        this.db.updatePlayer(p.id, dbp);
      } else if (pVal === dealerVal) {
        const dbp = this.db.getPlayer(p.id); dbp.cash += session.bet; this.db.updatePlayer(p.id, dbp);
        outcome = `🤝 PUSH — Refunded $${session.bet.toLocaleString()}`;
      } else {
        outcome = `❌ LOSS — Lost $${session.bet.toLocaleString()}`;
      }
      text += `👤 ${p.name}: ${this.showHand(p.hand)} = ${pVal}\n   ${outcome}\n\n`;
    }
    await sock.sendMessage(session.chatJid, { text });
    delete bjSessions[session.id];
  }

  getMenu() {
    return [
      `🎰 *SE CASINO*`,
      `Min: $${this.MIN_BET}  Max: $${this.MAX_BET.toLocaleString()}  Tax: 3%`,
      ``,
      `.gamble roulette [amt]  — 45% win, 3x`,
      `.gamble slots [amt]     — Match 3, 6x`,
      `.gamble coin heads [amt] — Pick heads`,
      `.gamble coin tails [amt] — Pick tails`,
      `.gamble coin @player [amt] — 1v1 flip`,
      `.gamble bet [amt]       — 50/50, 2x`,
      `.gamble blackjack [amt] — Beat dealer`,
      ``,
      `3% house edge • Wins => Bank`,
    ].join('\n');
  }
}

module.exports = GamblingCommand;
module.exports.coinChallenges = coinChallenges;
module.exports.handleCoinReply = GamblingCommand.handleCoinReply;
