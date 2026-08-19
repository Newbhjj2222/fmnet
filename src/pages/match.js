// src/pages/match.js

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './match.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MATCH_DURATION = 90;
const FIRST_HALF_END = 45;

const INJURY_TIME_MIN = 1;
const INJURY_TIME_MAX = 5;

const MAX_SQUAD_SIZE = 25;
const PLAYERS_ON_PITCH = 11;
const MAX_SUBSTITUTIONS = 5;

const MATCH_TICK_MS = 900;
const TICK_SECONDS = 1;

/*
 * Probability tuning.
 *
 * These values are deliberately moderate.
 * Player strength does most of the work.
 */
const BASE_SHOT_CHANCE = 0.24;
const BASE_GOAL_CHANCE_ON_TARGET = 0.27;

const HOME_ADVANTAGE = 0.035;

const MIN_PLAYER_STRENGTH = 35;
const MAX_PLAYER_STRENGTH = 99;

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pick(array) {
  if (!Array.isArray(array) || !array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function randomBetweenSafe(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'MID'
  );
}

function getPlayerOverall(player) {
  return clamp(
    safeNumber(
      player?.overall ??
        player?.rating ??
        player?.overallRating ??
        player?.ovr ??
        player?.strength,
      60
    ),
    MIN_PLAYER_STRENGTH,
    MAX_PLAYER_STRENGTH
  );
}

function getPlayerPhoto(player) {
  return (
    player?.photo ||
    player?.photoUrl ||
    player?.image ||
    player?.avatar ||
    null
  );
}

function playerId(player) {
  return player?.id || player?.playerId || player?.uid || null;
}

/* =========================================================
   POSSESSION
========================================================= */

function formatPossession(value) {
  return `${Number(value).toFixed(2)}%`;
}

/* =========================================================
   CLUB HELPERS
========================================================= */

function getClubName(club, fallback = 'Unknown Club') {
  return (
    club?.shortName ||
    club?.name ||
    club?.clubName ||
    club?.title ||
    fallback
  );
}

function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.image ||
    club?.badge ||
    null
  );
}

function getClubPrimaryColor(club) {
  return (
    club?.primaryColor ||
    club?.colors?.primary ||
    club?.color ||
    '#2563eb'
  );
}

function getClubStadium(club) {
  return (
    club?.stadium ||
    club?.stadiumName ||
    club?.homeGround ||
    club?.venue ||
    'Main Stadium'
  );
}

/* =========================================================
   POSITION
========================================================= */

function normalizePosition(position) {
  const value = normalize(position);

  if (
    value.includes('goal') ||
    value === 'gk' ||
    value === 'keeper'
  ) {
    return 'GK';
  }

  if (
    value.includes('def') ||
    value === 'cb' ||
    value === 'lb' ||
    value === 'rb' ||
    value === 'lwb' ||
    value === 'rwb'
  ) {
    return 'DEF';
  }

  if (
    value.includes('mid') ||
    value === 'cm' ||
    value === 'dm' ||
    value === 'am' ||
    value === 'lm' ||
    value === 'rm'
  ) {
    return 'MID';
  }

  if (
    value.includes('attack') ||
    value.includes('forward') ||
    value.includes('striker') ||
    value === 'st' ||
    value === 'cf' ||
    value === 'lw' ||
    value === 'rw'
  ) {
    return 'ATT';
  }

  return 'MID';
}

/* =========================================================
   FORMATIONS
========================================================= */

const FORMATIONS = {
  '4-4-2': {
    name: '4-4-2',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 18 },
      { x: 23, y: 39 },
      { x: 23, y: 61 },
      { x: 23, y: 82 },
      { x: 42, y: 20 },
      { x: 42, y: 42 },
      { x: 42, y: 58 },
      { x: 42, y: 80 },
      { x: 62, y: 36 },
      { x: 62, y: 64 },
    ],
  },

  '4-3-3': {
    name: '4-3-3',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 18 },
      { x: 23, y: 39 },
      { x: 23, y: 61 },
      { x: 23, y: 82 },
      { x: 42, y: 30 },
      { x: 42, y: 50 },
      { x: 42, y: 70 },
      { x: 64, y: 20 },
      { x: 64, y: 50 },
      { x: 64, y: 80 },
    ],
  },

  '3-5-2': {
    name: '3-5-2',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 30 },
      { x: 23, y: 50 },
      { x: 23, y: 70 },
      { x: 42, y: 20 },
      { x: 42, y: 39 },
      { x: 42, y: 50 },
      { x: 42, y: 61 },
      { x: 42, y: 80 },
      { x: 64, y: 36 },
      { x: 64, y: 64 },
    ],
  },

  '5-3-2': {
    name: '5-3-2',
    positions: [
      { x: 8, y: 50 },
      { x: 20, y: 15 },
      { x: 20, y: 32 },
      { x: 20, y: 50 },
      { x: 20, y: 68 },
      { x: 20, y: 85 },
      { x: 42, y: 30 },
      { x: 42, y: 50 },
      { x: 42, y: 70 },
      { x: 64, y: 36 },
      { x: 64, y: 64 },
    ],
  },

  '4-2-3-1': {
    name: '4-2-3-1',
    positions: [
      { x: 8, y: 50 },
      { x: 23, y: 18 },
      { x: 23, y: 39 },
      { x: 23, y: 61 },
      { x: 23, y: 82 },
      { x: 38, y: 35 },
      { x: 38, y: 65 },
      { x: 52, y: 20 },
      { x: 52, y: 50 },
      { x: 52, y: 80 },
      { x: 68, y: 50 },
    ],
  },
};

/* =========================================================
   TACTICS
========================================================= */

const TACTICS = {
  'Tiki-Taka': {
    name: 'Tiki-Taka',
    passChance: 0.62,
    dribbleChance: 0.18,
    shootChance: 0.20,
    pressIntensity: 0.70,
    attackModifier: 1.00,
    defenceModifier: 1.00,
  },

  'Counter Attack': {
    name: 'Counter Attack',
    passChance: 0.32,
    dribbleChance: 0.38,
    shootChance: 0.30,
    pressIntensity: 0.40,
    attackModifier: 1.08,
    defenceModifier: 0.96,
  },

  'High Press': {
    name: 'High Press',
    passChance: 0.42,
    dribbleChance: 0.28,
    shootChance: 0.30,
    pressIntensity: 0.90,
    attackModifier: 1.04,
    defenceModifier: 1.05,
  },

  'Park the Bus': {
    name: 'Park the Bus',
    passChance: 0.54,
    dribbleChance: 0.16,
    shootChance: 0.30,
    pressIntensity: 0.20,
    attackModifier: 0.88,
    defenceModifier: 1.15,
  },

  'Wing Play': {
    name: 'Wing Play',
    passChance: 0.43,
    dribbleChance: 0.35,
    shootChance: 0.22,
    pressIntensity: 0.50,
    attackModifier: 1.03,
    defenceModifier: 0.98,
  },
};

/* =========================================================
   EVENTS
========================================================= */

const EVENT_TYPES = {
  GOAL: 'goal',
  YELLOW: 'yellow',
  RED: 'red',
  FOUL: 'foul',
  CORNER: 'corner',
  OFFSIDE: 'offside',
  SAVE: 'save',
  SHOT: 'shot',
  SUBSTITUTION: 'substitution',
  INJURY: 'injury',
};

function eventLabel(event) {
  switch (event?.type) {
    case EVENT_TYPES.GOAL:
      return 'GOAL';

    case EVENT_TYPES.YELLOW:
      return 'YELLOW CARD';

    case EVENT_TYPES.RED:
      return 'RED CARD';

    case EVENT_TYPES.FOUL:
      return 'FOUL';

    case EVENT_TYPES.CORNER:
      return 'CORNER';

    case EVENT_TYPES.OFFSIDE:
      return 'OFFSIDE';

    case EVENT_TYPES.SAVE:
      return 'SAVE';

    case EVENT_TYPES.SHOT:
      return 'SHOT';

    case EVENT_TYPES.SUBSTITUTION:
      return 'SUBSTITUTION';

    case EVENT_TYPES.INJURY:
      return 'INJURY';

    default:
      return 'MATCH EVENT';
  }
}

function eventIcon(event) {
  switch (event?.type) {
    case EVENT_TYPES.GOAL:
      return '⚽';

    case EVENT_TYPES.YELLOW:
      return '🟨';

    case EVENT_TYPES.RED:
      return '🟥';

    case EVENT_TYPES.CORNER:
      return '🚩';

    case EVENT_TYPES.OFFSIDE:
      return '🚩';

    case EVENT_TYPES.SAVE:
      return '🧤';

    case EVENT_TYPES.SHOT:
      return '💥';

    case EVENT_TYPES.SUBSTITUTION:
      return '🔄';

    case EVENT_TYPES.INJURY:
      return '🩹';

    default:
      return '•';
  }
}

/* =========================================================
   DEFAULT STATS
========================================================= */

function createDefaultStats() {
  return {
    shots: 0,
    shotsOnTarget: 0,
    possession: 50.00,
    passes: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellow: 0,
    red: 0,
    saves: 0,
    tackles: 0,
    interceptions: 0,
  };
}

/* =========================================================
   CLUB / TEAM STRENGTH
========================================================= */

/*
 * IMPORTANT:
 *
 * Team strength is calculated from the actual starting XI.
 *
 * It is NOT taken from club reputation alone.
 *
 * This means:
 *
 * 90 OVR squad > 70 OVR squad
 *
 * even if the weaker club has a high reputation field.
 */

function calculateTeamStrength(players) {
  if (!Array.isArray(players) || players.length === 0) {
    return 60;
  }

  const weighted = players.map((player) => {
    const position = normalizePosition(getPlayerPosition(player));
    const overall = getPlayerOverall(player);

    let weight = 1;

    if (position === 'GK') {
      weight = 0.95;
    } else if (position === 'DEF') {
      weight = 1.00;
    } else if (position === 'MID') {
      weight = 1.05;
    } else if (position === 'ATT') {
      weight = 1.10;
    }

    return {
      value: overall,
      weight,
    };
  });

  let total = 0;
  let weights = 0;

  weighted.forEach((item) => {
    total += item.value * item.weight;
    weights += item.weight;
  });

  return clamp(
    weights > 0 ? total / weights : 60,
    MIN_PLAYER_STRENGTH,
    MAX_PLAYER_STRENGTH
  );
}

/* =========================================================
   POSITION GROUP STRENGTH
========================================================= */

function getGroupPlayers(players, group) {
  return (Array.isArray(players) ? players : []).filter(
    (player) =>
      normalizePosition(getPlayerPosition(player)) === group
  );
}

function calculateGroupStrength(players, group, fallback = 60) {
  const groupPlayers = getGroupPlayers(players, group);

  if (!groupPlayers.length) {
    return fallback;
  }

  const total = groupPlayers.reduce(
    (sum, player) => sum + getPlayerOverall(player),
    0
  );

  return total / groupPlayers.length;
}

