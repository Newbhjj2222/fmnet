import Vector2 from "./Vector2";
import {
  PITCH,
  PLAYER_STATE,
} from "./constants";

const numberValue = (value, fallback) => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
};

const clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

export default class Player {
  constructor(raw = {}, team = "home", index = 0) {
    this.id = String(
      raw.id ??
      raw.playerId ??
      raw.uid ??
      `${team}-${index}`
    );

    this.name = String(
      raw.name ??
      raw.fullName ??
      raw.playerName ??
      `Player ${index + 1}`
    );

    this.number = Math.max(
      1,
      Math.round(
        numberValue(
          raw.shirtNumber ??
          raw.number ??
          raw.jerseyNumber,
          index + 1
        )
      )
    );

    this.team = team;

    this.index = index;

    this.rawPosition = String(
      raw.position ??
      raw.pos ??
      raw.role ??
      (index === 0 ? "GK" : "MID")
    ).toUpperCase();

    this.position = this.normalizePosition(
      this.rawPosition
    );

    this.overall = clamp(
      numberValue(
        raw.overall ??
        raw.rating ??
        raw.ovr ??
        raw.score,
        65
      ),
      35,
      99
    );

    this.passing = clamp(
      numberValue(
        raw.passing ??
        raw.pass ??
        raw.passingRating,
        this.overall
      ),
      30,
      99
    );

    this.vision = clamp(
      numberValue(
        raw.vision ??
        raw.creativity,
        this.overall
      ),
      30,
      99
    );

    this.shooting = clamp(
      numberValue(
        raw.shooting ??
        raw.shoot ??
        raw.finishing,
        this.overall
      ),
      25,
      99
    );

    this.composure = clamp(
      numberValue(
        raw.composure ??
        raw.mental,
        this.overall
      ),
      30,
      99
    );

    this.dribbling = clamp(
      numberValue(
        raw.dribbling ??
        raw.dribble,
        this.overall
      ),
      25,
      99
    );

    this.tackling = clamp(
      numberValue(
        raw.tackling ??
        raw.defending ??
        raw.defence,
        this.overall
      ),
      25,
      99
    );

    this.defending = clamp(
      numberValue(
        raw.defending ??
        raw.defence ??
        raw.tackling,
        this.overall
      ),
      25,
      99
    );

    this.strength = clamp(
      numberValue(
        raw.strength ??
        raw.physical,
        this.overall
      ),
      30,
      99
    );

    this.pace = clamp(
      numberValue(
        raw.pace ??
        raw.speed,
        this.overall
      ),
      30,
      99
    );

    this.reaction = clamp(
      numberValue(
        raw.reaction ??
        raw.reflexes,
        this.overall
      ),
      30,
      99
    );

    this.diving = clamp(
      numberValue(
        raw.diving ??
        raw.gkDiving,
        this.overall
      ),
      30,
      99
    );

    this.handling = clamp(
      numberValue(
        raw.handling ??
        raw.gkHandling,
        this.overall
      ),
      30,
      99
    );

    this.stamina = clamp(
      numberValue(
        raw.stamina ??
        raw.condition,
        90
      ),
      25,
      100
    );

    this.fitness = clamp(
      numberValue(raw.fitness, 100),
      30,
      100
    );

    this.radius = 17;

    this.speed =
      76 +
      this.pace * 0.38;

    this.x = PITCH.width / 2;
    this.y = PITCH.height / 2;

    this.velocity = new Vector2();

    this.target = new Vector2(
      this.x,
      this.y
    );

    this.state = PLAYER_STATE.IDLE;

    this.hasBall = false;

    this.redCard = false;

    this.yellowCards = 0;

    this.injury = null;

    this.active = true;

    this.stats = {
      passes: 0,
      completedPasses: 0,

      shots: 0,
      shotsOnTarget: 0,

      goals: 0,
      assists: 0,

      tackles: 0,
      interceptions: 0,

      fouls: 0,

      yellow: 0,
      red: 0,
    };
  }

  normalizePosition(position) {
    const value = String(position || "")
      .toUpperCase();

    if (
      value.includes("GK") ||
      value.includes("KEEP")
    ) {
      return "GK";
    }

    if (
      value.includes("CB") ||
      value.includes("LB") ||
      value.includes("RB") ||
      value.includes("DEF")
    ) {
      return "DEF";
    }

    if (
      value.includes("ST") ||
      value.includes("CF") ||
      value.includes("FW") ||
      value.includes("ATT") ||
      value.includes("FWD")
    ) {
      return "FWD";
    }

    return "MID";
  }

  setTarget(x, y) {
    this.target.set(x, y);

    if (!this.hasBall) {
      this.state = PLAYER_STATE.MOVING;
    }
  }

  setPosition(x, y) {
    this.x = clamp(
      x,
      this.radius,
      PITCH.width - this.radius
    );

    this.y = clamp(
      y,
      this.radius,
      PITCH.height - this.radius
    );

    this.target.set(
      this.x,
      this.y
    );
  }

  update(dt) {
    if (
      !this.active ||
      this.redCard ||
      this.injury
    ) {
      this.velocity.set(0, 0);

      this.state =
        PLAYER_STATE.INJURED;

      return;
    }

    const dx =
      this.target.x - this.x;

    const dy =
      this.target.y - this.y;

    const distance =
      Math.sqrt(
        dx * dx +
        dy * dy
      );

    if (distance < 2) {
      this.velocity.set(0, 0);

      if (!this.hasBall) {
        this.state =
          PLAYER_STATE.IDLE;
      }

      this.stamina = clamp(
        this.stamina +
          dt * 0.75,
        0,
        100
      );

      return;
    }

    const direction =
      new Vector2(dx, dy)
        .normalize();

    const fatigue =
      this.stamina < 30
        ? 0.72
        : 1;

    const currentSpeed =
      this.speed * fatigue;

    this.velocity
      .copy(direction)
      .multiply(currentSpeed);

    this.x +=
      this.velocity.x * dt;

    this.y +=
      this.velocity.y * dt;

    this.x = clamp(
      this.x,
      this.radius,
      PITCH.width -
        this.radius
    );

    this.y = clamp(
      this.y,
      this.radius,
      PITCH.height -
        this.radius
    );

    const movementCost =
      (currentSpeed / 140) *
      dt *
      0.9;

    this.stamina = clamp(
      this.stamina -
        movementCost,
      0,
      100
    );

    this.state =
      this.hasBall
        ? PLAYER_STATE.POSSESSED
        : PLAYER_STATE.MOVING;
  }

  injure(reason = "knock") {
    if (this.injury) {
      return false;
    }

    this.injury = {
      reason,
      minute: 0,
    };

    this.active = false;

    this.hasBall = false;

    this.velocity.set(0, 0);

    this.state =
      PLAYER_STATE.INJURED;

    return true;
  }

  toSnapshot() {
    return {
      id: this.id,

      name: this.name,

      number: this.number,

      team: this.team,

      position: this.position,

      overall: this.overall,

      x: this.x,

      y: this.y,

      stamina: this.stamina,

      state: this.state,

      hasBall: this.hasBall,

      yellowCards:
        this.yellowCards,

      redCard:
        this.redCard,

      injury:
        this.injury,

      active:
        this.active,

      stats: {
        ...this.stats,
      },
    };
  }
}
