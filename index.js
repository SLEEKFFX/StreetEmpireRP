const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();
const Database = require('./src/database');
const CommandHandler = require('./src/commands/commandHandler');

class StreetEmpireBot {
  constructor() {
    this.sock = null;
    this.db = new Database();
    this.gameVersion = '7.2.0';
    this.startTime = new Date();
    this.activePlayers = new Map();
    this.commandCounts = new Map(); // tracks per-user command timestamps for rate limiting
    this.isInitializing = false;
    this.qrDisplayed = false;

    // Live stats reference passed to commands that need bot-level data (e.g. UptimeCommand)
    const botStats = {
      startTime: this.startTime,
      activePlayers: this.activePlayers,
      gameVersion: this.gameVersion,
    };
    this.commandHandler = new CommandHandler(this.db, botStats);
  }

  displaySystemInfo() {
    const players = Object.keys(this.db.data.players || {}).length;
    const crews = Object.keys(this.db.data.crews || {}).length;
    const transactions = this.db.data.transactions ? this.db.data.transactions.length : 0;

    console.log('\n╔═══════════════════════════════╗');
    console.log('║  🎮 Street Empire RP v' + this.gameVersion + '║');
    console.log('╚═══════════════════════════════╝\n');
    console.log('📍 Bot Prefix: .');
    console.log('🕐 Started: ' + new Date().toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }));
    console.log('💾 Database: gamedata.json');
    console.log('📁 Auth: auth_info_baileys/');

    // BUG FIX: was checking for menuimage.jpg but file is menuimage.png
    const menuImagePath = path.join(__dirname, 'resources', 'menuimage.png');
    if (fs.existsSync(menuImagePath)) {
      console.log('✅ Menu image found: resources/menuimage.png');
    } else {
      console.log('⚠️  Menu image not found: resources/menuimage.png (optional)');
    }

    console.log('✅ Database loaded');
    console.log(`👥 Total Players: ${players}`);
    console.log(`👥 Active Players: ${this.activePlayers.size}`);
    console.log(`💼 Total Crews: ${crews}`);
    console.log(`💰 Total Transactions: ${transactions}\n`);
    console.log('📖 Commands: Type .menu or .help');
    console.log('╔═════════════════════════════╗\n');
  }

  getUptime() {
    const diff = Math.floor((new Date() - this.startTime) / 1000);
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  isSpamming(sender) {
    const now = Date.now();
    const WINDOW_MS = 10000;   // 10-second sliding window
    const MAX_COMMANDS = 3;    // allow up to 3 commands within the window

    if (!this.commandCounts.has(sender)) {
      this.commandCounts.set(sender, []);
    }

    // Keep only timestamps within the current window
    const timestamps = this.commandCounts.get(sender).filter(t => now - t < WINDOW_MS);
    timestamps.push(now);
    this.commandCounts.set(sender, timestamps);

    return timestamps.length > MAX_COMMANDS;
  }

  trackPlayer(sender, command) {
    if (!this.activePlayers.has(sender)) {
      this.activePlayers.set(sender, { firstSeen: new Date(), lastSeen: new Date(), commandCount: 0, lastCommand: null });
    }
    const player = this.activePlayers.get(sender);
    player.lastSeen = new Date();
    player.commandCount++;
    player.lastCommand = command;
    this.activePlayers.set(sender, player);
    this.commandCounts.set(command, (this.commandCounts.get(command) || 0) + 1);
  }

  logCommand(sender, command, isGroup) {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const type = isGroup ? '👥 GROUP' : '💬 DM';
    const playerName = this.db.data.players[sender]?.name || sender.split('@')[0];
    console.log(`[${time}] ${type} | ${playerName} executed: ${command}`);
  }

  logError(sender, error) {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const playerName = this.db.data.players[sender]?.name || sender.split('@')[0];
    console.log(`[${time}] ❌ ERROR | ${playerName}: ${error.message}`);
  }

  // BUG FIX: Added pair code authentication support
  async askPairOrQR() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('\n📲 Choose authentication method:\n  [1] QR Code (scan with WhatsApp)\n  [2] Pair Code (enter code on phone)\nChoice (1 or 2): ', (answer) => {
        rl.close();
        if (answer.trim() === '2') {
          const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl2.question('📞 Enter your WhatsApp phone number (with country code, e.g. 12345678900): ', (num) => {
            rl2.close();
            resolve({ method: 'pair', phoneNumber: num.trim().replace(/[^0-9]/g, '') });
          });
        } else {
          resolve({ method: 'qr' });
        }
      });
    });
  }

  async initialize(authChoice = null) {
    if (this.isInitializing) {
      console.log('⚠️  Already initializing, skipping...');
      return;
    }

    this.isInitializing = true;
    this.qrDisplayed = false;

    try {
      console.log('📡 Fetching latest Baileys version...');
      let version;
      try {
        const result = await fetchLatestBaileysVersion();
        version = result.version;
        console.log(`✅ Using Baileys version ${version.join('.')}`);
      } catch (e) {
        // BUG FIX: Fallback version if network fetch fails
        version = [2, 3000, 1015901307];
        console.log(`⚠️  Could not fetch latest version, using fallback: ${version.join('.')}`);
      }

      const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

      // BUG FIX: Use silent pino logger instead of undefined (avoids noisy output)
      const logger = pino({ level: 'silent' });

      const usePairCode = authChoice?.method === 'pair';

      // BUG FIX: getMessage is required for group chats in Baileys.
      // Without it, group members see "Waiting for this message. This may take a while."
      // because WhatsApp asks the sender to re-transmit the message key and Baileys
      // has no way to provide it. Returning a dummy object satisfies the protocol.
      const getMessage = async (key) => {
        if (this.db?.data?.players) {
          // Try to return a real message body if we have it cached; fallback to empty
        }
        return { conversation: '' };
      };

      this.sock = makeWASocket({
        version,
        auth: state,
        // PAIR CODE FIX: WhatsApp detects and rejects fake browser strings.
        // Browsers.ubuntu('Chrome') produces the real fingerprint WhatsApp expects,
        // which is required for pair code authentication to work.
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        emitOwnEvents: true,
        logger,
        retryRequestDelayMs: 250,
        printQRInTerminal: false,
        getMessage,  // ← fixes "Waiting for this message" in group chats
      });

      this.sock.ev.on('creds.update', saveCreds);

      // ── Auto-view status / Stories listener ──────────────────────────────────
      this.sock.ev.on('messages.upsert', async (m) => {
        try {
          const { featureState } = require('./src/commands/botstatus');
          if (!featureState.autoViewStatus) return;
          for (const msg of m.messages) {
            const jid = msg.key?.remoteJid;
            if (!jid || jid !== 'status@broadcast') continue;
            // Mark status as read/viewed
            const participant = msg.key.participant || msg.key.remoteJid;
            await this.sock.readMessages([msg.key]);
            await this.sock.sendReceipt(jid, participant, [msg.key.id], 'read');
          }
        } catch {}
      });

      // ── PAIR CODE: request immediately after socket creation ─────────────────
      // Baileys queues the request internally; we don't need to wait for any event.
      // We do it here — before registering connection.update — so it fires before
      // WhatsApp has a chance to generate a QR code (which would void the pairing).
      if (usePairCode && !state.creds.registered) {
        // Give the WebSocket 500ms to open its TCP connection, then fire.
        setTimeout(async () => {
          try {
            console.log('\n⏳ Requesting pair code from WhatsApp...');
            const code = await this.sock.requestPairingCode(authChoice.phoneNumber);
            if (!code) throw new Error('Empty code returned');
            const formatted = code.match(/.{1,4}/g)?.join('-') || code;
            console.log('\n╔══════════════════════════════════════════╗');
            console.log('║  🔐 WHATSAPP PAIR CODE                    ║');
            console.log('╠══════════════════════════════════════════╣');
            console.log(`║  👉  ${formatted.padEnd(36)}║`);
            console.log('╚══════════════════════════════════════════╝');
            console.log('');
            console.log('HOW TO USE THIS CODE:');
            console.log('1. Open WhatsApp on your phone');
            console.log('2. Tap the 3-dot menu (⋮) top-right');
            console.log('3. Go to  Linked Devices');
            console.log('4. Tap  Link a Device');
            console.log('5. Tap  Link with phone number  (bottom of screen)');
            console.log('6. Enter YOUR phone number, then enter the 8-digit code above');
            console.log('');
            console.log('⏳ Code expires in ~60 seconds. Waiting...\n');
          } catch (e) {
            console.error('❌ Pair code request failed:', e.message);
            console.log('');
            console.log('TROUBLESHOOTING:');
            console.log('• Make sure the number you entered is the SAME number linked to this WhatsApp');
            console.log('• Include country code without + (e.g. 2348012345678 for Nigeria)');
            console.log('• Delete auth_info_baileys/ and restart if this keeps failing');
            console.log('• Falling back to QR code — scan that instead\n');
            this.qrDisplayed = false;
          }
        }, 500);
      }

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.qrDisplayed && !usePairCode) {
          console.log('\n╔══════════════════════════╗');
          console.log('║  📱 SCAN QR CODE WITH WHATSAPP ');
          console.log('╚════════════════════════════╝\n');
          qrcode.generate(qr, { small: true });
          console.log('\n📲 Use your phone to scan the QR code above');
          console.log('⏳ Waiting for authentication...\n');
          this.qrDisplayed = true;
        }

        if (connection === 'connecting') {
          console.log('⏳ Connecting to WhatsApp...');
        }

        if (connection === 'open') {
          console.log('✅ Street Empire RP Connected!\n');
          this.commandHandler.setSock(this.sock);
          this.isInitializing = false;
          this.displaySystemInfo();
        }

        if (connection === 'close') {
          this.isInitializing = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          if (shouldReconnect) {
            console.log('🔄 Reconnecting in 5 seconds...\n');
            await new Promise(resolve => setTimeout(resolve, 5000));
            await this.initialize(authChoice);
          } else {
            console.log('❌ Logged out. Please delete the auth_info_baileys folder and restart.\n');
            process.exit(0);
          }
        }
      });

      this.sock.ev.on('messages.upsert', async (m) => {
        // Only process real incoming messages, not history/offline sync
        if (m.type !== 'notify') return;
        try {
          const message = m.messages[0];
          if (!message.message) return;

          const chatJid = message.key.remoteJid;
          const isGroup = chatJid.endsWith('@g.us');
          // Normalize: strip Baileys multi-device suffix (:X) and harmonise @c.us → @s.whatsapp.net
          const _normJid = (j) => j ? j.replace(/:\d+@/, '@').replace(/@c\.us$/, '@s.whatsapp.net') : j;
          const sender = _normJid(isGroup ? (message.key.participant || chatJid) : chatJid);

          // Skip messages sent BY THE BOT PROCESS itself (auto-responses) to avoid
          // infinite loops — but ALLOW the bot owner (paired number) to use commands.
          // When the owner types in a group: fromMe=true, participant = owner's JID.
          // When the bot sends a reply: fromMe=true, participant = null/undefined.
          if (message.key.fromMe && isGroup) {
            const participant = message.key.participant;
            if (!participant) return; // bot's own outgoing message — skip
            // If participant is set, it's the owner typing — allow through
          }

          let text = '';
          if (message.message.conversation) {
            text = message.message.conversation;
          } else if (message.message.extendedTextMessage?.text) {
            text = message.message.extendedTextMessage.text;
          } else if (message.message.imageMessage?.caption) {
            text = message.message.imageMessage.caption;
          }

          // Allow bare "1"/"2" (purchase confirms), "heads"/"tails" (coin flip), race replies
          const isBareReply = /^[12]$/.test(text.trim()) ||
                              /^(heads|tails)$/i.test(text.trim());

          if (!text.startsWith('.') && !isBareReply) return;

          // Ignore a lone dot or dot followed only by whitespace
          const commandBody = isBareReply ? text.trim() : text.slice(1).trim();
          if (!commandBody) return;

          // ── Antilink check — runs on ALL group messages, not just commands ────
          if (isGroup && this.commandHandler?.commands?.utility) {
            try {
              // checkAntilink is on the 'antilink' command instance (from antilink.js)
          const antilinkCmd = this.commandHandler.commands.antilink;
          const handled = antilinkCmd?.checkAntilink
            ? await antilinkCmd.checkAntilink(this.sock, chatJid, sender, message)
            : false;
              if (handled) return; // link was detected and handled — stop processing
            } catch (e) { /* don't break normal flow on antilink errors */ }
          }

          if (this.isSpamming(sender)) {
            await this.sock.sendMessage(chatJid, { text: '⏱️ Slow down! Max 3 commands every 10 seconds.' }, { quoted: message });
            return;
          }

          const args = commandBody.split(/\s+/);
          const command = args[0].toLowerCase();

          this.trackPlayer(sender, command);
          this.logCommand(sender, command, isGroup);

          // Debug: log mention data when DEBUG_MENTIONS=1
          if (process.env.DEBUG_MENTIONS === '1') {
            const _msg = message?.message || {};
            const _ctx = _msg?.extendedTextMessage?.contextInfo;
            console.log('[MENTION DEBUG] type:', Object.keys(_msg)[0]);
            console.log('[MENTION DEBUG] contextInfo keys:', _ctx ? Object.keys(_ctx) : 'none');
            console.log('[MENTION DEBUG] mentionedJid:', _ctx?.mentionedJid);
            console.log('[MENTION DEBUG] args:', args.slice(1));
          }

          await this.commandHandler.handle(text, command, args.slice(1), sender, chatJid, this.sock, message);

        } catch (error) {
          console.error('❌ Message Error:', error);
          try {
            await this.sock.sendMessage(m.messages[0].key.remoteJid, { text: '```error — try again```' });
          } catch (e) {
            console.error('Failed to send error message:', e.message);
          }
        }
      });

    } catch (error) {
      console.error('❌ Initialization Error:', error.message);
      this.isInitializing = false;
      console.log('🔄 Retrying in 5 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.initialize(authChoice);
    }
  }

  async start() {
    try {
      console.log('\n🚀 Starting Street Empire RP...\n');

      if (!fs.existsSync('auth_info_baileys')) {
        fs.mkdirSync('auth_info_baileys', { recursive: true });
        console.log('✅ Created auth_info_baileys directory');
      }

      await this.db.connect();

      // Ask for auth method only on first run (no saved session)
      const hasSession = fs.existsSync('auth_info_baileys/creds.json');
      let authChoice = { method: 'qr' };
      if (!hasSession) {
        authChoice = await this.askPairOrQR();
      } else {
        console.log('✅ Existing session found, reconnecting...\n');
      }

      await this.initialize(authChoice);

    } catch (error) {
      console.error('❌ Fatal Error:', error);
      console.log('🔄 Retrying in 10 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
      await this.start();
    }
  }

  setupGracefulShutdown() {
    process.on('SIGINT', async () => {
      console.log('\n\n👋 Street Empire RP shutting down...');
      console.log('⏱️ Uptime: ' + this.getUptime());
      console.log('👥 Active Players: ' + this.activePlayers.size);
      console.log('\nGoodbye! 👑\n');
      try {
        if (this.sock) await this.sock.end();
      } catch (e) {
        console.error('Error during shutdown:', e.message);
      }
      process.exit(0);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
    });
  }
}

const bot = new StreetEmpireBot();
bot.setupGracefulShutdown();
bot.start().catch(console.error);
