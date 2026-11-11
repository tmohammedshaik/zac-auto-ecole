/* ZAC Auto-école · film d'accueil au défilement, mini-carte, portique des feux */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const sm = (p, a, b) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };
  const root = document.documentElement;

  /* ---- Découpage des titres en mots (lecteur d'écran : la phrase entière) ---- */
  $$('.split').forEach(el => {
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = el.textContent.trim();
    const vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    let i = 0;
    [...el.childNodes].forEach(n => {
      const em = n.nodeType === 1;
      n.textContent.split(/([ \n\t]+)/).forEach(w => {
        if (!w) return;
        if (/^[ \n\t]+$/.test(w)) { vis.append(' '); return; }
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = w;
        s.style.setProperty('--i', i);
        s.style.setProperty('--th', (i * 0.09).toFixed(3));
        if (em) { const e = document.createElement('em'); e.append(s); vis.append(e); } else vis.append(s);
        i++;
      });
    });
    el.textContent = ''; el.append(sr, vis);
  });

  /* ---- Éléments ---- */
  const hero = $('#hero'), stage = $('#stage');
  const voiture = $('#voiture'), file = $('.voiture .file'), intro = $('#intro'), indice = $('#indice');
  const actB = $('#actB'), actC = $('#actC'), canvas = $('#seq');
  const voile = $('#voile'), iaFilm = $('#iaFilm'), etapesFilm = $$('#etapesFilm li');
  const bands = $$('.band').map(el => ({ el, a: +el.dataset.a, b: +el.dataset.b, op: -1, k: -1, vis: null }));
  const fixe = $('#fixe'), carte = $('#carte');

  /* ---- Écriture DOM seulement quand la valeur change ---- */
  const cache = new Map();
  const put = (el, prop, val) => {
    const key = el; let c = cache.get(key); if (!c) cache.set(key, c = {});
    if (c[prop] === val) return; c[prop] = val;
    if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
  };
  const tog = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };

  /* ---- Mode fixe : mêmes requêtes que le script de l'en-tête, mot pour mot ---- */
  const GATES = ['(prefers-reduced-motion: reduce)', '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)'];
  const MQLS = GATES.map(q => matchMedia(q));
  let scrub = false;

  /* ---- Trois séquences d'images (drone, feux, transformation) peintes sur canevas : aucun « seek » vidéo ---- */
  const mkSeq = (name, el, n) => ({ name, el, ctx: el.getContext('2d'), n, frames: [], set: '', last: -1, want: 0, started: false, done: false });
  const SEQ = { drone: mkSeq('drone', $('#seqB'), 61), feux: mkSeq('feux', $('#seqC'), 61), transfo: mkSeq('transfo', $('#seq'), 121) };
  const ORDRE = ['drone', 'feux', 'transfo']; // chargement progressif : la suivante démarre quand la précédente est complète, ou plus tôt si on y arrive
  const pick = () => (innerWidth <= 720 ? 'm' : 'd');
  function ensure(name) {
    const S = SEQ[name], s = pick();
    if (S.started && S.set === s) return;
    S.started = true; S.done = false; S.set = s; S.frames = new Array(S.n); S.last = -1;
    const order = [];
    for (const step of [8, 4, 2, 1]) for (let i = 0; i < S.n; i += step) if (!order.includes(i)) order.push(i);
    let next = 0, active = 0, left = S.n;
    const pump = () => {
      while (active < 6 && next < order.length) {
        const i = order[next++], img = new Image(); active++;
        img.decoding = 'async';
        const fin = ok => { active--; left--; if (ok) { S.frames[i] = img; if (Math.abs(i - S.want) < 3) draw(S, S.want, true); }
          if (!left) { S.done = true; const k = ORDRE.indexOf(name); if (ORDRE[k + 1]) ensure(ORDRE[k + 1]); } pump(); };
        img.onload = () => fin(true); img.onerror = () => fin(false);
        img.src = `assets/seq/${name}/${s}/f${String(i + 1).padStart(3, '0')}.webp`;
      }
    };
    pump();
  }
  function sizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    for (const S of Object.values(SEQ)) { S.el.width = Math.round(innerWidth * dpr); S.el.height = Math.round(stage.clientHeight * dpr); S.last = -1; }
  }
  function draw(S, i, force) {
    S.want = i;
    let f = S.frames[i], j = i;
    if (!f) for (let d = 1; d < S.n; d++) { if (S.frames[i - d]) { f = S.frames[j = i - d]; break; } if (S.frames[i + d]) { f = S.frames[j = i + d]; break; } }
    if (!f || (!force && j === S.last)) return;
    S.last = j;
    const W = S.el.width, H = S.el.height, iw = f.naturalWidth, ih = f.naturalHeight;
    const s = Math.max(W / iw, H / ih), w = iw * s, h = ih * s; // plein cadre ; sur téléphone les images sont déjà recadrées
    S.ctx.drawImage(f, (W - w) / 2, (H - h) / 2, w, h);
  }
  const frameAt = (S, p, a, b) => Math.round(clamp((p - a) / (b - a)) * (S.n - 1));
  // Feux : images (à 12 im/s) où chaque feu s'allume dans la vidéo, puis l'image où tout s'éteint
  const ALLUME = [5, 12, 18, 24, 30], ETEINT = 41;

  /* ---- Rendu d'une progression 0..1 du film ---- */
  const t0 = performance.now();
  function render(p, now) {
    // A : la monoplace arrive (temps, au chargement) puis repart (défilement)
    const load = 1 - Math.pow(1 - clamp((now - t0 - 150) / 1300), 4);
    const out = sm(p, .045, .17);
    const x = (load - 1) * 115 + out * 135;
    put(voiture, 'transform', `translate3d(${x.toFixed(2)}vw,0,0) scale(${(1 + out * .12).toFixed(4)})`);
    put(file, 'opacity', Math.max(1 - load, sm(p, .03, .1)).toFixed(3));
    const ia = 1 - sm(p, .04, .12);
    put(intro, 'opacity', ia.toFixed(3));
    put(intro, 'transform', `translate3d(0,${((1 - ia) * -70).toFixed(1)}px,0)`);
    put(indice, 'opacity', (1 - sm(p, 0, .03)).toFixed(3));

    // B : le drone arrive derrière la voiture, en chevron, puis suit la monoplace dans le Raidillon
    const wx = sm(p, .075, .19) * 130;
    put(actB, 'clipPath', wx >= 130 ? 'none' : `polygon(0 0,${wx.toFixed(2)}% 0,${(wx - 18).toFixed(2)}% 100%,0 100%)`);
    if (p > .05 && p < .45) draw(SEQ.drone, frameAt(SEQ.drone, p, .1, .4));

    // C : la grille descend comme un portique ; les vrais feux de la vidéo s'allument, s'éteignent, la voiture part
    if (p > .15) ensure('feux');
    if (p > .35) ensure('transfo');
    const cy = sm(p, .355, .425) * 100;
    put(actC, 'clipPath', cy >= 100 ? 'none' : `inset(0 0 ${(100 - cy).toFixed(2)}% 0)`);
    const fc = frameAt(SEQ.feux, p, .4, .6);
    if (p > .3 && p < .68) draw(SEQ.feux, fc);
    const lit = fc >= ETEINT ? 0 : ALLUME.filter(a => fc >= a).length; // les étapes suivent l'image affichée, pas le défilement
    etapesFilm.forEach((li, n) => tog(li, 'on', n < lit));

    // D : la transformation, image par image
    put(canvas, 'opacity', sm(p, .625, .66).toFixed(3));
    if (p > .55) draw(SEQ.transfo, frameAt(SEQ.transfo, p, .64, .93));

    put(voile, 'opacity', (sm(p, .15, .22) * (1 - sm(p, .93, 1) * .5)).toFixed(3));
    put(iaFilm, 'opacity', sm(p, .16, .22).toFixed(3));

    // Bandes de texte
    for (const B of bands) {
      const f = Math.min(.02, (B.b - B.a) / 3);
      const op = B.b > 1 ? sm(p, B.a, B.a + f) : sm(p, B.a, B.a + f) * (1 - sm(p, B.b - f, B.b));
      const k = clamp((p - B.a) / Math.min(.035, (B.b - B.a) * .4));
      if (Math.abs(op - B.op) > .004 || (op === 0) !== (B.op === 0)) { B.op = op; B.el.style.opacity = op.toFixed(3); }
      if (Math.abs(k - B.k) > .008 || (k === 1 && B.k !== 1) || (k === 0 && B.k !== 0)) { B.k = k; B.el.style.setProperty('--k', k.toFixed(3)); }
      const v = op > .5;
      if (v !== B.vis) { B.vis = v; tog(B.el, 'vis', v); }
    }
  }

  /* ---- Progression de la page (mini-carte) ---- */
  const trace = $('#trace'), vive = $('#vive'), point = $('#point'), reperesG = $('#reperes'), virageTxt = $('#virage');
  const L = trace.getTotalLength();
  vive.style.strokeDasharray = L; vive.style.strokeDashoffset = L;
  let reperes = [];
  function placeReperes() {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    reperesG.textContent = '';
    reperes = $$('[data-virage]').map(el => {
      const y = el.getBoundingClientRect().top + scrollY;
      const f = clamp(y / max), pt = trace.getPointAtLength(f * L * .985);
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'rep'); c.setAttribute('r', 3.6); c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
      reperesG.append(c);
      return { f, c, txt: el.dataset.virage, y };
    });
  }
  let lastVirage = '';
  function renderPage(f) {
    const pt = trace.getPointAtLength(f * L * .985);
    put(point, 'transform', `translate(${pt.x.toFixed(1)}px,${pt.y.toFixed(1)}px)`);
    put(vive, 'strokeDashoffset', (L * (1 - f * .985)).toFixed(1));
    let txt = reperes.length ? reperes[0].txt : '';
    reperes.forEach(r => { const on = f + .002 >= r.f; tog(r.c, 'passe', on); if (on) txt = r.txt; });
    if (txt !== lastVirage) { lastVirage = txt; virageTxt.textContent = txt; }
  }

  /* ---- Boucle unique, amortie, qui se repose ---- */
  const heroP = () => { const r = hero.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - stage.clientHeight)); };
  const pageP = () => clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
  let tH = 0, sH = 0, tP = 0, sP = 0, raf = null, last = 0, heroOn = true;
  function tick(now) {
    const dt = Math.min(100, now - (last || now)); last = now;
    const a = 1 - Math.pow(1 - .14, dt / 16.667);
    sH += (tH - sH) * a; sP += (tP - sP) * a;
    const loading = now - t0 < 1700;
    const done = Math.abs(tH - sH) < .0002 && Math.abs(tP - sP) < .0002;
    if (done) { sH = tH; sP = tP; }
    if (scrub && (heroOn || !done)) render(sH, now);
    renderPage(sP);
    if (done && !loading) { raf = null; last = 0; } else raf = requestAnimationFrame(tick);
  }
  const wake = () => { if (raf === null) raf = requestAnimationFrame(tick); };
  function onScroll() {
    tH = heroP(); tP = pageP();
    tog(fixe, 'vis', scrollY > innerHeight * .9 && !inscriptionVue && ![...vertsVus].some(b => +getComputedStyle(b.closest('.band') || b).opacity > .1));
    tog(carte, 'mini', hero.getBoundingClientRect().bottom < innerHeight * .5);
    wake();
  }
  new IntersectionObserver(e => { heroOn = e[0].isIntersecting; }, { rootMargin: '200px' }).observe(hero);
  let inscriptionVue = false;
  const vertsVus = new Set(); // le bouton fixe se cache dès qu'un autre bouton vert est à l'écran
  const ioVert = new IntersectionObserver(es => { es.forEach(e => e.isIntersecting ? vertsVus.add(e.target) : vertsVus.delete(e.target)); onScroll(); });
  $$('.btn.go').filter(b => b !== fixe).forEach(b => ioVert.observe(b));
  new IntersectionObserver(e => { inscriptionVue = e[0].isIntersecting; onScroll(); }).observe($('#inscription'));

  function enableScrub() {
    if (scrub) return; scrub = true;
    root.classList.remove('static');
    sizeCanvas();
    bands.forEach(b => { b.op = -1; b.k = -1; b.vis = null; });
    cache.clear();
    if (document.readyState === 'complete') ensure('drone'); else addEventListener('load', () => scrub && ensure('drone'), { once: true });
    onScroll();
  }
  function disableScrub() {
    scrub = false;
    root.classList.add('static');
    voiture.style.transform = ''; intro.style.opacity = ''; intro.style.transform = ''; file.style.opacity = '0';
    cache.clear();
  }
  function applyMode() { if (MQLS.some(m => m.matches)) disableScrub(); else enableScrub(); requestAnimationFrame(() => { placeReperes(); onScroll(); }); }
  MQLS.forEach(m => m.addEventListener('change', () => { applyMode(); if (MQLS[0].matches) finirPortique(); }));
  applyMode();

  addEventListener('scroll', onScroll, { passive: true });
  let rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (scrub) { sizeCanvas(); for (const S of Object.values(SEQ)) if (S.started) { ensure(S.name); draw(S, S.want, true); } } placeReperes(); cache.clear(); onScroll(); }, 120);
  });
  addEventListener('load', () => { placeReperes(); onScroll(); });
  if (document.fonts) document.fonts.ready.then(() => { placeReperes(); onScroll(); });

  /* ---- Entrées des sections ---- */
  $$('[data-i]').forEach(el => el.style.setProperty('--d', el.dataset.i));
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); io.unobserve(e.target);
    setTimeout(() => e.target.classList.add('fini'), 1800); // les délais d'entrée se retirent : le survol répond tout de suite
  }), { threshold: .12 });
  $$('[data-in]').forEach(s => io.observe(s));

  /* ---- Pause des animations quand l'onglet est caché ---- */
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('pause', document.hidden));

  /* ---- Le moment interactif : maintenir pour allumer les feux ---- */
  const portique = $('#portique'), tenir = $('#tenir'), feux = $$('.feux i', portique), etapes = $$('.etapes li');
  let hold = 0, holding = false, hraf = null, hlast = 0, go = false;
  function drawHold() {
    const n = go ? 5 : Math.min(5, Math.floor(hold * 5 + .001));
    feux.forEach((f, i) => tog(f, 'on', i < n));
    etapes.forEach((e, i) => tog(e, 'on', i < n));
    tenir.style.setProperty('--h', hold.toFixed(3));
  }
  function holdTick(now) {
    const dt = Math.min(64, now - (hlast || now)); hlast = now;
    hold = holding ? Math.min(1, hold + dt / 1700) : Math.max(0, hold - dt / 900);
    drawHold();
    if (hold >= 1 && !go) { finirPortique(); hraf = null; return; }
    if (holding || hold > 0) hraf = requestAnimationFrame(holdTick); else { hraf = null; hlast = 0; }
  }
  function finirPortique() {
    go = true; hold = 1; drawHold();
    setTimeout(() => portique.classList.add('go'), MQLS[0].matches ? 0 : 450);
  }
  const start = e => { if (go) return; if (e) e.preventDefault(); holding = true; if (!hraf) hraf = requestAnimationFrame(holdTick); };
  const stop = () => { holding = false; };
  tenir.addEventListener('pointerdown', e => { tenir.setPointerCapture?.(e.pointerId); start(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => tenir.addEventListener(t, stop));
  tenir.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  tenir.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  tenir.addEventListener('contextmenu', e => e.preventDefault());
  if (MQLS[0].matches) finirPortique();

  /* ---- « Choisir cette formule » pré-remplit le formulaire ---- */
  const champ = $('#champFormule');
  $$('[data-formule]').forEach(a => a.addEventListener('click', () => { champ.value = a.dataset.formule; }));
})();
