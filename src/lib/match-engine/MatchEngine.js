// lib/match-engine/MatchEngine.js

import {
  FIELD,
  MATCH,
  FORMATIONS,
  DEFAULT_TACTICS,
  MENTALITY,
  clamp,
  random,
  randomInt,
  distance,
  teamDirection,
} from "./constants";

function num(value, fallback = 50) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePosition(position) {
  const p = String(position || "").toUpperCase();

  if (
    p.includes("GK") ||
    p.includes("KEEPER")
  ) {
    return "GK";
  }

  if (
    ["CB", "DC", "LB", "RB", "LWB", "RWB", "DF", "DEF"].includes(p)
  ) {
    return p;
  }

  if (
    ["CM", "CDM", "CAM", "LM", "RM", "DM", "AM", "MF"].includes(p)
  ) {
    return p;
  }

  if (
    ["ST", "CF", "LW", "RW", "LF", "RF", "FW"].includes(p)
  ) {
    return p;
  }

  return "CM";
}

function makeStats() {
  return {
    possessionSeconds: 0,

    passes: 0,
    completedPasses: 0,

    shots: 0,
    shotsOnTarget: 0,

    goals: 0,
    assists: 0,

    tackles: 0,
    interceptions: 0,

    saves: 0,

    corners: 0,
    throwIns: 0,
    goalKicks: 0,

    fouls: 0,
    offsides: 0,

    yellowCards: 0,
    redCards: 0,

    xg: 0,
  };
}

function makePlayer(raw, team, index) {
  const overall = num(
    raw.overall ?? raw.rating ?? raw.ova,
    65
  );

  const speed = num(
    raw.speed ?? raw.pace ?? raw.acceleration,
    65
  );

  const shooting = num(
    raw.shooting ?? raw.shoot ?? raw.finishing,
    55
  );

  const passing = num(
    raw.passing ?? raw.pass,
    55
  );

  const dribbling = num(
    raw.dribbling ?? raw.dribble,
    55
  );

  const tackling = num(
    raw.tackling ?? raw.defending ?? raw.defense,
    50
  );

  const positioning = num(
    raw.positioning ?? raw.pos,
    55
  );

  const vision = num(
    raw.vision,
    55
  );

  const decisionMaking = num(
    raw.decisionMaking ?? raw.decisions,
    55
  );

  const composure = num(
    raw.composure,
    55
  );

  return {
    id:
      raw.id ||
      raw.playerId ||
      `${team}-${index}`,

    name:
      raw.name ||
      raw.fullName ||
      raw.displayName ||
      `Player ${index + 1}`,

    number:
      Number(
        raw.shirtNumber ??
        raw.number ??
        raw.jerseyNumber ??
        index + 1
      ),

    team,

    position: normalizePosition(
      raw.position ??
      raw.pos ??
      raw.role
    ),

    role:
      raw.role ||
      normalizePosition(
        raw.position
      ),

    overall,

    speed,
    acceleration: num(raw.acceleration, speed),

    stamina: num(raw.stamina, 90),

    passing,
    shooting,
    dribbling,
    tackling,

    positioning,
    vision,
    decisionMaking,
    composure,

    reaction: num(raw.reaction, overall),
    handling: num(raw.handling, overall),
    diving: num(raw.diving, overall),
    catching: num(raw.catching, overall),
    parrying: num(raw.parrying, overall),

    x: FIELD.centerX,
    y: FIELD.centerY,

    vx: 0,
    vy: 0,

    targetX: FIELD.centerX,
    targetY: FIELD.centerY,

    hasBall: false,

    active: true,
    sentOff: false,

    yellowCards: 0,

    performance: 6.5,

    passes: 0,
    completedPasses: 0,
    shots: 0,
    goals: 0,
    assists: 0,
    tackles: 0,
    saves: 0,
  };
}

export default class MatchEngine {
  constructor({
    matchId,
    homeTeam,
    awayTeam,
    homePlayers,
    awayPlayers,
    homeFormation = "4-3-3",
    awayFormation = "4-3-3",
    homeTactics = {},
    awayTactics = {},
    initialHomeScore = 0,
    initialAwayScore = 0,
    initialMinute = 0,
  }) {
    this.matchId = matchId;

    this.homeTeam = {
      ...homeTeam,
      id: homeTeam?.id || "home",
      name: homeTeam?.name || "Home",
      tactics: {
        ...DEFAULT_TACTICS,
        ...homeTactics,
      },
      formation: FORMATIONS[homeFormation]
        ? homeFormation
        : "4-3-3",
    };

    this.awayTeam = {
      ...awayTeam,
      id: awayTeam?.id || "away",
      name: awayTeam?.name || "Away",
      tactics: {
        ...DEFAULT_TACTICS,
        ...awayTactics,
      },
      formation: FORMATIONS[awayFormation]
        ? awayFormation
        : "4-3-3",
    };

    this.players = [
      ...homePlayers.map((p, i) =>
        makePlayer(p, "home", i)
      ),
      ...awayPlayers.map((p, i) =>
        makePlayer(p, "away", i)
      ),
    ];

    this.bench = {
      home: [],
      away: [],
    };

    this.stats = {
      home: makeStats(),
      away: makeStats(),
    };

    this.score = {
      home: initialHomeScore,
      away: initialAwayScore,
    };

    this.minute = initialMinute;
    this.matchSeconds =
      initialMinute * 60;

    this.realElapsed = 0;

    this.status = "live";

    this.events = [];

    this.ball = {
      x: FIELD.centerX,
      y: FIELD.centerY,

      vx: 0,
      vy: 0,

      state: "possessed",

      ownerId: null,

      targetId: null,

      lastTouchTeam: "home",
      lastTouchPlayerId: null,

      action: null,

      shotXg: 0,
    };

    this.possessionTeam = "home";

    this.lastDecision = 0;
    this.lastTacticalUpdate = 0;
    this.lastSubstitutionCheck = 0;

    this.lastPass = null;

    this.pendingRestart = null;

    this.halfTimeShown = false;

    this.nextEventId = 1;

    this.initializeTeams();
  }

  initializeTeams() {
    this.applyFormation(
      "home",
      this.homeTeam.formation
    );

    this.applyFormation(
      "away",
      this.awayTeam.formation
    );

    this.createBenches();

    const kickoff =
      this.getActivePlayers("home")
        .sort(
          (a, b) =>
            distance(
              a,
              {
                x: FIELD.centerX,
                y: FIELD.centerY,
              }
            ) -
            distance(
              b,
              {
                x: FIELD.centerX,
                y: FIELD.centerY,
              }
            )
        )[0];

    if (kickoff) {
      this.giveBall(kickoff);
    }
  }

