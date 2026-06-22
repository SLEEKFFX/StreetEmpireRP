const fs   = require('fs');
const path = require('path');

// All image extensions we support + their MIME types
const IMAGE_MIMES = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

class MenuCommand {
  constructor(db) {
    this.db = db;
    this.resourcesDir = path.join(__dirname, '../../resources');
    this._imageCache = null;
  }

  _refreshCache() {
    try {
      const files = fs.readdirSync(this.resourcesDir);
      this._imageCache = files
        .filter(f => IMAGE_MIMES[path.extname(f).toLowerCase()])
        .map(f => path.join(this.resourcesDir, f));
      this._cacheTime = Date.now();
    } catch (e) {
      this._imageCache = [];
      this._cacheTime  = Date.now();
    }
  }

  getRandomMenuImage() {
    if (!this._imageCache || Date.now() - (this._cacheTime || 0) > 60_000) {
      this._refreshCache();
    }
    if (!this._imageCache.length) return null;
    return this._imageCache[Math.floor(Math.random() * this._imageCache.length)];
  }

  async _send(chatJid, text, sock, message) {
    const imgPath = this.getRandomMenuImage();
    if (imgPath) {
      try {
        const imageBuffer = fs.readFileSync(imgPath);
        const ext         = path.extname(imgPath).toLowerCase();
        const mimetype    = IMAGE_MIMES[ext] || 'image/jpeg';
        await sock.sendMessage(chatJid, { image: imageBuffer, caption: text, mimetype }, { quoted: message });
        return;
      } catch (e) {
        console.error('[Menu] Image send failed:', e.message);
      }
    }
    await sock.sendMessage(chatJid, { text }, { quoted: message });
  }

