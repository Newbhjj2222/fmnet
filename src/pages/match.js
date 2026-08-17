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
  updateDoc,
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

const MAX_SQUAD_SIZE = 25;
const PLAYERS_ON_PITCH = 11;
const MAX_SUBSTITUTIONS = 5;

const MATCH_TICK_MS = 900;
const TICK_SECONDS = 1;

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

function distanceBetween(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* =========================================================
   CLUB HELPERS
========================================================= */

function getClubName(club, fallback = 'Unknown Club') {
  return club?.name || club?.clubName || club?.title || fallback;
}

function getClubLogo(club) {
  return club?.logo || club?.logoUrl || club?.image || club?.badge || null;
}

function getClubPrimaryColor(club) {
  return club?.primaryColor || club?.colors?.primary || club?.color || '#2563eb';
}

function getClubSecondaryColor(club) {
  return club?.secondaryColor || club?.colors?.secondary || '#ffffff';
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

const TACTICS = {
  'Tiki-Taka': {
    name: 'Tiki-Taka',
    description: 'Short passes, high possession',
    passChance: 0.6,
    dribbleChance: 0.2,
    shootChance: 0.2,
    pressIntensity: 0.7,
  },
  'Counter Attack': {
    name: 'Counter Attack',
    description: 'Quick transitions, direct play',
    passChance: 0.3,
    dribbleChance: 0.4,
    shootChance: 0.3,
    pressIntensity: 0.4,
  },
  'High Press': {
    name: 'High Press',
    description: 'Aggressive pressing, win ball high',
    passChance: 0.4,
    dribbleChance: 0.3,
    shootChance: 0.3,
    pressIntensity: 0.9,
  },
  'Park the Bus': {
    name: 'Park the Bus',
    description: 'Defensive, compact shape',
    passChance: 0.5,
    dribbleChance: 0.2,
    shootChance: 0.3,
    pressIntensity: 0.2,
  },
  'Wing Play': {
    name: 'Wing Play',
    description: 'Crosses from wide areas',
    passChance: 0.4,
    dribbleChance: 0.35,
    shootChance: 0.25,
    pressIntensity: 0.5,
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
   STARTING XI
========================================================= */

function selectStartingXI(squad, formation = '4-4-2') {
  const safeSquad = Array.isArray(squad) ? [...squad] : [];

  const formationRequirements = {
    '4-4-2': { GK: 1, DEF: 4, MID: 4, ATT: 2 },
    '4-3-3': { GK: 1, DEF: 4, MID: 3, ATT: 3 },
    '3-5-2': { GK: 1, DEF: 3, MID: 5, ATT: 2 },
    '5-3-2': { GK: 1, DEF: 5, MID: 3, ATT: 2 },
    '4-2-3-1': { GK: 1, DEF: 4, MID: 5, ATT: 1 },
  };

  const requirements = formationRequirements[formation] || formationRequirements['4-4-2'];

  const goalkeepers = safeSquad.filter(
    (player) => normalizePosition(getPlayerPosition(player)) === 'GK',
  );
  const defenders = safeSquad.filter(
    (player) => normalizePosition(getPlayerPosition(player)) === 'DEF',
  );
  const midfielders = safeSquad.filter(
    (player) => normalizePosition(getPlayerPosition(player)) === 'MID',
  );
  const attackers = safeSquad.filter(
    (player) => normalizePosition(getPlayerPosition(player)) === 'ATT',
  );

  const used = new Set();
  const result = [];

  function addBest(list, count) {
    [...list]
      .sort((a, b) => getPlayerOverall(b) - getPlayerOverall(a))
      .slice(0, count)
      .forEach((player) => {
        if (!used.has(player.id)) {
          used.add(player.id);
          result.push(player);
        }
      });
  }

  addBest(goalkeepers, requirements.GK);
  addBest(defenders, requirements.DEF);
  addBest(midfielders, requirements.MID);
  addBest(attackers, requirements.ATT);

  const remaining = safeSquad
    .filter((player) => !used.has(player.id))
    .sort((a, b) => getPlayerOverall(b) - getPlayerOverall(a));

  while (result.length < PLAYERS_ON_PITCH && remaining.length) {
    result.push(remaining.shift());
  }

  return result.slice(0, PLAYERS_ON_PITCH);
}

/* =========================================================
   PLAYER ID
========================================================= */

function playerId(player) {
  return player?.id || player?.playerId || player?.uid || null;
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

    const snapshot = await getDocs(playersQuery);

    return snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));
  } catch (error) {
    console.error('clubId player query failed:', error);
  }

  try {
    const allSnapshot = await getDocs(collection(db, 'players'));

    return allSnapshot.docs
      .map((item) => ({
        id: item.id,
        ...item.data(),
      }))
      .filter((player) => {
        const id = player.clubId || player.currentClub || player.teamId;
        return String(id) === String(clubId);
      });
  } catch (error) {
    console.error('Fallback players query failed:', error);
    return [];
  }
}

/* =========================================================
   GENERATE PLAYERS IF SQUAD IS INCOMPLETE
========================================================= */

function createGeneratedPlayer(club, position, index) {
  const baseName =
    getClubName(club, 'Club')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim() || 'Club';

  const overall = 55 + ((index * 7 + (club.id?.length || 0)) % 21);

  return {
    id: `gen-${club.id}-${position}-${index}`,
    name: `${baseName} Youth ${index + 1}`,
    position,
    overall,
    isGenerated: true,
  };
}

function generateClubPlayers(club, existingPlayers, targetCount = 16) {
  const players = [...existingPlayers];
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };

  players.forEach((player) => {
    const pos = normalizePosition(getPlayerPosition(player));
    if (counts[pos] !== undefined) {
      counts[pos] += 1;
    }
  });

  const requiredPositions = [
    ['GK', 1],
    ['DEF', 4],
    ['MID', 4],
    ['ATT', 2],
  ];

  let generatedIndex = 0;

  requiredPositions.forEach(([pos, requiredCount]) => {
    while (counts[pos] < requiredCount) {
      const newPlayer = createGeneratedPlayer(club, pos, generatedIndex);
      players.push(newPlayer);
      counts[pos] += 1;
      generatedIndex += 1;
    }
  });

  const extraPositions = ['MID', 'ATT', 'DEF', 'MID', 'ATT', 'DEF', 'MID', 'GK'];

  while (players.length < targetCount) {
    const pos =
      extraPositions[(players.length - 11) % extraPositions.length] || 'MID';

    const newPlayer = createGeneratedPlayer(club, pos, generatedIndex);
    players.push(newPlayer);
    counts[pos] = (counts[pos] || 0) + 1;
    generatedIndex += 1;
  }

  return players;
}