  getActivePlayers(team) {
    return this.players.filter(
      (p) =>
        p.team === team &&
        p.active &&
        !p.sentOff
    );
  }

  getPlayer(id) {
    return this.players.find(
      (p) => p.id === id
    );
  }

  createBenches() {
    for (const team of ["home", "away"]) {
      const active = this.getActivePlayers(team);

      const all = team === "home"
        ? this.homeTeam.allPlayers || []
        : this.awayTeam.allPlayers || [];

      const activeIds = new Set(
        active.map((p) => p.id)
      );

      this.bench[team] = all
        .filter(
          (raw) =>
            !activeIds.has(
              raw.id ||
              raw.playerId
            )
        )
        .slice(0, 7)
        .map((raw, index) =>
          makePlayer(
            raw,
            team,
            20 + index
          )
        );
    }

    if (
      this.bench.home.length === 0
    ) {
      this.bench.home =
        this.createFallbackBench("home");
    }

    if (
      this.bench.away.length === 0
    ) {
      this.bench.away =
        this.createFallbackBench("away");
    }
  }

  createFallbackBench(team) {
    return Array.from(
      { length: 7 },
      (_, i) =>
        makePlayer(
          {
            id: `${team}-bench-${i}`,
            name: `Sub ${i + 1}`,
            number: 12 + i,
            position:
              i === 0
                ? "GK"
                : i < 3
                ? "DF"
                : i < 6
                ? "MF"
                : "FW",
            overall: 60,
          },
          team,
          30 + i
        )
    );
  }

  applyFormation(team, formationName) {
    const formation =
      FORMATIONS[formationName] ||
      FORMATIONS["4-3-3"];

    const players =
      this.getActivePlayers(team);

    const sorted =
      this.sortPlayersForFormation(
        players,
        formation
      );

    sorted.forEach((player, index) => {
      const slot =
        formation[index];

      if (!slot) return;

      const position =
        this.getFormationPosition(
          slot,
          team
        );

      player.role = slot.role;
      player.position = slot.role;

      player.homeX = position.x;
      player.homeY = position.y;

      player.x = position.x;
      player.y = position.y;
    });
  }

  sortPlayersForFormation(
    players,
    formation
  ) {
    const groups = {
      GK: [],
      DEF: [],
      MID: [],
      ATT: [],
    };

    players.forEach((p) => {
      if (p.position === "GK") {
        groups.GK.push(p);
      } else if (
        [
          "CB",
          "LB",
          "RB",
          "LWB",
          "RWB",
          "DF",
        ].includes(p.position)
      ) {
        groups.DEF.push(p);
      } else if (
        [
          "ST",
          "CF",
          "LW",
          "RW",
          "LF",
          "RF",
          "FW",
        ].includes(p.position)
      ) {
        groups.ATT.push(p);
      } else {
        groups.MID.push(p);
      }
    });

    const result = [];

    const needGK =
      formation.filter(
        (s) => s.role === "GK"
      ).length;

    result.push(
      ...groups.GK.slice(0, needGK)
    );

    const defenderRoles =
      formation.filter(
        (s) =>
          s.role !== "GK" &&
          [
            "CB",
            "LB",
            "RB",
            "LWB",
            "RWB",
          ].includes(s.role)
      );

    result.push(
      ...groups.DEF.slice(
        0,
        defenderRoles.length
      )
    );

    const midfielderRoles =
      formation.filter(
        (s) =>
          s.role !== "GK" &&
          ![
            "CB",
            "LB",
            "RB",
            "LWB",
            "RWB",
            "ST",
            "CF",
            "LW",
            "RW",
          ].includes(s.role)
      );

    result.push(
      ...groups.MID.slice(
        0,
        midfielderRoles.length
      )
    );

    const attackers =
      formation.filter(
        (s) =>
          [
            "ST",
            "CF",
            "LW",
            "RW",
          ].includes(s.role)
      );

    result.push(
      ...groups.ATT.slice(
        0,
        attackers.length
      )
    );

    const remaining = players.filter(
      (p) => !result.includes(p)
    );

    result.push(...remaining);

    return result.slice(
      0,
      formation.length
    );
  }

  getFormationPosition(slot, team) {
    let x =
      FIELD.left +
      slot.x *
        (FIELD.right - FIELD.left);

    let y =
      FIELD.top +
      slot.y *
        (FIELD.bottom - FIELD.top);

    if (team === "away") {
      x =
        FIELD.right -
        (x - FIELD.left);
    }

    return {
      x,
      y,
    };
  }

  update(dt) {
    if (
      this.status !== "live"
    ) {
      return;
    }

    if (!Number.isFinite(dt)) {
      return;
    }

    dt = Math.min(dt, 0.05);

    this.realElapsed += dt;

    const matchSpeed =
      90 /
      MATCH.realDurationSeconds;

    this.matchSeconds +=
      dt * matchSpeed * 60;

    this.minute = Math.min(
      90,
      Math.floor(
        this.matchSeconds / 60
      )
    );

    this.trackPossession(dt);

    this.updateStamina(dt);

    this.updatePositions(dt);

    if (
      this.realElapsed -
        this.lastDecision >
      MATCH.decisionInterval
    ) {
      this.lastDecision =
        this.realElapsed;

      this.makeDecisions();
    }

    this.updateBall(dt);

    this.handlePhysicalDuels();

    if (
      this.realElapsed -
        this.lastTacticalUpdate >
      MATCH.tacticalInterval
    ) {
      this.lastTacticalUpdate =
        this.realElapsed;

      this.updateAIManager();
    }

    if (
      this.realElapsed -
        this.lastSubstitutionCheck >
      MATCH.substitutionCheckInterval
    ) {
      this.lastSubstitutionCheck =
        this.realElapsed;

      this.checkSubstitutions();
    }

    if (
      this.minute >= 45 &&
      !this.halfTimeShown
    ) {
      this.halfTimeShown = true;

      this.addEvent({
        type: "halftime",
        minute: 45,
        text: "Half Time",
      });
    }

    if (
      this.minute >= 90
    ) {
      this.finishMatch();
    }
  }

