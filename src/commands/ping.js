'use strict';

class PingCommand {
  constructor(db) {
    this.db = db;
  }

  async execute(args, sender, chatJid, sock, message) {
    const sentAt = Date.now();

    // Step 1: send a placeholder so we can measure round-trip
    const sent = await sock.sendMessage(chatJid, { text: '🏓 Pinging...' }, { quoted: message });

    const rtt = Date.now() - sentAt;

    // Step 2: measure DB read speed
    const dbStart = Date.now();
    this.db.getPlayer(sender);
    const dbMs = Date.now() - dbStart;

    // Step 3: classify latency
    const latencyLabel = rtt < 300  ? '🟢 Excellent'
                       : rtt < 700  ? '🟡 Good'
                       : rtt < 1500 ? '🟠 Fair'
                       :              '🔴 Poor';

    const dbLabel = dbMs < 5   ? '⚡ Instant'
                  : dbMs < 20  ? '✅ Fast'
                  : dbMs < 100 ? '🟡 Normal'
                  :              '🔴 Slow';

    const uptime    = process.uptime();
    const uptimeStr = uptime < 60
      ? `${Math.floor(uptime)}s`
      : uptime < 3600
      ? `${Math.floor(uptime/60)}m ${Math.floor(uptime%60)}s`
      : `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`;

    const memUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const memTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);

    const lines = [
      `🏓 *PONG!*`,
      ``,
      `📡 *Bot Latency*`,
      `   ${latencyLabel}  —  *${rtt}ms*`,
      ``,
      `💾 *DB Read Speed*`,
      `   ${dbLabel}  —  *${dbMs}ms*`,
      ``,
      `⏱️ *Uptime:* ${uptimeStr}`,
      `🧠 *Memory:* ${memUsed}MB / ${memTotal}MB`,
      `🌐 *Node:* ${process.version}`,
    ];

    // Edit the placeholder message in place
    try {
      await sock.sendMessage(chatJid, {
        text: lines.join('\n'),
        edit: sent.key,
      });
    } catch {
      // Fallback: some Baileys versions don't support edit — just send fresh
      await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
    }
  }
}

module.exports = PingCommand;
