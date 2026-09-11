// lib/match-engine/passing.js

import {
  BALL_STATE,
  FIELD,
  clamp,
  distance,
} from "./constants";

import {
  kickBallForPass,
  loftBall,
} from "./ball";

/**
 * Get numerical player attribute safely.
 */
function attr(player, key, fallback = 50) {
  const value = Number(
    player?.[key]
  );

  if (
    Number.isFinite(value)
  ) {
    return value;
  }

  const nested = Number(
    player?.attributes?.[key]
  );

  if (
    Number.isFinite(nested)
  ) {
    return nested;
  }

  const rating = Number(
    player?.overall ??
    player?.rating ??
    50
  );

  return Number.isFinite(rating)
    ? rating
    : fallback;
}

function rand(min, max) {
  return (
    Math.random() *
      (max - min) +
    min
  );
}

function getOpponentPlayers(
  opponent
) {
  return (opponent?.players || [])
    .filter(
      (p) =>
        p &&
        !p.redCard
    );
}

function nearestOpponentDistance(
  player,
  opponentPlayers
) {
  let best = Infinity;

  for (
    const opponent of opponentPlayers
  ) {
    const d = distance(
      player,
      opponent
    );

    if (d < best) {
      best = d;
    }
  }

  return best;
}

/**
 * Determine how far forward a target is.
 */
function forwardness(
  passer,
  target,
  direction
) {
  const dx =
    (target.x - passer.x) *
    direction;

  return clamp(
    dx / 250,
    -1,
    1
  );
}

/**
 * Is a player in a useful passing lane?
 */
function laneValue(
  passer,
  target,
  teammates,
  opponents,
  direction
) {
  const fx =
    forwardness(
      passer,
      target,
      direction
    );

  let value =
    0.5 + fx * 0.7;

  const targetPressure =
    nearestOpponentDistance(
      target,
      opponents
    );

  if (
    targetPressure > 70
  ) {
    value += 0.45;
  } else if (
    targetPressure > 45
  ) {
    value += 0.15;
  } else {
    value -= 0.25;
  }

  /*
    Prefer players that are not surrounded
    by many teammates.
  */
  let crowd = 0;

  for (
    const teammate of teammates
  ) {
    if (
      teammate.id === target.id
    ) {
      continue;
    }

    if (
      distance(
        teammate,
        target
      ) < 25
    ) {
      crowd += 1;
    }
  }

  value -= crowd * 0.12;

  return value;
}

/**
 * Find the best teammate to receive a pass.
 */
export function findBestPassTarget(
  team,
  opponent,
  passer
) {
  if (
    !team ||
    !passer
  ) {
    return null;
  }

  const teammates =
    (team.players || [])
      .filter(
        (p) =>
          p &&
          p.id !== passer.id &&
          !p.redCard
      );

  const opponents =
    getOpponentPlayers(
      opponent
    );

  if (!teammates.length) {
    return null;
  }

  const direction =
    Number(
      team.attackDirection
    ) === -1
      ? -1
      : 1;

  let best = null;
  let bestScore = -Infinity;

  for (
    const target of teammates
  ) {
    const d =
      distance(
        passer,
        target
      );

    if (
      d < 25 ||
      d > 360
    ) {
      continue;
    }

    const forward =
      forwardness(
        passer,
        target,
        direction
      );

    const openness =
      nearestOpponentDistance(
        target,
        opponents
      );

    const lane =
      laneValue(
        passer,
        target,
        teammates,
        opponents,
        direction
      );

    const vision =
      attr(
        passer,
        "vision"
      );

    const passing =
      attr(
        passer,
        "passing"
      );

    const targetPassing =
      attr(
        target,
        "passing"
      );

    const decision =
      attr(
        passer,
        "decisionMaking",
        attr(
          passer,
          "decision",
          50
        )
      );

    const role =
      String(
        target.role ||
        target.position ||
        ""
      ).toUpperCase();

    let roleBonus = 0;

    if (
      [
        "CM",
        "CDM",
        "CAM",
        "CF",
      ].includes(role)
    ) {
      roleBonus += 0.25;
    }

    if (
      [
        "LW",
        "RW",
        "LM",
        "RM",
        "LWB",
        "RWB",
      ].includes(role)
    ) {
      roleBonus += 0.18;
    }

    /*
      Penalize impossible long passes.
    */
    const distancePenalty =
      d / 320;

    /*
      Forward passes get rewarded.
      Backward passes remain possible,
      especially under pressure.
    */
    let score =
      lane +
      forward * 1.4 +
      openness / 100 +
      vision / 180 +
      passing / 220 +
      targetPassing / 300 +
      decision / 250 +
      roleBonus -
      distancePenalty;

    /*
      Under pressure, safe passes become more valuable.
    */
    const passerPressure =
      nearestOpponentDistance(
        passer,
        opponents
      );

    if (
      passerPressure < 45
    ) {
      if (
        openness > 60
      ) {
        score += 0.55;
      }

      if (
        forward < 0
      ) {
        score += 0.35;
      }
    }

    /*
      Do not constantly pass to goalkeeper
      unless there is danger.
    */
    if (
      String(
        target.role ||
        target.position ||
        ""
      ).toUpperCase() ===
      "GK"
    ) {
      score -=
        passerPressure < 40
          ? -0.25
          : 0.8;
    }

    score += rand(
      -0.08,
      0.08
    );

    if (
      score >
      bestScore
    ) {
      bestScore = score;
      best = target;
    }
  }

  return best;
}

