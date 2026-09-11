// components/match/MatchCanvas.js

import { useEffect, useRef } from "react";

import { FIELD } from "../../lib/match-engine/constants";

import styles from "./MatchCanvas.module.css";

export default function MatchCanvas({ snapshot }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const parent = canvas.parentElement;

    if (!parent) return;

    const resize = () => {
      const rect = parent.getBoundingClientRect();

      const ratio = Math.max(
        1,
        window.devicePixelRatio || 1
      );

      const displayWidth = Math.max(
        1,
        rect.width
      );

      const displayHeight =
        displayWidth *
        (FIELD.height / FIELD.width);

      canvas.width =
        FIELD.width * ratio;

      canvas.height =
        FIELD.height * ratio;

      canvas.style.width =
        `${displayWidth}px`;

      canvas.style.height =
        `${displayHeight}px`;

      const ctx =
        canvas.getContext("2d");

      if (!ctx) return;

      ctx.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
      );

      draw(ctx, snapshot);
    };

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;

    if (observer) {
      observer.observe(parent);
    }

    resize();

    return () => {
      if (observer) {
        observer.disconnect();
      }
    };
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) return;

    const ratio =
      Math.max(
        1,
        window.devicePixelRatio || 1
      );

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    draw(ctx, snapshot);
  }, [snapshot]);

  return (
    <div className={styles.wrapper}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
      />
    </div>
  );
}

/* =========================================================
   MAIN DRAW
========================================================= */

function draw(ctx, snapshot) {
  if (!ctx) return;

  ctx.clearRect(
    0,
    0,
    FIELD.width,
    FIELD.height
  );

  drawPitch(ctx);

  if (!snapshot) {
    return;
  }

  drawPlayers(
    ctx,
    snapshot.home?.players,
    true
  );

  drawPlayers(
    ctx,
    snapshot.away?.players,
    false
  );

  drawBall(
    ctx,
    snapshot.ball
  );
}

/* =========================================================
   PITCH
========================================================= */

function drawPitch(ctx) {
  ctx.fillStyle = "#087f45";

  ctx.fillRect(
    0,
    0,
    FIELD.width,
    FIELD.height
  );

  /* Pitch stripes */

  for (
    let stripeX = 0;
    stripeX < FIELD.width;
    stripeX += 70
  ) {
    ctx.fillStyle =
      stripeX % 140 === 0
        ? "rgba(255,255,255,.025)"
        : "rgba(0,0,0,.025)";

    ctx.fillRect(
      stripeX,
      0,
      70,
      FIELD.height
    );
  }

  /* Outer line */

  ctx.strokeStyle =
    "rgba(255,255,255,.85)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    4,
    4,
    FIELD.width - 8,
    FIELD.height - 8
  );

  /* Halfway line */

  ctx.beginPath();

  ctx.moveTo(
    FIELD.centerX,
    0
  );

  ctx.lineTo(
    FIELD.centerX,
    FIELD.height
  );

  ctx.stroke();

  /* Center circle */

  ctx.beginPath();

  ctx.arc(
    FIELD.centerX,
    FIELD.centerY,
    85,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  /* Center spot */

  ctx.fillStyle =
    "rgba(255,255,255,.9)";

  ctx.beginPath();

  ctx.arc(
    FIELD.centerX,
    FIELD.centerY,
    4,
    0,
    Math.PI * 2
  );

  ctx.fill();

  /* Penalty areas */

  drawPenaltyArea(
    ctx,
    0,
    false
  );

  drawPenaltyArea(
    ctx,
    FIELD.width,
    true
  );

  /* Goals */

  drawGoals(ctx);
}

/* =========================================================
   PENALTY AREA
========================================================= */

function drawPenaltyArea(
  ctx,
  x,
  right
) {
  const width =
    Number(FIELD.penaltyBoxWidth) || 0;

  const height =
    Number(FIELD.penaltyBoxHeight) || 0;

  const startX =
    right
      ? x - width
      : x;

  const startY =
    (FIELD.height - height) / 2;

  ctx.strokeRect(
    startX,
    startY,
    width,
    height
  );

  const sixWidth =
    Number(FIELD.sixYardWidth) || 0;

  const sixHeight =
    Number(FIELD.sixYardHeight) || 0;

  const sixX =
    right
      ? x - sixWidth
      : x;

  const sixY =
    (FIELD.height - sixHeight) / 2;

  ctx.strokeRect(
    sixX,
    sixY,
    sixWidth,
    sixHeight
  );
}

/* =========================================================
   GOALS
========================================================= */

function drawGoals(ctx) {
  ctx.strokeStyle =
    "rgba(255,255,255,.95)";

  ctx.lineWidth = 4;

  const goalWidth =
    Number(FIELD.goalWidth) || 0;

  const goalDepth =
    Number(FIELD.goalDepth) || 0;

  const top =
    FIELD.centerY -
    goalWidth / 2;

  /* Left goal */

  ctx.strokeRect(
    -goalDepth,
    top,
    goalDepth,
    goalWidth
  );

  /* Right goal */

  ctx.strokeRect(
    FIELD.width,
    top,
    goalDepth,
    goalWidth
  );
}

/* =========================================================
   PLAYERS
========================================================= */

function drawPlayers(
  ctx,
  players,
  home
) {
  if (!Array.isArray(players)) {
    return;
  }

  for (const player of players) {
    if (!player) {
      continue;
    }

    if (player.redCard) {
      continue;
    }

    const playerX =
      Number(player.x);

    const playerY =
      Number(player.y);

    /*
     * Prevent Canvas errors when a player
     * temporarily has invalid coordinates.
     */

    if (
      !Number.isFinite(playerX) ||
      !Number.isFinite(playerY)
    ) {
      continue;
    }

    const radius =
      player.position === "GK"
        ? 15
        : 13;

    /* Player body */

    ctx.beginPath();

    ctx.arc(
      playerX,
      playerY,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      home
        ? "#e63946"
        : "#f1f5f9";

    ctx.fill();

    ctx.lineWidth = 2;

    ctx.strokeStyle =
      home
        ? "#7f1d1d"
        : "#1e3a8a";

    ctx.stroke();

    /* Ball possession indicator */

    if (player.hasBall) {
      ctx.beginPath();

      ctx.arc(
        playerX,
        playerY,
        radius + 5,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        "#facc15";

      ctx.lineWidth = 2;

      ctx.stroke();
    }

    /* Player number */

    ctx.fillStyle =
      home
        ? "#ffffff"
        : "#111827";

    ctx.font =
      "bold 10px Arial";

    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "middle";

    ctx.fillText(
      String(
        player.number ?? ""
      ),
      playerX,
      playerY
    );

    /* Pressing indicator */

    if (
      player.state === "press"
    ) {
      ctx.beginPath();

      ctx.arc(
        playerX,
        playerY,
        radius + 8,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        "rgba(250,204,21,.7)";

      ctx.lineWidth = 1.5;

      ctx.stroke();
    }
  }
}

/* =========================================================
   BALL
========================================================= */

function drawBall(
  ctx,
  ball
) {
  if (!ball) {
    return;
  }

  const ballX =
    Number(ball.x);

  const ballY =
    Number(ball.y);

  if (
    !Number.isFinite(ballX) ||
    !Number.isFinite(ballY)
  ) {
    return;
  }

  ctx.beginPath();

  ctx.arc(
    ballX,
    ballY,
    6,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    "#ffffff";

  ctx.fill();

  ctx.strokeStyle =
    "#111827";

  ctx.lineWidth = 1.5;

  ctx.stroke();
}