  trackPossession(dt) {
    if (
      this.possessionTeam === "home"
    ) {
      this.stats.home.possessionSeconds += dt;
    } else {
      this.stats.away.possessionSeconds += dt;
    }
  }

  updateStamina(dt) {
    for (const player of this.getAllActivePlayers()) {
      const speed =
        Math.hypot(
          player.vx,
          player.vy
        );

      const movementDrain =
        speed > 110
          ? 0.030
          : 0.010;

      const pressingDrain =
        player.isPressing
          ? 0.025
          : 0;

      player.stamina = clamp(
        player.stamina -
          dt *
            (
              movementDrain +
              pressingDrain
            ),
        20,
        100
      );
    }
  }

  getAllActivePlayers() {
    return this.players.filter(
      (p) =>
        p.active &&
        !p.sentOff
    );
  }

  updatePositions(dt) {
    const ball = this.ball;

    for (const player of this.getAllActivePlayers()) {
      let target;

      if (
        player.hasBall
      ) {
        target =
          this.getCarrierTarget(
            player
          );
      } else {
        target =
          this.getPlayerTarget(
            player
          );
      }

      if (
        player.position === "GK"
      ) {
        target =
          this.getGoalkeeperTarget(
            player
          );
      }

      player.targetX =
        target.x;

      player.targetY =
        target.y;

      this.movePlayer(
        player,
        target,
        dt
      );
    }
  }

  getCarrierTarget(player) {
    const direction =
      teamDirection(
        player.team
      );

    let x =
      player.x +
      direction * 80;

    let y =
      player.y;

    if (
      player.role === "LW" ||
      player.role === "RW"
    ) {
      y +=
        player.role === "LW"
          ? -25
          : 25;
    }

    return {
      x: clamp(
        x,
        FIELD.left + 20,
        FIELD.right - 20
      ),
      y: clamp(
        y,
        FIELD.top + 20,
        FIELD.bottom - 20
      ),
    };
  }

  getPlayerTarget(player) {
    const team =
      player.team === "home"
        ? this.homeTeam
        : this.awayTeam;

    const mentality =
      MENTALITY[
        team.tactics.mentality
      ] ||
      MENTALITY.balanced;

    const direction =
      teamDirection(
        player.team
      );

    let x =
      player.homeX;

    let y =
      player.homeY;

    const ballShift =
      (
        this.ball.x -
        FIELD.centerX
      ) * 0.12;

    const possessionBonus =
      this.possessionTeam ===
      player.team
        ? 1
        : -1;

    if (
      player.position !== "GK"
    ) {
      x +=
        ballShift *
        direction;

      y +=
        (
          this.ball.y -
          player.homeY
        ) *
        0.12;

      x +=
        mentality.line *
        direction;

      if (
        player.role === "LW" ||
        player.role === "RW" ||
        player.role === "LM" ||
        player.role === "RM"
      ) {
        y +=
          (
            team.tactics.width -
            50
          ) *
          1.1 *
          (
            player.role === "LW" ||
            player.role === "LM"
              ? -1
              : 1
          );
      }

      if (
        possessionBonus < 0 &&
        team.tactics.pressing === "high"
      ) {
        const nearest =
          this.findNearestOpponent(
            player
          );

        if (
          nearest &&
          distance(
            player,
            nearest
          ) < 230
        ) {
          player.isPressing = true;

          return {
            x: nearest.x,
            y: nearest.y,
          };
        }
      }

      player.isPressing = false;
    }

    return {
      x: clamp(
        x,
        FIELD.left + 15,
        FIELD.right - 15
      ),
      y: clamp(
        y,
        FIELD.top + 15,
        FIELD.bottom - 15
      ),
    };
  }

  getGoalkeeperTarget(player) {
    const ownGoalX =
      player.team === "home"
        ? FIELD.left
        : FIELD.right;

    let x =
      ownGoalX +
      (
        player.team === "home"
          ? 35
          : -35
      );

    let y =
      clamp(
        this.ball.y,
        FIELD.centerY - 65,
        FIELD.centerY + 65
      );

    const distanceToGoal =
      Math.abs(
        this.ball.x -
        ownGoalX
      );

    if (
      distanceToGoal < 250
    ) {
      x =
        ownGoalX +
        (
          player.team === "home"
            ? 65
            : -65
        );
    }

    return {
      x,
      y,
    };
  }

  movePlayer(player, target, dt) {
    const dx =
      target.x - player.x;

    const dy =
      target.y - player.y;

    const dist =
      Math.hypot(dx, dy);

    if (dist < 2) {
      player.vx *= 0.8;
      player.vy *= 0.8;
      return;
    }

    const staminaFactor =
      0.65 +
      player.stamina / 285;

    const maxSpeed =
      (
        55 +
        player.speed * 1.8
      ) *
      staminaFactor;

    const desiredVx =
      (
        dx / dist
      ) *
      maxSpeed;

    const desiredVy =
      (
        dy / dist
      ) *
      maxSpeed;

    const acceleration =
      220 *
      (
        player.acceleration / 100
      );

    player.vx +=
      clamp(
        desiredVx -
          player.vx,
        -acceleration * dt,
        acceleration * dt
      );

    player.vy +=
      clamp(
        desiredVy -
          player.vy,
        -acceleration * dt,
        acceleration * dt
      );

    player.x +=
      player.vx * dt;

    player.y +=
      player.vy * dt;

    this.keepPlayerOnField(
      player
    );
  }

  keepPlayerOnField(player) {
    player.x = clamp(
      player.x,
      FIELD.left + 8,
      FIELD.right - 8
    );

    player.y = clamp(
      player.y,
      FIELD.top + 8,
      FIELD.bottom - 8
    );

    if (
      player.position === "GK"
    ) {
      if (
        player.team === "home"
      ) {
        player.x = clamp(
          player.x,
          FIELD.left + 10,
          FIELD.left + 125
        );
      } else {
        player.x = clamp(
          player.x,
          FIELD.right - 125,
          FIELD.right - 10
        );
      }
    }
  }

  makeDecisions() {
    if (
      this.ball.state === "possessed"
    ) {
      const owner =
        this.getPlayer(
          this.ball.ownerId
        );

      if (owner) {
        owner.hasBall = true;

        this.decideWithBall(
          owner
        );
      }
    } else {
      this.tryLooseBallPickup();
    }
  }

