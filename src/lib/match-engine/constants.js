export const PITCH = {
  width: 1050,
  height: 680,

  goalWidth: 150,
  goalDepth: 28,

  penaltyWidth: 360,
  penaltyHeight: 220,

  sixYardWidth: 170,
  sixYardHeight: 90,

  centerCircle: 82,
};

export const MATCH = {
  realDuration: 240,
  matchMinutes: 90,

  firstHalf: 45,
  secondHalf: 90,

  playerDecisionInterval: 0.65,
  teamDecisionInterval: 1.25,

  maxDt: 0.05,
};

export const BALL = {
  radius: 6,
  maxPassSpeed: 680,
  maxShotSpeed: 920,
  controlDistance: 18,
};

export const PLAYER = {
  radius: 15,

  baseSpeed: 105,
  sprintSpeed: 150,

  acceleration: 320,
  deceleration: 260,

  tackleDistance: 27,
  pressureDistance: 105,

  staminaDrain: 0.018,
  sprintDrain: 0.045,
};

export const FORMATIONS = {
  "4-4-2": [
    "GK",
    "LB",
    "CB",
    "CB",
    "RB",
    "LM",
    "CM",
    "CM",
    "RM",
    "ST",
    "ST",
  ],

  "4-3-3": [
    "GK",
    "LB",
    "CB",
    "CB",
    "RB",
    "CM",
    "CM",
    "CM",
    "LW",
    "ST",
    "RW",
  ],

  "3-5-2": [
    "GK",
    "CB",
    "CB",
    "CB",
    "LWB",
    "CM",
    "CDM",
    "CM",
    "RWB",
    "ST",
    "ST",
  ],

  "5-3-2": [
    "GK",
    "LWB",
    "CB",
    "CB",
    "CB",
    "RWB",
    "CM",
    "CM",
    "CM",
    "ST",
    "ST",
  ],

  "4-2-3-1": [
    "GK",
    "LB",
    "CB",
    "CB",
    "RB",
    "CDM",
    "CDM",
    "LW",
    "CAM",
    "RW",
    "ST",
  ],
};

export const DEFAULT_TACTICS = {
  mentality: "balanced",
  pressing: "medium",
  tempo: "medium",
  width: 55,
  defensiveLine: 50,
  passingStyle: "mixed",
  counterAttack: true,
};

export const MENTALITY = {
  defensive: {
    attack: 0.75,
    width: 0.85,
    defensiveLine: -35,
    risk: 0.65,
  },

  balanced: {
    attack: 1,
    width: 1,
    defensiveLine: 0,
    risk: 1,
  },

  attacking: {
    attack: 1.3,
    width: 1.15,
    defensiveLine: 30,
    risk: 1.3,
  },
};

export const EVENT_TYPES = {
  KICKOFF: "kickoff",
  PASS: "pass",
  SHOT: "shot",
  SHOT_ON_TARGET: "shot_on_target",
  SAVE: "save",
  GOAL: "goal",
  ASSIST: "assist",
  TACKLE: "tackle",
  INTERCEPTION: "interception",
  FOUL: "foul",
  YELLOW: "yellow",
  RED: "red",
  OFFSIDE: "offside",
  CORNER: "corner",
  THROW_IN: "throw_in",
  GOAL_KICK: "goal_kick",
  SUBSTITUTION: "substitution",
  HALFTIME: "halftime",
  FULLTIME: "fulltime",
};
