export default class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
  }

  set(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;

    return this;
  }

  copy(vector) {
    this.x = vector?.x || 0;
    this.y = vector?.y || 0;

    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  add(vector) {
    this.x += vector?.x || 0;
    this.y += vector?.y || 0;

    return this;
  }

  subtract(vector) {
    this.x -= vector?.x || 0;
    this.y -= vector?.y || 0;

    return this;
  }

  multiply(value) {
    this.x *= Number(value) || 0;
    this.y *= Number(value) || 0;

    return this;
  }

  length() {
    return Math.sqrt(
      this.x * this.x +
      this.y * this.y
    );
  }

  normalize() {
    const length = this.length();

    if (length > 0.00001) {
      this.x /= length;
      this.y /= length;
    }

    return this;
  }

  distanceTo(vector) {
    const dx = this.x - (vector?.x || 0);
    const dy = this.y - (vector?.y || 0);

    return Math.sqrt(dx * dx + dy * dy);
  }

  static distance(a, b) {
    const dx = (a?.x || 0) - (b?.x || 0);
    const dy = (a?.y || 0) - (b?.y || 0);

    return Math.sqrt(dx * dx + dy * dy);
  }

  static lerp(a, b, amount) {
    return new Vector2(
      a.x + (b.x - a.x) * amount,
      a.y + (b.y - a.y) * amount
    );
  }
}
