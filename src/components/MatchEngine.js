// components/MatchEngine.js

export const MATCH_MINUTES = 90;

export const DEFAULT_FORMATION = '4-4-2';

export const FORMATIONS = {
  '4-4-2': [
    { role: 'GK', x: 8, y: 50 },

    { role: 'DEF', x: 25, y: 20 },
    { role: 'DEF', x: 25, y: 40 },
    { role: 'DEF', x: 25, y: 60 },
    { role: 'DEF', x: 25, y: 80 },

    { role: 'MID', x: 45, y: 20 },
    { role: 'MID', x: 45, y: 42 },
    { role: 'MID', x: 45, y: 58 },
    { role: 'MID', x: 45, y: 80 },

    { role: 'ATT', x: 67, y: 38 },
    { role: 'ATT', x: 67, y: 62 },
  ],

  '4-3-3': [
    { role: 'GK', x: 8, y: 50 },

    { role: 'DEF', x: 25, y: 20 },
    { role: 'DEF', x: 25, y: 40 },
    { role: 'DEF', x: 25, y: 60 },
    { role: 'DEF', x: 25, y: 80 },

    { role: 'MID', x: 45, y: 25 },
    { role: 'MID', x: 45, y: 50 },
    { role: 'MID', x: 45, y: 75 },

    { role: 'ATT', x: 68, y: 20 },
    { role: 'ATT', x: 68, y: 50 },
    { role: 'ATT', x: 68, y: 80 },
  ],

  '3-5-2': [
    { role: 'GK', x: 8, y: 50 },

    { role: 'DEF', x: 25, y: 30 },
    { role: 'DEF', x: 25, y: 50 },
    { role: 'DEF', x: 25, y: 70 },

    { role: 'MID', x: 45, y: 15 },
    { role: 'MID', x: 45, y: 32 },
    { role: 'MID', x: 45, y: 50 },
    { role: 'MID', x: 45, y: 68 },
    { role: 'MID', x: 45, y: 85 },

    { role: 'ATT', x: 68, y: 38 },
    { role: 'ATT', x: 68, y: 62 },
  ],
};

export function normalizePosition(player) {
  const position = String(
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    ''
  ).toLowerCase();

  if (
    position.includes('goal') ||
    position === 'gk'
  ) {
    return 'GK';
  }

  if (
    position.includes('def') ||
    position === 'cb' ||
    position === 'lb' ||
    position === 'rb'
  ) {
    return 'DEF';
  }

  if (
    position.includes('mid') ||
    position === 'cm' ||
    position === 'dm' ||
    position === 'am'
  ) {
    return 'MID';
  }

  if (
    position.includes('att') ||
    position.includes('forward') ||
    position.includes('striker') ||
    position === 'st' ||
    position === 'cf' ||
    position === 'lw' ||
    position === 'rw'
  ) {
    return 'ATT';
  }

  return 'MID';
}

export function getPlayerId(player) {
  return String(
    player?.id ||
    player?.playerId ||
    player?.uid ||
    ''
  );
}

export function getPlayerName(player) {
  if (player?.name) return player.name;
  if (player?.fullName) return player.fullName;

  const first = player?.firstName || '';
  const last = player?.lastName || '';

  const name = `${first} ${last}`.trim();

  return name || 'Unknown Player';
}

export function getOverall(player) {
  const value = Number(
    player?.overall ??
    player?.rating ??
    player?.ovr ??
    60
  );

  if (!Number.isFinite(value)) return 60;

  return Math.max(
    35,
    Math.min(99, value)
  );
}

export function createStats() {
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

    saves: 0,

    yellowCards: 0,
    redCards: 0,

    attacks: 0,
    dangerousAttacks: 0,

    dribbles: 0,
  };
}

export function cloneStats(stats) {
  return {
    ...createStats(),
    ...(stats || {}),
  };
}

export function calculateTeamStrength(players) {
  if (!players?.length) return 60;

  const total = players.reduce(
    (sum, player) => sum + getOverall(player),
    0
  );

  return total / players.length;
}

/*
 * AI chooses starting XI.
 *
 * Priority:
 * 1. one GK
 * 2. defenders
 * 3. midfielders
 * 4. attackers
 * 5. highest overall
 */
export function selectAIStartingXI(
  squad,
  formation = DEFAULT_FORMATION
) {
  if (!Array.isArray(squad)) {
    return [];
  }

  if (squad.length <= 11) {
    return [...squad];
  }

  const positions =
    FORMATIONS[formation] ||
    FORMATIONS[DEFAULT_FORMATION];

  const selected = [];

  const used = new Set();

  for (const slot of positions) {
    const candidates = squad
      .filter(player => {
        const id = getPlayerId(player);

        if (!id || used.has(id)) {
          return false;
        }

        return (
          normalizePosition(player) ===
          slot.role
        );
      })
      .sort(
        (a, b) =>
          getOverall(b) -
          getOverall(a)
      );

    if (candidates.length > 0) {
      const player = candidates[0];

      used.add(
        getPlayerId(player)
      );

      selected.push(player);
    }
  }

  /*
   * If exact positional selection could not
   * produce 11 players, fill remaining slots
   * with highest rated unused players.
   */

  if (selected.length < 11) {
    const remaining = squad
      .filter(
        player =>
          !used.has(
            getPlayerId(player)
          )
      )
      .sort(
        (a, b) =>
          getOverall(b) -
          getOverall(a)
      );

    for (
      const player of remaining
    ) {
      if (selected.length >= 11) break;

      selected.push(player);
    }
  }

  return selected.slice(0, 11);
}

