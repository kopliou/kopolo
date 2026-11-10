// Keyboard and mouse state. Keys are tracked by physical position (event.code), so WASD works on any layout.

export class Input {
  constructor(canvas) {
    this.down = new Set(); // codes currently held
    this.pressed = new Set(); // codes pressed since the last frame
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, left: false };
    this.wheel = 0;
    // 'menu': the browser keeps every key; 'overlay': the game owns Tab; 'play': also Space and the arrows.
    this.guard = () => 'menu';

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const owner = this.guard();
      const owned = e.code === 'Tab' ? owner !== 'menu' : owner === 'play' && (e.code === 'Space' || e.code.startsWith('Arrow'));
      if (owned) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 0) this.mouse.left = true;
      else if (e.button === 2) this.pressed.add('MouseRight');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  // Forget held keys and buttons, e.g. when a menu opens or the window loses focus.
  reset() {
    this.down.clear();
    this.pressed.clear();
    this.mouse.left = false;
    this.wheel = 0;
  }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
  }
}
