import Vector2 from "./Vector2";

import {
  BALL_STATE,
  PITCH,
} from "./constants";

export default class Ball {
  constructor() {
    this.position =
      new Vector2(
        PITCH.width / 2,
        PITCH.height / 2
      );

    this.velocity =
      new Vector2();

    this.ownerId = null;

    this.targetId = null;

    this.lastTouchTeam = null;

    this.lastTouchPlayer = null;

    this.state =
      BALL_STATE.IDLE;

    this.flightTime = 0;

    this.maxFlightTime = 0;
  }

  attach(player) {
    if (!player) return;

    this.ownerId = player.id;

    this.targetId = null;

    this.position.set(
      player.x,
      player.y
    );

    this.velocity.set(0, 0);

    this.state =
      BALL_STATE.IDLE;

    player.hasBall = true;
  }

  kick(
    from,
    target,
    speed = 300,
    state = BALL_STATE.PASSING,
    targetId = null
  ) {
    if (!from || !target) {
      return;
    }

    const targetX =
      target.x ??
      target.position?.x ??
      this.position.x;

    const targetY =
      target.y ??
      target.position?.y ??
      this.position.y;

    const direction =
      new Vector2(
        targetX - from.x,
        targetY - from.y
      );

    const distance =
      Math.max(
        1,
        direction.length()
      );

    direction.normalize();

    this.position.set(
      from.x,
      from.y
    );

    this.velocity
      .copy(direction)
      .multiply(speed);

    this.ownerId = null;

    this.targetId = targetId;

    this.lastTouchTeam =
      from.team;

    this.lastTouchPlayer =
      from.id;

    this.state = state;

    this.flightTime = 0;

    this.maxFlightTime =
      Math.min(
        2.1,
        Math.max(
          0.25,
          distance / speed
        )
      );

    from.hasBall = false;
  }

  update(dt) {
    if (this.ownerId) {
      return;
    }

    this.position.x +=
      this.velocity.x * dt;

    this.position.y +=
      this.velocity.y * dt;

    this.flightTime += dt;

    const damping =
      Math.pow(
        0.985,
        dt * 60
      );

    this.velocity
      .multiply(damping);

    if (
      this.flightTime >
        this.maxFlightTime &&
      this.velocity.length() < 30
    ) {
      this.velocity.set(0, 0);

      this.state =
        BALL_STATE.IDLE;

      this.targetId = null;
    }
  }

  stop() {
    this.velocity.set(0, 0);

    this.targetId = null;

    this.state =
      BALL_STATE.IDLE;
  }

  toSnapshot() {
    return {
      x: this.position.x,

      y: this.position.y,

      ownerId: this.ownerId,

      targetId: this.targetId,

      lastTouchTeam:
        this.lastTouchTeam,

      lastTouchPlayer:
        this.lastTouchPlayer,

      state: this.state,
    };
  }
}
