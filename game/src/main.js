// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. Rounds, the bomb, the buy menu, the grenades and the
// spectator camera all live here; the modules own their own jobs.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createMap, SITES } from './map.js';
import { createBody, createMover } from './mover.js';
import { createWeaponRig, WEAPONS } from './weapons.js';
import { createSquad } from './bots.js';
import { createBomb, FUSE_SECONDS, BLAST_RADIUS } from './bomb.js';
import { createEconomy } from './economy.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createMatch, WIN_SCORE, MAX_ROUNDS, ROUND_SECONDS, BUY_SECONDS } from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const match = createMatch();
const economy = createEconomy();
const audio = createAudio();
const hud = createHud();
const bomb = createBomb(scene);
const mover = createMover(map.colliders);
const weapon = createWeaponRig(camera);
const sableSquad = createSquad(scene, map, 'sable', random);
const ashenSquad = createSquad(scene, map, 'ashen', random);

const player = {
  name: 'You',
  side: 'sable',
  isPlayer: true,
  body: createBody(0, 15.5, 0),
  health: 100,
  alive: true,
};

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootTargets = map.shootables.concat(
  sableSquad.bots.flatMap((b) => [b.torso, b.head]),
  ashenSquad.bots.flatMap((b) => [b.torso, b.head]),
);

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = new THREE.Vector3();

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let roundEndAt = 0;
let plantProgress = 0;
let spectate = null;
let semiLatch = false;
let buyOpen = false;
let grenadeCount = 0;

const heard = [];
const grenades = [];
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({
  color: new THREE.Color(PALETTE.accent),
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
for (let i = 0; i < 10; i += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, tracerMat.clone());
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIndex = 0;

const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.8, depthWrite: false }),
);
blastMesh.visible = false;
scene.add(blastMesh);
const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 24, 1.5);
scene.add(blastLight);
let blastAge = -1;
const blastAt = new THREE.Vector3();

function drawTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const positions = tracer.line.geometry.attributes.position;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
  tracer.line.visible = true;
  tracer.line.material.opacity = 0.9;
  tracer.life = 0.07;
}

function explodeAt(point, radius, maxDamage, attacker) {
  blastMesh.visible = true;
  blastMesh.position.copy(point);
  blastMesh.scale.setScalar(1);
  blastLight.position.copy(point).setY(1.5);
  blastLight.intensity = 50;
  blastAge = 0;
  audio.explosion();
  const victims = [player, ...sableSquad.bots, ...ashenSquad.bots];
  for (const victim of victims) {
    if (!victim.alive) continue;
    const d = victim.body.position.distanceTo(point);
    if (d > radius) continue;
    const damage = Math.round(maxDamage * (1 - (d / radius) * 0.7));
    damageTarget(victim, damage, attacker, false);
  }
}

