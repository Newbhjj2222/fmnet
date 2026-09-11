// lib/match-engine/player.js

import {
  clamp,
  normalizePosition,
  PLAYER,
} from "./constants";

function numberFromPlayer(player, fallback) {
  const value =
    player?.shirtNumber ??
    player?.jerseyNumber ??
    player?.kitNumber ??
    player?.number;

  const number = Number(value);

  if (Number.isFinite(number) && number > 0) {
    return number;
  }

  return fallback;
}

function rating(player, keys, fallback = 60) {
  for (const key of keys) {
    const value = Number(player?.[key]);

    if (Number.isFinite(value)) {
      return clamp(value, 1, 99);
    }
  }

  const overall = Number(
    player?.overall ??
    player?.rating ??
    player?.ovr
  );

  if (Number.isFinite(overall)) {
    return clamp(overall, 1, 99);
  }

  return fallback;
}

export function createPlayer(
  data,
  slot,
  side,
  index
) {
  const position = normalizePosition(
    data?.position
  );

  const isGK = position === "GK";

  const xBase = slot?.x ?? 0.35;
  const yBase = slot?.y ?? 0.50;

  const x =
    side === "home"
      ? xBase
      : 1 - xBase;

  const number = numberFromPlayer(
    data,
    index + 1
  );

  const overall = rating(
    data,
    ["overall", "rating", "ovr"],
    65
  );

  const player = {
    id:
      data?.id ??
      data?.playerId ??
      `player-${side}-${index}`,

    name:
      data?.name ??
      data?.displayName ??
      data?.fullName ??
      `Player ${index + 1}`,

    shortName:
      data?.shortName ??
      data?.name ??
      `P${index + 1}`,

    number,

    position,

    role:
      slot?.role ??
      position,

    side,

    clubId:
      data?.clubId ??
      data?.teamId ??
      null,

    overall,

    x: 0,
    y: 0,

    homeX: x,
    homeY: y,

    vx: 0,
    vy: 0,

    speed: 50 +
      overall * 0.55,

    acceleration:
      130 +
      overall * 1.4,

    stamina: PLAYER.staminaMax,

    passing: rating(
      data,
      ["passing", "pass", "passingRating"],
      overall
    ),

    shooting: rating(
      data,
      ["shooting", "shot", "finishing"],
      overall
    ),

    dribbling: rating(
      data,
      ["dribbling", "dribble"],
      overall
    ),

    tackling: rating(
      data,
      ["tackling", "tackle"],
      overall
    ),

    positioning: rating(
      data,
      ["positioning", "positioningRating"],
      overall
    ),

    vision: rating(
      data,
      ["vision", "creativity"],
      overall
    ),

    decisionMaking: rating(
      data,
      ["decisionMaking", "decisions"],
      overall
    ),

    composure: rating(
      data,
      ["composure"],
      overall
    ),

    pace: rating(
      data,
      ["pace", "speed"],
      overall
    ),

    strength: rating(
      data,
      ["strength"],
      overall
    ),

    reaction: rating(
      data,
      ["reaction", "reflexes"],
      overall
    ),

    handling: rating(
      data,
      ["handling"],
      overall
    ),

    diving: rating(
      data,
      ["diving"],
      overall
    ),

    catching: rating(
      data,
      ["catching"],
      overall
    ),

    parrying: rating(
      data,
      ["parrying"],
      overall
    ),

    distribution: rating(
      data,
      ["distribution"],
      overall
    ),

    hasBall: false,

    state: "idle",

    yellowCard: false,
    redCard: false,

    goals: 0,
    assists: 0,

    shots: 0,
    shotsOnTarget: 0,

    passes: 0,
    passesCompleted: 0,

    tackles: 0,
    interceptions: 0,
    fouls: 0,

    dribbles: 0,

    minutesPlayed: 0,

    performance: overall,

    lastActionAt: 0,
  };

  player.x = player.homeX;
  player.y = player.homeY;

  return player;
}

export function playerCanPlay(player) {
  return (
    player &&
    !player.redCard &&
    player.stamina > 0
  );
}

export function playerEffectiveSpeed(player) {
  if (!player) return 0;

  const staminaFactor =
    0.55 +
    player.stamina / 220;

  return (
    player.speed *
    staminaFactor
  );
}

export function playerQuality(player) {
  if (!player) return 50;

  return (
    player.overall * 0.35 +
    player.passing * 0.1 +
    player.shooting * 0.1 +
    player.dribbling * 0.1 +
    player.tackling * 0.1 +
    player.positioning * 0.1 +
    player.decisionMaking * 0.1 +
    player.composure * 0.05
  );
}
