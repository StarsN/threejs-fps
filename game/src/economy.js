// Money and the buy menu: what a round pays, what a weapon costs, and who
// owns what. The menu is data only; hud.js renders it and main.js applies it.
import { WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';

export const ROUND_WIN = 3250;
export const ROUND_LOSS = 1400;
export const KILL_PAY = 300;
export const PLANT_PAY = 300;
export const START_MONEY = 800;

export function createEconomy() {
  const state = {
    money: START_MONEY,
    owned: new Set(['sidearm']),
    grenades: 0,
    kills: 0,
  };

  function describe() {
    const items = [];
    for (const id of BUY_ORDER) {
      if (id === 'grenade') {
        items.push({
          id,
          key: '6',
          name: GRENADE.name,
          price: GRENADE.price,
          owned: state.grenades > 0,
          hint: state.grenades > 0 ? 'Owned' : 'One per round',
        });
        continue;
      }
      const def = WEAPONS[id];
      items.push({
        id,
        key: String(BUY_ORDER.indexOf(id) + 1),
        name: def.name,
        price: def.price,
        owned: state.owned.has(id),
        hint: `${def.damage} dmg · ${def.mag} rounds`,
      });
    }
    return items;
  }

  return {
    state,
    describe,
    canAfford(price) {
      return state.money >= price;
    },
    buy(id) {
      if (id === 'grenade') {
        if (state.grenades > 0 || state.money < GRENADE.price) return null;
        state.money -= GRENADE.price;
        state.grenades = 1;
        return GRENADE;
      }
      const def = WEAPONS[id];
      if (!def || state.owned.has(id) || state.money < def.price) return null;
      state.money -= def.price;
      state.owned.add(id);
      return def;
    },
    roundEnd(won, planted) {
      state.money += won ? ROUND_WIN : ROUND_LOSS;
      if (planted) state.money += PLANT_PAY;
      state.grenades = 0;
    },
    kill() {
      state.money += KILL_PAY;
      state.kills += 1;
    },
    reset() {
      state.money = START_MONEY;
      state.owned = new Set(['sidearm']);
      state.grenades = 0;
      state.kills = 0;
    },
  };
}
