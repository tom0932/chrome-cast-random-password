'use strict';

/* ══════════════════════════════════════════════════════════════════
   CAST · 随机密码铸造 —— popup 逻辑

   两条硬规矩：
   1) 随机只走 Web Crypto + 拒绝采样，不用 Math.random；
   2) 状态只有一个来源（picked 集合 / S 对象），开关只是它的视图，
      免得出现"开关亮着，但一个符号都没有"的自相矛盾。
   ══════════════════════════════════════════════════════════════════ */

/* ══ 字盘 ══════════════════════════════════════════════════════ */
const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.?/~'
};
const SYMS = [...SETS.symbol];
const AMBIG = /[0O1lI|`]/g;
const LVN = { 1: '弱', 2: '中', 3: '强', 4: '极强' };
const HIST_MAX = 8;

const S = {
  upper: true, lower: true, digit: true, custom: false,
  len: 20,
  exclude: false, nodup: false, wip: true, clearOnClose: true
};

/* 25 颗字粒各自开关。整行开关是"整组停用 / 恢复"，不是"清空重来"：
   关掉时把这一盘存进 stash，再打开照原样放回去，挑过的字符不会被抹掉。 */
const picked = new Set(SYMS);
let stash = new Set(SYMS);   // 上一次"开着"的那一盘，关行时备份、开行时还原
let hist = [];
let pw = '';

const $ = id => document.getElementById(id);

/* ══ 存储：扩展里用 chrome.storage，直接打开文件预览时退回 localStorage ══ */
const HAS_EXT = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
const store = {
  async read() {
    try {
      if (HAS_EXT) { const r = await chrome.storage.local.get('cast'); return r.cast || null; }
      const raw = localStorage.getItem('cast');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  async write(v) {
    try {
      if (HAS_EXT) { await chrome.storage.local.set({ cast: v }); return; }
      localStorage.setItem('cast', JSON.stringify(v));
    } catch (e) { /* 存不下就算了，不打断使用 */ }
  },
  async readSession() {
    try {
      if (HAS_EXT && chrome.storage.session) { const r = await chrome.storage.session.get('castPw'); return r.castPw || null; }
      return null;
    } catch (e) { return null; }
  },
  async writeSession(v) {
    try {
      if (HAS_EXT && chrome.storage.session) {
        if (v) await chrome.storage.session.set({ castPw: v });
        else await chrome.storage.session.remove('castPw');
      }
    } catch (e) {}
  }
};

function snapshot() {
  return {
    v: 1,
    sets: { upper: S.upper, lower: S.lower, digit: S.digit, custom: S.custom },
    len: S.len,
    ctext: ($('customIn').value || ''),
    picked: [...picked],
    stash: [...stash],
    opts: { exclude: S.exclude, nodup: S.nodup, wip: S.wip, clearOnClose: S.clearOnClose },
    hist: hist.map(h => ({ t: h.t, ts: h.ts }))
  };
}
function hydrate(s) {
  if (!s || typeof s !== 'object') return;
  if (s.sets) {
    S.upper = !!s.sets.upper; S.lower = !!s.sets.lower;
    S.digit = !!s.sets.digit; S.custom = !!s.sets.custom;
  }
  if (typeof s.len === 'number' && isFinite(s.len)) S.len = Math.min(64, Math.max(6, Math.round(s.len)));
  if (typeof s.ctext === 'string') {
    $('customIn').value = s.ctext;
    /* 上次留了个空开关：没字符就别让它亮着 */
    if (!s.ctext.trim()) S.custom = false;
  }
  if (Array.isArray(s.picked)) {
    picked.clear();
    s.picked.filter(c => SYMS.includes(c)).forEach(c => picked.add(c));
  }
  if (Array.isArray(s.stash)) {
    const back = s.stash.filter(c => SYMS.includes(c));
    if (back.length) stash = new Set(back);
  }
  if (s.opts) {
    S.exclude = !!s.opts.exclude; S.nodup = !!s.opts.nodup;
    S.wip = !!s.opts.wip; S.clearOnClose = !!s.opts.clearOnClose;
  }
  if (Array.isArray(s.hist)) {
    hist = s.hist
      .filter(h => h && typeof h.t === 'string' && h.t.length)
      .slice(0, HIST_MAX)
      .map(h => ({ t: h.t, ts: Number(h.ts) || Date.now() }));
  }
}
function save() { store.write(snapshot()); }

/* ══ 真随机：crypto + 拒绝采样，避免取模偏移 ══════════════════ */
function rnd(n) {
  const lim = Math.floor(65536 / n) * n, a = new Uint16Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= lim);
  return a[0] % n;
}
function customChars() {
  const v = $('customIn').value || '';
  return [...new Set(v.replace(/\s/g, '').split(''))];
}
function pool() {
  let p = '';
  if (S.upper) p += SETS.upper;
  if (S.lower) p += SETS.lower;
  if (S.digit) p += SETS.digit;
  /* 符号按颗取，不按组取 —— 关掉 @ 就真的不会出现 @，而不是"概率上少一点" */
  p += SYMS.filter(c => picked.has(c)).join('');
  if (S.custom) p += customChars().join('');
  if (S.exclude) p = p.replace(AMBIG, '');
  return [...new Set(p.split(''))].join('');
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function shuffleNoRepeat(src, n) {
  /* 相邻不重复只能靠重洗，不保证绝不失败 —— 试 40 次还不行就交给调用方 */
  for (let k = 0; k < 40; k++) {
    const a = shuffle([...src]);
    let ok = true;
    for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1]) { ok = false; break; }
    if (ok) return a.slice(0, n).join('');
  }
  return null;
}
function generate() {
  const p = pool();
  if (!p.length) return null;
  const base = [...p];
  const groups = [];
  const push = arr => {
    const u = [...new Set(arr)].filter(c => base.includes(c));
    if (u.length) groups.push(u);
  };
  if (S.upper) push([...SETS.upper]);
  if (S.lower) push([...SETS.lower]);
  if (S.digit) push([...SETS.digit]);
  const live = SYMS.filter(c => picked.has(c));
  if (live.length) push(live);
  if (S.custom) push(customChars());

  const n = Math.max(S.len, groups.length);
  const out = [];
  const prev = () => out[out.length - 1];
  const pickFrom = set => {
    let s = set;
    if (S.nodup && s.length > 1) {
      const f = s.filter(c => c !== prev());
      if (f.length) s = f;
    }
    return s[rnd(s.length)];
  };
  /* 先给每个启用的组各塞一枚：这是"支持大写/小写/数字/符号"的实际含义，
     不是"概率上可能有" */
  groups.forEach(g => out.push(pickFrom(g)));
  while (out.length < n) out.push(pickFrom(base));

  if (S.nodup) {
    const strict = shuffleNoRepeat(out, n);
    if (strict) return strict;
  }
  return shuffle(out).slice(0, n).join('');
}

/* ══ 熵与强度 ═════════════════════════════════════════════════ */
function metrics() {
  const N = pool().length, L = S.len;
  const bits = N > 1 ? Math.round(L * Math.log2(N)) : 0;
  const sec = Math.pow(2, bits) / 2 / 1e11;
  return { bits, sec, lv: bits < 40 ? 1 : bits < 64 ? 2 : bits < 96 ? 3 : 4 };
}
function fmtSec(s) {
  if (!isFinite(s)) return '不可估';
  if (s < 0.001) return '瞬时';
  if (s < 1) return (s * 1000).toFixed(0) + ' 毫秒';
  if (s < 60) return s.toFixed(0) + ' 秒';
  if (s < 3600) return (s / 60).toFixed(0) + ' 分';
  if (s < 86400) return (s / 3600).toFixed(0) + ' 小时';
  if (s < 3.156e7) return (s / 86400).toFixed(0) + ' 天';
  const y = s / 3.156e7;
  if (y < 1e4) return y.toFixed(0) + ' 年';
  if (y < 1e8) return (y / 1e4).toFixed(1) + ' 万年';
  if (y < 1e13) return (y / 1e8).toFixed(1) + ' 亿年';
  return '远超宇宙年龄';
}

/* ══ 量字尺 ═══════════════════════════════════════════════════ */
function drawRuler(n) {
  const W = 200, step = W / n; let d = '';
  /* 长密码时刻度会密到看不清 —— 按位数降采样，五格一长照旧 */
  const stride = n > 44 ? 4 : n > 24 ? 2 : 1;
  for (let i = 0; i <= n; i += stride) {
    const x = (i * step).toFixed(2), lng = (i % 5 === 0);
    d += `<line x1="${x}" y1="${lng ? 12 : 19}" x2="${x}" y2="25" opacity="${lng ? '0.7' : '0.34'}"/>`;
  }
  $('ruler').innerHTML =
    `<line x1="0" y1="11.5" x2="200" y2="11.5" stroke="currentColor" stroke-width="1" opacity="0.30" vector-effect="non-scaling-stroke"/>`
    + `<g stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke">${d}</g>`;
}

