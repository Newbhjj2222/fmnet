import {
  useEffect,
  useRef,
} from "react";

import {
  PITCH,
  TEAM_COLORS,
} from "../../lib/match/constants";

import styles from "./MatchCanvas.module.css";

const clamp = (
  value,
  min,
  max
) =>
  Math.max(
    min,
    Math.min(max, value)
  );

export default function MatchCanvas({
  snapshot,
}) {
  const canvasRef =
    useRef(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (
      !canvas ||
      !snapshot
    ) {
      return undefined;
    }

    const context =
      canvas.getContext("2d");

    const dpr =
      Math.max(
        1,
        Math.min(
          window.devicePixelRatio ||
            1,
          2
        )
      );

    canvas.width =
      PITCH.width * dpr;

    canvas.height =
      PITCH.height * dpr;

    context.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    const drawPitch = () => {
      const width =
        PITCH.width;

      const height =
        PITCH.height;

      context.clearRect(
        0,
        0,
        width,
        height
      );

      const grass =
        context.createLinearGradient(
          0,
          0,
          width,
          height
        );

      grass.addColorStop(
        0,
        "#126b43"
      );

      grass.addColorStop(
        1,
        "#073b2a"
      );

      context.fillStyle =
        grass;

      context.fillRect(
        0,
        0,
        width,
        height
      );

      for (
        let index = 0;
        index < 14;
        index += 1
      ) {
        context.fillStyle =
          index % 2 === 0
            ? "rgba(255,255,255,.018)"
            : "rgba(0,0,0,.018)";

        context.fillRect(
          (index * width) / 14,
          0,
          width / 14,
          height
        );
      }

      context.strokeStyle =
        "rgba(255,255,255,.82)";

      context.lineWidth = 3;

      context.strokeRect(
        10,
        10,
        width - 20,
        height - 20
      );

      context.beginPath();

      context.moveTo(
        width / 2,
        10
      );

      context.lineTo(
        width / 2,
        height - 10
      );

      context.stroke();

      context.beginPath();

      context.arc(
        width / 2,
        height / 2,
        PITCH.centerCircle,
        0,
        Math.PI * 2
      );

      context.stroke();

      context.beginPath();

      context.arc(
        width / 2,
        height / 2,
        4,
        0,
        Math.PI * 2
      );

      context.fillStyle =
        "#ffffff";

      context.fill();

      const penaltyY =
        (height -
          PITCH.penaltyBoxHeight) /
        2;

      context.strokeRect(
        10,
        penaltyY,
        PITCH.penaltyBoxWidth,
        PITCH.penaltyBoxHeight
      );

      context.strokeRect(
        width -
          10 -
          PITCH.penaltyBoxWidth,

        penaltyY,

        PITCH.penaltyBoxWidth,
        PITCH.penaltyBoxHeight
      );

      const goalBoxY =
        (height -
          PITCH.goalBoxHeight) /
        2;

      context.strokeRect(
        10,
        goalBoxY,
        PITCH.goalBoxWidth,
        PITCH.goalBoxHeight
      );

      context.strokeRect(
        width -
          10 -
          PITCH.goalBoxWidth,

        goalBoxY,

        PITCH.goalBoxWidth,
        PITCH.goalBoxHeight
      );

      context.fillStyle =
        "rgba(255,255,255,.16)";

      context.fillRect(
        0,
        height / 2 - 75,
        PITCH.goalDepth,
        150
      );

      context.fillRect(
        width -
          PITCH.goalDepth,
        height / 2 - 75,
        PITCH.goalDepth,
        150
      );
    };

    const drawPlayer = (
      player,
      teamColor
    ) => {
      const x =
        clamp(
          Number(player.x) || 0,
          10,
          PITCH.width - 10
        );

      const y =
        clamp(
          Number(player.y) || 0,
          10,
          PITCH.height - 10
        );

      const radius = 17;

      context.beginPath();

      context.arc(
        x + 1,
        y + 3,
        radius + 1,
        0,
        Math.PI * 2
      );

      context.fillStyle =
        "rgba(0,0,0,.35)";

      context.fill();

      context.beginPath();

      context.arc(
        x,
        y,
        radius,
        0,
        Math.PI * 2
      );

      context.fillStyle =
        player.redCard
          ? "#7f1d1d"
          : teamColor;

      context.fill();

      context.lineWidth =
        player.hasBall
          ? 4
          : 2;

      context.strokeStyle =
        player.hasBall
          ? "#fef08a"
          : "rgba(255,255,255,.9)";

      context.stroke();

      context.fillStyle =
        "#07111b";

      context.font =
        "800 12px Arial";

      context.textAlign =
        "center";

      context.textBaseline =
        "middle";

      context.fillText(
        String(player.number),
        x,
        y
      );

      if (
        player.stamina < 25
      ) {
        context.fillStyle =
          "rgba(255,255,255,.8)";

        context.font =
          "700 8px Arial";

        context.fillText(
          Math.round(
            player.stamina
          ),
          x,
          y - 26
        );
      }
    };

    const drawBall = () => {
      const ball =
        snapshot.ball;

      if (!ball) {
        return;
      }

      context.beginPath();

      context.arc(
        ball.x,
        ball.y + 2,
        7,
        0,
        Math.PI * 2
      );

      context.fillStyle =
        "rgba(0,0,0,.3)";

      context.fill();

      context.beginPath();

      context.arc(
        ball.x,
        ball.y,
        5.5,
        0,
        Math.PI * 2
      );

      context.fillStyle =
        "#ffffff";

      context.fill();

      context.strokeStyle =
        "#111827";

      context.lineWidth = 1;

      context.stroke();
    };

    drawPitch();

    snapshot.homeXI?.forEach(
      (player) =>
        drawPlayer(
          player,
          TEAM_COLORS.home
        )
    );

    snapshot.awayXI?.forEach(
      (player) =>
        drawPlayer(
          player,
          TEAM_COLORS.away
        )
    );

    drawBall();
  }, [snapshot]);

  return (
    <div className={styles.wrap}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
      />
    </div>
  );
}
