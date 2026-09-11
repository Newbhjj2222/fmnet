// lib/match-engine/team.js

import {
  DEFAULT_STATS,
  DEFAULT_TACTICS,
  distance,
  clamp,
} from "./constants";

import {
  createPlayer,
  playerQuality,
} from "./player";

import {
  getFormation,
  mirrorFormationSlots,
} from "./formations";

export function normalizeTactics(tactics = {}) {
  return {
    ...DEFAULT_TACTICS,
    ...tactics,
  };
}

export function createTeam({
  side,
  club,
  players,
  lineupIds = [],
  formation = "4-4-2",
  tactics = {},
}) {
  const sourcePlayers = Array.isArray(players)
    ? players
    : [];

  const slots = getFormation(
    formation
  );

  const selected = [];

  for (const id of lineupIds) {
    const player = sourcePlayers.find(
      (p) =>
        String(p.id) === String(id) ||
        String(p.playerId) === String(id)
    );

    if (
      player &&
      !selected.some(
        (p) => String(p.id) === String(player.id)
      )
    ) {
      selected.push(player);
    }
  }

  for (const player of sourcePlayers) {
    if (selected.length >= 11) break;

    if (
      !selected.some(
        (p) =>
          String(p.id) ===
          String(player.id)
      )
    ) {
      selected.push(player);
    }
  }

  const teamPlayers = selected
    .slice(0, 11)
    .map((player, index) => {
      const slot =
        side === "home"
          ? slots[index]
          : mirrorFormationSlots(slots)[index];

      return createPlayer(
        player,
        slot,
        side,
        index
      );
    });

  const bench = sourcePlayers
    .filter(
      (player) =>
        !teamPlayers.some(
          (active) =>
            String(active.id) ===
            String(player.id)
        )
    )
    .sort(
      (a, b) =>
        Number(
          b.overall ??
          b.rating ??
          60
        ) -
        Number(
          a.overall ??
          a.rating ??
          60
        )
    )
    .slice(0, 9);

  return {
    side,

    id:
      club?.id ??
      club?.clubId ??
      null,

    name:
      club?.name ??
      club?.clubName ??
      "Team",

    logo:
      club?.logo ??
      club?.logoUrl ??
      "",

    formation,

    tactics:
      normalizeTactics(tactics),

    players: teamPlayers,

    bench,

    stats: DEFAULT_STATS(),

    substitutionsUsed: 0,

    cards: {},

    attackDirection:
      side === "home"
        ? 1
        : -1,

    score: 0,
  };
}

export function getTeamPlayer(
  team,
  playerId
) {
  return team.players.find(
    (p) =>
      String(p.id) ===
      String(playerId)
  );
}

export function getPlayerByNumber(
  team,
  number
) {
  return team.players.find(
    (p) =>
      Number(p.number) ===
      Number(number)
  );
}

export function getTeamStrength(team) {
  if (!team?.players?.length) {
    return 50;
  }

  return (
    team.players.reduce(
      (sum, player) =>
        sum + playerQuality(player),
      0
    ) /
    team.players.length
  );
}

export function nearestPlayer(
  team,
  point,
  excludeId = null
) {
  let best = null;
  let bestDistance = Infinity;

  for (const player of team.players) {
    if (
      player.redCard ||
      player.id === excludeId
    ) {
      continue;
    }

    const d = distance(
      player,
      point
    );

    if (d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }

  return best;
}

export function teamPossessionPlayers(
  team
) {
  return team.players.filter(
    (p) => p.hasBall
  );
}

export function updateTeamMinutes(
  team,
  dt
) {
  for (const player of team.players) {
    if (!player.redCard) {
      player.minutesPlayed +=
        dt / 60;
    }
  }
}
