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
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
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
    `${player?.firstName || ''} ${
      player?.lastName || ''
    }`.trim() ||
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


function getPlayerAge(player) {
  if (player?.age) {
    return safeNumber(player.age, 0);
  }

  if (player?.dateOfBirth) {
    const dob = new Date(
      player.dateOfBirth
    );

    if (!Number.isNaN(dob.getTime())) {
      const now = new Date();

      let age =
        now.getFullYear() -
        dob.getFullYear();

      const month =
        now.getMonth() -
        dob.getMonth();

      if (
        month < 0 ||
        (
          month === 0 &&
          now.getDate() <
            dob.getDate()
        )
      ) {
        age--;
      }

      return age;
    }
  }

  return 0;
}


function randomBetween(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}


function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}


function pick(array) {
  if (!array?.length) {
    return null;
  }

  return array[
    Math.floor(
      Math.random() * array.length
    )
  ];
}


/* =========================================================
   CLUB HELPERS
========================================================= */

function getClubName(club, fallback) {
  return (
    club?.name ||
    club?.clubName ||
    fallback ||
    'Unknown Club'
  );
}


function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.image ||
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
    'Main Stadium'
  );
}


function getClubCapacity(club) {
  return safeNumber(
    club?.stadiumCapacity ??
      club?.capacity ??
      club?.stadium?.capacity,
    30000
  );
}


/* =========================================================
   POSITION NORMALIZATION
========================================================= */