function getBestPlayer(players, preferredGroups = []) {
  const list = Array.isArray(players) ? players : [];

  if (!list.length) {
    return null;
  }

  if (preferredGroups.length) {
    const preferred = list.filter((player) =>
      preferredGroups.includes(
        normalizePosition(getPlayerPosition(player))
      )
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

/* =========================================================
   TEAM PERFORMANCE
========================================================= */

function calculateTeamPerformance({
  players,
  formation,
  tactic,
  mentality,
  stamina,
  isHome,
}) {
  const teamStrength = calculateTeamStrength(players);

  const attack = calculateGroupStrength(players, 'ATT');
  const midfield = calculateGroupStrength(players, 'MID');
  const defence = calculateGroupStrength(players, 'DEF');
  const goalkeeper = calculateGroupStrength(players, 'GK');

  const tacticData =
    TACTICS[tactic] || TACTICS['Tiki-Taka'];

  let formationAttack = 1;
  let formationMidfield = 1;
  let formationDefence = 1;

  switch (formation) {
    case '4-3-3':
      formationAttack = 1.06;
      formationMidfield = 1.02;
      formationDefence = 0.99;
      break;

    case '3-5-2':
      formationAttack = 1.03;
      formationMidfield = 1.07;
      formationDefence = 0.95;
      break;

    case '5-3-2':
      formationAttack = 0.96;
      formationMidfield = 1.00;
      formationDefence = 1.09;
      break;

    case '4-2-3-1':
      formationAttack = 1.02;
      formationMidfield = 1.06;
      formationDefence = 1.02;
      break;

    default:
      formationAttack = 1;
      formationMidfield = 1;
      formationDefence = 1;
  }

  let mentalityAttack = 1;
  let mentalityDefence = 1;

  if (mentality === 'attacking') {
    mentalityAttack = 1.10;
    mentalityDefence = 0.94;
  }

  if (mentality === 'defensive') {
    mentalityAttack = 0.90;
    mentalityDefence = 1.10;
  }

  const staminaValues = Object.values(stamina || {});

  const averageStamina =
    staminaValues.length > 0
      ? staminaValues.reduce(
          (sum, value) => sum + safeNumber(value, 100),
          0
        ) / staminaValues.length
      : 100;

  const staminaFactor =
    0.82 + clamp(averageStamina, 0, 100) / 100 * 0.18;

  return {
    overall: teamStrength,
    attack:
      attack *
      formationAttack *
      mentalityAttack *
      tacticData.attackModifier *
      staminaFactor,

    midfield:
      midfield *
      formationMidfield *
      staminaFactor,

    defence:
      defence *
      formationDefence *
      mentalityDefence *
      tacticData.defenceModifier *
      staminaFactor,

    goalkeeper:
      goalkeeper * staminaFactor,

    stamina: averageStamina,

    homeFactor: isHome ? 1 + HOME_ADVANTAGE : 1,
  };
}

/* =========================================================
   CHANCE CALCULATION
========================================================= */

function calculateShotProbability({
  attacker,
  attackingTeam,
  defendingTeam,
  attackerPosition,
  distanceToGoal,
}) {
  const attackerOverall = getPlayerOverall(attacker);

  const attackStrength = attackingTeam.attack;
  const midfieldStrength = attackingTeam.midfield;

  const defenceStrength = defendingTeam.defence;
  const goalkeeperStrength = defendingTeam.goalkeeper;

  const attackerFactor =
    0.75 + (attackerOverall / 100) * 0.55;

  const attackVsDefence =
    clamp(
      (attackStrength - defenceStrength + 50) / 100,
      0.55,
      1.45
    );

  const midfieldFactor =
    0.85 + clamp(midfieldStrength, 40, 100) / 100 * 0.30;

  const positionFactor =
    attackerPosition === 'ATT'
      ? 1.20
      : attackerPosition === 'MID'
        ? 0.90
        : 0.45;

  const distanceFactor = clamp(
    1.25 - distanceToGoal / 20,
    0.45,
    1.25
  );

  const goalkeeperFactor =
    1 -
    clamp(
      (goalkeeperStrength - 50) / 300,
      -0.08,
      0.16
    );

  const raw =
    BASE_SHOT_CHANCE *
    attackerFactor *
    attackVsDefence *
    midfieldFactor *
    positionFactor *
    distanceFactor *
    goalkeeperFactor *
    attackingTeam.homeFactor;

  return clamp(raw, 0.02, 0.55);
}

function calculateGoalProbability({
  attacker,
  attackingTeam,
  defendingTeam,
  distanceToGoal,
}) {
  const attackerOverall = getPlayerOverall(attacker);

  const goalkeeperOverall =
    defendingTeam.goalkeeper || 60;

  const attackQuality =
    clamp(attackingTeam.attack / 100, 0.45, 1.20);

  const attackerQuality =
    clamp(attackerOverall / 100, 0.40, 1.10);

  const goalkeeperResistance =
    clamp(
      1 - (goalkeeperOverall - 50) / 300,
      0.70,
      1.08
    );

  const distanceFactor = clamp(
    1.20 - distanceToGoal / 30,
    0.55,
    1.20
  );

  const raw =
    BASE_GOAL_CHANCE_ON_TARGET *
    attackQuality *
    attackerQuality *
    goalkeeperResistance *
    distanceFactor *
    attackingTeam.homeFactor;

  return clamp(raw, 0.04, 0.65);
}

/* =========================================================
   LOAD CLUB PLAYERS
========================================================= */

async function loadClubPlayers(clubId) {
  if (!clubId) return [];

  try {
    const playersQuery = query(
      collection(db, 'players'),
      where('clubId', '==', clubId)
    );

    const snapshot = await getDocs(playersQuery);

    const players = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));

    return players.filter(
      (player) =>
        player.squadType !== 'youth' &&
        player.isYouth !== true
    );
  } catch (error) {
    console.error(
      'clubId player query failed:',
      error
    );
  }

  try {
    const allSnapshot = await getDocs(
      collection(db, 'players')
    );

    return allSnapshot.docs
      .map((item) => ({
        id: item.id,
        ...item.data(),
      }))
      .filter((player) => {
        const id =
          player.clubId ||
          player.currentClub ||
          player.teamId;

        return String(id) === String(clubId);
      })
      .filter(
        (player) =>
          player.squadType !== 'youth' &&
          player.isYouth !== true
      );
  } catch (error) {
    console.error(
      'Fallback players query failed:',
      error
    );

    return [];
  }
}

/* =========================================================
   GENERATED PLAYERS
========================================================= */

function createGeneratedPlayer(club, position, index) {
  const baseName =
    getClubName(club, 'Club')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim() || 'Club';

  const clubSeed =
    String(club?.id || '').length;

  const overall =
    45 + ((index * 7 + clubSeed) % 15);

  return {
    id: `gen-${club?.id || 'club'}-${position}-${index}`,
    name: `${baseName} Academy ${index + 1}`,
    position,
    overall,
    isGenerated: true,
    squadType: 'first-team',
  };
}

function ensureSquadSize(
  club,
  existingPlayers,
  targetCount = MAX_SQUAD_SIZE
) {
  const players = [...(existingPlayers || [])];

  if (players.length >= targetCount) {
    return players;
  }

  const counts = {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  };

  players.forEach((player) => {
    const position = normalizePosition(
      getPlayerPosition(player)
    );

    if (counts[position] !== undefined) {
      counts[position] += 1;
    }
  });

  const requiredPositions = [
    ['GK', 2],
    ['DEF', 8],
    ['MID', 8],
    ['ATT', 6],
  ];

  let generatedIndex = 0;

  requiredPositions.forEach(
    ([position, requiredCount]) => {
      while (
        counts[position] < requiredCount &&
        players.length < targetCount
      ) {
        players.push(
          createGeneratedPlayer(
            club,
            position,
            generatedIndex
          )
        );

        counts[position] += 1;
        generatedIndex += 1;
      }
    }
  );

  const extraPositions = [
    'MID',
    'DEF',
    'ATT',
    'MID',
    'DEF',
    'ATT',
    'GK',
  ];

  while (players.length < targetCount) {
    const position =
      extraPositions[
        generatedIndex % extraPositions.length
      ];

    players.push(
      createGeneratedPlayer(
        club,
        position,
        generatedIndex
      )
    );

    generatedIndex += 1;
  }

  return players;
}

/* =========================================================
   LOAD MATCH
========================================================= */

async function loadMatchFromDatabase(matchId) {
  if (!matchId) return null;

  const matchRef = doc(
    db,
    'matches',
    matchId
  );

  const snapshot = await getDoc(matchRef);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
    _source: 'matches',
  };
}