/* ══ 渲染 ═════════════════════════════════════════════════════ */
function renderPW() {
  const el = $('pw');
  const m = metrics();
  if (!pool().length) {
    el.className = 'pw warn';
    el.textContent = '字盘全关，先打开至少一组字符';
    $('bits').textContent = '0'; $('crack').textContent = '—';
    $('segs').dataset.lv = '1'; $('lvname').textContent = '无字符';
    $('genBtn').disabled = true; $('genTxt').textContent = '至少选一组字符';
    /* 字盘全关时显示的是一句提示，不是密码 —— 复制按钮必须同时失效，
       否则会把上一枚旧的密码复制走，而屏幕上根本没有它 */
    $('copyBtn').disabled = true;
    $('pwMeta').textContent = '0 位';
    drawRuler(S.len);
    return;
  }
  $('genBtn').disabled = false; $('genTxt').textContent = '生成新密码';
  $('copyBtn').disabled = false;
  el.className = S.len > 27 ? 'pw long' : 'pw';
  el.textContent = pw || '—';
  $('pwMeta').textContent = pw.length + ' 位';
  $('bits').textContent = m.bits;
  $('crack').textContent = fmtSec(m.sec);
  $('segs').dataset.lv = m.lv;
  $('lvname').textContent = LVN[m.lv];
  drawRuler(S.len);
}
function syncTrays() {
  const n = SYMS.length, on = SYMS.filter(c => picked.has(c)).length;
  /* 开关是派生的：一颗都没选，整组就是关的 */
  S.symbol = on > 0;
  document.querySelectorAll('.tray').forEach(t => {
    t.setAttribute('aria-pressed', String(!!S[t.dataset.set]));
  });
  /* 关掉不等于忘掉：说清楚"还记着几颗"，用户才敢去关 */
  $('symMeta').textContent = on === n ? `${n} 个全开`
    : on === 0 ? (stash.size ? `已关 · 记住 ${stash.size} 颗` : '未选')
    : `已选 ${on} / ${n}`;
  $('symwrap').classList.toggle('off', on === 0);
  document.querySelectorAll('#symgrid .sym').forEach(b => {
    b.setAttribute('aria-pressed', String(picked.has(b.dataset.ch)));
    b.setAttribute('aria-label', '特殊字符 ' + b.dataset.ch + (picked.has(b.dataset.ch) ? '，已启用' : '，已关闭'));
  });
  const c = customChars();
  $('customGlyphs').textContent = c.length ? c.join(' ') : '· 未加入字盘 ·';
  $('customMeta').textContent = c.length ? `已并入 ${c.length} 个` : '未启用';
  $('cinWrap').classList.toggle('on', S.custom);
  document.querySelector('[data-panel="gen"]').classList.toggle('is-typing', S.custom);
}
function syncLen() {
  $('lnum').textContent = S.len;
  const r = $('len'); r.value = S.len;
  r.style.setProperty('--fill', ((S.len - 6) / (64 - 6) * 100) + '%');
}
function syncOpts() {
  document.querySelectorAll('.srow').forEach(r => {
    const on = !!S[r.dataset.opt];
    r.setAttribute('aria-pressed', String(on));
    r.querySelector('.sw').classList.toggle('on', on);
  });
}

