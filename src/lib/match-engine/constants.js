export const PITCH = {
  width: 1050,
  height: 680,

  goalWidth: 150,
  goalDepth: 35,

  penaltyBoxWidth: 165,
  penaltyBoxDepth: 105,

  goalBoxWidth: 75,
  goalBoxDepth: 45,

  centerCircleRadius: 70,
  playerRadius: 17,
  ballRadius: 7,
};

export const MATCH = {
  simulationFPS: 60,
  maxPlayersPerTeam: 18,

  defaultFormation: "4-3-3",

  formations: [
    "4-4-2",
    "4-3-3",
    "3-5-2",
    "5-3-2",
    "4-2-3-1",
  ],
};

export const TEAM_SIDE = {
  HOME: "home",
  AWAY: "away",
};

export const PLAYER_STATE = {
  IDLE: "idle",
  MOVING: "moving",
  CHASING: "chasing",
  RECEIVING: "receiving",
  POSSESSED: "possessed",
};

export const BALL_STATE = {
  FREE: "free",
  POSSESSED: "possessed",
  PASSING: "passing",
  SHOOTING: "shooting",
};

export const COLORS = {
  pitch: "#168447",
  pitchDark: "#116b39",
  line: "#ffffff",

  home: "#1683ff",
  homeDark: "#0755b5",

  away: "#ef4444",
  awayDark: "#991b1b",

  ball: "#ffffff",

  text: "#ffffff",
  panel: "#0b1220",
};
