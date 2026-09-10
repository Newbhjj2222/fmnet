import {
  useEffect,
  useRef,
} from "react";

import {
  PITCH,
} from "../../lib/match-engine/constants";

export default function MatchCanvas({
  engine,
}) {
  const canvasRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const previousTimeRef =
    useRef(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (
      !canvas ||
      !engine
    ) {
      return;
    }

    const context =
      canvas.getContext(
        "2d"
      );

    const resize =
      () => {
        const parent =
          canvas.parentElement;

        if (!parent) {
          return;
        }

        const rect =
          parent.getBoundingClientRect();

        const scale =
          Math.min(
            rect.width /
              PITCH.width,

            rect.height /
              PITCH.height
          );

        const width =
          PITCH.width *
          scale;

        const height =
          PITCH.height *
          scale;

        const dpr =
          window.devicePixelRatio ||
          1;

        canvas.width =
          PITCH.width *
          dpr;

        canvas.height =
          PITCH.height *
          dpr;

        canvas.style.width =
          `${width}px`;

        canvas.style.height =
          `${height}px`;

        context.setTransform(
          dpr,
          0,
          0,
          dpr,
          0,
          0
        );
      };

    const drawPitch =
      () => {
        context.clearRect(
          0,
          0,
          PITCH.width,
          PITCH.height
        );

        drawGrass(
          context
        );

        drawFieldLines(
          context
        );

        drawGoals(
          context
        );

        drawPlayers(
          context
        );

        drawBall(
          context
        );
      };

    const drawGrass =
      ctx => {
        ctx.fillStyle =
          "#168447";

        ctx.fillRect(
          0,
          0,
          PITCH.width,
          PITCH.height
        );

        const stripe =
          PITCH.width /
          14;

        for (
          let i = 0;
          i < 14;
          i++
        ) {
          if (
            i % 2 ===
            0
          ) {
            ctx.fillStyle =
              "rgba(0,0,0,0.07)";

            ctx.fillRect(
              i * stripe,
              0,
              stripe,
              PITCH.height
            );
          }
        }
      };

    const drawFieldLines =
      ctx => {
        ctx.strokeStyle =
          "rgba(255,255,255,0.95)";

        ctx.lineWidth =
          3;

        ctx.strokeRect(
          2,
          2,
          PITCH.width -
            4,
          PITCH.height -
            4
        );

        ctx.beginPath();

        ctx.moveTo(
          PITCH.width / 2,
          0
        );

        ctx.lineTo(
          PITCH.width / 2,
          PITCH.height
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.arc(
          PITCH.width / 2,
          PITCH.height / 2,
          PITCH.centerCircleRadius,
          0,
          Math.PI * 2
        );

        ctx.stroke();

        ctx.beginPath();

        ctx.arc(
          PITCH.width / 2,
          PITCH.height / 2,
          4,
          0,
          Math.PI * 2
        );

        ctx.fillStyle =
          "#ffffff";

        ctx.fill();

        const penaltyTop =
          (PITCH.height -
            PITCH.penaltyBoxWidth) /
          2;

        ctx.strokeRect(
          0,
          penaltyTop,
          PITCH.penaltyBoxDepth,
          PITCH.penaltyBoxWidth
        );

        ctx.strokeRect(
          PITCH.width -
            PITCH.penaltyBoxDepth,

          penaltyTop,

          PITCH.penaltyBoxDepth,

          PITCH.penaltyBoxWidth
        );

        const goalBoxTop =
          (PITCH.height -
            PITCH.goalBoxWidth) /
          2;

        ctx.strokeRect(
          0,
          goalBoxTop,
          PITCH.goalBoxDepth,
          PITCH.goalBoxWidth
        );

        ctx.strokeRect(
          PITCH.width -
            PITCH.goalBoxDepth,

          goalBoxTop,

          PITCH.goalBoxDepth,

          PITCH.goalBoxWidth
        );

        ctx.beginPath();

        ctx.arc(
          105,
          PITCH.height / 2,
          4,
          0,
          Math.PI * 2
        );

        ctx.fill();

        ctx.beginPath();

        ctx.arc(
          PITCH.width -
            105,

          PITCH.height / 2,

          4,

          0,

          Math.PI * 2
        );

        ctx.fill();

        drawCornerArc(
          ctx,
          0,
          0
        );

        drawCornerArc(
          ctx,
          PITCH.width,
          0
        );

        drawCornerArc(
          ctx,
          0,
          PITCH.height
        );

        drawCornerArc(
          ctx,
          PITCH.width,
          PITCH.height
        );
      };

    const drawCornerArc =
      (
        ctx,
        x,
        y
      ) => {
        ctx.beginPath();

        const radius =
          12;

        let start = 0;
        let end =
          Math.PI / 2;

        if (
          x ===
            PITCH.width &&
          y === 0
        ) {
          start =
            Math.PI / 2;

          end =
            Math.PI;
        }

        if (
          x === 0 &&
          y ===
            PITCH.height
        ) {
          start =
            -Math.PI / 2;

          end = 0;
        }

        if (
          x ===
            PITCH.width &&
          y ===
            PITCH.height
        ) {
          start =
            Math.PI;

          end =
            Math.PI * 1.5;
        }

        ctx.arc(
          x,
          y,
          radius,
          start,
          end
        );

        ctx.stroke();
      };

    const drawGoals =
      ctx => {
        const top =
          (PITCH.height -
            PITCH.goalWidth) /
          2;

        ctx.strokeStyle =
          "#ffffff";

        ctx.lineWidth =
          4;

        ctx.strokeRect(
          -PITCH.goalDepth,
          top,
          PITCH.goalDepth,
          PITCH.goalWidth
        );

        ctx.strokeRect(
          PITCH.width,
          top,
          PITCH.goalDepth,
          PITCH.goalWidth
        );

        ctx.globalAlpha =
          0.30;

        ctx.lineWidth =
          1;

        for (
          let y = top;
          y <=
          top +
            PITCH.goalWidth;
          y += 10
        ) {
          ctx.beginPath();

          ctx.moveTo(
            0,
            y
          );

          ctx.lineTo(
            -PITCH.goalDepth,
            y
          );

          ctx.stroke();

          ctx.beginPath();

          ctx.moveTo(
            PITCH.width,
            y
          );

          ctx.lineTo(
            PITCH.width +
              PITCH.goalDepth,
            y
          );

          ctx.stroke();
        }

        ctx.globalAlpha =
          1;
      };

    const drawPlayers =
      ctx => {
        const snapshot =
          engine.getSnapshot();

        snapshot.players.forEach(
          player => {
            const home =
              player.teamSide ===
              "home";

            const radius =
              player.position ===
              "GK"
                ? 20
                : 16;

            const baseColor =
              home
                ? "#1683ff"
                : "#ef4444";

            const borderColor =
              player.redCard
                ? "#111827"
                : player.hasBall
                ? "#facc15"
                : home
                ? "#0b4ea2"
                : "#991b1b";

            ctx.beginPath();

            ctx.arc(
              player.x + 2,
              player.y + 3,
              radius,
              0,
              Math.PI * 2
            );

            ctx.fillStyle =
              "rgba(0,0,0,0.28)";

            ctx.fill();

            ctx.beginPath();

            ctx.arc(
              player.x,
              player.y,
              radius,
              0,
              Math.PI * 2
            );

            ctx.fillStyle =
              player.redCard
                ? "#64748b"
                : baseColor;

            ctx.fill();

            ctx.strokeStyle =
              borderColor;

            ctx.lineWidth =
              player.hasBall
                ? 4
                : 2;

            ctx.stroke();

            ctx.fillStyle =
              "#ffffff";

            ctx.font =
              "bold 11px Arial";

            ctx.textAlign =
              "center";

            ctx.textBaseline =
              "middle";

            ctx.fillText(
              player.number,
              player.x,
              player.y
            );

            if (
              player.position ===
              "GK"
            ) {
              ctx.font =
                "bold 8px Arial";

              ctx.fillText(
                "GK",
                player.x,
                player.y -
                  radius -
                  7
              );
            }

            if (
              player.hasBall
            ) {
              ctx.beginPath();

              ctx.arc(
                player.x,
                player.y -
                  radius -
                  9,
                3,
                0,
                Math.PI * 2
              );

              ctx.fillStyle =
                "#facc15";

              ctx.fill();
            }
          }
        );
      };

    const drawBall =
      ctx => {
        const snapshot =
          engine.getSnapshot();

        const ball =
          snapshot.ball;

        ctx.beginPath();

        ctx.arc(
          ball.x + 2,
          ball.y + 2,
          8,
          0,
          Math.PI * 2
        );

        ctx.fillStyle =
          "rgba(0,0,0,0.25)";

        ctx.fill();

        ctx.beginPath();

        ctx.arc(
          ball.x,
          ball.y,
          PITCH.ballRadius,
          0,
          Math.PI * 2
        );

        ctx.fillStyle =
          "#ffffff";

        ctx.fill();

        ctx.strokeStyle =
          "#111827";

        ctx.lineWidth =
          1.5;

        ctx.stroke();
      };

    const loop =
      timestamp => {
        if (
          previousTimeRef.current ===
          null
        ) {
          previousTimeRef.current =
            timestamp;
        }

        const delta =
          Math.min(
            (
              timestamp -
              previousTimeRef.current
            ) /
              1000,
            0.1
          );

        previousTimeRef.current =
          timestamp;

        engine.update(
          delta
        );

        drawPitch();

        animationRef.current =
          requestAnimationFrame(
            loop
          );
      };

    resize();

    window.addEventListener(
      "resize",
      resize
    );

    animationRef.current =
      requestAnimationFrame(
        loop
      );

    return () => {
      cancelAnimationFrame(
        animationRef.current
      );

      window.removeEventListener(
        "resize",
        resize
      );
    };
  }, [engine]);

  return (
    <div className="canvasContainer">
      <canvas
        ref={canvasRef}
        className="matchCanvas"
      />
    </div>
  );
}
