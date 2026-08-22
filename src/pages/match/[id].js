// pages/match/[id].js

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../components/firebase';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';

// Import Three.js pitch with dynamic import (no SSR)
const ThreePitch = dynamic(
  () => import('../../components/ThreePitch'),
  { ssr: false, loading: () => <div className="pitch-loading">Loading 3D pitch...</div> }
);

import styles from './match.module.css';

// ============================================================
// CONSTANTS
// ============================================================

const MATCH_DURATION = 90;
const FIRST_HALF_END = 45;
const MAX_SUBSTITUTIONS = 5;
const PLAYERS_ON_PITCH = 11;
const MATCH_TICK_MS = 1000;

// ============================================================
// HELPERS
// ============================================================

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPlayerName(player) {
  return player?.name || player?.fullName || 
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() || 
    'Unknown Player';
}

function getPlayerPosition(player) {
  return player?.position || player?.primaryPosition || 'MID';
}

function getPlayerOverall(player) {
  return clamp(safeNumber(player?.overall || player?.rating || 60), 35, 99);
}

function playerId(player) {
  return player?.id || player?.playerId || null;
}

function normalizePosition(position) {
  const value = String(position || '').trim().toLowerCase();
  if (value.includes('goal') || value === 'gk') return 'GK';
  if (value.includes('def')) return 'DEF';
  if (value.includes('mid')) return 'MID';
  if (value.includes('attack') || value.includes('forward') || value.includes('striker')) return 'ATT';
  return 'MID';
}

function formatPossession(value) {
  return `${Number(value).toFixed(1)}%`;
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

// ============================================================
// DEFAULT STATS
// ============================================================

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
    saves: 0,
    tackles: 0,
    interceptions: 0,
  };
}

// ============================================================
// MATCH PAGE
// ============================================================

