import Vector2 from "./Vector2";
import {
  PLAYER_STATE,
  PITCH,
} from "./constants";

export default class Player {
  constructor(data) {
    this.id = data.id;
    this.teamId = data.teamId;
    this.teamSide = data.teamSide;

    this.number = data.number;
    this.name = data.name;

    this.position = data.position || "CM";

    this.x = data.x || 0;
    this.y = data.y || 0;

    this.homeX = this.x;
    this.homeY = this.y;

    this.targetX = this.x;
    this.targetY = this.y;

    this.velocity = new Vector2();

    this.speed = data.speed ?? 75;
    this.acceleration = data.acceleration ?? 70;

    this.stamina = data.stamina ?? 90;

    this.passing = data.passing ?? 70;
    this.shooting = data.shooting ?? 70;
    this.dribbling = data.dribbling ?? 70;
    this.tackling = data.tackling ?? 70;
    this.positioning = data.positioning ?? 70;
    this.vision = data.vision ?? 70;
    this.decisionMaking =
      data.decisionMaking ?? 70;
    this.composure =
      data.composure ?? 70;

    this.reaction = data.reaction ?? 70;
    this.handling = data.handling ?? 70;
    this.diving = data.diving ?? 70;

    this.state = PLAYER_STATE.IDLE;

    this.hasBall = false;

    this.radius = PITCH.playerRadius;
  }

  setTarget(x, y) {
    this.targetX = Math.max(
      this.radius,
      Math.min(
        PITCH.width - this.radius,
        x
      )
    );

    this.targetY = Math.max(
      this.radius,
      Math.min(
        PITCH.height - this.radius,
        y
      )
    );

    this.state = PLAYER_STATE.MOVING;
  }

  distanceToTarget() {
    return Math.sqrt(
      Math.pow(this.targetX - this.x, 2) +
      Math.pow(this.targetY - this.y, 2)
    );
  }

  distanceTo(other) {
    return Math.sqrt(
      Math.pow(this.x - other.x, 2) +
      Math.pow(this.y - other.y, 2)
    );
  }

  update(dt) {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;

    const distance = Math.sqrt(
      dx * dx + dy * dy
    );

    if (distance < 1) {
      this.velocity.multiply(0);
      this.state = this.hasBall
        ? PLAYER_STATE.POSSESSED
        : PLAYER_STATE.IDLE;

      return;
    }

    const directionX = dx / distance;
    const directionY = dy / distance;

    const staminaFactor =
      0.65 + (this.stamina / 100) * 0.35;

    const maxSpeed =
      this.speed *
      staminaFactor *
      0.9;

    const desiredVX =
      directionX * maxSpeed;

    const desiredVY =
      directionY * maxSpeed;

    const acceleration =
      this.acceleration * dt;

    this.velocity.x +=
      (desiredVX - this.velocity.x) *
      Math.min(1, acceleration);

    this.velocity.y +=
      (desiredVY - this.velocity.y) *
      Math.min(1, acceleration);

    const velocityLength =
      this.velocity.length();

    if (velocityLength > maxSpeed) {
      this.velocity
        .normalize()
        .multiply(maxSpeed);
    }

    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;

    this.x = Math.max(
      this.radius,
      Math.min(
        PITCH.width - this.radius,
        this.x
      )
    );

    this.y = Math.max(
      this.radius,
      Math.min(
        PITCH.height - this.radius,
        this.y
      )
    );

    if (this.stamina > 0) {
      const moving =
        Math.abs(this.velocity.x) +
        Math.abs(this.velocity.y) >
        5;

      if (moving) {
        this.stamina -= dt * 0.8;
        this.stamina = Math.max(
          0,
          this.stamina
        );
      }
    }
  }

  resetPosition() {
    this.x = this.homeX;
    this.y = this.homeY;

    this.targetX = this.homeX;
    this.targetY = this.homeY;

    this.velocity.multiply(0);

    this.hasBall = false;
    this.state = PLAYER_STATE.IDLE;
  }
}