/* =========================================================
   MATCH PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const matchId =
    typeof router.query.id === 'string'
      ? router.query.id
      : null;

  const [fixture, setFixture] = useState(null);

  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);

  const [homeSquad, setHomeSquad] = useState([]);
  const [awaySquad, setAwaySquad] = useState([]);

  const [homeXI, setHomeXI] = useState([]);
  const [awayXI, setAwayXI] = useState([]);

  const [homeBench, setHomeBench] = useState([]);
  const [awayBench, setAwayBench] = useState([]);

  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [matchStatus, setMatchStatus] =
    useState('loading');

  const [events, setEvents] = useState([]);

  const [
    injuryTimeFirstHalf,
    setInjuryTimeFirstHalf,
  ] = useState(0);

  const [
    injuryTimeSecondHalf,
    setInjuryTimeSecondHalf,
  ] = useState(0);

  const [homeStats, setHomeStats] = useState(
    createDefaultStats()
  );

  const [awayStats, setAwayStats] = useState(
    createDefaultStats()
  );

  const [mentality, setMentality] =
    useState('balanced');

  const [formation, setFormation] =
    useState('4-4-2');

  const [tactic, setTactic] =
    useState('Tiki-Taka');

  const [showTactics, setShowTactics] =
    useState(false);

  const [showFormation, setShowFormation] =
    useState(false);

  const [showSubs, setShowSubs] =
    useState(false);

  const [showEvents, setShowEvents] =
    useState(true);

  const [loadingMatch, setLoadingMatch] =
    useState(true);

  const [savingMatch, setSavingMatch] =
    useState(false);

  const [paused, setPaused] =
    useState(false);

  const [halfTimeShown, setHalfTimeShown] =
    useState(false);

  const [userClubId, setUserClubId] =
    useState(null);

  const [
    substitutionsUsed,
    setSubstitutionsUsed,
  ] = useState(0);

  const [selectedSubIn, setSelectedSubIn] =
    useState('');

  const [selectedSubOut, setSelectedSubOut] =
    useState('');

  const [playerStamina, setPlayerStamina] =
    useState({
      home: {},
      away: {},
    });

  /* =======================================================
     IMPORTANT REFS
  ======================================================= */

  const timerRef = useRef(null);

  const processingRef =
    useRef(false);

  const scoreRef = useRef({
    home: 0,
    away: 0,
  });

  const minuteRef = useRef(0);

  const eventsRef = useRef([]);

  const statsRef = useRef({
    home: createDefaultStats(),
    away: createDefaultStats(),
  });

  const staminaRef = useRef({
    home: {},
    away: {},
  });

  /* =======================================================
     THREE.JS
  ======================================================= */

  const mountRef = useRef(null);

  const sceneRef = useRef(null);

  const cameraRef = useRef(null);

  const rendererRef =
    useRef(null);

  const controlsRef =
    useRef(null);

  const ballMeshRef =
    useRef(null);

  const playerMeshesRef =
    useRef({
      home: [],
      away: [],
    });

  const animationFrameRef =
    useRef(null);

  const ballPossessionRef =
    useRef(null);

  const playerTargetsRef =
    useRef({
      home: [],
      away: [],
    });

  /* =======================================================
     USER TEAM
  ======================================================= */

  const isHomeUser =
    String(userClubId || '') ===
    String(homeClub?.id || '');

  const isAwayUser =
    String(userClubId || '') ===
    String(awayClub?.id || '');

  const userIsParticipant =
    isHomeUser || isAwayUser;

  const userTeam =
    isHomeUser
      ? 'home'
      : isAwayUser
        ? 'away'
        : null;

  /* =======================================================
     LOAD USER CLUB
  ======================================================= */

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;

    async function loadUserClub() {
      try {
        const userRef = doc(
          db,
          'users',
          user.uid
        );

        const snapshot =
          await getDoc(userRef);

        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data();

        const career =
          data.careerData || {};

        const clubId =
          career.currentClub ||
          data.currentClub ||
          data.clubId ||
          null;

        if (!cancelled) {
          setUserClubId(clubId);
        }
      } catch (error) {
        console.error(
          'User club error:',
          error
        );
      }
    }

    loadUserClub();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  /* =======================================================
     APPLY MATCH STATE
  ======================================================= */

  const applyMatchState =
    useCallback((data) => {
      if (!data) return;

      const result =
        data.result || {};

      const nextHomeScore =
        safeNumber(
          result.homeScore ??
            data.homeScore,
          0
        );

      const nextAwayScore =
        safeNumber(
          result.awayScore ??
            data.awayScore,
          0
        );

      const nextMinute =
        safeNumber(
          data.minute ??
            data.matchMinute,
          0
        );

      const nextEvents =
        Array.isArray(data.events)
          ? data.events
          : [];

      const nextHomeStats = {
        ...createDefaultStats(),
        ...(data.homeStats || {}),
        possession: safeNumber(
          data.homeStats?.possession,
          50
        ),
      };

      const nextAwayStats = {
        ...createDefaultStats(),
        ...(data.awayStats || {}),
        possession: safeNumber(
          data.awayStats?.possession,
          50
        ),
      };

      scoreRef.current = {
        home: nextHomeScore,
        away: nextAwayScore,
      };

      minuteRef.current =
        nextMinute;

      eventsRef.current =
        nextEvents;

      statsRef.current = {
        home: nextHomeStats,
        away: nextAwayStats,
      };

      setHomeScore(nextHomeScore);
      setAwayScore(nextAwayScore);

      setMatchMinute(nextMinute);

      setEvents(nextEvents);

      setHomeStats(nextHomeStats);
      setAwayStats(nextAwayStats);

      setSubstitutionsUsed(
        safeNumber(
          data.substitutionsUsed,
          0
        )
      );

      if (data.mentality) {
        setMentality(data.mentality);
      }

      if (data.formation) {
        setFormation(data.formation);
      }

      if (data.tactic) {
        setTactic(data.tactic);
      }

      if (data.injuryTimeFirstHalf) {
        setInjuryTimeFirstHalf(
          safeNumber(
            data.injuryTimeFirstHalf
          )
        );
      }

      if (data.injuryTimeSecondHalf) {
        setInjuryTimeSecondHalf(
          safeNumber(
            data.injuryTimeSecondHalf
          )
        );
      }

      const status =
        normalize(data.status);

      if (
        status === 'finished' ||
        status === 'completed'
      ) {
        setMatchStatus('finished');
      } else if (
        status === 'half-time'
      ) {
        setMatchStatus('half-time');
      } else if (
        status === 'live'
      ) {
        setMatchStatus('live');
      } else {
        setMatchStatus('ready');
      }
    }, []);

  /* =======================================================
     STARTING XI
  ======================================================= */

  const selectStartingXI =
    useCallback(
      (
        squad,
        formationName = '4-4-2'
      ) => {
        const safeSquad =
          Array.isArray(squad)
            ? [...squad]
            : [];

        const formationRequirements = {
          '4-4-2': {
            GK: 1,
            DEF: 4,
            MID: 4,
            ATT: 2,
          },

          '4-3-3': {
            GK: 1,
            DEF: 4,
            MID: 3,
            ATT: 3,
          },

          '3-5-2': {
            GK: 1,
            DEF: 3,
            MID: 5,
            ATT: 2,
          },

          '5-3-2': {
            GK: 1,
            DEF: 5,
            MID: 3,
            ATT: 2,
          },

          '4-2-3-1': {
            GK: 1,
            DEF: 4,
            MID: 5,
            ATT: 1,
          },
        };

        const requirements =
          formationRequirements[
            formationName
          ] ||
          formationRequirements['4-4-2'];

        const goalkeepers =
          safeSquad.filter(
            (p) =>
              normalizePosition(
                getPlayerPosition(p)
              ) === 'GK'
          );

        const defenders =
          safeSquad.filter(
            (p) =>
              normalizePosition(
                getPlayerPosition(p)
              ) === 'DEF'
          );

        const midfielders =
          safeSquad.filter(
            (p) =>
              normalizePosition(
                getPlayerPosition(p)
              ) === 'MID'
          );

        const attackers =
          safeSquad.filter(
            (p) =>
              normalizePosition(
                getPlayerPosition(p)
              ) === 'ATT'
          );

        const used =
          new Set();

        const result = [];

        function addBest(
          list,
          count
        ) {
          [...list]
            .sort(
              (a, b) =>
                getPlayerOverall(b) -
                getPlayerOverall(a)
            )
            .slice(0, count)
            .forEach((player) => {
              const id =
                playerId(player);

              if (
                !used.has(id)
              ) {
                used.add(id);
                result.push(player);
              }
            });
        }

        addBest(
          goalkeepers,
          requirements.GK
        );

        addBest(
          defenders,
          requirements.DEF
        );

        addBest(
          midfielders,
          requirements.MID
        );

        addBest(
          attackers,
          requirements.ATT
        );

        const remaining =
          safeSquad
            .filter(
              (player) =>
                !used.has(
                  playerId(player)
                )
            )
            .sort(
              (a, b) =>
                getPlayerOverall(b) -
                getPlayerOverall(a)
            );

        while (
          result.length <
            PLAYERS_ON_PITCH &&
          remaining.length
        ) {
          result.push(
            remaining.shift()
          );
        }

        return result.slice(
          0,
          PLAYERS_ON_PITCH
        );
      },
      []
    );

  /* =======================================================
     LOAD MATCH
  ======================================================= */

  useEffect(() => {
    if (
      loading ||
      !user ||
      !matchId
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoadingMatch(true);

        const match =
          await loadMatchFromDatabase(
            matchId
          );

        if (!match) {
          toast.error(
            'Match not found in database'
          );

          router.push(
            '/fixtures'
          );

          return;
        }

        if (cancelled) {
          return;
        }

        setFixture(match);

        applyMatchState(match);

        const homeId =
          match.homeClubId ||
          match.homeTeamId ||
          match.homeId;

        const awayId =
          match.awayClubId ||
          match.awayTeamId ||
          match.awayId;

        if (
          !homeId ||
          !awayId
        ) {
          toast.error(
            'This match has invalid teams'
          );

          return;
        }

        const [
          homeSnapshot,
          awaySnapshot,
        ] = await Promise.all([
          getDoc(
            doc(
              db,
              'clubs',
              homeId
            )
          ),

          getDoc(
            doc(
              db,
              'clubs',
              awayId
            )
          ),
        ]);

        const home =
          homeSnapshot.exists()
            ? {
                id:
                  homeSnapshot.id,
                ...homeSnapshot.data(),
              }
            : {
                id: homeId,
                name:
                  match.homeClubName ||
                  'Home',
              };

        const away =
          awaySnapshot.exists()
            ? {
                id:
                  awaySnapshot.id,
                ...awaySnapshot.data(),
              }
            : {
                id: awayId,
                name:
                  match.awayClubName ||
                  'Away',
              };

        if (cancelled) {
          return;
        }

        setHomeClub(home);
        setAwayClub(away);

        const [
          rawHomePlayers,
          rawAwayPlayers,
        ] = await Promise.all([
          loadClubPlayers(
            homeId
          ),

          loadClubPlayers(
            awayId
          ),
        ]);

        if (cancelled) {
          return;
        }

        const preparedHome =
          ensureSquadSize(
            home,
            rawHomePlayers
          );

        const preparedAway =
          ensureSquadSize(
            away,
            rawAwayPlayers
          );

        setHomeSquad(
          preparedHome
        );

        setAwaySquad(
          preparedAway
        );

        const startingHome =
          selectStartingXI(
            preparedHome,
            formation
          );

        const startingAway =
          selectStartingXI(
            preparedAway,
            formation
          );

        setHomeXI(
          startingHome
        );

        setAwayXI(
          startingAway
        );

        setHomeBench(
          preparedHome.filter(
            (player) =>
              !startingHome.some(
                (starter) =>
                  String(
                    playerId(starter)
                  ) ===
                  String(
                    playerId(player)
                  )
              )
          )
        );

        setAwayBench(
          preparedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) =>
                  String(
                    playerId(starter)
                  ) ===
                  String(
                    playerId(player)
                  )
              )
          )
        );

        const homeStamina = {};
        const awayStamina = {};

        startingHome.forEach(
          (player) => {
            homeStamina[
              playerId(player)
            ] = 100;
          }
        );

        startingAway.forEach(
          (player) => {
            awayStamina[
              playerId(player)
            ] = 100;
          }
        );

        staminaRef.current = {
          home: homeStamina,
          away: awayStamina,
        };

        setPlayerStamina({
          home: homeStamina,
          away: awayStamina,
        });

        if (
          !match.injuryTimeFirstHalf
        ) {
          setInjuryTimeFirstHalf(
            randomBetweenSafe(
              INJURY_TIME_MIN,
              INJURY_TIME_MAX
            )
          );
        }

        if (
          !match.injuryTimeSecondHalf
        ) {
          setInjuryTimeSecondHalf(
            randomBetweenSafe(
              INJURY_TIME_MIN,
              INJURY_TIME_MAX
            )
          );
        }
      } catch (error) {
        console.error(
          'Match loading error:',
          error
        );

        toast.error(
          'Could not load match'
        );
      } finally {
        if (!cancelled) {
          setLoadingMatch(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    user,
    matchId,
    router,
    applyMatchState,
    formation,
    selectStartingXI,
  ]);

  /* =======================================================
     THREE.JS SCENE
  ======================================================= */

  useEffect(() => {
    if (
      !mountRef.current ||
      loadingMatch
    ) {
      return;
    }

    const width =
      mountRef.current.clientWidth;

    const height =
      mountRef.current.clientHeight;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        0x0b1120
      );

    scene.fog =
      new THREE.Fog(
        0x0b1120,
        30,
        80
      );

    const camera =
      new THREE.PerspectiveCamera(
        45,
        width / height,
        0.1,
        100
      );

    camera.position.set(
      0,
      25,
      30
    );

    camera.lookAt(
      0,
      0,
      0
    );

    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
      });

    renderer.setSize(
      width,
      height
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2
      )
    );

    renderer.shadowMap.enabled =
      true;

    renderer.shadowMap.type =
      THREE.PCFSoftShadowMap;

    mountRef.current.appendChild(
      renderer.domElement
    );

    const controls =
      new OrbitControls(
        camera,
        renderer.domElement
      );

    controls.enableDamping =
      true;

    controls.dampingFactor =
      0.05;

    controls.target.set(
      0,
      0,
      0
    );

    controls.maxPolarAngle =
      Math.PI / 2.5;

    controls.minDistance = 15;
    controls.maxDistance = 50;

    controls.update();

    const ambientLight =
      new THREE.AmbientLight(
        0xffffff,
        0.5
      );

    scene.add(
      ambientLight
    );

    const directionalLight =
      new THREE.DirectionalLight(
        0xffffff,
        1
      );

    directionalLight.position.set(
      10,
      20,
      10
    );

    directionalLight.castShadow =
      true;

    scene.add(
      directionalLight
    );

    const pitch =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          30,
          20
        ),
        new THREE.MeshStandardMaterial(
          {
            color: 0x15803d,
            roughness: 0.8,
          }
        )
      );

    pitch.rotation.x =
      -Math.PI / 2;

    pitch.receiveShadow =
      true;

    scene.add(
      pitch
    );

    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    const borderGeometry =
      new THREE.BufferGeometry()
        .setFromPoints([
          new THREE.Vector3(
            -15,
            0.01,
            -10
          ),

          new THREE.Vector3(
            15,
            0.01,
            -10
          ),

          new THREE.Vector3(
            15,
            0.01,
            10
          ),

          new THREE.Vector3(
            -15,
            0.01,
            10
          ),

          new THREE.Vector3(
            -15,
            0.01,
            -10
          ),
        ]);

    scene.add(
      new THREE.Line(
        borderGeometry,
        lineMaterial
      )
    );

    const centerLine =
      new THREE.BufferGeometry()
        .setFromPoints([
          new THREE.Vector3(
            0,
            0.01,
            -10
          ),

          new THREE.Vector3(
            0,
            0.01,
            10
          ),
        ]);

    scene.add(
      new THREE.Line(
        centerLine,
        lineMaterial
      )
    );

    const centerCircle =
      new THREE.Mesh(
        new THREE.RingGeometry(
          3,
          3.05,
          64
        ),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side:
            THREE.DoubleSide,
        })
      );

    centerCircle.rotation.x =
      -Math.PI / 2;

    centerCircle.position.y =
      0.02;

    scene.add(
      centerCircle
    );

    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
      });

    const leftGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.1,
          0.15,
          6
        ),
        goalMaterial
      );

    leftGoal.position.set(
      -15,
      0.08,
      0
    );

    scene.add(
      leftGoal
    );

    const rightGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.1,
          0.15,
          6
        ),
        goalMaterial
      );

    rightGoal.position.set(
      15,
      0.08,
      0
    );

    scene.add(
      rightGoal
    );

    const ball =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.15,
          32,
          32
        ),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.3,
        })
      );

    ball.position.set(
      0,
      0.15,
      0
    );

    ball.castShadow =
      true;

    scene.add(
      ball
    );

    ballMeshRef.current =
      ball;

    const createPlayer = (
      x,
      z,
      color
    ) => {
      const group =
        new THREE.Group();

      const body =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.3,
            0.35,
            0.6,
            16
          ),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
          })
        );

      body.position.y =
        0.3;

      group.add(
        body
      );

      const head =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.15,
            16,
            16
          ),
          new THREE.MeshStandardMaterial({
            color: 0xffcc99,
          })
        );

      head.position.y =
        0.75;

      group.add(
        head
      );

      group.position.set(
        x,
        0,
        z
      );

      group.castShadow =
        true;

      scene.add(
        group
      );

      return group;
    };

    const formationData =
      FORMATIONS[
        formation
      ] ||
      FORMATIONS['4-4-2'];

    const positions =
      formationData.positions;

    playerMeshesRef.current.home =
      positions.map(
        (position) => {
          const x =
            ((position.x - 50) /
              50) *
            15;

          const z =
            ((position.y - 50) /
              50) *
            10;

          return createPlayer(
            x,
            z,
            0x3b82f6
          );
        }
      );

    playerMeshesRef.current.away =
      positions.map(
        (position) => {
          const x =
            ((50 - position.x) /
              50) *
            15;

          const z =
            ((50 - position.y) /
              50) *
            10;

          return createPlayer(
            x,
            z,
            0xef4444
          );
        }
      );

    playerTargetsRef.current.home =
      playerMeshesRef.current.home.map(
        (player) => ({
          x:
            player.position.x,
          z:
            player.position.z,
        })
      );

    playerTargetsRef.current.away =
      playerMeshesRef.current.away.map(
        (player) => ({
          x:
            player.position.x,
          z:
            player.position.z,
        })
      );

    const animate =
      () => {
        animationFrameRef.current =
          requestAnimationFrame(
            animate
          );

        playerMeshesRef.current.home.forEach(
          (player, index) => {
            const target =
              playerTargetsRef.current
                .home[index];

            if (target) {
              player.position.x =
                lerp(
                  player.position.x,
                  target.x,
                  0.1
                );

              player.position.z =
                lerp(
                  player.position.z,
                  target.z,
                  0.1
                );
            }
          }
        );

        playerMeshesRef.current.away.forEach(
          (player, index) => {
            const target =
              playerTargetsRef.current
                .away[index];

            if (target) {
              player.position.x =
                lerp(
                  player.position.x,
                  target.x,
                  0.1
                );

              player.position.z =
                lerp(
                  player.position.z,
                  target.z,
                  0.1
                );
            }
          }
        );

        if (
          ballPossessionRef.current &&
          ballMeshRef.current
        ) {
          const {
            team,
            playerIndex,
          } =
            ballPossessionRef.current;

          const players =
            team === 'home'
              ? playerMeshesRef.current.home
              : playerMeshesRef.current.away;

          const player =
            players[playerIndex];

          if (player) {
            ballMeshRef.current.position.x =
              player.position.x;

            ballMeshRef.current.position.z =
              player.position.z;

            ballMeshRef.current.position.y =
              0.15;
          }
        }

        controls.update();

        renderer.render(
          scene,
          camera
        );
      };

    animate();

    sceneRef.current =
      scene;

    cameraRef.current =
      camera;

    rendererRef.current =
      renderer;

    controlsRef.current =
      controls;

    const handleResize =
      () => {
        if (
          !mountRef.current
        ) {
          return;
        }

        const nextWidth =
          mountRef.current.clientWidth;

        const nextHeight =
          mountRef.current.clientHeight;

        camera.aspect =
          nextWidth /
          nextHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
          nextWidth,
          nextHeight
        );
      };

    window.addEventListener(
      'resize',
      handleResize
    );

    return () => {
      window.removeEventListener(
        'resize',
        handleResize
      );

      if (
        animationFrameRef.current
      ) {
        cancelAnimationFrame(
          animationFrameRef.current
        );
      }

      renderer.dispose();

      if (
        mountRef.current &&
        renderer.domElement.parentNode ===
          mountRef.current
      ) {
        mountRef.current.removeChild(
          renderer.domElement
        );
      }

      scene.clear();
    };
  }, [
    loadingMatch,
    formation,
  ]);

  /* =======================================================
     SIMULATE PLAYER MOVEMENT
  ======================================================= */

  const simulatePlayerMovement =
    useCallback(() => {
      if (
        !homeClub ||
        !awayClub ||
        homeXI.length < 11 ||
        awayXI.length < 11
      ) {
        return;
      }

      /*
       * Calculate current team performance
       * from REAL player OVR.
       */

      const homePerformance =
        calculateTeamPerformance({
          players: homeXI,
          formation,
          tactic,
          mentality,
          stamina:
            staminaRef.current.home,
          isHome: true,
        });

      const awayPerformance =
        calculateTeamPerformance({
          players: awayXI,
          formation,
          tactic,
          mentality:
            'balanced',
          stamina:
            staminaRef.current.away,
          isHome: false,
        });

      /*
       * Midfield controls possession.
       */

      const midfieldDifference =
        homePerformance.midfield -
        awayPerformance.midfield;

      const possessionShift =
        clamp(
          midfieldDifference *
            0.003,
          -0.35,
          0.35
        );

      const currentHomePossession =
        safeNumber(
          statsRef.current.home
            .possession,
          50
        );

      const nextHomePossession =
        clamp(
          currentHomePossession +
            possessionShift +
            (Math.random() -
              0.5) *
              0.04,
          20,
          80
        );

      const nextAwayPossession =
        100 -
        nextHomePossession;

      statsRef.current.home.possession =
        Number(
          nextHomePossession.toFixed(
            2
          )
        );

      statsRef.current.away.possession =
        Number(
          nextAwayPossession.toFixed(
            2
          )
        );

      /*
       * Choose team with possession.
       */

      const homePossessionChance =
        nextHomePossession /
        100;

      const team =
        Math.random() <
        homePossessionChance
          ? 'home'
          : 'away';

      const players =
        team === 'home'
          ? homeXI
          : awayXI;

      const opponentPlayers =
        team === 'home'
          ? awayXI
          : homeXI;

      const attackingPerformance =
        team === 'home'
          ? homePerformance
          : awayPerformance;

      const defendingPerformance =
        team === 'home'
          ? awayPerformance
          : homePerformance;

      const attackingMeshes =
        team === 'home'
          ? playerMeshesRef.current.home
          : playerMeshesRef.current.away;

      const defendingMeshes =
        team === 'home'
          ? playerMeshesRef.current.away
          : playerMeshesRef.current.home;

      /*
       * Select player weighted by role.
       */

      const attackerCandidates =
        players.filter(
          (player) => {
            const position =
              normalizePosition(
                getPlayerPosition(
                  player
                )
              );

            return (
              position === 'ATT' ||
              position === 'MID'
            );
          }
        );

      const selectedPlayer =
        getBestPlayer(
          attackerCandidates
        ) ||
        pick(players);

      if (!selectedPlayer) {
        return;
      }

      const playerIndex =
        players.findIndex(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              playerId(
                selectedPlayer
              )
            )
        );

      if (
        playerIndex < 0 ||
        !attackingMeshes[playerIndex]
      ) {
        return;
      }

      ballPossessionRef.current = {
        team,
        playerIndex,
      };

      const currentPlayer =
        attackingMeshes[playerIndex];

      const playerPosition =
        normalizePosition(
          getPlayerPosition(
            selectedPlayer
          )
        );

      const playerOverall =
        getPlayerOverall(
          selectedPlayer
        );

      /*
       * Stamina decreases according to workload.
       */

      const pid =
        playerId(
          selectedPlayer
        );

      const stamina =
        team === 'home'
          ? staminaRef.current.home
          : staminaRef.current.away;

      if (
        pid &&
        stamina[pid] !== undefined
      ) {
        const staminaLoss =
          playerPosition === 'ATT'
            ? 0.35
            : playerPosition === 'MID'
              ? 0.45
              : 0.25;

        stamina[pid] =
          clamp(
            safeNumber(
              stamina[pid],
              100
            ) - staminaLoss,
            0,
            100
          );
      }

      /*
       * Tactic action.
       */

      const tacticData =
        TACTICS[tactic] ||
        TACTICS['Tiki-Taka'];

      const actionRandom =
        Math.random();

      /*
       * PASS
       */

      if (
        actionRandom <
        tacticData.passChance
      ) {
        const teammates =
          players.filter(
            (player) =>
              String(
                playerId(player)
              ) !==
              String(
                playerId(
                  selectedPlayer
                )
              )
          );

        const teammate =
          pick(teammates);

        if (teammate) {
          const teammateIndex =
            players.findIndex(
              (player) =>
                String(
                  playerId(player)
                ) ===
                String(
                  playerId(teammate)
                )
            );

          if (
            teammateIndex >= 0
          ) {
            ballPossessionRef.current = {
              team,
              playerIndex:
                teammateIndex,
            };

            if (
              team === 'home'
            ) {
              statsRef.current.home.passes +=
                1;
            } else {
              statsRef.current.away.passes +=
                1;
            }

            return;
          }
        }
      }

      /*
       * MOVE PLAYER
       */

      const direction =
        team === 'home'
          ? 1
          : -1;

      const newX =
        clamp(
          currentPlayer.position.x +
            direction *
              randomBetweenSafe(
                1,
                3
              ),
          -14,
          14
        );

      const newZ =
        clamp(
          currentPlayer.position.z +
            randomBetweenSafe(
              -2,
              2
            ),
          -9,
          9
        );

      playerTargetsRef.current[
        team
      ][playerIndex] = {
        x: newX,
        z: newZ,
      };

      /*
       * DEFENDING PRESSURE
       */

      const pressChance =
        0.025 +
        (defendingPerformance.defence /
          100) *
          0.045;

      if (
        Math.random() <
        pressChance
      ) {
        if (
          team === 'home'
        ) {
          statsRef.current.away.tackles +=
            1;
        } else {
          statsRef.current.home.tackles +=
            1;
        }

        ballPossessionRef.current = {
          team:
            team === 'home'
              ? 'away'
              : 'home',
          playerIndex:
            Math.floor(
              Math.random() * 11
            ),
        };

        return;
      }

      /*
       * SHOT CHANCE
       *
       * A separate random number is used.
       */

      const shotRandom =
        Math.random();

      const goalX =
        team === 'home'
          ? 14
          : -14;

      const distanceToGoal =
        Math.abs(
          currentPlayer.position.x -
            goalX
        );

      const shotProbability =
        calculateShotProbability({
          attacker:
            selectedPlayer,
          attackingTeam:
            attackingPerformance,
          defendingTeam:
            defendingPerformance,
          attackerPosition:
            playerPosition,
          distanceToGoal,
        });

      /*
       * Better player = better chance
       * of creating a shot.
       */

      const qualityBonus =
        playerOverall >= 85
          ? 0.12
          : playerOverall >= 75
            ? 0.07
            : playerOverall >= 65
              ? 0.03
              : 0;

      const finalShotProbability =
        clamp(
          shotProbability +
            qualityBonus,
          0.02,
          0.65
        );

      if (
        shotRandom <
        finalShotProbability
      ) {
        /*
         * SHOT
         */

        if (
          team === 'home'
        ) {
          statsRef.current.home.shots +=
            1;
        } else {
          statsRef.current.away.shots +=
            1;
        }

        /*
         * Shot on target probability.
         */

        const onTargetProbability =
          clamp(
            0.42 +
              playerOverall /
                100 *
                0.32 +
              attackingPerformance.attack /
                500 -
              defendingPerformance.defence /
                700,
            0.25,
            0.90
          );

        const isOnTarget =
          Math.random() <
          onTargetProbability;

        if (!isOnTarget) {
          const shotEvent = {
            id: `${Date.now()}-shot-${Math.random()}`,
            type:
              EVENT_TYPES.SHOT,
            team,
            minute:
              minuteRef.current,
            playerId:
              playerId(
                selectedPlayer
              ),
            playerName:
              getPlayerName(
                selectedPlayer
              ),
            detail:
              `${getPlayerName(
                selectedPlayer
              )} missed the target.`,
            createdAt:
              new Date().toISOString(),
          };

          eventsRef.current = [
            shotEvent,
            ...eventsRef.current,
          ];

          setEvents(
            [...eventsRef.current]
          );

          return;
        }

        /*
         * SHOT ON TARGET
         */

        if (
          team === 'home'
        ) {
          statsRef.current.home.shotsOnTarget +=
            1;
        } else {
          statsRef.current.away.shotsOnTarget +=
            1;
        }

        /*
         * GOAL PROBABILITY
         *
         * This is where actual player strength,
         * team attack and goalkeeper strength matter.
         */

        const goalProbability =
          calculateGoalProbability({
            attacker:
              selectedPlayer,
            attackingTeam:
              attackingPerformance,
            defendingTeam:
              defendingPerformance,
            distanceToGoal,
          });

        const goalRandom =
          Math.random();

        if (
          goalRandom <
          goalProbability
        ) {
          /*
           * GOAL
           */

          if (
            team === 'home'
          ) {
            scoreRef.current.home +=
              1;
          } else {
            scoreRef.current.away +=
              1;
          }

          setHomeScore(
            scoreRef.current.home
          );

          setAwayScore(
            scoreRef.current.away
          );

          const goalEvent = {
            id: `${Date.now()}-goal-${Math.random()}`,
            type:
              EVENT_TYPES.GOAL,
            team,
            minute:
              minuteRef.current,
            playerId:
              playerId(
                selectedPlayer
              ),
            playerName:
              getPlayerName(
                selectedPlayer
              ),
            detail:
              `${getPlayerName(
                selectedPlayer
              )} scored!`,
            createdAt:
              new Date().toISOString(),
          };

          eventsRef.current = [
            goalEvent,
            ...eventsRef.current,
          ];

          setEvents(
            [...eventsRef.current]
          );

          ballPossessionRef.current =
            null;
        } else {
          /*
           * SAVE
           */

          if (
            team === 'home'
          ) {
            statsRef.current.away.saves +=
              1;
          } else {
            statsRef.current.home.saves +=
              1;
          }

          const goalkeeper =
            getBestPlayer(
              opponentPlayers,
              ['GK']
            );

          const saveEvent = {
            id: `${Date.now()}-save-${Math.random()}`,
            type:
              EVENT_TYPES.SAVE,
            team:
              team === 'home'
                ? 'away'
                : 'home',
            minute:
              minuteRef.current,
            playerId:
              playerId(
                goalkeeper
              ),
            playerName:
              goalkeeper
                ? getPlayerName(
                    goalkeeper
                  )
                : 'Goalkeeper',
            detail:
              goalkeeper
                ? `${getPlayerName(
                    goalkeeper
                  )} made a save.`
                : 'Goalkeeper made a save.',
            createdAt:
              new Date().toISOString(),
          };

          eventsRef.current = [
            saveEvent,
            ...eventsRef.current,
          ];

          setEvents(
            [...eventsRef.current]
          );

          ballPossessionRef.current =
            {
              team:
                team === 'home'
                  ? 'away'
                  : 'home',
              playerIndex: 0,
            };
        }

        return;
      }

      /*
       * FOUL
       */

      const foulChance =
        0.018 +
        tacticData.pressIntensity *
          0.025;

      if (
        Math.random() <
        foulChance
      ) {
        if (
          team === 'home'
        ) {
          statsRef.current.home.fouls +=
            1;
        } else {
          statsRef.current.away.fouls +=
            1;
        }

        const foulEvent = {
          id: `${Date.now()}-foul-${Math.random()}`,
          type:
            EVENT_TYPES.FOUL,
          team,
          minute:
            minuteRef.current,
          playerId:
            playerId(
              selectedPlayer
            ),
          playerName:
            getPlayerName(
              selectedPlayer
            ),
          detail:
            'Foul committed.',
          createdAt:
            new Date().toISOString(),
        };

        eventsRef.current = [
          foulEvent,
          ...eventsRef.current,
        ];

        setEvents(
          [...eventsRef.current]
        );
      }

      /*
       * CORNER
       */

      if (
        Math.random() <
        0.018
      ) {
        if (
          team === 'home'
        ) {
          statsRef.current.home.corners +=
            1;
        } else {
          statsRef.current.away.corners +=
            1;
        }

        const cornerEvent = {
          id: `${Date.now()}-corner-${Math.random()}`,
          type:
            EVENT_TYPES.CORNER,
          team,
          minute:
            minuteRef.current,
          playerName:
            getPlayerName(
              selectedPlayer
            ),
          detail:
            'Corner kick.',
          createdAt:
            new Date().toISOString(),
        };

        eventsRef.current = [
          cornerEvent,
          ...eventsRef.current,
        ];

        setEvents(
          [...eventsRef.current]
        );
      }

      /*
       * UPDATE UI STATS
       */

      setHomeStats({
        ...statsRef.current.home,
      });

      setAwayStats({
        ...statsRef.current.away,
      });

      setPlayerStamina({
        home: {
          ...staminaRef.current.home,
        },
        away: {
          ...staminaRef.current.away,
        },
      });
    }, [
      homeClub,
      awayClub,
      homeXI,
      awayXI,
      formation,
      tactic,
      mentality,
    ]);

  /* =======================================================
     SAVE MATCH
  ======================================================= */

  const saveMatchState =
    useCallback(
      async ({
        minute,
        homeScoreValue,
        awayScoreValue,
        eventsValue,
        homeStatsValue,
        awayStatsValue,
        statusValue,
        substitutionsValue,
        mentalityValue,
        formationValue,
        tacticValue,
        injuryFirstHalf,
        injurySecondHalf,
        extra = {},
      }) => {
        if (!matchId) {
          return;
        }

        const matchRef =
          doc(
            db,
            'matches',
            matchId
          );

        const finalHomeScore =
          safeNumber(
            homeScoreValue,
            scoreRef.current.home
          );

        const finalAwayScore =
          safeNumber(
            awayScoreValue,
            scoreRef.current.away
          );

        const finalMinute =
          safeNumber(
            minute,
            minuteRef.current
          );

        const finalEvents =
          Array.isArray(
            eventsValue
          )
            ? eventsValue
            : eventsRef.current;

        scoreRef.current = {
          home: finalHomeScore,
          away: finalAwayScore,
        };

        minuteRef.current =
          finalMinute;

        eventsRef.current =
          finalEvents;

        await setDoc(
          matchRef,
          {
            id: matchId,

            status:
              statusValue ||
              'live',

            minute:
              finalMinute,

            homeScore:
              finalHomeScore,

            awayScore:
              finalAwayScore,

            result: {
              homeScore:
                finalHomeScore,

              awayScore:
                finalAwayScore,
            },

            events:
              finalEvents,

            homeStats:
              homeStatsValue ||
              statsRef.current.home,

            awayStats:
              awayStatsValue ||
              statsRef.current.away,

            substitutionsUsed:
              safeNumber(
                substitutionsValue,
                0
              ),

            mentality:
              mentalityValue ||
              'balanced',

            formation:
              formationValue ||
              '4-4-2',

            tactic:
              tacticValue ||
              'Tiki-Taka',

            injuryTimeFirstHalf:
              safeNumber(
                injuryFirstHalf,
                0
              ),

            injuryTimeSecondHalf:
              safeNumber(
                injurySecondHalf,
                0
              ),

            updatedAt:
              serverTimestamp(),

            ...extra,
          },
          {
            merge: true,
          }
        );
      },
      [matchId]
    );

  /* =======================================================
     SIMULATE MINUTE
  ======================================================= */

  const simulateMinute =
    useCallback(
      async (minute) => {
        if (
          processingRef.current
        ) {
          return;
        }

        processingRef.current =
          true;

        try {
          minuteRef.current =
            minute;

          /*
           * Ten simulation actions per game minute.
           *
           * Better players get better actions
           * because every action uses their OVR.
           */

          for (
            let i = 0;
            i < 10;
            i += 1
          ) {
            simulatePlayerMovement();
          }

          const currentHomeScore =
            scoreRef.current.home;

          const currentAwayScore =
            scoreRef.current.away;

          const currentEvents =
            eventsRef.current;

          setHomeScore(
            currentHomeScore
          );

          setAwayScore(
            currentAwayScore
          );

          await saveMatchState({
            minute,

            homeScoreValue:
              currentHomeScore,

            awayScoreValue:
              currentAwayScore,

            eventsValue:
              currentEvents,

            homeStatsValue:
              statsRef.current.home,

            awayStatsValue:
              statsRef.current.away,

            statusValue:
              'live',

            substitutionsValue:
              substitutionsUsed,

            mentalityValue:
              mentality,

            formationValue:
              formation,

            tacticValue:
              tactic,

            injuryFirstHalf:
              injuryTimeFirstHalf,

            injurySecondHalf:
              injuryTimeSecondHalf,
          });
        } catch (error) {
          console.error(
            'Simulation error:',
            error
          );
        } finally {
          processingRef.current =
            false;
        }
      },
      [
        simulatePlayerMovement,
        saveMatchState,
        substitutionsUsed,
        mentality,
        formation,
        tactic,
        injuryTimeFirstHalf,
        injuryTimeSecondHalf,
      ]
    );

  /* =======================================================
     START MATCH
  ======================================================= */

  const startMatch =
    useCallback(
      async () => {
        if (
          !fixture ||
          !userIsParticipant
        ) {
          toast.error(
            'You are not managing a team in this match.'
          );

          return;
        }

        if (
          homeXI.length <
            PLAYERS_ON_PITCH ||
          awayXI.length <
            PLAYERS_ON_PITCH
        ) {
          toast.error(
            'Both teams need a starting XI.'
          );

          return;
        }

        if (
          matchStatus ===
          'finished'
        ) {
          toast.error(
            'This match has already finished.'
          );

          return;
        }

        try {
          setSavingMatch(true);

          scoreRef.current = {
            home: homeScore,
            away: awayScore,
          };

          await saveMatchState({
            minute: 0,

            homeScoreValue:
              homeScore,

            awayScoreValue:
              awayScore,

            eventsValue:
              events,

            homeStatsValue:
              homeStats,

            awayStatsValue:
              awayStats,

            statusValue:
              'live',

            substitutionsValue:
              substitutionsUsed,

            mentalityValue:
              mentality,

            formationValue:
              formation,

            tacticValue:
              tactic,

            injuryFirstHalf:
              injuryTimeFirstHalf,

            injurySecondHalf:
              injuryTimeSecondHalf,
          });

          setMatchStatus(
            'live'
          );

          setPaused(false);

          toast.success(
            'Match started'
          );
        } catch (error) {
          console.error(
            error
          );

          toast.error(
            'Could not start match'
          );
        } finally {
          setSavingMatch(false);
        }
      },
      [
        fixture,
        userIsParticipant,
        homeXI,
        awayXI,
        matchStatus,
        homeScore,
        awayScore,
        events,
        homeStats,
        awayStats,
        substitutionsUsed,
        mentality,
        formation,
        tactic,
        injuryTimeFirstHalf,
        injuryTimeSecondHalf,
        saveMatchState,
      ]
    );

  /* =======================================================
     TIMER
  ======================================================= */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      paused
    ) {
      return;
    }

    timerRef.current =
      setInterval(() => {
        setMatchMinute(
          (previous) => {
            const next =
              previous +
              TICK_SECONDS;

            minuteRef.current =
              next;

            const firstHalfTotal =
              FIRST_HALF_END +
              injuryTimeFirstHalf;

            if (
              next ===
                firstHalfTotal &&
              previous <
                firstHalfTotal
            ) {
              setMatchStatus(
                'half-time'
              );

              setHalfTimeShown(
                true
              );

              return next;
            }

            const fullMatchTotal =
              MATCH_DURATION +
              injuryTimeFirstHalf +
              injuryTimeSecondHalf;

            if (
              next >=
              fullMatchTotal
            ) {
              return fullMatchTotal;
            }

            return next;
          }
        );
      }, MATCH_TICK_MS);

    return () => {
      if (
        timerRef.current
      ) {
        clearInterval(
          timerRef.current
        );

        timerRef.current =
          null;
      }
    };
  }, [
    matchStatus,
    paused,
    injuryTimeFirstHalf,
    injuryTimeSecondHalf,
  ]);

  /* =======================================================
     FULL MATCH DURATION
  ======================================================= */

  const fullMatchDuration =
    MATCH_DURATION +
    injuryTimeFirstHalf +
    injuryTimeSecondHalf;

  /* =======================================================
     SIMULATE CURRENT MINUTE
  ======================================================= */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      paused ||
      matchMinute <= 0 ||
      matchMinute >=
        fullMatchDuration
    ) {
      return;
    }

    simulateMinute(
      matchMinute
    );
  }, [
    matchMinute,
    matchStatus,
    paused,
    simulateMinute,
    fullMatchDuration,
  ]);

  /* =======================================================
     CONTINUE SECOND HALF
  ======================================================= */

  const continueSecondHalf =
    async () => {
      try {
        setSavingMatch(true);

        const halftimeMinute =
          FIRST_HALF_END +
          injuryTimeFirstHalf;

        minuteRef.current =
          halftimeMinute;

        await saveMatchState({
          minute:
            halftimeMinute,

          homeScoreValue:
            scoreRef.current.home,

          awayScoreValue:
            scoreRef.current.away,

          eventsValue:
            eventsRef.current,

          homeStatsValue:
            statsRef.current.home,

          awayStatsValue:
            statsRef.current.away,

          statusValue:
            'live',

          substitutionsValue:
            substitutionsUsed,

          mentalityValue:
            mentality,

          formationValue:
            formation,

          tacticValue:
            tactic,

          injuryFirstHalf:
            injuryTimeFirstHalf,

          injurySecondHalf:
            injuryTimeSecondHalf,
        });

        setMatchMinute(
          halftimeMinute
        );

        setHalfTimeShown(
          false
        );

        setMatchStatus(
          'live'
        );

        setPaused(false);
      } catch (error) {
        console.error(
          error
        );

        toast.error(
          'Could not continue match'
        );
      } finally {
        setSavingMatch(false);
      }
    };

  /* =======================================================
     FINISH MATCH
  ======================================================= */

  const finishMatch =
    useCallback(
      async () => {
        if (
          matchStatus ===
          'finished'
        ) {
          return;
        }

        try {
          setSavingMatch(true);

          const finalHomeScore =
            scoreRef.current.home;

          const finalAwayScore =
            scoreRef.current.away;

          const finalMinute =
            MATCH_DURATION +
            injuryTimeFirstHalf +
            injuryTimeSecondHalf;

          const finalResult = {
            homeScore:
              finalHomeScore,

            awayScore:
              finalAwayScore,
          };

          await saveMatchState({
            minute:
              finalMinute,

            homeScoreValue:
              finalHomeScore,

            awayScoreValue:
              finalAwayScore,

            eventsValue:
              eventsRef.current,

            homeStatsValue:
              statsRef.current.home,

            awayStatsValue:
              statsRef.current.away,

            statusValue:
              'finished',

            substitutionsValue:
              substitutionsUsed,

            mentalityValue:
              mentality,

            formationValue:
              formation,

            tacticValue:
              tactic,

            injuryFirstHalf:
              injuryTimeFirstHalf,

            injurySecondHalf:
              injuryTimeSecondHalf,

            extra: {
              result:
                finalResult,

              finishedAt:
                serverTimestamp(),

              playedBy:
                user?.uid ||
                null,
            },
          });

          setHomeScore(
            finalHomeScore
          );

          setAwayScore(
            finalAwayScore
          );

          setMatchMinute(
            finalMinute
          );

          setMatchStatus(
            'finished'
          );

          setPaused(true);

          toast.success(
            `Full time: ${finalHomeScore} - ${finalAwayScore}`
          );
        } catch (error) {
          console.error(
            'Finish match error:',
            error
          );

          toast.error(
            'Could not save final result'
          );
        } finally {
          setSavingMatch(false);
        }
      },
      [
        matchStatus,
        injuryTimeFirstHalf,
        injuryTimeSecondHalf,
        substitutionsUsed,
        mentality,
        formation,
        tactic,
        user,
        saveMatchState,
      ]
    );

  /* =======================================================
     AUTO FINISH
  ======================================================= */

  useEffect(() => {
    if (
      matchStatus ===
        'live' &&
      matchMinute >=
        fullMatchDuration
    ) {
      finishMatch();
    }
  }, [
    matchMinute,
    matchStatus,
    finishMatch,
    fullMatchDuration,
  ]);

  /* =======================================================
     PAUSE
  ======================================================= */

  const togglePause =
    () => {
      if (
        matchStatus !==
        'live'
      ) {
        return;
      }

      setPaused(
        (previous) =>
          !previous
      );
    };

  /* =======================================================
     CHANGE FORMATION
  ======================================================= */

  const changeFormation =
    async (value) => {
      setFormation(value);

      const startingHome =
        selectStartingXI(
          homeSquad,
          value
        );

      const startingAway =
        selectStartingXI(
          awaySquad,
          value
        );

      setHomeXI(
        startingHome
      );

      setAwayXI(
        startingAway
      );

      setHomeBench(
        homeSquad.filter(
          (player) =>
            !startingHome.some(
              (starter) =>
                String(
                  playerId(starter)
                ) ===
                String(
                  playerId(player)
                )
            )
        )
      );

      setAwayBench(
        awaySquad.filter(
          (player) =>
            !startingAway.some(
              (starter) =>
                String(
                  playerId(starter)
                ) ===
                String(
                  playerId(player)
                )
            )
        )
      );

      if (
        matchStatus !==
        'ready'
      ) {
        await saveMatchState({
          minute:
            minuteRef.current,

          homeScoreValue:
            scoreRef.current.home,

          awayScoreValue:
            scoreRef.current.away,

          eventsValue:
            eventsRef.current,

          homeStatsValue:
            statsRef.current.home,

          awayStatsValue:
            statsRef.current.away,

          statusValue:
            matchStatus,

          substitutionsValue:
            substitutionsUsed,

          mentalityValue:
            mentality,

          formationValue:
            value,

          tacticValue:
            tactic,

          injuryFirstHalf:
            injuryTimeFirstHalf,

          injurySecondHalf:
            injuryTimeSecondHalf,
        });
      }

      toast.success(
        `Formation changed to ${value}`
      );
    };

  /* =======================================================
     CHANGE TACTIC
  ======================================================= */

  const changeTactic =
    async (value) => {
      setTactic(value);

      if (
        matchStatus !==
        'ready'
      ) {
        await saveMatchState({
          minute:
            minuteRef.current,

          homeScoreValue:
            scoreRef.current.home,

          awayScoreValue:
            scoreRef.current.away,

          eventsValue:
            eventsRef.current,

          homeStatsValue:
            statsRef.current.home,

          awayStatsValue:
            statsRef.current.away,

          statusValue:
            matchStatus,

          substitutionsValue:
            substitutionsUsed,

          mentalityValue:
            mentality,

          formationValue:
            formation,

          tacticValue:
            value,

          injuryFirstHalf:
            injuryTimeFirstHalf,

          injurySecondHalf:
            injuryTimeSecondHalf,
        });
      }

      toast.success(
        `Tactic changed to ${value}`
      );
    };

  /* =======================================================
     CHANGE MENTALITY
  ======================================================= */

  const changeMentality =
    async (value) => {
      setMentality(value);

      try {
        await saveMatchState({
          minute:
            minuteRef.current,

          homeScoreValue:
            scoreRef.current.home,

          awayScoreValue:
            scoreRef.current.away,

          eventsValue:
            eventsRef.current,

          homeStatsValue:
            statsRef.current.home,

          awayStatsValue:
            statsRef.current.away,

          statusValue:
            matchStatus ===
            'ready'
              ? 'ready'
              : matchStatus,

          substitutionsValue:
            substitutionsUsed,

          mentalityValue:
            value,

          formationValue:
            formation,

          tacticValue:
            tactic,

          injuryFirstHalf:
            injuryTimeFirstHalf,

          injurySecondHalf:
            injuryTimeSecondHalf,
        });
      } catch (error) {
        console.error(
          error
        );
      }
    };

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  const makeSubstitution =
    async () => {
      if (
        !userIsParticipant
      ) {
        return;
      }

      if (
        substitutionsUsed >=
        MAX_SUBSTITUTIONS
      ) {
        toast.error(
          'Maximum substitutions reached.'
        );

        return;
      }

      if (
        !selectedSubIn ||
        !selectedSubOut
      ) {
        toast.error(
          'Select player IN and player OUT.'
        );

        return;
      }

      const team =
        userTeam === 'home'
          ? 'home'
          : 'away';

      const currentXI =
        team === 'home'
          ? homeXI
          : awayXI;

      const bench =
        team === 'home'
          ? homeBench
          : awayBench;

      const playerIn =
        bench.find(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              selectedSubIn
            )
        );

      const playerOut =
        currentXI.find(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              selectedSubOut
            )
        );

      if (
        !playerIn ||
        !playerOut
      ) {
        toast.error(
          'Invalid selection.'
        );

        return;
      }

      const nextXI =
        currentXI.map(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              playerId(playerOut)
            )
              ? playerIn
              : player
        );

      const nextBench = [
        ...bench.filter(
          (player) =>
            String(
              playerId(player)
            ) !==
            String(
              playerId(playerIn)
            )
        ),

        playerOut,
      ];

      const nextSubCount =
        substitutionsUsed +
        1;

      const event = {
        id: `${Date.now()}-substitution`,
        type:
          EVENT_TYPES.SUBSTITUTION,
        team,
        minute:
          minuteRef.current,
        playerId:
          playerId(playerIn),
        playerName:
          getPlayerName(
            playerIn
          ),
        detail:
          `${getPlayerName(
            playerIn
          )} replaced ${getPlayerName(
            playerOut
          )}`,
        createdAt:
          new Date().toISOString(),
      };

      const nextEvents = [
        event,
        ...eventsRef.current,
      ];

      if (
        team === 'home'
      ) {
        setHomeXI(
          nextXI
        );

        setHomeBench(
          nextBench
        );
      } else {
        setAwayXI(
          nextXI
        );

        setAwayBench(
          nextBench
        );
      }

      /*
       * Give substitute stamina
       * based on actual player.
       */

      const playerInId =
        playerId(playerIn);

      const playerOutId =
        playerId(playerOut);

      const teamStamina =
        team === 'home'
          ? staminaRef.current.home
          : staminaRef.current.away;

      teamStamina[
        playerInId
      ] = 100;

      delete teamStamina[
        playerOutId
      ];

      staminaRef.current[
        team
      ] = teamStamina;

      setPlayerStamina({
        home: {
          ...staminaRef.current.home,
        },

        away: {
          ...staminaRef.current.away,
        },
      });

      setSubstitutionsUsed(
        nextSubCount
      );

      eventsRef.current =
        nextEvents;

      setEvents(
        [...nextEvents]
      );

      setSelectedSubIn('');
      setSelectedSubOut('');

      await saveMatchState({
        minute:
          minuteRef.current,

        homeScoreValue:
          scoreRef.current.home,

        awayScoreValue:
          scoreRef.current.away,

        eventsValue:
          nextEvents,

        homeStatsValue:
          statsRef.current.home,

        awayStatsValue:
          statsRef.current.away,

        statusValue:
          matchStatus,

        substitutionsValue:
          nextSubCount,

        mentalityValue:
          mentality,

        formationValue:
          formation,

        tacticValue:
          tactic,

        injuryFirstHalf:
          injuryTimeFirstHalf,

        injurySecondHalf:
          injuryTimeSecondHalf,

        extra: {
          [`${team}XI`]:
            nextXI.map(
              (player) =>
                playerId(player)
            ),
        },
      });

      toast.success(
        'Substitution made'
      );
    };

  /* =======================================================
     TEAM STRENGTH DISPLAY
  ======================================================= */

  const homeTeamStrength =
    useMemo(
      () =>
        calculateTeamStrength(
          homeXI
        ),
      [homeXI]
    );

  const awayTeamStrength =
    useMemo(
      () =>
        calculateTeamStrength(
          awayXI
        ),
      [awayXI]
    );

  /* =======================================================
     EVENTS
  ======================================================= */

  const sortedEvents =
    useMemo(
      () =>
        [...events].sort(
          (a, b) =>
            safeNumber(
              b.minute
            ) -
            safeNumber(
              a.minute
            )
        ),
      [events]
    );

  /* =======================================================
     STATUS
  ======================================================= */

  const statusLabel =
    useMemo(() => {
      switch (
        matchStatus
      ) {
        case 'ready':
          return 'READY';

        case 'live':
          return paused
            ? 'PAUSED'
            : 'LIVE';

        case 'half-time':
          return 'HALF TIME';

        case 'finished':
          return 'FULL TIME';

        default:
          return 'LOADING';
      }
    }, [
      matchStatus,
      paused,
    ]);

  /* =======================================================
     DISPLAY MINUTE
  ======================================================= */

  const displayMinute =
    matchMinute >
    MATCH_DURATION
      ? `${MATCH_DURATION}+${matchMinute - MATCH_DURATION}`
      : matchMinute;

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    loadingMatch
  ) {
    return (
      <main
        className={
          styles.loading
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <p>
          Loading match...
        </p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  if (
    !fixture ||
    !homeClub ||
    !awayClub
  ) {
    return (
      <main
        className={
          styles.emptyPage
        }
      >
        <div
          className={
            styles.emptyIcon
          }
        >
          ⚽
        </div>

        <h1>
          Match not found
        </h1>

        <p>
          This match does not
          exist in the database.
        </p>

        <button
          type="button"
          onClick={() =>
            router.push(
              '/fixtures'
            )
          }
        >
          Back to Fixtures
        </button>
      </main>
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          {getClubName(
            homeClub
          )}{' '}
          vs{' '}
          {getClubName(
            awayClub
          )}
        </title>

        <meta
          name="description"
          content={`Live match between ${getClubName(
            homeClub
          )} and ${getClubName(
            awayClub
          )}`}
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* HEADER */}

        <header
          className={
            styles.header
          }
        >
          <button
            type="button"
            className={
              styles.backButton
            }
            onClick={() =>
              router.push(
                '/fixtures'
              )
            }
          >
            ← Fixtures
          </button>

          <div>
            <span
              className={
                styles.competition
              }
            >
              {fixture.leagueName ||
                fixture.competition ||
                'MATCH'}
            </span>

            <h1>
              Match Centre
            </h1>
          </div>

          <span
            className={
              styles.status
            }
          >
            {statusLabel}
          </span>
        </header>

        {/* 3D PITCH */}

        <div
          ref={mountRef}
          className={
            styles.threeContainer
          }
        />

        {/* SCOREBOARD */}

        <section
          className={
            styles.scoreboard
          }
          style={{
            '--home-color':
              getClubPrimaryColor(
                homeClub
              ),

            '--away-color':
              getClubPrimaryColor(
                awayClub
              ),
          }}
        >
          <div
            className={
              styles.scoreTeam
            }
          >
            <div
              className={
                styles.clubLogo
              }
            >
              {getClubLogo(
                homeClub
              ) ? (
                <img
                  src={getClubLogo(
                    homeClub
                  )}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <strong>
              {getClubName(
                homeClub
              )}
            </strong>

            <span>
              HOME
            </span>
          </div>

          <div
            className={
              styles.scoreMiddle
            }
          >
            <div
              className={
                styles.score
              }
            >
              <strong>
                {homeScore}
              </strong>

              <span>
                -
              </span>

              <strong>
                {awayScore}
              </strong>
            </div>

            <div
              className={
                styles.matchClock
              }
            >
              {displayMinute}'
            </div>

            <small>
              {statusLabel}
            </small>
          </div>

          <div
            className={
              styles.scoreTeam
            }
          >
            <div
              className={
                styles.clubLogo
              }
            >
              {getClubLogo(
                awayClub
              ) ? (
                <img
                  src={getClubLogo(
                    awayClub
                  )}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <strong>
              {getClubName(
                awayClub
              )}
            </strong>

            <span>
              AWAY
            </span>
          </div>
        </section>

        {/* TEAM STRENGTH */}

        <section
          className={
            styles.latestScore
          }
        >
          <div>
            <span>
              HOME OVR
            </span>

            <strong>
              {Math.round(
                homeTeamStrength
              )}
            </strong>
          </div>

          <div>
            <span>
              AWAY OVR
            </span>

            <strong>
              {Math.round(
                awayTeamStrength
              )}
            </strong>
          </div>

          <div>
            <span>
              FORMATION
            </span>

            <strong>
              {formation}
            </strong>
          </div>

          <div>
            <span>
              TACTIC
            </span>

            <strong>
              {tactic}
            </strong>
          </div>

          <div>
            <span>
              MENTALITY
            </span>

            <strong>
              {mentality}
            </strong>
          </div>

          <div>
            <span>
              INJURY TIME
            </span>

            <strong>
              +{injuryTimeFirstHalf} / +
              {injuryTimeSecondHalf}
            </strong>
          </div>
        </section>

        {/* ACCESS WARNING */}

        {!userIsParticipant && (
          <section
            className={
              styles.warning
            }
          >
            <strong>
              View only
            </strong>

            <p>
              Your current club is
              not participating in
              this match. You can
              view the latest score
              and events, but you
              cannot play it.
            </p>
          </section>
        )}

        {/* CONTROLS */}

        {userIsParticipant && (
          <section
            className={
              styles.controls
            }
          >
            {matchStatus ===
              'ready' && (
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={
                  startMatch
                }
                disabled={
                  savingMatch
                }
              >
                ▶ START MATCH
              </button>
            )}

            {matchStatus ===
              'live' && (
              <button
                type="button"
                onClick={
                  togglePause
                }
              >
                {paused
                  ? '▶ Resume'
                  : 'Ⅱ Pause'}
              </button>
            )}

            {matchStatus ===
              'half-time' && (
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={
                  continueSecondHalf
                }
                disabled={
                  savingMatch
                }
              >
                ▶ START SECOND HALF
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setShowFormation(
                  (previous) =>
                    !previous
                )
              }
            >
              📋 Formation
            </button>

            <button
              type="button"
              onClick={() =>
                setShowTactics(
                  (previous) =>
                    !previous
                )
              }
            >
              ⚙ Tactics
            </button>

            <button
              type="button"
              onClick={() =>
                setShowSubs(
                  (previous) =>
                    !previous
                )
              }
            >
              🔄 Substitutions
            </button>
          </section>
        )}

        {/* HALF TIME */}

        {halfTimeShown && (
          <section
            className={
              styles.halfTime
            }
          >
            <span>
              HALF TIME
            </span>

            <strong>
              {homeScore} -{' '}
              {awayScore}
            </strong>

            <button
              type="button"
              onClick={
                continueSecondHalf
              }
              disabled={
                savingMatch
              }
            >
              Continue
            </button>
          </section>
        )}

        {/* FORMATION */}

        {showFormation &&
          userIsParticipant && (
            <section
              className={
                styles.panel
              }
            >
              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Formation
                </h2>

                <span>
                  {formation}
                </span>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Object.keys(
                  FORMATIONS
                ).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        formation ===
                        value
                          ? styles.active
                          : ''
                      }
                      onClick={() =>
                        changeFormation(
                          value
                        )
                      }
                    >
                      {value}
                    </button>
                  )
                )}
              </div>
            </section>
          )}

        {/* TACTICS */}

        {showTactics &&
          userIsParticipant && (
            <section
              className={
                styles.panel
              }
            >
              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Tactics
                </h2>

                <span>
                  {tactic}
                </span>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Object.keys(
                  TACTICS
                ).map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        tactic ===
                        value
                          ? styles.active
                          : ''
                      }
                      onClick={() =>
                        changeTactic(
                          value
                        )
                      }
                    >
                      {value}
                    </button>
                  )
                )}
              </div>

              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Mentality
                </h2>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {[
                  'defensive',
                  'balanced',
                  'attacking',
                ].map(
                  (value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        mentality ===
                        value
                          ? styles.active
                          : ''
                      }
                      onClick={() =>
                        changeMentality(
                          value
                        )
                      }
                    >
                      {value
                        .charAt(0)
                        .toUpperCase() +
                        value.slice(
                          1
                        )}
                    </button>
                  )
                )}
              </div>
            </section>
          )}

        {/* SUBSTITUTIONS */}

        {showSubs &&
          userIsParticipant && (
            <section
              className={
                styles.panel
              }
            >
              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Substitutions
                </h2>

                <span>
                  {
                    substitutionsUsed
                  }
                  /
                  {
                    MAX_SUBSTITUTIONS
                  }
                </span>
              </div>

              <div
                className={
                  styles.subRow
                }
              >
                <label>
                  Player IN
                  (from bench)
                </label>

                <select
                  value={
                    selectedSubIn
                  }
                  onChange={(
                    event
                  ) =>
                    setSelectedSubIn(
                      event.target
                        .value
                    )
                  }
                >
                  <option value="">
                    Select player IN
                  </option>

                  {(userTeam ===
                  'home'
                    ? homeBench
                    : awayBench
                  ).map(
                    (player) => (
                      <option
                        key={String(
                          playerId(
                            player
                          )
                        )}
                        value={String(
                          playerId(
                            player
                          )
                        )}
                      >
                        {getPlayerName(
                          player
                        )}{' '}
                        · OVR{' '}
                        {getPlayerOverall(
                          player
                        )}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div
                className={
                  styles.subRow
                }
              >
                <label>
                  Player OUT
                  (from pitch)
                </label>

                <select
                  value={
                    selectedSubOut
                  }
                  onChange={(
                    event
                  ) =>
                    setSelectedSubOut(
                      event.target
                        .value
                    )
                  }
                >
                  <option value="">
                    Select player OUT
                  </option>

                  {(userTeam ===
                  'home'
                    ? homeXI
                    : awayXI
                  ).map(
                    (player) => (
                      <option
                        key={String(
                          playerId(
                            player
                          )
                        )}
                        value={String(
                          playerId(
                            player
                          )
                        )}
                      >
                        {getPlayerName(
                          player
                        )}{' '}
                        · OVR{' '}
                        {getPlayerOverall(
                          player
                        )}{' '}
                        · STA{' '}
                        {Math.round(
                          playerStamina[
                            userTeam
                          ]?.[
                            playerId(
                              player
                            )
                          ] || 100
                        )}
                        %
                      </option>
                    )
                  )}
                </select>
              </div>

              <button
                type="button"
                onClick={
                  makeSubstitution
                }
                disabled={
                  substitutionsUsed >=
                    MAX_SUBSTITUTIONS ||
                  !selectedSubIn ||
                  !selectedSubOut
                }
              >
                Make Substitution
              </button>
            </section>
          )}

        {/* LIVE STATS */}

        <section
          className={
            styles.statsSection
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <span>
              MATCH STATISTICS
            </span>

            <strong>
              {homeScore} -{' '}
              {awayScore}
            </strong>
          </div>

          {[
            [
              'Possession',
              formatPossession(
                homeStats.possession
              ),
              formatPossession(
                awayStats.possession
              ),
            ],

            [
              'Shots',
              homeStats.shots,
              awayStats.shots,
            ],

            [
              'Shots on Target',
              homeStats.shotsOnTarget,
              awayStats.shotsOnTarget,
            ],

            [
              'Passes',
              homeStats.passes,
              awayStats.passes,
            ],

            [
              'Fouls',
              homeStats.fouls,
              awayStats.fouls,
            ],

            [
              'Corners',
              homeStats.corners,
              awayStats.corners,
            ],

            [
              'Offsides',
              homeStats.offsides,
              awayStats.offsides,
            ],

            [
              'Yellow Cards',
              homeStats.yellow,
              awayStats.yellow,
            ],

            [
              'Red Cards',
              homeStats.red,
              awayStats.red,
            ],

            [
              'Saves',
              homeStats.saves,
              awayStats.saves,
            ],

            [
              'Tackles',
              homeStats.tackles,
              awayStats.tackles,
            ],
          ].map(
            (row) => (
              <div
                key={row[0]}
                className={
                  styles.statRow
                }
              >
                <strong>
                  {row[1]}
                </strong>

                <span>
                  {row[0]}
                </span>

                <strong>
                  {row[2]}
                </strong>
              </div>
            )
          )}
        </section>

        {/* EVENTS */}

        <section
          className={
            styles.eventsSection
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <div>
              <span>
                LIVE FEED
              </span>

              <h2>
                Match Events
              </h2>
            </div>

            <button
              type="button"
              onClick={() =>
                setShowEvents(
                  (previous) =>
                    !previous
                )
              }
            >
              {showEvents
                ? 'Hide'
                : 'Show'}
            </button>
          </div>

          {showEvents && (
            <div
              className={
                styles.eventsList
              }
            >
              {sortedEvents.length >
              0 ? (
                sortedEvents.map(
                  (event) => (
                    <article
                      key={
                        event.id
                      }
                      className={
                        styles.event
                      }
                    >
                      <span
                        className={
                          styles.eventMinute
                        }
                      >
                        {event.minute >
                        MATCH_DURATION
                          ? `${MATCH_DURATION}+${event.minute - MATCH_DURATION}`
                          : event.minute}
                        '
                      </span>

                      <span
                        className={
                          styles.eventIcon
                        }
                      >
                        {eventIcon(
                          event
                        )}
                      </span>

                      <div>
                        <strong>
                          {eventLabel(
                            event
                          )}
                        </strong>

                        <p>
                          {event.playerName ||
                            event.detail ||
                            'Match event'}
                        </p>
                      </div>

                      <span>
                        {event.team ===
                        'home'
                          ? getClubName(
                              homeClub
                            )
                          : getClubName(
                              awayClub
                            )}
                      </span>
                    </article>
                  )
                )
              ) : (
                <div
                  className={
                    styles.noEvents
                  }
                >
                  No events yet.
                </div>
              )}
            </div>
          )}
        </section>

        {/* LINEUPS */}

        <section
          className={
            styles.lineups
          }
        >
          {/* HOME */}

          <div
            className={
              styles.lineupCard
            }
          >
            <div
              className={
                styles.sectionHeader
              }
            >
              <h2>
                {getClubName(
                  homeClub
                )}
              </h2>

              <span>
                {homeXI.length}/11
                {' · '}
                {formation}
              </span>
            </div>

            <div
              className={
                styles.playerList
              }
            >
              {homeXI.map(
                (player) => {
                  const stamina =
                    Math.round(
                      playerStamina
                        .home?.[
                        playerId(
                          player
                        )
                      ] || 100
                    );

                  return (
                    <div
                      key={String(
                        playerId(
                          player
                        )
                      )}
                      className={
                        styles.player
                      }
                    >
                      {getPlayerPhoto(
                        player
                      ) ? (
                        <img
                          src={getPlayerPhoto(
                            player
                          )}
                          alt=""
                        />
                      ) : (
                        <span>
                          ⚽
                        </span>
                      )}

                      <div>
                        <strong>
                          {getPlayerName(
                            player
                          )}
                        </strong>

                        <small>
                          {normalizePosition(
                            getPlayerPosition(
                              player
                            )
                          )}{' '}
                          · OVR{' '}
                          {getPlayerOverall(
                            player
                          )}
                        </small>
                      </div>

                      <div
                        className={
                          styles.playerMeta
                        }
                      >
                        <span
                          className={
                            styles.playerRating
                          }
                        >
                          {getPlayerOverall(
                            player
                          )}
                        </span>

                        <span
                          className={
                            styles.staminaBar
                          }
                        >
                          <span
                            className={
                              styles.staminaFill
                            }
                            style={{
                              width: `${stamina}%`,
                            }}
                          />
                        </span>

                        <small>
                          {stamina}%
                        </small>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>

          {/* AWAY */}

          <div
            className={
              styles.lineupCard
            }
          >
            <div
              className={
                styles.sectionHeader
              }
            >
              <h2>
                {getClubName(
                  awayClub
                )}
              </h2>

              <span>
                {awayXI.length}/11
                {' · '}
                {formation}
              </span>
            </div>

            <div
              className={
                styles.playerList
              }
            >
              {awayXI.map(
                (player) => {
                  const stamina =
                    Math.round(
                      playerStamina
                        .away?.[
                        playerId(
                          player
                        )
                      ] || 100
                    );

                  return (
                    <div
                      key={String(
                        playerId(
                          player
                        )
                      )}
                      className={
                        styles.player
                      }
                    >
                      {getPlayerPhoto(
                        player
                      ) ? (
                        <img
                          src={getPlayerPhoto(
                            player
                          )}
                          alt=""
                        />
                      ) : (
                        <span>
                          ⚽
                        </span>
                      )}

                      <div>
                        <strong>
                          {getPlayerName(
                            player
                          )}
                        </strong>

                        <small>
                          {normalizePosition(
                            getPlayerPosition(
                              player
                            )
                          )}{' '}
                          · OVR{' '}
                          {getPlayerOverall(
                            player
                          )}
                        </small>
                      </div>

                      <div
                        className={
                          styles.playerMeta
                        }
                      >
                        <span
                          className={
                            styles.playerRating
                          }
                        >
                          {getPlayerOverall(
                            player
                          )}
                        </span>

                        <span
                          className={
                            styles.staminaBar
                          }
                        >
                          <span
                            className={
                              styles.staminaFill
                            }
                            style={{
                              width: `${stamina}%`,
                            }}
                          />
                        </span>

                        <small>
                          {stamina}%
                        </small>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </div>
        </section>

        {/* MATCH INFO */}

        <section
          className={
            styles.matchInfo
          }
        >
          <div>
            <span>
              STADIUM
            </span>

            <strong>
              {fixture.stadium ||
                getClubStadium(
                  homeClub
                )}
            </strong>
          </div>

          <div>
            <span>
              HOME TEAM OVR
            </span>

            <strong>
              {Math.round(
                homeTeamStrength
              )}
            </strong>
          </div>

          <div>
            <span>
              AWAY TEAM OVR
            </span>

            <strong>
              {Math.round(
                awayTeamStrength
              )}
            </strong>
          </div>

          <div>
            <span>
              FORMATION
            </span>

            <strong>
              {formation}
            </strong>
          </div>

          <div>
            <span>
              TACTIC
            </span>

            <strong>
              {tactic}
            </strong>
          </div>

          <div>
            <span>
              MATCH ID
            </span>

            <strong>
              {matchId}
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
