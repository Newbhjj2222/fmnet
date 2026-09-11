// lib/match-engine/shooting.js

import {
  BALL_STATE,
  EVENTS,
  FIELD,
  clamp,
  distance,
} from "./constants";

import {
  kickBallForShot,
  setBallOwner,
} from "./ball";

function attr(
  player,
  key,
  fallback = 50
) {
  const direct =
    Number(
      player?.[key]
    );

  if (
    Number.isFinite(direct)
  ) {
    return direct;
  }

  const nested =
    Number(
      player?.attributes?.[key]
    );

  if (
    Number.isFinite(nested)
  ) {
    return nested;
  }

  const rating =
    Number(
      player?.overall ??
      player?.rating ??
      fallback
    );

  return Number.isFinite(rating)
    ? rating
    : fallback;
}

function getGoalkeeper(
  team
) {
  return (
    team?.players?.find(
      (p) =>
        !p.redCard &&
        (
          p.position === "GK" ||
          p.role === "GK"
        )
    ) || null
  );
}

function getGoalX(team) {
  return team.attackDirection === -1
    ? 0
    : FIELD.width;
}

function getGoalMouthY() {
  return FIELD.centerY;
}

function calculateAngleQuality(
  player,
  team
) {
  const goalX =
    getGoalX(team);

  const dx =
    Math.abs(
      goalX -
        player.x
    );

  const dy =
    Math.abs(
      FIELD.centerY -
        player.y
    );

  const angle =
    Math.atan2(
      dy,
      Math.max(1, dx)
    );

  /*
    0 = straight in front
    ~0.8 = difficult angle
  */
  return clamp(
    1 -
      angle / 1.25,
    0.15,
    1
  );
}

function calculateXG(
  shooter,
  team,
  opponent
) {
  const goalX =
    getGoalX(team);

  const d =
    Math.hypot(
      goalX -
        shooter.x,
      FIELD.centerY -
        shooter.y
    );

  const shooting =
    attr(
      shooter,
      "shooting"
    );

  const composure =
    attr(
      shooter,
      "composure"
    );

  const pressure =
    getNearestDefenderDistance(
      shooter,
      opponent
    );

  const angle =
    calculateAngleQuality(
      shooter,
      team
    );

  /*
    Base probability decreases with distance.
  */
  let xg =
    0.42 *
    Math.exp(
      -d / 250
    );

  /*
    Quality of shooter.
  */
  xg *=
    0.65 +
    shooting / 180;

  xg *=
    0.75 +
    composure / 300;

  xg *=
    0.45 +
    angle * 0.65;

  /*
    Defender pressure.
  */
  if (
    pressure < 25
  ) {
    xg *= 0.48;
  } else if (
    pressure < 45
  ) {
    xg *= 0.72;
  } else if (
    pressure > 100
  ) {
    xg *= 1.08;
  }

  /*
    Long-distance shots remain possible.
  */
  if (
    d > 430
  ) {
    xg *= 0.35;
  }

  return clamp(
    xg,
    0.01,
    0.82
  );
}

function getNearestDefenderDistance(
  shooter,
  opponent
) {
  let best = Infinity;

  for (
    const defender of
      opponent?.players || []
  ) {
    if (
      defender.redCard
    ) {
      continue;
    }

    if (
      defender.position === "GK" ||
      defender.role === "GK"
    ) {
      continue;
    }

    const d =
      distance(
        shooter,
        defender
      );

    if (
      d < best
    ) {
      best = d;
    }
  }

  return best;
}

/**
 * Is player close enough to realistically shoot?
 */
export function canShoot(
  team,
  player
) {
  if (
    !team ||
    !player ||
    player.redCard ||
    !player.hasBall
  ) {
    return false;
  }

  const goalX =
    getGoalX(team);

  const d =
    Math.hypot(
      goalX -
        player.x,
      FIELD.centerY -
        player.y
    );

  /*
    Allow long shots, but rarely.
  */
  return d < 520;
}

/**
 * Select where the shot should go.
 */
function chooseShotTarget(
  team,
  goalkeeper
) {
  const goalX =
    getGoalX(team);

  const goalTop =
    FIELD.centerY - 38;

  const goalBottom =
    FIELD.centerY + 38;

  /*
    Aim away from goalkeeper.
  */
  if (
    goalkeeper
  ) {
    if (
      goalkeeper.y <
      FIELD.centerY
    ) {
      return {
        x: goalX,
        y:
          goalBottom -
          Math.random() * 14,
      };
    }

    return {
      x: goalX,
      y:
        goalTop +
        Math.random() * 14,
    };
  }

  return {
    x: goalX,
    y:
      FIELD.centerY +
      (Math.random() - 0.5) *
        60,
  };
}

/**
 * Attempt shot.
 */