/* ══ 副作用都要有一句解释 ═════════════════════════════════════ */
let tt;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 1900);
}

async function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 落到 execCommand */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* 30 秒后清空剪贴板：popup 随时会被关掉，计时必须交给后台 */
function scheduleWipe() {
  try {
    if (HAS_EXT && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'cast:schedule-wipe' });
      return;
    }
  } catch (e) {}
}
/* 撤回还没到点的那一次：用户把开关关掉了，就不该再动他的剪贴板 */
function cancelWipe() {
  try {
    if (HAS_EXT && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'cast:cancel-wipe' });
    }
  } catch (e) {}
}

let ct;
async function copyPW(text, btn, quiet) {
  if (!text) return;
  const ok = await writeClipboard(text);
  if (!ok) { toast('复制失败，请手动选中密码'); return; }
  touchHist(text);
  if (btn) {
    btn.classList.add('done');
    const t = $('copyTxt'); if (t) t.textContent = '已复制';
    clearTimeout(ct);
    ct = setTimeout(() => {
      btn.classList.remove('done');
      const t2 = $('copyTxt'); if (t2) t2.textContent = '复制';
    }, 1700);
  }
  if (S.wip) { scheduleWipe(); if (!quiet) toast('已复制 · 30 秒后清空剪贴板'); }
  else if (!quiet) toast('已复制');
}

