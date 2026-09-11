import {
  useEffect,
  useRef,
} from "react";

import styles from "./MatchCanvas.module.css";

const WIDTH = 1050;
const HEIGHT = 680;

function drawPitch(ctx) {
  ctx.clearRect(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  ctx.fillStyle = "#087f3d";
  ctx.fillRect(
    0,
    0,
    WIDTH,
    HEIGHT
  );

  ctx.strokeStyle =
    "rgba(255,255,255,.85)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    4,
    4,
    WIDTH - 8,
    HEIGHT - 8
  );

  ctx.beginPath();

  ctx.moveTo(
    WIDTH / 2,
    4
  );

  ctx.lineTo(
    WIDTH / 2,
    HEIGHT - 4
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.arc(
    WIDTH / 2,
    HEIGHT / 2,
    82,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  ctx.fillStyle =
    "rgba(255,255,255,.8)";

  ctx.beginPath();

  ctx.arc(
    WIDTH / 2,
    HEIGHT / 2,
    4,
    0,
    Math.PI * 2
  );

  ctx.fill();

  drawPenaltyArea(
    ctx,
    0
  );

  drawPenaltyArea(
    ctx,
    WIDTH - 170
  );

  drawGoal(
    ctx,
    0
  );

  drawGoal(
    ctx,
    WIDTH
  );

  ctx.strokeStyle =
    "rgba(255,255,255,.28)";

  ctx.lineWidth = 1;

  for (
    let x = 0;
    x < WIDTH;
    x += 70
  ) {
    ctx.beginPath();

    ctx.moveTo(x, 0);
    ctx.lineTo(
      x + 70,
      HEIGHT
    );

    ctx.stroke();
  }
}

function drawPenaltyArea(
  ctx,
  x
) {
  ctx.strokeStyle =
    "rgba(255,255,255,.85)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    x,
    230,
    170,
    220
  );

  ctx.strokeRect(
    x === 0
      ? 0
      : WIDTH - 105,
    295,
    105,
    90
  );
}

function drawGoal(
  ctx,
  side
) {
  ctx.strokeStyle =
    "#ffffff";

  ctx.lineWidth = 5;

  const x =
    side === 0
      ? 0
      : WIDTH;

  const direction =
    side === 0
      ? -1
      : 1;

  ctx.strokeRect(
    x,
    HEIGHT / 2 - 75,
    28 * direction,
    150
  );
}

function drawPlayer(
  ctx,
  player
) {
  const isHome =
    player.team === "home";

  ctx.beginPath();

  ctx.arc(
    player.x,
    player.y,
    15,
    0,
    Math.PI * 2
  );

  ctx.fillStyle =
    isHome
      ? "#20a4ff"
      : "#f33d4f";

  ctx.fill();

  ctx.lineWidth = 2;

  ctx.strokeStyle =
    player.hasBall
      ? "#ffe45c"
      : "#ffffff";

  ctx.stroke();

  if (player.red) {
    ctx.fillStyle =
      "#111827";

    ctx.fillRect(
      player.x - 7,
      player.y - 8,
      14,
      16
    );
  }

  if (player.yellow) {
    ctx.fillStyle =
      "#ffd43b";

    ctx.fillRect(
      player.x + 8,
      player.y - 15,
      7,
      10
    );
  }

  ctx.fillStyle =
    "#ffffff";

  ctx.font =
    "bold 10px Arial";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.fillText(
    String(player.number),
    player.x,
    player.y
  );

  ctx.font =
    "bold 9px Arial";

  ctx.fillStyle =
    "#ffffff";

  ctx.fillText(
    player.name
      ?.split(" ")
      .slice(-1)[0]
      ?.slice(0, 10) || "",
    player.x,
    player.y + 25
  );
}

function drawBall(
  ctx,
  ball
) {
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

    const ratio =
      window.devicePixelRatio ||
      1;

    canvas.width =
      WIDTH * ratio;

    canvas.height =
      HEIGHT * ratio;

    canvas.style.width =
      "100%";

    canvas.style.height =
      "auto";

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    drawPitch(ctx);

    [
      ...(snapshot.players?.home ||
        []),
      ...(snapshot.players?.away ||
        []),
    ].forEach(
      (player) =>
        drawPlayer(
          ctx,
          player
        )
    );

    if (snapshot.ball) {
      drawBall(
        ctx,
        snapshot.ball
      );
    }
  }, [snapshot]);

  return (
    <div className={styles.canvasWrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={WIDTH}
        height={HEIGHT}
      />
    </div>
  );
}
