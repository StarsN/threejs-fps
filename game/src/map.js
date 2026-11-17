// Sable Yard: a desert-industrial yard, 44 x 36 m, two bomb sites and three
// lanes. Attackers spawn south, defenders north. Every box is a movement
// collider and a surface a bullet stops on; the silo is a cylinder you see
// and a box you bump. Plain geometry only, no models and no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint ids, so routes read as names in bots.js.
export const WP = {
  atkC: 0, atkW: 1, atkE: 2, midS: 3, mid: 4, midN: 5, split: 6,
  westS: 7, westM: 8, westN: 9, westA: 10, siteA: 11,
  eastS: 12, eastM: 13, eastN: 14, eastB: 15, siteB: 16,
  defC: 17, defW: 18, defE: 19, holdW: 20, holdM: 21, holdE: 22,
  holdA: 23, holdB: 24, crossW: 26, crossE: 27, linkW: 28, linkE: 29,
};

const NODES = [
  [0, 15.5], [-6, 15.5], [6, 15.5], [0, 10], [0, 5], [0, -2], [0, -7],
  [-18, 10], [-18, 4], [-18, -2], [-18, -8], [-16, -11],
  [18, 10], [18, 4], [18, -2], [18, -8], [16, -11],
  [0, -15.5], [-6, -15.5], [6, -15.5], [-14, -6], [0, -9], [14, -6],
  [-13, -13], [13, -13], null, [-10, 4], [10, 4], [-10, -2], [10, -2],
];

const EDGES = {
  0: [1, 2, 3], 1: [0, 7], 2: [0, 12], 3: [0, 4, 26, 27], 4: [3, 5, 26, 27],
  5: [4, 6, 28, 29], 6: [5, 11, 16, 21], 7: [1, 8], 8: [7, 9, 26],
  9: [8, 10, 28], 10: [9, 11], 11: [10, 6, 23], 12: [2, 13], 13: [12, 14, 27],
  14: [13, 15, 29], 15: [14, 16], 16: [15, 6, 24], 17: [18, 19, 21],
  18: [17, 20], 19: [17, 22], 20: [18, 9, 23], 21: [17, 6], 22: [19, 14, 24],
  23: [20, 11], 24: [22, 16], 26: [3, 4, 8], 27: [3, 4, 13], 28: [5, 9], 29: [5, 14],
};

export const SITES = {
  A: { name: 'Silo', center: new THREE.Vector3(-16, 0, -11), radius: 4.2 },
  B: { name: 'Depot', center: new THREE.Vector3(16, 0, -11), radius: 4.2 },
};

export const SPAWNS = {
  sable: [
    new THREE.Vector3(0, 0, 15.5),
    new THREE.Vector3(-6, 0, 15.5),
    new THREE.Vector3(6, 0, 15.5),
    new THREE.Vector3(-3, 0, 16.5),
    new THREE.Vector3(3, 0, 16.5),
  ],
  ashen: [
    new THREE.Vector3(0, 0, -15.5),
    new THREE.Vector3(-6, 0, -15.5),
    new THREE.Vector3(6, 0, -15.5),
    new THREE.Vector3(-3, 0, -16.5),
    new THREE.Vector3(3, 0, -16.5),
  ],
};

