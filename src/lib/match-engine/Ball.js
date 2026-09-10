import Vector2 from "./Vector2";
import {
  BALL_STATE,
  PITCH,
} from "./constants";

export default class Ball {
  constructor() {
    this.position = new Vector2(
      PITCH.width / 2,
      PITCH.height / 2
    );

    this.velocity = new Vector2();

    this.ownerId = null;

    this.state = BALL_STATE.FREE;

    this.radius = PITCH.ballRadius;

    this.passTargetId = null;
  }

  attachTo(player) {
    this.ownerId = player.id;

    this.position.set(
      player.x,
      player.y
    );

    this.velocity.multiply(0);

    this.state =
      BALL_STATE.POSSESSED;
  }

  release(x, y) {
    this.ownerId = null;

    this.position.set(x, y);

    this.state = BALL_STATE.FREE;
  }

  update(dt, players = []) {
    if (this.ownerId) {
      const owner =
        players.find(
          player =>
            player.id === this.ownerId
        );

      if (owner) {
        this.position.x = owner.x;
        this.position.y = owner.y;

        this.velocity.multiply(0);

        return;
      }

      this.ownerId = null;
    }

    this.position.x +=
      this.velocity.x * dt;

    this.position.y +=
      this.velocity.y * dt;

    this.velocity.x *=
      Math.pow(0.35, dt);

    this.velocity.y *=
      Math.pow(0.35, dt);

    if (
      this.position.x <
      this.radius
    ) {
      this.position.x =
        this.radius;

      this.velocity.x *= -0.5;
    }

    if (
      this.position.x >
      PITCH.width - this.radius
    ) {
      this.position.x =
        PITCH.width - this.radius;

      this.velocity.x *= -0.5;
    }

    if (
      this.position.y <
      this.radius
    ) {
      this.position.y =
        this.radius;

      this.velocity.y *= -0.5;
    }

    if (
      this.position.y >
      PITCH.height - this.radius
    ) {
      this.position.y =
        PITCH.height - this.radius;

      this.velocity.y *= -0.5;
    }
  }
}
