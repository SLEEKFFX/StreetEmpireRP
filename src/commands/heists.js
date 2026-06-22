const Database = require('../database');
const BankingCommand = require('./banking');

class HeistCommand {
  constructor(db) {
    this.db = db;
    this.activeHeists = {};
    // store chatJid per heist so results go back to the right group
    this.heistTypes = {
      'car robbery': {
        name: '🚗 Car Robbery',
        description: 'Steal high-tech luxury vehicles',
        minCrew: 1, maxCrew: 1,
        baseReward: 50000,
        difficulty: 'Medium',
        cooldown: 7200000, // 2hr nerf
        roles: ['Driver', 'Hacker', 'Lookout'],
        successRate: 0.75
      },
      'money heist': {
        name: '💵 Money Heist',
        description: 'Rob armored cash trucks',
        minCrew: 2, maxCrew: 5,
        baseReward: 300000,
        difficulty: 'Hard',
        cooldown: 7200000, // 2hr nerf
        roles: ['Driver', 'Gunner', 'Hacker', 'Lookout'],
        successRate: 0.50
      },
      'store robbery': {
        name: '🏪 Store Robbery',
        description: 'Rob convenience stores',
        minCrew: 1, maxCrew: 1,
        baseReward: 50000,
        difficulty: 'Easy',
        cooldown: 7200000, // 2hr nerf (was 30min)
        roles: ['Robber'],
        successRate: 0.75
      },
      'bank heist': {
        name: '🏦 Bank Heist',
        description: 'Rob the main bank vault',
        minCrew: 3, maxCrew: 5,
        baseReward: 1000000,
        difficulty: 'Risky',
        cooldown: 7200000,
        roles: ['Leader', 'Hacker', 'Driver', 'Gunner', 'Lookout'],
        successRate: 0.45
      },
      'jewelry heist': {
        name: '💎 Jewelry Heist',
        description: 'Steal precious gems, gold, artifacts, arts and stamps',
        minCrew: 2, maxCrew: 4,
        baseReward: 500000,
        difficulty: 'Hard',
        cooldown: 7200000,
        roles: ['Hacker', 'Driver', 'Gunner'],
        successRate: 0.60
      },
      'casino heist': {
        name: '🎰 Casino Heist',
        description: 'Infiltrate and rob the casino',
        minCrew: 2, maxCrew: 5,
        baseReward: 500000,
        difficulty: 'Extreme',
        cooldown: 7200000,
        roles: ['Leader', 'Hacker', 'Lookout', 'Gunner'],
        successRate: 0.55
      }
    };

    this.roleRewards = {
      'Leader': 0.40,
      'Driver': 0.30,
      'Gunner': 0.30,
      'Hacker': 0.25,
      'Lookout': 0.20,
      'Robber': 0.60,
    };
  }

  async execute(args, sender, chatJid, sock, message) {
    const player = this.db.getPlayer(sender);
    const subcommand = args[0];

    if (!subcommand || subcommand === 'list') {
      return await this.listHeists(sender, chatJid, sock, message);
    }

    if (subcommand === 'start') {
      const heistType = args.slice(1).join(' ');
      return await this.startHeist(sender, heistType, [], player, chatJid, sock, message);
    }

    // FIX: .heist join — no heist ID needed, join the latest active heist
    if (subcommand === 'join') {
      const role = args[1];
      return await this.joinHeist(sender, null, role, player, chatJid, sock, message);
    }

    if (subcommand === 'info') {
      const heistType = args.slice(1).join(' ');
      return await this.heistInfo(sender, heistType, chatJid, sock, message);
    }

    if (subcommand === 'cancel') {
      return await this.cancelHeist(sender, chatJid, sock, message);
    }

    if (subcommand === 'active') {
      return await this.viewActiveHeists(sender, chatJid, sock, message);
    }

    // FIX: typing .heist bank heist (or any heist name directly) now routes
    // through startHeist which enforces minCrew — solo bank heists are blocked.
    const heistTypeFromArgs = args.join(' ');
    if (this.heistTypes[heistTypeFromArgs]) {
      return await this.startHeist(sender, heistTypeFromArgs, [], player, chatJid, sock, message);
    }
    if (this.heistTypes[subcommand]) {
      return await this.startHeist(sender, subcommand, [], player, chatJid, sock, message);
    }

    await sock.sendMessage(chatJid, { text: '❌ Heist command not found. Use *.heist list*' }, { quoted: message });
  }

