// lib/matchEngine.js

import {
  clamp,
  getFormationPositions,
  getPlayerId,
  getPlayerName,
  getPlayerOverall,
  getPlayerRole,
} from "./football";

const PITCH_LENGTH = 30;
const PITCH_WIDTH = 20;

function random(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;

  return Math.sqrt(dx * dx + dz * dz);
}

function percentageToPitchX(value) {
  return ((value - 50) / 50) * 15;
}

function percentageToPitchZ(value) {
  return ((value - 50) / 50) * 10;
}

function makeStats() {
  return {
    possession: 50,

    shots: 0,
    shotsOnTarget: 0,

    passes: 0,
    passesCompleted: 0,

    tackles: 0,
    interceptions: 0,

    fouls: 0,

    corners: 0,
    offsides: 0,

    yellow: 0,
    red: 0,

    saves: 0,

    attacks: 0,
    dangerousAttacks: 0,

    successfulDribbles: 0,
    blockedShots: 0,
  };
}

function assignPlayers(lineup, team, formation) {
  const positions = getFormationPositions(formation);

  const byRole = {
    GK: [],
    DEF: [],
    MID: [],
    ATT: [],
  };

  for (const player of lineup) {
    const role = getPlayerRole(player);

    if (!byRole[role]) {
      byRole.MID.push(player);
    } else {
      byRole[role].push(player);
    }
  }

  const players = [];

  for (const slot of positions) {
    let player = byRole[slot.role]?.shift();

    if (!player) {
      player =
        Object.values(byRole)
          .flat()
          .find(Boolean);
    }

    if (!player) continue;

    const id = getPlayerId(player);

    let x = percentageToPitchX(slot.x);
    let z = percentageToPitchZ(slot.z);

    if (team === "away") {
      x *= -1;
      z *= -1;
    }

    players.push({
      id,
      name: getPlayerName(player),
      role: getPlayerRole(player),
      rating: getPlayerOverall(player),

      team,

      x,
      z,

      baseX: x,
      baseZ: z,

      number:
        player.number ||
        player.shirtNumber ||
        players.length + 1,

      stamina: 100,

      hasBall: false,
    });
  }

  return players;
}

export function createInitialEngineState(
  homeXI,
  awayXI,
  formation = "4-4-2"
) {
  const homePlayers = assignPlayers(
    homeXI,
    "home",
    formation
  );

  const awayPlayers = assignPlayers(
    awayXI,
    "away",
    formation
  );

  const firstHome = homePlayers.find(
    (p) => p.role === "MID"
  ) || homePlayers[0];

  const firstAway = awayPlayers.find(
    (p) => p.role === "MID"
  ) || awayPlayers[0];

  const firstTeam =
    Math.random() < 0.5 ? "home" : "away";

  const owner =
    firstTeam === "home"
      ? firstHome
      : firstAway;

  if (owner) {
    owner.hasBall = true;
  }

  return {
    score: {
      home: 0,
      away: 0,
    },

    stats: {
      home: makeStats(),
      away: makeStats(),
    },

    players: {
      home: homePlayers,
      away: awayPlayers,
    },

    ball: {
      x: owner?.x || 0,
      z: owner?.z || 0,

      ownerTeam: owner?.team || null,
      ownerId: owner?.id || null,

      targetX: owner?.x || 0,
      targetZ: owner?.z || 0,
    },

    events: [],

    lastAction: {
      type: "kickoff",
      team: firstTeam,
      minute: 0,
    },
  };
}

function getTeamStrength(players) {
  if (!players.length) return 60;

  return (
    players.reduce(
      (sum, player) => sum + player.rating,
      0
    ) / players.length
  );
}

function getGoalkeeper(players) {
  return (
    players.find(
      (player) => player.role === "GK"
    ) || players[0]
  );
}

function getNearestPlayer(players, position) {
  let best = null;
  let bestDistance = Infinity;

  for (const player of players) {
    const d = distance(player, position);

    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }

  return best;
}

