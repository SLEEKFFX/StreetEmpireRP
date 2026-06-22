'use strict';

const fs   = require('fs');
const path = require('path');

// The /updates/ folder sits at the project root
const UPDATES_DIR  = path.join(__dirname, '..', '..', 'updates');
// Where command files actually live (for correct relative requires)
const COMMANDS_DIR = path.join(__dirname);

// ── Legacy fallback map ───────────────────────────────────────────────────
// Only used for files that do NOT export `module.exports.commands`.
// New files should self-describe via module.exports.commands instead —
// see the dynamic loader pattern documented in commandHandler.js.
const FILE_TO_KEYS = {
  'banking.js':       ['bank'],
  'boxing.js':        ['box', 'boxing'],
  'business.js':      ['business'],
  'cooldowns.js':     ['cooldown', 'cd'],
  'crew.js':          ['crew'],
  'crypto.js':        ['crypto', 'c'],
  'daily.js':         ['daily'],
  'gambling.js':      ['gamble'],
  'guns.js':          ['guns', 'g'],
  'gym.js':           ['gym'],
  'gymTournament.js': ['tournament'],
  'heists.js':        ['heist'],
  'help.js':          ['help'],
  'hospital.js':      ['hospital', 'hosp'],
  'housing.js':       ['house', 'h'],
  'inventory.js':     ['inventory'],
  'leaderboard.js':   ['leaderboard', 'lb'],
  'menu.js':          ['menu'],
  'ping.js':          ['ping'],
  'police.js':        ['police', 'cop'],
  'profile.js':       ['profile'],
  'racing.js':        ['race'],
  'raid.js':          ['raid'],
  'rob.js':           ['rob'],
  'stats.js':         ['stats'],
  'tictactoe.js':     ['ttt', 'tictactoe'],
  'uptime.js':        ['uptime'],
  'username.js':      ['name'],
  'valuables.js':     ['val'],
  'vehicles.js':      ['vehicle'],
  'utility.js':       ['utility', 's', 'sticker', 'gcbio', 'setgcbio', 'online', 'promote', 'demote', 'gcname', 'lockgc', 'opengc', 'warn', 'kick', 'del', 'antilink', 'vv', 'utilitymenu', 'alwaysonline', 'autoviewstatus'],
};

class UpdateCommand {
  constructor(db, commandHandler) {
    this.db             = db;
    this.commandHandler = commandHandler; // full CommandHandler instance
  }

  async execute(args, sender, chatJid, sock, message) {
    if (!fs.existsSync(UPDATES_DIR)) {
      fs.mkdirSync(UPDATES_DIR, { recursive: true });
      await sock.sendMessage(chatJid, {
        text: `📁 Created */updates/* folder — it's empty.\n\nDrop updated .js files in there and run *.update* again.`
      }, { quoted: message });
      return;
    }

    const files = fs.readdirSync(UPDATES_DIR).filter(f => f.endsWith('.js'));
    if (files.length === 0) {
      await sock.sendMessage(chatJid, {
        text: `📂 */updates/* folder is empty.\n\nDrop updated command files in there and run *.update* again.`
      }, { quoted: message });
      return;
    }

    const results = [];
    const errors  = [];

    for (const filename of files) {
      const updatePath = path.join(UPDATES_DIR, filename);
      const targetPath = path.join(COMMANDS_DIR, filename);
      const isNewFile  = !fs.existsSync(targetPath);

      // ── Copy the update file into /src/commands/ FIRST ────────────────────
      // This ensures all relative require() calls inside the file
      // (e.g. '../utils/resolveMention') resolve from the correct directory.
      const hadExisting = fs.existsSync(targetPath);
      if (hadExisting) {
        try { fs.copyFileSync(targetPath, targetPath + '.bak'); } catch {}
      }

      try {
        fs.copyFileSync(updatePath, targetPath);
      } catch (err) {
        errors.push(`❌ *${filename}* — could not copy: ${err.message}`);
        continue;
      }

      // Require from its real home so relative paths work
      let NewModule;
      try {
        delete require.cache[require.resolve(targetPath)];
        NewModule = require(targetPath);
      } catch (err) {
        // Restore backup on failure (or delete if it's a brand new file)
        try {
          if (hadExisting) fs.copyFileSync(targetPath + '.bak', targetPath);
          else fs.unlinkSync(targetPath);
        } catch {}
        errors.push(`❌ *${filename}* — error: ${err.message}`);
        continue;
      }

      // ── Determine which command keys this file provides ───────────────────
      // 1. Preferred: module.exports.commands = { cmdName: 'methodName', ... }
      // 2. Fallback: hardcoded FILE_TO_KEYS map (legacy files)
      let cmdMap = NewModule?.commands;
      let usedDynamic = !!cmdMap && typeof cmdMap === 'object';

      let Cls = null;
      if (typeof NewModule === 'function') Cls = NewModule;
      else if (typeof NewModule === 'object') Cls = Object.values(NewModule).find(v => typeof v === 'function');

      try {
        let instance = null;
        if (Cls) {
          try { instance = new Cls(this.db); } catch {}
        }

        const registeredKeys = [];

        if (usedDynamic && instance) {
          // Dynamic registration — file self-describes its commands
          for (const [cmdKey, methodName] of Object.entries(cmdMap)) {
            const key    = cmdKey.toLowerCase();
            const method = instance[methodName];
            if (typeof method !== 'function') {
              errors.push(`❌ *${filename}* — method '${methodName}' not found for .${key}`);
              continue;
            }
            this.commandHandler.commands[key] = {
              execute: (...callArgs) => method.apply(instance, callArgs),
            };
            registeredKeys.push(key);
          }
        } else if (instance) {
          // Legacy registration via FILE_TO_KEYS
          const keys = FILE_TO_KEYS[filename] || [];
          keys.forEach(k => {
            this.commandHandler.commands[k] = instance;
            registeredKeys.push(k);
          });
        }

        fs.unlinkSync(updatePath);

        if (registeredKeys.length > 0) {
          results.push(`✅ *${filename}*  →  ${registeredKeys.map(k => '.' + k).join(', ')}`);
        } else if (isNewFile) {
          results.push(`✅ *${filename}* — loaded (no commands registered; add module.exports.commands)`);
        } else {
          results.push(`✅ *${filename}* — file updated (no command keys found)`);
        }

      } catch (err) {
        // Rollback
        try {
          if (hadExisting) {
            fs.copyFileSync(targetPath + '.bak', targetPath);
            delete require.cache[require.resolve(targetPath)];
            require(targetPath);
          } else {
            fs.unlinkSync(targetPath);
          }
        } catch {}
        errors.push(`❌ *${filename}* — reload failed (rolled back): ${err.message}`);
      }
    }

    const lines = [`🔄 *HOT-RELOAD COMPLETE*`, ``];
    if (results.length > 0) {
      lines.push(`*✅ Updated (${results.length} file${results.length > 1 ? 's' : ''}):*`);
      results.forEach(r => lines.push(`  ${r}`));
    }
    if (errors.length > 0) {
      lines.push(``, `*❌ Failed (${errors.length} file${errors.length > 1 ? 's' : ''}):*`);
      errors.forEach(e => lines.push(`  ${e}`));
    }
    if (results.length > 0) lines.push(``, `⚡ Changes are live — no restart needed!`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }
}

module.exports = UpdateCommand;
