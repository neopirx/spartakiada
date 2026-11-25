// Keyboard + gamepad input -> { throttle, brake, steer, airL, airR }
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.queue = []; // the same presses in the order they happened (menus)
    this.state = { throttle: 0, brake: false, steer: 0, airL: false, airR: false };
    this.padPrev = [];
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        this.queue.push(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  any(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  poll() {
    const k = (...c) => this.any(...c);
    let steer = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
    let throttle = k('ArrowUp', 'KeyW', 'Space') ? 1 : 0;
    let brake = k('ArrowDown', 'KeyS');
    let airL = k('KeyQ', 'KeyZ', 'ShiftLeft');
    let airR = k('KeyE', 'KeyC', 'ShiftRight');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88);
      if (p.buttons[14]?.pressed) steer = -1;
      if (p.buttons[15]?.pressed) steer = 1;
      const rt = p.buttons[7]?.value || 0;
      const a = p.buttons[0]?.pressed ? 1 : 0;
      throttle = Math.max(throttle, rt, a);
      if ((p.buttons[6]?.value || 0) > 0.3 || p.buttons[1]?.pressed) brake = true;
      if (p.buttons[4]?.pressed) airL = true;
      if (p.buttons[5]?.pressed) airR = true;
      p.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i]) {
          this.pressed.add(`Pad${i}`);
          this.queue.push(`Pad${i}`);
        }
        this.padPrev[i] = b.pressed;
      });
      break;
    }
    Object.assign(this.state, { throttle, brake, steer, airL, airR });
    return this.state;
  }

  endFrame() {
    this.pressed.clear();
    this.queue.length = 0;
  }
}