function movePlayers(
  state,
  attackingTeam,
  ballPosition
) {
  for (const team of ["home", "away"]) {
    const players = state.players[team];

    for (const player of players) {
      let influence = 0.08;

      if (player.team === attackingTeam) {
        influence = 0.18;
      }

      const targetX =
        player.baseX +
        (ballPosition.x - player.baseX) *
          influence;

      const targetZ =
        player.baseZ +
        (ballPosition.z - player.baseZ) *
          influence;

      const jitterX = random(-0.15, 0.15);
      const jitterZ = random(-0.15, 0.15);

      player.x = clamp(
        player.x +
          (targetX - player.x) * 0.12 +
          jitterX,
        -14.2,
        14.2
      );

      player.z = clamp(
        player.z +
          (targetZ - player.z) * 0.12 +
          jitterZ,
        -9.2,
        9.2
      );

      player.stamina = clamp(
        player.stamina - random(0.01, 0.06),
        50,
        100
      );
    }
  }
}

function createEvent(
  type,
  team,
  minute,
  player,
  detail,
  extra = {}
) {
  return {
    id:
      `${type}-${minute}-${Date.now()}-${Math.random()}`,
    type,
    team,
    minute,
    playerId: player?.id || null,
    playerName: player?.name || null,
    detail,
    ...extra,
  };
}

function addEvent(state, event) {
  state.events = [
    event,
    ...state.events,
  ].slice(0, 150);
}

function choosePossessionTeam(state) {
  const homeStrength = getTeamStrength(
    state.players.home
  );

  const awayStrength = getTeamStrength(
    state.players.away
  );

  const currentOwner =
    state.ball.ownerTeam;

  if (currentOwner && Math.random() < 0.72) {
    return currentOwner;
  }

  const homeProbability = clamp(
    0.5 +
      (homeStrength - awayStrength) *
        0.006 +
      random(-0.08, 0.08),
    0.25,
    0.75
  );

  return Math.random() < homeProbability
    ? "home"
    : "away";
}

function updatePossession(state, team) {
  const other =
    team === "home" ? "away" : "home";

  state.stats[team].possession += 0.55;
  state.stats[other].possession -= 0.55;

  state.stats.home.possession = clamp(
    state.stats.home.possession,
    5,
    95
  );

  state.stats.away.possession =
    100 - state.stats.home.possession;
}

function performPass(
  state,
  team,
  minute,
  passer
) {
  const teammates =
    state.players[team].filter(
      (p) => p.id !== passer.id
    );

  if (!teammates.length) return;

  teammates.sort(
    (a, b) =>
      distance(a, passer) -
      distance(b, passer)
  );

  const target =
    teammates[
      Math.min(
        randomInt(0, Math.min(5, teammates.length - 1)),
        teammates.length - 1
      )
    ];

  const passAccuracy = clamp(
    0.68 +
      (passer.rating - 60) * 0.006 -
      distance(passer, target) * 0.008,
    0.45,
    0.97
  );

  state.stats[team].passes++;

  const successful =
    Math.random() < passAccuracy;

  if (successful) {
    state.stats[team].passesCompleted++;

    passer.hasBall = false;
    target.hasBall = true;

    state.ball.ownerTeam = team;
    state.ball.ownerId = target.id;

    state.ball.x = passer.x;
    state.ball.z = passer.z;

    state.ball.targetX = target.x;
    state.ball.targetZ = target.z;

    addEvent(
      state,
      createEvent(
        "pass",
        team,
        minute,
        passer,
        `${passer.name} passed to ${target.name}`,
        {
          receiverId: target.id,
          receiverName: target.name,
          fromX: passer.x,
          fromZ: passer.z,
          toX: target.x,
          toZ: target.z,
        }
      )
    );

    state.lastAction = {
      type: "pass",
      team,
      minute,
      playerId: passer.id,
      receiverId: target.id,
      fromX: passer.x,
      fromZ: passer.z,
      toX: target.x,
      toZ: target.z,
    };
  } else {
    passer.hasBall = false;

    const opponentTeam =
      team === "home" ? "away" : "home";

    const interceptor =
      getNearestPlayer(
        state.players[opponentTeam],
        passer
      );

    if (interceptor) {
      interceptor.hasBall = true;

      state.ball.ownerTeam =
        opponentTeam;

      state.ball.ownerId =
        interceptor.id;

      state.ball.x = interceptor.x;
      state.ball.z = interceptor.z;

      state.stats[opponentTeam]
        .interceptions++;

      addEvent(
        state,
        createEvent(
          "interception",
          opponentTeam,
          minute,
          interceptor,
          `${interceptor.name} intercepted the pass`
        )
      );

      state.lastAction = {
        type: "interception",
        team: opponentTeam,
        minute,
        playerId: interceptor.id,
      };
    }
  }
}

