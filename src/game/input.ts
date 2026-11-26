/** Touch (joystick + look drag + buttons) and keyboard/mouse input for battles. */
export class Input {
  /** Camera-relative joystick, -1..1 (y up = forward on screen). */
  joyX = 0;
  joyY = 0;
  /** Tank-relative keyboard drive. */
  keyThrottle = 0;
  keySteer = 0;
  usingKeys = false;
  lookDX = 0;
  lookDY = 0;
  firing = false;
  zoomPressed = false;
  artyPressed = false;
  readonly touch: boolean;

  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private joyBase: HTMLDivElement;
  private joyKnob: HTMLDivElement;
  private cleanup: (() => void)[] = [];

  constructor(private root: HTMLElement, private canvas: HTMLCanvasElement) {
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    root.appendChild(this.joyBase);
    this.showJoy(false);

    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    root.appendChild(zone);

    this.on(zone, 'pointerdown', (e) => this.pointerDown(e as PointerEvent));
    this.on(window, 'pointermove', (e) => this.pointerMove(e as PointerEvent));
    this.on(window, 'pointerup', (e) => this.pointerUp(e as PointerEvent));
    this.on(window, 'pointercancel', (e) => this.pointerUp(e as PointerEvent));
    this.on(window, 'keydown', (e) => this.key(e as KeyboardEvent, true));
    this.on(window, 'keyup', (e) => this.key(e as KeyboardEvent, false));
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.firing = false;
      this.updateKeys();
    });
    this.on(document, 'mousemove', (e) => {
      const m = e as MouseEvent;
      if (document.pointerLockElement === this.canvas || (m.buttons & 2) !== 0) {
        this.lookDX += m.movementX;
        this.lookDY += m.movementY;
      }
    });
    this.on(zone, 'contextmenu', (e) => e.preventDefault());
  }

  private on(t: EventTarget, ev: string, fn: (e: Event) => void): void {
    t.addEventListener(ev, fn, { passive: false });
    this.cleanup.push(() => t.removeEventListener(ev, fn));
  }

  bindButton(el: HTMLElement, down: () => void, up?: () => void): void {
    this.on(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      down();
    });
    if (up) {
      this.on(el, 'pointerup', (e) => {
        e.preventDefault();
        up();
      });
      this.on(el, 'pointerleave', () => up());
      this.on(el, 'pointercancel', () => up());
    }
  }

  private showJoy(v: boolean): void {
    this.joyBase.style.display = v ? 'block' : 'none';
  }

  private pointerDown(e: PointerEvent): void {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      // Desktop: lock pointer for mouse-look; left fires, right zooms.
      if (document.pointerLockElement !== this.canvas) {
        try {
          const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
          r?.catch?.(() => {});
        } catch {
          /* pointer lock not available (iframe, embedded browser) */
        }
      }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.zoomPressed = true;
      return;
    }
    const left = e.clientX < window.innerWidth * 0.45;
    if (left && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
      this.showJoy(true);
    } else if (!left && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private pointerMove(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      const max = 55;
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const dead = 0.15;
      const nx = dx / max;
      const ny = -dy / max;
      const m = Math.hypot(nx, ny);
      const k = m < dead ? 0 : (m - dead) / (1 - dead) / m;
      this.joyX = nx * k;
      this.joyY = ny * k;
      this.usingKeys = false;
    } else if (e.pointerId === this.lookId) {
      this.lookDX += (e.clientX - this.lookLast.x) * 1.6;
      this.lookDY += (e.clientY - this.lookLast.y) * 1.6;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.firing = false;
      return;
    }
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.joyX = 0;
      this.joyY = 0;
      this.showJoy(false);
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift', 'e', 'f'].includes(k)) {
      e.preventDefault();
    }
    if (down) {
      if (k === 'shift' || k === 'z') this.zoomPressed = true;
      if (k === 'e') this.artyPressed = true;
      if (k === ' ' || k === 'f') this.firing = true;
      this.keys.add(k);
    } else {
      if (k === ' ' || k === 'f') this.firing = false;
      this.keys.delete(k);
    }
    this.updateKeys();
  }

  private updateKeys(): void {
    const has = (...k: string[]) => k.some((x) => this.keys.has(x));
    this.keyThrottle = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
    this.keySteer = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
    if (this.keyThrottle !== 0 || this.keySteer !== 0) this.usingKeys = true;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  consumeZoom(): boolean {
    const z = this.zoomPressed;
    this.zoomPressed = false;
    return z;
  }

  consumeArty(): boolean {
    const a = this.artyPressed;
    this.artyPressed = false;
    return a;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    if (document.pointerLockElement) document.exitPointerLock();
    this.root.innerHTML = '';
  }
}
