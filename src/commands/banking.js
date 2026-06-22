const { resolveMention, normJid } = require('../utils/resolveMention');
class BankingCommand {
  constructor(db) {
    this.db = db;
  }

  // ─── transaction helpers ──────────────────────────────────────────────────

  addTransaction(player, entry) {
    if (!player.transactions) player.transactions = [];
    player.transactions.push({ ...entry, timestamp: new Date().toISOString() });
    if (player.transactions.length > 300) {
      player.transactions = player.transactions.slice(-300);
    }
  }

  static recordExternal(db, playerId, entry) {
    const player = db.getPlayer(playerId);
    if (!player.transactions) player.transactions = [];
    player.transactions.push({ ...entry, timestamp: new Date().toISOString() });
    if (player.transactions.length > 300) {
      player.transactions = player.transactions.slice(-300);
    }
    db.updatePlayer(playerId, player);
  }

  formatDateTime(ts) {
    return new Date(ts).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }

  directionLabel(type) {
    const OUT = ['Withdrawal', 'Transfer Sent', 'Heist Fine', 'Gambling Loss',
                 'Vehicle Purchase', 'Business Purchase', 'Business Upgrade',
                 'Race Loss', 'Fine', 'Deposit Fee'];
    return OUT.includes(type) ? 'OUT' : 'IN';
  }

  typeEmoji(type) {
    const map = {
      'Deposit':            '📥',
      'Withdrawal':         '📤',
      'Transfer Sent':      '💸',
      'Transfer Received':  '💰',
      'Heist Reward':       '🎯',
      'Heist Fine':         '🚨',
      'Gambling Win':       '🎰',
      'Gambling Loss':      '🎲',
      'Business Income':    '🏢',
      'Race Win':           '🏆',
      'Race Loss':          '🏁',
      'Daily Reward':       '🎁',
      'Vehicle Purchase':   '🚗',
      'Vehicle Sale':       '🚘',
      'Business Purchase':  '💼',
      'Business Sale':      '🏷️',
      'Business Upgrade':   '⬆️',
      'Money Request':      '📨',
      'Level Up Reward':    '🌟',
    };
    return map[type] || '🔄';
  }

  // ─── execute ─────────────────────────────────────────────────────────────

