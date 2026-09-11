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
| MATCH ENGINE
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Real match duration:
|     8 minutes
|
| Football duration:
|     90 minutes
|
| Therefore:
|
|     90 / 480 = 0.1875 football minutes / real second
|
| Or:
|
|     1 football minute = 5.333 real seconds
|
| But player movement DOES NOT use this multiplier.
|
| Player movement receives the real frame dt.
|
| Example:
|
|     requestAnimationFrame -> dt = 0.016
|
| The player moves according to his actual speed.
|
| Only the match clock is accelerated.
|
|--------------------------------------------------------------------------
*/


const REAL_MATCH_SECONDS = 8 * 60;
const FOOTBALL_MATCH_MINUTES = 90;

const SIM_MINUTES_PER_REAL_SECOND =
  FOOTBALL_MATCH_MINUTES / REAL_MATCH_SECONDS;


/*
|--------------------------------------------------------------------------
| Utility helpers
|--------------------------------------------------------------------------
*/

function safeNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}


function getPlayerRating(player) {
  if (!player) return 50;

  return safeNumber(
    player.overall ??
    player.rating ??
    player.overallRating ??
    player.ovr,
    50
  );
}


function getPlayerAttribute(player, names, fallback = 50) {
  if (!player) return fallback;

  for (const name of names) {
    if (player[name] !== undefined) {
      return safeNumber(player[name], fallback);
    }

    if (player.attributes && player.attributes[name] !== undefined) {
      return safeNumber(player.attributes[name], fallback);
    }

    if (player.stats && player.stats[name] !== undefined) {
      return safeNumber(player.stats[name], fallback);
    }
  }

  return fallback;
}


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


