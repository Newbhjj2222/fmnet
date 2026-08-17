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
  onSnapshot,
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

const MATCH_DURATION = 96;
const FIRST_HALF_END = 48;

const PLAYERS_ON_PITCH = 11;
const MAX_SUBSTITUTIONS = 5;

const MATCH_TICK_MS = 1000;
const TICK_SECONDS = 1;

const DEFAULT_STAMINA = 100;
const MIN_STAMINA = 5;

const FORMATIONS = {
  '4-4-2': [
    { x: 8, y: 50, position: 'GK' },

    { x: 24, y: 18, position: 'DEF' },
    { x: 24, y: 39, position: 'DEF' },
    { x: 24, y: 61, position: 'DEF' },
    { x: 24, y: 82, position: 'DEF' },

    { x: 45, y: 18, position: 'MID' },
    { x: 45, y: 39, position: 'MID' },
    { x: 45, y: 61, position: 'MID' },
    { x: 45, y: 82, position: 'MID' },

    { x: 65, y: 38, position: 'ATT' },
    { x: 65, y: 62, position: 'ATT' },
  ],

  '4-3-3': [
    { x: 8, y: 50, position: 'GK' },

    { x: 24, y: 18, position: 'DEF' },
    { x: 24, y: 39, position: 'DEF' },
    { x: 24, y: 61, position: 'DEF' },
    { x: 24, y: 82, position: 'DEF' },

    { x: 45, y: 25, position: 'MID' },
    { x: 45, y: 50, position: 'MID' },
    { x: 45, y: 75, position: 'MID' },

    { x: 67, y: 20, position: 'ATT' },
    { x: 70, y: 50, position: 'ATT' },
    { x: 67, y: 80, position: 'ATT' },
  ],

  '4-2-3-1': [
    { x: 8, y: 50, position: 'GK' },

    { x: 24, y: 18, position: 'DEF' },
    { x: 24, y: 39, position: 'DEF' },
    { x: 24, y: 61, position: 'DEF' },
    { x: 24, y: 82, position: 'DEF' },

    { x: 40, y: 35, position: 'MID' },
    { x: 40, y: 65, position: 'MID' },

    { x: 58, y: 20, position: 'MID' },
    { x: 62, y: 50, position: 'MID' },
    { x: 58, y: 80, position: 'MID' },

    { x: 73, y: 50, position: 'ATT' },
  ],

  '3-5-2': [
    { x: 8, y: 50, position: 'GK' },

    { x: 24, y: 25, position: 'DEF' },
    { x: 24, y: 50, position: 'DEF' },
    { x: 24, y: 75, position: 'DEF' },

    { x: 43, y: 12, position: 'MID' },
    { x: 43, y: 32, position: 'MID' },
    { x: 43, y: 50, position: 'MID' },
    { x: 43, y: 68, position: 'MID' },
    { x: 43, y: 88, position: 'MID' },

    { x: 67, y: 38, position: 'ATT' },
    { x: 67, y: 62, position: 'ATT' },
  ],

  '5-3-2': [
    { x: 8, y: 50, position: 'GK' },

    { x: 22, y: 12, position: 'DEF' },
    { x: 22, y: 31, position: 'DEF' },
    { x: 22, y: 50, position: 'DEF' },
    { x: 22, y: 69, position: 'DEF' },
    { x: 22, y: 88, position: 'DEF' },

    { x: 44, y: 25, position: 'MID' },
    { x: 44, y: 50, position: 'MID' },
    { x: 44, y: 75, position: 'MID' },

    { x: 67, y: 38, position: 'ATT' },
    { x: 67, y: 62, position: 'ATT' },
  ],
};

const TACTICS = {
  balanced: {
    label: 'Balanced',
    description: 'Balanced attack and defence',
    staminaDrain: 1,
    attackBonus: 0,
    defenceBonus: 0,
    possessionBonus: 0,
  },

  defensive: {
    label: 'Defensive',
    description: 'Protect the goal and stay compact',
    staminaDrain: 0.75,
    attackBonus: -2,
    defenceBonus: 6,
    possessionBonus: -2,
  },

  attacking: {
    label: 'Attacking',
    description: 'Push more players forward',
    staminaDrain: 1.3,
    attackBonus: 6,
    defenceBonus: -3,
    possessionBonus: 2,
  },

  'tiki-taka': {
    label: 'Tiki-Taka',
    description: 'Short passes and possession',
    staminaDrain: 1.05,
    attackBonus: 3,
    defenceBonus: 1,
    possessionBonus: 8,
  },

  counter: {
    label: 'Counter Attack',
    description: 'Absorb pressure and attack quickly',
    staminaDrain: 1.1,
    attackBonus: 7,
    defenceBonus: 3,
    possessionBonus: -6,
  },

  'wing-play': {
    label: 'Wing Play',
    description: 'Attack through the wings',
    staminaDrain: 1.15,
    attackBonus: 5,
    defenceBonus: -1,
    possessionBonus: 1,
  },

  'long-ball': {
    label: 'Long Ball',
    description: 'Use direct balls behind the defence',
    staminaDrain: 0.9,
    attackBonus: 4,
    defenceBonus: 1,
    possessionBonus: -5,
  },

  gegenpress: {
    label: 'Gegenpress',
    description: 'Immediate pressure after losing possession',
    staminaDrain: 1.55,
    attackBonus: 5,
    defenceBonus: 5,
    possessionBonus: 3,
  },
};

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