function performDribble(
  state,
  team,
  minute,
  player
) {
  const direction =
    team === "home" ? 1 : -1;

  const oldX = player.x;
  const oldZ = player.z;

  const movement =
    random(0.8, 2.2);

  player.x = clamp(
    player.x + direction * movement,
    -13.5,
    13.5
  );

  player.z = clamp(
    player.z + random(-1.2, 1.2),
    -8.8,
    8.8
  );

  state.ball.x = player.x;
  state.ball.z = player.z;

  state.ball.targetX = player.x;
  state.ball.targetZ = player.z;

  state.stats[team]
    .successfulDribbles++;

  addEvent(
    state,
    createEvent(
      "dribble",
      team,
      minute,
      player,
      `${player.name} carried the ball forward`,
      {
        fromX: oldX,
        fromZ: oldZ,
        toX: player.x,
        toZ: player.z,
      }
    )
  );

  state.lastAction = {
    type: "dribble",
    team,
    minute,
    playerId: player.id,
    fromX: oldX,
    fromZ: oldZ,
    toX: player.x,
    toZ: player.z,
  };
}

function performShot(
  state,
  team,
  minute,
  shooter
) {
  const direction =
    team === "home" ? 1 : -1;

  const goalX =
    direction * 15;

  const distanceToGoal =
    Math.abs(goalX - shooter.x);

  state.stats[team].shots++;

  const accuracy = clamp(
    0.38 +
      (shooter.rating - 50) * 0.008 -
      distanceToGoal * 0.012,
    0.12,
    0.85
  );

  const onTarget =
    Math.random() < accuracy;

  const keeper =
    getGoalkeeper(
      state.players[
        team === "home"
          ? "away"
          : "home"
      ]
    );

  state.ball.ownerId = null;
  state.ball.ownerTeam = null;

  state.ball.x = shooter.x;
  state.ball.z = shooter.z;

  state.ball.targetX = goalX;
  state.ball.targetZ =
    random(-2.4, 2.4);

  if (!onTarget) {
    addEvent(
      state,
      createEvent(
        "shot",
        team,
        minute,
        shooter,
        `${shooter.name} shot wide`,
        {
          onTarget: false,
        }
      )
    );

    state.lastAction = {
      type: "shot",
      team,
      minute,
      playerId: shooter.id,
      onTarget: false,
      targetX: goalX,
      targetZ: state.ball.targetZ,
    };

    return;
  }

  state.stats[team].shotsOnTarget++;

  const goalProbability = clamp(
    0.12 +
      shooter.rating * 0.0025 -
      keeper.rating * 0.001 +
      (distanceToGoal < 10 ? 0.12 : 0),
    0.04,
    0.42
  );

  const goal =
    Math.random() < goalProbability;

  if (goal) {
    state.score[team]++;

    addEvent(
      state,
      createEvent(
        "goal",
        team,
        minute,
        shooter,
        `${shooter.name} scored!`,
        {
          onTarget: true,
        }
      )
    );

    state.lastAction = {
      type: "goal",
      team,
      minute,
      playerId: shooter.id,
      targetX: goalX,
      targetZ: state.ball.targetZ,
    };

    return;
  }

  state.stats[
    team === "home" ? "away" : "home"
  ].saves++;

  addEvent(
    state,
    createEvent(
      "save",
      team === "home" ? "away" : "home",
      minute,
      keeper,
      `${keeper.name} made a save from ${shooter.name}`,
      {
        shooterId: shooter.id,
      }
    )
  );

  state.lastAction = {
    type: "save",
    team,
    minute,
    playerId: shooter.id,
    keeperId: keeper.id,
    targetX: goalX,
    targetZ: state.ball.targetZ,
  };
}