  decideWithBall(player) {
    const goal =
      player.team === "home"
        ? {
            x: FIELD.right,
            y: FIELD.centerY,
          }
        : {
            x: FIELD.left,
            y: FIELD.centerY,
          };

    const distanceToGoal =
      distance(
        player,
        goal
      );

    const pressure =
      this.getPressure(player);

    const angle =
      this.getShootingAngle(
        player,
        goal
      );

    const shootingChance =
      clamp(
        (
          1 -
          distanceToGoal / 700
        ) *
        0.8 +
        angle * 0.3 -
        pressure * 0.25 +
        (
          player.shooting / 100
        ) *
        0.25,
        0,
        1
      );

    if (
      distanceToGoal < 250 &&
      Math.random() <
        shootingChance
    ) {
      this.shoot(player);
      return;
    }

    const teammate =
      this.findBestPassTarget(
        player
      );

    if (
      teammate &&
      (
        pressure > 0.55 ||
        Math.random() <
          0.55
      )
    ) {
      this.pass(
        player,
        teammate
      );

      return;
    }

    this.dribble(player);
  }

  getPressure(player) {
    const opponents =
      this.getActivePlayers(
        player.team === "home"
          ? "away"
          : "home"
      );

    if (!opponents.length) {
      return 0;
    }

    const nearest =
      Math.min(
        ...opponents.map(
          (p) =>
            distance(
              player,
              p
            )
        )
      );

    return clamp(
      1 -
        nearest / 120,
      0,
      1
    );
  }

  getShootingAngle(
    player,
    goal
  ) {
    const dx =
      Math.abs(
        goal.x - player.x
      );

    const dy =
      Math.abs(
        goal.y - player.y
      );

    return clamp(
      1 -
        dy /
          Math.max(
            dx,
            1
          ),
      0,
      1
    );
  }

