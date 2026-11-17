// The DOM HUD: crosshair, hit marker, health, money, ammo, timer, score,
// the kill feed, the buy menu and the one overlay panel. It never touches the
// simulation; main.js pushes numbers in and reads the play callback out.
const COPY = {
  start: {
    title: 'Sable Yard',
    copy: 'Five attackers, five defenders, two sites. Plant the charge or clear the yard. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Sable Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const healthFill = el('health-fill');
  const healthNum = el('health-num');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreValue = el('score-value');
  const aliveValue = el('alive-value');
  const killfeed = el('killfeed');
  const bombBox = el('bomb');
  const bombText = el('bomb-text');
  const channelBox = el('channel');
  const channelFill = el('channel-fill');
  const channelText = el('channel-text');
  const buyMenu = el('buymenu');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const hitmarker = el('hitmarker');
  const damage = el('damage');
  const dirhit = el('dirhit');
  const crosshair = el('crosshair');
  const grenadeValue = el('grenade-value');
  let hitTimer = 0;
  let bannerTimer = 0;
  const last = { mag: -1, reserve: -1, health: -1, money: -1, timer: '', score: '', alive: '', grenades: -1 };

  return {
    setAmmo(mag, reserve) {
      if (mag === last.mag && reserve === last.reserve) return;
      last.mag = mag;
      last.reserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(value) {
      const v = Math.max(0, Math.round(value));
      if (v === last.health) return;
      last.health = v;
      healthNum.textContent = String(v);
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
    },
    setMoney(value) {
      if (value === last.money) return;
      last.money = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setGrenades(n) {
      if (n === last.grenades) return;
      last.grenades = n;
      grenadeValue.textContent = n > 0 ? `G ×${n}` : '';
    },
    setTimer(text) {
      if (text === last.timer) return;
      last.timer = text;
      timerValue.textContent = text;
    },
    setScore(sable, ashen) {
      const text = `${sable} — ${ashen}`;
      if (text === last.score) return;
      last.score = text;
      scoreValue.textContent = text;
    },
    setAlive(sable, ashen) {
      const text = `${sable}v${ashen}`;
      if (text === last.alive) return;
      last.alive = text;
      aliveValue.textContent = text;
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash(angleDeg) {
      damage.classList.add('on');
      dirhit.style.transform = `translate(-50%, -50%) rotate(${Math.round(angleDeg)}deg)`;
      dirhit.classList.add('on');
      setTimeout(() => {
        damage.classList.remove('on');
        dirhit.classList.remove('on');
      }, 180);
    },
    killfeed(killer, victim, headshot, killerSide) {
      const line = document.createElement('div');
      line.className = `feed-line ${killerSide}`;
      line.textContent = `${killer} ${headshot ? '◉' : '✕'} ${victim}`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
    },
    showBomb(site, seconds) {
      bombBox.hidden = false;
      bombText.textContent = `CHARGE ${site} · ${Math.ceil(seconds)}s`;
      bombBox.classList.toggle('urgent', seconds <= 10);
    },
    hideBomb() {
      bombBox.hidden = true;
    },
    setChannel(kind, frac) {
      if (frac === null) {
        channelBox.hidden = true;
        return;
      }
      channelBox.hidden = false;
      channelText.textContent = kind === 'plant' ? 'Planting charge…' : 'Defusing charge…';
      channelFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showBuy(items) {
      buyMenu.hidden = false;
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.className = `buy-row${item.owned ? ' owned' : ''}`;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-hint">${item.hint}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
        buyItems.appendChild(row);
      }
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    banner(titleText, subText, holdMs = 2200) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail ?? text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
