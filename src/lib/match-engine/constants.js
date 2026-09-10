export const PITCH = {
  width: 1050,
  height: 680,

  goalWidth: 150,
  goalDepth: 30,

  penaltyBoxWidth: 165,
  penaltyBoxHeight: 390,

  goalBoxWidth: 55,
  goalBoxHeight: 190,

  centerCircle: 92,
};

export const MATCH = {
  // 4 real minutes = 90 football minutes
  REAL_DURATION_SECONDS: 240,

  SIMULATION_MINUTES: 90,

  SIM_MINUTES_PER_REAL_SECOND: 90 / 240,

  FIXED_DT: 1 / 30,

  AI_UPDATE_INTERVAL: 0.16,

  DECISION_INTERVAL: 0.65,

  AI_TACTICS_INTERVAL: 8,

  MAX_SUBSTITUTIONS: 5,

  MAX_EVENTS: 300,
};

export const MATCH_STATUS = {
  READY: "ready",
  LIVE: "live",
  HALF_TIME: "halftime",
  FINISHED: "finished",
};

export const BALL_STATE = {
  IDLE: "idle",
  PASSING: "passing",
  SHOOTING: "shooting",
  CROSSING: "crossing",
  DEFLECTED: "deflected",
  SAVED: "saved",
};

export const PLAYER_STATE = {
  IDLE: "idle",
  MOVING: "moving",
  CHASING: "chasing",
  RECEIVING: "receiving",
  POSSESSED: "possessed",
  SHOOTING: "shooting",
  INJURED: "injured",
};

export const EVENT_TYPES = {
  KICKOFF: "kickoff",
  HALF_TIME: "half_time",
  SECOND_HALF: "second_half",
  FULL_TIME: "full_time",

  PASS: "pass",
  THROUGH_BALL: "through_ball",
  DRIBBLE: "dribble",
  CROSS: "cross",

  SHOT: "shot",
  GOAL: "goal",
  SAVE: "save",

  INTERCEPTION: "interception",
  TACKLE: "tackle",

  FOUL: "foul",
  YELLOW: "yellow",
  RED: "red",

  INJURY: "injury",

  CORNER: "corner",
  GOAL_KICK: "goal_kick",
  THROW_IN: "throw_in",
  OFFSIDE: "offside",

  SUBSTITUTION: "substitution",
};

export const DEFAULT_TACTICS = {
  mentality: "balanced",

  tempo: "normal",

  pressing: "medium",

  defensiveLine: "normal",

  passingStyle: "mixed",

  width: "balanced",
};

export const INJURY = {
  TACKLE_BASE: 0.0008,

  FATIGUE_BASE: 0.00003,

  STAMINA_THRESHOLD: 17,
};

export const TEAM_COLORS = {
  home: "#38bdf8",
  away: "#fb7185",
};
