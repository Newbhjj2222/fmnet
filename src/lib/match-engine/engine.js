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
| MATCH TIME
|--------------------------------------------------------------------------
|
| 90 football minutes = 8 real minutes
|
| 8 minutes = 480 real seconds
|
| 90 / 480 = 0.1875 football minutes per real second
|
| IMPORTANT:
|
| This multiplier is ONLY for the match clock.
|
| Player movement still receives normal real dt.
|
|--------------------------------------------------------------------------
*/

const DEFAULT_REAL_MATCH_SECONDS = 8 * 60;

const DEFAULT_FOOTBALL_MINUTES = 90;

const FOOTBALL_SECONDS =
  DEFAULT_FOOTBALL_MINUTES * 60;


/*
|--------------------------------------------------------------------------
| Utility functions
|--------------------------------------------------------------------------
*/

function number(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function getRating(player) {
  if (!player) return 50;

  return number(
    player.overall ??
    player.rating ??
    player.overallRating ??
    player.ovr,
    50
  );
}


function getAttribute(
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
      return number(
        player[name],
        fallback
      );
    }

    if (
      player.attributes &&
      player.attributes[name] !== undefined
    ) {
      return number(
        player.attributes[name],
        fallback
      );
    }

    if (
      player.stats &&
      player.stats[name] !== undefined
    ) {
      return number(
        player.stats[name],
        fallback
      );
    }
  }

  return fallback;
}


function getPassing(player) {
  return getAttribute(
    player,
    [
      "passing",
      "pass",
      "shortPassing",
      "longPassing",
    ],
    55
  );
}


function getShooting(player) {
  return getAttribute(
    player,
    [
      "shooting",
      "finishing",
      "shot",
    ],
    50
  );
}


function getStamina(player) {
  return getAttribute(
    player,
    [
      "stamina",
      "fitness",
    ],
    70
  );
}


function getSpeed(player) {
  return getAttribute(
    player,
    [
      "pace",
      "speed",
      "acceleration",
    ],
    55
  );
}


function getDecision(player) {
  return getAttribute(
    player,
    [
      "decisionMaking",
      "decision",
      "vision",
      "composure",
    ],
    55
  );
}


function isAvailable(player) {
  if (!player) return false;

  if (player.redCard) return false;

  if (player.sentOff) return false;

  if (player.isSentOff) return false;

  if (player.substituted) return false;

  if (player.onPitch === false) {
    return false;
  }

  return true;
}


function playersOf(team) {
  if (!team) return [];

  return Array.isArray(team.players)
    ? team.players
    : [];
}


function activePlayers(team) {
  return playersOf(team).filter(
    isAvailable
  );
}


function playerById(team, id) {
  if (!team || id === null || id === undefined) {
    return null;
  }

  return playersOf(team).find(
    (player) =>
      String(player.id) === String(id)
  ) || null;
}


function teamDirection(team) {
  if (!team) return 1;

  if (
    team.attackDirection === -1 ||
    team.attackDirection === "left" ||
    team.attackDirection === "LEFT"
  ) {
    return -1;
  }

  return 1;
}


function goalX(team) {
  return teamDirection(team) === 1
    ? FIELD.width
    : 0;
}


function ownGoalX(team) {
  return teamDirection(team) === 1
    ? 0
    : FIELD.width;
}


function getRole(player) {
  return String(
    player?.role ??
    player?.position ??
    ""
  ).toLowerCase();
}


function random(min, max) {
  return (
    min +
    Math.random() *
    (max - min)
  );
}


