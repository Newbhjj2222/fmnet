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

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './match.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MATCH_DURATION = 20;
const FIRST_HALF_END = 10;

const MAX_SQUAD_SIZE = 25;
const PLAYERS_ON_PITCH = 11;
const MAX_SUBSTITUTIONS = 5;

const MATCH_TICK_MS = 1000;
const TICK_SECONDS = 1;

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
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
    60
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
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function pick(array) {
  if (!Array.isArray(array) || !array.length) {
    return null;
  }

  return array[
    Math.floor(Math.random() * array.length)
  ];
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

function getClubSecondaryColor(club) {
  return (
    club?.secondaryColor ||
    club?.colors?.secondary ||
    '#ffffff'
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
   FORMATION
========================================================= */

const FORMATION_POSITIONS = {
  balanced: [
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

  attacking: [
    { x: 8, y: 50 },

    { x: 22, y: 18 },
    { x: 22, y: 40 },
    { x: 22, y: 60 },
    { x: 22, y: 82 },

    { x: 40, y: 20 },
    { x: 40, y: 50 },
    { x: 40, y: 80 },

    { x: 59, y: 20 },
    { x: 64, y: 50 },
    { x: 59, y: 80 },
  ],

  defensive: [
    { x: 8, y: 50 },

    { x: 20, y: 18 },
    { x: 20, y: 39 },
    { x: 20, y: 61 },
    { x: 20, y: 82 },

    { x: 38, y: 20 },
    { x: 38, y: 42 },
    { x: 38, y: 58 },
    { x: 38, y: 80 },

    { x: 52, y: 38 },
    { x: 52, y: 62 },
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

function selectStartingXI(squad) {
  const safeSquad = Array.isArray(squad)
    ? [...squad]
    : [];

  const goalkeepers = safeSquad.filter(
    (player) =>
      normalizePosition(
        getPlayerPosition(player)
      ) === 'GK'
  );

  const defenders = safeSquad.filter(
    (player) =>
      normalizePosition(
        getPlayerPosition(player)
      ) === 'DEF'
  );

  const midfielders = safeSquad.filter(
    (player) =>
      normalizePosition(
        getPlayerPosition(player)
      ) === 'MID'
  );

  const attackers = safeSquad.filter(
    (player) =>
      normalizePosition(
        getPlayerPosition(player)
      ) === 'ATT'
  );

  const used = new Set();
  const result = [];

  function addBest(list, count) {
    [...list]
      .sort(
        (a, b) =>
          getPlayerOverall(b) -
          getPlayerOverall(a)
      )
      .slice(0, count)
      .forEach((player) => {
        if (!used.has(player.id)) {
          used.add(player.id);
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
      (player) => !used.has(player.id)
    )
    .sort(
      (a, b) =>
        getPlayerOverall(b) -
        getPlayerOverall(a)
    );

  while (
    result.length < PLAYERS_ON_PITCH &&
    remaining.length
  ) {
    result.push(remaining.shift());
  }

  return result.slice(
    0,
    PLAYERS_ON_PITCH
  );
}

/* =========================================================
   PLAYER ID
========================================================= */

function playerId(player) {
  return (
    player?.id ||
    player?.playerId ||
    player?.uid ||
    null
  );
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

    const snapshot =
      await getDocs(playersQuery);

    return snapshot.docs.map(
      (item) => ({
        id: item.id,
        ...item.data(),
      })
    );
  } catch (error) {
    console.error(
      'clubId player query failed:',
      error
    );
  }

  /*
   * Backward compatibility:
   * Some old player documents may use currentClub/teamId.
   */

  try {
    const allSnapshot =
      await getDocs(
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
      });
  } catch (error) {
    console.error(
      'Fallback players query failed:',
      error
    );

    return [];
  }
}

/* =========================================================
   LOAD MATCH FROM DATABASE
========================================================= */

async function loadMatchFromDatabase(matchId) {
  if (!matchId) {
    return null;
  }

  /*
   * PRIMARY SOURCE
   * matches/{matchId}
   */
  const matchRef = doc(
    db,
    'matches',
    matchId
  );

  const matchSnapshot =
    await getDoc(matchRef);

  if (matchSnapshot.exists()) {
    return {
      id: matchSnapshot.id,
      ...matchSnapshot.data(),
      _source: 'matches',
    };
  }

  /*
   * BACKWARD COMPATIBILITY ONLY
   *
   * Old fixtures can still be opened.
   * We do NOT generate anything here.
   */
  const fixtureRef = doc(
    db,
    'fixtures',
    matchId
  );

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
   MATCH PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const matchId =
    typeof router.query.id === 'string'
      ? router.query.id
      : null;

  /* =======================================================
     MATCH
  ======================================================== */

  const [fixture, setFixture] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  /* =======================================================
     SQUADS
  ======================================================== */

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

  /* =======================================================
     SCORE
  ======================================================== */

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

  /* =======================================================
     STATS
  ======================================================== */

  const [homeStats, setHomeStats] =
    useState(createDefaultStats());

  const [awayStats, setAwayStats] =
    useState(createDefaultStats());

  /* =======================================================
     TACTICS
  ======================================================== */

  const [mentality, setMentality] =
    useState('balanced');

  const [showTactics, setShowTactics] =
    useState(false);

  const [showSubs, setShowSubs] =
    useState(false);

  const [showEvents, setShowEvents] =
    useState(true);

  /* =======================================================
     UI
  ======================================================== */

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

  const [substitutionsUsed, setSubstitutionsUsed] =
    useState(0);

  const [selectedSubPlayer, setSelectedSubPlayer] =
    useState('');

  const [selectedTeam, setSelectedTeam] =
    useState('home');

  const timerRef =
    useRef(null);

  const processingRef =
    useRef(false);

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

  /* =======================================================
     LOAD USER CLUB
  ======================================================== */

  useEffect(() => {
    if (
      loading ||
      !user
    ) {
      return;
    }

    let cancelled = false;

    async function loadUserClub() {
      try {
        const userRef =
          doc(
            db,
            'users',
            user.uid
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
     APPLY MATCH DATABASE STATE
  ======================================================== */

  const applyMatchState = useCallback(
    (data) => {
      if (!data) return;

      const result =
        data.result || {};

      setHomeScore(
        safeNumber(
          result.homeScore ??
            data.homeScore,
          0
        )
      );

      setAwayScore(
        safeNumber(
          result.awayScore ??
            data.awayScore,
          0
        )
      );

      setMatchMinute(
        safeNumber(
          data.minute ??
            data.matchMinute,
          0
        )
      );

      setEvents(
        Array.isArray(data.events)
          ? data.events
          : []
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
          0
        )
      );

      if (data.mentality) {
        setMentality(
          data.mentality
        );
      }

      const status =
        normalize(data.status);

      if (
        status === 'finished' ||
        status === 'completed'
      ) {
        setMatchStatus(
          'finished'
        );
      } else if (
        status === 'half-time'
      ) {
        setMatchStatus(
          'half-time'
        );
      } else if (
        status === 'live'
      ) {
        setMatchStatus(
          'live'
        );
      } else {
        setMatchStatus(
          'ready'
        );
      }
    },
    []
  );

  /* =======================================================
     LOAD MATCH + CLUBS + PLAYERS
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

        if (cancelled) return;

        setHomeClub(home);
        setAwayClub(away);

        const [
          homePlayers,
          awayPlayers,
        ] = await Promise.all([
          loadClubPlayers(homeId),
          loadClubPlayers(awayId),
        ]);

        if (cancelled) return;

        /*
         * IMPORTANT:
         * Players come from database.
         * No fake squad is created here.
         */
        const preparedHome =
          homePlayers
            .slice(
              0,
              MAX_SQUAD_SIZE
            );

        const preparedAway =
          awayPlayers
            .slice(
              0,
              MAX_SQUAD_SIZE
            );

        setHomeSquad(
          preparedHome
        );

        setAwaySquad(
          preparedAway
        );

        const startingHome =
          selectStartingXI(
            preparedHome
          );

        const startingAway =
          selectStartingXI(
            preparedAway
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
  ]);

  /* =======================================================
     REALTIME MATCH LISTENER
  ======================================================== */

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
        matchId
      );

    const unsubscribe =
      onSnapshot(
        matchRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            return;
          }

          const data = {
            id:
              snapshot.id,
            ...snapshot.data(),
          };

          setFixture(
            (previous) => ({
              ...(previous || {}),
              ...data,
            })
          );

          applyMatchState(data);
        },
        (error) => {
          console.error(
            'Match realtime listener error:',
            error
          );
        }
      );

    return () =>
      unsubscribe();
  }, [
    user,
    matchId,
    applyMatchState,
  ]);

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

      await setDoc(
        matchRef,
        {
          id: matchId,

          status:
            statusValue ||
            'live',

          minute:
            safeNumber(
              minute,
              0
            ),

          homeScore:
            safeNumber(
              homeScoreValue,
              0
            ),

          awayScore:
            safeNumber(
              awayScoreValue,
              0
            ),

          result: {
            homeScore:
              safeNumber(
                homeScoreValue,
                0
              ),

            awayScore:
              safeNumber(
                awayScoreValue,
                0
              ),
          },

          events:
            Array.isArray(
              eventsValue
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
              0
            ),

          mentality:
            mentalityValue ||
            'balanced',

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
     ADD EVENT
  ======================================================== */

  const addMatchEvent = useCallback(
    async ({
      type,
      team,
      player,
      minute,
      detail = '',
    }) => {
      const event = {
        id: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

        type,

        team,

        minute:
          safeNumber(
            minute,
            0
          ),

        playerId:
          playerId(player),

        playerName:
          player
            ? getPlayerName(player)
            : '',

        detail,

        createdAt:
          new Date().toISOString(),
      };

      setEvents(
        (previous) => [
          event,
          ...previous,
        ]
      );

      return event;
    },
    []
  );

  /* =======================================================
     UPDATE SCORE
  ======================================================== */

  const updateScore = useCallback(
    async (team, player) => {
      const newHomeScore =
        team === 'home'
          ? homeScore + 1
          : homeScore;

      const newAwayScore =
        team === 'away'
          ? awayScore + 1
          : awayScore;

      const event = {
        id: `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

        type:
          EVENT_TYPES.GOAL,

        team,

        minute:
          matchMinute,

        playerId:
          playerId(player),

        playerName:
          getPlayerName(player),

        detail:
          `${getPlayerName(
            player
          )} scored`,

        createdAt:
          new Date().toISOString(),
      };

      const newEvents = [
        event,
        ...events,
      ];

      const newHomeStats = {
        ...homeStats,
        shots:
          homeStats.shots + 1,
        shotsOnTarget:
          homeStats.shotsOnTarget + 1,
      };

      const newAwayStats = {
        ...awayStats,
        shots:
          awayStats.shots + 1,
        shotsOnTarget:
          awayStats.shotsOnTarget + 1,
      };

      if (team === 'home') {
        newHomeStats.shots =
          homeStats.shots + 1;
        newHomeStats.shotsOnTarget =
          homeStats.shotsOnTarget + 1;
      } else {
        newAwayStats.shots =
          awayStats.shots + 1;
        newAwayStats.shotsOnTarget =
          awayStats.shotsOnTarget + 1;
      }

      setHomeScore(
        newHomeScore
      );

      setAwayScore(
        newAwayScore
      );

      setEvents(
        newEvents
      );

      setHomeStats(
        newHomeStats
      );

      setAwayStats(
        newAwayStats
      );

      await saveMatchState({
        minute:
          matchMinute,

        homeScoreValue:
          newHomeScore,

        awayScoreValue:
          newAwayScore,

        eventsValue:
          newEvents,

        homeStatsValue:
          newHomeStats,

        awayStatsValue:
          newAwayStats,

        statusValue:
          'live',

        substitutionsValue:
          substitutionsUsed,

        mentalityValue:
          mentality,
      });
    },
    [
      homeScore,
      awayScore,
      matchMinute,
      events,
      homeStats,
      awayStats,
      substitutionsUsed,
      mentality,
      saveMatchState,
    ]
  );

  /* =======================================================
     SIMULATE ONE MATCH MINUTE
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
          const homeStrength =
            homeXI.reduce(
              (
                total,
                player
              ) =>
                total +
                getPlayerOverall(
                  player
                ),
              0
            ) /
            Math.max(
              homeXI.length,
              1
            );

          const awayStrength =
            awayXI.reduce(
              (
                total,
                player
              ) =>
                total +
                getPlayerOverall(
                  player
                ),
              0
            ) /
            Math.max(
              awayXI.length,
              1
            );

          const homeMentalityBonus =
            mentality === 'attacking'
              ? 4
              : mentality ===
                'defensive'
              ? -3
              : 0;

          const homeChance =
            clamp(
              8 +
                (
                  homeStrength -
                  awayStrength
                ) *
                  0.18 +
                homeMentalityBonus,
              2,
              22
            );

          const awayChance =
            clamp(
              7 +
                (
                  awayStrength -
                  homeStrength
                ) *
                  0.18,
              2,
              20
            );

          const random =
            Math.random() * 100;

          let event = null;
          let scoringTeam = null;

          /*
           * GOAL
           */
          if (
            random <
            homeChance * 0.08
          ) {
            scoringTeam =
              'home';

            const player =
              pick(
                homeXI.filter(
                  (p) =>
                    normalizePosition(
                      getPlayerPosition(
                        p
                      )
                    ) ===
                      'ATT' ||
                    normalizePosition(
                      getPlayerPosition(
                        p
                      )
                    ) ===
                      'MID'
                )
              ) ||
              pick(homeXI);

            event = {
              id: `${Date.now()}-${minute}-goal-home`,

              type:
                EVENT_TYPES.GOAL,

              team: 'home',

              minute,

              playerId:
                playerId(player),

              playerName:
                getPlayerName(player),

              detail:
                `${getPlayerName(
                  player
                )} scored`,

              createdAt:
                new Date().toISOString(),
            };
          } else if (
            random <
            (homeChance +
              awayChance) *
              0.08
          ) {
            scoringTeam =
              'away';

            const player =
              pick(
                awayXI.filter(
                  (p) =>
                    normalizePosition(
                      getPlayerPosition(
                        p
                      )
                    ) ===
                      'ATT' ||
                    normalizePosition(
                      getPlayerPosition(
                        p
                      )
                    ) ===
                      'MID'
                )
              ) ||
              pick(awayXI);

            event = {
              id: `${Date.now()}-${minute}-goal-away`,

              type:
                EVENT_TYPES.GOAL,

              team: 'away',

              minute,

              playerId:
                playerId(player),

              playerName:
                getPlayerName(player),

              detail:
                `${getPlayerName(
                  player
                )} scored`,

              createdAt:
                new Date().toISOString(),
            };
          } else {
            /*
             * OTHER MATCH EVENTS
             */

            const eventRandom =
              Math.random() *
              100;

            if (
              eventRandom < 14
            ) {
              const team =
                Math.random() <
                0.5
                  ? 'home'
                  : 'away';

              const lineup =
                team === 'home'
                  ? homeXI
                  : awayXI;

              const player =
                pick(lineup);

              event = {
                id: `${Date.now()}-${minute}-shot`,

                type:
                  EVENT_TYPES.SHOT,

                team,

                minute,

                playerId:
                  playerId(player),

                playerName:
                  getPlayerName(
                    player
                  ),

                detail:
                  'Shot attempt',

                createdAt:
                  new Date().toISOString(),
              };
            } else if (
              eventRandom < 19
            ) {
              const team =
                Math.random() <
                0.5
                  ? 'home'
                  : 'away';

              const lineup =
                team === 'home'
                  ? homeXI
                  : awayXI;

              const player =
                pick(lineup);

              event = {
                id: `${Date.now()}-${minute}-foul`,

                type:
                  EVENT_TYPES.FOUL,

                team,

                minute,

                playerId:
                  playerId(player),

                playerName:
                  getPlayerName(
                    player
                  ),

                detail:
                  'Foul committed',

                createdAt:
                  new Date().toISOString(),
              };
            } else if (
              eventRandom < 22
            ) {
              const team =
                Math.random() <
                0.5
                  ? 'home'
                  : 'away';

              const lineup =
                team === 'home'
                  ? homeXI
                  : awayXI;

              const player =
                pick(lineup);

              event = {
                id: `${Date.now()}-${minute}-yellow`,

                type:
                  EVENT_TYPES.YELLOW,

                team,

                minute,

                playerId:
                  playerId(player),

                playerName:
                  getPlayerName(
                    player
                  ),

                detail:
                  'Yellow card',

                createdAt:
                  new Date().toISOString(),
              };
            } else if (
              eventRandom < 27
            ) {
              const team =
                Math.random() <
                0.5
                  ? 'home'
                  : 'away';

              event = {
                id: `${Date.now()}-${minute}-corner`,

                type:
                  EVENT_TYPES.CORNER,

                team,

                minute,

                detail:
                  'Corner kick',

                createdAt:
                  new Date().toISOString(),
              };
            }
          }

          /*
           * STATS
           */

          const nextHomeStats = {
            ...homeStats,
          };

          const nextAwayStats = {
            ...awayStats,
          };

          /*
           * Possession
           */
          const possessionBase =
            clamp(
              50 +
                (
                  homeStrength -
                  awayStrength
                ) *
                  0.4 +
                (
                  mentality ===
                  'attacking'
                    ? 2
                    : mentality ===
                      'defensive'
                    ? -2
                    : 0
                ),
              30,
              70
            );

          nextHomeStats.possession =
            Math.round(
              possessionBase
            );

          nextAwayStats.possession =
            100 -
            nextHomeStats.possession;

          /*
           * Passes
           */
          nextHomeStats.passes +=
            randomBetweenSafe(
              4,
              15
            );

          nextAwayStats.passes +=
            randomBetweenSafe(
              4,
              15
            );

          if (event) {
            if (
              event.type ===
              EVENT_TYPES.SHOT
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.shots +=
                  1;

                if (
                  Math.random() <
                  0.38
                ) {
                  nextHomeStats.shotsOnTarget +=
                    1;
                }
              } else {
                nextAwayStats.shots +=
                  1;

                if (
                  Math.random() <
                  0.38
                ) {
                  nextAwayStats.shotsOnTarget +=
                    1;
                }
              }
            }

            if (
              event.type ===
              EVENT_TYPES.GOAL
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.shots +=
                  1;

                nextHomeStats.shotsOnTarget +=
                  1;
              } else {
                nextAwayStats.shots +=
                  1;

                nextAwayStats.shotsOnTarget +=
                  1;
              }
            }

            if (
              event.type ===
              EVENT_TYPES.FOUL
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.fouls +=
                  1;
              } else {
                nextAwayStats.fouls +=
                  1;
              }
            }

            if (
              event.type ===
              EVENT_TYPES.YELLOW
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.yellow +=
                  1;
              } else {
                nextAwayStats.yellow +=
                  1;
              }
            }

            if (
              event.type ===
              EVENT_TYPES.RED
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.red +=
                  1;
              } else {
                nextAwayStats.red +=
                  1;
              }
            }

            if (
              event.type ===
              EVENT_TYPES.CORNER
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.corners +=
                  1;
              } else {
                nextAwayStats.corners +=
                  1;
              }
            }

            if (
              event.type ===
              EVENT_TYPES.OFFSIDE
            ) {
              if (
                event.team ===
                'home'
              ) {
                nextHomeStats.offsides +=
                  1;
              } else {
                nextAwayStats.offsides +=
                  1;
              }
            }
          }

          let nextHomeScore =
            homeScore;

          let nextAwayScore =
            awayScore;

          if (
            scoringTeam ===
            'home'
          ) {
            nextHomeScore +=
              1;
          }

          if (
            scoringTeam ===
            'away'
          ) {
            nextAwayScore +=
              1;
          }

          const nextEvents =
            event
              ? [
                  event,
                  ...events,
                ]
              : events;

          setHomeScore(
            nextHomeScore
          );

          setAwayScore(
            nextAwayScore
          );

          setHomeStats(
            nextHomeStats
          );

          setAwayStats(
            nextAwayStats
          );

          if (event) {
            setEvents(
              nextEvents
            );
          }

          await saveMatchState({
            minute,

            homeScoreValue:
              nextHomeScore,

            awayScoreValue:
              nextAwayScore,

            eventsValue:
              nextEvents,

            homeStatsValue:
              nextHomeStats,

            awayStatsValue:
              nextAwayStats,

            statusValue:
              'live',

            substitutionsValue:
              substitutionsUsed,

            mentalityValue:
              mentality,
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
        homeXI,
        awayXI,
        mentality,
        homeScore,
        awayScore,
        homeStats,
        awayStats,
        events,
        substitutionsUsed,
        saveMatchState,
      ]
    );

  /* =======================================================
     SAFE RANDOM
  ======================================================== */

  function randomBetweenSafe(
    min,
    max
  ) {
    return Math.floor(
      Math.random() *
        (max - min + 1)
    ) + min;
  }

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
        saveMatchState,
      ]
    );

  /* =======================================================
     MATCH TIMER
  ======================================================== */

  useEffect(() => {
    if (
      matchStatus !==
      'live'
    ) {
      return;
    }

    if (paused) {
      return;
    }

    timerRef.current =
      setInterval(() => {
        setMatchMinute(
          (previous) => {
            const next =
              previous + TICK_SECONDS;

            if (
              next ===
              FIRST_HALF_END
            ) {
              setMatchStatus(
                'half-time'
              );

              setHalfTimeShown(
                true
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
  ]);

  /* =======================================================
     SIMULATE CURRENT MINUTE
  ======================================================== */

  useEffect(() => {
    if (
      matchStatus !==
      'live'
    ) {
      return;
    }

    if (paused) {
      return;
    }

    if (
      matchMinute <= 0 ||
      matchMinute >=
        MATCH_DURATION
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
  ]);

  /* =======================================================
     HALF TIME
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

          mentalityValue:
            mentality,
        });

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
  ======================================================== */

  const finishMatch =
    useCallback(
      async () => {
        try {
          setSavingMatch(true);

          const finalResult = {
            homeScore,
            awayScore,
          };

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

            mentalityValue:
              mentality,

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

          setMatchMinute(
            MATCH_DURATION
          );

          setMatchStatus(
            'finished'
          );

          setPaused(true);

          toast.success(
            `Full time: ${homeScore} - ${awayScore}`
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
        homeScore,
        awayScore,
        events,
        homeStats,
        awayStats,
        substitutionsUsed,
        mentality,
        user,
        saveMatchState,
      ]
    );

  /* =======================================================
     FINISH AUTOMATICALLY
  ======================================================== */

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
          !previous
      );
    };

  /* =======================================================
     TACTICS
  ======================================================== */

  const changeMentality =
    async (value) => {
      setMentality(value);

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
            matchStatus ===
            'ready'
              ? 'ready'
              : matchStatus,

          substitutionsValue:
            substitutionsUsed,

          mentalityValue:
            value,
        });
      } catch (error) {
        console.error(
          error
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
          'Maximum substitutions reached.'
        );

        return;
      }

      if (
        !selectedSubPlayer
      ) {
        toast.error(
          'Select a player.'
        );

        return;
      }

      const team =
        userTeam ===
        'home'
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
              selectedSubPlayer
            )
        );

      if (!playerIn) {
        toast.error(
          'Player not found.'
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
              playerId(player)
            ) ===
            String(
              playerId(
                playerOut
              )
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
              playerId(
                playerIn
              )
            )
        ),
        playerOut,
      ];

      const nextSubCount =
        substitutionsUsed + 1;

      const event = {
        id: `${Date.now()}-substitution`,

        type:
          EVENT_TYPES.SUBSTITUTION,

        team,

        minute:
          matchMinute,

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
        ...events,
      ];

      if (team === 'home') {
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

      setSubstitutionsUsed(
        nextSubCount
      );

      setEvents(
        nextEvents
      );

      setSelectedSubPlayer(
        ''
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

        mentalityValue:
          mentality,

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
     DISPLAY EVENTS
  ======================================================== */

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
     MATCH STATUS LABEL
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

  /* =======================================================
     NO USER
  ======================================================== */

  if (!user) {
    return null;
  }

  /* =======================================================
     MATCH NOT FOUND
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
  ======================================================== */

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
        {/* =================================================
            HEADER
        ================================================== */}

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

        {/* =================================================
            SCOREBOARD
        ================================================== */}

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
              {matchMinute}
              '
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

        {/* =================================================
            LATEST SCORE
        ================================================== */}

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
                homeClub
              )}{' '}
              {homeScore}
              {' - '}
              {awayScore}{' '}
              {getClubName(
                awayClub
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

        {/* =================================================
            ACCESS WARNING
        ================================================== */}

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
              Your current club is not
              participating in this match.
              You can view the latest score
              and events, but you cannot play it.
            </p>
          </section>
        )}

        {/* =================================================
            CONTROLS
        ================================================== */}

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

        {/* =================================================
            HALF TIME
        ================================================== */}

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
              {homeScore} - {awayScore}
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
            TACTICS
        ================================================== */}

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
                          value
                        )
                      }
                    >
                      {value
                        .charAt(
                          0
                        )
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

        {/* =================================================
            SUBSTITUTIONS
        ================================================== */}

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
                onChange={(
                  event
                ) =>
                  setSelectedSubPlayer(
                    event.target
                      .value
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
                      ·{' '}
                      {getPlayerOverall(
                        player
                      )}
                    </option>
                  )
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
                Make Substitution
              </button>
            </section>
          )}

        {/* =================================================
            STATS
        ================================================== */}

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
              {homeScore} - {awayScore}
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
            )
          )}
        </section>

        {/* =================================================
            EVENTS
        ================================================== */}

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
                          event
                        )}
                      </span>

                      <div>
                        <strong>
                          {
                            eventLabel(
                              event
                            )
                          }
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

        {/* =================================================
            LINEUPS
        ================================================== */}

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
                  homeClub
                )}
              </h2>

              <span>
                {homeXI.length}
                /11
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
                        ·{' '}
                        {getPlayerOverall(
                          player
                        )}
                      </small>
                    </div>
                  </div>
                )
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
                  awayClub
                )}
              </h2>

              <span>
                {awayXI.length}
                /11
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
                        ·{' '}
                        {getPlayerOverall(
                          player
                        )}
                      </small>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </section>

        {/* =================================================
            FOOTER MATCH INFO
        ================================================== */}

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
