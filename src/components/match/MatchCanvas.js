import {
  useEffect,
  useRef,
} from "react";

import {
  PITCH,
  COLORS,
} from "../../lib/match-engine/constants";

export default function MatchCanvas({
  engine,
}) {
  const canvasRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const lastTimeRef =
    useRef(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas || !engine) {
      return;
    }

    const ctx =
      canvas.getContext("2d");

    let width =
      PITCH.width;

    let height =
      PITCH.height;

    const resizeCanvas = () => {
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

      const displayWidth =
        PITCH.width * scale;

      const displayHeight =
        PITCH.height * scale;

      canvas.style.width =
        `${displayWidth}px`;

      canvas.style.height =
        `${displayHeight}px`;

      const dpr =
        window.devicePixelRatio ||
        1;

      canvas.width =
        PITCH.width * dpr;

      canvas.height =
        PITCH.height * dpr;

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      width =
        PITCH.width;

      height =
        PITCH.height;
    };

    const drawPitch = () => {
      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      ctx.fillStyle =
        COLORS.pitch;

      ctx.fillRect(
        0,
        0,
        width,
        height
      );

      drawGrass(ctx);

      drawLines(ctx);

      drawGoals(ctx);

      drawPlayers(ctx);

      drawBall(ctx);
    };

    const drawGrass = ctx => {
      const stripeWidth =
        width / 14;

      for (
        let i = 0;
        i < 14;
        i++
      ) {
        if (i % 2 === 0) {
          ctx.fillStyle =
            COLORS.pitchDark;

          ctx.fillRect(
            i * stripeWidth,
            0,
            stripeWidth,
            height
          );
        }
      }
    };

    const drawLines = ctx => {
      ctx.strokeStyle =
        COLORS.line;

      ctx.lineWidth = 3;

      ctx.strokeRect(
        2,
        2,
        width - 4,
        height - 4
      );

      ctx.beginPath();

      ctx.moveTo(
        width / 2,
        0
      );

      ctx.lineTo(
        width / 2,
        height
      );

      ctx.stroke();

      ctx.beginPath();

      ctx.arc(
        width / 2,
        height / 2,
        PITCH.centerCircleRadius,
        0,
        Math.PI * 2
      );

      ctx.stroke();

      ctx.beginPath();

      ctx.arc(
        width / 2,
        height / 2,
        5,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        COLORS.line;

      ctx.fill();

      /*
       * Home penalty area
       */
      ctx.strokeRect(
        0,
        (height -
          PITCH.penaltyBoxWidth) /
          2,

        PITCH.penaltyBoxDepth,

        PITCH.penaltyBoxWidth
      );

      /*
       * Away penalty area
       */
      ctx.strokeRect(
        width -
          PITCH.penaltyBoxDepth,

        (height -
          PITCH.penaltyBoxWidth) /
          2,

        PITCH.penaltyBoxDepth,

        PITCH.penaltyBoxWidth
      );

      /*
       * Goal boxes
       */
      ctx.strokeRect(
        0,
        (height -
          PITCH.goalBoxWidth) /
          2,

        PITCH.goalBoxDepth,

        PITCH.goalBoxWidth
      );

      ctx.strokeRect(
        width -
          PITCH.goalBoxDepth,

        (height -
          PITCH.goalBoxWidth) /
          2,

        PITCH.goalBoxDepth,

        PITCH.goalBoxWidth
      );

      /*
       * Penalty spots
       */
      ctx.fillStyle =
        COLORS.line;

      ctx.beginPath();

      ctx.arc(
        105,
        height / 2,
        4,
        0,
        Math.PI * 2
      );

      ctx.fill();

      ctx.beginPath();

      ctx.arc(
        width - 105,
        height / 2,
        4,
        0,
        Math.PI * 2
      );

      ctx.fill();
    };

    const drawGoals = ctx => {
      const goalTop =
        (height -
          PITCH.goalWidth) /
          2;

      const goalBottom =
        goalTop +
        PITCH.goalWidth;

      ctx.strokeStyle =
        "#ffffff";

      ctx.lineWidth = 4;

      /*
       * Left goal
       */
      ctx.strokeRect(
        -PITCH.goalDepth,
        goalTop,
        PITCH.goalDepth,
        PITCH.goalWidth
      );

      /*
       * Right goal
       */
      ctx.strokeRect(
        width,
        goalTop,
        PITCH.goalDepth,
        PITCH.goalWidth
      );

      ctx.lineWidth = 3;

      /*
       * Net lines
       */
      ctx.globalAlpha = 0.35;

      for (
        let y = goalTop;
        y <= goalBottom;
        y += 12
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
          width,
          y
        );

        ctx.lineTo(
          width +
            PITCH.goalDepth,
          y
        );

        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    };

    const drawPlayers = ctx => {
      const snapshot =
        engine.getSnapshot();

      snapshot.players.forEach(
        player => {
          const isHome =
            player.teamSide ===
            "home";

          const baseColor =
            isHome
              ? COLORS.home
              : COLORS.away;

          const darkColor =
            isHome
              ? COLORS.homeDark
              : COLORS.awayDark;

          const radius =
            player.position === "GK"
              ? 20
              : PITCH.playerRadius;

          /*
           * Player shadow
           */
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

          /*
           * Player circle
           */
          ctx.beginPath();

          ctx.arc(
            player.x,
            player.y,
            radius,
            0,
            Math.PI * 2
          );

          ctx.fillStyle =
            baseColor;

          ctx.fill();

          ctx.strokeStyle =
            player.hasBall
              ? "#facc15"
              : darkColor;

          ctx.lineWidth =
            player.hasBall
              ? 4
              : 2;

          ctx.stroke();

          /*
           * Shirt number
           */
          ctx.fillStyle =
            "#ffffff";

          ctx.font =
            "bold 12px Arial";

          ctx.textAlign =
            "center";

          ctx.textBaseline =
            "middle";

          ctx.fillText(
            player.number,
            player.x,
            player.y
          );

          /*
           * GK label
           */
          if (
            player.position ===
            "GK"
          ) {
            ctx.font =
              "bold 9px Arial";

            ctx.fillText(
              "GK",
              player.x,
              player.y -
                radius -
                8
            );
          }
        }
      );
    };

    const drawBall = ctx => {
      const ball =
        engine.getSnapshot()
          .ball;

      ctx.beginPath();

      ctx.arc(
        ball.x + 1,
        ball.y + 2,
        PITCH.ballRadius + 2,
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
        COLORS.ball;

      ctx.fill();

      ctx.strokeStyle =
        "#111827";

      ctx.lineWidth = 1.5;

      ctx.stroke();
    };

    const loop = timestamp => {
      if (
        lastTimeRef.current ===
        null
      ) {
        lastTimeRef.current =
          timestamp;
      }

      let delta =
        (timestamp -
          lastTimeRef.current) /
        1000;

      lastTimeRef.current =
        timestamp;

      /*
       * Prevent giant jumps if the
       * browser tab sleeps.
       */
      delta =
        Math.min(delta, 0.1);

      engine.update(delta);

      drawPitch();

      animationRef.current =
        requestAnimationFrame(
          loop
        );
    };

    resizeCanvas();

    const resizeObserver =
      new ResizeObserver(
        resizeCanvas
      );

    if (
      canvas.parentElement
    ) {
      resizeObserver.observe(
        canvas.parentElement
      );
    }

    window.addEventListener(
      "resize",
      resizeCanvas
    );

    animationRef.current =
      requestAnimationFrame(
        loop
      );

    return () => {
      cancelAnimationFrame(
        animationRef.current
      );

      resizeObserver.disconnect();

      window.removeEventListener(
        "resize",
        resizeCanvas
      );
    };
  }, [engine]);

  return (
    <div className="matchCanvas">
      <canvas
        ref={canvasRef}
        className="canvas"
      />
    </div>
  );
}
