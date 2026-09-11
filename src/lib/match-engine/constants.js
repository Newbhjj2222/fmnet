// lib/match-engine/constants.js

export const FIELD = {
  width: 1050,
  height: 680,

  left: 30,
  right: 1020,
  top: 30,
  bottom: 650,

  centerX: 525,
  centerY: 340,

  goalWidth: 120,
  goalDepth: 28,

  penaltyWidth: 440,
  penaltyHeight: 190,

  goalAreaWidth: 180,
  goalAreaHeight: 80,
};

export const MATCH = {
  realDurationSeconds: 240,
  matchMinutes: 90,
  halfTimeMinute: 45,

  playerRadius: 13,
  ballRadius: 5,

  decisionInterval: 0.8,
  tacticalInterval: 5,
  substitutionCheckInterval: 8,

  maxSubstitutions: 5,
};

export const FORMATIONS = {
  "4-4-2": [
    { role: "GK", x: 0.055, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.18 },
    { role: "CB", x: 0.15, y: 0.39 },
    { role: "CB", x: 0.15, y: 0.61 },
    { role: "RB", x: 0.17, y: 0.82 },

    { role: "LM", x: 0.34, y: 0.18 },
    { role: "CM", x: 0.35, y: 0.39 },
    { role: "CM", x: 0.35, y: 0.61 },
    { role: "RM", x: 0.34, y: 0.82 },

    { role: "ST", x: 0.52, y: 0.38 },
    { role: "ST", x: 0.52, y: 0.62 },
  ],

  "4-3-3": [
    { role: "GK", x: 0.055, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.18 },
    { role: "CB", x: 0.15, y: 0.39 },
    { role: "CB", x: 0.15, y: 0.61 },
    { role: "RB", x: 0.17, y: 0.82 },

    { role: "CM", x: 0.31, y: 0.30 },
    { role: "CDM", x: 0.30, y: 0.50 },
    { role: "CM", x: 0.31, y: 0.70 },

    { role: "LW", x: 0.50, y: 0.20 },
    { role: "ST", x: 0.55, y: 0.50 },
    { role: "RW", x: 0.50, y: 0.80 },
  ],

  "3-5-2": [
    { role: "GK", x: 0.055, y: 0.50 },

    { role: "CB", x: 0.15, y: 0.30 },
    { role: "CB", x: 0.14, y: 0.50 },
    { role: "CB", x: 0.15, y: 0.70 },

    { role: "LM", x: 0.30, y: 0.12 },
    { role: "CM", x: 0.32, y: 0.34 },
    { role: "CDM", x: 0.30, y: 0.50 },
    { role: "CM", x: 0.32, y: 0.66 },
    { role: "RM", x: 0.30, y: 0.88 },

    { role: "ST", x: 0.54, y: 0.40 },
    { role: "ST", x: 0.54, y: 0.60 },
  ],

  "5-3-2": [
    { role: "GK", x: 0.055, y: 0.50 },

    { role: "LWB", x: 0.17, y: 0.13 },
    { role: "CB", x: 0.14, y: 0.32 },
    { role: "CB", x: 0.13, y: 0.50 },
    { role: "CB", x: 0.14, y: 0.68 },
    { role: "RWB", x: 0.17, y: 0.87 },

    { role: "CM", x: 0.32, y: 0.30 },
    { role: "CDM", x: 0.30, y: 0.50 },
    { role: "CM", x: 0.32, y: 0.70 },

    { role: "ST", x: 0.54, y: 0.40 },
    { role: "ST", x: 0.54, y: 0.60 },
  ],

  "4-2-3-1": [
    { role: "GK", x: 0.055, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.18 },
    { role: "CB", x: 0.15, y: 0.39 },
    { role: "CB", x: 0.15, y: 0.61 },
    { role: "RB", x: 0.17, y: 0.82 },

    { role: "CDM", x: 0.30, y: 0.40 },
    { role: "CDM", x: 0.30, y: 0.60 },

    { role: "LW", x: 0.45, y: 0.20 },
    { role: "CAM", x: 0.44, y: 0.50 },
    { role: "RW", x: 0.45, y: 0.80 },

    { role: "ST", x: 0.57, y: 0.50 },
  ],
};

export const DEFAULT_TACTICS = {
  mentality: "balanced",
  pressing: "medium",
  width: 55,
  defensiveLine: 50,
  tempo: 55,
  passingStyle: "mixed",
  attackingFocus: "balanced",
  counterAttack: true,
};

export const MENTALITY = {
  defensive: {
    attack: -0.20,
    defense: 0.25,
    width: -8,
    line: -12,
  },

  balanced: {
    attack: 0,
    defense: 0,
    width: 0,
    line: 0,
  },

  attacking: {
    attack: 0.25,
    defense: -0.18,
    width: 10,
    line: 12,
  },
};

export const ROLE_GROUPS = {
  goalkeeper: ["GK", "GKP", "GOALKEEPER"],

  defender: [
    "CB",
    "DC",
    "LB",
    "RB",
    "LWB",
    "RWB",
    "DF",
    "DEF",
  ],

  midfielder: [
    "CM",
    "CDM",
    "CAM",
    "LM",
    "RM",
    "DM",
    "AM",
    "MF",
  ],

  attacker: [
    "ST",
    "CF",
    "LW",
    "RW",
    "LF",
    "RF",
    "FW",
  ],
};

export const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

export const random = (min, max) =>
  Math.random() * (max - min) + min;

export const randomInt = (min, max) =>
  Math.floor(random(min, max + 1));

export const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const lerp = (a, b, t) =>
  a + (b - a) * t;

export function teamDirection(team) {
  return team === "home" ? 1 : -1;
}
