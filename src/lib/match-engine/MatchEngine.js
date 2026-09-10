import Player from "./Player";
import Ball from "./Ball";
import Vector2 from "./Vector2";

import {
  BALL_STATE,
  DEFAULT_TACTICS,
  EVENT_TYPES,
  MATCH,
  MATCH_STATUS,
  PLAYER_STATE,
  PITCH,
} from "./constants";

import {
  getFormationPosition,
  normalizeFormation,
} from "./Formation";

const clamp = (
  value,
  min,
  max
) =>
  Math.max(
    min,
    Math.min(max, value)
  );

const random = (
  min = 0,
  max = 1
) =>
  min +
  Math.random() *
    (max - min);

const chance = (
  probability
) =>
  Math.random() <
  probability;

const distance = (
  a,
  b
) =>
  Math.sqrt(
    Math.pow(
      a.x - b.x,
      2
    ) +
      Math.pow(
        a.y - b.y,
        2
      )
  );

export default class MatchEngine {
  constructor({
    match,
    homeClub,
    awayClub,
    homePlayers,
    awayPlayers,
  }) {
    this.match =
      match;

    this.homeClub =
      homeClub;

    this.awayClub =
      awayClub;

    this.running =
      false;

    this.paused =
      false;

    this.finished =
      false;

    this.simulationTime =
      clamp(
        Number(
          match?.minute
        ) || 0,
        0,
        90
      );

    this.homeScore =
      Number(
        match?.homeScore
      ) || 0;

    this.awayScore =
      Number(
        match?.awayScore
      ) || 0;

    this.status =
      normalizeStatus(
        match?.status
      );

    this.accumulator =
      0;

    this.decisionTimer =
      0;

    this.aiTimer =
      0;

    this.eventCounter =
      0;

    this.lastEvent =
      null;

    this.ball =
      new Ball();

    this.players = [];

    this.homeXI = [];

    this.awayXI = [];

    this.homeBench = [];

    this.awayBench = [];

    this.substitutions = {
      home: 0,
      away: 0,
    };

    this.homeFormation =
      normalizeFormation(
        match?.homeFormation ||
          match?.formation ||
          "4-4-2"
      );

    this.awayFormation =
      normalizeFormation(
        match?.awayFormation ||
          "4-4-2"
      );

    this.homeTactics =
      normalizeTactics(
        match?.homeTactics
      );

    this.awayTactics =
      normalizeTactics(
        match?.awayTactics
      );

    this.homeStats =
      createStats(
        match?.homeStats
      );

    this.awayStats =
      createStats(
        match?.awayStats
      );

    this.events =
      Array.isArray(
        match?.events
      )
        ? [...match.events]
        : [];

    this.buildTeams(
      homePlayers,
      awayPlayers
    );

    this.placeBallForKickoff();

    if (
      this.status ===
      MATCH_STATUS.FINISHED
    ) {
      this.finished =
        true;
    }
  }

  buildTeams(
    rawHome,
    rawAway
  ) {
    const homeXI =
      this.selectStartingXI(
        rawHome,
        "home",
        this.homeFormation,
        this.match
          ?.homeLineupIds
      );

    const awayXI =
      this.selectStartingXI(
        rawAway,
        "away",
        this.awayFormation,
        this.match
          ?.awayLineupIds
      );

    this.homeXI =
      this.createPlayers(
        homeXI,
        "home",
        this.homeFormation
      );

    this.awayXI =
      this.createPlayers(
        awayXI,
        "away",
        this.awayFormation
      );

    const homeIds =
      new Set(
        this.homeXI.map(
          p => p.id
        )
      );

    const awayIds =
      new Set(
        this.awayXI.map(
          p => p.id
        )
      );

    this.homeBench =
      this.createBench(
        rawHome,
        homeIds,
        "home"
      );

    this.awayBench =
      this.createBench(
        rawAway,
        awayIds,
        "away"
      );

    this.players = [
      ...this.homeXI,
      ...this.awayXI,
    ];
  }

  createPlayers(
    source,
    side,
    formation
  ) {
    return source
      .slice(0, 11)
      .map(
        (
          data,
          index
        ) => {
          const position =
            getFormationPosition(
              formation,
              index,
              side
            );

          return new Player(
            {
              ...data,
              teamSide:
                side,
              teamId:
                side ===
                "home"
                  ? this.homeClub
                      ?.id
                  : this.awayClub
                      ?.id,
            },
            position
          );
        }
      );
  }

  createBench(
    source,
    selectedIds,
    side
  ) {
    if (
      !Array.isArray(
        source
      )
    ) {
      return [];
    }

    return source
      .filter(
        player =>
          !selectedIds.has(
            String(
              player.id ??
                player.playerId
            )
          )
      )
      .slice(0, 7)
      .map(
        player => ({
          ...player,
          teamSide: side,
        })
      );
  }

  selectStartingXI(
    source,
    side,
    formation,
    savedIds
  ) {
    if (
      !Array.isArray(
        source
      )
    ) {
      return [];
    }

    const clean =
      source.filter(
        Boolean
      );

    if (
      Array.isArray(
        savedIds
      ) &&
      savedIds.length === 11
    ) {
      const map =
        new Map();

      clean.forEach(
        player => {
          const id =
            String(
              player.id ??
                player.playerId
            );

          map.set(
            id,
            player
          );
        }
      );

      const saved =
        savedIds
          .map(
            id =>
              map.get(
                String(id)
              )
          )
          .filter(Boolean);

      if (
        saved.length === 11
      ) {
        return saved;
      }
    }

    return chooseBestXI(
      clean,
      formation
    );
  }

  placeBallForKickoff(
    side = "home"
  ) {
    this.ball =
      new Ball();

    this.ball.position.set(
      PITCH.width / 2,
      PITCH.height / 2
    );

    const team =
      side === "home"
        ? this.homeXI
        : this.awayXI;

    const striker =
      team.find(
        player =>
          player.position ===
          "ST"
      ) ||
      team[9];

    if (
      striker
    ) {
      striker.setTarget(
        PITCH.width / 2,
        PITCH.height / 2
      );
    }
  }

  start() {
    if (
      this.finished
    ) {
      return;
    }

    this.running =
      true;

    this.paused =
      false;

    this.status =
      MATCH_STATUS.LIVE;

    this.addEvent({
      type:
        EVENT_TYPES.KICKOFF,
      team: "neutral",
      detail:
        "Match started.",
    });
  }

  pause() {
    this.paused =
      true;
  }

  resume() {
    if (
      this.finished
    ) {
      return;
    }

    this.paused =
      false;

    this.running =
      true;

    this.status =
      MATCH_STATUS.LIVE;
  }

  stop() {
    this.running =
      false;

    this.finished =
      true;

    this.status =
      MATCH_STATUS.FINISHED;

    this.addEvent({
      type:
        EVENT_TYPES.FULL_TIME,
      team: "neutral",
      detail:
        "Full time.",
    });
  }

  update(
    realDelta
  ) {
    if (
      !this.running ||
      this.paused ||
      this.finished
    ) {
      return;
    }

    const dt =
      Math.min(
        Number(
          realDelta
        ) || 0,
        0.1
      );

    this.accumulator +=
      dt;

    const fixed =
      1 / MATCH.FPS;

    while (
      this.accumulator >=
      fixed
    ) {
      this.fixedUpdate(
        fixed
      );

      this.accumulator -=
        fixed;
    }
  }