  async execute(args, sender, chatJid, sock, message) {
    const sub = (args[0] || '').toLowerCase();

    // ── Sub-menu routing ──────────────────────────────────────────────────
    if (sub === 'crime'   || sub === 'crimemenu')   return this._crimemenu(chatJid, sock, message);
    if (sub === 'pvp'     || sub === 'pvpmenu')     return this._pvpmenu(chatJid, sock, message);
    if (sub === 'money'   || sub === 'moneymenu')   return this._moneymenu(chatJid, sock, message);
    if (sub === 'utility' || sub === 'utilitymenu') return this._utilitymenu(chatJid, sock, message);
    if (sub === 'dl' || sub === 'dlmenu' || sub === 'downloader') return this._dlmenu(chatJid, sock, message);
    if (sub === 'prop'    || sub === 'propmenu')    return this._propmenu(chatJid, sock, message);
    if (sub === 'social'  || sub === 'socialmenu')  return this._socialmenu(chatJid, sock, message);

    // ── Main menu ─────────────────────────────────────────────────────────
    const player = this.db.getPlayer(sender);
    const xp     = player.experience || 0;

    const xpForLevel = (l) => l * (l + 1) / 2 * 100;
    let level = 0;
    while (xpForLevel(level + 1) <= xp) level++;

    this.db.updatePlayerRole(sender);
    const p = this.db.getPlayer(sender);

    const cash      = p.cash  || 0;
    const bank      = p.bank  || 0;
    const cryptoBal = p.cryptoBalance || 0;
    const networth  = cash + bank
      + (p.vehicles   || []).reduce((s, v) => s + (v.price || 0), 0)
      + (p.businesses || []).reduce((s, b) => s + (b.price || 0), 0);

    const displayName = p.nickname || p.name || sender.split('@')[0];
    const fmt = (n) => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n}`;
    const lvlCap = level >= 50 ? ' 👑MAX' : `/${Math.round((level+1)*(level+2)/2*100 - xp)} XP to next`;

    // Count online players (seen in last 10 min via botStats is unavailable here, so use db)
    const allPlayers   = Object.values(this.db.data.players || {});
    const activePlayers = allPlayers.length;

    const menuText = [
      `🏙️ *STREET EMPIRE RP*  v7`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `👤 *${displayName}*`,
      `🎖️ Rank: ${p.role}   •   📊 Lv.${level}${lvlCap}`,
      `⭐ ${xp.toLocaleString()} XP   •   🏅 ${p.reputation || 0} Rep`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💵 Cash:   ${fmt(cash)}`,
      `🏦 Bank:   ${fmt(bank)}`,
      `💹 Crypto: ${fmt(cryptoBal)}`,
      `💎 Worth:  ${fmt(networth)}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📂 *BROWSE MENUS*`,
      ``,
      `💰 .moneymenu   — Money & Grind`,
      `🔫 .crimemenu   — Crime & Hustle`,
      `🏠 .propmenu    — Property & Assets`,
      `⚔️ .pvpmenu     — PvP & Battles`,
      `👥 .socialmenu  — Crew & Social`,
      `🛠️ .utilitymenu — Tools & Info`,
      `📥 .dlmenu      — Downloader`,
      ``,
      `📖 .help [topic] for detailed guides`,
    ].join('\n');

    await this._send(chatJid, menuText, sock, message);
  }

  async _moneymenu(chatJid, sock, message) {
    const text = [
      `💰 *MONEY & GRIND MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `🎯 .heist            — Solo/crew heists`,
      `🏢 .business         — Buy & manage businesses`,
      `🏢 .business collect — Collect income`,
      `🎰 .gamble [amount]  — Casino games`,
      `🏁 .race [bet]       — Solo & PvP racing`,
      `💹 .crypto           — Meme coin trading`,
      `💹 .crypto buy/sell  — Trade coins`,
      `🎁 .daily            — Claim daily reward`,
      `🏦 .bank             — Deposit/Withdraw/Transfer`,
      `🏦 .bank history     — Transaction history`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📖 .help crypto • .help heist`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _crimemenu(chatJid, sock, message) {
    const text = [
      `🔫 *CRIME MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `🔫 .rob @player      — Rob a player (cash)`,
      `🏚️ .raid @player     — Raid a player's house`,
      `🔫 .guns             — Browse & buy weapons`,
      `🔫 .guns equip [id]  — Equip a weapon`,
      `💎 .val              — Trade gold/diamonds/gems`,
      `💎 .val sell [item]  — Sell valuables`,
      `🚔 .police report    — Report a robber/raider`,
      `🔒 .police           — Prison & bribe status`,
      `🏥 .hospital         — Treat injuries`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📖 .help guns • .help raid • .help val`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _propmenu(chatJid, sock, message) {
    const text = [
      `🏠 *PROPERTY MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `🏠 .house              — Buy or rent a home`,
      `🏠 .house vault        — Store valuables safely`,
      `🏠 .house garage       — Store cars in garage`,
      `🏠 .house sec hire     — Hire security guards`,
      `🚗 .vehicle            — Browse vehicles`,
      `🚗 .vehicle buy [id]   — Buy a vehicle`,
      `🚗 .vehicle equip [id] — Equip for racing`,
      `🚗 .vehicle upgrade    — Tune your vehicle`,
      `🎒 .inventory          — Your items & valuables`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📖 .help house • .help val`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _pvpmenu(chatJid, sock, message) {
    const text = [
      `⚔️ *PvP & BATTLES MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `🥊 .box @player [bet]   — Challenge to boxing`,
      `🎮 .ttt @player [bet]   — Tic-Tac-Toe match`,
      `🏁 .race @player [bet]  — 1v1 street race`,
      `🏆 .tournament          — Race tournament`,
      `⚔️ .crew war [crew]     — Declare crew war`,
      `🔫 .rob @player         — Rob a player`,
      `🏚️ .raid @player        — Raid a house`,
      ``,
      `💡 *Accepting invites:*`,
      `   Reply *1* to accept  |  *2* to decline`,
      `   (Must reply in group chat)`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _socialmenu(chatJid, sock, message) {
    const text = [
      `👥 *SOCIAL MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `👥 .crew create [name]  — Start a gang ($50K)`,
      `👥 .crew invite @p      — Invite a player`,
      `👥 .crew info           — Your crew details`,
      `👥 .crew members        — Member list`,
      `👥 .crew kick @p        — Remove a member`,
      `👥 .crew promote @p     — Set asst. leader`,
      `👥 .crew war [crew]     — Declare war`,
      `👥 .crew rename [new]   — Rename ($100K)`,
      `👥 .crew slang [text]   — Set crew slang ($25K)`,
      `👥 .crew leave          — Leave your crew`,
      `🏆 .lb [page]           — Player leaderboard`,
      `🏆 .lb race             — Race leaderboard`,
      `👥 .crew lb             — Crew leaderboard`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _utilitymenu(chatJid, sock, message) {
    const text = [
      `🛠️ *UTILITY MENU*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `━━ 🎮 GENERAL ━━━━━━━━━━━━━━`,
      `👤 .profile          — Full player stats`,
      `📊 .stats            — Health, heat, charisma`,
      `⏱️ .cooldown         — All active cooldowns`,
      `📛 .name [nick]      — Set your display name`,
      `📖 .help             — Full command guide`,
      `⏱️ .uptime           — Bot status & version`,
      `🏆 .lb               — Leaderboard`,
      `🏓 .ping             — Bot latency & memory`,
      ``,
      `━━ 🎨 MEDIA ━━━━━━━━━━━━━━━━`,
      `🖼️ .s / .sticker     — Image/GIF → sticker`,
      `🔓 .vv               — Unlock view-once media`,
      ``,
      `━━ 👥 GROUP (ADMIN) ━━━━━━━━`,
      `📋 .gcbio            — Show group bio`,
      `✏️ .setgcbio [text]  — Set group bio`,
      `🏷️ .gcname [text]    — Rename group`,
      `🔒 .lockgc           — Lock group`,
      `🔓 .opengc           — Open group`,
      `📣 .online           — Tag all members`,
      ``,
      `━━ 👮 MODERATION (ADMIN) ━━━`,
      `⬆️ .promote @member  — Promote to admin`,
      `⬇️ .demote @member   — Demote admin`,
      `👢 .kick @member     — Remove from group`,
      `🗑️ .del              — Delete replied msg`,
      `⚠️ .warn @member     — Warn (3 = kick)`,
      `✅ .resetwarn @member — Clear member warns`,
      `🧹 .resetallwarns    — Clear all group warns`,
      `👁️ .warnings @member — Check warn count`,
      `🔗 .antilink warn    — Auto-delete links + warn`,
      `🔗 .antilink kick    — Auto-delete links + kick`,
      `🔗 .antilink off     — Disable antilink`,
      ``,
      `━━ 🤖 BOT OWNER ONLY ━━━━━━`,
      `🟢 .alwaysonline on/off   — Stay online 24/7`,
      `👁️ .autoviewstatus on/off — Auto-view statuses`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }

  async _dlmenu(chatJid, sock, message) {
    const text = [
      `╔══════════════════════════╗`,
      `║  📥  DOWNLOADER`,
      `╚══════════════════════════╝`,
      ``,
      `━━ 🎬 VIDEO ━━━━━━━━━━━━━━━━`,
      `*.dl [url]*          — auto-detect & download`,
      `*.dl yt [url]*       — YouTube video (720p)`,
      `*.dl tt [url]*       — TikTok (no watermark)`,
      `*.dl tw [url]*       — Twitter/X video`,
      ``,
      `━━ 🎵 AUDIO ━━━━━━━━━━━━━━━━`,
      `*.dl yta [url]*      — YouTube audio (MP3)`,
      ``,
      `━━ ℹ️ INFO ━━━━━━━━━━━━━━━━━`,
      `*.dl info [url]*     — Title, duration & size`,
      ``,
      `⚠️ *Limits*`,
      `📹 Max video: 62MB`,
      `🎵 Max audio: 15MB`,
      `⏱️ May take 10–60 seconds`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `No API key needed — powered by yt-dlp`,
      `🏠 .menu — Back to main menu`,
    ].join('\n');
    await this._send(chatJid, text, sock, message);
  }
}

module.exports = MenuCommand;
