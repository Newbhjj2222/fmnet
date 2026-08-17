// pages/fixtures.js

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './fixture.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const SEASON_START_MONTHS = [7, 8]; // August / September
const SEASON_END_MONTHS = [4, 5];   // May / June

const FRIENDLY_MONTHS = [6, 7]; // July / August

const MAX_VISIBLE_FIXTURES = 100;

const TRANSFER_WINDOWS = [
  {
    name: 'Summer Transfer Window',
    startMonth: 6,
    startDay: 15,
    endMonth: 8,
    endDay: 1,
  },
  {
    name: 'Winter Transfer Window',
    startMonth: 0,
    startDay: 1,
    endMonth: 0,
    endDay: 31,
  },
];

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getClubId(club) {
  return (
    club?.id ||
    club?.clubId ||
    club?.teamId ||
    null
  );
}

function getClubName(club) {
  return (
    club?.name ||
    club?.clubName ||
    club?.teamName ||
    'Unknown Club'
  );
}

function getClubLogo(club) {
  return (
    club?.logo ||
    club?.logoUrl ||
    club?.badge ||
    null
  );
}

function getLeagueId(league) {
  return (
    league?.id ||
    league?.leagueId ||
    null
  );
}

function getLeagueName(league) {
  return (
    league?.name ||
    league?.leagueName ||
    league?.title ||
    'League'
  );
}

function getLeagueCountry(league) {
  return (
    league?.country ||
    league?.countryName ||
    'Unknown Country'
  );
}

function getLeagueClubs(league, clubs) {
  const leagueId = getLeagueId(league);

  return clubs.filter((club) => {
    const clubLeague =
      club?.leagueId ||
      club?.league ||
      club?.competitionId;

    return clubLeague === leagueId;
  });
}

function dateOnly(date) {
  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  );
}

function startOfDay(date = new Date()) {
  const d = new Date(date);

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    0
  );
}