  findBestPassTarget(player) {
    const teammates =
      this.getActivePlayers(
        player.team
      ).filter(
        (p) =>
          p.id !== player.id &&
          p.position !== "GK"
      );

    let best = null;
    let bestScore = -Infinity;

    const direction =
      teamDirection(
        player.team
      );

    for (const teammate of teammates) {
      const d =
        distance(
          player,
          teammate
        );

      if (
        d < 45 ||
        d > 420
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
        this.getOpponentDistance(
          teammate
        );

      const score =
        forward * 0.7 +
        openness * 0.5 +
        teammate.vision * 0.2 +
        teammate.positioning * 0.15 -
        d * 0.2 +
        random(
          -20,
          20
        );

      if (
        score > bestScore
      ) {
        bestScore = score;
        best = teammate;
      }
    }

    return best;
  }

  getOpponentDistance(player) {
    const opponents =
      this.getActivePlayers(
        player.team === "home"
          ? "away"
          : "home"
      );

    if (!opponents.length) {
      return 150;
    }

    return Math.min(
      ...opponents.map(
        (p) =>
          distance(
            player,
            p
          )
      )
    );
  }

  pass(from, to) {
    if (
      this.ball.ownerId !==
      from.id
    ) {
      return;
    }

    if (
      this.isOffside(to, from.team)
    ) {
      this.stats[
        from.team
      ].offsides += 1;

      this.addEvent({
        type: "offside",
        team: from.team,
        player: to.name,
        minute: this.minute,
        text: `${to.name} was offside`,
      });

      this.releaseBall();

      this.pendingRestart = {
        type: "offside",
        team:
          from.team === "home"
            ? "away"
            : "home",
      };

      return;
    }

    const dx =
      to.x - from.x;

    const dy =
      to.y - from.y;

    const d =
      Math.hypot(
        dx,
        dy
      );

    const accuracy =
      0.65 +
      from.passing / 350;

    const error =
      (
        1 -
        accuracy
      ) *
      d *
      0.35;

    const angle =
      Math.atan2(
        dy,
        dx
      );

    const targetX =
      to.x +
      Math.cos(
        angle + Math.PI / 2
      ) *
      random(
        -error,
        error
      );

    const targetY =
      to.y +
      Math.sin(
        angle + Math.PI / 2
      ) *
      random(
        -error,
        error
      );

    const speed =
      300 +
      from.passing * 4;

    this.stats[
      from.team
    ].passes += 1;

    from.passes += 1;

    this.lastPass = {
      passerId: from.id,
      team: from.team,
      time: this.realElapsed,
    };

    this.ball.state = "passing";
    this.ball.ownerId = null;
    this.ball.targetId = to.id;

    this.ball.vx =
      (
        targetX -
        this.ball.x
      ) /
      Math.max(
        d / speed,
        0.12
      );

    this.ball.vy =
      (
        targetY -
        this.ball.y
      ) /
      Math.max(
        d / speed,
        0.12
      );

    from.hasBall = false;
    this.possessionTeam = from.team;
  }

  dribble(player) {
    const direction =
      teamDirection(
        player.team
      );

    const target = {
      x:
        player.x +
        direction *
          random(
            70,
            140
          ),

      y:
        player.y +
        random(
          -80,
          80
        ),
    };

    player.targetX =
      clamp(
        target.x,
        FIELD.left + 20,
        FIELD.right - 20
      );

    player.targetY =
      clamp(
        target.y,
        FIELD.top + 20,
        FIELD.bottom - 20
      );

    this.ball.x =
      player.x +
      direction * 13;

    this.ball.y =
      player.y;

    this.ball.ownerId =
      player.id;

    this.ball.state =
      "possessed";
  }

  shoot(player) {
    if (
      this.ball.ownerId !==
      player.id
    ) {
      return;
    }

    const goalX =
      player.team === "home"
        ? FIELD.right
        : FIELD.left;

    const goalY =
      FIELD.centerY +
      random(
        -FIELD.goalWidth / 2 + 10,
        FIELD.goalWidth / 2 - 10
      );

    const d =
      Math.hypot(
        goalX - player.x,
        goalY - player.y
      );

    const xg =
      this.calculateXg(
        player,
        goalX,
        goalY
      );

    this.stats[
      player.team
    ].shots += 1;

    this.stats[
      player.team
    ].xg += xg;

    player.shots += 1;

    this.ball.state =
      "shooting";

    this.ball.ownerId =
      null;

    this.ball.action =
      "shot";

    this.ball.shotXg =
      xg;

    this.ball.vx =
      (
        goalX -
        player.x
      ) /
      Math.max(
        d / (
          500 +
          player.shooting * 4
        ),
        0.08
      );

    this.ball.vy =
      (
        goalY -
        player.y
      ) /
      Math.max(
        d / (
          500 +
          player.shooting * 4
        ),
        0.08
      );

    player.hasBall = false;

    this.addEvent({
      type: "shot",
      team: player.team,
      playerId: player.id,
      player: player.name,
      minute: this.minute,
      xg,
      text: `${player.name} shoots`,
    });
  }

  calculateXg(player, goalX, goalY) {
    const d =
      distance(
        player,
        {
          x: goalX,
          y: goalY,
        }
      );

    const angle =
      this.getShootingAngle(
        player,
        {
          x: goalX,
          y: goalY,
        }
      );

    const pressure =
      this.getPressure(player);

    const base =
      1 /
      (
        1 +
        Math.exp(
          (
            d - 185
          ) /
          48
        )
      );

    const quality =
      0.55 +
      player.shooting /
        220;

    return clamp(
      base *
        quality *
        (
          0.55 +
          angle * 0.45
        ) *
        (
          1 -
          pressure * 0.35
        ),
      0.01,
      0.95
    );
  }

  updateBall(dt) {
    if (
      this.ball.state ===
      "possessed"
    ) {
      const owner =
        this.getPlayer(
          this.ball.ownerId
        );

      if (!owner) {
        this.releaseBall();
        return;
      }

      this.ball.x =
        owner.x +
        (
          owner.team === "home"
            ? 13
            : -13
        );

      this.ball.y =
        owner.y;

      return;
    }

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

    if (
      this.ball.state ===
      "passing"
    ) {
      this.handlePassArrival();
      this.checkInterception();
    }

    if (
      this.ball.state ===
      "shooting"
    ) {
      this.handleGoalkeeper();
      this.checkGoal();
    }

    if (
      this.ball.state ===
      "free"
    ) {
      this.tryLooseBallPickup();
    }

    this.handleBoundaries();
  }

  handlePassArrival() {
    if (!this.ball.targetId) {
      return;
    }

    const target =
      this.getPlayer(
        this.ball.targetId
      );

    if (!target) {
      return;
    }

    if (
      distance(
        this.ball,
        target
      ) < 18
    ) {
      const passer =
        this.lastPass;

      this.giveBall(target);

      this.stats[
        target.team
      ].completedPasses += 1;

      target.completedPasses += 1;

      if (passer) {
        this.addEvent({
          type: "pass",
          team: target.team,
          player: target.name,
          minute: this.minute,
          text: `${passer.passerId} passed to ${target.name}`,
        });
      }
    }
  }

  checkInterception() {
    const target =
      this.getPlayer(
        this.ball.targetId
      );

    const opponents =
      this.getActivePlayers(
        target?.team === "home"
          ? "away"
          : "home"
      );

    for (const opponent of opponents) {
      if (
        distance(
          this.ball,
          opponent
        ) < 15
      ) {
        if (
          Math.random() <
          (
            opponent.tackling /
            170
          )
        ) {
          this.giveBall(
            opponent
          );

          this.stats[
            opponent.team
          ].interceptions += 1;

          this.addEvent({
            type: "interception",
            team: opponent.team,
            player: opponent.name,
            minute: this.minute,
            text: `${opponent.name} intercepts the ball`,
          });

          return;
        }
      }
    }
  }

  handleGoalkeeper() {
    const shootingTeam =
      this.ball.lastTouchTeam;

    const goalkeeperTeam =
      shootingTeam === "home"
        ? "away"
        : "home";

    const goalkeeper =
      this.getActivePlayers(
        goalkeeperTeam
      ).find(
        (p) =>
          p.position === "GK"
      );

    if (!goalkeeper) {
      return;
    }

    if (
      distance(
        this.ball,
        goalkeeper
      ) < 25
    ) {
      const shotPower =
        Math.hypot(
          this.ball.vx,
          this.ball.vy
        );

      const saveProbability =
        clamp(
          (
            goalkeeper.reaction +
            goalkeeper.diving +
            goalkeeper.positioning
          ) /
            300 -
            shotPower / 1800,
          0.12,
          0.86
        );

      if (
        Math.random() <
        saveProbability
      ) {
        this.stats[
          goalkeeperTeam
        ].saves += 1;

        goalkeeper.saves += 1;

        this.addEvent({
          type: "save",
          team: goalkeeperTeam,
          player: goalkeeper.name,
          minute: this.minute,
          text: `${goalkeeper.name} makes a save`,
        });

        if (
          Math.random() <
          goalkeeper.catching /
            130
        ) {
          this.giveBall(
            goalkeeper
          );
        } else {
          this.ball.state =
            "free";

          this.ball.vx =
            random(
              -160,
              160
            );

          this.ball.vy =
            random(
              -160,
              160
            );

          this.ball.ownerId =
            null;
        }

        this.stats[
          shootingTeam
        ].shotsOnTarget += 1;

        this.ball.action =
          null;
      }
    }
  }

  checkGoal() {
    const inGoalY =
      this.ball.y >
        FIELD.centerY -
          FIELD.goalWidth / 2 &&
      this.ball.y <
        FIELD.centerY +
          FIELD.goalWidth / 2;

    if (!inGoalY) {
      return;
    }

    if (
      this.ball.x <=
        FIELD.left &&
      this.ball.vx < 0
    ) {
      this.registerGoal("away");
    }

    if (
      this.ball.x >=
        FIELD.right &&
      this.ball.vx > 0
    ) {
      this.registerGoal("home");
    }
  }

  registerGoal(team) {
    const scorer =
      this.findLastAttackingPlayer(
        team
      );

    const opponent =
      team === "home"
        ? "away"
        : "home";

    this.score[team] += 1;

    this.stats[team].goals += 1;

    if (scorer) {
      scorer.goals += 1;
    }

    let assistPlayer = null;

    if (
      this.lastPass &&
      this.lastPass.team === team &&
      this.realElapsed -
        this.lastPass.time <
        8
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
        this.stats[
          team
        ].assists += 1;

        assistPlayer.assists += 1;
      }
    }

    this.addEvent({
      type: "goal",
      team,
      minute: this.minute,
      playerId: scorer?.id || null,
      player: scorer?.name || "Unknown",
      assistId:
        assistPlayer?.id || null,
      assist:
        assistPlayer?.name || null,
      text:
        `${scorer?.name || "Unknown"} scores!`,
    });

    this.ball.state =
      "possessed";

    this.ball.ownerId =
      null;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.possessionTeam =
      opponent;

    this.resetAfterGoal(
      opponent
    );
  }