/* ══ 历史：只存本机，最多 8 条 ════════════════════════════════ */
const COPY_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>';
const EMPTY_ICON = '<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z"/></svg>';

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  const t = new Date(ts), now = new Date();
  const hm = pad2(t.getHours()) + ':' + pad2(t.getMinutes());
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return '今天 ' + hm;
  const y = new Date(now.getTime() - 86400000);
  if (t.toDateString() === y.toDateString()) return '昨天 ' + hm;
  return (t.getMonth() + 1) + ' 月 ' + t.getDate() + ' 日';
}
function renderHist() {
  const ul = $('hlist');
  $('hcnt').textContent = hist.length;
  ul.textContent = '';
  if (!hist.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = EMPTY_ICON + '<b>还没有铸造记录</b>按一下「生成新密码」，或复制一枚';
    ul.appendChild(li);
    return;
  }
  hist.forEach((h, i) => {
    const li = document.createElement('li'); li.className = 'h-item';
    const fp = document.createElement('span');
    fp.className = 'h-fp'; fp.setAttribute('aria-hidden', 'true');
    fp.textContent = [...h.t].slice(0, 2).join('');
    const txt = document.createElement('div'); txt.className = 'h-txt';
    const b = document.createElement('b'); b.textContent = h.t;
    const meta = document.createElement('i');
    meta.textContent = [...h.t].length + ' 位 · ' + relTime(h.ts);
    txt.append(b, meta);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ib';
    btn.dataset.copy = String(i);
    btn.setAttribute('aria-label', '复制这一条');
    btn.innerHTML = COPY_ICON;
    li.append(fp, txt, btn);
    ul.appendChild(li);
  });
}
function touchHist(text) {
  hist = hist.filter(h => h.t !== text);
  hist.unshift({ t: text, ts: Date.now() });
  if (hist.length > HIST_MAX) hist.length = HIST_MAX;
  renderHist(); save();
}

/* ══ 铸造一次 ═════════════════════════════════════════════════ */
function draw(record) {
  const next = generate();
  if (next === null) { pw = ''; renderPW(); return; }
  pw = next;
  $('pw').classList.remove('pop-anim'); void $('pw').offsetWidth;
  $('pw').classList.add('pop-anim');
  renderPW();
  if (record) touchHist(pw);
  if (!S.clearOnClose) store.writeSession({ pw });
}

/* ══════════════════════════════════════════════════════════════
   状态切换
   ══════════════════════════════════════════════════════════════ */
/* 一：两个视图 */
function goView(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = b.dataset.go === name;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  document.querySelector('.body').scrollTop = 0;
}

/* 二：字盘 */
function toggleSet(k) {
  if (k === 'symbol') {
    if (picked.size) {
      /* 关：先把这一盘存下来，再整组退出字盘 */
      stash = new Set(picked);
      picked.clear();
      syncTrays(); save(); draw(false);
      toast(`特殊字符已关 · 记住 ${stash.size} 颗，再打开原样回来`);
      return;
    }
    /* 开：还原上次那一盘；从没挑过（stash 空）才退回全开 */
    const back = [...stash].filter(c => SYMS.includes(c));
    (back.length ? back : SYMS).forEach(c => picked.add(c));
    syncTrays(); save(); draw(false);
    toast(`特殊字符已开 · 恢复 ${picked.size} 颗`);
    return;
  }
  S[k] = !S[k];
  syncTrays(); save();
  if (k !== 'custom') draw(false); else renderPW();
}

