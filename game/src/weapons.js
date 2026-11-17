// The armoury: five buyable tools and their numbers. A weapon owns its view
// model, its magazine, its reload and its spread; main.js owns the ray and
// the damage. Spread grows with movement speed and falls when crouched, so
// stopping to aim pays. Damage is per shot except the shotgun, which fires
// pellets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'Pigeon-9', kind: 'sidearm', price: 0,
    damage: 26, headMult: 3, mag: 12, reserve: 36, gap: 0.16, reload: 1.4,
    spreadStill: 0.0028, spreadMove: 0.02, pellets: 1, auto: false, kick: 0.008,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', kind: 'smg', price: 1500,
    damage: 24, headMult: 3, mag: 30, reserve: 120, gap: 0.085, reload: 1.8,
    spreadStill: 0.005, spreadMove: 0.032, pellets: 1, auto: true, kick: 0.007,
  },
  rifle: {
    id: 'rifle', name: 'Longbow-7', kind: 'rifle', price: 2700,
    damage: 34, headMult: 3, mag: 25, reserve: 75, gap: 0.11, reload: 2.1,
    spreadStill: 0.0018, spreadMove: 0.03, pellets: 1, auto: true, kick: 0.011,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', kind: 'shotgun', price: 1700,
    damage: 11, headMult: 3, mag: 6, reserve: 24, gap: 0.9, reload: 2.6,
    spreadStill: 0.045, spreadMove: 0.05, pellets: 8, auto: false, kick: 0.03,
  },
  sniper: {
    id: 'sniper', name: 'Needle-50', kind: 'sniper', price: 4200,
    damage: 95, headMult: 2, mag: 5, reserve: 15, gap: 1.4, reload: 3.0,
    spreadStill: 0.0004, spreadMove: 0.06, pellets: 1, auto: false, kick: 0.04,
  },
};

export const GRENADE = { id: 'grenade', name: 'Popper HE', price: 300 };

export const BUY_ORDER = ['sidearm', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'];

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.6, metalness: 0.4 });
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (def.kind === 'sidearm') {
    part(0.05, 0.09, 0.2, 0, 0, -0.1, body);
    part(0.045, 0.12, 0.06, 0, -0.08, 0.02, grip);
  } else if (def.kind === 'smg') {
    part(0.07, 0.09, 0.34, 0, 0, -0.12, body);
    part(0.04, 0.04, 0.3, 0, 0.02, -0.34, grip);
    part(0.05, 0.14, 0.07, 0, -0.09, 0.02, grip);
  } else if (def.kind === 'rifle') {
    part(0.08, 0.1, 0.46, 0, 0, -0.14, body);
    part(0.045, 0.045, 0.42, 0, 0.025, -0.4, dark);
    part(0.07, 0.08, 0.2, 0, -0.02, 0.3, grip);
    part(0.05, 0.05, 0.12, 0, -0.07, -0.12, grip);
  } else if (def.kind === 'shotgun') {
    part(0.09, 0.11, 0.5, 0, 0, -0.14, dark);
    part(0.06, 0.06, 0.44, 0, -0.045, -0.16, grip);
    part(0.08, 0.09, 0.22, 0, -0.02, 0.28, grip);
  } else {
    part(0.07, 0.09, 0.62, 0, 0, -0.2, body);
    part(0.05, 0.05, 0.34, 0, 0.03, -0.5, dark);
    part(0.05, 0.07, 0.14, 0, 0.08, -0.12, dark);
    part(0.07, 0.08, 0.2, 0, -0.02, 0.3, grip);
  }
  return model;
}

export function createWeaponRig(camera) {
  // Muzzle flash: two crossed planes read as a starburst, not a flat square.
  const flashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashCross = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), flashMat);
  flashCross.position.copy(flash.position);
  flashCross.rotation.z = Math.PI / 4;
  flashCross.visible = false;
  camera.add(flashCross);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const state = {
    id: 'sidearm',
    mag: WEAPONS.sidearm.mag,
    reserve: WEAPONS.sidearm.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
  };

  function equip(id) {
    for (const key of Object.keys(models)) models[key].visible = key === id;
    const def = WEAPONS[id];
    state.id = id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
  }
  equip('sidearm');

  function step(dt) {
    const def = WEAPONS[state.id];
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.id];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashCross.visible = state.flash > 0;
    flashCross.rotation.z = Math.PI / 4 + state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    models,
    step,
    equip,
    def() {
      return WEAPONS[state.id];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.id].gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    spread(speed, crouched) {
      const def = WEAPONS[state.id];
      const move = Math.min(1, speed / 5.2) * def.spreadMove;
      return (def.spreadStill + move) * (crouched ? 0.6 : 1);
    },
    refillAmmo() {
      const def = WEAPONS[state.id];
      state.mag = def.mag;
      state.reserve = def.reserve;
    },
  };
}