function damageTarget(victim, amount, attacker, headshot) {
  if (!victim.alive || match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  victim.health -= amount;
  if (victim.isPlayer) {
    audio.hurt();
    if (attacker && !attacker.isPlayer) {
      _to.subVectors(attacker.body.position, player.body.position);
      const worldAngle = Math.atan2(_to.x, _to.z);
      const relative = worldAngle - player.body.yaw;
      hud.damageFlash((relative * 180) / Math.PI + 180);
    }
    hud.setHealth(victim.health);
  } else if (attacker?.isPlayer) {
    audio.hit();
  }
  if (victim.health > 0) return;
  victim.health = 0;
  victim.alive = false;
  if (victim.isPlayer) {
    spectate = sableSquad.bots.find((b) => b.alive) ?? null;
    hud.banner('You are down', spectate ? `Spectating ${spectate.name}` : 'No teammates left', 2600);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  const killerName = attacker ? attacker.name : 'The yard';
  hud.killfeed(killerName, victim.name, headshot, attacker?.side ?? 'ashen');
  if (attacker?.isPlayer) {
    economy.kill();
    audio.kill();
    hud.setMoney(economy.state.money);
  }
  if (bomb.state.carrier === victim) {
    bomb.drop(victim.body.position.x, victim.body.position.z);
  }
  if (bomb.state.fetchClaimed === victim) bomb.state.fetchClaimed = null;
  checkRoundEnd();
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const sableAlive = (player.alive ? 1 : 0) + sableSquad.aliveCount();
  const ashenAlive = ashenSquad.aliveCount();
  const planted = bomb.state.status === 'planted';
  if (!planted && sableAlive === 0) endRound('ashen', 'Sable team eliminated');
  else if (!planted && ashenAlive === 0) endRound('sable', 'Ashen team eliminated');
  else if (planted && ashenAlive === 0) endRound('sable', 'Charge detonates unopposed');
}

function startMatch() {
  economy.reset();
  match.scoreSable = 0;
  match.scoreAshen = 0;
  match.round = 0;
  match.started = true;
  hud.setMoney(economy.state.money);
  startRound();
}

function startRound() {
  match.round += 1;
  match.phase = 'buy';
  match.buyTimeLeft = BUY_SECONDS;
  match.roundTimeLeft = ROUND_SECONDS;
  match.plantedSite = null;
  match.winner = null;
  match.reason = '';
  roundEndAt = 0;
  plantProgress = 0;
  buyOpen = false;
  hud.hideBuy();
  hud.hideBomb();
  hud.setChannel(null, null);
  grenades.length = 0;
  spectate = null;

  player.body.position.set(0, 0, 15.5);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = 0;
  player.body.pitch = 0;
  player.health = 100;
  player.alive = true;
  hud.setHealth(100);

  sableSquad.reset(['A', 'B', 'A', 'B']);
  ashenSquad.reset();
  bomb.reset(player);
  weapon.equip('sidearm');
  for (const id of economy.state.owned) {
    if (id !== 'sidearm') weapon.equip(id);
  }
  weapon.refillAmmo();
  grenadeCount = economy.state.grenades;
  hud.setGrenades(grenadeCount);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setScore(match.scoreSable, match.scoreAshen);
  hud.setAlive(5, 5);
  hud.setTimer(`BUY ${Math.ceil(match.buyTimeLeft)}`);
  hud.banner(`Round ${match.round}`, 'Buy phase — press B for the armoury', 2400);
}

function endRound(winner, reason) {
  if (match.phase !== 'live') return;
  match.phase = 'roundEnd';
  match.winner = winner;
  match.reason = reason;
  if (winner === 'sable') match.scoreSable += 1;
  else match.scoreAshen += 1;
  economy.roundEnd(winner === 'sable', bomb.state.status === 'planted' || bomb.state.status === 'gone');
  hud.setMoney(economy.state.money);
  hud.setScore(match.scoreSable, match.scoreAshen);
  hud.hideBomb();
  hud.setChannel(null, null);
  if (winner === 'sable') audio.roundWin();
  else audio.roundLose();
  hud.banner(
    winner === 'sable' ? 'Sable takes the round' : 'Ashen takes the round',
    `${reason} · ${match.scoreSable} — ${match.scoreAshen}`,
    3600,
  );
  roundEndAt = elapsed + 4;
}

function endMatch() {
  match.phase = 'matchEnd';
  const winner = match.scoreSable > match.scoreAshen ? 'Sable' : 'Ashen';
  hud.showOverlay('match', `${winner} wins the match ${match.scoreSable} — ${match.scoreAshen}. You earned $${economy.state.money} across the match.`);
  if (document.pointerLockElement) document.exitPointerLock();
}

function aimAt(point) {
  const eye = player.body.position.y + player.body.eye;
  const dx = point.x - player.body.position.x;
  const dy = point.y - eye;
  const dz = point.z - player.body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function syncCamera() {
  if (player.alive) {
    camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
    camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
  } else if (spectate) {
    camera.position.set(spectate.body.position.x, spectate.body.position.y + spectate.body.eye, spectate.body.position.z);
    camera.rotation.set(0, spectate.body.yaw, 0, 'YXZ');
  }
}

function look(dx, dy, sensitivity = 0.0022) {
  player.body.yaw -= dx * sensitivity;
  player.body.pitch = Math.max(-1.45, Math.min(1.45, player.body.pitch - dy * sensitivity));
}

function shoot(spread) {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dry();
    return false;
  }
  camera.getWorldDirection(_dir);
  _dir.x += (random() * 2 - 1) * spread;
  _dir.y += (random() * 2 - 1) * spread;
  _dir.z += (random() * 2 - 1) * spread;
  _dir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, _dir);
  const hits = raycaster.intersectObjects(shootTargets, false);
  let end = null;
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const bot = hit.object.userData.bot;
    if (bot) {
      if (!bot.alive) continue;
      end = hit.point;
      const damage = def.damage * (hit.object.userData.part === 'head' ? def.headMult : 1);
      damageTarget(bot, damage, player, hit.object.userData.part === 'head');
      hud.hitMarker(bot.health <= 0);
      break;
    }
    end = hit.point;
    break;
  }
  if (!end) {
    end = _hit.copy(camera.position).addScaledVector(_dir, 80);
  }
  _muzzle.copy(camera.position).addScaledVector(_dir, 0.5);
  _muzzle.x += 0.2;
  _muzzle.y -= 0.15;
  drawTracer(_muzzle, end);
  weapon.pullTrigger();
  player.body.pitch = Math.min(1.45, player.body.pitch + def.kick);
  player.body.yaw += (random() * 2 - 1) * def.kick * 0.3;
  audio.shot(def.kind, 0);
  heard.push({ x: player.body.position.x, z: player.body.position.z, side: 'sable', time: elapsed });
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function throwGrenade() {
  if (grenadeCount <= 0) return;
  grenadeCount -= 1;
  economy.state.grenades = grenadeCount;
  hud.setGrenades(grenadeCount);
  camera.getWorldDirection(_dir);
  grenades.push({
    position: camera.position.clone().addScaledVector(_dir, 0.6),
    velocity: _dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4, 0)),
    fuse: 2.2,
    bounced: false,
  });
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.velocity.y -= 14 * dt;
    g.position.addScaledVector(g.velocity, dt);
    if (g.position.y < 0.15) {
      g.position.y = 0.15;
      g.velocity.y *= -0.45;
      g.velocity.x *= 0.7;
      g.velocity.z *= 0.7;
      if (!g.bounced) {
        g.bounced = true;
        g.fuse = Math.min(g.fuse, 1.2);
        audio.bounce();
      }
    }
    for (const box of map.colliders) {
      if (g.position.x > box.min.x - 0.1 && g.position.x < box.max.x + 0.1
        && g.position.y > box.min.y - 0.1 && g.position.y < box.max.y + 0.1
        && g.position.z > box.min.z - 0.1 && g.position.z < box.max.z + 0.1) {
        const dxl = g.position.x - (box.min.x - 0.1);
        const dxr = (box.max.x + 0.1) - g.position.x;
        const dzl = g.position.z - (box.min.z - 0.1);
        const dzr = (box.max.z + 0.1) - g.position.z;
        const dyl = g.position.y - (box.min.y - 0.1);
        const dyr = (box.max.y + 0.1) - g.position.y;
        const min = Math.min(dxl, dxr, dzl, dzr, dyl, dyr);
        if (min === dxl || min === dxr) g.velocity.x *= -0.45;
        else if (min === dzl || min === dzr) g.velocity.z *= -0.45;
        else g.velocity.y *= -0.45;
        audio.bounce();
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      grenades.splice(i, 1);
      explodeAt(g.position, 5, 90, player);
    }
  }
}