export function attemptShot(
  engine,
  team,
  opponent,
  shooter
) {
  if (
    !engine ||
    !team ||
    !opponent ||
    !shooter
  ) {
    return false;
  }

  if (
    !canShoot(
      team,
      shooter
    )
  ) {
    return false;
  }

  if (
    engine.ball.ownerId !==
    shooter.id
  ) {
    return false;
  }

  const goalX =
    getGoalX(team);

  const distanceToGoal =
    Math.hypot(
      goalX -
        shooter.x,
      FIELD.centerY -
        shooter.y
    );

  const goalkeeper =
    getGoalkeeper(
      opponent
    );

  const pressure =
    getNearestDefenderDistance(
      shooter,
      opponent
    );

  const shooting =
    attr(
      shooter,
      "shooting"
    );

  const composure =
    attr(
      shooter,
      "composure"
    );

  const xg =
    calculateXG(
      shooter,
      team,
      opponent
    );

  const angleQuality =
    calculateAngleQuality(
      shooter,
      team
    );

  /*
    Don't let the engine shoot every frame.
  */
  const actionTime =
    Number(
      shooter.lastActionAt || 0
    );

  if (
    actionTime < 1.0
  ) {
    return false;
  }

  /*
    Shot accuracy.
  */
  let accuracy =
    0.72 +
    shooting / 350 +
    composure / 500;

  accuracy *=
    0.6 +
    angleQuality * 0.45;

  if (
    pressure < 30
  ) {
    accuracy -= 0.2;
  } else if (
    pressure < 55
  ) {
    accuracy -= 0.08;
  }

  if (
    Number(
      shooter.stamina ?? 100
    ) < 35
  ) {
    accuracy -= 0.08;
  }

  accuracy =
    clamp(
      accuracy,
      0.42,
      0.98
    );

  const target =
    chooseShotTarget(
      team,
      goalkeeper
    );

  /*
    Long shots have more error.
  */
  let error =
    16 -
    shooting * 0.08;

  if (
    distanceToGoal > 300
  ) {
    error += 12;
  }

  if (
    pressure < 40
  ) {
    error += 8;
  }

  error =
    clamp(
      error,
      3,
      42
    );

  /*
    Decide whether shot is on target.
  */
  const onTarget =
    Math.random() <
    accuracy;

  const finalTarget =
    onTarget
      ? target
      : {
          x:
            goalX +
            (Math.random() -
              0.5) *
              35,
          y:
            FIELD.centerY +
            (Math.random() -
              0.5) *
              180,
        };

  const speed =
    clamp(
      570 +
        shooting * 2.2,
      570,
      850
    );

  const kicked =
    kickBallForShot(
      engine.ball,
      shooter,
      finalTarget.x,
      finalTarget.y,
      {
        speed,
        error,
        xg,
      }
    );

  if (!kicked) {
    return false;
  }

  team.stats.shots =
    (team.stats.shots || 0) +
    1;

  team.stats.xG =
    (team.stats.xG || 0) +
    xg;

  shooter.shots =
    (shooter.shots || 0) +
    1;

  shooter.xG =
    (shooter.xG || 0) +
    xg;

  if (
    onTarget
  ) {
    team.stats.shotsOnTarget =
      (team.stats.shotsOnTarget ||
        0) + 1;

    shooter.shotsOnTarget =
      (shooter.shotsOnTarget ||
        0) + 1;
  }

  engine.lastShot = {
    team: team.side,
    playerId: shooter.id,
    playerName: shooter.name,
    xg,
    onTarget,
    targetX:
      finalTarget.x,
    targetY:
      finalTarget.y,
    time:
      engine.simSeconds,
  };

  engine.lastPass =
    engine.lastPass || null;

  engine.lastTouchTeam =
    team.side;

  engine.lastTouchPlayerId =
    shooter.id;

  shooter.lastActionAt = 0;

  if (
    typeof engine.addEvent ===
    "function"
  ) {
    engine.addEvent({
      type:
        EVENTS?.SHOT ||
        "shot",
      team: team.side,
      player: shooter,
      text:
        `${shooter.name} shoots`,
      xg,
    });
  }

  return true;
}

/**
 * Resolve shot once ball reaches goal area.
 */
