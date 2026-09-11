// lib/match-engine/passing.js

import {
  BALL,
  BALL_STATE,
  FIELD,
  clamp,
  distance,
} from "./constants";

import {
  kickBall,
} from "./ball";

function openness(
  receiver,
  opponents
) {
  let nearest =
    Infinity;

  for (const opponent of opponents) {
    if (opponent.redCard) continue;

    nearest = Math.min(
      nearest,
      distance(
        receiver,
        opponent
      )
    );
  }

  return clamp(
    nearest / 180,
    0,
    1
  );
}

function forwardness(
  passer,
  receiver,
  direction
) {
  const delta =
    (receiver.x -
      passer.x) *
    direction;

  return clamp(
    0.5 +
      delta / 300,
    0,
    1
  );
}

function roleBonus(
  passer,
  receiver
) {
  if (
    passer.role === "GK"
  ) {
    return [
      "CB",
      "LB",
      "RB",
      "CDM",
    ].includes(
      receiver.role
    )
      ? 0.15
      : 0;
  }

  if (
    ["CM", "CDM"].includes(
      passer.role
    )
  ) {
    return [
      "CAM",
      "LW",
      "RW",
      "ST",
      "CF",
    ].includes(
      receiver.role
    )
      ? 0.14
      : 0;
  }

  return 0.04;
}

export function choosePassTarget(
  team,
  opponents,
  passer
) {
  const candidates =
    team.players.filter(
      (player) =>
        player.id !== passer.id &&
        !player.redCard &&
        distance(
          passer,
          player
        ) < 390
    );

  let best = null;
  let bestScore =
    -Infinity;

  for (const receiver of candidates) {
    const open =
      openness(
        receiver,
        opponents
      );

    const forward =
      forwardness(
        passer,
        receiver,
        team.attackDirection
      );

    const role =
      roleBonus(
        passer,
        receiver
      );

    const d =
      distance(
        passer,
        receiver
      );

    const distanceScore =
      1 -
      clamp(
        Math.abs(d - 150) /
          300,
        0,
        1
      );

    const score =
      open * 0.38 +
      forward * 0.30 +
      role * 0.12 +
      distanceScore * 0.20;

    if (
      score >
      bestScore
    ) {
      bestScore = score;
      best = receiver;
    }
  }

  return best;
}

export function attemptPass(
  engine,
  team,
  opponents,
  passer
) {
  if (!passer?.hasBall) {
    return false;
  }

  const target =
    choosePassTarget(
      team,
      opponents,
      passer
    );

  if (!target) {
    return false;
  }

  const d =
    distance(
      passer,
      target
    );

  const pressure =
    opponents.reduce(
      (nearest, opponent) =>
        Math.min(
          nearest,
          distance(
            passer,
            opponent
          )
        ),
      Infinity
    );

  const pressureFactor =
    clamp(
      pressure / 130,
      0.25,
      1
    );

  const quality =
    passer.passing *
    0.45 +
    passer.vision *
      0.25 +
    passer.decisionMaking *
      0.20 +
    passer.composure *
      0.10;

  const accuracy =
    clamp(
      0.72 +
        quality / 300 +
        pressureFactor * 0.12 -
        d / 1800,
      0.55,
      0.98
    );

  team.stats.passes += 1;
  passer.passes += 1;

  const successful =
    Math.random() <
    accuracy;

  let finalTarget = {
    x: target.x,
    y: target.y,
  };

  if (!successful) {
    const error =
      35 +
      (100 - passer.passing) *
      1.4;

    finalTarget = {
      x:
        target.x +
        (Math.random() -
          0.5) *
          error,

      y:
        target.y +
        (Math.random() -
          0.5) *
          error,
    };
  }

  const speed =
    clamp(
      130 +
        d * 0.65 +
        passer.passing,
      BALL.minPassSpeed,
      BALL.maxPassSpeed
    );

  kickBall(
    engine.ball,
    passer,
    finalTarget,
    speed,
    BALL_STATE.PASSING
  );

  if (successful) {
    team.stats.passesCompleted += 1;
    passer.passesCompleted += 1;
  }

  engine.addEvent({
    type: "pass",
    team: team.side,
    player: passer,
    relatedPlayer:
      successful
        ? target
        : null,
    text: successful
      ? `${passer.name} passes to ${target.name}`
      : `${passer.name} attempts a pass`,
  });

  return true;
}
