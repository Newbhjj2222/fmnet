// pages/career.js

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
} from 'firebase/firestore';

import toast from 'react-hot-toast';

import styles from './career.module.css';

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

/* =========================================================
   PAGE
========================================================= */

export default function Career() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();

  const [career, setCareer] = useState({
    totalMatches: 0,
    totalWins: 0,
    totalDraws: 0,
    totalLosses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    currentPosition: '-',
    points: 0,
    currentClub: null,
    level: 1,
    xp: 0,
    reputation: 0,
    trophies: 0,
    seasons: 1,
    cleanSheets: 0,
  });

  const [clubInfo, setClubInfo] = useState(null);
  const [matches, setMatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      fetchCareerData();
    }
  }, [user, loading, router]);

  /* =======================================================
     FETCH CAREER DATA
  ======================================================= */

  const fetchCareerData = async () => {
    try {
      setIsLoading(true);

      const userRef = doc(db, 'users', user.uid);
      const userSnapshot = await getDoc(userRef);

      let careerData = {};

      if (userSnapshot.exists()) {
        const data = userSnapshot.data();
        careerData = data.careerData || {};
      }

      setCareer((prev) => ({
        ...prev,
        totalMatches: safeNumber(careerData.totalMatches),
        totalWins: safeNumber(careerData.totalWins),
        totalDraws: safeNumber(careerData.totalDraws),
        totalLosses: safeNumber(careerData.totalLosses),
        goalsFor: safeNumber(careerData.goalsFor),
        goalsAgainst: safeNumber(careerData.goalsAgainst),
        currentPosition: careerData.currentPosition || '-',
        points: safeNumber(careerData.points),
        currentClub: careerData.currentClub || null,
        level: safeNumber(careerData.level, 1),
        xp: safeNumber(careerData.xp),
        reputation: safeNumber(careerData.reputation),
        trophies: safeNumber(careerData.trophies),
        seasons: safeNumber(careerData.seasons, 1),
        cleanSheets: safeNumber(careerData.cleanSheets),
      }));

      if (careerData.currentClub) {
        const clubRef = doc(db, 'clubs', careerData.currentClub);
        const clubSnapshot = await getDoc(clubRef);

        if (clubSnapshot.exists()) {
          setClubInfo({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }
      }
    } catch (error) {
      console.error('Error loading career:', error);
      toast.error('Failed to load career data');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     LOAD MATCHES FOR CURRENT CLUB (REAL-TIME)
  ======================================================= */

  useEffect(() => {
    if (!user || !career.currentClub) {
      setMatches([]);
      return;
    }

    const clubId = career.currentClub;

    const matchesQuery = query(
      collection(db, 'matches'),
      where('seasonYear', '==', getSeasonYear())
    );

    const unsubscribe = onSnapshot(
      matchesQuery,
      (snapshot) => {
        const matchList = [];

        snapshot.forEach((matchDoc) => {
          const match = matchDoc.data();

          // Filter for club's matches
          const isClubMatch =
            match.homeClubId === clubId ||
            match.awayClubId === clubId ||
            match.homeTeamId === clubId ||
            match.awayTeamId === clubId;

          if (isClubMatch) {
            matchList.push({
              id: matchDoc.id,
              ...match,
            });
          }
        });

        matchList.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;

          return dateB - dateA;
        });

        setMatches(matchList);
        calculateCareerStats(matchList, clubId);
      },
      (error) => {
        console.error('Matches realtime error:', error);
      }
    );

    return () => unsubscribe();
  }, [user, career.currentClub]);

  /* =======================================================
     GET SEASON YEAR
  ======================================================= */

  function getSeasonYear() {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  }

  /* =======================================================
     CALCULATE CAREER STATS FROM MATCHES
  ======================================================= */

  const calculateCareerStats = useCallback((matchList, clubId) => {
    let totalMatches = 0;
    let totalWins = 0;
    let totalDraws = 0;
    let totalLosses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let points = 0;
    let cleanSheets = 0;

    matchList.forEach((match) => {
      if (!match.result && match.status !== 'finished') return;

      const result = match.result || {};
      const homeScore = safeNumber(result.homeScore ?? match.homeScore);
      const awayScore = safeNumber(result.awayScore ?? match.awayScore);

      const isHome =
        match.homeClubId === clubId ||
        match.homeTeamId === clubId;

      const isAway =
        match.awayClubId === clubId ||
        match.awayTeamId === clubId;

      if (!isHome && !isAway) return;

      const teamScore = isHome ? homeScore : awayScore;
      const opponentScore = isHome ? awayScore : homeScore;

      totalMatches += 1;
      goalsFor += teamScore;
      goalsAgainst += opponentScore;

      if (teamScore > opponentScore) {
        totalWins += 1;
        points += 3;
      } else if (teamScore < opponentScore) {
        totalLosses += 1;
      } else {
        totalDraws += 1;
        points += 1;
      }

      if (opponentScore === 0) {
        cleanSheets += 1;
      }
    });

    setCareer((prev) => ({
      ...prev,
      totalMatches,
      totalWins,
      totalDraws,
      totalLosses,
      goalsFor,
      goalsAgainst,
      points,
      cleanSheets,
    }));
  }, []);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading career...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     DERIVED DATA
  ======================================================= */

  const totalMatches = career.totalMatches;

  const winRate =
    totalMatches > 0
      ? Math.round((career.totalWins / totalMatches) * 100)
      : 0;

  const drawRate =
    totalMatches > 0
      ? Math.round((career.totalDraws / totalMatches) * 100)
      : 0;

  const lossRate =
    totalMatches > 0
      ? Math.round((career.totalLosses / totalMatches) * 100)
      : 0;

  const goalDifference = career.goalsFor - career.goalsAgainst;

  const xpRequired = Math.max(career.level * 1000, 1000);

  const xpProgress = Math.min(
    Math.round((career.xp / xpRequired) * 100),
    100
  );

  const formMatches = matches
    .filter((match) => match.result || match.status === 'finished')
    .slice(0, 5);

  const getResult = (match) => {
    const result = match.result || {};
    const homeScore = safeNumber(result.homeScore ?? match.homeScore);
    const awayScore = safeNumber(result.awayScore ?? match.awayScore);

    if (
      match.homeScore === undefined &&
      match.awayScore === undefined &&
      !match.result
    ) {
      return null;
    }

    const isHome =
      match.homeClubId === career.currentClub ||
      match.homeTeamId === career.currentClub;

    const userScore = isHome ? homeScore : awayScore;
    const opponentScore = isHome ? awayScore : homeScore;

    if (userScore > opponentScore) return 'W';
    if (userScore === opponentScore) return 'D';
    return 'L';
  };

  const getResultClass = (result) => {
    if (result === 'W') return styles.formWin;
    if (result === 'D') return styles.formDraw;
    if (result === 'L') return styles.formLoss;
    return styles.formUnknown;
  };

  const getOpponentName = (match) => {
    const isHome =
      match.homeClubId === career.currentClub ||
      match.homeTeamId === career.currentClub;

    return isHome
      ? match.awayClubName || match.awayTeam || 'Away'
      : match.homeClubName || match.homeTeam || 'Home';
  };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>Career - Virtual Football Manager</title>
        <meta
          name="description"
          content="View your football manager career, statistics, club, achievements and progress."
        />
      </Head>

      <main className={styles.page}>
        {/* HERO */}
        <section className={styles.hero}>
          <div className={styles.heroGlow}></div>

          <div className={styles.profileArea}>
            <div className={styles.avatar}>
              {userData?.photoURL ? (
                <img src={userData.photoURL} alt="Profile" />
              ) : (
                <span>
                  {(userData?.displayName || user?.email || 'M')
                    .charAt(0)
                    .toUpperCase()}
                </span>
              )}
            </div>

            <div className={styles.profileInfo}>
              <div className={styles.roleBadge}>
                <span>⚽</span>
                FOOTBALL MANAGER
              </div>

              <h1>
                {userData?.displayName ||
                  user?.email?.split('@')[0] ||
                  'Manager'}
              </h1>

              <p>{clubInfo?.name || 'Independent Manager'}</p>

              <div className={styles.meta}>
                <span>🏆 Level {career.level}</span>
                <span>⭐ {career.reputation} Reputation</span>
                <span>📅 Season {career.seasons}</span>
              </div>
            </div>
          </div>

          <div className={styles.heroStats}>
            <div>
              <strong>{career.totalMatches}</strong>
              <span>Matches</span>
            </div>
            <div>
              <strong>{career.totalWins}</strong>
              <span>Wins</span>
            </div>
            <div>
              <strong>{career.goalsFor}</strong>
              <span>Goals</span>
            </div>
            <div>
              <strong>{career.trophies}</strong>
              <span>Trophies</span>
            </div>
          </div>
        </section>

        {/* XP */}
        <section className={styles.xpCard}>
          <div className={styles.xpHeader}>
            <div>
              <span className={styles.sectionLabel}>CAREER PROGRESS</span>
              <h2>Level {career.level}</h2>
            </div>
            <strong>
              {career.xp.toLocaleString()} / {xpRequired.toLocaleString()} XP
            </strong>
          </div>

          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: `${xpProgress}%` }}
            ></div>
          </div>

          <div className={styles.xpFooter}>
            <span>{xpProgress}% completed</span>
            <span>{Math.max(xpRequired - career.xp, 0)} XP to next level</span>
          </div>
        </section>

        {/* MAIN GRID */}
        <section className={styles.mainGrid}>
          {/* CAREER STATISTICS */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.sectionLabel}>PERFORMANCE</span>
                <h2>Career Statistics</h2>
              </div>
              <span className={styles.headerIcon}>📊</span>
            </div>

            <div className={styles.statsList}>
              <div className={styles.statRow}>
                <span>Matches Played</span>
                <strong>{career.totalMatches}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Wins</span>
                <strong className={styles.green}>{career.totalWins}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Draws</span>
                <strong className={styles.yellow}>{career.totalDraws}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Losses</span>
                <strong className={styles.red}>{career.totalLosses}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Goals Scored</span>
                <strong>{career.goalsFor}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Goals Conceded</span>
                <strong>{career.goalsAgainst}</strong>
              </div>
              <div className={styles.statRow}>
                <span>Goal Difference</span>
                <strong className={goalDifference >= 0 ? styles.green : styles.red}>
                  {goalDifference >= 0 ? '+' : ''}
                  {goalDifference}
                </strong>
              </div>
              <div className={styles.statRow}>
                <span>Clean Sheets</span>
                <strong>{career.cleanSheets}</strong>
              </div>
              <div className={styles.statRow}>
                <span>League Points</span>
                <strong>{career.points}</strong>
              </div>
            </div>
          </div>

          {/* WIN RATE */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.sectionLabel}>RESULTS</span>
                <h2>Match Record</h2>
              </div>
              <span className={styles.headerIcon}>🏆</span>
            </div>

            <div
              className={styles.recordCircle}
              style={{
                background: `conic-gradient(#22c55e 0% ${winRate}%, #f59e0b ${winRate}% ${winRate + drawRate}%, #ef4444 ${winRate + drawRate}% 100%)`,
              }}
            >
              <div className={styles.circleInner}>
                <strong>{winRate}%</strong>
                <span>Win Rate</span>
              </div>
            </div>

            <div className={styles.recordLegend}>
              <div>
                <span className={styles.legendDotGreen}></span>
                <span>Wins</span>
                <strong>{career.totalWins}</strong>
              </div>
              <div>
                <span className={styles.legendDotYellow}></span>
                <span>Draws</span>
                <strong>{career.totalDraws}</strong>
              </div>
              <div>
                <span className={styles.legendDotRed}></span>
                <span>Losses</span>
                <strong>{career.totalLosses}</strong>
              </div>
            </div>

            <div className={styles.rateGrid}>
              <div>
                <strong>{winRate}%</strong>
                <span>Win Rate</span>
              </div>
              <div>
                <strong>{drawRate}%</strong>
                <span>Draw Rate</span>
              </div>
              <div>
                <strong>{lossRate}%</strong>
                <span>Loss Rate</span>
              </div>
            </div>
          </div>
        </section>

        {/* CLUB */}
        <section className={styles.clubCard}>
          <div className={styles.clubLogoLarge}>
            {clubInfo?.logo ? (
              <img src={clubInfo.logo} alt={clubInfo.name} />
            ) : (
              '⚽'
            )}
          </div>

          <div className={styles.clubContent}>
            <span className={styles.sectionLabel}>CURRENT CLUB</span>
            <h2>{clubInfo?.name || 'No Club'}</h2>
            <p>
              {clubInfo?.leagueName ||
                safeString(clubInfo?.league, 'You are currently not assigned to a club.')}
            </p>

            {clubInfo && (
              <div className={styles.clubMeta}>
                {clubInfo.stadium && <span>🏟️ {clubInfo.stadium}</span>}
                {clubInfo.countryName && <span>🌍 {clubInfo.countryName}</span>}
              </div>
            )}
          </div>

          <div className={styles.clubPosition}>
            <span>LEAGUE POSITION</span>
            <strong>{career.currentPosition}</strong>
          </div>
        </section>

        {/* LOWER GRID */}
        <section className={styles.lowerGrid}>
          {/* FORM */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.sectionLabel}>RECENT FORM</span>
                <h2>Last Matches</h2>
              </div>
              <span className={styles.headerIcon}>📈</span>
            </div>

            {formMatches.length > 0 ? (
              <div className={styles.formMatches}>
                {formMatches.map((match) => {
                  const result = getResult(match);
                  const opponentName = getOpponentName(match);
                  const resultData = match.result || {};
                  const homeScore = safeNumber(
                    resultData.homeScore ?? match.homeScore
                  );
                  const awayScore = safeNumber(
                    resultData.awayScore ?? match.awayScore
                  );

                  return (
                    <div key={match.id} className={styles.matchItem}>
                      <div
                        className={`${styles.formBadge} ${getResultClass(result)}`}
                      >
                        {result || '?'}
                      </div>

                      <div className={styles.matchDetails}>
                        <strong>vs {opponentName}</strong>
                        <span>
                          {homeScore} - {awayScore}
                        </span>
                      </div>

                      <span className={styles.matchDate}>
                        {match.date
                          ? new Date(match.date).toLocaleDateString()
                          : '-'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <span>⚽</span>
                <p>No matches played yet.</p>
              </div>
            )}
          </div>

          {/* ACHIEVEMENTS */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.sectionLabel}>ACHIEVEMENTS</span>
                <h2>Career Milestones</h2>
              </div>
              <span className={styles.headerIcon}>🏅</span>
            </div>

            <div className={styles.achievements}>
              <div
                className={`${styles.achievement} ${
                  career.totalMatches >= 1 ? styles.unlocked : ''
                }`}
              >
                <div>🎮</div>
                <span>
                  <strong>First Match</strong>
                  <small>Play your first career match</small>
                </span>
                {career.totalMatches >= 1 && <b>✓</b>}
              </div>

              <div
                className={`${styles.achievement} ${
                  career.totalWins >= 10 ? styles.unlocked : ''
                }`}
              >
                <div>🔥</div>
                <span>
                  <strong>Winning Manager</strong>
                  <small>Win 10 matches</small>
                </span>
                {career.totalWins >= 10 && <b>✓</b>}
              </div>

              <div
                className={`${styles.achievement} ${
                  career.goalsFor >= 50 ? styles.unlocked : ''
                }`}
              >
                <div>⚽</div>
                <span>
                  <strong>Goal Machine</strong>
                  <small>Score 50 goals</small>
                </span>
                {career.goalsFor >= 50 && <b>✓</b>}
              </div>

              <div
                className={`${styles.achievement} ${
                  career.trophies >= 1 ? styles.unlocked : ''
                }`}
              >
                <div>🏆</div>
                <span>
                  <strong>Champion</strong>
                  <small>Win your first trophy</small>
                </span>
                {career.trophies >= 1 && <b>✓</b>}
              </div>

              <div
                className={`${styles.achievement} ${
                  career.cleanSheets >= 5 ? styles.unlocked : ''
                }`}
              >
                <div>🧤</div>
                <span>
                  <strong>Defensive Wall</strong>
                  <small>Keep 5 clean sheets</small>
                </span>
                {career.cleanSheets >= 5 && <b>✓</b>}
              </div>
            </div>
          </div>
        </section>

        {/* CAREER TIMELINE */}
        <section className={styles.timelineCard}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.sectionLabel}>YOUR JOURNEY</span>
              <h2>Career Timeline</h2>
            </div>
            <span className={styles.headerIcon}>🕐</span>
          </div>

          <div className={styles.timeline}>
            <div className={styles.timelineItem}>
              <div className={styles.timelineIcon}>🚀</div>
              <div>
                <strong>Career Started</strong>
                <p>Your football management journey began.</p>
              </div>
            </div>

            <div className={styles.timelineItem}>
              <div className={styles.timelineIcon}>🏟️</div>
              <div>
                <strong>Joined {clubInfo?.name || 'your first club'}</strong>
                <p>You became part of a professional football club.</p>
              </div>
            </div>

            <div className={styles.timelineItem}>
              <div className={styles.timelineIcon}>⭐</div>
              <div>
                <strong>Reached Level {career.level}</strong>
                <p>Your experience and reputation continue to grow.</p>
              </div>
            </div>

            <div className={styles.timelineItem}>
              <div className={styles.timelineIcon}>📊</div>
              <div>
                <strong>
                  {career.totalWins} Wins in {career.totalMatches} Matches
                </strong>
                <p>
                  Win rate of {winRate}% across your managerial career.
                </p>
              </div>
            </div>

            {career.trophies > 0 && (
              <div className={styles.timelineItem}>
                <div className={styles.timelineIcon}>🏆</div>
                <div>
                  <strong>
                    {career.trophies} Trophy
                    {career.trophies !== 1 ? 's' : ''}
                  </strong>
                  <p>You have added silverware to your career.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