export function resolveShot(
  engine,
  shootingTeam,
  defendingTeam
) {
  if (
    !engine ||
    !shootingTeam ||
    !defendingTeam ||
    !engine.lastShot
  ) {
    return false;
  }

  const shot =
    engine.lastShot;

  const shooter =
    engine.getPlayer
      ? engine.getPlayer(
          shot.playerId
        )
      : shootingTeam.players?.find(
          (p) =>
            p.id ===
            shot.playerId
        );

  if (!shooter) {
    return false;
  }

  const goalkeeper =
    getGoalkeeper(
      defendingTeam
    );

  const goalX =
    getGoalX(
      shootingTeam
    );

  const nearGoal =
    Math.abs(
      engine.ball.x -
        goalX
    ) < 55;

  if (!nearGoal) {
    return false;
  }

  /*
    Ball must actually be near goal mouth.
  */
  const insideGoalMouth =
    engine.ball.y >
      FIELD.centerY - 42 &&
    engine.ball.y <
      FIELD.centerY + 42;

  /*
    If it is outside the goal mouth,
    it is a miss.
  */
  if (
    !insideGoalMouth
  ) {
    registerMiss(
      engine,
      shootingTeam,
      shooter
    );

    return true;
  }

  /*
    Goal probability.
  */
  let goalChance =
    shot.xg;

  /*
    Strong goalkeeper reduces goal probability.
  */
  if (
    goalkeeper
  ) {
    const reaction =
      attr(
        goalkeeper,
        "reaction"
      );

    const diving =
      attr(
        goalkeeper,
        "diving"
      );

    const handling =
      attr(
        goalkeeper,
        "handling"
      );

    const gkQuality =
      (
        reaction +
        diving +
        handling
      ) / 300;

    goalChance *=
      1.08 -
      gkQuality * 0.48;

    /*
      If shot is very close, GK has less time.
    */
    const distanceToGoal =
      Math.hypot(
        goalX -
          shooter.x,
        FIELD.centerY -
          shooter.y
      );

    if (
      distanceToGoal < 110
    ) {
      goalChance *=
        1.2;
    }
  }

  goalChance =
    clamp(
      goalChance,
      0.01,
      0.92
    );

  /*
    A shot can be saved.
  */
  const goal =
    Math.random() <
    goalChance;

  if (goal) {
    engine.ball.state =
      BALL_STATE.GOAL;

    engine.ball.ownerId =
      null;

    if (
      goalkeeper
    ) {
      goalkeeper.hasBall =
        false;
    }

    engine.scoreGoal(
      shootingTeam,
      shooter
    );

    return true;
  }

  /*
    If goalkeeper is present, give him a chance
    to save on-target shots.
  */
  if (
    goalkeeper &&
    shot.onTarget
  ) {
    const reaction =
      attr(
        goalkeeper,
        "reaction"
      );

    const diving =
      attr(
        goalkeeper,
        "diving"
      );

    const positioning =
      attr(
        goalkeeper,
        "positioning"
      );

    const gkSaveChance =
      clamp(
        0.35 +
          reaction / 250 +
          diving / 350 +
          positioning / 450,
        0.3,
        0.88
      );

    if (
      Math.random() <
      gkSaveChance
    ) {
      goalkeeper.saves =
        (goalkeeper.saves || 0) +
        1;

      defendingTeam.stats.saves =
        (defendingTeam.stats.saves ||
          0) + 1;

      goalkeeper.hasBall =
        true;

      setBallOwner(
        engine.ball,
        goalkeeper
      );

      engine.ball.state =
        BALL_STATE.SAVED;

      engine.lastTouchTeam =
        defendingTeam.side;

      engine.lastTouchPlayerId =
        goalkeeper.id;

      if (
        typeof engine.addEvent ===
        "function"
      ) {
        engine.addEvent({
          type:
            EVENTS?.SAVE ||
            "save",
          team:
            defendingTeam.side,
          player:
            goalkeeper,
          relatedPlayer:
            shooter,
          text:
            `${goalkeeper.name} makes a save`,
        });
      }

      return true;
    }
  }

  /*
    Miss / post / deflection.
  */
  registerMiss(
    engine,
    shootingTeam,
    shooter
  );

  return true;
}

/**
 * Handle missed shot.
 */
function registerMiss(
  engine,
  team,
  shooter
) {
  engine.ball.ownerId =
    null;

  shooter.hasBall =
    false;

  engine.ball.state =
    BALL_STATE.FREE;

  engine.ball.vx *=
    0.25;

  engine.ball.vy *=
    0.25;

  if (
    typeof engine.addEvent ===
    "function"
  ) {
    engine.addEvent({
      type:
        EVENTS?.SHOT_MISSED ||
        "shot_missed",
      team: team.side,
      player: shooter,
      text:
        `${shooter.name}'s shot misses`,
    });
  }
}

/**
 * AI decision whether to shoot.
 */
export function shouldShoot(
  engine,
  team,
  opponent,
  player
) {
  if (
    !canShoot(
      team,
      player
    )
  ) {
    return false;
  }

  const goalX =
    getGoalX(team);

  const d =
    Math.hypot(
      goalX -
        player.x,
      FIELD.centerY -
        player.y
    );

  const shooting =
    attr(
      player,
      "shooting"
    );

  const pressure =
    getNearestDefenderDistance(
      player,
      opponent
    );

  /*
    Very close to goal.
  */
  if (
    d < 120
  ) {
    return true;
  }

  /*
    Normal scoring area.
  */
  if (
    d < 220
  ) {
    return (
      Math.random() <
      0.45 +
        shooting / 250
    );
  }

  /*
    Medium distance.
  */
  if (
    d < 320
  ) {
    return (
      Math.random() <
      0.16 +
        shooting / 500
    );
  }

  /*
    Long shots are uncommon.
  */
  if (
    d < 430 &&
    pressure > 65
  ) {
    return (
      Math.random() <
      0.07 +
        shooting / 900
    );
  }

  return false;
}