  findLastAttackingPlayer(team) {
    const players =
      this.getActivePlayers(
        team
      );

    return players
      .filter(
        (p) =>
          p.position !== "GK"
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
  }

  resetAfterGoal(team) {
    for (const p of this.getAllActivePlayers()) {
      p.hasBall = false;
    }

    this.applyFormation(
      "home",
      this.homeTeam.formation
    );

    this.applyFormation(
      "away",
      this.awayTeam.formation
    );

    const kickoff =
      this.getActivePlayers(
        team
      )
        .sort(
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

    if (kickoff) {
      kickoff.x =
        team === "home"
          ? FIELD.centerX - 20
          : FIELD.centerX + 20;

      kickoff.y =
        FIELD.centerY;

      this.giveBall(
        kickoff
      );
    }
  }

  handlePhysicalDuels() {
    const home =
      this.getActivePlayers(
        "home"
      );

    const away =
      this.getActivePlayers(
        "away"
      );

    for (const attacker of [
      ...home,
      ...away,
    ]) {
      if (!attacker.hasBall) {
        continue;
      }

      const defender =
        this.findNearestOpponent(
          attacker
        );

      if (!defender) {
        continue;
      }

      const d =
        distance(
          attacker,
          defender
        );

      if (d > 28) {
        continue;
      }

      const tackleProbability =
        clamp(
          (
            defender.tackling +
            defender.positioning
          ) /
            230 -
            attacker.dribbling /
              450,
          0.08,
          0.65
        );

      if (
        Math.random() <
        tackleProbability *
          0.10
      ) {
        const foul =
          Math.random() <
          0.12;

        if (foul) {
          this.registerFoul(
            defender,
            attacker
          );
        } else {
          this.giveBall(
            defender
          );

          this.stats[
            defender.team
          ].tackles += 1;

          defender.tackles += 1;

          this.addEvent({
            type: "tackle",
            team: defender.team,
            player: defender.name,
            minute: this.minute,
            text: `${defender.name} wins the ball`,
          });
        }
      }
    }
  }

  registerFoul(
    defender,
    attacker
  ) {
    this.stats[
      defender.team
    ].fouls += 1;

    const cardChance =
      defender.yellowCards > 0
        ? 0.18
        : 0.08;

    this.addEvent({
      type: "foul",
      team: defender.team,
      player: defender.name,
      minute: this.minute,
      text: `${defender.name} commits a foul`,
    });

    if (
      Math.random() <
      cardChance
    ) {
      defender.yellowCards += 1;

      this.stats[
        defender.team
      ].yellowCards += 1;

      this.addEvent({
        type: "yellow",
        team: defender.team,
        player: defender.name,
        minute: this.minute,
        text: `Yellow card for ${defender.name}`,
      });

      if (
        defender.yellowCards >= 2
      ) {
        defender.sentOff = true;
        defender.active = false;

        this.stats[
          defender.team
        ].redCards += 1;

        this.addEvent({
          type: "red",
          team: defender.team,
          player: defender.name,
          minute: this.minute,
          text: `${defender.name} is sent off`,
        });
      }
    }
  }

  findNearestOpponent(player) {
    const opponents =
      this.getActivePlayers(
        player.team === "home"
          ? "away"
          : "home"
      );

    if (!opponents.length) {
      return null;
    }

    return opponents.reduce(
      (closest, current) => {
        if (!closest) {
          return current;
        }

        return distance(
          player,
          current
        ) <
          distance(
            player,
            closest
          )
          ? current
          : closest;
      },
      null
    );
  }

  tryLooseBallPickup() {
    if (
      this.ball.state ===
      "possessed"
    ) {
      return;
    }

    const players =
      this.getAllActivePlayers();

    let closest = null;
    let closestDistance = 9999;

    for (const player of players) {
      const d =
        distance(
          this.ball,
          player
        );

      if (
        d < closestDistance
      ) {
        closestDistance = d;
        closest = player;
      }
    }

    if (
      closest &&
      closestDistance < 16
    ) {
      this.giveBall(
        closest
      );
    }
  }

  giveBall(player) {
    for (const p of this.getAllActivePlayers()) {
      p.hasBall = false;
    }

    player.hasBall = true;

    this.ball.state =
      "possessed";

    this.ball.ownerId =
      player.id;

    this.ball.targetId =
      null;

    this.ball.action =
      null;

    this.ball.lastTouchTeam =
      player.team;

    this.ball.lastTouchPlayerId =
      player.id;

    this.possessionTeam =
      player.team;
  }

  releaseBall() {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (owner) {
      owner.hasBall = false;
    }

    this.ball.ownerId =
      null;

    this.ball.state =
      "free";

    this.ball.targetId =
      null;
  }

  isOffside(player, attackingTeam) {
    if (
      player.position === "GK"
    ) {
      return false;
    }

    const direction =
      teamDirection(
        attackingTeam
      );

    const opponents =
      this.getActivePlayers(
        attackingTeam === "home"
          ? "away"
          : "home"
      );

    const sorted =
      opponents
        .map((p) => p.x)
        .sort(
          (a, b) =>
            direction === 1
              ? b - a
              : a - b
        );

    const secondLast =
      sorted[1];

    if (
      secondLast === undefined
    ) {
      return false;
    }

    const attackingHalf =
      attackingTeam === "home"
        ? player.x >
          FIELD.centerX
        : player.x <
          FIELD.centerX;

    if (!attackingHalf) {
      return false;
    }

    const beyondDefender =
      attackingTeam === "home"
        ? player.x > secondLast
        : player.x < secondLast;

    const beyondBall =
      attackingTeam === "home"
        ? player.x > this.ball.x
        : player.x < this.ball.x;

    return (
      beyondDefender &&
      beyondBall
    );
  }

  handleBoundaries() {
    if (
      this.ball.y <
        FIELD.top
    ) {
      this.handleThrowIn(
        "top"
      );
      return;
    }

    if (
      this.ball.y >
        FIELD.bottom
    ) {
      this.handleThrowIn(
        "bottom"
      );
      return;
    }

    if (
      this.ball.x <
        FIELD.left
    ) {
      if (
        Math.abs(
          this.ball.y -
            FIELD.centerY
        ) <=
        FIELD.goalWidth / 2
      ) {
        return;
      }

      this.handleGoalLineOut(
        "left"
      );

      return;
    }

    if (
      this.ball.x >
        FIELD.right
    ) {
      if (
        Math.abs(
          this.ball.y -
            FIELD.centerY
        ) <=
        FIELD.goalWidth / 2
      ) {
        return;
      }

      this.handleGoalLineOut(
        "right"
      );
    }
  }

  handleThrowIn(side) {
    const team =
      this.ball.lastTouchTeam ===
      "home"
        ? "away"
        : "home";

    this.stats[
      team
    ].throwIns += 1;

    this.addEvent({
      type: "throwIn",
      team,
      minute: this.minute,
      text: `${this.getTeamName(team)} throw-in`,
    });

    const player =
      this.getActivePlayers(
        team
      )
        .filter(
          (p) =>
            p.position !== "GK"
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

    if (player) {
      player.x =
        clamp(
          this.ball.x,
          FIELD.left + 8,
          FIELD.right - 8
        );

      player.y =
        side === "top"
          ? FIELD.top + 5
          : FIELD.bottom - 5;

      this.giveBall(
        player
      );
    }
  }

  handleGoalLineOut(side) {
    const defendingTeam =
      side === "left"
        ? "home"
        : "away";

    const attackingTeam =
      defendingTeam === "home"
        ? "away"
        : "home";

    if (
      this.ball.lastTouchTeam ===
      attackingTeam
    ) {
      this.stats[
        defendingTeam
      ].goalKicks += 1;

      this.addEvent({
        type: "goalKick",
        team: defendingTeam,
        minute: this.minute,
        text: `${this.getTeamName(defendingTeam)} goal kick`,
      });

      const keeper =
        this.getActivePlayers(
          defendingTeam
        ).find(
          (p) =>
            p.position === "GK"
        );

      if (keeper) {
        keeper.x =
          side === "left"
            ? FIELD.left + 35
            : FIELD.right - 35;

        keeper.y =
          FIELD.centerY;

        this.giveBall(
          keeper
        );
      }
    } else {
      this.stats[
        attackingTeam
      ].corners += 1;

      this.addEvent({
        type: "corner",
        team: attackingTeam,
        minute: this.minute,
        text: `${this.getTeamName(attackingTeam)} corner`,
      });

      const cornerPlayer =
        this.getActivePlayers(
          attackingTeam
        )
          .filter(
            (p) =>
              p.position !== "GK"
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

      if (cornerPlayer) {
        cornerPlayer.x =
          side === "left"
            ? FIELD.left + 8
            : FIELD.right - 8;

        cornerPlayer.y =
          this.ball.y <
            FIELD.centerY
            ? FIELD.top + 8
            : FIELD.bottom - 8;

        this.giveBall(
          cornerPlayer
        );

        setTimeout(() => {
          if (
            this.status ===
              "live" &&
            cornerPlayer.active &&
            cornerPlayer.hasBall
          ) {
            this.cross(
              cornerPlayer
            );
          }
        }, 250);
      }
    }

    this.ball.x =
      clamp(
        this.ball.x,
        FIELD.left + 5,
        FIELD.right - 5
      );
  }

  cross(player) {
    const target =
      this.getActivePlayers(
        player.team
      )
        .filter(
          (p) =>
            p.id !== player.id &&
            p.position !== "GK"
        )
        .sort(
          (a, b) =>
            distance(
              a,
              {
                x:
                  player.team === "home"
                    ? FIELD.right - 120
                    : FIELD.left + 120,
                y: FIELD.centerY,
              }
            ) -
            distance(
              b,
              {
                x:
                  player.team === "home"
                    ? FIELD.right - 120
                    : FIELD.left + 120,
                y: FIELD.centerY,
              }
            )
        )[0];

    if (!target) {
      return;
    }

    this.ball.state =
      "passing";

    this.ball.ownerId =
      null;

    this.ball.targetId =
      target.id;

    const dx =
      target.x -
      this.ball.x;

    const dy =
      target.y -
      this.ball.y;

    const d =
      Math.hypot(
        dx,
        dy
      );

    const speed = 350;

    this.ball.vx =
      dx /
      Math.max(
        d / speed,
        0.1
      );

    this.ball.vy =
      dy /
      Math.max(
        d / speed,
        0.1
      );

    player.hasBall = false;
  }

  updateAIManager() {
    for (const team of [
      "home",
      "away",
    ]) {
      const teamObject =
        team === "home"
          ? this.homeTeam
          : this.awayTeam;

      const ownScore =
        this.score[team];

      const opponent =
        team === "home"
          ? "away"
          : "home";

      const opponentScore =
        this.score[opponent];

      if (
        this.minute >= 70 &&
        ownScore <
          opponentScore
      ) {
        teamObject.tactics =
          {
            ...teamObject.tactics,
            mentality:
              "attacking",
            pressing:
              "high",
            tempo:
              75,
            defensiveLine:
              68,
            counterAttack:
              true,
          };
      }

      if (
        this.minute >= 75 &&
        ownScore >
          opponentScore
      ) {
        teamObject.tactics =
          {
            ...teamObject.tactics,
            mentality:
              "defensive",
            pressing:
              "medium",
            tempo:
              40,
            defensiveLine:
              35,
          };
      }
    }
  }

  checkSubstitutions() {
    if (
      this.minute < 55
    ) {
      return;
    }

    for (const team of [
      "home",
      "away",
    ]) {
      if (
        this.getSubstitutionsUsed(
          team
        ) >=
        MATCH.maxSubstitutions
      ) {
        continue;
      }

      const tired =
        this.getActivePlayers(
          team
        )
          .filter(
            (p) =>
              p.position !== "GK"
          )
          .sort(
            (a, b) =>
              a.stamina -
              b.stamina
          )[0];

      if (
        tired &&
        tired.stamina < 38
      ) {
        this.makeAISubstitution(
          team,
          tired
        );
      }
    }
  }

  getSubstitutionsUsed(team) {
    return this.events.filter(
      (event) =>
        event.type ===
          "substitution" &&
        event.team === team
    ).length;
  }

  makeAISubstitution(
    team,
    outgoing
  ) {
    const bench =
      this.bench[team];

    if (!bench.length) {
      return;
    }

    const incomingIndex =
      bench.findIndex(
        (p) =>
          this.isSimilarRole(
            p.position,
            outgoing.position
          )
      );

    const index =
      incomingIndex >= 0
        ? incomingIndex
        : 0;

    const incoming =
      bench.splice(
        index,
        1
      )[0];

    if (!incoming) {
      return;
    }

    incoming.active = true;
    incoming.sentOff = false;
    incoming.stamina = 100;

    incoming.x =
      outgoing.x;

    incoming.y =
      outgoing.y;

    incoming.homeX =
      outgoing.homeX;

    incoming.homeY =
      outgoing.homeY;

    outgoing.active = false;
    outgoing.hasBall = false;

    if (
      this.ball.ownerId ===
      outgoing.id
    ) {
      this.releaseBall();
    }

    this.players.push(
      incoming
    );

    this.addEvent({
      type: "substitution",
      team,
      minute: this.minute,
      playerOut:
        outgoing.name,
      playerIn:
        incoming.name,
      text:
        `${incoming.name} replaces ${outgoing.name}`,
    });
  }

  isSimilarRole(
    a,
    b
  ) {
    const groups = {
      GK: ["GK"],
      DEF: [
        "CB",
        "LB",
        "RB",
        "LWB",
        "RWB",
      ],
      MID: [
        "CM",
        "CDM",
        "CAM",
        "LM",
        "RM",
      ],
      ATT: [
        "ST",
        "CF",
        "LW",
        "RW",
      ],
    };

    const groupOf = (role) =>
      Object.keys(groups).find(
        (key) =>
          groups[key].includes(role)
      );

    return (
      groupOf(a) ===
      groupOf(b)
    );
  }

  finishMatch() {
    if (
      this.status ===
      "finished"
    ) {
      return;
    }

    this.status =
      "finished";

    this.minute = 90;

    this.addEvent({
      type: "fulltime",
      minute: 90,
      text: "Full Time",
    });
  }

  addEvent(event) {
    this.events.push({
      id:
        this.nextEventId++,
      timestamp:
        Date.now(),
      ...event,
    });

    if (
      this.events.length > 300
    ) {
      this.events =
        this.events.slice(
          -300
        );
    }
  }

  getTeamName(team) {
    return team === "home"
      ? this.homeTeam.name
      : this.awayTeam.name;
  }

  getPossessionPercent(team) {
    const total =
      this.stats.home
        .possessionSeconds +
      this.stats.away
        .possessionSeconds;

    if (!total) {
      return 50;
    }

    return (
      this.stats[team]
        .possessionSeconds /
      total
    ) * 100;
  }

  getSnapshot() {
    return {
      matchId:
        this.matchId,

      status:
        this.status,

      minute:
        this.minute,

      score: {
        ...this.score,
      },

      homeTeam: {
        id:
          this.homeTeam.id,
        name:
          this.homeTeam.name,
        logo:
          this.homeTeam.logo ||
          "",
        formation:
          this.homeTeam.formation,
        tactics:
          {
            ...this.homeTeam.tactics,
          },
      },

      awayTeam: {
        id:
          this.awayTeam.id,
        name:
          this.awayTeam.name,
        logo:
          this.awayTeam.logo ||
          "",
        formation:
          this.awayTeam.formation,
        tactics:
          {
            ...this.awayTeam.tactics,
          },
      },

      players:
        this.getAllActivePlayers().map(
          (p) => ({
            id: p.id,
            name: p.name,
            number: p.number,
            team: p.team,
            position: p.position,
            role: p.role,
            x: p.x,
            y: p.y,
            stamina: p.stamina,
            hasBall: p.hasBall,
            yellowCards:
              p.yellowCards,
            sentOff:
              p.sentOff,
          })
        ),

      ball: {
        x:
          this.ball.x,
        y:
          this.ball.y,
        state:
          this.ball.state,
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
        this.events.slice(-40),

      bench: {
        home:
          this.bench.home.map(
            (p) => ({
              id: p.id,
              name: p.name,
              number: p.number,
              position:
                p.position,
              overall:
                p.overall,
            })
          ),

        away:
          this.bench.away.map(
            (p) => ({
              id: p.id,
              name: p.name,
              number: p.number,
              position:
                p.position,
              overall:
                p.overall,
            })
          ),
      },
    };
  }

  getResult() {
    return {
      status:
        this.status,

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

      minute:
        90,

      events:
        this.events,

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

      homeLineup:
        this.getActivePlayers(
          "home"
        ).map(
          (p) => ({
            id: p.id,
            name: p.name,
            number: p.number,
            position: p.position,
            role: p.role,
            stamina: p.stamina,
          })
        ),

      awayLineup:
        this.getActivePlayers(
          "away"
        ).map(
          (p) => ({
            id: p.id,
            name: p.name,
            number: p.number,
            position: p.position,
            role: p.role,
            stamina: p.stamina,
          })
        ),
    };
  }

  setFormation(
    team,
    formation
  ) {
    if (
      !FORMATIONS[formation]
    ) {
      return;
    }

    if (team === "home") {
      this.homeTeam.formation =
        formation;
    } else {
      this.awayTeam.formation =
        formation;
    }

    this.applyFormation(
      team,
      formation
    );
  }

  setTactics(
    team,
    tactics
  ) {
    const target =
      team === "home"
        ? this.homeTeam
        : this.awayTeam;

    target.tactics = {
      ...target.tactics,
      ...tactics,
    };
  }

  manualSubstitution(
    team,
    outgoingId,
    incomingId
  ) {
    if (
      this.getSubstitutionsUsed(
        team
      ) >=
      MATCH.maxSubstitutions
    ) {
      return false;
    }

    const outgoing =
      this.getPlayer(
        outgoingId
      );

    const index =
      this.bench[team].findIndex(
        (p) =>
          p.id === incomingId
      );

    if (
      !outgoing ||
      index < 0 ||
      outgoing.team !== team
    ) {
      return false;
    }

    const incoming =
      this.bench[
        team
      ].splice(
        index,
        1
      )[0];

    incoming.active = true;
    incoming.stamina = 100;

    incoming.x =
      outgoing.x;

    incoming.y =
      outgoing.y;

    incoming.homeX =
      outgoing.homeX;

    incoming.homeY =
      outgoing.homeY;

    outgoing.active = false;
    outgoing.hasBall = false;

    if (
      this.ball.ownerId ===
      outgoing.id
    ) {
      this.releaseBall();
    }

    this.players.push(
      incoming
    );

    this.addEvent({
      type: "substitution",
      team,
      minute: this.minute,
      playerOut:
        outgoing.name,
      playerIn:
        incoming.name,
      text:
        `${incoming.name} replaces ${outgoing.name}`,
    });

    return true;
  }
}
