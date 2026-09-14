import {
  useCallback,
  useEffect,
  useRef,
} from "react";

import styles from "./MatchCanvas.module.css";


/* =========================================================
   FIELD DIMENSIONS (logical)
   Pitch is 100 wide x 64 tall (standard ratio)
========================================================= */

const FIELD_WIDTH = 100;
const FIELD_HEIGHT = 64;

const PITCH_GREEN_DARK = "#0a3d20";
const PITCH_GREEN_LIGHT = "#0f5b2e";
const LINE_COLOR = "rgba(255, 255, 255, 0.75)";

const HOME_COLOR = "#1677ff";
const HOME_COLOR_DARK = "#0a4bb8";
const AWAY_COLOR = "#f04444";
const AWAY_COLOR_DARK = "#a82626";

const BALL_GLOW = "#ffd700";


/* =========================================================
   HELPERS
========================================================= */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toX(playerX, width) {
  const x = clamp(Number(playerX ?? 50), 0, FIELD_WIDTH);
  return (x / FIELD_WIDTH) * width;
}

function toY(playerY, height) {
  const y = clamp(Number(playerY ?? 32), 0, FIELD_HEIGHT);
  return (y / FIELD_HEIGHT) * height;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}


/* =========================================================
   DRAWING FUNCTIONS
========================================================= */

function drawPitch(ctx, width, height) {
  /* Base pitch */
  const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
  baseGradient.addColorStop(0, PITCH_GREEN_DARK);
  baseGradient.addColorStop(0.5, PITCH_GREEN_LIGHT);
  baseGradient.addColorStop(1, PITCH_GREEN_DARK);

  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, 0, width, height);


  /* Mowing stripes */
  const stripes = 10;
  const stripeWidth = width / stripes;

  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      ctx.fillRect(i * stripeWidth, 0, stripeWidth, height);
    }
  }


  /* Subtle vignette */
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.35)");

  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);


  /* Field outline */
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;

  const padding = 3;
  roundedRect(
    ctx,
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
    4
  );
  ctx.stroke();


  /* Halfway line */
  ctx.beginPath();
  ctx.moveTo(width / 2, padding);
  ctx.lineTo(width / 2, height - padding);
  ctx.stroke();


  /* Center circle */
  const centerRadius = height * 0.16;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, centerRadius, 0, Math.PI * 2);
  ctx.stroke();


  /* Center spot */
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 2, 0, Math.PI * 2);
  ctx.fillStyle = LINE_COLOR;
  ctx.fill();


  /* Penalty boxes */
  const boxWidth = width * 0.16;
  const boxHeight = height * 0.55;
  const boxY = (height - boxHeight) / 2;

  ctx.strokeRect(padding, boxY, boxWidth, boxHeight);
  ctx.strokeRect(width - padding - boxWidth, boxY, boxWidth, boxHeight);


  /* Goal areas */
  const goalAreaWidth = width * 0.07;
  const goalAreaHeight = height * 0.28;
  const goalAreaY = (height - goalAreaHeight) / 2;

  ctx.strokeRect(padding, goalAreaY, goalAreaWidth, goalAreaHeight);
  ctx.strokeRect(
    width - padding - goalAreaWidth,
    goalAreaY,
    goalAreaWidth,
    goalAreaHeight
  );


  /* Penalty spots */
  ctx.beginPath();
  ctx.arc(padding + boxWidth * 0.65, height / 2, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(
    width - padding - boxWidth * 0.65,
    height / 2,
    2,
    0,
    Math.PI * 2
  );
  ctx.fill();


  /* Penalty arcs */
  const arcRadius = height * 0.14;

  ctx.beginPath();
  ctx.arc(
    padding + boxWidth * 0.65,
    height / 2,
    arcRadius,
    -Math.PI / 2.8,
    Math.PI / 2.8
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    width - padding - boxWidth * 0.65,
    height / 2,
    arcRadius,
    Math.PI - Math.PI / 2.8,
    Math.PI + Math.PI / 2.8
  );
  ctx.stroke();


  /* Goals */
  const goalWidth = width * 0.018;
  const goalHeight = height * 0.16;
  const goalY = (height - goalHeight) / 2;

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(padding - goalWidth, goalY, goalWidth, goalHeight);
  ctx.fillRect(
    width - padding,
    goalY,
    goalWidth,
    goalHeight
  );


  /* Corner arcs */
  const cornerRadius = height * 0.03;

  ctx.beginPath();
  ctx.arc(padding, padding, cornerRadius, 0, Math.PI / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    width - padding,
    padding,
    cornerRadius,
    Math.PI / 2,
    Math.PI
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    padding,
    height - padding,
    cornerRadius,
    -Math.PI / 2,
    0
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    width - padding,
    height - padding,
    cornerRadius,
    Math.PI,
    Math.PI * 1.5
  );
  ctx.stroke();
}


