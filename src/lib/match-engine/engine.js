// src/lib/match-engine/engine.js

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
  attemptShot,
} from "./shooting";

import {
  attemptPass,
} from "./passing";

import {
  aiSubstitute,
  performSubstitution,
} from "./substitutions";


/*
|--------------------------------------------------------------------------
| TIME CONFIGURATION
|--------------------------------------------------------------------------
|
| 90 football minutes = 8 real minutes
|
| 8 real minutes = 480 real seconds
|
| 90 / 480 = 0.1875 football minutes per real second
|
| IMPORTANT:
|
| This multiplier is ONLY used for the football clock.
| Player movement still uses normal real dt.
|
|--------------------------------------------------------------------------
*/

const REAL_MATCH_SECONDS = 8 * 60;

const FOOTBALL_MATCH_MINUTES = 90;

const FOOTBALL_MATCH_SECONDS =
  FOOTBALL_MATCH_MINUTES * 60;

const DEFAULT_MAX_DT = 0.05;


/*
|--------------------------------------------------------------------------
| SAFE NUMBER
|--------------------------------------------------------------------------
*/

function safeNumber(value, fallback = 0) {
  const n = Number(value);

  if (Number.isFinite(n)) {
    return n;
  }

  return fallback;
}


/*
|--------------------------------------------------------------------------
| SAFE DISTANCE
|--------------------------------------------------------------------------
*/

function safeDistance(a, b) {
  if (!a || !b) {
    return Infinity;
  }

  return distance(
    safeNumber(a.x),
    safeNumber(a.y),
    safeNumber(b.x),
    safeNumber(b.y)
  );
}


/*
|--------------------------------------------------------------------------
| GET PLAYER ATTRIBUTE
|--------------------------------------------------------------------------
*/

function getPlayerAttribute(
  player,
  names = [],
  fallback = 50
) {
  if (!player) {
    return fallback;
  }

  for (const name of names) {
    if (
      player[name] !== undefined &&
      player[name] !== null
    ) {
      return safeNumber(
        player[name],
        fallback
      );
    }

    if (
      player.attributes &&
      player.attributes[name] !== undefined
    ) {
      return safeNumber(
        player.attributes[name],
        fallback
      );
    }

    if (
      player.stats &&
      player.stats[name] !== undefined
    ) {
      return safeNumber(
        player.stats[name],
        fallback
      );
    }
  }

  return fallback;
}


/*
|--------------------------------------------------------------------------
| PLAYER RATING
|--------------------------------------------------------------------------
*/