// Breadth-first route over the waypoint graph; returns an array of node ids.
export function route(from, to) {
  if (from === to) return [to];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    for (const next of EDGES[node] ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, node);
      if (next === to) {
        const path = [to];
        let at = to;
        while (prev.get(at) !== -1) {
          at = prev.get(at);
          path.push(at);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [to];
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const node = NODES[i];
    if (!node) continue;
    const d = (node[0] - x) ** 2 + (node[1] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function nodePosition(id, out) {
  const node = NODES[id];
  out.set(node[0], 0, node[1]);
  return out;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const name of ['canvas', 'surface', 'hairline', 'sand', 'rust', 'slate', 'accent']) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: name === 'slate' ? 0.35 : 0.03,
    });
  }
  const siteMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent),
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent),
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const colliders = [];
  const shootables = [];
  const occluders = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    occluders.push(mesh);
    return mesh;
  }

  // Floor and perimeter, 44 x 36 m, walls 4.6 m high.
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'sand');
  box(0.4, 4.6, 36.4, -22.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 36.4, 22.2, 2.3, 0, 'surface');
  box(44.4, 4.6, 0.4, 0, 2.3, -18.2, 'surface');
  box(44.4, 4.6, 0.4, 0, 2.3, 18.2, 'surface');

  // Sand patches: thin slabs that break the floor up without changing play.
  box(10, 0.06, 7, -14, 0.03, 4, 'canvas', false);
  box(8, 0.06, 6, 12, 0.03, -4, 'canvas', false);
  box(7, 0.06, 9, 2, 0.03, -13, 'hairline', false);

  // Site A — the Silo: a cylinder you see, a box you bump, crates for cover.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 5.6, 20), mats.rust);
  silo.position.set(-17.5, 2.8, -13.5);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  shootables.push(silo);
  occluders.push(silo);
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-19.7, 0, -15.7),
    new THREE.Vector3(-15.3, 5.6, -11.3),
  ));
  const siloCap = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.3, 20), mats.slate);
  siloCap.position.set(-17.5, 5.7, -13.5);
  group.add(siloCap);
  box(1.2, 1.2, 1.2, -13, 0.6, -8, 'hairline');
  box(1.2, 1.2, 1.2, -19.5, 0.6, -8, 'hairline');
  box(2.4, 1.1, 1.2, -14, 0.55, -13.5, 'sand');
  box(1.6, 0.7, 1.6, -18.5, 0.35, -14.5, 'sand');

  // Site B — the Depot: a warehouse block, containers, crates.
  box(6, 4, 4, 18, 2, -15.5, 'slate');
  box(6.4, 0.3, 4.4, 18, 4.15, -15.5, 'rust');
  box(2.4, 1.1, 1.2, 13, 0.55, -8, 'sand');
  box(1.2, 1.2, 1.2, 19.5, 0.6, -8, 'hairline');
  box(1.6, 0.7, 1.6, 12.5, 0.35, -13.5, 'sand');

  // Mid: two blocks with a 4 m choke between them, plus low cover.
  box(2.4, 2.2, 4, -3.2, 1.1, 0, 'surface');
  box(2.4, 2.2, 4, 3.2, 1.1, 0, 'surface');
  box(6, 1.0, 0.8, 0, 0.5, 3.5, 'hairline');
  box(6, 1.0, 0.8, 0, 0.5, -4.5, 'hairline');

  // Pillars and crates down the lanes.
  box(1.2, 3.2, 1.2, -10, 1.6, -2, 'surface');
  box(1.2, 3.2, 1.2, 10, 1.6, -2, 'surface');
  box(1.2, 3.2, 1.2, -10, 1.6, 6, 'surface');
  box(1.2, 3.2, 1.2, 10, 1.6, 6, 'surface');
  box(1.6, 0.7, 1.6, -6, 0.35, 6, 'sand');
  box(1.6, 0.7, 1.6, 6, 0.35, 6, 'sand');
  box(1.2, 1.2, 1.2, -6, 0.6, -6, 'hairline');
  box(1.2, 1.2, 1.2, 6, 0.6, -6, 'hairline');
  box(2.4, 0.9, 1.2, 0, 0.45, 10, 'sand');
  box(2.4, 0.9, 1.2, 0, 0.45, -13, 'sand');

  // Spawn cover.
  box(1.2, 1.2, 1.2, -4, 0.6, 14, 'hairline');
  box(1.2, 1.2, 1.2, 4, 0.6, 14, 'hairline');
  box(1.2, 1.2, 1.2, -4, 0.6, -14, 'hairline');
  box(1.2, 1.2, 1.2, 4, 0.6, -14, 'hairline');

  // Barrels: cylinders you see, small boxes you bump.
  for (const [x, z] of [[-20, 2], [-20, -4], [20, 2], [20, -4], [-8, 12], [8, 12]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), mats.rust);
    barrel.position.set(x, 0.5, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    shootables.push(barrel);
    occluders.push(barrel);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - 0.42, 0, z - 0.42),
      new THREE.Vector3(x + 0.42, 1.0, z + 0.42),
    ));
  }

  // Site markers: a ring on the ground and a light beam.
  const markers = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.25, site.radius, 40), siteMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.06, site.center.z);
    group.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 7, 16, 1, true), beamMat);
    beam.position.set(site.center.x, 3.5, site.center.z);
    group.add(beam);
    markers[key] = { ring, beam, ringMat: ring.material, beamMat: beam.material };
  }

  // Dusk light: a low warm sun, a cool sky fill, and amber floodlights over the sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a68'), new THREE.Color(PALETTE.canvas), 0.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.4);
  sun.position.set(-14, 12, 16);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a8ba0'), 0.5);
  fill.position.set(12, 10, -12);
  scene.add(fill);
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const flood = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 1.6);
    flood.position.set(site.center.x, 5.2, site.center.z);
    scene.add(flood);
  }

  return { colliders, shootables, occluders, group, markers, spawns: SPAWNS };
}
