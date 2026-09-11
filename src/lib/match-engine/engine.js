// lib/match-engine/engine.js

import {
  BALL_STATE,
  EVENTS,
  FIELD,
  MATCH,
  clamp,
  distance,
} from "./constants";

import {
  createBall,
  setBallOwner,
  updateBall,
  moveBallWithOwner,
} from "./ball";

import {
  createTeam,
  updateTeamMinutes,
} from "./team";

import {
  attemptTackle,
} from "./defending";

import {
  resolveShot,
  attemptShot,
} from "./shooting";

import {
  attemptPass,
} from "./passing";

import {
  aiSubstitute,
  performSubstitution,
} from "./substitutions";

/* =========================================================
   HELPERS
========================================================= */

const FIELD_WIDTH =
  Number(FIELD?.width) || 1050;

const FIELD_HEIGHT =
  Number(FIELD?.height) || 680;

const CENTER_X =
  Number(FIELD?.centerX) || FIELD_WIDTH / 2;

const CENTER_Y =
  Number(FIELD?.centerY) || FIELD_HEIGHT / 2;

const DEFAULT_DURATION = 240;

const FORMATIONS = {
  "4-4-2": [
    { role: "GK", x: 0.05, y: 0.50 },

    { role: "LB", x: 0.20, y: 0.15 },
    { role: "CB", x: 0.18, y: 0.38 },
    { role: "CB", x: 0.18, y: 0.62 },
    { role: "RB", x: 0.20, y: 0.85 },

    { role: "LM", x: 0.42, y: 0.18 },
    { role: "CM", x: 0.38, y: 0.40 },
    { role: "CM", x: 0.38, y: 0.60 },
    { role: "RM", x: 0.42, y: 0.82 },

    { role: "ST", x: 0.72, y: 0.40 },
    { role: "ST", x: 0.72, y: 0.60 },
  ],

  "4-3-3": [
    { role: "GK", x: 0.05, y: 0.50 },

    { role: "LB", x: 0.20, y: 0.15 },
    { role: "CB", x: 0.18, y: 0.38 },
    { role: "CB", x: 0.18, y: 0.62 },
    { role: "RB", x: 0.20, y: 0.85 },

    { role: "CM", x: 0.38, y: 0.30 },
    { role: "CDM", x: 0.34, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.70 },

    { role: "LW", x: 0.72, y: 0.18 },
    { role: "ST", x: 0.76, y: 0.50 },
    { role: "RW", x: 0.72, y: 0.82 },
  ],

  "3-5-2": [
    { role: "GK", x: 0.05, y: 0.50 },

    { role: "CB", x: 0.18, y: 0.25 },
    { role: "CB", x: 0.16, y: 0.50 },
    { role: "CB", x: 0.18, y: 0.75 },

    { role: "LWB", x: 0.42, y: 0.12 },
    { role: "CM", x: 0.38, y: 0.34 },
    { role: "CDM", x: 0.34, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.66 },
    { role: "RWB", x: 0.42, y: 0.88 },

    { role: "ST", x: 0.73, y: 0.40 },
    { role: "ST", x: 0.73, y: 0.60 },
  ],

  "5-3-2": [
    { role: "GK", x: 0.05, y: 0.50 },

    { role: "LWB", x: 0.20, y: 0.10 },
    { role: "CB", x: 0.16, y: 0.30 },
    { role: "CB", x: 0.15, y: 0.50 },
    { role: "CB", x: 0.16, y: 0.70 },
    { role: "RWB", x: 0.20, y: 0.90 },

    { role: "CM", x: 0.38, y: 0.30 },
    { role: "CM", x: 0.36, y: 0.50 },
    { role: "CM", x: 0.38, y: 0.70 },

    { role: "ST", x: 0.72, y: 0.40 },
    { role: "ST", x: 0.72, y: 0.60 },
  ],

  "4-2-3-1": [
    { role: "GK", x: 0.05, y: 0.50 },

    { role: "LB", x: 0.20, y: 0.15 },
    { role: "CB", x: 0.18, y: 0.38 },
    { role: "CB", x: 0.18, y: 0.62 },
    { role: "RB", x: 0.20, y: 0.85 },

    { role: "CDM", x: 0.34, y: 0.40 },
    { role: "CDM", x: 0.34, y: 0.60 },

    { role: "LW", x: 0.55, y: 0.18 },
    { role: "CAM", x: 0.56, y: 0.50 },
    { role: "RW", x: 0.55, y: 0.82 },

    { role: "ST", x: 0.76, y: 0.50 },
  ],
};

const DEFAULT_TACTICS = {
  mentality: "balanced",
  pressing: "medium",
  tempo: "normal",
  width: "normal",
  defensiveLine: "normal",
  passingStyle: "mixed",
  counterAttack: true,
};

