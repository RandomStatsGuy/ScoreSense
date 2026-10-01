export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const GRAVITY = 460;

export function toyBounds(toy) {
  return { left: toy.x - 50, right: toy.x + 50, top: toy.y - (toy.anchor ? 50 : 100), bottom: toy.y + (toy.anchor ? 50 : 0) };
}

export function releaseState(toy, position, velocity = {}) {
  return { x: position.x, y: position.y, vx: clamp(velocity.x || 0, -350, 350), vy: clamp(velocity.y || 0, -350, 350), rotation: position.rotation || 0, age: 0, settled: false };
}

// Integrate only while a released prop is moving. Bound dt after a background tab
// so a suspended frame cannot throw a toy outside its square.
export function stepToy(toy, previous, elapsed) {
  const dt = clamp(elapsed, .001, .025);
  const bounds = toyBounds(toy);
  let { x, y, vx, vy, rotation, age } = previous;
  let ax = 0, ay = GRAVITY;
  age += dt;
  if (toy.anchor) {
    const dx = x - toy.anchor.x, dy = y - toy.anchor.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const rest = Math.max(8, Math.hypot(toy.x - toy.anchor.x, toy.y - toy.anchor.y) - GRAVITY / 70);
    const pull = Math.max(0, Math.max(0, length - rest) * 70 + (vx * dx + vy * dy) / length * 3.5);
    ax -= pull * dx / length;
    ay -= pull * dy / length;
  }
  vx = (vx + ax * dt) * Math.exp(-1.8 * dt);
  vy = (vy + ay * dt) * Math.exp(-1.8 * dt);
  x += vx * dt;
  y += vy * dt;
  if (x < bounds.left || x > bounds.right) { x = clamp(x, bounds.left, bounds.right); vx *= -.3; }
  if (y < bounds.top) { y = bounds.top; vy = Math.abs(vy) * .3; }
  if (y >= bounds.bottom) {
    y = bounds.bottom;
    vy = -Math.abs(vy) * .32;
    if (Math.abs(vy) < 18) vy = 0;
    vx *= Math.exp(-8 * dt);
  }
  rotation = toy.anchor ? -Math.atan2(x - toy.anchor.x, Math.max(1, y - toy.anchor.y)) * 180 / Math.PI : rotation + vx * dt * .7;
  const restX = toy.anchor?.x ?? x;
  const restY = toy.anchor ? toy.anchor.y + Math.hypot(toy.x - toy.anchor.x, toy.y - toy.anchor.y) : y;
  const settled = age > 8 || (toy.anchor
    ? Math.hypot(vx, vy) < 3 && Math.abs(x - restX) < .5 && Math.abs(y - restY) < .6
    : Math.abs(vx) < 2 && vy === 0 && y === bounds.bottom);
  return settled ? { x: restX, y: restY, vx: 0, vy: 0, rotation: toy.anchor ? 0 : rotation, age, settled } : { x, y, vx, vy, rotation, age, settled };
}
