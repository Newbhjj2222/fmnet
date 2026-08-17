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
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import toast from 'react-hot-toast';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import styles from './match.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MATCH_DURATION_MINUTES = 20;
const FIRST_HALF_END = 10;

const PLAYERS_ON_PITCH = 11;
const MAX_SUBSTITUTIONS = 5;

const PITCH_WIDTH = 30;
const PITCH_HEIGHT = 20;
const GOAL_WIDTH = 6;

const PLAYER_SPEED_BASE = 0.3;
const PASS_SPEED = 0.25;
const SHOT_SPEED = 0.6;

const BALL_SIZE = 0.15;
const PLAYER_RADIUS = 0.35;

const DECISION_INTERVAL = 0.2;
const FIREBASE_SAVE_INTERVAL = 2;

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(array) {
  if (!Array.isArray(array) || !array.length) return null;

  return array[Math.floor(Math.random() * array.length)];
}

function distanceBetween(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
      (a.y - b.y) ** 2 +
      (a.z - b.z) ** 2,
  );
}

function playerId(player) {
  return (
    player?.id ||
    player?.playerId ||
    player?.uid ||
    null
  );
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
   POSITIONS
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
   FORMATIONS
========================================================= */

const FORMATIONS = {
  '4-4-2': [
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

  '4-3-3': [
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

  '3-5-2': [
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

  '5-3-2': [
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

  '4-2-3-1': [
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
  PASS: 'pass',
  TACKLE: 'tackle',
  KICKOFF: 'kickoff',
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

    case EVENT_TYPES.PASS:
      return 'PASS';

    case EVENT_TYPES.TACKLE:
      return 'TACKLE';

    case EVENT_TYPES.KICKOFF:
      return 'KICKOFF';

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

    case EVENT_TYPES.PASS:
      return '🦶';

    case EVENT_TYPES.TACKLE:
      return '⚡';

    case EVENT_TYPES.KICKOFF:
      return '🟢';

    default:
      return '•';
  }
}

/* =========================================================
   STATS
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
   STARTING XI
========================================================= */

function selectStartingXI(
  squad,
  formation = '4-4-2',
) {
  const safeSquad = Array.isArray(squad)
    ? [...squad]
    : [];

  const requirementsMap = {
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
    requirementsMap[formation] ||
    requirementsMap['4-4-2'];

  const groups = {
    GK: [],
    DEF: [],
    MID: [],
    ATT: [],
  };

  safeSquad.forEach((player) => {
    const position = normalizePosition(
      getPlayerPosition(player),
    );

    if (groups[position]) {
      groups[position].push(player);
    }
  });

  const used = new Set();
  const result = [];

  const addBest = (players, count) => {
    [...players]
      .sort(
        (a, b) =>
          getPlayerOverall(b) -
          getPlayerOverall(a),
      )
      .slice(0, count)
      .forEach((player) => {
        const id = String(playerId(player));

        if (!used.has(id)) {
          used.add(id);
          result.push(player);
        }
      });
  };

  addBest(groups.GK, requirements.GK);
  addBest(groups.DEF, requirements.DEF);
  addBest(groups.MID, requirements.MID);
  addBest(groups.ATT, requirements.ATT);

  const remaining = safeSquad
    .filter(
      (player) =>
        !used.has(String(playerId(player))),
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
   GENERATED PLAYERS
========================================================= */

function createGeneratedPlayer(
  club,
  position,
  index,
) {
  const clubName =
    getClubName(club, 'Club')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim() || 'Club';

  const clubId = String(club?.id || 'club');

  const overall =
    55 +
    ((index * 7 + clubId.length) % 21);

  return {
    id: `gen-${clubId}-${position}-${index}`,
    name: `${clubName} Youth ${index + 1}`,
    position,
    overall,
    isGenerated: true,
  };
}

function generateClubPlayers(
  club,
  existingPlayers,
  targetCount = 16,
) {
  const players = Array.isArray(existingPlayers)
    ? [...existingPlayers]
    : [];

  const counts = {
    GK: 0,
    DEF: 0,
    MID: 0,
    ATT: 0,
  };

  players.forEach((player) => {
    const position = normalizePosition(
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
    ([position, requiredCount]) => {
      while (
        counts[position] < requiredCount
      ) {
        players.push(
          createGeneratedPlayer(
            club,
            position,
            generatedIndex,
          ),
        );

        counts[position] += 1;
        generatedIndex += 1;
      }
    },
  );

  const extraPositions = [
    'MID',
    'ATT',
    'DEF',
    'MID',
    'ATT',
    'DEF',
    'MID',
    'GK',
  ];

  while (players.length < targetCount) {
    const position =
      extraPositions[
        (players.length - 11) %
          extraPositions.length
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
   FIREBASE LOADERS
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
      'Primary player query failed:',
      error,
    );
  }

  try {
    const snapshot =
      await getDocs(collection(db, 'players'));

    return snapshot.docs
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
      'Fallback player query failed:',
      error,
    );

    return [];
  }
}

async function loadMatchFromDatabase(matchId) {
  if (!matchId) return null;

  try {
    const matchRef = doc(
      db,
      'matches',
      matchId,
    );

    const snapshot =
      await getDoc(matchRef);

    if (snapshot.exists()) {
      return {
        id: snapshot.id,
        ...snapshot.data(),
        _source: 'matches',
      };
    }
  } catch (error) {
    console.error(
      'Matches load error:',
      error,
    );
  }

  try {
    const fixtureRef = doc(
      db,
      'fixtures',
      matchId,
    );

    const snapshot =
      await getDoc(fixtureRef);

    if (snapshot.exists()) {
      return {
        id: snapshot.id,
        ...snapshot.data(),
        _source: 'fixtures',
      };
    }
  } catch (error) {
    console.error(
      'Fixtures load error:',
      error,
    );
  }

  return null;
}

/* =========================================================
   PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    loading: authLoading,
  } = useAuth();

  const matchId =
    typeof router.query.id === 'string'
      ? router.query.id
      : null;

  /* =======================================================
     UI STATE
  ======================================================= */

  const [fixture, setFixture] = useState(null);

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

  const [playersLoading, setPlayersLoading] =
    useState(false);

  const [homeScore, setHomeScore] =
    useState(0);

  const [awayScore, setAwayScore] =
    useState(0);

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [matchStatus, setMatchStatus] =
    useState('ready');

  const [events, setEvents] =
    useState([]);

  const [homeStats, setHomeStats] =
    useState(createDefaultStats());

  const [awayStats, setAwayStats] =
    useState(createDefaultStats());

  const [mentality, setMentality] =
    useState('balanced');

  const [formation, setFormation] =
    useState('4-4-2');

  const [showTactics, setShowTactics] =
    useState(false);

  const [showSubs, setShowSubs] =
    useState(false);

  const [showEvents, setShowEvents] =
    useState(true);

  const [showFormation, setShowFormation] =
    useState(false);

  const [savingMatch, setSavingMatch] =
    useState(false);

  const [paused, setPaused] =
    useState(false);

  const [halfTimeShown, setHalfTimeShown] =
    useState(false);

  const [userClubId, setUserClubId] =
    useState(null);

  const [userClubLoading, setUserClubLoading] =
    useState(true);

  const [substitutionsUsed, setSubstitutionsUsed] =
    useState(0);

  const [selectedSubPlayer, setSelectedSubPlayer] =
    useState('');

  /* =======================================================
     THREE REFS
  ======================================================= */

  const mountRef = useRef(null);

  const sceneRef = useRef(null);

  const cameraRef = useRef(null);

  const rendererRef = useRef(null);

  const controlsRef = useRef(null);

  const ballMeshRef = useRef(null);

  const playerMeshesRef = useRef({
    home: [],
    away: [],
  });

  const animationFrameRef =
    useRef(null);

  const threeClockRef =
    useRef(null);

  const sceneInitializedRef =
    useRef(false);

  /* =======================================================
     MATCH ENGINE REFS
  ======================================================= */

  const gameClockRef =
    useRef(0);

  const ballStateRef =
    useRef(null);

  const playersStateRef =
    useRef({
      home: [],
      away: [],
    });

  const lastSimulationTimeRef =
    useRef(0);

  const lastFirestoreSaveRef =
    useRef(0);

  const simulationVersionRef =
    useRef(0);

  const finishCalledRef =
    useRef(false);

  const homeScoreRef =
    useRef(0);

  const awayScoreRef =
    useRef(0);

  const matchMinuteRef =
    useRef(0);

  const matchStatusRef =
    useRef('ready');

  const homeStatsRef =
    useRef(createDefaultStats());

  const awayStatsRef =
    useRef(createDefaultStats());

  const eventsRef =
    useRef([]);

  const mentalityRef =
    useRef('balanced');

  const formationRef =
    useRef('4-4-2');

  const pausedRef =
    useRef(false);

  const substitutionsUsedRef =
    useRef(0);

  /* =======================================================
     PARTICIPATION
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
    if (authLoading) return;

    if (!user) {
      setUserClubLoading(false);
      return;
    }

    let cancelled = false;

    async function loadUserClub() {
      try {
        setUserClubLoading(true);

        const userRef = doc(
          db,
          'users',
          user.uid,
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
          'User club loading error:',
          error,
        );
      } finally {
        if (!cancelled) {
          setUserClubLoading(false);
        }
      }
    }

    loadUserClub();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  /* =======================================================
     LOAD MATCH + CLUBS
     
     IMPORTANT:
     We intentionally DO NOT wait for players.
     Once match + clubs are available, the UI renders.
  ======================================================= */

  useEffect(() => {
    if (
      authLoading ||
      !user ||
      !matchId
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        const match =
          await loadMatchFromDatabase(
            matchId,
          );

        if (cancelled) return;

        if (!match) {
          toast.error(
            'Match not found in database',
          );

          router.push('/fixtures');
          return;
        }

        setFixture(match);

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
            doc(db, 'clubs', homeId),
          ),
          getDoc(
            doc(db, 'clubs', awayId),
          ),
        ]);

        if (cancelled) return;

        const home =
          homeSnapshot.exists()
            ? {
                id: homeSnapshot.id,
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
                id: awaySnapshot.id,
                ...awaySnapshot.data(),
              }
            : {
                id: awayId,
                name:
                  match.awayClubName ||
                  'Away',
              };

        setHomeClub(home);
        setAwayClub(away);

        /* =================================================
           MATCH STATE
        ================================================= */

        const initialMinute =
          safeNumber(
            match.minute ??
              match.matchMinute,
            0,
          );

        const initialStatus =
          match.status || 'ready';

        homeScoreRef.current =
          safeNumber(
            match.homeScore ??
              match.result?.homeScore,
            0,
          );

        awayScoreRef.current =
          safeNumber(
            match.awayScore ??
              match.result?.awayScore,
            0,
          );

        matchMinuteRef.current =
          initialMinute;

        matchStatusRef.current =
          initialStatus;

        homeStatsRef.current = {
          ...createDefaultStats(),
          ...(match.homeStats || {}),
        };

        awayStatsRef.current = {
          ...createDefaultStats(),
          ...(match.awayStats || {}),
        };

        eventsRef.current =
          Array.isArray(match.events)
            ? match.events
            : [];

        simulationVersionRef.current =
          safeNumber(
            match.simulationVersion,
            0,
          );

        mentalityRef.current =
          match.mentality ||
          'balanced';

        formationRef.current =
          match.formation ||
          '4-4-2';

        substitutionsUsedRef.current =
          safeNumber(
            match.substitutionsUsed,
            0,
          );

        setMatchMinute(
          matchMinuteRef.current,
        );

        setMatchStatus(
          matchStatusRef.current,
        );

        setHomeScore(
          homeScoreRef.current,
        );

        setAwayScore(
          awayScoreRef.current,
        );

        setHomeStats(
          homeStatsRef.current,
        );

        setAwayStats(
          awayStatsRef.current,
        );

        setEvents(
          eventsRef.current,
        );

        setMentality(
          mentalityRef.current,
        );

        setFormation(
          formationRef.current,
        );

        setSubstitutionsUsed(
          substitutionsUsedRef.current,
        );

        /*
         * Ball can exist before players finish loading.
         */
        ballStateRef.current = {
          mode: 'possessed',
          team: 'home',
          playerIndex: 5,
        };

        /*
         * IMPORTANT:
         * From here the page is ready.
         * Players are loaded separately below.
         */

        loadPlayersInBackground(
          home,
          away,
          homeId,
          awayId,
        );
      } catch (error) {
        console.error(
          'Match loading error:',
          error,
        );

        toast.error(
          'Could not load match',
        );
      }
    }

    async function loadPlayersInBackground(
      home,
      away,
      homeId,
      awayId,
    ) {
      try {
        setPlayersLoading(true);

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

        const startingHome =
          selectStartingXI(
            preparedHome,
            formationRef.current,
          );

        const startingAway =
          selectStartingXI(
            preparedAway,
            formationRef.current,
          );

        setHomeSquad(
          preparedHome,
        );

        setAwaySquad(
          preparedAway,
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
                    playerId(starter),
                  ) ===
                  String(
                    playerId(player),
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
                    playerId(starter),
                  ) ===
                  String(
                    playerId(player),
                  ),
              ),
          ),
        );
      } catch (error) {
        console.error(
          'Background players error:',
          error,
        );

        /*
         * Even if Firestore player loading fails,
         * generate players locally.
         */

        const generatedHome =
          generateClubPlayers(
            home,
            [],
          );

        const generatedAway =
          generateClubPlayers(
            away,
            [],
          );

        const startingHome =
          selectStartingXI(
            generatedHome,
            formationRef.current,
          );

        const startingAway =
          selectStartingXI(
            generatedAway,
            formationRef.current,
          );

        setHomeSquad(
          generatedHome,
        );

        setAwaySquad(
          generatedAway,
        );

        setHomeXI(
          startingHome,
        );

        setAwayXI(
          startingAway,
        );

        setHomeBench(
          generatedHome.filter(
            (player) =>
              !startingHome.some(
                (starter) =>
                  String(
                    playerId(starter),
                  ) ===
                  String(
                    playerId(player),
                  ),
              ),
          ),
        );

        setAwayBench(
          generatedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) =>
                  String(
                    playerId(starter),
                  ) ===
                  String(
                    playerId(player),
                  ),
              ),
          ),
        );
      } finally {
        if (!cancelled) {
          setPlayersLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    matchId,
    router,
  ]);

  /* =======================================================
     FIRESTORE SAVE
  ======================================================= */

  const saveMatchStateToFirestore =
    useCallback(async () => {
      if (!matchId) return;

      try {
        const matchRef = doc(
          db,
          'matches',
          matchId,
        );

        await setDoc(
          matchRef,
          {
            id: matchId,

            status:
              matchStatusRef.current,

            minute:
              matchMinuteRef.current,

            homeScore:
              homeScoreRef.current,

            awayScore:
              awayScoreRef.current,

            result: {
              homeScore:
                homeScoreRef.current,

              awayScore:
                awayScoreRef.current,
            },

            events:
              eventsRef.current,

            homeStats:
              homeStatsRef.current,

            awayStats:
              awayStatsRef.current,

            substitutionsUsed:
              substitutionsUsedRef.current,

            mentality:
              mentalityRef.current,

            formation:
              formationRef.current,

            simulationVersion:
              simulationVersionRef.current,

            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          },
        );
      } catch (error) {
        console.error(
          'Firestore save error:',
          error,
        );
      }
    }, [matchId]);

  /* =======================================================
     FINISH MATCH
  ======================================================= */

  const finishMatch =
    useCallback(async () => {
      if (
        finishCalledRef.current
      ) {
        return;
      }

      finishCalledRef.current = true;

      try {
        setSavingMatch(true);

        matchStatusRef.current =
          'finished';

        pausedRef.current = true;

        matchMinuteRef.current =
          MATCH_DURATION_MINUTES;

        setMatchStatus(
          'finished',
        );

        setPaused(true);

        setMatchMinute(
          MATCH_DURATION_MINUTES,
        );

        await saveMatchStateToFirestore();

        toast.success(
          `Full time: ${homeScoreRef.current} - ${awayScoreRef.current}`,
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
    }, [
      saveMatchStateToFirestore,
    ]);

  /* =======================================================
     THREE.JS
     
     IMPORTANT:
     substitutionsUsed is NOT a dependency.
  ======================================================= */

  useEffect(() => {
    if (
      !mountRef.current ||
      sceneInitializedRef.current ||
      !homeXI.length ||
      !awayXI.length
    ) {
      return;
    }

    sceneInitializedRef.current = true;

    const container =
      mountRef.current;

    const width =
      container.clientWidth || 800;

    const height =
      container.clientHeight || 450;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(0x0b1120);

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

    renderer.shadowMap.enabled = true;

    container.appendChild(
      renderer.domElement,
    );

    const controls =
      new OrbitControls(
        camera,
        renderer.domElement,
      );

    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    controls.target.set(
      0,
      0,
      0,
    );

    controls.maxPolarAngle =
      Math.PI / 2.5;

    controls.minDistance = 15;
    controls.maxDistance = 50;

    controls.update();

    const ambientLight =
      new THREE.AmbientLight(
        0xffffff,
        0.5,
      );

    scene.add(
      ambientLight,
    );

    const directionalLight =
      new THREE.DirectionalLight(
        0xffffff,
        1,
      );

    directionalLight.position.set(
      10,
      20,
      10,
    );

    directionalLight.castShadow = true;

    scene.add(
      directionalLight,
    );

    /* =====================================================
       PITCH
    ===================================================== */

    const pitchGeometry =
      new THREE.PlaneGeometry(
        PITCH_WIDTH,
        PITCH_HEIGHT,
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

    pitch.receiveShadow = true;

    scene.add(pitch);

    /* =====================================================
       LINES
    ===================================================== */

    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    const borderGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
          new THREE.Vector3(
            -PITCH_WIDTH / 2,
            0.01,
            -PITCH_HEIGHT / 2,
          ),

          new THREE.Vector3(
            PITCH_WIDTH / 2,
            0.01,
            -PITCH_HEIGHT / 2,
          ),

          new THREE.Vector3(
            PITCH_WIDTH / 2,
            0.01,
            PITCH_HEIGHT / 2,
          ),

          new THREE.Vector3(
            -PITCH_WIDTH / 2,
            0.01,
            PITCH_HEIGHT / 2,
          ),

          new THREE.Vector3(
            -PITCH_WIDTH / 2,
            0.01,
            -PITCH_HEIGHT / 2,
          ),
        ],
      );

    scene.add(
      new THREE.Line(
        borderGeometry,
        lineMaterial,
      ),
    );

    const centerLineGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
          new THREE.Vector3(
            0,
            0.01,
            -PITCH_HEIGHT / 2,
          ),

          new THREE.Vector3(
            0,
            0.01,
            PITCH_HEIGHT / 2,
          ),
        ],
      );

    scene.add(
      new THREE.Line(
        centerLineGeometry,
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

    const centerCircle =
      new THREE.Mesh(
        circleGeometry,
        circleMaterial,
      );

    centerCircle.rotation.x =
      -Math.PI / 2;

    centerCircle.position.y =
      0.02;

    scene.add(
      centerCircle,
    );

    /* =====================================================
       GOALS
    ===================================================== */

    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
      });

    const goalGeometry =
      new THREE.BoxGeometry(
        0.1,
        0.15,
        GOAL_WIDTH,
      );

    const leftGoal =
      new THREE.Mesh(
        goalGeometry,
        goalMaterial,
      );

    leftGoal.position.set(
      -PITCH_WIDTH / 2,
      0.08,
      0,
    );

    scene.add(leftGoal);

    const rightGoal =
      new THREE.Mesh(
        goalGeometry,
        goalMaterial,
      );

    rightGoal.position.set(
      PITCH_WIDTH / 2,
      0.08,
      0,
    );

    scene.add(rightGoal);

    /* =====================================================
       BALL
    ===================================================== */

    const ballGeometry =
      new THREE.SphereGeometry(
        BALL_SIZE,
        32,
        32,
      );

    const ballMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
      });

    const ball =
      new THREE.Mesh(
        ballGeometry,
        ballMaterial,
      );

    ball.position.set(
      0,
      BALL_SIZE,
      0,
    );

    scene.add(ball);

    ballMeshRef.current = ball;

    /* =====================================================
       PLAYER MESH
    ===================================================== */

    const createPlayerMesh =
      (x, z, color) => {
        const group =
          new THREE.Group();

        const bodyGeometry =
          new THREE.CylinderGeometry(
            PLAYER_RADIUS,
            PLAYER_RADIUS,
            0.6,
            16,
          );

        const bodyMaterial =
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
          });

        const body =
          new THREE.Mesh(
            bodyGeometry,
            bodyMaterial,
          );

        body.position.y =
          0.3;

        group.add(body);

        const headGeometry =
          new THREE.SphereGeometry(
            0.15,
            16,
            16,
          );

        const headMaterial =
          new THREE.MeshStandardMaterial({
            color: 0xffcc99,
          });

        const head =
          new THREE.Mesh(
            headGeometry,
            headMaterial,
          );

        head.position.y =
          0.75;

        group.add(head);

        group.position.set(
          x,
          0,
          z,
        );

        scene.add(group);

        return group;
      };

    const positions =
      FORMATIONS[
        formationRef.current
      ] ||
      FORMATIONS['4-4-2'];

    playerMeshesRef.current.home =
      positions.map((position) => {
        const x =
          ((position.x - 50) / 50) *
          PITCH_WIDTH;

        const z =
          ((position.y - 50) / 50) *
          PITCH_HEIGHT;

        return createPlayerMesh(
          x,
          z,
          0x3b82f6,
        );
      });

    playerMeshesRef.current.away =
      positions.map((position) => {
        const x =
          ((50 - position.x) / 50) *
          PITCH_WIDTH;

        const z =
          ((50 - position.y) / 50) *
          PITCH_HEIGHT;

        return createPlayerMesh(
          x,
          z,
          0xef4444,
        );
      });

    playersStateRef.current.home =
      homeXI.map(
        (player, index) => ({
          id: playerId(player),

          name:
            getPlayerName(player),

          position:
            normalizePosition(
              getPlayerPosition(
                player,
              ),
            ),

          overall:
            getPlayerOverall(
              player,
            ),

          team: 'home',

          index,

          speed:
            PLAYER_SPEED_BASE +
            (getPlayerOverall(
              player,
            ) -
              60) *
              0.005,

          stamina: 100,

          hasBall: false,

          target: {
            x:
              playerMeshesRef
                .current.home[
                index
              ]?.position.x || 0,

            z:
              playerMeshesRef
                .current.home[
                index
              ]?.position.z || 0,
          },

          decisionCooldown: 0,
        }),
      );

    playersStateRef.current.away =
      awayXI.map(
        (player, index) => ({
          id: playerId(player),

          name:
            getPlayerName(player),

          position:
            normalizePosition(
              getPlayerPosition(
                player,
              ),
            ),

          overall:
            getPlayerOverall(
              player,
            ),

          team: 'away',

          index,

          speed:
            PLAYER_SPEED_BASE +
            (getPlayerOverall(
              player,
            ) -
              60) *
              0.005,

          stamina: 100,

          hasBall: false,

          target: {
            x:
              playerMeshesRef
                .current.away[
                index
              ]?.position.x || 0,

            z:
              playerMeshesRef
                .current.away[
                index
              ]?.position.z || 0,
          },

          decisionCooldown: 0,
        }),
      );

    /* =====================================================
       ENGINE
    ===================================================== */

    const updatePlayers =
      (delta) => {
        const home =
          playersStateRef.current
            .home;

        const away =
          playersStateRef.current
            .away;

        [
          ...home,
          ...away,
        ].forEach((player) => {
          player.stamina =
            clamp(
              player.stamina -
                delta * 2,
              0,
              100,
            );

          player.speed =
            PLAYER_SPEED_BASE +
            (player.overall - 60) *
              0.005 +
            (player.stamina - 100) *
              0.002;
        });

        home.forEach(
          (player, index) => {
            if (player.hasBall)
              return;

            const formationPosition =
              positions[index] ||
              positions[0];

            let targetX =
              ((formationPosition.x -
                50) /
                50) *
              PITCH_WIDTH;

            let targetZ =
              ((formationPosition.y -
                50) /
                50) *
              PITCH_HEIGHT;

            if (
              player.position ===
              'GK'
            ) {
              targetX =
                -PITCH_WIDTH / 2 +
                1;
            }

            player.target = {
              x: targetX,
              z: targetZ,
            };
          },
        );

        away.forEach(
          (player, index) => {
            if (player.hasBall)
              return;

            const formationPosition =
              positions[index] ||
              positions[0];

            let targetX =
              ((50 -
                formationPosition.x) /
                50) *
              PITCH_WIDTH;

            let targetZ =
              ((50 -
                formationPosition.y) /
                50) *
              PITCH_HEIGHT;

            if (
              player.position ===
              'GK'
            ) {
              targetX =
                PITCH_WIDTH / 2 -
                1;
            }

            player.target = {
              x: targetX,
              z: targetZ,
            };
          },
        );

        const ballState =
          ballStateRef.current;

        if (!ballState) return;

        if (
          ballState.mode ===
          'possessed'
        ) {
          const players =
            ballState.team ===
            'home'
              ? home
              : away;

          const player =
            players[
              ballState.playerIndex
            ];

          if (!player) return;

          player.hasBall = true;

          if (
            player.decisionCooldown >
            0
          ) {
            player.decisionCooldown -=
              delta;

            return;
          }

          player.decisionCooldown =
            DECISION_INTERVAL;

          const random =
            Math.random();

          const team =
            ballState.team;

          const mesh =
            team === 'home'
              ? playerMeshesRef
                  .current.home[
                  player.index
                ]
              : playerMeshesRef
                  .current.away[
                  player.index
                ];

          if (!mesh) return;

          const direction =
            team === 'home'
              ? 1
              : -1;

          const goalX =
            direction *
            (PITCH_WIDTH / 2 - 2);

          if (random < 0.3) {
            const teammates =
              players.filter(
                (_, index) =>
                  index !==
                  player.index,
              );

            const teammate =
              pick(teammates);

            if (teammate) {
              const teammateMesh =
                team === 'home'
                  ? playerMeshesRef
                      .current.home[
                      teammate.index
                    ]
                  : playerMeshesRef
                      .current.away[
                      teammate.index
                    ];

              if (teammateMesh) {
                ballStateRef.current =
                  {
                    mode: 'passing',
                    team,
                    fromIndex:
                      player.index,
                    toIndex:
                      teammate.index,
                    from: {
                      x:
                        mesh.position.x,
                      y: 0,
                      z:
                        mesh.position.z,
                    },
                    to: {
                      x:
                        teammateMesh
                          .position.x,
                      y: 0,
                      z:
                        teammateMesh
                          .position.z,
                    },
                    progress: 0,
                  };

                player.hasBall =
                  false;
              }
            }
          } else if (
            random < 0.5
          ) {
            const distanceToGoal =
              Math.abs(
                goalX -
                  mesh.position.x,
              );

            if (
              distanceToGoal <
              10
            ) {
              ballStateRef.current =
                {
                  mode: 'shot',
                  team,
                  fromIndex:
                    player.index,
                  from: {
                    x:
                      mesh.position.x,
                    y: 0,
                    z:
                      mesh.position.z,
                  },
                  to: {
                    x: goalX,
                    y: 0,
                    z: randomBetween(
                      -2,
                      2,
                    ),
                  },
                  progress: 0,
                };

              player.hasBall =
                false;

              const stats =
                team === 'home'
                  ? homeStatsRef
                  : awayStatsRef;

              stats.current = {
                ...stats.current,
                shots:
                  stats.current
                    .shots + 1,
              };

              if (team === 'home') {
                setHomeStats({
                  ...stats.current,
                });
              } else {
                setAwayStats({
                  ...stats.current,
                });
              }
            }
          } else {
            player.target = {
              x:
                mesh.position.x +
                direction * 0.5,

              z:
                mesh.position.z +
                (Math.random() -
                  0.5),
            };
          }
        }

        if (
          ballState.mode ===
          'passing'
        ) {
          ballState.progress +=
            PASS_SPEED * delta;

          if (
            ballState.progress >=
            1
          ) {
            ballStateRef.current =
              {
                mode: 'possessed',
                team:
                  ballState.team,
                playerIndex:
                  ballState.toIndex,
              };
          }
        }

        if (
          ballState.mode ===
          'shot'
        ) {
          ballState.progress +=
            SHOT_SPEED * delta;

          if (
            ballState.progress >=
            1
          ) {
            const shootingTeam =
              ballState.team;

            const defendingTeam =
              shootingTeam ===
              'home'
                ? 'away'
                : 'home';

            const isGoal =
              Math.random() <
              0.4;

            if (isGoal) {
              if (
                shootingTeam ===
                'home'
              ) {
                homeScoreRef.current +=
                  1;

                setHomeScore(
                  homeScoreRef.current,
                );

                homeStatsRef.current = {
                  ...homeStatsRef.current,
                  shotsOnTarget:
                    homeStatsRef.current
                      .shotsOnTarget +
                    1,
                };

                setHomeStats({
                  ...homeStatsRef.current,
                });
              } else {
                awayScoreRef.current +=
                  1;

                setAwayScore(
                  awayScoreRef.current,
                );

                awayStatsRef.current = {
                  ...awayStatsRef.current,
                  shotsOnTarget:
                    awayStatsRef.current
                      .shotsOnTarget +
                    1,
                };

                setAwayStats({
                  ...awayStatsRef.current,
                });
              }

              const event = {
                id: `${Date.now()}-goal`,
                type:
                  EVENT_TYPES.GOAL,
                team:
                  shootingTeam,
                minute:
                  matchMinuteRef.current,
                playerId:
                  null,
                playerName:
                  '',
                detail:
                  'Goal scored',
                createdAt:
                  new Date().toISOString(),
              };

              eventsRef.current = [
                event,
                ...eventsRef.current,
              ];

              setEvents([
                ...eventsRef.current,
              ]);

              ballStateRef.current =
                {
                  mode: 'kickoff',
                  team:
                    defendingTeam,
                };
            } else {
              const event = {
                id: `${Date.now()}-save`,
                type:
                  EVENT_TYPES.SAVE,
                team:
                  defendingTeam,
                minute:
                  matchMinuteRef.current,
                playerId:
                  null,
                playerName:
                  '',
                detail:
                  'Goalkeeper save',
                createdAt:
                  new Date().toISOString(),
              };

              eventsRef.current = [
                event,
                ...eventsRef.current,
              ];

              setEvents([
                ...eventsRef.current,
              ]);

              ballStateRef.current =
                {
                  mode: 'possessed',
                  team:
                    defendingTeam,
                  playerIndex: 0,
                };
            }
          }
        }

        if (
          ballState.mode ===
          'kickoff'
        ) {
          ballStateRef.current =
            {
              mode: 'possessed',
              team:
                ballState.team,
              playerIndex: 5,
            };
        }
      };

    const updateBall =
      () => {
        const ball =
          ballMeshRef.current;

        const state =
          ballStateRef.current;

        if (!ball || !state)
          return;

        if (
          state.mode ===
          'possessed'
        ) {
          const mesh =
            state.team === 'home'
              ? playerMeshesRef
                  .current.home[
                  state.playerIndex
                ]
              : playerMeshesRef
                  .current.away[
                  state.playerIndex
                ];

          if (mesh) {
            ball.position.x =
              mesh.position.x;

            ball.position.z =
              mesh.position.z;

            ball.position.y =
              BALL_SIZE;
          }

          return;
        }

        if (
          state.mode ===
            'passing' ||
          state.mode ===
            'shot'
        ) {
          ball.position.x =
            lerp(
              state.from.x,
              state.to.x,
              state.progress,
            );

          ball.position.z =
            lerp(
              state.from.z,
              state.to.z,
              state.progress,
            );

          ball.position.y =
            BALL_SIZE +
            Math.sin(
              state.progress *
                Math.PI,
            ) *
              0.5;
        }
      };

    const animate =
      () => {
        animationFrameRef.current =
          requestAnimationFrame(
            animate,
          );

        const delta =
          threeClockRef.current?.getDelta() ||
          0.016;

        if (
          matchStatusRef.current ===
            'live' &&
          !pausedRef.current
        ) {
          const now =
            performance.now() /
            1000;

          if (
            !lastSimulationTimeRef
              .current
          ) {
            lastSimulationTimeRef.current =
              now;
          }

          const elapsed =
            now -
            lastSimulationTimeRef
              .current;

          lastSimulationTimeRef.current =
            now;

          gameClockRef.current +=
            elapsed;

          const minute =
            Math.floor(
              gameClockRef.current,
            );

          if (
            minute >
            matchMinuteRef.current
          ) {
            matchMinuteRef.current =
              minute;

            setMatchMinute(
              minute,
            );

            if (
              minute ===
                FIRST_HALF_END &&
              !halfTimeShown
            ) {
              matchStatusRef.current =
                'half-time';

              setMatchStatus(
                'half-time',
              );

              setHalfTimeShown(
                true,
              );
            }

            if (
              minute >=
                MATCH_DURATION_MINUTES &&
              !finishCalledRef.current
            ) {
              finishMatch();
            }
          }

          if (
            matchStatusRef.current ===
            'live'
          ) {
            updatePlayers(delta);

            updateBall();

            const current =
              performance.now() /
              1000;

            if (
              current -
                lastFirestoreSaveRef
                  .current >
              FIREBASE_SAVE_INTERVAL
            ) {
              lastFirestoreSaveRef.current =
                current;

              saveMatchStateToFirestore();
            }
          }
        }

        playerMeshesRef.current.home.forEach(
          (mesh, index) => {
            const state =
              playersStateRef.current
                .home[index];

            if (!state) return;

            mesh.position.x =
              lerp(
                mesh.position.x,
                state.target.x,
                0.1,
              );

            mesh.position.z =
              lerp(
                mesh.position.z,
                state.target.z,
                0.1,
              );
          },
        );

        playerMeshesRef.current.away.forEach(
          (mesh, index) => {
            const state =
              playersStateRef.current
                .away[index];

            if (!state) return;

            mesh.position.x =
              lerp(
                mesh.position.x,
                state.target.x,
                0.1,
              );

            mesh.position.z =
              lerp(
                mesh.position.z,
                state.target.z,
                0.1,
              );
          },
        );

        controls.update();

        renderer.render(
          scene,
          camera,
        );
      };

    sceneRef.current = scene;

    cameraRef.current = camera;

    rendererRef.current =
      renderer;

    controlsRef.current =
      controls;

    threeClockRef.current =
      new THREE.Clock();

    lastSimulationTimeRef.current =
      performance.now() / 1000;

    lastFirestoreSaveRef.current =
      performance.now() / 1000;

    animate();

    const handleResize =
      () => {
        if (
          !mountRef.current
        ) {
          return;
        }

        const nextWidth =
          mountRef.current
            .clientWidth || 800;

        const nextHeight =
          mountRef.current
            .clientHeight || 450;

        camera.aspect =
          nextWidth /
          nextHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
          nextWidth,
          nextHeight,
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

      controls.dispose();

      renderer.dispose();

      pitchGeometry.dispose();
      pitchMaterial.dispose();

      lineMaterial.dispose();

      ballGeometry.dispose();
      ballMaterial.dispose();

      if (
        container.contains(
          renderer.domElement,
        )
      ) {
        container.removeChild(
          renderer.domElement,
        );
      }

      sceneInitializedRef.current =
        false;

      playerMeshesRef.current = {
        home: [],
        away: [],
      };

      ballMeshRef.current =
        null;
    };
  }, [
    homeXI,
    awayXI,
    finishMatch,
    saveMatchStateToFirestore,
  ]);

  /* =======================================================
     REALTIME LISTENER
  ======================================================= */

  useEffect(() => {
    if (
      !user ||
      !matchId
    ) {
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
          if (!snapshot.exists())
            return;

          const data =
            snapshot.data();

          const incomingVersion =
            safeNumber(
              data.simulationVersion,
              0,
            );

          if (
            incomingVersion <
            simulationVersionRef.current
          ) {
            return;
          }

          /*
           * The local participant should not have
           * his live simulation overwritten by snapshots.
           */
          if (
            userIsParticipant &&
            matchStatusRef.current ===
              'live'
          ) {
            return;
          }

          matchMinuteRef.current =
            safeNumber(
              data.minute,
              matchMinuteRef.current,
            );

          homeScoreRef.current =
            safeNumber(
              data.homeScore ??
                data.result
                  ?.homeScore,
              homeScoreRef.current,
            );

          awayScoreRef.current =
            safeNumber(
              data.awayScore ??
                data.result
                  ?.awayScore,
              awayScoreRef.current,
            );

          eventsRef.current =
            Array.isArray(
              data.events,
            )
              ? data.events
              : [];

          homeStatsRef.current = {
            ...createDefaultStats(),
            ...(data.homeStats ||
              {}),
          };

          awayStatsRef.current = {
            ...createDefaultStats(),
            ...(data.awayStats ||
              {}),
          };

          matchStatusRef.current =
            data.status ||
            'ready';

          setMatchMinute(
            matchMinuteRef.current,
          );

          setHomeScore(
            homeScoreRef.current,
          );

          setAwayScore(
            awayScoreRef.current,
          );

          setEvents(
            eventsRef.current,
          );

          setHomeStats(
            homeStatsRef.current,
          );

          setAwayStats(
            awayStatsRef.current,
          );

          setMatchStatus(
            matchStatusRef.current,
          );
        },
        (error) => {
          console.error(
            'Realtime listener error:',
            error,
          );
        },
      );

    return () =>
      unsubscribe();
  }, [
    user,
    matchId,
    userIsParticipant,
  ]);

  /* =======================================================
     START MATCH
  ======================================================= */

  const startMatch =
    useCallback(async () => {
      if (!fixture) {
        toast.error(
          'Match is not ready.',
        );
        return;
      }

      if (
        !userIsParticipant
      ) {
        toast.error(
          'You are not managing a team in this match.',
        );
        return;
      }

      if (
        matchStatusRef.current ===
        'finished'
      ) {
        toast.error(
          'This match has already finished.',
        );
        return;
      }

      try {
        setSavingMatch(true);

        const now =
          performance.now() /
          1000;

        matchStatusRef.current =
          'live';

        pausedRef.current =
          false;

        lastSimulationTimeRef.current =
          now;

        lastFirestoreSaveRef.current =
          now;

        setMatchStatus(
          'live',
        );

        setPaused(false);

        const matchRef =
          doc(
            db,
            'matches',
            matchId,
          );

        await setDoc(
          matchRef,
          {
            id: matchId,

            status: 'live',

            minute:
              matchMinuteRef.current,

            homeScore:
              homeScoreRef.current,

            awayScore:
              awayScoreRef.current,

            result: {
              homeScore:
                homeScoreRef.current,

              awayScore:
                awayScoreRef.current,
            },

            events:
              eventsRef.current,

            homeStats:
              homeStatsRef.current,

            awayStats:
              awayStatsRef.current,

            substitutionsUsed:
              substitutionsUsedRef.current,

            mentality:
              mentalityRef.current,

            formation:
              formationRef.current,

            simulationVersion:
              simulationVersionRef.current,

            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          },
        );

        toast.success(
          'Match started',
        );
      } catch (error) {
        console.error(
          'Start match error:',
          error,
        );

        matchStatusRef.current =
          'ready';

        setMatchStatus(
          'ready',
        );

        toast.error(
          'Could not start match.',
        );
      } finally {
        setSavingMatch(false);
      }
    }, [
      fixture,
      userIsParticipant,
      matchId,
    ]);

  /* =======================================================
     PAUSE
  ======================================================= */

  const togglePause =
    useCallback(() => {
      if (
        matchStatusRef.current !==
        'live'
      ) {
        return;
      }

      pausedRef.current =
        !pausedRef.current;

      setPaused(
        pausedRef.current,
      );
    }, []);

  /* =======================================================
     SECOND HALF
  ======================================================= */

  const continueSecondHalf =
    useCallback(async () => {
      try {
        setSavingMatch(true);

        setHalfTimeShown(
          false,
        );

        matchStatusRef.current =
          'live';

        pausedRef.current =
          false;

        setMatchStatus(
          'live',
        );

        setPaused(false);

        lastSimulationTimeRef.current =
          performance.now() /
          1000;

        await saveMatchStateToFirestore();
      } catch (error) {
        console.error(
          'Second half error:',
          error,
        );

        toast.error(
          'Could not continue match.',
        );
      } finally {
        setSavingMatch(false);
      }
    }, [
      saveMatchStateToFirestore,
    ]);

  /* =======================================================
     FORMATION
  ======================================================= */

  const changeFormation =
    useCallback(
      async (value) => {
        formationRef.current =
          value;

        setFormation(value);

        if (
          homeSquad.length
        ) {
          const startingHome =
            selectStartingXI(
              homeSquad,
              value,
            );

          setHomeXI(
            startingHome,
          );

          setHomeBench(
            homeSquad.filter(
              (player) =>
                !startingHome.some(
                  (starter) =>
                    String(
                      playerId(
                        starter,
                      ),
                    ) ===
                    String(
                      playerId(
                        player,
                      ),
                    ),
                ),
            ),
          );
        }

        if (
          awaySquad.length
        ) {
          const startingAway =
            selectStartingXI(
              awaySquad,
              value,
            );

          setAwayXI(
            startingAway,
          );

          setAwayBench(
            awaySquad.filter(
              (player) =>
                !startingAway.some(
                  (starter) =>
                    String(
                      playerId(
                        starter,
                      ),
                    ) ===
                    String(
                      playerId(
                        player,
                      ),
                    ),
                ),
            ),
          );
        }

        await saveMatchStateToFirestore();
      },
      [
        homeSquad,
        awaySquad,
        saveMatchStateToFirestore,
      ],
    );

  /* =======================================================
     MENTALITY
  ======================================================= */

  const changeMentality =
    useCallback(
      async (value) => {
        mentalityRef.current =
          value;

        setMentality(value);

        await saveMatchStateToFirestore();
      },
      [
        saveMatchStateToFirestore,
      ],
    );

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  const makeSubstitution =
    useCallback(async () => {
      if (
        !userIsParticipant
      ) {
        return;
      }

      if (
        substitutionsUsedRef.current >=
        MAX_SUBSTITUTIONS
      ) {
        toast.error(
          'Maximum substitutions reached.',
        );
        return;
      }

      if (
        !selectedSubPlayer
      ) {
        toast.error(
          'Select a player.',
        );
        return;
      }

      const team =
        userTeam;

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
              playerId(player),
            ) ===
            String(
              selectedSubPlayer,
            ),
        );

      if (!playerIn) {
        toast.error(
          'Player not found.',
        );
        return;
      }

      const playerOut =
        pick(currentXI);

      if (!playerOut) {
        return;
      }

      const nextXI =
        currentXI.map(
          (player) =>
            String(
              playerId(player),
            ) ===
            String(
              playerId(
                playerOut,
              ),
            )
              ? playerIn
              : player,
        );

      const nextBench = [
        ...bench.filter(
          (player) =>
            String(
              playerId(player),
            ) !==
            String(
              playerId(playerIn),
            ),
        ),

        playerOut,
      ];

      const nextSubCount =
        substitutionsUsedRef.current +
        1;

      substitutionsUsedRef.current =
        nextSubCount;

      setSubstitutionsUsed(
        nextSubCount,
      );

      const event = {
        id: `${Date.now()}-substitution`,

        type:
          EVENT_TYPES.SUBSTITUTION,

        team,

        minute:
          matchMinuteRef.current,

        playerId:
          playerId(playerIn),

        playerName:
          getPlayerName(
            playerIn,
          ),

        detail: `${getPlayerName(
          playerIn,
        )} replaced ${getPlayerName(
          playerOut,
        )}`,

        createdAt:
          new Date().toISOString(),
      };

      eventsRef.current = [
        event,
        ...eventsRef.current,
      ];

      setEvents([
        ...eventsRef.current,
      ]);

      if (team === 'home') {
        setHomeXI(nextXI);
        setHomeBench(
          nextBench,
        );
      } else {
        setAwayXI(nextXI);
        setAwayBench(
          nextBench,
        );
      }

      setSelectedSubPlayer(
        '',
      );

      await saveMatchStateToFirestore();

      toast.success(
        'Substitution made',
      );
    }, [
      userIsParticipant,
      userTeam,
      homeXI,
      awayXI,
      homeBench,
      awayBench,
      selectedSubPlayer,
      saveMatchStateToFirestore,
    ]);

  /* =======================================================
     EVENTS
  ======================================================= */

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
     AUTH LOADING ONLY
     
     Notice:
     playersLoading does NOT block the page.
  ======================================================= */

  if (authLoading) {
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
          Loading account...
        </p>
      </main>
    );
  }

  if (!user) {
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
          Login required
        </h1>

        <p>
          You need to sign in
          to manage this match.
        </p>
      </main>
    );
  }

  /*
   * Only match + clubs block initial page.
   * Players and Three.js do not.
   */

  if (
    !fixture ||
    !homeClub ||
    !awayClub
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

  /* =======================================================
     RENDER
  ======================================================= */

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
              view the score and
              events, but you cannot
              play it.
            </p>
          </section>
        )}

        {/* PLAYER LOADING NOTICE */}

        {userIsParticipant &&
          playersLoading && (
            <div
              className={
                styles.warning
              }
            >
              <strong>
                Preparing squads...
              </strong>

              <p>
                Players are loading
                in the background.
                You can still start
                the match.
              </p>
            </div>
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
                {savingMatch
                  ? 'STARTING...'
                  : '▶ START MATCH'}
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
                  (value) =>
                    !value,
                )
              }
            >
              ⚙ Tactics
            </button>

            <button
              type="button"
              onClick={() =>
                setShowFormation(
                  (value) =>
                    !value,
                )
              }
            >
              📋 Formation
            </button>

            <button
              type="button"
              onClick={() =>
                setShowSubs(
                  (value) =>
                    !value,
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
                  Team Mentality
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
                          value,
                        )
                      }
                    >
                      {value
                        .charAt(
                          0,
                        )
                        .toUpperCase() +
                        value.slice(
                          1,
                        )}
                    </button>
                  ),
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

              <select
                value={
                  selectedSubPlayer
                }
                onChange={(event) =>
                  setSelectedSubPlayer(
                    event.target
                      .value,
                  )
                }
              >
                <option value="">
                  Select player
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
                          player,
                        ),
                      )}
                      value={String(
                        playerId(
                          player,
                        ),
                      )}
                    >
                      {getPlayerName(
                        player,
                      )}{' '}
                      · OVR{' '}
                      {getPlayerOverall(
                        player,
                      )}
                    </option>
                  ),
                )}
              </select>

              <button
                type="button"
                onClick={
                  makeSubstitution
                }
                disabled={
                  substitutionsUsed >=
                    MAX_SUBSTITUTIONS ||
                  !selectedSubPlayer
                }
              >
                Make
                Substitution
              </button>
            </section>
          )}

        {/* STATS */}

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
                  (value) =>
                    !value,
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

        {/* LINEUPS */}

        <section
          className={
            styles.lineups
          }
        >
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
                  homeClub,
                )}
              </h2>

              <span>
                {homeXI.length}/11 ·{' '}
                {formation}
              </span>
            </div>

            <div
              className={
                styles.playerList
              }
            >
              {homeXI.map(
                (player) => (
                  <div
                    key={String(
                      playerId(
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

                    <div>
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
                        {getPlayerOverall(
                          player,
                        )}
                      </small>
                    </div>

                    <span
                      className={
                        styles.playerRating
                      }
                    >
                      {getPlayerOverall(
                        player,
                      )}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>

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
                  awayClub,
                )}
              </h2>

              <span>
                {awayXI.length}/11 ·{' '}
                {formation}
              </span>
            </div>

            <div
              className={
                styles.playerList
              }
            >
              {awayXI.map(
                (player) => (
                  <div
                    key={String(
                      playerId(
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

                    <div>
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
                        {getPlayerOverall(
                          player,
                        )}
                      </small>
                    </div>

                    <span
                      className={
                        styles.playerRating
                      }
                    >
                      {getPlayerOverall(
                        player,
                      )}
                    </span>
                  </div>
                ),
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
              MENTALITY
            </span>

            <strong>
              {mentality}
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
