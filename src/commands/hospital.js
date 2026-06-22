// ═══════════════════════════════════════════════════════════════
//  STREET EMPIRE — HOSPITAL  v1.0
//  Players visit hospital to heal injuries
//  Boxing losses send players here with injuries
// ═══════════════════════════════════════════════════════════════

const BankingCommand = require('./banking');

const INJURIES = {
  broken_rib:    { label: '🩻 Broken Rib',     healCost: 8000,  healTime: 10, hpPenalty: 30 },
  black_eye:     { label: '👁️ Black Eye',      healCost: 2000,  healTime: 3,  hpPenalty: 10 },
  broken_nose:   { label: '👃 Broken Nose',    healCost: 3500,  healTime: 5,  hpPenalty: 15 },
  concussion:    { label: '🧠 Concussion',     healCost: 12000, healTime: 20, hpPenalty: 40 },
  sprained_wrist:{ label: '🤝 Sprained Wrist',healCost: 4000,  healTime: 8,  hpPenalty: 20 },
  bruised_ribs:  { label: '🩹 Bruised Ribs',  healCost: 5000,  healTime: 6,  hpPenalty: 20 },
  puffy_face:    { label: '🤕 Puffy Face',     healCost: 1500,  healTime: 2,  hpPenalty: 5  },
  dislocated_jaw:{ label: '😮 Dislocated Jaw', healCost: 7000,  healTime: 12, hpPenalty: 25 },
};

const FOOD_ITEMS = {
  snack:     { label: '🍫 Snack Bar',     cost: 500,    healHp: 10, desc: 'Quick sugar boost' },
  sandwich:  { label: '🥪 Sandwich',      cost: 1500,   healHp: 25, desc: 'Decent recovery meal' },
  meal:      { label: '🍱 Full Meal',     cost: 4000,   healHp: 50, desc: 'Hot hospital meal' },
  smoothie:  { label: '🥤 Green Smoothie',cost: 3000,   healHp: 40, desc: 'Vitamin boost' },
  steak:     { label: '🥩 Premium Steak', cost: 12000,  healHp: 100, desc: 'Full recovery meal' },
};

class HospitalCommand {
  constructor(db) { this.db = db; }

  ensureHealth(p) {
    if (p.health === undefined || p.health === null) p.health = 100;
    if (!p.injuries) p.injuries = [];
    if (p.health > 100) p.health = 100;
    if (p.health < 0)   p.health = 0;
  }

  async execute(args, sender, chatJid, sock, message) {
    const p   = this.db.getPlayer(sender);
    this.ensureHealth(p);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'menu' || sub === 'visit') return this.showHospital(p, sender, chatJid, sock, message);
    if (sub === 'treat' || sub === 'heal') return this.treatInjury(args[1], p, sender, chatJid, sock, message);
    if (sub === 'food' || sub === 'eat')   return this.buyFood(args[1], p, sender, chatJid, sock, message);
    if (sub === 'status')                  return this.showStatus(p, sender, chatJid, sock, message);

