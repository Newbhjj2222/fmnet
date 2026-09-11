// lib/match-engine/movement.js

import {
  FIELD,
  PLAYER,
  PLAYER_STATES,
  clamp,
  distance,
} from "./constants";

import {
  defensiveDepth,
  widthModifier,
} from "./tactics";

function normalizeVector(
  dx,
  dy
) {
  const length =
    Math.hypot(dx, dy) || 1;

  return {
    x: dx / length,
    y: dy / length,
  };
}

function moveToward(
  player,
  target,
  dt,
  speedMultiplier = 1
) {
  const dx = target.x - player.x;
  const dy = target.y - player.y;

  const distanceToTarget =
    Math.hypot(dx, dy);

  if (distanceToTarget < 2) {
    player.vx *= 0.8;
    player.vy *= 0.8;
    return;
  }

  const direction =
    normalizeVector(dx, dy);

  const maxSpeed =
    Math.max(
      PLAYER.minSpeed,
      Math.min(
        PLAYER.maxSpeed,
        player.speed
      )
    ) *
    speedMultiplier;

  const desiredVx =
    direction.x * maxSpeed;

  const desiredVy =
    direction.y * maxSpeed;

  const acceleration =
    player.acceleration * dt;

  player.vx +=
    clamp(
      desiredVx - player.vx,
      -acceleration,
      acceleration
    );

  player.vy +=
    clamp(
      desiredVy - player.vy,
      -acceleration,
      acceleration
    );

  const velocity =
    Math.hypot(
      player.vx,
      player.vy
    );

  if (
    velocity > maxSpeed
  ) {
    player.vx =
      (player.vx / velocity) *
      maxSpeed;

    player.vy =
      (player.vy / velocity) *
      maxSpeed;
  }

  player.x +=
    player.vx * dt;

  player.y +=
    player.vy * dt;
}

function keepInsideField(
  player
) {
  const margin = 12;

  player.x = clamp(
    player.x,
    margin,
    FIELD.width - margin
  );

  player.y = clamp(
    player.y,
    margin,
    FIELD.height - margin
  );
}

function tacticalHomePosition(
  team,
  player,
  ball
) {
  const direction =
    team.attackDirection;

  let x =
    player.homeX;

  let y =
    player.homeY;

  const attacking =
    team.tactics.mentality ===
    "attacking";

  const defensive =
    team.tactics.mentality ===
    "defensive";

  const ballInfluence =
    clamp(
      (ball.x -
        FIELD.centerX) /
        FIELD.centerX,
      -1,
      1
    );

  const width =
    widthModifier(
      team.tactics.width
    );

  if (player.position === "GK") {
    x =
      team.side === "home"
        ? 0.055
        : 0.945;

    y =
      0.5 +
      ballInfluence * 0.06;

    return {
      x: x * FIELD.width,
      y: y * FIELD.height,
    };
  }

  const role = player.role;

  if (
    ["ST", "CF", "LW", "RW"].includes(
      role
    )
  ) {
    if (attacking) {
      x += 0.10 * direction;
    }

    if (defensive) {
      x -= 0.06 * direction;
    }
  }

  if (
    ["CM", "CAM", "LM", "RM"].includes(
      role
    )
  ) {
    if (attacking) {
      x += 0.05 * direction;
    }
  }

  if (
    ["LB", "RB", "LWB", "RWB"].includes(
      role
    ) &&
    attacking
  ) {
    x += 0.06 * direction;
  }

  if (
    ["CB", "CDM"].includes(role) &&
    defensive
  ) {
    x -= 0.04 * direction;
  }

  y =
    0.5 +
    (y - 0.5) *
      width;

  return {
    x: x * FIELD.width,
    y: y * FIELD.height,
  };
}

function attackingPosition(
  team,
  player,
  ball
) {
  const direction =
    team.attackDirection;

  const role =
    player.role;

  const ballX =
    ball.x;

  let x =
    player.homeX *
    FIELD.width;

  let y =
    player.homeY *
    FIELD.height;

  if (
    ["ST", "CF"].includes(role)
  ) {
    x +=
      direction *
      100;

    if (
      Math.abs(
        ball.y - y
      ) > 100
    ) {
      y +=
        (ball.y - y) *
        0.25;
    }
  }

  if (
    ["LW", "RW"].includes(role)
  ) {
    x +=
      direction *
      80;

    y +=
      (ball.y - y) *
      0.18;
  }

  if (
    ["CAM", "CM"].includes(role)
  ) {
    x +=
      direction *
      60;

    y +=
      (ball.y - y) *
      0.22;
  }

  if (
    ["LM", "RM"].includes(role)
  ) {
    x +=
      direction *
      50;
  }

  if (
    ["LB", "RB", "LWB", "RWB"].includes(
      role
    )
  ) {
    x +=
      direction *
      55;
  }

  if (
    ["CB", "CDM"].includes(role)
  ) {
    x +=
      direction *
      15;
  }

  if (
    team.tactics.counterAttack
  ) {
    x +=
      direction *
      clamp(
        (ballX -
          FIELD.centerX) *
          0.08,
        -25,
        25
      );
  }

  return {
    x,
    y,
  };
}