  fixedUpdate(
    dt
  ) {
    const matchMinutesPerSecond =
      MATCH.SIMULATION_MINUTES /
      MATCH.REAL_DURATION_SECONDS;

    this.simulationTime +=
      dt *
      matchMinutesPerSecond;

    if (
      this.simulationTime >=
      90
    ) {
      this.simulationTime =
        90;

      this.stop();

      return;
    }

    this.aiTimer +=
      dt;

    this.decisionTimer +=
      dt;

    this.updateBall(
      dt
    );

    this.updatePlayers(
      dt
    );

    this.resolvePossession();

    this.resolveTackles();

    this.checkBallOut();

    this.checkGoal();

    this.updateStamina(
      dt
    );

    if (
      this.aiTimer >=
      MATCH.AI_UPDATE_INTERVAL
    ) {
      this.aiTimer = 0;

      this.updateAI();
    }

    if (
      this.decisionTimer >=
      MATCH.DECISION_INTERVAL
    ) {
      this.decisionTimer = 0;

      this.makeDecisions();
    }

    this.updatePossessionStats();
  }

  updateBall(
    dt
  ) {
    const owner =
      this.findPlayer(
        this.ball.ownerId
      );

    if (
      owner
    ) {
      this.ball.position.set(
        owner.x,
        owner.y
      );

      return;
    }

    this.ball.update(
      dt
    );

    this.checkPassReception();
  }

  updatePlayers(
    dt
  ) {
    this.players.forEach(
      player => {
        if (
          player.redCard
        ) {
          return;
        }

        player.update(
          dt
        );

        if (
          player.hasBall
        ) {
          this.keepPlayerBall(
            player
          );
        }
      }
    );

    this.preventPlayerOverlap();
  }

  updateAI() {
    const ball =
      this.ball.position;

    const owner =
      this.findPlayer(
        this.ball.ownerId
      );

    this.players.forEach(
      player => {
        if (
          player.redCard
        ) {
          return;
        }

        if (
          player.position ===
          "GK"
        ) {
          this.updateGoalkeeper(
            player
          );

          return;
        }

        if (
          owner &&
          owner.teamSide !==
            player.teamSide
        ) {
          this.defensiveMovement(
            player,
            owner
          );

          return;
        }

        if (
          owner &&
          owner.teamSide ===
            player.teamSide
        ) {
          this.attackingMovement(
            player,
            owner
          );

          return;
        }

        this.freeBallMovement(
          player,
          ball
        );
      }
    );
  }

  defensiveMovement(
    player,
    attacker
  ) {
    const distanceToBall =
      player.distanceToPoint(
        this.ball.position.x,
        this.ball.position.y
      );

    const pressing =
      this.getTactics(
        player.teamSide
      ).pressing;

    const pressingDistance =
      pressing === "high"
        ? 260
        : pressing === "low"
        ? 120
        : 190;

    if (
      distanceToBall <
      pressingDistance
    ) {
      const nearest =
        this.getNearestDefender(
          player.teamSide
        );

      if (
        nearest?.id ===
        player.id
      ) {
        player.state =
          PLAYER_STATE.CHASING;

        player.setTarget(
          attacker.x,
          attacker.y
        );

        return;
      }
    }

    const tactical =
      this.getTacticalTarget(
        player
      );

    player.setTarget(
      tactical.x,
      tactical.y
    );
  }

  attackingMovement(
    player,
    owner
  ) {
    if (
      player.id ===
      owner.id
    ) {
      this.moveBallCarrier(
        player
      );

      return;
    }

    const target =
      this.getAttackingTarget(
        player,
        owner
      );

    player.setTarget(
      target.x,
      target.y
    );
  }

  freeBallMovement(
    player,
    ball
  ) {
    const nearest =
      this.getNearestPlayerToBall(
        player.teamSide
      );

    if (
      nearest?.id ===
        player.id &&
      player.distanceToPoint(
        ball.x,
        ball.y
      ) <
        300
    ) {
      player.state =
        PLAYER_STATE.CHASING;

      player.setTarget(
        ball.x,
        ball.y
      );

      return;
    }

    const tactical =
      this.getTacticalTarget(
        player
      );

    player.setTarget(
      tactical.x,
      tactical.y
    );
  }

  updateGoalkeeper(
    goalkeeper
  ) {
    const ball =
      this.ball.position;

    const ownGoalX =
      goalkeeper.teamSide ===
      "home"
        ? 25
        : PITCH.width - 25;

    const danger =
      this.distanceToOwnGoal(
        ball,
        goalkeeper.teamSide
      );

    if (
      this.ball.state ===
        BALL_STATE.SHOOTING ||
      this.ball.state ===
        BALL_STATE.CROSSING
    ) {
      if (
        danger <
        300
      ) {
        goalkeeper.setTarget(
          ownGoalX,
          clamp(
            ball.y,
            230,
            450
          )
        );

        return;
      }
    }

    goalkeeper.setTarget(
      ownGoalX,
      PITCH.height /
        2 +
        clamp(
          ball.y -
            PITCH.height /
              2,
          -100,
          100
        ) *
          0.25
    );
  }

  makeDecisions() {
    const owner =
      this.findPlayer(
        this.ball.ownerId
      );

    if (
      !owner
    ) {
      return;
    }

    if (
      owner.redCard
    ) {
      return;
    }

    const pressure =
      this.calculatePressure(
        owner
      );

    const team =
      owner.teamSide;

    const opponents =
      this.getOpponents(
        team
      );

    const distanceToGoal =
      this.distanceToOpponentGoal(
        owner
      );

    if (
      this.shouldShoot(
        owner,
        distanceToGoal,
        pressure
      )
    ) {
      this.shoot(
        owner,
        pressure
      );

      return;
    }

    if (
      this.shouldCross(
        owner,
        distanceToGoal
      )
    ) {
      this.cross(
        owner
      );

      return;
    }

    if (
      this.shouldPass(
        owner,
        pressure
      )
    ) {
      const target =
        this.choosePassTarget(
          owner,
          opponents
        );

      if (
        target
      ) {
        this.pass(
          owner,
          target
        );

        return;
      }
    }

    if (
      this.shouldDribble(
        owner,
        pressure
      )
    ) {
      this.dribble(
        owner,
        pressure
      );

      return;
    }

    if (
      pressure >
      0.78
    ) {
      const safe =
        this.choosePassTarget(
          owner,
          opponents,
          true
        );

      if (
        safe
      ) {
        this.pass(
          owner,
          safe
        );

        return;
      }

      this.tryHoldBall(
        owner
      );
    }
  }

  calculatePressure(
    player
  ) {
    const defenders =
      this.getOpponents(
        player.teamSide
      );

    if (
      !defenders.length
    ) {
      return 0;
    }

    const distances =
      defenders
        .map(
          defender =>
            distance(
              player,
              defender
            )
        )
        .sort(
          (a, b) =>
            a - b
        );

    const nearest =
      distances[0] ||
      999;

    const second =
      distances[1] ||
      999;

    const firstPressure =
      clamp(
        1 -
          nearest /
            180,
        0,
        1
      );

    const secondPressure =
      clamp(
        1 -
          second /
            260,
        0,
        1
      );

    return clamp(
      firstPressure *
        0.72 +
        secondPressure *
          0.28,
      0,
      1
    );
  }