/**
 * Check whether player can play a forward pass.
 */
export function canPass(
  player
) {
  if (!player) {
    return false;
  }

  if (
    player.redCard ||
    !player.hasBall
  ) {
    return false;
  }

  return true;
}

/**
 * Calculate passing error.
 */
function calculatePassError(
  passer,
  distanceToTarget,
  pressure
) {
  const passing =
    attr(
      passer,
      "passing"
    );

  const vision =
    attr(
      passer,
      "vision"
    );

  const stamina =
    Number(
      passer.stamina ?? 100
    );

  const quality =
    (passing +
      vision) /
    2;

  let error =
    18 -
    quality * 0.13;

  error +=
    pressure < 35
      ? 10
      : pressure < 55
      ? 5
      : 0;

  error +=
    distanceToTarget > 220
      ? 6
      : distanceToTarget > 150
      ? 3
      : 0;

  if (
    stamina < 45
  ) {
    error += 5;
  }

  return clamp(
    error,
    2,
    35
  );
}

/**
 * Attempt a normal pass.
 */
export function attemptPass(
  engine,
  team,
  opponent,
  passer
) {
  if (
    !engine ||
    !team ||
    !passer ||
    !canPass(passer)
  ) {
    return false;
  }

  if (
    engine.ball.state !==
      BALL_STATE.POSSESSED ||
    engine.ball.ownerId !==
      passer.id
  ) {
    return false;
  }

  const target =
    findBestPassTarget(
      team,
      opponent,
      passer
    );

  if (!target) {
    return false;
  }

  const opponents =
    getOpponentPlayers(
      opponent
    );

  const pressure =
    nearestOpponentDistance(
      passer,
      opponents
    );

  const d =
    distance(
      passer,
      target
    );

  const passing =
    attr(
      passer,
      "passing"
    );

  const vision =
    attr(
      passer,
      "vision"
    );

  const stamina =
    Number(
      passer.stamina ?? 100
    );

  const error =
    calculatePassError(
      passer,
      d,
      pressure
    );

  const speed =
    clamp(
      300 +
        passing * 2.2 +
        rand(-25, 25),
      300,
      560
    );

  const successChance =
    clamp(
      0.68 +
        passing / 300 +
        vision / 400 -
        d / 850 -
        (pressure < 35
          ? 0.18
          : pressure < 55
          ? 0.08
          : 0) -
        (stamina < 35
          ? 0.12
          : 0),
      0.38,
      0.96
    );

  const completed =
    Math.random() <
    successChance;

  /*
    Even an unsuccessful pass should physically
    travel toward its target, not magically vanish.
  */
  const actualTarget =
    completed
      ? target
      : {
          id: null,
          x:
            target.x +
            rand(-35, 35),
          y:
            target.y +
            rand(-35, 35),
        };

  const kicked =
    kickBallForPass(
      engine.ball,
      passer,
      actualTarget,
      {
        speed,
        error,
        type: "pass",
      }
    );

  if (!kicked) {
    return false;
  }

  team.stats =
    team.stats || {};

  team.stats.passesAttempted =
    (team.stats.passesAttempted ||
      0) + 1;

  passer.passesAttempted =
    (passer.passesAttempted ||
      0) + 1;

  engine.lastPass = {
    passerId: passer.id,
    receiverId:
      completed
        ? target.id
        : null,
    team: team.side,
    type: "pass",
    time:
      engine.simSeconds,
  };

  engine.lastTouchTeam =
    team.side;

  engine.lastTouchPlayerId =
    passer.id;

  passer.lastActionAt = 0;

  if (
    typeof engine.addEvent ===
    "function"
  ) {
    engine.addEvent({
      type: "pass",
      team: team.side,
      player: passer,
      relatedPlayer:
        completed
          ? target
          : null,
      text:
        completed
          ? `${passer.name} passes to ${target.name}`
          : `${passer.name} attempts a pass`,
    });
  }

  return true;
}

/**
 * Through ball.
 */
