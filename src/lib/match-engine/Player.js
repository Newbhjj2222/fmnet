import Vector2 from "./Vector2";
import { PLAYER_STATE, PITCH, INJURY } from "./constants";

const num = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function overallOf(data) {
  return clamp(num(data?.overall ?? data?.rating ?? data?.ovr ?? data?.overallRating, 60), 35, 99);
}

export default class Player {
  constructor(data, positionData) {
    this.id = String(data?.id ?? data?.playerId ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.name = data?.name || data?.fullName || `${data?.firstName || ""} ${data?.lastName || ""}`.trim() || "Unknown Player";
    this.teamId = data.teamId;
    this.teamSide = data.teamSide;
    this.number = num(data?.shirtNumber ?? data?.number, 1);
    this.rawPosition = data?.position || data?.primaryPosition || data?.role || positionData?.role || "MID";
    this.position = positionData?.role || normalizePosition(this.rawPosition);
    this.overall = overallOf(data);

    this.speed = num(data?.speed, deriveStat(this.overall, 70));
    this.acceleration = num(data?.acceleration, deriveStat(this.overall, 68));
    this.stamina = clamp(num(data?.stamina, deriveStat(this.overall, 82)), 1, 100);

    this.passing = derivePlayerStat(data, ["passing", "pass", "passingRating"], this.overall);
    this.vision = derivePlayerStat(data, ["vision", "creativity"], this.overall);
    this.dribbling = derivePlayerStat(data, ["dribbling", "dribble"], this.overall);
    this.shooting = derivePlayerStat(data, ["shooting", "finishing", "shot"], this.overall);
    this.tackling = derivePlayerStat(data, ["tackling", "defending"], this.overall);
    this.positioning = derivePlayerStat(data, ["positioning", "defensivePositioning"], this.overall);
    this.composure = derivePlayerStat(data, ["composure", "mental"], this.overall);
    this.reaction = derivePlayerStat(data, ["reaction", "reflexes"], this.overall);
    this.handling = derivePlayerStat(data, ["handling", "goalkeeping"], this.overall);
    this.diving = derivePlayerStat(data, ["diving", "goalkeeperDiving"], this.overall);

    this.height = num(data?.height, 175);
    this.age = num(data?.age, 25);

    this.x = positionData.x;
    this.y = positionData.y;
    this.homeX = positionData.x;
    this.homeY = positionData.y;

    this.target = new Vector2(this.x, this.y);
    this.velocity = new Vector2();

    this.hasBall = false;
    this.state = PLAYER_STATE.IDLE;

    this.yellowCards = 0;
    this.redCard = false;

    this.minutesPlayed = 0;
    this.lastActionAt = 0;

    // Injury
    this.injury = null; // { type, severity, minutesOut }
    this.fitness = 100; // 0-100
    this.form = 100; // 0-100

    this.stats = {
      passes: 0, passesCompleted: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, goals: 0,
      tackles: 0, interceptions: 0, fouls: 0,
      dribbles: 0, saves: 0,
    };

    this.radius = this.position === "GK" ? PITCH.goalkeeperRadius : PITCH.playerRadius;
  }

  setTarget(x, y) {
    this.target.set(
      clamp(x, this.radius, PITCH.width - this.radius),
      clamp(y, this.radius, PITCH.height - this.radius)
    );
  }

  distanceToPoint(x, y) {
    return Math.sqrt((this.x - x) ** 2 + (this.y - y) ** 2);
  }

  distanceToPlayer(p) { return this.distanceToPoint(p.x, p.y); }

  isInjured() { return !!this.injury; }

  injure(type = "strain", severity = "minor") {
    const range = severity === "severe" ? INJURY.MINUTES_OUT_SEVERE : INJURY.MINUTES_OUT_MINOR;
    const minutesOut = range[0] + Math.random() * (range[1] - range[0]);
    this.injury = { type, severity, minutesOut };
    this.state = PLAYER_STATE.INJURED;
    this.hasBall = false;
    this.velocity.multiply(0);
  }

  recover() {
    this.injury = null;
    this.state = PLAYER_STATE.IDLE;
  }

  update(dt) {
    if (this.redCard || this.state === PLAYER_STATE.INJURED) return;

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      this.velocity.multiply(0.7);
      // recovery when idle
      this.stamina = clamp(this.stamina + dt * 0.4, 0, 100);
      return;
    }

    const dir = new Vector2(dx, dy).normalize();

    const formFactor = 0.85 + (this.form / 100) * 0.15;
    const staminaFactor = 0.55 + (this.stamina / 100) * 0.45;
    const maxSpeed = (34 + this.speed * 0.72) * staminaFactor * formFactor;

    const desired = dir.multiply(maxSpeed);

    // acceleration + tempo affects
    const accel = Math.min(1, (this.acceleration * dt * 0.035) * (0.9 + this.fitness / 500));
    this.velocity.x += (desired.x - this.velocity.x) * accel;
    this.velocity.y += (desired.y - this.velocity.y) * accel;

    const vl = this.velocity.length();
    if (vl > maxSpeed) this.velocity.normalize().multiply(maxSpeed);

    this.x += this.velocity.x * dt;
    this.y += this.velocity.y * dt;

    this.x = clamp(this.x, this.radius, PITCH.width - this.radius);
    this.y = clamp(this.y, this.radius, PITCH.height - this.radius);

    // Stamina drain
    const movement = this.velocity.length();
    if (movement > 15) {
      const drain = (movement / 100) * dt * 0.55;
      this.stamina = clamp(this.stamina - drain, 0, 100);
      this.fitness = clamp(this.fitness - dt * 0.05, 0, 100);
      this.minutesPlayed += dt / 60;
    }
  }

  resetToFormation() {
    this.x = this.homeX;
    this.y = this.homeY;
    this.target.set(this.homeX, this.homeY);
    this.velocity.multiply(0);
    this.hasBall = false;
    if (!this.isInjured()) this.state = PLAYER_STATE.IDLE;
  }
}

function deriveStat(overall, base) { return clamp(base + (overall - 60) * 0.55, 40, 98); }

function derivePlayerStat(data, fields, overall) {
  for (const field of fields) {
    if (data?.[field] !== undefined) {
      return clamp(num(data[field], overall), 1, 99);
    }
  }
  return deriveStat(overall, 68);
}

function normalizePosition(position) {
  const p = String(position || "").toLowerCase();
  if (p.includes("goalkeeper") || p === "gk" || p.includes("keeper")) return "GK";
  if (p.includes("back") || p.includes("def") || ["cb", "lb", "rb", "lwb", "rwb"].includes(p)) return "DEF";
  if (p.includes("striker") || p.includes("forward") || p.includes("attack") || ["st", "cf", "lw", "rw"].includes(p)) return "ATT";
  return "MID";
}
