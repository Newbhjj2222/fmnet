// lib/match-engine/constants.js

export const FIELD = {
  width: 1050,
  height: 680,

  goalWidth: 120,
  goalDepth: 28,

  centerX: 525,
  centerY: 340,

  penaltyBoxWidth: 165,
  penaltyBoxHeight: 360,

  sixYardWidth: 70,
  sixYardHeight: 170,
};

export const MATCH = {
  REAL_DURATION_SECONDS: 240,
  MATCH_MINUTES: 90,

  FIRST_HALF: 45,
  SECOND_HALF: 90,

  MAX_SUBSTITUTIONS: 5,

  SIM_MINUTES_PER_REAL_SECOND:
    90 / 240,

  UI_UPDATE_MS: 33,
  SAVE_INTERVAL_MS: 10000,
};

export const PLAYER = {
  radius: 13,

  minSpeed: 25,
  maxSpeed: 105,

  acceleration: 180,
  deceleration: 220,

  staminaMax: 100,
};

export const BALL = {
  radius: 6,

  maxPassSpeed: 250,
  minPassSpeed: 90,

  maxShotSpeed: 390,

  friction: 0.985,
};

export const TEAM_SIDE = {
  HOME: "home",
  AWAY: "away",
};

export const BALL_STATE = {
  FREE: "free",
  POSSESSED: "possessed",
  PASSING: "passing",
  SHOOTING: "shooting",
  CROSSING: "crossing",
  SAVED: "saved",
  DEFLECTED: "deflected",
  OUT: "out",
  GOAL: "goal",
};

export const PLAYER_STATES = {
  IDLE: "idle",
  SUPPORT: "support",
  ATTACK: "attack",
  PRESS: "press",
  MARK: "mark",
  RETREAT: "retreat",
  CARRY: "carry",
  PASS: "pass",
  SHOOT: "shoot",
  RECOVER: "recover",
};

export const POSITIONS = {
  GK: "GK",

  CB: "CB",
  LB: "LB",
  RB: "RB",
  LWB: "LWB",
  RWB: "RWB",

  CDM: "CDM",
  CM: "CM",
  CAM: "CAM",
  LM: "LM",
  RM: "RM",

  LW: "LW",
  RW: "RW",
  CF: "CF",
  ST: "ST",
};

export const DEFAULT_TACTICS = {
  mentality: "balanced",
  pressing: "medium",
  defensiveLine: "medium",
  width: "medium",
  tempo: "medium",
  passingStyle: "mixed",
  counterAttack: true,
};

export const MENTALITY = {
  DEFENSIVE: "defensive",
  BALANCED: "balanced",
  ATTACKING: "attacking",
};

export const PRESSING = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export const EVENTS = {
  KICKOFF: "kickoff",
  SHOT: "shot",
  SHOT_ON_TARGET: "shot_on_target",
  GOAL: "goal",
  SAVE: "save",
  PASS: "pass",
  TACKLE: "tackle",
  FOUL: "foul",
  YELLOW: "yellow",
  RED: "red",
  CORNER: "corner",
  THROW_IN: "throw_in",
  GOAL_KICK: "goal_kick",
  OFFSIDE: "offside",
  SUBSTITUTION: "substitution",
  HALFTIME: "halftime",
  FULLTIME: "fulltime",
  DRIBBLE: "dribble",
  INTERCEPTION: "interception",
};

export const DEFAULT_STATS = () => ({
  possessionSeconds: 0,

  passes: 0,
  passesCompleted: 0,

  shots: 0,
  shotsOnTarget: 0,

  goals: 0,
  assists: 0,

  tackles: 0,
  interceptions: 0,
  fouls: 0,

  corners: 0,
  offsides: 0,

  yellowCards: 0,
  redCards: 0,

  saves: 0,

  dribbles: 0,
  crosses: 0,

  xG: 0,
});

export const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

export const lerp = (a, b, t) =>
  a + (b - a) * t;

export const distance = (a, b) =>
  Math.hypot(
    b.x - a.x,
    b.y - a.y
  );

export const randomBetween = (min, max) =>
  min + Math.random() * (max - min);

export const randomInt = (min, max) =>
  Math.floor(randomBetween(min, max + 1));

export const normalizePosition = (position = "") => {
  const value = String(position)
    .trim()
    .toUpperCase();

  if (
    ["GK", "GKP", "GOALKEEPER", "KEEPER"].includes(value)
  ) {
    return "GK";
  }

  if (
    [
      "CB",
      "DC",
      "DF",
      "LB",
      "RB",
      "LWB",
      "RWB",
      "DEF",
    ].includes(value)
  ) {
    return value === "DF" ? "CB" : value;
  }

  if (
    [
      "CDM",
      "DM",
      "CM",
      "CAM",
      "AM",
      "LM",
      "RM",
      "MF",
    ].includes(value)
  ) {
    if (value === "DM") return "CDM";
    if (value === "AM") return "CAM";
    if (value === "MF") return "CM";

    return value;
  }

  if (
    [
      "ST",
      "CF",
      "LW",
      "RW",
      "LF",
      "RF",
      "FW",
    ].includes(value)
  ) {
    if (value === "FW") return "ST";
    if (value === "LF") return "LW";
    if (value === "RF") return "RW";

    return value;
  }

  return "CM";
};
