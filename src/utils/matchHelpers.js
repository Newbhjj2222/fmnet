// src/utils/matchHelpers.js

import { PLAYERS_ON_PITCH } from './matchConstants';

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pick(array) {
  if (!Array.isArray(array) || !array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function getPlayerName(player) {
  return player?.name || player?.fullName || 
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() || 
    'Unknown Player';
}

export function getPlayerPosition(player) {
  return player?.position || player?.primaryPosition || player?.role || 'MID';
}

export function getPlayerOverall(player) {
  return clamp(
    safeNumber(
      player?.overall ?? player?.rating ?? player?.ovr ?? 60,
      60
    ),
    35,
    99
  );
}

export function playerId(player) {
  return player?.id || player?.playerId || player?.uid || null;
}

export function getClubName(club, fallback = 'Unknown Club') {
  return club?.shortName || club?.name || club?.clubName || club?.title || fallback;
}

export function getClubLogo(club) {
  return club?.logo || club?.logoUrl || club?.image || club?.badge || null;
}

export function getClubPrimaryColor(club) {
  return club?.primaryColor || club?.colors?.primary || '#2563eb';
}

export function normalizePosition(position) {
  const value = String(position || '').trim().toLowerCase();

  if (value.includes('goal') || value === 'gk' || value === 'keeper') {
    return 'GK';
  }
  if (value.includes('def') || value === 'cb' || value === 'lb' || value === 'rb') {
    return 'DEF';
  }
  if (value.includes('mid') || value === 'cm' || value === 'dm' || value === 'am') {
    return 'MID';
  }
  if (value.includes('attack') || value.includes('forward') || value.includes('striker')) {
    return 'ATT';
  }
  return 'MID';
}

export function calculateTeamStrength(players) {
  if (!Array.isArray(players) || players.length === 0) return 60;

  const weights = {
    GK: 0.95,
    DEF: 1.00,
    MID: 1.05,
    ATT: 1.10,
  };

  let total = 0;
  let weightSum = 0;

  players.forEach(player => {
    const pos = normalizePosition(getPlayerPosition(player));
    const weight = weights[pos] || 1.0;
    total += getPlayerOverall(player) * weight;
    weightSum += weight;
  });

  return clamp(weightSum > 0 ? total / weightSum : 60, 35, 99);
}

export function getGroupPlayers(players, group) {
  return (Array.isArray(players) ? players : []).filter(
    player => normalizePosition(getPlayerPosition(player)) === group
  );
}

export function calculateGroupStrength(players, group, fallback = 60) {
  const groupPlayers = getGroupPlayers(players, group);
  if (!groupPlayers.length) return fallback;

  const total = groupPlayers.reduce(
    (sum, player) => sum + getPlayerOverall(player),
    0
  );
  return total / groupPlayers.length;
}

export function getBestPlayer(players, preferredGroups = []) {
  const list = Array.isArray(players) ? players : [];
  if (!list.length) return null;

  if (preferredGroups.length) {
    const preferred = list.filter(player =>
      preferredGroups.includes(normalizePosition(getPlayerPosition(player)))
    );
    if (preferred.length) {
      return [...preferred].sort(
        (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
      )[0];
    }
  }

  return [...list].sort(
    (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
  )[0];
}

export function formatPossession(value) {
  return `${Number(value).toFixed(2)}%`;
}