function drawPlayer(ctx, player, type, width, height) {
  if (!player || player.onPitch === false) return;

  const x = toX(player.x, width);
  const y = toY(player.y, height);

  const radius = clamp(width * 0.017, 8, 14);

  const isHome = type === "home";
  const primary = isHome ? HOME_COLOR : AWAY_COLOR;
  const dark = isHome ? HOME_COLOR_DARK : AWAY_COLOR_DARK;


  /* Shadow under player */
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.6, radius * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fill();


  /* Has-ball glow */
  if (player.hasBall) {
    const glow = ctx.createRadialGradient(x, y, radius, x, y, radius * 2.4);
    glow.addColorStop(0, "rgba(255, 215, 0, 0.55)");
    glow.addColorStop(1, "rgba(255, 215, 0, 0)");

    ctx.beginPath();
    ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }


  /* Body gradient */
  const bodyGradient = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.3,
    radius * 0.15,
    x,
    y,
    radius
  );
  bodyGradient.addColorStop(0, primary);
  bodyGradient.addColorStop(1, dark);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = bodyGradient;
  ctx.fill();


  /* Outline */
  ctx.lineWidth = Math.max(1.2, radius * 0.14);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();


  /* Has-ball ring */
  if (player.hasBall) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 3.5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = BALL_GLOW;
    ctx.stroke();
  }


  /* Number */
  const number = player.number ?? "";
  if (number !== "") {
    const fontSize = Math.max(8, radius * 0.95);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 3;

    ctx.fillText(String(number), x, y + 0.5);

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
}


function drawBall(ctx, ball, width, height) {
  if (!ball) return;

  const x = toX(ball.x, width);
  const y = toY(ball.y, height);

  const radius = clamp(width * 0.006, 3.5, 6);


  /* Ball glow */
  const glow = ctx.createRadialGradient(x, y, radius, x, y, radius * 3);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.beginPath();
  ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();


  /* Ball body */
  const ballGradient = ctx.createRadialGradient(
    x - radius * 0.4,
    y - radius * 0.4,
    radius * 0.2,
    x,
    y,
    radius
  );
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(1, "#c9d2dc");

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = ballGradient;
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#0b1016";
  ctx.stroke();


  /* Small pentagon accents */
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "#0b1016";
  ctx.fill();
}


/* =========================================================
   COMPONENT
========================================================= */

export default function MatchCanvas({ snapshot }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);


  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;

    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = wrapper.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;

    /* Background */
    ctx.clearRect(0, 0, width, height);

    /* Pitch */
    drawPitch(ctx, width, height);

    /* Players */
    drawPlayers(ctx, snapshot?.home?.players, "home", width, height);
    drawPlayers(ctx, snapshot?.away?.players, "away", width, height);

    /* Ball */
    drawBall(ctx, snapshot?.ball, width, height);
  }, [snapshot]);


  /* Re-render when snapshot changes */
  useEffect(() => {
    render();
  }, [render]);


  /* Re-render on resize */
  useEffect(() => {
    const handleResize = () => {
      window.requestAnimationFrame(render);
    };

    window.addEventListener("resize", handleResize);

    /* Also observe wrapper size changes */
    let observer = null;

    if (typeof ResizeObserver !== "undefined" && wrapperRef.current) {
      observer = new ResizeObserver(() => {
        window.requestAnimationFrame(render);
      });
      observer.observe(wrapperRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (observer) observer.disconnect();
    };
  }, [render]);


  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}


/* =========================================================
   DRAW PLAYERS (helper for both teams)
========================================================= */

function drawPlayers(ctx, players, type, width, height) {
  if (!Array.isArray(players)) return;

  players.forEach((player) => {
    drawPlayer(ctx, player, type, width, height);
  });
}