function getPlayerPassing(player) {
  return getPlayerAttribute(
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


function getPlayerShooting(player) {
  return getPlayerAttribute(
    player,
    [
      "shooting",
      "shot",
      "finishing",
    ],
    50
  );
}


function isPlayerAvailable(player) {
  if (!player) return false;

  if (player.redCard) return false;

  if (player.sentOff) return false;

  if (player.isSentOff) return false;

  if (player.substituted) return false;

  if (player.onPitch === false) return false;

  return true;
}


function getTeamPlayers(team) {
  if (!team) return [];

  if (Array.isArray(team.players)) {
    return team.players;
  }

  return [];
}


function getActivePlayers(team) {
  return getTeamPlayers(team).filter(isPlayerAvailable);
}


function getPlayerById(team, playerId) {
  if (!team || !playerId) return null;

  return getTeamPlayers(team).find(
    (player) => String(player.id) === String(playerId)
  ) || null;
}


function getOpponentTeam(team, home, away) {
  if (!team) return null;

  return team.side === "home" ? away : home;
}


function getTeamDirection(team) {
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


function getGoalX(team) {
  const direction = getTeamDirection(team);

  if (direction === 1) {
    return FIELD.width;
  }

  return 0;
}


function getOwnGoalX(team) {
  const direction = getTeamDirection(team);

  if (direction === 1) {
    return 0;
  }

  return FIELD.width;
}


function getGoalDistance(player, team) {
  if (!player || !team) return Infinity;

  return Math.abs(
    getGoalX(team) - safeNumber(player.x, FIELD.centerX)
  );
}


function normalizeTime(seconds) {
  return Math.max(0, safeNumber(seconds, 0));
}


function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}


/*
|--------------------------------------------------------------------------
| Match Engine
|--------------------------------------------------------------------------
*/

export default class MatchEngine {
  constructor({
    matchId = null,

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

    durationSeconds = REAL_MATCH_SECONDS,

    initialScore = {},
    initialMinute = 0,
    initialEvents = [],

    onEvent = null,
  }) {
    this.matchId = matchId;

    /*
    |--------------------------------------------------------------------------
    | REAL TIME
    |--------------------------------------------------------------------------
    */

    this.realDurationSeconds =
      safeNumber(durationSeconds, REAL_MATCH_SECONDS) ||
      REAL_MATCH_SECONDS;

    /*
    |--------------------------------------------------------------------------
    | FOOTBALL TIME
    |--------------------------------------------------------------------------
    */

    this.footballDurationMinutes = FOOTBALL_MATCH_MINUTES;

    this.simMinutesPerRealSecond =
      FOOTBALL_MATCH_MINUTES /
      this.realDurationSeconds;

    /*
    |--------------------------------------------------------------------------
    | Clock
    |--------------------------------------------------------------------------
    */

    this.realTime = 0;

    this.simTime =
      Math.max(
        0,
        safeNumber(initialMinute, 0) * 60
      );

    this.minute =
      Math.floor(
        this.simTime / 60
      );

    this.second =
      Math.floor(
        this.simTime % 60
      );

    this.previousMinute = this.minute;

    this.running = false;

    this.finished = false;

    this.halfTime = false;

    this.halfTimeTriggered = false;

    this.fullTimeTriggered = false;

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

    this.events = Array.isArray(initialEvents)
      ? [...initialEvents]
      : [];

    this.onEvent =
      typeof onEvent === "function"
        ? onEvent
        : null;

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

    this.aiSubstitutionTimer = 0;

    this.aiDecisionTimer = 0;

    /*
    |--------------------------------------------------------------------------
    | Match state
    |--------------------------------------------------------------------------
    */

    this.state = "NOT_STARTED";

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
  | START
  |--------------------------------------------------------------------------
  */

  start() {
    if (this.finished) return;

    this.running = true;

    this.state =
      this.minute >= 45
        ? "SECOND_HALF"
        : "FIRST_HALF";

    this.emitEvent({
      type: EVENTS?.KICKOFF || "kickoff",
      minute: this.minute,
      second: this.second,
      team: "home",
    });
  }


  /*
  |--------------------------------------------------------------------------
  | PAUSE
  |--------------------------------------------------------------------------
  */

  pause() {
    this.running = false;

    if (!this.finished) {
      this.state = "PAUSED";
    }
  }


  /*
  |--------------------------------------------------------------------------
  | RESUME
  |--------------------------------------------------------------------------
  */

  resume() {
    if (this.finished) return;

    this.running = true;

    this.state =
      this.minute >= 45
        ? "SECOND_HALF"
        : "FIRST_HALF";
  }


  /*
  |--------------------------------------------------------------------------
  | UPDATE
  |--------------------------------------------------------------------------
  |
  | dt = REAL seconds.
  |
  | This is the most important part.
  |
  | NEVER:
  |
  |     dt *= simMinutesPerRealSecond
  |
  | for player movement.
  |
  | The match clock is accelerated separately.
  |
  |--------------------------------------------------------------------------
  */

  update(dt) {
    if (!this.running || this.finished) {
      return;
    }

    let realDt = safeNumber(dt, 0);

    /*
    |--------------------------------------------------------------------------
    | Prevent huge jumps after tab switching / phone sleep
    |--------------------------------------------------------------------------
    */

    realDt = clamp(
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
    | FOOTBALL CLOCK
    |--------------------------------------------------------------------------
    |
    | 8 real minutes -> 90 football minutes.
    |
    | IMPORTANT:
    | Only clock uses this multiplier.
    |
    |--------------------------------------------------------------------------
    */

    const previousSimTime = this.simTime;

    this.simTime +=
      realDt *
      this.simMinutesPerRealSecond *
      60;

    /*
    |--------------------------------------------------------------------------
    | Limit to 90 minutes
    |--------------------------------------------------------------------------
    */

    this.simTime = Math.min(
      this.simTime,
      this.footballDurationMinutes * 60
    );

    /*
    |--------------------------------------------------------------------------
    | Current football time
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
    | Match minute change
    |--------------------------------------------------------------------------
    */

    if (this.minute !== this.previousMinute) {
      this.handleMinuteChange(
        this.previousMinute,
        this.minute
      );

      this.previousMinute =
        this.minute;
    }

    /*
    |--------------------------------------------------------------------------
    | PLAYER / BALL SIMULATION
    |--------------------------------------------------------------------------
    |
    | VERY IMPORTANT:
    |
    | realDt is passed here.
    |
    | NOT the accelerated football clock.
    |
    |--------------------------------------------------------------------------
    */

    this.updatePlayers(realDt);

    this.updatePossession();

    this.updateBallPhysics(realDt);

    this.handleBallOwner(realDt);

    this.handleBallPhysics();

    this.handleTackles(realDt);

    this.updateAIDecisions(realDt);

    this.updateTeamStats(realDt);

    this.updateSubstitutions(realDt);

    /*
    |--------------------------------------------------------------------------
    | Halftime
    |--------------------------------------------------------------------------
    */

    if (
      !this.halfTimeTriggered &&
      previousSimTime < 45 * 60 &&
      this.simTime >= 45 * 60
    ) {
      this.triggerHalfTime();
    }

    /*
    |--------------------------------------------------------------------------
    | Full time
    |--------------------------------------------------------------------------
    */

    if (
      this.simTime >= 90 * 60
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

    updatePlayerMovement(
      this.home,
      this.away,
      this.ball,
      realDt
    );

    /*
    |--------------------------------------------------------------------------
    | Away
    |--------------------------------------------------------------------------
    */

    updatePlayerMovement(
      this.away,
      this.home,
      this.ball,
      realDt
    );

    /*
    |--------------------------------------------------------------------------
    | Additional continuous movement
    |--------------------------------------------------------------------------
    |
    | We deliberately do NOT multiply player speed by the match clock.
    |
    |--------------------------------------------------------------------------
    */

    this.keepPlayersActive(
      this.home,
      this.away,
      realDt
    );

    this.keepPlayersActive(
      this.away,
      this.home,
      realDt
    );
  }


  /*
  |--------------------------------------------------------------------------
  | KEEP PLAYERS ACTIVE
  |--------------------------------------------------------------------------
  |
  | Prevents players from freezing after reaching one target.
  |
  |--------------------------------------------------------------------------
  */

  keepPlayersActive(
    team,
    opponent,
    dt
  ) {
    const players =
      getActivePlayers(team);

    if (!players.length) return;

    for (const player of players) {
      if (!player) continue;

      /*
      |--------------------------------------------------------------------------
      | Natural stamina effect
      |--------------------------------------------------------------------------
      */

      const stamina =
        getPlayerStamina(player);

      player.stamina =
        player.stamina !== undefined
          ? player.stamina
          : stamina;

      /*
      |--------------------------------------------------------------------------
      | Don't force movement if movement.js
      | already controls the player.
      |--------------------------------------------------------------------------
      */

      if (
        player.targetX === undefined &&
        player.targetY === undefined
      ) {
        player.targetX =
          safeNumber(player.x, FIELD.centerX);

        player.targetY =
          safeNumber(player.y, FIELD.centerY);
      }

      /*
      |--------------------------------------------------------------------------
      | Small movement heartbeat.
      |--------------------------------------------------------------------------
      |
      | This prevents a player from becoming permanently idle.
      |
      |--------------------------------------------------------------------------
      */

      player.activityTimer =
        safeNumber(
          player.activityTimer,
          0
        ) + dt;

      /*
      |--------------------------------------------------------------------------
      | Every few real seconds, refresh movement intent.
      |--------------------------------------------------------------------------
      */

      if (
        player.activityTimer >=
        randomBetween(2.5, 4.5)
      ) {
        player.activityTimer = 0;

        this.refreshPlayerIntent(
          player,
          team,
          opponent
        );
      }
    }
  }


  /*
  |--------------------------------------------------------------------------
  | REFRESH PLAYER INTENT
  |--------------------------------------------------------------------------
  */

  refreshPlayerIntent(
    player,
    team,
    opponent
  ) {
    if (!player || !team) return;

    const ball = this.ball;

    const bx =
      safeNumber(
        ball?.x,
        FIELD.centerX
      );

    const by =
      safeNumber(
        ball?.y,
        FIELD.centerY
      );

    const px =
      safeNumber(
        player.x,
        FIELD.centerX
      );

    const py =
      safeNumber(
        player.y,
        FIELD.centerY
      );

    const direction =
      getTeamDirection(team);

    const role =
      String(
        player.role ??
        player.position ??
        ""
      ).toLowerCase();

    /*
    |--------------------------------------------------------------------------
    | Ball proximity
    |--------------------------------------------------------------------------
    */

    const ballDistance =
      distance(
        px,
        py,
        bx,
        by
      );

    /*
    |--------------------------------------------------------------------------
    | Attackers move more toward ball / goal
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("st") ||
      role.includes("cf") ||
      role.includes("fw") ||
      role.includes("att")
    ) {
      const forwardX =
        clamp(
          bx +
            direction *
            randomBetween(35, 90),
          40,
          FIELD.width - 40
        );

      const forwardY =
        clamp(
          by +
            randomBetween(-65, 65),
          30,
          FIELD.height - 30
        );

      player.targetX = forwardX;
      player.targetY = forwardY;

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Midfielders stay connected to play
    |--------------------------------------------------------------------------
    */

    if (
      role.includes("cm") ||
      role.includes("dm") ||
      role.includes("am") ||
      role.includes("mid")
    ) {
      const targetX =
        clamp(
          bx +
            direction *
            randomBetween(-20, 70),
          50,
          FIELD.width - 50
        );

      const targetY =
        clamp(
          by +
            randomBetween(-90, 90),
          35,
          FIELD.height - 35
        );

      player.targetX = targetX;
      player.targetY = targetY;

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
      const ownGoalX =
        getOwnGoalX(team);

      const desiredX =
        ownGoalX +
        direction *
        randomBetween(
          80,
          180
        );

      player.targetX =
        clamp(
          desiredX,
          35,
          FIELD.width - 35
        );

      player.targetY =
        clamp(
          by +
            randomBetween(-100, 100),
          30,
          FIELD.height - 30
        );

      return;
    }

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
      const ownGoalX =
        getOwnGoalX(team);

      player.targetX =
        ownGoalX +
        direction *
        randomBetween(20, 60);

      player.targetY =
        clamp(
          FIELD.centerY +
            (by - FIELD.centerY) *
            0.25,
          50,
          FIELD.height - 50
        );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Generic player
    |--------------------------------------------------------------------------
    */

    if (ballDistance > 250) {
      player.targetX =
        clamp(
          bx +
            direction *
            randomBetween(-30, 80),
          30,
          FIELD.width - 30
        );

      player.targetY =
        clamp(
          by +
            randomBetween(-80, 80),
          30,
          FIELD.height - 30
        );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | POSSESSION
  |--------------------------------------------------------------------------
  */

  updatePossession() {
    const homePlayers =
      getActivePlayers(this.home);

    const awayPlayers =
      getActivePlayers(this.away);

    let homeCount = 0;
    let awayCount = 0;

    for (const player of homePlayers) {
      if (player.hasBall) {
        homeCount++;
      }
    }

    for (const player of awayPlayers) {
      if (player.hasBall) {
        awayCount++;
      }
    }

    if (homeCount > 0) {
      this.lastPossessionTeam = "home";

      this.lastPossessionPlayer =
        homePlayers.find(
          (p) => p.hasBall
        )?.id || null;
    }

    if (awayCount > 0) {
      this.lastPossessionTeam = "away";

      this.lastPossessionPlayer =
        awayPlayers.find(
          (p) => p.hasBall
        )?.id || null;
    }

    /*
    |--------------------------------------------------------------------------
    | No owner
    |--------------------------------------------------------------------------
    */

    if (
      homeCount === 0 &&
      awayCount === 0
    ) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Update raw possession
    |--------------------------------------------------------------------------
    */

    if (homeCount > 0) {
      this.possessionAccumulator.home += 1;
    }

    if (awayCount > 0) {
      this.possessionAccumulator.away += 1;
    }

    const total =
      this.possessionAccumulator.home +
      this.possessionAccumulator.away;

    if (total <= 0) return;

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
    updateBall(
      this.ball,
      realDt
    );
  }


  /*
  |--------------------------------------------------------------------------
  | OWNER HANDLING
  |--------------------------------------------------------------------------
  */

  handleBallOwner() {
    if (!this.ball) return;

    if (
      this.ball.state !==
      BALL_STATE.POSSESSED
    ) {
      return;
    }

    const owner =
      this.findPlayerById(
        this.ball.ownerId
      );

    if (!owner) {
      this.ball.ownerId = null;

      this.ball.state =
        BALL_STATE.FREE;

      return;
    }

    if (!isPlayerAvailable(owner)) {
      this.ball.ownerId = null;

      this.ball.state =
        BALL_STATE.FREE;

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Keep ball attached to player
    |--------------------------------------------------------------------------
    */

    moveBallWithOwner(
      this.ball,
      owner
    );

    /*
    |--------------------------------------------------------------------------
    | Check nearby opponents
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

    for (const defender of opponents) {
      if (!defender) continue;

      const d =
        distance(
          owner.x,
          owner.y,
          defender.x,
          defender.y
        );

      /*
      |--------------------------------------------------------------------------
      | Tackle range
      |--------------------------------------------------------------------------
      */

      if (d < 38) {
        const tackled =
          attemptTackle(
            opponentTeam,
            owner,
            defender,
            this.ball
          );

        if (tackled) {
          this.lastTouch = {
            team: defender.side,
            playerId: defender.id,
            type: "tackle",
          };

          return;
        }
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Attacking decision
    |--------------------------------------------------------------------------
    */

    this.checkAttackingDecision(
      owner,
      opponentTeam
    );
  }


  /*
  |--------------------------------------------------------------------------
  | ATTACKING DECISION
  |--------------------------------------------------------------------------
  */

  checkAttackingDecision(
    owner,
    opponentTeam
  ) {
    if (!owner || !owner.hasBall) {
      return;
    }

    const team =
      owner.side === "home"
        ? this.home
        : this.away;

    const goalDistance =
      getGoalDistance(
        owner,
        team
      );

    const shooting =
      getPlayerShooting(owner);

    const passing =
      getPlayerPassing(owner);

    const stamina =
      getPlayerStamina(owner);

    const pressure =
      this.getPressure(
        owner,
        opponentTeam
      );

    /*
    |--------------------------------------------------------------------------
    | Action cooldown
    |--------------------------------------------------------------------------
    |
    | This is REAL time.
    |
    |--------------------------------------------------------------------------
    */

    const now =
      this.realTime;

    const lastAction =
      safeNumber(
        owner.lastActionAt,
        -100
      );

    const actionAge =
      now - lastAction;

    /*
    |--------------------------------------------------------------------------
    | Prevent frame-by-frame shooting/passing
    |--------------------------------------------------------------------------
    */

    if (actionAge < 0.8) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Shooting range
    |--------------------------------------------------------------------------
    */

    const shootingRange =
      FIELD.width * 0.30;

    /*
    |--------------------------------------------------------------------------
    | Shot decision
    |--------------------------------------------------------------------------
    */

    if (
      goalDistance <= shootingRange &&
      actionAge >= 1.1
    ) {
      const shootingChance =
        0.12 +
        shooting / 600;

      /*
      |--------------------------------------------------------------------------
      | Better players make better decisions
      |--------------------------------------------------------------------------
      */

      const decision =
        getPlayerAttribute(
          owner,
          [
            "decisionMaking",
            "decision",
            "composure",
          ],
          55
        );

      const finalShotChance =
        shootingChance +
        decision / 1500 -
        pressure / 1000;

      if (
        Math.random() <
        clamp(
          finalShotChance,
          0.06,
          0.55
        )
      ) {
        const success =
          attemptShot(
            this,
            team,
            opponentTeam,
            owner
          );

        if (success) {
          owner.lastActionAt =
            now;

          return;
        }
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Passing
    |--------------------------------------------------------------------------
    */

    if (
      actionAge >= 0.9
    ) {
      const passChance =
        0.35 +
        passing / 250;

      const decision =
        getPlayerAttribute(
          owner,
          [
            "decisionMaking",
            "vision",
            "passing",
          ],
          55
        );

      const finalPassChance =
        passChance +
        decision / 500 -
        pressure / 1200;

      if (
        Math.random() <
        clamp(
          finalPassChance,
          0.25,
          0.85
        )
      ) {
        const success =
          attemptPass(
            this,
            team,
            opponentTeam,
            owner
          );

        if (success) {
          owner.lastActionAt =
            now;

          return;
        }
      }
    }

    /*
    |--------------------------------------------------------------------------
    | If player is under heavy pressure,
    | prioritize a quick pass.
    |--------------------------------------------------------------------------
    */

    if (
      pressure > 75 &&
      actionAge >= 0.75
    ) {
      const success =
        attemptPass(
          this,
          team,
          opponentTeam,
          owner
        );

      if (success) {
        owner.lastActionAt =
          now;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Stamina affects decisions,
    | NOT movement clock.
    |--------------------------------------------------------------------------
    */

    if (
      stamina < 25
    ) {
      owner.lastActionAt =
        Math.min(
          safeNumber(
            owner.lastActionAt,
            now
          ),
          now - 0.4
        );
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
    if (!player || !opponentTeam) {
      return 0;
    }

    const opponents =
      getActivePlayers(
        opponentTeam
      );

    let closest =
      Infinity;

    for (const opponent of opponents) {
      const d =
        distance(
          player.x,
          player.y,
          opponent.x,
          opponent.y
        );

      if (d < closest) {
        closest = d;
      }
    }

    if (closest <= 20) {
      return 100;
    }

    if (closest >= 180) {
      return 0;
    }

    return clamp(
      100 -
        (
          (closest - 20) /
          160
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
    if (!this.ball) return;

    /*
    |--------------------------------------------------------------------------
    | Passing
    |--------------------------------------------------------------------------
    */

    if (
      this.ball.state ===
      BALL_STATE.PASSING
    ) {
      this.checkPassReception();

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Shooting
    |--------------------------------------------------------------------------
    */

    if (
      this.ball.state ===
      BALL_STATE.SHOOTING
    ) {
      this.checkShot();

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Free ball
    |--------------------------------------------------------------------------
    */

    if (
      this.ball.state ===
      BALL_STATE.FREE
    ) {
      this.checkFreeBallReception();

      this.checkBoundaries();

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Saved ball
    |--------------------------------------------------------------------------
    */

    if (
      this.ball.state ===
      BALL_STATE.SAVED
    ) {
      if (this.ball.ownerId) {
        const owner =
          this.findPlayerById(
            this.ball.ownerId
          );

        if (owner) {
          setBallOwner(
            this.ball,
            owner
          );
        }
      }

      return;
    }
  }


  /*
  |--------------------------------------------------------------------------
  | PASS RECEPTION
  |--------------------------------------------------------------------------
  */

  checkPassReception() {
    const ball = this.ball;

    if (!ball) return;

    const target =
      this.findPlayerById(
        ball.targetId
      );

    /*
    |--------------------------------------------------------------------------
    | Target player gets priority
    |--------------------------------------------------------------------------
    */

    if (
      target &&
      isPlayerAvailable(target)
    ) {
      const d =
        distance(
          ball.x,
          ball.y,
          target.x,
          target.y
        );

      if (d <= 34) {
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
    | Nearby players can intercept
    |--------------------------------------------------------------------------
    */

    const allPlayers = [
      ...getActivePlayers(this.home),
      ...getActivePlayers(this.away),
    ];

    let closest = null;
    let closestDistance = Infinity;

    for (const player of allPlayers) {
      const d =
        distance(
          ball.x,
          ball.y,
          player.x,
          player.y
        );

      if (d < closestDistance) {
        closestDistance = d;
        closest = player;
      }
    }

    if (
      closest &&
      closestDistance <= 25
    ) {
      /*
      |--------------------------------------------------------------------------
      | Target team gets a little advantage
      |--------------------------------------------------------------------------
      */

      if (
        ball.passTeam &&
        closest.side === ball.passTeam
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

      if (
        Math.random() < 0.45
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

          team: closest.side,

          playerId: closest.id,

          fromPlayerId:
            ball.passerId || null,
        });

        return;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Pass lost
    |--------------------------------------------------------------------------
    */

    if (
      Math.abs(ball.vx) +
      Math.abs(ball.vy) < 3
    ) {
      ball.state =
        BALL_STATE.FREE;

      ball.ownerId = null;
    }
  }


  /*
  |--------------------------------------------------------------------------
  | COMPLETE PASS
  |--------------------------------------------------------------------------
  */

  completePass(receiver) {
    if (!receiver) return;

    const pass =
      this.lastPass;

    if (!pass) return;

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
    const ball = this.ball;

    if (!ball) return;

    const allPlayers = [
      ...getActivePlayers(this.home),
      ...getActivePlayers(this.away),
    ];

    let closest = null;
    let closestDistance = Infinity;

    for (const player of allPlayers) {
      const d =
        distance(
          ball.x,
          ball.y,
          player.x,
          player.y
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
      closestDistance <= 24
    ) {
      setBallOwner(
        ball,
        closest
      );

      this.lastTouch = {
        team: closest.side,
        playerId: closest.id,
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
    const ball = this.ball;

    if (!ball) return;

    /*
    |--------------------------------------------------------------------------
    | If shooting ball reaches goal line
    |--------------------------------------------------------------------------
    */

    const reachedRight =
      ball.x >= FIELD.width;

    const reachedLeft =
      ball.x <= 0;

    if (
      reachedRight ||
      reachedLeft
    ) {
      const shootingTeam =
        ball.shotTeam === "home"
          ? this.home
          : this.away;

      const defendingTeam =
        ball.shotTeam === "home"
          ? this.away
          : this.home;

      resolveShot(
        this,
        shootingTeam,
        defendingTeam
      );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Prevent endlessly travelling shot
    |--------------------------------------------------------------------------
    */

    if (
      Math.abs(ball.vx) +
      Math.abs(ball.vy) < 2
    ) {
      resolveShot(
        this,
        ball.shotTeam === "home"
          ? this.home
          : this.away,
        ball.shotTeam === "home"
          ? this.away
          : this.home
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | TACKLES
  |--------------------------------------------------------------------------
  */

  handleTackles() {
    const teams = [
      [this.home, this.away],
      [this.away, this.home],
    ];

    for (const [team, opponent] of teams) {
      const players =
        getActivePlayers(team);

      const opponents =
        getActivePlayers(opponent);

      for (const player of players) {
        if (!player) continue;

        /*
        |--------------------------------------------------------------------------
        | Only attempt tackle when opponent has ball
        |--------------------------------------------------------------------------
        */

        const opponentOwner =
          opponents.find(
            (p) => p.hasBall
          );

        if (!opponentOwner) {
          continue;
        }

        const d =
          distance(
            player.x,
            player.y,
            opponentOwner.x,
            opponentOwner.y
          );

        if (d <= 34) {
          attemptTackle(
            team,
            opponentOwner,
            player,
            this.ball
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

  updateAIDecisions(dt) {
    this.aiDecisionTimer += dt;

    /*
    |--------------------------------------------------------------------------
    | AI doesn't need to calculate every frame.
    |--------------------------------------------------------------------------
    */

    if (
      this.aiDecisionTimer < 0.20
    ) {
      return;
    }

    this.aiDecisionTimer = 0;

    updateAI(
      this.home,
      this.away
    );

    updateAI(
      this.away,
      this.home
    );
  }


  /*
  |--------------------------------------------------------------------------
  | SUBSTITUTIONS
  |--------------------------------------------------------------------------
  */

  updateSubstitutions(dt) {
    this.aiSubstitutionTimer += dt;

    /*
    |--------------------------------------------------------------------------
    | Every 7 real seconds AI checks substitutions.
    |--------------------------------------------------------------------------
    */

    if (
      this.aiSubstitutionTimer < 7
    ) {
      return;
    }

    this.aiSubstitutionTimer = 0;

    if (
      this.minute < 45
    ) {
      return;
    }

    /*
    |--------------------------------------------------------------------------
    | AI home
    |--------------------------------------------------------------------------
    */

    this.performAITeamSubstitution(
      this.home,
      this.away
    );

    /*
    |--------------------------------------------------------------------------
    | AI away
    |--------------------------------------------------------------------------
    */

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
    if (!team) return;

    /*
    |--------------------------------------------------------------------------
    | Don't substitute too frequently
    |--------------------------------------------------------------------------
    */

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
    | Random decision
    |--------------------------------------------------------------------------
    */

    if (
      Math.random() > 0.25
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

      /*
      |--------------------------------------------------------------------------
      | Some substitution systems return
      | { playerOut, playerIn }
      |--------------------------------------------------------------------------
      */

      if (
        result.playerOut &&
        result.playerIn
      ) {
        performSubstitution(
          team,
          result.playerOut,
          result.playerIn
        );
      }
    } catch (error) {
      /*
      |--------------------------------------------------------------------------
      | AI substitution must never crash the match.
      |--------------------------------------------------------------------------
      */

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
    | Minutes
    |--------------------------------------------------------------------------
    |
    | Team minute calculations should follow
    | football clock, not player movement.
    |--------------------------------------------------------------------------
    */

    const footballMinutes =
      dt *
      this.simMinutesPerRealSecond;

    try {
      updateTeamMinutes(
        this.home,
        footballMinutes
      );

      updateTeamMinutes(
        this.away,
        footballMinutes
      );
    } catch {
      /*
      |--------------------------------------------------------------------------
      | Don't let optional team stats crash the match.
      |--------------------------------------------------------------------------
      */
    }

    /*
    |--------------------------------------------------------------------------
    | Player fatigue
    |--------------------------------------------------------------------------
    */

    this.updatePlayerFatigue(
      this.home,
      dt
    );

    this.updatePlayerFatigue(
      this.away,
      dt
    );
  }


  /*
  |--------------------------------------------------------------------------
  | PLAYER FATIGUE
  |--------------------------------------------------------------------------
  |
  | Fatigue is based on football time, but movement speed itself
  | remains controlled by movement.js.
  |--------------------------------------------------------------------------
  */

  updatePlayerFatigue(
    team,
    realDt
  ) {
    const players =
      getActivePlayers(team);

    /*
    |--------------------------------------------------------------------------
    | Football seconds elapsed
    |--------------------------------------------------------------------------
    */

    const footballDt =
      realDt *
      this.simMinutesPerRealSecond *
      60;

    for (const player of players) {
      if (!player) continue;

      player.matchSeconds =
        safeNumber(
          player.matchSeconds,
          0
        ) + footballDt;

      /*
      |--------------------------------------------------------------------------
      | Initialize stamina
      |--------------------------------------------------------------------------
      */

      if (
        player.currentStamina === undefined
      ) {
        player.currentStamina =
          getPlayerStamina(player);
      }

      /*
      |--------------------------------------------------------------------------
      | Very light natural fatigue
      |--------------------------------------------------------------------------
      */

      const baseStamina =
        getPlayerStamina(player);

      const minutesPlayed =
        player.matchSeconds / 60;

      const fatigue =
        Math.max(
          0,
          minutesPlayed - 25
        ) * 0.035;

      player.currentStamina =
        clamp(
          baseStamina - fatigue,
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
    const ball = this.ball;

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

        minute: this.minute,

        second: this.second,
      });

      this.restartFromSide();
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
      | If this was a shot, checkShot handles it.
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
        this.ball.x,
        10,
        FIELD.width - 10
      );

    this.ball.y =
      clamp(
        this.ball.y,
        10,
        FIELD.height - 10
      );

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

    this.ball.state =
      BALL_STATE.FREE;
  }


  /*
  |--------------------------------------------------------------------------
  | GOAL
  |--------------------------------------------------------------------------
  */

  scoreGoal(
    scoringTeam,
    shooter = null
  ) {
    if (!scoringTeam) {
      return;
    }

    scoringTeam.score =
      safeNumber(
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
      safeNumber(
        scoringTeam.stats.goals,
        0
      ) + 1;

    /*
    |--------------------------------------------------------------------------
    | Shooter
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

      /*
      |--------------------------------------------------------------------------
      | Don't give assist to shooter
      |--------------------------------------------------------------------------
      */

      if (
        assister &&
        (!shooter ||
          assister.id !== shooter.id)
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
    | Event
    |--------------------------------------------------------------------------
    */

    this.emitEvent({
      type:
        EVENTS?.GOAL ||
        "goal",

      minute: this.minute,

      second: this.second,

      team: scoringTeam.side,

      teamName:
        scoringTeam.name ||
        scoringTeam.teamName ||
        scoringTeam.id,

      playerId:
        shooter?.id || null,

      playerName:
        shooter?.name ||
        shooter?.playerName ||
        null,

      score: {
        home: this.home.score,
        away: this.away.score,
      },
    });

    /*
    |--------------------------------------------------------------------------
    | Reset
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
    /*
    |--------------------------------------------------------------------------
    | Reset player ball states
    |--------------------------------------------------------------------------
    */

    for (
      const player of [
        ...getTeamPlayers(this.home),
        ...getTeamPlayers(this.away),
      ]
    ) {
      if (!player) continue;

      player.hasBall = false;

      if (
        player.onPitch === undefined
      ) {
        player.onPitch = true;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Ball
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
    | Give kickoff to team that should start
    |--------------------------------------------------------------------------
    */

    const kickoffTeam =
      this.minute === 0
        ? this.home
        : (
            this.lastPossessionTeam === "home"
              ? this.away
              : this.home
          );

    const players =
      getActivePlayers(
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

    for (const player of players) {
      const d =
        distance(
          player.x,
          player.y,
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

    if (kickoffPlayer) {
      kickoffPlayer.x =
        FIELD.centerX;

      kickoffPlayer.y =
        FIELD.centerY;

      setBallOwner(
        this.ball,
        kickoffPlayer
      );
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

      minute: currentMinute,

      second: this.second,
    });

    /*
    |--------------------------------------------------------------------------
    | Debug / UI
    |--------------------------------------------------------------------------
    */

    if (
      currentMinute === 45
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
        home: this.home.score,
        away: this.away.score,
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

    this.halfTime = false;

    this.running = true;

    this.state =
      "SECOND_HALF";

    this.ball.state =
      BALL_STATE.FREE;

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

    this.state =
      "FULLTIME";

    this.simTime =
      90 * 60;

    this.minute = 90;

    this.second = 0;

    this.emitEvent({
      type:
        EVENTS?.FULLTIME ||
        "fulltime",

      minute: 90,

      second: 0,

      score: {
        home: this.home.score,
        away: this.away.score,
      },
    });
  }


  /*
  |--------------------------------------------------------------------------
  | FIND PLAYER
  |--------------------------------------------------------------------------
  */

  findPlayerById(playerId) {
    if (!playerId) return null;

    return (
      getPlayerById(
        this.home,
        playerId
      ) ||
      getPlayerById(
        this.away,
        playerId
      )
    );
  }


  /*
  |--------------------------------------------------------------------------
  | EVENT
  |--------------------------------------------------------------------------
  */

  emitEvent(event) {
    if (!event) return;

    const enriched = {
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
      enriched
    );

    /*
    |--------------------------------------------------------------------------
    | Don't allow infinite event memory
    |--------------------------------------------------------------------------
    */

    if (
      this.events.length > 500
    ) {
      this.events =
        this.events.slice(-500);
    }

    if (
      typeof this.onEvent ===
      "function"
    ) {
      try {
        this.onEvent(
          enriched
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
  | USER TACTICS
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  |
  | This method updates ONLY the managed team.
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

    if (!team) return;

    team.tactics = {
      ...(team.tactics || {}),
      ...(tactics || {}),
    };
  }


  /*
  |--------------------------------------------------------------------------
  | USER SUBSTITUTION
  |--------------------------------------------------------------------------
  |
  | Only managed team can be changed from UI.
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
      getPlayerById(
        team,
        playerOutId
      );

    const playerIn =
      getPlayerById(
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

    if (
      playerIn.onPitch === true
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

        minute: this.minute,

        second: this.second,

        team: team.side,

        playerOutId:
          playerOut.id,

        playerInId:
          playerIn.id,
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
  | GET STATE
  |--------------------------------------------------------------------------
  */

  getState() {
    return {
      matchId: this.matchId,

      state: this.state,

      running: this.running,

      finished: this.finished,

      halfTime: this.halfTime,

      realTime:
        this.realTime,

      realDurationSeconds:
        this.realDurationSeconds,

      footballDurationMinutes:
        this.footballDurationMinutes,

      minute:
        this.minute,

      second:
        this.second,

      simTime:
        this.simTime,

      score: {
        home: this.home.score,
        away: this.away.score,
      },

      possession: {
        home:
          Number(
            this.possession.home.toFixed(1)
          ),

        away:
          Number(
            this.possession.away.toFixed(1)
          ),
      },

      ball: {
        ...this.ball,
      },

      home: this.home,

      away: this.away,

      events: this.events,
    };
  }


  /*
  |--------------------------------------------------------------------------
  | RESET
  |--------------------------------------------------------------------------
  */

  reset() {
    this.realTime = 0;

    this.simTime = 0;

    this.minute = 0;

    this.second = 0;

    this.previousMinute = 0;

    this.running = false;

    this.finished = false;

    this.halfTime = false;

    this.halfTimeTriggered = false;

    this.fullTimeTriggered = false;

    this.state =
      "NOT_STARTED";

    this.possession = {
      home: 50,
      away: 50,
    };

    this.possessionAccumulator = {
      home: 0,
      away: 0,
    };

    this.lastPass = null;

    this.lastShot = null;

    this.lastTouch = null;

    this.lastPossessionTeam = null;

    this.lastPossessionPlayer = null;

    this.events = [];

    this.home.score = 0;
    this.away.score = 0;

    this.ball =
      createBall({
        x: FIELD.centerX,
        y: FIELD.centerY,
      });

    this.setupKickoff();
  }
}
