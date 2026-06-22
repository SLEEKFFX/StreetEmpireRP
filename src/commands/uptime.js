const os = require('os');

class UptimeCommand {
  /**
   * @param {object} db         - Database instance
   * @param {object} botStats   - Live reference to bot-level stats:
   *   { startTime: Date, activePlayers: Map, gameVersion: string }
   */
  constructor(db, botStats) {
    this.db = db;
    this.botStats = botStats;
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  formatUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const days    = Math.floor(totalSec / 86400);
    const hours   = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const parts = [];
    if (days)    parts.push(`${days}d`);
    if (hours)   parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  formatBytes(bytes) {
    if (bytes < 1024)             return `${bytes} B`;
    if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  getCpuUsage() {
    // Snapshot two readings 100 ms apart for a real delta
    return new Promise((resolve) => {
      const cpus1 = os.cpus();

      setTimeout(() => {
        const cpus2 = os.cpus();
        let totalIdle = 0, totalTick = 0;

        cpus2.forEach((cpu, i) => {
          const prev = cpus1[i];
          for (const type in cpu.times) {
            totalTick += cpu.times[type] - prev.times[type];
          }
          totalIdle += cpu.times.idle - prev.times.idle;
        });

        const usage = 100 - (100 * totalIdle / totalTick);
        resolve(Math.max(0, usage).toFixed(1));
      }, 100);
    });
  }

  async measurePing(sock) {
    // Measure the round-trip time of a WhatsApp keepalive ping
    try {
      const start = Date.now();
      await sock.sendPresenceUpdate('available');
      return Date.now() - start;
    } catch {
      return null;
    }
  }

  getSpeedLabel(ms) {
    if (ms === null) return '❓ N/A';
    if (ms < 100)   return `⚡ ${ms}ms (Excellent)`;
    if (ms < 300)   return `✅ ${ms}ms (Good)`;
    if (ms < 600)   return `⚠️ ${ms}ms (Fair)`;
    return `🔴 ${ms}ms (Poor)`;
  }

  // ─── execute ─────────────────────────────────────────────────────────────────

  async execute(args, sender, chatJid, sock, message) {
    // Gather all metrics in parallel where possible
    const [cpuPercent, pingMs] = await Promise.all([
      this.getCpuUsage(),
      this.measurePing(sock),
    ]);

    const memTotal = os.totalmem();
    const memFree  = os.freemem();
    const memUsed  = memTotal - memFree;
    const memPct   = ((memUsed / memTotal) * 100).toFixed(1);

    // Process (bot process) RAM
    const procMem  = process.memoryUsage();
    const heapUsed = procMem.heapUsed;
    const rss      = procMem.rss;

    const uptimeMs       = Date.now() - this.botStats.startTime.getTime();
    const activePlayers  = this.botStats.activePlayers.size;
    const totalPlayers   = Object.keys(this.db.data.players || {}).length;
    const totalCrews     = Object.keys(this.db.data.crews || {}).length;
    const version        = this.botStats.gameVersion || '1.0.0';

    // CPU bar (10 blocks)
    const cpuBar = this._bar(parseFloat(cpuPercent), 100, 10);
    // RAM bar
    const ramBar = this._bar(memUsed, memTotal, 10);

    const text = `
╔════════════════╗
║  🤖 *BOT STATUS*
╚════════════════╝
⏱️ *Uptime*
   ${this.formatUptime(uptimeMs)}
📡 *Network Speed*
   ${this.getSpeedLabel(pingMs)}
🖥️ *CPU Usage*
   ${cpuBar} ${cpuPercent}%
   Cores: ${os.cpus().length} × ${(os.cpus()[0].speed / 1000).toFixed(1)} GHz
🧠 *RAM Usage*
   ${ramBar} ${memPct}%
   Bot:    ${this.formatBytes(rss)} (heap ${this.formatBytes(heapUsed)})
   System: ${this.formatBytes(memUsed)} / ${this.formatBytes(memTotal)}
━━━━━━━━━━━━━━━━━━━━━
👥 *Players*
   Active Now:   ${activePlayers}
   Registered:   ${totalPlayers}
   Crews:        ${totalCrews}
━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 Version: v${version}
🕐 Turned on at: ${this.botStats.startTime.toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    })}
╚══════════════════╝
    `.trim();

    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  /** Render a simple block progress bar */
  _bar(value, max, width) {
    const filled = Math.round((value / max) * width);
    const empty  = width - filled;
    return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
  }
}

module.exports = UptimeCommand;