  async execute(args, sender, chatJid, sock, message) {
    sender = normJid(sender); // normalize once at entry point
    const player = this.db.getPlayer(sender);
    const subcommand = args[0];

    // ── Balance / main menu ──────────────────────────────────────────────
    if (!subcommand || subcommand === 'balance') {
      const balanceText = `
╔═════════════════╗
║  🏦 SE BANK
║  ${player.name.substring(0, 16)}'s account.
╚═════════════════╝

💵 Cash:  $${player.cash.toLocaleString()}
🏦 Bank:  $${player.bank.toLocaleString()}
💰 Worth: $${(player.cash + player.bank).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━
COMMANDS:
.bank deposit [amt]
.bank withdraw [amt]
.bank transfer [@p] [amt]
.bank request [@p] [amt]
.bank history [page]

Min deposit: $10
3% fee on transfers
      `.trim();
      await sock.sendMessage(chatJid, { text: balanceText }, { quoted: message });
      return;
    }

    // ── Deposit ──────────────────────────────────────────────────────────
    if (subcommand === 'deposit') {
      // Support 'all' to deposit entire cash balance
      const rawAmt = (args[1] || '').toLowerCase();
      const amount = rawAmt === 'all' ? player.cash : parseInt(args[1]);
      if (isNaN(amount) || amount <= 0) {
        await sock.sendMessage(chatJid, { text: '```Invalid amount! Use a number or *all*\n.bank deposit all```' }, { quoted: message }); return;
      }
      if (amount < 10) {
        await sock.sendMessage(chatJid, { text: '```Minimum deposit is $10```' }, { quoted: message }); return;
      }
      if (amount > 100000000) {
        await sock.sendMessage(chatJid, { text: '```Maximum deposit is $100M!```' }, { quoted: message }); return;
      }
      if (amount > player.cash) {
        await sock.sendMessage(chatJid, { text: `\`\`\`Not enough cash\n💵 You have: $${player.cash.toLocaleString()}\`\`\`` }, { quoted: message }); return;
      }

      player.cash -= amount;
      player.bank += amount;
      this.addTransaction(player, {
        type: 'Deposit',
        amount,
        sender: player.name,
        receiver: 'SE Bank Vault',
        note: 'Cash deposit',
        balance: player.bank,
      });
      this.db.updatePlayer(sender, player);

      await sock.sendMessage(chatJid, {
        text: `\`\`\`✅ *Deposit Successful*\n\n📥 +$${amount.toLocaleString()} to Bank\n🏦 Bank: $${player.bank.toLocaleString()}\n💵 Cash: $${player.cash.toLocaleString()}\n⏰ ${this.formatDateTime(new Date())}\`\`\``
      }, { quoted: message });
      return;
    }

    // ── Withdraw ─────────────────────────────────────────────────────────
    if (subcommand === 'withdraw') {
      // Support 'all' to withdraw entire bank balance
      const rawAmt = (args[1] || '').toLowerCase();
      const amount = rawAmt === 'all' ? player.bank : parseInt(args[1]);
      if (isNaN(amount) || amount <= 0) {
        await sock.sendMessage(chatJid, { text: '```Invalid amount! Use a number or *all*\n.bank withdraw all```' }, { quoted: message }); return;
      }
      if (amount > player.bank) {
        await sock.sendMessage(chatJid, { text: `\`\`\`Insufficient bank balance\n🏦 Balance: $${player.bank.toLocaleString()}\`\`\`` }, { quoted: message }); return;
      }

      player.bank -= amount;
      player.cash += amount;
      this.addTransaction(player, {
        type: 'Withdrawal',
        amount,
        sender: 'SE Bank Vault',
        receiver: player.name,
        note: 'Cash withdrawal',
        balance: player.bank,
      });
      this.db.updatePlayer(sender, player);

      await sock.sendMessage(chatJid, {
        text: `\`\`\`✅ *Withdrawal Successful*\n\n📤 $${amount.toLocaleString()} to Cash\n🏦 Bank: $${player.bank.toLocaleString()}\n💵 Cash: $${player.cash.toLocaleString()}\n⏰ ${this.formatDateTime(new Date())}\`\`\``
      }, { quoted: message });
      return;
    }

    // ── History ───────────────────────────────────────────────────────────
    if (subcommand === 'history') {
      const txns = player.transactions || [];
      if (txns.length === 0) {
        await sock.sendMessage(chatJid, { text: 'You have no recorded transaction yet.' }, { quoted: message });
        return;
      }

      const PER_PAGE = 5;
      const totalPages = Math.ceil(txns.length / PER_PAGE);
      const page = Math.min(Math.max(parseInt(args[1]) || 1, 1), totalPages);
      const start = txns.length - (page * PER_PAGE);
      const end   = txns.length - ((page - 1) * PER_PAGE);
      const slice = txns.slice(Math.max(start, 0), end).reverse();

      let totalIn = 0, totalOut = 0;
      txns.forEach(t => {
        if (this.directionLabel(t.type) === 'IN')  totalIn  += t.amount;
        else                                         totalOut += t.amount;
      });

      let text = `
╔════════════════════════╗
║  📋 TRANSACTION HISTORY
║  ${player.name} | Pg ${page}/${totalPages}
╚════════════════════════╝

🟢 Money IN:  +$${totalIn.toLocaleString()}
      🔴 Money OUT: -$${totalOut.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      slice.forEach((t, i) => {
        const dir    = this.directionLabel(t.type);
        const arrow  = dir === 'IN' ? '▲' : '▼';
        const sign   = dir === 'IN' ? '+' : '-';
        const num    = (page - 1) * PER_PAGE + (PER_PAGE - i);
        text += `${num}. ${this.typeEmoji(t.type)} *${t.type}*\n`;
        text += `   ${arrow} ${sign}$${t.amount.toLocaleString()}\n`;
        text += `   From: ${t.sender}  ->  To: ${t.receiver}\n`;
        if (t.note) text += `   Note: ${t.note}\n`;
        text += `   Bal: $${(t.balance || 0).toLocaleString()}  •  ${this.formatDateTime(t.timestamp)}\n\n`;
      });

      text += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `📊 ${txns.length} total  •  `;
      if (page < totalPages) text += `Next: *.bank history ${page + 1}*`;
      else text += `_(Last page)_`;

      await sock.sendMessage(chatJid, { text: text.trim() }, { quoted: message });
      return;
    }

    // ── Transfer ──────────────────────────────────────────────────────────
    if (subcommand === 'transfer') {
      // ── Resolve recipient ID ─────────────────────────────────────────────
      // WhatsApp delivers @mentions as special objects in extendedTextMessage.
      // The plain-text args may contain a display name, not a number.
      // We try three sources in priority order:
      //   1) Mentioned JIDs from the message context (most reliable in groups)
      //   2) Digit string in args[1] (e.g. ".bank transfer 2348131686152 500")
      //   3) Give up and show usage hint.

      let recipientId = null;

      // Resolve recipient from WhatsApp mention or bare phone digits
      const _rawRecipId = resolveMention(message, args, 1);
      recipientId = normJid(_rawRecipId);

      // Parse amount — it could be args[2] (with @mention) or args[1] (bare number transfer)
      const rawAmount = args[2] || args[1];
      const amount = parseInt(rawAmount);

      if (!recipientId || isNaN(amount) || amount <= 0) {
        await sock.sendMessage(chatJid, {
          text: '```Usage: .bank transfer [@player] [amount]\n\nExample: .bank transfer @John 5000\nOr: .bank transfer 2348131686152 5000```'
        }, { quoted: message });
        return;
      }

      if (amount < 1) {
        await sock.sendMessage(chatJid, { text: '```Minimum transfer is $1```' }, { quoted: message }); return;
      }
      if (amount > 50_000_000) {
        await sock.sendMessage(chatJid, { text: '```Max transfer is $50,000,000```' }, { quoted: message }); return;
      }

      const fee = Math.ceil(amount * 0.03);
      const totalDeducted = amount + fee;

      if (totalDeducted > player.bank) {
        await sock.sendMessage(chatJid, {
          text: `\`\`\`Insufficient bank balance\n🏦 Bank: $${player.bank.toLocaleString()}\n💸 Need (inc. 3% fee): $${totalDeducted.toLocaleString()}\`\`\``
        }, { quoted: message }); return;
      }

      if (recipientId === sender) {
        await sock.sendMessage(chatJid, { text: '```Cannot transfer to yourself```' }, { quoted: message }); return;
      }

      // Check recipient exists in the game before touching money
      const recipientExists = !!this.db.data.players[recipientId];
      if (!recipientExists) {
        await sock.sendMessage(chatJid, {
          text: '```That player has not started playing yet. They need to send .menu first.```'
        }, { quoted: message }); return;
      }

      const ts = new Date().toISOString();

      // ── Update recipient FIRST (independent object) ──────────────────────
      // Get recipient fresh, modify, save — completely isolated from sender.
      const recipient = this.db.data.players[recipientId];
      recipient.bank += amount;
      if (!recipient.transactions) recipient.transactions = [];
      recipient.transactions.push({
        type: 'Transfer Received', amount,
        sender: player.name, receiver: recipient.name || recipientId.split('@')[0],
        note: `Received from ${player.name}`,
        balance: recipient.bank,
        timestamp: ts,
      });
      if (recipient.transactions.length > 300) recipient.transactions = recipient.transactions.slice(-300);
      recipient.lastActive = new Date();
      this.db.saveData(); // save recipient changes

      // ── Now update sender ────────────────────────────────────────────────
      player.bank -= totalDeducted;
      this.addTransaction(player, {
        type: 'Transfer Sent', amount: totalDeducted,
        sender: player.name, receiver: recipient.name || recipientId.split('@')[0],
        note: `Sent $${amount.toLocaleString()} + $${fee.toLocaleString()} (3% fee)`,
        balance: player.bank, timestamp: ts,
      });
      this.db.updatePlayer(sender, player); // saves again

      // ── Notify both parties ──────────────────────────────────────────────
      await sock.sendMessage(chatJid, {
        text: `✅ *Transfer Successful*\n\n💸 $${amount.toLocaleString()} → ${recipient.name || recipientId.split('@')[0]}\n💰 3% Fee: -$${fee.toLocaleString()}\n🏦 Your Bank: $${player.bank.toLocaleString()}\n⏰ ${this.formatDateTime(ts)}`
      }, { quoted: message });

      try {
        await sock.sendMessage(recipientId, {
          text: `💰 *Incoming Transfer Received!*\n\n+$${amount.toLocaleString()} from ${player.name}\n🏦 Your Bank: $${recipient.bank.toLocaleString()}\n⏰ ${this.formatDateTime(ts)}`
        });
      } catch (e) {
        console.error('Could not DM recipient:', e.message);
      }

      return;
    }

    // ── Request ───────────────────────────────────────────────────────────
    if (subcommand === 'request') {
      const amount = parseInt(args[2]);

      if (isNaN(amount) || amount <= 0) {
        await sock.sendMessage(chatJid, { text: '```Usage: .bank request [@player] [amount]```' }, { quoted: message }); return;
      }
      if (this.db.checkCooldown(sender, 'money_request')) {
        const rem = this.db.getCooldownRemaining(sender, 'money_request');
        await sock.sendMessage(chatJid, { text: `⏰ Request on cooldown! Wait ${Math.ceil(rem / 60)}m` }, { quoted: message }); return;
      }
      if (amount < 10)       { await sock.sendMessage(chatJid, { text: '```Minimum request is $10!```' }, { quoted: message }); return; }
      if (amount > 10000000) { await sock.sendMessage(chatJid, { text: '```Maximum request is $10M!```' }, { quoted: message }); return; }

      const _rawReqId = resolveMention(message, args.slice(1), 0);
      const requestId = normJid(_rawReqId);
      if (!requestId) { await sock.sendMessage(chatJid, { text: '```Tag a player: .bank request @player [amt]```' }, { quoted: message }); return; }
      const requestPlayer = this.db.getPlayer(requestId);
      if (!requestPlayer) { await sock.sendMessage(chatJid, { text: '```Player not found```' }, { quoted: message }); return; }

      this.db.addCooldown(sender, 'money_request', 600000);

      // Store pending request so receiver can .accept trans / .decline trans
      if (!this.db.data.pendingTransRequests) this.db.data.pendingTransRequests = {};
      this.db.data.pendingTransRequests[requestId] = {
        fromId:   sender,
        fromName: player.name || sender.split('@')[0],
        amount,
        sentAt:   Date.now(),
      };
      this.db.saveData();

      await sock.sendMessage(chatJid, {
        text: `📨 *Request Sent*\n\n💰 $${amount.toLocaleString()} requested from *${requestPlayer.name || requestId.split('@')[0]}*\n\nThey can reply with:\n✅ *.accept trans* — pay you\n❌ *.decline trans* — refuse`
      }, { quoted: message });

      await sock.sendMessage(requestId, {
        text: [
          `📨 *MONEY REQUEST*`,
          `*${player.name || sender.split('@')[0]}* is requesting *$${amount.toLocaleString()}* from your bank.`,
          `✅ *.accept trans*`,
          `❌ *.decline trans*`,
          `⏰ Expires in 10 minutes`,
        ].join('\n'),
      });
      return;
    }

    // ── Accept money request ───────────────────────────────────────────────
    if (subcommand === 'accept' && (args[1] || '').toLowerCase() === 'trans') {
      const requests = this.db.data.pendingTransRequests || {};
      const req      = requests[sender];

      if (!req) {
        await sock.sendMessage(chatJid, { text: '```No pending money request to accept.```' }, { quoted: message }); return;
      }
      if (Date.now() - req.sentAt > 10 * 60 * 1000) {
        delete requests[sender];
        this.db.saveData();
        await sock.sendMessage(chatJid, { text: '```Money request expired.```' }, { quoted: message }); return;
      }
      if (player.bank < req.amount) {
        await sock.sendMessage(chatJid, {
          text: `\`\`\`Not enough in bank\n🏦 Balance: $${player.bank.toLocaleString()}\n💰 Requested: $${req.amount.toLocaleString()}\`\`\``
        }, { quoted: message }); return;
      }

      // Deduct from payer
      player.bank -= req.amount;
      this.addTransaction(player, { type: 'Transfer Out', amount: req.amount, sender: player.name, receiver: req.fromName, note: `Money request from ${req.fromName}`, balance: player.bank });
      this.db.updatePlayer(sender, player);

      // Credit requester
      const requester = this.db.getPlayer(req.fromId);
      if (requester) {
        requester.bank = (requester.bank || 0) + req.amount;
        this.addTransaction(requester, { type: 'Transfer In', amount: req.amount, sender: player.name, receiver: requester.name, note: `Request paid by ${player.name}`, balance: requester.bank });
        this.db.updatePlayer(req.fromId, requester);
      }

      delete requests[sender];
      this.db.saveData();

      await sock.sendMessage(chatJid, {
        text: `✅ *Payment Sent!*\n\n💸 -$${req.amount.toLocaleString()} from your bank\n🏦 Bank: $${player.bank.toLocaleString()}`
      }, { quoted: message });

      // Notify requester
      try {
        await sock.sendMessage(req.fromId, {
          text: `💰 *Request Fulfilled!*\n\n*${player.name || sender.split('@')[0]}* paid your $${req.amount.toLocaleString()} request!\n🏦 Bank: $${(requester?.bank || 0).toLocaleString()}`
        });
      } catch {}
      return;
    }

    // ── Decline money request ──────────────────────────────────────────────
    if (subcommand === 'decline' && (args[1] || '').toLowerCase() === 'trans') {
      const requests = this.db.data.pendingTransRequests || {};
      const req      = requests[sender];

      if (!req) {
        await sock.sendMessage(chatJid, { text: '```No pending money request to decline.```' }, { quoted: message }); return;
      }

      delete requests[sender];
      this.db.saveData();

      await sock.sendMessage(chatJid, { text: `\`\`\`*Request declined.*\`\`\`` }, { quoted: message });

      try {
        await sock.sendMessage(req.fromId, {
          text: `❌ *${player.name || sender.split('@')[0]}* declined your $${req.amount.toLocaleString()} money request.`
        });
      } catch {}
      return;
    }

    await sock.sendMessage(chatJid, { text: '```Unknown banking command. Use .bank to see options.```' }, { quoted: message });
  }
}

module.exports = BankingCommand;