const ROLE_GROUPS = {
  GK: ["GK"],

  DEF: [
    "CB",
    "LB",
    "RB",
    "LWB",
    "RWB",
    "SW",
  ],

  MID: [
    "CDM",
    "CM",
    "CAM",
    "LM",
    "RM",
  ],

  WIDE: [
    "LW",
    "RW",
    "LM",
    "RM",
    "LWB",
    "RWB",
  ],

  ATT: [
    "ST",
    "CF",
    "SS",
    "LW",
    "RW",
  ],
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback = false) {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return clamp(num(value, 0), 0, 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeTactics(input = {}) {
  return {
    ...DEFAULT_TACTICS,
    ...input,
  };
}

function roleIs(player, group) {
  return (
    ROLE_GROUPS[group]?.includes(player.role) ||
    ROLE_GROUPS[group]?.includes(player.position)
  );
}

function isDefender(player) {
  return roleIs(player, "DEF");
}

function isMidfielder(player) {
  return roleIs(player, "MID");
}

function isAttacker(player) {
  return roleIs(player, "ATT");
}

function isWide(player) {
  return roleIs(player, "WIDE");
}

function isGoalkeeper(player) {
  return (
    player.role === "GK" ||
    player.position === "GK"
  );
}

function attackingX(team, amount = 0) {
  return team.attackDirection === 1
    ? amount
    : FIELD_WIDTH - amount;
}

function progressForTeam(team, x) {
  if (team.attackDirection === 1) {
    return x / FIELD_WIDTH;
  }

  return 1 - x / FIELD_WIDTH;
}

function forwardDistance(team, fromX, toX) {
  if (team.attackDirection === 1) {
    return toX - fromX;
  }

  return fromX - toX;
}

function normalizePoint(x, y) {
  return {
    x: clamp(x, 8, FIELD_WIDTH - 8),
    y: clamp(y, 8, FIELD_HEIGHT - 8),
  };
}

function nearestPlayer(players, target) {
  let best = null;
  let bestDistance = Infinity;

  for (const player of players) {
    if (!player || player.redCard) continue;

    const d = distance(player, target);

    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }

  return best;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = clamp(
    ((px - x1) * dx + (py - y1) * dy) /
      (dx * dx + dy * dy),
    0,
    1
  );

  const cx = x1 + t * dx;
  const cy = y1 + t * dy;

  return Math.hypot(px - cx, py - cy);
}

/* =========================================================
   ENGINE
========================================================= */

export default class MatchEngine {
  constructor({
    matchId,

    homeTeam,
    awayTeam,

    homePlayers = [],
    awayPlayers = [],

    homeLineupIds = [],
    awayLineupIds = [],

    formationHome = "4-4-2",
    formationAway = "4-4-2",

    tacticsHome = {},
    tacticsAway = {},

    durationSeconds = DEFAULT_DURATION,

    initialScore = {
      home: 0,
      away: 0,
    },

    initialMinute = 0,

    initialEvents = [],

    managedTeam = "home",

    onEvent = null,
  }) {
    this.matchId = matchId;

    this.durationSeconds =
      Math.max(
        30,
        num(
          durationSeconds,
          DEFAULT_DURATION
        )
      );

    this.managedTeam =
      managedTeam === "away"
        ? "away"
        : "home";

    this.onEvent = onEvent;

    this.home = createTeam({
      side: "home",
      club: homeTeam,
      players: homePlayers,
      lineupIds: homeLineupIds,
      formation: formationHome,
      tactics: normalizeTactics(
        tacticsHome
      ),
    });

    this.away = createTeam({
      side: "away",
      club: awayTeam,
      players: awayPlayers,
      lineupIds: awayLineupIds,
      formation: formationAway,
      tactics: normalizeTactics(
        tacticsAway
      ),
    });

    this.normalizeTeam(
      this.home,
      formationHome
    );

    this.normalizeTeam(
      this.away,
      formationAway
    );

    this.ball = createBall();

    this.realSeconds = 0;

    this.simSeconds =
      clamp(
        num(initialMinute, 0),
        0,
        90
      ) *
      60;

    this.minute = Math.floor(
      this.simSeconds / 60
    );

    this.second = Math.floor(
      this.simSeconds % 60
    );

    this.status = "not_started";

    this.score = {
      home: num(initialScore?.home, 0),
      away: num(initialScore?.away, 0),
    };

    this.events = Array.isArray(
      initialEvents
    )
      ? [...initialEvents]
      : [];

    this.eventCounter =
      this.events.length;

    this.lastShot = null;
    this.lastPass = null;

    this.lastTouchTeam = null;
    this.lastTouchPlayerId = null;

    this.lastPossessionTeam =
      "home";

    this.lastPossessionPlayerId =
      null;

    this.possessionClock = {
      home: 0,
      away: 0,
    };

    this.halfTimeTriggered = false;
    this.fullTimeTriggered = false;

    this.kickoffTaken = false;

    this.aiTimer = 0;
    this.substitutionTimer = 0;

    this.tacticalTimer = 0;
    this.decisionTimer = 0;

    this.lastDecisionByPlayer = {};

    this.pendingRestart = null;

    this.goalCooldown = 0;

    this.resetPositions();

    if (this.minute >= 45) {
      this.halfTimeTriggered = true;
    }
  }

  /* =======================================================
     TEAM / PLAYER NORMALIZATION
  ======================================================= */

  normalizeTeam(team, formation) {
    team.tactics = normalizeTactics(
      team.tactics
    );

    team.formation =
      formation ||
      team.formation ||
      "4-4-2";

    team.attackDirection =
      team.side === "home" ? 1 : -1;

    team.score =
      num(team.score, 0);

    team.substitutionsUsed =
      num(team.substitutionsUsed, 0);

    if (!team.stats) {
      team.stats = {};
    }

    this.ensureStats(team);

    const formationSlots =
      FORMATIONS[
        team.formation
      ] ||
      FORMATIONS["4-4-2"];

    const lineupIds =
      Array.isArray(team.lineupIds)
        ? team.lineupIds.map(String)
        : [];

    let activePlayers = [];

    if (lineupIds.length > 0) {
      activePlayers =
        lineupIds
          .map((id) =>
            team.players.find(
              (p) =>
                String(p.id) === id
            )
          )
          .filter(Boolean);
    }

    if (activePlayers.length < 11) {
      for (const player of team.players) {
        if (
          activePlayers.includes(player)
        ) {
          continue;
        }

        if (activePlayers.length >= 11) {
          break;
        }

        activePlayers.push(player);
      }
    }

    team.activePlayers =
      activePlayers.slice(0, 11);

    team.bench =
      team.players.filter(
        (p) =>
          !team.activePlayers.includes(p)
      );

    team.players.forEach(
      (player, index) => {
        this.normalizePlayer(
          player,
          team,
          index
        );
      }
    );

    team.activePlayers.forEach(
      (player, index) => {
        const slot =
          formationSlots[index] ||
          formationSlots[
            formationSlots.length - 1
          ];

        player.role =
          player.role ||
          player.position ||
          slot.role;

        player.baseX =
          slot.x;

        player.baseY =
          slot.y;

        player.homeX =
          slot.x;

        player.homeY =
          slot.y;

        player.formationSlot =
          index;

        player.targetX =
          slot.x * FIELD_WIDTH;

        player.targetY =
          slot.y * FIELD_HEIGHT;
      }
    );
  }

  normalizePlayer(
    player,
    team,
    index
  ) {
    player.id =
      player.id ??
      player.playerId ??
      `${team.side}-player-${index}`;

    player.side = team.side;

    player.name =
      player.name ||
      player.fullName ||
      player.displayName ||
      `Player ${index + 1}`;

    /*
      IMPORTANT:
      Never replace the player's real shirt number
      with array index.
    */
    player.number =
      player.number ??
      player.shirtNumber ??
      player.jerseyNumber ??
      player.kitNumber ??
      player.squadNumber ??
      "";

    player.position =
      player.position ||
      player.role ||
      "CM";

    player.role =
      player.role ||
      player.position;

    player.overall =
      num(
        player.overall ??
          player.rating ??
          player.ovr ??
          player.overallRating,
        60
      );

    const attributes =
      player.attributes ||
      {};

    player.passing =
      num(
        player.passing ??
          attributes.passing ??
          attributes.pass,
        player.overall
      );

    player.shooting =
      num(
        player.shooting ??
          attributes.shooting ??
          attributes.shoot,
        player.overall
      );

    player.dribbling =
      num(
        player.dribbling ??
          attributes.dribbling ??
          attributes.dribble,
        player.overall
      );

    player.tackling =
      num(
        player.tackling ??
          attributes.tackling ??
          attributes.tackle,
        player.overall
      );

    player.positioning =
      num(
        player.positioning ??
          attributes.positioning,
        player.overall
      );

    player.vision =
      num(
        player.vision ??
          attributes.vision,
        player.overall
      );

    player.decisionMaking =
      num(
        player.decisionMaking ??
          attributes.decision ??
          attributes.decisions,
        player.overall
      );

    player.composure =
      num(
        player.composure ??
          attributes.composure,
        player.overall
      );

    player.reaction =
      num(
        player.reaction ??
          attributes.reaction,
        player.overall
      );

    player.diving =
      num(
        player.diving ??
          attributes.diving,
        player.overall
      );

    player.handling =
      num(
        player.handling ??
          attributes.handling,
        player.overall
      );

    player.catching =
      num(
        player.catching ??
          attributes.catching,
        player.overall
      );

    player.parrying =
      num(
        player.parrying ??
          attributes.parrying,
        player.overall
      );

    player.distribution =
      num(
        player.distribution ??
          attributes.distribution,
        player.overall
      );

    player.speed =
      num(
        player.speed ??
          attributes.speed ??
          attributes.pace,
        65
      );

    player.acceleration =
      num(
        player.acceleration ??
          attributes.acceleration,
        player.speed
      );

    player.stamina =
      clamp(
        num(
          player.stamina,
          100
        ),
        0,
        100
      );

    player.maxStamina =
      num(
        player.maxStamina,
        100
      );

    player.yellowCards =
      num(
        player.yellowCards ??
          player.yellow,
        0
      );

    player.redCard =
      bool(
        player.redCard,
        false
      );

    player.hasBall =
      bool(
        player.hasBall,
        false
      );

    player.vx =
      num(player.vx, 0);

    player.vy =
      num(player.vy, 0);

    player.x =
      num(
        player.x,
        player.homeX
          ? player.homeX *
            FIELD_WIDTH
          : CENTER_X
      );

    player.y =
      num(
        player.y,
        player.homeY
          ? player.homeY *
            FIELD_HEIGHT
          : CENTER_Y
      );

    player.targetX =
      num(
        player.targetX,
        player.x
      );

    player.targetY =
      num(
        player.targetY,
        player.y
      );

    player.lastActionAt =
      num(
        player.lastActionAt,
        5
      );

    player.decisionCooldown =
      num(
        player.decisionCooldown,
        randomBetween(
          0.2,
          0.8
        )
      );

    player.markId =
      player.markId ??
      null;

    player.state =
      player.state ||
      "moving";

    player.stats =
      player.stats || {};

    this.ensurePlayerStats(
      player
    );
  }

  ensureStats(team) {
    const defaults = {
      possessionSeconds: 0,
      possession: 0,

      passesAttempted: 0,
      passesCompleted: 0,

      shots: 0,
      shotsOnTarget: 0,

      goals: 0,
      assists: 0,

      tackles: 0,
      fouls: 0,

      corners: 0,
      offsides: 0,

      yellow: 0,
      red: 0,

      saves: 0,
      xG: 0,

      dribbles: 0,
      interceptions: 0,
      crosses: 0,
    };

    for (const [
      key,
      value,
    ] of Object.entries(defaults)) {
      if (
        typeof team.stats[key] !==
        "number"
      ) {
        team.stats[key] = value;
      }
    }
  }

  ensurePlayerStats(player) {
    const defaults = {
      passesAttempted: 0,
      passesCompleted: 0,
      shots: 0,
      shotsOnTarget: 0,
      goals: 0,
      assists: 0,
      tackles: 0,
      fouls: 0,
      yellow: 0,
      red: 0,
      saves: 0,
      xG: 0,
      dribbles: 0,
      interceptions: 0,
      crosses: 0,
    };

    for (const [
      key,
      value,
    ] of Object.entries(defaults)) {
      if (
        typeof player.stats[key] !==
        "number"
      ) {
        player.stats[key] = value;
      }
    }

    /*
      Compatibility with existing code
      that reads player.goals directly.
    */
    player.goals =
      num(
        player.goals,
        player.stats.goals
      );

    player.assists =
      num(
        player.assists,
        player.stats.assists
      );

    player.interceptions =
      num(
        player.interceptions,
        player.stats.interceptions
      );
  }

  /* =======================================================
     BASIC ACCESS
  ======================================================= */

  getTeams() {
    return [
      this.home,
      this.away,
    ];
  }

  getTeam(side) {
    return side === "away"
      ? this.away
      : this.home;
  }

  getOpponent(side) {
    return side === "away"
      ? this.home
      : this.away;
  }

  getPlayer(id) {
    if (!id) {
      return null;
    }

    const sid = String(id);

    return (
      this.home.players.find(
        (p) =>
          String(p.id) === sid
      ) ||
      this.away.players.find(
        (p) =>
          String(p.id) === sid
      ) ||
      null
    );
  }

  getActivePlayers(team) {
    if (
      Array.isArray(team.activePlayers) &&
      team.activePlayers.length
    ) {
      return team.activePlayers.filter(
        (p) => !p.redCard
      );
    }

    return team.players.filter(
      (p) => !p.redCard
    );
  }

  /* =======================================================
     RESET / KICKOFF
  ======================================================= */

  resetPositions() {
    for (const team of this.getTeams()) {
      const formationSlots =
        FORMATIONS[
          team.formation
        ] ||
        FORMATIONS["4-4-2"];

      const active =
        team.activePlayers ||
        team.players.slice(0, 11);

      active.forEach(
        (player, index) => {
          const slot =
            formationSlots[index] ||
            formationSlots[
              formationSlots.length - 1
            ];

          player.baseX =
            slot.x;

          player.baseY =
            slot.y;

          player.homeX =
            slot.x;

          player.homeY =
            slot.y;

          const x =
            team.attackDirection === 1
              ? slot.x
              : 1 - slot.x;

          player.x =
            x * FIELD_WIDTH;

          player.y =
            slot.y * FIELD_HEIGHT;

          player.targetX =
            player.x;

          player.targetY =
            player.y;

          player.vx = 0;
          player.vy = 0;

          player.hasBall = false;
          player.state = "moving";

          player.decisionCooldown =
            randomBetween(
              0.1,
              1.2
            );

          player.lastActionAt =
            5;
        }
      );
    }

    this.ball.x = CENTER_X;
    this.ball.y = CENTER_Y;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.ball.ownerId = null;

    this.ball.state =
      BALL_STATE.FREE;

    this.ball.lastTouchTeam =
      null;

    this.ball.lastTouchPlayerId =
      null;
  }

  start() {
    if (
      this.status ===
      "finished"
    ) {
      return;
    }

    if (
      this.status ===
      "live"
    ) {
      return;
    }

    this.status = "live";

    if (!this.kickoffTaken) {
      this.kickoffTaken = true;

      const player =
        this.findKickoffPlayer(
          this.home
        );

      this.addEvent({
        type:
          EVENTS.KICKOFF ||
          "kickoff",
        team: "home",
        player,
        text:
          "Kick-off. The match begins.",
      });

      this.kickoff();
    }
  }

  findKickoffPlayer(team) {
    const active =
      this.getActivePlayers(team);

    return (
      active.find(
        (p) =>
          ["ST", "CF", "CAM", "CM"]
            .includes(p.role)
      ) ||
      active.find(
        (p) =>
          !isGoalkeeper(p)
      ) ||
      active[0] ||
      null
    );
  }

  kickoff(team = this.home) {
    const player =
      this.findKickoffPlayer(team);

    if (!player) {
      return;
    }

    for (const t of this.getTeams()) {
      for (const p of t.players) {
        p.hasBall = false;
      }
    }

    player.x =
      team.side === "home"
        ? CENTER_X - 18
        : CENTER_X + 18;

    player.y = CENTER_Y;

    player.vx = 0;
    player.vy = 0;

    setBallOwner(
      this.ball,
      player
    );

    this.lastTouchTeam =
      team.side;

    this.lastTouchPlayerId =
      player.id;

    this.lastPossessionTeam =
      team.side;

    this.lastPossessionPlayerId =
      player.id;

    this.ball.state =
      BALL_STATE.POSSESSED;
  }

  /* =======================================================
     MAIN UPDATE LOOP
  ======================================================= */

  update(dt) {
    if (
      this.status !== "live"
    ) {
      return;
    }

    const safeDt = clamp(
      num(dt, 0),
      0,
      0.05
    );

    if (safeDt <= 0) {
      return;
    }

    if (this.goalCooldown > 0) {
      this.goalCooldown -= safeDt;
    }

    /*
      240 real seconds = 90 match minutes.
      This avoids relying on an incorrectly configured
      SIM_MINUTES_PER_REAL_SECOND constant.
    */
    const simSecondsPerRealSecond =
      (90 * 60) /
      this.durationSeconds;

    this.realSeconds += safeDt;

    this.simSeconds +=
      safeDt *
      simSecondsPerRealSecond;

    this.minute = clamp(
      Math.floor(
        this.simSeconds / 60
      ),
      0,
      90
    );

    this.second =
      Math.floor(
        this.simSeconds % 60
      );

    this.tickPlayerTimers(
      safeDt
    );

    /*
      FIRST:
      determine tactical targets.
    */
    this.tacticalTimer += safeDt;

    if (
      this.tacticalTimer >= 0.12
    ) {
      this.tacticalTimer = 0;

      this.updateTacticalTargets(
        this.home,
        this.away
      );

      this.updateTacticalTargets(
        this.away,
        this.home
      );
    }

    /*
      SECOND:
      continuous player movement.
      This happens EVERY FRAME.
    */
    this.updateAllPlayerMovement(
      safeDt
    );

    /*
      Ball owner follows the player.
    */
    this.updateBallOwner(
      safeDt
    );

    /*
      Free / passing / shooting ball.
    */
    this.updateBallPhysics(
      safeDt
    );

    /*
      AI decisions.
    */
    this.decisionTimer += safeDt;

    if (
      this.decisionTimer >= 0.12
    ) {
      this.decisionTimer = 0;

      this.updateTeamDecisions(
        this.home,
        this.away
      );

      this.updateTeamDecisions(
        this.away,
        this.home
      );
    }

    /*
      Tackles.
    */
    this.handleTackles(
      safeDt
    );

    /*
      Possession.
    */
    this.updatePossessionStats(
      safeDt
    );

    /*
      Stamina.
    */
    this.updateStamina(
      safeDt
    );

    /*
      Team minutes.
    */
    updateTeamMinutes(
      this.home,
      safeDt
    );

    updateTeamMinutes(
      this.away,
      safeDt
    );

    /*
      AI substitutions.
    */
    this.substitutionTimer += safeDt;

    if (
      this.substitutionTimer >= 7
    ) {
      this.substitutionTimer = 0;

      /*
        Never allow AI to change the user's
        managed team.
      */
      if (
        this.managedTeam !== "home"
      ) {
        aiSubstitute(
          this,
          this.home
        );
      }

      if (
        this.managedTeam !== "away"
      ) {
        aiSubstitute(
          this,
          this.away
        );
      }
    }

    this.handleHalfTime();
    this.handleFullTime();
  }

  /* =======================================================
     TIMERS
  ======================================================= */

  tickPlayerTimers(dt) {
    for (const team of this.getTeams()) {
      for (const player of team.players) {
        player.lastActionAt =
          num(
            player.lastActionAt,
            0
          ) + dt;

        player.decisionCooldown =
          Math.max(
            0,
            num(
              player.decisionCooldown,
              0
            ) - dt
          );
      }
    }
  }

  /* =======================================================
     TACTICAL TARGET SYSTEM
  ======================================================= */

  updateTacticalTargets(
    team,
    opponent
  ) {
    const active =
      this.getActivePlayers(team);

    if (!active.length) {
      return;
    }

    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    const teamHasBall =
      owner?.side === team.side;

    const opponentHasBall =
      owner?.side ===
      opponent.side;

    const ballX =
      num(
        this.ball.x,
        CENTER_X
      );

    const ballY =
      num(
        this.ball.y,
        CENTER_Y
      );

    /*
      Shape movement follows ball position.
      This is the important part that prevents
      players from freezing at formation coordinates.
    */
    const ballProgress =
      progressForTeam(
        team,
        ballX
      );

    const tactics =
      normalizeTactics(
        team.tactics
      );

    const width =
      this.getWidthValue(
        tactics.width
      );

    const defensiveLine =
      this.getDefensiveLineValue(
        tactics.defensiveLine
      );

    const mentality =
      this.getMentalityValue(
        tactics.mentality
      );

    const pressing =
      this.getPressingValue(
        tactics.pressing
      );

    const carrier =
      teamHasBall
        ? owner
        : null;

    const pressingPlayers =
      opponentHasBall
        ? this.getPressingPlayers(
            team,
            opponent,
            pressing
          )
        : [];

    for (const player of active) {
      let target =
        this.getBaseTarget(
          team,
          player
        );

      /*
        Goalkeeper.
      */
      if (
        isGoalkeeper(player)
      ) {
        target =
          this.getGoalkeeperTarget(
            team,
            player,
            ballX,
            ballY,
            opponentHasBall
          );
      }

      /*
        Defensive players.
      */
      else if (
        isDefender(player)
      ) {
        target =
          this.getDefenderTarget(
            team,
            opponent,
            player,
            ballX,
            ballY,
            teamHasBall,
            opponentHasBall,
            defensiveLine,
            mentality,
            width
          );
      }

      /*
        Midfielders.
      */
      else if (
        isMidfielder(player)
      ) {
        target =
          this.getMidfielderTarget(
            team,
            opponent,
            player,
            ballX,
            ballY,
            teamHasBall,
            opponentHasBall,
            width,
            mentality
          );
      }

      /*
        Attackers.
      */
      else if (
        isAttacker(player)
      ) {
        target =
          this.getAttackerTarget(
            team,
            opponent,
            player,
            ballX,
            ballY,
            teamHasBall,
            opponentHasBall,
            mentality,
            width
          );
      }

      /*
        Pressing overrides normal position
        for the nearest pressing players.
      */
      if (
        pressingPlayers.includes(
          player
        ) &&
        opponentHasBall &&
        owner
      ) {
        const pressTarget =
          this.getPressTarget(
            team,
            player,
            owner
          );

        target = {
          x:
            lerp(
              target.x,
              pressTarget.x,
              0.82
            ),
          y:
            lerp(
              target.y,
              pressTarget.y,
              0.82
            ),
        };

        player.state =
          "pressing";
      }

      /*
        If team has possession and this is
        an off-ball attacker, create forward runs.
      */
      if (
        teamHasBall &&
        carrier &&
        player.id !==
          carrier.id &&
        (isAttacker(player) ||
          isMidfielder(player))
      ) {
        target =
          this.addAttackingMovement(
            team,
            opponent,
            player,
            target,
            carrier
          );
      }

      /*
        If opponent has ball, dangerous
        attackers are marked.
      */
      if (
        opponentHasBall &&
        isDefender(player)
      ) {
        target =
          this.addDefensiveMarking(
            team,
            opponent,
            player,
            target,
            owner
          );
      }

      target =
        normalizePoint(
          target.x,
          target.y
        );

      player.targetX =
        target.x;

      player.targetY =
        target.y;
    }
  }

  getBaseTarget(
    team,
    player
  ) {
    const baseX =
      player.baseX ??
      player.homeX ??
      0.5;

    const baseY =
      player.baseY ??
      player.homeY ??
      0.5;

    /*
      Mirror the formation for away.
    */
    let x =
      team.attackDirection === 1
        ? baseX * FIELD_WIDTH
        : (1 - baseX) *
          FIELD_WIDTH;

    let y =
      baseY * FIELD_HEIGHT;

    /*
      Ball influence.
      Players shift continuously according to
      where the ball is.
    */
    const ballX =
      this.ball.x;

    const ballY =
      this.ball.y;

    const ballInfluenceX =
      clamp(
        (ballX - CENTER_X) *
          0.18,
        -95,
        95
      );

    const teamInfluence =
      team.attackDirection === 1
        ? ballInfluenceX
        : -ballInfluenceX;

    x += teamInfluence;

    const verticalInfluence =
      clamp(
        (ballY - CENTER_Y) *
          0.20,
        -80,
        80
      );

    y +=
      verticalInfluence *
      (isWide(player)
        ? 0.75
        : 0.35);

    return {
      x,
      y,
    };
  }

  getGoalkeeperTarget(
    team,
    player,
    ballX,
    ballY,
    opponentHasBall
  ) {
    const ownGoalX =
      team.attackDirection === 1
        ? 32
        : FIELD_WIDTH - 32;

    const distanceFromGoal =
      team.attackDirection === 1
        ? ballX
        : FIELD_WIDTH - ballX;

    const follow =
      clamp(
        distanceFromGoal * 0.04,
        0,
        32
      );

    let x =
      ownGoalX +
      team.attackDirection *
        follow;

    if (
      opponentHasBall
    ) {
      x +=
        team.attackDirection *
        clamp(
          (FIELD_WIDTH / 2 -
            distanceFromGoal) *
            0.03,
          0,
          20
        );
    }

    const y =
      lerp(
        CENTER_Y,
        ballY,
        0.25
      );

    return {
      x,
      y,
    };
  }

  getDefenderTarget(
    team,
    opponent,
    player,
    ballX,
    ballY,
    teamHasBall,
    opponentHasBall,
    defensiveLine,
    mentality,
    width
  ) {
    let target =
      this.getBaseTarget(
        team,
        player
      );

    /*
      Defensive line moves toward the ball,
      but remains behind midfield.
    */
    const ballProgress =
      progressForTeam(
        team,
        ballX
      );

    let lineShift =
      (ballProgress - 0.35) *
      defensiveLine *
      150;

    if (
      teamHasBall
    ) {
      lineShift +=
        mentality * 18;
    }

    target.x +=
      team.attackDirection *
      lineShift;

    /*
      Wide defenders maintain width.
    */
    if (
      isWide(player)
    ) {
      target.y =
        lerp(
          target.y,
          ballY,
          0.18
        );

      const side =
        player.baseY < 0.5
          ? -1
          : 1;

      target.y +=
        side *
        width *
        25;
    }

    /*
      When defending, defenders move
      closer to dangerous attackers.
    */
    if (
      opponentHasBall
    ) {
      const threat =
        this.findDangerousOpponent(
          team,
          opponent
        );

      if (
        threat &&
        !isWide(player)
      ) {
        const markDistance =
          player.role === "CB"
            ? 22
            : 30;

        const markX =
          threat.x -
          team.attackDirection *
          markDistance;

        target.x =
          lerp(
            target.x,
            markX,
            0.42
          );

        target.y =
          lerp(
            target.y,
            threat.y,
            0.35
          );
      }
    }

    return target;
  }

  getMidfielderTarget(
    team,
    opponent,
    player,
    ballX,
    ballY,
    teamHasBall,
    opponentHasBall,
    width,
    mentality
  ) {
    let target =
      this.getBaseTarget(
        team,
        player
      );

    /*
      Midfield follows the ball strongly.
    */
    target.x =
      lerp(
        target.x,
        ballX +
          team.attackDirection *
            20,
        0.35
      );

    target.y =
      lerp(
        target.y,
        ballY,
        isWide(player)
          ? 0.42
          : 0.28
      );

    /*
      Attacking mentality pushes midfield
      higher up the field.
    */
    if (
      teamHasBall
    ) {
      target.x +=
        team.attackDirection *
        mentality *
        42;
    }

    /*
      Defensive phase pulls midfielders back.
    */
    if (
      opponentHasBall
    ) {
      target.x -=
        team.attackDirection *
        25;

      const threat =
        this.findDangerousOpponent(
          team,
          opponent
        );

      if (
        threat &&
        player.role !== "CAM"
      ) {
        target.y =
          lerp(
            target.y,
            threat.y,
            0.16
          );
      }
    }

    /*
      Keep midfielders spread.
    */
    if (
      isWide(player)
    ) {
      const side =
        player.baseY < 0.5
          ? -1
          : 1;

      target.y +=
        side *
        width *
        28;
    }

    return target;
  }

  getAttackerTarget(
    team,
    opponent,
    player,
    ballX,
    ballY,
    teamHasBall,
    opponentHasBall,
    mentality,
    width
  ) {
    let target =
      this.getBaseTarget(
        team,
        player
      );

    if (
      teamHasBall
    ) {
      /*
        Attackers stay ahead of the ball
        and make runs into space.
      */
      const forward =
        team.attackDirection *
        randomBetween(
          55,
          125
        );

      target.x =
        ballX + forward;

      if (
        isWide(player)
      ) {
        const side =
          player.baseY < 0.5
            ? -1
            : 1;

        target.y =
          ballY +
          side *
          randomBetween(
            70,
            145
          ) *
          (0.8 + width);
      } else {
        target.y =
          lerp(
            target.y,
            ballY,
            0.30
          );
      }

      target.x +=
        team.attackDirection *
        mentality *
        35;
    }

    if (
      opponentHasBall
    ) {
      /*
        Attackers also participate in
        first-line pressing.
      */
      target.x =
        lerp(
          target.x,
          ballX +
            team.attackDirection *
              45,
          0.28
        );

      target.y =
        lerp(
          target.y,
          ballY,
          0.18
        );
    }

    /*
      Prevent attackers from running beyond
      the playable field.
    */
    target.x =
      clamp(
        target.x,
        120,
        FIELD_WIDTH - 70
      );

    return target;
  }

  addAttackingMovement(
    team,
    opponent,
    player,
    target,
    carrier
  ) {
    const forward =
      team.attackDirection;

    const carrierX =
      carrier.x;

    const playerForward =
      forwardDistance(
        team,
        carrierX,
        player.x
      );

    /*
      If player is too close to carrier,
      make a diagonal supporting run.
    */
    if (
      Math.abs(
        playerForward
      ) < 55
    ) {
      target.x +=
        forward *
        randomBetween(
          30,
          70
        );
    }

    /*
      Create vertical separation.
    */
    const verticalDirection =
      player.y < CENTER_Y
        ? -1
        : 1;

    target.y +=
      verticalDirection *
      randomBetween(
        15,
        50
      );

    return target;
  }

  addDefensiveMarking(
    team,
    opponent,
    player,
    target,
    carrier
  ) {
    const threat =
      this.findDangerousOpponent(
        team,
        opponent
      );

    if (
      !threat ||
      threat.id ===
        carrier?.id
    ) {
      return target;
    }

    /*
      Don't follow attackers all over the planet.
      Maintain a defensive relationship.
    */
    const markX =
      threat.x -
      team.attackDirection *
      20;

    const markY =
      threat.y;

    const markDistance =
      Math.hypot(
        markX - target.x,
        markY - target.y
      );

    if (
      markDistance < 150
    ) {
      target.x =
        lerp(
          target.x,
          markX,
          0.40
        );

      target.y =
        lerp(
          target.y,
          markY,
          0.30
        );

      player.markId =
        threat.id;
    }

    return target;
  }

  getPressingPlayers(
    team,
    opponent,
    pressing
  ) {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (
      !owner ||
      owner.side === team.side
    ) {
      return [];
    }

    const maxPressers =
      pressing >= 0.8
        ? 3
        : pressing >= 0.5
        ? 2
        : 1;

    return this.getActivePlayers(team)
      .filter(
        (p) =>
          !isGoalkeeper(p)
      )
      .sort(
        (a, b) =>
          distance(a, owner) -
          distance(b, owner)
      )
      .slice(
        0,
        maxPressers
      );
  }

  getPressTarget(
    team,
    player,
    carrier
  ) {
    const dx =
      carrier.x -
      player.x;

    const dy =
      carrier.y -
      player.y;

    const len =
      Math.hypot(dx, dy) ||
      1;

    /*
      Approach slightly from the side,
      rather than all defenders piling directly
      onto the carrier.
    */
    const sideOffset =
      player.y < carrier.y
        ? -12
        : 12;

    return {
      x:
        carrier.x -
        (dx / len) *
          14,

      y:
        carrier.y -
        (dy / len) *
          14 +
        sideOffset,
    };
  }

  getWidthValue(width) {
    switch (
      String(width || "")
        .toLowerCase()
    ) {
      case "narrow":
        return -1;

      case "wide":
        return 1;

      case "verywide":
      case "very-wide":
        return 1.5;

      default:
        return 0;
    }
  }

  getDefensiveLineValue(
    value
  ) {
    switch (
      String(value || "")
        .toLowerCase()
    ) {
      case "low":
        return -0.7;

      case "high":
        return 0.8;

      case "veryhigh":
      case "very-high":
        return 1.2;

      default:
        return 0;
    }
  }

  getPressingValue(
    value
  ) {
    switch (
      String(value || "")
        .toLowerCase()
    ) {
      case "low":
        return 0.25;

      case "high":
        return 0.85;

      case "veryhigh":
      case "very-high":
        return 1;

      default:
        return 0.55;
    }
  }

  getMentalityValue(
    value
  ) {
    switch (
      String(value || "")
        .toLowerCase()
    ) {
      case "defensive":
        return -1;

      case "verydefensive":
      case "very-defensive":
        return -1.5;

      case "attacking":
        return 1;

      case "veryattacking":
      case "very-attacking":
        return 1.5;

      default:
        return 0;
    }
  }

  findDangerousOpponent(
    team,
    opponent
  ) {
    const candidates =
      this.getActivePlayers(
        opponent
      ).filter(
        (p) =>
          !isGoalkeeper(p)
      );

    if (!candidates.length) {
      return null;
    }

    return candidates.sort(
      (a, b) => {
        const aScore =
          progressForTeam(
            team,
            a.x
          ) *
            100 -
          distance(
            a,
            this.ball
          ) *
            0.08;

        const bScore =
          progressForTeam(
            team,
            b.x
          ) *
            100 -
          distance(
            b,
            this.ball
          ) *
            0.08;

        return bScore - aScore;
      }
    )[0];
  }

  /* =======================================================
     CONTINUOUS MOVEMENT
  ======================================================= */

  updateAllPlayerMovement(
    dt
  ) {
    for (const team of this.getTeams()) {
      const opponent =
        this.getOpponent(
          team.side
        );

      for (const player of team.players) {
        if (
          player.redCard
        ) {
          continue;
        }

        this.movePlayer(
          player,
          team,
          opponent,
          dt
        );
      }
    }
  }

  movePlayer(
    player,
    team,
    opponent,
    dt
  ) {
    if (
      player.state ===
      "substituting"
    ) {
      return;
    }

    /*
      Player speed changes with stamina.
    */
    const staminaFactor =
      clamp(
        player.stamina / 100,
        0.45,
        1
      );

    const roleFactor =
      isGoalkeeper(player)
        ? 0.75
        : 1;

    const baseSpeed =
      42 +
      num(
        player.speed,
        65
      ) *
        0.62;

    const maxSpeed =
      baseSpeed *
      staminaFactor *
      roleFactor;

    const acceleration =
      160 +
      num(
        player.acceleration,
        65
      ) *
        1.4;

    /*
      If player has ball, movement target
      comes from dribbling logic.
    */
    let targetX =
      player.targetX;

    let targetY =
      player.targetY;

    if (
      player.hasBall
    ) {
      const dribbleTarget =
        this.getDribbleTarget(
          team,
          opponent,
          player
        );

      targetX =
        dribbleTarget.x;

      targetY =
        dribbleTarget.y;

      player.state =
        "dribbling";
    }

    /*
      Direction.
    */
    const dx =
      targetX -
      player.x;

    const dy =
      targetY -
      player.y;

    const dist =
      Math.hypot(
        dx,
        dy
      );

    let desiredVx = 0;
    let desiredVy = 0;

    /*
      IMPORTANT:
      Never use "if distance < X then stop".
      Instead slow down gradually while continuously
      adjusting to the next tactical target.
    */
    if (
      dist > 1
    ) {
      const nx =
        dx / dist;

      const ny =
        dy / dist;

      const speedMultiplier =
        dist < 25
          ? clamp(
              dist / 25,
              0.25,
              1
            )
          : 1;

      desiredVx =
        nx *
        maxSpeed *
        speedMultiplier;

      desiredVy =
        ny *
        maxSpeed *
        speedMultiplier;
    }

    /*
      Pressing / attacking run = sprint.
    */
    if (
      player.state ===
        "pressing" ||
      player.state ===
        "dribbling"
    ) {
      desiredVx *= 1.12;
      desiredVy *= 1.12;
    }

    /*
      Smooth acceleration.
    */
    const velocityChange =
      acceleration * dt;

    player.vx =
      this.approach(
        player.vx,
        desiredVx,
        velocityChange
      );

    player.vy =
      this.approach(
        player.vy,
        desiredVy,
        velocityChange
      );

    /*
      Limit speed.
    */
    const currentSpeed =
      Math.hypot(
        player.vx,
        player.vy
      );

    if (
      currentSpeed >
      maxSpeed
    ) {
      const factor =
        maxSpeed /
        currentSpeed;

      player.vx *= factor;
      player.vy *= factor;
    }

    player.x +=
      player.vx * dt;

    player.y +=
      player.vy * dt;

    /*
      Keep players inside the pitch.
    */
    player.x =
      clamp(
        player.x,
        8,
        FIELD_WIDTH - 8
      );

    player.y =
      clamp(
        player.y,
        8,
        FIELD_HEIGHT - 8
      );

    /*
      Small autonomous movement if target
      becomes too close. This prevents players
      from appearing completely frozen.
    */
    if (
      dist < 10 &&
      !player.hasBall
    ) {
      this.addMicroMovement(
        player,
        team
      );
    }
  }

  approach(
    current,
    target,
    amount
  ) {
    if (
      current < target
    ) {
      return Math.min(
        current + amount,
        target
      );
    }

    return Math.max(
      current - amount,
      target
    );
  }

  addMicroMovement(
    player,
    team
  ) {
    const angle =
      Math.atan2(
        player.y -
          CENTER_Y,
        player.x -
          CENTER_X
      ) +
      randomBetween(
        -0.8,
        0.8
      );

    const radius =
      randomBetween(
        12,
        32
      );

    player.targetX =
      clamp(
        player.x +
          Math.cos(angle) *
            radius,
        10,
        FIELD_WIDTH - 10
      );

    player.targetY =
      clamp(
        player.y +
          Math.sin(angle) *
            radius,
        10,
        FIELD_HEIGHT - 10
      );
  }

  getDribbleTarget(
    team,
    opponent,
    player
  ) {
    const goalX =
      team.attackDirection === 1
        ? FIELD_WIDTH - 25
        : 25;

    let targetX =
      player.x +
      team.attackDirection *
      80;

    let targetY =
      player.y;

    /*
      Move away from nearest defender.
    */
    const nearest =
      nearestPlayer(
        this.getActivePlayers(
          opponent
        ),
        player
      );

    if (nearest) {
      const d =
        distance(
          player,
          nearest
        );

      if (d < 100) {
        const awayX =
          player.x -
          nearest.x;

        const awayY =
          player.y -
          nearest.y;

        const len =
          Math.hypot(
            awayX,
            awayY
          ) || 1;

        targetX +=
          (awayX / len) *
          55;

        targetY +=
          (awayY / len) *
          55;
      }
    }

    /*
      Attack the goal when space exists.
    */
    if (
      nearest &&
      distance(
        player,
        nearest
      ) > 75
    ) {
      targetX =
        lerp(
          targetX,
          goalX,
          0.25
        );
    }

    targetY +=
      randomBetween(
        -12,
        12
      );

    return normalizePoint(
      targetX,
      targetY
    );
  }

  /* =======================================================
     BALL OWNER
  ======================================================= */

  updateBallOwner() {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (!owner) {
      return;
    }

    if (
      owner.redCard
    ) {
      owner.hasBall = false;

      this.ball.ownerId = null;

      this.ball.state =
        BALL_STATE.FREE;

      return;
    }

    owner.hasBall = true;

    moveBallWithOwner(
      this.ball,
      owner
    );

    this.lastTouchTeam =
      owner.side;

    this.lastTouchPlayerId =
      owner.id;

    this.lastPossessionTeam =
      owner.side;

    this.lastPossessionPlayerId =
      owner.id;

    /*
      Only one player may have the ball.
    */
    for (const team of this.getTeams()) {
      for (const player of team.players) {
        if (
          player.id !==
          owner.id
        ) {
          player.hasBall = false;
        }
      }
    }
  }

  /* =======================================================
     DECISION SYSTEM
  ======================================================= */

  updateTeamDecisions(
    team,
    opponent
  ) {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    /*
      Only the team with possession makes
      ball decisions.
    */
    if (
      !owner ||
      owner.side !==
        team.side
    ) {
      return;
    }

    if (
      owner.redCard ||
      !owner.hasBall
    ) {
      return;
    }

    if (
      owner.decisionCooldown >
      0
    ) {
      return;
    }

    const now =
      this.realSeconds;

    const last =
      num(
        this.lastDecisionByPlayer[
          owner.id
        ],
        -999
      );

    /*
      Prevent decision spam.
    */
    if (
      now - last <
      0.65
    ) {
      return;
    }

    this.lastDecisionByPlayer[
      owner.id
    ] = now;

    const result =
      this.decideWithBall(
        team,
        opponent,
        owner
      );

    /*
      Every failed action gets a fallback.
      This is important. No "do nothing".
    */
    if (
      result === "none"
    ) {
      this.forceDribble(
        team,
        opponent,
        owner
      );
    }

    owner.decisionCooldown =
      randomBetween(
        0.35,
        0.9
      );
  }

  decideWithBall(
    team,
    opponent,
    player
  ) {
    const goalDistance =
      this.getGoalDistance(
        team,
        player
      );

    const pressure =
      this.getPressure(
        opponent,
        player
      );

    const angle =
      this.getGoalAngle(
        team,
        player
      );

    /*
      Very close to goal:
      shoot frequently, but not blindly.
    */
    if (
      goalDistance < 260 &&
      angle > 0.35
    ) {
      const shotChance =
        this.getShotDecisionChance(
          player,
          goalDistance,
          pressure
        );

      if (
        Math.random() <
        shotChance
      ) {
        const success =
          this.performShot(
            team,
            opponent,
            player
          );

        if (success) {
          return "shot";
        }
      }
    }

    /*
      Wide advanced player:
      cross or pass.
    */
    if (
      isWide(player) &&
      progressForTeam(
        team,
        player.x
      ) > 0.68
    ) {
      if (
        Math.random() <
        0.55
      ) {
        const crossed =
          this.performCross(
            team,
            opponent,
            player
          );

        if (crossed) {
          return "cross";
        }
      }
    }

    /*
      Pass when a good teammate exists.
    */
    const passTarget =
      this.findBestPassTarget(
        team,
        opponent,
        player
      );

    if (
      passTarget
    ) {
      const passChance =
        this.getPassDecisionChance(
          player,
          passTarget,
          pressure,
          team
        );

      if (
        Math.random() <
        passChance
      ) {
        const success =
          this.performPass(
            team,
            opponent,
            player,
            passTarget
          );

        if (success) {
          return "pass";
        }
      }
    }

    /*
      If no pass or shot, dribble.
    */
    this.forceDribble(
      team,
      opponent,
      player
    );

    return "dribble";
  }

  getShotDecisionChance(
    player,
    goalDistance,
    pressure
  ) {
    const shooting =
      clamp(
        num(
          player.shooting,
          60
        ) / 100,
        0,
        1
      );

    const composure =
      clamp(
        num(
          player.composure,
          60
        ) / 100,
        0,
        1
      );

    const distanceFactor =
      clamp(
        1 -
          goalDistance /
            420,
        0.15,
        1
      );

    const pressureFactor =
      clamp(
        1 -
          pressure /
            130,
        0.2,
        1
      );

    return clamp(
      0.20 +
        shooting *
          0.28 +
        composure *
          0.16 +
        distanceFactor *
          0.35 +
        pressureFactor *
          0.18,
      0.15,
      0.92
    );
  }

  getPassDecisionChance(
    player,
    target,
    pressure,
    team
  ) {
    const passing =
      clamp(
        num(
          player.passing,
          60
        ) / 100,
        0,
        1
      );

    const vision =
      clamp(
        num(
          player.vision,
          60
        ) / 100,
        0,
        1
      );

    const targetQuality =
      this.getPassTargetQuality(
        team,
        player,
        target
      );

    const pressureFactor =
      clamp(
        1 -
          pressure /
            140,
        0.25,
        1
      );

    return clamp(
      0.34 +
        passing *
          0.25 +
        vision *
          0.20 +
        targetQuality *
          0.25 +
        pressureFactor *
          0.15,
      0.30,
      0.95
    );
  }

  getGoalDistance(
    team,
    player
  ) {
    const goalX =
      team.attackDirection === 1
        ? FIELD_WIDTH
        : 0;

    return Math.hypot(
      goalX - player.x,
      CENTER_Y -
        player.y
    );
  }

  getGoalAngle(
    team,
    player
  ) {
    const goalX =
      team.attackDirection === 1
        ? FIELD_WIDTH
        : 0;

    const dx =
      Math.abs(
        goalX -
          player.x
      );

    const dy =
      Math.abs(
        CENTER_Y -
          player.y
      );

    return Math.atan2(
      150,
      Math.max(
        1,
        dx + dy
      )
    );
  }

  getPressure(
    opponent,
    player
  ) {
    let nearest =
      Infinity;

    for (const defender of this.getActivePlayers(
      opponent
    )) {
      if (
        isGoalkeeper(
          defender
        )
      ) {
        continue;
      }

      nearest =
        Math.min(
          nearest,
          distance(
            player,
            defender
          )
        );
    }

    return nearest === Infinity
      ? 200
      : nearest;
  }

  /* =======================================================
     PASSING
  ======================================================= */

  findBestPassTarget(
    team,
    opponent,
    passer
  ) {
    const teammates =
      this.getActivePlayers(
        team
      ).filter(
        (p) =>
          p.id !==
            passer.id &&
          !p.redCard &&
          !isGoalkeeper(p)
      );

    let best = null;
    let bestScore = -Infinity;

    for (const target of teammates) {
      const d =
        distance(
          passer,
          target
        );

      if (
        d < 22 ||
        d > 360
      ) {
        continue;
      }

      const forward =
        forwardDistance(
          team,
          passer.x,
          target.x
        );

      const openness =
        this.getPlayerOpenness(
          opponent,
          target
        );

      const laneSafety =
        this.getPassLaneSafety(
          passer,
          target,
          opponent
        );

      const roleBonus =
        this.getRolePassBonus(
          target,
          passer
        );

      const progress =
        progressForTeam(
          team,
          target.x
        );

      const score =
        forward *
          1.2 +
        openness *
          1.8 +
        laneSafety *
          1.4 +
        roleBonus *
          20 +
        progress *
          25 -
        d *
          0.25;

      if (
        score >
        bestScore
      ) {
        bestScore = score;
        best = target;
      }
    }

    return best;
  }

  getPlayerOpenness(
    opponent,
    player
  ) {
    let nearest =
      Infinity;

    for (const defender of this.getActivePlayers(
      opponent
    )) {
      nearest =
        Math.min(
          nearest,
          distance(
            defender,
            player
          )
        );
    }

    return clamp(
      nearest / 100,
      0,
      2
    );
  }

  getPassLaneSafety(
    passer,
    target,
    opponent
  ) {
    let nearest =
      Infinity;

    for (const defender of this.getActivePlayers(
      opponent
    )) {
      const d =
        distanceToSegment(
          defender.x,
          defender.y,
          passer.x,
          passer.y,
          target.x,
          target.y
        );

      nearest =
        Math.min(
          nearest,
          d
        );
    }

    return clamp(
      nearest / 50,
      0,
      1
    );
  }

  getRolePassBonus(
    target,
    passer
  ) {
    if (
      isAttacker(target) &&
      !isAttacker(passer)
    ) {
      return 1;
    }

    if (
      isMidfielder(target)
    ) {
      return 0.8;
    }

    if (
      isWide(target)
    ) {
      return 0.7;
    }

    return 0.4;
  }

  getPassTargetQuality(
    team,
    passer,
    target
  ) {
    const forward =
      forwardDistance(
        team,
        passer.x,
        target.x
      );

    const openness =
      this.getPlayerOpenness(
        this.getOpponent(
          team.side
        ),
        target
      );

    return clamp(
      0.5 +
        forward / 300 +
        openness * 0.25,
      0,
      1
    );
  }

  performPass(
    team,
    opponent,
    passer,
    target
  ) {
    if (
      !target ||
      !passer.hasBall
    ) {
      return false;
    }

    /*
      Prefer existing passing module.
    */
    try {
      const result =
        attemptPass(
          this,
          team,
          opponent,
          passer,
          target
        );

      if (
        result
      ) {
        passer.lastActionAt = 0;

        return true;
      }
    } catch (
      error
    ) {
      /*
        If old passing.js has a different
        function signature, use internal fallback.
      */
    }

    return this.internalPass(
      team,
      opponent,
      passer,
      target
    );
  }

  internalPass(
    team,
    opponent,
    passer,
    target
  ) {
    const accuracy =
      clamp(
        num(
          passer.passing,
          60
        ) / 100,
        0.35,
        0.98
      );

    const vision =
      clamp(
        num(
          passer.vision,
          60
        ) / 100,
        0.35,
        0.98
      );

    const error =
      (1 -
        accuracy *
          0.75 -
        vision *
          0.25) *
      55;

    const tx =
      target.x +
      randomBetween(
        -error,
        error
      );

    const ty =
      target.y +
      randomBetween(
        -error,
        error
      );

    const dx =
      tx -
      passer.x;

    const dy =
      ty -
      passer.y;

    const len =
      Math.hypot(
        dx,
        dy
      ) || 1;

    const passSpeed =
      260 +
      num(
        passer.passing,
        60
      ) *
        1.5;

    for (const p of team.players) {
      p.hasBall = false;
    }

    this.ball.ownerId = null;

    this.ball.state =
      BALL_STATE.PASSING;

    this.ball.x =
      passer.x;

    this.ball.y =
      passer.y;

    this.ball.vx =
      (dx / len) *
      passSpeed;

    this.ball.vy =
      (dy / len) *
      passSpeed;

    this.ball.targetId =
      target.id;

    this.ball.lastTouchTeam =
      team.side;

    this.ball.lastTouchPlayerId =
      passer.id;

    this.lastTouchTeam =
      team.side;

    this.lastTouchPlayerId =
      passer.id;

    this.lastPass = {
      passerId: passer.id,
      receiverId: target.id,
      team: team.side,
      time: this.realSeconds,
    };

    team.stats.passesAttempted +=
      1;

    passer.stats.passesAttempted +=
      1;

    this.addEvent({
      type:
        EVENTS.PASS ||
        "pass",
      team: team.side,
      player: passer,
      relatedPlayer: target,
      text:
        `${passer.name} passes to ${target.name}`,
    });

    passer.lastActionAt = 0;

    return true;
  }

  /* =======================================================
     CROSS
  ======================================================= */

  performCross(
    team,
    opponent,
    player
  ) {
    const attackers =
      this.getActivePlayers(
        team
      ).filter(
        (p) =>
          p.id !==
            player.id &&
          isAttacker(p)
      );

    if (
      !attackers.length
    ) {
      return false;
    }

    const target =
      attackers.sort(
        (a, b) =>
          Math.abs(
            a.y -
              CENTER_Y
          ) -
          Math.abs(
            b.y -
              CENTER_Y
          )
      )[0];

    team.stats.crosses += 1;

    player.stats.crosses += 1;

    /*
      Cross behaves like a pass but with
      more height and larger target area.
    */
    const dx =
      target.x -
      player.x;

    const dy =
      target.y -
      player.y;

    const len =
      Math.hypot(
        dx,
        dy
      ) || 1;

    const speed =
      235 +
      num(
        player.passing,
        60
      ) *
        1.25;

    for (const p of team.players) {
      p.hasBall = false;
    }

    this.ball.ownerId = null;

    this.ball.state =
      BALL_STATE.PASSING;

    this.ball.x =
      player.x;

    this.ball.y =
      player.y;

    this.ball.vx =
      (dx / len) *
      speed;

    this.ball.vy =
      (dy / len) *
      speed;

    this.ball.height =
      1;

    this.ball.targetId =
      target.id;

    this.ball.lastTouchTeam =
      team.side;

    this.ball.lastTouchPlayerId =
      player.id;

    this.lastTouchTeam =
      team.side;

    this.lastTouchPlayerId =
      player.id;

    this.lastPass = {
      passerId: player.id,
      receiverId: target.id,
      team: team.side,
      time: this.realSeconds,
      cross: true,
    };

    this.addEvent({
      type:
        EVENTS.CROSS ||
        "cross",
      team: team.side,
      player,
      relatedPlayer: target,
      text:
        `${player.name} crosses the ball`,
    });

    player.lastActionAt = 0;

    return true;
  }

  /* =======================================================
     DRIBBLING
  ======================================================= */

  forceDribble(
    team,
    opponent,
    player
  ) {
    if (
      !player.hasBall
    ) {
      return false;
    }

    const target =
      this.getDribbleTarget(
        team,
        opponent,
        player
      );

    player.targetX =
      target.x;

    player.targetY =
      target.y;

    player.state =
      "dribbling";

    player.stats.dribbles +=
      1;

    team.stats.dribbles +=
      1;

    player.lastActionAt = 0;

    /*
      Don't emit an event every frame.
    */
    if (
      this.realSeconds -
        num(
          player.lastDribbleEvent,
          -999
        ) >
      4
    ) {
      player.lastDribbleEvent =
        this.realSeconds;

      this.addEvent({
        type:
          EVENTS.DRIBBLE ||
          "dribble",
        team: team.side,
        player,
        text:
          `${player.name} drives forward`,
      });
    }

    return true;
  }

  /* =======================================================
     SHOOTING
  ======================================================= */

  performShot(
    team,
    opponent,
    player
  ) {
    if (
      !player.hasBall
    ) {
      return false;
    }

    try {
      const result =
        attemptShot(
          this,
          team,
          opponent,
          player
        );

      if (
        result
      ) {
        player.lastActionAt = 0;
        return true;
      }
    } catch (
      error
    ) {
      /*
        Internal fallback below.
      */
    }

    return this.internalShot(
      team,
      opponent,
      player
    );
  }

  internalShot(
    team,
    opponent,
    player
  ) {
    const goalX =
      team.attackDirection === 1
        ? FIELD_WIDTH + 5
        : -5;

    const goalY =
      CENTER_Y +
      randomBetween(
        -28,
        28
      );

    const dx =
      goalX -
      player.x;

    const dy =
      goalY -
      player.y;

    const len =
      Math.hypot(
        dx,
        dy
      ) || 1;

    const shooting =
      clamp(
        num(
          player.shooting,
          60
        ) / 100,
        0.25,
        1
      );

    const composure =
      clamp(
        num(
          player.composure,
          60
        ) / 100,
        0.25,
        1
      );

    const pressure =
      this.getPressure(
        opponent,
        player
      );

    const accuracy =
      clamp(
        shooting *
          0.65 +
          composure *
            0.35 -
          pressure /
            300,
        0.20,
        0.96
      );

    const spread =
      (1 -
        accuracy) *
      110;

    const finalX =
      goalX;

    const finalY =
      clamp(
        goalY +
          randomBetween(
            -spread,
            spread
          ),
        12,
        FIELD_HEIGHT - 12
      );

    const distanceToGoal =
      this.getGoalDistance(
        team,
        player
      );

    const xg =
      clamp(
        0.04 +
          shooting *
            0.16 +
          composure *
            0.06 +
          clamp(
            1 -
              distanceToGoal /
                500,
            0,
            1
          ) *
            0.30 -
          pressure /
            600,
        0.01,
        0.75
      );

    team.stats.shots +=
      1;

    team.stats.xG += xg;

    player.stats.shots +=
      1;

    player.stats.xG += xg;

    this.lastShot = {
      team: team.side,
      playerId: player.id,
      xg,
      time: this.realSeconds,
      targetX: finalX,
      targetY: finalY,
    };

    for (const p of team.players) {
      p.hasBall = false;
    }

    this.ball.ownerId = null;

    this.ball.state =
      BALL_STATE.SHOOTING;

    this.ball.x =
      player.x;

    this.ball.y =
      player.y;

    const shotSpeed =
      380 +
      shooting *
        150;

    const sx =
      finalX -
      player.x;

    const sy =
      finalY -
      player.y;

    const slen =
      Math.hypot(
        sx,
        sy
      ) || 1;

    this.ball.vx =
      (sx / slen) *
      shotSpeed;

    this.ball.vy =
      (sy / slen) *
      shotSpeed;

    this.ball.shotTargetX =
      finalX;

    this.ball.shotTargetY =
      finalY;

    this.ball.shotXG =
      xg;

    this.lastTouchTeam =
      team.side;

    this.lastTouchPlayerId =
      player.id;

    this.addEvent({
      type:
        EVENTS.SHOT ||
        "shot",
      team: team.side,
      player,
      text:
        `${player.name} shoots`,
      xg,
    });

    player.lastActionAt = 0;

    return true;
  }

  /* =======================================================
     BALL PHYSICS
  ======================================================= */

  updateBallPhysics(
    dt
  ) {
    if (
      this.ball.state ===
      BALL_STATE.POSSESSED
    ) {
      return;
    }

    /*
      Let existing ball module update its physics,
      but protect the engine from broken/missing values.
    */
    try {
      updateBall(
        this.ball,
        dt
      );
    } catch (
      error
    ) {
      this.ball.x +=
        num(
          this.ball.vx,
          0
        ) *
        dt;

      this.ball.y +=
        num(
          this.ball.vy,
          0
        ) *
        dt;

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
    }

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
      this.checkShot();
    }

    this.checkBoundaries();
  }

  checkPassReception() {
    const target =
      this.getPlayer(
        this.ball.targetId
      );

    /*
      First give intended receiver a chance.
    */
    if (
      target &&
      !target.redCard
    ) {
      const d =
        distance(
          target,
          this.ball
        );

      if (
        d < 22
      ) {
        this.receivePass(
          target
        );

        return;
      }
    }

    /*
      Interception.
    */
    let interceptor =
      null;

    let nearest =
      Infinity;

    for (const team of this.getTeams()) {
      for (const player of this.getActivePlayers(
        team
      )) {
        if (
          player.id ===
          this.ball.targetId
        ) {
          continue;
        }

        const d =
          distance(
            player,
            this.ball
          );

        if (
          d < nearest
        ) {
          nearest = d;
          interceptor = player;
        }
      }
    }

    if (
      interceptor &&
      nearest < 15
    ) {
      const intended =
        target;

      const passQuality =
        this.lastPass
          ? this.getPlayer(
              this.lastPass.passerId
            )
          : null;

      const interceptionChance =
        passQuality
          ? clamp(
              0.16 +
                nearest / 70 -
                num(
                  passQuality.passing,
                  60
                ) /
                  500,
              0.05,
              0.55
            )
          : 0.25;

      if (
        Math.random() <
        interceptionChance
      ) {
        this.receiveInterception(
          interceptor,
          intended
        );
      }
    }

    /*
      Ball can reach the target even if
      it does not hit exact coordinates.
    */
    if (
      target &&
      distance(
        target,
        this.ball
      ) < 32
    ) {
      this.receivePass(
        target
      );
    }
  }

  receivePass(
    receiver
  ) {
    const team =
      this.getTeam(
        receiver.side
      );

    for (const t of this.getTeams()) {
      for (const p of t.players) {
        p.hasBall = false;
      }
    }

    setBallOwner(
      this.ball,
      receiver
    );

    receiver.hasBall = true;

    this.ball.state =
      BALL_STATE.POSSESSED;

    this.ball.targetId =
      null;

    this.lastTouchTeam =
      receiver.side;

    this.lastTouchPlayerId =
      receiver.id;

    this.lastPossessionTeam =
      receiver.side;

    this.lastPossessionPlayerId =
      receiver.id;

    if (
      this.lastPass &&
      this.lastPass.team ===
        receiver.side &&
      this.lastPass.receiverId ===
        receiver.id
    ) {
      const passer =
        this.getPlayer(
          this.lastPass.passerId
        );

      if (
        passer &&
        passer.id !==
          receiver.id
      ) {
        team.stats.passesCompleted +=
          1;

        passer.stats.passesCompleted +=
          1;
      }
    }

    this.addEvent({
      type:
        EVENTS.RECEPTION ||
        "reception",
      team: receiver.side,
      player: receiver,
      text:
        `${receiver.name} receives the ball`,
    });
  }

  receiveInterception(
    interceptor,
    intended
  ) {
    for (const team of this.getTeams()) {
      for (const p of team.players) {
        p.hasBall = false;
      }
    }

    setBallOwner(
      this.ball,
      interceptor
    );

    interceptor.hasBall =
      true;

    this.ball.state =
      BALL_STATE.POSSESSED;

    this.ball.targetId =
      null;

    const team =
      this.getTeam(
        interceptor.side
      );

    team.stats.interceptions +=
      1;

    interceptor.stats.interceptions +=
      1;

    interceptor.interceptions =
      num(
        interceptor.interceptions,
        0
      ) + 1;

    this.lastTouchTeam =
      interceptor.side;

    this.lastTouchPlayerId =
      interceptor.id;

    this.lastPossessionTeam =
      interceptor.side;

    this.lastPossessionPlayerId =
      interceptor.id;

    this.addEvent({
      type:
        EVENTS.INTERCEPTION ||
        "interception",
      team: interceptor.side,
      player: interceptor,
      relatedPlayer: intended,
      text:
        `${interceptor.name} intercepts the pass`,
    });
  }

  checkShot() {
    if (
      !this.lastShot
    ) {
      return;
    }

    const shooterTeam =
      this.getTeam(
        this.lastShot.team
      );

    const opponent =
      this.getOpponent(
        shooterTeam.side
      );

    const crossedGoalLine =
      shooterTeam.attackDirection ===
      1
        ? this.ball.x >=
          FIELD_WIDTH
        : this.ball.x <= 0;

    if (
      !crossedGoalLine
    ) {
      return;
    }

    this.resolveInternalShot(
      shooterTeam,
      opponent
    );
  }

  resolveInternalShot(
    shooterTeam,
    opponent
  ) {
    const targetY =
      num(
        this.ball.shotTargetY,
        CENTER_Y
      );

    const insideGoal =
      targetY >
        CENTER_Y - 52 &&
      targetY <
        CENTER_Y + 52;

    const goalkeeper =
      this.getActivePlayers(
        opponent
      ).find(
        (p) =>
          isGoalkeeper(p)
      );

    const shooter =
      this.getPlayer(
        this.lastShot.playerId
      );

    let saveChance = 0;

    if (
      goalkeeper
    ) {
      const gkSkill =
        (
          num(
            goalkeeper.diving,
            60
          ) +
          num(
            goalkeeper.reaction,
            60
          ) +
          num(
            goalkeeper.handling,
            60
          )
        ) /
        300;

      const shotPower =
        clamp(
          Math.hypot(
            this.ball.vx,
            this.ball.vy
          ) /
            550,
          0,
          1
        );

      saveChance =
        clamp(
          0.10 +
            gkSkill *
              0.40 -
            shotPower *
              0.20,
          0.05,
          0.62
        );
    }

    if (
      insideGoal &&
      Math.random() >
        saveChance
    ) {
      shooterTeam.stats.shotsOnTarget +=
        1;

      if (shooter) {
        shooter.stats.shotsOnTarget =
          num(
            shooter.stats.shotsOnTarget,
            0
          ) + 1;
      }

      this.scoreGoal(
        shooterTeam,
        shooter
      );

      return;
    }

    /*
      Shot on target but saved.
    */
    if (
      insideGoal
    ) {
      shooterTeam.stats.shotsOnTarget +=
        1;

      if (shooter) {
        shooter.stats.shotsOnTarget =
          num(
            shooter.stats.shotsOnTarget,
            0
          ) + 1;
      }

      shooterTeam.stats.shotsOnTarget =
        num(
          shooterTeam.stats.shotsOnTarget,
          0
        );

      if (goalkeeper) {
        opponent.stats.saves +=
          1;

        goalkeeper.stats.saves +=
          1;

        goalkeeper.saves =
          num(
            goalkeeper.saves,
            0
          ) + 1;

        this.addEvent({
          type:
            EVENTS.SAVE ||
            "save",
          team: opponent.side,
          player: goalkeeper,
          relatedPlayer: shooter,
          text:
            `${goalkeeper.name} makes a save`,
        });

        /*
          Goalkeeper gets possession after save.
        */
        setBallOwner(
          this.ball,
          goalkeeper
        );

        this.ball.state =
          BALL_STATE.POSSESSED;

        this.lastTouchTeam =
          opponent.side;

        this.lastTouchPlayerId =
          goalkeeper.id;

        return;
      }
    }

    /*
      Miss.
    */
    this.addEvent({
      type:
        EVENTS.MISS ||
        "miss",
      team: shooterTeam.side,
      player: shooter,
      text:
        `${shooter?.name || "Player"} misses the target`,
    });

    this.ball.state =
      BALL_STATE.FREE;

    this.ball.ownerId =
      null;

    this.lastShot = null;
  }

  /* =======================================================
     TACKLES
  ======================================================= */

  handleTackles() {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (
      !owner ||
      !owner.hasBall
    ) {
      return;
    }

    const defendingTeam =
      this.getOpponent(
        owner.side
      );

    const defenders =
      this.getActivePlayers(
        defendingTeam
      )
        .filter(
          (p) =>
            !isGoalkeeper(p)
        )
        .sort(
          (a, b) =>
            distance(
              a,
              owner
            ) -
            distance(
              b,
              owner
            )
        );

    const defender =
      defenders[0];

    if (!defender) {
      return;
    }

    const d =
      distance(
        defender,
        owner
      );

    if (
      d > 26
    ) {
      return;
    }

    const tackling =
      clamp(
        num(
          defender.tackling,
          60
        ) / 100,
        0,
        1
      );

    const dribbling =
      clamp(
        num(
          owner.dribbling,
          60
        ) / 100,
        0,
        1
      );

    const stamina =
      clamp(
        defender.stamina / 100,
        0.3,
        1
      );

    const chance =
      clamp(
        0.015 +
          tackling *
            0.055 +
          stamina *
            0.025 -
          dribbling *
            0.035,
        0.005,
        0.10
      );

    if (
      Math.random() >
      chance
    ) {
      return;
    }

    try {
      attemptTackle(
        this,
        defender,
        owner,
        defendingTeam
      );

      return;
    } catch (
      error
    ) {
      /*
        Internal fallback.
      */
    }

    this.internalTackle(
      defender,
      owner,
      defendingTeam
    );
  }

  internalTackle(
    defender,
    attacker,
    defendingTeam
  ) {
    const tackling =
      num(
        defender.tackling,
        60
      );

    const dribbling =
      num(
        attacker.dribbling,
        60
      );

    const success =
      clamp(
        0.38 +
          (tackling -
            dribbling) /
            180,
        0.15,
        0.78
      );

    defendingTeam.stats.tackles +=
      1;

    defender.stats.tackles +=
      1;

    if (
      Math.random() <
      success
    ) {
      attacker.hasBall =
        false;

      this.ball.ownerId =
        null;

      this.ball.state =
        BALL_STATE.FREE;

      this.ball.x =
        attacker.x;

      this.ball.y =
        attacker.y;

      this.ball.vx =
        defender.side === "home"
          ? 50
          : -50;

      this.ball.vy =
        randomBetween(
          -40,
          40
        );

      this.lastTouchTeam =
        defender.side;

      this.lastTouchPlayerId =
        defender.id;

      this.addEvent({
        type:
          EVENTS.TACKLE ||
          "tackle",
        team: defender.side,
        player: defender,
        relatedPlayer: attacker,
        text:
          `${defender.name} wins the ball`,
      });
    } else {
      /*
        Failed tackle may become foul.
      */
      if (
        Math.random() <
        0.08
      ) {
        defendingTeam.stats.fouls +=
          1;

        defender.stats.fouls =
          num(
            defender.stats.fouls,
            0
          ) + 1;

        this.addEvent({
          type:
            EVENTS.FOUL ||
            "foul",
          team: defender.side,
          player: defender,
          relatedPlayer: attacker,
          text:
            `${defender.name} commits a foul`,
        });

        /*
          Rare yellow card.
        */
        if (
          Math.random() <
          0.16
        ) {
          defender.yellowCards =
            num(
              defender.yellowCards,
              0
            ) + 1;

          defender.stats.yellow +=
            1;

          defendingTeam.stats.yellow +=
            1;

          this.addEvent({
            type:
              EVENTS.YELLOW ||
              "yellow",
            team: defender.side,
            player: defender,
            text:
              `${defender.name} receives a yellow card`,
          });

          /*
            Second yellow.
          */
          if (
            defender.yellowCards >=
            2
          ) {
            defender.redCard =
              true;

            defender.stats.red +=
              1;

            defendingTeam.stats.red +=
              1;

            this.addEvent({
              type:
                EVENTS.RED ||
                "red",
              team: defender.side,
              player: defender,
              text:
                `${defender.name} is sent off`,
            });
          }
        }
      }
    }
  }

  /* =======================================================
     POSSESSION / STAMINA
  ======================================================= */

  updatePossessionStats(
    dt
  ) {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (owner) {
      this.lastPossessionTeam =
        owner.side;

      this.lastPossessionPlayerId =
        owner.id;
    }

    if (
      this.lastPossessionTeam ===
      "home"
    ) {
      this.possessionClock.home +=
        dt;
    } else {
      this.possessionClock.away +=
        dt;
    }

    const total =
      this.possessionClock.home +
      this.possessionClock.away;

    if (
      total > 0
    ) {
      this.home.stats.possession =
        Math.round(
          (this.possessionClock.home /
            total) *
            100
        );

      this.away.stats.possession =
        Math.round(
          (this.possessionClock.away /
            total) *
            100
        );
    }

    if (owner) {
      const team =
        this.getTeam(
          owner.side
        );

      team.stats.possessionSeconds +=
        dt;
    }
  }

  updateStamina(dt) {
    for (const team of this.getTeams()) {
      for (const player of team.players) {
        if (
          player.redCard
        ) {
          continue;
        }

        const speed =
          Math.hypot(
            player.vx,
            player.vy
          );

        let drain =
          0.008;

        if (
          speed > 80
        ) {
          drain +=
            0.018;
        }

        if (
          player.state ===
          "pressing"
        ) {
          drain +=
            0.012;
        }

        if (
          player.hasBall
        ) {
          drain +=
            0.004;
        }

        player.stamina =
          clamp(
            player.stamina -
              drain *
                dt *
                60,
            0,
            100
          );
      }
    }
  }

  /* =======================================================
     BOUNDARIES
  ======================================================= */

  checkBoundaries() {
    if (
      this.ball.state ===
      BALL_STATE.POSSESSED
    ) {
      return;
    }

    const left =
      this.ball.x < 0;

    const right =
      this.ball.x >
      FIELD_WIDTH;

    const top =
      this.ball.y < 0;

    const bottom =
      this.ball.y >
      FIELD_HEIGHT;

    if (
      top ||
      bottom
    ) {
      this.ball.state =
        BALL_STATE.OUT;

      this.handleThrowIn();

      return;
    }

    if (
      left ||
      right
    ) {
      /*
        Shooting gets resolved first.
      */
      if (
        this.ball.state ===
        BALL_STATE.SHOOTING
      ) {
        return;
      }

      this.handleGoalLineRestart();
    }
  }

  handleThrowIn() {
    const team =
      this.lastTouchTeam ===
      "home"
        ? this.away
        : this.home;

    const player =
      this.getActivePlayers(
        team
      ).find(
        (p) =>
          !isGoalkeeper(p)
      );

    if (!player) {
      return;
    }

    this.ball.x =
      clamp(
        this.ball.x,
        5,
        FIELD_WIDTH - 5
      );

    this.ball.y =
      clamp(
        this.ball.y,
        5,
        FIELD_HEIGHT - 5
      );

    setBallOwner(
      this.ball,
      player
    );

    this.ball.state =
      BALL_STATE.POSSESSED;

    this.lastTouchTeam =
      team.side;

    this.lastTouchPlayerId =
      player.id;

    this.addEvent({
      type:
        EVENTS.THROW_IN ||
        "throw_in",
      team: team.side,
      player,
      text:
        `${team.name} takes a throw-in`,
    });
  }

  handleGoalLineRestart() {
    const defendingTeam =
      this.ball.x < 0
        ? this.home
        : this.away;

    const attackingTeam =
      this.ball.x < 0
        ? this.away
        : this.home;

    const goalkeeper =
      this.getActivePlayers(
        defendingTeam
      ).find(
        (p) =>
          isGoalkeeper(p)
      );

    if (!goalkeeper) {
      return;
    }

    /*
      If attacker touched it last,
      corner.
    */
    const isCorner =
      this.lastTouchTeam ===
      attackingTeam.side;

    if (
      isCorner
    ) {
      attackingTeam.stats.corners +=
        1;

      this.addEvent({
        type:
          EVENTS.CORNER ||
          "corner",
        team:
          attackingTeam.side,
        text:
          `${attackingTeam.name} wins a corner`,
      });

      const cornerPlayer =
        this.getActivePlayers(
          attackingTeam
        ).find(
          (p) =>
            isWide(p)
        ) ||
        this.getActivePlayers(
          attackingTeam
        )[0];

      if (
        cornerPlayer
      ) {
        cornerPlayer.x =
          defendingTeam.side ===
          "home"
            ? 24
            : FIELD_WIDTH - 24;

        cornerPlayer.y =
          this.ball.y <
          CENTER_Y
            ? 22
            : FIELD_HEIGHT - 22;

        setBallOwner(
          this.ball,
          cornerPlayer
        );

        this.ball.state =
          BALL_STATE.POSSESSED;

        this.lastTouchTeam =
          attackingTeam.side;

        this.lastTouchPlayerId =
          cornerPlayer.id;
      }

      return;
    }

    /*
      Goal kick.
    */
    this.addEvent({
      type:
        EVENTS.GOAL_KICK ||
        "goal_kick",
      team:
        defendingTeam.side,
      player: goalkeeper,
      text:
        `${defendingTeam.name} takes a goal kick`,
    });

    goalkeeper.x =
      defendingTeam.side ===
      "home"
        ? 55
        : FIELD_WIDTH - 55;

    goalkeeper.y =
      CENTER_Y;

    setBallOwner(
      this.ball,
      goalkeeper
    );

    this.ball.state =
      BALL_STATE.POSSESSED;

    this.lastTouchTeam =
      defendingTeam.side;

    this.lastTouchPlayerId =
      goalkeeper.id;
  }

  /* =======================================================
     GOALS
  ======================================================= */

  scoreGoal(
    team,
    scorer
  ) {
    if (
      this.goalCooldown > 0
    ) {
      return;
    }

    this.goalCooldown = 1;

    team.score =
      num(
        team.score,
        0
      ) + 1;

    this.score[team.side] +=
      1;

    team.stats.goals +=
      1;

    if (scorer) {
      scorer.goals =
        num(
          scorer.goals,
          0
        ) + 1;

      scorer.stats.goals =
        num(
          scorer.stats.goals,
          0
        ) + 1;
    }

    let assistPlayer = null;

    /*
      Only passes/crosses shortly before
      the goal can create an assist.
    */
    if (
      this.lastPass &&
      this.lastPass.team ===
        team.side &&
      this.realSeconds -
        num(
          this.lastPass.time,
          -999
        ) <
        12
    ) {
      assistPlayer =
        this.getPlayer(
          this.lastPass.passerId
        );

      if (
        assistPlayer &&
        assistPlayer.id !==
          scorer?.id
      ) {
        assistPlayer.assists =
          num(
            assistPlayer.assists,
            0
          ) + 1;

        assistPlayer.stats.assists =
          num(
            assistPlayer.stats.assists,
            0
          ) + 1;

        team.stats.assists +=
          1;
      }
    }

    this.addEvent({
      type:
        EVENTS.GOAL ||
        "goal",
      team: team.side,
      player: scorer,
      relatedPlayer:
        assistPlayer,
      text:
        `${team.name} scores! ${
          scorer?.name ||
          "Goal"
        }`,
      xg:
        this.lastShot?.xg ??
        null,
    });

    this.ball.state =
      BALL_STATE.GOAL;

    this.resetAfterGoal();
  }

  resetAfterGoal() {
    for (const team of this.getTeams()) {
      for (const player of team.players) {
        player.hasBall = false;
      }
    }

    this.ball.ownerId =
      null;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.ball.x =
      CENTER_X;

    this.ball.y =
      CENTER_Y;

    this.ball.state =
      BALL_STATE.FREE;

    this.lastPass = null;
    this.lastShot = null;

    /*
      Team that conceded restarts.
    */
    const kickoffTeam =
      this.lastTouchTeam ===
      "home"
        ? this.away
        : this.home;

    this.kickoff(
      kickoffTeam
    );
  }

  /* =======================================================
     HALF / FULL TIME
  ======================================================= */

  handleHalfTime() {
    if (
      this.minute >= 45 &&
      !this.halfTimeTriggered
    ) {
      this.halfTimeTriggered =
        true;

      this.addEvent({
        type:
          EVENTS.HALFTIME ||
          "halftime",
        text:
          "Half-time",
      });

      /*
        Short internal pause only.
        Match remains live so the UI can continue.
      */
    }
  }

  handleFullTime() {
    if (
      this.minute >= 90 &&
      !this.fullTimeTriggered
    ) {
      this.fullTimeTriggered =
        true;

      this.minute = 90;
      this.second = 0;

      this.status =
        "finished";

      this.addEvent({
        type:
          EVENTS.FULLTIME ||
          "fulltime",
        text:
          `Full-time. ${this.score.home}-${this.score.away}`,
      });
    }
  }

  /* =======================================================
     USER TACTICS
  ======================================================= */

  setManagedTeam(
    side
  ) {
    if (
      side !== "home" &&
      side !== "away"
    ) {
      return false;
    }

    this.managedTeam =
      side;

    return true;
  }

  /*
    User can only change the team he manages.
  */
  setUserTactics(
    tactics = {}
  ) {
    const team =
      this.getTeam(
        this.managedTeam
      );

    if (!team) {
      return false;
    }

    team.tactics =
      normalizeTactics({
        ...team.tactics,
        ...tactics,
      });

    this.addEvent({
      type:
        EVENTS.TACTICAL_CHANGE ||
        "tactical_change",
      team:
        team.side,
      text:
        `${team.name} changes tactics`,
    });

    return true;
  }

  setFormation(
    side,
    formation
  ) {
    /*
      User may only change his own formation.
    */
    if (
      side !==
      this.managedTeam
    ) {
      return false;
    }

    const team =
      this.getTeam(side);

    if (
      !FORMATIONS[
        formation
      ]
    ) {
      return false;
    }

    team.formation =
      formation;

    this.rebuildFormation(
      team
    );

    return true;
  }

  rebuildFormation(
    team
  ) {
    const slots =
      FORMATIONS[
        team.formation
      ] ||
      FORMATIONS["4-4-2"];

    const active =
      this.getActivePlayers(
        team
      );

    active.forEach(
      (player, index) => {
        const slot =
          slots[index] ||
          slots[
            slots.length - 1
          ];

        player.role =
          slot.role;

        player.position =
          slot.role;

        player.baseX =
          slot.x;

        player.baseY =
          slot.y;

        player.homeX =
          slot.x;

        player.homeY =
          slot.y;

        player.targetX =
          team.attackDirection ===
          1
            ? slot.x *
              FIELD_WIDTH
            : (1 - slot.x) *
              FIELD_WIDTH;

        player.targetY =
          slot.y *
          FIELD_HEIGHT;
      }
    );
  }

  /* =======================================================
     USER SUBSTITUTION
  ======================================================= */

  substituteUser(
    outgoingId,
    incomingId
  ) {
    const team =
      this.getTeam(
        this.managedTeam
      );

    if (!team) {
      return false;
    }

    if (
      num(
        team.substitutionsUsed,
        0
      ) >= 5
    ) {
      return false;
    }

    const outgoing =
      team.activePlayers?.find(
        (p) =>
          String(p.id) ===
          String(outgoingId)
      );

    const incoming =
      team.bench?.find(
        (p) =>
          String(p.id) ===
          String(incomingId)
      );

    if (
      !outgoing ||
      !incoming
    ) {
      return false;
    }

    /*
      If possible, preserve the outgoing
      tactical slot.
    */
    incoming.role =
      outgoing.role;

    incoming.position =
      outgoing.position;

    incoming.baseX =
      outgoing.baseX;

    incoming.baseY =
      outgoing.baseY;

    incoming.homeX =
      outgoing.homeX;

    incoming.homeY =
      outgoing.homeY;

    incoming.x =
      outgoing.x;

    incoming.y =
      outgoing.y;

    incoming.targetX =
      outgoing.targetX;

    incoming.targetY =
      outgoing.targetY;

    const result =
      performSubstitution(
        this,
        team,
        outgoingId,
        incomingId,
        false
      );

    if (
      result === false
    ) {
      return false;
    }

    team.substitutionsUsed =
      num(
        team.substitutionsUsed,
        0
      ) + 1;

    /*
      Rebuild active/bench arrays.
    */
    team.activePlayers =
      team.players.filter(
        (p) =>
          !team.bench.includes(p)
      );

    /*
      Safer rebuild from current lineup:
    */
    const activeIds =
      new Set(
        team.activePlayers.map(
          (p) =>
            String(p.id)
        )
      );

    team.bench =
      team.players.filter(
        (p) =>
          !activeIds.has(
            String(p.id)
          )
      );

    this.addEvent({
      type:
        EVENTS.SUBSTITUTION ||
        "substitution",
      team:
        team.side,
      player: incoming,
      relatedPlayer: outgoing,
      text:
        `${incoming.name} replaces ${outgoing.name}`,
    });

    return true;
  }

  /* =======================================================
     LINEUP API
  ======================================================= */

  getLineup(
    side
  ) {
    const team =
      this.getTeam(side);

    if (!team) {
      return [];
    }

    return this.getActivePlayers(
      team
    ).map(
      (player) => ({
        id: player.id,
        name: player.name,
        number: player.number,
        position:
          player.position,
        role:
          player.role,
        rating:
          player.overall,
        x: player.x,
        y: player.y,
        hasBall:
          player.hasBall,
        redCard:
          player.redCard,
        stamina:
          player.stamina,
      })
    );
  }

  /* =======================================================
     EVENTS
  ======================================================= */

  addEvent({
    type,
    team = null,
    player = null,
    relatedPlayer = null,
    text = "",
    xg = null,
  }) {
    const event = {
      id:
        `${this.matchId}-${++this.eventCounter}`,

      minute:
        this.minute,

      second:
        this.second,

      type,

      team,

      playerId:
        player?.id ??
        null,

      playerName:
        player?.name ??
        null,

      playerNumber:
        player?.number ??
        null,

      relatedPlayerId:
        relatedPlayer?.id ??
        null,

      relatedPlayerName:
        relatedPlayer?.name ??
        null,

      text,

      ...(xg !== null
        ? { xg }
        : {}),
    };

    this.events.push(
      event
    );

    /*
      Prevent endless memory growth.
    */
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
      try {
        this.onEvent(
          event
        );
      } catch (
        error
      ) {
        /*
          Event UI errors should never
          crash the match engine.
        */
      }
    }

    return event;
  }

  /* =======================================================
     SNAPSHOT
  ======================================================= */

  getSnapshot() {
    return {
      status:
        this.status,

      minute:
        this.minute,

      second:
        this.second,

      realSeconds:
        this.realSeconds,

      simSeconds:
        this.simSeconds,

      score: {
        home:
          this.score.home,
        away:
          this.score.away,
      },

      possessionTeam:
        this.lastPossessionTeam,

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
          this.ball.targetId ??
          null,
      },

      managedTeam:
        this.managedTeam,

      home: {
        id:
          this.home.id,
        name:
          this.home.name,
        logo:
          this.home.logo,

        formation:
          this.home.formation,

        tactics:
          {
            ...this.home.tactics,
          },

        score:
          this.score.home,

        stats:
          {
            ...this.home.stats,
          },

        substitutionsUsed:
          this.home
            .substitutionsUsed,

        players:
          this.home.players.map(
            (p) => ({
              ...p,
              stats: {
                ...p.stats,
              },
            })
          ),
      },

      away: {
        id:
          this.away.id,
        name:
          this.away.name,
        logo:
          this.away.logo,

        formation:
          this.away.formation,

        tactics:
          {
            ...this.away.tactics,
          },

        score:
          this.score.away,

        stats:
          {
            ...this.away.stats,
          },

        substitutionsUsed:
          this.away
            .substitutionsUsed,

        players:
          this.away.players.map(
            (p) => ({
              ...p,
              stats: {
                ...p.stats,
              },
            })
          ),
      },

      events:
        this.events.slice(-100),
    };
  }

  getEventsSince(
    index
  ) {
    return this.events.slice(
      Math.max(
        0,
        num(index, 0)
      )
    );
  }

  /* =======================================================
     RESULT
  ======================================================= */

  serializeResult() {
    return {
      status:
        this.status,

      minute:
        this.minute,

      second:
        this.second,

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

      homeStats:
        {
          ...this.home.stats,
        },

      awayStats:
        {
          ...this.away.stats,
        },

      events:
        [...this.events],

      homeSubstitutions:
        this.home
          .substitutionsUsed,

      awaySubstitutions:
        this.away
          .substitutionsUsed,

      homeFormation:
        this.home.formation,

      awayFormation:
        this.away.formation,

      homeTactics:
        {
          ...this.home.tactics,
        },

      awayTactics:
        {
          ...this.away.tactics,
        },

      result:
        this.score.home >
        this.score.away
          ? "home"
          : this.score.away >
            this.score.home
          ? "away"
          : "draw",
    };
  }

  isFinished() {
    return (
      this.status ===
      "finished"
    );
  }
}
