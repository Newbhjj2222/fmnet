import {
  useEffect,
  useRef,
} from "react";


const FIELD_WIDTH = 100;
const FIELD_HEIGHT = 64;


export default function MatchCanvas({
  snapshot,
}) {
  const canvasRef =
    useRef(null);


  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx =
      canvas.getContext(
        "2d"
      );

    if (!ctx) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    const dpr =
      window.devicePixelRatio ||
      1;

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

    const width =
      rect.width;

    const height =
      rect.height;


    /*
     * FIELD
     */

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    ctx.fillStyle =
      "#126b32";

    ctx.fillRect(
      0,
      0,
      width,
      height
    );


    /*
     * FIELD LINES
     */

    ctx.strokeStyle =
      "rgba(255,255,255,0.75)";

    ctx.lineWidth = 2;

    ctx.strokeRect(
      1,
      1,
      width - 2,
      height - 2
    );


    const centerX =
      width / 2;

    const centerY =
      height / 2;

    ctx.beginPath();

    ctx.moveTo(
      centerX,
      0
    );

    ctx.lineTo(
      centerX,
      height
    );

    ctx.stroke();


    ctx.beginPath();

    ctx.arc(
      centerX,
      centerY,
      height * 0.14,
      0,
      Math.PI * 2
    );

    ctx.stroke();


    /*
     * PENALTY AREAS
     */

    const boxWidth =
      width * 0.18;

    const boxHeight =
      height * 0.48;

    ctx.strokeRect(
      0,
      (height - boxHeight) / 2,
      boxWidth,
      boxHeight
    );

    ctx.strokeRect(
      width - boxWidth,
      (height - boxHeight) / 2,
      boxWidth,
      boxHeight
    );


    /*
     * GOALS
     */

    ctx.strokeRect(
      0,
      height * 0.40,
      width * 0.025,
      height * 0.20
    );

    ctx.strokeRect(
      width * 0.975,
      height * 0.40,
      width * 0.025,
      height * 0.20
    );


    /*
     * PLAYERS
     */

    const drawPlayers = (
      players,
      type
    ) => {
      if (!Array.isArray(players)) {
        return;
      }

      players.forEach(
        (player) => {
          if (
            player.onPitch ===
            false
          ) {
            return;
          }

          const x =
            (
              Number(
                player.x ?? 50
              ) /
              FIELD_WIDTH
            ) *
            width;

          const y =
            (
              Number(
                player.y ?? 32
              ) /
              FIELD_HEIGHT
            ) *
            height;


          const radius =
            Math.max(
              9,
              Math.min(
                14,
                width * 0.018
              )
            );


          /*
           * PLAYER BODY
           */

          ctx.beginPath();

          ctx.arc(
            x,
            y,
            radius,
            0,
            Math.PI * 2
          );

          ctx.fillStyle =
            type === "home"
              ? "#1677ff"
              : "#f04444";

          ctx.fill();

          ctx.strokeStyle =
            "#ffffff";

          ctx.lineWidth =
            1.5;

          ctx.stroke();


          /*
           * BALL INDICATOR
           */

          if (
            player.hasBall
          ) {
            ctx.beginPath();

            ctx.arc(
              x,
              y,
              radius + 4,
              0,
              Math.PI * 2
            );

            ctx.strokeStyle =
              "#ffd700";

            ctx.lineWidth = 2;

            ctx.stroke();
          }


          /*
           * NUMBER
           */

          ctx.fillStyle =
            "#ffffff";

          ctx.font =
            `bold ${Math.max(
              8,
              radius * 0.9
            )}px Arial`;

          ctx.textAlign =
            "center";

          ctx.textBaseline =
            "middle";

          ctx.fillText(
            String(
              player.number ??
              ""
            ),
            x,
            y
          );
        }
      );
    };


    drawPlayers(
      snapshot?.home?.players,
      "home"
    );

    drawPlayers(
      snapshot?.away?.players,
      "away"
    );


    /*
     * BALL
     */

    const ball =
      snapshot?.ball;

    if (ball) {
      const bx =
        (
          Number(
            ball.x ?? 50
          ) /
          FIELD_WIDTH
        ) *
        width;

      const by =
        (
          Number(
            ball.y ?? 32
          ) /
          FIELD_HEIGHT
        ) *
        height;

      ctx.beginPath();

      ctx.arc(
        bx,
        by,
        4,
        0,
        Math.PI * 2
      );

      ctx.fillStyle =
        "#ffffff";

      ctx.fill();

      ctx.strokeStyle =
        "#111111";

      ctx.stroke();
    }

  }, [
    snapshot,
  ]);


  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "100 / 64",
        position: "relative",
        borderRadius: 16,
        overflow: "hidden",
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
