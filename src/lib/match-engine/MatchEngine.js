import Player from "./Player";
import Ball from "./Ball";
import {
  PITCH,
  MATCH,
  MATCH_STATUS,
  EVENT_TYPES,
  DEFAULT_TACTICS,
} from "./constants";
import { getFormationPosition } from "./Formation";

/* =========================================================
   MATCH ENGINE
   90 MINUTES -> 4 REAL MINUTES
   ========================================================= */

class MatchEngine {
  constructor({
    match = {},
    homeClub = {},
    awayClub = {},
    homePlayers = [],
    awayPlayers = [],
  } = {}) {
    this.match = match;
    this.homeClub = homeClub;
    this.awayClub = awayClub;

    this.homeRawPlayers = Array.isArray(homePlayers)
      ? homePlayers
      : [];

    this.awayRawPlayers = Array.isArray(awayPlayers)
      ? awayPlayers
      : [];

    /* -----------------------------------------------------
       GAME CLOCK
       ----------------------------------------------------- */

    this.minute = Number(match.minute || 0);
    this.simulationSeconds = this.minute * 60;

    this.status =
      match.status === MATCH_STATUS.LIVE
        ? MATCH_STATUS.LIVE
        : match.status === MATCH_STATUS.HALF_TIME
          ? MATCH_STATUS.HALF_TIME
          : match.status === MATCH_STATUS.FINISHED
            ? MATCH_STATUS.FINISHED
            : MATCH_STATUS.READY;

    this.started = false;
    this.secondHalfStarted = this.minute >= 45;
    this.kickoffEmitted = false;
    this.halfTimeEmitted = false;
    this.fullTimeEmitted = false;

    /* -----------------------------------------------------
       SCORE
       ----------------------------------------------------- */

    this.score = {
      home: Number(match.homeScore || 0),
      away: Number(match.awayScore || 0),
    };

    /* -----------------------------------------------------
       USER CONTROL
       null = AI controls both teams
       ----------------------------------------------------- */

    this.userControlled = null;

    /* -----------------------------------------------------
       FORMATIONS
       ----------------------------------------------------- */

    this.formations = {
      home: match.homeFormation || "4-4-2",
      away: match.awayFormation || "4-4-2",
    };

    /* -----------------------------------------------------
       TACTICS
       ----------------------------------------------------- */

    this.tactics = {
      home: {
        ...DEFAULT_TACTICS,
        ...(match.homeTactics || {}),
      },

      away: {
        ...DEFAULT_TACTICS,
        ...(match.awayTactics || {}),
      },
    };

    /* -----------------------------------------------------
       EVENTS
       ----------------------------------------------------- */

    this.events = Array.isArray(match.events)
      ? [...match.events]
      : [];

    /* -----------------------------------------------------
       STATS
       ----------------------------------------------------- */

    this.stats = {
      home: this.createStats(match.homeStats),
      away: this.createStats(match.awayStats),
    };

    /* -----------------------------------------------------
       PLAYERS
       ----------------------------------------------------- */

    this.homePlayers = this.createPlayers(
      this.homeRawPlayers,
      "home"
    );

    this.awayPlayers = this.createPlayers(
      this.awayRawPlayers,
      "away"
    );

    /* -----------------------------------------------------
       LINEUPS
       ----------------------------------------------------- */

    this.homeXI = this.selectStartingXI(this.homePlayers);
    this.awayXI = this.selectStartingXI(this.awayPlayers);

    this.homeBench = this.homePlayers.filter(
      (player) => !this.homeXI.includes(player)
    );

    this.awayBench = this.awayPlayers.filter(
      (player) => !this.awayXI.includes(player)
    );

    this.homeSubstitutions = Number(
      match.homeSubsUsed || 0
    );

    this.awaySubstitutions = Number(
      match.awaySubsUsed || 0
    );

    /* -----------------------------------------------------
       BALL
       ----------------------------------------------------- */

    this.ball = new Ball(
      PITCH.width / 2,
      PITCH.height / 2
    );

    /* -----------------------------------------------------
       AI TIMERS
       ----------------------------------------------------- */

    this.decisionTimer = 0;
    this.aiTimer = 0;
    this.tacticsTimer = 0;

    /* -----------------------------------------------------
       INTERNAL STATE
       ----------------------------------------------------- */

    this.possessionTeam = null;
    this.lastPossessionTeam = null;
    this.lastEventSecond = -10;

    this.pendingAction = null;

    this.callbacks = new Set();

    this.accumulator = 0;

    this.homeAttackDirection = 1;
    this.awayAttackDirection = -1;

    this.initializePlayers();
    this.initializeBall();

    if (this.minute >= 90) {
      this.status = MATCH_STATUS.FINISHED;
    }
  }

  /* =======================================================
     BASIC HELPERS
     ======================================================= */

  createStats(existing = {}) {
    return {
      possessionSeconds: Number(
        existing?.possessionSeconds || 0
      ),

      shots: Number(existing?.shots || 0),

      shotsOnTarget: Number(
        existing?.shotsOnTarget || 0
      ),

      passes: Number(existing?.passes || 0),

      passesCompleted: Number(
        existing?.passesCompleted || 0
      ),

      tackles: Number(existing?.tackles || 0),

      interceptions: Number(
        existing?.interceptions || 0
      ),

      corners: Number(existing?.corners || 0),

      fouls: Number(existing?.fouls || 0),

      offsides: Number(existing?.offsides || 0),

      saves: Number(existing?.saves || 0),

      yellowCards: Number(
        existing?.yellowCards || 0
      ),

      redCards: Number(
        existing?.redCards || 0
      ),

      substitutions: Number(
        existing?.substitutions || 0
      ),

      goals: Number(existing?.goals || 0),
    };
  }

  createPlayers(rawPlayers, team) {
    return rawPlayers.map((raw, index) => {
      const player = new Player({
        ...raw,
        id:
          raw?.id ||
          raw?.playerId ||
          `${team}-player-${index + 1}`,

        team,

        shirtNumber:
          raw?.shirtNumber ??
          raw?.number ??
          index + 1,
      });

      return player;
    });
  }

  getTeamPlayers(team) {
    return team === "home"
      ? this.homePlayers
      : this.awayPlayers;
  }

  getXI(team) {
    return team === "home"
      ? this.homeXI
      : this.awayXI;
  }

  getBench(team) {
    return team === "home"
      ? this.homeBench
      : this.awayBench;
  }

  getOpponent(team) {
    return team === "home"
      ? this.awayXI
      : this.homeXI;
  }

  getTeamStats(team) {
    return team === "home"
      ? this.stats.home
      : this.stats.away;
  }

