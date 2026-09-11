// lib/match-engine/engine.js

import {
  BALL_STATE,
  DEFAULT_STATS,
  EVENTS,
  FIELD,
  MATCH,
  clamp,
  distance,
} from "./constants";

import {
  createBall,
  setBallOwner,
  releaseBall,
  updateBall,
  moveBallWithOwner,
  clampBallToField,
} from "./ball";

import {
  createTeam,
  getTeamPlayer,
  updateTeamMinutes,
} from "./team";

import {
  updatePlayerMovement,
} from "./movement";

import {
  updateAI,
} from "./ai";

import {
  attemptTackle,
} from "./defending";

import {
  resolveShot,
} from "./shooting";

import {
  aiSubstitute,
  performSubstitution,
} from "./substitutions";

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

    durationSeconds =
      MATCH.REAL_DURATION_SECONDS,

    initialScore = {
      home: 0,
      away: 0,
    },

    initialMinute = 0,

    initialEvents = [],

    onEvent = null,
  }) {
    this.matchId = matchId;

    this.home = createTeam({
      side: "home",
      club: homeTeam,
      players: homePlayers,
      lineupIds:
        homeLineupIds,
      formation:
        formationHome,
      tactics:
        tacticsHome,
    });

    this.away = createTeam({
      side: "away",
      club: awayTeam,
      players: awayPlayers,
      lineupIds:
        awayLineupIds,
      formation:
        formationAway,
      tactics:
        tacticsAway,
    });

    this.ball =
      createBall();

    this.durationSeconds =
      durationSeconds;

    this.realSeconds = 0;

    this.simSeconds =
      (initialMinute / 90) *
      MATCH.REAL_DURATION_SECONDS;

    this.minute =
      initialMinute;

    this.second = 0;

    this.status =
      "not_started";

    this.score = {
      home:
        Number(
          initialScore?.home
        ) || 0,

      away:
        Number(
          initialScore?.away
        ) || 0,
    };

    this.events =
      Array.isArray(
        initialEvents
      )
        ? [...initialEvents]
        : [];

    this.eventCounter =
      this.events.length;

    this.onEvent =
      onEvent;

    this.lastShot = null;

    this.lastPass = null;

    this.lastTouchTeam = null;
    this.lastTouchPlayerId =
      null;

    this.halfTimeTriggered =
      false;

    this.fullTimeTriggered =
      false;

    this.aiTimer = 0;
    this.substitutionTimer =
      0;

    this.kickoffTaken = false;

    this.lastUiSecond =
      -1;

    this.lastPossessionTeam =
      "home";

    this.lastEventTime = 0;

    this.resetPositions();
  }

  getTeams() {
    return [
      this.home,
      this.away,
    ];
  }

  getTeam(side) {
    return side === "home"
      ? this.home
      : this.away;
  }

  getOpponent(side) {
    return side === "home"
      ? this.away
      : this.home;
  }

  getPlayer(id) {
    if (!id) return null;

    return (
      this.home.players.find(
        (p) =>
          String(p.id) ===
          String(id)
      ) ||
      this.away.players.find(
        (p) =>
          String(p.id) ===
          String(id)
      ) ||
      null
    );
  }

  resetPositions() {
    for (const team of [
      this.home,
      this.away,
    ]) {
      for (const player of team.players) {
        player.x =
          player.homeX *
          FIELD.width;

        player.y =
          player.homeY *
          FIELD.height;

        player.vx = 0;
        player.vy = 0;

        player.hasBall = false;
      }
    }

    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.ball.ownerId =
      null;

    this.ball.state =
      BALL_STATE.FREE;
  }

  start() {
    if (
      this.status ===
      "finished"
    ) {
      return;
    }

    this.status = "live";

    if (
      !this.kickoffTaken
    ) {
      this.kickoffTaken =
        true;

      this.addEvent({
        type: EVENTS.KICKOFF,
        team: "home",
        player:
          this.home.players.find(
            (p) =>
              p.role === "ST" ||
              p.role === "CF" ||
              p.role === "CM"
          ),
        text: "Kick-off. The match begins.",
      });

      this.kickoff();
    }
  }

  kickoff() {
    const midfielders =
      this.home.players
        .filter(
          (p) =>
            !p.redCard &&
            p.position !== "GK"
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
        );

    const player =
      midfielders[0] ||
      this.home.players[0];

    if (player) {
      player.x =
        FIELD.centerX -
        20;

      player.y =
        FIELD.centerY;

      setBallOwner(
        this.ball,
        player
      );

      this.lastTouchTeam =
        "home";

      this.lastTouchPlayerId =
        player.id;
    }
  }

  update(dt) {
    if (
      this.status !== "live"
    ) {
      return;
    }

    const safeDt =
      clamp(
        dt,
        0,
        0.05
      );

    this.realSeconds +=
      safeDt;

    this.simSeconds +=
      safeDt *
      MATCH.SIM_MINUTES_PER_REAL_SECOND *
      60;

    this.minute =
      Math.min(
        90,
        Math.floor(
          this.simSeconds / 60
        )
      );

    this.second =
      Math.floor(
        this.simSeconds % 60
      );

    this.updatePossession(
      safeDt
    );

    updatePlayerMovement(
      this.home,
      this.away,
      this.ball,
      safeDt
    );

    updatePlayerMovement(
      this.away,
      this.home,
      this.ball,
      safeDt
    );

    updateBall(
      this.ball,
      safeDt
    );

    this.handleBallOwner(
      safeDt
    );

    this.handleBallPhysics(
      safeDt
    );

    this.handleTackles(
      safeDt
    );

    updateAI(
      this,
      this.home,
      this.away,
      safeDt
    );

    updateAI(
      this,
      this.away,
      this.home,
      safeDt
    );

    updateTeamMinutes(
      this.home,
      safeDt
    );

    updateTeamMinutes(
      this.away,
      safeDt
    );

    this.updatePossessionStats(
      safeDt
    );

    this.aiTimer +=
      safeDt;

    this.substitutionTimer +=
      safeDt;

    if (
      this.substitutionTimer >
      7
    ) {
      this.substitutionTimer =
        0;

      aiSubstitute(
        this,
        this.home
      );

      aiSubstitute(
        this,
        this.away
      );
    }

    this.handleHalfTime();

    this.handleFullTime();
  }

  updatePossession(dt) {
    const owner =
      this.getPlayer(
        this.ball.ownerId
      );

    if (owner) {
      this.lastPossessionTeam =
        owner.side;
    }
  }

  updatePossessionStats(dt) {
    if (
      this.lastPossessionTeam ===
      "home"
    ) {
      this.home.stats.possessionSeconds +=
        dt;
    } else {
      this.away.stats.possessionSeconds +=
        dt;
    }
  }

  handleBallOwner() {
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
      owner.hasBall =
        false;

      this.ball.ownerId =
        null;

      this.ball.state =
        BALL_STATE.FREE;

      return;
    }

    moveBallWithOwner(
      this.ball,
      owner
    );

    this.lastTouchTeam =
      owner.side;

    this.lastTouchPlayerId =
      owner.id;

    const opponent =
      this.getOpponent(
        owner.side
      );

    const nearest =
      opponent.players
        .filter(
          (p) =>
            !p.redCard
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
        )[0];

    if (
      nearest &&
      distance(
        nearest,
        owner
      ) < 24
    ) {
      const team =
        this.getTeam(
          owner.side
        );

      attemptTackle(
        this,
        nearest,
        owner,
        opponent
      );
    }

    this.checkAttackingDecision(
      owner
    );
  }

  checkAttackingDecision(
    player
  ) {
    if (!player.hasBall) {
      return;
    }

    const team =
      this.getTeam(
        player.side
      );

    const opponent =
      this.getOpponent(
        player.side
      );

    const goalX =
      team.attackDirection === 1
        ? FIELD.width
        : 0;

    const goalDistance =
      Math.hypot(
        goalX -
          player.x,
        FIELD.centerY -
          player.y
      );

    const pressure =
      opponent.players.reduce(
        (nearest, defender) =>
          Math.min(
            nearest,
            distance(
              player,
              defender
            )
          ),
        Infinity
      );

    if (
      goalDistance <
        360 &&
      player.lastActionAt >
        1.4
    ) {
      const chance =
        0.18 +
        player.shooting /
          400;

      if (
        Math.random() <
        chance
      ) {
        const {
          attemptShot,
        } =
          require("./shooting");

        attemptShot(
          this,
          team,
          opponent,
          player
        );

        player.lastActionAt = 0;

        return;
      }
    }

    if (
      pressure < 90 &&
      player.lastActionAt >
        1.0
    ) {
      const {
        attemptPass,
      } =
        require("./passing");

      if (
        attemptPass(
          this,
          team,
          opponent,
          player
        )
      ) {
        player.lastActionAt = 0;
      }
    }
  }

  handleBallPhysics() {
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

    if (
      this.ball.state ===
      BALL_STATE.SAVED
    ) {
      const goalkeeper =
        this.getPlayer(
          this.ball.ownerId
        );

      if (
        goalkeeper
      ) {
        setBallOwner(
          this.ball,
          goalkeeper
        );
      }
    }

    this.checkBoundaries();
  }

  checkPassReception() {
    let closest = null;
    let closestDistance =
      Infinity;

    for (const team of [
      this.home,
      this.away,
    ]) {
      for (const player of team.players) {
        if (
          player.redCard
        ) {
          continue;
        }

        const d =
          distance(
            player,
            this.ball
          );

        if (
          d <
          closestDistance
        ) {
          closestDistance = d;
          closest = player;
        }
      }
    }

    if (
      closest &&
      closestDistance <
        20
    ) {
      const previousTeam =
        this.lastTouchTeam;

      if (
        closest.side ===
        previousTeam
      ) {
        setBallOwner(
          this.ball,
          closest
        );

        this.lastPass = {
          receiverId:
            closest.id,
          team:
            closest.side,
        };

        return;
      }

      const defendingTeam =
        this.getTeam(
          closest.side
        );

      const attackingTeam =
        this.getOpponent(
          closest.side
        );

      const receiver =
        this.getPlayer(
          this.ball.lastTouchPlayerId
        );

      if (
        receiver &&
        Math.random() <
          0.18
      ) {
        setBallOwner(
          this.ball,
          closest
        );

        defendingTeam.stats.interceptions +=
          1;

        closest.interceptions +=
          1;

        this.addEvent({
          type: EVENTS.INTERCEPTION,
          team:
            defendingTeam.side,
          player: closest,
          relatedPlayer: receiver,
          text: `${closest.name} intercepts the pass`,
        });

        return;
      }

      setBallOwner(
        this.ball,
        closest
      );
    }
  }

  checkShot() {
    const shooterTeam =
      this.lastShot
        ? this.getTeam(
            this.lastShot.team
          )
        : null;

    if (!shooterTeam) {
      return;
    }

    const goalX =
      shooterTeam.attackDirection ===
      1
        ? FIELD.width
        : 0;

    const crossed =
      shooterTeam.attackDirection ===
      1
        ? this.ball.x >=
          FIELD.width
        : this.ball.x <= 0;

    if (
      crossed
    ) {
      const opponent =
        this.getOpponent(
          shooterTeam.side
        );

      resolveShot(
        this,
        shooterTeam,
        opponent
      );
    }
  }

  checkBoundaries() {
    if (
      this.ball.state ===
      BALL_STATE.POSSESSED
    ) {
      return;
    }

    const outsideLeft =
      this.ball.x < 0;

    const outsideRight =
      this.ball.x >
      FIELD.width;

    const outsideTop =
      this.ball.y < 0;

    const outsideBottom =
      this.ball.y >
      FIELD.height;

    if (
      outsideTop ||
      outsideBottom
    ) {
      this.ball.state =
        BALL_STATE.OUT;

      this.handleThrowIn(
        outsideTop ||
          outsideBottom
          ? "sideline"
          : "unknown"
      );

      return;
    }

    if (
      outsideLeft ||
      outsideRight
    ) {
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
      team.players.find(
        (p) =>
          !p.redCard &&
          p.position !== "GK"
      );

    if (!player) {
      return;
    }

    this.ball.x =
      clamp(
        this.ball.x,
        5,
        FIELD.width - 5
      );

    this.ball.y =
      clamp(
        this.ball.y,
        5,
        FIELD.height - 5
      );

    setBallOwner(
      this.ball,
      player
    );

    this.addEvent({
      type: EVENTS.THROW_IN,
      team: team.side,
      player,
      text: `${team.name} takes a throw-in`,
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

    const defendingGoalkeeper =
      defendingTeam.players.find(
        (p) =>
          p.position ===
            "GK" &&
          !p.redCard
      );

    if (
      !defendingGoalkeeper
    ) {
      return;
    }

    const corner =
      this.lastTouchTeam ===
      attackingTeam.side;

    if (corner) {
      attackingTeam.stats.corners +=
        1;

      this.addEvent({
        type: EVENTS.CORNER,
        team:
          attackingTeam.side,
        text: `${attackingTeam.name} wins a corner`,
      });

      const cornerPlayer =
        attackingTeam.players.find(
          (p) =>
            ["LW", "RW", "LM", "RM"].includes(
              p.role
            )
        ) ||
        attackingTeam.players[0];

      if (cornerPlayer) {
        cornerPlayer.x =
          defendingTeam.side ===
          "home"
            ? 25
            : FIELD.width - 25;

        cornerPlayer.y =
          this.ball.y <
          FIELD.centerY
            ? 25
            : FIELD.height - 25;

        setBallOwner(
          this.ball,
          cornerPlayer
        );
      }
    } else {
      this.addEvent({
        type: EVENTS.GOAL_KICK,
        team:
          defendingTeam.side,
        player:
          defendingGoalkeeper,
        text: `${defendingTeam.name} takes a goal kick`,
      });

      setBallOwner(
        this.ball,
        defendingGoalkeeper
      );
    }
  }

  scoreGoal(
    team,
    scorer
  ) {
    team.score += 1;

    this.score[
      team.side
    ] += 1;

    team.stats.goals +=
      1;

    if (scorer) {
      scorer.goals += 1;
    }

    let assistPlayer =
      null;

    if (
      this.lastPass &&
      this.lastPass.team ===
        team.side &&
      this.lastPass.receiverId &&
      this.lastPass.receiverId !==
        scorer?.id
    ) {
      assistPlayer =
        this.getPlayer(
          this.lastPass.receiverId
        );

      if (
        assistPlayer
      ) {
        assistPlayer.assists +=
          1;

        team.stats.assists +=
          1;
      }
    }

    this.addEvent({
      type: EVENTS.GOAL,
      team: team.side,
      player: scorer,
      relatedPlayer:
        assistPlayer,
      text: `${team.name} scores! ${scorer?.name ?? "Goal"}`,
    });

    this.ball.state =
      BALL_STATE.GOAL;

    this.resetAfterGoal();
  }

  resetAfterGoal() {
    for (const team of [
      this.home,
      this.away,
    ]) {
      for (const player of team.players) {
        player.hasBall =
          false;
      }
    }

    this.ball.ownerId =
      null;

    this.ball.vx = 0;
    this.ball.vy = 0;

    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.ball.state =
      BALL_STATE.FREE;

    const kickoffTeam =
      this.score.home >
      this.score.away
        ? this.away
        : this.score.away >
          this.score.home
        ? this.home
        : this.lastTouchTeam ===
          "home"
        ? this.away
        : this.home;

    const player =
      kickoffTeam.players.find(
        (p) =>
          !p.redCard &&
          ["ST", "CF", "CM"].includes(
            p.role
          )
      ) ||
      kickoffTeam.players[0];

    if (player) {
      player.x =
        kickoffTeam.side ===
        "home"
          ? FIELD.centerX -
            20
          : FIELD.centerX +
            20;

      player.y =
        FIELD.centerY;

      setBallOwner(
        this.ball,
        player
      );

      this.lastTouchTeam =
        kickoffTeam.side;

      this.lastTouchPlayerId =
        player.id;
    }
  }

  handleTackles() {
    const homeCarrier =
      this.home.players.find(
        (p) => p.hasBall
      );

    const awayCarrier =
      this.away.players.find(
        (p) => p.hasBall
      );

    if (
      homeCarrier
    ) {
      this.checkNearbyDefender(
        this.away,
        homeCarrier
      );
    }

    if (
      awayCarrier
    ) {
      this.checkNearbyDefender(
        this.home,
        awayCarrier
      );
    }
  }

  checkNearbyDefender(
    defendingTeam,
    attacker
  ) {
    const defender =
      defendingTeam.players
        .filter(
          (p) =>
            !p.redCard &&
            p.position !== "GK"
        )
        .sort(
          (a, b) =>
            distance(
              a,
              attacker
            ) -
            distance(
              b,
              attacker
            )
        )[0];

    if (!defender) {
      return;
    }

    const d =
      distance(
        defender,
        attacker
      );

    if (
      d < 25 &&
      Math.random() <
        0.025
    ) {
      attemptTackle(
        this,
        defender,
        attacker,
        defendingTeam
      );
    }
  }

  handleHalfTime() {
    if (
      this.minute >= 45 &&
      !this.halfTimeTriggered
    ) {
      this.halfTimeTriggered =
        true;

      this.addEvent({
        type: EVENTS.HALFTIME,
        text: "Half-time",
      });
    }
  }

  handleFullTime() {
    if (
      this.minute >= 90 &&
      !this.fullTimeTriggered
    ) {
      this.fullTimeTriggered =
        true;

      this.status =
        "finished";

      this.addEvent({
        type: EVENTS.FULLTIME,
        text: `Full-time. ${this.score.home}-${this.score.away}`,
      });
    }
  }

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

      minute: this.minute,

      second: this.second,

      type,

      team,

      playerId:
        player?.id ?? null,

      playerName:
        player?.name ?? null,

      playerNumber:
        player?.number ?? null,

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

    this.events.push(event);

    if (
      this.events.length >
      300
    ) {
      this.events =
        this.events.slice(
          -300
        );
    }

    if (
      typeof this.onEvent ===
      "function"
    ) {
      this.onEvent(event);
    }

    return event;
  }

  setUserTactics(
    tactics
  ) {
    this.home.tactics = {
      ...this.home.tactics,
      ...tactics,
    };
  }

  setFormation(
    side,
    formation
  ) {
    const team =
      this.getTeam(side);

    if (!team) {
      return;
    }

    team.formation =
      formation;
  }

  substituteUser(
    outgoingId,
    incomingId
  ) {
    return performSubstitution(
      this,
      this.home,
      outgoingId,
      incomingId,
      false
    );
  }

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

      score: {
        ...this.score,
      },

      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        state: this.ball.state,
        ownerId:
          this.ball.ownerId,
      },

      home: {
        id: this.home.id,
        name: this.home.name,
        logo: this.home.logo,
        formation:
          this.home.formation,
        tactics: {
          ...this.home.tactics,
        },
        score:
          this.score.home,
        stats: {
          ...this.home.stats,
        },
        substitutionsUsed:
          this.home.substitutionsUsed,

        players:
          this.home.players.map(
            (p) => ({
              ...p,
            })
          ),
      },

      away: {
        id: this.away.id,
        name: this.away.name,
        logo: this.away.logo,
        formation:
          this.away.formation,
        tactics: {
          ...this.away.tactics,
        },
        score:
          this.score.away,
        stats: {
          ...this.away.stats,
        },
        substitutionsUsed:
          this.away.substitutionsUsed,

        players:
          this.away.players.map(
            (p) => ({
              ...p,
            })
          ),
      },

      events:
        this.events.slice(
          -100
        ),
    };
  }

  getEventsSince(
    index
  ) {
    return this.events.slice(
      index
    );
  }

  serializeResult() {
    return {
      status:
        this.status,

      minute:
        this.minute,

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

      homeStats: {
        ...this.home.stats,
      },

      awayStats: {
        ...this.away.stats,
      },

      events: [
        ...this.events,
      ],

      homeSubstitutions:
        this.home.substitutionsUsed,

      awaySubstitutions:
        this.away.substitutionsUsed,

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