  shouldShoot(
    player,
    distanceToGoal,
    pressure
  ) {
    if (
      player.position ===
      "GK"
    ) {
      return false;
    }

    const shootingRange =
      player.position ===
      "ATT"
        ? 310
        : 235;

    if (
      distanceToGoal >
      shootingRange
    ) {
      return false;
    }

    const shooting =
      player.shooting /
      100;

    const composure =
      player.composure /
      100;

    const probability =
      clamp(
        0.20 +
          shooting *
            0.30 +
          composure *
            0.12 -
          pressure *
            0.18,
        0.08,
        0.72
      );

    return chance(
      probability
    );
  }

  shouldCross(
    player,
    distanceToGoal
  ) {
    if (
      ![
        "LW",
        "RW",
        "LM",
        "RM",
        "LWB",
        "RWB",
      ].includes(
        player.position
      )
    ) {
      return false;
    }

    return (
      distanceToGoal <
        380 &&
      chance(0.42)
    );
  }

  shouldPass(
    player,
    pressure
  ) {
    const tactics =
      this.getTactics(
        player.teamSide
      );

    let probability =
      0.55;

    if (
      tactics.passingStyle ===
      "short"
    ) {
      probability +=
        0.12;
    }

    if (
      tactics.passingStyle ===
      "direct"
    ) {
      probability -=
        0.08;
    }

    probability +=
      player.passing /
        100 *
        0.15;

    probability +=
      player.vision /
        100 *
        0.10;

    probability +=
      pressure *
      0.18;

    return chance(
      clamp(
        probability,
        0.25,
        0.92
      )
    );
  }

  shouldDribble(
    player,
    pressure
  ) {
    const dribbling =
      player.dribbling /
      100;

    return chance(
      clamp(
        0.15 +
          dribbling *
            0.35 -
          pressure *
            0.12,
        0.08,
        0.55
      )
    );
  }

