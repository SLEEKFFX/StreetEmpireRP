// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — GYM TOURNAMENT  v1.0
//  Boxing tournament with buy-ins from 100k to 10m.
//  Winners earn medals displayed on the boxing leaderboard.
// ═══════════════════════════════════════════════════════════════

const { normJid } = require('../utils/resolveMention');
const { getGymStats, ensureGym } = require('./gym');

const activeTournaments = {}; // chatJid → tournament

const BUY_IN_OPTIONS = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
const MEDAL_TIERS = {
  100000:      { name: 'Bronze Gloves',   emoji: '🥉' },
  500000:      { name: 'Silver Gloves',   emoji: '🥈' },
  1000000:     { name: 'Gold Gloves',     emoji: '🥇' },
  5000000:     { name: 'Diamond Gloves',  emoji: '💎' },
  10000000:    { name: 'Legend Gloves',   emoji: '👑' },
};

function simFight(p1Id, p2Id, db) {
  const p1 = ensureGym(db.getPlayer(p1Id));
  const p2 = ensureGym(db.getPlayer(p2Id));
  const s1 = getGymStats(p1);
  const s2 = getGymStats(p2);

  // Base score = sum of all gym points + random factor
  const p1Total = Object.values(p1.gym).reduce((s, a) => s + a.pts, 0);
  const p2Total = Object.values(p2.gym).reduce((s, a) => s + a.pts, 0);

  // Weighted random — more pts = higher win chance, but upsets possible
  const p1Score = p1Total + Math.random() * 40;
  const p2Score = p2Total + Math.random() * 40;

  return p1Score >= p2Score ? { winner: p1Id, loser: p2Id } : { winner: p2Id, loser: p1Id };
}

class GymTournament {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, msgRef) {
    sender = normJid(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'menu') return this.showMenu(chatJid, sock, msgRef);
    if (sub === 'create' || sub === 'c') return this.create(args.slice(1), sender, chatJid, sock, msgRef);
    if (sub === 'join'   || sub === 'j') return this.join(sender, chatJid, sock, msgRef);
    if (sub === 'start'  || sub === 's') return this.start(sender, chatJid, sock, msgRef);
    if (sub === 'status' || sub === 'info') return this.status(chatJid, sock, msgRef);
    if (sub === 'lb' || sub === 'leaderboard') return this.leaderboard(chatJid, sock, msgRef);
    if (sub === 'cancel' || sub === 'end') return this.cancel(sender, chatJid, sock, msgRef);

