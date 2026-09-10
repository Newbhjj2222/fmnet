export const PITCH = {
  width: 1050,
  height: 680,

  goalWidth: 150,
  goalDepth: 38,

  penaltyBoxDepth: 165,
  penaltyBoxWidth: 280,

  goalBoxDepth: 65,
  goalBoxWidth: 150,

  centerCircleRadius: 72,

  playerRadius: 16,
  goalkeeperRadius: 19,
  ballRadius: 6,
};

export const MATCH = {
  REAL_DURATION_SECONDS: 240,

  SIMULATION_MINUTES: 90,

  FPS: 60,

  PLAYER_SPEED: 92,

  BALL_FRICTION: 0.985,

  DECISION_INTERVAL: 1.25,

  AI_UPDATE_INTERVAL: 0.20,

  MAX_SUBSTITUTIONS: 5,

  HALF_TIME_MINUTE: 45,

  FULL_TIME_MINUTE: 90,
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
};

export const PLAYER_STATE = {
  IDLE: "idle",
  MOVING: "moving",
  CHASING: "chasing",
  RECEIVING: "receiving",
  POSSESSED: "possessed",
  TACKLING: "tackling",
  SHOOTING: "shooting",
  INJURED: "injured",
  SENT_OFF: "sent_off",
};

export const MATCH_STATUS = {
  READY: "ready",
  LIVE: "live",
  HALF_TIME: "half-time",
  FINISHED: "finished",
};

export const EVENT_TYPES = {
  KICKOFF: "kickoff",
  PASS: "pass",
  THROUGH_BALL: "through_ball",
  CROSS: "cross",
  DRIBBLE: "dribble",
  TACKLE: "tackle",
  INTERCEPTION: "interception",
  FOUL: "foul",
  YELLOW: "yellow_card",
  RED: "red_card",
  SHOT: "shot",
  SAVE: "save",
  GOAL: "goal",
  CORNER: "corner",
  GOAL_KICK: "goal_kick",
  THROW_IN: "throw_in",
  OFFSIDE: "offside",
  SUBSTITUTION: "substitution",
  HALF_TIME: "half_time",
  FULL_TIME: "full_time",
};

export const FORMATIONS = {
  "4-4-2": [
    ["GK", 0.06, 0.50],
    ["LB", 0.20, 0.18],
    ["CB", 0.20, 0.39],
    ["CB", 0.20, 0.61],
    ["RB", 0.20, 0.82],

    ["LM", 0.40, 0.18],
    ["CM", 0.39, 0.40],
    ["CM", 0.39, 0.60],
    ["RM", 0.40, 0.82],

    ["ST", 0.67, 0.40],
    ["ST", 0.67, 0.60],
  ],

  "4-3-3": [
    ["GK", 0.06, 0.50],

    ["LB", 0.20, 0.18],
    ["CB", 0.20, 0.39],
    ["CB", 0.20, 0.61],
    ["RB", 0.20, 0.82],

    ["CM", 0.39, 0.30],
    ["CM", 0.38, 0.50],
    ["CM", 0.39, 0.70],

    ["LW", 0.64, 0.19],
    ["ST", 0.69, 0.50],
    ["RW", 0.64, 0.81],
  ],

  "3-5-2": [
    ["GK", 0.06, 0.50],

    ["CB", 0.20, 0.28],
    ["CB", 0.20, 0.50],
    ["CB", 0.20, 0.72],

    ["LM", 0.38, 0.12],
    ["CM", 0.37, 0.34],
    ["CM", 0.37, 0.50],
    ["CM", 0.37, 0.66],
    ["RM", 0.38, 0.88],

    ["ST", 0.68, 0.41],
    ["ST", 0.68, 0.59],
  ],

  "5-3-2": [
    ["GK", 0.06, 0.50],

    ["LWB", 0.19, 0.10],
    ["CB", 0.20, 0.30],
    ["CB", 0.20, 0.50],
    ["CB", 0.20, 0.70],
    ["RWB", 0.19, 0.90],

    ["CM", 0.40, 0.32],
    ["CM", 0.39, 0.50],
    ["CM", 0.40, 0.68],

    ["ST", 0.68, 0.41],
    ["ST", 0.68, 0.59],
  ],

  "4-2-3-1": [
    ["GK", 0.06, 0.50],

    ["LB", 0.20, 0.18],
    ["CB", 0.20, 0.39],
    ["CB", 0.20, 0.61],
    ["RB", 0.20, 0.82],

    ["DM", 0.34, 0.40],
    ["DM", 0.34, 0.60],

    ["LW", 0.51, 0.20],
    ["AM", 0.52, 0.50],
    ["RW", 0.51, 0.80],

    ["ST", 0.69, 0.50],
  ],
};

export const DEFAULT_TACTICS = {
  mentality: "balanced",
  tempo: "normal",
  pressing: "medium",
  defensiveLine: "normal",
  width: "normal",
  passingStyle: "mixed",
};

export const TACTICAL_VALUES = {
  mentality: [
    "defensive",
    "balanced",
    "attacking",
  ],

  tempo: [
    "slow",
    "normal",
    "fast",
  ],

  pressing: [
    "low",
    "medium",
    "high",
  ],

  defensiveLine: [
    "deep",
    "normal",
    "high",
  ],

  width: [
    "narrow",
    "normal",
    "wide",
  ],

  passingStyle: [
    "short",
    "mixed",
    "direct",
  ],
};
