const { normalizeJid } = require('../utils/validators');
const { resolveMention } = require('../utils/resolveMention');
// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — CREW  v2.0
//  Wars, levels, leaderboard, rename, slang, kick, asst leader
// ═══════════════════════════════════════════════════════════════

// ── Pending war declarations & crew invites ─────────────────────────────
// warPending[enemyLeaderId] = { attackerCrewKey, defenderCrewKey, chatJid, expiresAt }
const warPending    = {};
// crewInvitePending[inviteeId] = { crewKey, inviterId, crewName, chatJid, expiresAt }
const crewInvitePending = {};

const MAX_MEMBERS = 10;
const CREW_CREATE_COST = 50_000;
const RENAME_COST = 100_000;
const SLANG_CHANGE_COST = 25_000;
const WAR_WIN_XP = 50;

function crewLevel(xp) { return Math.floor((xp || 0) / 200) + 1; }

function calcPlayerPower(player) {
  if (!player) return 1;
  const level = Math.min(50, Math.floor((player.experience || 0) / 100)); // Max level 50
  let gunPower = 0;
  try {
    const { gunScore, GUNS } = require('./guns');
    gunPower = (player.weapons || []).reduce((s, w) => s + gunScore(GUNS[w.id] || { damage:0, fireRate:0 }), 0);
  } catch(e) {}
  return Math.max(1, level + Math.floor(gunPower / 5));
}

function calcCrewPower(crew, db) {
  return crew.members.reduce((s, m) => s + calcPlayerPower(db.data.players[m.id]), 0);
}

class CrewCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    sender = normalizeJid(sender); // normalize once at entry point
    const player = this.db.getPlayer(sender);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'list') return this._showMenu(sender, player, chatJid, sock, message);
    if (sub === 'create')   return this._create(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'join')     return this._join(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'info')     return this._info(player, chatJid, sock, message);
    if (sub === 'members')  return this._members(player, chatJid, sock, message);
    if (sub === 'leave')    return this._leave(sender, player, chatJid, sock, message);
    if (sub === 'invite')   return this._invite(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'kick')     return this._kick(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'promote')  return this._promote(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'war')      return this._war(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'rename')   return this._rename(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'slang')    return this._slang(args.slice(1), sender, player, chatJid, sock, message);
    if (sub === 'lb' || sub === 'leaderboard') return this._leaderboard(chatJid, sock, message);

    await sock.sendMessage(chatJid, { text: `❌ Unknown subcommand. Type .crew` }, { quoted: message });
  }

  async _showMenu(sender, player, chatJid, sock, message) {
    const crew = player.crew ? this.db.data.crews[player.crew.toLowerCase()] : null;
    const role = !crew ? 'N/A' : normalizeJid(crew.leader) === normalizeJid(sender) ? '👑 Leader' : normalizeJid(crew.assistantLeader) === normalizeJid(sender) ? '⭐ Asst. Leader' : 'Member';
    const text = [
      `╔═══════════════════════╗`,
      `║  👥 CREW SYSTEM`,
      `╚═══════════════════════╝`,
      ``,
      `Crew: ${player.crew || 'None'}  Role: ${role}`,
      crew ? `Level: Lv.${crewLevel(crew.crewXp)} | Wars: ${crew.warWins||0}W/${crew.warLosses||0}L` : '',
      ``,
      `.crew create [name] — Start ($${CREW_CREATE_COST.toLocaleString()})`,
      `.crew join [name]   — Join crew`,
      `.crew info          — Crew details`,
      `.crew members       — Member list`,
      `.crew invite @p     — Invite (leader/asst)`,
      `.crew kick @p       — Remove (leader)`,
      `.crew promote @p    — Set asst. leader`,
      `.crew war [crew]    — Declare war!`,
      `.crew rename [new]  — Rename ($${RENAME_COST.toLocaleString()})`,
      `.crew slang [text]  — Set slang ($${SLANG_CHANGE_COST.toLocaleString()})`,
      `.crew lb            — Crew leaderboard`,
      `.crew leave         — Leave crew`,
    ].filter(l => l !== '').join('\n');
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _create(args, sender, player, chatJid, sock, message) {
    if (player.crew) { await sock.sendMessage(chatJid, { text: `❌ Already in a crew! Leave with .crew leave` }, { quoted: message }); return; }
    const crewName = args.join(' ').trim();
    if (!crewName) { await sock.sendMessage(chatJid, { text: `❌ Usage: .crew create [name]` }, { quoted: message }); return; }
    if ((player.cash || 0) < CREW_CREATE_COST) { await sock.sendMessage(chatJid, { text: `❌ Need $${CREW_CREATE_COST.toLocaleString()} cash.` }, { quoted: message }); return; }
    if (this.db.data.crews[crewName.toLowerCase()]) { await sock.sendMessage(chatJid, { text: `❌ Name taken!` }, { quoted: message }); return; }

    this.db.data.crews[crewName.toLowerCase()] = {
      name: crewName, leader: sender, leaderName: player.nickname || player.name,
      assistantLeader: null,
      members: [{ id: sender, name: player.nickname || player.name, joinedAt: new Date() }],
      founded: new Date(), crewXp: 0, level: 1, treasury: 0, reputation: 0,
      warWins: 0, warLosses: 0, slang: null,
    };
    player.cash -= CREW_CREATE_COST;
    player.crew = crewName;
    player.experience = (player.experience || 0) + 30;
    this.db.updatePlayer(sender, player);
    this.db.saveData();

    await sock.sendMessage(chatJid, {
      text: `✅ *CREW CREATED!*\n\n👥 ${crewName}\n👑 Leader: ${player.nickname || player.name}\n💰 Members: 1/${MAX_MEMBERS}\n💸 Cost: $${CREW_CREATE_COST.toLocaleString()}\n⭐ +30 XP\n\n.crew invite @player`
    }, { quoted: message });
  }

  async _join(args, sender, player, chatJid, sock, message) {
    if (player.crew) { await sock.sendMessage(chatJid, { text: `❌ Already in a crew! .crew leave first.` }, { quoted: message }); return; }
    const crewName = args.join(' ').toLowerCase();
    if (!crewName) { await sock.sendMessage(chatJid, { text: `❌ Usage: .crew join [crew name]` }, { quoted: message }); return; }
    const crew = this.db.data.crews[crewName];
    if (!crew) { await sock.sendMessage(chatJid, { text: `❌ Crew not found!` }, { quoted: message }); return; }
    if (crew.members.length >= MAX_MEMBERS) { await sock.sendMessage(chatJid, { text: `❌ Crew full! (${MAX_MEMBERS}/${MAX_MEMBERS})` }, { quoted: message }); return; }

    crew.members.push({ id: sender, name: player.nickname || player.name, joinedAt: new Date() });
    player.crew = crew.name;
    this.db.updatePlayer(sender, player);
    this.db.saveData();

    await sock.sendMessage(chatJid, { text: `✅ Joined *${crew.name}*!\n👥 Members: ${crew.members.length}/${MAX_MEMBERS}` }, { quoted: message });
    try { await sock.sendMessage(crew.leader, { text: `👥 *${player.nickname||player.name}* joined *${crew.name}*! Members: ${crew.members.length}/${MAX_MEMBERS}` }); } catch(e) {}
  }

  async _info(player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew) { await sock.sendMessage(chatJid, { text: `❌ Crew data error.` }, { quoted: message }); return; }
    const lvl = crewLevel(crew.crewXp || 0);
    const lines = [
      `╔═════════════════╗`,
      `║  👥 CREW INFO`,
      `╚═════════════════╝`,
      ``,
      `👥 *${crew.name}*`,
      crew.slang ? `💬 "${crew.slang}"` : null,
      `📊 Level: ${lvl} (${crew.crewXp||0} XP)`,
      `💼 Members: ${crew.members.length}/${MAX_MEMBERS}`,
      `⚔️ Wars: ${crew.warWins||0}W / ${crew.warLosses||0}L`,
      `👑 Leader: ${crew.leaderName || crew.leader.split('@')[0]}`,
      crew.assistantLeader ? `⭐ Asst: ${this.db.getDisplayName(crew.assistantLeader)}` : null,
      `📅 Founded: ${new Date(crew.founded).toLocaleDateString()}`,
      ``,
      `.crew members — full list`,
    ].filter(l => l !== null).join('\n');
    await sock.sendMessage(chatJid, { text: lines }, { quoted: message });
  }

  async _members(player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew) { await sock.sendMessage(chatJid, { text: `❌ Crew data error.` }, { quoted: message }); return; }

    let text = `👥 *${crew.name}* — Members (${crew.members.length}/${MAX_MEMBERS})\n\n`;
    crew.members.forEach((m, i) => {
      const md = this.db.data.players[m.id];
      const tag = m.id === crew.leader ? ' 👑' : m.id === crew.assistantLeader ? ' ⭐' : '';
      const lvl = md ? Math.floor((md.experience||0)/100) : '?';
      const nw  = md ? `$${((md.cash||0)+(md.bank||0)).toLocaleString()}` : '?';
      text += `${i+1}. *${m.name}*${tag} | Lv.${lvl} | Net: ${nw}\n`;
    });
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async _leave(sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (crew) {
      if (normalizeJid(crew.leader) === normalizeJid(sender) && crew.members.length > 1) {
        await sock.sendMessage(chatJid, { text: `❌ Promote someone to leader first!\n.crew promote @member` }, { quoted: message }); return;
      }
      crew.members = crew.members.filter(m => normalizeJid(m.id) !== normalizeJid(sender));
      if (crew.members.length === 0) delete this.db.data.crews[player.crew.toLowerCase()];
      this.db.saveData();
    }
    player.crew = null;
    this.db.updatePlayer(sender, player);
    await sock.sendMessage(chatJid, { text: `✅ You left the crew.` }, { quoted: message });
  }

  async _invite(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew || (normalizeJid(crew.leader) !== normalizeJid(sender) && normalizeJid(crew.assistantLeader) !== normalizeJid(sender))) {
      await sock.sendMessage(chatJid, { text: `❌ Only leader or assistant can invite!` }, { quoted: message }); return;
    }
    if (crew.members.length >= MAX_MEMBERS) {
      await sock.sendMessage(chatJid, { text: `❌ Crew full! (${MAX_MEMBERS} max)` }, { quoted: message }); return;
    }
    const _rawTargetId = resolveMention(message, args, 0);
    if (!_rawTargetId) { await sock.sendMessage(chatJid, { text: `❌ Tag a player: .crew invite @player` }, { quoted: message }); return; }
    const targetId = normalizeJid(_rawTargetId);
    if (normalizeJid(targetId) === normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ You are already in the crew!` }, { quoted: message }); return; }

    const targetPlayer = this.db.data.players[targetId] || this.db.data.players[_rawTargetId];
    if (targetPlayer?.crew) {
      await sock.sendMessage(chatJid, { text: `❌ That player is already in a crew!` }, { quoted: message }); return;
    }

    crewInvitePending[normalizeJid(targetId)] = {
      crewKey: player.crew.toLowerCase(), crewName: crew.name,
      inviterId: sender, inviterName: player.nickname || player.name || 'Leader',
      chatJid, expiresAt: Date.now() + 120_000,
    };
    const phone = targetId.split('@')[0];
    await sock.sendMessage(chatJid, {
      text: `📨 *CREW INVITE*\n\n@${phone} — *${player.nickname||player.name}* is inviting you to join *${crew.name}*!\n\nReply *1* to accept  |  *2* to decline\n⏳ 2 minutes`,
      mentions: [targetId],
    }, { quoted: message });
    try { await sock.sendMessage(targetId, { text: `📨 *CREW INVITE!*\n\n*${player.nickname||player.name}* invites you to join *${crew.name}*!\nReply *1* (accept) or *2* (decline) in the group.\n⏳ 2 minutes` }); } catch(e) {}
    setTimeout(() => { if (crewInvitePending[normalizeJid(targetId)]) delete crewInvitePending[normalizeJid(targetId)]; }, 120_000);
  }
  async _kick(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew || normalizeJid(crew.leader) !== normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ Only the leader can kick!` }, { quoted: message }); return; }
    const _rawKickId = resolveMention(message, args, 0);
    const targetId = _rawKickId ? normalizeJid(_rawKickId) : null;
    if (!targetId) { await sock.sendMessage(chatJid, { text: `❌ Tag a player: .crew kick @player` }, { quoted: message }); return; }
    if (normalizeJid(targetId) === normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ Can't kick yourself!` }, { quoted: message }); return; }
    const idx = crew.members.findIndex(m => normalizeJid(m.id) === targetId);
    if (idx === -1) { await sock.sendMessage(chatJid, { text: `❌ Not in your crew.` }, { quoted: message }); return; }
    const kickedName = crew.members[idx].name;
    crew.members.splice(idx, 1);
    if (crew.assistantLeader === targetId) crew.assistantLeader = null;
    const kp = this.db.data.players[targetId];
    if (kp) { kp.crew = null; this.db.updatePlayer(targetId, kp); }
    this.db.saveData();
    await sock.sendMessage(chatJid, { text: `👢 *${kickedName}* kicked from the crew.` }, { quoted: message });
  }

  async _promote(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew || normalizeJid(crew.leader) !== normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ Only the leader can promote!` }, { quoted: message }); return; }
    const _rawPromoteId = resolveMention(message, args, 0);
    const targetId = _rawPromoteId ? normalizeJid(_rawPromoteId) : null;
    if (!targetId) { await sock.sendMessage(chatJid, { text: `❌ Tag a member: .crew promote @player` }, { quoted: message }); return; }
    if (!crew.members.some(m => normalizeJid(m.id) === targetId)) { await sock.sendMessage(chatJid, { text: `❌ Not in your crew.` }, { quoted: message }); return; }
    crew.assistantLeader = targetId;
    this.db.saveData();
    await sock.sendMessage(chatJid, { text: `⭐ *${this.db.getDisplayName(targetId)}* is now Assistant Leader!` }, { quoted: message });
  }

  async _war(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const myCrew = this.db.data.crews[player.crew.toLowerCase()];
    if (!myCrew || normalizeJid(myCrew.leader) !== normalizeJid(sender)) {
      await sock.sendMessage(chatJid, { text: `❌ Only the crew leader can declare war!` }, { quoted: message }); return;
    }
    const targetKey = args.join(' ').trim().toLowerCase();
    if (!targetKey) { await sock.sendMessage(chatJid, { text: `⚔️ Usage: .crew war [crew name]` }, { quoted: message }); return; }
    const enemyCrew = this.db.data.crews[targetKey];
    if (!enemyCrew) { await sock.sendMessage(chatJid, { text: `❌ Crew "${args.join(' ').trim()}" not found!` }, { quoted: message }); return; }
    if (targetKey === player.crew.toLowerCase()) { await sock.sendMessage(chatJid, { text: `❌ Can't war yourself!` }, { quoted: message }); return; }

    const enemyLeaderId = normalizeJid(enemyCrew.leader);
    warPending[enemyLeaderId] = {
      attackerCrewKey: player.crew.toLowerCase(), defenderCrewKey: targetKey,
      attackerName: myCrew.name, defenderName: enemyCrew.name,
      chatJid, expiresAt: Date.now() + 120_000,
    };
    const phone = enemyLeaderId.split('@')[0];
    await sock.sendMessage(chatJid, {
      text: `⚔️ *WAR DECLARATION!*\n\n*${myCrew.name}* has declared war on *${enemyCrew.name}*!\n\n@${phone} — Reply *1* to accept war or *2* to decline\n⏳ 2 minutes to respond`,
      mentions: [enemyLeaderId],
    }, { quoted: message });
    try { await sock.sendMessage(enemyLeaderId, { text: `⚔️ *WAR DECLARATION!*\n*${myCrew.name}* declared war on *${enemyCrew.name}*!\nReply *1* (accept) or *2* (decline) in the group.\n⏳ 2 minutes` }); } catch(e) {}
    setTimeout(() => { if (warPending[enemyLeaderId]) delete warPending[enemyLeaderId]; }, 120_000);
  }

  async resolveWarReply(reply, sender, chatJid, sock) {
    const normSender = normalizeJid(sender);
    let _warKey = null;
    let pending = null;
    if (warPending[normSender]) { _warKey = normSender; pending = warPending[normSender]; }
    else if (warPending[sender]) { _warKey = sender; pending = warPending[sender]; }
    else {
      for (const [k, v] of Object.entries(warPending)) {
        if (normalizeJid(k) === normSender) { _warKey = k; pending = v; break; }
      }
    }
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) { delete warPending[_warKey]; await sock.sendMessage(pending.chatJid, { text: `⏰ War request from *${pending.attackerName}* expired.` }); return true; }
    delete warPending[sender];

    if (reply === '2') {
      await sock.sendMessage(pending.chatJid, { text: `🚫 *${pending.defenderName}* declined the war declaration. Cowards! 🐔` });
      return true;
    }

    const myCrew    = this.db.data.crews[pending.attackerCrewKey];
    const enemyCrew = this.db.data.crews[pending.defenderCrewKey];
    if (!myCrew || !enemyCrew) { await sock.sendMessage(pending.chatJid, { text: `❌ A crew no longer exists!` }); return true; }

    const myPow    = calcCrewPower(myCrew, this.db)    + myCrew.members.length * 10    + crewLevel(myCrew.crewXp||0)    * 5;
    const enemyPow = calcCrewPower(enemyCrew, this.db) + enemyCrew.members.length * 10 + crewLevel(enemyCrew.crewXp||0) * 5;
    const myRoll    = myPow    * (0.80 + Math.random() * 0.40);
    const enemyRoll = enemyPow * (0.80 + Math.random() * 0.40);
    const attackerWon = myRoll >= enemyRoll;
    const winner = attackerWon ? myCrew : enemyCrew;
    const loser  = attackerWon ? enemyCrew : myCrew;
    winner.crewXp   = (winner.crewXp   || 0) + WAR_WIN_XP;
    winner.warWins  = (winner.warWins  || 0) + 1;
    loser.warLosses = (loser.warLosses || 0) + 1;
    for (const m of winner.members) {
      const mp = this.db.data.players[m.id];
      if (mp) { mp.experience = (mp.experience||0) + 20; this.db.updatePlayer(m.id, mp); }
    }
    this.db.saveData();

    await sock.sendMessage(pending.chatJid, {
      text: [`⚔️ *CREW WAR RESULT!*`, ``,
        `🏴 ${myCrew.name}  ―  ${Math.round(myRoll)} pts`,
        `🏴 ${enemyCrew.name}  ―  ${Math.round(enemyRoll)} pts`, ``,
        `🏆 *WINNER: ${winner.name}*`, ``,
        attackerWon ? `🎉 ${myCrew.name} — +50 Crew XP, members +20 XP!` : `💀 ${myCrew.name} — Better luck next time.`,
        `⚡ Power = levels + guns + members + crew level`,
      ].join('\n')
    });
    return true;
  }

  async resolveInviteReply(reply, sender, chatJid, sock) {
    sender = normalizeJid(sender); // normalize at entry
    // crewInvitePending keys are always normalized — direct lookup suffices
    const pending = crewInvitePending[sender];
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) { delete crewInvitePending[sender]; return true; }
    delete crewInvitePending[sender];
    const crew = this.db.data.crews[pending.crewKey];

    if (reply === '2' || !crew) {
      await sock.sendMessage(pending.chatJid, { text: `❌ *${this.db.getDisplayName(sender)}* declined the invite to *${pending.crewName}*.` });
      return true;
    }

    if (crew.members.length >= MAX_MEMBERS) {
      await sock.sendMessage(pending.chatJid, { text: `❌ *${pending.crewName}* is now full!` }); return true;
    }
    const joiner = this.db.getPlayer(sender);
    if (joiner.crew) {
      await sock.sendMessage(pending.chatJid, { text: `❌ *${this.db.getDisplayName(sender)}* is already in a crew!` }); return true;
    }
    joiner.crew = pending.crewName;
    crew.members.push({ id: sender, name: joiner.nickname || joiner.name || sender.split('@')[0], joinedAt: new Date().toISOString() });
    this.db.updatePlayer(sender, joiner);
    this.db.saveData();
    await sock.sendMessage(pending.chatJid, {
      text: `✅ *${joiner.nickname||joiner.name||'Player'}* joined *${pending.crewName}*! 🎉\n👥 Members: ${crew.members.length}/${MAX_MEMBERS}`
    });
    return true;
  }
  async _rename(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew || normalizeJid(crew.leader) !== normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ Only the leader can rename!` }, { quoted: message }); return; }
    const newName = args.join(' ').trim();
    if (!newName) { await sock.sendMessage(chatJid, { text: `❌ Usage: .crew rename [new name]` }, { quoted: message }); return; }
    if (this.db.data.crews[newName.toLowerCase()]) { await sock.sendMessage(chatJid, { text: `❌ Name already taken!` }, { quoted: message }); return; }
    if ((player.cash||0) < RENAME_COST) { await sock.sendMessage(chatJid, { text: `❌ Need $${RENAME_COST.toLocaleString()} cash.` }, { quoted: message }); return; }

    const oldKey = player.crew.toLowerCase();
    crew.members.forEach(m => {
      const mp = this.db.data.players[m.id];
      if (mp && mp.crew?.toLowerCase() === oldKey) { mp.crew = newName; this.db.updatePlayer(m.id, mp); }
    });
    crew.name = newName;
    this.db.data.crews[newName.toLowerCase()] = crew;
    delete this.db.data.crews[oldKey];
    player.cash -= RENAME_COST;
    player.crew = newName;
    this.db.updatePlayer(sender, player);
    this.db.saveData();

    await sock.sendMessage(chatJid, { text: `✅ Crew renamed to *${newName}*\n💰 Cost: $${RENAME_COST.toLocaleString()}` }, { quoted: message });
  }

  async _slang(args, sender, player, chatJid, sock, message) {
    if (!player.crew) { await sock.sendMessage(chatJid, { text: `❌ Not in a crew!` }, { quoted: message }); return; }
    const crew = this.db.data.crews[player.crew.toLowerCase()];
    if (!crew || normalizeJid(crew.leader) !== normalizeJid(sender)) { await sock.sendMessage(chatJid, { text: `❌ Only the leader can set slang!` }, { quoted: message }); return; }
    const slang = args.join(' ').trim();
    if (!slang) {
      await sock.sendMessage(chatJid, { text: `Current slang: ${crew.slang ? `"${crew.slang}"` : 'None'}\n\n.crew slang [text] — set it ($${SLANG_CHANGE_COST.toLocaleString()})` }, { quoted: message }); return;
    }
    if (slang.length > 30) { await sock.sendMessage(chatJid, { text: `❌ Max 30 characters.` }, { quoted: message }); return; }
    if ((player.cash||0) < SLANG_CHANGE_COST) { await sock.sendMessage(chatJid, { text: `❌ Need $${SLANG_CHANGE_COST.toLocaleString()} cash.` }, { quoted: message }); return; }
    player.cash -= SLANG_CHANGE_COST;
    crew.slang = slang;
    this.db.updatePlayer(sender, player);
    this.db.saveData();
    await sock.sendMessage(chatJid, { text: `💬 Crew slang: "${slang}" ✅` }, { quoted: message });
  }

  async _leaderboard(chatJid, sock, message) {
    const crews = Object.values(this.db.data.crews);
    if (!crews.length) { await sock.sendMessage(chatJid, { text: `No crews yet!` }, { quoted: message }); return; }

    const nw = (crew) => crew.members.reduce((s, m) => {
      const p = this.db.data.players[m.id];
      return s + (p ? (p.cash||0) + (p.bank||0) : 0);
    }, 0);

    crews.sort((a, b) => (b.warWins||0) - (a.warWins||0) || nw(b) - nw(a));
    const medals = ['🥇','🥈','🥉'];
    let text = `╔══════════════════════╗\n║ 🏆 CREW LEADERBOARD\n╚══════════════════════╝\n\n`;
    crews.slice(0, 10).forEach((c, i) => {
      text += `${medals[i] || `${i+1}.`} *${c.name}*\n`;
      if (c.slang) text += `   💬 "${c.slang}"\n`;
      text += `   Lv.${crewLevel(c.crewXp||0)} | ⚔️ ${c.warWins||0}W/${c.warLosses||0}L\n`;
      text += `   👥 ${c.members.length} | 💰 $${nw(c).toLocaleString()}\n\n`;
    });
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

module.exports = CrewCommand;