  choosePassTarget(
    passer,
    opponents,
    safeOnly = false
  ) {
    const teammates =
      this.getTeamPlayers(
        passer.teamSide
      ).filter(
        player =>
          player.id !==
            passer.id &&
          !player.redCard
      );

    if (
      !teammates.length
    ) {
      return null;
    }

    const candidates =
      teammates
        .map(
          teammate => {
            const passDistance =
              distance(
                passer,
                teammate
              );

            const nearestOpponent =
              Math.min(
                ...opponents.map(
                  opponent =>
                    distance(
                      teammate,
                      opponent
                    )
                )
              );

            const forwardProgress =
              this.forwardProgress(
                passer,
                teammate
              );

            const spaceScore =
              clamp(
                nearestOpponent /
                  180,
                0,
                1
              );

            const progressScore =
              clamp(
                forwardProgress /
                  220,
                -1,
                1
              );

            const positionBonus =
              teammate.position ===
              "ATT"
                ? 0.15
                : teammate.position ===
                  "MID"
                ? 0.08
                : 0;

            const distanceScore =
              clamp(
                1 -
                  passDistance /
                    500,
                0,
                1
              );

            let score =
              spaceScore *
                0.45 +
              progressScore *
                0.28 +
              distanceScore *
                0.17 +
              positionBonus;

            if (
              safeOnly
            ) {
              score =
                spaceScore *
                  0.70 +
                distanceScore *
                  0.30;
            }

            return {
              player:
                teammate,
              score,
              distance:
                passDistance,
            };
          }
        )
        .filter(
          item =>
            item.distance <
            520
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return (
      candidates[0]
        ?.player ||
      null
    );
  }

  pass(
    passer,
    target
  ) {
    const opponents =
      this.getOpponents(
        passer.teamSide
      );

    const passDistance =
      distance(
        passer,
        target
      );

    const pressure =
      this.calculatePressure(
        passer
      );

    const passingAbility =
      passer.passing /
      100;

    const vision =
      passer.vision /
      100;

    const stamina =
      passer.stamina /
      100;

    let success =
      0.62 +
      passingAbility *
        0.20 +
      vision *
        0.10 +
      stamina *
        0.05;

    success -=
      pressure *
      0.18;

    success -=
      clamp(
        passDistance /
          900,
        0,
        0.16
      );

    const interceptors =
      opponents.filter(
        defender =>
          this.pointNearLine(
            passer,
            target,
            defender,
            34
          )
      );

    if (
      interceptors.length
    ) {
      success -=
        interceptors.length *
        0.10;
    }

    success =
      clamp(
        success,
        0.35,
        0.96
      );

    passer.stats.passes +=
      1;

    const offside =
      this.isOffsideAtPass(
        target
      );

    if (
      offside
    ) {
      this.addEvent({
        type:
          EVENT_TYPES.OFFSIDE,
        team:
          passer.teamSide,
        playerId:
          target.id,
        playerName:
          target.name,
        detail:
          `${target.name} was offside.`,
      });

      this.awardIndirectSetPiece(
        passer.teamSide ===
          "home"
          ? "away"
          : "home",
        "goal_kick"
      );

      return;
    }

    if (
      chance(success)
    ) {
      passer.stats.passesCompleted +=
        1;

      const style =
        this.getTactics(
          passer.teamSide
        ).passingStyle;

      const longPass =
        passDistance >
          280 ||
        style ===
          "direct";

      const through =
        this.isThroughBall(
          passer,
          target
        );

      this.ball.kick(
        passer,
        target,
        longPass
          ? 330
          : 260,
        through
          ? BALL_STATE.PASSING
          : BALL_STATE.PASSING,
        target.id
      );

      this.ball.lastTouchTeam =
        passer.teamSide;

      this.ball.lastTouchPlayer =
        passer.id;

      passer.hasBall =
        false;

      passer.state =
        PLAYER_STATE.MOVING;

      target.state =
        PLAYER_STATE.RECEIVING;

      this.addEvent({
        type:
          through
            ? EVENT_TYPES.THROUGH_BALL
            : EVENT_TYPES.PASS,
        team:
          passer.teamSide,
        playerId:
          passer.id,
        playerName:
          passer.name,
        targetPlayerId:
          target.id,
        detail:
          `${passer.name} passed to ${target.name}.`,
      });

      return;
    }

    this.ball.kick(
      passer,
      {
        x:
          passer.x +
          random(-80, 80),

        y:
          passer.y +
          random(-80, 80),
      },
      170,
      BALL_STATE.PASSING
    );

    passer.hasBall =
      false;

    this.addEvent({
      type:
        EVENT_TYPES.PASS,
      team:
        passer.teamSide,
      playerId:
        passer.id,
      playerName:
        passer.name,
      detail:
        `${passer.name}'s pass was misplaced.`,
    });
  }

  isThroughBall(
    passer,
    target
  ) {
    if (
      passer.position ===
      "ST"
    ) {
      return chance(0.30);
    }

    const forward =
      this.forwardProgress(
        passer,
        target
      );

    return (
      forward > 80 &&
      chance(0.25)
    );
  }

  dribble(
    player,
    pressure
  ) {
    const defenders =
      this.getOpponents(
        player.teamSide
      );

    const nearest =
      defenders.sort(
        (a, b) =>
          distance(
            player,
            a
          ) -
          distance(
            player,
            b
          )
      )[0];

    const dribbleAbility =
      player.dribbling /
      100;

    const defenderAbility =
      nearest
        ? (nearest.tackling +
            nearest.positioning) /
          200
        : 0.5;

    let success =
      0.50 +
      dribbleAbility *
        0.25 -
      defenderAbility *
        0.18;

    success -=
      pressure *
      0.12;

    success =
      clamp(
        success,
        0.16,
        0.86
      );

    player.stats.dribbles +=
      1;

    if (
      chance(success)
    ) {
      const direction =
        player.teamSide ===
        "home"
          ? 1
          : -1;

      const newX =
        clamp(
          player.x +
            direction *
              random(
                35,
                80
              ),
          20,
          PITCH.width -
            20
        );

      const newY =
        clamp(
          player.y +
            random(
              -55,
              55
            ),
          25,
          PITCH.height -
            25
        );

      player.setTarget(
        newX,
        newY
      );

      this.addEvent({
        type:
          EVENT_TYPES.DRIBBLE,
        team:
          player.teamSide,
        playerId:
          player.id,
        playerName:
          player.name,
        detail:
          `${player.name} beat the defender.`,
      });

      return;
    }

    if (
      nearest
    ) {
      this.tryTackle(
        nearest,
        player
      );
    }
  }

  cross(
    player
  ) {
    const attackers =
      this.getTeamPlayers(
        player.teamSide
      ).filter(
        teammate =>
          teammate.id !==
            player.id &&
          [
            "ST",
            "ATT",
            "AM",
          ].includes(
            teammate.position
          )
      );

    if (
      !attackers.length
    ) {
      return;
    }

    const target =
      attackers.sort(
        (a, b) =>
          this.distanceToOpponentGoal(
            a
          ) -
          this.distanceToOpponentGoal(
            b
          )
      )[0];

    const crossTarget = {
      x:
        player.teamSide ===
        "home"
          ? PITCH.width -
            95
          : 95,

      y:
        clamp(
          target.y +
            random(
              -60,
              60
            ),
          70,
          PITCH.height -
            70
        ),
    };

    this.ball.kick(
      player,
      crossTarget,
      280,
      BALL_STATE.CROSSING,
      target.id
    );

    player.hasBall =
      false;

    this.addEvent({
      type:
        EVENT_TYPES.CROSS,
      team:
        player.teamSide,
      playerId:
        player.id,
      playerName:
        player.name,
      targetPlayerId:
        target.id,
      detail:
        `${player.name} sent a cross into the box.`,
    });
  }

  shoot(
    player,
    pressure
  ) {
    const opponentSide =
      player.teamSide ===
      "home"
        ? "away"
        : "home";

    const goalkeeper =
      this.getTeamPlayers(
        opponentSide
      ).find(
        p =>
          p.position ===
          "GK"
      );

    if (
      !goalkeeper
    ) {
      return;
    }

    player.stats.shots +=
      1;

    const goalX =
      player.teamSide ===
      "home"
        ? PITCH.width + 35
        : -35;

    const goalY =
      PITCH.height / 2 +
      random(
        -PITCH.goalWidth / 2 +
          12,

        PITCH.goalWidth / 2 -
          12
      );

    const accuracy =
      clamp(
        0.35 +
          player.shooting /
            100 *
            0.40 +
          player.composure /
            100 *
            0.15 -
          pressure *
            0.20,
        0.15,
        0.92
      );

    const targetY =
      chance(accuracy)
        ? goalY
        : clamp(
            goalY +
              random(
                -130,
                130
              ),
            35,
            PITCH.height -
              35
          );

    const power =
      340 +
      player.shooting *
        1.6;

    this.ball.kick(
      player,
      {
        x: goalX,
        y: targetY,
      },
      power,
      BALL_STATE.SHOOTING
    );

    player.hasBall =
      false;

    player.state =
      PLAYER_STATE.SHOOTING;

    this.addEvent({
      type:
        EVENT_TYPES.SHOT,
      team:
        player.teamSide,
      playerId:
        player.id,
      playerName:
        player.name,
      detail:
        `${player.name} takes a shot.`,
    });
  }

  checkPassReception() {
    if (
      !this.ball.targetId
    ) {
      this.checkInterception();

      return;
    }

    const target =
      this.findPlayer(
        this.ball.targetId
      );

    if (
      !target ||
      target.redCard
    ) {
      this.ball.targetId =
        null;

      return;
    }

    const targetDistance =
      distance(
        this.ball.position,
        target
      );

    if (
      targetDistance <
      30
    ) {
      const pressure =
        this.getOpponents(
          target.teamSide
        )
          .map(
            opponent =>
              distance(
                target,
                opponent
              )
          )
          .sort(
            (a, b) =>
              a - b
          )[0] ||
        999;

      const control =
        clamp(
          0.65 +
            target.overall /
              100 *
              0.20 -
            pressure /
              500,
          0.35,
          0.94
        );

      if (
        chance(control)
      ) {
        this.giveBall(
          target
        );

        return;
      }
    }

    this.checkInterception();
  }

  checkInterception() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const candidates =
      this.players
        .filter(
          player =>
            !player.redCard
        )
        .map(
          player => ({
            player,
            distance:
              distance(
                player,
                this.ball.position
              ),
          })
        )
        .filter(
          item =>
            item.distance <
            24
        )
        .sort(
          (a, b) =>
            a.distance -
            b.distance
        );

    const candidate =
      candidates[0];

    if (
      !candidate
    ) {
      return;
    }

    const player =
      candidate.player;

    const canControl =
      clamp(
        0.58 +
          player.overall /
            100 *
            0.18 +
          player.positioning /
            100 *
            0.12,
        0.35,
        0.94
      );

    if (
      chance(canControl)
    ) {
      this.giveBall(
        player
      );

      if (
        this.ball.lastTouchTeam &&
        this.ball.lastTouchTeam !==
          player.teamSide
      ) {
        player.stats.interceptions +=
          1;

        this.addEvent({
          type:
            EVENT_TYPES.INTERCEPTION,
          team:
            player.teamSide,
          playerId:
            player.id,
          playerName:
            player.name,
          detail:
            `${player.name} intercepted the ball.`,
        });
      }
    }
  }

  resolvePossession() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const nearby =
      this.players
        .filter(
          player =>
            !player.redCard
        )
        .map(
          player => ({
            player,
            distance:
              distance(
                player,
                this.ball.position
              ),
          })
        )
        .filter(
          item =>
            item.distance <
            22
        )
        .sort(
          (a, b) =>
            a.distance -
            b.distance
        );

    const closest =
      nearby[0];