/* =========================================================
   LOAD MATCH FROM DATABASE
========================================================= */

async function loadMatchFromDatabase(matchId) {
  if (!matchId) return null;

  const matchRef = doc(db, 'matches', matchId);
  const matchSnapshot = await getDoc(matchRef);

  if (matchSnapshot.exists()) {
    return {
      id: matchSnapshot.id,
      ...matchSnapshot.data(),
      _source: 'matches',
    };
  }

  const fixtureRef = doc(db, 'fixtures', matchId);
  const fixtureSnapshot = await getDoc(fixtureRef);

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
   MATCH PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const matchId = typeof router.query.id === 'string' ? router.query.id : null;

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
  const [matchMinute, setMatchMinute] = useState(0);
  const [matchStatus, setMatchStatus] = useState('loading');
  const [events, setEvents] = useState([]);

  const [homeStats, setHomeStats] = useState(createDefaultStats());
  const [awayStats, setAwayStats] = useState(createDefaultStats());

  const [mentality, setMentality] = useState('balanced');
  const [formation, setFormation] = useState('4-4-2');
  const [tactic, setTactic] = useState('Tiki-Taka');
  const [showTactics, setShowTactics] = useState(false);
  const [showFormation, setShowFormation] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [showEvents, setShowEvents] = useState(true);

  const [loadingMatch, setLoadingMatch] = useState(true);
  const [savingMatch, setSavingMatch] = useState(false);
  const [paused, setPaused] = useState(false);
  const [halfTimeShown, setHalfTimeShown] = useState(false);
  const [userClubId, setUserClubId] = useState(null);
  const [substitutionsUsed, setSubstitutionsUsed] = useState(0);
  const [selectedSubIn, setSelectedSubIn] = useState('');
  const [selectedSubOut, setSelectedSubOut] = useState('');
  const [playerStamina, setPlayerStamina] = useState({ home: {}, away: {} });

  const timerRef = useRef(null);
  const processingRef = useRef(false);

  // Three.js refs
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const ballMeshRef = useRef(null);
  const playerMeshesRef = useRef({ home: [], away: [] });
  const animationFrameRef = useRef(null);
  
  // Match simulation state refs
  const ballPossessionRef = useRef(null);
  const ballTargetRef = useRef(null);
  const playerTargetsRef = useRef({ home: [], away: [] });
  const staminaRef = useRef({ home: {}, away: {} });

  const isHomeUser =
    String(userClubId || '') === String(homeClub?.id || '');

  const isAwayUser =
    String(userClubId || '') === String(awayClub?.id || '');

  const userIsParticipant = isHomeUser || isAwayUser;

  const userTeam = isHomeUser ? 'home' : isAwayUser ? 'away' : null;

  /* =======================================================
     LOAD USER CLUB
  ======================================================== */

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;

    async function loadUserClub() {
      try {
        const userRef = doc(db, 'users', user.uid);
        const snapshot = await getDoc(userRef);

        if (!snapshot.exists()) return;

        const data = snapshot.data();
        const career = data.careerData || {};

        const clubId =
          career.currentClub || data.currentClub || data.clubId || null;

        if (!cancelled) {
          setUserClubId(clubId);
        }
      } catch (error) {
        console.error('User club error:', error);
      }
    }

    loadUserClub();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  /* =======================================================
     APPLY MATCH DATABASE STATE
  ======================================================== */

  const applyMatchState = useCallback((data) => {
    if (!data) return;

    const result = data.result || {};

    setHomeScore(safeNumber(result.homeScore ?? data.homeScore, 0));
    setAwayScore(safeNumber(result.awayScore ?? data.awayScore, 0));
    setMatchMinute(safeNumber(data.minute ?? data.matchMinute, 0));
    setEvents(Array.isArray(data.events) ? data.events : []);

    setHomeStats({
      ...createDefaultStats(),
      ...(data.homeStats || {}),
    });

    setAwayStats({
      ...createDefaultStats(),
      ...(data.awayStats || {}),
    });

    setSubstitutionsUsed(safeNumber(data.substitutionsUsed, 0));

    if (data.mentality) {
      setMentality(data.mentality);
    }
    if (data.formation) {
      setFormation(data.formation);
    }
    if (data.tactic) {
      setTactic(data.tactic);
    }

    const status = normalize(data.status);

    if (status === 'finished' || status === 'completed') {
      setMatchStatus('finished');
    } else if (status === 'half-time') {
      setMatchStatus('half-time');
    } else if (status === 'live') {
      setMatchStatus('live');
    } else {
      setMatchStatus('ready');
    }
  }, []);

  /* =======================================================
     LOAD MATCH + CLUBS + PLAYERS
  ======================================================== */

  useEffect(() => {
    if (loading || !user || !matchId) return;

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoadingMatch(true);

        const match = await loadMatchFromDatabase(matchId);

        if (!match) {
          toast.error('Match not found in database');
          router.push('/fixtures');
          return;
        }

        if (cancelled) return;

        setFixture(match);
        applyMatchState(match);

        const homeId = match.homeClubId || match.homeTeamId || match.homeId;
        const awayId = match.awayClubId || match.awayTeamId || match.awayId;

        if (!homeId || !awayId) {
          toast.error('This match has invalid teams');
          return;
        }

        const [homeSnapshot, awaySnapshot] = await Promise.all([
          getDoc(doc(db, 'clubs', homeId)),
          getDoc(doc(db, 'clubs', awayId)),
        ]);

        const home = homeSnapshot.exists()
          ? { id: homeSnapshot.id, ...homeSnapshot.data() }
          : { id: homeId, name: match.homeClubName || 'Home' };

        const away = awaySnapshot.exists()
          ? { id: awaySnapshot.id, ...awaySnapshot.data() }
          : { id: awayId, name: match.awayClubName || 'Away' };

        if (cancelled) return;

        setHomeClub(home);
        setAwayClub(away);

        const [rawHomePlayers, rawAwayPlayers] = await Promise.all([
          loadClubPlayers(homeId),
          loadClubPlayers(awayId),
        ]);

        if (cancelled) return;

        const preparedHome = generateClubPlayers(home, rawHomePlayers);
        const preparedAway = generateClubPlayers(away, rawAwayPlayers);

        setHomeSquad(preparedHome);
        setAwaySquad(preparedAway);

        const startingHome = selectStartingXI(preparedHome, formation);
        const startingAway = selectStartingXI(preparedAway, formation);

        setHomeXI(startingHome);
        setAwayXI(startingAway);

        setHomeBench(
          preparedHome.filter(
            (player) =>
              !startingHome.some(
                (starter) =>
                  String(playerId(starter)) === String(playerId(player)),
              ),
          ),
        );

        setAwayBench(
          preparedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) =>
                  String(playerId(starter)) === String(playerId(player)),
              ),
          ),
        );

        // Initialize stamina
        const homeStamina = {};
        const awayStamina = {};
        startingHome.forEach((player) => {
          homeStamina[playerId(player)] = 100;
        });
        startingAway.forEach((player) => {
          awayStamina[playerId(player)] = 100;
        });
        staminaRef.current = { home: homeStamina, away: awayStamina };
        setPlayerStamina({ home: homeStamina, away: awayStamina });
      } catch (error) {
        console.error('Match loading error:', error);
        toast.error('Could not load match');
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
  }, [loading, user, matchId, router, applyMatchState, formation]);

  /* =======================================================
     THREE.JS 3D PITCH SETUP
  ======================================================== */

  useEffect(() => {
    if (!mountRef.current || loadingMatch) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.Fog(0x0b1120, 30, 80);

    const camera = new THREE.PerspectiveCamera(
      45,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      100,
    );
    camera.position.set(0, 25, 30);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.minDistance = 15;
    controls.maxDistance = 50;
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 60;
    directionalLight.shadow.camera.left = -30;
    directionalLight.shadow.camera.right = 30;
    directionalLight.shadow.camera.top = 30;
    directionalLight.shadow.camera.bottom = -30;
    scene.add(directionalLight);

    const pitchGeometry = new THREE.PlaneGeometry(30, 20);
    const pitchMaterial = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.8,
      metalness: 0.1,
    });
    const pitch = new THREE.Mesh(pitchGeometry, pitchMaterial);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0;
    pitch.receiveShadow = true;
    scene.add(pitch);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-15, 0.01, -10),
      new THREE.Vector3(15, 0.01, -10),
      new THREE.Vector3(15, 0.01, 10),
      new THREE.Vector3(-15, 0.01, 10),
      new THREE.Vector3(-15, 0.01, -10),
    ]);
    const borderLine = new THREE.Line(borderGeometry, lineMaterial);
    scene.add(borderLine);

    const centerLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, -10),
      new THREE.Vector3(0, 0.01, 10),
    ]);
    const centerLine = new THREE.Line(centerLineGeometry, lineMaterial);
    scene.add(centerLine);

    const circleGeometry = new THREE.RingGeometry(3, 3.05, 64);
    const circleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const centerCircle = new THREE.Mesh(circleGeometry, circleMaterial);
    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.y = 0.02;
    scene.add(centerCircle);

    const goalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

    const leftGoal = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 6),
      goalMaterial,
    );
    leftGoal.position.set(-15, 0.08, 0);
    scene.add(leftGoal);

    const rightGoal = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 6),
      goalMaterial,
    );
    rightGoal.position.set(15, 0.08, 0);
    scene.add(rightGoal);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3,
        metalness: 0.1,
      }),
    );
    ball.position.set(0, 0.15, 0);
    ball.castShadow = true;
    scene.add(ball);
    ballMeshRef.current = ball;

    const createPlayer = (x, z, color, index) => {
      const group = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.35, 0.6, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
      );
      body.position.y = 0.3;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffcc99 }),
      );
      head.position.y = 0.75;
      group.add(head);

      group.position.set(x, 0, z);
      group.castShadow = true;
      scene.add(group);
      return group;
    };

    const formationData = FORMATIONS[formation] || FORMATIONS['4-4-2'];
    const formationPositions = formationData.positions;

    playerMeshesRef.current.home = formationPositions.map((pos, index) => {
      const x = ((pos.x - 50) / 50) * 15;
      const z = ((pos.y - 50) / 50) * 10;
      return createPlayer(x, z, 0x3b82f6, index);
    });

    playerMeshesRef.current.away = formationPositions.map((pos, index) => {
      const x = ((50 - pos.x) / 50) * 15;
      const z = ((50 - pos.y) / 50) * 10;
      return createPlayer(x, z, 0xef4444, index);
    });

    playerTargetsRef.current.home = playerMeshesRef.current.home.map((player) => ({
      x: player.position.x,
      z: player.position.z,
    }));

    playerTargetsRef.current.away = playerMeshesRef.current.away.map((player) => ({
      x: player.position.x,
      z: player.position.z,
    }));

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      playerMeshesRef.current.home.forEach((player, index) => {
        const target = playerTargetsRef.current.home[index];
        if (target) {
          player.position.x = lerp(player.position.x, target.x, 0.1);
          player.position.z = lerp(player.position.z, target.z, 0.1);
        }
      });

      playerMeshesRef.current.away.forEach((player, index) => {
        const target = playerTargetsRef.current.away[index];
        if (target) {
          player.position.x = lerp(player.position.x, target.x, 0.1);
          player.position.z = lerp(player.position.z, target.z, 0.1);
        }
      });

      if (ballPossessionRef.current && ballMeshRef.current) {
        const { team, playerIndex } = ballPossessionRef.current;
        const players = team === 'home' ? playerMeshesRef.current.home : playerMeshesRef.current.away;
        const player = players[playerIndex];

        if (player) {
          ballMeshRef.current.position.x = player.position.x;
          ballMeshRef.current.position.z = player.position.z;
          ballMeshRef.current.position.y = 0.15;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const handleResize = () => {
      if (!mountRef.current || !camera || !renderer) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (mountRef.current && renderer) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, [loadingMatch, formation]);

  /* =======================================================
     SIMULATE PLAYER MOVEMENT
  ======================================================== */

  const simulatePlayerMovement = useCallback(() => {
    if (!ballPossessionRef.current) {
      const team = Math.random() < 0.5 ? 'home' : 'away';
      const playerIndex = Math.floor(Math.random() * 11);
      ballPossessionRef.current = { team, playerIndex };
      return;
    }

    const { team, playerIndex } = ballPossessionRef.current;
    const players = team === 'home' ? homeXI : awayXI;
    const opposingTeam = team === 'home' ? 'away' : 'home';

    const playerMeshes = team === 'home' ? playerMeshesRef.current.home : playerMeshesRef.current.away;
    const opposingMeshes = opposingTeam === 'home' ? playerMeshesRef.current.home : playerMeshesRef.current.away;

    const currentPlayer = playerMeshes[playerIndex];
    if (!currentPlayer) return;

    const tacticData = TACTICS[tactic] || TACTICS['Tiki-Taka'];

    const random = Math.random();

    if (random < tacticData.passChance) {
      const teammateIndex = Math.floor(Math.random() * 11);
      if (teammateIndex !== playerIndex) {
        const teammate = playerMeshes[teammateIndex];
        if (teammate) {
          ballPossessionRef.current = { team, playerIndex: teammateIndex };
          playerTargetsRef.current[team][playerIndex] = {
            x: teammate.position.x,
            z: teammate.position.z,
          };
          return;
        }
      }
    }

    const goalX = team === 'home' ? 14 : -14;
    const distanceToGoal = Math.abs(currentPlayer.position.x - goalX);

    if (random < tacticData.shootChance && distanceToGoal < 10) {
      const goalZ = randomBetweenSafe(-2, 2);
      ballTargetRef.current = { x: goalX, z: goalZ };

      const saveChance = 0.3;
      if (Math.random() > saveChance) {
        if (team === 'home') {
          setHomeScore((prev) => prev + 1);
        } else {
          setAwayScore((prev) => prev + 1);
        }
        ballPossessionRef.current = null;
      } else {
        ballPossessionRef.current = { team: opposingTeam, playerIndex: 0 };
      }
      return;
    }

    const direction = team === 'home' ? 1 : -1;
    const newX = clamp(currentPlayer.position.x + direction * randomBetweenSafe(1, 3), -14, 14);
    const newZ = clamp(currentPlayer.position.z + randomBetweenSafe(-2, 2), -9, 9);

    playerTargetsRef.current[team][playerIndex] = { x: newX, z: newZ };
    ballTargetRef.current = { x: newX, z: newZ };

    opposingMeshes.forEach((opponent, index) => {
      const targetX = currentPlayer.position.x + (Math.random() - 0.5) * 2;
      const targetZ = currentPlayer.position.z + (Math.random() - 0.5) * 2;
      playerTargetsRef.current[opposingTeam][index] = { x: targetX, z: targetZ };
    });

    if (Math.random() < 0.05) {
      const opponentIndex = Math.floor(Math.random() * 11);
      ballPossessionRef.current = { team: opposingTeam, playerIndex: opponentIndex };
    }

    // Update stamina
    const staminaHome = staminaRef.current.home;
    const staminaAway = staminaRef.current.away;
    const currentPlayerData = players[playerIndex];
    if (currentPlayerData) {
      const pid = playerId(currentPlayerData);
      const stamina = team === 'home' ? staminaHome : staminaAway;
      if (stamina[pid]) {
        stamina[pid] = clamp(stamina[pid] - 0.5, 0, 100);
        setPlayerStamina({ home: staminaHome, away: staminaAway });
      }
    }
  }, [homeXI, awayXI, tactic]);

  /* =======================================================
     SAVE MATCH STATE
  ======================================================== */

  const saveMatchState = useCallback(
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
      extra = {},
    }) => {
      if (!matchId) return;

      const matchRef = doc(db, 'matches', matchId);

      await setDoc(
        matchRef,
        {
          id: matchId,
          status: statusValue || 'live',
          minute: safeNumber(minute, 0),
          homeScore: safeNumber(homeScoreValue, 0),
          awayScore: safeNumber(awayScoreValue, 0),
          result: {
            homeScore: safeNumber(homeScoreValue, 0),
            awayScore: safeNumber(awayScoreValue, 0),
          },
          events: Array.isArray(eventsValue) ? eventsValue : [],
          homeStats: homeStatsValue || createDefaultStats(),
          awayStats: awayStatsValue || createDefaultStats(),
          substitutionsUsed: safeNumber(substitutionsValue, 0),
          mentality: mentalityValue || 'balanced',
          formation: formationValue || '4-4-2',
          tactic: tacticValue || 'Tiki-Taka',
          updatedAt: serverTimestamp(),
          ...extra,
        },
        { merge: true },
      );
    },
    [matchId],
  );

  /* =======================================================
     SIMULATE ONE MATCH MINUTE
  ======================================================== */

  const simulateMinute = useCallback(
    async (minute) => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        for (let i = 0; i < 10; i++) {
          simulatePlayerMovement();
        }

        const homeStrength =
          homeXI.reduce((total, player) => total + getPlayerOverall(player), 0) /
          Math.max(homeXI.length, 1);

        const awayStrength =
          awayXI.reduce((total, player) => total + getPlayerOverall(player), 0) /
          Math.max(awayXI.length, 1);

        const nextHomeStats = { ...homeStats };
        const nextAwayStats = { ...awayStats };

        const possessionBase = clamp(
          50 +
            (homeStrength - awayStrength) * 0.4 +
            (mentality === 'attacking' ? 2 : mentality === 'defensive' ? -2 : 0),
          30,
          70,
        );

        nextHomeStats.possession = Math.round(possessionBase);
        nextAwayStats.possession = 100 - nextHomeStats.possession;

        nextHomeStats.passes += randomBetweenSafe(4, 15);
        nextAwayStats.passes += randomBetweenSafe(4, 15);

        setHomeStats(nextHomeStats);
        setAwayStats(nextAwayStats);

        await saveMatchState({
          minute,
          homeScoreValue: homeScore,
          awayScoreValue: awayScore,
          eventsValue: events,
          homeStatsValue: nextHomeStats,
          awayStatsValue: nextAwayStats,
          statusValue: 'live',
          substitutionsValue: substitutionsUsed,
          mentalityValue: mentality,
          formationValue: formation,
          tacticValue: tactic,
        });
      } catch (error) {
        console.error('Simulation error:', error);
      } finally {
        processingRef.current = false;
      }
    },
    [
      homeXI,
      awayXI,
      mentality,
      formation,
      tactic,
      homeScore,
      awayScore,
      homeStats,
      awayStats,
      events,
      substitutionsUsed,
      saveMatchState,
      simulatePlayerMovement,
    ],
  );

  /* =======================================================
     START MATCH
  ======================================================== */

  const startMatch = useCallback(async () => {
    if (!fixture || !userIsParticipant) {
      toast.error('You are not managing a team in this match.');
      return;
    }

    if (homeXI.length < PLAYERS_ON_PITCH || awayXI.length < PLAYERS_ON_PITCH) {
      toast.error('Both teams need a starting XI.');
      return;
    }

    if (matchStatus === 'finished') {
      toast.error('This match has already finished.');
      return;
    }

    try {
      setSavingMatch(true);

      await saveMatchState({
        minute: 0,
        homeScoreValue: homeScore,
        awayScoreValue: awayScore,
        eventsValue: events,
        homeStatsValue: homeStats,
        awayStatsValue: awayStats,
        statusValue: 'live',
        substitutionsValue: substitutionsUsed,
        mentalityValue: mentality,
        formationValue: formation,
        tacticValue: tactic,
      });

      setMatchStatus('live');
      setPaused(false);
      toast.success('Match started');
    } catch (error) {
      console.error(error);
      toast.error('Could not start match');
    } finally {
      setSavingMatch(false);
    }
  }, [
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
    saveMatchState,
  ]);

  /* =======================================================
     MATCH TIMER
  ======================================================== */

  useEffect(() => {
    if (matchStatus !== 'live') return;
    if (paused) return;

    timerRef.current = setInterval(() => {
      setMatchMinute((previous) => {
        const next = previous + TICK_SECONDS;

        if (next === FIRST_HALF_END) {
          setMatchStatus('half-time');
          setHalfTimeShown(true);
          return next;
        }

        if (next >= MATCH_DURATION) {
          return MATCH_DURATION;
        }

        return next;
      });
    }, MATCH_TICK_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [matchStatus, paused]);

  /* =======================================================
     SIMULATE CURRENT MINUTE
  ======================================================== */

  useEffect(() => {
    if (matchStatus !== 'live') return;
    if (paused) return;
    if (matchMinute <= 0 || matchMinute >= MATCH_DURATION) return;

    simulateMinute(matchMinute);
  }, [matchMinute, matchStatus, paused, simulateMinute]);

  /* =======================================================
     HALF TIME
  ======================================================== */

  const continueSecondHalf = async () => {
    try {
      setSavingMatch(true);

      await saveMatchState({
        minute: FIRST_HALF_END,
        homeScoreValue: homeScore,
        awayScoreValue: awayScore,
        eventsValue: events,
        homeStatsValue: homeStats,
        awayStatsValue: awayStats,
        statusValue: 'live',
        substitutionsValue: substitutionsUsed,
        mentalityValue: mentality,
        formationValue: formation,
        tacticValue: tactic,
      });

      setHalfTimeShown(false);
      setMatchStatus('live');
      setPaused(false);
    } catch (error) {
      console.error(error);
      toast.error('Could not continue match');
    } finally {
      setSavingMatch(false);
    }
  };

  /* =======================================================
     FINISH MATCH
  ======================================================== */

  const finishMatch = useCallback(async () => {
    try {
      setSavingMatch(true);

      const finalResult = {
        homeScore,
        awayScore,
      };

      await saveMatchState({
        minute: MATCH_DURATION,
        homeScoreValue: homeScore,
        awayScoreValue: awayScore,
        eventsValue: events,
        homeStatsValue: homeStats,
        awayStatsValue: awayStats,
        statusValue: 'finished',
        substitutionsValue: substitutionsUsed,
        mentalityValue: mentality,
        formationValue: formation,
        tacticValue: tactic,
        extra: {
          result: finalResult,
          finishedAt: serverTimestamp(),
          playedBy: user?.uid || null,
        },
      });

      setMatchMinute(MATCH_DURATION);
      setMatchStatus('finished');
      setPaused(true);

      toast.success(`Full time: ${homeScore} - ${awayScore}`);
    } catch (error) {
      console.error('Finish match error:', error);
      toast.error('Could not save final result');
    } finally {
      setSavingMatch(false);
    }
  }, [
    homeScore,
    awayScore,
    events,
    homeStats,
    awayStats,
    substitutionsUsed,
    mentality,
    formation,
    tactic,
    user,
    saveMatchState,
  ]);

  /* =======================================================
     FINISH AUTOMATICALLY
  ======================================================== */

  useEffect(() => {
    if (matchStatus === 'live' && matchMinute >= MATCH_DURATION) {
      finishMatch();
    }
  }, [matchMinute, matchStatus, finishMatch]);

  /* =======================================================
     PAUSE
  ======================================================== */

  const togglePause = () => {
    if (matchStatus !== 'live') return;
    setPaused((previous) => !previous);
  };

  /* =======================================================
     CHANGE FORMATION
  ======================================================== */

  const changeFormation = async (value) => {
    setFormation(value);

    const startingHome = selectStartingXI(homeSquad, value);
    const startingAway = selectStartingXI(awaySquad, value);

    setHomeXI(startingHome);
    setAwayXI(startingAway);

    setHomeBench(
      homeSquad.filter(
        (player) =>
          !startingHome.some(
            (starter) => String(playerId(starter)) === String(playerId(player)),
          ),
      ),
    );

    setAwayBench(
      awaySquad.filter(
        (player) =>
          !startingAway.some(
            (starter) => String(playerId(starter)) === String(playerId(player)),
          ),
      ),
    );

    toast.success(`Formation changed to ${value}`);
  };

  /* =======================================================
     CHANGE TACTIC
  ======================================================== */

  const changeTactic = async (value) => {
    setTactic(value);
    toast.success(`Tactic changed to ${value}`);
  };

  /* =======================================================
     CHANGE MENTALITY
  ======================================================== */

  const changeMentality = async (value) => {
    setMentality(value);

    try {
      await saveMatchState({
        minute: matchMinute,
        homeScoreValue: homeScore,
        awayScoreValue: awayScore,
        eventsValue: events,
        homeStatsValue: homeStats,
        awayStatsValue: awayStats,
        statusValue: matchStatus === 'ready' ? 'ready' : matchStatus,
        substitutionsValue: substitutionsUsed,
        mentalityValue: value,
        formationValue: formation,
        tacticValue: tactic,
      });
    } catch (error) {
      console.error(error);
    }
  };

  /* =======================================================
     SUBSTITUTION
  ======================================================== */

  const makeSubstitution = async () => {
    if (!userIsParticipant) return;

    if (substitutionsUsed >= MAX_SUBSTITUTIONS) {
      toast.error('Maximum substitutions reached.');
      return;
    }

    if (!selectedSubIn || !selectedSubOut) {
      toast.error('Select player IN and player OUT.');
      return;
    }

    const team = userTeam === 'home' ? 'home' : 'away';

    const currentXI = team === 'home' ? homeXI : awayXI;
    const bench = team === 'home' ? homeBench : awayBench;

    const playerIn = bench.find(
      (player) => String(playerId(player)) === String(selectedSubIn),
    );
    const playerOut = currentXI.find(
      (player) => String(playerId(player)) === String(selectedSubOut),
    );

    if (!playerIn || !playerOut) {
      toast.error('Invalid selection.');
      return;
    }

    const nextXI = currentXI.map((player) =>
      String(playerId(player)) === String(playerId(playerOut)) ? playerIn : player,
    );

    const nextBench = [
      ...bench.filter(
        (player) => String(playerId(player)) !== String(playerId(playerIn)),
      ),
      playerOut,
    ];

    const nextSubCount = substitutionsUsed + 1;

    const event = {
      id: `${Date.now()}-substitution`,
      type: EVENT_TYPES.SUBSTITUTION,
      team,
      minute: matchMinute,
      playerId: playerId(playerIn),
      playerName: getPlayerName(playerIn),
      detail: `${getPlayerName(playerIn)} replaced ${getPlayerName(playerOut)}`,
      createdAt: new Date().toISOString(),
    };

    const nextEvents = [event, ...events];

    if (team === 'home') {
      setHomeXI(nextXI);
      setHomeBench(nextBench);
    } else {
      setAwayXI(nextXI);
      setAwayBench(nextBench);
    }

    setSubstitutionsUsed(nextSubCount);
    setEvents(nextEvents);
    setSelectedSubIn('');
    setSelectedSubOut('');

    await saveMatchState({
      minute: matchMinute,
      homeScoreValue: homeScore,
      awayScoreValue: awayScore,
      eventsValue: nextEvents,
      homeStatsValue: homeStats,
      awayStatsValue: awayStats,
      statusValue: matchStatus,
      substitutionsValue: nextSubCount,
      mentalityValue: mentality,
      formationValue: formation,
      tacticValue: tactic,
      extra: {
        [`${team}XI`]: nextXI.map((player) => playerId(player)),
      },
    });

    toast.success('Substitution made');
  };

  /* =======================================================
     DISPLAY EVENTS
  ======================================================== */

  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => safeNumber(b.minute) - safeNumber(a.minute),
      ),
    [events],
  );

  /* =======================================================
     MATCH STATUS LABEL
  ======================================================== */

  const statusLabel = useMemo(() => {
    switch (matchStatus) {
      case 'ready':
        return 'READY';
      case 'live':
        return paused ? 'PAUSED' : 'LIVE';
      case 'half-time':
        return 'HALF TIME';
      case 'finished':
        return 'FULL TIME';
      default:
        return 'LOADING';
    }
  }, [matchStatus, paused]);

  /* =======================================================
     LOADING
  ======================================================== */

  if (loading || loadingMatch) {
    return (
      <main className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading match...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     MATCH NOT FOUND
  ======================================================== */

  if (!fixture || !homeClub || !awayClub) {
    return (
      <main className={styles.emptyPage}>
        <div className={styles.emptyIcon}>⚽</div>
        <h1>Match not found</h1>
        <p>This match does not exist in the database.</p>
        <button type="button" onClick={() => router.push('/fixtures')}>
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
          {getClubName(homeClub)} vs {getClubName(awayClub)}
        </title>
        <meta
          name="description"
          content={`Live match between ${getClubName(homeClub)} and ${getClubName(awayClub)}`}
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() => router.push('/fixtures')}
          >
            ← Fixtures
          </button>

          <div>
            <span className={styles.competition}>
              {fixture.leagueName || fixture.competition || 'MATCH'}
            </span>
            <h1>Match Centre</h1>
          </div>

          <span className={styles.status}>{statusLabel}</span>
        </header>

        {/* 3D PITCH */}
        <div ref={mountRef} className={styles.threeContainer} />

        {/* SCOREBOARD */}
        <section
          className={styles.scoreboard}
          style={{
            '--home-color': getClubPrimaryColor(homeClub),
            '--away-color': getClubPrimaryColor(awayClub),
          }}
        >
          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {getClubLogo(homeClub) ? (
                <img src={getClubLogo(homeClub)} alt="" />
              ) : (
                '⚽'
              )}
            </div>
            <strong>{getClubName(homeClub)}</strong>
            <span>HOME</span>
          </div>

          <div className={styles.scoreMiddle}>
            <div className={styles.score}>
              <strong>{homeScore}</strong>
              <span>-</span>
              <strong>{awayScore}</strong>
            </div>
            <div className={styles.matchClock}>{matchMinute}'</div>
            <small>{statusLabel}</small>
          </div>

          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {getClubLogo(awayClub) ? (
                <img src={getClubLogo(awayClub)} alt="" />
              ) : (
                '⚽'
              )}
            </div>
            <strong>{getClubName(awayClub)}</strong>
            <span>AWAY</span>
          </div>
        </section>

        {/* FORMATION + TACTIC BAR */}
        <section className={styles.latestScore}>
          <div>
            <span>FORMATION</span>
            <strong>{formation}</strong>
          </div>
          <div>
            <span>TACTIC</span>
            <strong>{tactic}</strong>
          </div>
          <div>
            <span>MENTALITY</span>
            <strong>{mentality}</strong>
          </div>
        </section>

        {/* ACCESS WARNING */}
        {!userIsParticipant && (
          <section className={styles.warning}>
            <strong>View only</strong>
            <p>
              Your current club is not participating in this match. You can view
              the latest score and events, but you cannot play it.
            </p>
          </section>
        )}

        {/* CONTROLS */}
        {userIsParticipant && (
          <section className={styles.controls}>
            {matchStatus === 'ready' && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={startMatch}
                disabled={savingMatch}
              >
                ▶ START MATCH
              </button>
            )}

            {matchStatus === 'live' && (
              <button type="button" onClick={togglePause}>
                {paused ? '▶ Resume' : 'Ⅱ Pause'}
              </button>
            )}

            {matchStatus === 'half-time' && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={continueSecondHalf}
                disabled={savingMatch}
              >
                ▶ START SECOND HALF
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowFormation((previous) => !previous)}
            >
              📋 Formation
            </button>

            <button
              type="button"
              onClick={() => setShowTactics((previous) => !previous)}
            >
              ⚙ Tactics
            </button>

            <button
              type="button"
              onClick={() => setShowSubs((previous) => !previous)}
            >
              🔄 Substitutions
            </button>
          </section>
        )}

        {/* HALF TIME */}
        {halfTimeShown && (
          <section className={styles.halfTime}>
            <span>HALF TIME</span>
            <strong>
              {homeScore} - {awayScore}
            </strong>
            <button
              type="button"
              onClick={continueSecondHalf}
              disabled={savingMatch}
            >
              Continue
            </button>
          </section>
        )}

        {/* FORMATION PANEL */}
        {showFormation && userIsParticipant && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Formation</h2>
              <span>{formation}</span>
            </div>
            <div className={styles.mentalityGrid}>
              {Object.keys(FORMATIONS).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={formation === value ? styles.active : ''}
                  onClick={() => changeFormation(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* TACTICS PANEL */}
        {showTactics && userIsParticipant && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Tactics</h2>
              <span>{tactic}</span>
            </div>
            <div className={styles.mentalityGrid}>
              {Object.keys(TACTICS).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={tactic === value ? styles.active : ''}
                  onClick={() => changeTactic(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className={styles.panelHeader}>
              <h2>Mentality</h2>
            </div>
            <div className={styles.mentalityGrid}>
              {['defensive', 'balanced', 'attacking'].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mentality === value ? styles.active : ''}
                  onClick={() => changeMentality(value)}
                >
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* SUBSTITUTIONS */}
        {showSubs && userIsParticipant && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Substitutions</h2>
              <span>
                {substitutionsUsed}/{MAX_SUBSTITUTIONS}
              </span>
            </div>

            <div className={styles.subRow}>
              <label>Player IN (from bench)</label>
              <select
                value={selectedSubIn}
                onChange={(event) => setSelectedSubIn(event.target.value)}
              >
                <option value="">Select player IN</option>
                {(userTeam === 'home' ? homeBench : awayBench).map((player) => (
                  <option
                    key={String(playerId(player))}
                    value={String(playerId(player))}
                  >
                    {getPlayerName(player)} · OVR {getPlayerOverall(player)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.subRow}>
              <label>Player OUT (from pitch)</label>
              <select
                value={selectedSubOut}
                onChange={(event) => setSelectedSubOut(event.target.value)}
              >
                <option value="">Select player OUT</option>
                {(userTeam === 'home' ? homeXI : awayXI).map((player) => (
                  <option
                    key={String(playerId(player))}
                    value={String(playerId(player))}
                  >
                    {getPlayerName(player)} · OVR {getPlayerOverall(player)} · STA{' '}
                    {Math.round(playerStamina[userTeam]?.[playerId(player)] || 100)}%
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={makeSubstitution}
              disabled={
                substitutionsUsed >= MAX_SUBSTITUTIONS ||
                !selectedSubIn ||
                !selectedSubOut
              }
            >
              Make Substitution
            </button>
          </section>
        )}

        {/* STATS */}
        <section className={styles.statsSection}>
          <div className={styles.sectionHeader}>
            <span>MATCH STATISTICS</span>
            <strong>
              {homeScore} - {awayScore}
            </strong>
          </div>

          {[
            ['Possession', `${homeStats.possession}%`, `${awayStats.possession}%`],
            ['Shots', homeStats.shots, awayStats.shots],
            ['Shots on Target', homeStats.shotsOnTarget, awayStats.shotsOnTarget],
            ['Passes', homeStats.passes, awayStats.passes],
            ['Fouls', homeStats.fouls, awayStats.fouls],
            ['Corners', homeStats.corners, awayStats.corners],
            ['Offsides', homeStats.offsides, awayStats.offsides],
            ['Yellow Cards', homeStats.yellow, awayStats.yellow],
            ['Red Cards', homeStats.red, awayStats.red],
          ].map((row) => (
            <div key={row[0]} className={styles.statRow}>
              <strong>{row[1]}</strong>
              <span>{row[0]}</span>
              <strong>{row[2]}</strong>
            </div>
          ))}
        </section>

        {/* EVENTS */}
        <section className={styles.eventsSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>LIVE FEED</span>
              <h2>Match Events</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowEvents((previous) => !previous)}
            >
              {showEvents ? 'Hide' : 'Show'}
            </button>
          </div>

          {showEvents && (
            <div className={styles.eventsList}>
              {sortedEvents.length > 0 ? (
                sortedEvents.map((event) => (
                  <article key={event.id} className={styles.event}>
                    <span className={styles.eventMinute}>{event.minute}'</span>
                    <span className={styles.eventIcon}>{eventIcon(event)}</span>
                    <div>
                      <strong>{eventLabel(event)}</strong>
                      <p>{event.playerName || event.detail || 'Match event'}</p>
                    </div>
                    <span>
                      {event.team === 'home'
                        ? getClubName(homeClub)
                        : getClubName(awayClub)}
                    </span>
                  </article>
                ))
              ) : (
                <div className={styles.noEvents}>No events yet.</div>
              )}
            </div>
          )}
        </section>

        {/* LINEUPS WITH RATINGS AND STAMINA */}
        <section className={styles.lineups}>
          <div className={styles.lineupCard}>
            <div className={styles.sectionHeader}>
              <h2>{getClubName(homeClub)}</h2>
              <span>{homeXI.length}/11 · {formation}</span>
            </div>
            <div className={styles.playerList}>
              {homeXI.map((player) => (
                <div key={String(playerId(player))} className={styles.player}>
                  {getPlayerPhoto(player) ? (
                    <img src={getPlayerPhoto(player)} alt="" />
                  ) : (
                    <span>⚽</span>
                  )}
                  <div>
                    <strong>{getPlayerName(player)}</strong>
                    <small>
                      {normalizePosition(getPlayerPosition(player))} · OVR{' '}
                      {getPlayerOverall(player)}
                    </small>
                  </div>
                  <div className={styles.playerMeta}>
                    <span className={styles.playerRating}>
                      {getPlayerOverall(player)}
                    </span>
                    <span className={styles.staminaBar}>
                      <span
                        className={styles.staminaFill}
                        style={{
                          width: `${Math.round(playerStamina.home?.[playerId(player)] || 100)}%`,
                        }}
                      />
                    </span>
                    <small>
                      {Math.round(playerStamina.home?.[playerId(player)] || 100)}%
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.lineupCard}>
            <div className={styles.sectionHeader}>
              <h2>{getClubName(awayClub)}</h2>
              <span>{awayXI.length}/11 · {formation}</span>
            </div>
            <div className={styles.playerList}>
              {awayXI.map((player) => (
                <div key={String(playerId(player))} className={styles.player}>
                  {getPlayerPhoto(player) ? (
                    <img src={getPlayerPhoto(player)} alt="" />
                  ) : (
                    <span>⚽</span>
                  )}
                  <div>
                    <strong>{getPlayerName(player)}</strong>
                    <small>
                      {normalizePosition(getPlayerPosition(player))} · OVR{' '}
                      {getPlayerOverall(player)}
                    </small>
                  </div>
                  <div className={styles.playerMeta}>
                    <span className={styles.playerRating}>
                      {getPlayerOverall(player)}
                    </span>
                    <span className={styles.staminaBar}>
                      <span
                        className={styles.staminaFill}
                        style={{
                          width: `${Math.round(playerStamina.away?.[playerId(player)] || 100)}%`,
                        }}
                      />
                    </span>
                    <small>
                      {Math.round(playerStamina.away?.[playerId(player)] || 100)}%
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FOOTER MATCH INFO */}
        <section className={styles.matchInfo}>
          <div>
            <span>STADIUM</span>
            <strong>{fixture.stadium || getClubStadium(homeClub)}</strong>
          </div>
          <div>
            <span>FORMATION</span>
            <strong>{formation}</strong>
          </div>
          <div>
            <span>TACTIC</span>
            <strong>{tactic}</strong>
          </div>
          <div>
            <span>MATCH ID</span>
            <strong>{matchId}</strong>
          </div>
        </section>
      </main>
    </>
  );
}
