import Vector2 from "./Vector2";
import { BALL_STATE, PITCH, MATCH } from "./constants";

export default class Ball {
  constructor() {
    this.position = new Vector2(PITCH.width / 2, PITCH.height / 2);
    this.velocity = new Vector2();
    this.state = BALL_STATE.FREE;
    this.ownerId = null;
    this.targetId = null;
    this.radius = PITCH.ballRadius;
    this.lastTouchTeam = null;
    this.lastTouchPlayer = null;
    this.actionStartedAt = 0;
  }

  attach(player) {
    this.ownerId = player.id;
    this.targetId = null;
    this.position.set(player.x, player.y);
    this.velocity.multiply(0);
    this.state = BALL_STATE.POSSESSED;
    this.lastTouchTeam = player.teamSide;
    this.lastTouchPlayer = player.id;
  }

  kick(from, target, speed, state, targetId = null) {
    const dir = new Vector2(target.x - from.x, target.y - from.y);
    const d = dir.length();
    if (d === 0) return;
    dir.normalize();
    this.position.set(from.x, from.y);
    this.velocity.set(dir.x * speed, dir.y * speed);
    this.ownerId = null;
    this.targetId = targetId;
    this.state = state;
    this.actionStartedAt = performance.now();
  }

  update(dt) {
    if (this.ownerId) return;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    const friction = Math.pow(MATCH.BALL_FRICTION, dt);
    this.velocity.x *= friction;
    this.velocity.y *= friction;
    if (this.velocity.length() < 3) this.velocity.multiply(0);
  }

  stop() {
    this.velocity.multiply(0);
    this.ownerId = null;
    this.state = BALL_STATE.FREE;
  }

  isMoving() { return this.velocity.length() > 8; }
}
