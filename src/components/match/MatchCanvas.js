// components/match/MatchCanvas.js

import {
  useEffect,
  useRef,
} from "react";

import {
  FIELD,
} from "../../lib/match-engine/constants";

export default function MatchCanvas({
  snapshot,
}) {
  const canvasRef =
    useRef(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas || !snapshot) {
      return;
    }

    const ctx =
      canvas.getContext("2d");

    const rect =
      canvas.getBoundingClientRect();

    const dpr =
      window.devicePixelRatio || 1;

    canvas.width =
      rect.width * dpr;

    canvas.height =
      rect.height * dpr;

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    const scaleX =
      rect.width /
      FIELD.width;

    const scaleY =
      rect.height /
      FIELD.height;

    const scale =
      Math.min(
        scaleX,
        scaleY
      );

    ctx.save();

    ctx.translate(
      (
        rect.width -
        FIELD.width * scale
      ) / 2,
      (
        rect.height -
        FIELD.height * scale
      ) / 2
    );

    ctx.scale(
      scale,
      scale
    );

    drawPitch(ctx);

    drawPlayers(
      ctx,
      snapshot.players
    );

    drawBall(
      ctx,
      snapshot.ball
    );

    ctx.restore();
  }, [snapshot]);

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "1050 / 680",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}

function drawPitch(ctx) {
  ctx.fillStyle =
    "#087f3d";

  ctx.fillRect(
    0,
    0,
    FIELD.width,
    FIELD.height
  );

  ctx.strokeStyle =
    "rgba(255,255,255,.88)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    FIELD.left,
    FIELD.top,
    FIELD.right -
      FIELD.left,
    FIELD.bottom -
      FIELD.top
  );

  ctx.beginPath();

  ctx.moveTo(
    FIELD.centerX,
    FIELD.top
  );

  ctx.lineTo(
    FIELD.centerX,
    FIELD.bottom
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.arc(
    FIELD.centerX,
    FIELD.centerY,
    72,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.arc(
    FIELD.centerX,
    FIELD.centerY,
    5,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    "#fff";

  ctx.fill();

  drawPenaltyArea(
    ctx,
    "home"
  );

  drawPenaltyArea(
    ctx,
    "away"
  );

  drawGoalArea(
    ctx,
    "home"
  );

  drawGoalArea(
    ctx,
    "away"
  );

  drawGoals(ctx);

  for (
    let i = 0;
    i < 10;
    i++
  ) {
    if (i % 2 === 0) {
      ctx.fillStyle =
        "rgba(255,255,255,.025)";

      ctx.fillRect(
        FIELD.left +
          i *
            (
              (
                FIELD.right -
                FIELD.left
              ) / 10
            ),
        FIELD.top,
        (
          FIELD.right -
          FIELD.left
        ) / 10,
        FIELD.bottom -
          FIELD.top
      );
    }
  }
}

function drawPenaltyArea(
  ctx,
  team
) {
  const width =
    165;

  const height =
    300;

  const x =
    team === "home"
      ? FIELD.left
      : FIELD.right - width;

  ctx.strokeRect(
    x,
    FIELD.centerY -
      height / 2,
    width,
    height
  );
}

function drawGoalArea(
  ctx,
  team
) {
  const width =
    65;

  const height =
    145;

  const x =
    team === "home"
      ? FIELD.left
      : FIELD.right - width;

  ctx.strokeRect(
    x,
    FIELD.centerY -
      height / 2,
    width,
    height
  );
}

function drawGoals(ctx) {
  ctx.strokeStyle =
    "#f4f4f4";

  ctx.lineWidth = 5;

  ctx.strokeRect(
    FIELD.left -
      FIELD.goalDepth,
    FIELD.centerY -
      FIELD.goalWidth / 2,
    FIELD.goalDepth,
    FIELD.goalWidth
  );

  ctx.strokeRect(
    FIELD.right,
    FIELD.centerY -
      FIELD.goalWidth / 2,
    FIELD.goalDepth,
    FIELD.goalWidth
  );
}

function drawPlayers(
  ctx,
  players
) {
  for (const player of players) {
    const isHome =
      player.team === "home";

    ctx.beginPath();

    ctx.arc(
      player.x,
      player.y,
      13,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      isHome
        ? "#1677ff"
        : "#e33d48";

    ctx.fill();

    ctx.lineWidth =
      player.hasBall
        ? 4
        : 2;

    ctx.strokeStyle =
      player.hasBall
        ? "#ffd83d"
        : "#ffffff";

    ctx.stroke();

    if (
      player.position ===
      "GK"
    ) {
      ctx.beginPath();

      ctx.arc(
        player.x,
        player.y,
        17,
        0,
        Math.PI * 2
      );

      ctx.strokeStyle =
        "#ffe66d";

      ctx.lineWidth = 2;

      ctx.stroke();
    }

    ctx.fillStyle =
      "#fff";

    ctx.font =
      "bold 11px Arial";

    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "middle";

    ctx.fillText(
      String(
        player.number
      ),
      player.x,
      player.y
    );

    if (
      player.yellowCards > 0
    ) {
      ctx.fillStyle =
        "#ffd400";

      ctx.fillRect(
        player.x + 11,
        player.y - 18,
        6,
        9
      );
    }
  }
}

function drawBall(
  ctx,
  ball
) {
  ctx.beginPath();

  ctx.arc(
    ball.x,
    ball.y,
    5,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    "#ffffff";

  ctx.fill();

  ctx.strokeStyle =
    "#111";

  ctx.lineWidth = 1;

  ctx.stroke();
}
