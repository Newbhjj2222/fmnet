// components/match/MatchCanvas.js

import {
  useEffect,
  useRef,
} from "react";

import {
  FIELD,
} from "../../lib/match-engine/constants";

import styles from "./MatchCanvas.module.css";

export default function MatchCanvas({
  snapshot,
}) {
  const canvasRef =
    useRef(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) return;

    const parent =
      canvas.parentElement;

    const resize = () => {
      const rect =
        parent.getBoundingClientRect();

      const ratio =
        window.devicePixelRatio ||
        1;

      canvas.width =
        FIELD.width * ratio;

      canvas.height =
        FIELD.height * ratio;

      canvas.style.width =
        `${rect.width}px`;

      canvas.style.height =
        `${rect.width *
          (FIELD.height /
            FIELD.width)}px`;

      const ctx =
        canvas.getContext("2d");

      ctx.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
      );

      draw(
        ctx,
        snapshot
      );
    };

    const observer =
      new ResizeObserver(
        resize
      );

    observer.observe(parent);

    resize();

    return () =>
      observer.disconnect();
  }, [snapshot]);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) return;

    const ctx =
      canvas.getContext("2d");

    const ratio =
      window.devicePixelRatio ||
      1;

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    draw(
      ctx,
      snapshot
    );
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

function draw(
  ctx,
  snapshot
) {
  if (!ctx) return;

  ctx.clearRect(
    0,
    0,
    FIELD.width,
    FIELD.height
  );

  drawPitch(ctx);

  if (!snapshot) return;

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

function drawPitch(ctx) {
  ctx.fillStyle =
    "#087f45";

  ctx.fillRect(
    0,
    0,
    FIELD.width,
    FIELD.height
  );

  for (
    let x = 0;
    x < FIELD.width;
    x += 70
  ) {
    ctx.fillStyle =
      x % 140 === 0
        ? "rgba(255,255,255,.025)"
        : "rgba(0,0,0,.025)";

    ctx.fillRect(
      x,
      0,
      70,
      FIELD.height
    );
  }

  ctx.strokeStyle =
    "rgba(255,255,255,.85)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    4,
    4,
    FIELD.width - 8,
    FIELD.height - 8
  );

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

  ctx.beginPath();

  ctx.arc(
    FIELD.centerX,
    FIELD.centerY,
    85,
    0,
    Math.PI * 2
  );

  ctx.stroke();

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

  drawGoals(ctx);
}

function drawPenaltyArea(
  ctx,
  x,
  right
) {
  const width =
    FIELD.penaltyBoxWidth;

  const height =
    FIELD.penaltyBoxHeight;

  const startX =
    right
      ? x - width
      : x;

  const startY =
    (FIELD.height -
      height) /
    2;

  ctx.strokeRect(
    startX,
    startY,
    width,
    height
  );

  const sixWidth =
    FIELD.sixYardWidth;

  const sixHeight =
    FIELD.sixYardHeight;

  const sixX =
    right
      ? x - sixWidth
      : x;

  const sixY =
    (FIELD.height -
      sixHeight) /
    2;

  ctx.strokeRect(
    sixX,
    sixY,
    sixWidth,
    sixHeight
  );
}

function drawGoals(ctx) {
  ctx.strokeStyle =
    "rgba(255,255,255,.95)";

  ctx.lineWidth = 4;

  const top =
    FIELD.centerY -
    FIELD.goalWidth / 2;

  ctx.strokeRect(
    -FIELD.goalDepth,
    top,
    FIELD.goalDepth,
    FIELD.goalWidth
  );

  ctx.strokeRect(
    FIELD.width,
    top,
    FIELD.goalDepth,
    FIELD.goalWidth
  );
}

function drawPlayers(
  ctx,
  players,
  home
) {
  if (!Array.isArray(players)) {
    return;
  }

  for (const player of players) {
    if (
      player.redCard
    ) {
      continue;
    }

    const x =
      player.x;

    const y =
      player.y;

    const radius =
      player.position === "GK"
        ? 15
        : 13;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
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

    if (
      player.hasBall
    ) {
      ctx.beginPath();

      ctx.arc(
        x,
        y,
        radius + 5,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        "#facc15";

      ctx.lineWidth = 2;

      ctx.stroke();
    }

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
        player.number
      ),
      x,
      y
    );

    if (
      player.state ===
      "press"
    ) {
      ctx.beginPath();

      ctx.arc(
        x,
        y,
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

function drawBall(
  ctx,
  ball
) {
  if (!ball) return;

  ctx.beginPath();

  ctx.arc(
    ball.x,
    ball.y,
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
