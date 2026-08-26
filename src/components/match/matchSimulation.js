// components/match/matchSimulation.js

// ============================================================
// REALISTIC FOOTBALL MATCH SIMULATION ENGINE
// ============================================================

export const PITCH = {
  minX: -14.2,
  maxX: 14.2,
  minZ: -9.2,
  maxZ: 9.2,
};

// ============================================================
// HELPERS
// ============================================================

export function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

export function random(min, max) {
  return (
    Math.random() *
      (max - min) +
    min
  );
}

export function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    `${player?.firstName || ""} ${
      player?.lastName || ""
    }`.trim() ||
    "Player"
  );
}

export function getPlayerId(
  player,
  index
) {
  return (
    player?.id ||
    player?.playerId ||
    player?.uid ||
    `${getPlayerName(
      player
    )}-${index}`
  );
}

export function getOverall(player) {
  const value = Number(
    player?.overall ||
      player?.rating ||
      player?.ovr ||
      60
  );

  if (!Number.isFinite(value)) {
    return 60;
  }

  return clamp(
    value,
    35,
    99
  );
}

export function getPosition(
  player
) {
  const value = String(
    player?.position ||
      player?.primaryPosition ||
      player?.role ||
      ""
  ).toLowerCase();

  if (
    value.includes("goal") ||
    value === "gk"
  ) {
    return "GK";
  }

  if (
    value.includes("def")
  ) {
    return "DEF";
  }

  if (
    value.includes("mid")
  ) {
    return "MID";
  }

  if (
    value.includes("attack") ||
    value.includes("forward") ||
    value.includes("striker") ||
    value === "st"
  ) {
    return "ATT";
  }

  return "MID";
}

// ============================================================
// FORMATIONS
// ============================================================

export const FORMATIONS = {
  "4-4-2": [
    { x: -13, z: 0, role: "GK" },

    { x: -9, z: -7, role: "DEF" },
    { x: -9, z: -2.4, role: "DEF" },
    { x: -9, z: 2.4, role: "DEF" },
    { x: -9, z: 7, role: "DEF" },

    { x: -3.5, z: -7, role: "MID" },
    { x: -3.5, z: -2.3, role: "MID" },
    { x: -3.5, z: 2.3, role: "MID" },
    { x: -3.5, z: 7, role: "MID" },

    { x: 4.5, z: -3.2, role: "ATT" },
    { x: 4.5, z: 3.2, role: "ATT" },
  ],

  "4-3-3": [
    { x: -13, z: 0, role: "GK" },

    { x: -9, z: -7, role: "DEF" },
    { x: -9, z: -2.4, role: "DEF" },
    { x: -9, z: 2.4, role: "DEF" },
    { x: -9, z: 7, role: "DEF" },

    { x: -3, z: -5.5, role: "MID" },
    { x: -3, z: 0, role: "MID" },
    { x: -3, z: 5.5, role: "MID" },

    { x: 5, z: -6.5, role: "ATT" },
    { x: 6, z: 0, role: "ATT" },
    { x: 5, z: 6.5, role: "ATT" },
  ],

  "3-5-2": [
    { x: -13, z: 0, role: "GK" },

    { x: -9, z: -5.5, role: "DEF" },
    { x: -9, z: 0, role: "DEF" },
    { x: -9, z: 5.5, role: "DEF" },

    { x: -3, z: -8, role: "MID" },
    { x: -3, z: -4, role: "MID" },
    { x: -3, z: 0, role: "MID" },
    { x: -3, z: 4, role: "MID" },
    { x: -3, z: 8, role: "MID" },

    { x: 5, z: -3.2, role: "ATT" },
    { x: 5, z: 3.2, role: "ATT" },
  ],

  "5-3-2": [
    { x: -13, z: 0, role: "GK" },

    { x: -9, z: -8, role: "DEF" },
    { x: -9, z: -4, role: "DEF" },
    { x: -9, z: 0, role: "DEF" },
    { x: -9, z: 4, role: "DEF" },
    { x: -9, z: 8, role: "DEF" },

    { x: -3, z: -5, role: "MID" },
    { x: -3, z: 0, role: "MID" },
    { x: -3, z: 5, role: "MID" },

    { x: 5, z: -3, role: "ATT" },
    { x: 5, z: 3, role: "ATT" },
  ],

  "4-2-3-1": [
    { x: -13, z: 0, role: "GK" },

    { x: -9, z: -7, role: "DEF" },
    { x: -9, z: -2.4, role: "DEF" },
    { x: -9, z: 2.4, role: "DEF" },
    { x: -9, z: 7, role: "DEF" },

    { x: -3.5, z: -3, role: "MID" },
    { x: -3.5, z: 3, role: "MID" },

    { x: 1, z: -6, role: "MID" },
    { x: 2, z: 0, role: "MID" },
    { x: 1, z: 6, role: "MID" },

    { x: 5.5, z: 0, role: "ATT" },
  ],
};

