// Pure logic (no DOM, no network) so it is easy to test and update.
const Calc = {
  norm: (s) => String(s || '').toLowerCase().replace(/[\s_-]/g, ''),

  // Bonus % for n copies of one resource: 5 + 0.5 + 0.25 * (n - 2) ...
  copyBonus(n) {
    const [a, b, c] = CFG.SR_BONUS;
    return n <= 0 ? 0 : n === 1 ? a : a + b + (n - 2) * c;
  },

  // regions: array of region objects. Returns per-resource breakdown and total.
  srBonus(regions) {
    const count = {};
    regions.forEach((r) => { const k = Calc.norm(r.strategicResource); if (k) count[k] = (count[k] || 0) + 1; });
    const per = {}; let total = 0;
    Object.keys(count).forEach((k) => { per[k] = { count: count[k], pct: Calc.copyBonus(count[k]) }; total += per[k].pct; });
    return { per, total };
  },

  // ethics: object like { industrialism: 2, militarism: 0, ... }
  ethicEffects(ethics) {
    let srBonus = 0, devCooldownH = CFG.DEV_COOLDOWN_H; const used = [];
    Object.entries(ethics || {}).forEach(([axis, level]) => {
      const e = CFG.ETHICS[axis]?.[level]; if (!e) return;
      used.push(e.label || `${axis} ${level}`); srBonus += e.srBonus || 0;
      if (e.devCooldownH != null) devCooldownH = Math.min(devCooldownH, e.devCooldownH);
    });
    return { srBonus, devCooldownH, used };
  },

  // Region can be claimed if it borders an owned or already planned region.
  claimable(region, ownedIds, plannedIds) {
    return (region.neighbors || []).some((n) => ownedIds.has(n) || plannedIds.has(n));
  },

  // Drop planned regions that are no longer connected to owned territory.
  prune(planned, ownedIds, byId) {
    const ok = new Set(); let grew = true;
    while (grew) {
      grew = false;
      planned.forEach((id) => {
        if (ok.has(id)) return;
        if ((byId[id].neighbors || []).some((n) => ownedIds.has(n) || ok.has(n))) { ok.add(id); grew = true; }
      });
    }
    return ok;
  },

  msLeft: (iso) => (iso ? new Date(iso) - Date.now() : 0),
  fmt(ms) {
    if (ms <= 0) return 'ready';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
  },
};