    if (
      closest
    ) {
      this.giveBall(
        closest.player
      );
    }
  }

  giveBall(
    player
  ) {
    this.players.forEach(
      p => {
        p.hasBall =
          false;

        if (
          p.state ===
          PLAYER_STATE.POSSESSED
        ) {
          p.state =
            PLAYER_STATE.MOVING;
        }
      }
    );

    player.hasBall =
      true;

    player.state =
      PLAYER_STATE.POSSESSED;

    this.ball.attach(
      player
    );
  }

  keepPlayerBall(
    player
  ) {
    this.ball.position.set(
      player.x,
      player.y
    );
  }

  resolveTackles() {
    const carriers =
      this.players.filter(
        player =>
          player.hasBall &&
          !player.redCard
      );

    carriers.forEach(
      carrier => {
        const defenders =
          this.getOpponents(
            carrier.teamSide
          )
            .filter(
              defender =>
                !defender.redCard
            )
            .sort(
              (a, b) =>
                distance(
                  a,
                  carrier
                ) -
                distance(
                  b,
                  carrier
                )
            );

        const defender =
          defenders[0];

        if (
          !defender
        ) {
          return;
        }

        if (
          distance(
            defender,
            carrier
          ) >
          27
        ) {
          return;
        }

        if (
          chance(
            0.035
          )
        ) {
          this.tryTackle(
            defender,
            carrier
          );
        }
      }
    );
  }

  tryTackle(
    defender,
    attacker
  ) {
    if (
      defender.redCard
    ) {
      return;
    }

    const tackling =
      defender.tackling /
      100;

    const attackerDribbling =
      attacker.dribbling /
      100;

    const success =
      clamp(
        0.40 +
          tackling *
            0.35 -
          attackerDribbling *
            0.20,
        0.20,
        0.88
      );

    defender.stats.tackles +=
      1;

    if (
      chance(success)
    ) {
      attacker.hasBall =
        false;

      defender.hasBall =
        true;

      this.ball.attach(
        defender
      );

      this.addEvent({
        type:
          EVENT_TYPES.TACKLE,
        team:
          defender.teamSide,
        playerId:
          defender.id,
        playerName:
          defender.name,
        detail:
          `${defender.name} won the tackle.`,
      });

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
    defender.stats.fouls +=
      1;

    const severe =
      chance(
        0.025 +
          (100 -
            defender.tackling) /
            1000
      );

    if (
      severe
    ) {
      defender.yellowCards +=
        1;

      if (
        defender.yellowCards >=
        2
      ) {
        defender.redCard =
          true;

        defender.hasBall =
          false;

        this.addEvent({
          type:
            EVENT_TYPES.RED,
          team:
            defender.teamSide,
          playerId:
            defender.id,
          playerName:
            defender.name,
          detail:
            `${defender.name} was sent off.`,
        });
      } else {
        this.addEvent({
          type:
            EVENT_TYPES.YELLOW,
          team:
            defender.teamSide,
          playerId:
            defender.id,
          playerName:
            defender.name,
          detail:
            `${defender.name} received a yellow card.`,
        });
      }
    }

    this.addEvent({
      type:
        EVENT_TYPES.FOUL,
      team:
        defender.teamSide,
      playerId:
        defender.id,
      playerName:
        defender.name,
      detail:
        `${defender.name} committed a foul on ${attacker.name}.`,
    });

    this.awardFreeKick(
      attacker.teamSide
    );
  }

  awardFreeKick(
    team
  ) {
    this.ball.stop();

    const players =
      this.getTeamPlayers(
        team
      );

    const kicker =
      players
        .filter(
          player =>
            !player.redCard &&
            player.position !==
              "GK"
        )
        .sort(
          (a, b) =>
            b.passing -
            a.passing
        )[0];

    if (
      kicker
    ) {
      this.ball.position.set(
        kicker.x,
        kicker.y
      );

      this.giveBall(
        kicker
      );
    }
  }

  checkBallOut() {
    if (
      this.ball.ownerId
    ) {
      return;
    }

    const x =
      this.ball.position.x;

    const y =
      this.ball.position.y;

    const goalTop =
      (PITCH.height -
        PITCH.goalWidth) /
      2;

    const goalBottom =
      goalTop +
      PITCH.goalWidth;

    if (
      x >=
        PITCH.width &&
      (y <
        goalTop ||
        y >
          goalBottom)
    ) {
      this.handleGoalLineOut(
        "away"
      );

      return;
    }

    if (
      x <= 0 &&
      (y <
        goalTop ||
        y >
          goalBottom)
    ) {
      this.handleGoalLineOut(
        "home"
      );

      return;
    }

    if (
      y <= 0 ||
      y >=
        PITCH.height
    ) {
      this.handleThrowIn();
    }
  }

  handleGoalLineOut(
    attackingSide
  ) {
    const lastTouch =
      this.ball.lastTouchTeam;

    const defendingSide =
      attackingSide ===
      "home"
        ? "away"
        : "home";

    if (
      lastTouch ===
      attackingSide
    ) {
      this.awardCorner(
        attackingSide
      );
    } else {
      this.awardGoalKick(
        defendingSide
      );
    }
  }

  awardCorner(
    team
  ) {
    this.getStats(
      team
    ).corners += 1;

    this.ball.stop();

    const x =
      team === "home"
        ? PITCH.width - 8
        : 8;

    const y =
      this.ball.position.y <
      PITCH.height / 2
        ? 8
        : PITCH.height -
          8;

    this.ball.position.set(
      x,
      y
    );

    const kicker =
      this.getTeamPlayers(
        team
      )
        .filter(
          p =>
            !p.redCard &&
            p.position !==
              "GK"
        )
        .sort(
          (a, b) =>
            b.passing -
            a.passing
        )[0];

    if (
      kicker
    ) {
      this.giveBall(
        kicker
      );
    }

    this.addEvent({
      type:
        EVENT_TYPES.CORNER,
      team,
      detail:
        `${this.getTeamName(
          team
        )} won a corner.`,
    });
  }

  awardGoalKick(
    team
  ) {
    this.ball.stop();

    const goalkeeper =
      this.getTeamPlayers(
        team
      ).find(
        p =>
          p.position ===
          "GK"
      );

    if (
      goalkeeper
    ) {
      goalkeeper.x =
        team === "home"
          ? 45
          : PITCH.width -
            45;

      goalkeeper.y =
        PITCH.height / 2;

      this.giveBall(
        goalkeeper
      );
    }

    this.addEvent({
      type:
        EVENT_TYPES.GOAL_KICK,
      team,
      detail:
        `${this.getTeamName(
          team
        )} have a goal kick.`,
    });
  }

  handleThrowIn() {
    const team =
      this.ball.lastTouchTeam ===
      "home"
        ? "away"
        : "home";

    this.getStats(
      team
    ).throwIns +=
      1;

    this.ball.stop();

    const thrower =
      this.getTeamPlayers(
        team
      )
        .filter(
          p =>
            !p.redCard
        )
        .sort(
          (a, b) =>
            b.overall -
            a.overall
        )[0];

    if (
      thrower
    ) {
      this.ball.position.y =
        clamp(
          this.ball.position.y,
          15,
          PITCH.height -
            15
        );

      this.giveBall(
        thrower
      );
    }

    this.addEvent({
      type:
        EVENT_TYPES.THROW_IN,
      team,
      detail:
        `${this.getTeamName(
          team
        )} take a throw-in.`,
    });
  }

  checkGoal() {
    if (
      this.ball.state !==
        BALL_STATE.SHOOTING &&
      this.ball.state !==
        BALL_STATE.CROSSING &&
      this.ball.state !==
        BALL_STATE.PASSING
    ) {
      return;
    }

    const x =
      this.ball.position.x;

    const y =
      this.ball.position.y;

    const goalTop =
      (PITCH.height -
        PITCH.goalWidth) /
      2;

    const goalBottom =
      goalTop +
      PITCH.goalWidth;

    if (
      y < goalTop ||
      y > goalBottom
    ) {
      return;
    }

    let scoringSide =
      null;

    if (
      x >
      PITCH.width +
        5
    ) {
      scoringSide =
        "home";
    }

    if (
      x <
      -5
    ) {
      scoringSide =
        "away";
    }

    if (
      !scoringSide
    ) {
      return;
    }

    const shooter =
      this.findLastShooter();

    const goalkeeper =
      this.getTeamPlayers(
        scoringSide ===
          "home"
          ? "away"
          : "home"
      ).find(
        p =>
          p.position ===
          "GK"
      );

    if (
      goalkeeper &&
      this.shouldGoalkeeperSave(
        goalkeeper,
        shooter
      )
    ) {
      this.handleSave(
        goalkeeper,
        scoringSide
      );

      return;
    }

    this.scoreGoal(
      scoringSide,
      shooter
    );
  }

  shouldGoalkeeperSave(
    goalkeeper,
    shooter
  ) {
    const gkSkill =
      (
        goalkeeper.diving +
        goalkeeper.reaction +
        goalkeeper.handling +
        goalkeeper.positioning
      ) /
      400;

    const shooterSkill =
      shooter
        ? shooter.shooting /
          100
        : 0.65;

    const distance =
      shooter
        ? this.distanceToOpponentGoal(
            shooter
          )
        : 260;

    const difficulty =
      clamp(
        0.20 +
          shooterSkill *
            0.30 +
          clamp(
            1 -
              distance /
                500,
            0,
            1
          ) *
            0.22,
        0.15,
        0.82
      );

    const saveProbability =
      clamp(
        gkSkill *
          0.70 -
          difficulty *
            0.42 +
          goalkeeper.reaction /
            100 *
            0.20,
        0.04,
        0.70
      );

    return chance(
      saveProbability
    );
  }

  handleSave(
    goalkeeper,
    attackingSide
  ) {
    goalkeeper.stats.saves +=
      1;

    const catchChance =
      clamp(
        0.35 +
          goalkeeper.handling /
            100 *
            0.40,
        0.20,
        0.80
      );

    if (
      chance(catchChance)
    ) {
      this.giveBall(
        goalkeeper
      );

      this.ball.state =
        BALL_STATE.SAVED;
    } else {
      const direction =
        goalkeeper.teamSide ===
        "home"
          ? 1
          : -1;

      this.ball.kick(
        goalkeeper,
        {
          x:
            goalkeeper.x +
            direction *
              random(
                80,
                230
              ),

          y:
            clamp(
              goalkeeper.y +
                random(
                  -130,
                  130
                ),
              30,
              PITCH.height -
                30
            ),
        },
        210,
        BALL_STATE.DEFLECTED
      );
    }

    this.addEvent({
      type:
        EVENT_TYPES.SAVE,
      team:
        goalkeeper.teamSide,
      playerId:
        goalkeeper.id,
      playerName:
        goalkeeper.name,
      detail:
        `${goalkeeper.name} made a save.`,
    });
  }

  scoreGoal(
    team,
    shooter
  ) {
    if (
      team === "home"
    ) {
      this.homeScore +=
        1;
    } else {
      this.awayScore +=
        1;
    }

    if (
      shooter
    ) {
      shooter.stats.goals +=
        1;
    }

    this.getStats(
      team
    ).shotsOnTarget +=
      1;

    this.addEvent({
      type:
        EVENT_TYPES.GOAL,
      team,
      playerId:
        shooter?.id ||
        null,
      playerName:
        shooter?.name ||
        "Unknown",
      detail:
        `GOAL! ${
          shooter?.name ||
          "Unknown"
        } scored for ${this.getTeamName(
          team
        )}.`,
    });

    this.players.forEach(
      player =>
        player.resetToFormation()
    );

    this.ball.stop();

    this.ball.position.set(
      PITCH.width / 2,
      PITCH.height / 2
    );

    this.placeBallForKickoff(
      team ===
        "home"
        ? "away"
        : "home"
    );
  }

  findLastShooter() {
    const player =
      this.findPlayer(
        this.ball.lastTouchPlayer
      );

    if (
      player
    ) {
      return player;
    }

    return null;
  }

  updatePossessionStats() {
    const owner =
      this.findPlayer(
        this.ball.ownerId
      );

    if (
      !owner
    ) {
      return;
    }

    const stats =
      this.getStats(
        owner.teamSide
      );

    stats.possessionSeconds +=
      1 /
      MATCH.FPS;
  }

  updateStamina(
    dt
  ) {
    this.players.forEach(
      player => {
        if (
          player.redCard
        ) {
          return;
        }

        const movement =
          player.velocity.length();

        if (
          movement > 30
        ) {
          player.minutesPlayed +=
            dt /
            60;
        }
      }
    );
  }

  performSubstitution(
    team,
    playerOutId,
    playerInId
  ) {
    if (
      this.substitutions[
        team
      ] >=
      MATCH.MAX_SUBSTITUTIONS
    ) {
      return false;
    }

    const lineup =
      team === "home"
        ? this.homeXI
        : this.awayXI;

    const bench =
      team === "home"
        ? this.homeBench
        : this.awayBench;

    const outIndex =
      lineup.findIndex(
        p =>
          p.id ===
          String(
            playerOutId
          )
      );

    const inIndex =
      bench.findIndex(
        p =>
          String(
            p.id ??
              p.playerId
          ) ===
          String(
            playerInId
          )
      );

    if (
      outIndex < 0 ||
      inIndex < 0
    ) {
      return false;
    }

    const oldPlayer =
      lineup[outIndex];

    const rawNew =
      bench[inIndex];

    const position =
      getFormationPosition(
        team === "home"
          ? this.homeFormation
          : this.awayFormation,
        outIndex,
        team
      );

    const newPlayer =
      new Player(
        {
          ...rawNew,
          teamSide:
            team,
          teamId:
            team === "home"
              ? this.homeClub?.id
              : this.awayClub?.id,
        },
        position
      );

    lineup[outIndex] =
      newPlayer;

    bench.splice(
      inIndex,
      1
    );

    bench.push({
      ...oldPlayer,
    });

    this.players =
      [
        ...this.homeXI,
        ...this.awayXI,
      ];

    this.substitutions[
      team
    ] += 1;

    this.addEvent({
      type:
        EVENT_TYPES.SUBSTITUTION,
      team,
      minute:
        this.getMinute(),
      detail:
        `${oldPlayer.name} replaced by ${newPlayer.name}.`,
    });

    return true;
  }

  runAutomaticSubstitutions() {
    ["home", "away"].forEach(
      team => {
        if (
          this.substitutions[
            team
          ] >=
          MATCH.MAX_SUBSTITUTIONS
        ) {
          return;
        }

        if (
          this.getMinute() <
          55
        ) {
          return;
        }

        const lineup =
          team === "home"
            ? this.homeXI
            : this.awayXI;

        const bench =
          team === "home"
            ? this.homeBench
            : this.awayBench;

        if (
          !bench.length
        ) {
          return;
        }

        const tired =
          lineup
            .filter(
              p =>
                p.position !==
                  "GK" &&
                !p.redCard
            )
            .sort(
              (a, b) =>
                a.stamina -
                b.stamina
            )[0];

        if (
          !tired ||
          tired.stamina >
            45
        ) {
          return;
        }

        const replacement =
          bench
            .slice()
            .sort(
              (a, b) =>
                Number(
                  b.overall ??
                    60
                ) -
                Number(
                  a.overall ??
                    60
                )
            )[0];

        if (
          replacement
        ) {
          this.performSubstitution(
            team,
            tired.id,
            replacement.id ??
              replacement.playerId
          );
        }
      }
    );
  }

  getTacticalTarget(
    player
  ) {
    const tactics =
      this.getTactics(
        player.teamSide
      );

    const attackDirection =
      player.teamSide ===
      "home"
        ? 1
        : -1;

    let x =
      player.homeX;

    let y =
      player.homeY;

    const ball =
      this.ball.position;

    const ballInfluence =
      tactics.mentality ===
      "attacking"
        ? 0.17
        : tactics.mentality ===
          "defensive"
        ? 0.08
        : 0.12;

    x +=
      (ball.x -
        PITCH.width /
          2) *
      ballInfluence *
      attackDirection;

    y +=
      (ball.y -
        PITCH.height /
          2) *
      0.10;

    if (
      tactics.width ===
      "wide"
    ) {
      y +=
        player.homeY <
        PITCH.height / 2
          ? -18
          : 18;
    }

    if (
      tactics.width ===
      "narrow"
    ) {
      y +=
        player.homeY <
        PITCH.height / 2
          ? 15
          : -15;
    }

    const lineModifier =
      tactics.defensiveLine ===
      "high"
        ? 40
        : tactics.defensiveLine ===
          "deep"
        ? -35
        : 0;

    if (
      player.position !==
      "GK"
    ) {
      x +=
        attackDirection *
        lineModifier;
    }

    return {
      x: clamp(
        x,
        25,
        PITCH.width -
          25
      ),
      y: clamp(
        y,
        25,
        PITCH.height -
          25
      ),
    };
  }

  getAttackingTarget(
    player,
    owner
  ) {
    const direction =
      player.teamSide ===
      "home"
        ? 1
        : -1;

    let x =
      player.homeX;

    let y =
      player.homeY;

    if (
      player.position ===
      "ST"
    ) {
      x +=
        direction *
        70;
    }

    if (
      [
        "LW",
        "RW",
        "LM",
        "RM",
        "LWB",
        "RWB",
      ].includes(
        player.position
      )
    ) {
      x +=
        direction *
        35;
    }

    const ownerDistance =
      distance(
        player,
        owner
      );

    if (
      ownerDistance <
      120
    ) {
      y +=
        player.y <
        PITCH.height / 2
          ? -45
          : 45;
    }

    const ballMovement =
      this.forwardProgress(
        owner,
        player
      );

    if (
      ballMovement <
      0
    ) {
      x -=
        direction *
        20;
    }

    return {
      x: clamp(
        x,
        30,
        PITCH.width -
          30
      ),
      y: clamp(
        y,
        25,
        PITCH.height -
          25
      ),
    };
  }

  moveBallCarrier(
    player
  ) {
    const direction =
      player.teamSide ===
      "home"
        ? 1
        : -1;

    const goalX =
      player.teamSide ===
      "home"
        ? PITCH.width
        : 0;

    const pressure =
      this.calculatePressure(
        player
      );

    let x =
      player.x;

    let y =
      player.y;

    if (
      pressure <
      0.35
    ) {
      x +=
        direction *
        70;
    } else {
      y +=
        player.y <
        PITCH.height / 2
          ? 35
          : -35;
    }

    x =
      clamp(
        x,
        20,
        PITCH.width -
          20
      );

    y =
      clamp(
        y,
        20,
        PITCH.height -
          20
      );

    if (
      this.distanceToOpponentGoal(
        player
      ) <
      150
    ) {
      x =
        goalX;
    }

    player.setTarget(
      x,
      y
    );
  }

  tryHoldBall(
    player
  ) {
    player.setTarget(
      player.x,
      player.y
    );

    player.velocity.multiply(
      0.4
    );
  }

  preventPlayerOverlap() {
    for (
      let i = 0;
      i <
      this.players.length;
      i++
    ) {
      const a =
        this.players[i];

      if (
        a.redCard
      ) {
        continue;
      }

      for (
        let j = i + 1;
        j <
        this.players.length;
        j++
      ) {
        const b =
          this.players[j];

        if (
          b.redCard
        ) {
          continue;
        }

        const dx =
          b.x - a.x;

        const dy =
          b.y - a.y;

        const dist =
          Math.sqrt(
            dx * dx +
              dy * dy
          );

        const min =
          a.radius +
          b.radius +
          4;

        if (
          dist <= 0 ||
          dist >= min
        ) {
          continue;
        }

        const nx =
          dx / dist;

        const ny =
          dy / dist;

        const push =
          (min - dist) /
          2;

        a.x -=
          nx * push;

        a.y -=
          ny * push;

        b.x +=
          nx * push;

        b.y +=
          ny * push;
      }
    }
  }

  pointNearLine(
    start,
    end,
    point,
    tolerance
  ) {
    const lineX =
      end.x -
      start.x;

    const lineY =
      end.y -
      start.y;

    const length =
      Math.sqrt(
        lineX * lineX +
          lineY * lineY
      );

    if (
      length === 0
    ) {
      return false;
    }

    const t =
      clamp(
        (
          (point.x -
            start.x) *
            lineX +
          (point.y -
            start.y) *
            lineY
        ) /
          (length *
            length),
        0,
        1
      );

    const closestX =
      start.x +
      lineX * t;

    const closestY =
      start.y +
      lineY * t;

    const d =
      Math.sqrt(
        Math.pow(
          point.x -
            closestX,
          2
        ) +
        Math.pow(
          point.y -
            closestY,
          2
        )
      );

    return (
      d <=
      tolerance
    );
  }

  isOffsideAtPass(
    target
  ) {
    const team =
      target.teamSide;

    const opponents =
      this.getOpponents(
        team
      ).filter(
        player =>
          player.position !==
            "GK" &&
          !player.redCard
      );

    if (
      opponents.length <
      2
    ) {
      return false;
    }

    const direction =
      team === "home"
        ? 1
        : -1;

    const sorted =
      opponents
        .map(
          player =>
            player.x
        )
        .sort(
          (a, b) =>
            direction === 1
              ? b - a
              : a - b
        );

    const secondLast =
      sorted[1];

    const targetBeyond =
      direction === 1
        ? target.x >
          secondLast
        : target.x <
          secondLast;

    const opponentHalf =
      direction === 1
        ? target.x >
          PITCH.width /
            2
        : target.x <
          PITCH.width /
            2;

    return (
      targetBeyond &&
      opponentHalf
    );
  }

  awardIndirectSetPiece(
    team,
    type
  ) {
    if (
      type ===
      "goal_kick"
    ) {
      this.awardGoalKick(
        team
      );
    }
  }

  distanceToOpponentGoal(
    player
  ) {
    const goalX =
      player.teamSide ===
      "home"
        ? PITCH.width
        : 0;

    return Math.abs(
      player.x -
        goalX
    );
  }

  distanceToOwnGoal(
    point,
    side
  ) {
    const goalX =
      side === "home"
        ? 0
        : PITCH.width;

    return Math.abs(
      point.x -
        goalX
    );
  }

  forwardProgress(
    from,
    to
  ) {
    const direction =
      from.teamSide ===
      "home"
        ? 1
        : -1;

    return (
      (to.x -
        from.x) *
      direction
    );
  }

  getNearestPlayerToBall(
    team
  ) {
    const candidates =
      this.getTeamPlayers(
        team
      ).filter(
        player =>
          !player.redCard
      );

    return candidates.sort(
      (a, b) =>
        distance(
          a,
          this.ball.position
        ) -
        distance(
          b,
          this.ball.position
        )
    )[0];
  }

  getNearestDefender(
    team
  ) {
    const candidates =
      this.getOpponents(
        team
      ).filter(
        player =>
          player.position !==
            "GK" &&
          !player.redCard
      );

    return candidates.sort(
      (a, b) =>
        distance(
          a,
          this.ball.position
        ) -
        distance(
          b,
          this.ball.position
        )
    )[0];
  }

  getTeamPlayers(
    team
  ) {
    return this.players.filter(
      player =>
        player.teamSide ===
        team
    );
  }

  getOpponents(
    team
  ) {
    return this.players.filter(
      player =>
        player.teamSide !==
          team &&
        !player.redCard
    );
  }

  findPlayer(
    id
  ) {
    if (!id) {
      return null;
    }

    return (
      this.players.find(
        player =>
          String(
            player.id
          ) ===
          String(id)
      ) || null
    );
  }

  getStats(
    team
  ) {
    return team ===
      "home"
      ? this.homeStats
      : this.awayStats;
  }

  getTactics(
    team
  ) {
    return team ===
      "home"
      ? this.homeTactics
      : this.awayTactics;
  }

  getTeamName(
    team
  ) {
    return team ===
      "home"
      ? this.homeClub?.name ||
          "Home"
      : this.awayClub?.name ||
          "Away";
  }

  getMinute() {
    return clamp(
      Math.floor(
        this.simulationTime
      ),
      0,
      90
    );
  }

  addEvent(
    event
  ) {
    const complete = {
      id:
        `event-${Date.now()}-${this.eventCounter++}`,

      minute:
        this.getMinute(),

      timestamp:
        Date.now(),

      ...event,
    };

    this.events.unshift(
      complete
    );

    this.lastEvent =
      complete;

    if (
      this.events.length >
      150
    ) {
      this.events =
        this.events.slice(
          0,
          150
        );
    }
  }

  getSnapshot() {
    const possessionTotal =
      this.homeStats
        .possessionSeconds +
      this.awayStats
        .possessionSeconds;

    const homePossession =
      possessionTotal >
      0
        ? (
            this.homeStats
              .possessionSeconds /
            possessionTotal
          ) * 100
        : 50;

    const players =
      this.players.map(
        player => ({
          id:
            player.id,

          name:
            player.name,

          number:
            player.number,

          teamSide:
            player.teamSide,

          position:
            player.position,

          rawPosition:
            player.rawPosition,

          x:
            player.x,

          y:
            player.y,

          stamina:
            player.stamina,

          overall:
            player.overall,

          hasBall:
            player.hasBall,

          redCard:
            player.redCard,

          yellowCards:
            player.yellowCards,

          state:
            player.state,
        })
      );

    return {
      status:
        this.status,

      minute:
        this.getMinute(),

      simulationTime:
        this.simulationTime,

      homeScore:
        this.homeScore,

      awayScore:
        this.awayScore,

      ball: {
        x:
          this.ball.position.x,

        y:
          this.ball.position.y,

        state:
          this.ball.state,

        ownerId:
          this.ball.ownerId,
      },

      players,

      homeStats: {
        ...this.homeStats,

        possession:
          Number(
            homePossession.toFixed(
              1
            )
          ),
      },

      awayStats: {
        ...this.awayStats,

        possession:
          Number(
            (
              100 -
              homePossession
            ).toFixed(1)
          ),
      },

      events: [
        ...this.events,
      ],

      substitutions: {
        ...this.substitutions,
      },

      homeFormation:
        this.homeFormation,

      awayFormation:
        this.awayFormation,

      homeTactics: {
        ...this.homeTactics,
      },

      awayTactics: {
        ...this.awayTactics,
      },
    };
  }
}

