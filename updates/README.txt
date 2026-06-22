╔══════════════════════════════════════════════════════════════╗
║         STREET EMPIRE — HOT-RELOAD UPDATES FOLDER           ║
╚══════════════════════════════════════════════════════════════╝

HOW TO UPDATE THE BOT WITHOUT RESTARTING
─────────────────────────────────────────

1. Drop your updated .js file(s) into this folder
   Example: drop a new boxing.js here

2. In any WhatsApp group or DM, type:
      .update

3. The bot will:
   ✅ Syntax-check the new file
   ✅ Replace the live file
   ✅ Reload it in memory instantly
   ✅ Delete it from /updates/ (so it doesn't re-apply)
   ✅ Report back exactly what was updated

4. If the new file has a syntax error:
   ❌ The OLD version stays active (automatic rollback)
   ❌ You'll see the error message in chat

SUPPORTED FILES
────────────────
Any file inside /src/commands/ can be hot-reloaded:
  banking.js, boxing.js, business.js, cooldowns.js,
  crew.js, crypto.js, daily.js, gambling.js, guns.js,
  gym.js, heists.js, help.js, hospital.js, housing.js,
  inventory.js, leaderboard.js, menu.js, ping.js,
  police.js, profile.js, racing.js, raid.js, rob.js,
  stats.js, tictactoe.js, uptime.js, username.js,
  valuables.js, vehicles.js

WHAT CANNOT BE HOT-RELOADED (requires bot restart):
  index.js         — WhatsApp socket lives here
  database.js      — DB class instantiated at startup
  commandHandler.js — Core routing layer

NOTES
──────
• Multiple files can be updated at once — drop them all in
  and run .update once
• Each updated file gets a .bak backup in /src/commands/
  in case you need to manually roll back
• This folder is gitignored — updates here won't pollute
  your repo
