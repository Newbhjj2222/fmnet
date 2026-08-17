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
const SEASON_END_MONTHS = [4, 5]; // May / June

const FRIENDLY_MONTHS = [6, 7];

const MAX_LEAGUES = 500;
const MAX_CLUBS = 5000;

const MATCH_DURATION_MINUTES = 105;

const DEFAULT_MATCH_HOUR = 15;

const TRANSFER_WINDOWS = {
  summer: {
    startMonth: 6,
    startDay: 1,
    endMonth: 8,
    endDay: 1,
  },
  winter: {
    startMonth: 0,
    startDay: 1,
    endMonth: 0,
    endDay: 31,
  },
};

/* =========================================================
   SAFE HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function makeDate(year, month, day, hour = 15, minute = 0) {
  const date = new Date(year, month, day, hour, minute, 0, 0);
  return date;
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function startOfDay(date) {
  const d = cloneDate(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = cloneDate(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = cloneDate(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMinutes(date, minutes) {
  const d = cloneDate(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function isoDate(date) {
  const d = cloneDate(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateTimeKey(date) {
  return [
    isoDate(date),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('T');
}

function parseDate(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === 'function') {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(date) {
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatTime(date) {
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function daysBetween(a, b) {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil((startOfDay(b).getTime() - startOfDay(a).getTime()) / oneDay);
}

/* =========================================================
   SEEDED RANDOM
   Same league => same schedule.
========================================================= */