// ============================================================
// CHOOSE STARTING XI
// ============================================================

export function selectStartingXI(
  players,
  formation = "4-4-2"
) {
  if (
    !Array.isArray(players) ||
    players.length === 0
  ) {
    return [];
  }

  const slots =
    FORMATIONS[formation] ||
    FORMATIONS["4-4-2"];

  const used = new Set();
  const selected = [];

  function chooseForRole(role) {
    let candidates =
      players.filter(
        (player, index) => {
          const id =
            getPlayerId(
              player,
              index
            );

          if (used.has(id)) {
            return false;
          }

          return (
            getPosition(player) ===
            role
          );
        }
      );

    if (candidates.length === 0) {
      candidates =
        players.filter(
          (player, index) =>
            !used.has(
              getPlayerId(
                player,
                index
              )
            )
        );
    }

    candidates.sort(
      (a, b) =>
        getOverall(b) -
        getOverall(a)
    );

    return candidates[0];
  }

  slots.forEach(
    slot => {
      const player =
        chooseForRole(
          slot.role
        );

      if (!player) return;

      const index =
        players.indexOf(
          player
        );

      const id =
        getPlayerId(
          player,
          index
        );

      used.add(id);

      selected.push({
        ...player,
        id,
      });
    }
  );

  return selected.slice(
    0,
    11
  );
}

// ============================================================
// TEAM STRENGTH
// ============================================================

export function calculateTeamStrength(
  players
) {
  if (
    !Array.isArray(players) ||
    players.length === 0
  ) {
    return 60;
  }

  const total =
    players.reduce(
      (sum, player) =>
        sum +
        getOverall(player),
      0
    );

  return (
    total / players.length
  );
}

// ============================================================
// INITIAL PLAYER STATE
// ============================================================

export function createTeamState(
  players,
  team,
  formation
) {
  const slots =
    FORMATIONS[formation] ||
    FORMATIONS["4-4-2"];

  return players
    .slice(0, 11)
    .map(
      (player, index) => {
        const slot =
          slots[index] ||
          slots[0];

        let x = slot.x;
        let z = slot.z;

        if (team === "away") {
          x = -x;
          z = -z;
        }

        const id =
          getPlayerId(
            player,
            index
          );

        return {
          id,

          name:
            getPlayerName(
              player
            ),

          team,

          role:
            slot.role,

          x,
          z,

          baseX: x,
          baseZ: z,

          targetX: x,
          targetZ: z,

          speed: random(
            2.8,
            4.3
          ),

          stamina: 100,

          overall:
            getOverall(
              player
            ),
        };
      }
    );
}

// ============================================================
// INITIAL MATCH STATE
// ============================================================

export function createMatchSimulation(
  homeXI,
  awayXI,
  formation = "4-4-2"
) {
  const home =
    createTeamState(
      homeXI,
      "home",
      formation
    );

  const away =
    createTeamState(
      awayXI,
      "away",
      formation
    );

  const firstHome =
    home.find(
      player =>
        player.role ===
        "MID"
    ) ||
    home[0];

  return {
    home,
    away,

    possession: {
      team: "home",
      playerId:
        firstHome?.id ||
        home[0]?.id ||
        null,
    },

    ball: {
      mode: "owner",

      team: "home",

      ownerId:
        firstHome?.id ||
        home[0]?.id ||
        null,

      from: {
        x:
          firstHome?.x ||
          0,

        z:
          firstHome?.z ||
          0,
      },

      to: {
        x:
          firstHome?.x ||
          0,

        z:
          firstHome?.z ||
          0,
      },

      startedAt:
        Date.now(),

      duration: 500,
    },

    lastAction: null,
  };
}

// ============================================================
// GET PLAYER
// ============================================================

function findPlayer(
  state,
  team,
  id
) {
  return state[team].find(
    player =>
      player.id === id
  );
}

// ============================================================
// PICK PASS RECEIVER
// ============================================================

