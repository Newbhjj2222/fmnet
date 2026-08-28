// pages/fixture.js

import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from 'react';

import Head from 'next/head';
import { useRouter } from 'next/router';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../components/firebase';
import { useAuth } from '../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './fixture.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_LEAGUES = 500;
const MAX_CLUBS = 5000;
const MATCH_DURATION_MINUTES = 105;
const FIRESTORE_BATCH_SIZE = 450;

/* =========================================================
   SAFE DATE HELPERS
========================================================= */

function makeDate(year, month, day, hour = 15, minute = 0) {
  return new Date(year, month, day, hour, minute, 0, 0);
}

function cloneDate(date) {
  return new Date(date.getTime());
}

function startOfDay(date) {
  const d = cloneDate(date);
  d.setHours(0, 0, 0, 0);
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
  if (!date) return '';
  const d = cloneDate(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseDate(value) {
  if (!value) return null;

  try {
    if (value?.toDate && typeof value.toDate === 'function') {
      const d = value.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
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
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil(
    (startOfDay(b).getTime() - startOfDay(a).getTime()) / oneDay
  );
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  if (!league || !Array.isArray(clubs)) return [];

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
   MATCH STATUS
========================================================= */

function getMatchState(fixture, gameDate) {
  const start = parseDate(fixture?.date);

  if (!start) return 'scheduled';

  const end = addMinutes(start, MATCH_DURATION_MINUTES);

  if (
    fixture?.result ||
    fixture?.status === 'finished' ||
    fixture?.status === 'played'
  ) {
    return 'finished';
  }

  if (!gameDate) return 'upcoming';
  if (gameDate >= end) return 'missed';
  if (gameDate >= start) return 'live';

  return 'upcoming';
}

/* =========================================================
   SIMULATE MATCH - USING REPUTATION & PLAYER OVERALL
========================================================= */

function simulateMatchResult(fixture, homeClubData, awayClubData) {
  // Get club reputation
  const homeReputation = safeNumber(
    homeClubData?.reputation,
    50
  );
  const awayReputation = safeNumber(
    awayClubData?.reputation,
    50
  );

  // Get player overall from fixture (pre-calculated) or calculate from players
  const homeOverall = safeNumber(
    fixture?.homeOverall ||
      (homeClubData?.squadOverall
        ? homeClubData.squadOverall
        : 60),
    60
  );
  const awayOverall = safeNumber(
    fixture?.awayOverall ||
      (awayClubData?.squadOverall
        ? awayClubData.squadOverall
        : 60),
    60
  );

  // Weighted team strength:
  // 60% player overall, 30% reputation, 10% random factor
  const homeStrength =
    homeOverall * 0.60 + homeReputation * 0.30 + (Math.random() * 10 - 5);
  const awayStrength =
    awayOverall * 0.60 + awayReputation * 0.30 + (Math.random() * 10 - 5);

  // Home advantage
  const homeAdvantage = 3;

  const homeTotal = homeStrength + homeAdvantage;
  const awayTotal = awayStrength;

  // Generate scores based on strength
  const homeScore = Math.max(
    0,
    Math.floor(
      (homeTotal / 100) * 3 + Math.random() * 2
    )
  );
  const awayScore = Math.max(
    0,
    Math.floor(
      (awayTotal / 100) * 3 + Math.random() * 1.5
    )
  );

  return {
    homeScore,
    awayScore,
  };
}

/* =========================================================
   PAGE
========================================================= */

export default function FixturesPage({
  initialLeagues = [],
  initialClubs = [],
}) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [leagues] = useState(
    Array.isArray(initialLeagues) ? initialLeagues : []
  );
  const [clubs] = useState(
    Array.isArray(initialClubs) ? initialClubs : []
  );

  const [dbMatches, setDbMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(true);

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

  const simulatedMatchesRef = useRef(new Set());

  /* =======================================================
     REAL-TIME CLOCK
  ======================================================= */

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  /* =======================================================
     AUTH + CAREER
  ======================================================= */

  const loadCareer = useCallback(async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const userRef = doc(db, 'users', user.uid);
      const snapshot = await getDoc(userRef);

      if (!snapshot.exists()) {
        setCareerData({});
        setCurrentClub(null);
        return;
      }

      const data = snapshot.data();
      const career = data?.careerData || {};
      setCareerData(career);

      if (!career.currentClub) {
        setCurrentClub(null);
        return;
      }

      const clubSnapshot = await getDoc(
        doc(db, 'clubs', career.currentClub)
      );

      if (clubSnapshot.exists()) {
        setCurrentClub({
          id: clubSnapshot.id,
          ...clubSnapshot.data(),
        });
      } else {
        setCurrentClub(null);
      }
    } catch (error) {
      console.error('Career loading error:', error);
      toast.error('Failed to load career');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    loadCareer();
  }, [user, loading, router, loadCareer]);

  /* =======================================================
     GAME DATE - 100% GAME CALENDAR
  ======================================================= */

  const gameDate = useMemo(() => {
    const saved = parseDate(careerData?.currentDate);
    return saved || new Date();
  }, [careerData?.currentDate]);

  /* =======================================================
     SEASON YEAR - BASED ON GAME DATE
  ======================================================= */

  const seasonYear = useMemo(() => {
    return gameDate.getMonth() >= 6
      ? gameDate.getFullYear()
      : gameDate.getFullYear() - 1;
  }, [gameDate]);

  /* =======================================================
     REALTIME MATCHES
  ======================================================= */

  useEffect(() => {
    if (!user) {
      setDbMatches([]);
      setMatchesLoading(false);
      return undefined;
    }

    setMatchesLoading(true);
    const matchesQuery = query(
      collection(db, 'matches'),
      where('seasonYear', '==', seasonYear)
    );

    const unsubscribe = onSnapshot(
      matchesQuery,
      (snapshot) => {
        const matches = snapshot.docs.map((docItem) => ({
          id: docItem.id,
          ...docItem.data(),
        }));
        setDbMatches(matches);
        setMatchesLoading(false);
      },
      (error) => {
        console.error('[FIXTURES] Realtime matches error:', error);
        setDbMatches([]);
        setMatchesLoading(false);
        toast.error('Could not load fixtures');
      }
    );

    return () => unsubscribe();
  }, [user, seasonYear]);

  /* =======================================================
     ALL FIXTURES FROM DATABASE
  ======================================================= */

  const allFixtures = useMemo(() => {
    return Array.isArray(dbMatches) ? dbMatches : [];
  }, [dbMatches]);

  /* =======================================================
     USER LEAGUES
  ======================================================= */

  const userLeagueIds = useMemo(() => {
    if (!currentClub) return [];
    const leagueId = getLeagueId(currentClub);
    return leagueId ? [leagueId] : [];
  }, [currentClub]);

  /* =======================================================
     MY FIXTURES
  ======================================================= */

  const myFixtures = useMemo(() => {
    if (!currentClub?.id) return [];

    return allFixtures.filter(
      (fixture) =>
        fixture?.homeClubId === currentClub.id ||
        fixture?.awayClubId === currentClub.id
    );
  }, [allFixtures, currentClub]);

  /* =======================================================
     NEXT MATCH
  ======================================================= */

  const nextMatch = useMemo(() => {
    if (!currentClub?.id) return null;

    const live = myFixtures.find(
      (fixture) => getMatchState(fixture, gameDate) === 'live'
    );

    if (live) return live;

    const upcoming = myFixtures
      .filter(
        (fixture) => getMatchState(fixture, gameDate) === 'upcoming'
      )
      .sort(
        (a, b) =>
          (parseDate(a.date)?.getTime() || 0) -
          (parseDate(b.date)?.getTime() || 0)
      );

    return upcoming[0] || null;
  }, [myFixtures, gameDate, currentClub]);

  /* =======================================================
     FILTERED FIXTURES
  ======================================================= */

  const visibleFixtures = useMemo(() => {
    let source = activeView === 'my' ? myFixtures : allFixtures;

    if (selectedLeague !== 'all') {
      source = source.filter(
        (fixture) => fixture?.leagueId === selectedLeague
      );
    }

    if (selectedDate) {
      source = source.filter((fixture) => {
        const date = parseDate(fixture?.date);
        return date && isoDate(date) === selectedDate;
      });
    }

    return [...source].sort(
      (a, b) =>
        (parseDate(a.date)?.getTime() || 0) -
        (parseDate(b.date)?.getTime() || 0)
    );
  }, [activeView, myFixtures, allFixtures, selectedLeague, selectedDate]);

  /* =======================================================
     CALENDAR FIXTURES
  ======================================================= */

  const calendarFixtures = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    return allFixtures.filter((fixture) => {
      const date = parseDate(fixture?.date);
      if (!date) return false;
      return date.getFullYear() === year && date.getMonth() === month;
    });
  }, [allFixtures, calendarMonth]);

  /* =======================================================
     CLUB MAP FOR STRENGTH CALCULATION
  ======================================================= */

  const clubMap = useMemo(() => {
    return clubs.reduce((map, club) => {
      map[club.id] = club;
      return map;
    }, {});
  }, [clubs]);

  /* =======================================================
     SIMULATE OTHER TEAM MATCHES
     Uses club reputation & player overall from database
  ======================================================= */

  const simulateOtherTeamMatches = useCallback(async () => {
    if (!user || !currentClub) return;

    try {
      const today = isoDate(gameDate);

      const matchesToSimulate = allFixtures.filter((fixture) => {
        if (simulatedMatchesRef.current.has(fixture.id)) return false;
        const fixtureDate = parseDate(fixture.date);
        if (!fixtureDate) return false;
        if (isoDate(fixtureDate) !== today) return false;
        if (fixture.result || fixture.status === 'finished') return false;
        const isMyMatch =
          fixture.homeClubId === currentClub.id ||
          fixture.awayClubId === currentClub.id;
        if (isMyMatch) return false;
        return true;
      });

      if (matchesToSimulate.length === 0) return;

      const batch = writeBatch(db);

      matchesToSimulate.forEach((fixture) => {
        simulatedMatchesRef.current.add(fixture.id);

        // Get club data for strength calculation
        const homeClub = clubMap[fixture.homeClubId] || null;
        const awayClub = clubMap[fixture.awayClubId] || null;

        // Calculate team strength from club reputation and squad overall
        const result = simulateMatchResult(fixture, homeClub, awayClub);

        const matchRef = doc(db, 'matches', fixture.id);

        batch.update(matchRef, {
          status: 'finished',
          result,
          homeScore: result.homeScore,
          awayScore: result.awayScore,
          simulatedBy: 'system',
          simulatedAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      toast.success(
        `${matchesToSimulate.length} other team matches simulated with results`
      );
    } catch (error) {
      console.error('Other team simulation error:', error);
      toast.error('Could not simulate other matches');
    }
  }, [user, currentClub, gameDate, allFixtures, clubMap]);

  /* =======================================================
     ADVANCE DAY - Always works, simulates other matches
  ======================================================= */

  const advanceDay = async () => {
    if (!user || saving) return;

    const current = gameDate;
    const next = addDays(startOfDay(gameDate), 1);

    const blockingMatch = myFixtures.find((fixture) => {
      const date = parseDate(fixture?.date);
      if (!date) return false;
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

      // Simulate all other team matches for today
      await simulateOtherTeamMatches();

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        'careerData.currentDate': next.toISOString(),
        'careerData.updatedAt': serverTimestamp(),
      });

      setCareerData((previous) => ({
        ...(previous || {}),
        currentDate: next.toISOString(),
      }));

      setNow(new Date());

      toast.success(`Advanced to ${formatDate(next)}`);
    } catch (error) {
      console.error('Advance day error:', error);
      toast.error('Could not advance the day');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     ADVANCE TO KICKOFF
  ======================================================= */

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
        ...(previous || {}),
        currentDate: kickoff.toISOString(),
      }));

      setNow(new Date());

      toast.success(`Advanced to kickoff: ${formatTime(kickoff)}`);
    } catch (error) {
      console.error('Advance kickoff error:', error);
      toast.error('Could not advance to kickoff');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     PLAY MATCH
  ======================================================= */

  const playMatch = (fixture) => {
    if (!fixture?.id) return;

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

    // Dynamic route: /match/[id]
    router.push(`/match/${encodeURIComponent(fixture.id)}`);
  };

  /* =======================================================
     CREATE FRIENDLY
  ======================================================= */

  const createFriendly = async () => {
    if (!currentClub || !friendlyOpponent || !user) {
      toast.error('Choose an opponent');
      return;
    }

    const opponent = clubs.find((club) => club.id === friendlyOpponent);
    if (!opponent) {
      toast.error('Opponent not found');
      return;
    }

    const friendlyDate = addDays(startOfDay(gameDate), 3);

    const id = [
      'friendly',
      user.uid,
      currentClub.id,
      opponent.id,
      isoDate(friendlyDate),
    ].join('_');

    const kickoff = makeDate(
      friendlyDate.getFullYear(),
      friendlyDate.getMonth(),
      friendlyDate.getDate(),
      16,
      0
    );

    const fixture = {
      id,
      type: 'friendly',
      leagueId: null,
      leagueName: 'Pre-Season Friendly',
      country: 'Friendly',
      seasonYear,
      season: `${seasonYear}/${String(seasonYear + 1).slice(-2)}`,
      round: 0,
      homeClubId: currentClub.id,
      homeClubName: getClubName(currentClub),
      homeLogo: getClubLogo(currentClub),
      awayClubId: opponent.id,
      awayClubName: getClubName(opponent),
      awayLogo: getClubLogo(opponent),
      stadium: currentClub?.stadium || 'Club Stadium',
      date: kickoff.toISOString(),
      status: 'scheduled',
      result: null,
      createdBy: user.uid,
      homeOverall: 60,
      awayOverall: 60,
    };

    try {
      setSaving(true);

      const matchRef = doc(db, 'matches', id);

      await updateDoc(matchRef, {
        ...fixture,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(async () => {
        const batch = writeBatch(db);
        batch.set(matchRef, {
          ...fixture,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      });

      setShowFriendly(false);
      setFriendlyOpponent('');
      toast.success('Friendly match saved to database');
    } catch (error) {
      console.error('Friendly creation error:', error);
      toast.error('Could not schedule friendly');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     TRANSFER WINDOWS - GAME CALENDAR ONLY
  ======================================================= */

  const transferWindows = useMemo(
    () => [
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
    ],
    [seasonYear]
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
  ======================================================= */

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
  ======================================================= */

  if (loading || isLoading || matchesLoading) {
    return (
      <>
        <Head>
          <title>Fixtures</title>
        </Head>
        <main className={styles.page}>
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            <p>Loading fixtures...</p>
          </div>
        </main>
      </>
    );
  }

  if (!user) return null;

  /* =======================================================
     NO CLUB
  ======================================================= */

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
     NEXT MATCH STATE
  ======================================================= */

  const nextMatchState = nextMatch
    ? getMatchState(nextMatch, gameDate)
    : null;

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Fixtures & Calendar | {getClubName(currentClub)}
        </title>
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

        {/* NEXT MATCH */}
        <section className={styles.nextMatchCard}>
          <div className={styles.nextMatchTop}>
            <div>
              <span>NEXT MATCH</span>
              <h2>
                {nextMatch
                  ? nextMatch.leagueName || 'Match'
                  : 'No upcoming match'}
              </h2>
            </div>
            <div className={styles.liveDate}>
              {nextMatch
                ? formatDate(parseDate(nextMatch.date))
                : 'Season calendar'}
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

          {/* ADVANCE BUTTON - Always visible */}
          <div className={styles.nextMatchActions}>
            {nextMatchState === 'upcoming' && nextMatch && (
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
                  Match in{' '}
                  {Math.max(0, daysBetween(gameDate, parseDate(nextMatch.date)))}{' '}
                  day(s)
                </span>
              </>
            )}

            {nextMatchState === 'live' && (
              <button
                type="button"
                className={styles.playButton}
                onClick={() => playMatch(nextMatch)}
              >
                ▶ PLAY MATCH
              </button>
            )}

            {nextMatchState === 'missed' && (
              <span className={styles.missed}>MISSED</span>
            )}

            {(!nextMatch || nextMatchState === 'missed') && (
              <button
                type="button"
                className={styles.advanceButton}
                onClick={advanceDay}
                disabled={saving}
              >
                ⏭ Advance to Next Day
              </button>
            )}
          </div>
        </section>

        {/* CONTROLS */}
        <section className={styles.controls}>
          <div className={styles.viewTabs}>
            <button
              type="button"
              className={activeView === 'my' ? styles.active : ''}
              onClick={() => setActiveView('my')}
            >
              My Fixtures
            </button>

            <button
              type="button"
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
            <strong>
              {currentTransferWindow
                ? currentTransferWindow.name
                : 'Closed'}
            </strong>
          </div>

          <div>
            <span>STATUS</span>
            <strong
              className={
                currentTransferWindow
                  ? styles.openStatus
                  : styles.closedStatus
              }
            >
              {currentTransferWindow ? 'OPEN' : 'CLOSED'}
            </strong>
          </div>

          <div>
            <span>NEXT WINDOW</span>
            <strong>
              {transferWindows
                .filter((window) => parseDate(window.start) > gameDate)
                .sort(
                  (a, b) =>
                    new Date(a.start) - new Date(b.start)
                )[0]?.name || 'None'}
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
                  (previous) =>
                    new Date(
                      previous.getFullYear(),
                      previous.getMonth() - 1,
                      1
                    )
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
                  (previous) =>
                    new Date(
                      previous.getFullYear(),
                      previous.getMonth() + 1,
                      1
                    )
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

            {Array.from({ length: calendarDays.first.getDay() }).map(
              (_, index) => (
                <div key={`empty-${index}`} className={styles.emptyDay} />
              )
            )}

            {calendarDays.days.map((day) => {
              const isToday = isoDate(day.date) === isoDate(gameDate);

              return (
                <button
                  type="button"
                  key={isoDate(day.date)}
                  className={`${styles.calendarDay} ${
                    isToday ? styles.today : ''
                  }`}
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
                          : fixture.result
                          ? styles.finishedMatchDot
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
              <h2>
                {selectedDate
                  ? `Fixtures on ${selectedDate}`
                  : 'Upcoming Fixtures'}
              </h2>
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
                    className={`${styles.fixtureCard} ${
                      isMyMatch ? styles.myFixture : ''
                    }`}
                  >
                    <div className={styles.fixtureDate}>
                      <strong>{fixtureDate?.getDate()}</strong>
                      <span>
                        {fixtureDate
                          ? new Intl.DateTimeFormat('en-US', {
                              month: 'short',
                            }).format(fixtureDate)
                          : '-'}
                      </span>
                      <small>
                        {fixtureDate ? formatTime(fixtureDate) : '-'}
                      </small>
                    </div>

                    <div className={styles.fixtureCompetition}>
                      <span>
                        {fixture.type === 'friendly'
                          ? 'FRIENDLY'
                          : fixture.country || 'COMPETITION'}
                      </span>
                      <strong>{fixture.leagueName || 'Match'}</strong>
                      {fixture.type === 'league' && (
                        <small>Round {fixture.round}</small>
                      )}
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

                      <span className={styles.vs}>
                        {fixture.result
                          ? `${fixture.result.homeScore ?? fixture.homeScore ?? 0} - ${fixture.result.awayScore ?? fixture.awayScore ?? 0}`
                          : 'VS'}
                      </span>

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
                        <strong>{fixture.stadium || 'Club Stadium'}</strong>
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

                      {state === 'missed' && isMyMatch && (
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
                <p>
                  There are no matches in the database for the selected
                  filters.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* FRIENDLY */}
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
              Proposed date{' '}
              <strong>{formatDate(addDays(gameDate, 3))}</strong>
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
                  className={`${styles.leagueCard} ${
                    isMyLeague ? styles.myLeague : ''
                  }`}
                  onClick={() => {
                    setSelectedLeague(league.id);
                    setActiveView('all');
                  }}
                >
                  <div className={styles.leagueIcon}>
                    {league.logo ? (
                      <img src={league.logo} alt="" />
                    ) : (
                      '🏆'
                    )}
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
    const [leaguesSnapshot, clubsSnapshot] = await Promise.all([
      getDocs(collection(db, 'leagues')),
      getDocs(collection(db, 'clubs')),
    ]);

    const leagues = leaguesSnapshot.docs
      .slice(0, MAX_LEAGUES)
      .map((item) => ({
        id: item.id,
        ...item.data(),
      }));

    const clubs = clubsSnapshot.docs
      .slice(0, MAX_CLUBS)
      .map((item) => ({
        id: item.id,
        ...item.data(),
      }));

    return {
      props: {
        initialLeagues: JSON.parse(JSON.stringify(leagues)),
        initialClubs: JSON.parse(JSON.stringify(clubs)),
      },
    };
  } catch (error) {
    console.error('Fixtures SSR error:', error);

    return {
      props: {
        initialLeagues: [],
        initialClubs: [],
      },
    };
  }
}
