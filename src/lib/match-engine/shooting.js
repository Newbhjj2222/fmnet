// lib/match-engine/shooting.js

import {
  BALL,
  BALL_STATE,
  EVENTS,
  FIELD,
  clamp,
  distance,
} from "./constants";

import {
  kickBall,
} from "./ball";

function goalX(side) {
  return side === "home"
    ? FIELD.width
    : 0;
}

function insideGoalMouth(
  y
) {
  const half =
    FIELD.goalWidth / 2;

  return (
    y >=
      FIELD.centerY -
        half &&
    y <=
      FIELD.centerY +
        half
  );
}

function shotXG(
  shooter,
  goalY,
  defenders,
  team
) {
  const goal = {
    x: goalX(team.side),
    y: FIELD.centerY,
  };

  const d =
    distance(
      shooter,
      goal
    );

  const distanceFactor =
    clamp(
      1 -
        Math.max(
          0,
          d - 90
        ) /
          600,
      0.04,
      0.95
    );

  const angleFactor =
    clamp(
      1 -
        Math.abs(
          shooter.y -
            FIELD.centerY
        ) /
          400,
      0.35,
      1
    );

  const pressure =
    defenders.reduce(
      (nearest, defender) =>
        Math.min(
          nearest,
          distance(
            shooter,
            defender
          )
        ),
      Infinity
    );

  const pressureFactor =
    clamp(
      pressure / 130,
      0.35,
      1
    );

  const finishing =
    shooter.shooting /
    100;

  const xg =
    0.025 +
    distanceFactor *
      0.22 +
    angleFactor *
      0.15 +
    finishing *
      0.22 +
    pressureFactor *
      0.12;

  return clamp(
    xg,
    0.02,
    0.75
  );
}

function goalkeeperSaveChance(
  goalkeeper,
  shooter,
  shotY,
  speed
) {
  const quality =
    goalkeeper.reaction *
      0.30 +
    goalkeeper.diving *
      0.25 +
    goalkeeper.positioning *
      0.20 +
    goalkeeper.handling *
      0.15 +
    goalkeeper.composure *
      0.10;

  const distance =
    Math.abs(
      shotY -
        goalkeeper.y
    );

  return clamp(
    0.18 +
      quality / 170 -
      distance / 850 -
      speed / 1500,
    0.08,
    0.82
  );
}

export function attemptShot(
  engine,
  team,
  opponents,
  shooter
) {
  if (
    !shooter?.hasBall
  ) {
    return false;
  }

  const goal = {
    x: goalX(team.side),
    y: FIELD.centerY,
  };

  const d =
    distance(
      shooter,
      goal
    );

  if (d > 560) {
    return false;
  }

  const defenders =
    opponents.players.filter(
      (p) =>
        !p.redCard &&
        p.position !== "GK"
    );

  const xg =
    shotXG(
      shooter,
      FIELD.centerY,
      defenders,
      team
    );

  team.stats.shots += 1;
  shooter.shots += 1;

  team.stats.xG += xg;

  const pressure =
    defenders.reduce(
      (nearest, defender) =>
        Math.min(
          nearest,
          distance(
            shooter,
            defender
          )
        ),
      Infinity
    );

  const shotQuality =
    shooter.shooting *
      0.50 +
    shooter.composure *
      0.25 +
    shooter.decisionMaking *
      0.15 +
    shooter.strength *
      0.10;

  const accuracy =
    clamp(
      0.72 +
        shotQuality / 400 -
        (130 -
          Math.min(
            130,
            pressure
          )) /
          900,
      0.45,
      0.96
    );

  let targetY =
    FIELD.centerY +
    (Math.random() -
      0.5) *
      FIELD.goalWidth *
      1.15;

  if (
    Math.random() >
    accuracy
  ) {
    targetY +=
      (Math.random() -
        0.5) *
      120;
  }

  const speed =
    clamp(
      230 +
        shooter.shooting *
          1.35,
      190,
      BALL.maxShotSpeed
    );

  kickBall(
    engine.ball,
    shooter,
    {
      x: goal.x,
      y: targetY,
    },
    speed,
    BALL_STATE.SHOOTING
  );

  engine.ball.type =
    "shot";

  engine.ball.targetId =
    `goal-${team.side}`;

  engine.lastShot = {
    shooterId: shooter.id,
    team: team.side,
    xg,
    time:
      engine.simSeconds,
  };

  engine.addEvent({
    type: EVENTS.SHOT,
    team: team.side,
    player: shooter,
    text: `${shooter.name} shoots`,
    xg,
  });

  return true;
}

export function resolveShot(
  engine,
  team,
  opponents
) {
  const goalkeeper =
    opponents.players.find(
      (p) =>
        p.position ===
        "GK" &&
        !p.redCard
    );

  if (!goalkeeper) {
    return false;
  }

  const shotY =
    engine.ball.y;

  const speed =
    Math.hypot(
      engine.ball.vx,
      engine.ball.vy
    );

  const onTarget =
    insideGoalMouth(
      shotY
    );

  if (!onTarget) {
    engine.addEvent({
      type: EVENTS.SHOT,
      team: team.side,
      player:
        engine.getPlayer(
          engine.lastShot?.shooterId
        ),
      text: `Shot goes wide`,
    });

    return false;
  }

  const saveChance =
    goalkeeperSaveChance(
      goalkeeper,
      engine.getPlayer(
        engine.lastShot?.shooterId
      ),
      shotY,
      speed
    );

  if (
    Math.random() <
    saveChance
  ) {
    team.stats.shotsOnTarget +=
      1;

    const shooter =
      engine.getPlayer(
        engine.lastShot?.shooterId
      );

    if (shooter) {
      shooter.shotsOnTarget +=
        1;
    }

    opponents.stats.saves +=
      1;

    goalkeeper.performance +=
      1;

    engine.ball.state =
      BALL_STATE.SAVED;

    engine.ball.ownerId =
      goalkeeper.id;

    engine.ball.x =
      goalkeeper.x;

    engine.ball.y =
      goalkeeper.y;

    goalkeeper.hasBall =
      true;

    engine.addEvent({
      type: EVENTS.SAVE,
      team: opponents.side,
      player: goalkeeper,
      relatedPlayer: shooter,
      text: `${goalkeeper.name} makes a save`,
    });

    return true;
  }

  team.stats.shotsOnTarget +=
    1;

  const shooter =
    engine.getPlayer(
      engine.lastShot?.shooterId
    );

  if (shooter) {
    shooter.shotsOnTarget +=
      1;
  }

  engine.scoreGoal(
    team,
    shooter
  );

  return true;
}