function chooseReceiver(
  state,
  team,
  passer
) {
  const players =
    state[team];

  const candidates =
    players.filter(
      player =>
        player.id !==
          passer.id &&
        player.role !== "GK"
    );

  if (
    candidates.length ===
    0
  ) {
    return passer;
  }

  // Prefer players who are
  // reasonably close
  // and ahead of the passer.
  const scored =
    candidates.map(
      player => {
        const distance =
          Math.sqrt(
            Math.pow(
              player.x -
                passer.x,
              2
            ) +
              Math.pow(
                player.z -
                  passer.z,
                2
              )
          );

        const forward =
          team === "home"
            ? player.x -
              passer.x
            : passer.x -
              player.x;

        const score =
          100 -
          distance * 4 +
          forward * 2 +
          random(
            -15,
            15
          );

        return {
          player,
          score,
        };
      }
    );

  scored.sort(
    (a, b) =>
      b.score -
      a.score
  );

  return scored[0].player;
}

// ============================================================
// MOVE TEAM AROUND BALL
// ============================================================

function updateTacticalMovement(
  state
) {
  const ballX =
    state.ball.to?.x ??
    state.ball.from?.x ??
    0;

  const ballZ =
    state.ball.to?.z ??
    state.ball.from?.z ??
    0;

  ["home", "away"].forEach(
    team => {
      state[team].forEach(
        player => {
          const attacking =
            team === "home"
              ? 1
              : -1;

          const distanceToBall =
            Math.sqrt(
              Math.pow(
                player.x -
                  ballX,
                2
              ) +
                Math.pow(
                  player.z -
                    ballZ,
                  2
                )
            );

          let targetX =
            player.baseX;

          let targetZ =
            player.baseZ;

          // Team shifts toward ball
          targetZ +=
            clamp(
              (ballZ -
                player.baseZ) *
                0.18,
              -2.2,
              2.2
            );

          // Team in possession pushes forward
          if (
            state.possession.team ===
            team
          ) {
            targetX +=
              attacking *
              (
                player.role ===
                "ATT"
                  ? 1.8
                  : player.role ===
                    "MID"
                  ? 0.8
                  : 0.25
              );
          } else {
            // Defending team drops
            targetX -=
              attacking *
              (
                player.role ===
                "ATT"
                  ? 0.6
                  : player.role ===
                    "MID"
                  ? 0.3
                  : -0.3
              );
          }

          // Nearest players press the ball
          if (
            distanceToBall <
            7
          ) {
            const press =
              clamp(
                (7 -
                  distanceToBall) /
                  7,
                0,
                1
              );

            targetX +=
              (ballX -
                targetX) *
              press *
              0.3;

            targetZ +=
              (ballZ -
                targetZ) *
              press *
              0.3;
          }

          // Slight natural movement
          targetX += random(
            -0.35,
            0.35
          );

          targetZ += random(
            -0.35,
            0.35
          );

          player.targetX =
            clamp(
              targetX,
              PITCH.minX,
              PITCH.maxX
            );

          player.targetZ =
            clamp(
              targetZ,
              PITCH.minZ,
              PITCH.maxZ
            );
        }
      );
    }
  );
}

// ============================================================
// PASS
// ============================================================

function performPass(
  state,
  team,
  passer
) {
  const receiver =
    chooseReceiver(
      state,
      team,
      passer
    );

  if (!receiver) {
    return {
      type: "pass",
      team,
      player: passer,
      receiver: null,
    };
  }

  // Move receiver into space
  receiver.targetX =
    clamp(
      receiver.x +
        random(
          -1.5,
          2.5
        ),
      PITCH.minX,
      PITCH.maxX
    );

  receiver.targetZ =
    clamp(
      receiver.z +
        random(
          -1.8,
          1.8
        ),
      PITCH.minZ,
      PITCH.maxZ
    );

  state.possession = {
    team,
    playerId:
      receiver.id,
  };

  state.ball = {
    mode: "pass",

    team,

    ownerId:
      receiver.id,

    from: {
      x: passer.x,
      z: passer.z,
    },

    to: {
      x: receiver.x,
      z: receiver.z,
    },

    startedAt:
      Date.now(),

    duration: random(
      450,
      850
    ),
  };

  return {
    type: "pass",
    team,
    player: passer,
    receiver,
  };
}

// ============================================================
// DRIBBLE
// ============================================================

