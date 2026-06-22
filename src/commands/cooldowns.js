// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — COOLDOWN VIEWER  v2.0 (Fixed)
//  Shows ALL active cooldowns for the player, not just some
// ═══════════════════════════════════════════════════════════════

// Friendly names for all known cooldown keys
const COOLDOWN_LABELS = {
  // Heists
  heist_solo_store_robbery:   '🏪 Heist: Store Robbery',
  heist_solo_atm_heist:       '🏧 Heist: ATM Heist',
  heist_solo_bank_vault:      '🏦 Heist: Bank Vault',
  heist_solo_jewelry_store:   '💎 Heist: Jewelry Store',
  heist_solo_casino_heist:    '🎰 Heist: Casino Heist',
  heist_solo_money_heist:     '💰 Heist: Money Heist',
  heist_group:                '👥 Crew Heist',
  // Racing
  race_npc:                   '🏁 NPC Race',
  race_pvp:                   '🏎️ PvP Race',
  // Crime
  rob:                        '🔫 Robbery',
  raid:                       '🏚️ House Raid',
  boxing:                     '🥊 Boxing',
  // Business
  business_collect:           '🏢 Business Collection',
  // Social
  money_request:              '💸 Money Request',
  daily:                      '🎁 Daily Reward',
  // Police
  police_report:              '🚔 Police Report',
  // Crypto
  crypto_daily:               '💹 Crypto Daily Limit',
};

function formatTime(seconds) {
  if (seconds <= 0) return 'Ready!';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

class CooldownCommand {
  constructor(db) { this.db = db; }

  async execute(args, sender, chatJid, sock, message) {
    const p = this.db.getPlayer(sender);
    const now = Date.now();
    const cooldowns = p.cooldowns || {};

    // Collect all active cooldowns
    const active = [];
    const expired = [];

    for (const [key, expiresAt] of Object.entries(cooldowns)) {
      const remaining = Math.ceil((expiresAt - now) / 1000);
      if (remaining > 0) {
        const label = COOLDOWN_LABELS[key] || `⏱️ ${key.replace(/_/g, ' ')}`;
        active.push({ label, key, remaining });
      } else {
        expired.push(key);
      }
    }

    // Clean expired from DB
    if (expired.length > 0) {
      expired.forEach(k => delete p.cooldowns[k]);
      this.db.updatePlayer(sender, p);
    }

    // Sort by soonest ready first
    active.sort((a, b) => a.remaining - b.remaining);

    const lines = [
      `⏱️ *YOUR COOLDOWNS*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
    ];

    if (active.length === 0) {
      lines.push(`✅ All actions are ready! No active cooldowns.`);
    } else {
      lines.push(`*${active.length} active cooldown${active.length > 1 ? 's' : ''}:*`);
      lines.push(``);
      active.forEach(cd => {
        lines.push(`${cd.label}`);
        lines.push(`   ⏰ Ready in: *${formatTime(cd.remaining)}*`);
      });
    }

    // Also check prison status
    if (p.prison && p.prison.until > now) {
      const prisonSecs = Math.ceil((p.prison.until - now) / 1000);
      lines.push(``);
      lines.push(`🔒 *PRISON:* ${formatTime(prisonSecs)} remaining`);
    }

    lines.push(``);
    lines.push(`*All commands reset at their natural time.*`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }
}

module.exports = CooldownCommand;
