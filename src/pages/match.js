// pages/match.js

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './match.module.css';

/* =========================================================
   MATCH CONFIGURATION
========================================================= */

const MATCH_DURATION = 20;
const HALF_DURATION = 10;
const TICK_MS = 1000;

const MAX_SUBSTITUTIONS = 5;
const MAX_SUB_WINDOWS = 3;

const FORMATIONS = {
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

  '4-2-3-1': {
    GK: 1,
    DEF: 4,
    MID: 5,
    ATT: 1,
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
};

const TACTICS = [
  'balanced',
  'attacking',
  'defensive',
  'counter',
  'possession',
];

const TEMPOS = [
  'slow',
  'normal',
  'fast',
];

const PRESSING = [
  'low',
  'medium',
  'high',
];

/* =========================================================
   HELPERS
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

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function random(min = 0, max = 1) {
  return (
    Math.random() *
      (max - min) +
    min
  );
}

function randomInt(min, max) {
  return Math.floor(
    random(min, max + 1)
  );
}

function money(value) {
  return new Intl.NumberFormat(
    'en-US',
    {
      maximumFractionDigits: 0,
    }
  ).format(
    safeNumber(value)
  );
}

function getOverall(player) {
  return safeNumber(
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    60
  );
}

function getPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'MID'
  );
}

function getName(player, index) {
  return (
    player?.name ||
    player?.fullName ||
    `${getPosition(player)} Player ${
      index + 1
    }`
  );
}

function getClubName(club) {
  return (
    club?.name ||
    club?.clubName ||
    'Unknown Club'
  );
}

function getClubColor(club, fallback) {
  return (
    club?.primaryColor ||
    club?.color ||
    club?.kitColor ||
    fallback
  );
}

function getSecondColor(club, fallback) {
  return (
    club?.secondaryColor ||
    club?.accentColor ||
    club?.kitSecondaryColor ||
    fallback
  );
}

function timestampDate(value) {
  if (!value) return null;

  if (
    typeof value?.toDate ===
    'function'
  ) {
    return value.toDate();
  }

  const date = new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function getKickoff(fixture) {
  return (
    fixture?.kickoff ||
    fixture?.dateTime ||
    fixture?.matchDate ||
    fixture?.scheduledAt ||
    null
  );
}

function getTeamId(fixture, side) {
  if (side === 'home') {
    return (
      fixture?.homeClubId ||
      fixture?.homeTeamId ||
      fixture?.home?.id ||
      null
    );
  }

  return (
    fixture?.awayClubId ||
    fixture?.awayTeamId ||
    fixture?.away?.id ||
    null
  );
}

function getTeamName(fixture, side) {
  if (side === 'home') {
    return (
      fixture?.homeClubName ||
      fixture?.homeTeamName ||
      fixture?.home?.name ||
      'Home'
    );
  }

  return (
    fixture?.awayClubName ||
    fixture?.awayTeamName ||
    fixture?.away?.name ||
    'Away'
  );
}

/* =========================================================
   POSITION HELPERS
========================================================= */

function positionGroup(player) {
  const position = normalize(
    getPosition(player)
  );

  if (
    position.includes('goal') ||
    position === 'gk' ||
    position === 'keeper'
  ) {
    return 'GK';
  }

  if (
    position.includes('def') ||
    position === 'cb' ||
    position === 'lb' ||
    position === 'rb' ||
    position === 'lwb' ||
    position === 'rwb'
  ) {
    return 'DEF';
  }

  if (
    position.includes('mid') ||
    position === 'cm' ||
    position === 'dm' ||
    position === 'am' ||
    position === 'lm' ||
    position === 'rm'
  ) {
    return 'MID';
  }

  if (
    position.includes('wing') ||
    position.includes('forward') ||
    position.includes('striker') ||
    position === 'st' ||
    position === 'cf'
  ) {
    return 'ATT';
  }

  return 'MID';
}

/* =========================================================
   TEMPORARY SQUAD GENERATOR
   These players are NEVER written to Firestore.
========================================================= */

function generateTemporaryPlayer(
  teamName,
  index,
  preferredGroup
) {
  const base =
    preferredGroup === 'GK'
      ? randomInt(58, 75)
      : randomInt(55, 74);

  return {
    id: `temporary-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}-${index}`,

    name: `${teamName} Academy ${index + 1}`,

    fullName: `${teamName} Academy ${index + 1}`,

    position:
      preferredGroup === 'GK'
        ? 'GK'
        : preferredGroup === 'DEF'
        ? 'DEF'
        : preferredGroup === 'ATT'
        ? 'ST'
        : 'CM',

    overall: base,

    age: randomInt(18, 25),

    nationality: 'Generated',

    photo: null,

    temporary: true,

    teamName,

    fitness: randomInt(80, 100),

    morale: randomInt(65, 90),

    pace: randomInt(50, 85),

    passing: randomInt(50, 85),

    shooting: randomInt(45, 85),

    defending: randomInt(45, 85),
  };
}

function normalizeSquad(
  players,
  teamName
) {
  const source = Array.isArray(players)
    ? [...players]
    : [];

  const groups = {
    GK: [],
    DEF: [],
    MID: [],
    ATT: [],
  };

  source.forEach((player) => {
    groups[positionGroup(player)].push(
      player
    );
  });

  const target = {
    GK: 3,
    DEF: 7,
    MID: 7,
    ATT: 5,
  };

  let counter = 0;

  Object.entries(target).forEach(
    ([group, count]) => {
      while (
        groups[group].length <
        count
      ) {
        groups[group].push(
          generateTemporaryPlayer(
            teamName,
            counter++,
            group
          )
        );
      }
    }
  );

  return [
    ...groups.GK,
    ...groups.DEF,
    ...groups.MID,
    ...groups.ATT,
  ].slice(0, 25);
}

/* =========================================================
   STARTING XI
========================================================= */

function buildStartingXI(
  squad,
  formation
) {
  const config =
    FORMATIONS[formation] ||
    FORMATIONS['4-3-3'];

  const remaining = [...squad];

  const result = [];

  const groups = {
    GK: [],
    DEF: [],
    MID: [],
    ATT: [],
  };

  remaining.forEach((player) => {
    groups[positionGroup(player)].push(
      player
    );
  });

  Object.entries(config).forEach(
    ([group, amount]) => {
      for (
        let index = 0;
        index < amount;
        index++
      ) {
        if (
          groups[group].length
        ) {
          result.push(
            groups[group].shift()
          );
        }
      }
    }
  );

  while (
    result.length < 11 &&
    remaining.length
  ) {
    const player =
      remaining.find(
        (item) =>
          !result.some(
            (selected) =>
              selected.id === item.id
          )
      );

    if (!player) break;

    result.push(player);
  }

  return result.slice(0, 11);
}

/* =========================================================
   INITIAL PLAYER STATE
========================================================= */

function createPlayerState(
  player
) {
  return {
    ...player,

    matchRating: 6.5,

    fitness: clamp(
      safeNumber(
        player?.fitness,
        100
      ),
      0,
      100
    ),

    yellow: false,

    red: false,

    goals: 0,

    assists: 0,

    shots: 0,

    shotsOnTarget: 0,

    passes: 0,

    successfulPasses: 0,

    fouls: 0,

    saves: 0,

    minutes: 0,
  };
}

/* =========================================================
   ENGINE
========================================================= */

function createInitialEngine(
  homePlayers,
  awayPlayers,
  homeFormation,
  awayFormation
) {
  const homeXI =
    buildStartingXI(
      homePlayers,
      homeFormation
    ).map(createPlayerState);

  const awayXI =
    buildStartingXI(
      awayPlayers,
      awayFormation
    ).map(createPlayerState);

  return {
    minute: 0,

    second: 0,

    phase: 'first-half',

    running: false,

    finished: false,

    homeScore: 0,

    awayScore: 0,

    possession: 50,

    homeStats: {
      shots: 0,
      shotsOnTarget: 0,
      corners: 0,
      fouls: 0,
      offsides: 0,
      yellow: 0,
      red: 0,
      passes: 0,
      successfulPasses: 0,
      possession: 50,
    },

    awayStats: {
      shots: 0,
      shotsOnTarget: 0,
      corners: 0,
      fouls: 0,
      offsides: 0,
      yellow: 0,
      red: 0,
      passes: 0,
      successfulPasses: 0,
      possession: 50,
    },

    homeXI,

    awayXI,

    homeBench:
      homePlayers
        .filter(
          (player) =>
            !homeXI.some(
              (item) =>
                item.id === player.id
            )
        )
        .map(createPlayerState),

    awayBench:
      awayPlayers
        .filter(
          (player) =>
            !awayXI.some(
              (item) =>
                item.id === player.id
            )
        )
        .map(createPlayerState),

    events: [],

    substitutions: {
      home: 0,
      away: 0,
    },

    substitutionWindows: {
      home: 0,
      away: 0,
    },

    lastEvent: null,
  };
}

/* =========================================================
   MATCH EVENTS
========================================================= */

function eventText(event) {
  switch (event.type) {
    case 'goal':
      return `⚽ GOAL! ${event.playerName}`;

    case 'shot':
      return `🎯 ${event.playerName} takes a shot`;

    case 'save':
      return `🧤 ${event.playerName} makes a save`;

    case 'corner':
      return `🚩 Corner kick`;

    case 'yellow':
      return `🟨 Yellow card: ${event.playerName}`;

    case 'red':
      return `🟥 Red card: ${event.playerName}`;

    case 'foul':
      return `⚠️ Foul by ${event.playerName}`;

    case 'offside':
      return `🚩 Offside: ${event.playerName}`;

    case 'substitution':
      return `🔄 ${event.playerOut} replaced by ${event.playerIn}`;

    case 'halftime':
      return '⏸ Half time';

    case 'fulltime':
      return '🏁 Full time';

    default:
      return event.description || 'Match event';
  }
}

/* =========================================================
   SIMULATION
========================================================= */

function simulateTick(
  engine,
  tactics
) {
  const next = {
    ...engine,

    homeStats: {
      ...engine.homeStats,
    },

    awayStats: {
      ...engine.awayStats,
    },

    homeXI:
      engine.homeXI.map(
        (player) => ({
          ...player,
        })
      ),

    awayXI:
      engine.awayXI.map(
        (player) => ({
          ...player,
        })
      ),

    events: [...engine.events],

    substitutions: {
      ...engine.substitutions,
    },

    substitutionWindows: {
      ...engine.substitutionWindows,
    },
  };

  next.second += 1;

  if (
    next.second >= 60
  ) {
    next.minute +=
      Math.floor(
        next.second / 60
      );

    next.second %= 60;
  }

  if (
    next.minute >=
    MATCH_DURATION
  ) {
    next.finished = true;
    next.running = false;
    next.phase = 'full-time';

    next.events.push({
      id: `event-${Date.now()}`,

      minute:
        MATCH_DURATION,

      type: 'fulltime',

      description:
        'Full time',
    });

    next.lastEvent =
      'Full time';

    return next;
  }

  if (
    next.minute ===
      HALF_DURATION &&
    next.phase ===
      'first-half'
  ) {
    next.phase = 'second-half';

    next.events.push({
      id: `event-${Date.now()}`,

      minute: HALF_DURATION,

      type: 'halftime',

      description:
        'Half time',
    });

    next.lastEvent =
      'Half time';

    return next;
  }

  const homeTactic =
    tactics.home;

  const awayTactic =
    tactics.away;

  const homeStrength =
    next.homeXI.reduce(
      (sum, player) =>
        sum +
        getOverall(player) *
          (player.fitness / 100),
      0
    ) /
    Math.max(
      1,
      next.homeXI.length
    );

  const awayStrength =
    next.awayXI.reduce(
      (sum, player) =>
        sum +
        getOverall(player) *
          (player.fitness / 100),
      0
    ) /
    Math.max(
      1,
      next.awayXI.length
    );

  let homeChance =
    0.22;

  let awayChance =
    0.22;

  if (
    homeTactic ===
    'attacking'
  ) {
    homeChance += 0.12;
  }

  if (
    awayTactic ===
    'attacking'
  ) {
    awayChance += 0.12;
  }

  if (
    homeTactic ===
    'defensive'
  ) {
    homeChance -= 0.06;
  }

  if (
    awayTactic ===
    'defensive'
  ) {
    awayChance -= 0.06;
  }

  homeChance +=
    (homeStrength -
      awayStrength) *
    0.004;

  awayChance +=
    (awayStrength -
      homeStrength) *
    0.004;

  const total =
    homeChance +
    awayChance;

  const possessionBase =
    50 +
    (homeStrength -
      awayStrength) *
      0.7;

  next.possession =
    clamp(
      possessionBase,
      35,
      65
    );

  next.homeStats.possession =
    Math.round(
      next.possession
    );

  next.awayStats.possession =
    100 -
    next.homeStats.possession;

  const eventRoll =
    random();

  const isHome =
    random() <
    next.possession / 100;

  const team =
    isHome
      ? 'home'
      : 'away';

  const teamPlayers =
    isHome
      ? next.homeXI
      : next.awayXI;

  const stats =
    isHome
      ? next.homeStats
      : next.awayStats;

  const activePlayers =
    teamPlayers.filter(
      (player) =>
        !player.red
    );

  if (
    !activePlayers.length
  ) {
    return next;
  }

  const player =
    activePlayers[
      randomInt(
        0,
        activePlayers.length - 1
      )
    ];

  /* PASS */

  stats.passes += randomInt(1, 4);

  stats.successfulPasses +=
    randomInt(
      1,
      stats.passes
    );

  player.passes +=
    randomInt(1, 3);

  player.successfulPasses +=
    randomInt(1, 3);

  /* FATIGUE */

  player.fitness = clamp(
    player.fitness -
      random(
        0.04,
        0.14
      ),
    0,
    100
  );

  player.minutes =
    Math.max(
      player.minutes,
      next.minute
    );

  /* EVENT */

  if (
    eventRoll <
    homeChance *
      0.28
  ) {
    stats.shots += 1;

    player.shots += 1;

    const onTarget =
      random() <
      0.38 +
        getOverall(player) /
          500;

    if (onTarget) {
      stats.shotsOnTarget +=
        1;

      player.shotsOnTarget +=
        1;

      const keeper =
        (
          isHome
            ? next.awayXI
            : next.homeXI
        ).find(
          (item) =>
            positionGroup(item) ===
            'GK'
        );

      const goalChance =
        0.08 +
        getOverall(player) /
          1200;

      if (
        random() <
        goalChance
      ) {
        if (isHome) {
          next.homeScore +=
            1;
        } else {
          next.awayScore +=
            1;
        }

        player.goals += 1;

        player.matchRating +=
          0.65;

        if (keeper) {
          keeper.matchRating -=
            0.25;
        }

        const event = {
          id: `goal-${Date.now()}-${Math.random()}`,

          minute:
            next.minute,

          type: 'goal',

          team,

          playerId:
            player.id,

          playerName:
            getName(
              player,
              0
            ),

          scoreHome:
            next.homeScore,

          scoreAway:
            next.awayScore,

          description:
            `${getName(
              player,
              0
            )} scored`,
        };

        next.events.push(event);

        next.lastEvent =
          eventText(event);

        return next;
      }

      if (keeper) {
        keeper.saves += 1;
        keeper.matchRating +=
          0.08;

        stats.shotsOnTarget +=
          0;

        const event = {
          id: `save-${Date.now()}`,

          minute:
            next.minute,

          type: 'save',

          team:
            isHome
              ? 'away'
              : 'home',

          playerName:
            getName(
              keeper,
              0
            ),

          description:
            'Goalkeeper save',
        };

        next.events.push(event);

        next.lastEvent =
          eventText(event);

        return next;
      }

      const event = {
        id: `shot-${Date.now()}`,

        minute:
          next.minute,

        type: 'shot',

        team,

        playerName:
          getName(
            player,
            0
          ),

        description:
          'Shot on target',
      };

      next.events.push(event);

      next.lastEvent =
        eventText(event);

      return next;
    }

    const event = {
      id: `shot-${Date.now()}`,

      minute:
        next.minute,

      type: 'shot',

      team,

      playerName:
        getName(
          player,
          0
        ),

      description:
        'Shot missed',
    };

    next.events.push(event);

    next.lastEvent =
      eventText(event);

    return next;
  }

  /* CORNER */

  if (
    eventRoll <
    0.13
  ) {
    stats.corners += 1;

    const event = {
      id: `corner-${Date.now()}`,

      minute:
        next.minute,

      type: 'corner',

      team,

      description:
        'Corner kick',
    };

    next.events.push(event);

    next.lastEvent =
      eventText(event);

    return next;
  }

  /* FOUL */

  if (
    eventRoll <
    0.22
  ) {
    stats.fouls += 1;

    player.fouls += 1;

    const cardChance =
      random();

    if (
      cardChance <
      0.12 &&
      !player.yellow
    ) {
      player.yellow = true;

      stats.yellow += 1;

      const event = {
        id: `yellow-${Date.now()}`,

        minute:
          next.minute,

        type: 'yellow',

        team,

        playerName:
          getName(
            player,
            0
          ),

        description:
          'Yellow card',
      };

      next.events.push(event);

      next.lastEvent =
        eventText(event);

      return next;
    }

    if (
      cardChance <
        0.015 &&
      player.yellow
    ) {
      player.red = true;

      stats.red += 1;

      const event = {
        id: `red-${Date.now()}`,

        minute:
          next.minute,

        type: 'red',

        team,

        playerName:
          getName(
            player,
            0
          ),

        description:
          'Second yellow / red card',
      };

      next.events.push(event);

      next.lastEvent =
        eventText(event);

      return next;
    }

    const event = {
      id: `foul-${Date.now()}`,

      minute:
        next.minute,

      type: 'foul',

      team,

      playerName:
        getName(
          player,
          0
        ),

      description:
        'Foul committed',
    };

    next.events.push(event);

    next.lastEvent =
      eventText(event);

    return next;
  }

  /* OFFSIDE */

  if (
    eventRoll <
    0.27
  ) {
    stats.offsides += 1;

    const event = {
      id: `offside-${Date.now()}`,

      minute:
        next.minute,

      type: 'offside',

      team,

      playerName:
        getName(
          player,
          0
        ),

      description:
        'Offside',
    };

    next.events.push(event);

    next.lastEvent =
      eventText(event);

    return next;
  }

  return next;
}

/* =========================================================
   PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [fixture, setFixture] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  const [loadingMatch, setLoadingMatch] =
    useState(true);

  const [error, setError] =
    useState('');

  const [engine, setEngine] =
    useState(null);

  const [started, setStarted] =
    useState(false);

  const [paused, setPaused] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [homeFormation, setHomeFormation] =
    useState('4-3-3');

  const [awayFormation] =
    useState('4-3-3');

  const [homeTactic, setHomeTactic] =
    useState('balanced');

  const [tempo, setTempo] =
    useState('normal');

  const [pressing, setPressing] =
    useState('medium');

  const [selectedPlayer, setSelectedPlayer] =
    useState(null);

  const [showTactics, setShowTactics] =
    useState(false);

  const [showSquad, setShowSquad] =
    useState(false);

  const [currentTime, setCurrentTime] =
    useState(Date.now());

  const engineRef =
    useRef(null);

  /* =======================================================
     LOAD MATCH
  ======================================================= */

  useEffect(() => {
    if (!router.isReady) return;

    if (!loading && !user) {
      router.replace('/login');
      return;
    }

    if (!user) return;

    const matchId =
      router.query.id ||
      router.query.matchId;

    if (!matchId) {
      setError(
        'No match was specified.'
      );

      setLoadingMatch(false);

      return;
    }

    loadMatch(
      String(matchId)
    );
  }, [
    router.isReady,
    router.query.id,
    router.query.matchId,
    user,
    loading,
  ]);

  /* =======================================================
     LOAD FIXTURE + CLUBS + PLAYERS
  ======================================================= */

  const loadMatch =
    async (matchId) => {
      try {
        setLoadingMatch(true);

        setError('');

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
          setError(
            'This fixture does not exist.'
          );

          return;
        }

        const fixtureData = {
          id:
            fixtureSnapshot.id,

          ...fixtureSnapshot.data(),
        };

        const kickoff =
          timestampDate(
            getKickoff(
              fixtureData
            )
          );

        if (!kickoff) {
          setError(
            'This match has no valid kickoff time.'
          );

          return;
        }

        const homeId =
          getTeamId(
            fixtureData,
            'home'
          );

        const awayId =
          getTeamId(
            fixtureData,
            'away'
          );

        if (
          !homeId ||
          !awayId
        ) {
          setError(
            'The fixture has incomplete team information.'
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

        const homeData =
          homeSnapshot.exists()
            ? {
                id:
                  homeSnapshot.id,
                ...homeSnapshot.data(),
              }
            : {
                id: homeId,
                name:
                  getTeamName(
                    fixtureData,
                    'home'
                  ),
              };

        const awayData =
          awaySnapshot.exists()
            ? {
                id:
                  awaySnapshot.id,
                ...awaySnapshot.data(),
              }
            : {
                id: awayId,
                name:
                  getTeamName(
                    fixtureData,
                    'away'
                  ),
              };

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
              player.clubId ===
                homeId ||
              player.currentClub ===
                homeId ||
              player.teamId ===
                homeId
          );

        const awayPlayers =
          allPlayers.filter(
            (player) =>
              player.clubId ===
                awayId ||
              player.currentClub ===
                awayId ||
              player.teamId ===
                awayId
          );

        const normalizedHome =
          normalizeSquad(
            homePlayers,
            getClubName(
              homeData
            )
          );

        const normalizedAway =
          normalizeSquad(
            awayPlayers,
            getClubName(
              awayData
            )
          );

        const initial =
          createInitialEngine(
            normalizedHome,
            normalizedAway,
            '4-3-3',
            '4-3-3'
          );

        setFixture(
          fixtureData
        );

        setHomeClub(
          homeData
        );

        setAwayClub(
          awayData
        );

        setEngine(initial);

        engineRef.current =
          initial;
      } catch (loadError) {
        console.error(
          'Match loading error:',
          loadError
        );

        setError(
          'Unable to load this match.'
        );
      } finally {
        setLoadingMatch(false);
      }
    };

  /* =======================================================
     CLOCK
  ======================================================= */

  useEffect(() => {
    const interval =
      setInterval(() => {
        setCurrentTime(
          Date.now()
        );
      }, 1000);

    return () =>
      clearInterval(interval);
  }, []);

  const kickoff =
    useMemo(
      () =>
        timestampDate(
          getKickoff(
            fixture
          )
        ),

      [fixture]
    );

  const kickoffReached =
    kickoff &&
    currentTime >=
      kickoff.getTime();

  /* =======================================================
     START MATCH
  ======================================================= */

  const startMatch =
    () => {
      if (!fixture) return;

      if (!kickoffReached) {
        toast.error(
          'Kickoff time has not arrived yet.'
        );

        return;
      }

      if (
        fixture.status ===
        'completed'
      ) {
        toast.error(
          'This match has already been completed.'
        );

        return;
      }

      setStarted(true);

      setPaused(false);

      setEngine(
        (previous) => {
          const next = {
            ...previous,
            running: true,
          };

          engineRef.current =
            next;

          return next;
        }
      );
    };

  /* =======================================================
     PAUSE
  ======================================================= */

  const togglePause =
    () => {
      setPaused(
        (previous) =>
          !previous
      );
    };

  /* =======================================================
     SIMULATION LOOP
  ======================================================= */

  useEffect(() => {
    if (
      !started ||
      paused ||
      !engine ||
      engine.finished
    ) {
      return undefined;
    }

    const interval =
      setInterval(() => {
        setEngine(
          (previous) => {
            if (
              !previous ||
              previous.finished
            ) {
              return previous;
            }

            const next =
              simulateTick(
                previous,
                {
                  home:
                    homeTactic,

                  away:
                    'balanced',
                }
              );

            engineRef.current =
              next;

            if (
              next.finished
            ) {
              setStarted(
                false
              );
            }

            return next;
          }
        );
      }, TICK_MS);

    return () =>
      clearInterval(interval);
  }, [
    started,
    paused,
    engine,
    homeTactic,
    tempo,
    pressing,
  ]);

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  const substitute =
    (team, playerOutId, playerInId) => {
      setEngine(
        (previous) => {
          if (!previous) {
            return previous;
          }

          const used =
            previous.substitutions[
              team
            ];

          if (
            used >=
            MAX_SUBSTITUTIONS
          ) {
            toast.error(
              'Maximum substitutions reached.'
            );

            return previous;
          }

          const startersKey =
            team === 'home'
              ? 'homeXI'
              : 'awayXI';

          const benchKey =
            team === 'home'
              ? 'homeBench'
              : 'awayBench';

          const starters = [
            ...previous[
              startersKey
            ],
          ];

          const bench = [
            ...previous[
              benchKey
            ],
          ];

          const outIndex =
            starters.findIndex(
              (player) =>
                player.id ===
                playerOutId
            );

          const inIndex =
            bench.findIndex(
              (player) =>
                player.id ===
                playerInId
            );

          if (
            outIndex < 0 ||
            inIndex < 0
          ) {
            return previous;
          }

          const playerOut =
            starters[
              outIndex
            ];

          const playerIn =
            bench[
              inIndex
            ];

          starters[
            outIndex
          ] = {
            ...playerIn,

            minutes:
              previous.minute,
          };

          bench[
            inIndex
          ] = playerOut;

          const next = {
            ...previous,

            [startersKey]:
              starters,

            [benchKey]:
              bench,

            substitutions: {
              ...previous.substitutions,

              [team]:
                used + 1,
            },

            events: [
              ...previous.events,

              {
                id: `sub-${Date.now()}`,

                minute:
                  previous.minute,

                type:
                  'substitution',

                team,

                playerOut:
                  getName(
                    playerOut,
                    0
                  ),

                playerIn:
                  getName(
                    playerIn,
                    0
                  ),
              },
            ],

            lastEvent:
              `${getName(
                playerOut,
                0
              )} replaced by ${getName(
                playerIn,
                0
              )}`,
          };

          engineRef.current =
            next;

          toast.success(
            'Substitution made'
          );

          return next;
        }
      );
    };

  /* =======================================================
     CHANGE FORMATION
  ======================================================= */

  const changeFormation =
    (formation) => {
      setHomeFormation(
        formation
      );

      toast.success(
        `Formation changed to ${formation}`
      );
    };

  /* =======================================================
     COMPLETE MATCH
  ======================================================= */

  const completeMatch =
    useCallback(
      async (finalEngine) => {
        if (
          !fixture ||
          !finalEngine ||
          saving
        ) {
          return;
        }

        try {
          setSaving(true);

          const result = {
            homeScore:
              finalEngine.homeScore,

            awayScore:
              finalEngine.awayScore,

            homeStats:
              finalEngine.homeStats,

            awayStats:
              finalEngine.awayStats,

            events:
              finalEngine.events,

            homeFormation,

            awayFormation,

            completedAt:
              new Date().toISOString(),

            duration:
              MATCH_DURATION,
          };

          await updateDoc(
            doc(
              db,
              'fixtures',
              fixture.id
            ),
            {
              status:
                'completed',

              result,

              homeScore:
                finalEngine.homeScore,

              awayScore:
                finalEngine.awayScore,

              completedAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            }
          );

          setFixture(
            (previous) => ({
              ...previous,

              status:
                'completed',

              result,

              homeScore:
                finalEngine.homeScore,

              awayScore:
                finalEngine.awayScore,
            })
          );

          toast.success(
            'Match completed'
          );
        } catch (error) {
          console.error(
            'Match completion error:',
            error
          );

          toast.error(
            'Could not save match result'
          );
        } finally {
          setSaving(false);
        }
      },
      [
        fixture,
        saving,
        homeFormation,
        awayFormation,
      ]
    );

  useEffect(() => {
    if (
      engine?.finished &&
      fixture?.status !==
        'completed'
    ) {
      completeMatch(
        engine
      );
    }
  }, [
    engine,
    fixture,
    completeMatch,
  ]);

  /* =======================================================
     RESULT
  ======================================================= */

  const resultLabel =
    useMemo(() => {
      if (!engine) return '';

      if (
        engine.homeScore >
        engine.awayScore
      ) {
        return 'HOME WIN';
      }

      if (
        engine.awayScore >
        engine.homeScore
      ) {
        return 'AWAY WIN';
      }

      return 'DRAW';
    }, [
      engine,
    ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    loadingMatch
  ) {
    return (
      <div
        className={
          styles.loading
        }
      >
        <div
          className={
            styles.loader
          }
        />

        <p>
          Preparing stadium...
        </p>
      </div>
    );
  }

  /* =======================================================
     ERROR
  ======================================================= */

  if (error) {
    return (
      <>
        <Head>
          <title>
            Match unavailable
          </title>
        </Head>

        <main
          className={
            styles.errorPage
          }
        >
          <div
            className={
              styles.errorIcon
            }
          >
            ⚽
          </div>

          <h1>
            Match unavailable
          </h1>

          <p>
            {error}
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
      </>
    );
  }

  if (
    !fixture ||
    !engine
  ) {
    return null;
  }

  /* =======================================================
     TEAM VISUALS
  ======================================================= */

  const homePrimary =
    getClubColor(
      homeClub,
      '#2563eb'
    );

  const homeSecondary =
    getSecondColor(
      homeClub,
      '#ffffff'
    );

  const awayPrimary =
    getClubColor(
      awayClub,
      '#ef4444'
    );

  const awaySecondary =
    getSecondColor(
      awayClub,
      '#ffffff'
    );

  const clock =
    `${String(
      engine.minute
    ).padStart(
      2,
      '0'
    )}:${String(
      engine.second
    ).padStart(
      2,
      '0'
    )}`;

  const currentEvent =
    engine.events[
      engine.events.length - 1
    ];

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
            SKY
        ================================================= */}

        <div
          className={
            styles.sky
          }
        >
          <div
            className={
              styles.cloud cloudOne
            }
          />

          <div
            className={
              styles.cloud cloudTwo
            }
          />

          <div
            className={
              styles.cloud cloudThree
            }
          />
        </div>


        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={
            styles.topBar
          }
        >
          <button
            type="button"
            onClick={() =>
              router.push(
                '/fixtures'
              )
            }
          >
            ← Fixtures
          </button>

          <div
            className={
              styles.competition
            }
          >
            <strong>
              {fixture.leagueName ||
                fixture.competitionName ||
                'Football Match'}
            </strong>

            <span>
              {fixture.stadium ||
                fixture.venue ||
                'Main Stadium'}
            </span>
          </div>

          <div
            className={
              styles.liveIndicator
            }
          >
            {engine.finished
              ? 'FINAL'
              : started
              ? '● LIVE'
              : 'READY'}
          </div>
        </header>


        {/* =================================================
            SCOREBOARD
        ================================================= */}

        <section
          className={
            styles.scoreboard
          }
        >

          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={
                styles.clubBadge
              }
              style={{
                background:
                  homePrimary,
              }}
            >
              {homeClub?.logo ? (
                <img
                  src={
                    homeClub.logo
                  }
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
          </div>


          <div
            className={
              styles.scoreCenter
            }
          >
            <div
              className={
                styles.matchClock
              }
            >
              {clock}
            </div>

            <div
              className={
                styles.score
              }
            >
              <strong>
                {engine.homeScore}
              </strong>

              <span>
                -
              </span>

              <strong>
                {engine.awayScore}
              </strong>
            </div>

            <small>
              {engine.phase ===
              'first-half'
                ? '1ST HALF'
                : engine.phase ===
                  'second-half'
                ? '2ND HALF'
                : 'FULL TIME'}
            </small>
          </div>


          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={
                styles.clubBadge
              }
              style={{
                background:
                  awayPrimary,
              }}
            >
              {awayClub?.logo ? (
                <img
                  src={
                    awayClub.logo
                  }
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
          </div>

        </section>


        {/* =================================================
            3D STADIUM
        ================================================= */}

        <section
          className={
            styles.stadium
          }
        >

          <div
            className={
              styles.stadiumRoof
            }
          />

          <div
            className={
              styles.stands
            }
          >
            <div />
            <div />
            <div />
            <div />
          </div>


          <div
            className={
              styles.pitch3d
            }
          >

            <div
              className={
                styles.pitchLine
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
                styles.penaltyBoxLeft
              }
            />

            <div
              className={
                styles.penaltyBoxRight
              }
            />

            <div
              className={
                styles.goalLeft
              }
            />

            <div
              className={
                styles.goalRight
              }
            />


            {/* HOME PLAYERS */}

            <div
              className={
                styles.homePlayers
              }
            >
              {engine.homeXI.map(
                (
                  player,
                  index
                ) => (
                  <div
                    key={
                      player.id
                    }
                    className={`${styles.pitchPlayer} ${
                      player.red
                        ? styles.sentOff
                        : ''
                    }`}
                    style={{
                      '--x':
                        `${
                          12 +
                          (index %
                            5) *
                            18
                        }%`,

                      '--y':
                        `${
                          18 +
                          Math.floor(
                            index /
                              5
                          ) *
                            22
                        }%`,

                      '--kit':
                        homePrimary,

                      '--kit2':
                        homeSecondary,
                    }}
                    onClick={() =>
                      setSelectedPlayer(
                        player
                      )
                    }
                  >
                    <span
                      className={
                        styles.playerHead
                      }
                    />

                    <span
                      className={
                        styles.playerBody
                      }
                    />

                    <small>
                      {getName(
                        player,
                        index
                      ).slice(
                        0,
                        10
                      )}
                    </small>
                  </div>
                )
              )}
            </div>


            {/* AWAY PLAYERS */}

            <div
              className={
                styles.awayPlayers
              }
            >
              {engine.awayXI.map(
                (
                  player,
                  index
                ) => (
                  <div
                    key={
                      player.id
                    }
                    className={`${styles.pitchPlayer} ${
                      player.red
                        ? styles.sentOff
                        : ''
                    }`}
                    style={{
                      '--x':
                        `${
                          58 +
                          (index %
                            5) *
                            8
                        }%`,

                      '--y':
                        `${
                          18 +
                          Math.floor(
                            index /
                              5
                          ) *
                            22
                        }%`,

                      '--kit':
                        awayPrimary,

                      '--kit2':
                        awaySecondary,
                    }}
                    onClick={() =>
                      setSelectedPlayer(
                        player
                      )
                    }
                  >
                    <span
                      className={
                        styles.playerHead
                      }
                    />

                    <span
                      className={
                        styles.playerBody
                      }
                    />

                    <small>
                      {getName(
                        player,
                        index
                      ).slice(
                        0,
                        10
                      )}
                    </small>
                  </div>
                )
              )}
            </div>


            <div
              className={
                styles.ball
              }
            >
              ⚽
            </div>

          </div>

        </section>


        {/* =================================================
            MATCH CONTROLS
        ================================================= */}

        <section
          className={
            styles.controlPanel
          }
        >

          {!started &&
            !engine.finished && (
            <button
              type="button"
              className={
                styles.playButton
              }
              disabled={
                !kickoffReached
              }
              onClick={
                startMatch
              }
            >
              ▶ PLAY MATCH
            </button>
          )}


          {started &&
            !engine.finished && (
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


          <button
            type="button"
            onClick={() =>
              setShowTactics(
                (value) =>
                  !value
              )
            }
          >
            ⚙ Tactics
          </button>

          <button
            type="button"
            onClick={() =>
              setShowSquad(
                (value) =>
                  !value
              )
            }
          >
            👥 Squad
          </button>

          <div
            className={
              styles.managerStatus
            }
          >
            <span>
              Tactic
            </span>

            <strong>
              {homeTactic}
            </strong>

            <span>
              Pressing
            </span>

            <strong>
              {pressing}
            </strong>
          </div>

        </section>


        {/* =================================================
            TACTICS
        ================================================= */}

        {showTactics && (
          <section
            className={
              styles.tacticsPanel
            }
          >

            <div>
              <label>
                Formation

                <select
                  value={
                    homeFormation
                  }
                  onChange={(event) =>
                    changeFormation(
                      event.target.value
                    )
                  }
                >
                  {Object.keys(
                    FORMATIONS
                  ).map(
                    (formation) => (
                      <option
                        key={
                          formation
                        }
                        value={
                          formation
                        }
                      >
                        {formation}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>


            <div>
              <label>
                Tactic

                <select
                  value={
                    homeTactic
                  }
                  onChange={(event) =>
                    setHomeTactic(
                      event.target.value
                    )
                  }
                >
                  {TACTICS.map(
                    (tactic) => (
                      <option
                        key={tactic}
                        value={tactic}
                      >
                        {tactic}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>


            <div>
              <label>
                Tempo

                <select
                  value={tempo}
                  onChange={(event) =>
                    setTempo(
                      event.target.value
                    )
                  }
                >
                  {TEMPOS.map(
                    (item) => (
                      <option
                        key={item}
                        value={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>


            <div>
              <label>
                Pressing

                <select
                  value={
                    pressing
                  }
                  onChange={(event) =>
                    setPressing(
                      event.target.value
                    )
                  }
                >
                  {PRESSING.map(
                    (item) => (
                      <option
                        key={item}
                        value={item}
                      >
                        {item}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>

          </section>
        )}


        {/* =================================================
            EVENT + STATS
        ================================================= */}

        <section
          className={
            styles.bottomGrid
          }
        >

          <div
            className={
              styles.eventPanel
            }
          >
            <div
              className={
                styles.panelHeader
              }
            >
              <h2>
                Match Events
              </h2>

              <span>
                {engine.events.length}
              </span>
            </div>

            <div
              className={
                styles.eventList
              }
            >
              {engine.events
                .slice()
                .reverse()
                .slice(0, 20)
                .map(
                  (event) => (
                    <div
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

                      <span>
                        {eventText(
                          event
                        )}
                      </span>
                    </div>
                  )
                )}

              {!engine.events.length && (
                <p
                  className={
                    styles.emptyEvents
                  }
                >
                  Match events will
                  appear here.
                </p>
              )}
            </div>
          </div>


          <div
            className={
              styles.statsPanel
            }
          >
            <div
              className={
                styles.panelHeader
              }
            >
              <h2>
                Match Stats
              </h2>
            </div>

            <StatRow
              label="Possession"
              home={
                engine.homeStats
                  .possession
              }
              away={
                engine.awayStats
                  .possession
              }
              suffix="%"
            />

            <StatRow
              label="Shots"
              home={
                engine.homeStats
                  .shots
              }
              away={
                engine.awayStats
                  .shots
              }
            />

            <StatRow
              label="Shots on target"
              home={
                engine.homeStats
                  .shotsOnTarget
              }
              away={
                engine.awayStats
                  .shotsOnTarget
              }
            />

            <StatRow
              label="Corners"
              home={
                engine.homeStats
                  .corners
              }
              away={
                engine.awayStats
                  .corners
              }
            />

            <StatRow
              label="Fouls"
              home={
                engine.homeStats
                  .fouls
              }
              away={
                engine.awayStats
                  .fouls
              }
            />

            <StatRow
              label="Offsides"
              home={
                engine.homeStats
                  .offsides
              }
              away={
                engine.awayStats
                  .offsides
              }
            />

            <StatRow
              label="Yellow cards"
              home={
                engine.homeStats
                  .yellow
              }
              away={
                engine.awayStats
                  .yellow
              }
            />

            <StatRow
              label="Red cards"
              home={
                engine.homeStats
                  .red
              }
              away={
                engine.awayStats
                  .red
              }
            />
          </div>

        </section>


        {/* =================================================
            SQUAD PANEL
        ================================================= */}

        {showSquad && (
          <section
            className={
              styles.squadPanel
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
                  engine.substitutions
                    .home
                }/{MAX_SUBSTITUTIONS}
              </span>
            </div>

            <div
              className={
                styles.substitutionGrid
              }
            >

              <div>
                <h3>
                  Starting XI
                </h3>

                {engine.homeXI.map(
                  (player) => (
                    <button
                      type="button"
                      key={
                        player.id
                      }
                      className={
                        selectedPlayer?.id ===
                        player.id
                          ? styles.selectedPlayer
                          : ''
                      }
                      onClick={() =>
                        setSelectedPlayer(
                          player
                        )
                      }
                    >
                      <span>
                        {getName(
                          player,
                          0
                        )}
                      </span>

                      <small>
                        {positionGroup(
                          player
                        )}{' '}
                        •{' '}
                        {Math.round(
                          player.fitness
                        )}%
                      </small>
                    </button>
                  )
                )}
              </div>


              <div>
                <h3>
                  Bench
                </h3>

                {engine.homeBench.map(
                  (player) => (
                    <button
                      type="button"
                      key={
                        player.id
                      }
                      onClick={() => {
                        if (
                          !selectedPlayer
                        ) {
                          setSelectedPlayer(
                            player
                          );

                          return;
                        }

                        if (
                          selectedPlayer.id ===
                          player.id
                        ) {
                          return;
                        }

                        substitute(
                          'home',
                          selectedPlayer.id,
                          player.id
                        );

                        setSelectedPlayer(
                          null
                        );
                      }}
                    >
                      <span>
                        {getName(
                          player,
                          0
                        )}
                      </span>

                      <small>
                        {positionGroup(
                          player
                        )}
                      </small>
                    </button>
                  )
                )}
              </div>

            </div>
          </section>
        )}


        {/* =================================================
            SELECTED PLAYER
        ================================================= */}

        {selectedPlayer && (
          <aside
            className={
              styles.playerInspector
            }
          >

            <button
              type="button"
              className={
                styles.closeInspector
              }
              onClick={() =>
                setSelectedPlayer(
                  null
                )
              }
            >
              ×
            </button>

            <div
              className={
                styles.inspectorAvatar
              }
              style={{
                background:
                  selectedPlayer.temporary
                    ? '#475569'
                    : homePrimary,
              }}
            >
              {selectedPlayer.photo ? (
                <img
                  src={
                    selectedPlayer.photo
                  }
                  alt=""
                />
              ) : (
                getName(
                  selectedPlayer,
                  0
                )
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>

            <h2>
              {getName(
                selectedPlayer,
                0
              )}
            </h2>

            <span>
              {positionGroup(
                selectedPlayer
              )}
            </span>

            <div
              className={
                styles.playerMetrics
              }
            >
              <div>
                <small>
                  OVR
                </small>

                <strong>
                  {Math.round(
                    getOverall(
                      selectedPlayer
                    )
                  )}
                </strong>
              </div>

              <div>
                <small>
                  FITNESS
                </small>

                <strong>
                  {Math.round(
                    selectedPlayer.fitness
                  )}
                  %
                </strong>
              </div>

              <div>
                <small>
                  RATING
                </small>

                <strong>
                  {selectedPlayer.matchRating.toFixed(
                    1
                  )}
                </strong>
              </div>
            </div>

            {selectedPlayer.temporary && (
              <small
                className={
                  styles.temporaryBadge
                }
              >
                Temporary match player
              </small>
            )}

          </aside>
        )}


        {/* =================================================
            LAST EVENT
        ================================================= */}

        {engine.lastEvent && (
          <div
            className={
              styles.liveEvent
            }
          >
            {engine.lastEvent}
          </div>
        )}


        {/* =================================================
            FULL TIME
        ================================================= */}

        {engine.finished && (
          <section
            className={
              styles.fullTime
            }
          >

            <span>
              FULL TIME
            </span>

            <h2>
              {engine.homeScore}
              {' - '}
              {engine.awayScore}
            </h2>

            <p>
              {getClubName(
                homeClub
              )}{' '}
              vs{' '}
              {getClubName(
                awayClub
              )}
            </p>

            <strong>
              {resultLabel}
            </strong>

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

          </section>
        )}

      </main>
    </>
  );
}

/* =========================================================
   STAT ROW
========================================================= */

function StatRow({
  label,
  home,
  away,
  suffix = '',
}) {
  return (
    <div
      className={
        styles.statRow
      }
    >
      <strong>
        {home}
        {suffix}
      </strong>

      <span>
        {label}
      </span>

      <strong>
        {away}
        {suffix}
      </strong>
    </div>
  );
}