function performDribble(
  state,
  team,
  player
) {
  const direction =
    team === "home"
      ? 1
      : -1;

  const oldX =
    player.x;

  const oldZ =
    player.z;

  const newX =
    clamp(
      oldX +
        direction *
          random(
            0.8,
            2.5
          ),
      PITCH.minX,
      PITCH.maxX
    );

  const newZ =
    clamp(
      oldZ +
        random(
          -1.3,
          1.3
        ),
      PITCH.minZ,
      PITCH.maxZ
    );

  player.targetX =
    newX;

  player.targetZ =
    newZ;

  state.ball = {
    mode: "owner",

    team,

    ownerId:
      player.id,

    from: {
      x: player.x,
      z: player.z,
    },

    to: {
      x: newX,
      z: newZ,
    },

    startedAt:
      Date.now(),

    duration: 500,
  };

  return {
    type: "dribble",
    team,
    player,
  };
}

// ============================================================
// SHOT
// ============================================================

function performShot(
  state,
  team,
  player,
  attackingStrength,
  defendingStrength
) {
  const goalX =
    team === "home"
      ? 14.5
      : -14.5;

  const goalZ =
    random(
      -2.4,
      2.4
    );

  state.ball = {
    mode: "shot",

    team,

    ownerId:
      null,

    from: {
      x: player.x,
      z: player.z,
    },

    to: {
      x: goalX,
      z: goalZ,
    },

    startedAt:
      Date.now(),

    duration: random(
      550,
      900
    ),
  };

  const quality =
    getOverall(
      player
    ) / 100;

  const attack =
    attackingStrength /
    100;

  const defence =
    defendingStrength /
    100;

  const probability =
    clamp(
      0.12 +
        quality *
          0.25 +
        attack *
          0.15 -
        defence *
          0.08,
      0.03,
      0.42
    );

  const goal =
    Math.random() <
    probability;

  return {
    type: goal
      ? "goal"
      : "shot",
    team,
    player,
    goal,
  };
}

// ============================================================
// MAIN ACTION
// ============================================================

export function simulateAction(
  state,
  homeStrength,
  awayStrength
) {
  const team =
    state.possession.team;

  const players =
    state[team];

  if (
    !players ||
    players.length === 0
  ) {
    return null;
  }

  const player =
    findPlayer(
      state,
      team,
      state.possession.playerId
    ) ||
    players[
      Math.floor(
        Math.random() *
          players.length
      )
    ];

  if (!player) {
    return null;
  }

  const attackingStrength =
    team === "home"
      ? homeStrength
      : awayStrength;

  const defendingStrength =
    team === "home"
      ? awayStrength
      : homeStrength;

  const roll =
    Math.random();

  let result;

  // Better players keep possession
  const passChance =
    0.48 +
    (player.overall - 60) *
      0.003;

  const dribbleChance =
    0.23;

  const shotChance =
    0.12 +
    (attackingStrength -
      60) *
      0.002;

  if (
    roll <
    passChance
  ) {
    result =
      performPass(
        state,
        team,
        player
      );
  } else if (
    roll <
    passChance +
      dribbleChance
  ) {
    result =
      performDribble(
        state,
        team,
        player
      );
  } else if (
    roll <
    passChance +
      dribbleChance +
      shotChance
  ) {
    result =
      performShot(
        state,
        team,
        player,
        attackingStrength,
        defendingStrength
      );
  } else {
    result =
      performDribble(
        state,
        team,
        player
      );
  }

  updateTacticalMovement(
    state
  );

  state.lastAction =
    result;

  return result;
}

// ============================================================
// APPLY PLAYER MOVEMENT
// ============================================================

export function advancePlayers(
  state,
  deltaSeconds
) {
  ["home", "away"].forEach(
    team => {
      state[team].forEach(
        player => {
          const dx =
            player.targetX -
            player.x;

          const dz =
            player.targetZ -
            player.z;

          const distance =
            Math.sqrt(
              dx * dx +
                dz * dz
            );

          if (
            distance <=
            0.01
          ) {
            return;
          }

          const speed =
            player.speed *
            deltaSeconds;

          const ratio =
            Math.min(
              speed / distance,
              1
            );

          player.x +=
            dx * ratio;

          player.z +=
            dz * ratio;
        }
      );
    }
  );
}

// ============================================================
// SERIALIZE FOR THREE.JS
// ============================================================

export function getVisualState(
  state
) {
  return {
    players: {
      home:
        state.home.map(
          player => ({
            id: player.id,
            x: player.x,
            z: player.z,
            speed: player.speed,
          })
        ),

      away:
        state.away.map(
          player => ({
            id: player.id,
            x: player.x,
            z: player.z,
            speed: player.speed,
          })
        ),
    },

    ball: {
      ...state.ball,
    },

    possession:
      state.possession,
  };
}
