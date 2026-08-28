// pages/dashboard.js

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '../context/AuthContext';
import { db } from '../components/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  Bar,
  Doughnut,
  Line,
} from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
} from 'chart.js';
import toast from 'react-hot-toast';
import styles from './dashboard.module.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value.name || value.title || value.label || value.id || fallback;
  }
  return String(value);
}

function getClubName(club, fallback = 'Unknown Club') {
  return (
    club?.shortName ||
    club?.name ||
    club?.clubName ||
    club?.title ||
    fallback
  );
}

function getGameDate(value) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getSeasonYearFromDate(gameDate) {
  return gameDate.getMonth() >= 6
    ? gameDate.getFullYear()
    : gameDate.getFullYear() - 1;
}

/* =========================================================
   PAGE
========================================================= */

export default function Dashboard() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();

  const [stats, setStats] = useState({
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    conceded: 0,
    position: '-',
    points: 0,
    cleanSheets: 0,
  });

  const [recentMatches, setRecentMatches] = useState([]);
  const [clubInfo, setClubInfo] = useState(null);
  const [upcomingFixtures, setUpcomingFixtures] = useState([]);
  const [allMatches, setAllMatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClubOccupied, setIsClubOccupied] = useState(false);
  const [gameDate, setGameDate] = useState(new Date());
  const [seasonYear, setSeasonYear] = useState(
    getSeasonYearFromDate(new Date())
  );

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      fetchDashboardData();
    }
  }, [user, loading, router]);

  /* =======================================================
     FETCH DASHBOARD DATA
  ======================================================= */

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      let careerData = {};

      if (userDoc.exists()) {
        const data = userDoc.data();
        careerData = data.careerData || {};
      }

      // IMPORTANT: game date from careerData.currentDate
      const currentGameDate = getGameDate(careerData.currentDate);
      setGameDate(currentGameDate);
      setSeasonYear(getSeasonYearFromDate(currentGameDate));

      if (careerData.currentClub) {
        const clubRef = doc(db, 'clubs', careerData.currentClub);
        const clubDoc = await getDoc(clubRef);

        if (clubDoc.exists()) {
          const clubData = clubDoc.data();

          // Check if club is occupied by another manager
          if (clubData.managerId && clubData.managerId !== user.uid) {
            setIsClubOccupied(true);
            setClubInfo(null);
            toast.error('This club has been taken by another manager. Please choose a different club.');
            return;
          }

          setIsClubOccupied(false);

          // Ensure club is marked as occupied by this user
          if (clubData.managerId !== user.uid) {
            await updateDoc(clubRef, {
              managerId: user.uid,
              managerName:
                userData?.displayName ||
                user?.email?.split('@')[0] ||
                'Manager',
              managerStatus: 'active',
              updatedAt: serverTimestamp(),
            });
          }

          setClubInfo({
            id: clubDoc.id,
            ...clubData,
          });
        } else {
          toast.error('Your assigned club no longer exists. Please choose a new club.');
          setClubInfo(null);
        }
      } else {
        setClubInfo(null);
      }

      // Load matches for current club using game-date-based seasonYear
      if (careerData.currentClub && !isClubOccupied) {
        await loadClubMatches(
          careerData.currentClub,
          getSeasonYearFromDate(currentGameDate)
        );
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     LOAD CLUB MATCHES (REAL-TIME)
     seasonYear passed from game calendar
  ======================================================= */

  const loadClubMatches = useCallback(async (clubId, seasonYearParam) => {
    try {
      const matchesQuery = query(
        collection(db, 'matches'),
        where('seasonYear', '==', seasonYearParam)
      );

      const unsubscribe = onSnapshot(
        matchesQuery,
        (snapshot) => {
          const allLeagueMatches = [];

          snapshot.forEach((docItem) => {
            const match = docItem.data();

            const isClubMatch =
              match.homeClubId === clubId ||
              match.awayClubId === clubId ||
              match.homeTeamId === clubId ||
              match.awayTeamId === clubId;

            if (isClubMatch) {
              allLeagueMatches.push({
                id: docItem.id,
                ...match,
              });
            }
          });

          setAllMatches(allLeagueMatches);
          calculateStats(allLeagueMatches, clubId);
          separateMatches(allLeagueMatches);
        },
        (error) => {
          console.error('Error loading club matches:', error);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error('Error loading club matches:', error);
    }
  }, []);

  /* =======================================================
     CALCULATE STATS FROM MATCHES
  ======================================================= */

  const calculateStats = useCallback((matchList, clubId) => {
    let matches = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goals = 0;
    let conceded = 0;
    let points = 0;
    let cleanSheets = 0;

    matchList.forEach((match) => {
      const result = match.result || {};
      const homeScore = safeNumber(result.homeScore ?? match.homeScore);
      const awayScore = safeNumber(result.awayScore ?? match.awayScore);

      const isHome =
        match.homeClubId === clubId ||
        match.homeTeamId === clubId;

      if (!isHome && match.awayClubId !== clubId && match.awayTeamId !== clubId) {
        return;
      }

      const teamScore = isHome ? homeScore : awayScore;
      const opponentScore = isHome ? awayScore : homeScore;

      if (!match.result && match.status !== 'finished') {
        return;
      }

      matches += 1;
      goals += teamScore;
      conceded += opponentScore;

      if (teamScore > opponentScore) {
        wins += 1;
        points += 3;
      } else if (teamScore < opponentScore) {
        losses += 1;
      } else {
        draws += 1;
        points += 1;
      }

      if (opponentScore === 0 && (match.result || match.status === 'finished')) {
        cleanSheets += 1;
      }
    });

    setStats({
      matches,
      wins,
      draws,
      losses,
      goals,
      conceded,
      position: '-',
      points,
      cleanSheets,
    });
  }, []);

  /* =======================================================
     SEPARATE MATCHES
  ======================================================= */

  const separateMatches = useCallback((matchList) => {
    const finished = [];
    const upcoming = [];

    matchList.forEach((match) => {
      if (match.result || match.status === 'finished' || match.status === 'played') {
        finished.push(match);
      } else {
        upcoming.push(match);
      }
    });

    finished.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

    upcoming.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    setRecentMatches(finished.slice(0, 5));
    setUpcomingFixtures(upcoming.slice(0, 5));
  }, []);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     CLUB OCCUPIED
  ======================================================= */

  if (isClubOccupied) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.emptyIcon}>⚠️</div>
        <h2>Club Already Taken</h2>
        <p>This club has been taken by another manager.</p>
        <button
          type="button"
          className={styles.chooseClubButton}
          onClick={() => router.push('/club')}
        >
          Choose Another Club
        </button>
      </div>
    );
  }

  /* =======================================================
     NO CLUB
  ======================================================= */

  if (!clubInfo) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.emptyIcon}>⚽</div>
        <h2>No Club Assigned</h2>
        <p>You need to choose a club before viewing the dashboard.</p>
        <button
          type="button"
          className={styles.chooseClubButton}
          onClick={() => router.push('/club')}
        >
          Choose Club
        </button>
      </div>
    );
  }

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const winRate =
    stats.matches > 0
      ? Math.round((stats.wins / stats.matches) * 100)
      : 0;

  const goalDifference = stats.goals - stats.conceded;

  const getMatchOpponent = (match, clubIdValue) => {
    const isHome =
      match.homeClubId === clubIdValue ||
      match.homeTeamId === clubIdValue;

    return isHome
      ? match.awayClubName || match.awayTeam || 'Away'
      : match.homeClubName || match.homeTeam || 'Home';
  };

  const getMatchScore = (match, clubIdValue) => {
    const result = match.result || {};
    const homeScore = safeNumber(result.homeScore ?? match.homeScore);
    const awayScore = safeNumber(result.awayScore ?? match.awayScore);

    const isHome =
      match.homeClubId === clubIdValue ||
      match.homeTeamId === clubIdValue;

    return isHome
      ? `${homeScore} - ${awayScore}`
      : `${awayScore} - ${homeScore}`;
  };

  const getMatchResult = (match, clubIdValue) => {
    const result = match.result || {};
    const homeScore = safeNumber(result.homeScore ?? match.homeScore);
    const awayScore = safeNumber(result.awayScore ?? match.awayScore);

    const isHome =
      match.homeClubId === clubIdValue ||
      match.homeTeamId === clubIdValue;

    const teamScore = isHome ? homeScore : awayScore;
    const opponentScore = isHome ? awayScore : homeScore;

    if (teamScore > opponentScore) return 'W';
    if (teamScore < opponentScore) return 'L';
    return 'D';
  };

  /* =======================================================
     CHART DATA
  ======================================================= */

  const matchChartData = {
    labels: ['Wins', 'Draws', 'Losses'],
    datasets: [
      {
        label: 'Matches',
        data: [stats.wins, stats.draws, stats.losses],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderColor: ['#059669', '#d97706', '#dc2626'],
        borderWidth: 2,
      },
    ],
  };

  const performanceData = {
    labels: ['Goals Scored', 'Goals Conceded', 'Clean Sheets'],
    datasets: [
      {
        label: 'Performance',
        data: [stats.goals, stats.conceded, stats.cleanSheets],
        backgroundColor: ['#3b82f6', '#ef4444', '#10b981'],
        borderColor: ['#2563eb', '#dc2626', '#059669'],
        borderWidth: 2,
      },
    ],
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>Dashboard - Virtual Football Manager Career</title>
        <meta
          name="description"
          content="View your football manager dashboard with real match statistics."
        />
      </Head>

      <div className={styles.dashboard}>
        <div className={styles.header}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>
            Welcome back,{' '}
            {userData?.displayName ||
              user?.email?.split('@')[0] ||
              'Manager'}
            !
          </p>
          <p className={styles.gameDate}>
            Game Date: {gameDate.toLocaleDateString()}
          </p>
        </div>

        <div className={styles.statsGrid}>
          <div className={`${styles.statCard} ${styles.primary}`}>
            <div className={styles.statIcon}>🏆</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Matches Played</span>
              <span className={styles.statValue}>{stats.matches}</span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.success}`}>
            <div className={styles.statIcon}>⭐</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Win Rate</span>
              <span className={styles.statValue}>{winRate}%</span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.warning}`}>
            <div className={styles.statIcon}>📊</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>League Points</span>
              <span className={styles.statValue}>{stats.points}</span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.info}`}>
            <div className={styles.statIcon}>⚽</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Goal Difference</span>
              <span className={styles.statValue}>
                {goalDifference >= 0 ? '+' : ''}
                {goalDifference}
              </span>
            </div>
          </div>
        </div>

        {/* CLUB INFO */}
        <div className={styles.clubInfo}>
          <div className={styles.clubHeader}>
            <span className={styles.clubLogo}>
              {clubInfo.logo ? (
                <img src={clubInfo.logo} alt={clubInfo.name} />
              ) : (
                '⚽'
              )}
            </span>
            <div>
              <h2 className={styles.clubName}>{getClubName(clubInfo)}</h2>
              <p className={styles.clubDetails}>
                {safeString(clubInfo.leagueName, clubInfo.league)} •{' '}
                {clubInfo.stadium || 'No stadium'}
              </p>
            </div>
          </div>
        </div>

        {/* CHARTS */}
        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Match Results</h3>
            <div className={styles.chartContainer}>
              <Doughnut
                data={matchChartData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Team Performance</h3>
            <div className={styles.chartContainer}>
              <Bar
                data={performanceData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
        </div>

        {/* FEED */}
        <div className={styles.feedGrid}>
          <div className={styles.feedCard}>
            <h3 className={styles.feedTitle}>Recent Matches</h3>
            <div className={styles.feedList}>
              {recentMatches.length > 0 ? (
                recentMatches.map((match) => {
                  const opponent = getMatchOpponent(match, clubInfo?.id);
                  const score = getMatchScore(match, clubInfo?.id);
                  const result = getMatchResult(match, clubInfo?.id);

                  return (
                    <div key={match.id} className={styles.feedItem}>
                      <span
                        className={`${styles.resultBadge} ${
                          result === 'W'
                            ? styles.resultWin
                            : result === 'L'
                              ? styles.resultLoss
                              : styles.resultDraw
                        }`}
                      >
                        {result}
                      </span>
                      <span className={styles.matchResult}>
                        vs {opponent}{' '}
                        <strong>{score}</strong>
                      </span>
                      <span className={styles.matchStatus}>
                        <span className={styles.played}>✓ Played</span>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className={styles.empty}>No recent matches</p>
              )}
            </div>
          </div>

          <div className={styles.feedCard}>
            <h3 className={styles.feedTitle}>Upcoming Fixtures</h3>
            <div className={styles.feedList}>
              {upcomingFixtures.length > 0 ? (
                upcomingFixtures.map((fixture) => {
                  const opponent = getMatchOpponent(fixture, clubInfo?.id);

                  return (
                    <div key={fixture.id} className={styles.feedItem}>
                      <span className={styles.fixtureInfo}>
                        vs {opponent}
                      </span>
                      <span className={styles.fixtureDate}>
                        {fixture.date
                          ? new Date(fixture.date).toLocaleDateString()
                          : '-'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className={styles.empty}>No upcoming fixtures</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
