/* ============================================================
   lib/match-engine/engine.js

   VFM 2D FOOTBALL MATCH ENGINE
   ------------------------------------------------------------
   Features:
   - Continuous player movement
   - Ball movement
   - Possession
   - Passing
   - Dribbling
   - Attacking runs
   - Defensive marking
   - Pressing
   - Defensive cover
   - Tackling
   - Fouls
   - Yellow / red cards
   - Shooting
   - Goalkeeper saves
   - Goals + assists
   - Corners
   - Throw-ins
   - Goal kicks
   - Offside
   - Stamina
   - AI substitutions
   - Manager substitutions
   - Maximum 5 substitutions
   - Dynamic tactics
   - Formation positioning
   - Player ratings
   - Match statistics
   - Event feed
   - Continuous 90-minute simulation

   No Firebase / React dependencies.
   Pure JavaScript.
============================================================ */

/* ============================================================
   CONSTANTS
============================================================ */

const FIELD = {
  width: 1050,
  height: 680,

  left: 45,
  right: 1005,
  top: 45,
  bottom: 635,

  centerX: 525,
  centerY: 340,

  goalWidth: 120,
  goalDepth: 24,

  penaltyWidth: 360,
  penaltyHeight: 180,

  goalAreaWidth: 180,
  goalAreaHeight: 80,
};

const MATCH = {
  durationSeconds: 240,
  matchMinutes: 90,

  maxSubstitutions: 5,

  minPlayerSpeed: 35,
  maxPlayerSpeed: 120,

  playerRadius: 11,
  ballRadius: 5,

  possessionDistance: 18,

  passMinDistance: 35,
  passMaxDistance: 340,

  shotDistance: 390,

  staminaDrain: 0.035,
  sprintDrain: 0.075,

  simulationStep: 1 / 60,
};

const TEAM = {
  HOME: "home",
  AWAY: "away",
};

const BALL_STATE = {
  FREE: "free",
  POSSESSED: "possessed",
  PASSING: "passing",
  SHOOTING: "shooting",
  SAVED: "saved",
  DEFLECTED: "deflected",
  OUT: "out",
  GOAL: "goal",
};

const PLAYER_STATE = {
  ACTIVE: "active",
  INJURED: "injured",
  SENT_OFF: "sent_off",
  SUBSTITUTED: "substituted",
};

const DEFAULT_TACTICS = {
  mentality: "balanced",
  pressing: "medium",
  tempo: "medium",
  width: 55,
  defensiveLine: 50,
  passingStyle: "mixed",
  counterAttack: true,
};

/* ============================================================
   FORMATIONS
============================================================ */

const FORMATIONS = {
  "4-4-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.16 },
    { role: "CB", x: 0.12, y: 0.38 },
    { role: "CB", x: 0.12, y: 0.62 },
    { role: "RB", x: 0.17, y: 0.84 },

    { role: "LM", x: 0.38, y: 0.16 },
    { role: "CM", x: 0.35, y: 0.39 },
    { role: "CM", x: 0.35, y: 0.61 },
    { role: "RM", x: 0.38, y: 0.84 },

    { role: "ST", x: 0.61, y: 0.40 },
    { role: "ST", x: 0.64, y: 0.60 },
  ],

  "4-3-3": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.16 },
    { role: "CB", x: 0.12, y: 0.38 },
    { role: "CB", x: 0.12, y: 0.62 },
    { role: "RB", x: 0.17, y: 0.84 },

    { role: "CM", x: 0.33, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.30 },
    { role: "CM", x: 0.38, y: 0.70 },

    { role: "LW", x: 0.61, y: 0.15 },
    { role: "ST", x: 0.66, y: 0.50 },
    { role: "RW", x: 0.61, y: 0.85 },
  ],

  "3-5-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "CB", x: 0.12, y: 0.27 },
    { role: "CB", x: 0.11, y: 0.50 },
    { role: "CB", x: 0.12, y: 0.73 },

    { role: "LM", x: 0.35, y: 0.12 },
    { role: "CM", x: 0.34, y: 0.35 },
    { role: "CM", x: 0.34, y: 0.50 },
    { role: "CM", x: 0.34, y: 0.65 },
    { role: "RM", x: 0.35, y: 0.88 },

    { role: "ST", x: 0.63, y: 0.40 },
    { role: "ST", x: 0.65, y: 0.60 },
  ],

  "5-3-2": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LWB", x: 0.17, y: 0.12 },
    { role: "CB", x: 0.12, y: 0.31 },
    { role: "CB", x: 0.11, y: 0.50 },
    { role: "CB", x: 0.12, y: 0.69 },
    { role: "RWB", x: 0.17, y: 0.88 },

    { role: "CM", x: 0.35, y: 0.32 },
    { role: "CM", x: 0.34, y: 0.50 },
    { role: "CM", x: 0.35, y: 0.68 },

    { role: "ST", x: 0.63, y: 0.40 },
    { role: "ST", x: 0.65, y: 0.60 },
  ],

  "4-2-3-1": [
    { role: "GK", x: 0.04, y: 0.50 },

    { role: "LB", x: 0.17, y: 0.16 },
    { role: "CB", x: 0.12, y: 0.38 },
    { role: "CB", x: 0.12, y: 0.62 },
    { role: "RB", x: 0.17, y: 0.84 },

    { role: "CDM", x: 0.31, y: 0.38 },
    { role: "CDM", x: 0.31, y: 0.62 },

    { role: "LW", x: 0.48, y: 0.15 },
    { role: "CAM", x: 0.49, y: 0.50 },
    { role: "RW", x: 0.48, y: 0.85 },

    { role: "ST", x: 0.67, y: 0.50 },
  ],
};

