// The charge: carried, dropped, planted or gone. It is the round's second
// way to win — plant it at a site and keep it alive for its fuse, or cut the
// wires before it blows. The beeps quicken as the fuse runs down.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const FUSE_SECONDS = 35;
export const BLAST_RADIUS = 12;

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slate), roughness: 0.5, metalness: 0.5 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  lamp.position.set(0, 0.14, 0);
  group.add(body, lamp);
  group.visible = false;
  scene.add(group);

  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30, 1.4);
  scene.add(blastLight);

  const state = {
    status: 'carried',
    site: null,
    carrier: null,
    position: new THREE.Vector3(),
    plantedAt: 0,
    fuseLeft: FUSE_SECONDS,
    beepAt: 0,
    blastAt: -1,
    fetchClaimed: null,
  };

  function showAt(x, y, z) {
    group.visible = true;
    group.position.set(x, y, z);
  }

  return {
    state,
    reset(carrier) {
      state.status = 'carried';
      state.site = null;
      state.carrier = carrier;
      state.position.set(0, 0, 0);
      state.fuseLeft = FUSE_SECONDS;
      state.beepAt = 0;
      state.blastAt = -1;
      state.fetchClaimed = null;
      group.visible = false;
      blast.visible = false;
      blastLight.intensity = 0;
    },
    plant(site, time) {
      state.status = 'planted';
      state.site = site;
      state.plantedAt = time;
      state.fuseLeft = FUSE_SECONDS;
      state.beepAt = time;
      const center = site === 'A'
        ? new THREE.Vector3(-16, 0, -11)
        : new THREE.Vector3(16, 0, -11);
      state.position.copy(center);
      showAt(center.x, 0.12, center.z);
    },
    drop(x, z) {
      state.status = 'dropped';
      state.carrier = null;
      state.position.set(x, 0, z);
      state.fetchClaimed = null;
      showAt(x, 0.12, z);
    },
    pickUp(carrier) {
      state.status = 'carried';
      state.carrier = carrier;
      state.fetchClaimed = null;
      group.visible = false;
    },
    step(dt, time, ctx) {
      if (state.status === 'planted') {
        state.fuseLeft -= dt;
        lamp.material.color.setHex(Math.sin(time * 10) > 0 ? 0xff2a1a : 0xe07840);
        if (time >= state.beepAt) {
          ctx.onBeep(state.fuseLeft < 10);
          state.beepAt = time + Math.max(0.25, state.fuseLeft / FUSE_SECONDS);
        }
        if (state.fuseLeft <= 0) {
          state.status = 'gone';
          state.blastAt = time;
          group.visible = false;
          blast.visible = true;
          blast.position.copy(state.position).setY(1);
          blastLight.position.copy(state.position).setY(2);
          ctx.onDetonate(state.site);
        }
      }
      if (state.blastAt >= 0) {
        const age = time - state.blastAt;
        const t = Math.min(1, age / 0.6);
        blast.scale.setScalar(1 + t * BLAST_RADIUS);
        blast.material.opacity = 0.8 * (1 - t);
        blastLight.intensity = 60 * (1 - t);
        if (t >= 1) {
          blast.visible = false;
          blastLight.intensity = 0;
          state.blastAt = -1;
        }
      }
    },
  };
}
