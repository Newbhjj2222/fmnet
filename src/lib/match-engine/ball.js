// lib/match-engine/ball.js

import {
  BALL_STATE,
  FIELD,
  clamp,
  distance,
} from "./constants";

/*
  Ball state:
  FREE
  POSSESSED
  PASSING
  SHOOTING
  SAVED
  DEFLECTED
  OUT
  GOAL
*/

export function createBall() {
  return {
    x: FIELD.centerX,
    y: FIELD.centerY,

    vx: 0,
    vy: 0,

    state: BALL_STATE.FREE,

    ownerId: null,
    targetId: null,

    lastTouchTeam: null,
    lastTouchPlayerId: null,

    type: null,

    height: 0,
    spin: 0,

    passStartX: FIELD.centerX,
    passStartY: FIELD.centerY,

    shotXG: 0,

    restartTeam: null,
    restartType: null,

    flightTime: 0,
    maxFlightTime: 0,

    elapsed: 0,
  };
}

/**
 * Give the ball to a player.
 */
export function setBallOwner(ball, player) {
  if (!ball || !player) return;

  ball.ownerId = player.id;
  ball.state = BALL_STATE.POSSESSED;

  ball.x = player.x;
  ball.y = player.y;

  ball.vx = 0;
  ball.vy = 0;

  ball.targetId = null;

  ball.height = 0;
  ball.flightTime = 0;
  ball.maxFlightTime = 0;

  player.hasBall = true;

  ball.lastTouchTeam = player.side;
  ball.lastTouchPlayerId = player.id;
}

/**
 * Remove ball from current owner.
 */
export function releaseBall(ball, player = null) {
  if (!ball) return;

  if (player) {
    player.hasBall = false;
  }

  ball.ownerId = null;

  if (
    ball.state === BALL_STATE.POSSESSED
  ) {
    ball.state = BALL_STATE.FREE;
  }
}

/**
 * Ball follows player.
 */
export function moveBallWithOwner(ball, player) {
  if (!ball || !player) return;

  if (
    ball.ownerId !== player.id ||
    !player.hasBall
  ) {
    return;
  }

  const offsetX =
    player.side === "home"
      ? 9
      : -9;

  ball.x = player.x + offsetX;
  ball.y = player.y;

  ball.vx = player.vx || 0;
  ball.vy = player.vy || 0;

  ball.state = BALL_STATE.POSSESSED;
  ball.height = 0;
}

/**
 * Start a pass.
 */
export function kickBallForPass(
  ball,
  passer,
  target,
  {
    speed = 360,
    error = 0,
    type = "pass",
  } = {}
) {
  if (!ball || !passer || !target) {
    return false;
  }

  releaseBall(ball, passer);

  let tx = target.x;
  let ty = target.y;

  if (error > 0) {
    tx += (Math.random() - 0.5) * error;
    ty += (Math.random() - 0.5) * error;
  }

  const dx = tx - passer.x;
  const dy = ty - passer.y;

  const len = Math.hypot(dx, dy) || 1;

  ball.x = passer.x;
  ball.y = passer.y;

  ball.vx = (dx / len) * speed;
  ball.vy = (dy / len) * speed;

  ball.state = BALL_STATE.PASSING;

  ball.ownerId = null;
  ball.targetId = target.id;

  ball.lastTouchTeam = passer.side;
  ball.lastTouchPlayerId = passer.id;

  ball.type = type;

  ball.passStartX = passer.x;
  ball.passStartY = passer.y;

  ball.flightTime = 0;

  const d = Math.max(
    1,
    Math.hypot(dx, dy)
  );

  ball.maxFlightTime =
    d / Math.max(100, speed);

  ball.elapsed = 0;

  return true;
}

/**
 * Start a shot.
 */
export function kickBallForShot(
  ball,
  shooter,
  targetX,
  targetY,
  {
    speed = 620,
    error = 0,
    xg = 0,
  } = {}
) {
  if (!ball || !shooter) {
    return false;
  }

  releaseBall(ball, shooter);

  let tx = targetX;
  let ty = targetY;

  if (error > 0) {
    tx += (Math.random() - 0.5) * error;
    ty += (Math.random() - 0.5) * error;
  }

  const dx = tx - shooter.x;
  const dy = ty - shooter.y;

  const len = Math.hypot(dx, dy) || 1;

  ball.x = shooter.x;
  ball.y = shooter.y;

  ball.vx = (dx / len) * speed;
  ball.vy = (dy / len) * speed;

  ball.state = BALL_STATE.SHOOTING;

  ball.ownerId = null;
  ball.targetId = null;

  ball.lastTouchTeam = shooter.side;
  ball.lastTouchPlayerId = shooter.id;

  ball.type = "shot";

  ball.shotXG = clamp(
    Number(xg) || 0,
    0,
    1
  );

  ball.flightTime = 0;

  const d = Math.max(
    1,
    Math.hypot(dx, dy)
  );

  ball.maxFlightTime =
    d / Math.max(200, speed);

  ball.elapsed = 0;

  return true;
}