export function attemptThroughPass(
  engine,
  team,
  opponent,
  passer
) {
  if (
    !canPass(passer)
  ) {
    return false;
  }

  const teammates =
    (team.players || [])
      .filter(
        (p) =>
          p.id !== passer.id &&
          !p.redCard &&
          p.position !== "GK"
      );

  const direction =
    team.attackDirection === -1
      ? -1
      : 1;

  let best = null;
  let bestScore = -Infinity;

  for (
    const target of teammates
  ) {
    const dx =
      (target.x -
        passer.x) *
      direction;

    if (
      dx < 20 ||
      dx > 320
    ) {
      continue;
    }

    const d =
      distance(
        passer,
        target
      );

    if (
      d > 330
    ) {
      continue;
    }

    const pressure =
      nearestOpponentDistance(
        target,
        getOpponentPlayers(
          opponent
        )
      );

    const score =
      dx / 150 +
      pressure / 100 -
      d / 300 +
      Math.random() * 0.2;

    if (
      score >
      bestScore
    ) {
      bestScore = score;
      best = target;
    }
  }

  if (!best) {
    return false;
  }

  const lead =
    35 +
    attr(
      passer,
      "vision"
    ) * 0.35;

  const targetPoint = {
    id: best.id,
    x:
      best.x +
      direction * lead,
    y: best.y,
  };

  const d =
    distance(
      passer,
      targetPoint
    );

  const error =
    clamp(
      15 -
        attr(
          passer,
          "passing"
        ) *
          0.1,
      4,
      18
    );

  const kicked =
    kickBallForPass(
      engine.ball,
      passer,
      targetPoint,
      {
        speed: 410,
        error,
        type: "through",
      }
    );

  if (!kicked) {
    return false;
  }

  team.stats.passesAttempted =
    (team.stats.passesAttempted ||
      0) + 1;

  passer.passesAttempted =
    (passer.passesAttempted ||
      0) + 1;

  engine.lastPass = {
    passerId: passer.id,
    receiverId: best.id,
    team: team.side,
    type: "through",
    time:
      engine.simSeconds,
  };

  passer.lastActionAt = 0;

  if (
    typeof engine.addEvent ===
    "function"
  ) {
    engine.addEvent({
      type: "through_pass",
      team: team.side,
      player: passer,
      relatedPlayer: best,
      text: `${passer.name} plays a through ball`,
    });
  }

  return true;
}

/**
 * Cross from wide position.
 */
export function attemptCross(
  engine,
  team,
  opponent,
  player
) {
  if (
    !canPass(player)
  ) {
    return false;
  }

  const direction =
    team.attackDirection === -1
      ? -1
      : 1;

  const inAttackingZone =
    direction === 1
      ? player.x > FIELD.width * 0.62
      : player.x <
        FIELD.width * 0.38;

  if (
    !inAttackingZone
  ) {
    return false;
  }

  const wide =
    player.y <
      FIELD.height * 0.24 ||
    player.y >
      FIELD.height * 0.76;

  if (!wide) {
    return false;
  }

  const attackers =
    (team.players || [])
      .filter(
        (p) =>
          p.id !== player.id &&
          !p.redCard &&
          p.position !== "GK"
      )
      .sort(
        (a, b) =>
          Math.abs(
            FIELD.centerY -
              a.y
          ) -
          Math.abs(
            FIELD.centerY -
              b.y
          )
      );

  const target =
    attackers.find(
      (p) =>
        direction === 1
          ? p.x >
            FIELD.width * 0.58
          : p.x <
            FIELD.width * 0.42
    ) ||
    attackers[0];

  if (!target) {
    return false;
  }

  const goalX =
    direction === 1
      ? FIELD.width
      : 0;

  const targetX =
    goalX -
    direction * 90;

  const targetY =
    clamp(
      FIELD.centerY +
        rand(-110, 110),
      60,
      FIELD.height - 60
    );

  const kicked =
    loftBall(
      engine.ball,
      player,
      targetX,
      targetY,
      {
        speed: 330,
        height: 28,
        error: 25,
        type: "cross",
      }
    );

  if (!kicked) {
    return false;
  }

  team.stats.crosses =
    (team.stats.crosses || 0) +
    1;

  player.crosses =
    (player.crosses || 0) +
    1;

  engine.lastPass = {
    passerId: player.id,
    receiverId: target.id,
    team: team.side,
    type: "cross",
    time:
      engine.simSeconds,
  };

  player.lastActionAt = 0;

  if (
    typeof engine.addEvent ===
    "function"
  ) {
    engine.addEvent({
      type: "cross",
      team: team.side,
      player,
      relatedPlayer: target,
      text: `${player.name} sends a cross into the box`,
    });
  }

  return true;
}

/**
 * Decide whether player should pass.
 */
export function shouldPass(
  engine,
  team,
  opponent,
  player
) {
  if (
    !player ||
    !player.hasBall
  ) {
    return false;
  }

  const opponents =
    getOpponentPlayers(
      opponent
    );

  const pressure =
    nearestOpponentDistance(
      player,
      opponents
    );

  const actionTime =
    Number(
      player.lastActionAt || 0
    );

  if (
    actionTime < 0.8
  ) {
    return false;
  }

  /*
    Under strong pressure, passing becomes
    much more likely.
  */
  if (
    pressure < 35
  ) {
    return true;
  }

  /*
    Normal passing rhythm.
  */
  if (
    pressure < 70 &&
    actionTime > 1.2
  ) {
    return (
      Math.random() <
      0.72
    );
  }

  if (
    actionTime > 2.1
  ) {
    return (
      Math.random() <
      0.52
    );
  }

  return false;
}