function playerStep(dt, keys) {
  const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if (forward || strafe) {
    const sin = Math.sin(player.body.yaw);
    const cos = Math.cos(player.body.yaw);
    wishX = -sin * forward + cos * strafe;
    wishZ = -cos * forward - sin * strafe;
    const len = Math.hypot(wishX, wishZ) || 1;
    wishX /= len;
    wishZ /= len;
  }
  const speed = player.body.crouching ? 2.4 : 5.2;
  mover.step(player.body, dt, wishX, wishZ, speed, 42, 9, keys.has('Space'), crouching);
}

// The bot contexts are built once and mutated per step: foes never change, and
// time, speed and the heard list are the only fields that move.
const playerFoe = { ...player, isPlayer: true };
const botBase = {
  rng: random,
  occluders: map.occluders,
  botHitMeshes: shootTargets.slice(map.shootables.length),
  playerSpeed: 0,
  time: 0,
  heard,
  bomb: bomb.state,
  onFire(bot, muzzle, dir, kind) {
    const distance = muzzle.distanceTo(camera.position);
    audio.shot(kind, distance);
    heard.push({ x: bot.body.position.x, z: bot.body.position.z, side: bot.side, time: elapsed });
  },
  onTracer(from, to) {
    drawTracer(from, to);
  },
  onHit(shooter, victim, damage, headshot, point) {
    damageTarget(victim, damage, shooter, headshot);
  },
  onChannel(bot, kind, frac) {
    if (bot.side === 'sable' && kind === 'plant') {
      hud.banner(`${bot.name} is planting the charge`, 'Cover them', 1200);
    }
  },
  onPlantDone(bot) {
    bomb.plant(bot.site, elapsed);
    match.plantedSite = bot.site;
    hud.banner('Charge planted', `Site ${bot.site} — defend it until it blows`, 3000);
    audio.plant();
  },
  onDefuseDone(bot) {
    bomb.state.status = 'gone';
    endRound('ashen', `${bot.name} defused the charge`);
  },
  onBeep(final) {
    audio.beep(final);
  },
  onDetonate(site) {
    explodeAt(bomb.state.position, BLAST_RADIUS, 120, null);
    endRound('sable', `Charge detonated at Site ${site}`);
  },
};
const sableCtx = { ...botBase, foes: ashenSquad.bots };
const ashenCtx = { ...botBase, foes: [...sableSquad.bots, playerFoe] };

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;

  if (match.phase === 'buy') {
    match.buyTimeLeft -= dt;
    hud.setTimer(`BUY ${Math.max(0, Math.ceil(match.buyTimeLeft))}`);
    if (input.wasPressed('KeyB')) {
      buyOpen = !buyOpen;
      if (buyOpen) hud.showBuy(economy.describe());
      else hud.hideBuy();
    }
    if (buyOpen) {
      for (let n = 0; n < 6; n += 1) {
        if (!input.wasPressed(`Digit${n + 1}`)) continue;
        const items = economy.describe();
        const item = items[n];
        if (!item) continue;
        if (item.id === 'grenade') {
          if (economy.buy('grenade')) {
            grenadeCount = 1;
            hud.setGrenades(1);
            audio.buy();
            hud.showBuy(economy.describe());
          } else audio.denied();
        } else if (economy.state.owned.has(item.id)) {
          weapon.equip(item.id);
          weapon.refillAmmo();
          hud.setAmmo(weapon.state.mag, weapon.state.reserve);
          audio.buy();
          hud.showBuy(economy.describe());
        } else if (economy.buy(item.id)) {
          weapon.equip(item.id);
          weapon.refillAmmo();
          hud.setAmmo(weapon.state.mag, weapon.state.reserve);
          audio.buy();
          hud.showBuy(economy.describe());
        } else audio.denied();
      }
    }
    if (match.buyTimeLeft <= 0) {
      match.phase = 'live';
      buyOpen = false;
      hud.hideBuy();
      hud.banner('Go', 'Plant the charge or clear the yard', 1600);
    }
  }

  if (match.phase === 'live') {
    match.roundTimeLeft -= dt;
    if (bomb.state.status === 'planted') {
      hud.setTimer(`0:${String(Math.max(0, Math.ceil(bomb.state.fuseLeft))).padStart(2, '0')}`);
      hud.showBomb(bomb.state.site, bomb.state.fuseLeft);
    } else {
      const seconds = Math.max(0, Math.ceil(match.roundTimeLeft));
      hud.setTimer(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      if (match.roundTimeLeft <= 0) endRound('ashen', 'Time expired — charge never planted');
    }
  }

  if (match.phase === 'roundEnd' && elapsed >= roundEndAt) {
    if (match.scoreSable >= WIN_SCORE || match.scoreAshen >= WIN_SCORE || match.round >= MAX_ROUNDS) endMatch();
    else startRound();
  }

  if (match.phase === 'live' || match.phase === 'buy') {
    if (player.alive) {
      const lookDelta = input.takeLook();
      look(lookDelta.x, lookDelta.y);
      playerStep(dt, keys);
      weapon.step(dt);
      if (match.phase === 'live') {
        const def = weapon.def();
        if (input.state.firing) {
          if (def.auto) {
            if (weapon.ready()) shoot(shot ? 0 : weapon.spread(mover.groundSpeed(player.body), player.body.crouching));
          } else if (!semiLatch) {
            semiLatch = true;
            if (weapon.ready()) shoot(shot ? 0 : weapon.spread(mover.groundSpeed(player.body), player.body.crouching));
          }
        } else semiLatch = false;
        if (input.wasPressed('KeyR') && weapon.reload()) audio.reload();
        if (input.wasPressed('KeyG')) throwGrenade();
        for (let n = 0; n < 5; n += 1) {
          if (!input.wasPressed(`Digit${n + 1}`)) continue;
          const ids = ['sidearm', 'smg', 'shotgun', 'rifle', 'sniper'];
          if (economy.state.owned.has(ids[n])) {
            weapon.equip(ids[n]);
            hud.setAmmo(weapon.state.mag, weapon.state.reserve);
          }
        }
        // Plant: hold E at a site while carrying the charge.
        if (bomb.state.carrier === player && input.state.keys.has('KeyE')) {
          let near = null;
          for (const key of ['A', 'B']) {
            const site = SITES[key];
            const dx = site.center.x - player.body.position.x;
            const dz = site.center.z - player.body.position.z;
            if (dx * dx + dz * dz < site.radius * site.radius) near = key;
          }
          if (near) {
            plantProgress += dt / 3.5;
            hud.setChannel('plant', plantProgress);
            if (plantProgress >= 1) {
              plantProgress = 0;
              hud.setChannel(null, null);
              economy.state.money += 300;
              hud.setMoney(economy.state.money);
              bomb.plant(near, elapsed);
              match.plantedSite = near;
              hud.banner('Charge planted', `Site ${near} — defend it until it blows`, 3000);
              audio.plant();
            }
          } else {
            plantProgress = 0;
            hud.setChannel(null, null);
          }
        } else {
          plantProgress = 0;
          hud.setChannel(null, null);
        }
        stepGrenades(dt);
      }
    }
    // Bots and the bomb only run once the round is live: during the buy phase
    // both teams hold at their spawns.
    if (match.phase === 'live') {
      botBase.time = elapsed;
      botBase.playerSpeed = mover.groundSpeed(player.body);
      sableSquad.step(dt, sableCtx);
      ashenSquad.step(dt, ashenCtx);
      heard.length = 0;
      bomb.step(dt, elapsed, botBase);
    }
  }

  if (blastAge >= 0) {
    blastAge += dt;
    const t = Math.min(1, blastAge / 0.6);
    blastMesh.scale.setScalar(1 + t * 11);
    blastMesh.material.opacity = 0.8 * (1 - t);
    blastLight.intensity = 50 * (1 - t);
    if (t >= 1) {
      blastMesh.visible = false;
      blastLight.intensity = 0;
      blastAge = -1;
    }
  }

  for (const tracer of tracers) {
    if (tracer.life <= 0) continue;
    tracer.life -= dt;
    tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.9;
    if (tracer.life <= 0) tracer.line.visible = false;
  }

  hud.setAlive((player.alive ? 1 : 0) + sableSquad.aliveCount(), ashenSquad.aliveCount());
  hud.setHealth(player.health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(economy.state.money);
  hud.setScore(match.scoreSable, match.scoreAshen);
  hud.setSpread(6 + weapon.spread(mover.groundSpeed(player.body), player.body.crouching) * 900);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    input.endFrame();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  if (name === 'start') {
    // Buy phase at the Sable spawn, armoury open, the yard ahead.
    player.body.position.set(0, 0, 15.5);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(20);
    buyOpen = true;
    hud.showBuy(economy.describe());
    hud.banner('Round 1', 'Buy phase — press B for the armoury', 60000);
    paintTwiceThenReady();
    return;
  }
  // Live round for play and end.
  match.phase = 'live';
  match.buyTimeLeft = 0;
  buyOpen = false;
  hud.hideBuy();
  if (name === 'play') {
    player.body.position.set(0, 0, 7);
    player.body.yaw = 0;
    player.body.pitch = 0;
    const target = ashenSquad.bots[1];
    target.body.position.set(0, 0, -2);
    target.body.yaw = Math.PI;
    target.state = 'hold';
    target.route = [];
    const down = ashenSquad.bots[2];
    down.body.position.set(-3.5, 0, -3);
    down.health = 0;
    down.alive = false;
    down.fall = 1;
    down.mesh.rotation.x = -1.45;
    down.mesh.position.set(-3.5, -0.08, -3);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, -2));
    shoot(0);
    settle(6);
    aimAt(new THREE.Vector3(0, 1.2, -2));
    shoot(0);
    hud.hitMarker(false, 6000);
    settle(1);
    aimAt(new THREE.Vector3(0, 1.2, -2));
    shoot(0);
    hud.hideBanner();
  } else {
    // Round won: the charge ticks at Site A, Sable leads 1–0.
    match.scoreSable = 1;
    match.scoreAshen = 0;
    bomb.plant('A', elapsed);
    match.plantedSite = 'A';
    match.phase = 'roundEnd';
    match.winner = 'sable';
    match.reason = 'Charge planted at Site A';
    roundEndAt = elapsed + 3600;
    player.body.position.set(-9, 0, -4);
    player.body.yaw = 0.7;
    player.body.pitch = 0.02;
    const down = ashenSquad.bots[0];
    down.body.position.set(-13, 0, -8);
    down.health = 0;
    down.alive = false;
    down.fall = 1;
    down.mesh.rotation.x = -1.45;
    down.mesh.position.set(-13, -0.08, -8);
    settle(20);
    hud.setScore(1, 0);
    hud.showBomb('A', 28);
    hud.setTimer('0:28');
    hud.banner('Sable takes the round', 'Charge planted at Site A · 1 — 0', 60000);
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (match.phase === 'menu') {
    startMatch();
    input.requestLock();
  } else if (match.phase === 'matchEnd') {
    startMatch();
    input.requestLock();
  } else if (match.phase === 'roundEnd') {
    if (match.scoreSable >= WIN_SCORE || match.scoreAshen >= WIN_SCORE || match.round >= MAX_ROUNDS) endMatch();
    else {
      startRound();
      input.requestLock();
    }
  } else {
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.phase === 'menu') {
    hud.showOverlay('start');
  } else if (match.phase === 'live' || match.phase === 'buy') {
    if (player.alive) hud.showOverlay('paused');
  } else if (match.phase === 'roundEnd') {
    hud.showOverlay('round', `${match.reason} · ${match.scoreSable} — ${match.scoreAshen}`);
  } else if (match.phase === 'matchEnd') {
    hud.showOverlay('match', `${match.scoreSable > match.scoreAshen ? 'Sable' : 'Ashen'} wins the match ${match.scoreSable} — ${match.scoreAshen}.`);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM') audio.toggleMute();
});

syncCamera();
hud.setHealth(100);
hud.setAmmo(weapon.state.mag, weapon.state.reserve);
hud.setMoney(economy.state.money);
hud.setScore(0, 0);
hud.setAlive(5, 5);
hud.setTimer('1:40');
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