function endOfDay(date = new Date()) {
  const d = new Date(date);

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    23,
    59,
    59,
    999
  );
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function formatDate(date) {
  if (!date) return '-';

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortDate(date) {
  if (!date) return '-';

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

function formatTime(date) {
  if (!date) return '-';

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return '-';
  }

  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMonthYear(date) {
  const d = new Date(date);

  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function sameDay(a, b) {
  if (!a || !b) return false;

  const da = dateOnly(a);
  const db = dateOnly(b);

  return (
    da &&
    db &&
    da.getTime() === db.getTime()
  );
}

function isPast(date) {
  return new Date(date).getTime() < Date.now();
}

function isStarted(date) {
  return new Date(date).getTime() <= Date.now();
}

function isFuture(date) {
  return new Date(date).getTime() > Date.now();
}

function getMatchStatus(match) {
  if (match?.status) {
    return normalize(match.status);
  }

  if (match?.played === true) {
    return 'played';
  }

  if (match?.result) {
    return 'played';
  }

  if (
    match?.homeScore !== undefined &&
    match?.awayScore !== undefined
  ) {
    return 'played';
  }

  if (
    match?.scheduledAt &&
    isStarted(match.scheduledAt)
  ) {
    return 'ready';
  }

  return 'scheduled';
}

function isPlayed(match) {
  return (
    getMatchStatus(match) === 'played' ||
    match?.played === true
  );
}

function isMatchReady(match) {
  return (
    !isPlayed(match) &&
    !!match?.scheduledAt &&
    isStarted(match.scheduledAt)
  );
}

function getOpponent(match, clubId) {
  if (
    match.homeClubId === clubId
  ) {
    return {
      id: match.awayClubId,
      name:
        match.awayClubName ||
        'Away Team',
      logo:
        match.awayClubLogo ||
        null,
      home: false,
    };
  }

  return {
    id: match.homeClubId,
    name:
      match.homeClubName ||
      'Home Team',
    logo:
      match.homeClubLogo ||
      null,
    home: true,
  };
}

function getMatchResult(match, clubId) {
  if (
    match.homeScore === undefined ||
    match.awayScore === undefined
  ) {
    return null;
  }

  const homeScore =
    safeNumber(match.homeScore);

  const awayScore =
    safeNumber(match.awayScore);

  if (
    match.homeClubId === clubId
  ) {
    if (homeScore > awayScore) {
      return 'W';
    }

    if (homeScore < awayScore) {
      return 'L';
    }

    return 'D';
  }

  if (awayScore > homeScore) {
    return 'W';
  }

  if (awayScore < homeScore) {
    return 'L';
  }

  return 'D';
}

function resultClass(result) {
  switch (result) {
    case 'W':
      return styles.win;

    case 'L':
      return styles.loss;

    case 'D':
      return styles.draw;

    default:
      return '';
  }
}

/* =========================================================
   SEASON HELPERS
========================================================= */

function getSeasonStart(year) {
  const randomMonth =
    SEASON_START_MONTHS[
      Math.floor(
        Math.random() *
          SEASON_START_MONTHS.length
      )
    ];

  const month =
    randomMonth === 7 ? 7 : 8;

  const day =
    month === 7
      ? 1 + Math.floor(Math.random() * 25)
      : 1 + Math.floor(Math.random() * 20);

  return new Date(
    year,
    month,
    day,
    18,
    0,
    0
  );
}

function getSeasonEnd(year) {
  const randomMonth =
    SEASON_END_MONTHS[
      Math.floor(
        Math.random() *
          SEASON_END_MONTHS.length
      )
    ];

  const month =
    randomMonth === 4 ? 4 : 5;

  const day =
    month === 4
      ? 10 + Math.floor(Math.random() * 21)
      : 1 + Math.floor(Math.random() * 20);

  return new Date(
    year + 1,
    month,
    day,
    18,
    0,
    0
  );
}

function getCurrentSeasonKey(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (month >= 7) {
    return `${year}/${year + 1}`;
  }

  return `${year - 1}/${year}`;
}

function getSeasonYear(date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();

  return month >= 7
    ? year
    : year - 1;
}

/* =========================================================
   TRANSFER WINDOWS
========================================================= */

function getTransferWindowDates(
  seasonYear
) {
  return [
    {
      name: 'Summer Transfer Window',
      start: new Date(
        seasonYear,
        5,
        15,
        0,
        0,
        0
      ),
      end: new Date(
        seasonYear,
        7,
        31,
        23,
        59,
        59
      ),
    },

    {
      name: 'Winter Transfer Window',
      start: new Date(
        seasonYear + 1,
        0,
        1,
        0,
        0,
        0
      ),
      end: new Date(
        seasonYear + 1,
        0,
        31,
        23,
        59,
        59
      ),
    },
  ];
}

function getActiveTransferWindow(
  date = new Date(),
  seasonYear = getSeasonYear(date)
) {
  const windows =
    getTransferWindowDates(
      seasonYear
    );

  return (
    windows.find(
      (window) =>
        date >= window.start &&
        date <= window.end
    ) || null
  );
}

/* =========================================================
   RANDOM TIME
========================================================= */

function getRandomMatchTime(date) {
  const hours = [
    13,
    15,
    16,
    17,
    18,
    19,
    20,
  ];

  const hour =
    hours[
      Math.floor(
        Math.random() * hours.length
      )
    ];

  const minute =
    Math.random() > 0.5
      ? 0
      : 30;

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0
  );
}

/* =========================================================
   MATCH SCHEDULER
========================================================= */

function createRoundRobin(
  league,
  leagueClubs,
  seasonYear
) {
  if (
    !league ||
    leagueClubs.length < 2
  ) {
    return [];
  }

  const clubsList = [
    ...leagueClubs,
  ];

  if (
    clubsList.length % 2 !== 0
  ) {
    clubsList.push(null);
  }

  const totalTeams =
    clubsList.length;

  const rounds =
    totalTeams - 1;

  const matchesPerRound =
    totalTeams / 2;

  const firstLeg = [];
  const secondLeg = [];

  let rotation = [
    ...clubsList,
  ];

  for (
    let round = 0;
    round < rounds;
    round++
  ) {
    const roundMatches = [];

    for (
      let i = 0;
      i < matchesPerRound;
      i++
    ) {
      const home =
        rotation[i];

      const away =
        rotation[
          totalTeams - 1 - i
        ];

      if (
        home &&
        away
      ) {
        roundMatches.push({
          home,
          away,
        });
      }
    }

    firstLeg.push(
      roundMatches
    );

    rotation = [
      rotation[0],
      rotation[
        totalTeams - 1
      ],
      ...rotation.slice(
        1,
        totalTeams - 1
      ),
    ];
  }

  firstLeg.forEach(
    (roundMatches) => {
      roundMatches.forEach(
        (match) => {
          secondLeg.push({
            home: match.away,
            away: match.home,
          });
        }
      );
    }
  );

  const allRounds = [
    ...firstLeg,
    ...secondLeg,
  ];

  const seasonStart =
    getSeasonStart(
      seasonYear
    );

  const seasonEnd =
    getSeasonEnd(
      seasonYear
    );

  const totalDays =
    Math.max(
      1,
      Math.floor(
        (
          seasonEnd.getTime() -
          seasonStart.getTime()
        ) /
          86400000
      )
    );

  const gap =
    Math.max(
      2,
      Math.floor(
        totalDays /
          allRounds.length
      )
    );

  const matches = [];

  allRounds.forEach(
    (roundMatches, roundIndex) => {
      const baseDate =
        addDays(
          seasonStart,
          roundIndex * gap
        );

      roundMatches.forEach(
        (
          match,
          matchIndex
        ) => {
          const matchDate =
            addDays(
              baseDate,
              matchIndex % 2
            );

          const scheduledAt =
            getRandomMatchTime(
              matchDate
            );

          const homeClub =
            match.home;

          const awayClub =
            match.away;

          matches.push({
            id: `${getLeagueId(
              league
            )}_${seasonYear}_${roundIndex}_${matchIndex}`,

            leagueId:
              getLeagueId(league),

            leagueName:
              getLeagueName(league),

            country:
              getLeagueCountry(
                league
              ),

            season:
              `${seasonYear}/${
                seasonYear + 1
              }`,

            round:
              roundIndex + 1,

            matchday:
              roundIndex + 1,

            type: 'league',

            homeClubId:
              getClubId(homeClub),

            homeClubName:
              getClubName(homeClub),

            homeClubLogo:
              getClubLogo(homeClub),

            awayClubId:
              getClubId(awayClub),

            awayClubName:
              getClubName(awayClub),

            awayClubLogo:
              getClubLogo(awayClub),

            stadium:
              homeClub?.stadium ||
              homeClub?.stadiumName ||
              homeClub?.ground ||
              'Home Stadium',

            scheduledAt:
              scheduledAt.toISOString(),

            status:
              'scheduled',

            played: false,

            homeScore: null,
            awayScore: null,

            createdBy:
              'system',
          });
        }
      );
    }
  );

  return matches;
}

/* =========================================================
   FRIENDLY MATCH
========================================================= */

function createFriendly(
  userClub,
  opponent,
  date
) {
  const scheduledAt =
    getRandomMatchTime(
      date
    );

  return {
    id: `friendly_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`,

    type: 'friendly',

    competition:
      'Pre-Season Friendly',

    leagueId: null,

    leagueName:
      'Pre-Season Friendly',

    country: null,

    season:
      getCurrentSeasonKey(),

    round: null,

    homeClubId:
      getClubId(userClub),

    homeClubName:
      getClubName(userClub),

    homeClubLogo:
      getClubLogo(userClub),

    awayClubId:
      getClubId(opponent),

    awayClubName:
      getClubName(opponent),

    awayClubLogo:
      getClubLogo(opponent),

    stadium:
      userClub?.stadium ||
      userClub?.stadiumName ||
      'Home Stadium',

    scheduledAt:
      scheduledAt.toISOString(),

    status:
      'scheduled',

    played: false,

    homeScore: null,
    awayScore: null,

    createdBy:
      'user',
  };
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [
      leaguesSnapshot,
      clubsSnapshot,
      fixturesSnapshot,
    ] = await Promise.all([
      getDocs(
        collection(
          db,
          'leagues'
        )
      ),

      getDocs(
        collection(
          db,
          'clubs'
        )
      ),

      getDocs(
        collection(
          db,
          'fixtures'
        )
      ),
    ]);

    const leagues =
      leaguesSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    const clubs =
      clubsSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    const fixtures =
      fixturesSnapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data(),
        })
      );

    return {
      props: {
        initialLeagues:
          JSON.parse(
            JSON.stringify(
              leagues
            )
          ),

        initialClubs:
          JSON.parse(
            JSON.stringify(
              clubs
            )
          ),

        initialFixtures:
          JSON.parse(
            JSON.stringify(
              fixtures
            )
          ),
      },
    };
  } catch (error) {
    console.error(
      'Fixtures SSR error:',
      error
    );

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
        initialFixtures: [],
      },
    };
  }
}