export default function MatchPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { id } = router.query;

  // State
  const [match, setMatch] = useState(null);
  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);
  const [homeXI, setHomeXI] = useState([]);
  const [awayXI, setAwayXI] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Match state
  const [matchMinute, setMatchMinute] = useState(0);
  const [matchStatus, setMatchStatus] = useState('loading');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [events, setEvents] = useState([]);
  const [homeStats, setHomeStats] = useState(createDefaultStats());
  const [awayStats, setAwayStats] = useState(createDefaultStats());
  const [isPaused, setIsPaused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [injuryTime, setInjuryTime] = useState({ firstHalf: 0, secondHalf: 0 });

  // Refs for simulation
  const timerRef = useRef(null);
  const processingRef = useRef(false);
  const scoreRef = useRef({ home: 0, away: 0 });
  const statsRef = useRef({ home: createDefaultStats(), away: createDefaultStats() });
  const eventsRef = useRef([]);
  const minuteRef = useRef(0);

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  useEffect(() => {
    if (authLoading || !id || !user) return;

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError(null);

        const matchRef = doc(db, 'matches', id);
        const matchSnap = await getDoc(matchRef);

        if (!matchSnap.exists()) {
          setError('Match not found in database');
          setLoading(false);
          return;
        }

        const matchData = { id: matchSnap.id, ...matchSnap.data() };
        
        if (cancelled) return;
        setMatch(matchData);

        // Load clubs
        const [homeSnap, awaySnap] = await Promise.all([
          matchData.homeClubId ? getDoc(doc(db, 'clubs', matchData.homeClubId)) : null,
          matchData.awayClubId ? getDoc(doc(db, 'clubs', matchData.awayClubId)) : null,
        ]);

        if (cancelled) return;

        const home = homeSnap?.exists() ? { id: homeSnap.id, ...homeSnap.data() } : 
          { id: matchData.homeClubId, name: matchData.homeClubName || 'Home' };
        const away = awaySnap?.exists() ? { id: awaySnap.id, ...awaySnap.data() } : 
          { id: matchData.awayClubId, name: matchData.awayClubName || 'Away' };

        setHomeClub(home);
        setAwayClub(away);

        // Load players for starting XI
        const [homePlayers, awayPlayers] = await Promise.all([
          loadClubPlayers(matchData.homeClubId),
          loadClubPlayers(matchData.awayClubId),
        ]);

        if (cancelled) return;

        // Select starting XI
        const formation = matchData.formation || '4-4-2';
        const startingHome = selectStartingXI(homePlayers, formation);
        const startingAway = selectStartingXI(awayPlayers, formation);

        setHomeXI(startingHome);
        setAwayXI(startingAway);

        // Apply saved match state
        if (matchData.status === 'live' || matchData.status === 'half-time') {
          const savedHomeScore = safeNumber(matchData.homeScore, 0);
          const savedAwayScore = safeNumber(matchData.awayScore, 0);
          
          scoreRef.current = { home: savedHomeScore, away: savedAwayScore };
          statsRef.current = {
            home: { ...createDefaultStats(), ...matchData.homeStats },
            away: { ...createDefaultStats(), ...matchData.awayStats },
          };
          eventsRef.current = matchData.events || [];
          minuteRef.current = safeNumber(matchData.minute, 0);

          setHomeScore(savedHomeScore);
          setAwayScore(savedAwayScore);
          setMatchMinute(minuteRef.current);
          setEvents([...eventsRef.current]);
          setHomeStats({ ...statsRef.current.home });
          setAwayStats({ ...statsRef.current.away });
          setMatchStatus(matchData.status);
        } else if (matchData.status === 'finished') {
          scoreRef.current = { 
            home: safeNumber(matchData.result?.homeScore || matchData.homeScore, 0),
            away: safeNumber(matchData.result?.awayScore || matchData.awayScore, 0),
          };
          setHomeScore(scoreRef.current.home);
          setAwayScore(scoreRef.current.away);
          setMatchStatus('finished');
          setMatchMinute(90 + safeNumber(matchData.injuryTimeFirstHalf, 0) + safeNumber(matchData.injuryTimeSecondHalf, 0));
        } else {
          setMatchStatus('ready');
          setMatchMinute(0);
        }

        // Injury time
        setInjuryTime({
          firstHalf: safeNumber(matchData.injuryTimeFirstHalf, Math.floor(Math.random() * 3) + 1),
          secondHalf: safeNumber(matchData.injuryTimeSecondHalf, Math.floor(Math.random() * 3) + 1),
        });

      } catch (err) {
        console.error('Match load error:', err);
        setError('Failed to load match: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMatch();
    return () => { cancelled = true; };
  }, [id, user, authLoading]);

  // ==========================================================
  // TIMER
  // ==========================================================

  useEffect(() => {
    if (matchStatus !== 'live' || isPaused || loading) return;

    timerRef.current = setInterval(() => {
      setMatchMinute(prev => {
        const next = prev + 1;
        minuteRef.current = next;

        const firstHalfTotal = 45 + injuryTime.firstHalf;
        const fullMatchTotal = 90 + injuryTime.firstHalf + injuryTime.secondHalf;

        if (next === firstHalfTotal && prev < firstHalfTotal) {
          setMatchStatus('half-time');
          setIsPaused(true);
          saveMatchState('half-time');
          return next;
        }

        if (next >= fullMatchTotal) {
          finishMatch();
          return fullMatchTotal;
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
  }, [matchStatus, isPaused, loading, injuryTime]);

  // ==========================================================
  // SIMULATE MINUTE
  // ==========================================================

  useEffect(() => {
    if (matchStatus !== 'live' || isPaused || loading || matchMinute <= 0) return;
    if (processingRef.current) return;

    // Simulate 10 actions per minute
    for (let i = 0; i < 10; i++) {
      simulateAction();
    }

    // Update UI
    setHomeScore(scoreRef.current.home);
    setAwayScore(scoreRef.current.away);
    setHomeStats({ ...statsRef.current.home });
    setAwayStats({ ...statsRef.current.away });
    setEvents([...eventsRef.current]);

    // Save every 5 minutes
    if (matchMinute % 5 === 0) {
      saveMatchState('live');
    }
  }, [matchMinute, matchStatus, isPaused, loading]);

  // ==========================================================
  // SIMULATE ACTION
  // ==========================================================

  const simulateAction = useCallback(() => {
    if (homeXI.length < 11 || awayXI.length < 11) return;

    // Calculate team strengths
    const homeStrength = calculateTeamStrength(homeXI);
    const awayStrength = calculateTeamStrength(awayXI);

    // Update possession
    const possessionShift = clamp((homeStrength - awayStrength) * 0.003 + (Math.random() - 0.5) * 0.04, -0.35, 0.35);
    const currentPos = safeNumber(statsRef.current.home.possession, 50);
    const nextPos = clamp(currentPos + possessionShift, 20, 80);
    statsRef.current.home.possession = Number(nextPos.toFixed(1));
    statsRef.current.away.possession = Number((100 - nextPos).toFixed(1));

    // Choose team with possession
    const homeChance = nextPos / 100;
    const team = Math.random() < homeChance ? 'home' : 'away';
    const players = team === 'home' ? homeXI : awayXI;
    const opponentPlayers = team === 'home' ? awayXI : homeXI;
    const attackingStrength = team === 'home' ? homeStrength : awayStrength;
    const defendingStrength = team === 'home' ? awayStrength : homeStrength;

    // Select attacker
    const attackers = players.filter(p => {
      const pos = normalizePosition(getPlayerPosition(p));
      return pos === 'ATT' || pos === 'MID';
    });
    const selected = attackers.length > 0 ? attackers[Math.floor(Math.random() * attackers.length)] : players[0];
    if (!selected) return;

    const playerPos = normalizePosition(getPlayerPosition(selected));
    const playerOVR = getPlayerOverall(selected);

    // Action: Pass
    if (Math.random() < 0.45 + (playerOVR - 50) * 0.003) {
      const teammates = players.filter(p => p.id !== selected.id);
      if (teammates.length > 0) {
        const target = teammates[Math.floor(Math.random() * teammates.length)];
        statsRef.current[team].passes += 1;
      }
      return;
    }

    // Action: Shot
    const shotProbability = clamp(
      0.24 * (0.75 + playerOVR / 100 * 0.55) * (attackingStrength / 50) / (defendingStrength / 50),
      0.02, 0.55
    );

    if (Math.random() < shotProbability) {
      statsRef.current[team].shots += 1;

      // On target?
      if (Math.random() < 0.42 + playerOVR / 100 * 0.32) {
        statsRef.current[team].shotsOnTarget += 1;

        // Goal?
        const goalProb = clamp(
          0.27 * (attackingStrength / 100) * (playerOVR / 100) * (1 - (defendingStrength - 50) / 300),
          0.04, 0.65
        );

        if (Math.random() < goalProb) {
          // GOAL!
          scoreRef.current[team] += 1;
          const event = {
            id: `goal-${Date.now()}`,
            type: 'goal',
            team,
            minute: minuteRef.current,
            playerName: getPlayerName(selected),
            detail: `${getPlayerName(selected)} scored!`,
          };
          eventsRef.current = [event, ...eventsRef.current];
          toast.success(`⚽ ${getPlayerName(selected)} scored!`);
        } else {
          // Save
          const defendingTeam = team === 'home' ? 'away' : 'home';
          statsRef.current[defendingTeam].saves += 1;
        }
      }
    }

    // Foul
    if (Math.random() < 0.015) {
      statsRef.current[team].fouls += 1;
    }

    // Corner
    if (Math.random() < 0.018) {
      statsRef.current[team].corners += 1;
    }

  }, [homeXI, awayXI]);

  // ==========================================================
  // SAVE MATCH STATE
  // ==========================================================

  const saveMatchState = useCallback(async (status) => {
    if (!match?.id || !user) return;

    try {
      setIsSaving(true);

      const matchRef = doc(db, 'matches', match.id);
      await updateDoc(matchRef, {
        status: status || matchStatus,
        minute: minuteRef.current,
        homeScore: scoreRef.current.home,
        awayScore: scoreRef.current.away,
        result: {
          homeScore: scoreRef.current.home,
          awayScore: scoreRef.current.away,
        },
        events: eventsRef.current,
        homeStats: statsRef.current.home,
        awayStats: statsRef.current.away,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Save match error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [match, user, matchStatus]);

  // ==========================================================
  // FINISH MATCH
  // ==========================================================

  const finishMatch = useCallback(async () => {
    if (matchStatus === 'finished') return;

    setMatchStatus('finished');
    setIsPaused(true);

    await saveMatchState('finished');

    const home = scoreRef.current.home;
    const away = scoreRef.current.away;
    const winner = home > away ? 'Home' : home < away ? 'Away' : 'Draw';
    toast.success(`Full time: ${home} - ${away} (${winner})`);
  }, [matchStatus, saveMatchState]);

  // ==========================================================
  // PLAY MATCH
  // ==========================================================

  const startMatch = useCallback(async () => {
    if (matchStatus !== 'ready' && matchStatus !== 'half-time') return;

    const status = matchStatus === 'half-time' ? 'live' : 'live';
    setMatchStatus(status);
    setIsPaused(false);

    await saveMatchState(status);
    toast.success('Match started!');
  }, [matchStatus, saveMatchState]);

  const togglePause = useCallback(() => {
    if (matchStatus !== 'live') return;
    setIsPaused(prev => !prev);
    saveMatchState(matchStatus);
  }, [matchStatus, saveMatchState]);

  // ==========================================================
  // HELPER FUNCTIONS (Client-side)
  // ==========================================================

  function calculateTeamStrength(players) {
    if (!Array.isArray(players) || players.length === 0) return 60;
    const total = players.reduce((sum, p) => sum + getPlayerOverall(p), 0);
    return total / players.length;
  }

  function selectStartingXI(squad, formation) {
    if (!Array.isArray(squad) || squad.length === 0) return [];
    // Simple selection: pick highest rated players
    const sorted = [...squad].sort((a, b) => getPlayerOverall(b) - getPlayerOverall(a));
    return sorted.slice(0, PLAYERS_ON_PITCH);
  }

  async function loadClubPlayers(clubId) {
    if (!clubId) return [];
    try {
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const playersQuery = query(
        collection(db, 'players'),
        where('clubId', '==', clubId)
      );
      const snapshot = await getDocs(playersQuery);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('Load players error:', err);
      return [];
    }
  }

  // ==========================================================
  // RENDER
  // ==========================================================

  if (authLoading || loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading match...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorIcon}>⚠️</div>
        <h1>Match Error</h1>
        <p>{error}</p>
        <button onClick={() => router.push('/fixtures')}>Back to Fixtures</button>
      </div>
    );
  }

  if (!match || !homeClub || !awayClub) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorIcon}>⚽</div>
        <h1>Match Not Found</h1>
        <button onClick={() => router.push('/fixtures')}>Back to Fixtures</button>
      </div>
    );
  }

  // Status label
  const statusLabel = matchStatus === 'ready' ? 'READY' : 
    matchStatus === 'live' ? (isPaused ? 'PAUSED' : 'LIVE') :
    matchStatus === 'half-time' ? 'HALF TIME' : 'FULL TIME';

  // Display minute
  const displayMinute = matchMinute > 90 ? `${90}+${matchMinute - 90}` : matchMinute;
  const fullDuration = 90 + injuryTime.firstHalf + injuryTime.secondHalf;

  return (
    <>
      <Head>
        <title>{homeClub.name} vs {awayClub.name} | Match</title>
      </Head>

      <main className={styles.page}>
        {/* Header */}
        <header className={styles.header}>
          <button className={styles.backButton} onClick={() => router.push('/fixtures')}>
            ← Fixtures
          </button>
          <h1>Match Centre</h1>
          <span className={`${styles.status} ${matchStatus === 'live' ? styles.live : ''}`}>
            {statusLabel}
          </span>
        </header>

        {/* 3D Pitch */}
        <div className={styles.pitchContainer}>
          <ThreePitch
            homeXI={homeXI}
            awayXI={awayXI}
            homeColor={homeClub.primaryColor || '#3b82f6'}
            awayColor={awayClub.primaryColor || '#ef4444'}
            ballPossession={null}
            formation={match.formation || '4-4-2'}
          />
        </div>

        {/* Scoreboard */}
        <section className={styles.scoreboard}>
          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {homeClub.logo ? <img src={homeClub.logo} alt="" /> : '⚽'}
            </div>
            <strong>{homeClub.name}</strong>
            <span className={styles.badge}>HOME</span>
          </div>

          <div className={styles.scoreMiddle}>
            <div className={styles.score}>
              <strong className={styles.homeScore}>{homeScore}</strong>
              <span>-</span>
              <strong className={styles.awayScore}>{awayScore}</strong>
            </div>
            <div className={styles.matchClock}>{displayMinute}'</div>
            <small>{statusLabel}</small>
          </div>

          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {awayClub.logo ? <img src={awayClub.logo} alt="" /> : '⚽'}
            </div>
            <strong>{awayClub.name}</strong>
            <span className={styles.badge}>AWAY</span>
          </div>
        </section>

        {/* Controls */}
        <section className={styles.controls}>
          {matchStatus === 'ready' && (
            <button className={styles.primaryButton} onClick={startMatch} disabled={isSaving}>
              ▶ START MATCH
            </button>
          )}

          {matchStatus === 'half-time' && (
            <button className={styles.primaryButton} onClick={startMatch} disabled={isSaving}>
              ▶ START SECOND HALF
            </button>
          )}

          {matchStatus === 'live' && (
            <>
              <button onClick={togglePause} disabled={isSaving}>
                {isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button onClick={finishMatch} disabled={isSaving}>
                ⏹ Finish
              </button>
            </>
          )}

          {matchStatus === 'finished' && (
            <button onClick={() => router.push('/fixtures')}>
              Back to Fixtures
            </button>
          )}
        </section>

        {/* Stats */}
        <section className={styles.statsSection}>
          <div className={styles.sectionHeader}>
            <span>MATCH STATISTICS</span>
            <strong>{homeScore} - {awayScore}</strong>
          </div>

          {[
            ['Possession', formatPossession(homeStats.possession), formatPossession(awayStats.possession)],
            ['Shots', homeStats.shots, awayStats.shots],
            ['Shots on Target', homeStats.shotsOnTarget, awayStats.shotsOnTarget],
            ['Passes', homeStats.passes, awayStats.passes],
            ['Fouls', homeStats.fouls, awayStats.fouls],
            ['Corners', homeStats.corners, awayStats.corners],
            ['Saves', homeStats.saves, awayStats.saves],
            ['Tackles', homeStats.tackles, awayStats.tackles],
          ].map(row => (
            <div key={row[0]} className={styles.statRow}>
              <strong className={styles.homeStat}>{row[1]}</strong>
              <span>{row[0]}</span>
              <strong className={styles.awayStat}>{row[2]}</strong>
            </div>
          ))}
        </section>

        {/* Events */}
        <section className={styles.eventsSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>LIVE FEED</span>
              <h2>Match Events</h2>
            </div>
          </div>
          <div className={styles.eventsList}>
            {events.length > 0 ? (
              events.slice(0, 30).map(event => (
                <div key={event.id} className={styles.event}>
                  <span className={styles.eventMinute}>
                    {event.minute > 90 ? `${90}+${event.minute - 90}` : event.minute}'
                  </span>
                  <span className={styles.eventIcon}>
                    {event.type === 'goal' ? '⚽' : 
                     event.type === 'save' ? '🧤' : 
                     event.type === 'shot' ? '💥' : '🔄'}
                  </span>
                  <div>
                    <strong>{event.type.toUpperCase()}</strong>
                    <p>{event.detail || event.playerName}</p>
                  </div>
                  <span className={event.team === 'home' ? styles.homeEvent : styles.awayEvent}>
                    {event.team === 'home' ? homeClub.name : awayClub.name}
                  </span>
                </div>
              ))
            ) : (
              <div className={styles.noEvents}>No events yet. Match in progress...</div>
            )}
          </div>
        </section>

        {/* Lineups */}
        <section className={styles.lineups}>
          <div className={styles.lineupCard}>
            <h3>{homeClub.name} <small>Starting XI</small></h3>
            {homeXI.slice(0, 11).map(player => (
              <div key={player.id} className={styles.lineupPlayer}>
                <span>{getPlayerName(player)}</span>
                <span className={styles.playerRating}>{getPlayerOverall(player)}</span>
              </div>
            ))}
          </div>

          <div className={styles.lineupCard}>
            <h3>{awayClub.name} <small>Starting XI</small></h3>
            {awayXI.slice(0, 11).map(player => (
              <div key={player.id} className={styles.lineupPlayer}>
                <span>{getPlayerName(player)}</span>
                <span className={styles.playerRating}>{getPlayerOverall(player)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Match Info */}
        <section className={styles.matchInfo}>
          <div>
            <span>STADIUM</span>
            <strong>{match.stadium || 'Unknown Stadium'}</strong>
          </div>
          <div>
            <span>LEAGUE</span>
            <strong>{match.leagueName || match.competition || 'Friendly'}</strong>
          </div>
          <div>
            <span>DATE</span>
            <strong>{match.date ? new Date(match.date).toLocaleDateString() : '-'}</strong>
          </div>
          <div>
            <span>INJURY TIME</span>
            <strong>+{injuryTime.firstHalf} / +{injuryTime.secondHalf}</strong>
          </div>
        </section>
      </main>
    </>
  );
}