  otherTeam(team) {
    return team === "home"
      ? "away"
      : "home";
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  random(min = 0, max = 1) {
    return min + Math.random() * (max - min);
  }

  chance(probability) {
    return Math.random() < probability;
  }

  distance(a, b) {
    if (!a || !b) return Infinity;

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
  }

  /* =======================================================
     EVENTS
     ======================================================= */

  onEvent(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.callbacks.add(callback);

    return () => {
      this.callbacks.delete(callback);
    };
  }

  emit(type, data = {}) {
    const event = {
      id: `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`,

      type,

      minute: Math.floor(this.minute),

      second: Math.floor(
        this.simulationSeconds % 60
      ),

      timestamp: Date.now(),

      ...data,
    };

    this.events.push(event);

    if (this.events.length > 300) {
      this.events = this.events.slice(-300);
    }

    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error(
          "MatchEngine event callback error:",
          error
        );
      }
    });

    return event;
  }

  /* =======================================================
     PLAYER INITIALIZATION
     ======================================================= */

  initializePlayers() {
    this.positionTeam(
      "home",
      this.formations.home
    );

    this.positionTeam(
      "away",
      this.formations.away
    );

    this.homeXI.forEach((player) => {
      player.active = true;
      player.redCard = false;
    });

    this.awayXI.forEach((player) => {
      player.active = true;
      player.redCard = false;
    });

    this.homeBench.forEach((player) => {
      player.active = false;
    });

    this.awayBench.forEach((player) => {
      player.active = false;
    });
  }

  selectStartingXI(players) {
    const available = players.filter(
      (player) =>
        !player.redCard &&
        !player.injured
    );

    const sorted = [...available].sort(
      (a, b) =>
        Number(b.overall || 60) -
        Number(a.overall || 60)
    );

    return sorted.slice(0, 11);
  }

  positionTeam(team, formation) {
    const xi = this.getXI(team);

    xi.forEach((player, index) => {
      const position = getFormationPosition(
        formation,
        index,
        team
      );

      if (!position) return;

      player.x = position.x;
      player.y = position.y;

      if (typeof player.setTarget === "function") {
        player.setTarget(
          position.x,
          position.y
        );
      }
    });
  }

  /* =======================================================
     BALL INITIALIZATION
     ======================================================= */

  initializeBall() {
    this.ball.stop?.();

    this.ball.x = PITCH.width / 2;
    this.ball.y = PITCH.height / 2;

    this.ball.ownerId = null;
    this.ball.targetId = null;

    const homeMidfielder =
      this.homeXI.find((player) =>
        this.isMidfielder(player)
      ) || this.homeXI[5];

    const awayMidfielder =
      this.awayXI.find((player) =>
        this.isMidfielder(player)
      ) || this.awayXI[5];

    if (homeMidfielder) {
      this.ball.attach?.(homeMidfielder);
    }

    this.possessionTeam = null;
    this.lastPossessionTeam = null;
  }

  /* =======================================================
     MATCH CONTROL
     ======================================================= */

  start() {
    if (this.status === MATCH_STATUS.FINISHED) {
      return;
    }

    if (this.status === MATCH_STATUS.HALF_TIME) {
      this.startSecondHalf();
      return;
    }

    if (
      this.status !== MATCH_STATUS.READY &&
      this.status !== MATCH_STATUS.LIVE
    ) {
      return;
    }

    this.status = MATCH_STATUS.LIVE;
    this.started = true;

    if (!this.kickoffEmitted) {
      this.kickoffEmitted = true;

      this.emit(EVENT_TYPES.KICKOFF, {
        team: "home",
      });
    }
  }

  pause() {
    if (this.status !== MATCH_STATUS.LIVE) {
      return;
    }

    this.status = MATCH_STATUS.READY;
  }

  resume() {
    if (this.status !== MATCH_STATUS.READY) {
      return;
    }

    this.status = MATCH_STATUS.LIVE;
    this.started = true;
  }

  startSecondHalf() {
    if (
      this.status !== MATCH_STATUS.HALF_TIME &&
      this.minute < 45
    ) {
      return;
    }

    if (this.minute >= 90) {
      this.finishMatch();
      return;
    }

    this.secondHalfStarted = true;
    this.halfTimeEmitted = true;
    this.status = MATCH_STATUS.LIVE;
    this.started = true;

    this.ball.x = PITCH.width / 2;
    this.ball.y = PITCH.height / 2;

    this.ball.ownerId = null;
    this.ball.targetId = null;

    this.positionTeam(
      "home",
      this.formations.home
    );

    this.positionTeam(
      "away",
      this.formations.away
    );

    this.emit(EVENT_TYPES.SECOND_HALF);
  }

  stop() {
    this.finishMatch();
  }

  finishMatch() {
    if (this.fullTimeEmitted) {
      return;
    }

    this.minute = 90;
    this.simulationSeconds = 90 * 60;

    this.status = MATCH_STATUS.FINISHED;
    this.started = false;

    this.fullTimeEmitted = true;

    this.ball.stop?.();

    this.emit(EVENT_TYPES.FULL_TIME, {
      homeScore: this.score.home,
      awayScore: this.score.away,
    });
  }

  /* =======================================================
     MAIN UPDATE
     ======================================================= */

  update(realDelta) {
    if (this.status !== MATCH_STATUS.LIVE) {
      return;
    }

    if (!Number.isFinite(realDelta)) {
      return;
    }

    const safeDelta = this.clamp(
      realDelta,
      0,
      0.25
    );

    const simulationRatio =
      MATCH.SIMULATION_MINUTES /
      MATCH.REAL_DURATION_SECONDS;

    const simulatedDelta =
      safeDelta * simulationRatio * 60;

    this.accumulator += simulatedDelta;

    const fixedStep =
      MATCH.FIXED_DT || 1 / 30;

    let steps = 0;

    while (
      this.accumulator >= fixedStep &&
      steps < 12
    ) {
      this.fixedUpdate(fixedStep);

      this.accumulator -= fixedStep;
      steps += 1;

      if (
        this.status !== MATCH_STATUS.LIVE
      ) {
        break;
      }
    }
  }

  fixedUpdate(dt) {
    if (this.status !== MATCH_STATUS.LIVE) {
      return;
    }

    this.simulationSeconds += dt;

    this.minute = Math.min(
      90,
      this.simulationSeconds / 60
    );

    this.updatePossession(dt);

    this.updatePlayers(dt);

    this.updateBall(dt);

    this.decisionTimer += dt;
    this.aiTimer += dt;
    this.tacticsTimer += dt;

    if (
      this.decisionTimer >=
      MATCH.DECISION_INTERVAL
    ) {
      this.decisionTimer = 0;

      this.makeDecisions();
    }

    if (
      this.aiTimer >=
      MATCH.AI_UPDATE_INTERVAL
    ) {
      this.aiTimer = 0;

      this.updateAI();
    }

    if (
      this.tacticsTimer >=
      MATCH.AI_TACTICS_INTERVAL
    ) {
      this.tacticsTimer = 0;

      this.updateAITactics();
    }

    this.checkPhysicalEvents();

    this.checkBallBoundaries();

    this.checkHalftime();

    if (this.simulationSeconds >= 90 * 60) {
      this.finishMatch();
    }
  }

  /* =======================================================
     POSSESSION
     ======================================================= */

  updatePossession(dt) {
    const owner = this.getBallOwner();

    if (!owner) {
      return;
    }

    const team = owner.team;

    if (team !== "home" && team !== "away") {
      return;
    }

    this.possessionTeam = team;

    this.getTeamStats(
      team
    ).possessionSeconds += dt;
  }

  getBallOwner() {
    if (!this.ball?.ownerId) {
      return null;
    }

    return this.findPlayer(
      this.ball.ownerId
    );
  }

  findPlayer(id) {
    if (!id) return null;

    return (
      this.homePlayers.find(
        (player) => player.id === id
      ) ||
      this.awayPlayers.find(
        (player) => player.id === id
      ) ||
      null
    );
  }

  /* =======================================================
     PLAYER MOVEMENT
     ======================================================= */

  updatePlayers(dt) {
    const allPlayers = [
      ...this.homeXI,
      ...this.awayXI,
    ];

    allPlayers.forEach((player) => {
      if (!player.active) return;
      if (player.injured) return;
      if (player.redCard) return;

      this.updatePlayerMovement(
        player,
        dt
      );

      if (
        typeof player.update ===
        "function"
      ) {
        player.update(dt);
      }
    });
  }

  updatePlayerMovement(player, dt) {
    const owner = this.getBallOwner();

    if (!owner) {
      this.moveTowardBall(
        player,
        dt
      );

      return;
    }

    if (owner.id === player.id) {
      this.moveBallCarrier(
        player,
        dt
      );

      return;
    }

    if (player.team === owner.team) {
      this.moveSupportingPlayer(
        player,
        owner,
        dt
      );

      return;
    }

    this.moveDefender(
      player,
      owner,
      dt
    );
  }

  moveTowardBall(player) {
    if (!this.ball) return;

    const distance = this.distance(
      player,
      this.ball
    );

    if (distance > 150) {
      const target = this.calculateRoleTarget(
        player
      );

      this.setPlayerTarget(
        player,
        target
      );

      return;
    }

    this.setPlayerTarget(
      player,
      this.ball.x,
      this.ball.y
    );
  }

  moveBallCarrier(player) {
    const direction =
      player.team === "home"
        ? 1
        : -1;

    const targetX =
      player.x +
      direction *
      this.random(25, 70);

    const targetY =
      player.y +
      this.random(-35, 35);

    this.setPlayerTarget(
      player,
      this.clamp(
        targetX,
        60,
        PITCH.width - 60
      ),
      this.clamp(
        targetY,
        60,
        PITCH.height - 60
      )
    );
  }

  moveSupportingPlayer(
    player,
    owner
  ) {
    const base =
      this.calculateRoleTarget(
        player
      );

    const dx =
      owner.x - PITCH.width / 2;

    const supportX =
      base.x +
      dx * 0.15;

    const supportY =
      base.y +
      Math.sin(
        this.simulationSeconds / 5 +
        player.number
      ) *
      12;

    this.setPlayerTarget(
      player,
      this.clamp(
        supportX,
        40,
        PITCH.width - 40
      ),
      this.clamp(
        supportY,
        40,
        PITCH.height - 40
      )
    );
  }

  moveDefender(
    player,
    owner
  ) {
    const distance =
      this.distance(
        player,
        owner
      );

    const defensiveTarget =
      this.calculateDefensiveTarget(
        player,
        owner
      );

    if (distance < 100) {
      this.setPlayerTarget(
        player,
        owner.x,
        owner.y
      );
    } else {
      this.setPlayerTarget(
        player,
        defensiveTarget.x,
        defensiveTarget.y
      );
    }
  }

  calculateRoleTarget(player) {
    const formation =
      this.formations[player.team];

    const xi = this.getXI(
      player.team
    );

    const index = Math.max(
      0,
      xi.indexOf(player)
    );

    const position =
      getFormationPosition(
        formation,
        index,
        player.team
      );

    if (position) {
      return {
        x: position.x,
        y: position.y,
      };
    }

    return {
      x:
        PITCH.width / 2,
      y:
        PITCH.height / 2,
    };
  }

  calculateDefensiveTarget(
    player,
    owner
  ) {
    const base =
      this.calculateRoleTarget(
        player
      );

    const goalX =
      player.team === "home"
        ? 0
        : PITCH.width;

    const ratio =
      this.clamp(
        this.distance(
          owner,
          {
            x: goalX,
            y: PITCH.height / 2,
          }
        ) / PITCH.width,
        0,
        1
      );

    return {
      x:
        base.x +
        (goalX - base.x) *
        (0.15 + ratio * 0.2),

      y:
        base.y +
        (owner.y - base.y) *
        0.15,
    };
  }

  setPlayerTarget(
    player,
    x,
    y
  ) {
    if (
      !player ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }

    const targetX = this.clamp(
      x,
      20,
      PITCH.width - 20
    );

    const targetY = this.clamp(
      y,
      20,
      PITCH.height - 20
    );

    if (
      typeof player.setTarget ===
      "function"
    ) {
      player.setTarget(
        targetX,
        targetY
      );
    } else {
      player.target = {
        x: targetX,
        y: targetY,
      };
    }
  }

  /* =======================================================
     BALL
     ======================================================= */

  updateBall(dt) {
    if (!this.ball) return;

    if (
      typeof this.ball.update ===
      "function"
    ) {
      this.ball.update(dt);
    }

    const owner = this.getBallOwner();

    if (owner) {
      this.ball.x = owner.x;
      this.ball.y = owner.y;
    }
  }

  /* =======================================================
     AI DECISION MAKING
     ======================================================= */

  makeDecisions() {
    if (
      this.status !== MATCH_STATUS.LIVE
    ) {
      return;
    }

    const owner =
      this.getBallOwner();

    if (!owner) {
      this.contestLooseBall();
      return;
    }

    this.possessionTeam =
      owner.team;

    this.decideForTeam(
      owner.team,
      owner
    );
  }

  decideForTeam(
    team,
    owner
  ) {
    if (!owner) return;

    const opponents =
      this.getOpponent(team);

    const goalX =
      team === "home"
        ? PITCH.width
        : 0;

    const goalDistance =
      Math.abs(
        goalX - owner.x
      );

    const defendersNearby =
      opponents.filter(
        (player) =>
          !player.redCard &&
          !player.injured &&
          this.distance(
            player,
            owner
          ) < 110
      );

    const passingOption =
      this.findBestPassingOption(
        owner,
        team
      );

    const shootingRange =
      team === "home"
        ? owner.x >
          PITCH.width * 0.67
        : owner.x <
          PITCH.width * 0.33;

    const tactic =
      this.tactics[team];

    /* -----------------------------------------------------
       SHOOT
       ----------------------------------------------------- */

    if (
      shootingRange &&
      goalDistance < 330 &&
      this.chance(
        this.getShotDecisionProbability(
          owner,
          tactic
        )
      )
    ) {
      this.shoot(
        owner,
        team
      );

      return;
    }

    /* -----------------------------------------------------
       PASS
       ----------------------------------------------------- */

    if (
      passingOption &&
      (
        defendersNearby.length >= 2 ||
        this.chance(
          this.getPassDecisionProbability(
            owner,
            tactic
          )
        )
      )
    ) {
      this.pass(
        owner,
        passingOption
      );

      return;
    }

    /* -----------------------------------------------------
       DRIBBLE
       ----------------------------------------------------- */

    if (
      defendersNearby.length === 1 &&
      this.chance(0.55)
    ) {
      this.dribble(
        owner,
        defendersNearby[0]
      );

      return;
    }

    /* -----------------------------------------------------
       CROSS
       ----------------------------------------------------- */

    if (
      this.isWidePlayer(owner) &&
      goalDistance < 420 &&
      this.chance(0.35)
    ) {
      this.cross(
        owner,
        team
      );
    }
  }

  getShotDecisionProbability(
    player,
    tactic
  ) {
    const shooting =
      Number(
        player.shooting || 60
      );

    let probability =
      0.08 +
      shooting / 1000;

    if (
      tactic?.mentality ===
      "attacking"
    ) {
      probability += 0.05;
    }

    if (
      tactic?.tempo ===
      "fast"
    ) {
      probability += 0.02;
    }

    return this.clamp(
      probability,
      0.03,
      0.22
    );
  }

  getPassDecisionProbability(
    player,
    tactic
  ) {
    const passing =
      Number(
        player.passing || 60
      );

    let probability =
      0.25 +
      passing / 300;

    if (
      tactic?.passingStyle ===
      "short"
    ) {
      probability += 0.08;
    }

    return this.clamp(
      probability,
      0.18,
      0.65
    );
  }

  updateAI() {
    if (
      this.status !== MATCH_STATUS.LIVE
    ) {
      return;
    }

    this.runPressing();

    this.runDefensiveShape();

    this.runAttackingRuns();

    this.tryAutomaticSubstitutions();
  }

  updateAITactics() {
    if (
      this.status !== MATCH_STATUS.LIVE
    ) {
      return;
    }

    ["home", "away"].forEach(
      (team) => {
        this.adaptTeamTactics(team);
      }
    );
  }

  adaptTeamTactics(team) {
    const stats =
      this.getTeamStats(team);

    const opponent =
      this.getTeamStats(
        this.otherTeam(team)
      );

    const goalsFor =
      this.score[team];

    const goalsAgainst =
      this.score[
        this.otherTeam(team)
      ];

    const tactics =
      this.tactics[team];

    if (
      goalsAgainst > goalsFor &&
      this.minute > 55
    ) {
      tactics.mentality =
        "attacking";

      tactics.tempo =
        "fast";

      tactics.pressing =
        "high";
    }

    if (
      goalsFor > goalsAgainst &&
      this.minute > 70
    ) {
      tactics.mentality =
        "defensive";

      tactics.tempo =
        "slow";

      tactics.pressing =
        "medium";
    }

    if (
      stats.passesCompleted <
      opponent.passesCompleted * 0.6
    ) {
      tactics.passingStyle =
        "short";
    }
  }

  runPressing() {
    const owner =
      this.getBallOwner();

    if (!owner) return;

    const pressingTeam =
      this.otherTeam(
        owner.team
      );

    const pressingPlayers =
      this.getXI(
        pressingTeam
      );

    const tactic =
      this.tactics[
        pressingTeam
      ];

    if (
      tactic.pressing ===
      "low"
    ) {
      return;
    }

    pressingPlayers.forEach(
      (player) => {
        if (
          player.redCard ||
          player.injured
        ) {
          return;
        }

        const distance =
          this.distance(
            player,
            owner
          );

        if (
          distance < 240
        ) {
          this.setPlayerTarget(
            player,
            owner.x,
            owner.y
          );
        }
      }
    );
  }

  runDefensiveShape() {
    ["home", "away"].forEach(
      (team) => {
        const owner =
          this.getBallOwner();

        this.getXI(team).forEach(
          (player) => {
            if (
              player.redCard ||
              player.injured
            ) {
              return;
            }

            if (
              owner?.team === team &&
              owner.id === player.id
            ) {
              return;
            }

            const target =
              this.calculateRoleTarget(
                player
              );

            const pressure =
              owner &&
              owner.team !== team
                ? 0.25
                : 0.08;

            this.setPlayerTarget(
              player,
              target.x +
                (owner
                  ? (
                      owner.x -
                      target.x
                    ) * pressure
                  : 0),

              target.y +
                (owner
                  ? (
                      owner.y -
                      target.y
                    ) * pressure
                  : 0)
            );
          }
        );
      }
    );
  }

  runAttackingRuns() {
    const owner =
      this.getBallOwner();

    if (!owner) return;

    this.getXI(
      owner.team
    ).forEach(
      (player) => {
        if (
          player.id === owner.id ||
          player.redCard ||
          player.injured
        ) {
          return;
        }

        if (
          this.isAttacker(player) &&
          this.chance(0.45)
        ) {
          const direction =
            owner.team === "home"
              ? 1
              : -1;

          this.setPlayerTarget(
            player,
            player.x +
              direction *
              this.random(30, 100),

            player.y +
              this.random(-45, 45)
          );
        }
      }
    );
  }

  /* =======================================================
     PASSING
     ======================================================= */

  findBestPassingOption(
    passer,
    team
  ) {
    const players =
      this.getXI(team);

    const candidates =
      players.filter(
        (player) =>
          player.id !== passer.id &&
          !player.redCard &&
          !player.injured
      );

    if (!candidates.length) {
      return null;
    }

    let best = null;
    let bestScore = -Infinity;

    candidates.forEach(
      (player) => {
        const distance =
          this.distance(
            passer,
            player
          );

        if (
          distance < 35 ||
          distance > 430
        ) {
          return;
        }

        const direction =
          team === "home"
            ? player.x - passer.x
            : passer.x - player.x;

        const progress =
          direction / PITCH.width;

        const openSpace =
          this.getNearestOpponentDistance(
            player,
            team
          );

        const score =
          progress * 120 +
          openSpace * 0.3 -
          distance * 0.12 +
          Number(
            player.passing || 60
          ) *
          0.15;

        if (
          score > bestScore
        ) {
          bestScore = score;
          best = player;
        }
      }
    );

    return best;
  }

  getNearestOpponentDistance(
    player,
    team
  ) {
    const opponents =
      this.getOpponent(team);

    let minimum =
      Infinity;

    opponents.forEach(
      (opponent) => {
        const distance =
          this.distance(
            player,
            opponent
          );

        if (
          distance < minimum
        ) {
          minimum = distance;
        }
      }
    );

    return minimum;
  }

  pass(
    passer,
    receiver
  ) {
    if (
      !passer ||
      !receiver
    ) {
      return;
    }

    if (
      this.getBallOwner()?.id !==
      passer.id
    ) {
      return;
    }

    const team =
      passer.team;

    const stats =
      this.getTeamStats(team);

    stats.passes += 1;

    const passing =
      Number(
        passer.passing || 60
      );

    const distance =
      this.distance(
        passer,
        receiver
      );

    const accuracy =
      this.clamp(
        0.55 +
          passing / 220 -
          distance / 1000,
        0.45,
        0.96
      );

    const completed =
      this.chance(accuracy);

    if (completed) {
      stats.passesCompleted += 1;

      this.ball.kick?.(
        passer,
        receiver,
        this.getPassSpeed(
          distance
        ),
        "passing",
        receiver.id
      );

      this.ball.ownerId = null;
      this.ball.targetId =
        receiver.id;

      this.emit(
        EVENT_TYPES.PASS,
        {
          team,
          playerId: passer.id,
          playerName: passer.name,
          targetId: receiver.id,
          targetName: receiver.name,
          completed: true,
        }
      );

      this.pendingAction = {
        type: "pass",
        receiverId: receiver.id,
      };

      return;
    }

    /* Failed pass */

    this.ball.ownerId = null;

    const direction =
      receiver.team === "home"
        ? 1
        : -1;

    this.ball.velocity = {
      x:
        direction *
        this.random(70, 130),

      y:
        this.random(-80, 80),
    };

    this.emit(
      EVENT_TYPES.PASS,
      {
        team,
        playerId: passer.id,
        playerName: passer.name,
        targetId: receiver.id,
        targetName: receiver.name,
        completed: false,
      }
    );

    this.pendingAction = null;
  }

  getPassSpeed(distance) {
    return this.clamp(
      250 + distance * 0.7,
      280,
      600
    );
  }

  /* =======================================================
     DRIBBLING
     ======================================================= */

  dribble(
    player,
    defender
  ) {
    if (
      this.getBallOwner()?.id !==
      player.id
    ) {
      return;
    }

    const dribbling =
      Number(
        player.dribbling || 60
      );

    const tackling =
      Number(
        defender?.tackling || 60
      );

    const successProbability =
      this.clamp(
        0.45 +
          (dribbling -
            tackling) /
            250,
        0.2,
        0.8
      );

    if (
      this.chance(
        successProbability
      )
    ) {
      const direction =
        player.team === "home"
          ? 1
          : -1;

      player.x +=
        direction *
        this.random(15, 35);

      player.y +=
        this.random(-20, 20);

      this.emit(
        EVENT_TYPES.DRIBBLE,
        {
          team: player.team,
          playerId: player.id,
          playerName: player.name,
          successful: true,
        }
      );

      return;
    }

    this.tackle(
      defender,
      player
    );
  }

  /* =======================================================
     TACKLES
     ======================================================= */

  tackle(
    defender,
    attacker
  ) {
    if (
      !defender ||
      !attacker
    ) {
      return;
    }

    const team =
      defender.team;

    const stats =
      this.getTeamStats(team);

    stats.tackles += 1;

    const tackling =
      Number(
        defender.tackling || 60
      );

    const dribbling =
      Number(
        attacker.dribbling || 60
      );

    const success =
      this.chance(
        this.clamp(
          0.48 +
            (tackling -
              dribbling) /
              300,
          0.3,
          0.8
        )
      );

    if (success) {
      this.ball.ownerId =
        defender.id;

      this.ball.targetId = null;

      this.ball.x =
        defender.x;

      this.ball.y =
        defender.y;

      this.possessionTeam =
        team;

      this.emit(
        EVENT_TYPES.TACKLE,
        {
          team,
          playerId:
            defender.id,

          playerName:
            defender.name,

          won: true,
        }
      );

      return;
    }

    this.commitFoul(
      defender,
      attacker
    );
  }

  commitFoul(
    defender,
    attacker
  ) {
    const team =
      defender.team;

    const stats =
      this.getTeamStats(team);

    stats.fouls += 1;

    this.emit(
      EVENT_TYPES.FOUL,
      {
        team,
        playerId:
          defender.id,

        playerName:
          defender.name,

        victimId:
          attacker.id,
      }
    );

    const foulSeverity =
      this.random();

    if (
      foulSeverity < 0.08
    ) {
      this.giveYellowCard(
        defender
      );
    }

    if (
      foulSeverity < 0.01
    ) {
      this.giveRedCard(
        defender
      );
    }

    this.ball.ownerId =
      attacker.id;

    this.ball.x =
      attacker.x;

    this.ball.y =
      attacker.y;
  }

  /* =======================================================
     SHOOTING
     ======================================================= */

  shoot(
    player,
    team
  ) {
    if (
      this.getBallOwner()?.id !==
      player.id
    ) {
      return;
    }

    const stats =
      this.getTeamStats(team);

    stats.shots += 1;

    const goalX =
      team === "home"
        ? PITCH.width
        : 0;

    const distanceToGoal =
      Math.abs(
        goalX - player.x
      );

    const angleFactor =
      this.getShotAngleFactor(
        player,
        team
      );

    const shooting =
      Number(
        player.shooting || 60
      );

    const composure =
      Number(
        player.composure || 60
      );

    const probability =
      this.clamp(
        0.05 +
          shooting / 1500 +
          composure / 2500 +
          angleFactor * 0.06 -
          distanceToGoal / 5000,
        0.035,
        0.3
      );

    this.emit(
      EVENT_TYPES.SHOT,
      {
        team,
        playerId: player.id,
        playerName: player.name,
        distance:
          Math.round(
            distanceToGoal
          ),
      }
    );

    this.ball.ownerId = null;

    if (
      this.chance(
        probability
      )
    ) {
      this.scoreGoal(
        team,
        player
      );

      return;
    }

    const goalkeeper =
      this.getGoalkeeper(
        this.otherTeam(team)
      );

    const saveProbability =
      goalkeeper
        ? this.getSaveProbability(
            goalkeeper,
            player
          )
        : 0.15;

    if (
      this.chance(
        saveProbability
      )
    ) {
      stats.shotsOnTarget += 1;

      if (goalkeeper) {
        this.stats[
          goalkeeper.team
        ].saves += 1;
      }

      this.emit(
        EVENT_TYPES.SAVE,
        {
          team:
            goalkeeper?.team,

          goalkeeperId:
            goalkeeper?.id,

          goalkeeperName:
            goalkeeper?.name,

          shooterId:
            player.id,
        }
      );

      this.resetAfterSave(
        goalkeeper
      );

      return;
    }

    /* Miss */

    this.ball.x =
      goalX +
      (
        team === "home"
          ? this.random(-100, 20)
          : this.random(-20, 100)
      );

    this.ball.y =
      PITCH.height / 2 +
      this.random(-100, 100);

    this.ball.velocity = {
      x:
        team === "home"
          ? this.random(80, 180)
          : this.random(-180, -80),

      y:
        this.random(-100, 100),
    };

    this.emit(
      EVENT_TYPES.GOAL_KICK,
      {
        team:
          this.otherTeam(team),
      }
    );
  }

  getShotAngleFactor(
    player,
    team
  ) {
    const center =
      PITCH.height / 2;

    const verticalDistance =
      Math.abs(
        player.y - center
      );

    return this.clamp(
      1 -
        verticalDistance /
          (PITCH.height / 2),
      0,
      1
    );
  }

  getSaveProbability(
    goalkeeper,
    shooter
  ) {
    const diving =
      Number(
        goalkeeper.diving || 60
      );

    const reaction =
      Number(
        goalkeeper.reaction || 60
      );

    const shooting =
      Number(
        shooter.shooting || 60
      );

    return this.clamp(
      0.18 +
        diving / 800 +
        reaction / 1000 -
        shooting / 1500,
      0.12,
      0.55
    );
  }

  scoreGoal(
    team,
    scorer
  ) {
    if (
      team !== "home" &&
      team !== "away"
    ) {
      return;
    }

    this.score[team] += 1;

    const stats =
      this.getTeamStats(team);

    stats.goals += 1;
    stats.shotsOnTarget += 1;

    this.emit(
      EVENT_TYPES.GOAL,
      {
        team,
        playerId:
          scorer.id,

        playerName:
          scorer.name,

        homeScore:
          this.score.home,

        awayScore:
          this.score.away,
      }
    );

    this.resetAfterGoal(
      team
    );
  }

  resetAfterGoal(
    scoringTeam
  ) {
    this.ball.ownerId = null;
    this.ball.targetId = null;

    this.ball.x =
      PITCH.width / 2;

    this.ball.y =
      PITCH.height / 2;

    this.ball.velocity = {
      x: 0,
      y: 0,
    };

    this.positionTeam(
      "home",
      this.formations.home
    );

    this.positionTeam(
      "away",
      this.formations.away
    );

    const kickoffTeam =
      this.otherTeam(
        scoringTeam
      );

    const kickoffPlayer =
      this.getXI(
        kickoffTeam
      ).find(
        (player) =>
          this.isMidfielder(player)
      ) ||
      this.getXI(
        kickoffTeam
      )[5];

    if (kickoffPlayer) {
      this.ball.attach?.(
        kickoffPlayer
      );

      this.ball.x =
        PITCH.width / 2;

      this.ball.y =
        PITCH.height / 2;
    }

    this.pendingAction = null;
  }

  resetAfterSave(
    goalkeeper
  ) {
    if (!goalkeeper) {
      return;
    }

    this.ball.ownerId =
      goalkeeper.id;

    this.ball.targetId = null;

    this.ball.x =
      goalkeeper.x;

    this.ball.y =
      goalkeeper.y;
  }

  /* =======================================================
     CROSS
     ======================================================= */

  cross(
    player,
    team
  ) {
    if (
      this.getBallOwner()?.id !==
      player.id
    ) {
      return;
    }

    const attackers =
      this.getXI(team).filter(
        (p) =>
          p.id !== player.id &&
          this.isAttacker(p)
      );

    if (!attackers.length) {
      return;
    }

    const target =
      attackers.reduce(
        (best, current) => {
          if (!best) return current;

          return Math.abs(
            current.y -
              PITCH.height / 2
          ) <
            Math.abs(
              best.y -
                PITCH.height / 2
            )
            ? current
            : best;
        },
        null
      );

    if (!target) return;

    const stats =
      this.getTeamStats(team);

    stats.passes += 1;

    const accuracy =
      this.clamp(
        0.48 +
          Number(
            player.passing || 60
          ) /
            250,
        0.4,
        0.85
      );

    this.ball.ownerId = null;

    this.ball.targetId =
      target.id;

    this.ball.kick?.(
      player,
      target,
      380,
      "crossing",
      target.id
    );

    this.emit(
      EVENT_TYPES.CROSS,
      {
        team,
        playerId:
          player.id,

        playerName:
          player.name,

        targetId:
          target.id,

        accurate:
          this.chance(
            accuracy
          ),
      }
    );
  }

  /* =======================================================
     LOOSE BALL
     ======================================================= */

  contestLooseBall() {
    if (!this.ball) return;

    const candidates = [
      ...this.homeXI,
      ...this.awayXI,
    ].filter(
      (player) =>
        player.active &&
        !player.redCard &&
        !player.injured
    );

    if (!candidates.length) {
      return;
    }

    let closest = null;
    let distance = Infinity;

    candidates.forEach(
      (player) => {
        const d =
          this.distance(
            player,
            this.ball
          );

        if (d < distance) {
          distance = d;
          closest = player;
        }
      }
    );

    if (
      closest &&
      distance < 30
    ) {
      this.ball.attach?.(
        closest
      );

      this.ball.ownerId =
        closest.id;

      this.possessionTeam =
        closest.team;

      if (
        this.lastPossessionTeam &&
        this.lastPossessionTeam !==
          closest.team
      ) {
        this.getTeamStats(
          closest.team
        ).interceptions += 1;

        this.emit(
          EVENT_TYPES.INTERCEPTION,
          {
            team:
              closest.team,

            playerId:
              closest.id,

            playerName:
              closest.name,
          }
        );
      }

      this.lastPossessionTeam =
        closest.team;
    }
  }

  /* =======================================================
     BALL BOUNDARIES
     ======================================================= */

  checkBallBoundaries() {
    if (!this.ball) return;

    const x =
      Number(this.ball.x);

    const y =
      Number(this.ball.y);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }

    /* Goal is checked first */

    if (
      x <= 0 ||
      x >= PITCH.width
    ) {
      if (
        Math.abs(
          y -
            PITCH.height / 2
        ) <
        PITCH.goalWidth / 2
      ) {
        return;
      }
    }

    /* Side line */

    if (
      y <= 0 ||
      y >= PITCH.height
    ) {
      this.handleThrowIn();

      return;
    }

    /* Goal line */

    if (
      x <= 0 ||
      x >= PITCH.width
    ) {
      this.handleGoalKickOrCorner();

      return;
    }

    this.ball.x = this.clamp(
      x,
      0,
      PITCH.width
    );

    this.ball.y = this.clamp(
      y,
      0,
      PITCH.height
    );
  }

  handleThrowIn() {
    const lastTeam =
      this.ball.lastTouchTeam;

    const throwTeam =
      lastTeam
        ? this.otherTeam(
            lastTeam
          )
        : "home";

    this.ball.x =
      this.ball.x <= 0
        ? 10
        : PITCH.width - 10;

    this.ball.y =
      this.clamp(
        this.ball.y,
        30,
        PITCH.height - 30
      );

    this.ball.ownerId = null;

    this.emit(
      EVENT_TYPES.THROW_IN,
      {
        team: throwTeam,
      }
    );

    this.contestLooseBall();
  }

  handleGoalKickOrCorner() {
    const lastTeam =
      this.ball.lastTouchTeam;

    if (!lastTeam) {
      this.ball.x =
        PITCH.width / 2;

      this.ball.y =
        PITCH.height / 2;

      return;
    }

    const defendingTeam =
      this.otherTeam(
        lastTeam
      );

    const goalkeeper =
      this.getGoalkeeper(
        defendingTeam
      );

    const wasAttacking =
      lastTeam !== defendingTeam;

    if (wasAttacking) {
      const corner =
        this.isNearCorner();

      if (corner) {
        this.getTeamStats(
          lastTeam
        ).corners += 1;

        this.emit(
          EVENT_TYPES.CORNER,
          {
            team: lastTeam,
          }
        );

        this.ball.x =
          lastTeam === "home"
            ? PITCH.width - 15
            : 15;

        this.ball.y =
          this.ball.y < PITCH.height / 2
            ? 15
            : PITCH.height - 15;

        this.ball.ownerId = null;

        this.contestLooseBall();

        return;
      }
    }

    this.emit(
      EVENT_TYPES.GOAL_KICK,
      {
        team:
          defendingTeam,
      }
    );

    if (goalkeeper) {
      this.ball.attach?.(
        goalkeeper
      );

      this.ball.x =
        goalkeeper.x;

      this.ball.y =
        goalkeeper.y;
    } else {
      this.ball.x =
        defendingTeam === "home"
          ? 70
          : PITCH.width - 70;

      this.ball.y =
        PITCH.height / 2;

      this.ball.ownerId = null;
    }
  }

  isNearCorner() {
    return (
      (
        this.ball.x < 30 ||
        this.ball.x >
          PITCH.width - 30
      ) &&
      (
        this.ball.y < 50 ||
        this.ball.y >
          PITCH.height - 50
      )
    );
  }

  /* =======================================================
     OFFSIDE
     ======================================================= */

  checkOffside(
    attacker,
    receiver
  ) {
    if (
      !attacker ||
      !receiver
    ) {
      return false;
    }

    const opponents =
      this.getOpponent(
        attacker.team
      ).filter(
        (player) =>
          !player.redCard &&
          !player.injured
      );

    if (
      opponents.length < 2
    ) {
      return false;
    }

    const sorted = [
      ...opponents,
    ].sort(
      (a, b) =>
        attacker.team === "home"
          ? b.x - a.x
          : a.x - b.x
    );

    const secondLast =
      sorted[1];

    if (!secondLast) {
      return false;
    }

    if (
      attacker.team === "home"
    ) {
      return (
        receiver.x >
          secondLast.x &&
        receiver.x >
          PITCH.width / 2
      );
    }

    return (
      receiver.x <
        secondLast.x &&
      receiver.x <
        PITCH.width / 2
    );
  }

  /* =======================================================
     PHYSICAL EVENTS
     ======================================================= */

  checkPhysicalEvents() {
    const allPlayers = [
      ...this.homeXI,
      ...this.awayXI,
    ];

    allPlayers.forEach(
      (player) => {
        if (
          !player.active ||
          player.redCard ||
          player.injured
        ) {
          return;
        }

        if (
          this.chance(
            this.getInjuryProbability(
              player
            )
          )
        ) {
          this.handleInjury(
            player
          );
        }
      }
    );
  }

  getInjuryProbability(
    player
  ) {
    const stamina =
      Number(
        player.stamina || 70
      );

    let probability =
      0.00001;

    if (
      stamina < 40
    ) {
      probability += 0.00002;
    }

    if (
      this.minute > 75
    ) {
      probability += 0.000015;
    }

    return probability;
  }

  handleInjury(
    player
  ) {
    if (player.injured) {
      return;
    }

    player.injured = true;
    player.active = false;

    if (
      this.ball.ownerId ===
      player.id
    ) {
      this.ball.ownerId = null;
    }

    this.emit(
      EVENT_TYPES.INJURY,
      {
        team:
          player.team,

        playerId:
          player.id,

        playerName:
          player.name,
      }
    );

    this.forceInjurySubstitution(
      player
    );
  }

  forceInjurySubstitution(
    injuredPlayer
  ) {
    const team =
      injuredPlayer.team;

    const bench =
      this.getBench(team);

    const replacement =
      bench.find(
        (player) =>
          !player.injured &&
          !player.redCard
      );

    if (!replacement) {
      return;
    }

    this.performSubstitution(
      team,
      injuredPlayer.id,
      replacement.id,
      true
    );
  }

  /* =======================================================
     CARDS
     ======================================================= */

  giveYellowCard(
    player
  ) {
    if (!player) return;

    player.yellowCards =
      Number(
        player.yellowCards || 0
      ) + 1;

    this.getTeamStats(
      player.team
    ).yellowCards += 1;

    this.emit(
      EVENT_TYPES.YELLOW,
      {
        team:
          player.team,

        playerId:
          player.id,

        playerName:
          player.name,
      }
    );

    if (
      player.yellowCards >= 2
    ) {
      this.giveRedCard(
        player
      );
    }
  }

  giveRedCard(
    player
  ) {
    if (
      !player ||
      player.redCard
    ) {
      return;
    }

    player.redCard = true;
    player.active = false;

    this.getTeamStats(
      player.team
    ).redCards += 1;

    if (
      this.ball.ownerId ===
      player.id
    ) {
      this.ball.ownerId = null;
    }

    this.emit(
      EVENT_TYPES.RED,
      {
        team:
          player.team,

        playerId:
          player.id,

        playerName:
          player.name,
      }
    );
  }

  /* =======================================================
     SUBSTITUTIONS
     ======================================================= */

  tryAutomaticSubstitutions() {
    if (
      this.minute < 55 ||
      this.minute > 88
    ) {
      return;
    }

    ["home", "away"].forEach(
      (team) => {
        if (
          this.getSubstitutionsUsed(
            team
          ) >= MATCH.MAX_SUBSTITUTIONS
        ) {
          return;
        }

        const xi =
          this.getXI(team);

        const bench =
          this.getBench(team);

        if (!bench.length) {
          return;
        }

        const tired =
          xi.find(
            (player) =>
              Number(
                player.stamina || 100
              ) < 22 &&
              !player.injured &&
              !player.redCard
          );

        if (
          tired &&
          this.chance(0.35)
        ) {
          const replacement =
            bench.find(
              (player) =>
                !player.injured &&
                !player.redCard
            );

          if (replacement) {
            this.performSubstitution(
              team,
              tired.id,
              replacement.id
            );
          }
        }
      }
    );
  }

  getSubstitutionsUsed(
    team
  ) {
    return team === "home"
      ? this.homeSubstitutions
      : this.awaySubstitutions;
  }

  performSubstitution(
    team,
    outgoingId,
    incomingId,
    forced = false
  ) {
    if (
      team !== "home" &&
      team !== "away"
    ) {
      return false;
    }

    if (
      !forced &&
      this.getSubstitutionsUsed(
        team
      ) >= MATCH.MAX_SUBSTITUTIONS
    ) {
      return false;
    }

    const xi =
      this.getXI(team);

    const bench =
      this.getBench(team);

    const outgoing =
      xi.find(
        (player) =>
          player.id === outgoingId
      );

    const incoming =
      bench.find(
        (player) =>
          player.id === incomingId
      );

    if (
      !outgoing ||
      !incoming
    ) {
      return false;
    }

    const outgoingIndex =
      xi.indexOf(outgoing);

    if (outgoingIndex < 0) {
      return false;
    }

    incoming.active = true;
    incoming.redCard = false;
    incoming.injured = false;

    outgoing.active = false;

    const oldTarget = {
      x: outgoing.x,
      y: outgoing.y,
    };

    incoming.x =
      oldTarget.x;

    incoming.y =
      oldTarget.y;

    this.setPlayerTarget(
      incoming,
      oldTarget.x,
      oldTarget.y
    );

    xi[outgoingIndex] =
      incoming;

    const benchIndex =
      bench.indexOf(incoming);

    if (benchIndex >= 0) {
      bench.splice(
        benchIndex,
        1
      );
    }

    bench.push(outgoing);

    if (team === "home") {
      this.homeSubstitutions += 1;
    } else {
      this.awaySubstitutions += 1;
    }

    this.getTeamStats(
      team
    ).substitutions += 1;

    this.emit(
      EVENT_TYPES.SUBSTITUTION,
      {
        team,

        outgoingId:
          outgoing.id,

        outgoingName:
          outgoing.name,

        incomingId:
          incoming.id,

        incomingName:
          incoming.name,

        forced,
      }
    );

    return true;
  }

  /* =======================================================
     FORMATION
     ======================================================= */

  setFormation(
    team,
    formation
  ) {
    const valid = [
      "4-4-2",
      "4-3-3",
      "3-5-2",
      "5-3-2",
      "4-2-3-1",
    ];

    if (
      !valid.includes(
        formation
      )
    ) {
      return false;
    }

    if (
      team !== "home" &&
      team !== "away"
    ) {
      return false;
    }

    this.formations[team] =
      formation;

    this.positionTeam(
      team,
      formation
    );

    return true;
  }

  setTactics(
    team,
    tactics
  ) {
    if (
      team !== "home" &&
      team !== "away"
    ) {
      return false;
    }

    this.tactics[team] = {
      ...this.tactics[team],
      ...tactics,
    };

    return true;
  }

  setUserControlled(
    team
  ) {
    if (
      team !== null &&
      team !== "home" &&
      team !== "away"
    ) {
      return false;
    }

    this.userControlled =
      team;

    return true;
  }

  /* =======================================================
     HALFTIME
     ======================================================= */

  checkHalftime() {
    if (
      this.halfTimeEmitted
    ) {
      return;
    }

    if (
      this.simulationSeconds <
      45 * 60
    ) {
      return;
    }

    if (
      this.secondHalfStarted
    ) {
      return;
    }

    this.simulationSeconds =
      45 * 60;

    this.minute = 45;

    this.status =
      MATCH_STATUS.HALF_TIME;

    this.started = false;

    this.halfTimeEmitted = true;

    this.ball.stop?.();

    this.emit(
      EVENT_TYPES.HALF_TIME,
      {
        homeScore:
          this.score.home,

        awayScore:
          this.score.away,
      }
    );
  }

  /* =======================================================
     PLAYER ROLE HELPERS
     ======================================================= */

  normalizePosition(
    player
  ) {
    return String(
      player?.position ||
        player?.role ||
        ""
    )
      .trim()
      .toLowerCase();
  }

  isGoalkeeper(
    player
  ) {
    const position =
      this.normalizePosition(
        player
      );

    return (
      position.includes("goal") ||
      position === "gk" ||
      position === "keeper"
    );
  }

  isDefender(
    player
  ) {
    const position =
      this.normalizePosition(
        player
      );

    return (
      position.includes("def") ||
      position === "cb" ||
      position === "lb" ||
      position === "rb" ||
      position === "lwb" ||
      position === "rwb"
    );
  }

  isMidfielder(
    player
  ) {
    const position =
      this.normalizePosition(
        player
      );

    return (
      position.includes("mid") ||
      position === "cm" ||
      position === "dm" ||
      position === "am" ||
      position === "lm" ||
      position === "rm"
    );
  }

  isAttacker(
    player
  ) {
    const position =
      this.normalizePosition(
        player
      );

    return (
      position.includes("attack") ||
      position.includes("forward") ||
      position.includes("striker") ||
      position === "st" ||
      position === "cf" ||
      position === "lw" ||
      position === "rw"
    );
  }

  isWidePlayer(
    player
  ) {
    const position =
      this.normalizePosition(
        player
      );

    return (
      position.includes("wing") ||
      position === "lw" ||
      position === "rw" ||
      position === "lm" ||
      position === "rm" ||
      position === "lb" ||
      position === "rb"
    );
  }

  getGoalkeeper(
    team
  ) {
    const players =
      this.getXI(team);

    return (
      players.find(
        (player) =>
          this.isGoalkeeper(
            player
          )
      ) ||
      players[0] ||
      null
    );
  }

  /* =======================================================
     SNAPSHOT
     ======================================================= */

  getPossessionPercent(
    team
  ) {
    const total =
      this.stats.home
        .possessionSeconds +
      this.stats.away
        .possessionSeconds;

    if (total <= 0) {
      return 50;
    }

    return Math.round(
      (
        this.getTeamStats(team)
          .possessionSeconds /
        total
      ) *
        100
    );
  }

  getTeamSnapshot(
    team
  ) {
    return {
      clubId:
        team === "home"
          ? this.homeClub.id ||
            this.homeClub.clubId ||
            null
          : this.awayClub.id ||
            this.awayClub.clubId ||
            null,

      clubName:
        team === "home"
          ? this.homeClub.name ||
            this.homeClub.clubName ||
            "Home"
          : this.awayClub.name ||
            this.awayClub.clubName ||
            "Away",

      formation:
        this.formations[team],

      tactics: {
        ...this.tactics[team],
      },

      lineup:
        this.getXI(team).map(
          (player) =>
            typeof player.toSnapshot ===
            "function"
              ? player.toSnapshot()
              : this.serializePlayer(
                  player
                )
        ),

      bench:
        this.getBench(team).map(
          (player) =>
            typeof player.toSnapshot ===
            "function"
              ? player.toSnapshot()
              : this.serializePlayer(
                  player
                )
        ),

      stats: {
        ...this.getTeamStats(team),

        possession:
          this.getPossessionPercent(
            team
          ),
      },

      substitutionsUsed:
        this.getSubstitutionsUsed(
          team
        ),
    };
  }

  serializePlayer(
    player
  ) {
    return {
      id: player.id,
      name: player.name,
      number:
        player.number ??
        player.shirtNumber ??
        null,

      team:
        player.team,

      position:
        player.position ||
        null,

      x:
        Number(
          player.x || 0
        ),

      y:
        Number(
          player.y || 0
        ),

      active:
        player.active !== false,

      injured:
        Boolean(
          player.injured
        ),

      redCard:
        Boolean(
          player.redCard
        ),

      yellowCards:
        Number(
          player.yellowCards ||
            0
        ),

      stamina:
        Number(
          player.stamina || 0
        ),
    };
  }

  getSnapshot() {
    return {
      status:
        this.status,

      minute:
        this.minute,

      simulationSeconds:
        this.simulationSeconds,

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

      homeClub: {
        ...this.homeClub,
      },

      awayClub: {
        ...this.awayClub,
      },

      home: this.getTeamSnapshot(
        "home"
      ),

      away: this.getTeamSnapshot(
        "away"
      ),

      homeFormation:
        this.formations.home,

      awayFormation:
        this.formations.away,

      homeTactics: {
        ...this.tactics.home,
      },

      awayTactics: {
        ...this.tactics.away,
      },

      homeLineup:
        this.getXI("home").map(
          (player) =>
            this.serializePlayer(
              player
            )
        ),

      awayLineup:
        this.getXI("away").map(
          (player) =>
            this.serializePlayer(
              player
            )
        ),

      homeBench:
        this.getBench("home").map(
          (player) =>
            this.serializePlayer(
              player
            )
        ),

      awayBench:
        this.getBench("away").map(
          (player) =>
            this.serializePlayer(
              player
            )
        ),

      homeStats: {
        ...this.stats.home,

        possession:
          this.getPossessionPercent(
            "home"
          ),
      },

      awayStats: {
        ...this.stats.away,

        possession:
          this.getPossessionPercent(
            "away"
          ),
      },

      events:
        [...this.events],

      ball:
        this.ball &&
        typeof this.ball.toSnapshot ===
          "function"
          ? this.ball.toSnapshot()
          : {
              x:
                Number(
                  this.ball?.x || 0
                ),

              y:
                Number(
                  this.ball?.y || 0
                ),

              ownerId:
                this.ball?.ownerId ||
                null,

              targetId:
                this.ball?.targetId ||
                null,
            },

      possessionTeam:
        this.possessionTeam,

      userControlled:
        this.userControlled,

      homeSubsUsed:
        this.homeSubstitutions,

      awaySubsUsed:
        this.awaySubstitutions,
    };
  }

  /* =======================================================
     FIRESTORE SAVE PAYLOAD
     ======================================================= */

  getSavePayload() {
    const snapshot =
      this.getSnapshot();

    return {
      status:
        snapshot.status,

      minute:
        Number(
          snapshot.minute.toFixed(2)
        ),

      simulationSeconds:
        Number(
          snapshot.simulationSeconds.toFixed(
            2
          )
        ),

      homeScore:
        snapshot.homeScore,

      awayScore:
        snapshot.awayScore,

      homeStats:
        snapshot.homeStats,

      awayStats:
        snapshot.awayStats,

      events:
        snapshot.events,

      homeFormation:
        snapshot.homeFormation,

      awayFormation:
        snapshot.awayFormation,

      homeTactics:
        snapshot.homeTactics,

      awayTactics:
        snapshot.awayTactics,

      homeLineupIds:
        snapshot.homeLineup.map(
          (player) =>
            player.id
        ),

      awayLineupIds:
        snapshot.awayLineup.map(
          (player) =>
            player.id
        ),

      homeBenchIds:
        snapshot.homeBench.map(
          (player) =>
            player.id
        ),

      awayBenchIds:
        snapshot.awayBench.map(
          (player) =>
            player.id
        ),

      homeSubsUsed:
        snapshot.homeSubsUsed,

      awaySubsUsed:
        snapshot.awaySubsUsed,

      ball:
        snapshot.ball,

      possessionTeam:
        snapshot.possessionTeam,
    };
  }

  /* =======================================================
     RESET
     ======================================================= */

  reset() {
    this.minute = 0;
    this.simulationSeconds = 0;

    this.status =
      MATCH_STATUS.READY;

    this.started = false;

    this.secondHalfStarted =
      false;

    this.kickoffEmitted =
      false;

    this.halfTimeEmitted =
      false;

    this.fullTimeEmitted =
      false;

    this.score.home = 0;
    this.score.away = 0;

    this.events = [];

    this.stats.home =
      this.createStats();

    this.stats.away =
      this.createStats();

    this.homeSubstitutions = 0;
    this.awaySubstitutions = 0;

    this.possessionTeam = null;
    this.lastPossessionTeam = null;

    this.initializePlayers();
    this.initializeBall();
  }
}

export default MatchEngine;