function seededRandom(seed) {
  let value = 0;
  for (let i = 0; i < seed.length; i++) {
    value = (value * 31 + seed.charCodeAt(i)) % 2147483647;
  }

  return function random() {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function shuffle(array, seed) {
  const result = [...array];
  const random = seededRandom(seed);

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/* =========================================================
   LEAGUE HELPERS
========================================================= */

function getLeagueId(club) {
  return club?.leagueId || club?.league || club?.competitionId || null;
}

function getLeagueName(league) {
  return league?.name || league?.leagueName || league?.title || 'Unknown League';
}

function getClubName(club) {
  return club?.name || club?.clubName || club?.shortName || 'Unknown Club';
}

function getClubLogo(club) {
  return club?.logo || club?.logoUrl || club?.badge || '';
}

function getLeagueCountry(league) {
  return league?.country || league?.countryName || league?.nation || 'International';
}

function getLeagueTeams(league, clubs) {
  const ids = league?.clubIds || league?.teamIds || league?.teams || [];

  if (Array.isArray(ids) && ids.length > 0) {
    const normalized = ids
      .map((team) => {
        if (typeof team === 'string') return team;
        return team?.id || team?.clubId || team?.teamId;
      })
      .filter(Boolean);

    const selected = clubs.filter((club) => normalized.includes(club.id));

    if (selected.length > 0) return selected;
  }

  return clubs.filter((club) => getLeagueId(club) === league.id);
}

/* =========================================================
   SEASON CALENDAR
========================================================= */

function randomSeasonStart(year, seed) {
  const random = seededRandom(seed);

  const month = random() > 0.5 ? 7 : 8;
  const maxDay = month === 7 ? 31 : 20;
  const day = 1 + Math.floor(random() * maxDay);

  return makeDate(year, month, day, 14, 0);
}

function randomSeasonEnd(year, seed) {
  const random = seededRandom(`${seed}-end`);

  const month = random() > 0.5 ? 4 : 5;
  const maxDay = month === 4 ? 31 : 20;
  const day = 1 + Math.floor(random() * maxDay);

  return makeDate(year + 1, month, day, 18, 0);
}

function generateSeasonDates(league, seasonYear) {
  const start = randomSeasonStart(seasonYear, league.id);
  let end = randomSeasonEnd(seasonYear, league.id);

  if (end <= start) {
    end = makeDate(seasonYear + 1, 5, 15, 18, 0);
  }

  return { start, end };
}

/* =========================================================
   ROUND ROBIN GENERATOR
========================================================= */

function generateRounds(clubs, leagueId) {
  let teams = shuffle(clubs, `${leagueId}-teams`);

  const isOdd = teams.length % 2 !== 0;

  if (isOdd) {
    teams = [
      ...teams,
      {
        id: `BYE-${leagueId}`,
        name: 'BYE',
        isBye: true,
      },
    ];
  }

  const totalTeams = teams.length;
  const rounds = totalTeams - 1;
  const matchesPerRound = totalTeams / 2;

  const firstHalf = [];
  let rotation = [...teams];

  for (let round = 0; round < rounds; round++) {
    const matches = [];

    for (let i = 0; i < matchesPerRound; i++) {
      const home = rotation[i];
      const away = rotation[totalTeams - 1 - i];

      if (!home.isBye && !away.isBye) {
        matches.push({
          home,
          away,
          round: round + 1,
        });
      }
    }

    firstHalf.push(matches);

    rotation = [
      rotation[0],
      rotation[totalTeams - 1],
      ...rotation.slice(1, totalTeams - 1),
    ];
  }

  const secondHalf = firstHalf.map((matches, index) =>
    matches.map((match) => ({
      home: match.away,
      away: match.home,
      round: rounds + index + 1,
    })),
  );

  return [...firstHalf, ...secondHalf];
}

/* =========================================================
   MATCH TIME
========================================================= */

function getMatchHour(leagueId, round, index) {
  const random = seededRandom(`${leagueId}-${round}-${index}`);

  const hours = [13, 14, 15, 16, 17, 18, 19, 20];
  return hours[Math.floor(random() * hours.length)];
}

/* =========================================================
   STADIUM
========================================================= */

function getStadium(club) {
  return club?.stadium || club?.stadiumName || club?.venue || club?.ground || 'Club Stadium';
}

/* =========================================================
   GENERATE LEAGUE FIXTURES
========================================================= */

function generateLeagueFixtures(league, clubs, seasonYear) {
  const teams = getLeagueTeams(league, clubs);

  if (teams.length < 2) return [];

  const { start, end } = generateSeasonDates(league, seasonYear);

  const rounds = generateRounds(teams, league.id);

  if (rounds.length === 0) return [];

  const interval = Math.max(
    3,
    Math.floor(daysBetween(start, end) / Math.max(rounds.length - 1, 1)),
  );

  const fixtures = [];

  rounds.forEach((roundMatches, roundIndex) => {
    const roundDate = addDays(start, interval * roundIndex);

    roundMatches.forEach((match, matchIndex) => {
      const hour = getMatchHour(league.id, roundIndex + 1, matchIndex);
      const matchDate = makeDate(
        roundDate.getFullYear(),
        roundDate.getMonth(),
        roundDate.getDate(),
        hour,
        0,
      );

      const id = [
        'league',
        league.id,
        seasonYear,
        roundIndex + 1,
        match.home.id,
        match.away.id,
      ].join('_');

      fixtures.push({
        id,
        type: 'league',
        leagueId: league.id,
        leagueName: getLeagueName(league),
        country: getLeagueCountry(league),
        season: `${seasonYear}/${String(seasonYear + 1).slice(-2)}`,
        round: roundIndex + 1,
        homeClubId: match.home.id,
        homeClubName: getClubName(match.home),
        homeLogo: getClubLogo(match.home),
        awayClubId: match.away.id,
        awayClubName: getClubName(match.away),
        awayLogo: getClubLogo(match.away),
        stadium: getStadium(match.home),
        date: matchDate.toISOString(),
        dateKey: dateTimeKey(matchDate),
        status: 'scheduled',
        result: null,
      });
    });
  });

  return fixtures;
}

/* =========================================================
   FRIENDLIES
========================================================= */

function generateFriendlies(club, clubs, seasonYear) {
  if (!club) return [];

  const others = clubs.filter((item) => item.id !== club.id);

  if (others.length === 0) return [];

  const opponents = shuffle(others, `${club.id}-friendlies-${seasonYear}`).slice(
    0,
    Math.min(5, others.length),
  );

  const fixtures = [];
  const start = makeDate(seasonYear, 6, 5, 16, 0);

  opponents.forEach((opponent, index) => {
    const date = addDays(start, index * 5);
    const home = index % 2 === 0 ? club : opponent;
    const away = index % 2 === 0 ? opponent : club;

    fixtures.push({
      id: ['friendly', seasonYear, club.id, opponent.id, index + 1].join('_'),
      type: 'friendly',
      leagueId: null,
      leagueName: 'Pre-Season Friendly',
      country: 'Friendly',
      season: `${seasonYear}/${String(seasonYear + 1).slice(-2)}`,
      round: index + 1,
      homeClubId: home.id,
      homeClubName: getClubName(home),
      homeLogo: getClubLogo(home),
      awayClubId: away.id,
      awayClubName: getClubName(away),
      awayLogo: getClubLogo(away),
      stadium: getStadium(home),
      date: date.toISOString(),
      dateKey: dateTimeKey(date),
      status: 'scheduled',
      result: null,
    });
  });

  return fixtures;
}

/* =========================================================
   TRANSFER WINDOWS
========================================================= */

function generateTransferWindows(seasonYear) {
  return [
    {
      id: `summer-${seasonYear}`,
      name: 'Summer Transfer Window',
      start: makeDate(seasonYear, 6, 1, 0, 0).toISOString(),
      end: makeDate(seasonYear, 8, 1, 23, 59).toISOString(),
      type: 'summer',
    },
    {
      id: `winter-${seasonYear + 1}`,
      name: 'Winter Transfer Window',
      start: makeDate(seasonYear + 1, 0, 1, 0, 0).toISOString(),
      end: makeDate(seasonYear + 1, 0, 31, 23, 59).toISOString(),
      type: 'winter',
    },
  ];
}

/* =========================================================
   MATCH STATUS
========================================================= */

function getMatchState(fixture, now) {
  const start = parseDate(fixture.date);

  if (!start) return 'scheduled';

  const end = addMinutes(start, MATCH_DURATION_MINUTES);

  if (fixture.result || fixture.status === 'finished' || fixture.status === 'played') {
    return 'finished';
  }

  if (now >= end) return 'missed';
  if (now >= start) return 'live';

  return 'upcoming';
}

/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialLeagues = [],
  initialClubs = [],
  initialMatches = [],
}) {
  const router = useRouter();
  const { user, userData, loading } = useAuth();

  const [leagues] = useState(initialLeagues);
  const [clubs] = useState(initialClubs);
  const [savedMatches, setSavedMatches] = useState(initialMatches);

  const [careerData, setCareerData] = useState(null);
  const [currentClub, setCurrentClub] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [activeView, setActiveView] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [now, setNow] = useState(new Date());

  const [showFriendly, setShowFriendly] = useState(false);
  const [friendlyOpponent, setFriendlyOpponent] = useState('');
  const [saving, setSaving] = useState(false);

  /* =======================================================
     REAL-TIME CLOCK
  ======================================================== */

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  /* =======================================================
     AUTH + CAREER
  ======================================================== */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      loadCareer();
    }
  }, [user, loading, router]);

  const loadCareer = async () => {
    try {
      setIsLoading(true);

      const userRef = doc(db, 'users', user.uid);
      const snapshot = await getDoc(userRef);

      if (!snapshot.exists()) {
        setCareerData({});
        return;
      }

      const data = snapshot.data();
      const career = data.careerData || {};
      setCareerData(career);

      if (career.currentClub) {
        const clubSnapshot = await getDoc(doc(db, 'clubs', career.currentClub));

        if (clubSnapshot.exists()) {
          setCurrentClub({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to load fixtures');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     GAME DATE
  ======================================================== */

  const gameDate = useMemo(() => {
    const saved = parseDate(careerData?.currentDate);
    return saved || new Date();
  }, [careerData?.currentDate]);

  /* =======================================================
     SEASON YEAR
  ======================================================== */

  const seasonYear =
    gameDate.getMonth() >= 6 ? gameDate.getFullYear() : gameDate.getFullYear() - 1;

  /* =======================================================
     USER LEAGUES
  ======================================================== */

  const userLeagueIds = useMemo(() => {
    if (!currentClub) return [];

    const leagueId = getLeagueId(currentClub);
    if (leagueId) return [leagueId];

    return [];
  }, [currentClub]);

  /* =======================================================
     GENERATED FIXTURES
  ======================================================== */

  const generatedFixtures = useMemo(() => {
    const fixtures = [];

    leagues
      .slice(0, MAX_LEAGUES)
      .forEach((league) => {
        const teams = getLeagueTeams(league, clubs);

        if (teams.length >= 2) {
          fixtures.push(...generateLeagueFixtures(league, clubs, seasonYear));
        }
      });

    if (currentClub) {
      fixtures.push(...generateFriendlies(currentClub, clubs, seasonYear));
    }

    return fixtures;
  }, [leagues, clubs, currentClub, seasonYear]);

  /* =======================================================
     MERGE SAVED RESULTS
  ======================================================== */

  const allFixtures = useMemo(() => {
    const savedMap = new Map();

    savedMatches.forEach((match) => {
      savedMap.set(match.id, match);
    });

    return generatedFixtures.map((fixture) => {
      const saved = savedMap.get(fixture.id);

      if (!saved) return fixture;

      return {
        ...fixture,
        ...saved,
        result: saved.result || fixture.result,
      };
    });
  }, [generatedFixtures, savedMatches]);

  /* =======================================================
     CUSTOM FRIENDLIES (from careerData)
  ======================================================== */

  const customFriendlies = careerData?.customFriendlies || [];

  const combinedFixtures = useMemo(() => {
    return [...allFixtures, ...customFriendlies];
  }, [allFixtures, customFriendlies]);

  /* =======================================================
     USER TEAM FIXTURES
  ======================================================== */

  const myFixtures = useMemo(() => {
    if (!currentClub?.id) return [];

    return combinedFixtures.filter(
      (fixture) =>
        fixture.homeClubId === currentClub.id ||
        fixture.awayClubId === currentClub.id,
    );
  }, [combinedFixtures, currentClub]);

  /* =======================================================
     NEXT MATCH
  ======================================================== */

  const nextMatch = useMemo(() => {
    const upcoming = myFixtures
      .filter((fixture) => {
        const state = getMatchState(fixture, gameDate);
        return state === 'upcoming';
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return upcoming[0] || null;
  }, [myFixtures, gameDate]);

  /* =======================================================
     NEXT MATCH TODAY
  ======================================================== */

  const todaysMatch = useMemo(() => {
    return myFixtures.find((fixture) => {
      const date = parseDate(fixture.date);
      if (!date) return false;
      return isoDate(date) === isoDate(gameDate);
    });
  }, [myFixtures, gameDate]);

  /* =======================================================
     FILTER
  ======================================================== */

  const visibleFixtures = useMemo(() => {
    let source = activeView === 'my' ? myFixtures : combinedFixtures;

    if (selectedLeague !== 'all') {
      source = source.filter((fixture) => fixture.leagueId === selectedLeague);
    }

    if (selectedDate) {
      source = source.filter((fixture) => {
        const date = parseDate(fixture.date);
        return date && isoDate(date) === selectedDate;
      });
    }

    return [...source].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [activeView, myFixtures, combinedFixtures, selectedLeague, selectedDate]);

  /* =======================================================
     CALENDAR MATCHES
  ======================================================== */

  const calendarFixtures = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    return combinedFixtures.filter((fixture) => {
      const date = parseDate(fixture.date);
      if (!date) return false;
      return date.getFullYear() === year && date.getMonth() === month;
    });
  }, [combinedFixtures, calendarMonth]);

  /* =======================================================
     ADVANCE DAY
  ======================================================== */

  const advanceDay = async () => {
    if (!user || saving) return;

    const current = gameDate;
    const next = addDays(startOfDay(gameDate), 1);

    // Hagarika niba hari umukino utarakinwa uyu munsi
    const blockingMatch = myFixtures.find((fixture) => {
      const date = parseDate(fixture.date);
      if (!date) return false;

      // Umukino uyu munsi gusa
      if (isoDate(date) !== isoDate(current)) return false;

      const state = getMatchState(fixture, current);
      return state === 'upcoming' || state === 'live';
    });

    if (blockingMatch) {
      toast.error('You have an unplayed match today. Play it before advancing.');
      return;
    }

    try {
      setSaving(true);

      const userRef = doc(db, 'users', user.uid);

      await updateDoc(userRef, {
        'careerData.currentDate': next.toISOString(),
        'careerData.updatedAt': serverTimestamp(),
      });

      setCareerData((previous) => ({
        ...previous,
        currentDate: next.toISOString(),
      }));

      setNow(new Date());
      toast.success(`Advanced to ${formatDate(next)}`);
    } catch (error) {
      console.error(error);
      toast.error('Could not advance the day');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     ADVANCE TO KICKOFF
  ======================================================== */

  const advanceToKickoff = async (fixture) => {
    if (!user || saving || !fixture) return;

    const kickoff = parseDate(fixture.date);
    if (!kickoff) return;

    try {
      setSaving(true);

      const userRef = doc(db, 'users', user.uid);

      await updateDoc(userRef, {
        'careerData.currentDate': kickoff.toISOString(),
        'careerData.updatedAt': serverTimestamp(),
      });

      setCareerData((previous) => ({
        ...previous,
        currentDate: kickoff.toISOString(),
      }));

      setNow(new Date());
      toast.success(`Advanced to kickoff: ${formatTime(kickoff)}`);
    } catch (error) {
      console.error(error);
      toast.error('Could not advance to kickoff');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     PLAY MATCH
  ======================================================== */

  const playMatch = (fixture) => {
    if (!fixture) return;

    const state = getMatchState(fixture, gameDate);

    if (state === 'finished') {
      toast.error('This match has already been played.');
      return;
    }

    if (state === 'upcoming') {
      toast.error('This match has not started yet.');
      return;
    }

    if (state === 'missed') {
      toast.error('This match can no longer be played.');
      return;
    }

    router.push(`/match?id=${encodeURIComponent(fixture.id)}`);
  };

  /* =======================================================
     FRIENDLY MATCH
  ======================================================== */

  const createFriendly = async () => {
    if (!currentClub || !friendlyOpponent) {
      toast.error('Choose an opponent');
      return;
    }

    const opponent = clubs.find((club) => club.id === friendlyOpponent);
    if (!opponent) return;

    const friendlyDate = addDays(startOfDay(gameDate), 3);

    const id = [
      'friendly-custom',
      user.uid,
      currentClub.id,
      opponent.id,
      isoDate(friendlyDate),
    ].join('_');

    const fixture = {
      id,
      type: 'friendly',
      leagueId: null,
      leagueName: 'Pre-Season Friendly',
      country: 'Friendly',
      season: `${seasonYear}/${String(seasonYear + 1).slice(-2)}`,
      round: 0,
      homeClubId: currentClub.id,
      homeClubName: getClubName(currentClub),
      homeLogo: getClubLogo(currentClub),
      awayClubId: opponent.id,
      awayClubName: getClubName(opponent),
      awayLogo: getClubLogo(opponent),
      stadium: getStadium(currentClub),
      date: makeDate(
        friendlyDate.getFullYear(),
        friendlyDate.getMonth(),
        friendlyDate.getDate(),
        16,
        0,
      ).toISOString(),
      status: 'scheduled',
      result: null,
      createdBy: user.uid,
    };

    try {
      setSaving(true);

      await updateDoc(doc(db, 'users', user.uid), {
        'careerData.customFriendlies': [
          ...(careerData?.customFriendlies || []),
          fixture,
        ],
        'careerData.updatedAt': serverTimestamp(),
      });

      setCareerData((previous) => ({
        ...previous,
        customFriendlies: [...(previous?.customFriendlies || []), fixture],
      }));

      setShowFriendly(false);
      setFriendlyOpponent('');
      toast.success('Friendly match scheduled');
    } catch (error) {
      console.error(error);
      toast.error('Could not schedule friendly');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     TRANSFER WINDOWS
  ======================================================== */

  const transferWindows = useMemo(
    () => generateTransferWindows(seasonYear),
    [seasonYear],
  );

  const currentTransferWindow = useMemo(() => {
    return transferWindows.find((window) => {
      const start = parseDate(window.start);
      const end = parseDate(window.end);
      return start && end && gameDate >= start && gameDate <= end;
    });
  }, [transferWindows, gameDate]);

  /* =======================================================
     CALENDAR DAYS
  ======================================================== */

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const days = [];

    for (let day = 1; day <= last.getDate(); day++) {
      const date = new Date(year, month, day);

      const fixtures = calendarFixtures.filter((fixture) => {
        const fixtureDate = parseDate(fixture.date);
        return fixtureDate && isoDate(fixtureDate) === isoDate(date);
      });

      days.push({ date, fixtures });
    }

    return { first, days };
  }, [calendarMonth, calendarFixtures]);

  /* =======================================================
     LOADING
  ======================================================== */

  if (loading || isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading fixtures...</p>
      </div>
    );
  }

  if (!user) return null;

  /* =======================================================
     NO CLUB
  ======================================================== */

  if (!currentClub) {
    return (
      <>
        <Head>
          <title>Fixtures | Football Manager</title>
        </Head>
        <main className={styles.emptyPage}>
          <div className={styles.emptyIcon}>⚽</div>
          <h1>No Club Assigned</h1>
          <p>You need a club before managing fixtures and matches.</p>
          <button type="button" onClick={() => router.push('/club')}>
            Choose a Club
          </button>
        </main>
      </>
    );
  }

  /* =======================================================
     RENDER
  ======================================================== */

  return (
    <>
      <Head>
        <title>Fixtures & Calendar | {getClubName(currentClub)}</title>
        <meta
          name="description"
          content="Football fixtures, league schedules, match calendar, friendlies and transfer windows."
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div className={styles.headerIdentity}>
            <div className={styles.clubLogo}>
              {getClubLogo(currentClub) ? (
                <img src={getClubLogo(currentClub)} alt="" />
              ) : (
                '⚽'
              )}
            </div>
            <div>
              <span className={styles.eyebrow}>MATCH CENTRE</span>
              <h1>Fixtures</h1>
              <p>{getClubName(currentClub)}</p>
            </div>
          </div>

          <div className={styles.gameDate}>
            <span>GAME DATE</span>
            <strong>{formatDate(gameDate)}</strong>
          </div>
        </header>

        {/* NEXT MATCH CARD */}
        <section className={styles.nextMatchCard}>
          <div className={styles.nextMatchTop}>
            <div>
              <span>NEXT MATCH</span>
              <h2>{nextMatch ? nextMatch.leagueName : 'No upcoming match'}</h2>
            </div>
            <div className={styles.liveDate}>
              {nextMatch ? formatDate(parseDate(nextMatch.date)) : 'Season calendar'}
            </div>
          </div>

          {nextMatch ? (
            <div className={styles.nextMatchBody}>
              <div className={styles.nextTeam}>
                <div className={styles.teamLogo}>
                  {nextMatch.homeLogo ? (
                    <img src={nextMatch.homeLogo} alt="" />
                  ) : (
                    '⚽'
                  )}
                </div>
                <strong>{nextMatch.homeClubName}</strong>
                <span>HOME</span>
              </div>

              <div className={styles.nextVs}>
                <strong>VS</strong>
                <span>{formatTime(parseDate(nextMatch.date))}</span>
              </div>

              <div className={styles.nextTeam}>
                <div className={styles.teamLogo}>
                  {nextMatch.awayLogo ? (
                    <img src={nextMatch.awayLogo} alt="" />
                  ) : (
                    '⚽'
                  )}
                </div>
                <strong>{nextMatch.awayClubName}</strong>
                <span>AWAY</span>
              </div>
            </div>
          ) : (
            <div className={styles.noNextMatch}>No scheduled match.</div>
          )}

          {nextMatch && (
            <div className={styles.nextMatchActions}>
              {getMatchState(nextMatch, gameDate) === 'upcoming' && (
                <>
                  {daysBetween(gameDate, parseDate(nextMatch.date)) === 0 ? (
                    <button
                      type="button"
                      className={styles.advanceButton}
                      onClick={() => advanceToKickoff(nextMatch)}
                      disabled={saving}
                    >
                      ⏭ Advance to Kickoff ({formatTime(parseDate(nextMatch.date))})
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.advanceButton}
                      onClick={advanceDay}
                      disabled={saving}
                    >
                      ⏭ Advance to Next Day
                    </button>
                  )}

                  <span>
                    Match in {Math.max(0, daysBetween(gameDate, parseDate(nextMatch.date)))}{' '}
                    day(s)
                  </span>
                </>
              )}

              {getMatchState(nextMatch, gameDate) === 'live' && (
                <button
                  type="button"
                  className={styles.playButton}
                  onClick={() => playMatch(nextMatch)}
                >
                  ▶ PLAY MATCH
                </button>
              )}
            </div>
          )}
        </section>

        {/* CONTROL BAR */}
        <section className={styles.controls}>
          <div className={styles.viewTabs}>
            <button
              className={activeView === 'my' ? styles.active : ''}
              onClick={() => setActiveView('my')}
            >
              My Fixtures
            </button>
            <button
              className={activeView === 'all' ? styles.active : ''}
              onClick={() => setActiveView('all')}
            >
              All Leagues
            </button>
          </div>

          <select
            value={selectedLeague}
            onChange={(event) => setSelectedLeague(event.target.value)}
          >
            <option value="all">All Leagues</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {getLeagueName(league)}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </section>

        {/* TRANSFER WINDOW */}
        <section className={styles.transferBar}>
          <div>
            <span>TRANSFER WINDOW</span>
            <strong>{currentTransferWindow ? currentTransferWindow.name : 'Closed'}</strong>
          </div>
          <div>
            <span>STATUS</span>
            <strong className={currentTransferWindow ? styles.openStatus : styles.closedStatus}>
              {currentTransferWindow ? 'OPEN' : 'CLOSED'}
            </strong>
          </div>
          <div>
            <span>NEXT WINDOW</span>
            <strong>
              {transferWindows
                .filter((window) => parseDate(window.start) > gameDate)
                .sort((a, b) => new Date(a.start) - new Date(b.start))[0]?.name || 'None'}
            </strong>
          </div>
        </section>

        {/* CALENDAR */}
        <section className={styles.calendarCard}>
          <div className={styles.calendarHeader}>
            <button
              type="button"
              onClick={() =>
                setCalendarMonth(
                  (previous) => new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
                )
              }
            >
              ‹
            </button>
            <h2>{formatMonth(calendarMonth)}</h2>
            <button
              type="button"
              onClick={() =>
                setCalendarMonth(
                  (previous) => new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
                )
              }
            >
              ›
            </button>
          </div>

          <div className={styles.calendarGrid}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className={styles.weekday}>
                {day}
              </div>
            ))}

            {Array.from({ length: calendarDays.first.getDay() }).map((_, index) => (
              <div key={`empty-${index}`} className={styles.emptyDay} />
            ))}

            {calendarDays.days.map((day) => {
              const isToday = isoDate(day.date) === isoDate(gameDate);

              return (
                <button
                  type="button"
                  key={isoDate(day.date)}
                  className={`${styles.calendarDay} ${isToday ? styles.today : ''}`}
                  onClick={() => setSelectedDate(isoDate(day.date))}
                >
                  <strong>{day.date.getDate()}</strong>
                  {day.fixtures.slice(0, 3).map((fixture) => (
                    <span
                      key={fixture.id}
                      className={
                        fixture.homeClubId === currentClub.id ||
                        fixture.awayClubId === currentClub.id
                          ? styles.myMatchDot
                          : styles.matchDot
                      }
                    />
                  ))}
                </button>
              );
            })}
          </div>
        </section>

        {/* FIXTURE LIST */}
        <section className={styles.fixtureSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>MATCH SCHEDULE</span>
              <h2>{selectedDate ? `Fixtures on ${selectedDate}` : 'Upcoming Fixtures'}</h2>
            </div>
            <strong>{visibleFixtures.length} matches</strong>
          </div>

          <div className={styles.fixtureList}>
            {visibleFixtures.length > 0 ? (
              visibleFixtures.map((fixture) => {
                const state = getMatchState(fixture, gameDate);
                const fixtureDate = parseDate(fixture.date);
                const isMyMatch =
                  fixture.homeClubId === currentClub.id ||
                  fixture.awayClubId === currentClub.id;

                return (
                  <article
                    key={fixture.id}
                    className={`${styles.fixtureCard} ${isMyMatch ? styles.myFixture : ''}`}
                  >
                    <div className={styles.fixtureDate}>
                      <strong>{fixtureDate?.getDate()}</strong>
                      <span>
                        {fixtureDate
                          ? new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
                              fixtureDate,
                            )
                          : '-'}
                      </span>
                      <small>{fixtureDate ? formatTime(fixtureDate) : '-'}</small>
                    </div>

                    <div className={styles.fixtureCompetition}>
                      <span>{fixture.type === 'friendly' ? 'FRIENDLY' : fixture.country}</span>
                      <strong>{fixture.leagueName}</strong>
                      {fixture.type === 'league' && <small>Round {fixture.round}</small>}
                    </div>

                    <div className={styles.fixtureTeams}>
                      <div>
                        {fixture.homeLogo ? (
                          <img src={fixture.homeLogo} alt="" />
                        ) : (
                          <span>⚽</span>
                        )}
                        <strong>{fixture.homeClubName}</strong>
                      </div>
                      <span className={styles.vs}>VS</span>
                      <div>
                        {fixture.awayLogo ? (
                          <img src={fixture.awayLogo} alt="" />
                        ) : (
                          <span>⚽</span>
                        )}
                        <strong>{fixture.awayClubName}</strong>
                      </div>
                    </div>

                    <div className={styles.fixtureVenue}>
                      <span>🏟</span>
                      <div>
                        <small>STADIUM</small>
                        <strong>{fixture.stadium}</strong>
                      </div>
                    </div>

                    <div className={styles.fixtureAction}>
                      {state === 'finished' && fixture.result && (
                        <div className={styles.result}>
                          <span>RESULT</span>
                          <strong>
                            {fixture.result.homeScore} - {fixture.result.awayScore}
                          </strong>
                        </div>
                      )}

                      {state === 'finished' && !fixture.result && (
                        <span className={styles.finished}>FINISHED</span>
                      )}

                      {state === 'upcoming' && isMyMatch && (
                        <span className={styles.waiting}>UPCOMING</span>
                      )}

                      {state === 'live' && isMyMatch && (
                        <button
                          type="button"
                          className={styles.playButtonSmall}
                          onClick={() => playMatch(fixture)}
                        >
                          ▶ PLAY MATCH
                        </button>
                      )}

                      {state === 'live' && !isMyMatch && (
                        <span className={styles.liveBadge}>LIVE</span>
                      )}

                      {state === 'missed' && (
                        <span className={styles.missed}>MISSED</span>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className={styles.noFixtures}>
                <span>📅</span>
                <h3>No fixtures found</h3>
                <p>There are no matches for the selected filters.</p>
              </div>
            )}
          </div>
        </section>

        {/* FRIENDLY SECTION */}
        <section className={styles.friendlySection}>
          <div>
            <span>PRE-SEASON</span>
            <h2>Friendly Matches</h2>
            <p>Prepare your squad before competitive football begins.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowFriendly((previous) => !previous)}
          >
            + Schedule Friendly
          </button>
        </section>

        {showFriendly && (
          <section className={styles.friendlyForm}>
            <label>
              Opponent
              <select
                value={friendlyOpponent}
                onChange={(event) => setFriendlyOpponent(event.target.value)}
              >
                <option value="">Select opponent</option>
                {clubs
                  .filter((club) => club.id !== currentClub.id)
                  .map((club) => (
                    <option key={club.id} value={club.id}>
                      {getClubName(club)}
                    </option>
                  ))}
              </select>
            </label>

            <div className={styles.friendlyDate}>
              Proposed date <strong>{formatDate(addDays(gameDate, 3))}</strong>
            </div>

            <button
              type="button"
              disabled={saving || !friendlyOpponent}
              onClick={createFriendly}
            >
              {saving ? 'Scheduling...' : 'Confirm Friendly'}
            </button>
          </section>
        )}

        {/* LEAGUES */}
        <section className={styles.leaguesSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>COMPETITIONS</span>
              <h2>Leagues</h2>
            </div>
          </div>

          <div className={styles.leagueGrid}>
            {leagues.map((league) => {
              const teams = getLeagueTeams(league, clubs);
              const isMyLeague = userLeagueIds.includes(league.id);

              return (
                <button
                  type="button"
                  key={league.id}
                  className={`${styles.leagueCard} ${isMyLeague ? styles.myLeague : ''}`}
                  onClick={() => {
                    setSelectedLeague(league.id);
                    setActiveView('all');
                  }}
                >
                  <div className={styles.leagueIcon}>
                    {league.logo ? <img src={league.logo} alt="" /> : '🏆'}
                  </div>
                  <div>
                    <span>{getLeagueCountry(league)}</span>
                    <strong>{getLeagueName(league)}</strong>
                    <small>{teams.length} teams</small>
                  </div>
                  {isMyLeague && <b>YOUR LEAGUE</b>}
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}

/* =========================================================
   SSR
========================================================= */

export async function getServerSideProps() {
  try {
    const [leaguesSnapshot, clubsSnapshot, matchesSnapshot] = await Promise.all([
      getDocs(collection(db, 'leagues')),
      getDocs(collection(db, 'clubs')),
      getDocs(collection(db, 'matches')),
    ]);

    const leagues = leaguesSnapshot.docs
      .slice(0, MAX_LEAGUES)
      .map((item) => ({ id: item.id, ...item.data() }));

    const clubs = clubsSnapshot.docs
      .slice(0, MAX_CLUBS)
      .map((item) => ({ id: item.id, ...item.data() }));

    const matches = matchesSnapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    }));

    return {
      props: {
        initialLeagues: JSON.parse(JSON.stringify(leagues)),
        initialClubs: JSON.parse(JSON.stringify(clubs)),
        initialMatches: JSON.parse(JSON.stringify(matches)),
      },
    };
  } catch (error) {
    console.error('Fixtures SSR error:', error);

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
        initialMatches: [],
      },
    };
  }
}
