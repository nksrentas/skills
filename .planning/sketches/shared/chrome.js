// Sketch chrome shared by 002 and 003: variant tabs, state cycling, theme switch, viewport, toast.
window.Sketch = function ({ variants, render }) {
  let variant = variants[0].key;
  let mode = 'run';
  const nav = document.getElementById('variant-nav');
  nav.querySelector('.tabs').innerHTML = variants.map(v => `<button class="variant-tab" data-v="${v.key}">${v.label}</button>`).join('');
  const draw = () => {
    nav.querySelectorAll('.variant-tab').forEach(b => b.classList.toggle('active', b.dataset.v === variant));
    nav.querySelectorAll('.state-btn').forEach(b => b.classList.toggle('active', b.dataset.m === mode));
    const v = variants.find(x => x.key === variant);
    document.getElementById('desc').innerHTML = v.desc;
    document.getElementById('main').innerHTML = render(variant, window.loopIn(mode), mode);
  };
  nav.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.v) variant = b.dataset.v;
    if (b.dataset.m) mode = b.dataset.m;
    draw();
  });
  // expandable rows and buttons inside the pane
  document.getElementById('main').addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) { (t.closest('[data-box]') || t).classList.toggle('open'); return; }
    const a = e.target.closest('[data-toast]');
    if (a) toast(a.dataset.toast);
  });
  document.getElementById('theme-switcher').addEventListener('change', e => {
    document.querySelector('link[href*=themes]').href = '../themes/' + e.target.value + '.css';
  });
  document.querySelectorAll('#sketch-tools .vp').forEach(b => b.addEventListener('click', () => {
    const w = +b.dataset.w;
    document.querySelectorAll('.pane, .variant-desc').forEach(p => { p.style.maxWidth = w ? w + 'px' : ''; });
  }));
  window.toast = text => {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast = setTimeout(() => t.classList.remove('show'), 1800);
  };
  draw();
  window.redraw = draw;
};

window.area = key => window.LOOP.areas.find(a => a.key === key);

window.verdict = (L, mode) => {
  const c = window.counts(L.items);
  if (mode === 'stuck') {
    const s = L.items.find(i => i.state === 'stuck');
    return `<div class="verdict stuck"><b>⚠ Needs you</b><span class="meta">"${s.plain}" failed 3 times, so the loop skipped it and carries on with the rest.</span><button class="btn act" data-toast="Opens what went wrong, in plain words">See what went wrong</button></div>`;
  }
  if (mode === 'done') return `<div class="verdict done"><b>✓ Finished</b><span class="meta">All ${c.total} work · took ${L.elapsed} · ${L.spent}</span><button class="btn act" data-toast="Dismissed from the list">Dismiss</button></div>`;
  return `<div class="verdict ok"><b>● On track</b><span class="meta">${c.done} of ${c.total} work · ${L.left} left, done around ${L.finishAt} · nothing needs you</span><button class="btn act" data-toast="The loop finishes what it is doing, then stops">Stop</button></div>`;
};

window.loopsColumn = (L, mode) => {
  const c = window.counts(L.items);
  const first = mode === 'done' ? 'Finished' : mode === 'stuck' ? `⚠ Needs you · ${c.done}/${c.total}` : `${c.done} of ${c.total} work · ${L.left.replace('about ', '~')} left`;
  return `<div class="loops">
    <div class="loop-card sel"><div class="n">${mode === 'done' ? '✓' : '●'} ${L.name}</div><div class="s">${first}</div></div>
    <div class="loop-card" data-toast="Would switch to this loop"><div class="n">● Production deploy</div><div class="s">3 of 14 work · ~58 min left</div></div>
    <div class="loop-card" data-toast="Would switch to this loop"><div class="n">● Dev dock</div><div class="s">Just started · 1 of 15</div></div>
    <div class="loop-card" data-toast="Would switch to this loop"><div class="n">■ First resume picker</div><div class="s">Stopped by you · 13 of 13</div></div>
    <div class="loop-card" data-toast="Would switch to this loop"><div class="n">✓ Transactional email</div><div class="s">Finished yesterday</div></div>
  </div>`;
};
