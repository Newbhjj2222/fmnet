import {
  BALL,
  DEFAULT_TACTICS,
  EVENT_TYPES,
  MATCH,
  MENTALITY,
  PLAYER,
  PITCH,
} from "./constants";

import {
  getFormationPositions,
  getRoleGroup,
} from "./Formation";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function random(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function chance(value) {
  return Math.random() < clamp(value, 0, 1);
}

function distance(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}

function normalize(value, min, max) {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function avg(...values) {
  const valid = values.filter(
    (v) => Number.isFinite(v)
  );

  if (!valid.length) return 50;

  return (
    valid.reduce((sum, v) => sum + v, 0) /
    valid.length
  );
}

function rating(player, key, fallback = 60) {
  const aliases = {
    speed: ["speed", "pace"],
    passing: ["passing", "pass", "passingRating"],
    shooting: ["shooting", "finishing", "shot"],
    dribbling: ["dribbling", "dribble"],
    tackling: ["tackling", "defending", "defence"],
    positioning: ["positioning", "position"],
    vision: ["vision", "creativity"],
    decisionMaking: [
      "decisionMaking",
      "decision",
      "iq",
    ],
    composure: ["composure", "mental"],
    stamina: ["stamina", "fitness"],
    strength: ["strength", "physical"],
    acceleration: ["acceleration", "accel"],
    reaction: ["reaction", "reflexes"],
    handling: ["handling", "catching"],
    diving: ["diving"],
  };

  const list = aliases[key] || [key];

  for (const field of list) {
    if (Number.isFinite(Number(player[field]))) {
      return clamp(Number(player[field]), 1, 100);
    }
  }

  if (Number.isFinite(Number(player.overall))) {
    return clamp(Number(player.overall), 1, 100);
  }

  if (Number.isFinite(Number(player.rating))) {
    return clamp(Number(player.rating), 1, 100);
  }

  return fallback;
}

function createStats() {
  return {
    possession: 0,

    passes: 0,
    completedPasses: 0,

    shots: 0,
    shotsOnTarget: 0,

    goals: 0,
    assists: 0,

    tackles: 0,
    interceptions: 0,

    fouls: 0,
    offsides: 0,

    corners: 0,
    throwIns: 0,
    goalKicks: 0,

    saves: 0,

    yellowCards: 0,
    redCards: 0,

    xG: 0,
  };
}

function createPlayer(raw, team, index) {
  const number =
    Number(
      raw.shirtNumber ??
      raw.number ??
      raw.jerseyNumber ??
      raw.jersey ??
      raw.squadNumber
    ) || index + 1;

  return {
    id:
      String(
        raw.id ??
        raw.playerId ??
        `${team}-${index + 1}`
      ),

    name:
      raw.name ??
      raw.displayName ??
      raw.fullName ??
      `Player ${number}`,

    number,

    position:
      raw.position ??
      raw.pos ??
      raw.role ??
      "CM",

    team,

    role: raw.role ?? raw.position ?? "CM",

    x: PITCH.width / 2,
    y: PITCH.height / 2,

    homeX: PITCH.width / 2,
    homeY: PITCH.height / 2,

    vx: 0,
    vy: 0,

    stamina: rating(raw, "stamina", 90),

    speed: rating(raw, "speed", 70),
    acceleration: rating(raw, "acceleration", 70),

    passing: rating(raw, "passing", 65),
    shooting: rating(raw, "shooting", 60),
    dribbling: rating(raw, "dribbling", 60),
    tackling: rating(raw, "tackling", 60),

    positioning: rating(raw, "positioning", 65),
    vision: rating(raw, "vision", 60),
    decisionMaking: rating(
      raw,
      "decisionMaking",
      60
    ),
    composure: rating(raw, "composure", 60),

    strength: rating(raw, "strength", 60),

    reaction: rating(raw, "reaction", 65),
    handling: rating(raw, "handling", 65),
    diving: rating(raw, "diving", 65),

    hasBall: false,
    active: true,

    yellow: false,
    red: false,

    sprinting: false,

    goals: 0,
    assists: 0,

    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    completedPasses: 0,
    tackles: 0,
    fouls: 0,

    lastActionAt: 0,
    lastTouchAt: 0,
  };
}

export default class MatchEngine {
  constructor({
    matchId,
    homeTeam,
    awayTeam,

    homePlayers = [],
    awayPlayers = [],

    homeFormation = "4-4-2",
    awayFormation = "4-4-2",

    homeTactics = {},
    awayTactics = {},

    durationSeconds = MATCH.realDuration,

    initialScore = {
      home: 0,
      away: 0,
    },

    initialMinute = 0,

    onEvent,
  }) {
    this.matchId = matchId;

    this.durationSeconds = durationSeconds;

    this.onEvent = onEvent;

    this.running = false;
    this.finished = false;

    this.realElapsed = 0;
    this.lastDecision = 0;
    this.lastTeamDecision = 0;
    this.lastSubstitutionCheck = 0;

    this.lastSnapshot = null;

    this.homeTeam = {
      id: homeTeam?.id || "home",
      name: homeTeam?.name || "Home",
      logo: homeTeam?.logo || "",
      formation: homeFormation,
      tactics: {
        ...DEFAULT_TACTICS,
        ...(homeTactics || {}),
      },
    };

    this.awayTeam = {
      id: awayTeam?.id || "away",
      name: awayTeam?.name || "Away",
      logo: awayTeam?.logo || "",
      formation: awayFormation,
      tactics: {
        ...DEFAULT_TACTICS,
        ...(awayTactics || {}),
      },
    };

    this.players = {
      home: homePlayers.map((p, i) =>
        createPlayer(p, "home", i)
      ),

      away: awayPlayers.map((p, i) =>
        createPlayer(p, "away", i)
      ),
    };

    this.bench = {
      home: [],
      away: [],
    };

    this.score = {
      home: Number(initialScore.home) || 0,
      away: Number(initialScore.away) || 0,
    };

    this.stats = {
      home: createStats(),
      away: createStats(),
    };

    this.events = [];

    this.possessionSeconds = {
      home: 0,
      away: 0,
    };

    this.lastPass = null;

    this.setPiece = null;

    this.ball = {
      x: PITCH.width / 2,
      y: PITCH.height / 2,

      vx: 0,
      vy: 0,

      ownerId: null,
      ownerTeam: null,

      state: "possessed",

      targetId: null,

      lastTouchTeam: null,
      lastTouchPlayerId: null,

      shotBy: null,
      assistCandidate: null,

      type: null,
    };

    this.minute =
      clamp(Number(initialMinute) || 0, 0, 90);

    this.second = this.minute * 60;

    this.initializeLineups();
  }

  initializeLineups() {
    this.prepareTeam("home");
    this.prepareTeam("away");

    this.setupKickoff("home");

    this.addEvent({
      type: EVENT_TYPES.KICKOFF,
      team: "home",
      text: `${this.homeTeam.name} kick off`,
    });
  }

  prepareTeam(team) {
    const data =
      team === "home"
        ? this.homeTeam
        : this.awayTeam;

    const all = this.players[team];

    const formationPositions =
      getFormationPositions(
        data.formation,
        team
      );

    const starters = this.chooseStartingXI(
      all,
      formationPositions
    );

    const starterIds = new Set(
      starters.map((p) => p.id)
    );

    this.bench[team] = all
      .filter((p) => !starterIds.has(p.id))
      .slice(0, 7);

    starters.forEach((player, index) => {
      const position =
        formationPositions[index];

      player.active = true;

      player.homeX = position.x;
      player.homeY = position.y;

      player.x = position.x;
      player.y = position.y;

      player.role = position.role;
    });

    this.players[team] = starters.concat(
      this.bench[team]
    );
  }

  chooseStartingXI(
    players,
    formationPositions
  ) {
    const pool = [...players];

    const result = [];

    for (const slot of formationPositions) {
      const roleGroup =
        getRoleGroup(slot.role);

      let candidates = pool.filter(
        (p) => {
          const group = getRoleGroup(
            p.position
          );

          if (slot.role === "GK") {
            return group === "GK";
          }

          if (roleGroup === "DEF") {
            return group === "DEF";
          }

          if (roleGroup === "MID") {
            return group === "MID";
          }

          if (roleGroup === "ATT") {
            return group === "ATT";
          }

          return true;
        }
      );

      if (!candidates.length) {
        candidates = pool.filter(
          (p) => !result.includes(p)
        );
      }

      candidates.sort(
        (a, b) =>
          this.playerRoleScore(
            b,
            slot.role
          ) -
          this.playerRoleScore(
            a,
            slot.role
          )
      );

      const chosen = candidates[0];

      if (chosen) {
        result.push(chosen);

        const index = pool.indexOf(chosen);

        if (index >= 0) {
          pool.splice(index, 1);
        }
      }
    }

    return result;
  }

  playerRoleScore(player, role) {
    const group =
      getRoleGroup(player.position);

    if (role === "GK") {
      return (
        group === "GK" ? 1000 : 0
      ) +
        rating(player, "reaction") +
        rating(player, "handling");
    }

    if (
      ["CB", "LB", "RB", "LWB", "RWB"].includes(
        role
      )
    ) {
      return (
        (group === "DEF" ? 400 : 0) +
        rating(player, "tackling") +
        rating(player, "positioning")
      );
    }

    if (
      ["CM", "CDM", "CAM", "LM", "RM"].includes(
        role
      )
    ) {
      return (
        (group === "MID" ? 400 : 0) +
        rating(player, "passing") +
        rating(player, "vision") +
        rating(player, "positioning")
      );
    }

    return (
      (group === "ATT" ? 500 : 0) +
      rating(player, "shooting") +
      rating(player, "dribbling")
    );
  }

  getActivePlayers(team) {
    return this.players[team].filter(
      (p) => p.active && !p.red
    );
  }

  getAllOpponents(team) {
    return this.getActivePlayers(
      team === "home" ? "away" : "home"
    );
  }

  getPlayerById(id) {
    return (
      this.players.home.find(
        (p) => p.id === id
      ) ||
      this.players.away.find(
        (p) => p.id === id
      ) ||
      null
    );
  }

  setupKickoff(team) {
    const players =
      this.getActivePlayers(team);

    const striker =
      players
        .filter(
          (p) =>
            getRoleGroup(p.position) === "ATT"
        )
        .sort(
          (a, b) =>
            distance(a, {
              x: PITCH.width / 2,
              y: PITCH.height / 2,
            }) -
            distance(b, {
              x: PITCH.width / 2,
              y: PITCH.height / 2,
            })
        )[0] || players[0];

    if (!striker) return;

    this.releaseBall();

    striker.x = PITCH.width / 2;
    striker.y = PITCH.height / 2;

    this.givePossession(
      striker,
      true
    );
  }

  start() {
    if (this.finished) return;

    this.running = true;
  }

  pause() {
    this.running = false;
  }

  resume() {
    if (!this.finished) {
      this.running = true;
    }
  }

  stop() {
    this.running = false;
  }

  update(dt) {
    if (!this.running || this.finished) {
      return;
    }

    dt = Math.min(
      Number(dt) || 0,
      MATCH.maxDt
    );

    this.realElapsed += dt;

    this.second +=
      dt *
      (MATCH.matchMinutes /
        this.durationSeconds) *
      60;

    this.minute = Math.floor(
      this.second / 60
    );

    if (this.minute >= 90) {
      this.finishMatch();
      return;
    }

    this.updatePossessionStats(dt);

    this.updateStamina(dt);

    this.updateTeamTactics();

    this.updatePlayers(dt);

    this.updateBall(dt);

    this.checkTackles(dt);

    this.checkBoundaries();

    this.runDecisions(dt);

    this.runSubstitutions();

    this.handleHalfTime();

    this.lastSnapshot =
      this.getSnapshot();
  }

  updatePossessionStats(dt) {
    if (this.ball.ownerTeam) {
      this.possessionSeconds[
        this.ball.ownerTeam
      ] += dt;
    }
  }

  updateStamina(dt) {
    ["home", "away"].forEach((team) => {
      this.getActivePlayers(team).forEach(
        (player) => {
          const movement =
            Math.hypot(
              player.vx,
              player.vy
            );

          let drain =
            PLAYER.staminaDrain * dt;

          if (
            player.sprinting ||
            movement >
              PLAYER.baseSpeed * 0.85
          ) {
            drain +=
              PLAYER.sprintDrain * dt;
          }

          if (
            this.ball.ownerId === player.id
          ) {
            drain *= 1.15;
          }

          player.stamina = clamp(
            player.stamina - drain,
            15,
            100
          );
        }
      );
    });
  }

  updateTeamTactics() {
    const update = (team, data) => {
      const ownScore =
        this.score[team];

      const opponent =
        team === "home" ? "away" : "home";

      const opponentScore =
        this.score[opponent];

      const minute = this.minute;

      if (
        minute > 70 &&
        ownScore < opponentScore
      ) {
        data.tactics.mentality =
          "attacking";

        data.tactics.pressing =
          "high";

        data.tactics.tempo =
          "fast";

        data.tactics.counterAttack =
          true;
      }

      if (
        minute > 78 &&
        ownScore > opponentScore
      ) {
        data.tactics.mentality =
          "defensive";

        data.tactics.pressing =
          "medium";

        data.tactics.tempo =
          "slow";
      }
    };

    update("home", this.homeTeam);
    update("away", this.awayTeam);
  }

  updatePlayers(dt) {
    ["home", "away"].forEach((team) => {
      const opponents =
        this.getAllOpponents(team);

      const teamData =
        team === "home"
          ? this.homeTeam
          : this.awayTeam;

      this.getActivePlayers(team).forEach(
        (player) => {
          let target;

          if (
            this.ball.ownerId === player.id
          ) {
            target =
              this.getCarrierTarget(
                player,
                teamData
              );
          } else if (
            this.ball.ownerTeam ===
            (team === "home"
              ? "away"
              : "home")
          ) {
            target =
              this.getDefensiveTarget(
                player,
                opponents,
                teamData
              );
          } else {
            target =
              this.getAttackingSupportTarget(
                player,
                teamData
              );
          }

          if (
            player.position
              ?.toUpperCase()
              .includes("GK")
          ) {
            target =
              this.getGoalkeeperTarget(
                player,
                team
              );
          }

          this.movePlayer(
            player,
            target,
            dt
          );
        }
      );
    });
  }

  getCarrierTarget(player, teamData) {
    const direction =
      player.team === "home" ? 1 : -1;

    const goalX =
      player.team === "home"
        ? PITCH.width - 20
        : 20;

    const distGoal =
      Math.abs(goalX - player.x);

    const pressure =
      this.getPressure(player);

    if (
      distGoal < 245 &&
      pressure < 0.35 &&
      rating(player, "shooting") > 55
    ) {
      return {
        x: goalX,
        y:
          PITCH.height / 2 +
          random(-45, 45),
      };
    }

    const forward =
      player.x +
      direction *
        (90 +
          rating(
            player,
            "dribbling"
          ));

    return {
      x: clamp(
        forward,
        25,
        PITCH.width - 25
      ),

      y: clamp(
        player.y +
          random(-35, 35),
        25,
        PITCH.height - 25
      ),
    };
  }

  getDefensiveTarget(
    player,
    opponents,
    teamData
  ) {
    const direction =
      player.team === "home" ? 1 : -1;

    const ballX = this.ball.x;
    const ballY = this.ball.y;

    const distanceBall =
      distance(player, {
        x: ballX,
        y: ballY,
      });

    const pressing =
      teamData.tactics.pressing;

    const pressDistance =
      pressing === "high"
        ? 180
        : pressing === "medium"
        ? 120
        : 80;

    const closest =
      [...this.getActivePlayers(player.team)]
        .sort(
          (a, b) =>
            distance(a, this.ball) -
            distance(b, this.ball)
        )
        .slice(0, 3);

    if (
      distanceBall <
        pressDistance &&
      closest.some(
        (p) => p.id === player.id
      )
    ) {
      return {
        x: ballX,
        y: ballY,
      };
    }

    const threat =
      opponents
        .filter((op) => {
          if (!op.active || op.red) {
            return false;
          }

          const towardGoal =
            direction *
            (op.x - player.x);

          return towardGoal > -20;
        })
        .sort(
          (a, b) =>
            distance(player, a) -
            distance(player, b)
        )[0];

    if (
      threat &&
      getRoleGroup(player.position) !==
        "ATT"
    ) {
      return {
        x:
          threat.x -
          direction * 22,

        y: threat.y,
      };
    }

    return this.getFormationShiftedPosition(
      player,
      teamData
    );
  }

  getAttackingSupportTarget(
    player,
    teamData
  ) {
    const direction =
      player.team === "home" ? 1 : -1;

    const ballShift =
      (this.ball.x -
        PITCH.width / 2) *
      0.20;

    const attackFactor =
      MENTALITY[
        teamData.tactics.mentality
      ]?.attack || 1;

    const role =
      getRoleGroup(player.position);

    let push = 0;

    if (role === "ATT") {
      push = 95 * attackFactor;
    } else if (role === "MID") {
      push = 35 * attackFactor;
    } else {
      push = -15;
    }

    return {
      x: clamp(
        player.homeX +
          direction * push +
          ballShift,
        20,
        PITCH.width - 20
      ),

      y: clamp(
        player.homeY +
          (this.ball.y -
            PITCH.height / 2) *
            0.18,
        20,
        PITCH.height - 20
      ),
    };
  }

  getFormationShiftedPosition(
    player,
    teamData
  ) {
    const direction =
      player.team === "home" ? 1 : -1;

    const lineShift =
      MENTALITY[
        teamData.tactics.mentality
      ]?.defensiveLine || 0;

    const ballInfluence =
      (this.ball.x -
        PITCH.width / 2) *
      0.12;

    return {
      x: clamp(
        player.homeX +
          direction *
            lineShift +
          ballInfluence,
        20,
        PITCH.width - 20
      ),

      y: clamp(
        player.homeY +
          (this.ball.y -
            PITCH.height / 2) *
            0.10,
        20,
        PITCH.height - 20
      ),
    };
  }

  getGoalkeeperTarget(
    player,
    team
  ) {
    const goalX =
      team === "home"
        ? 42
        : PITCH.width - 42;

    const direction =
      team === "home" ? 1 : -1;

    let x =
      goalX +
      direction *
        clamp(
          Math.abs(
            this.ball.x - goalX
          ) * 0.10,
          0,
          35
        );

    let y = this.ball.y;

    if (
      Math.abs(
        this.ball.x - goalX
      ) > 260
    ) {
      y =
        PITCH.height / 2;
    }

    return {
      x: clamp(
        x,
        team === "home" ? 25 : PITCH.width - 90,
        team === "home" ? 90 : PITCH.width - 25
      ),

      y: clamp(
        y,
        190,
        490
      ),
    };
  }

  movePlayer(
    player,
    target,
    dt
  ) {
    if (!target) return;

    const dx =
      target.x - player.x;

    const dy =
      target.y - player.y;

    const dist =
      Math.hypot(dx, dy);

    if (dist < 2) {
      player.vx *= 0.85;
      player.vy *= 0.85;
      return;
    }

    const staminaFactor =
      0.55 +
      player.stamina / 200;

    const maxSpeed =
      PLAYER.baseSpeed +
      player.speed * 0.65;

    const desiredSpeed =
      maxSpeed *
      staminaFactor;

    const desiredVx =
      (dx / dist) *
      desiredSpeed;

    const desiredVy =
      (dy / dist) *
      desiredSpeed;

    player.vx +=
      (desiredVx - player.vx) *
      clamp(
        PLAYER.acceleration *
          dt /
          100,
        0,
        1
      );

    player.vy +=
      (desiredVy - player.vy) *
      clamp(
        PLAYER.acceleration *
          dt /
          100,
        0,
        1
      );

    player.x +=
      player.vx * dt;

    player.y +=
      player.vy * dt;

    player.x = clamp(
      player.x,
      PLAYER.radius,
      PITCH.width -
        PLAYER.radius
    );

    player.y = clamp(
      player.y,
      PLAYER.radius,
      PITCH.height -
        PLAYER.radius
    );

    player.sprinting =
      Math.hypot(
        player.vx,
        player.vy
      ) >
      PLAYER.baseSpeed * 0.85;

    if (
      this.ball.ownerId === player.id
    ) {
      this.ball.x =
        player.x +
        (player.team === "home"
          ? 11
          : -11);

      this.ball.y =
        player.y;
    }
  }

  runDecisions(dt) {
    this.lastDecision += dt;

    if (
      this.lastDecision <
      MATCH.playerDecisionInterval
    ) {
      return;
    }

    this.lastDecision = 0;

    const owner =
      this.getPlayerById(
        this.ball.ownerId
      );

    if (!owner) return;

    this.decideWithBall(owner);
  }

  decideWithBall(player) {
    if (!player.active || player.red) {
      return;
    }

    const pressure =
      this.getPressure(player);

    const team =
      player.team;

    const goalX =
      team === "home"
        ? PITCH.width
        : 0;

    const goalDistance =
      Math.abs(
        goalX - player.x
      );

    const shooting =
      rating(player, "shooting");

    const decision =
      rating(
        player,
        "decisionMaking"
      );

    const passing =
      rating(player, "passing");

    const vision =
      rating(player, "vision");

    const composure =
      rating(player, "composure");

    const defenders =
      this.getAllOpponents(team);

    const nearestDefender =
      [...defenders].sort(
        (a, b) =>
          distance(player, a) -
          distance(player, b)
      )[0];

    const pressureValue =
      nearestDefender
        ? clamp(
            1 -
              distance(
                player,
                nearestDefender
              ) /
                140,
            0,
            1
          )
        : 0;

    const shootingChance =
      goalDistance < 260
        ? 0.25 +
          shooting / 180 +
          decision / 250 -
          pressureValue * 0.25
        : 0;

    if (
      shootingChance > 0.62 &&
      chance(
        shootingChance *
          (0.65 +
            composure / 300)
      )
    ) {
      this.shoot(player);
      return;
    }

    const passTarget =
      this.findBestPassTarget(
        player
      );

    const passScore =
      passTarget?.score || 0;

    if (
      passTarget &&
      (
        pressure > 0.45 ||
        passScore >
          0.68 ||
        passing > 75
      )
    ) {
      this.pass(
        player,
        passTarget.player
      );

      return;
    }

    const direction =
      team === "home" ? 1 : -1;

    player.x +=
      direction *
      clamp(
        18 +
          player.dribbling * 0.15,
        10,
        45
      );

    player.x = clamp(
      player.x,
      20,
      PITCH.width - 20
    );
  }

  getPressure(player) {
    const opponents =
      this.getAllOpponents(
        player.team
      );

    if (!opponents.length) {
      return 0;
    }

    const nearest =
      Math.min(
        ...opponents.map((p) =>
          distance(player, p)
        )
      );

    return clamp(
      1 -
        nearest /
          PLAYER.pressureDistance,
      0,
      1
    );
  }

  findBestPassTarget(
    player
  ) {
    const teammates =
      this.getActivePlayers(
        player.team
      ).filter(
        (p) =>
          p.id !== player.id
      );

    const direction =
      player.team === "home"
        ? 1
        : -1;

    let best = null;

    teammates.forEach(
      (target) => {
        const d =
          distance(
            player,
            target
          );

        if (d < 35 || d > 470) {
          return;
        }

        const forward =
          direction *
          (target.x -
            player.x);

        const opponentDistance =
          Math.min(
            ...this.getAllOpponents(
              player.team
            ).map((op) =>
              distance(
                target,
                op
              )
            )
          );

        const openness =
          clamp(
            opponentDistance /
              150,
            0,
            1
          );

        const forwardScore =
          clamp(
            (forward + 100) /
              260,
            0,
            1
          );

        const distanceScore =
          1 -
          normalize(
            d,
            40,
            470
          );

        const passingQuality =
          rating(
            player,
            "passing"
          ) /
          100;

        const vision =
          rating(
            player,
            "vision"
          ) /
          100;

        const score =
          openness * 0.35 +
          forwardScore * 0.25 +
          distanceScore * 0.10 +
          passingQuality * 0.15 +
          vision * 0.15;

        if (
          !best ||
          score > best.score
        ) {
          best = {
            player: target,
            score,
          };
        }
      }
    );

    return best;
  }

  pass(
    passer,
    receiver
  ) {
    if (!receiver) return;

    const direction =
      passer.team === "home"
        ? 1
        : -1;

    if (
      this.isOffside(
        receiver,
        passer.team
      )
    ) {
      this.stats[
        passer.team
      ].offsides += 1;

      this.addEvent({
        type: EVENT_TYPES.OFFSIDE,
        team: passer.team,
        player: receiver,
        text: `${receiver.name} is offside`,
      });

      this.setupFreeKick(
        passer.team === "home"
          ? "away"
          : "home"
      );

      return;
    }

    passer.passes += 1;

    this.stats[
      passer.team
    ].passes += 1;

    this.releaseBall();

    const dx =
      receiver.x - passer.x;

    const dy =
      receiver.y - passer.y;

    const dist =
      Math.hypot(dx, dy);

    const passing =
      rating(
        passer,
        "passing"
      );

    const error =
      (100 - passing) *
      0.45;

    const angle =
      Math.atan2(
        dy,
        dx
      ) +
      random(
        -error / 100,
        error / 100
      );

    const speed =
      clamp(
        330 +
          passing * 3.2,
        300,
        BALL.maxPassSpeed
      );

    this.ball.vx =
      Math.cos(angle) *
      speed;

    this.ball.vy =
      Math.sin(angle) *
      speed;

    this.ball.state = "passing";

    this.ball.targetId =
      receiver.id;

    this.ball.lastTouchTeam =
      passer.team;

    this.ball.lastTouchPlayerId =
      passer.id;

    this.ball.assistCandidate =
      passer.id;

    this.lastPass = {
      passerId: passer.id,
      receiverId: receiver.id,
      team: passer.team,
      time: this.realElapsed,
    };

    this.addEvent({
      type: EVENT_TYPES.PASS,
      team: passer.team,
      player: passer,
      target: receiver,
      text: `${passer.name} passes to ${receiver.name}`,
    });
  }

  shoot(player) {
    const team =
      player.team;

    const goalX =
      team === "home"
        ? PITCH.width + 10
        : -10;

    const goalCenter =
      PITCH.height / 2;

    const targetY =
      goalCenter +
      random(-65, 65);

    const dx =
      goalX - player.x;

    const dy =
      targetY - player.y;

    const length =
      Math.hypot(dx, dy);

    const shooting =
      rating(
        player,
        "shooting"
      );

    const composure =
      rating(
        player,
        "composure"
      );

    const pressure =
      this.getPressure(player);

    const error =
      (
        1 -
        shooting / 100
      ) *
      0.30 +
      pressure *
      0.18;

    const angle =
      Math.atan2(dy, dx) +
      random(-error, error);

    const speed =
      clamp(
        480 +
          shooting * 4.0 +
          random(-70, 70),
        420,
        BALL.maxShotSpeed
      );

    const d =
      Math.abs(
        goalX - player.x
      );

    const angleFactor =
      clamp(
        1 -
          Math.abs(
            player.y -
              goalCenter
          ) /
            350,
        0.25,
        1
      );

    const xg =
      clamp(
        Math.exp(
          -d / 250
        ) *
          0.55 *
          angleFactor *
          (0.55 +
            shooting /
              180) *
          (1 -
            pressure * 0.35),
        0.01,
        0.95
      );

    this.stats[
      team
    ].shots += 1;

    this.stats[
      team
    ].xG += xg;

    player.shots += 1;

    this.releaseBall();

    this.ball.state =
      "shooting";

    this.ball.vx =
      Math.cos(angle) *
      speed;

    this.ball.vy =
      Math.sin(angle) *
      speed;

    this.ball.shotBy =
      player.id;

    this.ball.targetId = null;

    this.ball.lastTouchTeam =
      team;

    this.ball.lastTouchPlayerId =
      player.id;

    this.addEvent({
      type: EVENT_TYPES.SHOT,
      team,
      player,
      text: `${player.name} shoots`,
      xG,
    });
  }

  updateBall(dt) {
    if (
      this.ball.ownerId
    ) {
      const owner =
        this.getPlayerById(
          this.ball.ownerId
        );

      if (owner) {
        this.ball.x =
          owner.x +
          (owner.team === "home"
            ? 11
            : -11);

        this.ball.y =
          owner.y;

        this.ball.vx = 0;
        this.ball.vy = 0;

        return;
      }
    }

    this.ball.x +=
      this.ball.vx * dt;

    this.ball.y +=
      this.ball.vy * dt;

    const friction =
      this.ball.state ===
      "shooting"
        ? 0.998
        : 0.985;

    this.ball.vx *= friction;
    this.ball.vy *= friction;

    if (
      this.ball.state ===
      "passing"
    ) {
      this.checkPassReception();
      this.checkInterception();
    }

    if (
      this.ball.state ===
      "shooting"
    ) {
      this.checkGoalkeeperSave();
      this.checkGoalLine();
    }

    if (
      this.ball.state ===
      "free"
    ) {
      this.checkFreeBallPickup();
    }
  }

  checkPassReception() {
    if (!this.ball.targetId) {
      return;
    }

    const receiver =
      this.getPlayerById(
        this.ball.targetId
      );

    if (!receiver) return;

    if (
      distance(
        this.ball,
        receiver
      ) <
      BALL.controlDistance
    ) {
      this.receiveBall(receiver);
    }
  }

  checkInterception() {
    const target =
      this.getPlayerById(
        this.ball.targetId
      );

    const opponents =
      this.getAllOpponents(
        this.ball.lastTouchTeam
      );

    for (const defender of opponents) {
      if (!defender.active) continue;

      const d =
        distance(
          this.ball,
          defender
        );

      if (d < 16) {
        const interception =
          0.20 +
          rating(
            defender,
            "tackling"
          ) /
            260 +
          rating(
            defender,
            "positioning"
          ) /
            400;

        if (
          chance(
            interception
          )
        ) {
          this.givePossession(
            defender
          );

          this.stats[
            defender.team
          ].interceptions += 1;

          defender.tackles += 1;

          this.addEvent({
            type:
              EVENT_TYPES.INTERCEPTION,
            team:
              defender.team,
            player:
              defender,
            text: `${defender.name} intercepts the pass`,
          });

          return;
        }
      }
    }

    if (
      target &&
      distance(
        this.ball,
        target
      ) < 25
    ) {
      this.receiveBall(
        target
      );
    }
  }

  receiveBall(player) {
    if (!player.active || player.red) {
      return;
    }

    this.givePossession(
      player
    );

    if (
      this.lastPass &&
      this.lastPass.receiverId ===
        player.id
    ) {
      const passer =
        this.getPlayerById(
          this.lastPass.passerId
        );

      if (passer) {
        passer.completedPasses += 1;

        this.stats[
          passer.team
        ].completedPasses += 1;
      }
    }

    this.ball.targetId = null;
    this.ball.state =
      "possessed";
  }

  givePossession(
    player,
    kickoff = false
  ) {
    this.releaseBall();

    this.ball.ownerId =
      player.id;

    this.ball.ownerTeam =
      player.team;

    this.ball.state =
      "possessed";

    this.ball.lastTouchTeam =
      player.team;

    this.ball.lastTouchPlayerId =
      player.id;

    player.hasBall = true;
    player.lastTouchAt =
      this.realElapsed;

    if (kickoff) {
      this.ball.x =
        PITCH.width / 2;

      this.ball.y =
        PITCH.height / 2;
    }
  }

  releaseBall() {
    const old =
      this.getPlayerById(
        this.ball.ownerId
      );

    if (old) {
      old.hasBall = false;
    }

    this.ball.ownerId = null;
    this.ball.ownerTeam = null;
  }

  checkFreeBallPickup() {
    const players = [
      ...this.getActivePlayers("home"),
      ...this.getActivePlayers("away"),
    ];

    const nearby =
      players
        .filter(
          (p) =>
            distance(
              p,
              this.ball
            ) < 20
        )
        .sort(
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

    if (nearby) {
      this.givePossession(
        nearby
      );
    }
  }

  checkGoalkeeperSave() {
    const shotBy =
      this.getPlayerById(
        this.ball.shotBy
      );

    if (!shotBy) return;

    const defending =
      shotBy.team === "home"
        ? "away"
        : "home";

    const goalkeeper =
      this.getActivePlayers(
        defending
      ).find(
        (p) =>
          getRoleGroup(
            p.position
          ) === "GK"
      );

    if (!goalkeeper) return;

    const goalX =
      defending === "home"
        ? 42
        : PITCH.width - 42;

    const nearGoal =
      Math.abs(
        this.ball.x - goalX
      ) < 210;

    if (!nearGoal) return;

    const saveDistance =
      distance(
        goalkeeper,
        this.ball
      );

    if (saveDistance > 32) {
      return;
    }

    const shotSpeed =
      Math.hypot(
        this.ball.vx,
        this.ball.vy
      );

    const keeperQuality =
      avg(
        rating(
          goalkeeper,
          "reaction"
        ),
        rating(
          goalkeeper,
          "diving"
        ),
        rating(
          goalkeeper,
          "positioning"
        )
      );

    const difficulty =
      clamp(
        shotSpeed / 900,
        0.2,
        1
      );

    const saveProbability =
      0.62 +
      keeperQuality / 230 -
      difficulty * 0.55;

    if (
      chance(
        saveProbability
      )
    ) {
      this.stats[
        defending
      ].saves += 1;

      this.stats[
        shotBy.team
      ].shotsOnTarget += 1;

      shotBy.shotsOnTarget += 1;

      const catchChance =
        0.35 +
        rating(
          goalkeeper,
          "handling"
        ) /
          180 -
        difficulty * 0.25;

      if (
        chance(catchChance)
      ) {
        this.givePossession(
          goalkeeper
        );

        this.ball.state =
          "possessed";
      } else {
        this.ball.state =
          "free";

        this.ball.vx *= -0.25;
        this.ball.vy *= -0.25;

        this.ball.shotBy = null;
      }

      this.addEvent({
        type: EVENT_TYPES.SAVE,
        team: defending,
        player: goalkeeper,
        text: `${goalkeeper.name} makes a save`,
      });
    }
  }

  checkGoalLine() {
    if (
      this.ball.state !==
      "shooting"
    ) {
      return;
    }

    const goalTop =
      PITCH.height / 2 -
      PITCH.goalWidth / 2;

    const goalBottom =
      PITCH.height / 2 +
      PITCH.goalWidth / 2;

    if (
      this.ball.y < goalTop ||
      this.ball.y > goalBottom
    ) {
      return;
    }

    const shotBy =
      this.getPlayerById(
        this.ball.shotBy
      );

    if (!shotBy) return;

    const crossed =
      shotBy.team === "home"
        ? this.ball.x >=
          PITCH.width
        : this.ball.x <= 0;

    if (!crossed) return;

    this.goal(
      shotBy.team,
      shotBy
    );
  }

  goal(
    team,
    scorer
  ) {
    if (this.finished) return;

    this.score[team] += 1;

    this.stats[
      team
    ].goals += 1;

    scorer.goals += 1;

    const assist =
      this.getAssistPlayer(
        scorer
      );

    if (assist) {
      assist.assists += 1;

      this.stats[
        team
      ].assists += 1;
    }

    this.stats[
      team
    ].shotsOnTarget += 1;

    scorer.shotsOnTarget += 1;

    this.addEvent({
      type: EVENT_TYPES.GOAL,
      team,
      player: scorer,
      assist,
      text: assist
        ? `GOAL! ${scorer.name} scores. Assist: ${assist.name}`
        : `GOAL! ${scorer.name} scores`,
    });

    this.ball.state =
      "goal";

    this.releaseBall();

    const conceding =
      team === "home"
        ? "away"
        : "home";

    this.setPiece = {
      type: "kickoff",
      team: conceding,
      timer: 1.0,
    };
  }

  getAssistPlayer(
    scorer
  ) {
    if (!this.lastPass) {
      return null;
    }

    if (
      this.lastPass.team !==
      scorer.team
    ) {
      return null;
    }

    if (
      this.realElapsed -
        this.lastPass.time >
      7
    ) {
      return null;
    }

    const passer =
      this.getPlayerById(
        this.lastPass.passerId
      );

    if (
      !passer ||
      passer.id === scorer.id
    ) {
      return null;
    }

    return passer;
  }

  checkTackles() {
    const home =
      this.getActivePlayers(
        "home"
      );

    const away =
      this.getActivePlayers(
        "away"
      );

    const groups = [
      [home, away],
      [away, home],
    ];

    groups.forEach(
      ([defenders, attackers]) => {
        defenders.forEach(
          (defender) => {
            const carrier =
              attackers.find(
                (attacker) =>
                  attacker.id ===
                    this.ball.ownerId &&
                  distance(
                    defender,
                    attacker
                  ) <
                    PLAYER.tackleDistance
              );

            if (!carrier) return;

            if (
              defender.position
                ?.toUpperCase()
                .includes("GK")
            ) {
              return;
            }

            const tackle =
              0.25 +
              rating(
                defender,
                "tackling"
              ) /
                190 -
              rating(
                carrier,
                "dribbling"
              ) /
                500;

            if (
              !chance(
                tackle
              )
            ) {
              return;
            }

            defender.tackles += 1;

            this.stats[
              defender.team
            ].tackles += 1;

            if (
              chance(
                0.055 +
                  (100 -
                    rating(
                      defender,
                      "tackling"
                    )) /
                    1500
              )
            ) {
              this.commitFoul(
                defender,
                carrier
              );

              return;
            }

            this.givePossession(
              defender
            );

            this.addEvent({
              type:
                EVENT_TYPES.TACKLE,
              team:
                defender.team,
              player:
                defender,
              target:
                carrier,
              text: `${defender.name} wins the ball from ${carrier.name}`,
            });
          }
        );
      }
    );
  }

  commitFoul(
    defender,
    victim
  ) {
    defender.fouls += 1;

    this.stats[
      defender.team
    ].fouls += 1;

    const yellow =
      chance(
        0.12 +
          (
            100 -
            rating(
              defender,
              "tackling"
            )
          ) /
            600
      );

    this.addEvent({
      type: EVENT_TYPES.FOUL,
      team: defender.team,
      player: defender,
      target: victim,
      text: `${defender.name} commits a foul`,
    });

    if (yellow) {
      if (defender.yellow) {
        defender.red = true;

        defender.active = false;

        this.stats[
          defender.team
        ].redCards += 1;

        this.addEvent({
          type: EVENT_TYPES.RED,
          team: defender.team,
          player: defender,
          text: `${defender.name} is sent off`,
        });
      } else {
        defender.yellow = true;

        this.stats[
          defender.team
        ].yellowCards += 1;

        this.addEvent({
          type:
            EVENT_TYPES.YELLOW,
          team: defender.team,
          player: defender,
          text: `${defender.name} receives a yellow card`,
        });
      }
    }

    this.setupFreeKick(
      victim.team
    );
  }

  setupFreeKick(team) {
    const players =
      this.getActivePlayers(team);

    const kicker =
      players
        .filter(
          (p) =>
            getRoleGroup(
              p.position
            ) !== "GK"
        )
        .sort(
          (a, b) =>
            rating(
              b,
              "passing"
            ) -
            rating(
              a,
              "passing"
            )
        )[0];

    if (!kicker) return;

    this.givePossession(
      kicker
    );

    this.ball.state =
      "possessed";
  }

  checkBoundaries() {
    if (
      this.ball.state ===
        "possessed" ||
      this.ball.state ===
        "goal"
    ) {
      return;
    }

    const outsideLeft =
      this.ball.x < 0;

    const outsideRight =
      this.ball.x >
      PITCH.width;

    const outsideTop =
      this.ball.y < 0;

    const outsideBottom =
      this.ball.y >
      PITCH.height;

    if (
      !outsideLeft &&
      !outsideRight &&
      !outsideTop &&
      !outsideBottom
    ) {
      return;
    }

    const lastTeam =
      this.ball.lastTouchTeam;

    if (
      outsideTop ||
      outsideBottom
    ) {
      const throwTeam =
        lastTeam === "home"
          ? "away"
          : "home";

      this.stats[
        throwTeam
      ].throwIns += 1;

      this.addEvent({
        type:
          EVENT_TYPES.THROW_IN,
        team: throwTeam,
        text: `${throwTeam === "home"
          ? this.homeTeam.name
          : this.awayTeam.name} throw-in`,
      });

      this.restartThrowIn(
        throwTeam
      );

      return;
    }

    const attackingTeam =
      lastTeam;

    const defendingTeam =
      attackingTeam === "home"
        ? "away"
        : "home";

    if (
      outsideLeft ||
      outsideRight
    ) {
      const isHomeGoal =
        outsideLeft;

      const defendingOwnGoal =
        defendingTeam ===
        "home"
          ? isHomeGoal
          : !isHomeGoal;

      if (
        defendingOwnGoal
      ) {
        this.stats[
          attackingTeam
        ].corners += 1;

        this.addEvent({
          type:
            EVENT_TYPES.CORNER,
          team:
            attackingTeam,
          text: `${
            attackingTeam ===
            "home"
              ? this.homeTeam.name
              : this.awayTeam.name
          } corner`,
        });

        this.restartCorner(
          attackingTeam,
          isHomeGoal
        );
      } else {
        this.stats[
          defendingTeam
        ].goalKicks += 1;

        this.addEvent({
          type:
            EVENT_TYPES.GOAL_KICK,
          team:
            defendingTeam,
          text: `${
            defendingTeam ===
            "home"
              ? this.homeTeam.name
              : this.awayTeam.name
          } goal kick`,
        });

        this.restartGoalKick(
          defendingTeam
        );
      }
    }
  }

  restartThrowIn(team) {
    const player =
      this.getActivePlayers(
        team
      )
        .filter(
          (p) =>
            getRoleGroup(
              p.position
            ) !== "GK"
        )
        .sort(
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

    if (!player) return;

    player.x = clamp(
      this.ball.x,
      25,
      PITCH.width - 25
    );

    player.y =
      this.ball.y < 0
        ? 15
        : PITCH.height - 15;

    this.givePossession(
      player
    );
  }

  restartCorner(
    team,
    leftSide
  ) {
    const player =
      this.getActivePlayers(
        team
      )
        .filter(
          (p) =>
            getRoleGroup(
              p.position
            ) !== "GK"
        )
        .sort(
          (a, b) =>
            rating(
              b,
              "passing"
            ) -
            rating(
              a,
              "passing"
            )
        )[0];

    if (!player) return;

    player.x =
      team === "home"
        ? PITCH.width - 12
        : 12;

    player.y =
      leftSide
        ? 12
        : PITCH.height - 12;

    this.givePossession(
      player
    );

    this.ball.state =
      "possessed";

    this.lastDecision = -0.3;
  }

  restartGoalKick(team) {
    const goalkeeper =
      this.getActivePlayers(
        team
      ).find(
        (p) =>
          getRoleGroup(
            p.position
          ) === "GK"
      );

    if (!goalkeeper) return;

    goalkeeper.x =
      team === "home"
        ? 65
        : PITCH.width - 65;

    goalkeeper.y =
      PITCH.height / 2;

    this.givePossession(
      goalkeeper
    );
  }

  isOffside(
    receiver,
    team
  ) {
    const direction =
      team === "home" ? 1 : -1;

    const attackingHalf =
      team === "home"
        ? receiver.x >
          PITCH.width / 2
        : receiver.x <
          PITCH.width / 2;

    if (!attackingHalf) {
      return false;
    }

    const opponents =
      this.getAllOpponents(
        team
      );

    const sorted =
      opponents
        .filter(
          (p) =>
            getRoleGroup(
              p.position
            ) !== "GK" ||
            true
        )
        .sort(
          (a, b) =>
            direction *
            (a.x - b.x)
        );

    if (sorted.length < 2) {
      return false;
    }

    const secondLast =
      sorted[1];

    const ballAhead =
      direction *
        (receiver.x -
          this.ball.x) >
      0;

    const defenderAhead =
      direction *
        (receiver.x -
          secondLast.x) >
      0;

    return (
      ballAhead &&
      defenderAhead
    );
  }

  runSubstitutions() {
    if (
      this.minute < 55 ||
      this.minute >
        88
    ) {
      return;
    }

    if (
      this.realElapsed -
        this.lastSubstitutionCheck <
      8
    ) {
      return;
    }

    this.lastSubstitutionCheck =
      this.realElapsed;

    ["home", "away"].forEach(
      (team) => {
        const used =
          this.getSubstitutionCount(
            team
          );

        if (used >= 5) return;

        const active =
          this.getActivePlayers(
            team
          );

        const bench =
          this.bench[team].filter(
            (p) =>
              !p.active &&
              !p.red
          );

        if (!bench.length) {
          return;
        }

        const tired =
          active
            .filter(
              (p) =>
                getRoleGroup(
                  p.position
                ) !== "GK"
            )
            .sort(
              (a, b) =>
                a.stamina -
                b.stamina
            )[0];

        if (
          !tired ||
          tired.stamina > 30
        ) {
          return;
        }

        const replacement =
          bench.find(
            (p) =>
              getRoleGroup(
                p.position
              ) ===
              getRoleGroup(
                tired.position
              )
          ) ||
          bench[0];

        this.makeSubstitution(
          team,
          tired,
          replacement
        );
      }
    );
  }

  getSubstitutionCount(team) {
    return this.events.filter(
      (event) =>
        event.type ===
          EVENT_TYPES.SUBSTITUTION &&
        event.team === team
    ).length;
  }

  makeSubstitution(
    team,
    outgoing,
    incoming
  ) {
    if (!outgoing || !incoming) {
      return;
    }

    const index =
      this.players[team].findIndex(
        (p) =>
          p.id === outgoing.id
      );

    if (index < 0) return;

    incoming.active = true;
    incoming.red = false;
    incoming.yellow = false;

    incoming.x =
      outgoing.x;

    incoming.y =
      outgoing.y;

    incoming.homeX =
      outgoing.homeX;

    incoming.homeY =
      outgoing.homeY;

    incoming.role =
      outgoing.role;

    outgoing.active = false;
    outgoing.hasBall = false;

    if (
      this.ball.ownerId ===
      outgoing.id
    ) {
      this.givePossession(
        incoming
      );
    }

    const benchIndex =
      this.bench[
        team
      ].findIndex(
        (p) =>
          p.id === incoming.id
      );

    if (benchIndex >= 0) {
      this.bench[
        team
      ].splice(
        benchIndex,
        1
      );
    }

    this.addEvent({
      type:
        EVENT_TYPES.SUBSTITUTION,
      team,
      player: incoming,
      outgoing,
      text: `${incoming.name} replaces ${outgoing.name}`,
    });
  }

  handleHalfTime() {
    if (
      this.minute === 45 &&
      !this.events.some(
        (e) =>
          e.type ===
          EVENT_TYPES.HALFTIME
      )
    ) {
      this.addEvent({
        type:
          EVENT_TYPES.HALFTIME,
        text: "Half-time",
      });
    }
  }

  finishMatch() {
    if (this.finished) return;

    this.finished = true;
    this.running = false;

    this.minute = 90;
    this.second = 5400;

    this.addEvent({
      type:
        EVENT_TYPES.FULLTIME,
      text: `Full-time: ${this.homeTeam.name} ${this.score.home}-${this.score.away} ${this.awayTeam.name}`,
    });
  }

  addEvent(data) {
    const event = {
      id:
        `${this.realElapsed}-${Math.random()
          .toString(36)
          .slice(2)}`,

      minute: Math.floor(
        this.minute
      ),

      second: Math.floor(
        this.second % 60
      ),

      timestamp:
        Date.now(),

      type:
        data.type,

      team:
        data.team || null,

      playerId:
        data.player?.id || null,

      playerName:
        data.player?.name || null,

      playerNumber:
        data.player?.number || null,

      targetId:
        data.target?.id || null,

      targetName:
        data.target?.name || null,

      assistId:
        data.assist?.id || null,

      assistName:
        data.assist?.name || null,

      outgoingId:
        data.outgoing?.id || null,

      outgoingName:
        data.outgoing?.name || null,

      text:
        data.text || "",

      xG:
        Number(data.xG || 0),
    };

    this.events.push(event);

    if (
      this.events.length >
      300
    ) {
      this.events =
        this.events.slice(-300);
    }

    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  getPossessionPercent(team) {
    const total =
      this.possessionSeconds.home +
      this.possessionSeconds.away;

    if (!total) {
      return 50;
    }

    return (
      this.possessionSeconds[
        team
      ] /
        total *
      100
    );
  }

  getSnapshot() {
    return {
      matchId:
        this.matchId,

      running:
        this.running,

      finished:
        this.finished,

      minute:
        this.minute,

      second:
        Math.floor(
          this.second % 60
        ),

      score: {
        ...this.score,
      },

      teams: {
        home: {
          id:
            this.homeTeam.id,
          name:
            this.homeTeam.name,
          logo:
            this.homeTeam.logo,
          formation:
            this.homeTeam.formation,
          tactics:
            {
              ...this.homeTeam.tactics,
            },
        },

        away: {
          id:
            this.awayTeam.id,
          name:
            this.awayTeam.name,
          logo:
            this.awayTeam.logo,
          formation:
            this.awayTeam.formation,
          tactics:
            {
              ...this.awayTeam.tactics,
            },
        },
      },

      players: {
        home:
          this.getActivePlayers(
            "home"
          ).map((p) =>
            this.publicPlayer(p)
          ),

        away:
          this.getActivePlayers(
            "away"
          ).map((p) =>
            this.publicPlayer(p)
          ),
      },

      bench: {
        home:
          this.bench.home.map((p) =>
            this.publicPlayer(p)
          ),

        away:
          this.bench.away.map((p) =>
            this.publicPlayer(p)
          ),
      },

      ball: {
        ...this.ball,
      },

      stats: {
        home: {
          ...this.stats.home,
          possession:
            this.getPossessionPercent(
              "home"
            ),
        },

        away: {
          ...this.stats.away,
          possession:
            this.getPossessionPercent(
              "away"
            ),
        },
      },

      events:
        this.events.slice(-80),
    };
  }

  publicPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      number: player.number,
      position: player.position,
      role: player.role,

      team: player.team,

      x: player.x,
      y: player.y,

      vx: player.vx,
      vy: player.vy,

      stamina:
        player.stamina,

      hasBall:
        player.hasBall,

      yellow:
        player.yellow,

      red:
        player.red,

      goals:
        player.goals,

      assists:
        player.assists,

      shots:
        player.shots,

      shotsOnTarget:
        player.shotsOnTarget,

      passes:
        player.passes,

      completedPasses:
        player.completedPasses,

      tackles:
        player.tackles,
    };
  }

  getResult() {
    return {
      matchId:
        this.matchId,

      status:
        "finished",

      minute: 90,

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

      stats: {
        home: {
          ...this.stats.home,
          possession:
            this.getPossessionPercent(
              "home"
            ),
        },

        away: {
          ...this.stats.away,
          possession:
            this.getPossessionPercent(
              "away"
            ),
        },
      },

      events:
        this.events,

      players: {
        home:
          this.players.home.map(
            (p) => ({
              id: p.id,
              name: p.name,
              number: p.number,
              goals: p.goals,
              assists: p.assists,
              shots: p.shots,
              shotsOnTarget:
                p.shotsOnTarget,
              passes: p.passes,
              completedPasses:
                p.completedPasses,
              tackles: p.tackles,
              yellow: p.yellow,
              red: p.red,
            })
          ),

        away:
          this.players.away.map(
            (p) => ({
              id: p.id,
              name: p.name,
              number: p.number,
              goals: p.goals,
              assists: p.assists,
              shots: p.shots,
              shotsOnTarget:
                p.shotsOnTarget,
              passes: p.passes,
              completedPasses:
                p.completedPasses,
              tackles: p.tackles,
              yellow: p.yellow,
              red: p.red,
            })
          ),
      },

      result:
        this.score.home >
        this.score.away
          ? "H"
          : this.score.home <
            this.score.away
          ? "A"
          : "D",
    };
  }
}
