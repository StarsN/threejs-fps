// The bots: nine opponents and teammates that move, see and shoot back. Each
// bot is a small state machine — advance along a route, hold a lane, engage a
// target it can see, investigate a sound it heard, plant or defuse the charge,
// or fetch a dropped bomb — over one shared mover and one honest raycast per
// shot. No bot ever knows where an enemy is without seeing or hearing them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody, createMover } from './mover.js';
import { WEAPONS } from './weapons.js';
import { route, nearestNode, nodePosition, WP, SITES } from './map.js';
import { range } from './rng.js';

const VIEW_RANGE = 38;
const VIEW_HALF_ANGLE = 0.9;
const HEAR_RANGE = 28;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 5;

const SABLE_NAMES = ['Wren', 'Kite', 'Dune', 'Flint'];
const ASHEN_NAMES = ['Ash', 'Cinder', 'Ember', 'Soot', 'Rook'];

const BOT_LOADOUT = {
  sable: ['rifle', 'rifle', 'shotgun', 'rifle'],
  ashen: ['rifle', 'sniper', 'rifle', 'rifle', 'rifle'],
};

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _node = new THREE.Vector3();
const _ray = new THREE.Ray();
const _playerBox = new THREE.Box3();
const _playerHead = new THREE.Box3();

function buildBotMesh(side) {
  const team = side === 'sable' ? PALETTE.sable : PALETTE.ashen;
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(team), roughness: 0.7, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sand), roughness: 0.6, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.6, metalness: 0.3 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), torsoMat);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), headMat);
  head.position.y = 1.56;
  head.userData.part = 'head';
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.34), torsoMat);
  band.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.24), darkMat);
  legL.position.set(-0.14, 0.28, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.24), darkMat);
  legR.position.set(0.14, 0.28, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.3, 1.15, -0.25);
  group.add(torso, head, band, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head };
}