function getPlayerId(player) {
  return player?.id || player?.playerId || player?.uid || null;
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
  return safeNumber(
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    60,
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

function getPlayerStamina(player) {
  return clamp(
    safeNumber(
      player?.stamina ??
        player?.fitness ??
        player?.energy ??
        DEFAULT_STAMINA,
      DEFAULT_STAMINA,
    ),
    0,
    100,
  );
}

/*
  Overall igenda igabanuka uko stamina igabanuka.
*/
function getLivePlayerRating(player) {
  const overall = getPlayerOverall(player);
  const stamina = getPlayerStamina(player);

  let penalty = 0;

  if (stamina < 20) {
    penalty = 12;
  } else if (stamina < 35) {
    penalty = 8;
  } else if (stamina < 50) {
    penalty = 5;
  } else if (stamina < 70) {
    penalty = 2;
  }

  return Math.max(1, Math.round(overall - penalty));
}

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
    value === 'rb'
  ) {
    return 'DEF';
  }

  if (
    value.includes('mid') ||
    value === 'cm' ||
    value === 'dm' ||
    value === 'am'
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
   CLUB HELPERS
========================================================= */

function getClubName(club, fallback = 'Unknown Club') {
  return (
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
   EVENTS
========================================================= */

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
    possession: 50,
    passes: 0,
    fouls: 0,
    corners: 0,
    offsides: 0,
    yellow: 0,
    red: 0,
  };
}

/* =========================================================
   PREPARE PLAYER
========================================================= */

function preparePlayer(player) {
  return {
    ...player,
    stamina: getPlayerStamina(player),
  };
}

/* =========================================================
   STARTING XI
========================================================= */

function selectStartingXI(squad) {
  const safeSquad = Array.isArray(squad)
    ? squad.map(preparePlayer)
    : [];

  const goalkeepers = safeSquad.filter(
    (player) =>
      normalizePosition(getPlayerPosition(player)) === 'GK',
  );

  const defenders = safeSquad.filter(
    (player) =>
      normalizePosition(getPlayerPosition(player)) === 'DEF',
  );

  const midfielders = safeSquad.filter(
    (player) =>
      normalizePosition(getPlayerPosition(player)) === 'MID',
  );

  const attackers = safeSquad.filter(
    (player) =>
      normalizePosition(getPlayerPosition(player)) === 'ATT',
  );

  const used = new Set();
  const result = [];

  function addBest(list, count) {
    [...list]
      .sort(
        (a, b) =>
          getPlayerOverall(b) -
          getPlayerOverall(a),
      )
      .slice(0, count)
      .forEach((player) => {
        const id = String(getPlayerId(player));

        if (!used.has(id)) {
          used.add(id);
          result.push(player);
        }
      });
  }

  addBest(goalkeepers, 1);
  addBest(defenders, 4);
  addBest(midfielders, 4);
  addBest(attackers, 2);

  const remaining = safeSquad
    .filter(
      (player) =>
        !used.has(String(getPlayerId(player))),
    )
    .sort(
      (a, b) =>
        getPlayerOverall(b) -
        getPlayerOverall(a),
    );

  while (
    result.length < PLAYERS_ON_PITCH &&
    remaining.length
  ) {
    result.push(remaining.shift());
  }

  return result.slice(0, PLAYERS_ON_PITCH);
}

/* =========================================================
   FORMATION BUILDER
========================================================= */

function buildFormationXI(xi, formationName) {
  const formation =
    FORMATIONS[formationName] ||
    FORMATIONS['4-4-2'];

  const players = Array.isArray(xi)
    ? [...xi]
    : [];

  const result = [];

  const used = new Set();

  /*
    First try to put players in their natural positions.
  */
  formation.forEach((slot) => {
    const candidates = players
      .filter(
        (player) =>
          !used.has(String(getPlayerId(player))) &&
          normalizePosition(
            getPlayerPosition(player),
          ) === slot.position,
      )
      .sort(
        (a, b) =>
          getLivePlayerRating(b) -
          getLivePlayerRating(a),
      );

    const player = candidates[0];

    if (player) {
      used.add(String(getPlayerId(player)));

      result.push({
        player,
        slot,
      });
    }
  });

  /*
    Fill empty positions with remaining players.
  */
  formation.forEach((slot) => {
    if (
      result.some(
        (item) =>
          item.slot === slot,
      )
    ) {
      return;
    }

    const player = players.find(
      (item) =>
        !used.has(
          String(getPlayerId(item)),
        ),
    );

    if (player) {
      used.add(String(getPlayerId(player)));

      result.push({
        player,
        slot,
      });
    }
  });

  return result;
}

/* =========================================================
   LOAD CLUB PLAYERS
========================================================= */

async function loadClubPlayers(clubId) {
  if (!clubId) return [];

  try {
    const playersQuery = query(
      collection(db, 'players'),
      where('clubId', '==', clubId),
    );

    const snapshot =
      await getDocs(playersQuery);

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
  } catch (error) {
    console.error(
      'clubId player query failed:',
      error,
    );
  }

  try {
    const allSnapshot =
      await getDocs(
        collection(db, 'players'),
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
      });
  } catch (error) {
    console.error(
      'Fallback players query failed:',
      error,
    );

    return [];
  }
}

/* =========================================================
   GENERATED PLAYERS
========================================================= */

function createGeneratedPlayer(
  club,
  position,
  index,
) {
  const baseName =
    getClubName(club, 'Club')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim() || 'Club';

  const overall =
    55 +
    ((index * 7 +
      (String(club?.id || '').length || 0)) %
      21);

  return {
    id: `gen-${club?.id || 'club'}-${position}-${index}`,
    name: `${baseName} Youth ${index + 1}`,
    position,
    overall,
    stamina: DEFAULT_STAMINA,
    isGenerated: true,
  };
}

function generateClubPlayers(
  club,
  existingPlayers,
  targetCount = 16,
) {
  const players = Array.isArray(existingPlayers)
    ? existingPlayers.map(preparePlayer)
    : [];

  const counts = {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  };

  players.forEach((player) => {
    const position =
      normalizePosition(
        getPlayerPosition(player),
      );

    if (counts[position] !== undefined) {
      counts[position] += 1;
    }
  });

  const requiredPositions = [
    ['GK', 1],
    ['DEF', 4],
    ['MID', 4],
    ['ATT', 2],
  ];

  let generatedIndex = 0;

  requiredPositions.forEach(
    ([position, required]) => {
      while (
        counts[position] < required
      ) {
        const player =
          createGeneratedPlayer(
            club,
            position,
            generatedIndex,
          );

        players.push(player);
        counts[position] += 1;
        generatedIndex += 1;
      }
    },
  );

  const extras = [
    'MID',
    'ATT',
    'DEF',
    'MID',
    'ATT',
    'DEF',
    'MID',
    'GK',
  ];

  while (
    players.length < targetCount
  ) {
    const position =
      extras[
        (players.length - 11) %
          extras.length
      ] || 'MID';

    players.push(
      createGeneratedPlayer(
        club,
        position,
        generatedIndex,
      ),
    );

    generatedIndex += 1;
  }

  return players;
}

/* =========================================================
   LOAD MATCH
========================================================= */

async function loadMatchFromDatabase(
  matchId,
) {
  if (!matchId) return null;

  const matchRef =
    doc(db, 'matches', matchId);

  const matchSnapshot =
    await getDoc(matchRef);

  if (matchSnapshot.exists()) {
    return {
      id: matchSnapshot.id,
      ...matchSnapshot.data(),
      _source: 'matches',
    };
  }

  const fixtureRef =
    doc(db, 'fixtures', matchId);

  const fixtureSnapshot =
    await getDoc(fixtureRef);

  if (fixtureSnapshot.exists()) {
    return {
      id: fixtureSnapshot.id,
      ...fixtureSnapshot.data(),
      _source: 'fixtures',
    };
  }

  return null;
}

/* =========================================================
   3D LABEL
========================================================= */

function createPlayerLabel(
  player,
  color,
) {
  const canvas =
    document.createElement('canvas');

  canvas.width = 512;
  canvas.height = 128;

  const context =
    canvas.getContext('2d');

  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  context.fillStyle =
    'rgba(0,0,0,0.72)';

  context.roundRect(
    5,
    5,
    502,
    118,
    18,
  );

  context.fill();

  context.font =
    'bold 30px Arial';

  context.textAlign = 'center';
  context.textBaseline = 'middle';

  context.fillStyle = '#ffffff';

  const name =
    getPlayerName(player)
      .slice(0, 18);

  const rating =
    getLivePlayerRating(player);

  const stamina =
    Math.round(
      getPlayerStamina(player),
    );

  context.fillText(
    `${name}  ${rating}`,
    256,
    43,
  );

  context.font =
    'bold 23px Arial';

  context.fillStyle = '#ffffff';

  context.fillText(
    `STAMINA ${stamina}%`,
    256,
    88,
  );

  const texture =
    new THREE.CanvasTexture(canvas);

  texture.needsUpdate = true;

  const material =
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

  const sprite =
    new THREE.Sprite(material);

  sprite.scale.set(
    4.3,
    1.08,
    1,
  );

  sprite.userData = {
    canvas,
    context,
    texture,
    material,
    playerId: getPlayerId(player),
    color,
  };

  return sprite;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function MatchPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const matchId =
    typeof router.query.id === 'string'
      ? router.query.id
      : null;

  const [fixture, setFixture] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  const [homeSquad, setHomeSquad] =
    useState([]);

  const [awaySquad, setAwaySquad] =
    useState([]);

  const [homeXI, setHomeXI] =
    useState([]);

  const [awayXI, setAwayXI] =
    useState([]);

  const [homeBench, setHomeBench] =
    useState([]);

  const [awayBench, setAwayBench] =
    useState([]);

  const [homeScore, setHomeScore] =
    useState(0);

  const [awayScore, setAwayScore] =
    useState(0);

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [matchStatus, setMatchStatus] =
    useState('loading');

  const [events, setEvents] =
    useState([]);

  const [homeStats, setHomeStats] =
    useState(createDefaultStats());

  const [awayStats, setAwayStats] =
    useState(createDefaultStats());

  const [formation, setFormation] =
    useState('4-4-2');

  const [tactic, setTactic] =
    useState('balanced');

  const [showTactics, setShowTactics] =
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

  const [
    selectedPlayerOut,
    setSelectedPlayerOut,
  ] = useState('');

  const [
    selectedPlayerIn,
    setSelectedPlayerIn,
  ] = useState('');

  const [selectedTeam, setSelectedTeam] =
    useState('home');

  /*
    Player fatigue is kept separately so that
    the match simulation doesn't depend on
    React rendering speed.
  */
  const playerStateRef =
    useRef({
      home: {},
      away: {},
    });

  const timerRef = useRef(null);
  const processingRef = useRef(false);

  /* =======================================================
     THREE REFS
  ======================================================== */

  const mountRef = useRef(null);

  const sceneRef = useRef(null);

  const cameraRef = useRef(null);

  const rendererRef = useRef(null);

  const controlsRef = useRef(null);

  const ballMeshRef = useRef(null);

  const playerMeshesRef =
    useRef({
      home: [],
      away: [],
    });

  const playerLabelsRef =
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
     DERIVED
  ======================================================== */

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

  const activeTactic =
    TACTICS[tactic] ||
    TACTICS.balanced;

  /* =======================================================
     INITIALIZE PLAYER STATE
  ======================================================== */

  const initializePlayerState =
    useCallback(
      (team, players) => {
        const state = {};

        players.forEach((player) => {
          const id =
            String(getPlayerId(player));

          state[id] = {
            stamina:
              getPlayerStamina(player),
          };
        });

        playerStateRef.current[
          team
        ] = state;
      },
      [],
    );

  /* =======================================================
     GET CURRENT PLAYER WITH STAMINA
  ======================================================== */

  const applyPlayerState =
    useCallback(
      (players, team) => {
        return players.map((player) => {
          const id =
            String(getPlayerId(player));

          const state =
            playerStateRef.current[
              team
            ]?.[id];

          return {
            ...player,
            stamina:
              state?.stamina ??
              getPlayerStamina(player),
          };
        });
      },
      [],
    );

  /* =======================================================
     LOAD USER CLUB
  ======================================================== */

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;

    async function loadUserClub() {
      try {
        const userRef =
          doc(
            db,
            'users',
            user.uid,
          );

        const snapshot =
          await getDoc(userRef);

        if (!snapshot.exists()) {
          return;
        }

        const data =
          snapshot.data();

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
          error,
        );
      }
    }

    loadUserClub();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  /* =======================================================
     APPLY DATABASE STATE
  ======================================================== */

  const applyMatchState =
    useCallback((data) => {
      if (!data) return;

      const result =
        data.result || {};

      setHomeScore(
        safeNumber(
          result.homeScore ??
            data.homeScore,
          0,
        ),
      );

      setAwayScore(
        safeNumber(
          result.awayScore ??
            data.awayScore,
          0,
        ),
      );

      setMatchMinute(
        safeNumber(
          data.minute ??
            data.matchMinute,
          0,
        ),
      );

      setEvents(
        Array.isArray(data.events)
          ? data.events
          : [],
      );

      setHomeStats({
        ...createDefaultStats(),
        ...(data.homeStats || {}),
      });

      setAwayStats({
        ...createDefaultStats(),
        ...(data.awayStats || {}),
      });

      setSubstitutionsUsed(
        safeNumber(
          data.substitutionsUsed,
          0,
        ),
      );

      if (data.formation) {
        setFormation(
          FORMATIONS[
            data.formation
          ]
            ? data.formation
            : '4-4-2',
        );
      }

      if (data.tactic) {
        setTactic(
          TACTICS[data.tactic]
            ? data.tactic
            : 'balanced',
        );
      }

      const status =
        normalize(data.status);

      if (
        status === 'finished' ||
        status === 'completed'
      ) {
        setMatchStatus(
          'finished',
        );
      } else if (
        status === 'half-time'
      ) {
        setMatchStatus(
          'half-time',
        );
      } else if (
        status === 'live'
      ) {
        setMatchStatus('live');
      } else {
        setMatchStatus('ready');
      }
    }, []);

  /* =======================================================
     LOAD MATCH
  ======================================================== */

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
            matchId,
          );

        if (!match) {
          toast.error(
            'Match not found in database',
          );

          router.push('/fixtures');
          return;
        }

        if (cancelled) return;

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

        if (!homeId || !awayId) {
          toast.error(
            'This match has invalid teams',
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
              homeId,
            ),
          ),
          getDoc(
            doc(
              db,
              'clubs',
              awayId,
            ),
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

        if (cancelled) return;

        setHomeClub(home);
        setAwayClub(away);

        const [
          rawHomePlayers,
          rawAwayPlayers,
        ] = await Promise.all([
          loadClubPlayers(homeId),
          loadClubPlayers(awayId),
        ]);

        if (cancelled) return;

        const preparedHome =
          generateClubPlayers(
            home,
            rawHomePlayers,
          );

        const preparedAway =
          generateClubPlayers(
            away,
            rawAwayPlayers,
          );

        initializePlayerState(
          'home',
          preparedHome,
        );

        initializePlayerState(
          'away',
          preparedAway,
        );

        setHomeSquad(
          preparedHome,
        );

        setAwaySquad(
          preparedAway,
        );

        let startingHome =
          selectStartingXI(
            preparedHome,
          );

        let startingAway =
          selectStartingXI(
            preparedAway,
          );

        /*
          If match already saved XI,
          try to restore it.
        */
        if (
          Array.isArray(
            match.homeXI,
          ) &&
          match.homeXI.length
        ) {
          const saved =
            match.homeXI
              .map((id) =>
                preparedHome.find(
                  (player) =>
                    String(
                      getPlayerId(
                        player,
                      ),
                    ) ===
                    String(id),
                ),
              )
              .filter(Boolean);

          if (
            saved.length ===
            PLAYERS_ON_PITCH
          ) {
            startingHome =
              saved;
          }
        }

        if (
          Array.isArray(
            match.awayXI,
          ) &&
          match.awayXI.length
        ) {
          const saved =
            match.awayXI
              .map((id) =>
                preparedAway.find(
                  (player) =>
                    String(
                      getPlayerId(
                        player,
                      ),
                    ) ===
                    String(id),
                ),
              )
              .filter(Boolean);

          if (
            saved.length ===
            PLAYERS_ON_PITCH
          ) {
            startingAway =
              saved;
          }
        }

        /*
          Restore stamina if available.
        */
        if (
          match.playerStamina
        ) {
          Object.entries(
            match.playerStamina,
          ).forEach(
            ([team, players]) => {
              if (
                !playerStateRef
                  .current[team]
              ) {
                playerStateRef.current[
                  team
                ] = {};
              }

              Object.entries(
                players || {},
              ).forEach(
                ([id, stamina]) => {
                  playerStateRef.current[
                    team
                  ][id] = {
                    stamina:
                      clamp(
                        safeNumber(
                          stamina,
                          100,
                        ),
                        0,
                        100,
                      ),
                  };
                },
              );
            },
          );
        }

        startingHome =
          applyPlayerState(
            startingHome,
            'home',
          );

        startingAway =
          applyPlayerState(
            startingAway,
            'away',
          );

        setHomeXI(
          startingHome,
        );

        setAwayXI(
          startingAway,
        );

        setHomeBench(
          preparedHome.filter(
            (player) =>
              !startingHome.some(
                (starter) =>
                  String(
                    getPlayerId(
                      starter,
                    ),
                  ) ===
                  String(
                    getPlayerId(
                      player,
                    ),
                  ),
              ),
          ),
        );

        setAwayBench(
          preparedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) =>
                  String(
                    getPlayerId(
                      starter,
                    ),
                  ) ===
                  String(
                    getPlayerId(
                      player,
                    ),
                  ),
              ),
          ),
        );
      } catch (error) {
        console.error(
          'Match loading error:',
          error,
        );

        toast.error(
          'Could not load match',
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
    initializePlayerState,
    applyPlayerState,
  ]);

  /* =======================================================
     SAVE MATCH
  ======================================================== */

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
        formationValue,
        tacticValue,
        homeXIValue,
        awayXIValue,
        extra = {},
      }) => {
        if (!matchId) return;

        const matchRef =
          doc(
            db,
            'matches',
            matchId,
          );

        const playerStamina = {
          home:
            playerStateRef
              .current.home || {},
          away:
            playerStateRef
              .current.away || {},
        };

        const cleanStamina = {
          home: {},
          away: {},
        };

        ['home', 'away'].forEach(
          (team) => {
            Object.entries(
              playerStamina[team],
            ).forEach(
              ([id, state]) => {
                cleanStamina[
                  team
                ][id] = clamp(
                  safeNumber(
                    state?.stamina,
                    100,
                  ),
                  0,
                  100,
                );
              },
            );
          },
        );

        await setDoc(
          matchRef,
          {
            id: matchId,

            status:
              statusValue || 'live',

            minute:
              safeNumber(
                minute,
                0,
              ),

            homeScore:
              safeNumber(
                homeScoreValue,
                0,
              ),

            awayScore:
              safeNumber(
                awayScoreValue,
                0,
              ),

            result: {
              homeScore:
                safeNumber(
                  homeScoreValue,
                  0,
                ),
              awayScore:
                safeNumber(
                  awayScoreValue,
                  0,
                ),
            },

            events:
              Array.isArray(
                eventsValue,
              )
                ? eventsValue
                : [],

            homeStats:
              homeStatsValue ||
              createDefaultStats(),

            awayStats:
              awayStatsValue ||
              createDefaultStats(),

            substitutionsUsed:
              safeNumber(
                substitutionsValue,
                0,
              ),

            formation:
              formationValue ||
              '4-4-2',

            tactic:
              tacticValue ||
              'balanced',

            homeXI:
              Array.isArray(
                homeXIValue,
              )
                ? homeXIValue.map(
                    getPlayerId,
                  )
                : [],

            awayXI:
              Array.isArray(
                awayXIValue,
              )
                ? awayXIValue.map(
                    getPlayerId,
                  )
                : [],

            playerStamina:
              cleanStamina,

            updatedAt:
              serverTimestamp(),

            ...extra,
          },
          {
            merge: true,
          },
        );
      },
      [matchId],
    );

  /* =======================================================
     THREE.JS
  ======================================================== */

  useEffect(() => {
    if (
      !mountRef.current ||
      loadingMatch ||
      homeXI.length !== 11 ||
      awayXI.length !== 11
    ) {
      return;
    }

    const mount =
      mountRef.current;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        0x0b1120,
      );

    scene.fog =
      new THREE.Fog(
        0x0b1120,
        30,
        80,
      );

    const width =
      mount.clientWidth || 800;

    const height =
      mount.clientHeight || 500;

    const camera =
      new THREE.PerspectiveCamera(
        45,
        width / height,
        0.1,
        100,
      );

    camera.position.set(
      0,
      25,
      30,
    );

    camera.lookAt(
      0,
      0,
      0,
    );

    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
      });

    renderer.setSize(
      width,
      height,
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        2,
      ),
    );

    renderer.shadowMap.enabled =
      true;

    renderer.shadowMap.type =
      THREE.PCFSoftShadowMap;

    mount.appendChild(
      renderer.domElement,
    );

    const controls =
      new OrbitControls(
        camera,
        renderer.domElement,
      );

    controls.enableDamping =
      true;

    controls.dampingFactor =
      0.05;

    controls.target.set(
      0,
      0,
      0,
    );

    controls.maxPolarAngle =
      Math.PI / 2.5;

    controls.minDistance =
      15;

    controls.maxDistance =
      50;

    controls.update();

    /* LIGHTS */

    const ambientLight =
      new THREE.AmbientLight(
        0xffffff,
        0.55,
      );

    scene.add(
      ambientLight,
    );

    const directionalLight =
      new THREE.DirectionalLight(
        0xffffff,
        1.2,
      );

    directionalLight.position.set(
      10,
      20,
      10,
    );

    directionalLight.castShadow =
      true;

    directionalLight.shadow.mapSize.width =
      1024;

    directionalLight.shadow.mapSize.height =
      1024;

    scene.add(
      directionalLight,
    );

    /* PITCH */

    const pitchGeometry =
      new THREE.PlaneGeometry(
        30,
        20,
      );

    const pitchMaterial =
      new THREE.MeshStandardMaterial({
        color: 0x15803d,
        roughness: 0.8,
        metalness: 0.1,
      });

    const pitch =
      new THREE.Mesh(
        pitchGeometry,
        pitchMaterial,
      );

    pitch.rotation.x =
      -Math.PI / 2;

    pitch.receiveShadow =
      true;

    scene.add(pitch);

    /* LINES */

    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    const borderGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
          new THREE.Vector3(
            -15,
            0.01,
            -10,
          ),
          new THREE.Vector3(
            15,
            0.01,
            -10,
          ),
          new THREE.Vector3(
            15,
            0.01,
            10,
          ),
          new THREE.Vector3(
            -15,
            0.01,
            10,
          ),
          new THREE.Vector3(
            -15,
            0.01,
            -10,
          ),
        ],
      );

    scene.add(
      new THREE.Line(
        borderGeometry,
        lineMaterial,
      ),
    );

    const centerGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
          new THREE.Vector3(
            0,
            0.01,
            -10,
          ),
          new THREE.Vector3(
            0,
            0.01,
            10,
          ),
        ],
      );

    scene.add(
      new THREE.Line(
        centerGeometry,
        lineMaterial,
      ),
    );

    const circleGeometry =
      new THREE.RingGeometry(
        3,
        3.05,
        64,
      );

    const circleMaterial =
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      });

    const circle =
      new THREE.Mesh(
        circleGeometry,
        circleMaterial,
      );

    circle.rotation.x =
      -Math.PI / 2;

    circle.position.y =
      0.02;

    scene.add(circle);

    /* GOALS */

    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
      });

    const leftGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.1,
          0.15,
          6,
        ),
        goalMaterial,
      );

    leftGoal.position.set(
      -15,
      0.08,
      0,
    );

    scene.add(leftGoal);

    const rightGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.1,
          0.15,
          6,
        ),
        goalMaterial,
      );

    rightGoal.position.set(
      15,
      0.08,
      0,
    );

    scene.add(rightGoal);

    /* BALL */

    const ball =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.15,
          24,
          24,
        ),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.3,
        }),
      );

    ball.position.set(
      0,
      0.15,
      0,
    );

    ball.castShadow =
      true;

    scene.add(ball);

    ballMeshRef.current =
      ball;

    /* PLAYER CREATOR */

    function createPlayerMesh(
      player,
      x,
      z,
      color,
      index,
      team,
    ) {
      const geometry =
        new THREE.CylinderGeometry(
          0.3,
          0.35,
          1.2,
          16,
        );

      const material =
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.5,
          metalness: 0.2,
        });

      const mesh =
        new THREE.Mesh(
          geometry,
          material,
        );

      mesh.position.set(
        x,
        0.6,
        z,
      );

      mesh.castShadow =
        true;

      mesh.userData = {
        playerId:
          getPlayerId(player),
        team,
        index,
      };

      scene.add(mesh);

      const label =
        createPlayerLabel(
          player,
          color,
        );

      label.position.set(
        x,
        2.1,
        z,
      );

      scene.add(label);

      return {
        mesh,
        label,
      };
    }

    const homeFormation =
      buildFormationXI(
        homeXI,
        formation,
      );

    const awayFormation =
      buildFormationXI(
        awayXI,
        formation,
      );

    const homeObjects =
      homeFormation.map(
        (item, index) => {
          const x =
            ((item.slot.x - 50) /
              50) *
            15;

          const z =
            ((item.slot.y - 50) /
              50) *
            10;

          return createPlayerMesh(
            item.player,
            x,
            z,
            0x3b82f6,
            index,
            'home',
          );
        },
      );

    const awayObjects =
      awayFormation.map(
        (item, index) => {
          const x =
            ((50 - item.slot.x) /
              50) *
            15;

          const z =
            ((50 - item.slot.y) /
              50) *
            10;

          return createPlayerMesh(
            item.player,
            x,
            z,
            0xef4444,
            index,
            'away',
          );
        },
      );

    playerMeshesRef.current.home =
      homeObjects.map(
        (item) => item.mesh,
      );

    playerMeshesRef.current.away =
      awayObjects.map(
        (item) => item.mesh,
      );

    playerLabelsRef.current.home =
      homeObjects.map(
        (item) => item.label,
      );

    playerLabelsRef.current.away =
      awayObjects.map(
        (item) => item.label,
      );

    playerTargetsRef.current.home =
      playerMeshesRef.current.home.map(
        (player) => ({
          x: player.position.x,
          z: player.position.z,
        }),
      );

    playerTargetsRef.current.away =
      playerMeshesRef.current.away.map(
        (player) => ({
          x: player.position.x,
          z: player.position.z,
        }),
      );

    /* ANIMATION */

    const animate =
      () => {
        animationFrameRef.current =
          requestAnimationFrame(
            animate,
          );

        ['home', 'away'].forEach(
          (team) => {
            const meshes =
              playerMeshesRef
                .current[team];

            const targets =
              playerTargetsRef
                .current[team];

            meshes.forEach(
              (player, index) => {
                const target =
                  targets[index];

                if (!target) return;

                player.position.x =
                  lerp(
                    player.position.x,
                    target.x,
                    0.08,
                  );

                player.position.z =
                  lerp(
                    player.position.z,
                    target.z,
                    0.08,
                  );

                const label =
                  playerLabelsRef
                    .current[team][
                    index
                  ];

                if (label) {
                  label.position.x =
                    player.position.x;

                  label.position.z =
                    player.position.z;

                  label.position.y =
                    2.1;
                }
              },
            );
          },
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
            playerMeshesRef
              .current[team];

          const player =
            players[playerIndex];

          if (player) {
            ballMeshRef.current.position.x =
              player.position.x;

            ballMeshRef.current.position.z =
              player.position.z;
          }
        }

        controls.update();

        renderer.render(
          scene,
          camera,
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

        const newWidth =
          mountRef.current
            .clientWidth;

        const newHeight =
          mountRef.current
            .clientHeight;

        camera.aspect =
          newWidth /
          newHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
          newWidth,
          newHeight,
        );
      };

    window.addEventListener(
      'resize',
      handleResize,
    );

    return () => {
      window.removeEventListener(
        'resize',
        handleResize,
      );

      if (
        animationFrameRef.current
      ) {
        cancelAnimationFrame(
          animationFrameRef.current,
        );
      }

      playerLabelsRef.current.home.forEach(
        (label) => {
          label.material.map?.dispose();
          label.material.dispose();
        },
      );

      playerLabelsRef.current.away.forEach(
        (label) => {
          label.material.map?.dispose();
          label.material.dispose();
        },
      );

      renderer.dispose();

      if (
        mount.contains(
          renderer.domElement,
        )
      ) {
        mount.removeChild(
          renderer.domElement,
        );
      }

      playerMeshesRef.current = {
        home: [],
        away: [],
      };

      playerLabelsRef.current = {
        home: [],
        away: [],
      };
    };
  }, [
    loadingMatch,
    homeXI,
    awayXI,
    formation,
  ]);

  /* =======================================================
     PLAYER MOVEMENT
  ======================================================== */

  const simulatePlayerMovement =
    useCallback(() => {
      if (
        !ballPossessionRef.current
      ) {
        const team =
          Math.random() < 0.5
            ? 'home'
            : 'away';

        const playerIndex =
          Math.floor(
            Math.random() * 11,
          );

        ballPossessionRef.current = {
          team,
          playerIndex,
        };

        return;
      }

      const {
        team,
        playerIndex,
      } =
        ballPossessionRef.current;

      const players =
        team === 'home'
          ? homeXI
          : awayXI;

      if (!players[playerIndex]) {
        ballPossessionRef.current =
          null;

        return;
      }

      const playerMeshes =
        playerMeshesRef.current[
          team
        ];

      const opponentTeam =
        team === 'home'
          ? 'away'
          : 'home';

      const opponentMeshes =
        playerMeshesRef.current[
          opponentTeam
        ];

      const currentPlayer =
        playerMeshes[playerIndex];

      if (!currentPlayer) return;

      const random =
        Math.random();

      const goalX =
        team === 'home'
          ? 14
          : -14;

      /*
        Tiki-Taka
      */
      if (
        tactic === 'tiki-taka' &&
        random < 0.55
      ) {
        const teammates =
          playerMeshes
            .map(
              (_, index) =>
                index,
            )
            .filter(
              (index) =>
                index !==
                playerIndex,
            );

        const targetIndex =
          pick(teammates);

        if (
          targetIndex !== null
        ) {
          ballPossessionRef.current =
            {
              team,
              playerIndex:
                targetIndex,
            };

          return;
        }
      }

      /*
        PASS
      */
      if (
        random <
        (tactic === 'long-ball'
          ? 0.18
          : 0.4)
      ) {
        const targetIndex =
          Math.floor(
            Math.random() * 11,
          );

        if (
          targetIndex !==
          playerIndex
        ) {
          ballPossessionRef.current =
            {
              team,
              playerIndex:
                targetIndex,
            };

          return;
        }
      }

      /*
        SHOOT
      */
      const distanceToGoal =
        Math.abs(
          currentPlayer.position.x -
            goalX,
        );

      if (
        distanceToGoal <
          9 &&
        random <
          0.5
      ) {
        const stamina =
          getPlayerStamina(
            players[playerIndex],
          );

        const rating =
          getLivePlayerRating(
            players[playerIndex],
          );

        const shootingPower =
          rating / 100;

        const chance =
          clamp(
            0.25 +
              shootingPower *
                0.3 +
              activeTactic.attackBonus /
                100 -
              (100 - stamina) /
                400,
            0.12,
            0.78,
          );

        if (
          Math.random() <
          chance
        ) {
          if (
            team === 'home'
          ) {
            setHomeScore(
              (value) =>
                value + 1,
            );
          } else {
            setAwayScore(
              (value) =>
                value + 1,
            );
          }

          const goalEvent = {
            id:
              `${Date.now()}-goal-${Math.random()}`,
            type:
              EVENT_TYPES.GOAL,
            team,
            minute:
              matchMinute,
            playerId:
              getPlayerId(
                players[
                  playerIndex
                ],
              ),
            playerName:
              getPlayerName(
                players[
                  playerIndex
                ],
              ),
            detail:
              `${getPlayerName(
                players[
                  playerIndex
                ],
              )} scored`,
            createdAt:
              new Date().toISOString(),
          };

          setEvents(
            (previous) => [
              goalEvent,
              ...previous,
            ],
          );

          ballPossessionRef.current =
            null;

          return;
        }
      }

      /*
        DRIBBLE
      */
      const direction =
        team === 'home'
          ? 1
          : -1;

      const speedPenalty =
        getPlayerStamina(
          players[playerIndex],
        ) < 35
          ? 0.5
          : 1;

      const newX =
        clamp(
          currentPlayer.position.x +
            direction *
              randomBetweenSafe(
                1,
                3,
              ) *
              speedPenalty,
          -14,
          14,
        );

      const newZ =
        clamp(
          currentPlayer.position.z +
            randomBetweenSafe(
              -2,
              2,
            ),
          -9,
          9,
        );

      playerTargetsRef.current[
        team
      ][playerIndex] = {
        x: newX,
        z: newZ,
      };

      opponentMeshes.forEach(
        (opponent, index) => {
          playerTargetsRef.current[
            opponentTeam
          ][index] = {
            x:
              currentPlayer.position
                .x +
              (Math.random() -
                0.5) *
                2,
            z:
              currentPlayer.position
                .z +
              (Math.random() -
                0.5) *
                2,
          };
        },
      );

      /*
        STEAL
      */
      const stealChance =
        tactic === 'gegenpress'
          ? 0.12
          : 0.05;

      if (
        Math.random() <
        stealChance
      ) {
        const opponentIndex =
          Math.floor(
            Math.random() * 11,
          );

        ballPossessionRef.current =
          {
            team: opponentTeam,
            playerIndex:
              opponentIndex,
          };
      }
    }, [
      homeXI,
      awayXI,
      tactic,
      activeTactic,
      matchMinute,
    ]);

  /* =======================================================
     REALTIME LISTENER
  ======================================================== */

  useEffect(() => {
    if (!user || !matchId) {
      return;
    }

    const matchRef =
      doc(
        db,
        'matches',
        matchId,
      );

    const unsubscribe =
      onSnapshot(
        matchRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }

          const data = {
            id: snapshot.id,
            ...snapshot.data(),
          };

          setFixture(
            (previous) => ({
              ...(previous || {}),
              ...data,
            }),
          );

          applyMatchState(data);
        },
        (error) => {
          console.error(
            'Match realtime listener error:',
            error,
          );
        },
      );

    return () =>
      unsubscribe();
  }, [
    user,
    matchId,
    applyMatchState,
  ]);

  /* =======================================================
     SIMULATE MINUTE
  ======================================================== */

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
          /*
            10 simulation cycles per match minute.
          */
          for (
            let i = 0;
            i < 10;
            i += 1
          ) {
            simulatePlayerMovement();
          }

          /*
            FATIGUE
          */
          ['home', 'away'].forEach(
            (team) => {
              const players =
                team === 'home'
                  ? homeXI
                  : awayXI;

              players.forEach(
                (player) => {
                  const id =
                    String(
                      getPlayerId(
                        player,
                      ),
                    );

                  const current =
                    safeNumber(
                      playerStateRef
                        .current[
                        team
                      ]?.[id]
                        ?.stamina,
                      100,
                    );

                  const position =
                    normalizePosition(
                      getPlayerPosition(
                        player,
                      ),
                    );

                  let drain =
                    activeTactic.staminaDrain;

                  /*
                    Attackers and midfielders
                    usually spend more energy.
                  */
                  if (
                    position ===
                    'MID'
                  ) {
                    drain *= 1.12;
                  }

                  if (
                    position ===
                    'ATT'
                  ) {
                    drain *= 1.08;
                  }

                  if (
                    position ===
                    'GK'
                  ) {
                    drain *= 0.45;
                  }

                  /*
                    Gegenpress is expensive.
                  */
                  if (
                    tactic ===
                    'gegenpress'
                  ) {
                    drain *= 1.2;
                  }

                  const next =
                    clamp(
                      current -
                        drain,
                      MIN_STAMINA,
                      100,
                    );

                  playerStateRef
                    .current[
                    team
                  ][id] = {
                    stamina: next,
                  };
                },
              );
            },
          );

          /*
            Put current stamina into React state.
          */
          setHomeXI(
            (previous) =>
              applyPlayerState(
                previous,
                'home',
              ),
          );

          setAwayXI(
            (previous) =>
              applyPlayerState(
                previous,
                'away',
              ),
          );

          const homeStrength =
            homeXI.reduce(
              (total, player) =>
                total +
                getLivePlayerRating(
                  {
                    ...player,
                    stamina:
                      playerStateRef
                        .current
                        .home[
                        String(
                          getPlayerId(
                            player,
                          ),
                        )
                      ]?.stamina ??
                      getPlayerStamina(
                        player,
                      ),
                  },
                ),
              0,
            ) /
            Math.max(
              homeXI.length,
              1,
            );

          const awayStrength =
            awayXI.reduce(
              (total, player) =>
                total +
                getLivePlayerRating(
                  {
                    ...player,
                    stamina:
                      playerStateRef
                        .current
                        .away[
                        String(
                          getPlayerId(
                            player,
                          ),
                        )
                      ]?.stamina ??
                      getPlayerStamina(
                        player,
                      ),
                  },
                ),
              0,
            ) /
            Math.max(
              awayXI.length,
              1,
            );

          const nextHomeStats = {
            ...homeStats,
          };

          const nextAwayStats = {
            ...awayStats,
          };

          const possessionBase =
            clamp(
              50 +
                (homeStrength -
                  awayStrength) *
                  0.4 +
                activeTactic
                  .possessionBonus,
              25,
              75,
            );

          nextHomeStats.possession =
            Math.round(
              possessionBase,
            );

          nextAwayStats.possession =
            100 -
            nextHomeStats.possession;

          nextHomeStats.passes +=
            randomBetweenSafe(
              4,
              15,
            );

          nextAwayStats.passes +=
            randomBetweenSafe(
              4,
              15,
            );

          /*
            Generate some basic statistics.
          */
          if (
            Math.random() <
            0.35
          ) {
            nextHomeStats.shots +=
              1;
          }

          if (
            Math.random() <
            0.35
          ) {
            nextAwayStats.shots +=
              1;
          }

          if (
            Math.random() <
            0.15
          ) {
            nextHomeStats.shotsOnTarget +=
              1;
          }

          if (
            Math.random() <
            0.15
          ) {
            nextAwayStats.shotsOnTarget +=
              1;
          }

          if (
            Math.random() <
            0.1
          ) {
            nextHomeStats.corners +=
              1;
          }

          if (
            Math.random() <
            0.1
          ) {
            nextAwayStats.corners +=
              1;
          }

          if (
            Math.random() <
            0.1
          ) {
            nextHomeStats.fouls +=
              1;
          }

          if (
            Math.random() <
            0.1
          ) {
            nextAwayStats.fouls +=
              1;
          }

          setHomeStats(
            nextHomeStats,
          );

          setAwayStats(
            nextAwayStats,
          );

          await saveMatchState({
            minute,
            homeScoreValue:
              homeScore,
            awayScoreValue:
              awayScore,
            eventsValue:
              events,
            homeStatsValue:
              nextHomeStats,
            awayStatsValue:
              nextAwayStats,
            statusValue:
              'live',
            substitutionsValue:
              substitutionsUsed,
            formationValue:
              formation,
            tacticValue:
              tactic,
            homeXIValue:
              homeXI,
            awayXIValue:
              awayXI,
          });
        } catch (error) {
          console.error(
            'Simulation error:',
            error,
          );
        } finally {
          processingRef.current =
            false;
        }
      },
      [
        homeXI,
        awayXI,
        homeScore,
        awayScore,
        homeStats,
        awayStats,
        events,
        substitutionsUsed,
        formation,
        tactic,
        activeTactic,
        simulatePlayerMovement,
        saveMatchState,
        applyPlayerState,
      ],
    );

  /* =======================================================
     START MATCH
  ======================================================== */

  const startMatch =
    useCallback(
      async () => {
        if (
          !fixture ||
          !userIsParticipant
        ) {
          toast.error(
            'You are not managing a team in this match.',
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
            'Both teams need a starting XI.',
          );
          return;
        }

        if (
          matchStatus ===
          'finished'
        ) {
          toast.error(
            'This match has already finished.',
          );
          return;
        }

        try {
          setSavingMatch(true);

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
            formationValue:
              formation,
            tacticValue:
              tactic,
            homeXIValue:
              homeXI,
            awayXIValue:
              awayXI,
          });

          setMatchStatus(
            'live',
          );

          setPaused(false);

          toast.success(
            'Match started',
          );
        } catch (error) {
          console.error(error);

          toast.error(
            'Could not start match',
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
        formation,
        tactic,
        saveMatchState,
      ],
    );

  /* =======================================================
     TIMER
  ======================================================== */

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

            if (
              next ===
              FIRST_HALF_END
            ) {
              setMatchStatus(
                'half-time',
              );

              setHalfTimeShown(
                true,
              );

              return next;
            }

            if (
              next >=
              MATCH_DURATION
            ) {
              return MATCH_DURATION;
            }

            return next;
          },
        );
      }, MATCH_TICK_MS);

    return () => {
      if (
        timerRef.current
      ) {
        clearInterval(
          timerRef.current,
        );

        timerRef.current =
          null;
      }
    };
  }, [
    matchStatus,
    paused,
  ]);

  /* =======================================================
     SIMULATE CURRENT MINUTE
  ======================================================== */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      paused ||
      matchMinute <= 0 ||
      matchMinute >=
        MATCH_DURATION
    ) {
      return;
    }

    simulateMinute(
      matchMinute,
    );
  }, [
    matchMinute,
    matchStatus,
    paused,
    simulateMinute,
  ]);

  /* =======================================================
     SECOND HALF
  ======================================================== */

  const continueSecondHalf =
    async () => {
      try {
        setSavingMatch(true);

        await saveMatchState({
          minute:
            FIRST_HALF_END,
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
          formationValue:
            formation,
          tacticValue:
            tactic,
          homeXIValue:
            homeXI,
          awayXIValue:
            awayXI,
        });

        setHalfTimeShown(
          false,
        );

        setMatchStatus(
          'live',
        );

        setPaused(false);
      } catch (error) {
        console.error(error);

        toast.error(
          'Could not continue match',
        );
      } finally {
        setSavingMatch(false);
      }
    };

  /* =======================================================
     FINISH
  ======================================================== */

  const finishMatch =
    useCallback(
      async () => {
        try {
          setSavingMatch(true);

          await saveMatchState({
            minute:
              MATCH_DURATION,
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
              'finished',
            substitutionsValue:
              substitutionsUsed,
            formationValue:
              formation,
            tacticValue:
              tactic,
            homeXIValue:
              homeXI,
            awayXIValue:
              awayXI,
            extra: {
              finishedAt:
                serverTimestamp(),
              playedBy:
                user?.uid || null,
            },
          });

          setMatchMinute(
            MATCH_DURATION,
          );

          setMatchStatus(
            'finished',
          );

          setPaused(true);

          toast.success(
            `Full time: ${homeScore} - ${awayScore}`,
          );
        } catch (error) {
          console.error(
            'Finish match error:',
            error,
          );

          toast.error(
            'Could not save final result',
          );
        } finally {
          setSavingMatch(false);
        }
      },
      [
        homeScore,
        awayScore,
        events,
        homeStats,
        awayStats,
        substitutionsUsed,
        formation,
        tactic,
        homeXI,
        awayXI,
        user,
        saveMatchState,
      ],
    );

  useEffect(() => {
    if (
      matchStatus ===
        'live' &&
      matchMinute >=
        MATCH_DURATION
    ) {
      finishMatch();
    }
  }, [
    matchMinute,
    matchStatus,
    finishMatch,
  ]);

  /* =======================================================
     PAUSE
  ======================================================== */

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
          !previous,
      );
    };

  /* =======================================================
     FORMATION
  ======================================================== */

  const changeFormation =
    async (value) => {
      if (
        !FORMATIONS[value]
      ) {
        return;
      }

      setFormation(value);

      try {
        await saveMatchState({
          minute:
            matchMinute,
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
            matchStatus,
          substitutionsValue:
            substitutionsUsed,
          formationValue:
            value,
          tacticValue:
            tactic,
          homeXIValue:
            homeXI,
          awayXIValue:
            awayXI,
        });
      } catch (error) {
        console.error(
          'Formation save error:',
          error,
        );
      }
    };

  /* =======================================================
     TACTIC
  ======================================================== */

  const changeTactic =
    async (value) => {
      if (
        !TACTICS[value]
      ) {
        return;
      }

      setTactic(value);

      try {
        await saveMatchState({
          minute:
            matchMinute,
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
            matchStatus,
          substitutionsValue:
            substitutionsUsed,
          formationValue:
            formation,
          tacticValue:
            value,
          homeXIValue:
            homeXI,
          awayXIValue:
            awayXI,
        });
      } catch (error) {
        console.error(
          'Tactic save error:',
          error,
        );
      }
    };

  /* =======================================================
     SUBSTITUTION
  ======================================================== */

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
          'Maximum substitutions reached.',
        );
        return;
      }

      if (
        !selectedPlayerOut ||
        !selectedPlayerIn
      ) {
        toast.error(
          'Select both the player going out and the player coming in.',
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

      const playerOut =
        currentXI.find(
          (player) =>
            String(
              getPlayerId(
                player,
              ),
            ) ===
            String(
              selectedPlayerOut,
            ),
        );

      const playerIn =
        bench.find(
          (player) =>
            String(
              getPlayerId(
                player,
              ),
            ) ===
            String(
              selectedPlayerIn,
            ),
        );

      if (
        !playerOut ||
        !playerIn
      ) {
        toast.error(
          'Player selection is invalid.',
        );
        return;
      }

      const nextXI =
        currentXI.map(
          (player) =>
            String(
              getPlayerId(
                player,
              ),
            ) ===
            String(
              getPlayerId(
                playerOut,
              ),
            )
              ? applyPlayerState(
                  [playerIn],
                  team,
                )[0]
              : player,
        );

      const nextBench = [
        ...bench.filter(
          (player) =>
            String(
              getPlayerId(
                player,
              ),
            ) !==
            String(
              getPlayerId(
                playerIn,
              ),
            ),
        ),
        playerOut,
      ];

      const nextSubCount =
        substitutionsUsed +
        1;

      const event = {
        id:
          `${Date.now()}-substitution`,
        type:
          EVENT_TYPES.SUBSTITUTION,
        team,
        minute:
          matchMinute,
        playerId:
          getPlayerId(
            playerIn,
          ),
        playerName:
          getPlayerName(
            playerIn,
          ),
        detail:
          `${getPlayerName(
            playerIn,
          )} replaced ${getPlayerName(
            playerOut,
          )}`,
        createdAt:
          new Date().toISOString(),
      };

      const nextEvents = [
        event,
        ...events,
      ];

      if (
        team === 'home'
      ) {
        setHomeXI(
          nextXI,
        );

        setHomeBench(
          nextBench,
        );
      } else {
        setAwayXI(
          nextXI,
        );

        setAwayBench(
          nextBench,
        );
      }

      setSubstitutionsUsed(
        nextSubCount,
      );

      setEvents(
        nextEvents,
      );

      setSelectedPlayerOut(
        '',
      );

      setSelectedPlayerIn(
        '',
      );

      await saveMatchState({
        minute:
          matchMinute,
        homeScoreValue:
          homeScore,
        awayScoreValue:
          awayScore,
        eventsValue:
          nextEvents,
        homeStatsValue:
          homeStats,
        awayStatsValue:
          awayStats,
        statusValue:
          matchStatus,
        substitutionsValue:
          nextSubCount,
        formationValue:
          formation,
        tacticValue:
          tactic,
        homeXIValue:
          team === 'home'
            ? nextXI
            : homeXI,
        awayXIValue:
          team === 'away'
            ? nextXI
            : awayXI,
      });

      toast.success(
        `${getPlayerName(
          playerIn,
        )} is replacing ${getPlayerName(
          playerOut,
        )}`,
      );
    };

  /* =======================================================
     EVENTS
  ======================================================== */

  const sortedEvents =
    useMemo(
      () =>
        [...events].sort(
          (a, b) =>
            safeNumber(
              b.minute,
            ) -
            safeNumber(
              a.minute,
            ),
        ),
      [events],
    );

  /* =======================================================
     STATUS
  ======================================================== */

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
     LOADING
  ======================================================== */

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

  /* =======================================================
     NOT FOUND
  ======================================================== */

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
              '/fixtures',
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
  ======================================================== */

  return (
    <>
      <Head>
        <title>
          {getClubName(
            homeClub,
          )}{' '}
          vs{' '}
          {getClubName(
            awayClub,
          )}
        </title>

        <meta
          name="description"
          content={`Live match between ${getClubName(
            homeClub,
          )} and ${getClubName(
            awayClub,
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
                '/fixtures',
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
                homeClub,
              ),
            '--away-color':
              getClubPrimaryColor(
                awayClub,
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
                homeClub,
              ) ? (
                <img
                  src={getClubLogo(
                    homeClub,
                  )}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <strong>
              {getClubName(
                homeClub,
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

              <span>-</span>

              <strong>
                {awayScore}
              </strong>
            </div>

            <div
              className={
                styles.matchClock
              }
            >
              {matchMinute}'
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
                awayClub,
              ) ? (
                <img
                  src={getClubLogo(
                    awayClub,
                  )}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <strong>
              {getClubName(
                awayClub,
              )}
            </strong>

            <span>
              AWAY
            </span>
          </div>
        </section>

        {/* LATEST SCORE */}

        <section
          className={
            styles.latestScore
          }
        >
          <div>
            <span>
              LATEST SCORE
            </span>

            <strong>
              {getClubName(
                homeClub,
              )}{' '}
              {homeScore} -{' '}
              {awayScore}{' '}
              {getClubName(
                awayClub,
              )}
            </strong>
          </div>

          <span>
            {matchStatus ===
            'finished'
              ? 'FINAL RESULT'
              : `Minute ${matchMinute}`}
          </span>
        </section>

        {/* VIEW ONLY */}

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
                setShowTactics(
                  (previous) =>
                    !previous,
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
                    !previous,
                )
              }
            >
              🔄 Substitutions
            </button>
          </section>
        )}

        {/* =================================================
            TACTICS PANEL
        ================================================= */}

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
                <div>
                  <h2>
                    Formation
                  </h2>

                  <small>
                    Current:{' '}
                    {formation}
                  </small>
                </div>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Object.keys(
                  FORMATIONS,
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
                          value,
                        )
                      }
                    >
                      {value}
                    </button>
                  ),
                )}
              </div>

              <div
                className={
                  styles.panelHeader
                }
                style={{
                  marginTop:
                    20,
                }}
              >
                <div>
                  <h2>
                    Tactics
                  </h2>

                  <small>
                    {
                      activeTactic.description
                    }
                  </small>
                </div>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Object.entries(
                  TACTICS,
                ).map(
                  ([
                    key,
                    value,
                  ]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        tactic ===
                        key
                          ? styles.active
                          : ''
                      }
                      onClick={() =>
                        changeTactic(
                          key,
                        )
                      }
                    >
                      {
                        value.label
                      }
                    </button>
                  ),
                )}
              </div>
            </section>
          )}

        {/* =================================================
            HALF TIME
        ================================================= */}

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

        {/* =================================================
            SUBSTITUTIONS
        ================================================= */}

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
                <div>
                  <h2>
                    Substitutions
                  </h2>

                  <small>
                    Choose player
                    OUT and player
                    IN
                  </small>
                </div>

                <span>
                  {substitutionsUsed}/
                  {
                    MAX_SUBSTITUTIONS
                  }
                </span>
              </div>

              {/* TEAM */}

              <select
                value={
                  selectedTeam
                }
                onChange={(
                  event,
                ) => {
                  setSelectedTeam(
                    event.target
                      .value,
                  );

                  setSelectedPlayerOut(
                    '',
                  );

                  setSelectedPlayerIn(
                    '',
                  );
                }}
              >
                <option value="home">
                  {getClubName(
                    homeClub,
                  )}
                </option>

                <option value="away">
                  {getClubName(
                    awayClub,
                  )}
                </option>
              </select>

              {/* PLAYER OUT */}

              <div
                style={{
                  marginTop: 12,
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      6,
                    fontWeight:
                      700,
                  }}
                >
                  Player OUT
                </label>

                <select
                  value={
                    selectedPlayerOut
                  }
                  onChange={(
                    event,
                  ) =>
                    setSelectedPlayerOut(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Select player
                  </option>

                  {(selectedTeam ===
                  'home'
                    ? homeXI
                    : awayXI
                  ).map(
                    (player) => (
                      <option
                        key={String(
                          getPlayerId(
                            player,
                          ),
                        )}
                        value={String(
                          getPlayerId(
                            player,
                          ),
                        )}
                      >
                        {getPlayerName(
                          player,
                        )}{' '}
                        · OVR{' '}
                        {getLivePlayerRating(
                          player,
                        )}{' '}
                        · STAMINA{' '}
                        {Math.round(
                          getPlayerStamina(
                            player,
                          ),
                        )}
                        %
                      </option>
                    ),
                  )}
                </select>
              </div>

              {/* PLAYER IN */}

              <div
                style={{
                  marginTop: 12,
                }}
              >
                <label
                  style={{
                    display:
                      'block',
                    marginBottom:
                      6,
                    fontWeight:
                      700,
                  }}
                >
                  Player IN
                </label>

                <select
                  value={
                    selectedPlayerIn
                  }
                  onChange={(
                    event,
                  ) =>
                    setSelectedPlayerIn(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Select player
                  </option>

                  {(selectedTeam ===
                  'home'
                    ? homeBench
                    : awayBench
                  ).map(
                    (player) => (
                      <option
                        key={String(
                          getPlayerId(
                            player,
                          ),
                        )}
                        value={String(
                          getPlayerId(
                            player,
                          ),
                        )}
                      >
                        {getPlayerName(
                          player,
                        )}{' '}
                        · OVR{' '}
                        {getLivePlayerRating(
                          player,
                        )}{' '}
                        · STAMINA{' '}
                        {Math.round(
                          getPlayerStamina(
                            player,
                          ),
                        )}
                        %
                      </option>
                    ),
                  )}
                </select>
              </div>

              {/* PREVIEW */}

              {selectedPlayerOut &&
                selectedPlayerIn && (
                  <div
                    style={{
                      marginTop:
                        15,
                      padding:
                        12,
                      borderRadius:
                        12,
                      background:
                        'rgba(255,255,255,0.05)',
                    }}
                  >
                    {(() => {
                      const xi =
                        selectedTeam ===
                        'home'
                          ? homeXI
                          : awayXI;

                      const bench =
                        selectedTeam ===
                        'home'
                          ? homeBench
                          : awayBench;

                      const out =
                        xi.find(
                          (player) =>
                            String(
                              getPlayerId(
                                player,
                              ),
                            ) ===
                            String(
                              selectedPlayerOut,
                            ),
                        );

                      const inPlayer =
                        bench.find(
                          (player) =>
                            String(
                              getPlayerId(
                                player,
                              ),
                            ) ===
                            String(
                              selectedPlayerIn,
                            ),
                        );

                      if (
                        !out ||
                        !inPlayer
                      ) {
                        return null;
                      }

                      return (
                        <div>
                          <strong>
                            SUBSTITUTION
                          </strong>

                          <div
                            style={{
                              marginTop:
                                8,
                            }}
                          >
                            🔴 OUT:{' '}
                            {
                              getPlayerName(
                                out,
                              )
                            }{' '}
                            ·{' '}
                            {getLivePlayerRating(
                              out,
                            )}{' '}
                            OVR ·{' '}
                            {Math.round(
                              getPlayerStamina(
                                out,
                              ),
                            )}
                            %
                          </div>

                          <div
                            style={{
                              marginTop:
                                6,
                            }}
                          >
                            🟢 IN:{' '}
                            {
                              getPlayerName(
                                inPlayer,
                              )
                            }{' '}
                            ·{' '}
                            {getLivePlayerRating(
                              inPlayer,
                            )}{' '}
                            OVR ·{' '}
                            {Math.round(
                              getPlayerStamina(
                                inPlayer,
                              ),
                            )}
                            %
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

              <button
                type="button"
                onClick={
                  makeSubstitution
                }
                disabled={
                  substitutionsUsed >=
                    MAX_SUBSTITUTIONS ||
                  !selectedPlayerOut ||
                  !selectedPlayerIn
                }
                style={{
                  marginTop:
                    14,
                }}
              >
                🔄 Make
                Substitution
              </button>
            </section>
          )}

        {/* =================================================
            LIVE FATIGUE
        ================================================= */}

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
            <div>
              <span>
                PLAYER CONDITION
              </span>

              <strong>
                Formation{' '}
                {formation}
              </strong>
            </div>

            <span>
              {activeTactic.label}
            </span>
          </div>

          <div
            style={{
              display:
                'grid',
              gridTemplateColumns:
                'repeat(auto-fit,minmax(220px,1fr))',
              gap: 10,
            }}
          >
            {[
              [
                homeClub,
                homeXI,
                'home',
              ],
              [
                awayClub,
                awayXI,
                'away',
              ],
            ].map(
              ([
                club,
                players,
                team,
              ]) => (
                <div
                  key={team}
                  style={{
                    padding:
                      10,
                    borderRadius:
                      12,
                    background:
                      'rgba(255,255,255,0.03)',
                  }}
                >
                  <strong>
                    {getClubName(
                      club,
                    )}
                  </strong>

                  {players.map(
                    (player) => {
                      const stamina =
                        Math.round(
                          getPlayerStamina(
                            player,
                          ),
                        );

                      const rating =
                        getLivePlayerRating(
                          player,
                        );

                      return (
                        <div
                          key={String(
                            getPlayerId(
                              player,
                            ),
                          )}
                          style={{
                            marginTop:
                              9,
                          }}
                        >
                          <div
                            style={{
                              display:
                                'flex',
                              justifyContent:
                                'space-between',
                              gap: 8,
                            }}
                          >
                            <span>
                              {getPlayerName(
                                player,
                              )}
                            </span>

                            <strong>
                              {rating}
                            </strong>
                          </div>

                          <div
                            style={{
                              height:
                                5,
                              marginTop:
                                4,
                              borderRadius:
                                99,
                              background:
                                'rgba(255,255,255,0.1)',
                              overflow:
                                'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${stamina}%`,
                                height:
                                  '100%',
                                background:
                                  stamina <
                                  30
                                    ? '#ef4444'
                                    : stamina <
                                      60
                                      ? '#f59e0b'
                                      : '#22c55e',
                              }}
                            />
                          </div>

                          <small>
                            STAMINA{' '}
                            {stamina}
                            % · OVR{' '}
                            {rating}
                          </small>
                        </div>
                      );
                    },
                  )}
                </div>
              ),
            )}
          </div>
        </section>

        {/* =================================================
            MATCH STATS
        ================================================= */}

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
              `${homeStats.possession}%`,
              `${awayStats.possession}%`,
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
            ),
          )}
        </section>

        {/* =================================================
            EVENTS
        ================================================= */}

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
                    !previous,
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
                        {
                          event.minute
                        }
                        '
                      </span>

                      <span
                        className={
                          styles.eventIcon
                        }
                      >
                        {eventIcon(
                          event,
                        )}
                      </span>

                      <div>
                        <strong>
                          {eventLabel(
                            event,
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
                              homeClub,
                            )
                          : getClubName(
                              awayClub,
                            )}
                      </span>
                    </article>
                  ),
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

        {/* =================================================
            LINEUPS
        ================================================= */}

        <section
          className={
            styles.lineups
          }
        >
          {[
            [
              homeClub,
              homeXI,
              'HOME',
            ],
            [
              awayClub,
              awayXI,
              'AWAY',
            ],
          ].map(
            ([
              club,
              players,
              label,
            ]) => (
              <div
                key={label}
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
                      club,
                    )}
                  </h2>

                  <span>
                    {players.length}
                    /11
                  </span>
                </div>

                <div
                  className={
                    styles.playerList
                  }
                >
                  {players.map(
                    (player) => {
                      const stamina =
                        Math.round(
                          getPlayerStamina(
                            player,
                          ),
                        );

                      const rating =
                        getLivePlayerRating(
                          player,
                        );

                      return (
                        <div
                          key={String(
                            getPlayerId(
                              player,
                            ),
                          )}
                          className={
                            styles.player
                          }
                        >
                          {getPlayerPhoto(
                            player,
                          ) ? (
                            <img
                              src={getPlayerPhoto(
                                player,
                              )}
                              alt=""
                            />
                          ) : (
                            <span>
                              ⚽
                            </span>
                          )}

                          <div
                            style={{
                              flex: 1,
                            }}
                          >
                            <strong>
                              {getPlayerName(
                                player,
                              )}
                            </strong>

                            <small>
                              {normalizePosition(
                                getPlayerPosition(
                                  player,
                                ),
                              )}{' '}
                              · OVR{' '}
                              {rating}{' '}
                              ·{' '}
                              {stamina}
                              %
                            </small>

                            <div
                              style={{
                                height:
                                  4,
                                marginTop:
                                  4,
                                background:
                                  'rgba(255,255,255,0.1)',
                                borderRadius:
                                  99,
                              }}
                            >
                              <div
                                style={{
                                  width: `${stamina}%`,
                                  height:
                                    '100%',
                                  background:
                                    stamina <
                                    30
                                      ? '#ef4444'
                                      : stamina <
                                        60
                                        ? '#f59e0b'
                                        : '#22c55e',
                                  borderRadius:
                                    99,
                                }}
                              />
                            </div>
                          </div>

                          <strong>
                            {rating}
                          </strong>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            ),
          )}
        </section>

        {/* =================================================
            MATCH INFO
        ================================================= */}

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
                  homeClub,
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
              {activeTactic.label}
            </strong>
          </div>

          <div>
            <span>
              ROUND
            </span>

            <strong>
              {fixture.round ||
                '-'}
            </strong>
          </div>

          <div>
            <span>
              SEASON
            </span>

            <strong>
              {fixture.season ||
                '-'}
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