function chooseBestXI(
  players,
  formation
) {
  const required =
    getFormationRequirements(
      formation
    );

  const remaining =
    [...players];

  const result = [];

  const take =
    (
      category,
      count
    ) => {
      const candidates =
        remaining
          .filter(
            player =>
              normalizePosition(
                player.position
              ) ===
              category
          )
          .sort(
            (a, b) =>
              getOverall(b) -
              getOverall(a)
          )
          .slice(
            0,
            count
          );

      candidates.forEach(
        player => {
          const index =
            remaining.indexOf(
              player
            );

          if (
            index >= 0
          ) {
            remaining.splice(
              index,
              1
            );
          }

          result.push(
            player
          );
        }
      );
    };

  take(
    "GK",
    required.GK
  );

  take(
    "DEF",
    required.DEF
  );

  take(
    "MID",
    required.MID
  );

  take(
    "ATT",
    required.ATT
  );

  remaining.sort(
    (a, b) =>
      getOverall(b) -
      getOverall(a)
  );

  while (
    result.length <
      11 &&
    remaining.length
  ) {
    result.push(
      remaining.shift()
    );
  }

  return result.slice(
    0,
    11
  );
}

function getFormationRequirements(
  formation
) {
  const values = {
    "4-4-2": {
      GK: 1,
      DEF: 4,
      MID: 4,
      ATT: 2,
    },

    "4-3-3": {
      GK: 1,
      DEF: 4,
      MID: 3,
      ATT: 3,
    },

    "3-5-2": {
      GK: 1,
      DEF: 3,
      MID: 5,
      ATT: 2,
    },

    "5-3-2": {
      GK: 1,
      DEF: 5,
      MID: 3,
      ATT: 2,
    },

    "4-2-3-1": {
      GK: 1,
      DEF: 4,
      MID: 5,
      ATT: 1,
    },
  };

  return (
    values[formation] ||
    values["4-4-2"]
  );
}

