// lib/football.js

export const FORMATIONS = {
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

export function safeNumber(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getPlayerName(player) {
  if (!player) return "Unknown Player";

  return (
    player.name ||
    player.fullName ||
    `${player.firstName || ""} ${player.lastName || ""}`.trim() ||
    "Unknown Player"
  );
}

export function getPlayerId(player) {
  return player?.id || player?.playerId || null;
}

export function getPlayerOverall(player) {
  return clamp(
    safeNumber(
      player?.overall ??
      player?.rating ??
      player?.overallRating ??
      player?.ovr ??
      60
    ),
    35,
    99
  );
}

export function normalizePosition(position) {
  const value = String(position || "")
    .trim()
    .toLowerCase();

  if (
    value.includes("goal") ||
    value === "gk" ||
    value === "keeper"
  ) {
    return "GK";
  }

  if (
    value.includes("def") ||
    value.includes("back") ||
    value.includes("cb") ||
    value.includes("lb") ||
    value.includes("rb")
  ) {
    return "DEF";
  }

  if (
    value.includes("mid") ||
    value.includes("cm") ||
    value.includes("dm") ||
    value.includes("am")
  ) {
    return "MID";
  }

  if (
    value.includes("attack") ||
    value.includes("forward") ||
    value.includes("striker") ||
    value.includes("wing")
  ) {
    return "ATT";
  }

  return "MID";
}

export function getPlayerRole(player) {
  return normalizePosition(
    player?.position ||
    player?.primaryPosition ||
    player?.role
  );
}

export function getFormationPositions(formation = "4-4-2") {
  const formations = {
    "4-4-2": [
      { role: "GK", x: 8, z: 50 },

      { role: "DEF", x: 24, z: 15 },
      { role: "DEF", x: 24, z: 38 },
      { role: "DEF", x: 24, z: 62 },
      { role: "DEF", x: 24, z: 85 },

      { role: "MID", x: 45, z: 15 },
      { role: "MID", x: 45, z: 38 },
      { role: "MID", x: 45, z: 62 },
      { role: "MID", x: 45, z: 85 },

      { role: "ATT", x: 67, z: 36 },
      { role: "ATT", x: 67, z: 64 },
    ],

    "4-3-3": [
      { role: "GK", x: 8, z: 50 },

      { role: "DEF", x: 24, z: 15 },
      { role: "DEF", x: 24, z: 38 },
      { role: "DEF", x: 24, z: 62 },
      { role: "DEF", x: 24, z: 85 },

      { role: "MID", x: 44, z: 25 },
      { role: "MID", x: 44, z: 50 },
      { role: "MID", x: 44, z: 75 },

      { role: "ATT", x: 68, z: 15 },
      { role: "ATT", x: 70, z: 50 },
      { role: "ATT", x: 68, z: 85 },
    ],

    "3-5-2": [
      { role: "GK", x: 8, z: 50 },

      { role: "DEF", x: 25, z: 25 },
      { role: "DEF", x: 25, z: 50 },
      { role: "DEF", x: 25, z: 75 },

      { role: "MID", x: 43, z: 10 },
      { role: "MID", x: 43, z: 30 },
      { role: "MID", x: 43, z: 50 },
      { role: "MID", x: 43, z: 70 },
      { role: "MID", x: 43, z: 90 },

      { role: "ATT", x: 68, z: 38 },
      { role: "ATT", x: 68, z: 62 },
    ],

    "5-3-2": [
      { role: "GK", x: 8, z: 50 },

      { role: "DEF", x: 22, z: 10 },
      { role: "DEF", x: 22, z: 30 },
      { role: "DEF", x: 22, z: 50 },
      { role: "DEF", x: 22, z: 70 },
      { role: "DEF", x: 22, z: 90 },

      { role: "MID", x: 45, z: 25 },
      { role: "MID", x: 45, z: 50 },
      { role: "MID", x: 45, z: 75 },

      { role: "ATT", x: 68, z: 38 },
      { role: "ATT", x: 68, z: 62 },
    ],

    "4-2-3-1": [
      { role: "GK", x: 8, z: 50 },

      { role: "DEF", x: 24, z: 15 },
      { role: "DEF", x: 24, z: 38 },
      { role: "DEF", x: 24, z: 62 },
      { role: "DEF", x: 24, z: 85 },

      { role: "MID", x: 42, z: 35 },
      { role: "MID", x: 42, z: 65 },

      { role: "MID", x: 62, z: 20 },
      { role: "MID", x: 64, z: 50 },
      { role: "MID", x: 62, z: 80 },

      { role: "ATT", x: 78, z: 50 },
    ],
  };

  return formations[formation] || formations["4-4-2"];
}

export function selectAIStartingXI(
  squad = [],
  formation = "4-4-2"
) {
  if (!Array.isArray(squad)) return [];

  const requirements = FORMATIONS[formation] || FORMATIONS["4-4-2"];

  const sorted = [...squad].sort(
    (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
  );

  const selected = [];
  const used = new Set();

  const pickRole = (role, amount) => {
    const candidates = sorted
      .filter(
        (player) =>
          getPlayerRole(player) === role &&
          !used.has(getPlayerId(player))
      )
      .slice(0, amount);

    for (const player of candidates) {
      selected.push(player);
      used.add(getPlayerId(player));
    }
  };

  pickRole("GK", requirements.GK);
  pickRole("DEF", requirements.DEF);
  pickRole("MID", requirements.MID);
  pickRole("ATT", requirements.ATT);

  // Fallback if the squad lacks a certain position.
  for (const player of sorted) {
    if (selected.length >= 11) break;

    const id = getPlayerId(player);

    if (!used.has(id)) {
      selected.push(player);
      used.add(id);
    }
  }

  return selected.slice(0, 11);
}

export function validateStartingXI(
  lineup = [],
  formation = "4-4-2"
) {
  if (!Array.isArray(lineup)) {
    return {
      valid: false,
      message: "Starting XI is invalid.",
    };
  }

  if (lineup.length !== 11) {
    return {
      valid: false,
      message: `You must select exactly 11 players. Currently: ${lineup.length}.`,
    };
  }

  const requirements =
    FORMATIONS[formation] || FORMATIONS["4-4-2"];

  const counts = {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  };

  for (const player of lineup) {
    counts[getPlayerRole(player)]++;
  }

  if (counts.GK !== requirements.GK) {
    return {
      valid: false,
      message: `Formation requires ${requirements.GK} goalkeeper.`,
    };
  }

  if (counts.DEF !== requirements.DEF) {
    return {
      valid: false,
      message: `Formation requires ${requirements.DEF} defenders.`,
    };
  }

  if (counts.MID !== requirements.MID) {
    return {
      valid: false,
      message: `Formation requires ${requirements.MID} midfielders.`,
    };
  }

  if (counts.ATT !== requirements.ATT) {
    return {
      valid: false,
      message: `Formation requires ${requirements.ATT} attackers.`,
    };
  }

  return {
    valid: true,
    message: "Starting XI is ready.",
  };
}