    return this.showHospital(p, sender, chatJid, sock, message);
  }

  async showHospital(p, sender, chatJid, sock, message) {
    this.ensureHealth(p);
    const injuries = p.injuries || [];
    const lines = [
      `🏥 *S.E GENERAL HOSPITAL*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `❤️ Health: ${p.health}/100 HP  ${this._hpBar(p.health)}`,
      ``,
    ];

    if (injuries.length > 0) {
      lines.push(`🩺 *Active Injuries:*`);
      injuries.forEach((inj, i) => {
        const def = INJURIES[inj.type];
        if (!def) return;
        lines.push(`  ${i+1}. ${def.label}  — Treat: $${def.healCost.toLocaleString()}`);
      });
      lines.push(``);
      lines.push(`💊 *.hospital treat [1-${injuries.length}]* — Pay to treat injury`);
    } else {
      lines.push(`✅ No active injuries`);
    }

    lines.push(``);
    lines.push(`🍔 *Food Shop (restore HP):*`);
    Object.entries(FOOD_ITEMS).forEach(([key, f]) => {
      lines.push(`  .hospital food ${key.padEnd(10)} — ${f.label} (+${f.healHp}HP) $${f.cost.toLocaleString()}`);
    });
    lines.push(``);
    lines.push(`💵 Cash: $${(p.cash||0).toLocaleString()}`);
    lines.push(`📊 *.hospital status* — full health report`);

    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  async showStatus(p, sender, chatJid, sock, message) {
    this.ensureHealth(p);
    const injuries = p.injuries || [];
    const lines = [
      `🏥 *HEALTH STATUS*`,
      `━━━━━━━━━━━━━━━━━━`,
      ``,
      `❤️  HP: ${p.health}/100  ${this._hpBar(p.health)}`,
      `🩺  Injuries: ${injuries.length}`,
      ``,
    ];

    if (injuries.length > 0) {
      lines.push(`*Injuries Detail:*`);
      injuries.forEach((inj, i) => {
        const def = INJURIES[inj.type] || { label: inj.type, healCost: 5000 };
        lines.push(`  ${i+1}. ${def.label}  (sustained ${new Date(inj.timestamp).toLocaleDateString()})`);
      });
    } else {
      lines.push(`✅ You're in perfect health!`);
    }

    lines.push(``);
    lines.push(`💡 Heal at *.hospital* or eat food to restore HP`);
    await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message });
  }

  async treatInjury(numStr, p, sender, chatJid, sock, message) {
    this.ensureHealth(p);
    const injuries = p.injuries || [];
    if (injuries.length === 0) {
      await sock.sendMessage(chatJid, { text: `✅ No injuries to treat! You're healthy.` }, { quoted: message }); return;
    }

    const num = parseInt(numStr);
    if (isNaN(num) || num < 1 || num > injuries.length) {
      await sock.sendMessage(chatJid, { text: `Choose 1–${injuries.length}\n💊 *.hospital treat [number]*` }, { quoted: message }); return;
    }

    const inj  = injuries[num - 1];
    const def  = INJURIES[inj.type];
    if (!def) {
      injuries.splice(num - 1, 1);
      this.db.updatePlayer(sender, p);
      await sock.sendMessage(chatJid, { text: `✅ Injury cleared.` }, { quoted: message }); return;
    }

    if ((p.cash || 0) < def.healCost) {
      await sock.sendMessage(chatJid, { text: `Need $${def.healCost.toLocaleString()} cash!\n💵 You have: $${(p.cash||0).toLocaleString()}` }, { quoted: message }); return;
    }

    p.cash -= def.healCost;
    p.health = Math.min(100, (p.health || 0) + def.hpPenalty);
    injuries.splice(num - 1, 1);
    p.injuries = injuries;
    p.experience = (p.experience || 0) + 5;
    this.db.updatePlayer(sender, p);

    BankingCommand.recordExternal(this.db, sender, {
      type: 'Hospital Bill', amount: def.healCost,
      sender: this.db.getDisplayName(sender), receiver: 'S.E General Hospital',
      note: `Treated: ${def.label}`, balance: p.cash,
    });

    await sock.sendMessage(chatJid, {
      text: [
        `🏥 *TREATMENT COMPLETE!*`,
        ``,
        `💊 Treated: ${def.label}`,
        `❤️  HP restored: +${def.hpPenalty}  (now ${p.health}/100)`,
        `💸 Cost: -$${def.healCost.toLocaleString()}`,
        `💵 Cash: $${p.cash.toLocaleString()}`,
        injuries.length > 0 ? `\n⚠️ ${injuries.length} injury${injuries.length>1?'s':''} remaining` : `\n✅ Fully recovered!`,
      ].join('\n')
    }, { quoted: message });
  }

  async buyFood(item, p, sender, chatJid, sock, message) {
    this.ensureHealth(p);
    if (!item) {
      const lines = [`🍔 *HOSPITAL FOOD SHOP*`, ``];
      Object.entries(FOOD_ITEMS).forEach(([key, f]) => {
        lines.push(`${f.label}\n  +${f.healHp} HP  |  $${f.cost.toLocaleString()}\n  *.hospital food ${key}*\n`);
      });
      await sock.sendMessage(chatJid, { text: lines.join('\n') }, { quoted: message }); return;
    }

    const food = FOOD_ITEMS[item.toLowerCase()];
    if (!food) {
      await sock.sendMessage(chatJid, { text: `❌ Unknown food item.\nOptions: ${Object.keys(FOOD_ITEMS).join(', ')}` }, { quoted: message }); return;
    }

    if (p.health >= 100) {
      await sock.sendMessage(chatJid, { text: `❤️ Already at full HP (100/100)!` }, { quoted: message }); return;
    }

    if ((p.cash || 0) < food.cost) {
      await sock.sendMessage(chatJid, { text: `❌ Need $${food.cost.toLocaleString()} cash!\n💵 You have: $${(p.cash||0).toLocaleString()}` }, { quoted: message }); return;
    }

    const oldHp = p.health;
    p.cash -= food.cost;
    p.health = Math.min(100, (p.health || 0) + food.healHp);
    this.db.updatePlayer(sender, p);

    await sock.sendMessage(chatJid, {
      text: [
        `🍽️ *FOOD PURCHASED!*`,
        ``,
        `${food.label} — ${food.desc}`,
        `❤️  HP: ${oldHp} → ${p.health}/100  (+${p.health - oldHp})`,
        `💸 Cost: -$${food.cost.toLocaleString()}`,
        `💵 Cash: $${p.cash.toLocaleString()}`,
      ].join('\n')
    }, { quoted: message });
  }

  _hpBar(hp) {
    const filled = Math.round((hp / 100) * 10);
    const color  = hp > 60 ? '🟩' : hp > 30 ? '🟨' : '🟥';
    return color.repeat(filled) + '⬛'.repeat(10 - filled);
  }

  // Static method to hospitalize a player after boxing loss
  static admitPlayer(db, playerId, injuryKeys) {
    const p = db.getPlayer(playerId);
    if (!p.injuries) p.injuries = [];
    if (p.health === undefined) p.health = 100;

    injuryKeys.forEach(key => {
      const def = INJURIES[key];
      if (def) {
        p.injuries.push({ type: key, timestamp: Date.now() });
        p.health = Math.max(1, p.health - def.hpPenalty);
      }
    });
    db.updatePlayer(playerId, p);
    return p;
  }
}

module.exports = { HospitalCommand, INJURIES, FOOD_ITEMS };
