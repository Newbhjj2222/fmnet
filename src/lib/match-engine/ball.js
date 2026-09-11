// lib/match-engine/ball.js

import {
  BALL,
  BALL_STATE,
  FIELD,
  clamp,
  distance,
} from "./constants";

export function createBall() {
  return {
    x: FIELD.centerX,
    y: FIELD.centerY,

    vx: 0,
    vy: 0,

    ownerId: null,

    state: BALL_STATE.FREE,

    targetId: null,

    lastTouchTeam: null,
    lastTouchPlayerId: null,

    type: "normal",

    flightTime: 0,
    elapsed: 0,
  };
}

export function setBallOwner(
  ball,
  player
) {
  if (!player) return;

  ball.ownerId = player.id;
  ball.state =
    BALL_STATE.POSSESSED;

  ball.targetId = null;

  ball.vx = 0;
  ball.vy = 0;

  ball.x = player.x;
  ball.y = player.y;

  player.hasBall = true;
}

export function releaseBall(
  ball,
  player
) {
  if (player) {
    player.hasBall = false;
  }

  ball.ownerId = null;
  ball.state =
    BALL_STATE.FREE;

  ball.lastTouchPlayerId =
    player?.id ?? null;

  ball.lastTouchTeam =
    player?.side ?? null;
}

export function kickBall(
  ball,
  from,
  target,
  speed,
  state = BALL_STATE.PASSING
) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;

  const length =
    Math.hypot(dx, dy) || 1;

  releaseBall(ball, from);

  ball.vx =
    (dx / length) * speed;

  ball.vy =
    (dy / length) * speed;

  ball.state = state;

  ball.targetId = null;

  ball.x = from.x;
  ball.y = from.y;

  ball.elapsed = 0;

  ball.flightTime =
    Math.max(
      0.15,
      length / speed
    );
}

export function updateBall(
  ball,
  dt
) {
  if (
    ball.state ===
    BALL_STATE.POSSESSED
  ) {
    return;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const friction =
    Math.pow(
      BALL.friction,
      dt * 60
    );

  ball.vx *= friction;
  ball.vy *= friction;

  ball.elapsed += dt;

  if (
    Math.abs(ball.vx) < 2 &&
    Math.abs(ball.vy) < 2
  ) {
    ball.vx = 0;
    ball.vy = 0;
  }

  if (
    ball.x < 0 ||
    ball.x > FIELD.width ||
    ball.y < 0 ||
    ball.y > FIELD.height
  ) {
    ball.state =
      BALL_STATE.OUT;
  }
}

export function moveBallWithOwner(
  ball,
  player
) {
  if (!player) return;

  ball.x = player.x;
  ball.y = player.y;
}

export function ballSpeed(ball) {
  return Math.hypot(
    ball.vx,
    ball.vy
  );
}

export function ballNearPlayer(
  ball,
  player,
  radius = 24
) {
  return (
    distance(ball, player) <=
    radius
  );
}

export function clampBallToField(ball) {
  ball.x = clamp(
    ball.x,
    0,
    FIELD.width
  );

  ball.y = clamp(
    ball.y,
    0,
    FIELD.height
  );
}
