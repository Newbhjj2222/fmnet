export default class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  set(x, y) {
    this.x = x;
    this.y = y;

    return this;
  }

  add(vector) {
    this.x += vector.x;
    this.y += vector.y;

    return this;
  }

  subtract(vector) {
    this.x -= vector.x;
    this.y -= vector.y;

    return this;
  }

  multiply(value) {
    this.x *= value;
    this.y *= value;

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

    if (length === 0) {
      return this;
    }

    this.x /= length;
    this.y /= length;

    return this;
  }

  distanceTo(vector) {
    const dx = this.x - vector.x;
    const dy = this.y - vector.y;

    return Math.sqrt(
      dx * dx +
      dy * dy
    );
  }

  angle() {
    return Math.atan2(
      this.y,
      this.x
    );
  }

  static distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(
      dx * dx +
      dy * dy
    );
  }

  static fromAngle(angle, magnitude = 1) {
    return new Vector2(
      Math.cos(angle) * magnitude,
      Math.sin(angle) * magnitude
    );
  }
}