/* ============================================================
   HELPERS
============================================================ */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function random(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function chance(probability) {
  return Math.random() < probability;
}

function normalize(value, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function avg(values) {
  if (!values.length) return 50;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function otherTeam(team) {
  return team === TEAM.HOME ? TEAM.AWAY : TEAM.HOME;
}

function teamDirection(team) {
  return team === TEAM.HOME ? 1 : -1;
}

function clampPosition(player) {
  player.x = clamp(player.x, FIELD.left + 10, FIELD.right - 10);
  player.y = clamp(player.y, FIELD.top + 10, FIELD.bottom - 10);
}

/* ============================================================
   POSITION NORMALIZATION
============================================================ */

function normalizePosition(position) {
  const p = String(position || "").trim().toUpperCase();

  if (
    ["GK", "GKP", "GOALKEEPER", "GOALIE"].includes(p)
  ) {
    return "GK";
  }

  if (
    [
      "LB",
      "RB",
      "CB",
      "DC",
      "DF",
      "LWB",
      "RWB",
      "DEFENDER",
    ].includes(p)
  ) {
    return "DF";
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
      "MIDFIELDER",
    ].includes(p)
  ) {
    return "MF";
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
      "FORWARD",
      "STRIKER",
    ].includes(p)
  ) {
    return "FW";
  }

  return "MF";
}

/* ============================================================
   NUMBER FROM DATABASE
============================================================ */

function getPlayerNumber(player, fallback) {
  const candidates = [
    player?.shirtNumber,
    player?.jerseyNumber,
    player?.number,
    player?.kitNumber,
  ];

  for (const value of candidates) {
    const n = Number(value);

    if (Number.isInteger(n) && n > 0 && n <= 99) {
      return n;
    }
  }

  return fallback;
}

/* ============================================================
   RATING HELPERS
============================================================ */

function getRating(player, names, fallback = 60) {
  for (const name of names) {
    if (player && player[name] !== undefined) {
      return clamp(normalize(player[name], fallback), 1, 99);
    }
  }

  return clamp(
    normalize(
      player?.overall ??
        player?.rating ??
        player?.ovr,
      fallback
    ),
    1,
    99
  );
}

function buildRatings(player) {
  const overall = getRating(player, ["overall", "rating", "ovr"], 65);

  return {
    overall,

    pace: getRating(
      player,
      ["pace", "speed", "sprintSpeed"],
      overall
    ),

    acceleration: getRating(
      player,
      ["acceleration", "accel"],
      overall
    ),

    passing: getRating(
      player,
      ["passing", "pass", "passingRating"],
      overall
    ),

    vision: getRating(
      player,
      ["vision", "passingVision"],
      overall
    ),

    shooting: getRating(
      player,
      ["shooting", "shot", "finishing"],
      overall
    ),

    dribbling: getRating(
      player,
      ["dribbling", "dribble"],
      overall
    ),

    tackling: getRating(
      player,
      ["tackling", "tackle"],
      overall
    ),

    positioning: getRating(
      player,
      ["positioning", "positioningRating"],
      overall
    ),

    marking: getRating(
      player,
      ["marking", "defensivePositioning"],
      overall
    ),

    decisionMaking: getRating(
      player,
      ["decisionMaking", "decisions", "iq"],
      overall
    ),

    composure: getRating(
      player,
      ["composure", "mental"],
      overall
    ),

    stamina: getRating(
      player,
      ["stamina", "fitness"],
      overall
    ),

    strength: getRating(
      player,
      ["strength", "physical"],
      overall
    ),

    crossing: getRating(
      player,
      ["crossing", "cross"],
      overall
    ),

    interceptions: getRating(
      player,
      ["interceptions", "interception"],
      overall
    ),

    aggression: getRating(
      player,
      ["aggression", "pressing"],
      overall
    ),

    reaction: getRating(
      player,
      ["reaction", "reflexes"],
      overall
    ),

    handling: getRating(
      player,
      ["handling", "catching"],
      overall
    ),

    diving: getRating(
      player,
      ["diving", "goalkeepingDiving"],
      overall
    ),

    distribution: getRating(
      player,
      ["distribution", "goalKick", "kicking"],
      overall
    ),
  };
}

/* ============================================================
   TACTICS NORMALIZATION
============================================================ */

function normalizeTactics(tactics = {}) {
  return {
    mentality: [
      "balanced",
      "attacking",
      "defensive",
    ].includes(tactics.mentality)
      ? tactics.mentality
      : DEFAULT_TACTICS.mentality,

    pressing: [
      "low",
      "medium",
      "high",
    ].includes(tactics.pressing)
      ? tactics.pressing
      : DEFAULT_TACTICS.pressing,

    tempo: [
      "slow",
      "medium",
      "fast",
    ].includes(tactics.tempo)
      ? tactics.tempo
      : DEFAULT_TACTICS.tempo,

    width: clamp(
      normalize(tactics.width, DEFAULT_TACTICS.width),
      20,
      90
    ),

    defensiveLine: clamp(
      normalize(
        tactics.defensiveLine,
        DEFAULT_TACTICS.defensiveLine
      ),
      20,
      90
    ),

    passingStyle: [
      "short",
      "mixed",
      "direct",
    ].includes(tactics.passingStyle)
      ? tactics.passingStyle
      : DEFAULT_TACTICS.passingStyle,

    counterAttack:
      tactics.counterAttack === undefined
        ? DEFAULT_TACTICS.counterAttack
        : Boolean(tactics.counterAttack),
  };
}

/* ============================================================
   PLAYER CREATION
============================================================ */

function createPlayer(raw, team, index, roleInfo) {
  const ratings = buildRatings(raw);

  const position = normalizePosition(
    raw?.position || roleInfo.role
  );

  const role = roleInfo.role;

  const number = getPlayerNumber(
    raw,
    index + 1
  );

  const baseSpeed =
    MATCH.minPlayerSpeed +
    ((ratings.pace - 1) / 98) *
      (MATCH.maxPlayerSpeed - MATCH.minPlayerSpeed);

  const side =
    team === TEAM.HOME ? 1 : -1;

  const x =
    FIELD.left +
    roleInfo.x *
      (FIELD.right - FIELD.left);

  const y =
    FIELD.top +
    roleInfo.y *
      (FIELD.bottom - FIELD.top);

  return {
    id:
      raw?.id ||
      raw?.playerId ||
      raw?.uid ||
      id("player"),

    rawId:
      raw?.id ||
      raw?.playerId ||
      raw?.uid ||
      null,

    team,

    name:
      raw?.name ||
      raw?.displayName ||
      raw?.fullName ||
      `Player ${number}`,

    number,

    position,
    role,

    preferredPosition: raw?.position || position,

    x:
      team === TEAM.HOME
        ? x
        : FIELD.left +
          (1 - roleInfo.x) *
            (FIELD.right - FIELD.left),

    y,

    homeX:
      team === TEAM.HOME
        ? x
        : FIELD.left +
          (1 - roleInfo.x) *
            (FIELD.right - FIELD.left),

    homeY: y,

    vx: 0,
    vy: 0,

    speed: baseSpeed,

    acceleration:
      35 +
      ratings.acceleration * 0.8,

    stamina: 100,

    ratings,

    state: PLAYER_STATE.ACTIVE,

    hasBall: false,

    targetX: x,
    targetY: y,

    markPlayerId: null,

    lastAction: null,

    touches: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    assists: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    dribbles: 0,
    crosses: 0,

    distanceCovered: 0,

    sprinting: false,

    carded: false,

    substituted: false,

    injured: false,

    side,

    isGoalkeeper: position === "GK",
  };
}

/* ============================================================
   MATCH ENGINE
============================================================ */

export default class MatchEngine {
  constructor({
    matchId = null,

    homeTeam = {},
    awayTeam = {},

    homePlayers = [],
    awayPlayers = [],

    formationHome = "4-4-2",
    formationAway = "4-4-2",

    tacticsHome = DEFAULT_TACTICS,
    tacticsAway = DEFAULT_TACTICS,

    initialScore = {},
    initialMinute = 0,

    durationSeconds = MATCH.durationSeconds,

    onEvent = null,
  } = {}) {
    this.matchId = matchId;

    this.durationSeconds =
      Number(durationSeconds) || MATCH.durationSeconds;

    this.simSeconds =
      clamp(
        (Number(initialMinute) || 0) /
          MATCH.matchMinutes *
          this.durationSeconds,
        0,
        this.durationSeconds
      );

    this.status = "pre-match";

    this.homeTeam = {
      id: homeTeam?.id || homeTeam?.clubId || "home",
      name:
        homeTeam?.name ||
        homeTeam?.clubName ||
        "Home",
      logo: homeTeam?.logo || homeTeam?.logoUrl || null,
    };

    this.awayTeam = {
      id: awayTeam?.id || awayTeam?.clubId || "away",
      name:
        awayTeam?.name ||
        awayTeam?.clubName ||
        "Away",
      logo: awayTeam?.logo || awayTeam?.logoUrl || null,
    };

    this.formations = {
      home: FORMATIONS[formationHome]
        ? formationHome
        : "4-4-2",

      away: FORMATIONS[formationAway]
        ? formationAway
        : "4-4-2",
    };

    this.tactics = {
      home: normalizeTactics(tacticsHome),
      away: normalizeTactics(tacticsAway),
    };

    this.rawPlayers = {
      home: homePlayers || [],
      away: awayPlayers || [],
    };

    this.players = {
      home: [],
      away: [],
    };

    this.bench = {
      home: [],
      away: [],
    };

    this.score = {
      home: Number(initialScore.home || 0),
      away: Number(initialScore.away || 0),
    };

    this.events = [];

    this.lastEventTime = 0;

    this.lastBallTouch = {
      team: null,
      playerId: null,
      time: 0,
    };

    this.possessionSeconds = {
      home: 0,
      away: 0,
    };

    this.stats = {
      home: this.createTeamStats(),
      away: this.createTeamStats(),
    };

    this.substitutionsUsed = {
      home: 0,
      away: 0,
    };

    this.setPiece = null;

    this.pendingRestart = null;

    this.lastPass = null;

    this.nextDecisionAt = {
      home: 0,
      away: 0,
    };

    this.nextSubstitutionCheck = {
      home: 55,
      away: 55,
    };

    this.ball = {
      x: FIELD.centerX,
      y: FIELD.centerY,

      vx: 0,
      vy: 0,

      state: BALL_STATE.FREE,

      ownerId: null,

      targetId: null,

      lastTouchTeam: null,

      lastTouchPlayerId: null,

      type: "normal",

      flightTime: 0,

      totalFlightTime: 0,
    };

    this.onEvent = onEvent;

    this.createLineups();

    this.resetBallToKickoff();
  }

  /* ==========================================================
     STATS
  ========================================================== */

  createTeamStats() {
    return {
      possession: 0,

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

      xG: 0,

      dribbles: 0,
      crosses: 0,

      throwIns: 0,
      goalKicks: 0,

      bigChances: 0,
    };
  }

  /* ==========================================================
     LINEUPS
  ========================================================== */

  createLineups() {
    this.players.home =
      this.createStartingPlayers(
        TEAM.HOME,
        this.rawPlayers.home,
        this.formations.home
      );

    this.players.away =
      this.createStartingPlayers(
        TEAM.AWAY,
        this.rawPlayers.away,
        this.formations.away
      );

    this.bench.home =
      this.createBench(
        TEAM.HOME,
        this.rawPlayers.home,
        this.players.home
      );

    this.bench.away =
      this.createBench(
        TEAM.AWAY,
        this.rawPlayers.away,
        this.players.away
      );
  }

  createStartingPlayers(
    team,
    rawPlayers,
    formationName
  ) {
    const formation =
      FORMATIONS[formationName] ||
      FORMATIONS["4-4-2"];

    const available = [...rawPlayers];

    const selected = [];

    for (let i = 0; i < formation.length; i++) {
      const roleInfo = formation[i];

      let playerIndex = -1;

      if (roleInfo.role === "GK") {
        playerIndex = available.findIndex(
          (p) =>
            normalizePosition(
              p?.position
            ) === "GK"
        );
      }

      if (playerIndex < 0) {
        playerIndex = this.findBestPlayerForRole(
          available,
          roleInfo.role
        );
      }

      if (playerIndex < 0) {
        playerIndex = 0;
      }

      const raw =
        available.splice(
          playerIndex,
          1
        )[0];

      if (!raw) {
        continue;
      }

      selected.push(
        createPlayer(
          raw,
          team,
          i,
          roleInfo
        )
      );
    }

    return selected;
  }

  findBestPlayerForRole(players, role) {
    if (!players.length) {
      return -1;
    }

    const preferred = players.findIndex(
      (p) => this.roleMatches(
        p?.position,
        role
      )
    );

    if (preferred >= 0) {
      return preferred;
    }

    const normalizedRole =
      normalizePosition(role);

    const sameGroup =
      players.findIndex(
        (p) =>
          normalizePosition(
            p?.position
          ) === normalizedRole
      );

    if (sameGroup >= 0) {
      return sameGroup;
    }

    return 0;
  }

  roleMatches(position, role) {
    const p = String(
      position || ""
    ).toUpperCase();

    if (role === "GK") {
      return normalizePosition(p) === "GK";
    }

    if (
      ["LB", "RB", "LWB", "RWB"].includes(role)
    ) {
      return [
        "LB",
        "RB",
        "LWB",
        "RWB",
        "DF",
      ].includes(p);
    }

    if (
      [
        "CB",
      ].includes(role)
    ) {
      return [
        "CB",
        "DC",
        "DF",
      ].includes(p);
    }

    if (
      [
        "CDM",
        "CM",
        "CAM",
        "LM",
        "RM",
      ].includes(role)
    ) {
      return normalizePosition(p) === "MF";
    }

    if (
      [
        "LW",
        "RW",
        "ST",
        "CF",
      ].includes(role)
    ) {
      return normalizePosition(p) === "FW";
    }

    return false;
  }

  createBench(
    team,
    rawPlayers,
    starters
  ) {
    const starterIds = new Set(
      starters.map(
        (p) => p.rawId || p.id
      )
    );

    return rawPlayers
      .filter(
        (p) =>
          !starterIds.has(
            p?.id ||
              p?.playerId ||
              p?.uid
          )
      )
      .slice(0, 7)
      .map((raw, index) =>
        createPlayer(
          raw,
          team,
          index + 12,
          {
            role:
              normalizePosition(
                raw?.position
              ) === "GK"
                ? "GK"
                : "SUB",
            x: 0.25,
            y:
              0.1 +
              index * 0.12,
          }
        )
      );
  }

  /* ==========================================================
     START / PAUSE / RESUME
  ========================================================== */

  start() {
    if (this.status === "finished") {
      return;
    }

    this.status = "live";

    if (
      !this.events.some(
        (event) =>
          event.type === "kickoff"
      )
    ) {
      this.addEvent({
        type: "kickoff",
        team: TEAM.HOME,
        playerId: null,
        text: "Kick-off",
      });
    }
  }

  pause() {
    if (this.status === "live") {
      this.status = "paused";
    }
  }

  resume() {
    if (this.status === "paused") {
      this.status = "live";
    }
  }

  /* ==========================================================
     UPDATE
  ========================================================== */

  update(dt) {
    if (this.status !== "live") {
      return;
    }

    let remaining =
      clamp(
        Number(dt) || 0,
        0,
        0.15
      );

    while (remaining > 0) {
      const step = Math.min(
        remaining,
        MATCH.simulationStep
      );

      this.updateStep(step);

      remaining -= step;
    }
  }

  updateStep(dt) {
    if (
      this.simSeconds >=
      this.durationSeconds
    ) {
      this.finishMatch();
      return;
    }

    const previousMinute =
      this.getMinute();

    this.simSeconds +=
      dt;

    const currentMinute =
      this.getMinute();

    if (
      currentMinute !==
      previousMinute
    ) {
      this.handleMinuteChange(
        currentMinute
      );
    }

    this.updatePossessionTime(dt);

    this.updateAllPlayers(dt);

    this.updateBall(dt);

    this.handlePlayerInteractions();

    this.handleAI();

    this.updateSetPieces();

    this.checkAutomaticSubstitutions();

    if (
      this.simSeconds >=
      this.durationSeconds
    ) {
      this.finishMatch();
    }
  }

  /* ==========================================================
     MINUTE
  ========================================================== */

  getMinute() {
    return clamp(
      Math.floor(
        this.simSeconds /
          this.durationSeconds *
          90
      ),
      0,
      90
    );
  }

  getSecond() {
    const minuteProgress =
      (
        this.simSeconds /
          this.durationSeconds *
          90
      ) % 1;

    return Math.floor(
      minuteProgress * 60
    );
  }

  handleMinuteChange(minute) {
    if (minute === 45) {
      this.addEvent({
        type: "halftime",
        team: null,
        text: "Half-time",
      });
    }
  }

  /* ==========================================================
     POSSESSION
  ========================================================== */

  updatePossessionTime(dt) {
    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    if (
      owner &&
      owner.state ===
        PLAYER_STATE.ACTIVE
    ) {
      this.possessionSeconds[
        owner.team
      ] += dt;

      this.stats[
        owner.team
      ].possessionSeconds += dt;
    }
  }

  updatePossessionPercent() {
    const total =
      this.possessionSeconds.home +
      this.possessionSeconds.away;

    if (!total) {
      this.stats.home.possession = 50;
      this.stats.away.possession = 50;
      return;
    }

    this.stats.home.possession =
      Math.round(
        (this.possessionSeconds.home /
          total) *
          100
      );

    this.stats.away.possession =
      100 -
      this.stats.home.possession;
  }

  /* ==========================================================
     PLAYER UPDATE
  ========================================================== */

  updateAllPlayers(dt) {
    const all = [
      ...this.players.home,
      ...this.players.away,
    ];

    for (const player of all) {
      if (
        player.state !==
        PLAYER_STATE.ACTIVE
      ) {
        continue;
      }

      this.updatePlayerMovement(
        player,
        dt
      );

      this.updateStamina(
        player,
        dt
      );
    }
  }

  updatePlayerMovement(player, dt) {
    const target =
      this.calculatePlayerTarget(
        player
      );

    player.targetX = target.x;
    player.targetY = target.y;

    let dx =
      target.x - player.x;

    let dy =
      target.y - player.y;

    const dist =
      Math.hypot(dx, dy);

    if (dist > 1) {
      dx /= dist;
      dy /= dist;
    } else {
      dx = 0;
      dy = 0;
    }

    const tacticalSpeed =
      this.getPlayerMovementSpeed(
        player,
        target
      );

    const acceleration =
      player.acceleration *
      dt;

    const desiredVx =
      dx * tacticalSpeed;

    const desiredVy =
      dy * tacticalSpeed;

    player.vx =
      lerp(
        player.vx,
        desiredVx,
        clamp(
          acceleration /
            Math.max(
              tacticalSpeed,
              1
            ),
          0,
          1
        )
      );

    player.vy =
      lerp(
        player.vy,
        desiredVy,
        clamp(
          acceleration /
            Math.max(
              tacticalSpeed,
              1
            ),
          0,
          1
        )
      );

    player.x +=
      player.vx * dt;

    player.y +=
      player.vy * dt;

    player.distanceCovered +=
      Math.hypot(
        player.vx * dt,
        player.vy * dt
      );

    player.sprinting =
      tacticalSpeed >
      player.speed * 0.82;

    clampPosition(player);
  }

  getPlayerMovementSpeed(
    player,
    target
  ) {
    let speed =
      player.speed;

    const staminaFactor =
      clamp(
        player.stamina / 100,
        0.55,
        1
      );

    speed *= staminaFactor;

    if (
      player.sprinting
    ) {
      speed *= 1.08;
    }

    if (
      target?.reason === "press"
    ) {
      speed *= 1.12;
    }

    if (
      target?.reason === "attack-run"
    ) {
      speed *= 1.05;
    }

    return speed;
  }

  /* ==========================================================
     PLAYER TARGET LOGIC
  ========================================================== */

  calculatePlayerTarget(player) {
    const team =
      player.team;

    const tactics =
      this.tactics[team];

    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    const possession =
      owner?.team || null;

    if (
      player.isGoalkeeper
    ) {
      return this.calculateGoalkeeperTarget(
        player
      );
    }

    /* ------------------------------------------
       PLAYER WITH BALL
    ------------------------------------------ */

    if (
      player.hasBall
    ) {
      return this.calculateCarrierTarget(
        player
      );
    }

    /* ------------------------------------------
       TEAM HAS BALL
    ------------------------------------------ */

    if (
      possession === team
    ) {
      return this.calculateAttackingTarget(
        player
      );
    }

    /* ------------------------------------------
       OPPONENT HAS BALL
    ------------------------------------------ */

    if (
      possession ===
      otherTeam(team)
    ) {
      return this.calculateDefensiveTarget(
        player
      );
    }

    /* ------------------------------------------
       FREE BALL
    ------------------------------------------ */

    return this.calculateLooseBallTarget(
      player
    );
  }

  /* ==========================================================
     GOALKEEPER
  ========================================================== */

  calculateGoalkeeperTarget(
    player
  ) {
    const defendingHome =
      player.team === TEAM.HOME;

    const goalX =
      defendingHome
        ? FIELD.left + 20
        : FIELD.right - 20;

    const ballX =
      this.ball.x;

    const y =
      clamp(
        this.ball.y,
        FIELD.centerY -
          FIELD.goalWidth / 2,
        FIELD.centerY +
          FIELD.goalWidth / 2
      );

    const distanceToGoal =
      Math.abs(
        ballX - goalX
      );

    if (
      distanceToGoal < 220
    ) {
      return {
        x: lerp(
          goalX,
          ballX,
          0.08
        ),
        y,
        reason: "goalkeeper-cover",
      };
    }

    return {
      x: goalX,
      y: FIELD.centerY +
        (
          y -
          FIELD.centerY
        ) *
          0.35,
      reason: "goalkeeper-position",
    };
  }

  /* ==========================================================
     BALL CARRIER
  ========================================================== */

  calculateCarrierTarget(
    player
  ) {
    const direction =
      teamDirection(
        player.team
      );

    const goalX =
      player.team === TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    const distanceToGoal =
      Math.abs(
        goalX - player.x
      );

    if (
      distanceToGoal <
      MATCH.shotDistance &&
      player.ratings.shooting >= 45
    ) {
      return {
        x: goalX,
        y:
          FIELD.centerY +
          random(-35, 35),
        reason: "attack-goal",
      };
    }

    const space =
      this.findBestSpaceAhead(
        player
      );

    return {
      x:
        player.x +
        direction *
          Math.min(
            100,
            space.distance
          ),

      y:
        space.y,

      reason: "dribble-forward",
    };
  }

  /* ==========================================================
     ATTACKING TEAM
  ========================================================== */

  calculateAttackingTarget(
    player
  ) {
    const direction =
      teamDirection(
        player.team
      );

    const tactics =
      this.tactics[player.team];

    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    const ballX =
      this.ball.x;

    const ballY =
      this.ball.y;

    const width =
      (tactics.width - 50) *
      2.0;

    const role =
      player.role;

    /* -----------------------------
       STRIKERS
    ----------------------------- */

    if (
      ["ST", "CF"].includes(role)
    ) {
      return {
        x:
          ballX +
          direction *
            65,

        y:
          clamp(
            player.homeY +
              (
                ballY -
                FIELD.centerY
              ) *
                0.18,
            FIELD.top + 35,
            FIELD.bottom - 35
          ),

        reason: "attack-run",
      };
    }

    /* -----------------------------
       WINGERS
    ----------------------------- */

    if (
      ["LW", "RW"].includes(role)
    ) {
      const side =
        role === "LW"
          ? -1
          : 1;

      return {
        x:
          ballX +
          direction *
            35,

        y:
          FIELD.centerY +
          side *
            (
              155 +
              width * 0.25
            ),

        reason: "wing-support",
      };
    }

    /* -----------------------------
       FULLBACKS
    ----------------------------- */

    if (
      [
        "LB",
        "RB",
        "LWB",
        "RWB",
      ].includes(role)
    ) {
      return {
        x:
          ballX +
          direction *
            5,

        y:
          player.homeY,

        reason: "overlap",
      };
    }

    /* -----------------------------
       MIDFIELDERS
    ----------------------------- */

    if (
      [
        "CM",
        "CAM",
        "CDM",
        "LM",
        "RM",
      ].includes(role)
    ) {
      const forward =
        role === "CAM"
          ? 70
          : role === "CM"
          ? 30
          : 0;

      return {
        x:
          ballX +
          direction *
            forward,

        y:
          lerp(
            player.homeY,
            ballY,
            0.22
          ),

        reason: "support-attack",
      };
    }

    /* -----------------------------
       CENTRAL DEFENDERS
    ----------------------------- */

    return {
      x:
        player.homeX +
        (
          ballX -
          FIELD.centerX
        ) *
          0.10,

      y:
        lerp(
          player.homeY,
          ballY,
          0.10
        ),

      reason: "build-up",
    };
  }

  /* ==========================================================
     DEFENDING TEAM
  ========================================================== */

  calculateDefensiveTarget(
    player
  ) {
    const tactics =
      this.tactics[player.team];

    const opponent =
      this.getClosestOpponentToBall(
        player.team
      );

    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    /* ------------------------------------------
       PRESSING
    ------------------------------------------ */

    const pressingDistance =
      tactics.pressing === "high"
        ? 240
        : tactics.pressing === "medium"
        ? 160
        : 100;

    if (
      owner &&
      owner.team !== player.team
    ) {
      const distanceToBall =
        distance(
          player,
          owner
        );

      const pressingAbility =
        (
          player.ratings.aggression +
          player.ratings.stamina +
          player.ratings.tackling
        ) / 3;

      if (
        distanceToBall <
          pressingDistance &&
        pressingAbility >
          45
      ) {
        return {
          x: owner.x,
          y: owner.y,
          reason: "press",
        };
      }
    }

    /* ------------------------------------------
       MARK DANGEROUS OPPONENT
    ------------------------------------------ */

    const dangerous =
      this.findDangerousOpponent(
        player.team,
        player
      );

    if (
      dangerous
    ) {
      const markDistance =
        player.ratings.marking >
        70
          ? 25
          : 40;

      return {
        x:
          dangerous.x -
          teamDirection(
            dangerous.team
          ) *
            markDistance,

        y:
          dangerous.y,

        reason: "mark",
      };
    }

    /* ------------------------------------------
       DEFENSIVE SHAPE
    ------------------------------------------ */

    const lineFactor =
      (
        tactics.defensiveLine -
        50
      ) / 100;

    return {
      x:
        player.homeX +
        lineFactor *
          70,

      y:
        lerp(
          player.homeY,
          this.ball.y,
          0.12
        ),

      reason: "defensive-shape",
    };
  }

  /* ==========================================================
     LOOSE BALL
  ========================================================== */

  calculateLooseBallTarget(
    player
  ) {
    const d =
      distance(
        player,
        this.ball
      );

    if (
      d < 190 &&
      player.ratings.positioning >
        45
    ) {
      return {
        x: this.ball.x,
        y: this.ball.y,
        reason: "ball-recovery",
      };
    }

    return {
      x:
        player.homeX +
        (
          this.ball.x -
          FIELD.centerX
        ) *
          0.08,

      y:
        lerp(
          player.homeY,
          this.ball.y,
          0.08
        ),

      reason: "shape",
    };
  }

  /* ==========================================================
     SPACE
  ========================================================== */

  findBestSpaceAhead(
    player
  ) {
    const direction =
      teamDirection(
        player.team
      );

    let best = {
      distance: 50,
      y: player.y,
    };

    for (
      let i = 0;
      i < 12;
      i++
    ) {
      const candidateY =
        clamp(
          player.y +
            random(-100, 100),
          FIELD.top + 20,
          FIELD.bottom - 20
        );

      const candidateX =
        player.x +
        direction *
          random(
            45,
            130
          );

      const opponents =
        this.getTeamPlayers(
          otherTeam(
            player.team
          )
        );

      const nearest =
        opponents.reduce(
          (min, opponent) =>
            Math.min(
              min,
              Math.hypot(
                opponent.x -
                  candidateX,
                opponent.y -
                  candidateY
              )
            ),
          Infinity
        );

      if (
        nearest >
        best.distance
      ) {
        best = {
          distance: nearest,
          y: candidateY,
        };
      }
    }

    return best;
  }

  /* ==========================================================
     MARKING
  ========================================================== */

  findDangerousOpponent(
    team,
    player
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(team)
      );

    const direction =
      teamDirection(
        team
      );

    const goalX =
      team === TEAM.HOME
        ? FIELD.left
        : FIELD.right;

    let best = null;
    let bestScore = -Infinity;

    for (const opponent of opponents) {
      if (
        opponent.isGoalkeeper ||
        opponent.state !==
          PLAYER_STATE.ACTIVE
      ) {
        continue;
      }

      const distanceToGoal =
        Math.abs(
          goalX -
            opponent.x
        );

      const forwardness =
        direction *
        (
          opponent.x -
          FIELD.centerX
        );

      const score =
        forwardness * 0.6 +
        (
          700 -
          distanceToGoal
        ) *
          0.4;

      if (
        score >
        bestScore
      ) {
        bestScore = score;
        best = opponent;
      }
    }

    return best;
  }

  /* ==========================================================
     STAMINA
  ========================================================== */

  updateStamina(
    player,
    dt
  ) {
    if (
      player.state !==
      PLAYER_STATE.ACTIVE
    ) {
      return;
    }

    const movement =
      Math.hypot(
        player.vx,
        player.vy
      );

    let drain =
      MATCH.staminaDrain;

    if (
      movement >
      player.speed * 0.75
    ) {
      drain =
        MATCH.sprintDrain;
    }

    if (
      player.hasBall
    ) {
      drain *= 1.08;
    }

    player.stamina =
      clamp(
        player.stamina -
          drain *
          dt *
          3.0,
        0,
        100
      );
  }

  /* ==========================================================
     BALL UPDATE
  ========================================================== */

  updateBall(dt) {
    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    if (
      this.ball.state ===
        BALL_STATE.POSSESSED &&
      owner
    ) {
      this.ball.x =
        owner.x +
        teamDirection(
          owner.team
        ) *
          12;

      this.ball.y =
        owner.y;

      this.ball.vx =
        owner.vx;

      this.ball.vy =
        owner.vy;

      return;
    }

    if (
      this.ball.state ===
        BALL_STATE.PASSING ||
      this.ball.state ===
        BALL_STATE.SHOOTING
    ) {
      this.ball.x +=
        this.ball.vx * dt;

      this.ball.y +=
        this.ball.vy * dt;

      this.ball.vx *=
        Math.pow(
          0.985,
          dt * 60
        );

      this.ball.vy *=
        Math.pow(
          0.985,
          dt * 60
        );

      this.ball.flightTime +=
        dt;

      if (
        this.ball.state ===
        BALL_STATE.PASSING
      ) {
        this.checkPassReception();
      }

      if (
        this.ball.state ===
        BALL_STATE.SHOOTING
      ) {
        this.checkShotResult();
      }

      this.checkBallOut();

      return;
    }

    if (
      this.ball.state ===
      BALL_STATE.FREE
    ) {
      this.ball.x +=
        this.ball.vx * dt;

      this.ball.y +=
        this.ball.vy * dt;

      this.ball.vx *=
        Math.pow(
          0.94,
          dt * 60
        );

      this.ball.vy *=
        Math.pow(
          0.94,
          dt * 60
        );

      this.checkFreeBallPickup();

      this.checkBallOut();
    }
  }

  /* ==========================================================
     BALL PICKUP
  ========================================================== */

  checkFreeBallPickup() {
    const candidates = [
      ...this.players.home,
      ...this.players.away,
    ]
      .filter(
        (player) =>
          player.state ===
          PLAYER_STATE.ACTIVE
      )
      .map(
        (player) => ({
          player,
          distance: distance(
            player,
            this.ball
          ),
        })
      )
      .filter(
        (item) =>
          item.distance <
          MATCH.possessionDistance
      )
      .sort(
        (a, b) =>
          a.distance -
          b.distance
      );

    if (!candidates.length) {
      return;
    }

    const selected =
      candidates[0].player;

    this.giveBallToPlayer(
      selected
    );
  }

  giveBallToPlayer(
    player
  ) {
    if (
      !player ||
      player.state !==
        PLAYER_STATE.ACTIVE
    ) {
      return;
    }

    this.clearAllPossession(
      player.team
    );

    player.hasBall = true;
    player.touches += 1;

    this.ball.ownerId =
      player.id;

    this.ball.state =
      BALL_STATE.POSSESSED;

    this.ball.targetId =
      null;

    this.ball.x =
      player.x;

    this.ball.y =
      player.y;

    this.ball.lastTouchTeam =
      player.team;

    this.ball.lastTouchPlayerId =
      player.id;

    this.lastBallTouch = {
      team: player.team,
      playerId: player.id,
      time: this.simSeconds,
    };
  }

  clearAllPossession(
    exceptTeam = null
  ) {
    for (const team of [
      TEAM.HOME,
      TEAM.AWAY,
    ]) {
      for (const player of this.players[
        team
      ]) {
        if (
          !exceptTeam ||
          player.team ===
            exceptTeam
        ) {
          player.hasBall = false;
        }
      }
    }
  }

  /* ==========================================================
     PLAYER INTERACTIONS
  ========================================================== */

  handlePlayerInteractions() {
    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    if (!owner) {
      return;
    }

    const opponents =
      this.getTeamPlayers(
        otherTeam(
          owner.team
        )
      );

    for (const defender of opponents) {
      if (
        defender.state !==
        PLAYER_STATE.ACTIVE
      ) {
        continue;
      }

      const d =
        distance(
          defender,
          owner
        );

      if (
        d < 20
      ) {
        this.resolveTackle(
          defender,
          owner
        );

        break;
      }
    }
  }

  /* ==========================================================
     TACKLE
  ========================================================== */

  resolveTackle(
    defender,
    attacker
  ) {
    const tackling =
      defender.ratings.tackling;

    const dribbling =
      attacker.ratings.dribbling;

    const stamina =
      defender.stamina;

    const chanceValue =
      clamp(
        (
          tackling * 0.55 +
          stamina * 0.20 +
          defender.ratings.aggression *
            0.25 -
          dribbling * 0.45
        ) / 100,
        0.05,
        0.85
      );

    if (
      chance(chanceValue * 0.22)
    ) {
      defender.tackles += 1;

      this.stats[
        defender.team
      ].tackles += 1;

      if (
        chance(
          0.025 +
            (
              70 -
              defender.ratings
                .composure
            ) /
              2500
        )
      ) {
        this.createFoul(
          defender,
          attacker
        );

        return;
      }

      this.giveBallToPlayer(
        defender
      );

      defender.lastAction =
        "tackle";

      attacker.lastAction =
        "lost-ball";

      return;
    }

    if (
      chance(
        0.035 +
          (
            defender.ratings
              .aggression
          ) /
            2500
      )
    ) {
      this.createFoul(
        defender,
        attacker
      );
    }
  }

  /* ==========================================================
     FOUL
  ========================================================== */

  createFoul(
    defender,
    attacker
  ) {
    defender.fouls += 1;

    this.stats[
      defender.team
    ].fouls += 1;

    this.stats[
      otherTeam(
        defender.team
      )
    ].fouls += 0;

    attacker.lastAction =
      "fouled";

    this.addEvent({
      type: "foul",
      team: defender.team,
      playerId: defender.id,
      playerName: defender.name,
      playerNumber: defender.number,

      relatedPlayerId:
        attacker.id,

      relatedPlayerName:
        attacker.name,

      text:
        `${defender.name} fouls ${attacker.name}`,
    });

    const severity =
      clamp(
        (
          defender.ratings
            .aggression +
          (
            100 -
            defender.stamina
          )
        ) /
          220,
        0,
        1
      );

    if (
      chance(
        0.08 +
          severity * 0.08
      )
    ) {
      this.giveYellowCard(
        defender
      );
    }

    this.prepareFreeKick(
      otherTeam(
        defender.team
      ),
      attacker
    );
  }

  /* ==========================================================
     CARDS
  ========================================================== */

  giveYellowCard(
    player
  ) {
    if (
      player.state !==
      PLAYER_STATE.ACTIVE
    ) {
      return;
    }

    if (
      player.yellowCards >= 1
    ) {
      player.redCards += 1;
      player.state =
        PLAYER_STATE.SENT_OFF;

      player.hasBall = false;

      if (
        this.ball.ownerId ===
        player.id
      ) {
        this.ball.ownerId =
          null;

        this.ball.state =
          BALL_STATE.FREE;
      }

      this.stats[
        player.team
      ].redCards += 1;

      this.addEvent({
        type: "red",
        team: player.team,
        playerId: player.id,
        playerName: player.name,
        playerNumber: player.number,
        text:
          `${player.name} is sent off`,
      });

      return;
    }

    player.yellowCards += 1;
    player.carded = true;

    this.stats[
      player.team
    ].yellowCards += 1;

    this.addEvent({
      type: "yellow",
      team: player.team,
      playerId: player.id,
      playerName: player.name,
      playerNumber: player.number,
      text:
        `${player.name} receives a yellow card`,
    });
  }

  /* ==========================================================
     FREE KICK
  ========================================================== */

  prepareFreeKick(
    team,
    player
  ) {
    this.pendingRestart = {
      type: "free-kick",
      team,
      x: player.x,
      y: player.y,
      executeAt:
        this.simSeconds + 0.7,
    };
  }

  /* ==========================================================
     AI
  ========================================================== */

  handleAI() {
    const minute =
      this.getMinute();

    for (const team of [
      TEAM.HOME,
      TEAM.AWAY,
    ]) {
      const owner =
        this.getPlayerById(
          this.ball.ownerId
        );

      if (
        owner &&
        owner.team === team
      ) {
        if (
          this.simSeconds >=
          this.nextDecisionAt[
            team
          ]
        ) {
          this.nextDecisionAt[
            team
          ] =
            this.simSeconds +
            random(
              0.8,
              1.8
            );

          this.makePlayerDecision(
            owner
          );
        }
      }
    }

    if (
      minute >=
      this.nextSubstitutionCheck.home
    ) {
      this.aiSubstitution(
        TEAM.HOME
      );

      this.nextSubstitutionCheck.home +=
        random(
          7,
          12
        );
    }

    if (
      minute >=
      this.nextSubstitutionCheck.away
    ) {
      this.aiSubstitution(
        TEAM.AWAY
      );

      this.nextSubstitutionCheck.away +=
        random(
          7,
          12
        );
    }
  }

  /* ==========================================================
     PLAYER DECISION
  ========================================================== */

  makePlayerDecision(
    player
  ) {
    if (
      !player ||
      !player.hasBall
    ) {
      return;
    }

    const team =
      player.team;

    const tactics =
      this.tactics[team];

    const goalX =
      team === TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    const distanceToGoal =
      Math.abs(
        goalX -
          player.x
      );

    const pressure =
      this.getPressureOnPlayer(
        player
      );

    /* ------------------------------------------
       SHOOT
    ------------------------------------------ */

    if (
      distanceToGoal <
        MATCH.shotDistance &&
      this.isShootingAngleGood(
        player
      )
    ) {
      const shootingChance =
        clamp(
          0.20 +
            player.ratings
              .shooting /
              180 -
            pressure / 250,
          0.05,
          0.65
        );

      if (
        chance(
          shootingChance
        )
      ) {
        this.shoot(
          player
        );

        return;
      }
    }

    /* ------------------------------------------
       PASS
    ------------------------------------------ */

    const passTarget =
      this.findBestPassTarget(
        player
      );

    if (
      passTarget
    ) {
      const passProbability =
        tactics.passingStyle ===
        "short"
          ? 0.82
          : tactics.passingStyle ===
            "direct"
          ? 0.65
          : 0.74;

      if (
        chance(
          passProbability
        )
      ) {
        this.pass(
          player,
          passTarget
        );

        return;
      }
    }

    /* ------------------------------------------
       DRIBBLE
    ------------------------------------------ */

    this.dribble(
      player
    );
  }

  /* ==========================================================
     PRESSURE
  ========================================================== */

  getPressureOnPlayer(
    player
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(
          player.team
        )
      );

    let pressure = 0;

    for (const opponent of opponents) {
      const d =
        distance(
          opponent,
          player
        );

      if (
        d < 150
      ) {
        pressure +=
          (
            150 -
            d
          ) /
          150 *
          (
            opponent.ratings
              .tackling /
            100
          );
      }
    }

    return clamp(
      pressure * 35,
      0,
      100
    );
  }

  /* ==========================================================
     PASS TARGET
  ========================================================== */

  findBestPassTarget(
    player
  ) {
    const teammates =
      this.getTeamPlayers(
        player.team
      )
        .filter(
          (p) =>
            p.id !== player.id &&
            p.state ===
              PLAYER_STATE.ACTIVE &&
            !p.isGoalkeeper
        );

    if (!teammates.length) {
      return null;
    }

    const direction =
      teamDirection(
        player.team
      );

    let best = null;
    let bestScore =
      -Infinity;

    for (const teammate of teammates) {
      const d =
        distance(
          player,
          teammate
        );

      if (
        d <
        MATCH.passMinDistance ||
        d >
        MATCH.passMaxDistance
      ) {
        continue;
      }

      const forward =
        (
          teammate.x -
          player.x
        ) *
        direction;

      const openness =
        this.getPlayerOpenness(
          teammate
        );

      const lane =
        this.getPassingLaneQuality(
          player,
          teammate
        );

      const roleBonus =
        ["ST", "LW", "RW", "CAM"].includes(
          teammate.role
        )
          ? 10
          : 0;

      const score =
        forward * 0.45 +
        openness * 0.30 +
        lane * 0.20 +
        roleBonus -
        d * 0.05;

      if (
        score >
        bestScore
      ) {
        bestScore = score;
        best = teammate;
      }
    }

    return best;
  }

  getPlayerOpenness(
    player
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(
          player.team
        )
      );

    const nearest =
      opponents.reduce(
        (min, opponent) =>
          Math.min(
            min,
            distance(
              player,
              opponent
            )
          ),
        Infinity
      );

    return clamp(
      nearest,
      0,
      100
    );
  }

  getPassingLaneQuality(
    from,
    to
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(
          from.team
        )
      );

    let quality = 100;

    for (const opponent of opponents) {
      const d =
        this.distancePointToSegment(
          opponent.x,
          opponent.y,
          from.x,
          from.y,
          to.x,
          to.y
        );

      if (
        d < 25
      ) {
        quality -= 35;
      } else if (
        d < 45
      ) {
        quality -= 15;
      }
    }

    return clamp(
      quality,
      0,
      100
    );
  }

  distancePointToSegment(
    px,
    py,
    x1,
    y1,
    x2,
    y2
  ) {
    const dx =
      x2 - x1;

    const dy =
      y2 - y1;

    const lengthSquared =
      dx * dx +
      dy * dy;

    if (
      lengthSquared === 0
    ) {
      return Math.hypot(
        px - x1,
        py - y1
      );
    }

    let t =
      (
        (px - x1) * dx +
        (py - y1) * dy
      ) /
      lengthSquared;

    t =
      clamp(
        t,
        0,
        1
      );

    const x =
      x1 + t * dx;

    const y =
      y1 + t * dy;

    return Math.hypot(
      px - x,
      py - y
    );
  }

  /* ==========================================================
     PASS
  ========================================================== */

  pass(
    passer,
    receiver
  ) {
    if (
      !passer?.hasBall ||
      !receiver
    ) {
      return false;
    }

    const pressure =
      this.getPressureOnPlayer(
        passer
      );

    const passing =
      passer.ratings.passing;

    const vision =
      passer.ratings.vision;

    const accuracy =
      clamp(
        (
          passing * 0.55 +
          vision * 0.45 -
          pressure * 0.35
        ) / 100,
        0.35,
        0.98
      );

    passer.passesAttempted += 1;

    this.stats[
      passer.team
    ].passes += 1;

    const error =
      (
        1 -
        accuracy
      ) *
      random(
        15,
        55
      );

    const angle =
      Math.atan2(
        receiver.y -
          passer.y,
        receiver.x -
          passer.x
      );

    const errorAngle =
      random(
        -error / 100,
        error / 100
      );

    const finalAngle =
      angle +
      errorAngle;

    const d =
      distance(
        passer,
        receiver
      );

    const speed =
      clamp(
        250 +
          passing * 2.1,
        260,
        470
      );

    this.clearAllPossession();

    passer.hasBall = false;

    this.ball.ownerId =
      null;

    this.ball.state =
      BALL_STATE.PASSING;

    this.ball.targetId =
      receiver.id;

    this.ball.x =
      passer.x;

    this.ball.y =
      passer.y;

    this.ball.vx =
      Math.cos(
        finalAngle
      ) * speed;

    this.ball.vy =
      Math.sin(
        finalAngle
      ) * speed;

    this.ball.flightTime = 0;

    this.ball.totalFlightTime =
      d / speed;

    this.ball.lastTouchTeam =
      passer.team;

    this.ball.lastTouchPlayerId =
      passer.id;

    this.lastPass = {
      passerId:
        passer.id,
      receiverId:
        receiver.id,
      time:
        this.simSeconds,
    };

    passer.lastAction =
      "pass";

    this.addEvent({
      type: "pass",
      team: passer.team,
      playerId: passer.id,
      playerName: passer.name,
      playerNumber: passer.number,
      relatedPlayerId:
        receiver.id,
      relatedPlayerName:
        receiver.name,
      text:
        `${passer.name} passes to ${receiver.name}`,
    });

    return true;
  }

  /* ==========================================================
     PASS RECEPTION
  ========================================================== */

  checkPassReception() {
    const receiver =
      this.getPlayerById(
        this.ball.targetId
      );

    if (!receiver) {
      return;
    }

    const d =
      distance(
        receiver,
        this.ball
      );

    if (
      d <
      MATCH.possessionDistance
    ) {
      const interception =
        this.findInterception(
          receiver
        );

      if (
        interception
      ) {
        this.giveBallToPlayer(
          interception
        );

        interception.interceptions +=
          1;

        this.stats[
          interception.team
        ].interceptions += 1;

        this.addEvent({
          type: "interception",
          team:
            interception.team,
          playerId:
            interception.id,
          playerName:
            interception.name,
          playerNumber:
            interception.number,
          text:
            `${interception.name} intercepts the pass`,
        });

        return;
      }

      const offside =
        this.checkOffsideAtPass(
          receiver
        );

      if (
        offside
      ) {
        this.handleOffside(
          receiver
        );

        return;
      }

      this.giveBallToPlayer(
        receiver
      );

      const passer =
        this.getPlayerById(
          this.lastPass?.passerId
        );

      if (passer) {
        passer.passesCompleted +=
          1;

        this.stats[
          passer.team
        ].passesCompleted +=
          1;
      }

      this.lastPass = null;
    }
  }

  /* ==========================================================
     INTERCEPTION
  ========================================================== */

  findInterception(
    receiver
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(
          receiver.team
        )
      );

    for (const defender of opponents) {
      const d =
        this.distancePointToSegment(
          defender.x,
          defender.y,
          this.ball.x -
            this.ball.vx *
              0.12,
          this.ball.y -
            this.ball.vy *
              0.12,
          receiver.x,
          receiver.y
        );

      if (
        d < 15 &&
        distance(
          defender,
          this.ball
        ) < 24
      ) {
        const interceptionChance =
          clamp(
            (
              defender.ratings
                .interceptions +
              defender.ratings
                .positioning
            ) /
              210,
            0.15,
            0.85
          );

        if (
          chance(
            interceptionChance *
              0.65
          )
        ) {
          return defender;
        }
      }
    }

    return null;
  }

  /* ==========================================================
     DRIBBLE
  ========================================================== */

  dribble(
    player
  ) {
    if (
      !player.hasBall
    ) {
      return;
    }

    const direction =
      teamDirection(
        player.team
      );

    const pressure =
      this.getPressureOnPlayer(
        player
      );

    const dribbling =
      player.ratings.dribbling;

    const decision =
      player.ratings
        .decisionMaking;

    const chanceValue =
      clamp(
        (
          dribbling * 0.6 +
          decision * 0.4 -
          pressure * 0.5
        ) / 100,
        0.1,
        0.95
      );

    if (
      chance(
        chanceValue
      )
    ) {
      player.dribbles += 1;

      this.stats[
        player.team
      ].dribbles += 1;

      player.x +=
        direction *
        random(
          8,
          24
        );

      player.y +=
        random(
          -12,
          12
        );

      clampPosition(
        player
      );

      player.lastAction =
        "dribble";
    } else {
      const opponent =
        this.getClosestOpponentToBall(
          player.team
        );

      if (
        opponent &&
        distance(
          opponent,
          player
        ) < 28
      ) {
        this.resolveTackle(
          opponent,
          player
        );
      }
    }
  }

  /* ==========================================================
     SHOOT
  ========================================================== */

  shoot(
    player
  ) {
    if (
      !player.hasBall
    ) {
      return false;
    }

    const team =
      player.team;

    const direction =
      teamDirection(
        team
      );

    const goalX =
      team === TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    const goalY =
      FIELD.centerY +
      random(
        -FIELD.goalWidth / 2 + 12,
        FIELD.goalWidth / 2 - 12
      );

    const distanceToGoal =
      Math.abs(
        goalX -
          player.x
      );

    const pressure =
      this.getPressureOnPlayer(
        player
      );

    const angleQuality =
      this.getShootingAngleQuality(
        player
      );

    const xG =
      clamp(
        0.04 +
          angleQuality * 0.18 +
          (
            1 -
            distanceToGoal /
              700
          ) *
            0.42 +
          player.ratings.shooting /
            250 -
          pressure / 500,
        0.01,
        0.92
      );

    this.stats[
      team
    ].shots += 1;

    this.stats[
      team
    ].xG += xG;

    player.shots += 1;

    if (
      xG >
      0.30
    ) {
      this.stats[
        team
      ].bigChances += 1;
    }

    const angle =
      Math.atan2(
        goalY -
          player.y,
        goalX -
          player.x
      );

    const accuracy =
      clamp(
        (
          player.ratings.shooting *
            0.55 +
          player.ratings.composure *
            0.20 +
          player.ratings.decisionMaking *
            0.15 -
          pressure * 0.5
        ) / 100,
        0.25,
        0.97
      );

    const error =
      (
        1 -
        accuracy
      ) *
      random(
        0.10,
        0.35
      );

    const finalAngle =
      angle +
      random(
        -error,
        error
      );

    const speed =
      clamp(
        360 +
          player.ratings.shooting *
            2.0,
        360,
        560
      );

    this.clearAllPossession();

    player.hasBall = false;

    this.ball.ownerId =
      null;

    this.ball.state =
      BALL_STATE.SHOOTING;

    this.ball.targetId =
      null;

    this.ball.x =
      player.x;

    this.ball.y =
      player.y;

    this.ball.vx =
      Math.cos(
        finalAngle
      ) * speed;

    this.ball.vy =
      Math.sin(
        finalAngle
      ) * speed;

    this.ball.flightTime =
      0;

    this.ball.totalFlightTime =
      distanceToGoal /
      speed;

    this.ball.lastTouchTeam =
      team;

    this.ball.lastTouchPlayerId =
      player.id;

    this.lastShot = {
      playerId:
        player.id,
      team,
      xG,
      time:
        this.simSeconds,
    };

    this.addEvent({
      type: "shot",
      team,
      playerId:
        player.id,
      playerName:
        player.name,
      playerNumber:
        player.number,
      xg:
        Number(
          xG.toFixed(3)
        ),
      text:
        `${player.name} shoots`,
    });

    return true;
  }

  /* ==========================================================
     SHOT RESULT
  ========================================================== */

  checkShotResult() {
    const team =
      this.ball.lastTouchTeam;

    if (!team) {
      return;
    }

    const defendingTeam =
      otherTeam(team);

    const goalX =
      team === TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    const insideGoalMouth =
      this.ball.y >=
        FIELD.centerY -
          FIELD.goalWidth / 2 &&
      this.ball.y <=
        FIELD.centerY +
          FIELD.goalWidth / 2;

    const crossedGoalLine =
      team === TEAM.HOME
        ? this.ball.x >=
          FIELD.right
        : this.ball.x <=
          FIELD.left;

    if (
      crossedGoalLine &&
      insideGoalMouth
    ) {
      this.scoreGoal(
        team
      );

      return;
    }

    const goalkeeper =
      this.getGoalkeeper(
        defendingTeam
      );

    if (
      goalkeeper
    ) {
      const d =
        distance(
          goalkeeper,
          this.ball
        );

      if (
        d < 32
      ) {
        const shotPower =
          Math.hypot(
            this.ball.vx,
            this.ball.vy
          );

        const saveAbility =
          (
            goalkeeper.ratings
              .reaction *
              0.30 +
            goalkeeper.ratings
              .diving *
              0.30 +
            goalkeeper.ratings
              .handling *
              0.20 +
            goalkeeper.ratings
              .positioning *
              0.20
          );

        const saveChance =
          clamp(
            (
              saveAbility -
              shotPower *
                0.08
            ) /
              100,
            0.10,
            0.90
          );

        if (
          chance(
            saveChance
          )
        ) {
          goalkeeper.saves += 1;

          this.stats[
            defendingTeam
          ].saves += 1;

          this.stats[
            team
          ].shotsOnTarget += 1;

          const shooter =
            this.getPlayerById(
              this.lastShot?.playerId
            );

          if (shooter) {
            shooter.shotsOnTarget +=
              1;
          }

          this.addEvent({
            type: "save",
            team:
              defendingTeam,
            playerId:
              goalkeeper.id,
            playerName:
              goalkeeper.name,
            playerNumber:
              goalkeeper.number,
            relatedPlayerId:
              shooter?.id ||
              null,
            relatedPlayerName:
              shooter?.name ||
              null,
            text:
              `${goalkeeper.name} makes a save`,
          });

          if (
            chance(
              goalkeeper.ratings
                .handling /
                150
            )
          ) {
            this.giveBallToPlayer(
              goalkeeper
            );
          } else {
            this.ball.state =
              BALL_STATE.DEFLECTED;

            this.ball.vx *=
              -0.25;

            this.ball.vy *=
              0.65;
          }

          return;
        }
      }
    }

    /* ------------------------------------------
       SHOT OFF TARGET
    ------------------------------------------ */

    if (
      this.ball.x <
        FIELD.left - 10 ||
      this.ball.x >
        FIELD.right + 10 ||
      this.ball.y <
        FIELD.top - 10 ||
      this.ball.y >
        FIELD.bottom + 10
    ) {
      this.handleShotOut(
        team
      );
    }
  }

  /* ==========================================================
     SHOOTING ANGLE
  ========================================================== */

  isShootingAngleGood(
    player
  ) {
    return (
      this.getShootingAngleQuality(
        player
      ) > 0.28
    );
  }

  getShootingAngleQuality(
    player
  ) {
    const goalX =
      player.team === TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    const distanceToGoal =
      Math.abs(
        goalX -
          player.x
      );

    const vertical =
      Math.abs(
        player.y -
          FIELD.centerY
      );

    const distanceFactor =
      clamp(
        1 -
          distanceToGoal /
            800,
        0,
        1
      );

    const angleFactor =
      clamp(
        1 -
          vertical /
            350,
        0,
        1
      );

    return (
      distanceFactor *
      0.65 +
      angleFactor *
      0.35
    );
  }

  /* ==========================================================
     GOAL
  ========================================================== */

  scoreGoal(
    team
  ) {
    this.score[
      team
    ] += 1;

    this.stats[
      team
    ].goals += 1;

    const scorer =
      this.getPlayerById(
        this.lastShot?.playerId
      );

    if (scorer) {
      scorer.goals += 1;
    }

    let assister = null;

    if (
      this.lastPass &&
      this.lastPass.receiverId ===
        scorer?.id
    ) {
      assister =
        this.getPlayerById(
          this.lastPass.passerId
        );

      if (assister) {
        assister.assists += 1;

        this.stats[
          team
        ].assists += 1;
      }
    }

    this.addEvent({
      type: "goal",
      team,
      playerId:
        scorer?.id ||
        null,
      playerName:
        scorer?.name ||
        "Unknown",
      playerNumber:
        scorer?.number ||
        null,
      relatedPlayerId:
        assister?.id ||
        null,
      relatedPlayerName:
        assister?.name ||
        null,
      xg:
        this.lastShot?.xG ||
        null,
      text:
        assister
          ? `GOAL! ${scorer.name} scores, assisted by ${assister.name}`
          : `GOAL! ${scorer?.name || "Unknown"} scores`,
    });

    this.ball.state =
      BALL_STATE.GOAL;

    this.ball.ownerId =
      null;

    this.clearAllPossession();

    this.pendingRestart = {
      type: "kickoff",
      team:
        otherTeam(team),
      executeAt:
        this.simSeconds + 1.2,
    };

    this.lastPass = null;
    this.lastShot = null;
  }

  /* ==========================================================
     SHOT OUT
  ========================================================== */

  handleShotOut(
    attackingTeam
  ) {
    const defendingTeam =
      otherTeam(
        attackingTeam
      );

    const goalLine =
      attackingTeam ===
      TEAM.HOME
        ? FIELD.right
        : FIELD.left;

    if (
      (
        attackingTeam ===
          TEAM.HOME &&
        this.ball.x >
          goalLine
      ) ||
      (
        attackingTeam ===
          TEAM.AWAY &&
        this.ball.x <
          goalLine
      )
    ) {
      this.stats[
        defendingTeam
      ].goalKicks += 1;

      this.addEvent({
        type: "goal-kick",
        team:
          defendingTeam,
        text:
          `${this.getTeamName(defendingTeam)} goal kick`,
      });

      this.prepareGoalKick(
        defendingTeam
      );

      return;
    }

    this.ball.state =
      BALL_STATE.OUT;
  }

  /* ==========================================================
     OFFSIDE
  ========================================================== */

  checkOffsideAtPass(
    receiver
  ) {
    const direction =
      teamDirection(
        receiver.team
      );

    const opponentPlayers =
      this.getTeamPlayers(
        otherTeam(
          receiver.team
        )
      )
        .filter(
          (p) =>
            !p.isGoalkeeper &&
            p.state ===
              PLAYER_STATE.ACTIVE
        )
        .sort(
          (a, b) =>
            (
              b.x *
              direction
            ) -
            (
              a.x *
              direction
            )
        );

    const goalkeeper =
      this.getGoalkeeper(
        otherTeam(
          receiver.team
        )
      );

    const defenders = [
      ...opponentPlayers,
      goalkeeper,
    ]
      .filter(Boolean)
      .sort(
        (a, b) =>
          (
            b.x *
            direction
          ) -
          (
            a.x *
            direction
          )
      );

    if (
      receiver.x *
        direction <=
      FIELD.centerX *
        direction
    ) {
      return false;
    }

    const secondLast =
      defenders[1];

    if (!secondLast) {
      return false;
    }

    const ballAhead =
      this.ball.x *
        direction >
      receiver.x *
        direction;

    return (
      receiver.x *
        direction >
        secondLast.x *
          direction &&
      !ballAhead
    );
  }

  handleOffside(
    receiver
  ) {
    this.stats[
      receiver.team
    ].offsides += 1;

    this.addEvent({
      type: "offside",
      team:
        receiver.team,
      playerId:
        receiver.id,
      playerName:
        receiver.name,
      playerNumber:
        receiver.number,
      text:
        `${receiver.name} is offside`,
    });

    this.pendingRestart = {
      type: "free-kick",
      team:
        otherTeam(
          receiver.team
        ),
      x: this.ball.x,
      y: this.ball.y,
      executeAt:
        this.simSeconds + 0.8,
    };

    this.ball.ownerId =
      null;

    this.ball.state =
      BALL_STATE.FREE;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.clearAllPossession();
  }

  /* ==========================================================
     SET PIECES
  ========================================================== */

  updateSetPieces() {
    if (
      !this.pendingRestart
    ) {
      return;
    }

    if (
      this.simSeconds <
      this.pendingRestart.executeAt
    ) {
      return;
    }

    const restart =
      this.pendingRestart;

    this.pendingRestart =
      null;

    if (
      restart.type ===
      "kickoff"
    ) {
      this.executeKickoff(
        restart.team
      );
    }

    if (
      restart.type ===
      "free-kick"
    ) {
      this.executeFreeKick(
        restart
      );
    }

    if (
      restart.type ===
      "goal-kick"
    ) {
      this.executeGoalKick(
        restart.team
      );
    }

    if (
      restart.type ===
      "corner"
    ) {
      this.executeCorner(
        restart.team,
        restart.y
      );
    }

    if (
      restart.type ===
      "throw-in"
    ) {
      this.executeThrowIn(
        restart.team,
        restart.y
      );
    }
  }

  executeKickoff(
    team
  ) {
    const midfielders =
      this.getTeamPlayers(
        team
      ).filter(
        (p) =>
          !p.isGoalkeeper
      );

    const player =
      midfielders.sort(
        (a, b) =>
          Math.abs(
            a.x -
              FIELD.centerX
          ) -
          Math.abs(
            b.x -
              FIELD.centerX
          )
      )[0];

    if (!player) {
      return;
    }

    player.x =
      FIELD.centerX -
      teamDirection(team) *
        12;

    player.y =
      FIELD.centerY;

    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.giveBallToPlayer(
      player
    );
  }

  executeFreeKick(
    restart
  ) {
    const players =
      this.getTeamPlayers(
        restart.team
      )
        .filter(
          (p) =>
            !p.isGoalkeeper
        )
        .sort(
          (a, b) =>
            b.ratings.passing -
            a.ratings.passing
        );

    const kicker =
      players[0];

    if (!kicker) {
      return;
    }

    kicker.x =
      restart.x;

    kicker.y =
      restart.y;

    this.giveBallToPlayer(
      kicker
    );

    this.nextDecisionAt[
      restart.team
    ] =
      this.simSeconds +
      0.5;
  }

  prepareGoalKick(
    team
  ) {
    this.pendingRestart = {
      type: "goal-kick",
      team,
      executeAt:
        this.simSeconds + 0.8,
    };
  }

  executeGoalKick(
    team
  ) {
    const goalkeeper =
      this.getGoalkeeper(
        team
      );

    if (!goalkeeper) {
      return;
    }

    this.giveBallToPlayer(
      goalkeeper
    );

    this.ball.x =
      team === TEAM.HOME
        ? FIELD.left + 55
        : FIELD.right - 55;

    this.ball.y =
      FIELD.centerY;
  }

  executeCorner(
    team,
    y
  ) {
    const players =
      this.getTeamPlayers(
        team
      ).filter(
        (p) =>
          !p.isGoalkeeper
      );

    const kicker =
      players.sort(
        (a, b) =>
          b.ratings.crossing -
          a.ratings.crossing
      )[0];

    if (!kicker) {
      return;
    }

    kicker.x =
      team === TEAM.HOME
        ? FIELD.right - 8
        : FIELD.left + 8;

    kicker.y =
      y < FIELD.centerY
        ? FIELD.top + 8
        : FIELD.bottom - 8;

    this.giveBallToPlayer(
      kicker
    );

    kicker.crosses += 1;

    this.stats[
      team
    ].crosses += 1;
  }

  executeThrowIn(
    team,
    y
  ) {
    const players =
      this.getTeamPlayers(
        team
      ).filter(
        (p) =>
          !p.isGoalkeeper
      );

    const thrower =
      players.sort(
        (a, b) =>
          b.ratings.passing -
          a.ratings.passing
      )[0];

    if (!thrower) {
      return;
    }

    thrower.y =
      y;

    thrower.x =
      team === TEAM.HOME
        ? FIELD.left + 10
        : FIELD.right - 10;

    this.giveBallToPlayer(
      thrower
    );

    this.stats[
      team
    ].throwIns += 1;
  }

  /* ==========================================================
     BALL OUT
  ========================================================== */

  checkBallOut() {
    if (
      this.ball.x >=
        FIELD.left &&
      this.ball.x <=
        FIELD.right &&
      this.ball.y >=
        FIELD.top &&
      this.ball.y <=
        FIELD.bottom
    ) {
      return;
    }

    if (
      this.ball.state ===
      BALL_STATE.GOAL
    ) {
      return;
    }

    const lastTeam =
      this.ball.lastTouchTeam;

    if (!lastTeam) {
      this.resetBallToKickoff();
      return;
    }

    const horizontalOut =
      this.ball.y <
        FIELD.top ||
      this.ball.y >
        FIELD.bottom;

    const verticalOut =
      this.ball.x <
        FIELD.left ||
      this.ball.x >
        FIELD.right;

    if (
      horizontalOut
    ) {
      const restartTeam =
        otherTeam(
          lastTeam
        );

      this.addEvent({
        type: "throw-in",
        team:
          restartTeam,
        text:
          `${this.getTeamName(restartTeam)} throw-in`,
      });

      this.pendingRestart = {
        type: "throw-in",
        team:
          restartTeam,
        y:
          clamp(
            this.ball.y,
            FIELD.top,
            FIELD.bottom
          ),
        executeAt:
          this.simSeconds + 0.6,
      };

      this.ball.state =
        BALL_STATE.OUT;

      this.ball.vx = 0;
      this.ball.vy = 0;

      this.ball.ownerId =
        null;

      this.clearAllPossession();

      return;
    }

    if (
      verticalOut
    ) {
      const defendingTeam =
        otherTeam(
          lastTeam
        );

      const attackingTeam =
        lastTeam;

      const crossedGoal =
        (
          attackingTeam ===
            TEAM.HOME &&
          this.ball.x >
            FIELD.right
        ) ||
        (
          attackingTeam ===
            TEAM.AWAY &&
          this.ball.x <
            FIELD.left
        );

      if (
        crossedGoal
      ) {
        this.addEvent({
          type: "goal-kick",
          team:
            defendingTeam,
          text:
            `${this.getTeamName(defendingTeam)} goal kick`,
        });

        this.stats[
          defendingTeam
        ].goalKicks += 1;

        this.prepareGoalKick(
          defendingTeam
        );
      } else {
        this.addEvent({
          type: "corner",
          team:
            attackingTeam,
          text:
            `${this.getTeamName(attackingTeam)} corner`,
        });

        this.stats[
          attackingTeam
        ].corners += 1;

        this.pendingRestart = {
          type: "corner",
          team:
            attackingTeam,
          y:
            this.ball.y <
            FIELD.centerY
              ? FIELD.top + 8
              : FIELD.bottom - 8,
          executeAt:
            this.simSeconds + 0.8,
        };
      }

      this.ball.state =
        BALL_STATE.OUT;

      this.ball.ownerId =
        null;

      this.ball.vx = 0;
      this.ball.vy = 0;

      this.clearAllPossession();
    }
  }

  /* ==========================================================
     AUTOMATIC SUBSTITUTIONS
  ========================================================== */

  checkAutomaticSubstitutions() {
    if (
      this.getMinute() < 55
    ) {
      return;
    }

    this.aiSubstitution(
      TEAM.HOME
    );

    this.aiSubstitution(
      TEAM.AWAY
    );
  }

  aiSubstitution(
    team
  ) {
    if (
      this.substitutionsUsed[
        team
      ] >=
      MATCH.maxSubstitutions
    ) {
      return;
    }

    const starters =
      this.getTeamPlayers(
        team
      ).filter(
        (p) =>
          p.state ===
            PLAYER_STATE.ACTIVE &&
          !p.isGoalkeeper
      );

    const bench =
      this.bench[
        team
      ].filter(
        (p) =>
          p.state ===
          PLAYER_STATE.ACTIVE
      );

    if (
      !starters.length ||
      !bench.length
    ) {
      return;
    }

    const tired =
      starters
        .filter(
          (p) =>
            p.stamina <
            35
        )
        .sort(
          (a, b) =>
            a.stamina -
            b.stamina
        )[0];

    const yellowRisk =
      starters.find(
        (p) =>
          p.yellowCards >= 1 &&
          p.stamina < 55
      );

    const poorPerformer =
      starters
        .filter(
          (p) =>
            p.shots +
              p.passes +
              p.tackles >
            2
        )
        .sort(
          (a, b) =>
            this.getPlayerPerformance(
              a
            ) -
            this.getPlayerPerformance(
              b
            )
        )[0];

    const outgoing =
      tired ||
      yellowRisk ||
      (
        chance(0.25)
          ? poorPerformer
          : null
      );

    if (!outgoing) {
      return;
    }

    const incoming =
      this.findReplacement(
        outgoing,
        bench
      );

    if (!incoming) {
      return;
    }

    this.substitute(
      team,
      outgoing.id,
      incoming.id,
      true
    );
  }

  getPlayerPerformance(
    player
  ) {
    return (
      player.passesCompleted *
        0.8 +
      player.goals * 10 +
      player.assists * 8 +
      player.tackles * 1.2 +
      player.interceptions *
        1.5 +
      player.dribbles * 0.8 -
      player.fouls * 0.8
    );
  }

  findReplacement(
    outgoing,
    bench
  ) {
    const outgoingGroup =
      normalizePosition(
        outgoing.position
      );

    return (
      bench.find(
        (p) =>
          normalizePosition(
            p.position
          ) ===
          outgoingGroup
      ) ||
      bench.find(
        (p) =>
          p.role ===
          outgoing.role
      ) ||
      bench[0]
    );
  }

  /* ==========================================================
     MANAGER SUBSTITUTION
  ========================================================== */

  substitute(
    team,
    outgoingId,
    incomingId,
    isAI = false
  ) {
    if (
      this.substitutionsUsed[
        team
      ] >=
      MATCH.maxSubstitutions
    ) {
      return {
        success: false,
        reason:
          "Maximum 5 substitutions reached",
      };
    }

    const starters =
      this.getTeamPlayers(
        team
      );

    const outgoing =
      starters.find(
        (p) =>
          p.id ===
          outgoingId
      );

    const incomingIndex =
      this.bench[
        team
      ].findIndex(
        (p) =>
          p.id ===
          incomingId
      );

    if (
      !outgoing
    ) {
      return {
        success: false,
        reason:
          "Outgoing player not found",
      };
    }

    if (
      incomingIndex < 0
    ) {
      return {
        success: false,
        reason:
          "Incoming player not found",
      };
    }

    if (
      outgoing.isGoalkeeper &&
      !this.bench[
        team
      ][incomingIndex].isGoalkeeper
    ) {
      return {
        success: false,
        reason:
          "Goalkeeper must be replaced by goalkeeper",
      };
    }

    const incoming =
      this.bench[
        team
      ][incomingIndex];

    const oldRole =
      outgoing.role;

    const oldX =
      outgoing.x;

    const oldY =
      outgoing.y;

    outgoing.state =
      PLAYER_STATE.SUBSTITUTED;

    outgoing.substituted =
      true;

    outgoing.hasBall =
      false;

    incoming.state =
      PLAYER_STATE.ACTIVE;

    incoming.substituted =
      false;

    incoming.role =
      oldRole;

    incoming.x =
      oldX;

    incoming.y =
      oldY;

    incoming.homeX =
      oldX;

    incoming.homeY =
      oldY;

    incoming.targetX =
      oldX;

    incoming.targetY =
      oldY;

    const starterIndex =
      this.players[
        team
      ].findIndex(
        (p) =>
          p.id ===
          outgoing.id
      );

    if (
      starterIndex >= 0
    ) {
      this.players[
        team
      ][starterIndex] =
        incoming;
    }

    this.bench[
      team
    ].splice(
      incomingIndex,
      1
    );

    this.bench[
      team
    ].push(
      outgoing
    );

    this.substitutionsUsed[
      team
    ] += 1;

    this.addEvent({
      type: "substitution",
      team,
      playerId:
        incoming.id,
      playerName:
        incoming.name,
      playerNumber:
        incoming.number,
      relatedPlayerId:
        outgoing.id,
      relatedPlayerName:
        outgoing.name,
      text:
        `${incoming.name} replaces ${outgoing.name}`,
      isAI,
    });

    return {
      success: true,
      outgoing,
      incoming,
      substitutionsUsed:
        this.substitutionsUsed[
          team
        ],
    };
  }

  /* ==========================================================
     RESET BALL
  ========================================================== */

  resetBallToKickoff() {
    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.ball.state =
      BALL_STATE.FREE;

    this.ball.ownerId =
      null;

    this.ball.targetId =
      null;

    this.clearAllPossession();
  }

  /* ==========================================================
     GETTERS
  ========================================================== */

  getTeamPlayers(
    team
  ) {
    return this.players[
      team
    ].filter(
      (player) =>
        player.state ===
        PLAYER_STATE.ACTIVE
    );
  }

  getPlayerById(
    playerId
  ) {
    if (!playerId) {
      return null;
    }

    return (
      this.players.home.find(
        (p) =>
          p.id ===
          playerId
      ) ||
      this.players.away.find(
        (p) =>
          p.id ===
          playerId
      ) ||
      this.bench.home.find(
        (p) =>
          p.id ===
          playerId
      ) ||
      this.bench.away.find(
        (p) =>
          p.id ===
          playerId
      ) ||
      null
    );
  }

  getGoalkeeper(
    team
  ) {
    return this.getTeamPlayers(
      team
    ).find(
      (player) =>
        player.isGoalkeeper
    );
  }

  getClosestOpponentToBall(
    team
  ) {
    const opponents =
      this.getTeamPlayers(
        otherTeam(team)
      );

    if (!opponents.length) {
      return null;
    }

    return opponents.sort(
      (a, b) =>
        distance(
          a,
          this.ball
        ) -
        distance(
          b,
          this.ball
        )
    )[0];
  }

  getTeamName(
    team
  ) {
    return team === TEAM.HOME
      ? this.homeTeam.name
      : this.awayTeam.name;
  }

  /* ==========================================================
     TACTICS UPDATE
     IMPORTANT:
     Manager can update HOME only.
     ========================================================== */

  setHomeTactics(
    changes = {}
  ) {
    this.tactics.home =
      normalizeTactics({
        ...this.tactics.home,
        ...changes,
      });

    return this.tactics.home;
  }

  setAwayTactics(
    changes = {}
  ) {
    /*
      This function is kept for AI/internal use.
      The UI should NOT expose this to the manager.
    */

    this.tactics.away =
      normalizeTactics({
        ...this.tactics.away,
        ...changes,
      });

    return this.tactics.away;
  }

  /* ==========================================================
     FORMATION UPDATE
     Manager's team only.
  ========================================================== */

  setHomeFormation(
    formation
  ) {
    if (
      !FORMATIONS[formation]
    ) {
      return false;
    }

    this.formations.home =
      formation;

    this.repositionTeam(
      TEAM.HOME,
      formation
    );

    return true;
  }

  repositionTeam(
    team,
    formationName
  ) {
    const formation =
      FORMATIONS[
        formationName
      ];

    if (!formation) {
      return;
    }

    const players =
      this.getTeamPlayers(
        team
      );

    for (
      let i = 0;
      i <
      Math.min(
        players.length,
        formation.length
      );
      i++
    ) {
      const player =
        players[i];

      const roleInfo =
        formation[i];

      const x =
        FIELD.left +
        (
          team === TEAM.HOME
            ? roleInfo.x
            : 1 -
              roleInfo.x
        ) *
          (
            FIELD.right -
            FIELD.left
          );

      const y =
        FIELD.top +
        roleInfo.y *
          (
            FIELD.bottom -
            FIELD.top
          );

      player.homeX =
        x;

      player.homeY =
        y;

      player.targetX =
        x;

      player.targetY =
        y;

      player.role =
        roleInfo.role;
    }
  }

  /* ==========================================================
     EVENTS
  ========================================================== */

  addEvent({
    type,
    team = null,
    playerId = null,
    playerName = null,
    playerNumber = null,
    relatedPlayerId = null,
    relatedPlayerName = null,
    text = "",
    xg = null,
    isAI = false,
  }) {
    const event = {
      id: id("event"),

      minute:
        this.getMinute(),

      second:
        this.getSecond(),

      type,

      team,

      playerId,

      playerName,

      playerNumber,

      relatedPlayerId,

      relatedPlayerName,

      text,

      ...(xg !== null
        ? { xg }
        : {}),

      ...(isAI
        ? { isAI: true }
        : {}),
    };

    this.events.push(
      event
    );

    if (
      this.events.length >
      500
    ) {
      this.events =
        this.events.slice(
          -500
        );
    }

    if (
      typeof this.onEvent ===
      "function"
    ) {
      this.onEvent(
        event
      );
    }

    return event;
  }

  /* ==========================================================
     FINISH
  ========================================================== */

  finishMatch() {
    if (
      this.status ===
      "finished"
    ) {
      return;
    }

    this.simSeconds =
      this.durationSeconds;

    this.updatePossessionPercent();

    this.status =
      "finished";

    this.addEvent({
      type: "fulltime",
      team: null,
      text:
        `Full-time: ${this.score.home}-${this.score.away}`,
    });
  }

  /* ==========================================================
     SNAPSHOT
  ========================================================== */

  getSnapshot() {
    this.updatePossessionPercent();

    return {
      matchId:
        this.matchId,

      status:
        this.status,

      minute:
        this.getMinute(),

      second:
        this.getSecond(),

      simSeconds:
        this.simSeconds,

      durationSeconds:
        this.durationSeconds,

      score: {
        home:
          this.score.home,

        away:
          this.score.away,
      },

      formations: {
        home:
          this.formations.home,

        away:
          this.formations.away,
      },

      tactics: {
        home: {
          ...this.tactics.home,
        },

        away: {
          ...this.tactics.away,
        },
      },

      ball: {
        x:
          this.ball.x,

        y:
          this.ball.y,

        vx:
          this.ball.vx,

        vy:
          this.ball.vy,

        state:
          this.ball.state,

        ownerId:
          this.ball.ownerId,

        targetId:
          this.ball.targetId,

        lastTouchTeam:
          this.ball.lastTouchTeam,
      },

      players: {
        home:
          this.serializePlayers(
            TEAM.HOME
          ),

        away:
          this.serializePlayers(
            TEAM.AWAY
          ),
      },

      bench: {
        home:
          this.serializeBench(
            TEAM.HOME
          ),

        away:
          this.serializeBench(
            TEAM.AWAY
          ),
      },

      stats: {
        home: {
          ...this.stats.home,
        },

        away: {
          ...this.stats.away,
        },
      },

      substitutionsUsed: {
        home:
          this.substitutionsUsed.home,

        away:
          this.substitutionsUsed.away,
      },

      events:
        this.events.slice(-100),
    };
  }

  serializePlayers(
    team
  ) {
    return this.players[
      team
    ].map(
      (player) => ({
        id:
          player.id,

        rawId:
          player.rawId,

        name:
          player.name,

        number:
          player.number,

        position:
          player.position,

        role:
          player.role,

        x:
          player.x,

        y:
          player.y,

        vx:
          player.vx,

        vy:
          player.vy,

        stamina:
          player.stamina,

        hasBall:
          player.hasBall,

        state:
          player.state,

        ratings: {
          ...player.ratings,
        },

        stats: {
          passesAttempted:
            player.passesAttempted,

          passesCompleted:
            player.passesCompleted,

          shots:
            player.shots,

          shotsOnTarget:
            player.shotsOnTarget,

          goals:
            player.goals,

          assists:
            player.assists,

          tackles:
            player.tackles,

          interceptions:
            player.interceptions,

          fouls:
            player.fouls,

          yellowCards:
            player.yellowCards,

          redCards:
            player.redCards,

          saves:
            player.saves,

          dribbles:
            player.dribbles,

          crosses:
            player.crosses,
        },
      })
    );
  }

  serializeBench(
    team
  ) {
    return this.bench[
      team
    ].map(
      (player) => ({
        id:
          player.id,

        rawId:
          player.rawId,

        name:
          player.name,

        number:
          player.number,

        position:
          player.position,

        role:
          player.role,

        stamina:
          player.stamina,

        state:
          player.state,

        ratings: {
          ...player.ratings,
        },
      })
    );
  }

  /* ==========================================================
     SERIALIZE RESULT FOR FIRESTORE
  ========================================================== */

  serializeResult() {
    this.updatePossessionPercent();

    return {
      status:
        this.status,

      minute:
        this.getMinute(),

      score: {
        home:
          this.score.home,

        away:
          this.score.away,
      },

      homeScore:
        this.score.home,

      awayScore:
        this.score.away,

      result:
        this.score.home >
        this.score.away
          ? "home"
          : this.score.away >
            this.score.home
          ? "away"
          : "draw",

      formations: {
        home:
          this.formations.home,

        away:
          this.formations.away,
      },

      tactics: {
        home: {
          ...this.tactics.home,
        },

        away: {
          ...this.tactics.away,
        },
      },

      stats: {
        home: {
          ...this.stats.home,
        },

        away: {
          ...this.stats.away,
        },
      },

      events:
        this.events.slice(-500),

      substitutionsUsed: {
        home:
          this.substitutionsUsed.home,

        away:
          this.substitutionsUsed.away,
      },

      playerStats: {
        home:
          this.serializePlayers(
            TEAM.HOME
          ),

        away:
          this.serializePlayers(
            TEAM.AWAY
          ),
      },
    };
  }

  /* ==========================================================
     EVENT ACCESS
  ========================================================== */

  getEventsSince(
    index = 0
  ) {
    return this.events.slice(
      Math.max(
        0,
        index
      )
    );
  }

  /* ==========================================================
     STATE
  ========================================================== */

  isFinished() {
    return (
      this.status ===
      "finished"
    );
  }

  getRemainingSeconds() {
    return Math.max(
      0,
      this.durationSeconds -
        this.simSeconds
    );
  }

  /* ==========================================================
     DEBUG
  ========================================================== */

  debug() {
    return {
      minute:
        this.getMinute(),

      status:
        this.status,

      score:
        this.score,

      ball:
        this.ball,

      homePlayers:
        this.players.home.map(
          (p) => ({
            name:
              p.name,
            number:
              p.number,
            x:
              p.x,
            y:
              p.y,
            hasBall:
              p.hasBall,
            stamina:
              p.stamina,
          })
        ),

      awayPlayers:
        this.players.away.map(
          (p) => ({
            name:
              p.name,
            number:
              p.number,
            x:
              p.x,
            y:
              p.y,
            hasBall:
              p.hasBall,
            stamina:
              p.stamina,
          })
        ),

      stats:
        this.stats,
    };
  }
}