export function createSquad(scene, map, side, rng) {
  const mover = createMover(map.colliders);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const names = side === 'sable' ? SABLE_NAMES : ASHEN_NAMES;
  const loadout = BOT_LOADOUT[side];
  const bots = [];

  for (let i = 0; i < names.length; i += 1) {
    const spawn = map.spawns[side][i];
    const body = createBody(spawn.x, spawn.z, side === 'sable' ? 0 : Math.PI);
    const visual = buildBotMesh(side);
    scene.add(visual.group);
    const bot = {
      id: `${side}-${i}`,
      name: names[i],
      side,
      weaponId: loadout[i],
      body,
      mesh: visual.group,
      torso: visual.torso,
      head: visual.head,
      health: 100,
      alive: true,
      state: 'hold',
      route: [],
      routeIndex: 0,
      holdNode: -1,
      holdUntil: 0,
      target: null,
      targetSeenAt: -10,
      reactionAt: 0,
      burstLeft: 0,
      burstGap: 0,
      pauseLeft: 0,
      visionAt: rng() * 0.15,
      strafeDir: 1,
      strafeUntil: 0,
      investigate: null,
      channel: 0,
      channelKind: null,
      site: null,
      fall: 0,
      yawTarget: body.yaw,
      isCarrier: false,
    };
    visual.torso.userData.bot = bot;
    visual.head.userData.bot = bot;
    bots.push(bot);
  }

  function reset(spawnSite) {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const spawn = map.spawns[bot.side][i];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = bot.side === 'sable' ? 0 : Math.PI;
      bot.body.pitch = 0;
      bot.health = 100;
      bot.alive = true;
      bot.state = 'hold';
      bot.route = [];
      bot.routeIndex = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.pauseLeft = 0;
      bot.channel = 0;
      bot.channelKind = null;
      bot.fall = 0;
      bot.isCarrier = false;
      bot.mesh.rotation.set(0, bot.body.yaw, 0);
      bot.mesh.position.copy(bot.body.position);
      bot.mesh.visible = true;
      // Attackers pick a site and a lane; defenders take their holds.
      if (bot.side === 'sable') {
        bot.site = spawnSite[i % spawnSite.length];
        const lane = bot.site === 'A'
          ? [WP.atkW, WP.westS, WP.westM, WP.westN, WP.westA, WP.siteA]
          : i === 3
            ? [WP.atkC, WP.midS, WP.mid, WP.midN, WP.split, WP.siteB]
            : [WP.atkE, WP.eastS, WP.eastM, WP.eastN, WP.eastB, WP.siteB];
        bot.route = lane;
        bot.routeIndex = 0;
        bot.state = 'advance';
      } else {
        bot.holdNode = [WP.holdW, WP.holdM, WP.holdE, WP.holdA, WP.holdB][i];
        nodePosition(bot.holdNode, _node);
        bot.route = [bot.holdNode];
        bot.routeIndex = 0;
        bot.state = 'advance';
      }
    }
  }

  function canSee(bot, foe, occluders) {
    _eye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const foePos = foe.body.position;
    _to.set(foePos.x - _eye.x, (foePos.y + 1.2) - _eye.y, foePos.z - _eye.z);
    const distance = _to.length();
    if (distance > VIEW_RANGE) return false;
    _to.normalize();
    const facing = Math.sin(bot.body.yaw) * -_to.x + Math.cos(bot.body.yaw) * -_to.z;
    if (facing < Math.cos(VIEW_HALF_ANGLE)) return false;
    raycaster.set(_eye, _to);
    raycaster.far = distance;
    return raycaster.intersectObjects(occluders, false).length === 0;
  }

  function shoot(bot, foe, ctx) {
    const def = WEAPONS[bot.weaponId];
    _eye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const foePos = foe.body.position;
    const targetSpeed = foe.isPlayer ? ctx.playerSpeed : Math.hypot(foe.body.velocity.x, foe.body.velocity.z);
    const ownSpeed = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
    const error = (0.02 + _eye.distanceTo(_to.set(foePos.x, foePos.y + 1.2, foePos.z)) * 0.004
      + targetSpeed * 0.008 + ownSpeed * 0.012) * (ctx.rng() + ctx.rng() - 1);
    _aim.set(foePos.x, foePos.y + 1.2, foePos.z);
    _aim.x += error * 2;
    _aim.y += error * 0.7;
    _dir.subVectors(_aim, _eye).normalize();
    const muzzle = _eye.clone().addScaledVector(_dir, 0.5);
    ctx.onFire(bot, muzzle, _dir, def.kind);
    // Resolve the shot: walls and bot bodies by raycast, the player by AABB.
    raycaster.set(_eye, _dir);
    raycaster.far = 60;
    let bestDist = Infinity;
    let best = null;
    const wallHit = raycaster.intersectObjects(ctx.occluders, false)[0];
    if (wallHit) {
      bestDist = wallHit.distance;
      best = { kind: 'wall', point: wallHit.point };
    }
    const bodyHit = raycaster.intersectObjects(ctx.botHitMeshes, false)[0];
    if (bodyHit && bodyHit.distance < bestDist && bodyHit.object.userData.bot?.alive) {
      bestDist = bodyHit.distance;
      best = { kind: 'bot', point: bodyHit.point, victim: bodyHit.object.userData.bot, part: bodyHit.object.userData.part };
    }
    if (foe.isPlayer && foe.alive) {
      _playerBox.min.set(foePos.x - 0.3, foePos.y + 0.6, foePos.z - 0.3);
      _playerBox.max.set(foePos.x + 0.3, foePos.y + 1.4, foePos.z + 0.3);
      _playerHead.min.set(foePos.x - 0.17, foePos.y + 1.4, foePos.z - 0.17);
      _playerHead.max.set(foePos.x + 0.17, foePos.y + 1.72, foePos.z + 0.17);
      _ray.origin.copy(_eye);
      _ray.direction.copy(_dir);
      const dBody = _ray.intersectsBox(_playerBox);
      const dHead = _ray.intersectsBox(_playerHead);
      const d = dHead !== null ? dHead : dBody;
      if (d !== null && d < bestDist) {
        bestDist = d;
        best = { kind: 'player', point: _eye.clone().addScaledVector(_dir, d), victim: foe, part: dHead !== null ? 'head' : 'torso' };
      }
    }
    if (!best) return;
    ctx.onTracer(muzzle, best.point);
    if (best.kind === 'wall') return;
    const damage = def.damage * (best.part === 'head' ? def.headMult : 1);
    ctx.onHit(bot, best.victim, damage, best.part === 'head', best.point);
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.mesh.rotation.x = -bot.fall * 1.45;
      bot.mesh.position.y = -bot.fall * 0.08;
      return;
    }
    const def = WEAPONS[bot.weaponId];
    bot.burstGap = Math.max(0, bot.burstGap - dt);
    bot.pauseLeft = Math.max(0, bot.pauseLeft - dt);

    // Vision, staggered so nine bots do not raycast every step.
    bot.visionAt -= dt;
    if (bot.visionAt <= 0) {
      bot.visionAt = 0.15;
      let seen = null;
      for (const foe of ctx.foes) {
        if (!foe.alive) continue;
        if (canSee(bot, foe, ctx.occluders)) {
          seen = foe;
          break;
        }
      }
      if (seen) {
        if (bot.target !== seen) {
          bot.target = seen;
          bot.reactionAt = ctx.time + range(ctx.rng, 0.4, 0.8);
          bot.burstLeft = 0;
        }
        bot.targetSeenAt = ctx.time;
        if (bot.state !== 'engage') bot.state = 'engage';
      } else if (bot.target && ctx.time - bot.targetSeenAt > 1.2) {
        bot.target = null;
        bot.state = bot.holdNode >= 0 && bot.side === 'ashen' ? 'hold' : 'advance';
      }
    }

    // Hearing: a shot nearby pulls a bot off its route to look.
    for (const heard of ctx.heard) {
      if (heard.side === bot.side) continue;
      const dx = heard.x - bot.body.position.x;
      const dz = heard.z - bot.body.position.z;
      if (dx * dx + dz * dz < HEAR_RANGE * HEAR_RANGE && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
        bot.investigate = { x: heard.x, z: heard.z, until: ctx.time + 4 };
        bot.state = 'investigate';
      }
    }

    // Bomb work: the carrier plants, defenders defuse, the nearest friendly fetches a drop.
    if (ctx.bomb.state === 'planted' && bot.side === 'ashen' && bot.state !== 'engage' && bot.state !== 'defuse') {
      const site = SITES[ctx.bomb.site];
      const dx = site.center.x - bot.body.position.x;
      const dz = site.center.z - bot.body.position.z;
      if (dx * dx + dz * dz < 16) {
        bot.state = 'defuse';
        bot.channelKind = 'defuse';
      } else if (bot.state !== 'advance') {
        const from = nearestNode(bot.body.position.x, bot.body.position.z);
        const dest = ctx.bomb.site === 'A' ? WP.siteA : WP.siteB;
        bot.route = [from, ...route(from, dest)];
        bot.routeIndex = 0;
        bot.state = 'advance';
      }
    }
    if (bot.isCarrier && ctx.bomb.state === 'carried' && bot.side === 'sable' && bot.state !== 'engage' && bot.state !== 'plant') {
      const site = SITES[bot.site];
      const dx = site.center.x - bot.body.position.x;
      const dz = site.center.z - bot.body.position.z;
      if (dx * dx + dz * dz < site.radius * site.radius && ctx.time - bot.targetSeenAt > 2) {
        bot.state = 'plant';
        bot.channelKind = 'plant';
        bot.channel = 0;
      }
    }
    if (ctx.bomb.state === 'dropped' && bot.side === 'sable' && bot.state !== 'engage' && !ctx.bomb.fetchClaimed) {
      ctx.bomb.fetchClaimed = bot;
      bot.route = [nearestNode(bot.body.position.x, bot.body.position.z)];
      bot.state = 'fetch';
    }

    let wishX = 0;
    let wishZ = 0;
    let speed = 4.2;
    const wantCrouch = false;

    if (bot.state === 'engage' && bot.target?.alive) {
      const foePos = bot.target.body.position;
      _to.set(foePos.x - bot.body.position.x, 0, foePos.z - bot.body.position.z);
      const dist = _to.length() || 1;
      _to.divideScalar(dist);
      bot.yawTarget = Math.atan2(-_to.x, -_to.z);
      if (ctx.time > bot.strafeUntil) {
        bot.strafeDir = ctx.rng() < 0.5 ? -1 : 1;
        bot.strafeUntil = ctx.time + range(ctx.rng, 0.6, 1.4);
      }
      const toward = dist > 26 ? 1 : dist < 7 ? -0.7 : 0;
      wishX = _to.x * toward + -_to.z * bot.strafeDir * 0.7;
      wishZ = _to.z * toward + _to.x * bot.strafeDir * 0.7;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len;
      wishZ /= len;
      speed = 2.6;
      if (ctx.time >= bot.reactionAt && bot.pauseLeft <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = bot.weaponId === 'sniper' || bot.weaponId === 'shotgun' ? 1 : 3 + Math.floor(ctx.rng() * 3);
        }
        if (bot.burstGap <= 0 && bot.burstLeft > 0) {
          bot.burstLeft -= 1;
          bot.burstGap = def.gap;
          shoot(bot, bot.target, ctx);
          if (bot.burstLeft === 0) bot.pauseLeft = range(ctx.rng, 0.7, 1.4);
        }
      }
    } else if (bot.state === 'plant' || bot.state === 'defuse') {
      const seconds = bot.state === 'plant' ? PLANT_SECONDS : DEFUSE_SECONDS;
      bot.channel += dt;
      ctx.onChannel(bot, bot.state, bot.channel / seconds);
      if (bot.channel >= seconds) {
        const done = bot.state;
        bot.channel = 0;
        bot.channelKind = null;
        bot.state = 'hold';
        if (done === 'plant') ctx.onPlantDone(bot);
        else ctx.onDefuseDone(bot);
      }
    } else if (bot.state === 'fetch') {
      _to.set(ctx.bomb.position.x - bot.body.position.x, 0, ctx.bomb.position.z - bot.body.position.z);
      const dist = _to.length();
      if (dist < 1) {
        bot.isCarrier = true;
        ctx.bomb.state = 'carried';
        ctx.bomb.carrier = bot;
        bot.state = 'advance';
        const from = nearestNode(bot.body.position.x, bot.body.position.z);
        const dest = bot.site === 'A' ? WP.siteA : WP.siteB;
        bot.route = [from, ...route(from, dest)];
        bot.routeIndex = 0;
      } else {
        _to.divideScalar(dist || 1);
        wishX = _to.x;
        wishZ = _to.z;
        bot.yawTarget = Math.atan2(-_to.x, -_to.z);
      }
    } else if (bot.state === 'investigate' && bot.investigate) {
      if (ctx.time > bot.investigate.until) {
        bot.investigate = null;
        bot.state = 'advance';
      } else {
        const target = bot.investigate;
        _to.set(target.x - bot.body.position.x, 0, target.z - bot.body.position.z);
        const dist = _to.length();
        if (dist < 1.2) {
          bot.state = 'hold';
          bot.holdUntil = ctx.time + 3;
        } else {
          _to.divideScalar(dist || 1);
          wishX = _to.x;
          wishZ = _to.z;
          bot.yawTarget = Math.atan2(-_to.x, -_to.z);
        }
      }
    } else if (bot.state === 'hold') {
      if (bot.holdUntil && ctx.time > bot.holdUntil) {
        bot.holdUntil = 0;
        bot.state = 'advance';
      } else {
        bot.yawTarget += Math.sin(ctx.time * 0.5 + bot.id.length) * dt * 0.4;
      }
    } else {
      // advance: follow the route, one node at a time.
      const nodeId = bot.route[bot.routeIndex];
      if (nodeId === undefined) {
        bot.state = 'hold';
        bot.holdUntil = ctx.time + 2;
      } else {
        nodePosition(nodeId, _node);
        _to.set(_node.x - bot.body.position.x, 0, _node.z - bot.body.position.z);
        const dist = _to.length();
        if (dist < 0.7) {
          bot.routeIndex += 1;
        } else {
          _to.divideScalar(dist || 1);
          wishX = _to.x;
          wishZ = _to.z;
          bot.yawTarget = Math.atan2(-_to.x, -_to.z);
        }
        if (bot.side === 'ashen' && bot.routeIndex >= bot.route.length && bot.holdNode >= 0) {
          bot.state = 'hold';
        }
      }
    }

    // Turn toward the target yaw, then move.
    let dyaw = bot.yawTarget - bot.body.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.body.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    mover.step(bot.body, dt, wishX, wishZ, speed, 30, 8, false, wantCrouch);
    bot.mesh.position.copy(bot.body.position);
    bot.mesh.rotation.y = bot.body.yaw;
  }

  return {
    bots,
    reset,
    step(dt, ctx) {
      for (const bot of bots) stepBot(bot, dt, ctx);
    },
    aliveCount() {
      return bots.filter((bot) => bot.alive).length;
    },
  };
}