  async listHeists(sender, chatJid, sock, message) {
    let text = `╔═══════════════════╗\n║  🎯 HEISTS - STREET EMPIRE\n╚═══════════════════╝\n\n`;
    Object.entries(this.heistTypes).forEach(([key, h]) => {
      text += `${h.name}\n`;
      text += `   ${h.description}\n`;
      text += `   💰 $${h.baseReward.toLocaleString()} | 👥 ${h.minCrew}-${h.maxCrew} | ${h.difficulty}\n\n`;
    });
    text += `━━━━━━━━━━━━━━━━━━━\n`;
    text += `COMMANDS:\n`;
    text += `.heist start [type] — start a heist\n`;
    text += `.heist join [role]  — join active heist\n`;
    text += `.heist active       — see open heists\n`;
    text += `.heist info [type]  — heist details\n\n`;
    text += `EXAMPLE:\n.heist start bank heist\n.heist join Driver`;
    text += `ROLES:\n LEADER, HACKER, LOOKOUT, DRIVER, GUNNER, ROBBER.`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async heistInfo(sender, heistType, chatJid, sock, message) {
    const heist = this.heistTypes[heistType];
    if (!heist) {
      await sock.sendMessage(chatJid, { text: '❌ Heist type not found! Use *.heist list*' }, { quoted: message });
      return;
    }
    const fine = Math.floor(heist.baseReward * 0.01);
    let text = `╔═════════════════╗\n║  ${heist.name}\n╚═════════════════╝\n\n`;
    text += `*📝 ${heist.description}*\n\n`;
    text += `*💰 Base Reward:* $${heist.baseReward.toLocaleString()}\n`;
    text += `*👥 Crew:* ${heist.minCrew}-${heist.maxCrew}\n`;
    text += `*📊 Difficulty:* ${heist.difficulty}\n`;
    text += `*✅ Success Rate:* ${(heist.successRate * 100).toFixed(0)}%\n`;
    text += `*⏱️ Cooldown:* ${heist.cooldown / 60000} min\n`;
    text += `*🔖 Roles:* ${heist.roles.join(', ')}\n\n`;
    text += `*⚠️ Bust fine:* $${fine.toLocaleString()} | XP: -10`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async startHeist(sender, heistType, crewMembers, player, chatJid, sock, message) {
    heistType = heistType.trim().toLowerCase();
    const heist = this.heistTypes[heistType];
    if (!heist) {
      await sock.sendMessage(chatJid, { text: '❌ Heist not found! Use *.heist list*' }, { quoted: message });
      return;
    }

    if (this.db.checkCooldown(sender, `heist_${heistType}`)) {
      const remaining = this.db.getCooldownRemaining(sender, `heist_${heistType}`);
      await sock.sendMessage(chatJid, { text: `⏰ Heist on cooldown! Wait ${Math.ceil(remaining / 60)}m for ${heist.name}` }, { quoted: message });
      return;
    }

    // Check if this chat already has an active heist
    const existingForChat = Object.values(this.activeHeists).find(
      h => h.chatJid === chatJid && h.status === 'recruiting'
    );
    if (existingForChat) {
      await sock.sendMessage(chatJid, { text: '❌ There is already an active heist in this group! Use .heist join [role]' }, { quoted: message });
      return;
    }

    const heistId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const heistData = {
      id: heistId,
      type: heistType,
      initiator: sender,
      initiatorName: player.name,
      chatJid: chatJid, // FIX: store the group chat JID
      crew: [{
        id: sender,
        name: player.name,
        role: 'Leader',
        status: 'joined',
        joinedAt: Date.now()
      }],
      baseReward: heist.baseReward,
      status: 'recruiting',
      createdAt: Date.now(),
      timerEnd: Date.now() + 60000
    };

    this.activeHeists[heistId] = heistData;

    let text = `╔════════════════╗\n║  *🎯 HEIST STARTING*\n║  ${heist.name}\n╚════════════════╝\n\n`;
    text += `*👤 Mastermind:* ${player.name}\n`;
    text += `*👥 Crews Needed:* ${heist.maxCrew - 1} more (max ${heist.maxCrew} total)\n`;
    text += `*⏱️ 60 seconds to join!*\n\n`;
    text += `*Available Roles:* ${heist.roles.filter(r => r !== 'Leader').join(', ')}\n`;
    text += `*💰 Reward:* $${heist.baseReward.toLocaleString()}\n`;
    text += `*📊 Difficulty:* ${heist.difficulty}\n\n`;
    text += `TO JOIN: .heist join [role]\n`;
    text += `EXAMPLE: .heist join Driver`;

    await sock.sendMessage(chatJid, { text }, { quoted: message });

    setTimeout(async () => {
      if (this.activeHeists[heistId]) {
        await this.executeHeist(heistId, sock);
      }
    }, 60000);
  }

  // FIX: join by finding the latest active heist for this chat (no heist ID needed)
  async joinHeist(sender, _heistId, role, player, chatJid, sock, message) {
    // Find the most recent recruiting heist in this chat
    const heist = Object.values(this.activeHeists)
      .filter(h => h.chatJid === chatJid && h.status === 'recruiting')
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!heist) {
      await sock.sendMessage(chatJid, { text: '❌ No active heist.' }, { quoted: message });
      return;
    }

    if (heist.crew.some(m => m.id === sender)) {
      await sock.sendMessage(chatJid, { text: '❌ You already joined this heist!' }, { quoted: message });
      return;
    }

    if (heist.crew.length >= this.heistTypes[heist.type].maxCrew) {
      await sock.sendMessage(chatJid, { text: '❌ Heist crew is full!' }, { quoted: message });
      return;
    }

    const validRoles = this.heistTypes[heist.type].roles;
    // FIX: case-insensitive role matching — hacker / Hacker / HACKER all work
    const matchedRole = role
      ? validRoles.find(r => r.toLowerCase() === role.toLowerCase())
      : null;
    if (!matchedRole) {
      await sock.sendMessage(chatJid, { text: `❌ Specify a role!\nAvailable roles: ${validRoles.join(', ')}\nExample: .heist join hacker` }, { quoted: message });
      return;
    }

    heist.crew.push({
      id: sender,
      name: player.name,
      role: matchedRole,  // store the properly-cased version
      status: 'joined',
      joinedAt: Date.now()
    });

    const joinMsg = `✅ ${player.name} joined as *${role}*!\n👥 Crew: ${heist.crew.length}/${this.heistTypes[heist.type].maxCrew}`;
    await sock.sendMessage(chatJid, { text: joinMsg }, { quoted: message });

    if (heist.crew.length === this.heistTypes[heist.type].maxCrew) {
      await sock.sendMessage(chatJid, { text: '🎯 Crew is full! Starting heist now...' });
      await this.executeHeist(heist.id, sock);
    }
  }

  async executeHeist(heistId, sock) {
    const heist = this.activeHeists[heistId];
    if (!heist || heist.status !== 'recruiting') return;

    const heistConfig = this.heistTypes[heist.type];

    // ── Cancel if not enough crew joined ──────────────────────────────────
    if (heist.crew.length < heistConfig.minCrew) {
      const chatJid = heist.chatJid;
      delete this.activeHeists[heistId];
      if (chatJid && sock) {
        await sock.sendMessage(chatJid, {
          text: [
            `🚫 *HEIST CANCELLED!*`,
            ``,
            `🎯 ${heistConfig.name}`,
            `👥 Needed: ${heistConfig.minCrew} crew members`,
            `❌ Only ${heist.crew.length} joined`,
            ``,
            `Not enough crew showed up. Heist called off.`,
            `Try again: .heist start ${heist.type}`,
          ].join('\n')
        });
      }
      return;
    }

    heist.status = 'active';
    heist.startedAt = Date.now();
    const success = Math.random() < heistConfig.successRate;
    let resultText = '';

    if (success) {
      const rewards = this.calculateRewards(heist, heistConfig);

      resultText = `╔═══════════════════╗\n║  ✅ HEIST SUCCESSFUL!\n╚═══════════════════╝\n\n`;
      resultText += `🎯 ${heistConfig.name}\n`;
      resultText += `👥 Crew: ${heist.crew.length}\n`;
      resultText += `💰 Total Reward: $${heist.baseReward.toLocaleString()}\n\n`;
      resultText += `━━━━ REWARDS (paid to bank) ━━━━\n`;

      heist.crew.forEach(member => {
        const reward = rewards[member.id];
        resultText += `👤 ${member.name} (${member.role}): +$${reward.toLocaleString()}\n`;
      });

      resultText += `\n⭐ XP Gained: +50\n📊 Rep: +100`;

      heist.crew.forEach(member => {
        const memberPlayer = this.db.getPlayer(member.id);
        const reward = rewards[member.id];

        // FIX: reward goes to bank
        memberPlayer.bank += reward;
        memberPlayer.stats.heistsDone++;
        memberPlayer.stats.moneyEarned += reward;
        memberPlayer.experience += 50;
        memberPlayer.reputation = (memberPlayer.reputation || 0) + 100;

        // FIX: anonymous sender
        BankingCommand.recordExternal(this.db, member.id, {
          type: 'Heist Reward', amount: reward,
          sender: 'Anonymous | Acc: Unknown',
          receiver: memberPlayer.name,
          note: `${heistConfig.name} — role: ${member.role}`,
          balance: memberPlayer.bank,
        });

        this.db.updatePlayer(member.id, memberPlayer);
      });

    } else {
      // FIX: fine = 1% of base reward, XP deduction = -10
      const fine = Math.floor(heistConfig.baseReward * 0.01);

      resultText = `╔═══════════════════╗\n║  🚨 BUSTED! HEIST FAILED!\n╚═══════════════════╝\n\n`;
      resultText += `🎯 ${heistConfig.name}\n`;
      resultText += `👥 Crew: ${heist.crew.length}\n`;
      resultText += `💸 Fine: $${fine.toLocaleString()} each\n\n`;
      resultText += `━━━━━━ CONSEQUENCES ━━━━━━\n`;

      heist.crew.forEach(member => {
        resultText += `👤 ${member.name}: -$${fine.toLocaleString()} | XP -10\n`;
      });

      heist.crew.forEach(member => {
        const memberPlayer = this.db.getPlayer(member.id);
        memberPlayer.cash = Math.max(0, memberPlayer.cash - fine);
        memberPlayer.reputation = Math.max(0, (memberPlayer.reputation || 0) - 20);
        memberPlayer.experience = Math.max(0, memberPlayer.experience - 10);

        BankingCommand.recordExternal(this.db, member.id, {
          type: 'Heist Fine', amount: fine,
          sender: memberPlayer.name, receiver: 'SEPD',
          note: `Busted on ${heistConfig.name}`,
          balance: memberPlayer.cash,
        });

        this.db.updatePlayer(member.id, memberPlayer);
      });
    }

    heist.status = 'completed';
    heist.completedAt = Date.now();
    heist.success = success;

    heist.crew.forEach(member => {
      this.db.addCooldown(member.id, `heist_${heist.type}`, heistConfig.cooldown);
    });

    // FIX: send results to GROUP CHAT, not DMs
    await sock.sendMessage(heist.chatJid, { text: resultText });

    delete this.activeHeists[heistId];
  }

  calculateRewards(heist, heistConfig) {
    const rewards = {};
    const totalReward = heist.baseReward;
    const initiatorReward = Math.floor(totalReward * 0.40);
    rewards[heist.initiator] = initiatorReward;

    const remainingReward = totalReward - initiatorReward;
    const otherCrew = heist.crew.filter(m => m.id !== heist.initiator);
    const perMember = otherCrew.length > 0 ? Math.floor(remainingReward / otherCrew.length) : 0;

    otherCrew.forEach(member => {
      rewards[member.id] = perMember;
    });

    return rewards;
  }

  async startSoloHeist(sender, heistType, player, chatJid, sock, message) {
    const heist = this.heistTypes[heistType];
    if (!heist) {
      await sock.sendMessage(chatJid, { text: '❌ Heist type not found! Use *.heist list*' }, { quoted: message });
      return;
    }

    if (this.db.checkCooldown(sender, `heist_${heistType}`)) {
      const remaining = this.db.getCooldownRemaining(sender, `heist_${heistType}`);
      await sock.sendMessage(chatJid, { text: `⏰ Heist on cooldown! Wait ${Math.ceil(remaining / 60)}m` }, { quoted: message });
      return;
    }

    const success = Math.random() < heist.successRate;
    let reward = Math.floor(Math.random() * (heist.baseReward * 0.5)) + (heist.baseReward * 0.5);
    let resultText = '';

    if (success) {
      // FIX: reward to bank
      player.bank += reward;
      player.stats.heistsDone++;
      player.stats.moneyEarned += reward;
      player.experience += 30;

      BankingCommand.recordExternal(this.db, sender, {
        type: 'Heist Reward', amount: reward,
        sender: 'Unknown',
        receiver: player.name,
        note: `Solo ${heist.name}`,
        balance: player.bank,
      });

      resultText = `✅ *${heist.name} SUCCESSFUL!*\n\n💰 Reward: +$${reward.toLocaleString()} (Bank)\n⭐ XP: +30\n📊 Difficulty: ${heist.difficulty}\n\n🏦 Bank: $${player.bank.toLocaleString()}`;
    } else {
      const fine = Math.floor(heist.baseReward * 0.01);
      player.cash = Math.max(0, player.cash - fine);
      player.experience = Math.max(0, player.experience - 10);

      resultText = `🚨 *${heist.name} BUSTED!*\n\n💸 Fine: -$${fine.toLocaleString()}\nXP: -10\n📊 Difficulty: ${heist.difficulty}\n\n💵 Cash: $${player.cash.toLocaleString()}`;
    }

    this.db.addCooldown(sender, `heist_${heistType}`, heist.cooldown);
    this.db.updatePlayer(sender, player);

    await sock.sendMessage(chatJid, { text: resultText }, { quoted: message });
  }

  async cancelHeist(sender, chatJid, sock, message) {
    // Find heist started by this person in this chat
    const heist = Object.values(this.activeHeists).find(
      h => h.initiator === sender && h.chatJid === chatJid && h.status === 'recruiting'
    );
    if (!heist) {
      await sock.sendMessage(chatJid, { text: '❌ No active heist to cancel!' }, { quoted: message });
      return;
    }
    delete this.activeHeists[heist.id];
    await sock.sendMessage(chatJid, { text: '🚫 Heist cancelled!' }, { quoted: message });
  }

  async viewActiveHeists(sender, chatJid, sock, message) {
    const activeHeists = Object.values(this.activeHeists).filter(h => h.status === 'recruiting');
    if (activeHeists.length === 0) {
      await sock.sendMessage(chatJid, { text: '❌ No active heists right now!' }, { quoted: message });
      return;
    }

    let text = `╔═════════════════╗\n║  🔴 ACTIVE HEISTS\n╚═════════════════╝\n\n`;
    activeHeists.forEach(h => {
      const config = this.heistTypes[h.type];
      const secLeft = Math.max(0, Math.ceil((h.timerEnd - Date.now()) / 1000));
      text += `${config.name}\n`;
      text += `   Leader: ${h.initiatorName}\n`;
      text += `   Crew: ${h.crew.length}/${config.maxCrew}\n`;
      text += `   Time left: ${secLeft}s\n\n`;
    });
    text += `Join: .heist join [role]`;
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }
}

module.exports = HeistCommand;