function performTackle(
  state,
  defendingTeam,
  minute
) {
  const attackingTeam =
    defendingTeam === "home"
      ? "away"
      : "home";

  const attacker =
    state.players[attackingTeam].find(
      (p) => p.hasBall
    ) ||
    getNearestPlayer(
      state.players[attackingTeam],
      state.ball
    );

  if (!attacker) return;

  const defender =
    getNearestPlayer(
      state.players[defendingTeam],
      attacker
    );

  if (!defender) return;

  state.stats[defendingTeam].tackles++;

  const success =
    Math.random() <
    clamp(
      0.65 +
        (defender.rating - attacker.rating) *
          0.005,
      0.35,
      0.9
    );

  if (success) {
    attacker.hasBall = false;
    defender.hasBall = true;

    state.ball.ownerTeam =
      defendingTeam;

    state.ball.ownerId =
      defender.id;

    state.ball.x = defender.x;
    state.ball.z = defender.z;

    addEvent(
      state,
      createEvent(
        "tackle",
        defendingTeam,
        minute,
        defender,
        `${defender.name} won the ball from ${attacker.name}`
      )
    );

    state.lastAction = {
      type: "tackle",
      team: defendingTeam,
      minute,
      playerId: defender.id,
      opponentId: attacker.id,
    };
  } else {
    state.stats[defendingTeam].fouls++;

    addEvent(
      state,
      createEvent(
        "foul",
        defendingTeam,
        minute,
        defender,
        `${defender.name} committed a foul on ${attacker.name}`
      )
    );

    if (Math.random() < 0.18) {
      state.stats[defendingTeam].yellow++;

      addEvent(
        state,
        createEvent(
          "yellow",
          defendingTeam,
          minute,
          defender,
          `${defender.name} received a yellow card`
        )
      );
    }

    state.lastAction = {
      type: "foul",
      team: defendingTeam,
      minute,
      playerId: defender.id,
    };
  }
}

function performCorner(
  state,
  team,
  minute,
  player
) {
  state.stats[team].corners++;

  addEvent(
    state,
    createEvent(
      "corner",
      team,
      minute,
      player,
      `${player.name}'s team won a corner`
    )
  );

  state.lastAction = {
    type: "corner",
    team,
    minute,
    playerId: player.id,
  };
}

export function simulateMinute(
  previousState,
  minute
) {
  const state = {
    ...previousState,

    score: {
      ...previousState.score,
    },

    stats: {
      home: {
        ...previousState.stats.home,
      },

      away: {
        ...previousState.stats.away,
      },
    },

    players: {
      home: previousState.players.home.map(
        (p) => ({
          ...p,
          hasBall: false,
        })
      ),

      away: previousState.players.away.map(
        (p) => ({
          ...p,
          hasBall: false,
        })
      ),
    },

    ball: {
      ...previousState.ball,
    },

    events: [
      ...previousState.events,
    ],

    lastAction: null,
  };

  const team =
    choosePossessionTeam(state);

  const opponent =
    team === "home"
      ? "away"
      : "home";

  updatePossession(state, team);

  const players =
    state.players[team];

  const attackingPlayers =
    players.filter(
      (player) =>
        player.role === "ATT" ||
        player.role === "MID"
    );

  const selected =
    attackingPlayers[
      randomInt(
        0,
        Math.max(
          0,
          attackingPlayers.length - 1
        )
      )
    ] ||
    players[0];

  if (!selected) {
    return state;
  }

  selected.hasBall = true;

  state.ball.ownerTeam = team;
  state.ball.ownerId = selected.id;

  state.ball.x = selected.x;
  state.ball.z = selected.z;

  movePlayers(
    state,
    team,
    state.ball
  );

  state.stats[team].attacks++;

  const dangerous =
    Math.random() < 0.34;

  if (dangerous) {
    state.stats[team]
      .dangerousAttacks++;
  }

  const distanceToGoal =
    team === "home"
      ? 15 - selected.x
      : selected.x + 15;

  const actionRoll =
    Math.random();

  if (
    distanceToGoal < 14 &&
    actionRoll < 0.20
  ) {
    performShot(
      state,
      team,
      minute,
      selected
    );
  } else if (
    actionRoll < 0.52
  ) {
    performPass(
      state,
      team,
      minute,
      selected
    );
  } else if (
    actionRoll < 0.72
  ) {
    performDribble(
      state,
      team,
      minute,
      selected
    );
  } else if (
    actionRoll < 0.86
  ) {
    performTackle(
      state,
      opponent,
      minute
    );
  } else if (
    actionRoll < 0.91
  ) {
    performCorner(
      state,
      team,
      minute,
      selected
    );
  } else {
    performDribble(
      state,
      team,
      minute,
      selected
    );
  }

  // Guarantee one player owns the ball
  // after non-shot actions.
  if (
    state.ball.ownerId &&
    state.ball.ownerTeam
  ) {
    const owner =
      state.players[
        state.ball.ownerTeam
      ].find(
        (p) =>
          p.id === state.ball.ownerId
      );

    if (owner) {
      owner.hasBall = true;

      state.ball.x = owner.x;
      state.ball.z = owner.z;
    }
  }

  return state;
}
