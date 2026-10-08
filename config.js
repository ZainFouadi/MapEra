// Central config: edit this file when the game changes (endpoints, bonus rules, ethics).
window.CFG = {
  API: 'https://api2.warera.io/trpc',
  EP: { // endpoint names
    regions: 'region.getRegionsObject', countries: 'country.getAllCountries',
    gov: 'government.getByCountryId', user: 'user.getUserById', party: 'party.getById',
    upgrade: 'upgrade.getUpgradeByTypeAndEntity', map: 'map.getMapData',
  },
  // Bonus % by copy number of the same resource: 1st, 2nd, 3rd and above
  SR_BONUS: [5, 0.5, 0.25],
  RESOURCES: { lithium: '#3b82f6', coal: '#6b7280', diamonds: '#06b6d4', uranium: '#65a30d', rareearths: '#a855f7', gold: '#f59e0b' },
  BUILDINGS: [['bunker', 'Bunker'], ['base', 'Military Base'], ['pacification', 'Pacification']],
  OPERATING_H: 12,      // building takes this long to become active after an upgrade
  DEV_COOLDOWN_H: 8,    // default cooldown between upgrades of a region
  // Party ethics are axes with a level (see party.getById -> ethics: militarism, isolationism,
  // imperialism, industrialism = numbers, unethical = boolean). Fill the effects per axis and level.
  //   srBonus: extra production % on the specialization goods; devCooldownH: replaces DEV_COOLDOWN_H
  ETHICS: {
    industrialism: { 2: { label: 'Fanatic Industrialist', srBonus: 30 } },
    militarism: {},    // TODO e.g. { 2: { label: 'Fanatic Militarist', devCooldownH: 4 } }
    isolationism: {},
    imperialism: {},
  },
};
