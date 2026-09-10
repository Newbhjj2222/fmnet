export default class Vector2 {
  constructor(x = 0, y = 0) { this.x = Number(x) || 0; this.y = Number(y) || 0; }
  clone() { return new Vector2(this.x, this.y); }
  set(x, y) { this.x = x; this.y = y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  subtract(v) { this.x -= v.x; this.y -= v.y; return this; }
  multiply(v) { this.x *= v; this.y *= v; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  normalize() { const l = this.length(); if (!l) return this; this.x /= l; this.y /= l; return this; }
  distanceTo(v) { const dx = this.x - v.x; const dy = this.y - v.y; return Math.sqrt(dx * dx + dy * dy); }
  static distance(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  static lerp(a, b, t) { return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
}