    return this.showMenu(chatJid, sock, msgRef);
  }

  async showMenu(chatJid, sock, msgRef) {
    const t = activeTournaments[chatJid];
    const options = BUY_IN_OPTIONS.map(b => {
      const m = MEDAL_TIERS[b];
      return `  ${m.emoji} $${(b/1000).toFixed(0)}k — ${m.name}`;
    }).join('\n');

    const text = [
      `🏆 *BOXING TOURNAMENT*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `Bracket-style boxing.`,
      `Winners wins medal`,
      ``,
      `*BUY-IN TIERS:*`,
      options,
      ``,
      `*COMMANDS:*`,
      `*.gym tournament create [buyIn]* — Create`,
      `*.gym tournament join*           — Join`,
      `*.gym tournament start*          — Start (host only)`,
      `*.gym tournament info*           — Bracket`,
      `*.gym tournament lb*             — Medal leaderboard`,
      `*.gym tournament cancel*         — Cancel (host)`,
      ``,
      t
        ? `⚡ ACTIVE: ${t.players.length} players | $${t.buyIn.toLocaleString()} buy-in`
        : `No active tournament in this chat.`,
    ].join('\n');

    await sock.sendMessage(chatJid, { text }, msgRef);
  }

  async create(args, sender, chatJid, sock, msgRef) {
    if (activeTournaments[chatJid]) {
      await sock.sendMessage(chatJid, { text: `A tournament is already recruiting!\nJoin with *.gym tournament join*` }, msgRef); return;
    }

    const buyIn = parseInt(args[0]);
    if (!buyIn || buyIn < 100_000) {
      await sock.sendMessage(chatJid, {
        text: `❌ Specify a valid buy-in.\nOptions: ${BUY_IN_OPTIONS.map(b => `$${(b/1000).toFixed(0)}k`).join(', ')}`
      }, msgRef); return;
    }

    const host = this.db.getPlayer(sender);
    if ((host.cash||0) < buyIn) {
      await sock.sendMessage(chatJid, { text: `Not enough cash! Need $${buyIn.toLocaleString()}` }, msgRef); return;
    }

    host.cash -= buyIn;
    this.db.updatePlayer(sender, host);

    activeTournaments[chatJid] = {
      hostId: sender, buyIn, players: [sender],
      chatJid, status: 'recruiting',
      createdAt: Date.now(), maxPlayers: 8,
    };

    const medal = MEDAL_TIERS[buyIn] || MEDAL_TIERS[100_000];

    await sock.sendMessage(chatJid, {
      text: [
        `🏆 *TOURNAMENT CREATED!*`,
        ``,
        `🎙️ Host: ${this.db.getDisplayName(sender)}`,
        `💰 Buy-in: $${buyIn.toLocaleString()}`,
        `${medal.emoji} Medal: ${medal.name}`,
        `👥 Players: 1/8 | Max: 8`,
        ``,
        `Join with *.gym tournament join*`,
        `Start anytime with *.gym tournament start*`,
      ].join('\n')
    }, msgRef);

    // Auto-start after 30 min if enough players
    setTimeout(async () => {
      const cur = activeTournaments[chatJid];
      if (!cur || cur.createdAt !== activeTournaments[chatJid]?.createdAt) return;
      if (cur.status !== 'recruiting') return;
      if (cur.players.length < 2) {
        const h = this.db.getPlayer(sender);
        h.cash = (h.cash||0) + buyIn;
        this.db.updatePlayer(sender, h);
        delete activeTournaments[chatJid];
        await sock.sendMessage(chatJid, { text: `Tournament cancelled — not enough players. Buy-in refunded.` }).catch(() => {});
        return;
      }
      await this._runTournament(chatJid, sock);
    }, 30 * 60 * 1000);
  }

  async join(sender, chatJid, sock, msgRef) {
    const t = activeTournaments[chatJid];
    if (!t || t.status !== 'recruiting') {
      await sock.sendMessage(chatJid, { text: `No active tournament recruiting.\nStart one: *.gym tournament create [buyIn]*` }, msgRef); return;
    }
    if (t.players.includes(sender)) {
      await sock.sendMessage(chatJid, { text: `Already in the tournament!` }, msgRef); return;
    }
    if (t.players.length >= t.maxPlayers) {
      await sock.sendMessage(chatJid, { text: `Tournament is full (${t.maxPlayers} players)!` }, msgRef); return;
    }

    const p = this.db.getPlayer(sender);
    if ((p.cash||0) < t.buyIn) {
      await sock.sendMessage(chatJid, { text: `Need $${t.buyIn.toLocaleString()} to join!` }, msgRef); return;
    }

    p.cash -= t.buyIn;
    this.db.updatePlayer(sender, p);
    t.players.push(sender);

    await sock.sendMessage(chatJid, {
      text: [
        `✅ *${this.db.getDisplayName(sender)} joined!*`,
        `👥 Players: ${t.players.length}/${t.maxPlayers}`,
        `💸 Buy-in paid: $${t.buyIn.toLocaleString()}`,
        t.players.length >= t.maxPlayers ? `⚡ Full! Starting soon...` : ``,
      ].filter(Boolean).join('\n')
    }, msgRef);

    if (t.players.length >= t.maxPlayers) await this._runTournament(chatJid, sock);
  }

  async start(sender, chatJid, sock, msgRef) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: `No active tournament.` }, msgRef); return; }
    if (t.hostId !== sender) { await sock.sendMessage(chatJid, { text: `Only the host can start.` }, msgRef); return; }
    if (t.players.length < 2) { await sock.sendMessage(chatJid, { text: `Need at least 2 players!` }, msgRef); return; }
    await this._runTournament(chatJid, sock);
  }

  async status(chatJid, sock, msgRef) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: `No active tournament.` }, msgRef); return; }

    const lines = [
      `🏆 *TOURNAMENT STATUS*`,
      `💰 Buy-in: $${t.buyIn.toLocaleString()} | Pot: $${(t.buyIn * t.players.length).toLocaleString()}`,
      `👥 Players (${t.players.length}/${t.maxPlayers}):`,
    ];
    t.players.forEach((pid, i) => {
      const p = ensureGym(this.db.getPlayer(pid));
      const totalPts = Object.values(p.gym).reduce((s, a) => s + a.pts, 0);
      lines.push(`  ${i+1}. ${this.db.getDisplayName(pid)} — ${totalPts} gym pts`);
    });
    await sock.sendMessage(chatJid, { text: lines.join('\n') }, msgRef);
  }

  async cancel(sender, chatJid, sock, msgRef) {
    const t = activeTournaments[chatJid];
    if (!t) { await sock.sendMessage(chatJid, { text: `No tournament to cancel.` }, msgRef); return; }
    if (t.hostId !== sender) { await sock.sendMessage(chatJid, { text: `Only the host can cancel.` }, msgRef); return; }
    for (const pid of t.players) {
      const p = this.db.getPlayer(pid);
      p.cash = (p.cash||0) + t.buyIn;
      this.db.updatePlayer(pid, p);
    }
    delete activeTournaments[chatJid];
    await sock.sendMessage(chatJid, { text: `🚫 Tournament cancelled. All buy-ins refunded.` }, msgRef);
  }

  async leaderboard(chatJid, sock, msgRef) {
    const players = Object.values(this.db.data.players)
      .filter(p => p.gymMedals && p.gymMedals.length > 0)
      .map(p => ({
        id: p.id, name: this.db.getDisplayName(p.id),
        medals: p.gymMedals || [],
      }))
      .sort((a, b) => {
        // Sort by highest medal tier won
        const tierVal = { 10000000: 5, 5000000: 4, 1000000: 3, 500000: 2, 100000: 1 };
        const aTop = Math.max(0, ...a.medals.map(m => tierVal[m.buyIn] || 0));
        const bTop = Math.max(0, ...b.medals.map(m => tierVal[m.buyIn] || 0));
        return bTop - aTop || b.medals.length - a.medals.length;
      })
      .slice(0, 10);

    if (players.length === 0) {
      await sock.sendMessage(chatJid, { text: `🏆 No gym tournament medals awarded yet!` }, msgRef); return;
    }

    const rank = ['🥇','🥈','🥉'];
    const lines = [`🏆 *BOXING LEADERBOARD*`, `━━━━━━━━━━━━━━━━━━━━━━━━━━━`, ``];

    players.forEach((p, i) => {
      const medalStr = p.medals.slice(-5).map(m => {
        const tier = MEDAL_TIERS[m.buyIn] || MEDAL_TIERS[100000];
        return `${tier.emoji}${m.place === 1 ? '' : m.place === 2 ? '²' : '³'}`;
      }).join(' ');
      lines.push(`${rank[i] || `${i+1}.`} *${p.name}*`);
      lines.push(`   Medals: ${medalStr || 'none'}`);
    });

    lines.push(``);
    lines.push(`💡 Enter a gym tournament: *.gym tournament create*`);
    await sock.sendMessage(chatJid, { text: lines.join('\n') }, msgRef);
  }

  // ── Run tournament bracket ────────────────────────────────────
  async _runTournament(chatJid, sock) {
    const t = activeTournaments[chatJid];
    if (!t || t.status !== 'recruiting') return;
    t.status = 'running';

    const players  = [...t.players].sort(() => Math.random() - 0.5);
    const totalPot = t.buyIn * players.length;
    const medal    = MEDAL_TIERS[t.buyIn] || MEDAL_TIERS[100_000];

    await sock.sendMessage(chatJid, {
      text: [
        `🥊 *BOXING TOURNAMENT STARTING!*`,
        `💰 Total Pot: $${totalPot.toLocaleString()}`,
        `${medal.emoji} Medal: ${medal.name}`,
        `👥 ${players.length} fighters!`,
        ``,
        `🔔 Bracket fights commencing...`,
      ].join('\n')
    });

    let current = [...players];
    let roundNum = 1;
    const eliminated = {};  // pid → place

    while (current.length > 1) {
      const next    = [];
      const roundLines = [`\n🔔 *ROUND ${roundNum}*`];

      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 >= current.length) {
          next.push(current[i]);
          roundLines.push(`⚡ ${this.db.getDisplayName(current[i])} — AUTO-ADVANCE (bye)`);
          continue;
        }
        const { winner, loser } = simFight(current[i], current[i+1], this.db);
        next.push(winner);
        const p1 = ensureGym(this.db.getPlayer(current[i]));
        const p2 = ensureGym(this.db.getPlayer(current[i+1]));
        const pts1 = Object.values(p1.gym).reduce((s,a) => s+a.pts, 0);
        const pts2 = Object.values(p2.gym).reduce((s,a) => s+a.pts, 0);
        roundLines.push(
          `🥊 ${this.db.getDisplayName(current[i])} (${pts1}pts) vs ${this.db.getDisplayName(current[i+1])} (${pts2}pts)`
        );
        roundLines.push(
          `   ✅ ${this.db.getDisplayName(winner)} advances |  ${this.db.getDisplayName(loser)} eliminated`
        );
        eliminated[loser] = current.length <= 4 ? 3 : 0; // track top 3
      }

      await sock.sendMessage(chatJid, { text: roundLines.join('\n') });
      current = next;
      roundNum++;
    }

    const champId = current[0];
    // Find runner-up (last eliminated from final round)
    const finalists = players.slice(-2);
    const runnerId  = finalists.find(p => p !== champId) || null;

    // ── Payouts ──────────────────────────────────────────────────
    const prize1 = Math.floor(totalPot * 0.65);
    const prize2 = Math.floor(totalPot * 0.25);
    const prize3 = Math.floor(totalPot * 0.10);

    const champ   = this.db.getPlayer(champId);
    champ.cash    = (champ.cash||0) + prize1;
    champ.experience = (champ.experience||0) + 150;
    if (!champ.gymMedals) champ.gymMedals = [];
    champ.gymMedals.push({ place: 1, buyIn: t.buyIn, date: Date.now() });
    this.db.updatePlayer(champId, champ);

    const resultLines = [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `${medal.emoji} *BOXING TOURNAMENT CHAMPION*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `👑 *${this.db.getDisplayName(champId)}* takes the crown!`,
      `💰 Prize: +$${prize1.toLocaleString()} `,
      `${medal.emoji} Medal earned: *${medal.name}*`,
      `⭐ +150 XP`,
    ];

    if (runnerId) {
      const runner = this.db.getPlayer(runnerId);
      runner.cash  = (runner.cash||0) + prize2;
      runner.experience = (runner.experience||0) + 75;
      if (!runner.gymMedals) runner.gymMedals = [];
      runner.gymMedals.push({ place: 2, buyIn: t.buyIn, date: Date.now() });
      this.db.updatePlayer(runnerId, runner);
      resultLines.push(`🥈 Runner-up: *${this.db.getDisplayName(runnerId)}* +$${prize2.toLocaleString()} + 🥈 medal`);
    }

    // 3rd place: last player eliminated in semi-finals (approximate)
    const thirdId = Object.keys(eliminated).find(pid => eliminated[pid] === 3 && pid !== runnerId);
    if (thirdId) {
      const third = this.db.getPlayer(thirdId);
      third.cash  = (third.cash||0) + prize3;
      third.experience = (third.experience||0) + 50;
      if (!third.gymMedals) third.gymMedals = [];
      third.gymMedals.push({ place: 3, buyIn: t.buyIn, date: Date.now() });
      this.db.updatePlayer(thirdId, third);
      resultLines.push(`🥉 3rd place: *${this.db.getDisplayName(thirdId)}* +$${prize3.toLocaleString()} + 🥉 medal`);
    }

    resultLines.push(``, `View medals: *.gym tournament lb*`);

    delete activeTournaments[chatJid];
    await sock.sendMessage(chatJid, { text: resultLines.join('\n') });
  }
}

module.exports = { GymTournament };