/*
 * Generate a realistic action for one simulation tick.
 */
export function simulateMatchTick({
  homeXI,
  awayXI,
  homeStats,
  awayStats,
  homeScore,
  awayScore,
  minute,
}) {
  const homeStrength =
    calculateTeamStrength(homeXI);

  const awayStrength =
    calculateTeamStrength(awayXI);

  const strengthDifference =
    homeStrength - awayStrength;

  /*
   * Possession changes gradually.
   */
  const homePossession = Math.max(
    35,
    Math.min(
      65,
      50 +
        strengthDifference * 0.18 +
        (Math.random() - 0.5) * 6
    )
  );

  homeStats.possession =
    Number(homePossession.toFixed(1));

  awayStats.possession =
    Number(
      (100 - homePossession).toFixed(1)
    );

  const homeAttack =
    homePossession / 100;

  const attackingHome =
    Math.random() < homeAttack;

  const team =
    attackingHome ? 'home' : 'away';

  const players =
    team === 'home'
      ? homeXI
      : awayXI;

  const ownStats =
    team === 'home'
      ? homeStats
      : awayStats;

  const opponentStats =
    team === 'home'
      ? awayStats
      : homeStats;

  if (!players?.length) {
    return {
      homeScore,
      awayScore,
      event: null,
      action: null,
      ballTeam: team,
      player: null,
    };
  }

  const player =
    players[
      Math.floor(
        Math.random() *
        players.length
      )
    ];

  /*
   * PASS
   */
  if (Math.random() < 0.52) {
    ownStats.passes += 1;

    const passQuality =
      0.72 +
      getOverall(player) / 100 * 0.23;

    if (Math.random() < passQuality) {
      ownStats.passesCompleted += 1;
    }

    return {
      homeScore,
      awayScore,
      event: null,
      action: 'pass',
      ballTeam: team,
      player,
    };
  }

  /*
   * DRIBBLE
   */
  if (Math.random() < 0.18) {
    ownStats.dribbles += 1;

    return {
      homeScore,
      awayScore,
      event: null,
      action: 'dribble',
      ballTeam: team,
      player,
    };
  }

  /*
   * TACKLE / INTERCEPTION
   */
  if (Math.random() < 0.14) {
    ownStats.tackles += 1;

    if (Math.random() < 0.35) {
      ownStats.interceptions += 1;
    }

    return {
      homeScore,
      awayScore,
      event: null,
      action: 'tackle',
      ballTeam: team,
      player,
    };
  }

  /*
   * ATTACK
   */
  ownStats.attacks += 1;

  if (Math.random() < 0.48) {
    ownStats.dangerousAttacks += 1;
  }

  /*
   * SHOT
   */
  if (Math.random() < 0.23) {
    ownStats.shots += 1;

    const accuracy =
      0.35 +
      getOverall(player) / 250;

    if (Math.random() < accuracy) {
      ownStats.shotsOnTarget += 1;

      const scoringChance =
        0.08 +
        (
          getOverall(player) /
          99
        ) * 0.16;

      if (
        Math.random() <
        scoringChance
      ) {
        if (team === 'home') {
          homeScore += 1;
        } else {
          awayScore += 1;
        }

        const event = {
          id:
            `goal-${Date.now()}-${Math.random()}`,
          type: 'goal',
          team,
          minute,
          playerId:
            getPlayerId(player),
          playerName:
            getPlayerName(player),
          detail:
            `${getPlayerName(player)} scored!`,
        };

        return {
          homeScore,
          awayScore,
          event,
          action: 'goal',
          ballTeam: team,
          player,
        };
      }

      opponentStats.saves += 1;

      return {
        homeScore,
        awayScore,
        event: {
          id:
            `shot-${Date.now()}-${Math.random()}`,
          type: 'save',
          team,
          minute,
          playerId:
            getPlayerId(player),
          playerName:
            getPlayerName(player),
          detail:
            `Great save after a shot from ${getPlayerName(player)}.`,
        },
        action: 'shot',
        ballTeam: team,
        player,
      };
    }
  }

  /*
   * FOUL
   */
  if (Math.random() < 0.025) {
    ownStats.fouls += 1;

    return {
      homeScore,
      awayScore,
      event: null,
      action: 'foul',
      ballTeam: team,
      player,
    };
  }

  /*
   * CORNER
   */
  if (Math.random() < 0.018) {
    ownStats.corners += 1;

    return {
      homeScore,
      awayScore,
      event: null,
      action: 'corner',
      ballTeam: team,
      player,
    };
  }

  return {
    homeScore,
    awayScore,
    event: null,
    action: 'attack',
    ballTeam: team,
    player,
  };
}