/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialLeagues = [],
  initialClubs = [],
  initialFixtures = [],
}) {
  const router = useRouter();

  const {
    user,
    userData,
    loading,
  } = useAuth();

  const [leagues] =
    useState(
      initialLeagues
    );

  const [clubs] =
    useState(
      initialClubs
    );

  const [fixtures, setFixtures] =
    useState(
      initialFixtures
    );

  const [careerData, setCareerData] =
    useState(null);

  const [currentClub, setCurrentClub] =
    useState(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [activeTab, setActiveTab] =
    useState('my');

  const [selectedLeague, setSelectedLeague] =
    useState('all');

  const [selectedDate, setSelectedDate] =
    useState(
      startOfDay()
    );

  const [showFriendlyModal, setShowFriendlyModal] =
    useState(false);

  const [friendlyOpponent, setFriendlyOpponent] =
    useState('');

  const [friendlyDate, setFriendlyDate] =
    useState('');

  const [saving, setSaving] =
    useState(false);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      loadCareer();
    }
  }, [
    user,
    loading,
    router,
  ]);

  /* =======================================================
     LOAD CAREER
  ======================================================= */

  async function loadCareer() {
    try {
      setIsLoading(true);

      const userRef =
        doc(
          db,
          'users',
          user.uid
        );

      const snapshot =
        await getDoc(
          userRef
        );

      if (!snapshot.exists()) {
        setCareerData({});
        return;
      }

      const data =
        snapshot.data();

      const career =
        data.careerData || {};

      setCareerData(career);

      if (
        career.currentClub
      ) {
        const clubSnapshot =
          await getDoc(
            doc(
              db,
              'clubs',
              career.currentClub
            )
          );

        if (
          clubSnapshot.exists()
        ) {
          setCurrentClub({
            id:
              clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error(
        'Career loading error:',
        error
      );

      toast.error(
        'Failed to load career'
      );
    } finally {
      setIsLoading(false);
    }
  }

  /* =======================================================
     CURRENT CLUB
  ======================================================= */

  const currentClubId =
    careerData?.currentClub ||
    currentClub?.id ||
    null;

  /* =======================================================
     CURRENT CLUB FIXTURES
  ======================================================= */

  const myFixtures =
    useMemo(() => {
      if (!currentClubId) {
        return [];
      }

      return fixtures
        .filter(
          (match) =>
            match.homeClubId ===
              currentClubId ||
            match.awayClubId ===
              currentClubId
        )
        .sort(
          (a, b) =>
            new Date(
              a.scheduledAt
            ) -
            new Date(
              b.scheduledAt
            )
        );
    }, [
      fixtures,
      currentClubId,
    ]);

  /* =======================================================
     ALL FIXTURES
  ======================================================= */

  const filteredFixtures =
    useMemo(() => {
      let result = fixtures;

      if (
        selectedLeague !==
        'all'
      ) {
        result =
          result.filter(
            (match) =>
              match.leagueId ===
              selectedLeague
          );
      }

      if (
        activeTab === 'my'
      ) {
        result =
          result.filter(
            (match) =>
              match.homeClubId ===
                currentClubId ||
              match.awayClubId ===
                currentClubId
          );
      }

      if (
        activeTab ===
        'league'
      ) {
        result =
          result.filter(
            (match) =>
              match.type ===
              'league'
          );
      }

      if (
        activeTab ===
        'friendly'
      ) {
        result =
          result.filter(
            (match) =>
              match.type ===
              'friendly'
          );
      }

      return [
        ...result,
      ].sort(
        (a, b) =>
          new Date(
            a.scheduledAt
          ) -
          new Date(
            b.scheduledAt
          )
      );
    }, [
      fixtures,
      selectedLeague,
      activeTab,
      currentClubId,
    ]);

  /* =======================================================
     NEXT MATCH
  ======================================================= */

  const nextMatch =
    useMemo(() => {
      return myFixtures.find(
        (match) =>
          !isPlayed(match)
      ) || null;
    }, [
      myFixtures,
    ]);

  const nextPlayableMatch =
    useMemo(() => {
      return myFixtures.find(
        (match) =>
          !isPlayed(match) &&
          isStarted(
            match.scheduledAt
          )
      ) || null;
    }, [
      myFixtures,
    ]);

  /* =======================================================
     BLOCK ADVANCE
  ======================================================= */

  const matchBlockingAdvance =
    useMemo(() => {
      if (!nextMatch) {
        return null;
      }

      if (
        isStarted(
          nextMatch.scheduledAt
        ) &&
        !isPlayed(nextMatch)
      ) {
        return nextMatch;
      }

      return null;
    }, [
      nextMatch,
    ]);

  /* =======================================================
     TODAY MATCHES
  ======================================================= */

  const selectedDayMatches =
    useMemo(() => {
      return filteredFixtures.filter(
        (match) =>
          sameDay(
            match.scheduledAt,
            selectedDate
          )
      );
    }, [
      filteredFixtures,
      selectedDate,
    ]);

  /* =======================================================
     CALENDAR GROUPS
  ======================================================= */

  const calendarGroups =
    useMemo(() => {
      const groups = {};

      filteredFixtures
        .slice(
          0,
          MAX_VISIBLE_FIXTURES
        )
        .forEach(
          (match) => {
            const key =
              new Date(
                match.scheduledAt
              ).toISOString()
              .slice(0, 10);

            if (!groups[key]) {
              groups[key] = [];
            }

            groups[key].push(
              match
            );
          }
        );

      return Object.entries(
        groups
      ).sort(
        ([a], [b]) =>
          new Date(a) -
          new Date(b)
      );
    }, [
      filteredFixtures,
    ]);

  /* =======================================================
     STATS
  ======================================================= */

  const playedCount =
    myFixtures.filter(
      isPlayed
    ).length;

  const upcomingCount =
    myFixtures.filter(
      (match) =>
        !isPlayed(match)
    ).length;

  const wins =
    myFixtures.filter(
      (match) =>
        getMatchResult(
          match,
          currentClubId
        ) === 'W'
    ).length;

  const draws =
    myFixtures.filter(
      (match) =>
        getMatchResult(
          match,
          currentClubId
        ) === 'D'
    ).length;

  const losses =
    myFixtures.filter(
      (match) =>
        getMatchResult(
          match,
          currentClubId
        ) === 'L'
    ).length;

  /* =======================================================
     GENERATE LEAGUE FIXTURES
  ======================================================= */

  async function generateLeagueFixtures(
    league
  ) {
    if (!league) {
      return;
    }

    const seasonYear =
      getSeasonYear();

    const leagueClubs =
      getLeagueClubs(
        league,
        clubs
      );

    if (
      leagueClubs.length <
      2
    ) {
      toast.error(
        `${getLeagueName(
          league
        )} needs at least 2 clubs`
      );

      return;
    }

    try {
      setSaving(true);

      const generated =
        createRoundRobin(
          league,
          leagueClubs,
          seasonYear
        );

      for (
        const match of generated
      ) {
        await setDoc(
          doc(
            db,
            'fixtures',
            match.id
          ),
          match,
          {
            merge: true,
          }
        );
      }

      setFixtures(
        (previous) => {
          const map =
            new Map(
              previous.map(
                (item) => [
                  item.id,
                  item,
                ]
              )
            );

          generated.forEach(
            (item) =>
              map.set(
                item.id,
                item
              )
          );

          return Array.from(
            map.values()
          );
        }
      );

      toast.success(
        `${generated.length} fixtures generated for ${getLeagueName(
          league
        )}`
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not generate fixtures'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     ADVANCE DAY
  ======================================================= */

  async function advanceDay() {
    if (
      matchBlockingAdvance
    ) {
      toast.error(
        `You must play ${getOpponent(
          matchBlockingAdvance,
          currentClubId
        ).name} before advancing`
      );

      setSelectedDate(
        startOfDay(
          matchBlockingAdvance.scheduledAt
        )
      );

      return;
    }

    const nextDay =
      addDays(
        selectedDate,
        1
      );

    setSelectedDate(
      startOfDay(nextDay)
    );

    /*
      IMPORTANT:
      This does NOT mark a match as played.

      A match becomes played only after
      match.js writes the result to Firestore.
    */
  }

  /* =======================================================
     PLAY MATCH
  ======================================================= */

  function playMatch(match) {
    if (!match) {
      return;
    }

    if (isPlayed(match)) {
      toast.error(
        'This match has already been played'
      );

      return;
    }

    if (
      !isStarted(
        match.scheduledAt
      )
    ) {
      toast.error(
        `Match starts on ${formatDate(
          match.scheduledAt
        )} at ${formatTime(
          match.scheduledAt
        )}`
      );

      return;
    }

    if (
      match.homeClubId !==
        currentClubId &&
      match.awayClubId !==
        currentClubId
    ) {
      toast.error(
        'This is not your club match'
      );

      return;
    }

    router.push(
      `/match?id=${encodeURIComponent(
        match.id
      )}`
    );
  }

  /* =======================================================
     FRIENDLY
  ======================================================= */

  async function createFriendlyMatch() {
    if (
      !currentClub ||
      !friendlyOpponent ||
      !friendlyDate
    ) {
      toast.error(
        'Select an opponent and date'
      );

      return;
    }

    const opponent =
      clubs.find(
        (club) =>
          getClubId(club) ===
          friendlyOpponent
      );

    if (!opponent) {
      toast.error(
        'Opponent not found'
      );

      return;
    }

    if (
      getClubId(opponent) ===
      currentClubId
    ) {
      toast.error(
        'You cannot play against yourself'
      );

      return;
    }

    const date =
      new Date(
        `${friendlyDate}T18:00:00`
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      toast.error(
        'Invalid friendly date'
      );

      return;
    }

    if (
      date <= new Date()
    ) {
      toast.error(
        'Friendly date must be in the future'
      );

      return;
    }

    try {
      setSaving(true);

      const friendly =
        createFriendly(
          currentClub,
          opponent,
          date
        );

      await setDoc(
        doc(
          db,
          'fixtures',
          friendly.id
        ),
        friendly
      );

      setFixtures(
        (previous) => [
          ...previous,
          friendly,
        ]
      );

      setShowFriendlyModal(
        false
      );

      setFriendlyOpponent('');
      setFriendlyDate('');

      toast.success(
        'Friendly match scheduled'
      );
    } catch (error) {
      console.error(
        error
      );

      toast.error(
        'Could not create friendly'
      );
    } finally {
      setSaving(false);
    }
  }

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    isLoading
  ) {
    return (
      <div
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
          Loading fixtures...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     NO CLUB
  ======================================================= */

  if (!currentClubId) {
    return (
      <>
        <Head>
          <title>
            Fixtures | Virtual Football Manager
          </title>
        </Head>

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
            📅
          </div>

          <h1>
            No Club Assigned
          </h1>

          <p>
            Choose a club before managing
            fixtures and match days.
          </p>

          <button
            type="button"
            onClick={() =>
              router.push(
                '/club'
              )
            }
          >
            Choose a Club
          </button>
        </main>
      </>
    );
  }

  /* =======================================================
     TRANSFER WINDOW
  ======================================================= */

  const activeTransferWindow =
    getActiveTransferWindow();

  const seasonKey =
    getCurrentSeasonKey();

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Fixtures |{' '}
          {getClubName(
            currentClub
          )}
        </title>

        <meta
          name="description"
          content="Manage league fixtures, match days, friendlies and your club calendar."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >

        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={
            styles.header
          }
        >
          <div
            className={
              styles.identity
            }
          >
            <div
              className={
                styles.clubLogo
              }
            >
              {getClubLogo(
                currentClub
              ) ? (
                <img
                  src={getClubLogo(
                    currentClub
                  )}
                  alt=""
                />
              ) : (
                '⚽'
              )}
            </div>

            <div>
              <span
                className={
                  styles.eyebrow
                }
              >
                MATCH CENTRE
              </span>

              <h1>
                Fixtures
              </h1>

              <p>
                {getClubName(
                  currentClub
                )}{' '}
                • Season{' '}
                {seasonKey}
              </p>
            </div>
          </div>

          <div
            className={
              styles.headerActions
            }
          >
            <button
              type="button"
              onClick={() =>
                setShowFriendlyModal(
                  true
                )
              }
            >
              ⚽ Pre-Season Friendly
            </button>
          </div>
        </header>

        {/* =================================================
            NEXT MATCH HERO
        ================================================= */}

        {nextMatch && (
          <section
            className={
              styles.nextMatch
            }
          >
            <div
              className={
                styles.nextMatchTop
              }
            >
              <div>
                <span
                  className={
                    styles.liveEyebrow
                  }
                >
                  NEXT MATCH
                </span>

                <h2>
                  {nextMatch.type ===
                  'friendly'
                    ? 'Pre-Season Friendly'
                    : nextMatch.leagueName}
                </h2>

                <p>
                  {formatDate(
                    nextMatch.scheduledAt
                  )}{' '}
                  •{' '}
                  {formatTime(
                    nextMatch.scheduledAt
                  )}
                </p>
              </div>

              <span
                className={
                  styles.seasonBadge
                }
              >
                {nextMatch.type ===
                'friendly'
                  ? 'FRIENDLY'
                  : 'LEAGUE'}
              </span>
            </div>

            <div
              className={
                styles.nextTeams
              }
            >
              <div
                className={
                  styles.nextTeam
                }
              >
                <div
                  className={
                    styles.teamLogo
                  }
                >
                  {nextMatch.homeClubLogo ? (
                    <img
                      src={
                        nextMatch.homeClubLogo
                      }
                      alt=""
                    />
                  ) : (
                    '⚽'
                  )}
                </div>

                <strong>
                  {nextMatch.homeClubName}
                </strong>

                <span>
                  HOME
                </span>
              </div>

              <div
                className={
                  styles.vs
                }
              >
                VS
              </div>

              <div
                className={
                  styles.nextTeam
                }
              >
                <div
                  className={
                    styles.teamLogo
                  }
                >
                  {nextMatch.awayClubLogo ? (
                    <img
                      src={
                        nextMatch.awayClubLogo
                      }
                      alt=""
                    />
                  ) : (
                    '⚽'
                  )}
                </div>

                <strong>
                  {nextMatch.awayClubName}
                </strong>

                <span>
                  AWAY
                </span>
              </div>
            </div>

            <div
              className={
                styles.nextMatchInfo
              }
            >
              <span>
                🏟️{' '}
                {nextMatch.stadium ||
                  'Stadium TBA'}
              </span>

              <span>
                🕒{' '}
                {formatTime(
                  nextMatch.scheduledAt
                )}
              </span>
            </div>

            <div
              className={
                styles.nextMatchAction
              }
            >
              {isPlayed(
                nextMatch
              ) ? (
                <button
                  type="button"
                  disabled
                >
                  Match Played
                </button>
              ) : isStarted(
                  nextMatch.scheduledAt
                ) ? (
                <button
                  type="button"
                  className={
                    styles.playButton
                  }
                  onClick={() =>
                    playMatch(
                      nextMatch
                    )
                  }
                >
                  ▶ Play Match
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDate(
                      startOfDay(
                        nextMatch.scheduledAt
                      )
                    )
                  }
                >
                  📅 Match Day
                </button>
              )}
            </div>

            {!isStarted(
              nextMatch.scheduledAt
            ) && (
              <div
                className={
                  styles.waitingNotice
                }
              >
                <span>
                  🔒 Match not started
                </span>

                <p>
                  You cannot play or skip this
                  match until its scheduled time.
                </p>
              </div>
            )}
          </section>
        )}

        {/* =================================================
            STATS
        ================================================= */}

        <section
          className={
            styles.stats
          }
        >
          <div
            className={
              styles.statCard
            }
          >
            <span>
              📅
            </span>

            <div>
              <small>
                UPCOMING
              </small>

              <strong>
                {upcomingCount}
              </strong>

              <p>
                Matches remaining
              </p>
            </div>
          </div>

          <div
            className={
              styles.statCard
            }
          >
            <span>
              ▶️
            </span>

            <div>
              <small>
                PLAYED
              </small>

              <strong>
                {playedCount}
              </strong>

              <p>
                Matches completed
              </p>
            </div>
          </div>

          <div
            className={
              styles.statCard
            }
          >
            <span>
              🟢
            </span>

            <div>
              <small>
                WINS
              </small>

              <strong>
                {wins}
              </strong>

              <p>
                League & friendly wins
              </p>
            </div>
          </div>

          <div
            className={
              styles.statCard
            }
          >
            <span>
              📊
            </span>

            <div>
              <small>
                RECORD
              </small>

              <strong>
                {wins}-{draws}-{losses}
              </strong>

              <p>
                W / D / L
              </p>
            </div>
          </div>
        </section>

        {/* =================================================
            TRANSFER WINDOW
        ================================================= */}

        <section
          className={
            styles.seasonBar
          }
        >
          <div>
            <span>
              CURRENT SEASON
            </span>

            <strong>
              {seasonKey}
            </strong>
          </div>

          <div>
            <span>
              TRANSFER STATUS
            </span>

            <strong
              className={
                activeTransferWindow
                  ? styles.transferOpen
                  : styles.transferClosed
              }
            >
              {activeTransferWindow
                ? 'OPEN'
                : 'CLOSED'}
            </strong>
          </div>

          <div>
            <span>
              WINDOW
            </span>

            <strong>
              {activeTransferWindow
                ? activeTransferWindow.name
                : 'No active window'}
            </strong>
          </div>
        </section>

        {/* =================================================
            TABS
        ================================================= */}

        <nav
          className={
            styles.tabs
          }
        >
          <button
            type="button"
            className={
              activeTab === 'my'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'my'
              )
            }
          >
            👥 My Fixtures
          </button>

          <button
            type="button"
            className={
              activeTab === 'league'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'league'
              )
            }
          >
            🏆 Leagues
          </button>

          <button
            type="button"
            className={
              activeTab === 'friendly'
                ? styles.activeTab
                : ''
            }
            onClick={() =>
              setActiveTab(
                'friendly'
              )
            }
          >
            ⚽ Friendlies
          </button>
        </nav>

        {/* =================================================
            FILTER
        ================================================= */}

        <section
          className={
            styles.filters
          }
        >
          <div>
            <label>
              League
            </label>

            <select
              value={
                selectedLeague
              }
              onChange={(event) =>
                setSelectedLeague(
                  event.target.value
                )
              }
            >
              <option value="all">
                All Leagues
              </option>

              {leagues.map(
                (league) => (
                  <option
                    key={
                      league.id
                    }
                    value={
                      league.id
                    }
                  >
                    {getLeagueName(
                      league
                    )}{' '}
                    •{' '}
                    {getLeagueCountry(
                      league
                    )}
                  </option>
                )
              )}
            </select>
          </div>
        </section>

        {/* =================================================
            CALENDAR
        ================================================= */}

        <section
          className={
            styles.calendar
          }
        >
          <div
            className={
              styles.calendarHeader
            }
          >
            <button
              type="button"
              onClick={() =>
                setSelectedDate(
                  addDays(
                    selectedDate,
                    -1
                  )
                )
              }
            >
              ←
            </button>

            <div>
              <span>
                MATCH DAY
              </span>

              <h2>
                {formatDate(
                  selectedDate
                )}
              </h2>
            </div>

            <button
              type="button"
              onClick={() =>
                setSelectedDate(
                  addDays(
                    selectedDate,
                    1
                  )
                )
              }
            >
              →
            </button>
          </div>

          <div
            className={
              styles.calendarDays
            }
          >
            {[
              -2,
              -1,
              0,
              1,
              2,
            ].map(
              (offset) => {
                const date =
                  addDays(
                    selectedDate,
                    offset
                  );

                const hasMatch =
                  filteredFixtures.some(
                    (match) =>
                      sameDay(
                        match.scheduledAt,
                        date
                      )
                  );

                return (
                  <button
                    type="button"
                    key={offset}
                    className={
                      sameDay(
                        date,
                        selectedDate
                      )
                        ? styles.selectedDay
                        : ''
                    }
                    onClick={() =>
                      setSelectedDate(
                        startOfDay(
                          date
                        )
                      )
                    }
                  >
                    <small>
                      {date.toLocaleDateString(
                        'en-US',
                        {
                          weekday:
                            'short',
                        }
                      )}
                    </small>

                    <strong>
                      {date.getDate()}
                    </strong>

                    {hasMatch && (
                      <i />
                    )}
                  </button>
                );
              }
            )}
          </div>
        </section>

        {/* =================================================
            TODAY MATCHES
        ================================================= */}

        <section
          className={
            styles.daySection
          }
        >
          <div
            className={
              styles.sectionTitle
            }
          >
            <div>
              <span>
                {sameDay(
                  selectedDate,
                  new Date()
                )
                  ? 'TODAY'
                  : 'SELECTED DAY'}
              </span>

              <h2>
                {formatMonthYear(
                  selectedDate
                )}
              </h2>
            </div>

            <strong>
              {
                selectedDayMatches.length
              }{' '}
              matches
            </strong>
          </div>

          {selectedDayMatches.length >
          0 ? (
            <div
              className={
                styles.matches
              }
            >
              {selectedDayMatches.map(
                (match) => {
                  const myMatch =
                    match.homeClubId ===
                      currentClubId ||
                    match.awayClubId ===
                      currentClubId;

                  const played =
                    isPlayed(
                      match
                    );

                  const ready =
                    isMatchReady(
                      match
                    );

                  const result =
                    myMatch
                      ? getMatchResult(
                          match,
                          currentClubId
                        )
                      : null;

                  return (
                    <article
                      key={
                        match.id
                      }
                      className={
                        `${styles.matchCard} ${
                          myMatch
                            ? styles.myMatch
                            : ''
                        }`
                      }
                    >
                      <div
                        className={
                          styles.matchMeta
                        }
                      >
                        <span>
                          {match.type ===
                          'friendly'
                            ? 'FRIENDLY'
                            : match.leagueName}
                        </span>

                        <small>
                          {formatTime(
                            match.scheduledAt
                          )}
                        </small>
                      </div>

                      <div
                        className={
                          styles.matchTeams
                        }
                      >
                        <div>
                          <div
                            className={
                              styles.smallLogo
                            }
                          >
                            {match.homeClubLogo ? (
                              <img
                                src={
                                  match.homeClubLogo
                                }
                                alt=""
                              />
                            ) : (
                              '⚽'
                            )}
                          </div>

                          <strong>
                            {
                              match.homeClubName
                            }
                          </strong>
                        </div>

                        <div
                          className={
                            styles.matchScore
                          }
                        >
                          {played ? (
                            <>
                              <strong>
                                {
                                  match.homeScore
                                }
                                {' - '}
                                {
                                  match.awayScore
                                }
                              </strong>

                              {result && (
                                <span
                                  className={
                                    resultClass(
                                      result
                                    )
                                  }
                                >
                                  {result}
                                </span>
                              )}
                            </>
                          ) : (
                            <span>
                              VS
                            </span>
                          )}
                        </div>

                        <div>
                          <div
                            className={
                              styles.smallLogo
                            }
                          >
                            {match.awayClubLogo ? (
                              <img
                                src={
                                  match.awayClubLogo
                                }
                                alt=""
                              />
                            ) : (
                              '⚽'
                            )}
                          </div>

                          <strong>
                            {
                              match.awayClubName
                            }
                          </strong>
                        </div>
                      </div>

                      <div
                        className={
                          styles.matchFooter
                        }
                      >
                        <span>
                          🏟️{' '}
                          {match.stadium ||
                            'Stadium TBA'}
                        </span>

                        {myMatch &&
                          !played &&
                          ready && (
                            <button
                              type="button"
                              className={
                                styles.playSmall
                              }
                              onClick={() =>
                                playMatch(
                                  match
                                )
                              }
                            >
                              ▶ Play Match
                            </button>
                          )}

                        {myMatch &&
                          !played &&
                          !ready && (
                            <span
                              className={
                                styles.locked
                              }
                            >
                              🔒 Not started
                            </span>
                          )}

                        {played && (
                          <span
                            className={
                              styles.resultLabel
                            }
                          >
                            RESULT
                          </span>
                        )}
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          ) : (
            <div
              className={
                styles.noMatches
              }
            >
              <span>
                🗓️
              </span>

              <h3>
                No matches scheduled
              </h3>

              <p>
                There are no fixtures on this
                date.
              </p>
            </div>
          )}
        </section>

        {/* =================================================
            FULL CALENDAR
        ================================================= */}

        <section
          className={
            styles.fullCalendar
          }
        >
          <div
            className={
              styles.sectionTitle
            }
          >
            <div>
              <span>
                SEASON CALENDAR
              </span>

              <h2>
                All Scheduled Fixtures
              </h2>
            </div>
          </div>

          {calendarGroups.length >
          0 ? (
            <div
              className={
                styles.calendarList
              }
            >
              {calendarGroups.map(
                ([
                  dateKey,
                  dayMatches,
                ]) => (
                  <div
                    key={
                      dateKey
                    }
                    className={
                      styles.calendarGroup
                    }
                  >
                    <div
                      className={
                        styles.dateHeading
                      }
                    >
                      <strong>
                        {formatDate(
                          dayMatches[0]
                            .scheduledAt
                        )}
                      </strong>

                      <span>
                        {
                          dayMatches.length
                        }{' '}
                        matches
                      </span>
                    </div>

                    {dayMatches.map(
                      (match) => (
                        <div
                          key={
                            match.id
                          }
                          className={
                            styles.calendarMatch
                          }
                        >
                          <span>
                            {formatTime(
                              match.scheduledAt
                            )}
                          </span>

                          <div>
                            <strong>
                              {
                                match.homeClubName
                              }
                              {' '}
                              vs{' '}
                              {
                                match.awayClubName
                              }
                            </strong>

                            <small>
                              {match.leagueName ||
                                match.type}
                              {' • '}
                              {match.stadium ||
                                'Stadium TBA'}
                            </small>
                          </div>

                          {isPlayed(
                            match
                          ) ? (
                            <strong>
                              {
                                match.homeScore
                              }
                              {' - '}
                              {
                                match.awayScore
                              }
                            </strong>
                          ) : (
                            <span>
                              Upcoming
                            </span>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )
              )}
            </div>
          ) : (
            <div
              className={
                styles.noMatches
              }
            >
              No fixtures generated yet.
            </div>
          )}
        </section>

        {/* =================================================
            ADVANCE DAY
        ================================================= */}

        <section
          className={
            styles.advanceSection
          }
        >
          {matchBlockingAdvance ? (
            <>
              <div
                className={
                  styles.advanceWarning
                }
              >
                <span>
                  🔒
                </span>

                <div>
                  <strong>
                    Match Day Locked
                  </strong>

                  <p>
                    You must play{' '}
                    {
                      matchBlockingAdvance.homeClubName
                    }{' '}
                    vs{' '}
                    {
                      matchBlockingAdvance.awayClubName
                    }{' '}
                    before advancing to another
                    day.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className={
                  styles.playButton
                }
                onClick={() =>
                  playMatch(
                    matchBlockingAdvance
                  )
                }
              >
                ▶ Play Required Match
              </button>
            </>
          ) : (
            <button
              type="button"
              className={
                styles.advanceButton
              }
              onClick={
                advanceDay
              }
            >
              Next Day →
            </button>
          )}
        </section>

        {/* =================================================
            FRIENDLY MODAL
        ================================================= */}

        {showFriendlyModal && (
          <div
            className={
              styles.modalOverlay
            }
            onClick={() =>
              setShowFriendlyModal(
                false
              )
            }
          >
            <div
              className={
                styles.modal
              }
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              <button
                type="button"
                className={
                  styles.close
                }
                onClick={() =>
                  setShowFriendlyModal(
                    false
                  )
                }
              >
                ×
              </button>

              <span
                className={
                  styles.eyebrow
                }
              >
                PRE-SEASON
              </span>

              <h2>
                Arrange Friendly
              </h2>

              <p>
                Prepare your squad before the
                league season begins.
              </p>

              <label>
                Opponent

                <select
                  value={
                    friendlyOpponent
                  }
                  onChange={(event) =>
                    setFriendlyOpponent(
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    Select club
                  </option>

                  {clubs
                    .filter(
                      (club) =>
                        getClubId(
                          club
                        ) !==
                        currentClubId
                    )
                    .map(
                      (club) => (
                        <option
                          key={
                            club.id
                          }
                          value={
                            club.id
                          }
                        >
                          {getClubName(
                            club
                          )}
                        </option>
                      )
                    )}
                </select>
              </label>

              <label>
                Match Date

                <input
                  type="date"
                  value={
                    friendlyDate
                  }
                  onChange={(event) =>
                    setFriendlyDate(
                      event.target.value
                    )
                  }
                />
              </label>

              <div
                className={
                  styles.modalHint
                }
              >
                ⚽ Friendly matches are independent
                from league standings.
              </div>

              <button
                type="button"
                className={
                  styles.primaryButton
                }
                disabled={saving}
                onClick={
                  createFriendlyMatch
                }
              >
                {saving
                  ? 'Scheduling...'
                  : 'Schedule Friendly'}
              </button>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