function normalizePosition(
  value
) {
  const p =
    String(
      value || ""
    ).toLowerCase();

  if (
    p === "gk" ||
    p.includes(
      "goalkeeper"
    ) ||
    p.includes(
      "keeper"
    )
  ) {
    return "GK";
  }

  if (
    p.includes("def") ||
    p.includes("back") ||
    [
      "cb",
      "lb",
      "rb",
      "lwb",
      "rwb",
    ].includes(p)
  ) {
    return "DEF";
  }

  if (
    p.includes(
      "attack"
    ) ||
    p.includes(
      "forward"
    ) ||
    p.includes(
      "striker"
    ) ||
    [
      "st",
      "cf",
      "lw",
      "rw",
    ].includes(p)
  ) {
    return "ATT";
  }

  return "MID";
}

function getOverall(
  player
) {
  return clamp(
    Number(
      player?.overall ??
        player?.rating ??
        player?.ovr ??
        60
    ) || 60,
    35,
    99
  );
}

function normalizeStatus(
  status
) {
  const value =
    String(
      status || ""
    ).toLowerCase();

  if (
    [
      "finished",
      "completed",
      "full-time",
      "full_time",
      "ended",
    ].includes(value)
  ) {
    return MATCH_STATUS.FINISHED;
  }

  if (
    [
      "live",
      "playing",
      "started",
      "in-progress",
      "in_progress",
    ].includes(value)
  ) {
    return MATCH_STATUS.LIVE;
  }

  if (
    [
      "half-time",
      "halftime",
      "half_time",
    ].includes(value)
  ) {
    return MATCH_STATUS.HALF_TIME;
  }

  return MATCH_STATUS.READY;
}

function normalizeTactics(
  tactics
) {
  return {
    ...DEFAULT_TACTICS,
    ...(tactics || {}),
  };
}

function createStats(
  source
) {
  return {
    possessionSeconds:
      0,

    possession: 50,

    shots: 0,

    shotsOnTarget: 0,

    passes: 0,

    passesCompleted: 0,

    tackles: 0,

    interceptions: 0,

    fouls: 0,

    corners: 0,

    throwIns: 0,

    saves: 0,

    yellow: 0,

    red: 0,

    attacks: 0,

    dangerousAttacks: 0,

    dribbles: 0,

    offsides: 0,

    ...(
      source || {}
    ),
  };
}
