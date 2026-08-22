// src/pages/match/[id].jsx

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../../components/firebase';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

import ThreePitch from '../../components/ThreePitch';
import { useMatchEngine } from '../../hooks/useMatchEngine';
import { FORMATIONS, TACTICS, MATCH_DURATION } from '../../utils/matchConstants';
import {
  getClubName,
  getClubLogo,
  getClubPrimaryColor,
  getPlayerName,
  getPlayerPosition,
  getPlayerOverall,
  playerId,
  calculateTeamStrength,
  clamp,
  safeNumber,
  normalizePosition,
} from '../../utils/matchHelpers';

import styles from './match.module.css';

export default function MatchPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const matchId = typeof router.query.id === 'string' ? router.query.id : null;

  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);
  const [homeXI, setHomeXI] = useState([]);
  const [awayXI, setAwayXI] = useState([]);
  const [homeSquad, setHomeSquad] = useState([]);
  const [awaySquad, setAwaySquad] = useState([]);
  const [formation, setFormation] = useState('4-4-2');
  const [tactic, setTactic] = useState('Tiki-Taka');
  const [mentality, setMentality] = useState('balanced');
  const [loadingMatch, setLoadingMatch] = useState(true);
  const [userClubId, setUserClubId] = useState(null);
  const [injuryTimeFirstHalf, setInjuryTimeFirstHalf] = useState(0);
  const [injuryTimeSecondHalf, setInjuryTimeSecondHalf] = useState(0);
  const [halfTimeShown, setHalfTimeShown] = useState(false);
  const [showFormation, setShowFormation] = useState(false);
  const [showTactics, setShowTactics] = useState(false);
  const [showSubs, setShowSubs] = useState(false);

  const {
    matchMinute,
    setMatchMinute,
    matchStatus,
    setMatchStatus,
    homeScore,
    awayScore,
    events,
    homeStats,
    awayStats,
    substitutionsUsed,
    setSubstitutionsUsed,
    playerStamina,
    setPlayerStamina,
    ballPossession,
    setBallPossession,
    isPaused,
    setIsPaused,
    scoreRef,
    eventsRef,
    statsRef,
    staminaRef,
    simulateMinute,
  } = useMatchEngine();

  const isHomeUser = String(userClubId) === String(homeClub?.id);
  const isAwayUser = String(userClubId) === String(awayClub?.id);
  const userIsParticipant = isHomeUser || isAwayUser;
  const userTeam = isHomeUser ? 'home' : isAwayUser ? 'away' : null;

  // Load user club
  useEffect(() => {
    if (loading || !user) return;
    const loadUserClub = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          const clubId = data.careerData?.currentClub || data.currentClub || data.clubId;
          setUserClubId(clubId);
        }
      } catch (err) {
        console.error('User club error:', err);
      }
    };
    loadUserClub();
  }, [user, loading]);

  // Load match
  useEffect(() => {
    if (loading || !user || !matchId) return;

    const loadMatch = async () => {
      try {
        setLoadingMatch(true);
        const matchRef = doc(db, 'matches', matchId);
        const matchSnap = await getDoc(matchRef);

        if (!matchSnap.exists()) {
          toast.error('Match not found');
          router.push('/fixtures');
          return;
        }

        const match = { id: matchSnap.id, ...matchSnap.data() };

        const homeId = match.homeClubId || match.homeTeamId;
        const awayId = match.awayClubId || match.awayTeamId;

        if (!homeId || !awayId) {
          toast.error('Invalid teams');
          return;
        }

        const [homeSnap, awaySnap] = await Promise.all([
          getDoc(doc(db, 'clubs', homeId)),
          getDoc(doc(db, 'clubs', awayId)),
        ]);

        const home = homeSnap.exists() ? { id: homeSnap.id, ...homeSnap.data() } : { id: homeId, name: 'Home' };
        const away = awaySnap.exists() ? { id: awaySnap.id, ...awaySnap.data() } : { id: awayId, name: 'Away' };

        setHomeClub(home);
        setAwayClub(away);

        // Load players
        const [homePlayers, awayPlayers] = await Promise.all([
          loadClubPlayers(homeId),
          loadClubPlayers(awayId),
        ]);

        setHomeSquad(homePlayers);
        setAwaySquad(awayPlayers);

        // Select starting XI
        const startingHome = selectStartingXI(homePlayers, formation);
        const startingAway = selectStartingXI(awayPlayers, formation);

        setHomeXI(startingHome);
        setAwayXI(startingAway);

        // Init stamina
        const homeStamina = {};
        const awayStamina = {};
        startingHome.forEach(p => { homeStamina[playerId(p)] = 100; });
        startingAway.forEach(p => { awayStamina[playerId(p)] = 100; });
        staminaRef.current = { home: homeStamina, away: awayStamina };
        setPlayerStamina({ home: homeStamina, away: awayStamina });

        // Apply match state if exists
        if (match.status === 'live' || match.status === 'half-time') {
          scoreRef.current = { home: match.homeScore || 0, away: match.awayScore || 0 };
          statsRef.current = { home: match.homeStats || createDefaultStats(), away: match.awayStats || createDefaultStats() };
          eventsRef.current = match.events || [];
          setMatchMinute(match.minute || 0);
          setMatchStatus(match.status);
          setHomeScore(scoreRef.current.home);
          setAwayScore(scoreRef.current.away);
          setEvents(eventsRef.current);
          setHomeStats(statsRef.current.home);
          setAwayStats(statsRef.current.away);
        }

        setInjuryTimeFirstHalf(match.injuryTimeFirstHalf || Math.floor(Math.random() * 4) + 1);
        setInjuryTimeSecondHalf(match.injuryTimeSecondHalf || Math.floor(Math.random() * 4) + 1);

      } catch (err) {
        console.error('Match load error:', err);
        toast.error('Could not load match');
      } finally {
        setLoadingMatch(false);
      }
    };

    loadMatch();
  }, [loading, user, matchId, router]);

  // Timer
  useEffect(() => {
    if (matchStatus !== 'live' || isPaused) return;

    const timer = setInterval(() => {
      setMatchMinute(prev => {
        const next = prev + 1;
        const firstHalfTotal = 45 + injuryTimeFirstHalf;
        const fullTotal = 90 + injuryTimeFirstHalf + injuryTimeSecondHalf;

        if (next === firstHalfTotal && prev < firstHalfTotal) {
          setMatchStatus('half-time');
          setHalfTimeShown(true);
          return next;
        }
        if (next >= fullTotal) {
          finishMatch();
          return fullTotal;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [matchStatus, isPaused, injuryTimeFirstHalf, injuryTimeSecondHalf]);

  // Simulate minute
  useEffect(() => {
    if (matchStatus !== 'live' || isPaused || matchMinute <= 0) return;
    if (matchMinute >= 90 + injuryTimeFirstHalf + injuryTimeSecondHalf) return;

    for (let i = 0; i < 10; i++) {
      simulateMinute(matchMinute, homeXI, awayXI, formation, tactic, mentality);
    }
  }, [matchMinute, matchStatus, isPaused, homeXI, awayXI, formation, tactic, mentality, simulateMinute]);

  // Finish match
  const finishMatch = useCallback(async () => {
    if (matchStatus === 'finished') return;
    setMatchStatus('finished');
    setIsPaused(true);
    toast.success(`Full time: ${scoreRef.current.home} - ${scoreRef.current.away}`);
  }, [matchStatus]);

  // UI helpers
  const displayMinute = matchMinute > 90 ? `${90}+${matchMinute - 90}` : matchMinute;
  const statusLabel = matchStatus === 'ready' ? 'READY' : matchStatus === 'live' ? (isPaused ? 'PAUSED' : 'LIVE') : matchStatus === 'half-time' ? 'HALF TIME' : 'FULL TIME';
  const homeStrength = calculateTeamStrength(homeXI);
  const awayStrength = calculateTeamStrength(awayXI);

  if (loading || loadingMatch) {
    return (
      <main className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading match...</p>
      </main>
    );
  }

  if (!homeClub || !awayClub) {
    return (
      <main className={styles.emptyPage}>
        <div className={styles.emptyIcon}>⚽</div>
        <h1>Match not found</h1>
        <button onClick={() => router.push('/fixtures')}>Back to Fixtures</button>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>{getClubName(homeClub)} vs {getClubName(awayClub)}</title>
      </Head>

      <main className={styles.page}>
        {/* Header */}
        <header className={styles.header}>
          <button className={styles.backButton} onClick={() => router.push('/fixtures')}>
            ← Fixtures
          </button>
          <div>
            <span className={styles.competition}>MATCH</span>
            <h1>Match Centre</h1>
          </div>
          <span className={styles.status}>{statusLabel}</span>
        </header>

        {/* 3D Pitch */}
        <ThreePitch
          homeXI={homeXI}
          awayXI={awayXI}
          formation={formation}
          ballPossession={ballPossession}
        />

        {/* Scoreboard */}
        <section className={styles.scoreboard}>
          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {getClubLogo(homeClub) ? <img src={getClubLogo(homeClub)} alt="" /> : '⚽'}
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
            <div className={styles.matchClock}>{displayMinute}'</div>
            <small>{statusLabel}</small>
          </div>

          <div className={styles.scoreTeam}>
            <div className={styles.clubLogo}>
              {getClubLogo(awayClub) ? <img src={getClubLogo(awayClub)} alt="" /> : '⚽'}
            </div>
            <strong>{getClubName(awayClub)}</strong>
            <span>AWAY</span>
          </div>
        </section>

        {/* Controls */}
        {userIsParticipant && (
          <section className={styles.controls}>
            {matchStatus === 'ready' && (
              <button className={styles.primaryButton} onClick={() => setMatchStatus('live')}>
                ▶ START MATCH
              </button>
            )}
            {matchStatus === 'live' && (
              <button onClick={() => setIsPaused(!isPaused)}>
                {isPaused ? '▶ Resume' : 'Ⅱ Pause'}
              </button>
            )}
            <button onClick={() => setShowFormation(!showFormation)}>📋 Formation</button>
            <button onClick={() => setShowTactics(!showTactics)}>⚙ Tactics</button>
            <button onClick={() => setShowSubs(!showSubs)}>🔄 Substitutions</button>
          </section>
        )}

        {/* Formation Panel */}
        {showFormation && userIsParticipant && (
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Formation</h2>
              <span>{formation}</span>
            </div>
            <div className={styles.mentalityGrid}>
              {Object.keys(FORMATIONS).map(key => (
                <button
                  key={key}
                  className={formation === key ? styles.active : ''}
                  onClick={() => setFormation(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Stats */}
        <section className={styles.statsSection}>
          <div className={styles.sectionHeader}>
            <span>MATCH STATISTICS</span>
            <strong>{homeScore} - {awayScore}</strong>
          </div>
          {[
            ['Possession', `${homeStats.possession}%`, `${awayStats.possession}%`],
            ['Shots', homeStats.shots, awayStats.shots],
            ['Shots on Target', homeStats.shotsOnTarget, awayStats.shotsOnTarget],
            ['Passes', homeStats.passes, awayStats.passes],
            ['Fouls', homeStats.fouls, awayStats.fouls],
            ['Corners', homeStats.corners, awayStats.corners],
            ['Saves', homeStats.saves, awayStats.saves],
            ['Tackles', homeStats.tackles, awayStats.tackles],
          ].map(row => (
            <div key={row[0]} className={styles.statRow}>
              <strong>{row[1]}</strong>
              <span>{row[0]}</span>
              <strong>{row[2]}</strong>
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
            {events.length > 0 ? events.slice(0, 20).map(event => (
              <article key={event.id} className={styles.event}>
                <span className={styles.eventMinute}>
                  {event.minute > 90 ? `${90}+${event.minute - 90}` : event.minute}'
                </span>
                <span className={styles.eventIcon}>{eventIcon(event)}</span>
                <div>
                  <strong>{eventLabel(event)}</strong>
                  <p>{event.detail || event.playerName}</p>
                </div>
                <span>{event.team === 'home' ? getClubName(homeClub) : getClubName(awayClub)}</span>
              </article>
            )) : <div className={styles.noEvents}>No events yet.</div>}
          </div>
        </section>
      </main>
    </>
  );
}

// Helpers
function createDefaultStats() {
  return { shots: 0, shotsOnTarget: 0, possession: 50, passes: 0, fouls: 0, corners: 0, offsides: 0, yellow: 0, red: 0, saves: 0, tackles: 0, interceptions: 0 };
}

function loadClubPlayers(clubId) {
  // Implementation...
}

function selectStartingXI(squad, formation) {
  // Implementation...
}

function eventLabel(event) {
  const map = { goal: 'GOAL', yellow: 'YELLOW CARD', red: 'RED CARD', foul: 'FOUL', corner: 'CORNER', save: 'SAVE', shot: 'SHOT', substitution: 'SUBSTITUTION' };
  return map[event.type] || 'EVENT';
}

function eventIcon(event) {
  const map = { goal: '⚽', yellow: '🟨', red: '🟥', corner: '🚩', save: '🧤', shot: '💥', substitution: '🔄' };
  return map[event.type] || '•';
}
