'use strict';
// grimoire - recipes, meal plan, shopping list. data in indexeddb, logs meals into forge

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']; // same as forge
const FORGE_KEY = 'forge.v1';

const DEFAULTS = {
  avoid: 'seafood, fish, salmon, tuna, cod, haddock, prawn, prawns, shrimp, crab, lobster, mussels, clams, oysters, squid, calamari, anchovy, anchovies, sardines, mackerel, scallops, sea bass, trout, fish sauce, shellfish, '
    + 'cheese, cheddar, parmesan, mozzarella, feta, halloumi, ricotta, mascarpone, brie, gruyere, gouda, paneer, stilton, pecorino, emmental, camembert, burrata, grana padano, manchego, '
    + 'kidney beans, soy sauce, soya sauce, tamari',
  staples: 'salt, black pepper, pepper, water, salt and pepper',
  servings: 2,
  scriptUrl: '', scriptToken: ''
};

const S = { settings: { ...DEFAULTS }, recipes: [], plan: {}, shop: [] };

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r1 = n => Math.round((+n || 0) * 10) / 10;
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const dayName = s => new Date(s + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const recipe = id => S.recipes.find(r => r.id === id);
const mins = m => !m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
const monday = s => { const d = new Date(s + 'T12:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
function busy(btn, label) {
  if (!btn) return;
  if (label) { btn.dataset.was = btn.textContent; btn.textContent = label; btn.disabled = true; }
  else { btn.textContent = btn.dataset.was || btn.textContent; btn.disabled = false; }
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// 9x9 pixel icons
const PX = {
  recipes: ['.#######.', '#.......#', '#.#####.#', '#.......#', '#.###...#', '#.......#', '#.####..#', '#.......#', '.#######.'],
  plan: ['.#.....#.', '#########', '#.......#', '#.#.#.#.#', '#.......#', '#.#.#.#.#', '#.......#', '#.#.#...#', '#########'],
  shop: ['.........', '##.......', '.#######.', '.#.....#.', '.#.....#.', '..#####..', '.........', '..#...#..', '.###.###.'],
  gear: ['...#.#...', '.#.###.#.', '..#####..', '.###.###.', '..##.##..', '.###.###.', '..#####..', '.#.###.#.', '...#.#...']
};
const pix = n => `<svg class="px" viewBox="0 0 9 9" shape-rendering="crispEdges">${PX[n].map((row, y) =>
  [...row].map((c, x) => c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="currentColor"/>` : '').join('')).join('')}</svg>`;
const SIGIL = `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M16 5 L26 23 L6 23 Z" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="9" y1="17" x2="23" y2="17" stroke="currentColor" stroke-width="1.2"/><circle cx="16" cy="19.5" r="1.5" fill="currentColor"/></svg>`;

// ---------- db ----------
const db = {
  open() {
    return this.p = this.p || new Promise((res, rej) => {
      const r = indexedDB.open('grimoire', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('photos'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async req(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), q = fn(t.objectStore(store));
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    });
  },
  get: (s, k) => db.req(s, 'readonly', o => o.get(k)),
  put: (s, k, v) => db.req(s, 'readwrite', o => o.put(v, k)),
  del: (s, k) => db.req(s, 'readwrite', o => o.delete(k)),
  keys: s => db.req(s, 'readonly', o => o.getAllKeys()),
  clear: s => db.req(s, 'readwrite', o => o.clear())
};
const save = k => db.put('kv', k, S[k]).catch(e => toast('Save failed: ' + e.message, 5000));

async function load() {
  S.recipes = (await db.get('kv', 'recipes')) || [];
  S.plan = (await db.get('kv', 'plan')) || {};
  S.shop = (await db.get('kv', 'shop')) || [];
  S.settings = { ...DEFAULTS, ...((await db.get('kv', 'settings')) || {}) };
}

// borrow the script url/token from tithe if it's on this phone. only open it if it exists or we'd create a blank one
async function tithe() {
  try {
    if (!indexedDB.databases) return null;
    if (!(await indexedDB.databases()).some(d => d.name === 'tithe')) return null;
    const d = await new Promise((res, rej) => { const r = indexedDB.open('tithe'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (!d.objectStoreNames.contains('kv')) { d.close(); return null; }
    const st = await new Promise(res => { const q = d.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    d.close();
    return st && st.scriptUrl ? { url: st.scriptUrl, token: st.scriptToken } : null;
  } catch (e) { return null; }
}
async function script() {
  const st = S.settings;
  if (st.scriptUrl) return { url: st.scriptUrl, token: st.scriptToken };
  return tithe();
}

// photos -> object urls, cached
const photoUrls = {};
async function photoUrl(id) {
  if (photoUrls[id]) return photoUrls[id];
  const b = await db.get('photos', id);
  return b ? (photoUrls[id] = URL.createObjectURL(b)) : null;
}
async function fillPhotos(root = document) {
  for (const el of root.querySelectorAll('[data-photo]')) {
    const u = await photoUrl(el.dataset.photo);
    if (u) { el.style.backgroundImage = `url("${u}")`; el.innerHTML = el.querySelector('.fav') ? el.querySelector('.fav').outerHTML : ''; }
  }
}
const imgAttr = r => r.hasPhoto ? `data-photo="${r.id}"` : r.image ? `style="background-image:url('${esc(r.image)}')"` : '';

// ---------- ingredients ----------
const FRAC = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅕': .2 };
const UNIT_RE = /^(kg|g|grams?|gr|ml|millilitres?|milliliters?|l|litres?|liters?|tsp|teaspoons?|tbsp|tbs|tablespoons?|cups?|oz|ounces?|lbs?|pounds?|cloves?|tins?|cans?|pinch(?:es)?|handfuls?|slices?|packs?|packets?|bunch(?:es)?|sprigs?|rashers?|fillets?|pieces?|knobs?|sticks?|stalks?|heads?|jars?|bags?|pots?|dash(?:es)?|splash(?:es)?|drizzle)\b\.?/i;
const UNIT_MAP = { grams: 'g', gram: 'g', gr: 'g', millilitres: 'ml', millilitre: 'ml', milliliters: 'ml', milliliter: 'ml', litres: 'l', litre: 'l', liters: 'l', liter: 'l', teaspoon: 'tsp', teaspoons: 'tsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', ounces: 'oz', ounce: 'oz', pounds: 'lb', pound: 'lb', lbs: 'lb' };
const SHORT = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'oz', 'lb'];

function normUnit(u) {
  u = u.toLowerCase().replace(/\.$/, '');
  if (UNIT_MAP[u]) return UNIT_MAP[u];
  if (SHORT.includes(u)) return u;
  if (/(pinch|bunch|dash|splash)es$/.test(u)) return u.slice(0, -2);
  if (u.length > 3 && u.endsWith('s')) return u.slice(0, -1);
  return u;
}

function parseIng(line) {
  let s = String(line).trim().replace(/^[-•*▢□◦·]\s*/, '');
  s = s.replace(/(\d)\s*([½¼¾⅓⅔⅛⅕])/g, (m, a, b) => String(+a + FRAC[b])).replace(/[½¼¾⅓⅔⅛⅕]/g, m => String(FRAC[m]));
  let qty = null;
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:x\s+)?/i);
  if (m) {
    qty = +m[1];
    if (m[2]) qty += m[2] / m[3]; else if (m[4]) qty = m[1] / m[4];
    s = s.slice(m[0].length);
  }
  let unit = '';
  const u = qty != null && s.match(UNIT_RE);
  if (u) { unit = normUnit(u[1]); s = s.slice(u[0].length).trim().replace(/^of\s+/i, ''); }
  return { qty, unit, item: s.trim() };
}

function fmtQty(q) {
  if (q == null || isNaN(q)) return '';
  if (q >= 10) return String(Math.round(q));
  const w = Math.floor(q), f = q - w;
  const F = [[0, ''], [.125, '⅛'], [.25, '¼'], [1 / 3, '⅓'], [.5, '½'], [2 / 3, '⅔'], [.75, '¾'], [1, '']];
  const near = F.reduce((a, b) => Math.abs(b[0] - f) < Math.abs(a[0] - f) ? b : a);
  if (Math.abs(near[0] - f) < .05) {
    if (near[0] === 1) return String(w + 1);
    return (w ? w : '') + near[1] || '0';
  }
  return String(r1(q));
}

function ingQty(ing, mult = 1) {
  if (ing.qty == null) return '';
  const q = ing.qty * mult;
  if (!ing.unit) return fmtQty(q);
  if (SHORT.includes(ing.unit)) return (ing.unit === 'g' || ing.unit === 'ml') ? Math.round(q) + ing.unit : fmtQty(q) + (ing.unit.length <= 2 ? '' : ' ') + ing.unit;
  return `${fmtQty(q)} ${ing.unit}${q > 1 && !/s$/.test(ing.unit) ? (/(ch|sh)$/.test(ing.unit) ? 'es' : 's') : ''}`;
}

// avoid list
const avoidList = () => S.settings.avoid.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function badWords(text, list = avoidList()) {
  const t = text.toLowerCase();
  return list.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
}
function recipeBad(r) {
  const list = avoidList(), hits = new Set();
  r.ingredients.forEach(i => badWords(i.item, list).forEach(w => hits.add(w)));
  // collapse to the obvious groups
  const out = new Set();
  hits.forEach(w => out.add(/cheese|cheddar|parmesan|mozzarella|feta|halloumi|ricotta|mascarpone|brie|gruyere|gouda|paneer|stilton|pecorino|emmental|camembert|burrata|grana|manchego/.test(w) ? 'cheese'
    : /fish|salmon|tuna|cod|haddock|prawn|shrimp|crab|lobster|mussel|clam|oyster|squid|calamari|anchov|sardine|mackerel|scallop|sea bass|trout|shellfish|seafood/.test(w) ? 'seafood' : w));
  return [...out];
}

// ---------- shopping helpers ----------
const AISLES = [
  ['Frozen', /frozen/],
  ['Spices & sauces', /black pepper|peppercorn|\bsalt\b|paprika|cumin|chilli powder|chili powder|chilli flakes|oregano|thyme|rosemary|cinnamon|nutmeg|spice|seasoning|sauce|ketchup|mayo|mustard|curry|garam|turmeric|bay lea|stock cube|gravy|vinegar|harissa|pesto|sriracha|bbq/],
  ['Cupboard', /\btins?\b|\bcans?\b|chopped tomatoes|passata|tomato puree|tomato paste|coconut milk|stock\b/],
  ['Meat', /chicken|beef|mince|steak|pork|bacon|lamb|turkey|sausage|chorizo|\bham\b|gammon|duck|pancetta|salami|meatball/],
  ['Fruit & veg', /onion|garlic|pepper|tomato(?!.*(tin|can|puree|paste|passata|chopped))|potato|carrot|celery|lettuce|spinach|kale|broccoli|courgette|mushroom|lemon|lime|apple|banana|berr|avocado|chilli|ginger|coriander|parsley|basil|mint|leek|cabbage|cucumber|squash|aubergine|\bpeas?\b|sweetcorn|corn on|rocket|salad|herb|orange|mango|pineapple|grape|beansprout|green beans|asparagus|cauliflower|parsnip|beetroot/],
  ['Dairy & eggs', /milk|butter|cream|yog|\begg|crème|creme|quark|skyr|cheese|cheddar|mozzarella|parmesan|feta|halloumi|ricotta|paneer/],
  ['Bakery', /bread|bun\b|buns|wrap|tortilla|bagel|pitta|pita|naan|brioche|\brolls?\b|baguette|ciabatta|crumpet/],
  ['Cupboard', /rice|pasta|spaghetti|penne|noodle|flour|oats|\btins?\b|\bcans?\b|chopped tomatoes|passata|puree|paste|stock|beans|lentil|chickpea|sugar|honey|syrup|\boil\b|couscous|quinoa|nuts?\b|peanut|almond|cornflour|baking|yeast|cocoa|chocolate|raisin|coconut milk/]
];
const shopQty = s => (s.qty != null && (!s.unit || !SHORT.includes(s.unit))) ? ingQty({ ...s, qty: Math.max(1, Math.ceil(s.qty - 0.01)) }) : ingQty(s);
const aisleOf = name => (AISLES.find(([, re]) => re.test(name.toLowerCase())) || ['Other'])[0];
const AISLE_ORDER = ['Fruit & veg', 'Meat', 'Dairy & eggs', 'Bakery', 'Cupboard', 'Spices & sauces', 'Frozen', 'Other'];

function itemKey(name) {
  let s = name.toLowerCase().replace(/\(.*?\)/g, '').split(',')[0]
    .replace(/\b(fresh|large|small|medium|finely|roughly|thinly|chopped|diced|sliced|minced|grated|peeled|crushed|to taste|boneless|skinless|ripe|optional|about|approx|of)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  if (s.length > 3 && /[^s]s$/.test(s)) s = s.slice(0, -1);
  if (/oe$/.test(s)) s = s.slice(0, -1); // tomatoe -> tomato
  return s;
}
const isStaple = name => S.settings.staples.split(',').map(s => itemKey(s.trim())).filter(Boolean).includes(itemKey(name));

function addToShop(list) {
  // list: [{item, qty, unit, from}]
  for (const it of list) {
    if (!it.item || isStaple(it.item)) continue;
    const key = itemKey(it.item);
    const ex = S.shop.find(s => !s.done && s.key === key && s.unit === (it.unit || ''));
    if (ex) {
      if (ex.qty != null && it.qty != null) ex.qty += it.qty; else if (it.qty != null) ex.qty = it.qty;
      if (it.from && !ex.from.includes(it.from)) ex.from.push(it.from);
    } else {
      const nice = it.item.split(',')[0].replace(/\(.*?\)/g, '').trim();
      S.shop.push({ id: uid(), key, name: nice.charAt(0).toUpperCase() + nice.slice(1), qty: it.qty, unit: it.unit || '', aisle: aisleOf(it.item), done: false, from: it.from ? [it.from] : [] });
    }
  }
  save('shop');
}

// ---------- forge ----------
function forgeHere() { try { return !!localStorage.getItem(FORGE_KEY); } catch (e) { return false; } }
function logToForge(r, serv, meal) {
  try {
    const raw = localStorage.getItem(FORGE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw), k = today(), m = r.macros || {};
    s.diary = s.diary || {};
    (s.diary[k] = s.diary[k] || []).push({
      id: uid(), fid: null, name: r.title + (serv !== 1 ? ` ×${fmtQty(serv)}` : ''), g: 0, meal,
      k: r1((+m.k || 0) * serv), p: r1((+m.p || 0) * serv), c: r1((+m.c || 0) * serv), f: r1((+m.f || 0) * serv), fib: 0
    });
    localStorage.setItem(FORGE_KEY, JSON.stringify(s));
    return true;
  } catch (e) { return false; }
}
const guessMeal = () => { const h = new Date().getHours(); return h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snacks'; };

// ---------- views ----------
let tab = 'recipes', q = '', filt = 'all', weekStart = monday(today());
const TABS = [['recipes', 'Recipes'], ['plan', 'Plan'], ['shop', 'Shop']];

function render() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-act="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${pix(k)}${l}</button>`).join('');
  $('#app').innerHTML = VIEWS[tab]();
  fillPhotos($('#app'));
  drawTimers();
}

function card(r) {
  const bad = recipeBad(r), m = r.macros || {};
  return `<div class="rc" data-act="openRecipe" data-id="${r.id}">
    <div class="im" ${imgAttr(r)}>${r.hasPhoto || r.image ? '' : SIGIL}${r.fav ? '<span class="fav">★</span>' : ''}</div>
    <div class="b"><div class="t">${esc(r.title)}</div>
      <div class="m">${[mins((+r.prep || 0) + (+r.cook || 0)), m.k ? Math.round(m.k) + ' kcal' : '', m.p ? Math.round(m.p) + 'g P' : ''].filter(Boolean).join(' · ')}</div>
      ${bad.length ? `<span class="warn-tag">${esc(bad.join(', '))}</span>` : ''}</div>
  </div>`;
}

function filtered() {
  const t = q.toLowerCase();
  return S.recipes.filter(r => {
    if (filt === 'fav' && !r.fav) return false;
    if (filt === 'safe' && recipeBad(r).length) return false;
    if (filt.startsWith('#') && !(r.tags || []).includes(filt.slice(1))) return false;
    if (!t) return true;
    return (r.title + ' ' + (r.tags || []).join(' ') + ' ' + r.ingredients.map(i => i.item).join(' ')).toLowerCase().includes(t);
  }).sort((a, b) => (b.fav - a.fav) || (b.lastMade || b.created || 0) - (a.lastMade || a.created || 0));
}

const VIEWS = {
  recipes() {
    const tags = {};
    S.recipes.forEach(r => (r.tags || []).forEach(t => tags[t] = (tags[t] || 0) + 1));
    const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
    const list = filtered();
    return `
      <div class="search"><input id="q" type="search" placeholder="Search recipes or ingredients" value="${esc(q)}">
        <button class="btn solid" data-act="newRecipe">+ Add</button></div>
      <div class="chips" style="margin-top:8px">
        ${[['all', 'All'], ['fav', '★ Favourites'], ['safe', 'Safe for me']].map(([k, l]) => `<button class="chip ${filt === k ? 'on' : ''}" data-act="filt" data-f="${k}">${l}</button>`).join('')}
        ${top.map(t => `<button class="chip ${filt === '#' + t ? 'on' : ''}" data-act="filt" data-f="#${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      ${S.recipes.length ? `<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="surprise">Surprise me</button>
        <span class="mono muted">${S.recipes.length} recipe${S.recipes.length === 1 ? '' : 's'}</span></div>` : ''}
      <div id="rlist">${listHtml(list)}</div>`;
  },

  plan() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const end = days[6];
    const label = `${new Date(weekStart + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(end + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    const count = sum(days.map(d => (S.plan[d] || []).length));
    return `
      <div class="weeknav"><button class="btn ghost sm" data-act="week" data-d="-7">‹ Prev</button>
        <span class="mono">${weekStart === monday(today()) ? 'This week' : label}</span>
        <button class="btn ghost sm" data-act="week" data-d="7">Next ›</button></div>
      ${count ? `<button class="btn wide" data-act="planToShop">Add this week to shopping list</button>` : ''}
      ${days.map(d => {
        const ents = S.plan[d] || [];
        const tot = ents.reduce((a, e) => { const r = recipe(e.rid); if (r && r.macros) { a.k += (+r.macros.k || 0) * e.serv; a.p += (+r.macros.p || 0) * e.serv; } return a; }, { k: 0, p: 0 });
        return `<div class="day ${d === today() ? 'today' : ''}"><h3>${dayName(d)}</h3>
          ${MEALS.map(m => `<div class="slot"><span class="ml">${m}</span><div class="en">
            ${ents.filter(e => e.meal === m).map(e => { const r = recipe(e.rid); return `<span class="pill" data-act="planEntry" data-d="${d}" data-id="${e.id}">${esc(r ? r.title : 'Deleted recipe')}<i>×${fmtQty(e.serv)}</i></span>`; }).join('')}
          </div><button class="add" data-act="planAdd" data-d="${d}" data-m="${m}" aria-label="Add to ${m}">+</button></div>`).join('')}
          ${tot.k ? `<div class="daytot">Planned: ${Math.round(tot.k)} kcal · ${Math.round(tot.p)}g protein (your portions)</div>` : ''}
        </div>`;
      }).join('')}`;
  },

  shop() {
    const left = S.shop.filter(s => !s.done).length;
    const by = {};
    S.shop.forEach(s => (by[s.aisle] = by[s.aisle] || []).push(s));
    return `
      <div class="search"><input id="shopAdd" placeholder="Add an item, e.g. 2 onions" enterkeyhint="done">
        <button class="btn solid" data-act="shopAdd">Add</button></div>
      <div class="row spread" style="margin-top:10px">
        <span class="mono muted">${left} to get</span>
        <div class="row">
          ${S.shop.some(s => s.done) ? '<button class="btn ghost sm" data-act="shopClearDone">Clear ticked</button>' : ''}
          ${S.shop.length ? '<button class="btn ghost sm" data-act="shopShare">Share</button><button class="btn ghost danger sm" data-act="shopClear">Clear all</button>' : ''}
        </div>
      </div>
      ${S.shop.length ? AISLE_ORDER.filter(a => by[a]).map(a => `<div class="card aisle"><h3>${a}</h3>
        ${by[a].sort((x, y) => x.done - y.done || x.name.localeCompare(y.name)).map(s => `
          <div class="si ${s.done ? 'done' : ''}" data-act="shopTick" data-id="${s.id}">
            <span class="box">${s.done ? '✓' : ''}</span><span class="nm">${esc(s.name)}</span>
            <span class="qq">${esc(shopQty(s))}</span>
            <button class="x" data-act="shopDel" data-id="${s.id}" aria-label="Remove">✕</button>
          </div>`).join('')}</div>`).join('')
        : '<div class="card"><div class="empty">List is empty. Add things here, or send them over from a recipe or the week\'s plan.</div></div>'}`;
  }
};

function listHtml(list) {
  if (!S.recipes.length) return `<div class="card"><p>No recipes yet. Add one with the button above:</p>
    <p class="small muted" style="margin-top:8px">Import from a recipe website, paste one you've copied, or write your own.
    You can also share a recipe page from Chrome straight into Grimoire.</p></div>`;
  return list.length ? `<div class="cards">${list.map(card).join('')}</div>` : '<div class="card"><div class="empty">Nothing matches.</div></div>';
}

// ---------- sheets ----------
let sheetBack = null;
function openSheet(html, mount, opts = {}) {
  const el = $('#sheet');
  // redraw of the same sheet, keep scroll and skip the slide in
  const keep = opts.same && !el.hidden ? el.querySelector('.sheet-inner').scrollTop : null;
  el.className = (opts.cls || '') + (keep != null ? ' noanim' : '');
  el.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-inner">${html}</div>`;
  el.hidden = false; document.body.classList.add('locked');
  document.body.classList.toggle('cooking', (opts.cls || '') === 'cook');
  sheetBack = opts.back || null;
  el.querySelector('.sheet-inner').scrollTop = keep || 0;
  if (mount) mount(el);
}
function closeSheet(done) {
  const cb = sheetBack; sheetBack = null;
  $('#sheet').hidden = true; $('#sheet').innerHTML = ''; $('#sheet').className = '';
  document.body.classList.remove('locked', 'cooking');
  releaseWake();
  if (!done && cb) cb();
}
const head = (title, extra = '') => `<div class="sheet-head"><h2>${title}</h2>${extra}<button class="x" data-act="closeSheet">✕</button></div>`;

function ask(msg, yes = 'Yes') {
  return new Promise(res => {
    const el = $('#dialog');
    el.innerHTML = `<div class="dlg"><p>${esc(msg)}</p><div class="row">
      <button class="btn ghost" id="dNo">Cancel</button><button class="btn solid" id="dYes">${esc(yes)}</button></div></div>`;
    el.hidden = false;
    $('#dNo').onclick = () => { el.hidden = true; res(false); };
    $('#dYes').onclick = () => { el.hidden = true; res(true); };
  });
}

// ---------- recipe view ----------
let cr = null, crServ = 2;

function recipeSheet(id, serv, same) {
  cr = recipe(id); if (!cr) return;
  crServ = serv || +cr.servings || 2;
  const r = cr, m = r.macros || {}, bad = recipeBad(r), list = avoidList();
  const mult = crServ / (+r.servings || 1);
  openSheet(`
    ${r.hasPhoto || r.image ? `<div class="hero" ${imgAttr(r)}></div>` : ''}
    ${head(esc(r.title), `<button class="x" data-act="fav" aria-label="Favourite" style="color:var(--red)">${r.fav ? '★' : '☆'}</button>`)}
    <div class="meta">${[r.prep ? 'Prep ' + mins(+r.prep) : '', r.cook ? 'Cook ' + mins(+r.cook) : '', r.made ? `Made ${r.made}×` : '', ...(r.tags || [])].filter(Boolean).map(esc).join(' · ')}</div>
    ${bad.length ? `<div class="card warn" style="margin:6px 0"><p class="small">Contains <b class="red">${esc(bad.join(', '))}</b>. The lines are marked below so you can swap them.</p></div>` : ''}
    ${m.k || m.p ? `<div class="mono muted" style="margin-top:8px">Per serving</div><div class="macros">
      <div><b>${Math.round(+m.k || 0)}</b><span>kcal</span></div><div><b>${r1(m.p)}</b><span>Protein</span></div>
      <div><b>${r1(m.c)}</b><span>Carbs</span></div><div><b>${r1(m.f)}</b><span>Fat</span></div></div>
      <p class="small muted">Whole lot (${fmtQty(crServ)} servings): <b>${Math.round((+m.k || 0) * crServ)} kcal</b> · ${Math.round((+m.p || 0) * crServ)}g protein · ${Math.round((+m.c || 0) * crServ)}g carbs · ${Math.round((+m.f || 0) * crServ)}g fat</p>` : ''}
    <div class="row" style="margin:12px 0 4px">
      <button class="btn solid" data-act="cook" style="flex:1">Cook</button>
      <button class="btn ghost" data-act="toPlan" style="flex:1">Plan</button>
      <button class="btn ghost" data-act="toShop" style="flex:1">Shop</button>
    </div>
    <div class="sec">Ingredients</div>
    <div class="row spread"><div class="stepper"><button data-act="serv" data-d="-1">−</button><span>${fmtQty(crServ)} serving${crServ === 1 ? '' : 's'}</span><button data-act="serv" data-d="1">+</button></div>
      ${mult !== 1 ? `<button class="btn ghost sm" data-act="servReset">Reset</button>` : ''}</div>
    <ul class="ings">${r.ingredients.map(i => `<li class="${badWords(i.item, list).length ? 'bad' : ''}"><span class="q">${esc(ingQty(i, mult))}</span><span>${esc(i.item)}</span></li>`).join('')}</ul>
    <div class="sec">Method</div>
    <ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    ${r.notes ? `<div class="sec">Notes</div><p style="white-space:pre-line">${esc(r.notes)}</p>` : ''}
    ${r.source ? `<p class="small muted" style="margin-top:14px">From <a href="${esc(r.source)}" target="_blank" rel="noopener" style="color:var(--red)">${esc(r.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></p>` : ''}
    <div class="actions" style="margin-top:18px">
      <button class="btn ghost" data-act="logForge">Log to Forge</button>
      <button class="btn ghost" data-act="editRecipe">Edit</button>
      <button class="btn ghost danger" data-act="delRecipe">Delete</button>
    </div>
  `, el => fillPhotos(el), { same });
}

// ---------- add / import ----------
let impTab = 'link';
function newSheet(prefill) {
  impTab = prefill ? 'link' : impTab;
  openSheet(`
    ${head('Add a recipe')}
    <div class="seg">${[['link', 'From a link'], ['paste', 'Paste text'], ['write', 'Write it']].map(([k, l]) => `<button class="${impTab === k ? 'on' : ''}" data-act="impTab" data-t="${k}">${l}</button>`).join('')}</div>
    <div id="impBody"></div>
  `, () => drawImp(prefill));
}
async function drawImp(prefill) {
  const b = $('#impBody');
  if (impTab === 'link') {
    const sc = await script();
    b.innerHTML = `
      <label>Recipe page link<input id="impUrl" type="url" inputmode="url" placeholder="https://www.bbcgoodfood.com/recipes/…" value="${esc(prefill || '')}"></label>
      <p class="hint">Works with most recipe sites (BBC Good Food, Pinch of Nom, Jamie Oliver, Mob and so on). Tip: in Chrome, tap Share → Grimoire on any recipe page.</p>
      ${sc ? '' : `<div class="card warn"><p class="small">Link import uses your Google helper script. Add the recipe bit to it (see the README), then paste the URL and token in settings.
        If Tithe already has them on this phone, Grimoire picks them up by itself.</p></div>`}
      <div class="actions"><button class="btn solid" data-act="importUrl">Import</button></div>
      <div id="impMsg" class="mono muted" style="margin-top:8px"></div>`;
    if (prefill && sc) ACTS.importUrl(null, $('[data-act=importUrl]'));
  } else if (impTab === 'paste') {
    b.innerHTML = `
      <label>Paste the whole recipe<textarea id="impText" rows="12" placeholder="Title&#10;&#10;Ingredients&#10;200g chicken breast&#10;1 onion…&#10;&#10;Method&#10;1. Fry the onion…"></textarea></label>
      <p class="hint">Copy the recipe from a site, a note or a message. Having "Ingredients" and "Method" headings helps it sort things out.</p>
      <div class="actions"><button class="btn solid" data-act="importText">Sort it out</button></div>`;
  } else {
    b.innerHTML = '';
    editSheet(null);
  }
}

function isoMins(s) {
  if (!s) return '';
  const m = String(s).match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return '';
  return ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) || '';
}
const numIn = v => { const m = String(v ?? '').replace(',', '.').match(/[\d.]+/); return m ? +m[0] : ''; };
const decode = s => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); };

function findRecipe(blocks) {
  const stack = [...blocks];
  while (stack.length) {
    const o = stack.shift();
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) { stack.push(...o); continue; }
    const t = o['@type'];
    if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return o;
    if (o['@graph']) stack.push(o['@graph']);
    if (o.mainEntity) stack.push(o.mainEntity);
  }
  return null;
}

function flatSteps(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') return ins.split(/\n+|(?<=\.)\s+(?=\d+\.\s)/).map(decode).filter(Boolean);
  if (Array.isArray(ins)) return ins.flatMap(flatSteps);
  if (ins.itemListElement) return flatSteps(ins.itemListElement);
  if (ins.text) return [decode(ins.text)];
  if (ins.name) return [decode(ins.name)];
  return [];
}

// yield can be "4", "Serves 4", or "Makes 500ml". only trust plain counts
function yieldServ(y) {
  for (const t of [].concat(y || []).map(String)) {
    if (/\d\s*(ml|l|litres?|liters?|g|kg|cups?|oz|pints?)\b/i.test(t)) continue;
    const m = t.match(/(\d+)/);
    if (m && +m[1] > 0 && +m[1] <= 24) return +m[1];
  }
  return null;
}

function fromLd(o, url) {
  const img = o.image ? (typeof o.image === 'string' ? o.image : Array.isArray(o.image) ? (typeof o.image[0] === 'string' ? o.image[0] : o.image[0].url) : o.image.url) : '';
  const n = o.nutrition || {};
  const serv = yieldServ(o.recipeYield);
  const ytxt = [].concat(o.recipeYield || []).map(String).find(t => /\d/.test(t)) || '';
  const kw = typeof o.keywords === 'string' ? o.keywords.split(',') : (o.keywords || []);
  const tags = [...[].concat(o.recipeCategory || []), ...[].concat(o.recipeCuisine || [])].map(s => decode(s).toLowerCase()).filter(Boolean).slice(0, 4);
  return {
    title: decode(o.name) || 'Untitled',
    servings: serv || S.settings.servings,
    prep: isoMins(o.prepTime), cook: isoMins(o.cookTime) || (!o.prepTime && isoMins(o.totalTime)) || '',
    tags: [...new Set(tags.length ? tags : kw.slice(0, 3).map(s => decode(s).toLowerCase()).filter(Boolean))],
    raw: [].concat(o.recipeIngredient || o.ingredients || []).map(decode).filter(Boolean),
    steps: flatSteps(o.recipeInstructions),
    macros: { k: numIn(n.calories), p: numIn(n.proteinContent), c: numIn(n.carbohydrateContent), f: numIn(n.fatContent) },
    image: img || '', source: url, notes: !serv && ytxt ? `Makes ${decode(ytxt).replace(/^makes\s*/i, '')}. Set the servings to however many portions you split it into.` : ''
  };
}

function parseText(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim());
  const nonEmpty = lines.filter(Boolean);
  const title = (nonEmpty[0] || 'Untitled').replace(/^#+\s*/, '').slice(0, 80);
  const iI = lines.findIndex(l => /^(ingredients?|you('ll)? need|shopping list)\s*:?$/i.test(l));
  const iM = lines.findIndex(l => /^(method|instructions?|directions?|steps|how to make( it)?|preparation)\s*:?$/i.test(l));
  let ings = [], steps = [], notes = '';
  const stripNum = s => s.replace(/^(step\s*)?\d+[.):]\s*/i, '').trim();
  if (iI >= 0 && iM >= 0) {
    const a = iI < iM ? [iI, iM] : [iM, iI];
    const first = lines.slice(a[0] + 1, a[1]).filter(Boolean), second = lines.slice(a[1] + 1).filter(Boolean);
    if (iI < iM) { ings = first; steps = second; } else { steps = first; ings = second; }
  } else {
    // no headings, guess: short lines starting with a number/fraction are ingredients
    nonEmpty.slice(1).forEach(l => {
      if (l.length < 70 && /^([\d½¼¾⅓⅔]|a |an |pinch|handful|some )/i.test(l) && !/^\d+[.)]\s+\w+\s+\w+\s+\w+/.test(l)) ings.push(l);
      else if (l.length > 25) steps.push(l);
    });
  }
  // steps written as one paragraph -> split on sentences-ish
  steps = steps.map(stripNum).filter(Boolean);
  if (steps.length === 1 && steps[0].length > 300) steps = steps[0].split(/(?<=\.)\s+/);
  const serv = (text.match(/serves\s*(\d+)/i) || [])[1];
  return { title, servings: +serv || S.settings.servings, prep: '', cook: '', tags: [], raw: ings, steps, macros: {}, image: '', source: '', notes };
}

// ---------- editor ----------
let ed = null, edBlob = null;
function editSheet(id, draft) {
  const r = id ? recipe(id) : null;
  ed = draft ? { ...draft } : r ? { ...r, raw: r.ingredients.map(i => i.raw || [ingQty(i), i.item].filter(Boolean).join(' ')) } :
    { title: '', servings: S.settings.servings, prep: '', cook: '', tags: [], raw: [], steps: [], macros: {}, image: '', source: '', notes: '' };
  ed.id = r ? r.id : ed.id || uid();
  edBlob = null;
  const m = ed.macros || {};
  const bad = ed.raw.filter(l => badWords(l).length);
  openSheet(`
    ${head(r ? 'Edit recipe' : draft ? 'Check it over' : 'New recipe')}
    ${draft && bad.length ? `<div class="card warn"><p class="small">Heads up, this has <b class="red">${esc([...new Set(bad.flatMap(l => badWords(l)))].join(', '))}</b>. Swap those lines before saving if you like.</p></div>` : ''}
    <div class="rcpt" id="edPhoto"></div>
    <label>Title<input id="eTitle" value="${esc(ed.title)}"></label>
    <div class="grid3" style="grid-template-columns:1fr 1fr 1fr">
      <label>Serves<input id="eServ" type="number" inputmode="decimal" value="${esc(ed.servings)}"></label>
      <label>Prep min<input id="ePrep" type="number" inputmode="numeric" value="${esc(ed.prep)}"></label>
      <label>Cook min<input id="eCook" type="number" inputmode="numeric" value="${esc(ed.cook)}"></label>
    </div>
    <label>Tags<input id="eTags" value="${esc((ed.tags || []).join(', '))}" placeholder="e.g. chicken, high protein, batch"></label>
    <label>Ingredients, one per line<textarea id="eIngs" rows="${Math.max(6, ed.raw.length + 1)}" placeholder="200g chicken breast&#10;1 red onion, sliced&#10;2 tbsp olive oil">${esc(ed.raw.join('\n'))}</textarea></label>
    <label>Method, one step per line<textarea id="eSteps" rows="${Math.max(6, ed.steps.length * 2)}">${esc(ed.steps.join('\n'))}</textarea></label>
    <div class="mono muted lbl">Per serving (optional, for Forge)</div>
    <div class="grid2" style="grid-template-columns:repeat(4,1fr)">
      <label>Kcal<input id="mK" type="number" inputmode="decimal" value="${esc(m.k)}"></label>
      <label>Protein<input id="mP" type="number" inputmode="decimal" value="${esc(m.p)}"></label>
      <label>Carbs<input id="mC" type="number" inputmode="decimal" value="${esc(m.c)}"></label>
      <label>Fat<input id="mF" type="number" inputmode="decimal" value="${esc(m.f)}"></label>
    </div>
    <label>Notes<textarea id="eNotes" rows="2" placeholder="Swaps, tweaks, what went well">${esc(ed.notes)}</textarea></label>
    <label>Source link<input id="eSrc" type="url" value="${esc(ed.source)}"></label>
    <div class="actions"><button class="btn solid" data-act="saveRecipe">Save recipe</button></div>
  `, async () => {
    const u = ed.hasPhoto ? await photoUrl(ed.id) : ed.image;
    drawEdPhoto(u);
  }, { back: r ? () => recipeSheet(r.id) : null });
}
function drawEdPhoto(url) {
  const el = $('#edPhoto'); if (!el) return;
  el.innerHTML = url
    ? `<img src="${esc(url)}" alt=""><div class="row"><button class="btn ghost sm" data-act="edPhoto">Change photo</button><button class="btn ghost danger sm" data-act="edPhotoRm">Remove</button></div>`
    : `<button class="btn ghost rcpt-add" data-act="edPhoto">+ Photo</button>`;
}

// ---------- cook mode ----------
let ck = { i: 0, mult: 1 }, wake = null;
async function grabWake() { try { wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
function releaseWake() { if (wake) { wake.release().catch(() => {}); wake = null; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#sheet').classList.contains('cook')) grabWake(); });

const TIME_RE = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
function timesIn(text) {
  const out = [];
  for (const m of text.matchAll(TIME_RE)) {
    const n = +(m[2] || m[1]), u = m[3].toLowerCase();
    const secs = u.startsWith('h') ? n * 3600 : u.startsWith('s') ? n : n * 60;
    if (secs > 0 && secs <= 86400) out.push({ secs, label: m[0] });
  }
  return out;
}

function cookSheet() {
  ck = { i: 0, mult: crServ / (+cr.servings || 1), showIngs: false };
  grabWake();
  openSheet('<div id="ckBody" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>', drawCook, { cls: 'cook', back: () => recipeSheet(cr.id, crServ) });
}
function drawCook() {
  const r = cr, n = r.steps.length, b = $('#ckBody'); if (!b) return;
  const last = ck.i >= n - 1;
  const step = r.steps[ck.i] || 'No method written yet.';
  b.innerHTML = `
    ${head(esc(r.title))}
    <div class="dots">${r.steps.map((_, i) => `<i class="${i <= ck.i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="seg"><button class="${ck.showIngs ? '' : 'on'}" data-act="ckView" data-v="0">Steps</button><button class="${ck.showIngs ? 'on' : ''}" data-act="ckView" data-v="1">Ingredients</button></div>
    ${ck.showIngs ? `<div class="cookstep" style="font-size:18px"><ul class="ings">${r.ingredients.map((i, k) => `<li class="si ${ck.done && ck.done[k] ? 'done' : ''}" data-act="ckIng" data-k="${k}" style="border:0;padding:6px 0"><span class="box">${ck.done && ck.done[k] ? '✓' : ''}</span><span class="q">${esc(ingQty(i, ck.mult))}</span><span class="nm">${esc(i.item)}</span></li>`).join('')}</ul></div>`
      : `<div class="cookstep"><span class="n">Step ${Math.min(ck.i + 1, Math.max(n, 1))} of ${Math.max(n, 1)}</span>${esc(step)}
          <div class="tbtns">${timesIn(step).map(t => `<button class="btn" data-act="timer" data-s="${t.secs}" data-l="${esc(r.title.slice(0, 18) + ' · ' + t.label)}">⏱ ${esc(t.label)}</button>`).join('')}</div></div>`}
    <div class="cooknav">
      <button class="btn ghost" data-act="ckPrev" ${ck.i === 0 ? 'disabled' : ''}>‹ Back</button>
      ${last ? '<button class="btn solid" data-act="ckDone">Done</button>' : '<button class="btn solid" data-act="ckNext">Next ›</button>'}
    </div>`;
}

// ---------- timers ----------
let timers = [], tick = null, actx = null;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = .08;
      o.connect(g); g.connect(actx.destination);
      o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .2);
    });
  } catch (e) { /* no sound, oh well */ }
}
function startTimer(secs, label) {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) { }
  timers.push({ id: uid(), end: Date.now() + secs * 1000, label, rung: false });
  if (!tick) tick = setInterval(drawTimers, 1000);
  drawTimers(); toast('Timer started');
}
function drawTimers() {
  const el = $('#timers');
  if (!timers.length) { el.innerHTML = ''; clearInterval(tick); tick = null; return; }
  const now = Date.now();
  el.innerHTML = timers.map(t => {
    const left = Math.max(0, Math.round((t.end - now) / 1000));
    if (!left && !t.rung) { t.rung = true; beep(); if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); }
    if (t.rung && now - t.end < 60000 && (Math.round((now - t.end) / 1000) % 6 === 5)) beep();
    const mm = Math.floor(left / 60), ss = left % 60;
    return `<div class="tmr ${left ? '' : 'ring'}" data-act="timerTap" data-id="${t.id}"><span>${left ? `${mm >= 60 ? Math.floor(mm / 60) + ':' + pad(mm % 60) : mm}:${pad(ss)}` : 'DONE'}</span><small>${esc(t.label)}</small><span>✕</span></div>`;
  }).join('');
}

// ---------- plan helpers ----------
function planPick(date, meal, rid) {
  const list = [...S.recipes].sort((a, b) => a.title.localeCompare(b.title));
  let sel = rid || '', serv = 1;
  openSheet(`
    ${head('Add to plan')}
    <div class="grid2">
      <label>Day<input id="pDate" type="date" value="${date || today()}"></label>
      <label>Meal<select id="pMeal">${MEALS.map(m => `<option ${m === (meal || guessMeal()) ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>
    <label>Your portions<input id="pServ" type="number" inputmode="decimal" step="0.5" value="1"></label>
    <p class="hint">How many servings you'll eat. Making a batch? Plan the leftovers on other days too.</p>
    ${rid ? `<div class="card"><b>${esc(recipe(rid).title)}</b></div>` : `
    <label>Recipe<input id="pQ" type="search" placeholder="Search"></label>
    <div id="pList" class="card" style="max-height:40vh;overflow:auto"></div>`}
    <div class="actions"><button class="btn solid" data-act="planSave">Add</button></div>
  `, () => {
    const draw = () => {
      const t = ($('#pQ').value || '').toLowerCase();
      $('#pList').innerHTML = list.filter(r => r.title.toLowerCase().includes(t)).map(r =>
        `<div class="si ${r.id === sel ? 'done' : ''}" data-rid="${r.id}"><span class="box">${r.id === sel ? '✓' : ''}</span><span class="nm">${esc(r.title)}</span></div>`).join('') || '<div class="empty">No recipes yet.</div>';
    };
    if (!rid) {
      draw();
      $('#pQ').oninput = draw;
      $('#pList').onclick = e => { const it = e.target.closest('[data-rid]'); if (it) { sel = it.dataset.rid; draw(); } };
    }
    ACTS.planSave = () => {
      if (!sel) { toast('Pick a recipe'); return; }
      serv = +$('#pServ').value || 1;
      const d = $('#pDate').value || today(), m = $('#pMeal').value;
      (S.plan[d] = S.plan[d] || []).push({ id: uid(), rid: sel, meal: m, serv });
      save('plan'); closeSheet(true);
      weekStart = monday(d); tab = 'plan'; render(); toast('Planned');
    };
  }, { back: rid ? () => recipeSheet(rid, crServ) : null });
}

function entrySheet(date, id) {
  const e = (S.plan[date] || []).find(x => x.id === id); if (!e) return;
  const r = recipe(e.rid);
  openSheet(`
    ${head(esc(r ? r.title : 'Deleted recipe'))}
    <p class="mono muted">${dayName(date)} · ${e.meal} · ×${fmtQty(e.serv)}</p>
    <div class="actions">
      ${r ? `<button class="btn solid" data-act="entryOpen">Open recipe</button>` : ''}
      ${r && forgeHere() ? `<button class="btn ghost" data-act="entryLog">Ate it, log to Forge</button>` : ''}
      <button class="btn ghost danger" data-act="entryDel">Remove</button>
    </div>
  `);
  ACTS.entryOpen = () => recipeSheet(r.id);
  ACTS.entryLog = () => { if (logToForge(r, e.serv, e.meal)) { closeSheet(true); toast('Logged in Forge'); } else toast('Forge not found on this phone'); };
  ACTS.entryDel = () => { S.plan[date] = S.plan[date].filter(x => x.id !== id); if (!S.plan[date].length) delete S.plan[date]; save('plan'); closeSheet(true); render(); };
}

// ---------- log to forge ----------
function logSheet(fromCook) {
  const r = cr, m = r.macros || {};
  openSheet(`
    ${head('Log to Forge')}
    <p><b>${esc(r.title)}</b></p>
    <div class="grid2">
      <label>How much you ate (servings)<input id="lServ" type="number" inputmode="decimal" step="0.25" min="0.25" value="1"></label>
      <label>Meal<select id="lMeal">${MEALS.map(x => `<option ${x === guessMeal() ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <div class="chips" style="margin-top:8px">${[0.5, 1, 1.5, 2].map(v => `<button class="chip" data-v="${v}">${fmtQty(v)}</button>`).join('')}</div>
    <div class="macros" id="lMac"></div>
    <div class="actions"><button class="btn solid" data-act="logGo">Log it</button></div>
  `, () => {
    const upd = () => {
      const v = +$('#lServ').value || 0;
      $('#lMac').innerHTML = `<div><b>${Math.round((+m.k || 0) * v)}</b><span>kcal</span></div><div><b>${r1((+m.p || 0) * v)}</b><span>Protein</span></div>
        <div><b>${r1((+m.c || 0) * v)}</b><span>Carbs</span></div><div><b>${r1((+m.f || 0) * v)}</b><span>Fat</span></div>`;
    };
    $('#lServ').oninput = upd; upd();
    document.querySelectorAll('#sheet .chip[data-v]').forEach(c => c.onclick = () => { $('#lServ').value = c.dataset.v; upd(); });
    ACTS.logGo = () => {
      const v = +$('#lServ').value;
      if (!(v > 0)) { toast('How much did you have?'); return; }
      if (logToForge(r, v, $('#lMeal').value)) {
        if (!fromCook) { r.made = (r.made || 0) + 1; r.lastMade = Date.now(); save('recipes'); }
        closeSheet(true); render(); toast('Logged in Forge');
      } else toast('Couldn\'t write to Forge');
    };
  }, { back: fromCook ? null : () => recipeSheet(r.id, crServ) });
}

// ---------- settings ----------
function settingsSheet() {
  const st = S.settings;
  openSheet(`
    ${head('Settings')}
    <div class="sec">Things I don't eat</div>
    <p class="hint">Comma separated. Recipes with these get flagged and the lines go red.</p>
    <textarea id="sAvoid" rows="6">${esc(st.avoid)}</textarea>
    <div class="sec">Always in the cupboard</div>
    <p class="hint">These never get added to the shopping list.</p>
    <textarea id="sStaples" rows="2">${esc(st.staples)}</textarea>
    <label>Default servings for new recipes<input id="sServ" type="number" inputmode="numeric" value="${esc(st.servings)}"></label>
    <div class="sec">Link import</div>
    <p class="hint">Your Google helper script, the same one Tithe uses. Leave blank to borrow Tithe's.</p>
    <label>Script URL<input id="sUrl" type="url" value="${esc(st.scriptUrl)}"></label>
    <label>Script token<input id="sTok" value="${esc(st.scriptToken)}"></label>
    <div class="actions"><button class="btn solid" data-act="saveSettings">Save settings</button></div>
    <div class="sec">Backup</div>
    <p class="hint">Recipes live on this phone only. Export a backup now and then.</p>
    <div class="actions"><button class="btn ghost" data-act="exportBackup">Export backup</button><button class="btn ghost" data-act="importBackup">Restore backup</button></div>
    <p class="hint" style="margin-top:14px">${forgeHere() ? 'Forge found on this phone. "Log to Forge" adds meals to today\'s diary.' : 'Forge isn\'t on this phone\'s browser, so "Log to Forge" won\'t work yet.'}</p>
  `);
}

const blobToData = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

// resize so photos don't eat the phone
async function shrink(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1400 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8));
}

// ---------- actions ----------
const ACTS = {
  tab: d => { tab = d.tab; render(); scrollTo(0, 0); },
  settings: () => settingsSheet(),
  closeSheet: () => closeSheet(),
  filt: d => { filt = d.f; render(); },
  surprise: () => {
    const pool = filtered().filter(r => !recipeBad(r).length);
    const list = pool.length ? pool : filtered();
    if (!list.length) return;
    recipeSheet(list[Math.floor(Math.random() * list.length)].id);
  },

  newRecipe: () => newSheet(),
  impTab: d => { impTab = d.t; newSheet(); },
  importUrl: async (d, btn) => {
    const url = ($('#impUrl').value || '').trim();
    if (!/^https?:\/\//.test(url)) { toast('Paste a full link starting https://'); return; }
    const sc = await script();
    if (!sc) { toast('Set up the helper script first'); return; }
    busy(btn, 'Fetching…'); $('#impMsg').textContent = 'Summoning the recipe…';
    try {
      const j = await (await fetch(sc.url, { method: 'POST', body: JSON.stringify({ token: sc.token, fetchRecipe: url }) })).json();
      if (!j.ok) throw new Error(j.error || 'Script said no');
      const blocks = (j.ld || []).map(s => { try { return JSON.parse(s.trim()); } catch (e) { return null; } }).filter(Boolean);
      const o = findRecipe(blocks);
      let draft;
      if (o) draft = fromLd(o, url);
      else if (j.text) { draft = parseText((j.title ? j.title + '\n' : '') + j.text); draft.source = url; draft.image = j.image || ''; }
      if (!draft || (!draft.raw.length && !draft.steps.length)) throw new Error("Couldn't find a recipe on that page. Try Paste text.");
      if (!o) toast('No proper recipe data there, guessed from the page text. Check it.', 4000);
      editSheet(null, draft);
    } catch (e) {
      busy(btn);
      if ($('#impMsg')) $('#impMsg').textContent = e.message.includes('Unknown') || e.message.includes('fetchRecipe') ? 'Your helper script needs the recipe update. See README.' : e.message;
    }
  },
  importText: () => {
    const t = $('#impText').value.trim();
    if (t.length < 20) { toast('Paste the recipe first'); return; }
    editSheet(null, parseText(t));
  },

  openRecipe: d => recipeSheet(d.id),
  fav: () => { cr.fav = !cr.fav; save('recipes'); render(); recipeSheet(cr.id, crServ, true); },
  serv: d => { crServ = Math.max(1, crServ + +d.d); recipeSheet(cr.id, crServ, true); },
  servReset: () => recipeSheet(cr.id, null, true),
  editRecipe: () => editSheet(cr.id),
  delRecipe: async () => {
    if (!await ask(`Delete ${cr.title}? Can't undo.`, 'Delete')) return;
    S.recipes = S.recipes.filter(r => r.id !== cr.id);
    Object.keys(S.plan).forEach(k => { S.plan[k] = S.plan[k].filter(e => e.rid !== cr.id); if (!S.plan[k].length) delete S.plan[k]; });
    db.del('photos', cr.id); save('recipes'); save('plan'); closeSheet(true); render();
  },
  toShop: () => {
    const mult = crServ / (+cr.servings || 1);
    addToShop(cr.ingredients.map(i => ({ item: i.item, qty: i.qty != null ? i.qty * mult : null, unit: i.unit, from: cr.title })));
    toast(`Added to shopping list (${fmtQty(crServ)} servings)`);
  },
  toPlan: () => planPick(today(), guessMeal(), cr.id),
  logForge: () => {
    if (!forgeHere()) { toast('Forge not found on this phone\'s browser'); return; }
    const m = cr.macros || {};
    if (!+m.k && !+m.p) { toast('Add per-serving macros first (Edit)'); return; }
    logSheet();
  },

  saveRecipe: async () => {
    const title = $('#eTitle').value.trim();
    if (!title) { toast('Needs a title'); return; }
    const raw = $('#eIngs').value.split('\n').map(s => s.trim()).filter(Boolean);
    const r = {
      id: ed.id, title,
      servings: +$('#eServ').value || 1, prep: +$('#ePrep').value || '', cook: +$('#eCook').value || '',
      tags: $('#eTags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      ingredients: raw.map(l => ({ ...parseIng(l), raw: l })),
      steps: $('#eSteps').value.split('\n').map(s => s.replace(/^(step\s*)?\d+[.):]\s*/i, '').trim()).filter(Boolean),
      macros: { k: +$('#mK').value || '', p: +$('#mP').value || '', c: +$('#mC').value || '', f: +$('#mF').value || '' },
      notes: $('#eNotes').value.trim(), source: $('#eSrc').value.trim(),
      image: ed._noImg ? '' : ed.image || '', hasPhoto: !!ed.hasPhoto,
      fav: !!ed.fav, made: ed.made || 0, lastMade: ed.lastMade || 0, created: ed.created || Date.now()
    };
    if (edBlob) { await db.put('photos', r.id, edBlob); delete photoUrls[r.id]; r.hasPhoto = true; }
    else if (ed._rmPhoto) { await db.del('photos', r.id); delete photoUrls[r.id]; r.hasPhoto = false; }
    const i = S.recipes.findIndex(x => x.id === r.id);
    i < 0 ? S.recipes.push(r) : (S.recipes[i] = r);
    save('recipes'); closeSheet(true); tab = 'recipes'; render(); recipeSheet(r.id); toast('Saved');
  },
  edPhoto: () => {
    const inp = $('#photoPick'); inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { edBlob = await shrink(f); } catch (e) { edBlob = f; }
      ed._rmPhoto = false; ed._noImg = true; drawEdPhoto(URL.createObjectURL(edBlob));
    };
    inp.click();
  },
  edPhotoRm: () => { edBlob = null; ed._rmPhoto = true; ed._noImg = true; ed.hasPhoto = false; drawEdPhoto(null); },

  cook: () => cookSheet(),
  ckNext: () => { ck.i = Math.min(ck.i + 1, cr.steps.length - 1); drawCook(); },
  ckPrev: () => { ck.i = Math.max(0, ck.i - 1); drawCook(); },
  ckView: d => { ck.showIngs = d.v === '1'; drawCook(); },
  ckIng: d => { ck.done = ck.done || {}; ck.done[d.k] = !ck.done[d.k]; drawCook(); },
  ckDone: async () => {
    cr.made = (cr.made || 0) + 1; cr.lastMade = Date.now(); save('recipes');
    const m = cr.macros || {};
    closeSheet(true); render();
    if (forgeHere() && (+m.k || +m.p) && await ask('Nice. Log what you ate to Forge?', 'Log it')) logSheet(true);
    else toast('Done. Enjoy.');
  },
  timer: d => startTimer(+d.s, d.l),
  timerTap: async d => {
    const t = timers.find(x => x.id === d.id); if (!t) return;
    if (t.rung || await ask('Cancel this timer?', 'Cancel timer')) { timers = timers.filter(x => x !== t); drawTimers(); }
  },

  week: d => { weekStart = addDays(weekStart, +d.d); render(); },
  planAdd: d => planPick(d.d, d.m),
  planEntry: d => entrySheet(d.d, d.id),
  planToShop: () => {
    const items = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      (S.plan[d] || []).forEach(e => {
        const r = recipe(e.rid); if (!r) return;
        const mult = e.serv / (+r.servings || 1);
        r.ingredients.forEach(ing => items.push({ item: ing.item, qty: ing.qty != null ? ing.qty * mult : null, unit: ing.unit, from: r.title }));
      });
    }
    addToShop(items); tab = 'shop'; render(); toast('Week added to the list');
  },

  shopAdd: () => {
    const v = $('#shopAdd').value.trim(); if (!v) return;
    const p = parseIng(v);
    if (isStaple(p.item)) { S.shop.push({ id: uid(), key: itemKey(p.item), name: p.item, qty: p.qty, unit: p.unit, aisle: aisleOf(p.item), done: false, from: [] }); save('shop'); }
    else addToShop([{ item: p.item || v, qty: p.qty, unit: p.unit }]);
    render(); $('#shopAdd').focus();
  },
  shopTick: (d, el, e) => {
    if (e.target.closest('.x')) return;
    const s = S.shop.find(x => x.id === d.id); if (!s) return;
    s.done = !s.done; save('shop'); render();
    if (navigator.vibrate) navigator.vibrate(15);
  },
  shopDel: d => { S.shop = S.shop.filter(x => x.id !== d.id); save('shop'); render(); },
  shopClearDone: () => { S.shop = S.shop.filter(x => !x.done); save('shop'); render(); },
  shopClear: async () => { if (await ask('Clear the whole list?', 'Clear')) { S.shop = []; save('shop'); render(); } },
  shopShare: async () => {
    const by = {};
    S.shop.filter(s => !s.done).forEach(s => (by[s.aisle] = by[s.aisle] || []).push(s));
    const text = AISLE_ORDER.filter(a => by[a]).map(a => `${a}\n${by[a].map(s => `- ${s.name}${shopQty(s) ? ' (' + shopQty(s) + ')' : ''}`).join('\n')}`).join('\n\n');
    try { if (navigator.share) await navigator.share({ title: 'Shopping list', text }); else { await navigator.clipboard.writeText(text); toast('Copied'); } }
    catch (e) { if (e.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (x) { } } }
  },

  saveSettings: () => {
    const url = $('#sUrl').value.trim();
    if (url && !/^https:\/\/script\.google\.com\//.test(url)) { toast('Script URL should start https://script.google.com/'); return; }
    Object.assign(S.settings, { avoid: $('#sAvoid').value.trim(), staples: $('#sStaples').value.trim(), servings: +$('#sServ').value || 2, scriptUrl: url, scriptToken: $('#sTok').value.trim() });
    save('settings'); closeSheet(true); render(); toast('Saved');
  },
  exportBackup: async () => {
    const photos = {};
    for (const k of await db.keys('photos')) { const b = await db.get('photos', k); if (b) photos[k] = await blobToData(b); }
    const data = { app: 'grimoire', v: 1, at: new Date().toISOString(), settings: S.settings, recipes: S.recipes, plan: S.plan, shop: S.shop, photos };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `grimoire-backup-${today()}.json`);
  },
  importBackup: () => {
    const inp = $('#backupPick'); inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); } catch (e) { toast('That isn\'t a backup file'); return; }
      if (d.app !== 'grimoire') { toast('That isn\'t a Grimoire backup'); return; }
      if (!await ask(`Restore the backup from ${(d.at || '').slice(0, 10)}?\nThis replaces everything here.`, 'Restore')) return;
      S.settings = { ...DEFAULTS, ...d.settings }; S.recipes = d.recipes || []; S.plan = d.plan || {}; S.shop = d.shop || [];
      await Promise.all(['settings', 'recipes', 'plan', 'shop'].map(save));
      await db.clear('photos');
      for (const [k, url] of Object.entries(d.photos || {})) await db.put('photos', k, await (await fetch(url)).blob());
      closeSheet(true); render(); toast('Restored');
    };
    inp.click();
  }
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t && ACTS[t.dataset.act]) ACTS[t.dataset.act](t.dataset, t, e);
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { q = e.target.value; $('#rlist').innerHTML = listHtml(filtered()); fillPhotos($('#rlist')); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'shopAdd') ACTS.shopAdd();
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
});

// ---------- boot ----------
(async () => {
  $('#gearBtn').innerHTML = pix('gear');
  try { await load(); } catch (e) { toast('Storage broke: ' + e.message, 8000); }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // shared in from another app
  const qs = new URLSearchParams(location.search);
  const shared = qs.get('url') || ((qs.get('text') || '').match(/https?:\/\/\S+/) || [])[0];
  if (shared) { history.replaceState(null, '', location.pathname); impTab = 'link'; newSheet(shared); }
  else if (qs.get('text')) { history.replaceState(null, '', location.pathname); impTab = 'paste'; newSheet(); setTimeout(() => { if ($('#impText')) $('#impText').value = qs.get('text'); }, 50); }
})();
