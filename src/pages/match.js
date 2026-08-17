// src/pages/match.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return player?.position || player?.primaryPosition || player?.role || 'MID';
}

function getPlayerOverall(player) {
  return safeNumber(player?.overall ?? player?.rating ?? player?.overallRating, 60);
}

function getPlayerPhoto(player) {
  return player?.photo || player?.photoUrl || player?.image || player?.avatar || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distanceBetween(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function getClubName(club, fallback = 'Unknown Club') {
  return club?.name || club?.clubName || club?.title || fallback;
}

function getClubLogo(club) {
  return club?.logo || club?.logoUrl || club?.image || club?.badge || null;
}

function getClubPrimaryColor(club) {
  return club?.primaryColor || club?.colors?.primary || club?.color || '#2563eb';
}

function getClubStadium(club) {
  return club?.stadium || club?.stadiumName || club?.homeGround || club?.venue || 'Main Stadium';
}

function normalizePosition(position) {
  const value = normalize(position);
  if (value.includes('goal') || value === 'gk' || value === 'keeper') return 'GK';
  if (value.includes('def') || value === 'cb' || value === 'lb' || value === 'rb') return 'DEF';
  if (value.includes('mid') || value === 'cm' || value === 'dm' || value === 'am') return 'MID';
  if (
    value.includes('attack') ||
    value.includes('forward') ||
    value.includes('striker') ||
    value === 'st' ||
    value === 'cf' ||
    value === 'lw' ||
    value === 'rw'
  )
    return 'ATT';
  return 'MID';
}

function pick(array) {
  if (!Array.isArray(array) || !array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

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

const EVENT_TYPES = {
  GOAL: 'goal',
  SAVE: 'save',
  SHOT: 'shot',
  PASS: 'pass',
  KICKOFF: 'kickoff',
};

function eventLabel(event) {
  switch (event?.type) {
    case EVENT_TYPES.GOAL: return 'GOAL';
    case EVENT_TYPES.SAVE: return 'SAVE';
    case EVENT_TYPES.SHOT: return 'SHOT';
    case EVENT_TYPES.PASS: return 'PASS';
    case EVENT_TYPES.KICKOFF: return 'KICKOFF';
    default: return 'MATCH EVENT';
  }
}

function eventIcon(event) {
  switch (event?.type) {
    case EVENT_TYPES.GOAL: return '⚽';
    case EVENT_TYPES.SAVE: return '🧤';
    case EVENT_TYPES.SHOT: return '💥';
    case EVENT_TYPES.PASS: return '🦶';
    case EVENT_TYPES.KICKOFF: return '🟢';
    default: return '•';
  }
}

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

function playerId(player) {
  return player?.id || player?.playerId || player?.uid || null;
}

async function loadClubPlayers(clubId) {
  if (!clubId) return [];

  try {
    const playersQuery = query(
      collection(db, 'players'),
      where('clubId', '==', clubId),
    );
    const snapshot = await getDocs(playersQuery);
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.error('clubId player query failed:', error);
  }

  try {
    const allSnapshot = await getDocs(collection(db, 'players'));
    return allSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((player) => {
        const id = player.clubId || player.currentClub || player.teamId;
        return String(id) === String(clubId);
      });
  } catch (error) {
    console.error('Fallback players query failed:', error);
    return [];
  }
}

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
    if (counts[pos] !== undefined) counts[pos] += 1;
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

async function loadMatchFromDatabase(matchId) {
  if (!matchId) return null;

  const matchRef = doc(db, 'matches', matchId);
  const matchSnapshot = await getDoc(matchRef);

  if (matchSnapshot.exists()) {
    return { id: matchSnapshot.id, ...matchSnapshot.data(), _source: 'matches' };
  }

  const fixtureRef = doc(db, 'fixtures', matchId);
  const fixtureSnapshot = await getDoc(fixtureRef);

  if (fixtureSnapshot.exists()) {
    return { id: fixtureSnapshot.id, ...fixtureSnapshot.data(), _source: 'fixtures' };
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

  // UI state
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
  const [matchStatus, setMatchStatus] = useState('ready');
  const [events, setEvents] = useState([]);

  const [homeStats, setHomeStats] = useState(createDefaultStats());
  const [awayStats, setAwayStats] = useState(createDefaultStats());

  const [mentality, setMentality] = useState('balanced');
  const [formation, setFormation] = useState('4-4-2');
  const [showTactics, setShowTactics] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [showEvents, setShowEvents] = useState(true);
  const [showFormation, setShowFormation] = useState(false);

  const [savingMatch, setSavingMatch] = useState(false);
  const [paused, setPaused] = useState(false);
  const [halfTimeShown, setHalfTimeShown] = useState(false);
  const [userClubId, setUserClubId] = useState(null);
  const [substitutionsUsed, setSubstitutionsUsed] = useState(0);
  const [selectedSubPlayer, setSelectedSubPlayer] = useState('');

  // Refs
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const ballMeshRef = useRef(null);
  const playerMeshesRef = useRef({ home: [], away: [] });
  const animationFrameRef = useRef(null);
  const threeClockRef = useRef(null);
  const sceneInitializedRef = useRef(false);

  // Match engine refs
  const gameClockRef = useRef(0);
  const ballStateRef = useRef(null);
  const playersStateRef = useRef({ home: [], away: [] });
  const lastSimulationTimeRef = useRef(0);
  const lastFirestoreSaveRef = useRef(0);
  const simulationVersionRef = useRef(0);
  const finishCalledRef = useRef(false);
  const homeScoreRef = useRef(0);
  const awayScoreRef = useRef(0);
  const matchMinuteRef = useRef(0);
  const matchStatusRef = useRef('ready');
  const homeStatsRef = useRef(createDefaultStats());
  const awayStatsRef = useRef(createDefaultStats());
  const eventsRef = useRef([]);
  const mentalityRef = useRef('balanced');
  const formationRef = useRef('4-4-2');
  const pausedRef = useRef(false);

  const isHomeUser = String(userClubId || '') === String(homeClub?.id || '');
  const isAwayUser = String(userClubId || '') === String(awayClub?.id || '');
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
        const clubId = career.currentClub || data.currentClub || data.clubId || null;

        if (!cancelled) setUserClubId(clubId);
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
     LOAD MATCH DATA
  ======================================================== */

  useEffect(() => {
    if (loading || !user || !matchId) return;

    let cancelled = false;

    async function loadMatchData() {
      try {
        const match = await loadMatchFromDatabase(matchId);

        if (!match) {
          toast.error('Match not found in database');
          router.push('/fixtures');
          return;
        }

        if (cancelled) return;

        setFixture(match);

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

        const startingHome = selectStartingXI(preparedHome, formationRef.current);
        const startingAway = selectStartingXI(preparedAway, formationRef.current);

        setHomeXI(startingHome);
        setAwayXI(startingAway);

        setHomeBench(
          preparedHome.filter(
            (player) =>
              !startingHome.some(
                (starter) => String(playerId(starter)) === String(playerId(player)),
              ),
          ),
        );

        setAwayBench(
          preparedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) => String(playerId(starter)) === String(playerId(player)),
              ),
          ),
        );

        // Initialize state
        const initialMinute = safeNumber(match.minute ?? match.matchMinute, 0);
        const initialStatus = match.status || 'ready';

        matchMinuteRef.current = initialMinute;
        matchStatusRef.current = initialStatus;
        homeScoreRef.current = safeNumber(match.homeScore ?? match.result?.homeScore, 0);
        awayScoreRef.current = safeNumber(match.awayScore ?? match.result?.awayScore, 0);
        homeStatsRef.current = { ...createDefaultStats(), ...(match.homeStats || {}) };
        awayStatsRef.current = { ...createDefaultStats(), ...(match.awayStats || {}) };
        eventsRef.current = Array.isArray(match.events) ? match.events : [];
        simulationVersionRef.current = match.simulationVersion || 0;
        mentalityRef.current = match.mentality || 'balanced';
        formationRef.current = match.formation || '4-4-2';

        setMatchStatus(initialStatus);
        setMatchMinute(initialMinute);
        setHomeScore(homeScoreRef.current);
        setAwayScore(awayScoreRef.current);
        setEvents(eventsRef.current);
        setHomeStats(homeStatsRef.current);
        setAwayStats(awayStatsRef.current);
        setSubstitutionsUsed(safeNumber(match.substitutionsUsed, 0));
        setMentality(mentalityRef.current);
        setFormation(formationRef.current);

        ballStateRef.current = {
          mode: 'possessed',
          team: 'home',
          playerIndex: 5,
        };

        lastSimulationTimeRef.current = performance.now() / 1000;
        lastFirestoreSaveRef.current = performance.now() / 1000;
      } catch (error) {
        console.error('Match loading error:', error);
        toast.error('Could not load match');
      }
    }

    loadMatchData();

    return () => {
      cancelled = true;
    };
  }, [loading, user, matchId, router]);

  /* =======================================================
     THREE.JS SCENE SETUP
  ======================================================== */

  useEffect(() => {
    if (!mountRef.current || sceneInitializedRef.current) return;
    if (!homeXI.length || !awayXI.length) return;

    sceneInitializedRef.current = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);

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
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.minDistance = 15;
    controls.maxDistance = 50;
    controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pitchGeometry = new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_HEIGHT);
    const pitchMaterial = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.8,
    });
    const pitch = new THREE.Mesh(pitchGeometry, pitchMaterial);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-PITCH_WIDTH / 2, 0.01, -PITCH_HEIGHT / 2),
      new THREE.Vector3(PITCH_WIDTH / 2, 0.01, -PITCH_HEIGHT / 2),
      new THREE.Vector3(PITCH_WIDTH / 2, 0.01, PITCH_HEIGHT / 2),
      new THREE.Vector3(-PITCH_WIDTH / 2, 0.01, PITCH_HEIGHT / 2),
      new THREE.Vector3(-PITCH_WIDTH / 2, 0.01, -PITCH_HEIGHT / 2),
    ]);
    scene.add(new THREE.Line(borderGeometry, lineMaterial));

    const centerLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, -PITCH_HEIGHT / 2),
      new THREE.Vector3(0, 0.01, PITCH_HEIGHT / 2),
    ]);
    scene.add(new THREE.Line(centerLineGeometry, lineMaterial));

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
      new THREE.BoxGeometry(0.1, 0.15, GOAL_WIDTH),
      goalMaterial,
    );
    leftGoal.position.set(-PITCH_WIDTH / 2, 0.08, 0);
    scene.add(leftGoal);

    const rightGoal = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, GOAL_WIDTH),
      goalMaterial,
    );
    rightGoal.position.set(PITCH_WIDTH / 2, 0.08, 0);
    scene.add(rightGoal);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_SIZE, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    );
    ball.position.set(0, BALL_SIZE, 0);
    ball.castShadow = true;
    scene.add(ball);
    ballMeshRef.current = ball;

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    threeClockRef.current = new THREE.Clock();

    const createPlayerMesh = (x, z, color) => {
      const group = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(PLAYER_RADIUS, PLAYER_RADIUS, 0.6, 16),
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
      scene.add(group);
      return group;
    };

    const formationPositions = FORMATIONS[formationRef.current] || FORMATIONS['4-4-2'];

    playerMeshesRef.current.home = formationPositions.map((pos, index) => {
      const x = ((pos.x - 50) / 50) * PITCH_WIDTH;
      const z = ((pos.y - 50) / 50) * PITCH_HEIGHT;
      return createPlayerMesh(x, z, 0x3b82f6);
    });

    playerMeshesRef.current.away = formationPositions.map((pos, index) => {
      const x = ((50 - pos.x) / 50) * PITCH_WIDTH;
      const z = ((50 - pos.y) / 50) * PITCH_HEIGHT;
      return createPlayerMesh(x, z, 0xef4444);
    });

    playersStateRef.current.home = homeXI.map((player, index) => ({
      id: playerId(player),
      name: getPlayerName(player),
      position: normalizePosition(getPlayerPosition(player)),
      overall: getPlayerOverall(player),
      team: 'home',
      index,
      speed: PLAYER_SPEED_BASE + (getPlayerOverall(player) - 60) * 0.005,
      stamina: 100,
      hasBall: false,
      target: {
        x: playerMeshesRef.current.home[index]?.position.x || 0,
        z: playerMeshesRef.current.home[index]?.position.z || 0,
      },
      decisionCooldown: 0,
    }));

    playersStateRef.current.away = awayXI.map((player, index) => ({
      id: playerId(player),
      name: getPlayerName(player),
      position: normalizePosition(getPlayerPosition(player)),
      overall: getPlayerOverall(player),
      team: 'away',
      index,
      speed: PLAYER_SPEED_BASE + (getPlayerOverall(player) - 60) * 0.005,
      stamina: 100,
      hasBall: false,
      target: {
        x: playerMeshesRef.current.away[index]?.position.x || 0,
        z: playerMeshesRef.current.away[index]?.position.z || 0,
      },
      decisionCooldown: 0,
    }));

    const updateMatchEngine = (delta) => {
      if (matchStatusRef.current !== 'live' || pausedRef.current) return;

      const now = performance.now() / 1000;
      if (!lastSimulationTimeRef.current) lastSimulationTimeRef.current = now;

      const elapsed = now - lastSimulationTimeRef.current;
      lastSimulationTimeRef.current = now;

      gameClockRef.current += elapsed;

      const newMinute = Math.floor(gameClockRef.current);

      if (newMinute > matchMinuteRef.current) {
        matchMinuteRef.current = newMinute;
        setMatchMinute(newMinute);

        if (newMinute === FIRST_HALF_END && !halfTimeShown) {
          setHalfTimeShown(true);
          matchStatusRef.current = 'half-time';
          setMatchStatus('half-time');
          return;
        }

        if (newMinute >= MATCH_DURATION_MINUTES && !finishCalledRef.current) {
          finishCalledRef.current = true;
          finishMatch();
          return;
        }
      }

      updatePlayersState(delta);
      updateBall(delta);

      const currentTime = performance.now() / 1000;
      if (currentTime - lastFirestoreSaveRef.current > FIREBASE_SAVE_INTERVAL) {
        lastFirestoreSaveRef.current = currentTime;
        saveMatchStateToFirestore();
      }
    };

    const updatePlayersState = (delta) => {
      const homePlayers = playersStateRef.current.home;
      const awayPlayers = playersStateRef.current.away;

      homePlayers.forEach((player) => {
        player.stamina = clamp(player.stamina - delta * 2, 0, 100);
        player.speed =
          PLAYER_SPEED_BASE +
          (player.overall - 60) * 0.005 +
          (player.stamina - 100) * 0.002;
      });

      awayPlayers.forEach((player) => {
        player.stamina = clamp(player.stamina - delta * 2, 0, 100);
        player.speed =
          PLAYER_SPEED_BASE +
          (player.overall - 60) * 0.005 +
          (player.stamina - 100) * 0.002;
      });

      homePlayers.forEach((player, index) => {
        if (player.hasBall) return;
        const mesh = playerMeshesRef.current.home[index];
        if (!mesh) return;
        const formationPositions = FORMATIONS[formationRef.current] || FORMATIONS['4-4-2'];
        const formationPos = formationPositions[index] || formationPositions[0];
        const targetX = ((formationPos.x - 50) / 50) * PITCH_WIDTH;
        const targetZ = ((formationPos.y - 50) / 50) * PITCH_HEIGHT;
        if (player.position === 'GK') {
          player.target = { x: -PITCH_WIDTH / 2 + 1, z: mesh.position.z };
        } else {
          player.target = { x: targetX, z: targetZ };
        }
      });

      awayPlayers.forEach((player, index) => {
        if (player.hasBall) return;
        const mesh = playerMeshesRef.current.away[index];
        if (!mesh) return;
        const formationPositions = FORMATIONS[formationRef.current] || FORMATIONS['4-4-2'];
        const formationPos = formationPositions[index] || formationPositions[0];
        const targetX = ((50 - formationPos.x) / 50) * PITCH_WIDTH;
        const targetZ = ((50 - formationPos.y) / 50) * PITCH_HEIGHT;
        if (player.position === 'GK') {
          player.target = { x: PITCH_WIDTH / 2 - 1, z: mesh.position.z };
        } else {
          player.target = { x: targetX, z: targetZ };
        }
      });

      const ballState = ballStateRef.current;
      if (ballState && ballState.mode === 'possessed') {
        const { team, playerIndex } = ballState;
        const players = team === 'home' ? homePlayers : awayPlayers;
        const player = players[playerIndex];

        if (player) {
          player.hasBall = true;
          const mesh =
            team === 'home'
              ? playerMeshesRef.current.home[playerIndex]
              : playerMeshesRef.current.away[playerIndex];
          if (!mesh) return;

          const direction = team === 'home' ? 1 : -1;
          const goalX = direction * (PITCH_WIDTH / 2 - 2);

          if (player.decisionCooldown <= 0) {
            player.decisionCooldown = DECISION_INTERVAL;
            const random = Math.random();

            if (random < 0.3) {
              const teammates = players.filter((_, i) => i !== playerIndex);
              const bestTeammate = teammates.reduce((best, current) => {
                const currentDistance = distanceBetween(
                  { x: current.target.x, y: 0, z: current.target.z },
                  { x: mesh.position.x, y: 0, z: mesh.position.z },
                );
                const bestDistance = best
                  ? distanceBetween(
                      { x: best.target.x, y: 0, z: best.target.z },
                      { x: mesh.position.x, y: 0, z: mesh.position.z },
                    )
                  : Infinity;
                return currentDistance < bestDistance ? current : best;
              }, null);

              if (bestTeammate) {
                const teammateMesh =
                  team === 'home'
                    ? playerMeshesRef.current.home[bestTeammate.index]
                    : playerMeshesRef.current.away[bestTeammate.index];
                ballStateRef.current = {
                  mode: 'passing',
                  team,
                  fromIndex: playerIndex,
                  toIndex: bestTeammate.index,
                  from: { x: mesh.position.x, y: 0, z: mesh.position.z },
                  to: { x: teammateMesh.position.x, y: 0, z: teammateMesh.position.z },
                  progress: 0,
                };
                player.hasBall = false;
              }
            } else if (random < 0.5) {
              const distanceToGoal = Math.abs(goalX - mesh.position.x);
              if (distanceToGoal < 10) {
                ballStateRef.current = {
                  mode: 'shot',
                  team,
                  fromIndex: playerIndex,
                  from: { x: mesh.position.x, y: 0, z: mesh.position.z },
                  to: { x: goalX, y: 0, z: randomBetween(-2, 2) },
                  progress: 0,
                };
                player.hasBall = false;
              }
            } else {
              player.target = {
                x: mesh.position.x + direction * 0.5,
                z: mesh.position.z + (Math.random() - 0.5),
              };
            }
          } else {
            player.decisionCooldown -= delta;
          }
        }
      } else if (ballState && ballState.mode === 'passing') {
        ballState.progress += PASS_SPEED * delta;
        if (ballState.progress >= 1) {
          ballStateRef.current = {
            mode: 'possessed',
            team: ballState.team,
            playerIndex: ballState.toIndex,
          };
        }
      } else if (ballState && ballState.mode === 'shot') {
        ballState.progress += SHOT_SPEED * delta;
        if (ballState.progress >= 1) {
          const isGoal = Math.random() < 0.4;
          if (isGoal) {
            if (ballState.team === 'home') {
              homeScoreRef.current += 1;
              setHomeScore(homeScoreRef.current);
            } else {
              awayScoreRef.current += 1;
              setAwayScore(awayScoreRef.current);
            }

            const goalEvent = {
              id: `${Date.now()}-goal`,
              type: EVENT_TYPES.GOAL,
              team: ballState.team,
              minute: matchMinuteRef.current,
              playerId: null,
              playerName: '',
              detail: '',
              createdAt: new Date().toISOString(),
            };
            eventsRef.current = [goalEvent, ...eventsRef.current];
            setEvents(eventsRef.current);

            ballStateRef.current = {
              mode: 'kickoff',
              team: ballState.team === 'home' ? 'away' : 'home',
            };
          } else {
            const saveTeam = ballState.team === 'home' ? 'away' : 'home';
            const saveEvent = {
              id: `${Date.now()}-save`,
              type: EVENT_TYPES.SAVE,
              team: saveTeam,
              minute: matchMinuteRef.current,
              playerId: null,
              playerName: '',
              detail: '',
              createdAt: new Date().toISOString(),
            };
            eventsRef.current = [saveEvent, ...eventsRef.current];
            setEvents(eventsRef.current);

            ballStateRef.current = {
              mode: 'possessed',
              team: saveTeam,
              playerIndex: 0,
            };
          }
        }
      } else if (ballState && ballState.mode === 'kickoff') {
        const player =
          ballState.team === 'home'
            ? playersStateRef.current.home[5]
            : playersStateRef.current.away[5];
        if (player) {
          ballStateRef.current = {
            mode: 'possessed',
            team: ballState.team,
            playerIndex: 5,
          };
        }
      }
    };

    const updateBall = () => {
      const ball = ballMeshRef.current;
      const ballState = ballStateRef.current;
      if (!ball || !ballState) return;

      if (ballState.mode === 'possessed') {
        const { team, playerIndex } = ballState;
        const mesh =
          team === 'home'
            ? playerMeshesRef.current.home[playerIndex]
            : playerMeshesRef.current.away[playerIndex];
        if (mesh) {
          ball.position.x = mesh.position.x;
          ball.position.z = mesh.position.z;
          ball.position.y = BALL_SIZE;
        }
      } else if (ballState.mode === 'passing' || ballState.mode === 'shot') {
        const progress = ballState.progress;
        ball.position.x = lerp(ballState.from.x, ballState.to.x, progress);
        ball.position.z = lerp(ballState.from.z, ballState.to.z, progress);
        ball.position.y = BALL_SIZE + Math.sin(progress * Math.PI) * 0.5;
      }
    };

    const saveMatchStateToFirestore = async () => {
      if (!matchId) return;
      try {
        const matchRef = doc(db, 'matches', matchId);
        await setDoc(
          matchRef,
          {
            id: matchId,
            status: matchStatusRef.current,
            minute: matchMinuteRef.current,
            homeScore: homeScoreRef.current,
            awayScore: awayScoreRef.current,
            result: {
              homeScore: homeScoreRef.current,
              awayScore: awayScoreRef.current,
            },
            events: eventsRef.current,
            homeStats: homeStatsRef.current,
            awayStats: awayStatsRef.current,
            substitutionsUsed,
            mentality: mentalityRef.current,
            formation: formationRef.current,
            simulationVersion: simulationVersionRef.current,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (error) {
        console.error('Firestore save error:', error);
      }
    };

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      const delta = threeClockRef.current.getDelta();
      updateMatchEngine(delta);

      playerMeshesRef.current.home.forEach((mesh, index) => {
        const state = playersStateRef.current.home[index];
        if (state && mesh) {
          mesh.position.x = lerp(mesh.position.x, state.target.x, 0.1);
          mesh.position.z = lerp(mesh.position.z, state.target.z, 0.1);
        }
      });

      playerMeshesRef.current.away.forEach((mesh, index) => {
        const state = playersStateRef.current.away[index];
        if (state && mesh) {
          mesh.position.x = lerp(mesh.position.x, state.target.x, 0.1);
          mesh.position.z = lerp(mesh.position.z, state.target.z, 0.1);
        }
      });

      updateBall();
      controls.update();
      renderer.render(scene, camera);
    };

    animate();

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
  }, [homeXI, awayXI]);

  /* =======================================================
     REALTIME MATCH LISTENER
  ======================================================== */

  useEffect(() => {
    if (!user || !matchId) return;

    const matchRef = doc(db, 'matches', matchId);

    const unsubscribe = onSnapshot(
      matchRef,
      (snapshot) => {
        if (!snapshot.exists()) return;

        const data = snapshot.data();
        const incomingVersion = data.simulationVersion || 0;

        if (incomingVersion < simulationVersionRef.current) return;

        if (!userIsParticipant || matchStatusRef.current !== 'live') {
          matchMinuteRef.current = safeNumber(data.minute, matchMinuteRef.current);
          homeScoreRef.current = safeNumber(
            data.homeScore ?? data.result?.homeScore,
            homeScoreRef.current,
          );
          awayScoreRef.current = safeNumber(
            data.awayScore ?? data.result?.awayScore,
            awayScoreRef.current,
          );
          eventsRef.current = Array.isArray(data.events) ? data.events : [];
          homeStatsRef.current = { ...createDefaultStats(), ...(data.homeStats || {}) };
          awayStatsRef.current = { ...createDefaultStats(), ...(data.awayStats || {}) };
          matchStatusRef.current = data.status || 'ready';

          setMatchMinute(matchMinuteRef.current);
          setHomeScore(homeScoreRef.current);
          setAwayScore(awayScoreRef.current);
          setEvents(eventsRef.current);
          setHomeStats(homeStatsRef.current);
          setAwayStats(awayStatsRef.current);
          setMatchStatus(matchStatusRef.current);
        }
      },
      (error) => {
        console.error('Match realtime listener error:', error);
      },
    );

    return () => unsubscribe();
  }, [user, matchId, userIsParticipant]);

  /* =======================================================
     START MATCH
  ======================================================== */

  const startMatch = useCallback(async () => {
    if (!fixture || !userIsParticipant) {
      toast.error('You are not managing a team in this match.');
      return;
    }

    if (matchStatusRef.current === 'finished') {
      toast.error('This match has already finished.');
      return;
    }

    try {
      setSavingMatch(true);
      matchStatusRef.current = 'live';
      setMatchStatus('live');
      pausedRef.current = false;
      setPaused(false);
      lastSimulationTimeRef.current = performance.now() / 1000;
      lastFirestoreSaveRef.current = performance.now() / 1000;
      toast.success('Match started');
    } catch (error) {
      console.error(error);
      toast.error('Could not start match');
    } finally {
      setSavingMatch(false);
    }
  }, [fixture, userIsParticipant]);

  /* =======================================================
     PAUSE
  ======================================================== */

  const togglePause = () => {
    if (matchStatusRef.current !== 'live') return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  /* =======================================================
     HALF TIME
  ======================================================== */

  const continueSecondHalf = async () => {
    try {
      setSavingMatch(true);
      setHalfTimeShown(false);
      matchStatusRef.current = 'live';
      setMatchStatus('live');
      pausedRef.current = false;
      setPaused(false);
      lastSimulationTimeRef.current = performance.now() / 1000;
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
    if (finishCalledRef.current) return;
    finishCalledRef.current = true;

    try {
      setSavingMatch(true);
      matchStatusRef.current = 'finished';
      setMatchStatus('finished');
      pausedRef.current = true;
      setPaused(true);
      setMatchMinute(MATCH_DURATION_MINUTES);
      matchMinuteRef.current = MATCH_DURATION_MINUTES;

      const matchRef = doc(db, 'matches', matchId);

      await setDoc(
        matchRef,
        {
          id: matchId,
          status: 'finished',
          minute: MATCH_DURATION_MINUTES,
          homeScore: homeScoreRef.current,
          awayScore: awayScoreRef.current,
          result: {
            homeScore: homeScoreRef.current,
            awayScore: awayScoreRef.current,
          },
          events: eventsRef.current,
          homeStats: homeStatsRef.current,
          awayStats: awayStatsRef.current,
          substitutionsUsed,
          mentality: mentalityRef.current,
          formation: formationRef.current,
          simulationVersion: simulationVersionRef.current,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      toast.success(`Full time: ${homeScoreRef.current} - ${awayScoreRef.current}`);
    } catch (error) {
      console.error('Finish match error:', error);
      toast.error('Could not save final result');
    } finally {
      setSavingMatch(false);
    }
  }, [matchId, substitutionsUsed]);

  /* =======================================================
     TACTICS
  ======================================================== */

  const changeMentality = async (value) => {
    mentalityRef.current = value;
    setMentality(value);
  };

  /* =======================================================
     FORMATION
  ======================================================== */

  const changeFormation = async (value) => {
    formationRef.current = value;
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

    if (!selectedSubPlayer) {
      toast.error('Select a player.');
      return;
    }

    const team = userTeam === 'home' ? 'home' : 'away';
    const currentXI = team === 'home' ? homeXI : awayXI;
    const bench = team === 'home' ? homeBench : awayBench;

    const playerIn = bench.find(
      (player) => String(playerId(player)) === String(selectedSubPlayer),
    );

    if (!playerIn) {
      toast.error('Player not found.');
      return;
    }

    const playerOut = pick(currentXI);
    if (!playerOut) return;

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
      minute: matchMinuteRef.current,
      playerId: playerId(playerIn),
      playerName: getPlayerName(playerIn),
      detail: `${getPlayerName(playerIn)} replaced ${getPlayerName(playerOut)}`,
      createdAt: new Date().toISOString(),
    };

    const nextEvents = [event, ...eventsRef.current];
    eventsRef.current = nextEvents;

    if (team === 'home') {
      setHomeXI(nextXI);
      setHomeBench(nextBench);
    } else {
      setAwayXI(nextXI);
      setAwayBench(nextBench);
    }

    setSubstitutionsUsed(nextSubCount);
    setEvents(nextEvents);
    setSelectedSubPlayer('');
    toast.success('Substitution made');
  };

  /* =======================================================
     DISPLAY EVENTS
  ======================================================== */

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => safeNumber(b.minute) - safeNumber(a.minute)),
    [events],
  );

  /* =======================================================
     MATCH STATUS LABEL
  ======================================================== */

  const statusLabel = useMemo(() => {
    switch (matchStatus) {
      case 'ready': return 'READY';
      case 'live': return paused ? 'PAUSED' : 'LIVE';
      case 'half-time': return 'HALF TIME';
      case 'finished': return 'FULL TIME';
      default: return 'LOADING';
    }
  }, [matchStatus, paused]);

  /* =======================================================
     RENDER
  ======================================================== */

  if (loading) {
    return (
      <main className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading...</p>
      </main>
    );
  }

  if (!user) return null;

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
              onClick={() => setShowTactics((previous) => !previous)}
            >
              ⚙ Tactics
            </button>

            <button
              type="button"
              onClick={() => setShowFormation((previous) => !previous)}
            >
              📋 Formation
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

        {/* FORMATION */}
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

        {/* TACTICS */}
        {showTactics && userIsParticipant && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Team Mentality</h2>
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

            <select
              value={selectedSubPlayer}
              onChange={(event) => setSelectedSubPlayer(event.target.value)}
            >
              <option value="">Select player</option>
              {(userTeam === 'home' ? homeBench : awayBench).map((player) => (
                <option
                  key={String(playerId(player))}
                  value={String(playerId(player))}
                >
                  {getPlayerName(player)} · OVR {getPlayerOverall(player)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={makeSubstitution}
              disabled={
                substitutionsUsed >= MAX_SUBSTITUTIONS || !selectedSubPlayer
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

        {/* LINEUPS WITH RATINGS */}
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
                  <span className={styles.playerRating}>
                    {getPlayerOverall(player)}
                  </span>
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
                  <span className={styles.playerRating}>
                    {getPlayerOverall(player)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* MATCH INFO */}
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
            <span>MENTALITY</span>
            <strong>{mentality}</strong>
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
