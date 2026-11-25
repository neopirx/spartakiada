// Arcade-style menu navigation shared by every screen.
//
// A screen's focusable items are the elements with class `mi` (buttons /
// links) or `opt` (option rows: ◀ value ▶). Keyboard, gamepad and mouse all
// drive the same focus:
//   ↑ ↓ / W S / d-pad      move focus
//   ← → / A D / d-pad      change an option row (or the screen's own handler)
//   Enter / Space / A      activate
//   Esc / Backspace / B    back
import { deaccent } from './text.js';

const UP = ['ArrowUp', 'KeyW', 'Pad12'];
const DOWN = ['ArrowDown', 'KeyS', 'Pad13'];
const LEFT = ['ArrowLeft', 'KeyA', 'Pad14'];
const RIGHT = ['ArrowRight', 'KeyD', 'Pad15'];
const OK = ['Enter', 'NumpadEnter', 'Space', 'Pad0', 'Pad9'];
const BACK = ['Escape', 'Backspace', 'Pad1'];

export class MenuNav {
  constructor(audio) {
    this.audio = audio;
    this.el = null;
    this.items = [];
    this.idx = 0;
    this.opts = {};
    this.memory = new Map(); // screen id -> last focused index
  }

  /**
   * Make `el` the active screen.
   * @param {HTMLElement} el
   * @param {{onBack?: Function, onLeftRight?: (dir:number)=>boolean, focus?: HTMLElement|number}} opts
   */
  set(el, opts = {}) {
    if (this.el) this.memory.set(this.el.id, this.idx);
    for (const it of this.items) it.classList.remove('focus');
    this.el = el;
    this.opts = opts;
    this.refresh();
    let i = this.memory.get(el.id) ?? 0;
    if (typeof opts.focus === 'number') i = opts.focus;
    else if (opts.focus) i = Math.max(0, this.items.indexOf(opts.focus));
    this.focus(i, false);
  }

  clear() {
    if (this.el) this.memory.set(this.el.id, this.idx);
    for (const it of this.items) it.classList.remove('focus');
    this.el = null;
    this.items = [];
  }

  // re-scan the screen (after items were added / removed)
  refresh() {
    if (!this.el) return;
    this.items = [...this.el.querySelectorAll('.mi, .opt')].filter((e) => !e.disabled && e.offsetParent !== null);
    for (const it of this.items) {
      if (it._navBound) continue;
      it._navBound = true;
      it.addEventListener('mouseenter', () => {
        const i = this.items.indexOf(it);
        if (i >= 0 && i !== this.idx) this.focus(i, true);
      });
    }
    if (this.idx >= this.items.length) this.idx = Math.max(0, this.items.length - 1);
  }

  focus(i, sound = true) {
    if (!this.items.length) return;
    this.idx = (i + this.items.length) % this.items.length;
    this.items.forEach((e, k) => e.classList.toggle('focus', k === this.idx));
    const cur = this.items[this.idx];
    cur.scrollIntoView?.({ block: 'nearest' });
    if (sound) this.audio.ui('move');
    this.opts.onFocus?.(cur);
  }

  get current() {
    return this.items[this.idx];
  }

  /** @param {import('../game/input.js').Input} input */
  update(input) {
    // every press, in order (several can land in one slow frame)
    for (const code of input.queue) {
      if (!this.el) return;
      this.key(code);
    }
  }

  key(code) {
    const is = (codes) => codes.includes(code);
    if (is(UP)) this.focus(this.idx - 1);
    else if (is(DOWN)) this.focus(this.idx + 1);
    else if (is(LEFT) || is(RIGHT)) {
      const dir = is(LEFT) ? -1 : 1;
      const cur = this.current;
      if (cur && cur._change) {
        cur._change(dir);
        this.audio.ui('tick');
      } else if (this.opts.onLeftRight?.(dir)) this.audio.ui('tick');
      else if (cur && cur.closest('.row-nav')) this.focus(this.idx + dir);
    } else if (is(OK)) {
      const cur = this.current;
      if (!cur) return;
      if (cur._change) {
        cur._change(1);
        this.audio.ui('tick');
      } else cur.click();
    } else if (is(BACK) && this.opts.onBack) {
      this.audio.ui('back');
      this.opts.onBack();
    }
  }
}

/**
 * Option row: LABEL  ◀ value ▶
 * @param {{label: string, sub?: string, values: Array<{v: any, label: string}>, get: () => any, set: (v:any) => void, bar?: boolean}} o
 */
export function optionRow(o) {
  const row = document.createElement('div');
  row.className = 'opt';
  row.tabIndex = -1;
  row.innerHTML = `<span class="opt-label">${deaccent(o.label)}${o.sub ? `<small>${o.sub}</small>` : ''}</span>
    <span class="opt-val"><b class="arr l">◀</b><span class="v"></span><b class="arr r">▶</b></span>`;
  const vEl = row.querySelector('.v');
  const index = () => Math.max(0, o.values.findIndex((x) => x.v === o.get()));
  const render = () => {
    const i = index();
    if (o.bar) {
      const n = o.values.length - 1;
      vEl.innerHTML = `<span class="bar">${'<i class="on"></i>'.repeat(i)}${'<i></i>'.repeat(n - i)}</span>`;
    } else vEl.textContent = o.values[i].label;
  };
  row._change = (dir) => {
    const n = o.values.length;
    let i = index() + dir;
    if (o.bar) i = Math.max(0, Math.min(n - 1, i));
    else i = (i + n) % n;
    o.set(o.values[i].v);
    render();
  };
  row._render = render;
  row.querySelector('.arr.l').addEventListener('click', (e) => {
    e.stopPropagation();
    row._change(-1);
  });
  row.querySelector('.arr.r').addEventListener('click', (e) => {
    e.stopPropagation();
    row._change(1);
  });
  render();
  return row;
}