/*
|--------------------------------------------------------------------------
| Match Engine
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
      DEFAULT_REAL_MATCH_SECONDS,

    initialScore = {},
    initialMinute = 0,
    initialEvents = [],

    onEvent = null,
  } = {}) {
    /*
    |--------------------------------------------------------------------------
    | Basic information
    |--------------------------------------------------------------------------
    */

    this.matchId = matchId;

    this.onEvent =
      typeof onEvent === "function"
        ? onEvent
        : null;


    /*
    |--------------------------------------------------------------------------
    | Match duration
    |--------------------------------------------------------------------------
    */

    this.realDurationSeconds =
      number(
        durationSeconds,
        DEFAULT_REAL_MATCH_SECONDS
      );

    if (
      this.realDurationSeconds <= 0
    ) {
      this.realDurationSeconds =
        DEFAULT_REAL_MATCH_SECONDS;
    }


    /*
    |--------------------------------------------------------------------------
    | 90 minutes / 8 real minutes
    |--------------------------------------------------------------------------
    */

    this.footballDurationMinutes =
      DEFAULT_FOOTBALL_MINUTES;

    this.simMinutesPerRealSecond =
      this.footballDurationMinutes /
      this.realDurationSeconds;


    /*
    |--------------------------------------------------------------------------
    | Clock
    |--------------------------------------------------------------------------
    */

    const startingMinute =
      clamp(
        number(initialMinute, 0),
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
    | State
    |--------------------------------------------------------------------------
    */

    this.running = false;

    this.finished = false;

    this.halfTime = false;

    this.halfTimeTriggered =
      this.minute >= 45;

    this.fullTimeTriggered =
      this.minute >= 90;

    this.state =
      this.minute >= 90
        ? "FULLTIME"
        : this.minute >= 45
          ? "SECOND_HALF"
          : "NOT_STARTED";


    /*
    |--------------------------------------------------------------------------
    | Teams
    |--------------------------------------------------------------------------
    */

    this.home = createTeam({
      ...homeTeam,

      side: "home",

      players: homePlayers,

      lineupIds: homeLineupIds,

      formation: formationHome,

      tactics: tacticsHome,

      attackDirection: 1,
    });


    this.away = createTeam({
      ...awayTeam,

      side: "away",

      players: awayPlayers,

      lineupIds: awayLineupIds,

      formation: formationAway,

      tactics: tacticsAway,

      attackDirection: -1,
    });


    /*
    |--------------------------------------------------------------------------
    | Score
    |--------------------------------------------------------------------------
    */

    this.home.score =
      number(
        initialScore.home ??
        initialScore.homeScore,
        0
      );

    this.away.score =
      number(
        initialScore.away ??
        initialScore.awayScore,
        0
      );


    /*
    |--------------------------------------------------------------------------
    | Ball
    |--------------------------------------------------------------------------
    */

    this.ball = createBall({
      x: FIELD.centerX,
      y: FIELD.centerY,
    });


    /*
    |--------------------------------------------------------------------------
    | Events
    |--------------------------------------------------------------------------
    */

    this.events =
      Array.isArray(initialEvents)
        ? [...initialEvents]
        : [];


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
    | AI timers
    |--------------------------------------------------------------------------
    */

    this.aiDecisionTimer = 0;

    this.aiSubstitutionTimer = 0;


    /*
    |--------------------------------------------------------------------------
    | Frame protection
    |--------------------------------------------------------------------------
    */

    this.maxDeltaTime = 0.05;


    /*
    |--------------------------------------------------------------------------
    | Kickoff
    |--------------------------------------------------------------------------
    */

    this.setupKickoff();
  }


  /*
  |--------------------------------------------------------------------------
  | START MATCH
  |--------------------------------------------------------------------------
  */

  start() {
    if (this.finished) {
      return;
    }

    this.running = true;

    this.halfTime = false;

    this.state =
      this.minute >= 45
        ? "SECOND_HALF"
        : "FIRST_HALF";

    this.emitEvent({
      type:
        EVENTS?.KICKOFF ||
        "kickoff",

      minute: this.minute,

      second: this.second,

      team: this.lastPossessionTeam ||
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

    this.halfTime = false;

    this.state =
      this.minute >= 45
        ? "SECOND_HALF"
        : "FIRST_HALF";
  }


  /*
  |--------------------------------------------------------------------------
  | MAIN UPDATE
  |--------------------------------------------------------------------------
  |
  | dt = REAL seconds.
  |
  | Example:
  |
  | 60 FPS:
  | dt ≈ 0.016
  |
  | Player movement:
  |
  | updatePlayerMovement(..., 0.016)
  |
  | Match clock:
  |
  | 0.016 * 11.25
  |
  | Only the clock is accelerated.
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
      number(dt, 0);

    /*
    |--------------------------------------------------------------------------
    | Prevent huge jumps
    |--------------------------------------------------------------------------
    */

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
    | 8 real minutes -> 90 football minutes.
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
    | Never exceed 90 minutes
    |--------------------------------------------------------------------------
    */

    this.simTime =
      Math.min(
        this.simTime,
        FOOTBALL_SECONDS
      );


    /*
    |--------------------------------------------------------------------------
    | Current match clock
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
    | Minute events
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
    | VERY IMPORTANT:
    |
    | realDt is used here.
    |
    | NOT footballSeconds.
    |
    |--------------------------------------------------------------------------
    */

    this.updatePlayers(realDt);


    /*
    |--------------------------------------------------------------------------
    | Possession
    |--------------------------------------------------------------------------
    */

    this.updatePossession();


    /*
    |--------------------------------------------------------------------------
    | Ball
    |--------------------------------------------------------------------------
    */

    this.updateBallPhysics(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | Owner
    |--------------------------------------------------------------------------
    */

    this.handleBallOwner();


    /*
    |--------------------------------------------------------------------------
    | Ball physics / reception
    |--------------------------------------------------------------------------
    */

    this.handleBallPhysics();


    /*
    |--------------------------------------------------------------------------
    | Tackles
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
    | Stats and fatigue
    |--------------------------------------------------------------------------
    */

    this.updateTeamStats(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | AI substitutions
    |--------------------------------------------------------------------------
    */

    this.updateSubstitutions(
      realDt
    );


    /*
    |--------------------------------------------------------------------------
    | Half time
    |--------------------------------------------------------------------------
    */

    if (
      !this.halfTimeTriggered &&
      previousSimTime < 45 * 60 &&
      this.simTime >= 45 * 60
    ) {
      this.triggerHalfTime();
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Full time
    |--------------------------------------------------------------------------
    */

    if (
      this.simTime >=
      FOOTBALL_SECONDS
    ) {
      this.triggerFullTime();
    }
  }


  /*
  |--------------------------------------------------------------------------
  | PLAYER MOVEMENT
  |--------------------------------------------------------------------------
  */

  updatePlayers(realDt) {
    /*
    |--------------------------------------------------------------------------
    | Home
    |--------------------------------------------------------------------------
    */

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


    /*
    |--------------------------------------------------------------------------
    | Away
    |--------------------------------------------------------------------------
    */

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
    | Keep players active
    |--------------------------------------------------------------------------
    */

    this.refreshMovementIntent(
      this.home,
      this.away,
      realDt
    );

    this.refreshMovementIntent(
      this.away,
      this.home,
      realDt
    );
  }


  /*
  |--------------------------------------------------------------------------
  | REFRESH MOVEMENT INTENT
  |--------------------------------------------------------------------------
  |
  | Players don't just run to one point and freeze.
  |
  |--------------------------------------------------------------------------
  */

  refreshMovementIntent(
    team,
    opponent,
    dt
  ) {
    const players =
      activePlayers(team);

    if (!players.length) {
      return;
    }

    const ball =
      this.ball;

    for (const player of players) {
      if (!player) continue;

      /*
      |--------------------------------------------------------------------------
      | Don't interfere with current movement target too frequently.
      |--------------------------------------------------------------------------
      */

      player.activityTimer =
        number(
          player.activityTimer,
          0
        ) + dt;

      /*
      |--------------------------------------------------------------------------
      | Different players refresh at different times.
      |--------------------------------------------------------------------------
      */

      const refreshTime =
        number(
          player.movementRefreshTime,
          2.8 +
            (
              (getSpeed(player) % 30) /
              30
            )
        );

      if (
        player.activityTimer <
        refreshTime
      ) {
        continue;
      }

      player.activityTimer = 0;

      player.movementRefreshTime =
        random(
          2.5,
          4.5
        );


      /*
      |--------------------------------------------------------------------------
      | Don't force a player with the ball.
      |--------------------------------------------------------------------------
      */

      if (player.hasBall) {
        continue;
      }


      /*
      |--------------------------------------------------------------------------
      | Don't constantly overwrite movement.js
      |--------------------------------------------------------------------------
      */

      if (
        player.targetX !== undefined &&
        player.targetY !== undefined
      ) {
        const d =
          distance(
            number(player.x),
            number(player.y),
            number(player.targetX),
            number(player.targetY)
          );

        if (d > 50) {
          continue;
        }
      }


      this.assignNewMovementTarget(
        player,
        team,
        opponent,
        ball
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | ASSIGN NEW MOVEMENT TARGET
  |--------------------------------------------------------------------------
  */

  assignNewMovementTarget(
    player,
    team,
    opponent,
    ball
  ) {
    const direction =
      teamDirection(team);

    const role =
      getRole(player);

    const bx =
      number(
        ball?.x,
        FIELD.centerX
      );

    const by =
      number(
        ball?.y,
        FIELD.centerY
      );


    /*
    |--------------------------------------------------------------------------
    | Goalkeeper
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("gk") ||
      role.includes("goalkeeper") ||
      role === "keeper"
    ) {
      player.targetX =
        ownGoalX(team) +
        direction *
        random(
          15,
          55
        );

      player.targetY =
        clamp(
          FIELD.centerY +
            (
              by -
              FIELD.centerY
            ) * 0.25,
          40,
          FIELD.height - 40
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Defenders
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("cb") ||
      role.includes("lb") ||
      role.includes("rb") ||
      role.includes("df") ||
      role.includes("def")
    ) {
      const targetX =
        ownGoalX(team) +
        direction *
        random(
          80,
          220
        );

      player.targetX =
        clamp(
          targetX,
          35,
          FIELD.width - 35
        );

      player.targetY =
        clamp(
          by +
            random(
              -100,
              100
            ),
          35,
          FIELD.height - 35
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Strikers / attackers
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
          bx +
            direction *
            random(
              35,
              100
            ),
          35,
          FIELD.width - 35
        );

      player.targetY =
        clamp(
          by +
            random(
              -80,
              80
            ),
          30,
          FIELD.height - 30
        );

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Midfielders
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
          bx +
            direction *
            random(
              -30,
              70
            ),
          45,
          FIELD.width - 45
        );

      player.targetY =
        clamp(
          by +
            random(
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
    | Generic player
    |--------------------------------------------------------------------------
    */

    player.targetX =
      clamp(
        bx +
          direction *
          random(
            -50,
            70
          ),
        30,
        FIELD.width - 30
      );

    player.targetY =
      clamp(
        by +
          random(
            -90,
            90
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
    const home =
      activePlayers(
        this.home
      );

    const away =
      activePlayers(
        this.away
      );

    const homeOwner =
      home.find(
        (player) =>
          player.hasBall
      );

    const awayOwner =
      away.find(
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


    /*
    |--------------------------------------------------------------------------
    | Accumulate possession
    |--------------------------------------------------------------------------
    */

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

  updateBallPhysics(
    realDt
  ) {
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
  | OWNER
  |--------------------------------------------------------------------------
  */

  handleBallOwner() {
    const ball =
      this.ball;

    if (!ball) return;

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
      !isAvailable(owner)
    ) {
      ball.ownerId = null;

      ball.state =
        BALL_STATE.FREE;

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Keep ball with player
    |--------------------------------------------------------------------------
    */

    moveBallWithOwner(
      ball,
      owner
    );


    /*
    |--------------------------------------------------------------------------
    | Pressure / tackling
    |--------------------------------------------------------------------------
    */

    const opponentTeam =
      owner.side === "home"
        ? this.away
        : this.home;

    const opponents =
      activePlayers(
        opponentTeam
      );


    for (const defender of opponents) {
      if (!defender) continue;

      const d =
        distance(
          number(owner.x),
          number(owner.y),
          number(defender.x),
          number(defender.y)
        );

      if (d <= 36) {
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
              team: defender.side,
              playerId: defender.id,
              type: "tackle",
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
        goalX(team) -
        number(
          owner.x,
          FIELD.centerX
        )
      );


    const shooting =
      getShooting(owner);

    const passing =
      getPassing(owner);

    const decision =
      getDecision(owner);

    const pressure =
      this.getPressure(
        owner,
        opponentTeam
      );


    /*
    |--------------------------------------------------------------------------
    | Real-time action cooldown
    |--------------------------------------------------------------------------
    */

    const now =
      this.realTime;

    const lastAction =
      number(
        owner.lastActionAt,
        -100
      );

    const actionAge =
      now -
      lastAction;


    if (
      actionAge < 0.85
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Tired players take slightly longer decisions.
    |--------------------------------------------------------------------------
    */

    const stamina =
      number(
        owner.currentStamina,
        getStamina(owner)
      );


    const fatiguePenalty =
      stamina < 35
        ? 0.10
        : 0;


    /*
    |--------------------------------------------------------------------------
    | Shooting range
    |--------------------------------------------------------------------------
    */

    const shootingRange =
      FIELD.width * 0.31;


    /*
    |--------------------------------------------------------------------------
    | SHOT
    |--------------------------------------------------------------------------
    */

    if (
      goalDistance <=
      shootingRange &&
      actionAge >= 1.05
    ) {
      let shotChance =
        0.10 +
        shooting / 650 +
        decision / 1800;

      shotChance -=
        pressure / 1300;

      shotChance -=
        fatiguePenalty;


      shotChance =
        clamp(
          shotChance,
          0.04,
          0.48
        );


      if (
        Math.random() <
        shotChance
      ) {
        try {
          const shot =
            attemptShot(
              this,
              team,
              opponentTeam,
              owner
            );

          if (shot) {
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
        0.28 +
        passing / 280 +
        decision / 900;

      passChance -=
        pressure / 1300;


      passChance =
        clamp(
          passChance,
          0.25,
          0.82
        );


      if (
        Math.random() <
        passChance
      ) {
        try {
          const passed =
            attemptPass(
              this,
              team,
              opponentTeam,
              owner
            );

          if (passed) {
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
    | Heavy pressure = quick pass
    |--------------------------------------------------------------------------
    */

    if (
      pressure >= 72 &&
      actionAge >= 0.75
    ) {
      try {
        const passed =
          attemptPass(
            this,
            team,
            opponentTeam,
            owner
          );

        if (passed) {
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
      activePlayers(
        opponentTeam
      );


    if (!opponents.length) {
      return 0;
    }


    let closest =
      Infinity;


    for (const opponent of opponents) {
      const d =
        distance(
          number(player.x),
          number(player.y),
          number(opponent.x),
          number(opponent.y)
        );

      if (
        d < closest
      ) {
        closest = d;
      }
    }


    if (
      closest <= 18
    ) {
      return 100;
    }


    if (
      closest >= 180
    ) {
      return 0;
    }


    return clamp(
      100 -
        (
          (closest - 18) /
          162
        ) * 100,
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

    if (!ball) return;


    /*
    |--------------------------------------------------------------------------
    | PASSING
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
    | SHOOTING
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
    | SAVED
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

    if (!ball) return;


    /*
    |--------------------------------------------------------------------------
    | First look for intended receiver.
    |--------------------------------------------------------------------------
    */

    const target =
      this.findPlayerById(
        ball.targetId
      );


    if (
      target &&
      isAvailable(target)
    ) {
      const d =
        distance(
          number(ball.x),
          number(ball.y),
          number(target.x),
          number(target.y)
        );


      if (
        d <= 32
      ) {
        setBallOwner(
          ball,
          target
        );

        this.completePass(
          target
        );

        return;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Interception
    |--------------------------------------------------------------------------
    */

    const allPlayers = [
      ...activePlayers(
        this.home
      ),
      ...activePlayers(
        this.away
      ),
    ];


    let closest =
      null;

    let closestDistance =
      Infinity;


    for (const player of allPlayers) {
      const d =
        distance(
          number(ball.x),
          number(ball.y),
          number(player.x),
          number(player.y)
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
    | Same team gets the ball.
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

      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Opponent interception
    |--------------------------------------------------------------------------
    */

    const interceptionChance =
      clamp(
        0.28 +
          (
            1 -
            closestDistance / 26
          ) * 0.40,
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

        minute: this.minute,

        second: this.second,

        team:
          closest.side,

        playerId:
          closest.id,

        fromPlayerId:
          ball.passerId ||
          null,
      });


      this.lastTouch = {
        team: closest.side,

        playerId:
          closest.id,

        type: "interception",
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


    const pass =
      this.lastPass;


    if (!pass) {
      return;
    }


    if (
      pass.completed
    ) {
      return;
    }


    pass.completed = true;


    const team =
      pass.team === "home"
        ? this.home
        : this.away;


    team.stats =
      team.stats || {};


    team.stats.passesCompleted =
      number(
        team.stats.passesCompleted,
        0
      ) + 1;


    receiver.stats =
      receiver.stats || {};


    receiver.stats.receivedPasses =
      number(
        receiver.stats.receivedPasses,
        0
      ) + 1;
  }


  /*
  |--------------------------------------------------------------------------
  | FREE BALL
  |--------------------------------------------------------------------------
  */

  checkFreeBallReception() {
    const ball =
      this.ball;

    if (!ball) return;


    const allPlayers = [
      ...activePlayers(
        this.home
      ),
      ...activePlayers(
        this.away
      ),
    ];


    let closest =
      null;

    let closestDistance =
      Infinity;


    for (const player of allPlayers) {
      const d =
        distance(
          number(ball.x),
          number(ball.y),
          number(player.x),
          number(player.y)
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
        team: closest.side,

        playerId:
          closest.id,

        type: "recovery",
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

    if (!ball) return;


    const reachedRight =
      number(ball.x) >=
      FIELD.width;


    const reachedLeft =
      number(ball.x) <= 0;


    if (
      reachedRight ||
      reachedLeft
    ) {
      const shootingTeam =
        ball.shotTeam === "away"
          ? this.away
          : this.home;


      const defendingTeam =
        ball.shotTeam === "away"
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
    | Very slow / stopped shot
    |--------------------------------------------------------------------------
    */

    const velocity =
      Math.abs(
        number(ball.vx)
      ) +
      Math.abs(
        number(ball.vy)
      );


    if (
      velocity < 1.5
    ) {
      const shootingTeam =
        ball.shotTeam === "away"
          ? this.away
          : this.home;


      const defendingTeam =
        ball.shotTeam === "away"
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
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | TACKLES
  |--------------------------------------------------------------------------
  */

  handleTackles() {
    const pairs = [
      [
        this.home,
        this.away,
      ],
      [
        this.away,
        this.home,
      ],
    ];


    for (const [
      defendingTeam,
      attackingTeam,
    ] of pairs) {
      const defenders =
        activePlayers(
          defendingTeam
        );

      const attackers =
        activePlayers(
          attackingTeam
        );


      const owner =
        attackers.find(
          (player) =>
            player.hasBall
        );


      if (!owner) {
        continue;
      }


      for (const defender of defenders) {
        if (!defender) continue;


        const d =
          distance(
            number(defender.x),
            number(defender.y),
            number(owner.x),
            number(owner.y)
          );


        if (
          d <= 35
        ) {
          try {
            attemptTackle(
              defendingTeam,
              owner,
              defender,
              this.ball
            );
          } catch (error) {
            console.error(
              "Tackle processing error:",
              error
            );
          }
        }
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | AI DECISIONS
  |--------------------------------------------------------------------------
  */

  updateAIDecisions(dt) {
    this.aiDecisionTimer += dt;


    /*
    |--------------------------------------------------------------------------
    | Don't calculate AI every frame.
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

  updateSubstitutions(dt) {
    this.aiSubstitutionTimer += dt;


    if (
      this.aiSubstitutionTimer <
      7
    ) {
      return;
    }


    this.aiSubstitutionTimer = 0;


    /*
    |--------------------------------------------------------------------------
    | AI substitutions only after halftime.
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
  | AI SUBSTITUTION
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
      number(
        team.substitutionsUsed,
        0
      ) >= 5
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Not every check results in a substitution.
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

  updateTeamStats(dt) {
    /*
    |--------------------------------------------------------------------------
    | Convert REAL seconds to football seconds
    |--------------------------------------------------------------------------
    */

    const footballSeconds =
      dt *
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
  | FATIGUE
  |--------------------------------------------------------------------------
  */

  updatePlayerFatigue(
    team,
    footballSeconds
  ) {
    const players =
      activePlayers(team);


    for (const player of players) {
      if (!player) continue;


      player.matchSeconds =
        number(
          player.matchSeconds,
          0
        ) +
        footballSeconds;


      const baseStamina =
        getStamina(player);


      if (
        player.currentStamina ===
        undefined
      ) {
        player.currentStamina =
          baseStamina;
      }


      const minutesPlayed =
        player.matchSeconds /
        60;


      /*
      |--------------------------------------------------------------------------
      | Light fatigue.
      |--------------------------------------------------------------------------
      |
      | It affects decisions slightly,
      | not the match clock.
      |
      |--------------------------------------------------------------------------
      */

      const fatigue =
        Math.max(
          0,
          minutesPlayed - 20
        ) * 0.035;


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

    if (!ball) return;


    /*
    |--------------------------------------------------------------------------
    | Top / bottom
    |--------------------------------------------------------------------------
    */

    if (
      ball.y <= 0 ||
      ball.y >= FIELD.height
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
    | Left / right
    |--------------------------------------------------------------------------
    */

    if (
      ball.x <= 0 ||
      ball.x >= FIELD.width
    ) {
      /*
      |--------------------------------------------------------------------------
      | A shot is handled by checkShot().
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
        number(this.ball.x),
        10,
        FIELD.width - 10
      );


    this.ball.y =
      clamp(
        number(this.ball.y),
        10,
        FIELD.height - 10
      );


    this.ball.vx = 0;

    this.ball.vy = 0;

    this.ball.ownerId = null;

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
    | Score
    |--------------------------------------------------------------------------
    */

    scoringTeam.score =
      number(
        scoringTeam.score,
        0
      ) + 1;


    /*
    |--------------------------------------------------------------------------
    | Team stats
    |--------------------------------------------------------------------------
    */

    scoringTeam.stats =
      scoringTeam.stats || {};


    scoringTeam.stats.goals =
      number(
        scoringTeam.stats.goals,
        0
      ) + 1;


    /*
    |--------------------------------------------------------------------------
    | Shooter stats
    |--------------------------------------------------------------------------
    */

    if (shooter) {
      shooter.stats =
        shooter.stats || {};


      shooter.stats.goals =
        number(
          shooter.stats.goals,
          0
        ) + 1;


      shooter.goals =
        number(
          shooter.goals,
          0
        ) + 1;
    }


    /*
    |--------------------------------------------------------------------------
    | Assist
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
          assister.id !== shooter.id
        )
      ) {
        assister.stats =
          assister.stats || {};


        assister.stats.assists =
          number(
            assister.stats.assists,
            0
          ) + 1;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Goal event
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
    | Kickoff after goal
    |--------------------------------------------------------------------------
    */

    this.setupKickoff();
  }


  /*
  |--------------------------------------------------------------------------
  | KICKOFF
  |--------------------------------------------------------------------------
  */

  setupKickoff() {
    const allPlayers = [
      ...playersOf(this.home),
      ...playersOf(this.away),
    ];


    /*
    |--------------------------------------------------------------------------
    | Clear ball ownership
    |--------------------------------------------------------------------------
    */

    for (
      const player of allPlayers
    ) {
      if (!player) continue;

      player.hasBall = false;
    }


    /*
    |--------------------------------------------------------------------------
    | Reset ball
    |--------------------------------------------------------------------------
    */

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

    let kickoffTeam =
      this.home;


    /*
    |--------------------------------------------------------------------------
    | At the beginning home starts.
    |--------------------------------------------------------------------------
    */

    if (
      this.minute === 0
    ) {
      kickoffTeam =
        this.home;
    } else {
      /*
      |--------------------------------------------------------------------------
      | After a goal, opponent kicks off.
      |--------------------------------------------------------------------------
      */

      kickoffTeam =
        this.lastPossessionTeam ===
        "home"
          ? this.away
          : this.home;
    }


    const players =
      activePlayers(
        kickoffTeam
      );


    if (!players.length) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Find central player
    |--------------------------------------------------------------------------
    */

    let kickoffPlayer =
      players[0];

    let bestDistance =
      Infinity;


    for (
      const player of players
    ) {
      const d =
        distance(
          number(player.x),
          number(player.y),
          FIELD.centerX,
          FIELD.centerY
        );


      if (
        d < bestDistance
      ) {
        bestDistance = d;
        kickoffPlayer = player;
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Put only kickoff player near center.
    |--------------------------------------------------------------------------
    */

    if (kickoffPlayer) {
      kickoffPlayer.x =
        FIELD.centerX;

      kickoffPlayer.y =
        FIELD.centerY;

      kickoffPlayer.targetX =
        FIELD.centerX;

      kickoffPlayer.targetY =
        FIELD.centerY;

      setBallOwner(
        this.ball,
        kickoffPlayer
      );


      this.lastPossessionTeam =
        kickoffTeam.side;

      this.lastPossessionPlayer =
        kickoffPlayer.id;
    }
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
    | 45 minutes
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


    this.halfTimeTriggered = true;

    this.halfTime = true;

    this.running = false;

    this.state =
      "HALFTIME";


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
  | SECOND HALF
  |--------------------------------------------------------------------------
  */

  startSecondHalf() {
    if (
      this.finished
    ) {
      return;
    }


    /*
    |--------------------------------------------------------------------------
    | Make sure clock starts from 45.
    |--------------------------------------------------------------------------
    */

    if (
      this.simTime <
      45 * 60
    ) {
      this.simTime =
        45 * 60;
    }


    this.minute = 45;

    this.second = 0;

    this.previousMinute = 45;

    this.halfTime = false;

    this.running = true;

    this.state =
      "SECOND_HALF";


    /*
    |--------------------------------------------------------------------------
    | Second half kickoff
    |--------------------------------------------------------------------------
    */

    this.lastPossessionTeam =
      this.lastPossessionTeam ===
      "home"
        ? "away"
        : "home";


    this.setupKickoff();


    this.emitEvent({
      type:
        EVENTS?.KICKOFF ||
        "kickoff",

      minute: 45,

      second: 0,

      half: 2,
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


    this.fullTimeTriggered = true;

    this.finished = true;

    this.running = false;

    this.halfTime = false;

    this.state =
      "FULLTIME";


    this.simTime =
      FOOTBALL_SECONDS;

    this.minute = 90;

    this.second = 0;


    /*
    |--------------------------------------------------------------------------
    | Fulltime event
    |--------------------------------------------------------------------------
    */

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
  | FIND PLAYER
  |--------------------------------------------------------------------------
  */

  findPlayerById(
    playerId
  ) {
    if (
      playerId === null ||
      playerId === undefined
    ) {
      return null;
    }


    return (
      playerById(
        this.home,
        playerId
      ) ||
      playerById(
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
  | TypeError: ee.getSnapshot is not a function
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
          number(
            this.home?.score,
            0
          ),

        away:
          number(
            this.away?.score,
            0
          ),
      },

      possession: {
        home:
          Number(
            number(
              this.possession?.home,
              50
            ).toFixed(1)
          ),

        away:
          Number(
            number(
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
  |
  | Keep this for old code that calls getState().
  |
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
  | Only managed side should call this from the UI.
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
      playerById(
        team,
        playerOutId
      );


    const playerIn =
      playerById(
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
      playerOut.id ===
      playerIn.id
    ) {
      return false;
    }


    /*
    |--------------------------------------------------------------------------
    | Player coming in must not already be playing.
    |--------------------------------------------------------------------------
    */

    if (
      playerIn.onPitch === true
    ) {
      return false;