function getPlayerRating(player) {
  return getPlayerAttribute(
    player,
    [
      "overall",
      "rating",
      "overallRating",
      "ovr",
    ],
    50
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER SPEED
|--------------------------------------------------------------------------
*/

function getPlayerSpeed(player) {
  return getPlayerAttribute(
    player,
    [
      "pace",
      "speed",
      "acceleration",
    ],
    55
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER STAMINA
|--------------------------------------------------------------------------
*/

function getPlayerStamina(player) {
  return getPlayerAttribute(
    player,
    [
      "stamina",
      "fitness",
    ],
    70
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER SHOOTING
|--------------------------------------------------------------------------
*/

function getPlayerShooting(player) {
  return getPlayerAttribute(
    player,
    [
      "shooting",
      "finishing",
      "shot",
    ],
    50
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER PASSING
|--------------------------------------------------------------------------
*/

function getPlayerPassing(player) {
  return getPlayerAttribute(
    player,
    [
      "passing",
      "pass",
      "shortPassing",
      "longPassing",
    ],
    50
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER DECISION
|--------------------------------------------------------------------------
*/

function getPlayerDecision(player) {
  return getPlayerAttribute(
    player,
    [
      "decisionMaking",
      "decision",
      "vision",
      "composure",
    ],
    50
  );
}


/*
|--------------------------------------------------------------------------
| PLAYER ROLE
|--------------------------------------------------------------------------
*/

function getPlayerRole(player) {
  return String(
    player?.role ??
    player?.position ??
    ""
  ).toLowerCase();
}


/*
|--------------------------------------------------------------------------
| ACTIVE PLAYER
|--------------------------------------------------------------------------
*/

function isActivePlayer(player) {
  if (!player) {
    return false;
  }

  if (player.redCard) {
    return false;
  }

  if (player.sentOff) {
    return false;
  }

  if (player.isSentOff) {
    return false;
  }

  if (player.substituted) {
    return false;
  }

  if (player.onPitch === false) {
    return false;
  }

  return true;
}


/*
|--------------------------------------------------------------------------
| TEAM PLAYERS
|--------------------------------------------------------------------------
*/

function getPlayers(team) {
  if (!team) {
    return [];
  }

  return Array.isArray(team.players)
    ? team.players
    : [];
}


/*
|--------------------------------------------------------------------------
| ACTIVE TEAM PLAYERS
|--------------------------------------------------------------------------
*/

function getActivePlayers(team) {
  return getPlayers(team).filter(
    isActivePlayer
  );
}


/*
|--------------------------------------------------------------------------
| FIND PLAYER
|--------------------------------------------------------------------------
*/

function findPlayer(team, playerId) {
  if (!team) {
    return null;
  }

  if (
    playerId === null ||
    playerId === undefined
  ) {
    return null;
  }

  return (
    getPlayers(team).find(
      (player) =>
        String(player.id) ===
        String(playerId)
    ) || null
  );
}


/*
|--------------------------------------------------------------------------
| TEAM DIRECTION
|--------------------------------------------------------------------------
*/

function getAttackDirection(team) {
  if (!team) {
    return 1;
  }

  if (
    team.attackDirection === -1 ||
    team.attackDirection === "left" ||
    team.attackDirection === "LEFT"
  ) {
    return -1;
  }

  return 1;
}


/*
|--------------------------------------------------------------------------
| GOAL X
|--------------------------------------------------------------------------
*/

function getGoalX(team) {
  return getAttackDirection(team) === 1
    ? FIELD.width
    : 0;
}


/*
|--------------------------------------------------------------------------
| OWN GOAL X
|--------------------------------------------------------------------------
*/

function getOwnGoalX(team) {
  return getAttackDirection(team) === 1
    ? 0
    : FIELD.width;
}


/*
|--------------------------------------------------------------------------
| RANDOM
|--------------------------------------------------------------------------
*/

function randomBetween(min, max) {
  return (
    min +
    Math.random() * (max - min)
  );
}


/*
|--------------------------------------------------------------------------
| MATCH ENGINE
|--------------------------------------------------------------------------
*/

export default class MatchEngine {
  constructor({
    matchId = null,

    homeTeam = {},
    awayTeam = {},

    homePlayers = [],
    awayPlayers = [],

    homeLineupIds = [],
    awayLineupIds = [],

    formationHome = "4-4-2",
    formationAway = "4-4-2",

    tacticsHome = {},
    tacticsAway = {},

    durationSeconds =
      REAL_MATCH_SECONDS,

    initialScore = {},

    initialMinute = 0,

    initialEvents = [],

    onEvent = null,
  } = {}) {
    /*
    |--------------------------------------------------------------------------
    | BASIC
    |--------------------------------------------------------------------------
    */

    this.matchId = matchId;

    this.onEvent =
      typeof onEvent === "function"
        ? onEvent
        : null;


    /*
    |--------------------------------------------------------------------------
    | REAL MATCH DURATION
    |--------------------------------------------------------------------------
    */

    this.realDurationSeconds =
      Math.max(
        1,
        safeNumber(
          durationSeconds,
          REAL_MATCH_SECONDS
        )
      );


    /*
    |--------------------------------------------------------------------------
    | FOOTBALL TIME
    |--------------------------------------------------------------------------
    */

    this.footballDurationMinutes =
      FOOTBALL_MATCH_MINUTES;

    this.footballDurationSeconds =
      FOOTBALL_MATCH_SECONDS;


    /*
    |--------------------------------------------------------------------------
    | TIME SCALE
    |--------------------------------------------------------------------------
    |
    | This affects ONLY the match clock.
    |
    |--------------------------------------------------------------------------
    */

    this.simMinutesPerRealSecond =
      this.footballDurationMinutes /
      this.realDurationSeconds;


    /*
    |--------------------------------------------------------------------------
    | CLOCK
    |--------------------------------------------------------------------------
    */

    const startingMinute =
      clamp(
        safeNumber(
          initialMinute,
          0
        ),
        0,
        90
      );

    this.realTime = 0;

    this.simTime =
      startingMinute * 60;

    this.minute =
      Math.floor(
        this.simTime / 60
      );

    this.second =
      Math.floor(
        this.simTime % 60
      );

    this.previousMinute =
      this.minute;


    /*
    |--------------------------------------------------------------------------
    | STATE
    |--------------------------------------------------------------------------
    */

    this.running = false;

    this.finished = false;

    this.halfTime = false;

    this.halfTimeTriggered =
      this.minute >= 45;

    this.fullTimeTriggered =
      this.minute >= 90;


    if (this.minute >= 90) {
      this.state = "FULLTIME";
    } else if (this.minute >= 45) {
      this.state = "SECOND_HALF";
    } else {
      this.state = "NOT_STARTED";
    }


    /*
    |--------------------------------------------------------------------------
    | TEAMS
    |--------------------------------------------------------------------------
    */

    this.home = createTeam({
      ...homeTeam,

      side: "home",

      players: homePlayers,

      lineupIds:
        homeLineupIds,

      formation:
        formationHome,

      tactics:
        tacticsHome,

      attackDirection: 1,
    });


    this.away = createTeam({
      ...awayTeam,

      side: "away",

      players: awayPlayers,

      lineupIds:
        awayLineupIds,

      formation:
        formationAway,

      tactics:
        tacticsAway,

      attackDirection: -1,
    });


    /*
    |--------------------------------------------------------------------------
    | SCORE
    |--------------------------------------------------------------------------
    */

    this.home.score =
      safeNumber(
        initialScore.home ??
        initialScore.homeScore,
        0
      );

    this.away.score =
      safeNumber(
        initialScore.away ??
        initialScore.awayScore,
        0
      );


    /*
    |--------------------------------------------------------------------------
    | BALL
    |--------------------------------------------------------------------------
    */

    this.ball =
      createBall({
        x: FIELD.centerX,
        y: FIELD.centerY,
      });


    /*
    |--------------------------------------------------------------------------
    | EVENTS
    |--------------------------------------------------------------------------
    */

    this.events =
      Array.isArray(initialEvents)
        ? [...initialEvents]
        : [];


    /*
    |--------------------------------------------------------------------------
    | POSSESSION
    |--------------------------------------------------------------------------
    */

    this.possession = {
      home: 50,
      away: 50,
    };

    this.possessionAccumulator = {
      home: 0,
      away: 0,
    };


    /*
    |--------------------------------------------------------------------------
    | LAST ACTIONS
    |--------------------------------------------------------------------------
    */

    this.lastPass = null;

    this.lastShot = null;

    this.lastTouch = null;

    this.lastPossessionTeam = null;

    this.lastPossessionPlayer = null;


    /*
    |--------------------------------------------------------------------------
    | TIMERS
    |--------------------------------------------------------------------------
    */

    this.aiDecisionTimer = 0;

    this.aiSubstitutionTimer = 0;


    /*
    |--------------------------------------------------------------------------
    | FRAME LIMIT
    |--------------------------------------------------------------------------
    */

    this.maxDeltaTime =
      DEFAULT_MAX_DT;


    /*
    |--------------------------------------------------------------------------
    | PLAYER INITIALIZATION
    |--------------------------------------------------------------------------
    */

    this.initializePlayers();


    /*
    |--------------------------------------------------------------------------
    | KICKOFF
    |--------------------------------------------------------------------------
    */

    this.setupKickoff(
      "home"
    );
  }


  /*
  |--------------------------------------------------------------------------
  | INITIALIZE PLAYERS
  |--------------------------------------------------------------------------
  */

  initializePlayers() {
    const allPlayers = [
      ...getPlayers(this.home),
      ...getPlayers(this.away),
    ];

    for (const player of allPlayers) {
      if (!player) {
        continue;
      }

      if (
        player.onPitch === undefined
      ) {
        player.onPitch = true;
      }

      if (
        player.hasBall === undefined
      ) {
        player.hasBall = false;
      }

      if (
        player.lastActionAt ===
        undefined
      ) {
        player.lastActionAt = -100;
      }

      if (
        player.activityTimer ===
        undefined
      ) {
        player.activityTimer = 0;
      }

      if (
        player.matchSeconds ===
        undefined
      ) {
        player.matchSeconds = 0;
      }

      if (
        player.currentStamina ===
        undefined
      ) {
        player.currentStamina =
          getPlayerStamina(player);
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | START
  |--------------------------------------------------------------------------
  */

  start() {
    if (this.finished) {
      return;
    }

    if (this.halfTime) {
      this.startSecondHalf();
      return;
    }

    this.running = true;

    if (this.minute >= 45) {
      this.state =
        "SECOND_HALF";
    } else {
      this.state =
        "FIRST_HALF";
    }

    this.emitEvent({
      type:
        EVENTS?.KICKOFF ||
        "kickoff",

      minute: this.minute,

      second: this.second,

      team:
        this.lastPossessionTeam ||
        "home",
    });
  }


  /*
  |--------------------------------------------------------------------------
  | PAUSE
  |--------------------------------------------------------------------------
  */

  pause() {
    if (this.finished) {
      return;
    }

    this.running = false;

    this.state = "PAUSED";
  }


  /*
  |--------------------------------------------------------------------------
  | RESUME
  |--------------------------------------------------------------------------
  */

  resume() {
    if (this.finished) {
      return;
    }

    this.running = true;

    if (this.minute >= 45) {
      this.state =
        "SECOND_HALF";
    } else {
      this.state =
        "FIRST_HALF";
    }
  }


  /*
  |--------------------------------------------------------------------------
  | UPDATE
  |--------------------------------------------------------------------------
  |
  | dt = REAL seconds.
  |
  | IMPORTANT:
  |
  | Do NOT multiply dt before sending it to player movement.
  |
  |--------------------------------------------------------------------------
  */

  update(dt) {
    if (
      !this.running ||
      this.finished ||
      this.halfTime
    ) {
      return;
    }

    let realDt =
      safeNumber(dt, 0);

    realDt =
      clamp(
        realDt,
        0,
        this.maxDeltaTime
      );

    if (realDt <= 0) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | REAL TIME
    |--------------------------------------------------------------------------
    */

    this.realTime += realDt;


    /*
    |--------------------------------------------------------------------------
    | FOOTBALL TIME
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | 1 real second = 0.1875 football minute
    |
    | 480 real seconds = 90 football minutes
    |
    |--------------------------------------------------------------------------
    */

    const previousSimTime =
      this.simTime;

    const footballSeconds =
      realDt *
      this.simMinutesPerRealSecond *
      60;


    this.simTime +=
      footballSeconds;


    /*
    |--------------------------------------------------------------------------
    | LIMIT TO 90 MINUTES
    |--------------------------------------------------------------------------
    */

    this.simTime =
      Math.min(
        this.simTime,
        this.footballDurationSeconds
      );


    /*
    |--------------------------------------------------------------------------
    | MATCH CLOCK
    |--------------------------------------------------------------------------
    */

    this.minute =
      Math.floor(
        this.simTime / 60
      );

    this.second =
      Math.floor(
        this.simTime % 60
      );


    /*
    |--------------------------------------------------------------------------
    | MINUTE CHANGE
    |--------------------------------------------------------------------------
    */

    if (
      this.minute !==
      this.previousMinute
    ) {
      this.handleMinuteChange(
        this.previousMinute,
        this.minute
      );

      this.previousMinute =
        this.minute;
    }


    /*
    |--------------------------------------------------------------------------
    | PLAYER MOVEMENT
    |--------------------------------------------------------------------------
    |
    | NORMAL REAL DT
    |
    | No 11.25x speed here.
    |
    |--------------------------------------------------------------------------
    */

    this.updatePlayers(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | POSSESSION
    |--------------------------------------------------------------------------
    */

    this.updatePossession();


    /*
    |--------------------------------------------------------------------------
    | BALL
    |--------------------------------------------------------------------------
    */

    this.updateBallPhysics(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | BALL OWNER
    |--------------------------------------------------------------------------
    */

    this.handleBallOwner();


    /*
    |--------------------------------------------------------------------------
    | BALL PHYSICS
    |--------------------------------------------------------------------------
    */

    this.handleBallPhysics();


    /*
    |--------------------------------------------------------------------------
    | TACKLES
    |--------------------------------------------------------------------------
    */

    this.handleTackles();


    /*
    |--------------------------------------------------------------------------
    | AI
    |--------------------------------------------------------------------------
    */

    this.updateAIDecisions(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | STATS / FATIGUE
    |--------------------------------------------------------------------------
    */

    this.updateTeamStats(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | AI SUBSTITUTIONS
    |--------------------------------------------------------------------------
    */

    this.updateSubstitutions(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | HALF TIME
    |--------------------------------------------------------------------------
    */

    if (
      !this.halfTimeTriggered &&
      previousSimTime <
        45 * 60 &&
      this.simTime >=
        45 * 60
    ) {
      this.triggerHalfTime();
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | FULL TIME
    |--------------------------------------------------------------------------
    */

    if (
      this.simTime >=
      this.footballDurationSeconds
    ) {
      this.triggerFullTime();
    }
  }


  /*
  |--------------------------------------------------------------------------
  | UPDATE PLAYERS
  |--------------------------------------------------------------------------
  */

  updatePlayers(realDt) {
    try {
      updatePlayerMovement(
        this.home,
        this.away,
        this.ball,
        realDt
      );
    } catch (error) {
      console.error(
        "Home movement error:",
        error
      );
    }

    try {
      updatePlayerMovement(
        this.away,
        this.home,
        this.ball,
        realDt
      );
    } catch (error) {
      console.error(
        "Away movement error:",
        error
      );
    }


    /*
    |--------------------------------------------------------------------------
    | Keep players moving
    |--------------------------------------------------------------------------
    */

    this.refreshMovementTargets(
      this.home,
      this.away,
      realDt
    );

    this.refreshMovementTargets(
      this.away,
      this.home,
      realDt
    );
  }


  /*
  |--------------------------------------------------------------------------
  | REFRESH MOVEMENT TARGETS
  |--------------------------------------------------------------------------
  */

  refreshMovementTargets(
    team,
    opponent,
    realDt
  ) {
    const players =
      getActivePlayers(team);

    if (!players.length) {
      return;
    }

    for (const player of players) {
      if (!player) {
        continue;
      }

      player.activityTimer =
        safeNumber(
          player.activityTimer,
          0
        ) + realDt;


      /*
      |--------------------------------------------------------------------------
      | Player with ball makes decisions elsewhere.
      |--------------------------------------------------------------------------
      */

      if (player.hasBall) {
        continue;
      }


      const refreshTime =
        safeNumber(
          player.movementRefreshTime,
          2.5
        );


      if (
        player.activityTimer <
        refreshTime
      ) {
        continue;
      }


      player.activityTimer = 0;

      player.movementRefreshTime =
        randomBetween(
          2.5,
          4.5
        );


      /*
      |--------------------------------------------------------------------------
      | If movement module already has a useful target,
      | don't overwrite it constantly.
      |--------------------------------------------------------------------------
      */

      if (
        player.targetX !== undefined &&
        player.targetY !== undefined
      ) {
        const targetDistance =
          distance(
            safeNumber(player.x),
            safeNumber(player.y),
            safeNumber(player.targetX),
            safeNumber(player.targetY)
          );

        if (
          targetDistance > 55
        ) {
          continue;
        }
      }


      this.assignMovementTarget(
        player,
        team,
        opponent
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | ASSIGN MOVEMENT TARGET
  |--------------------------------------------------------------------------
  */

  assignMovementTarget(
    player,
    team,
    opponent
  ) {
    const direction =
      getAttackDirection(team);

    const role =
      getPlayerRole(player);

    const ballX =
      safeNumber(
        this.ball?.x,
        FIELD.centerX
      );

    const ballY =
      safeNumber(
        this.ball?.y,
        FIELD.centerY
      );


    /*
    |--------------------------------------------------------------------------
    | GOALKEEPER
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("gk") ||
      role.includes("goalkeeper") ||
      role === "keeper"
    ) {
      player.targetX =
        clamp(
          getOwnGoalX(team) +
            direction *
            randomBetween(
              15,
              55
            ),
          20,
          FIELD.width - 20
        );

      player.targetY =
        clamp(
          FIELD.centerY +
            (
              ballY -
              FIELD.centerY
            ) * 0.20,
          35,
          FIELD.height - 35
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | DEFENDERS
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("cb") ||
      role.includes("lb") ||
      role.includes("rb") ||
      role.includes("df") ||
      role.includes("def")
    ) {
      player.targetX =
        clamp(
          getOwnGoalX(team) +
            direction *
            randomBetween(
              90,
              240
            ),
          30,
          FIELD.width - 30
        );

      player.targetY =
        clamp(
          ballY +
            randomBetween(
              -110,
              110
            ),
          35,
          FIELD.height - 35
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | ATTACKERS
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("st") ||
      role.includes("cf") ||
      role.includes("fw") ||
      role.includes("att")
    ) {
      player.targetX =
        clamp(
          ballX +
            direction *
            randomBetween(
              40,
              120
            ),
          30,
          FIELD.width - 30
        );

      player.targetY =
        clamp(
          ballY +
            randomBetween(
              -100,
              100
            ),
          30,
          FIELD.height - 30
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | MIDFIELDERS
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("cm") ||
      role.includes("dm") ||
      role.includes("am") ||
      role.includes("mid")
    ) {
      player.targetX =
        clamp(
          ballX +
            direction *
            randomBetween(
              -40,
              80
            ),
          35,
          FIELD.width - 35
        );

      player.targetY =
        clamp(
          ballY +
            randomBetween(
              -110,
              110
            ),
          35,
          FIELD.height - 35
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | GENERAL PLAYER
    |--------------------------------------------------------------------------
    */

    player.targetX =
      clamp(
        ballX +
          direction *
          randomBetween(
            -50,
            80
          ),
        30,
        FIELD.width - 30
      );

    player.targetY =
      clamp(
        ballY +
          randomBetween(
            -100,
            100
          ),
        30,
        FIELD.height - 30
      );
  }


  /*
  |--------------------------------------------------------------------------
  | POSSESSION
  |--------------------------------------------------------------------------
  */

  updatePossession() {
    const homePlayers =
      getActivePlayers(
        this.home
      );

    const awayPlayers =
      getActivePlayers(
        this.away
      );


    const homeOwner =
      homePlayers.find(
        (player) =>
          player.hasBall
      );


    const awayOwner =
      awayPlayers.find(
        (player) =>
          player.hasBall
      );


    if (homeOwner) {
      this.lastPossessionTeam =
        "home";

      this.lastPossessionPlayer =
        homeOwner.id;
    }


    if (awayOwner) {
      this.lastPossessionTeam =
        "away";

      this.lastPossessionPlayer =
        awayOwner.id;
    }


    if (homeOwner) {
      this.possessionAccumulator.home += 1;
    }

    if (awayOwner) {
      this.possessionAccumulator.away += 1;
    }


    const total =
      this.possessionAccumulator.home +
      this.possessionAccumulator.away;


    if (total <= 0) {
      return;
    }


    this.possession.home =
      (
        this.possessionAccumulator.home /
        total
      ) * 100;

    this.possession.away =
      (
        this.possessionAccumulator.away /
        total
      ) * 100;
  }


  /*
  |--------------------------------------------------------------------------
  | BALL UPDATE
  |--------------------------------------------------------------------------
  */

  updateBallPhysics(realDt) {
    if (!this.ball) {
      return;
    }

    try {
      updateBall(
        this.ball,
        realDt
      );
    } catch (error) {
      console.error(
        "Ball update error:",
        error
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | HANDLE BALL OWNER
  |--------------------------------------------------------------------------
  */

  handleBallOwner() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }

    if (
      ball.state !==
      BALL_STATE.POSSESSED
    ) {
      return;
    }


    const owner =
      this.findPlayerById(
        ball.ownerId
      );


    if (
      !owner ||
      !isActivePlayer(owner)
    ) {
      ball.ownerId = null;

      ball.state =
        BALL_STATE.FREE;

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Ball follows owner
    |--------------------------------------------------------------------------
    */

    moveBallWithOwner(
      ball,
      owner
    );


    /*
    |--------------------------------------------------------------------------
    | Opponent pressure
    |--------------------------------------------------------------------------
    */

    const opponentTeam =
      owner.side === "home"
        ? this.away
        : this.home;


    const opponents =
      getActivePlayers(
        opponentTeam
      );


    for (
      const defender of opponents
    ) {
      if (!defender) {
        continue;
      }

      const d =
        safeDistance(
          owner,
          defender
        );


      if (d <= 35) {
        try {
          const tackled =
            attemptTackle(
              opponentTeam,
              owner,
              defender,
              ball
            );


          if (tackled) {
            this.lastTouch = {
              team:
                defender.side,

              playerId:
                defender.id,

              type:
                "tackle",
            };

            return;
          }
        } catch (error) {
          console.error(
            "Tackle error:",
            error
          );
        }
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Attack decision
    |--------------------------------------------------------------------------
    */

    this.checkAttackingDecision(
      owner,
      opponentTeam
    );
  }


  /*
  |--------------------------------------------------------------------------
  | ATTACK DECISION
  |--------------------------------------------------------------------------
  */

  checkAttackingDecision(
    owner,
    opponentTeam
  ) {
    if (
      !owner ||
      !owner.hasBall
    ) {
      return;
    }


    const team =
      owner.side === "home"
        ? this.home
        : this.away;


    const goalDistance =
      Math.abs(
        getGoalX(team) -
        safeNumber(
          owner.x,
          FIELD.centerX
        )
      );


    const pressure =
      this.getPressure(
        owner,
        opponentTeam
      );


    const passing =
      getPlayerPassing(owner);

    const shooting =
      getPlayerShooting(owner);

    const decision =
      getPlayerDecision(owner);


    const now =
      this.realTime;


    const lastAction =
      safeNumber(
        owner.lastActionAt,
        -100
      );


    const actionAge =
      now -
      lastAction;


    /*
    |--------------------------------------------------------------------------
    | Don't make decisions every frame.
    |--------------------------------------------------------------------------
    */

    if (
      actionAge < 0.80
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Shooting distance
    |--------------------------------------------------------------------------
    */

    const shootingRange =
      FIELD.width * 0.32;


    /*
    |--------------------------------------------------------------------------
    | SHOOT
    |--------------------------------------------------------------------------
    */

    if (
      goalDistance <=
      shootingRange &&
      actionAge >= 1.00
    ) {
      let shotChance =
        0.10 +
        shooting / 700 +
        decision / 1800;


      shotChance -=
        pressure / 1600;


      shotChance =
        clamp(
          shotChance,
          0.04,
          0.45
        );


      if (
        Math.random() <
        shotChance
      ) {
        try {
          const result =
            attemptShot(
              this,
              team,
              opponentTeam,
              owner
            );


          if (result) {
            owner.lastActionAt =
              now;

            return;
          }
        } catch (error) {
          console.error(
            "Shot error:",
            error
          );
        }
      }
    }


    /*
    |--------------------------------------------------------------------------
    | PASS
    |--------------------------------------------------------------------------
    */

    if (
      actionAge >= 0.90
    ) {
      let passChance =
        0.30 +
        passing / 300 +
        decision / 1000;


      passChance -=
        pressure / 1500;


      passChance =
        clamp(
          passChance,
          0.28,
          0.82
        );


      if (
        Math.random() <
        passChance
      ) {
        try {
          const result =
            attemptPass(
              this,
              team,
              opponentTeam,
              owner
            );


          if (result) {
            owner.lastActionAt =
              now;

            return;
          }
        } catch (error) {
          console.error(
            "Pass error:",
            error
          );
        }
      }
    }


    /*
    |--------------------------------------------------------------------------
    | EMERGENCY PASS
    |--------------------------------------------------------------------------
    */

    if (
      pressure >= 70 &&
      actionAge >= 0.70
    ) {
      try {
        const result =
          attemptPass(
            this,
            team,
            opponentTeam,
            owner
          );


        if (result) {
          owner.lastActionAt =
            now;
        }
      } catch (error) {
        console.error(
          "Emergency pass error:",
          error
        );
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | PRESSURE
  |--------------------------------------------------------------------------
  */

  getPressure(
    player,
    opponentTeam
  ) {
    if (
      !player ||
      !opponentTeam
    ) {
      return 0;
    }


    const opponents =
      getActivePlayers(
        opponentTeam
      );


    if (!opponents.length) {
      return 0;
    }


    let closest =
      Infinity;


    for (
      const opponent of opponents
    ) {
      const d =
        safeDistance(
          player,
          opponent
        );


      if (
        d < closest
      ) {
        closest = d;
      }
    }


    if (closest <= 18) {
      return 100;
    }


    if (closest >= 180) {
      return 0;
    }


    return clamp(
      100 -
        (
          (closest - 18) /
          162
        ) *
        100,
      0,
      100
    );
  }


  /*
  |--------------------------------------------------------------------------
  | BALL PHYSICS
  |--------------------------------------------------------------------------
  */

  handleBallPhysics() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | PASS
    |--------------------------------------------------------------------------
    */

    if (
      ball.state ===
      BALL_STATE.PASSING
    ) {
      this.checkPassReception();
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | SHOT
    |--------------------------------------------------------------------------
    */

    if (
      ball.state ===
      BALL_STATE.SHOOTING
    ) {
      this.checkShot();
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | FREE BALL
    |--------------------------------------------------------------------------
    */

    if (
      ball.state ===
      BALL_STATE.FREE
    ) {
      this.checkFreeBallReception();
      this.checkBoundaries();
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | SAVED BALL
    |--------------------------------------------------------------------------
    */

    if (
      ball.state ===
      BALL_STATE.SAVED
    ) {
      if (ball.ownerId) {
        const goalkeeper =
          this.findPlayerById(
            ball.ownerId
          );

        if (goalkeeper) {
          setBallOwner(
            ball,
            goalkeeper
          );
        }
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | PASS RECEPTION
  |--------------------------------------------------------------------------
  */

  checkPassReception() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Intended receiver
    |--------------------------------------------------------------------------
    */

    const target =
      this.findPlayerById(
        ball.targetId
      );


    if (
      target &&
      isActivePlayer(target)
    ) {
      const d =
        safeDistance(
          ball,
          target
        );


      if (d <= 32) {
        setBallOwner(
          ball,
          target
        );

        this.completePass(
          target
        );

        this.lastTouch = {
          team:
            target.side,

          playerId:
            target.id,

          type:
            "pass_reception",
        };

        return;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Find closest player
    |--------------------------------------------------------------------------
    */

    const allPlayers = [
      ...getActivePlayers(
        this.home
      ),
      ...getActivePlayers(
        this.away
      ),
    ];


    let closest =
      null;

    let closestDistance =
      Infinity;


    for (
      const player of allPlayers
    ) {
      const d =
        safeDistance(
          ball,
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
      !closest ||
      closestDistance > 26
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Same team
    |--------------------------------------------------------------------------
    */

    if (
      ball.passTeam &&
      closest.side ===
        ball.passTeam
    ) {
      setBallOwner(
        ball,
        closest
      );

      this.completePass(
        closest
      );

      this.lastTouch = {
        team:
          closest.side,

        playerId:
          closest.id,

        type:
          "pass_reception",
      };

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Interception
    |--------------------------------------------------------------------------
    */

    const interceptionChance =
      clamp(
        0.25 +
          (
            1 -
            closestDistance / 26
          ) *
          0.45,
        0.20,
        0.75
      );


    if (
      Math.random() <
      interceptionChance
    ) {
      setBallOwner(
        ball,
        closest
      );

      this.emitEvent({
        type:
          EVENTS?.INTERCEPTION ||
          "interception",

        minute:
          this.minute,

        second:
          this.second,

        team:
          closest.side,

        playerId:
          closest.id,

        fromPlayerId:
          ball.passerId ||
          null,
      });


      this.lastTouch = {
        team:
          closest.side,

        playerId:
          closest.id,

        type:
          "interception",
      };
    }
  }


  /*
  |--------------------------------------------------------------------------
  | COMPLETE PASS
  |--------------------------------------------------------------------------
  */

  completePass(receiver) {
    if (!receiver) {
      return;
    }


    if (!this.lastPass) {
      return;
    }


    if (
      this.lastPass.completed
    ) {
      return;
    }


    this.lastPass.completed =
      true;


    const team =
      this.lastPass.team ===
      "away"
        ? this.away
        : this.home;


    if (!team) {
      return;
    }


    team.stats =
      team.stats || {};


    team.stats.passesCompleted =
      safeNumber(
        team.stats.passesCompleted,
        0
      ) + 1;


    receiver.stats =
      receiver.stats || {};


    receiver.stats.receivedPasses =
      safeNumber(
        receiver.stats.receivedPasses,
        0
      ) + 1;
  }


  /*
  |--------------------------------------------------------------------------
  | FREE BALL RECEPTION
  |--------------------------------------------------------------------------
  */

  checkFreeBallReception() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }


    const players = [
      ...getActivePlayers(
        this.home
      ),
      ...getActivePlayers(
        this.away
      ),
    ];


    let closest =
      null;

    let closestDistance =
      Infinity;


    for (
      const player of players
    ) {
      const d =
        safeDistance(
          ball,
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
      closestDistance <= 25
    ) {
      setBallOwner(
        ball,
        closest
      );

      this.lastTouch = {
        team:
          closest.side,

        playerId:
          closest.id,

        type:
          "recovery",
      };
    }
  }


  /*
  |--------------------------------------------------------------------------
  | SHOT
  |--------------------------------------------------------------------------
  */

  checkShot() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }


    const reachedRight =
      safeNumber(ball.x) >=
      FIELD.width;


    const reachedLeft =
      safeNumber(ball.x) <=
      0;


    if (
      reachedRight ||
      reachedLeft
    ) {
      const shootingTeam =
        ball.shotTeam ===
        "away"
          ? this.away
          : this.home;


      const defendingTeam =
        ball.shotTeam ===
        "away"
          ? this.home
          : this.away;


      try {
        resolveShot(
          this,
          shootingTeam,
          defendingTeam
        );
      } catch (error) {
        console.error(
          "Resolve shot error:",
          error
        );

        ball.state =
          BALL_STATE.FREE;
      }

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Very slow shot
    |--------------------------------------------------------------------------
    */

    const speed =
      Math.abs(
        safeNumber(ball.vx)
      ) +
      Math.abs(
        safeNumber(ball.vy)
      );


    if (
      speed < 1.5 &&
      ball.elapsedFlight > 0.5
    ) {
      const shootingTeam =
        ball.shotTeam ===
        "away"
          ? this.away
          : this.home;


      const defendingTeam =
        ball.shotTeam ===
        "away"
          ? this.home
          : this.away;


      try {
        resolveShot(
          this,
          shootingTeam,
          defendingTeam
        );
      } catch (error) {
        console.error(
          "Stopped shot error:",
          error
        );

        ball.state =
          BALL_STATE.FREE;
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | TACKLES
  |--------------------------------------------------------------------------
  */

  handleTackles() {
    const teams = [
      {
        defending:
          this.home,

        attacking:
          this.away,
      },

      {
        defending:
          this.away,

        attacking:
          this.home,
      },
    ];


    for (
      const pair of teams
    ) {
      const defenders =
        getActivePlayers(
          pair.defending
        );


      const attackers =
        getActivePlayers(
          pair.attacking
        );


      const owner =
        attackers.find(
          (player) =>
            player.hasBall
        );


      if (!owner) {
        continue;
      }


      for (
        const defender of defenders
      ) {
        const d =
          safeDistance(
            defender,
            owner
          );


        if (d > 34) {
          continue;
        }


        try {
          const result =
            attemptTackle(
              pair.defending,
              owner,
              defender,
              this.ball
            );


          if (result) {
            this.lastTouch = {
              team:
                defender.side,

              playerId:
                defender.id,

              type:
                "tackle",
            };

            break;
          }
        } catch (error) {
          console.error(
            "Tackle processing error:",
            error
          );
        }
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | AI
  |--------------------------------------------------------------------------
  */

  updateAIDecisions(realDt) {
    this.aiDecisionTimer += realDt;


    /*
    |--------------------------------------------------------------------------
    | AI every 0.20 real seconds
    |--------------------------------------------------------------------------
    */

    if (
      this.aiDecisionTimer <
      0.20
    ) {
      return;
    }


    this.aiDecisionTimer = 0;


    try {
      updateAI(
        this.home,
        this.away
      );
    } catch (error) {
      console.error(
        "Home AI error:",
        error
      );
    }


    try {
      updateAI(
        this.away,
        this.home
      );
    } catch (error) {
      console.error(
        "Away AI error:",
        error
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | SUBSTITUTIONS
  |--------------------------------------------------------------------------
  */

  updateSubstitutions(realDt) {
    this.aiSubstitutionTimer +=
      realDt;


    if (
      this.aiSubstitutionTimer <
      7
    ) {
      return;
    }


    this.aiSubstitutionTimer = 0;


    /*
    |--------------------------------------------------------------------------
    | No AI substitutions before halftime
    |--------------------------------------------------------------------------
    */

    if (
      this.minute < 45
    ) {
      return;
    }


    this.performAITeamSubstitution(
      this.home,
      this.away
    );


    this.performAITeamSubstitution(
      this.away,
      this.home
    );
  }


  /*
  |--------------------------------------------------------------------------
  | AI TEAM SUBSTITUTION
  |--------------------------------------------------------------------------
  */

  performAITeamSubstitution(
    team,
    opponent
  ) {
    if (!team) {
      return;
    }


    if (
      safeNumber(
        team.substitutionsUsed,
        0
      ) >= 5
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Don't substitute every check.
    |--------------------------------------------------------------------------
    */

    if (
      Math.random() > 0.20
    ) {
      return;
    }


    try {
      const result =
        aiSubstitute(
          team,
          opponent,
          this.minute
        );


      if (!result) {
        return;
      }


      if (
        result.playerOut &&
        result.playerIn
      ) {
        const success =
          performSubstitution(
            team,
            result.playerOut,
            result.playerIn
          );


        if (
          success !== false
        ) {
          this.emitEvent({
            type:
              EVENTS?.SUBSTITUTION ||
              "substitution",

            minute:
              this.minute,

            second:
              this.second,

            team:
              team.side,

            playerOutId:
              result.playerOut.id,

            playerInId:
              result.playerIn.id,
          });
        }
      }
    } catch (error) {
      console.error(
        "AI substitution error:",
        error
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | TEAM STATS
  |--------------------------------------------------------------------------
  */

  updateTeamStats(realDt) {
    /*
    |--------------------------------------------------------------------------
    | Convert REAL seconds to football seconds
    |--------------------------------------------------------------------------
    */

    const footballSeconds =
      realDt *
      this.simMinutesPerRealSecond *
      60;


    const footballMinutes =
      footballSeconds / 60;


    try {
      updateTeamMinutes(
        this.home,
        footballMinutes
      );
    } catch (error) {
      console.error(
        "Home team minutes error:",
        error
      );
    }


    try {
      updateTeamMinutes(
        this.away,
        footballMinutes
      );
    } catch (error) {
      console.error(
        "Away team minutes error:",
        error
      );
    }


    /*
    |--------------------------------------------------------------------------
    | Fatigue
    |--------------------------------------------------------------------------
    */

    this.updatePlayerFatigue(
      this.home,
      footballSeconds
    );


    this.updatePlayerFatigue(
      this.away,
      footballSeconds
    );
  }


  /*
  |--------------------------------------------------------------------------
  | PLAYER FATIGUE
  |--------------------------------------------------------------------------
  */

  updatePlayerFatigue(
    team,
    footballSeconds
  ) {
    const players =
      getActivePlayers(team);


    for (
      const player of players
    ) {
      if (!player) {
        continue;
      }


      player.matchSeconds =
        safeNumber(
          player.matchSeconds,
          0
        ) +
        footballSeconds;


      const baseStamina =
        getPlayerStamina(player);


      if (
        player.currentStamina ===
        undefined
      ) {
        player.currentStamina =
          baseStamina;
      }


      const minutesPlayed =
        player.matchSeconds / 60;


      /*
      |--------------------------------------------------------------------------
      | Gentle fatigue after 20 minutes.
      |--------------------------------------------------------------------------
      */

      const fatigue =
        Math.max(
          0,
          minutesPlayed - 20
        ) *
        0.035;


      player.currentStamina =
        clamp(
          baseStamina -
            fatigue,
          10,
          100
        );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | BOUNDARIES
  |--------------------------------------------------------------------------
  */

  checkBoundaries() {
    const ball =
      this.ball;

    if (!ball) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | TOP / BOTTOM
    |--------------------------------------------------------------------------
    */

    if (
      safeNumber(ball.y) <= 0 ||
      safeNumber(ball.y) >=
        FIELD.height
    ) {
      ball.state =
        BALL_STATE.OUT;

      ball.ownerId = null;

      ball.vx = 0;

      ball.vy = 0;


      this.emitEvent({
        type:
          EVENTS?.THROW_IN ||
          "throw_in",

        minute:
          this.minute,

        second:
          this.second,
      });


      this.restartFromSide();

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | LEFT / RIGHT
    |--------------------------------------------------------------------------
    */

    if (
      safeNumber(ball.x) <= 0 ||
      safeNumber(ball.x) >=
        FIELD.width
    ) {
      /*
      |--------------------------------------------------------------------------
      | Shots are resolved separately.
      |--------------------------------------------------------------------------
      */

      if (
        ball.state ===
        BALL_STATE.SHOOTING
      ) {
        return;
      }


      ball.state =
        BALL_STATE.OUT;

      ball.ownerId = null;

      ball.vx = 0;

      ball.vy = 0;


      this.restartFromGoalLine();
    }
  }


  /*
  |--------------------------------------------------------------------------
  | SIDE RESTART
  |--------------------------------------------------------------------------
  */

  restartFromSide() {
    this.ball.x =
      clamp(
        safeNumber(
          this.ball.x,
          FIELD.centerX
        ),
        10,
        FIELD.width - 10
      );


    this.ball.y =
      clamp(
        safeNumber(
          this.ball.y,
          FIELD.centerY
        ),
        10,
        FIELD.height - 10
      );


    this.ball.vx = 0;

    this.ball.vy = 0;

    this.ball.ownerId = null;

    this.ball.targetId = null;

    this.ball.state =
      BALL_STATE.FREE;
  }


  /*
  |--------------------------------------------------------------------------
  | GOAL LINE RESTART
  |--------------------------------------------------------------------------
  */

  restartFromGoalLine() {
    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.ball.vx = 0;

    this.ball.vy = 0;

    this.ball.ownerId = null;

    this.ball.targetId = null;

    this.ball.passerId = null;

    this.ball.shotTeam = null;

    this.ball.shotPlayerId = null;

    this.ball.state =
      BALL_STATE.FREE;
  }


  /*
  |--------------------------------------------------------------------------
  | SCORE GOAL
  |--------------------------------------------------------------------------
  */

  scoreGoal(
    scoringTeam,
    shooter = null
  ) {
    if (!scoringTeam) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | SCORE
    |--------------------------------------------------------------------------
    */

    scoringTeam.score =
      safeNumber(
        scoringTeam.score,
        0
      ) + 1;


    /*
    |--------------------------------------------------------------------------
    | TEAM STATS
    |--------------------------------------------------------------------------
    */

    scoringTeam.stats =
      scoringTeam.stats || {};


    scoringTeam.stats.goals =
      safeNumber(
        scoringTeam.stats.goals,
        0
      ) + 1;


    /*
    |--------------------------------------------------------------------------
    | SHOOTER
    |--------------------------------------------------------------------------
    */

    if (shooter) {
      shooter.stats =
        shooter.stats || {};


      shooter.stats.goals =
        safeNumber(
          shooter.stats.goals,
          0
        ) + 1;


      shooter.goals =
        safeNumber(
          shooter.goals,
          0
        ) + 1;
    }


    /*
    |--------------------------------------------------------------------------
    | ASSIST
    |--------------------------------------------------------------------------
    */

    if (
      this.lastPass &&
      this.lastPass.team ===
        scoringTeam.side
    ) {
      const assister =
        this.findPlayerById(
          this.lastPass.passerId
        );


      if (
        assister &&
        (
          !shooter ||
          String(assister.id) !==
            String(shooter.id)
        )
      ) {
        assister.stats =
          assister.stats || {};


        assister.stats.assists =
          safeNumber(
            assister.stats.assists,
            0
          ) + 1;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | GOAL EVENT
    |--------------------------------------------------------------------------
    */

    this.emitEvent({
      type:
        EVENTS?.GOAL ||
        "goal",

      minute:
        this.minute,

      second:
        this.second,

      team:
        scoringTeam.side,

      teamName:
        scoringTeam.name ||
        scoringTeam.teamName ||
        scoringTeam.id ||
        scoringTeam.side,

      playerId:
        shooter?.id ||
        null,

      playerName:
        shooter?.name ||
        shooter?.playerName ||
        null,

      score: {
        home:
          this.home.score,

        away:
          this.away.score,
      },
    });


    /*
    |--------------------------------------------------------------------------
    | Kickoff by opponent
    |--------------------------------------------------------------------------
    */

    const nextKickoffSide =
      scoringTeam.side ===
      "home"
        ? "away"
        : "home";


    this.setupKickoff(
      nextKickoffSide
    );
  }


  /*
  |--------------------------------------------------------------------------
  | SETUP KICKOFF
  |--------------------------------------------------------------------------
  */

  setupKickoff(
    kickoffSide = "home"
  ) {
    const allPlayers = [
      ...getPlayers(this.home),
      ...getPlayers(this.away),
    ];


    /*
    |--------------------------------------------------------------------------
    | Clear ownership
    |--------------------------------------------------------------------------
    */

    for (
      const player of allPlayers
    ) {
      if (!player) {
        continue;
      }

      player.hasBall = false;
    }


    /*
    |--------------------------------------------------------------------------
    | Reset ball
    |--------------------------------------------------------------------------
    */

    if (!this.ball) {
      this.ball =
        createBall({
          x: FIELD.centerX,
          y: FIELD.centerY,
        });
    }


    this.ball.x =
      FIELD.centerX;

    this.ball.y =
      FIELD.centerY;

    this.ball.vx = 0;

    this.ball.vy = 0;

    this.ball.ownerId = null;

    this.ball.targetId = null;

    this.ball.passerId = null;

    this.ball.shotTeam = null;

    this.ball.shotPlayerId = null;

    this.ball.state =
      BALL_STATE.FREE;


    /*
    |--------------------------------------------------------------------------
    | Select kickoff team
    |--------------------------------------------------------------------------
    */

    const kickoffTeam =
      kickoffSide === "away"
        ? this.away
        : this.home;


    const players =
      getActivePlayers(
        kickoffTeam
      );


    if (!players.length) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Find player closest to center
    |--------------------------------------------------------------------------
    */

    let kickoffPlayer =
      players[0];

    let closest =
      Infinity;


    for (
      const player of players
    ) {
      const d =
        distance(
          safeNumber(player.x),
          safeNumber(player.y),
          FIELD.centerX,
          FIELD.centerY
        );


      if (d < closest) {
        closest = d;
        kickoffPlayer = player;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Place kickoff player
    |--------------------------------------------------------------------------
    */

    kickoffPlayer.x =
      FIELD.centerX;

    kickoffPlayer.y =
      FIELD.centerY;

    kickoffPlayer.targetX =
      FIELD.centerX;

    kickoffPlayer.targetY =
      FIELD.centerY;


    /*
    |--------------------------------------------------------------------------
    | Give ball
    |--------------------------------------------------------------------------
    */

    setBallOwner(
      this.ball,
      kickoffPlayer
    );


    this.lastPossessionTeam =
      kickoffTeam.side;

    this.lastPossessionPlayer =
      kickoffPlayer.id;
  }


  /*
  |--------------------------------------------------------------------------
  | MINUTE CHANGE
  |--------------------------------------------------------------------------
  */

  handleMinuteChange(
    previousMinute,
    currentMinute
  ) {
    this.emitEvent({
      type: "minute",

      minute:
        currentMinute,

      second:
        this.second,
    });


    /*
    |--------------------------------------------------------------------------
    | HALF TIME
    |--------------------------------------------------------------------------
    */

    if (
      currentMinute >= 45 &&
      !this.halfTimeTriggered
    ) {
      this.triggerHalfTime();
    }
  }


  /*
  |--------------------------------------------------------------------------
  | HALF TIME
  |--------------------------------------------------------------------------
  */

  triggerHalfTime() {
    if (
      this.halfTimeTriggered ||
      this.finished
    ) {
      return;
    }


    this.halfTimeTriggered =
      true;

    this.halfTime = true;

    this.running = false;

    this.state =
      "HALFTIME";


    this.simTime =
      45 * 60;

    this.minute = 45;

    this.second = 0;


    this.emitEvent({
      type:
        EVENTS?.HALFTIME ||
        "halftime",

      minute: 45,

      second: 0,

      score: {
        home:
          this.home.score,

        away:
          this.away.score,
      },
    });
  }


  /*
  |--------------------------------------------------------------------------
  | START SECOND HALF
  |--------------------------------------------------------------------------
  */

  startSecondHalf() {
    if (this.finished) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Make sure clock starts at 45:00
    |--------------------------------------------------------------------------
    */

    this.simTime =
      45 * 60;

    this.minute = 45;

    this.second = 0;

    this.previousMinute = 45;


    this.halfTime = false;

    this.running = true;

    this.state =
      "SECOND_HALF";


    /*
    |--------------------------------------------------------------------------
    | Second-half kickoff belongs to opposite team
    |--------------------------------------------------------------------------
    */

    const kickoffSide =
      this.lastPossessionTeam ===
      "home"
        ? "away"
        : "home";


    this.setupKickoff(
      kickoffSide
    );


    this.emitEvent({
      type:
        EVENTS?.KICKOFF ||
        "kickoff",

      minute: 45,

      second: 0,

      half: 2,

      team:
        kickoffSide,
    });
  }


  /*
  |--------------------------------------------------------------------------
  | FULL TIME
  |--------------------------------------------------------------------------
  */

  triggerFullTime() {
    if (
      this.fullTimeTriggered
    ) {
      return;
    }


    this.fullTimeTriggered =
      true;

    this.finished = true;

    this.running = false;

    this.halfTime = false;

    this.state =
      "FULLTIME";


    this.simTime =
      this.footballDurationSeconds;

    this.minute = 90;

    this.second = 0;


    this.emitEvent({
      type:
        EVENTS?.FULLTIME ||
        "fulltime",

      minute: 90,

      second: 0,

      score: {
        home:
          this.home.score,

        away:
          this.away.score,
      },
    });
  }


  /*
  |--------------------------------------------------------------------------
  | FIND PLAYER BY ID
  |--------------------------------------------------------------------------
  */

  findPlayerById(playerId) {
    if (
      playerId === null ||
      playerId === undefined
    ) {
      return null;
    }


    return (
      findPlayer(
        this.home,
        playerId
      ) ||
      findPlayer(
        this.away,
        playerId
      )
    );
  }


  /*
  |--------------------------------------------------------------------------
  | GET SNAPSHOT
  |--------------------------------------------------------------------------
  |
  | This fixes:
  |
  | TypeError:
  | ee.getSnapshot is not a function
  |
  |--------------------------------------------------------------------------
  */

  getSnapshot() {
    return {
      matchId:
        this.matchId,

      state:
        this.state,

      running:
        this.running,

      finished:
        this.finished,

      halfTime:
        this.halfTime,

      realTime:
        this.realTime,

      realDurationSeconds:
        this.realDurationSeconds,

      footballDurationMinutes:
        this.footballDurationMinutes,

      footballDurationSeconds:
        this.footballDurationSeconds,

      simMinutesPerRealSecond:
        this.simMinutesPerRealSecond,

      minute:
        this.minute,

      second:
        this.second,

      simTime:
        this.simTime,

      score: {
        home:
          safeNumber(
            this.home?.score,
            0
          ),

        away:
          safeNumber(
            this.away?.score,
            0
          ),
      },

      possession: {
        home:
          Number(
            safeNumber(
              this.possession?.home,
              50
            ).toFixed(1)
          ),

        away:
          Number(
            safeNumber(
              this.possession?.away,
              50
            ).toFixed(1)
          ),
      },

      ball:
        this.ball
          ? {
              ...this.ball,
            }
          : null,

      home:
        this.home
          ? {
              ...this.home,

              players:
                Array.isArray(
                  this.home.players
                )
                  ? this.home.players.map(
                      (player) => ({
                        ...player,
                      })
                    )
                  : [],
            }
          : null,

      away:
        this.away
          ? {
              ...this.away,

              players:
                Array.isArray(
                  this.away.players
                )
                  ? this.away.players.map(
                      (player) => ({
                        ...player,
                      })
                    )
                  : [],
            }
          : null,

      events:
        Array.isArray(
          this.events
        )
          ? [...this.events]
          : [],
    };
  }


  /*
  |--------------------------------------------------------------------------
  | GET STATE
  |--------------------------------------------------------------------------
  */

  getState() {
    return this.getSnapshot();
  }


  /*
  |--------------------------------------------------------------------------
  | SET USER TACTICS
  |--------------------------------------------------------------------------
  |
  | managedSide determines which team the manager controls.
  |
  |--------------------------------------------------------------------------
  */

  setUserTactics(
    tactics,
    managedSide = "home"
  ) {
    const team =
      managedSide === "away"
        ? this.away
        : this.home;


    if (!team) {
      return false;
    }


    team.tactics = {
      ...(team.tactics || {}),
      ...(tactics || {}),
    };


    return true;
  }


  /*
  |--------------------------------------------------------------------------
  | USER SUBSTITUTION
  |--------------------------------------------------------------------------
  */

  substituteUser(
    playerOutId,
    playerInId,
    managedSide = "home"
  ) {
    const team =
      managedSide === "away"
        ? this.away
        : this.home;


    if (!team) {
      return false;
    }


    const playerOut =
      findPlayer(
        team,
        playerOutId
      );


    const playerIn =
      findPlayer(
        team,
        playerInId
      );


    if (
      !playerOut ||
      !playerIn
    ) {
      return false;
    }


    if (
      String(playerOut.id) ===
      String(playerIn.id)
    ) {
      return false;
    }


    /*
    |--------------------------------------------------------------------------
    | Player out must be playing
    |--------------------------------------------------------------------------
    */

    if (
      playerOut.onPitch === false
    ) {
      return false;
    }


    /*
    |--------------------------------------------------------------------------
    | Player in must be on bench
    |--------------------------------------------------------------------------
    */

    if (
      playerIn.onPitch === true
    ) {
      return false;
    }


    /*
    |--------------------------------------------------------------------------
    | Maximum 5 substitutions
    |--------------------------------------------------------------------------
    */

    if (
      safeNumber(
        team.substitutionsUsed,
        0
      ) >= 5
    ) {
      return false;
    }


    try {
      const result =
        performSubstitution(
          team,
          playerOut,
          playerIn
        );


      if (
        result === false
      ) {
        return false;
      }


      this.emitEvent({
        type:
          EVENTS?.SUBSTITUTION ||
          "substitution",

        minute:
          this.minute,

        second:
          this.second,

        team:
          team.side,

        playerOutId:
          playerOut.id,

        playerInId:
          playerIn.id,

        playerOutName:
          playerOut.name ||
          playerOut.playerName ||
          null,

        playerInName:
          playerIn.name ||
          playerIn.playerName ||
          null,
      });


      return true;
    } catch (error) {
      console.error(
        "User substitution error:",
        error
      );

      return false;
    }
  }


  /*
  |--------------------------------------------------------------------------
  | EVENTS
  |--------------------------------------------------------------------------
  */

  emitEvent(event) {
    if (!event) {
      return;
    }


    const enrichedEvent = {
      ...event,

      timestamp:
        Date.now(),

      realTime:
        this.realTime,

      matchMinute:
        this.minute,

      matchSecond:
        this.second,
    };


    this.events.push(
      enrichedEvent
    );


    /*
    |--------------------------------------------------------------------------
    | Keep last 500 events
    |--------------------------------------------------------------------------
    */

    if (
      this.events.length > 500
    ) {
      this.events =
        this.events.slice(-500);
    }


    /*
    |--------------------------------------------------------------------------
    | UI callback
    |--------------------------------------------------------------------------
    */

    if (
      typeof this.onEvent ===
      "function"
    ) {
      try {
        this.onEvent(
          enrichedEvent
        );
      } catch (error) {
        console.error(
          "Match event callback error:",
          error
        );
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | RESET
  |--------------------------------------------------------------------------
  */

  reset() {
    /*
    |--------------------------------------------------------------------------
    | Clock
    |--------------------------------------------------------------------------
    */

    this.realTime = 0;

    this.simTime = 0;

    this.minute = 0;

    this.second = 0;

    this.previousMinute = 0;


    /*
    |--------------------------------------------------------------------------
    | State
    |--------------------------------------------------------------------------
    */

    this.running = false;

    this.finished = false;

    this.halfTime = false;

    this.halfTimeTriggered = false;

    this.fullTimeTriggered = false;

    this.state =
      "NOT_STARTED";


    /*
    |--------------------------------------------------------------------------
    | Possession
    |--------------------------------------------------------------------------
    */

    this.possession = {
      home: 50,
      away: 50,
    };


    this.possessionAccumulator = {
      home: 0,
      away: 0,
    };


    /*
    |--------------------------------------------------------------------------
    | Last actions
    |--------------------------------------------------------------------------
    */

    this.lastPass = null;

    this.lastShot = null;

    this.lastTouch = null;

    this.lastPossessionTeam = null;

    this.lastPossessionPlayer = null;


    /*
    |--------------------------------------------------------------------------
    | Timers
    |--------------------------------------------------------------------------
    */

    this.aiDecisionTimer = 0;

    this.aiSubstitutionTimer = 0;


    /*
    |--------------------------------------------------------------------------
    | Events
    |--------------------------------------------------------------------------
    */

    this.events = [];


    /*
    |--------------------------------------------------------------------------
    | Score
    |--------------------------------------------------------------------------
    */

    this.home.score = 0;

    this.away.score = 0;


    /*
    |--------------------------------------------------------------------------
    | Substitution counters
    |--------------------------------------------------------------------------
    */

    this.home.substitutionsUsed = 0;

    this.away.substitutionsUsed = 0;


    /*
    |--------------------------------------------------------------------------
    | Players
    |--------------------------------------------------------------------------
    */

    const allPlayers = [
      ...getPlayers(this.home),
      ...getPlayers(this.away),
    ];


    for (
      const player of allPlayers
    ) {
      if (!player) {
        continue;
      }

      player.hasBall = false;

      player.matchSeconds = 0;

      player.currentStamina =
        getPlayerStamina(player);

      player.lastActionAt = -100;

      player.activityTimer = 0;

      player.substituted = false;
    }


    /*
    |--------------------------------------------------------------------------
    | New ball
    |--------------------------------------------------------------------------
    */

    this.ball =
      createBall({
        x:
          FIELD.centerX,

        y:
          FIELD.centerY,
      });


    /*
    |--------------------------------------------------------------------------
    | Kickoff
    |--------------------------------------------------------------------------
    */

    this.setupKickoff(
      "home"
    );
  }
}