function defensivePosition(
  team,
  player,
  ball
) {
  const direction =
    team.attackDirection;

  let target =
    tacticalHomePosition(
      team,
      player,
      ball
    );

  const line =
    team.tactics.defensiveLine;

  const depth =
    defensiveDepth(line);

  target.x +=
    -direction *
    depth *
    FIELD.width;

  if (
    ["CB", "LB", "RB", "LWB", "RWB"].includes(
      player.role
    )
  ) {
    target.x +=
      (ball.x -
        FIELD.centerX) *
      0.08;
  }

  return target;
}

export function updatePlayerMovement(
  team,
  opponent,
  ball,
  dt
) {
  const opponentHasBall =
    opponent.players.some(
      (p) =>
        p.hasBall &&
        !p.redCard
    );

  const teamHasBall =
    team.players.some(
      (p) =>
        p.hasBall &&
        !p.redCard
    );

  const ballOwner =
    [...team.players, ...opponent.players]
      .find(
        (p) =>
          p.id ===
          ball.ownerId
      );

  for (const player of team.players) {
    if (
      player.redCard
    ) {
      player.vx *= 0.9;
      player.vy *= 0.9;
      continue;
    }

    let target;

    let state =
      PLAYER_STATES.SUPPORT;

    if (
      player.hasBall
    ) {
      state =
        PLAYER_STATES.CARRY;

      target =
        attackingPosition(
          team,
          player,
          ball
        );
    } else if (
      opponentHasBall
    ) {
      const d =
        ballOwner
          ? distance(
              player,
              ballOwner
            )
          : Infinity;

      const pressDistance =
        team.tactics.pressing ===
        "high"
          ? 165
          : team.tactics.pressing ===
            "low"
          ? 70
          : 110;

      if (
        d < pressDistance &&
        player.role !== "GK"
      ) {
        state =
          PLAYER_STATES.PRESS;

        target = {
          x:
            ballOwner.x -
            team.attackDirection *
              12,
          y:
            ballOwner.y,
        };
      } else {
        state =
          PLAYER_STATES.MARK;

        target =
          defensivePosition(
            team,
            player,
            ball
          );

        if (
          ballOwner &&
          ["CB", "CDM", "CM"].includes(
            player.role
          )
        ) {
          const laneX =
            ballOwner.x -
            team.attackDirection *
              55;

          target.x =
            target.x * 0.7 +
            laneX * 0.3;

          target.y =
            target.y * 0.65 +
            ballOwner.y * 0.35;
        }
      }
    } else if (
      teamHasBall
    ) {
      state =
        PLAYER_STATES.ATTACK;

      target =
        attackingPosition(
          team,
          player,
          ball
        );
    } else {
      state =
        PLAYER_STATES.SUPPORT;

      target =
        tacticalHomePosition(
          team,
          player,
          ball
        );
    }

    player.state = state;

    const staminaFactor =
      0.6 +
      player.stamina / 250;

    const pressingMultiplier =
      state ===
      PLAYER_STATES.PRESS
        ? 1.12
        : state ===
          PLAYER_STATES.ATTACK
        ? 1.04
        : 0.92;

    moveToward(
      player,
      target,
      dt,
      staminaFactor *
        pressingMultiplier
    );

    keepInsideField(player);

    const movement =
      Math.hypot(
        player.vx,
        player.vy
      );

    const sprinting =
      movement >
      player.speed * 0.7;

    let staminaDrain =
      movement > 10
        ? 0.008
        : 0.002;

    if (sprinting) {
      staminaDrain *= 1.8;
    }

    if (
      state ===
      PLAYER_STATES.PRESS
    ) {
      staminaDrain *= 2.2;
    }

    player.stamina =
      clamp(
        player.stamina -
          staminaDrain *
            dt *
            60,
        15,
        100
      );
  }
}