/**
 * Update free/pass/shot ball.
 */
export function updateBall(ball, dt) {
  if (!ball) return;

  if (
    ball.state === BALL_STATE.POSSESSED
  ) {
    return;
  }

  if (
    ball.state !== BALL_STATE.PASSING &&
    ball.state !== BALL_STATE.SHOOTING &&
    ball.state !== BALL_STATE.FREE &&
    ball.state !== BALL_STATE.DEFLECTED &&
    ball.state !== BALL_STATE.SAVED
  ) {
    return;
  }

  const safeDt = clamp(
    Number(dt) || 0,
    0,
    0.05
  );

  ball.elapsed += safeDt;
  ball.flightTime += safeDt;

  /*
    Small friction for free balls.
  */
  if (
    ball.state === BALL_STATE.FREE ||
    ball.state === BALL_STATE.DEFLECTED
  ) {
    ball.vx *= Math.pow(0.985, safeDt * 60);
    ball.vy *= Math.pow(0.985, safeDt * 60);
  }

  ball.x += ball.vx * safeDt;
  ball.y += ball.vy * safeDt;

  /*
    Keep the ball inside the vertical field
    while allowing goal-line crossing.
  */
  if (ball.y < 0) {
    ball.y = 0;
    ball.vy *= -0.35;
  }

  if (ball.y > FIELD.height) {
    ball.y = FIELD.height;
    ball.vy *= -0.35;
  }

  /*
    Slow passing ball after expected arrival.
    Engine will decide who receives it.
  */
  if (
    ball.state === BALL_STATE.PASSING &&
    ball.elapsed >
      ball.maxFlightTime + 0.5
  ) {
    ball.state = BALL_STATE.FREE;
    ball.targetId = null;
    ball.vx *= 0.5;
    ball.vy *= 0.5;
  }

  /*
    Shot should keep traveling until engine
    resolves goal/miss/save.
  */
  if (
    ball.state === BALL_STATE.SHOOTING &&
    ball.elapsed >
      Math.max(
        ball.maxFlightTime + 1,
        2.5
      )
  ) {
    ball.state = BALL_STATE.FREE;
  }
}

/**
 * Put a ball into the air.
 */
export function loftBall(
  ball,
  fromPlayer,
  targetX,
  targetY,
  {
    speed = 300,
    height = 20,
    error = 0,
    type = "cross",
  } = {}
) {
  if (!ball || !fromPlayer) {
    return false;
  }

  releaseBall(ball, fromPlayer);

  let tx = targetX;
  let ty = targetY;

  if (error > 0) {
    tx +=
      (Math.random() - 0.5) * error;

    ty +=
      (Math.random() - 0.5) * error;
  }

  const dx = tx - fromPlayer.x;
  const dy = ty - fromPlayer.y;

  const len = Math.hypot(dx, dy) || 1;

  ball.x = fromPlayer.x;
  ball.y = fromPlayer.y;

  ball.vx = (dx / len) * speed;
  ball.vy = (dy / len) * speed;

  ball.state = BALL_STATE.PASSING;

  ball.ownerId = null;
  ball.targetId = null;

  ball.lastTouchTeam = fromPlayer.side;
  ball.lastTouchPlayerId =
    fromPlayer.id;

  ball.type = type;

  ball.height = height;

  ball.passStartX = fromPlayer.x;
  ball.passStartY = fromPlayer.y;

  ball.flightTime = 0;

  ball.maxFlightTime =
    Math.max(
      0.25,
      len / Math.max(100, speed)
    );

  ball.elapsed = 0;

  return true;
}

/**
 * Stop ball completely.
 */
export function stopBall(ball) {
  if (!ball) return;

  ball.vx = 0;
  ball.vy = 0;

  ball.state = BALL_STATE.FREE;

  ball.ownerId = null;
  ball.targetId = null;

  ball.height = 0;
}

/**
 * Move ball to a position without possession.
 */
export function placeBall(
  ball,
  x,
  y
) {
  if (!ball) return;

  ball.x = clamp(
    x,
    -20,
    FIELD.width + 20
  );

  ball.y = clamp(
    y,
    0,
    FIELD.height
  );

  ball.vx = 0;
  ball.vy = 0;
}

/**
 * Find player closest to ball.
 */
export function findClosestPlayerToBall(
  ball,
  players = []
) {
  let closest = null;
  let best = Infinity;

  for (const player of players) {
    if (!player || player.redCard) {
      continue;
    }

    const d = distance(
      player,
      ball
    );

    if (d < best) {
      best = d;
      closest = player;
    }
  }

  return closest;
}