function normalizePosition(position) {
  const value =
    normalize(position);

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
   TEMPORARY PLAYER GENERATOR
========================================================= */

function generateTemporaryPlayer(
  club,
  index
) {
  const positions = [
    'GK',
    'DEF',
    'DEF',
    'DEF',
    'DEF',
    'MID',
    'MID',
    'MID',
    'MID',
    'ATT',
    'ATT',
  ];

  const position =
    positions[
      index % positions.length
    ];

  const base =
    randomBetween(58, 74);

  return {
    id: `temporary-${club?.id || 'club'}-${Date.now()}-${index}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,

    name: `Generated Player ${index + 1}`,

    fullName: `Generated Player ${index + 1}`,

    position,

    primaryPosition:
      position,

    overall: base,

    rating: base,

    age: randomBetween(18, 32),

    nationality:
      club?.country ||
      'International',

    temporary: true,

    clubId:
      club?.id || null,

    clubName:
      getClubName(
        club,
        'Club'
      ),

    photo: null,
  };
}


function generateTemporarySquad(
  club,
  count
) {
  return Array.from(
    {
      length: count,
    },
    (_, index) =>
      generateTemporaryPlayer(
        club,
        index
      )
  );
}


/* =========================================================
   SQUAD PREPARATION
========================================================= */

function prepareSquad(
  players,
  club
) {
  const safePlayers =
    Array.isArray(players)
      ? [...players]
      : [];

  if (
    safePlayers.length >=
    MAX_SQUAD_SIZE
  ) {
    return safePlayers.slice(
      0,
      MAX_SQUAD_SIZE
    );
  }

  const generated =
    generateTemporarySquad(
      club,
      MAX_SQUAD_SIZE -
        safePlayers.length
    );

  return [
    ...safePlayers,
    ...generated,
  ];
}


/* =========================================================
   STARTING XI
========================================================= */

function selectStartingXI(
  squad
) {
  const goalkeepers =
    squad.filter(
      (player) =>
        normalizePosition(
          getPlayerPosition(player)
        ) === 'GK'
    );

  const defenders =
    squad.filter(
      (player) =>
        normalizePosition(
          getPlayerPosition(player)
        ) === 'DEF'
    );

  const midfielders =
    squad.filter(
      (player) =>
        normalizePosition(
          getPlayerPosition(player)
        ) === 'MID'
    );

  const attackers =
    squad.filter(
      (player) =>
        normalizePosition(
          getPlayerPosition(player)
        ) === 'ATT'
    );

  const used = new Set();

  const result = [];

  function addBest(list, count) {
    const sorted = [
      ...list,
    ].sort(
      (a, b) =>
        getPlayerOverall(b) -
        getPlayerOverall(a)
    );

    sorted
      .slice(0, count)
      .forEach((player) => {
        if (
          !used.has(player.id)
        ) {
          used.add(player.id);
          result.push(player);
        }
      });
  }

  addBest(goalkeepers, 1);

  addBest(defenders, 4);

  addBest(midfielders, 4);

  addBest(attackers, 2);

  const remaining =
    squad
      .filter(
        (player) =>
          !used.has(player.id)
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
}


/* =========================================================
   FORMATION POSITIONS
========================================================= */

const FORMATION_POSITIONS = {
  balanced: [
    {
      x: 8,
      y: 50,
    },
    {
      x: 23,
      y: 18,
    },
    {
      x: 23,
      y: 39,
    },
    {
      x: 23,
      y: 61,
    },
    {
      x: 23,
      y: 82,
    },
    {
      x: 42,
      y: 20,
    },
    {
      x: 42,
      y: 42,
    },
    {
      x: 42,
      y: 58,
    },
    {
      x: 42,
      y: 80,
    },
    {
      x: 62,
      y: 36,
    },
    {
      x: 62,
      y: 64,
    },
  ],

  attacking: [
    {
      x: 8,
      y: 50,
    },
    {
      x: 22,
      y: 18,
    },
    {
      x: 22,
      y: 40,
    },
    {
      x: 22,
      y: 60,
    },
    {
      x: 22,
      y: 82,
    },
    {
      x: 40,
      y: 20,
    },
    {
      x: 40,
      y: 50,
    },
    {
      x: 40,
      y: 80,
    },
    {
      x: 59,
      y: 20,
    },
    {
      x: 64,
      y: 50,
    },
    {
      x: 59,
      y: 80,
    },
  ],

  defensive: [
    {
      x: 8,
      y: 50,
    },
    {
      x: 20,
      y: 18,
    },
    {
      x: 20,
      y: 39,
    },
    {
      x: 20,
      y: 61,
    },
    {
      x: 20,
      y: 82,
    },
    {
      x: 38,
      y: 20,
    },
    {
      x: 38,
      y: 42,
    },
    {
      x: 38,
      y: 58,
    },
    {
      x: 38,
      y: 80,
    },
    {
      x: 52,
      y: 38,
    },
    {
      x: 52,
      y: 62,
    },
  ],
};


/* =========================================================
   EVENT TYPES
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


/* =========================================================
   EVENT LABEL
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


/* =========================================================
   EVENT ICON
========================================================= */

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
   COMPONENT
========================================================= */

export default function MatchPage() {
  const router =
    useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const matchId =
    typeof router.query.id ===
    'string'
      ? router.query.id
      : null;


  /* =======================================================
     STATE
  ======================================================= */

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
    useState({
      shots: 0,
      shotsOnTarget: 0,
      possession: 50,
      passes: 0,
      fouls: 0,
      corners: 0,
      offsides: 0,
      yellow: 0,
      red: 0,
    });

  const [awayStats, setAwayStats] =
    useState({
      shots: 0,
      shotsOnTarget: 0,
      possession: 50,
      passes: 0,
      fouls: 0,
      corners: 0,
      offsides: 0,
      yellow: 0,
      red: 0,
    });

  const [mentality, setMentality] =
    useState('balanced');

  const [selectedSubPlayer, setSelectedSubPlayer] =
    useState('');

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

  const [substitutionsUsed, setSubstitutionsUsed] =
    useState(0);

  const [selectedTeam, setSelectedTeam] =
    useState('home');

  const timerRef =
    useRef(null);

  const processedSeconds =
    useRef(new Set());


  /* =======================================================
     DETERMINE USER CLUB
  ======================================================= */

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

        if (
          !snapshot.exists()
        ) {
          return;
        }

        const data =
          snapshot.data();

        const career =
          data.careerData ||
          {};

        const clubId =
          career.currentClub ||
          data.currentClub ||
          data.clubId ||
          null;

        if (!cancelled) {
          setUserClubId(
            clubId
          );
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
  }, [
    user,
    loading,
  ]);


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

        const fixtureRef =
          doc(
            db,
            'fixtures',
            matchId
          );

        const fixtureSnapshot =
          await getDoc(
            fixtureRef
          );

        if (
          !fixtureSnapshot.exists()
        ) {
          toast.error(
            'Match not found'
          );

          router.push(
            '/fixtures'
          );

          return;
        }

        const fixtureData = {
          id:
            fixtureSnapshot.id,
          ...fixtureSnapshot.data(),
        };

        if (cancelled) {
          return;
        }

        setFixture(
          fixtureData
        );

        const homeId =
          fixtureData.homeClubId ||
          fixtureData.homeTeamId ||
          fixtureData.homeId;

        const awayId =
          fixtureData.awayClubId ||
          fixtureData.awayTeamId ||
          fixtureData.awayId;

        if (
          !homeId ||
          !awayId
        ) {
          toast.error(
            'Invalid fixture'
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

        const home = homeSnapshot.exists()
          ? {
              id:
                homeSnapshot.id,
              ...homeSnapshot.data(),
            }
          : {
              id: homeId,
              name:
                fixtureData.homeClubName ||
                'Home',
            };

        const away = awaySnapshot.exists()
          ? {
              id:
                awaySnapshot.id,
              ...awaySnapshot.data(),
            }
          : {
              id: awayId,
              name:
                fixtureData.awayClubName ||
                'Away',
            };

        setHomeClub(home);
        setAwayClub(away);

        const playersSnapshot =
          await getDocs(
            collection(
              db,
              'players'
            )
          );

        const allPlayers =
          playersSnapshot.docs.map(
            (playerDoc) => ({
              id:
                playerDoc.id,
              ...playerDoc.data(),
            })
          );

        const homePlayers =
          allPlayers.filter(
            (player) =>
              String(
                player.clubId ||
                player.currentClub ||
                player.teamId ||
                ''
              ) ===
              String(homeId)
          );

        const awayPlayers =
          allPlayers.filter(
            (player) =>
              String(
                player.clubId ||
                player.currentClub ||
                player.teamId ||
                ''
              ) ===
              String(awayId)
          );

        const preparedHome =
          prepareSquad(
            homePlayers,
            home
          );

        const preparedAway =
          prepareSquad(
            awayPlayers,
            away
          );

        const startingHome =
          selectStartingXI(
            preparedHome
          );

        const startingAway =
          selectStartingXI(
            preparedAway
          );

        setHomeSquad(
          preparedHome
        );

        setAwaySquad(
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
                  starter.id ===
                  player.id
              )
          )
        );

        setAwayBench(
          preparedAway.filter(
            (player) =>
              !startingAway.some(
                (starter) =>
                  starter.id ===
                  player.id
              )
          )
        );

        /*
         * A finished fixture cannot be played again.
         */
        if (
          normalize(
            fixtureData.status
          ) === 'finished' ||
          normalize(
            fixtureData.status
          ) === 'completed'
        ) {
          setMatchStatus(
            'finished'
          );
        } else {
          setMatchStatus(
            'ready'
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
          setLoadingMatch(
            false
          );
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
  ]);


  /* =======================================================
     USER TEAM
  ======================================================= */

  const isHomeUser =
    Boolean(
      userClubId &&
      homeClub?.id &&
      String(userClubId) ===
        String(homeClub.id)
    );

  const isAwayUser =
    Boolean(
      userClubId &&
      awayClub?.id &&
      String(userClubId) ===
        String(awayClub.id)
    );

  const userIsPlaying =
    isHomeUser ||
    isAwayUser;


  /* =======================================================
     ACTIVE USER TEAM
  ======================================================= */

  const userTeam =
    isHomeUser
      ? 'home'
      : isAwayUser
      ? 'away'
      : null;


  /* =======================================================
     START MATCH
  ======================================================= */

  const startMatch =
    useCallback(() => {
      if (
        matchStatus !==
        'ready'
      ) {
        return;
      }

      if (
        !userIsPlaying
      ) {
        toast.error(
          'You are not managing either team in this match.'
        );

        return;
      }

      setMatchStatus(
        'live'
      );

      setPaused(false);

      toast.success(
        'Kick-off!'
      );
    }, [
      matchStatus,
      userIsPlaying,
    ]);


  /* =======================================================
     ADD EVENT
  ======================================================= */

  const addEvent =
    useCallback(
      ({
        type,
        team,
        player,
        text,
      }) => {
        const event = {
          id:
            `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`,

          minute:
            Math.max(
              1,
              matchMinute
            ),

          type,

          team,

          playerId:
            player?.id ||
            null,

          playerName:
            player
              ? getPlayerName(
                  player
                )
              : null,

          text:
            text ||
            `${eventLabel({
              type,
            })}`,
        };

        setEvents(
          (previous) => [
            event,
            ...previous,
          ]
        );
      },
      [matchMinute]
    );


  /* =======================================================
     UPDATE STATS
  ======================================================= */

  const incrementTeamStat =
    useCallback(
      (team, stat) => {
        if (
          team === 'home'
        ) {
          setHomeStats(
            (previous) => ({
              ...previous,
              [stat]:
                safeNumber(
                  previous[stat]
                ) + 1,
            })
          );
        } else {
          setAwayStats(
            (previous) => ({
              ...previous,
              [stat]:
                safeNumber(
                  previous[stat]
                ) + 1,
            })
          );
        }
      },
      []
    );


  /* =======================================================
     CALCULATE TEAM STRENGTH
  ======================================================= */

  const calculateStrength =
    useCallback(
      (team) => {
        const players =
          team === 'home'
            ? homeXI
            : awayXI;

        if (!players.length) {
          return 60;
        }

        const average =
          players.reduce(
            (sum, player) =>
              sum +
              getPlayerOverall(
                player
              ),
            0
          ) /
          players.length;

        let tacticalBonus =
          0;

        if (
          mentality ===
          'attacking'
        ) {
          tacticalBonus =
            team === userTeam
              ? 4
              : 0;
        }

        if (
          mentality ===
          'defensive'
        ) {
          tacticalBonus =
            team === userTeam
              ? 2
              : 0;
        }

        return (
          average +
          tacticalBonus
        );
      },
      [
        homeXI,
        awayXI,
        mentality,
        userTeam,
      ]);


  /* =======================================================
     SIMULATE FOOTBALL EVENT
  ======================================================= */

  const simulateEvent =
    useCallback(() => {
      if (
        matchStatus !==
          'live' ||
        paused
      ) {
        return;
      }

      const second =
        matchMinute;

      if (
        processedSeconds.current.has(
          second
        )
      ) {
        return;
      }

      processedSeconds.current.add(
        second
      );

      const homeStrength =
        calculateStrength(
          'home'
        );

      const awayStrength =
        calculateStrength(
          'away'
        );

      const totalStrength =
        homeStrength +
        awayStrength;

      const homePossession =
        clamp(
          Math.round(
            50 +
              (
                homeStrength -
                awayStrength
              ) *
                0.35
          ),
          35,
          65
        );

      setHomeStats(
        (previous) => ({
          ...previous,
          possession:
            homePossession,
        })
      );

      setAwayStats(
        (previous) => ({
          ...previous,
          possession:
            100 -
            homePossession,
        })
      );

      const attackingTeam =
        Math.random() <
        homePossession / 100
          ? 'home'
          : 'away';

      const attackingPlayers =
        attackingTeam === 'home'
          ? homeXI
          : awayXI;

      const defendingPlayers =
        attackingTeam === 'home'
          ? awayXI
          : homeXI;

      const attacker =
        pick(
          attackingPlayers
        );

      const defender =
        pick(
          defendingPlayers
        );

      if (!attacker) {
        return;
      }

      /*
       * Passes happen frequently.
       */
      if (
        Math.random() <
        0.45
      ) {
        incrementTeamStat(
          attackingTeam,
          'passes'
        );

        return;
      }

      /*
       * Foul.
       */
      if (
        Math.random() <
        0.09
      ) {
        incrementTeamStat(
          attackingTeam ===
            'home'
            ? 'away'
            : 'home',
          'fouls'
        );

        addEvent({
          type:
            EVENT_TYPES.FOUL,

          team:
            attackingTeam ===
            'home'
              ? 'away'
              : 'home',

          player:
            defender,

          text:
            `${getPlayerName(
              defender
            )} commits a foul.`,
        });

        /*
         * Yellow card.
         */
        if (
          Math.random() <
          0.16
        ) {
          incrementTeamStat(
            attackingTeam ===
              'home'
              ? 'away'
              : 'home',
            'yellow'
          );

          addEvent({
            type:
              EVENT_TYPES.YELLOW,

            team:
              attackingTeam ===
              'home'
                ? 'away'
                : 'home',

            player:
              defender,

            text:
              `${getPlayerName(
                defender
              )} is shown a yellow card.`,
          });
        }

        return;
      }

      /*
       * Offside.
       */
      if (
        Math.random() <
        0.045
      ) {
        incrementTeamStat(
          attackingTeam,
          'offsides'
        );

        addEvent({
          type:
            EVENT_TYPES.OFFSIDE,

          team:
            attackingTeam,

          player:
            attacker,

          text:
            `${getPlayerName(
              attacker
            )} is caught offside.`,
        });

        return;
      }

      /*
       * Corner.
       */
      if (
        Math.random() <
        0.065
      ) {
        incrementTeamStat(
          attackingTeam,
          'corners'
        );

        addEvent({
          type:
            EVENT_TYPES.CORNER,

          team:
            attackingTeam,

          player:
            attacker,

          text:
            `${getPlayerName(
              attacker
            )} wins a corner.`,
        });

        return;
      }

      /*
       * Shot.
       */
      if (
        Math.random() <
        0.24
      ) {
        incrementTeamStat(
          attackingTeam,
          'shots'
        );

        const attackStrength =
          attackingTeam ===
          'home'
            ? homeStrength
            : awayStrength;

        const defenseStrength =
          attackingTeam ===
          'home'
            ? awayStrength
            : homeStrength;

        const shotQuality =
          clamp(
            0.08 +
              (
                attackStrength -
                defenseStrength
              ) *
                0.012 +
              (
                getPlayerOverall(
                  attacker
                ) -
                60
              ) *
                0.004,
            0.03,
            0.38
          );

        if (
          Math.random() <
          shotQuality
        ) {
          incrementTeamStat(
            attackingTeam,
            'shotsOnTarget'
          );

          /*
           * Goal.
           */
          const goalChance =
            clamp(
              0.15 +
                (
                  getPlayerOverall(
                    attacker
                  ) -
                  60
                ) *
                  0.008,
              0.08,
              0.32
            );

          if (
            Math.random() <
            goalChance
          ) {
            if (
              attackingTeam ===
              'home'
            ) {
              setHomeScore(
                (score) =>
                  score + 1
              );
            } else {
              setAwayScore(
                (score) =>
                  score + 1
              );
            }

            addEvent({
              type:
                EVENT_TYPES.GOAL,

              team:
                attackingTeam,

              player:
                attacker,

              text:
                `${getPlayerName(
                  attacker
                )} scores!`,
            });

            return;
          }

          /*
           * Save.
           */
          addEvent({
            type:
              EVENT_TYPES.SAVE,

            team:
              attackingTeam ===
              'home'
                ? 'away'
                : 'home',

            player:
              defender,

            text:
              `${getPlayerName(
                defender
              )}'s side survives the shot.`,
          });

          return;
        }

        addEvent({
          type:
            EVENT_TYPES.SHOT,

          team:
            attackingTeam,

          player:
            attacker,

          text:
            `${getPlayerName(
              attacker
            )} takes a shot.`,
        });
      }
    }, [
      matchStatus,
      paused,
      matchMinute,
      calculateStrength,
      homeXI,
      awayXI,
      mentality,
      userTeam,
      incrementTeamStat,
      addEvent,
    ]);


  /* =======================================================
     MATCH CLOCK
  ======================================================= */

  useEffect(() => {
    if (
      matchStatus !==
        'live' ||
      paused
    ) {
      return;
    }

    timerRef.current =
      setInterval(() => {
        setMatchMinute(
          (minute) => {
            const next =
              minute + 1;

            return Math.min(
              next,
              MATCH_DURATION
            );
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
      }
    };
  }, [
    matchStatus,
    paused,
  ]);


  /* =======================================================
     SIMULATE EVENT ON CLOCK
  ======================================================= */

  useEffect(() => {
    if (
      matchStatus !==
      'live'
    ) {
      return;
    }

    simulateEvent();
  }, [
    matchMinute,
    matchStatus,
    simulateEvent,
  ]);


  /* =======================================================
     HALF TIME
  ======================================================= */

  useEffect(() => {
    if (
      matchMinute ===
        FIRST_HALF_END &&
      matchStatus ===
        'live' &&
      !halfTimeShown
    ) {
      setPaused(true);

      setHalfTimeShown(
        true
      );

      addEvent({
        type:
          EVENT_TYPES.SUBSTITUTION,

        team:
          userTeam ||
          'home',

        text:
          'Half-time. The players head to the dressing room.',
      });

      toast(
        'Half-time',
        {
          icon: '⏱️',
        }
      );
    }
  }, [
    matchMinute,
    matchStatus,
    halfTimeShown,
    addEvent,
    userTeam,
  ]);


  /* =======================================================
     RESUME AFTER HALF TIME
  ======================================================= */

  const resumeSecondHalf =
    () => {
      if (
        matchMinute !==
        FIRST_HALF_END
      ) {
        return;
      }

      setPaused(false);
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

        setMatchStatus(
          'finished'
        );

        setPaused(true);

        if (
          timerRef.current
        ) {
          clearInterval(
            timerRef.current
          );
        }

        /*
         * Save only actual match result.
         * Temporary generated players are NOT saved.
         */
        try {
          setSavingMatch(
            true
          );

          const fixtureRef =
            doc(
              db,
              'fixtures',
              matchId
            );

          await updateDoc(
            fixtureRef,
            {
              status:
                'finished',

              result: {
                homeScore,
                awayScore,
              },

              homeScore,
              awayScore,

              finishedAt:
                new Date().toISOString(),

              matchStatistics: {
                home:
                  homeStats,

                away:
                  awayStats,
              },

              events:
                events.map(
                  (event) => ({
                    ...event,
                  })
                ),
            }
          );

          toast.success(
            'Full-time. Match result saved.'
          );
        } catch (error) {
          console.error(
            'Match save error:',
            error
          );

          toast.error(
            'Match finished, but result could not be saved.'
          );
        } finally {
          setSavingMatch(
            false
          );
        }
      },
      [
        matchStatus,
        matchId,
        homeScore,
        awayScore,
        homeStats,
        awayStats,
        events,
      ]);


  /* =======================================================
     FINISH WHEN CLOCK REACHES 20
  ======================================================= */

  useEffect(() => {
    if (
      matchMinute >=
        MATCH_DURATION &&
      matchStatus ===
        'live'
    ) {
      finishMatch();
    }
  }, [
    matchMinute,
    matchStatus,
    finishMatch,
  ]);


  /* =======================================================
     SUBSTITUTE USER PLAYER
  ======================================================= */

  const substitutePlayer =
    () => {
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
          'Select a substitute.'
        );

        return;
      }

      const team =
        userTeam;

      if (!team) {
        return;
      }

      const isHome =
        team === 'home';

      const currentXI =
        isHome
          ? homeXI
          : awayXI;

      const bench =
        isHome
          ? homeBench
          : awayBench;

      const playerOut =
        currentXI[0];

      const playerIn =
        bench.find(
          (player) =>
            String(
              player.id
            ) ===
            String(
              selectedSubPlayer
            )
        );

      if (
        !playerOut ||
        !playerIn
      ) {
        toast.error(
          'Could not complete substitution.'
        );

        return;
      }

      const nextXI =
        currentXI.map(
          (player, index) =>
            index === 0
              ? playerIn
              : player
        );

      const nextBench =
        [
          ...bench.filter(
            (player) =>
              player.id !==
              playerIn.id
          ),
          playerOut,
        ];

      if (isHome) {
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
        (value) =>
          value + 1
      );

      addEvent({
        type:
          EVENT_TYPES.SUBSTITUTION,

        team,

        player:
          playerIn,

        text:
          `${getPlayerName(
            playerIn
          )} comes on.`,
      });

      setSelectedSubPlayer(
        ''
      );

      toast.success(
        'Substitution made.'
      );
    };


  /* =======================================================
     CHANGE MENTALITY
  ======================================================= */

  const changeMentality =
    (value) => {
      setMentality(
        value
      );

      addEvent({
        type:
          EVENT_TYPES.SUBSTITUTION,

        team:
          userTeam ||
          'home',

        text:
          `Tactical mentality changed to ${value}.`,
      });
    };


  /* =======================================================
     PITCH PLAYERS
  ======================================================= */

  const homePositions =
    FORMATION_POSITIONS[
      mentality
    ] ||
    FORMATION_POSITIONS
      .balanced;

  const awayPositions =
    homePositions.map(
      (position) => ({
        x:
          100 -
          position.x,

        y:
          position.y,
      })
    );


  /* =======================================================
     STADIUM
  ======================================================= */

  const stadiumCapacity =
    getClubCapacity(
      homeClub
    );

  const crowd =
    Math.round(
      stadiumCapacity *
        0.7
    );


  /* =======================================================
     SCORE DISPLAY
  ======================================================= */

  const scoreText =
    `${homeScore} - ${awayScore}`;


  /* =======================================================
     CURRENT EVENTS
  ======================================================= */

  const recentEvents =
    useMemo(
      () =>
        events.slice(
          0,
          12
        ),
      [events]
    );


  /* =======================================================
     LOADING SCREEN
  ======================================================= */

  if (
    loading ||
    loadingMatch
  ) {
    return (
      <>
        <Head>
          <title>
            Loading Match
          </title>
        </Head>

        <main
          className={
            styles.loadingPage
          }
        >
          <div
            className={
              styles.loadingBall
            }
          >
            ⚽
          </div>

          <h1>
            Preparing Match
          </h1>

          <p>
            Loading stadium, squads
            and match officials...
          </p>
        </main>
      </>
    );
  }


  /* =======================================================
     NO FIXTURE
  ======================================================= */

  if (
    !fixture ||
    !homeClub ||
    !awayClub
  ) {
    return (
      <main
        className={
          styles.errorPage
        }
      >
        <h1>
          Match unavailable
        </h1>

        <p>
          This fixture could not be
          loaded.
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
          )}{' '}
          | Live Match
        </title>

        <meta
          name="description"
          content="Live football match management."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >

        {/* =================================================
            STADIUM SKY
        ================================================= */}

        <section
          className={
            styles.stadium
          }
        >

          <div
            className={
              styles.sky
            }
          >
            <div
              className={`${styles.cloud} ${styles.cloudOne}`}
            />

            <div
              className={`${styles.cloud} ${styles.cloudTwo}`}
            />

            <div
              className={`${styles.cloud} ${styles.cloudThree}`}
            />
          </div>


          {/* =================================================
              STADIUM LIGHTS
          ================================================= */}

          <div
            className={
              styles.stadiumLights
            }
          >
            <span />
            <span />
            <span />
            <span />
          </div>


          {/* =================================================
              CROWD
          ================================================= */}

          <div
            className={
              styles.crowd
            }
          >
            <div
              className={
                styles.crowdLayer
              }
            >
              {Array.from(
                {
                  length:
                    Math.min(
                      120,
                      Math.max(
                        40,
                        Math.round(
                          crowd /
                            800
                        )
                      )
                    ),
                },
                (_, index) => (
                  <span
                    key={
                      index
                    }
                    style={{
                      animationDelay: `${
                        (
                          index %
                          12
                        ) *
                        0.08
                      }s`,
                    }}
                  >
                    ●
                  </span>
                )
              )}
            </div>
          </div>


          {/* =================================================
              SCOREBOARD
          ================================================= */}

          <div
            className={
              styles.scoreboard
            }
          >

            <div
              className={
                styles.scoreTeam
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
                <span>
                  ⚽
                </span>
              )}

              <strong>
                {getClubName(
                  homeClub
                )}
              </strong>
            </div>


            <div
              className={
                styles.scoreCenter
              }
            >
              <span
                className={
                  styles.matchStatus
                }
              >
                {matchStatus ===
                'live'
                  ? 'LIVE'
                  : matchStatus ===
                    'finished'
                  ? 'FULL TIME'
                  : matchStatus ===
                    'ready'
                  ? 'READY'
                  : 'MATCH'}
              </span>

              <strong
                className={
                  styles.score
                }
              >
                {scoreText}
              </strong>

              <span
                className={
                  styles.clock
                }
              >
                {matchMinute}'
              </span>
            </div>


            <div
              className={
                styles.scoreTeam
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
                <span>
                  ⚽
                </span>
              )}

              <strong>
                {getClubName(
                  awayClub
                )}
              </strong>
            </div>

          </div>


          {/* =================================================
              PITCH
          ================================================= */}

          <div
            className={
              styles.pitchScene
            }
          >

            <div
              className={
                styles.pitch3d
              }
            >

              <div
                className={
                  styles.pitchGrass
                }
              />

              <div
                className={
                  styles.centerLine
                }
              />

              <div
                className={
                  styles.centerCircle
                }
              />

              <div
                className={
                  styles.centerSpot
                }
              />

              <div
                className={
                  styles.homePenalty
                }
              />

              <div
                className={
                  styles.awayPenalty
                }
              />

              <div
                className={
                  styles.homeGoal
                }
              />

              <div
                className={
                  styles.awayGoal
                }
              />


              {/* HOME PLAYERS */}

              {homeXI.map(
                (
                  player,
                  index
                ) => {
                  const position =
                    homePositions[
                      index
                    ] ||
                    homePositions[
                      0
                    ];

                  return (
                    <div
                      key={
                        player.id
                      }
                      className={`${styles.pitchPlayer} ${styles.homePlayer}`}
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                      }}
                    >
                      <div
                        className={
                          styles.playerShadow
                        }
                      />

                      <div
                        className={
                          styles.playerModel
                        }
                        style={{
                          '--jersey': getClubPrimaryColor(
                            homeClub
                          ),

                          '--secondary': getClubSecondaryColor(
                            homeClub
                          ),
                        }}
                      >
                        <span>
                          {index +
                            1}
                        </span>
                      </div>

                      <small>
                        {getPlayerName(
                          player
                        ).split(
                          ' '
                        )[0]}
                      </small>
                    </div>
                  );
                }
              )}


              {/* AWAY PLAYERS */}

              {awayXI.map(
                (
                  player,
                  index
                ) => {
                  const position =
                    awayPositions[
                      index
                    ] ||
                    awayPositions[
                      0
                    ];

                  return (
                    <div
                      key={
                        player.id
                      }
                      className={`${styles.pitchPlayer} ${styles.awayPlayer}`}
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                      }}
                    >
                      <div
                        className={
                          styles.playerShadow
                        }
                      />

                      <div
                        className={
                          styles.playerModel
                        }
                        style={{
                          '--jersey': getClubPrimaryColor(
                            awayClub
                          ),

                          '--secondary': getClubSecondaryColor(
                            awayClub
                          ),
                        }}
                      >
                        <span>
                          {index +
                            1}
                        </span>
                      </div>

                      <small>
                        {getPlayerName(
                          player
                        ).split(
                          ' '
                        )[0]}
                      </small>
                    </div>
                  );
                }
              )}


              {/* BALL */}

              <div
                className={
                  styles.ball
                }
              >
                ⚽
              </div>

            </div>
          </div>


          {/* =================================================
              STADIUM INFORMATION
          ================================================= */}

          <div
            className={
              styles.stadiumInfo
            }
          >
            <span>
              🏟️{' '}
              {getClubStadium(
                homeClub
              )}
            </span>

            <span>
              👥{' '}
              {crowd.toLocaleString()}{' '}
              fans
            </span>

            <span>
              ☁️ Matchday
            </span>
          </div>

        </section>


        {/* =================================================
            CONTROL AREA
        ================================================= */}

        <section
          className={
            styles.controlArea
          }
        >

          {/* =================================================
              MATCH CONTROLS
          ================================================= */}

          <div
            className={
              styles.controlPanel
            }
          >

            <div
              className={
                styles.controlHeader
              }
            >
              <div>
                <span>
                  MATCH CONTROL
                </span>

                <h2>
                  {matchStatus ===
                  'live'
                    ? 'Live Match'
                    : matchStatus ===
                      'finished'
                    ? 'Match Finished'
                    : 'Ready for Kick-off'}
                </h2>
              </div>

              <div
                className={
                  styles.minuteBadge
                }
              >
                {matchMinute}'
              </div>
            </div>


            <div
              className={
                styles.controlButtons
              }
            >

              {matchStatus ===
                'ready' && (
                <button
                  type="button"
                  className={
                    styles.playButton
                  }
                  onClick={
                    startMatch
                  }
                >
                  ▶ Play Match
                </button>
              )}


              {matchStatus ===
                'live' && (
                <button
                  type="button"
                  className={
                    styles.pauseButton
                  }
                  onClick={() =>
                    setPaused(
                      (value) =>
                        !value
                    )
                  }
                >
                  {paused
                    ? '▶ Resume'
                    : 'Ⅱ Pause'}
                </button>
              )}


              {matchMinute ===
                FIRST_HALF_END &&
                matchStatus ===
                  'live' &&
                paused && (
                  <button
                    type="button"
                    className={
                      styles.playButton
                    }
                    onClick={
                      resumeSecondHalf
                    }
                  >
                    ▶ Start 2nd Half
                  </button>
                )}


              {matchStatus ===
                'finished' && (
                <button
                  type="button"
                  className={
                    styles.secondaryButton
                  }
                  onClick={() =>
                    router.push(
                      '/fixtures'
                    )
                  }
                >
                  Back to Fixtures
                </button>
              )}

            </div>

          </div>


          {/* =================================================
              TACTICS
          ================================================= */}

          {userIsPlaying && (
            <section
              className={
                styles.tacticsPanel
              }
            >

              <button
                type="button"
                className={
                  styles.panelToggle
                }
                onClick={() =>
                  setShowTactics(
                    (value) =>
                      !value
                  )
                }
              >
                <span>
                  🧠 Tactics
                </span>

                <strong>
                  {showTactics
                    ? '−'
                    : '+'}
                </strong>
              </button>


              {showTactics && (
                <div
                  className={
                    styles.tacticsContent
                  }
                >

                  <div
                    className={
                      styles.tacticGroup
                    }
                  >
                    <span>
                      Mentality
                    </span>

                    <div
                      className={
                        styles.tacticButtons
                      }
                    >

                      <button
                        type="button"
                        className={
                          mentality ===
                          'defensive'
                            ? styles.selectedTactic
                            : ''
                        }
                        onClick={() =>
                          changeMentality(
                            'defensive'
                          )
                        }
                      >
                        🛡️ Defensive
                      </button>

                      <button
                        type="button"
                        className={
                          mentality ===
                          'balanced'
                            ? styles.selectedTactic
                            : ''
                        }
                        onClick={() =>
                          changeMentality(
                            'balanced'
                          )
                        }
                      >
                        ⚖️ Balanced
                      </button>

                      <button
                        type="button"
                        className={
                          mentality ===
                          'attacking'
                            ? styles.selectedTactic
                            : ''
                        }
                        onClick={() =>
                          changeMentality(
                            'attacking'
                          )
                        }
                      >
                        ⚔️ Attacking
                      </button>

                    </div>
                  </div>

                </div>
              )}

            </section>
          )}


          {/* =================================================
              SUBSTITUTIONS
          ================================================= */}

          {userIsPlaying && (
            <section
              className={
                styles.tacticsPanel
              }
            >

              <button
                type="button"
                className={
                  styles.panelToggle
                }
                onClick={() =>
                  setShowSubs(
                    (value) =>
                      !value
                  )
                }
              >
                <span>
                  🔄 Substitutions
                </span>

                <strong>
                  {substitutionsUsed}/
                  {MAX_SUBSTITUTIONS}
                </strong>
              </button>


              {showSubs && (
                <div
                  className={
                    styles.substitutionContent
                  }
                >

                  <select
                    value={
                      selectedSubPlayer
                    }
                    onChange={(event) =>
                      setSelectedSubPlayer(
                        event.target.value
                      )
                    }
                  >
                    <option value="">
                      Select substitute
                    </option>

                    {(isHomeUser
                      ? homeBench
                      : awayBench
                    ).map(
                      (player) => (
                        <option
                          key={
                            player.id
                          }
                          value={
                            player.id
                          }
                        >
                          {getPlayerName(
                            player
                          )}{' '}
                          ·{' '}
                          {getPlayerPosition(
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


                  <button
                    type="button"
                    className={
                      styles.primaryAction
                    }
                    disabled={
                      matchStatus !==
                        'live' ||
                      substitutionsUsed >=
                        MAX_SUBSTITUTIONS
                    }
                    onClick={
                      substitutePlayer
                    }
                  >
                    Make Substitution
                  </button>

                </div>
              )}

            </section>
          )}


          {/* =================================================
              STATS
          ================================================= */}

          <section
            className={
              styles.statsPanel
            }
          >

            <div
              className={
                styles.statsTitle
              }
            >
              <span>
                📊 MATCH STATISTICS
              </span>
            </div>


            <div
              className={
                styles.statsGrid
              }
            >

              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {homeStats.shots}
                </strong>

                <span>
                  Shots
                </span>

                <strong>
                  {awayStats.shots}
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.shotsOnTarget
                  }
                </strong>

                <span>
                  Shots on target
                </span>

                <strong>
                  {
                    awayStats.shotsOnTarget
                  }
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.possession
                  }%
                </strong>

                <span>
                  Possession
                </span>

                <strong>
                  {
                    awayStats.possession
                  }%
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.passes
                  }
                </strong>

                <span>
                  Passes
                </span>

                <strong>
                  {
                    awayStats.passes
                  }
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.fouls
                  }
                </strong>

                <span>
                  Fouls
                </span>

                <strong>
                  {
                    awayStats.fouls
                  }
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.corners
                  }
                </strong>

                <span>
                  Corners
                </span>

                <strong>
                  {
                    awayStats.corners
                  }
                </strong>
              </div>


              <div
                className={
                  styles.statRow
                }
              >
                <strong>
                  {
                    homeStats.yellow
                  }
                </strong>

                <span>
                  Yellow cards
                </span>

                <strong>
                  {
                    awayStats.yellow
                  }
                </strong>
              </div>

            </div>

          </section>


          {/* =================================================
              EVENTS
          ================================================= */}

          <section
            className={
              styles.eventsPanel
            }
          >

            <button
              type="button"
              className={
                styles.eventsHeader
              }
              onClick={() =>
                setShowEvents(
                  (value) =>
                    !value
                )
              }
            >
              <span>
                📋 Match Events
              </span>

              <strong>
                {events.length}
              </strong>
            </button>


            {showEvents && (
              <div
                className={
                  styles.eventsList
                }
              >

                {recentEvents.length >
                0 ? (
                  recentEvents.map(
                    (event) => (
                      <article
                        key={
                          event.id
                        }
                        className={
                          styles.event
                        }
                      >

                        <time>
                          {event.minute}'
                        </time>

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
                            {event.text}
                          </p>
                        </div>

                      </article>
                    )
                  )
                ) : (
                  <div
                    className={
                      styles.noEvents
                    }
                  >
                    No match events yet.
                  </div>
                )}

              </div>
            )}

          </section>


          {/* =================================================
              MATCH INFORMATION
          ================================================= */}

          <section
            className={
              styles.matchInfo
            }
          >

            <div>
              <span>
                LEAGUE
              </span>

              <strong>
                {fixture.leagueName ||
                  fixture.league ||
                  'League Match'}
              </strong>
            </div>


            <div>
              <span>
                STADIUM
              </span>

              <strong>
                {getClubStadium(
                  homeClub
                )}
              </strong>
            </div>


            <div>
              <span>
                CAPACITY
              </span>

              <strong>
                {stadiumCapacity.toLocaleString()}
              </strong>
            </div>


            <div>
              <span>
                MATCH LENGTH
              </span>

              <strong>
                {MATCH_DURATION}{' '}
                minutes
              </strong>
            </div>

          </section>

        </section>

      </main>
    </>
  );
}
