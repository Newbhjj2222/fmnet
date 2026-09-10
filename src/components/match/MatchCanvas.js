import { useEffect, useRef } from "react";
import { PITCH } from "../../lib/match-engine/constants";
import styles from "../../pages/match/Mach.module.css";

const HOME_COLOR = "#3b82f6";
const AWAY_COLOR = "#ef4444";
const GRASS_1 = "#0f5132";
const GRASS_2 = "#0a3d24";
const LINE = "rgba(255,255,255,0.55)";

function drawPitch(ctx, w, h) {
  const stripes = 14;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? GRASS_1 : GRASS_2;
    ctx.fillRect(i * sw, 0, sw + 1, h);
  }

  const pad = 8;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  ctx.beginPath();
  ctx.moveTo(w / 2, pad);
  ctx.lineTo(w / 2, h - pad);
  ctx.stroke();

  const scaleX = (w - pad * 2) / PITCH.width;
  const scaleY = (h - pad * 2) / PITCH.height;
  const cr = PITCH.centerCircleRadius * scaleX;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, cr, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();

  const pbD = PITCH.penaltyBoxDepth * scaleX;
  const pbW = PITCH.penaltyBoxWidth * scaleY;
  const pbY = (h - pbW) / 2;
  ctx.strokeRect(pad, pbY, pbD, pbW);
  ctx.strokeRect(w - pad - pbD, pbY, pbD, pbW);

  const gbD = PITCH.goalBoxDepth * scaleX;
  const gbW = PITCH.goalBoxWidth * scaleY;
  const gbY = (h - gbW) / 2;
  ctx.strokeRect(pad, gbY, gbD, gbW);
  ctx.strokeRect(w - pad - gbD, gbY, gbD, gbW);

  const goalW = PITCH.goalWidth * scaleY;
  const goalY = (h - goalW) / 2;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(pad, goalY); ctx.lineTo(pad - 5, goalY);
  ctx.lineTo(pad - 5, goalY + goalW); ctx.lineTo(pad, goalY + goalW);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w - pad, goalY); ctx.lineTo(w - pad + 5, goalY);
  ctx.lineTo(w - pad + 5, goalY + goalW); ctx.lineTo(w - pad, goalY + goalW);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(pad + 115 * scaleX, h / 2, 3, 0, Math.PI * 2);
  ctx.arc(w - pad - 115 * scaleX, h / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = LINE;
  ctx.fill();
}

function drawPlayers(ctx, players, ball, w, h) {
  const pad = 8;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const sx = innerW / PITCH.width;
  const sy = innerH / PITCH.height;

  players.forEach(p => {
    const px = pad + p.x * sx;
    const py = pad + p.y * sy;
    const r = p.position === "GK" ? 11 : 9.5;

    ctx.globalAlpha = p.redCard ? 0.2 : 1;

    ctx.beginPath();
    ctx.arc(px + 1, py + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = p.teamSide === "home" ? HOME_COLOR : AWAY_COLOR;
    ctx.fill();
    ctx.strokeStyle = p.hasBall ? "#fbbf24" : "rgba(255,255,255,0.85)";
    ctx.lineWidth = p.hasBall ? 3 : 1.5;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.number), px, py + 0.5);

    const sw = 18;
    const stX = px - sw / 2;
    const stY = py + r + 2;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(stX, stY, sw, 2.5);
    const c = p.stamina > 60 ? "#22c55e"
      : p.stamina > 30 ? "#eab308" : "#ef4444";
    ctx.fillStyle = c;
    ctx.fillRect(stX, stY, sw * (p.stamina / 100), 2.5);

    if (p.injury) {
      ctx.beginPath();
      ctx.arc(px + r - 2, py - r + 2, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px sans-serif";
      ctx.fillText("+", px + r - 2, py - r + 2.5);
    }

    if (p.yellowCards > 0 && !p.redCard) {
      ctx.fillStyle = "#facc15";
      ctx.fillRect(px - r - 5, py - r, 3, 5);
    }

    ctx.globalAlpha = 1;
  });

  if (ball) {
    const bx = pad + ball.position.x * sx;
    const by = pad + ball.position.y * sy;
    ctx.beginPath();
    ctx.arc(bx + 1, by + 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export default function MatchCanvas({ engine }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(engine);

  useEffect(() => { engineRef.current = engine; }, [engine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;

    const loop = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      drawPitch(ctx, w, h);

      const e = engineRef.current;
      if (e) drawPlayers(ctx, e.players, e.ball, w, h);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={1050}
      height={680}
      className={styles.matchCanvas}
    />
  );
}