/* 三：设置弹层 */
const scrim = $('scrim'), sheet = $('sheet');
function openSheet(on) {
  scrim.classList.toggle('on', on);
  sheet.classList.toggle('on', on);
  $('setBtn').setAttribute('aria-expanded', String(on));
}

/* ══ 绑定 ═════════════════════════════════════════════════════ */
function bind() {
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => goView(b.dataset.go)));

  /* 25 颗字粒：一颗一个按钮，点一下关掉一个 */
  SYMS.forEach(ch => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sym'; b.dataset.ch = ch;
    b.textContent = ch;
    b.setAttribute('aria-pressed', 'true');
    $('symgrid').appendChild(b);
  });
  $('symgrid').addEventListener('click', e => {
    const b = e.target.closest('.sym');
    if (!b) return;
    const ch = b.dataset.ch;
    if (picked.has(ch)) picked.delete(ch); else picked.add(ch);
    syncTrays(); save(); draw(false);
  });

  document.querySelectorAll('.tray').forEach(t => {
    t.addEventListener('click', () => toggleSet(t.dataset.set));
  });

  $('customIn').addEventListener('input', () => {
    S.custom = !!$('customIn').value.trim() || S.custom;
    syncTrays(); save(); renderPW();
    if (!S.clearOnClose) store.writeSession({ pw });
  });

  $('len').addEventListener('input', e => { S.len = +e.target.value; syncLen(); save(); draw(false); });

  $('genBtn').addEventListener('click', () => { draw(true); });
  $('rerollBtn').addEventListener('click', () => { draw(true); toast('已重铸 · 旧密码不再保留'); });
  $('copyBtn').addEventListener('click', e => { copyPW(pw, e.currentTarget); });

  $('hlist').addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const item = hist[+b.dataset.copy];
    if (item) copyPW(item.t, null);
  });

  $('setBtn').addEventListener('click', () => openSheet(true));
  $('sheetX').addEventListener('click', () => openSheet(false));
  scrim.addEventListener('click', () => openSheet(false));

  document.querySelectorAll('.srow').forEach(r => {
    r.addEventListener('click', () => {
      const k = r.dataset.opt;
      S[k] = !S[k];
      syncOpts(); save();
      toast(r.querySelector('.t b').textContent + (S[k] ? '：已开启' : '：已关闭'));
      if (k === 'exclude' || k === 'nodup') draw(false);
      if (k === 'wip' && !S.wip) cancelWipe();
      if (k === 'clearOnClose') {
        if (S.clearOnClose) store.writeSession(null);
        else store.writeSession({ pw });
      }
    });
  });

  $('clearHist').addEventListener('click', () => {
    hist = []; renderHist(); save(); toast('铸造记录已清空');
  });

  /* ══ 一个意图，多条通路：点击 / 键盘 ══ */
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Space' || e.key === 'Enter') {
      if (e.target.tagName !== 'BUTTON') { e.preventDefault(); draw(true); }
    } else if (e.key === 'c' || e.key === 'C') {
      copyPW(pw, $('copyBtn'));
    } else if (e.key === 'ArrowLeft') {
      S.len = Math.max(6, S.len - 1); syncLen(); save(); draw(false);
    } else if (e.key === 'ArrowRight') {
      S.len = Math.min(64, S.len + 1); syncLen(); save(); draw(false);
    } else if (e.key === 'Escape') {
      openSheet(false);
    } else if (/^[1-4]$/.test(e.key)) {
      toggleSet(['upper', 'lower', 'digit', 'symbol'][+e.key - 1]);
    }
  });
}

/* ══ 启动 ═════════════════════════════════════════════════════ */
async function boot() {
  hydrate(await store.read());
  bind();
  syncLen(); syncTrays(); syncOpts();
  renderHist();
  goView('gen');

  let restored = false;
  if (!S.clearOnClose) {
    const sess = await store.readSession();
    if (sess && typeof sess.pw === 'string' && sess.pw) { pw = sess.pw; restored = true; }
  }
  if (restored) renderPW(); else draw(false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
