// pages/match/[id].js

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useRouter,
} from 'next/router';

import Head from 'next/head';

import dynamic from 'next/dynamic';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '../../components/firebase';

import { useAuth } from '../../context/AuthContext';

import toast from 'react-hot-toast';

import styles from './match.module.css';

import {
  createStats,
  cloneStats,
  getPlayerId,
  getPlayerName,
  getOverall,
  normalizePosition,
  selectAIStartingXI,
  simulateMatchTick,
  FORMATIONS,
} from '../../components/MatchEngine';

const ThreePitch =
  dynamic(
    () =>
      import(
        '../../components/ThreePitch'
      ),
    {
      ssr: false,
      loading: () => (
        <div
          style={{
            height: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Loading 3D pitch...
        </div>
      ),
    }
  );

function safeNumber(
  value,
  fallback = 0
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

export default function MatchPage() {

  const router =
    useRouter();

  const {
    id,
  } = router.query;

  const {
    user,
    loading: authLoading,
  } = useAuth();

  /*
   * MATCH
   */
  const [
    match,
    setMatch,
  ] = useState(null);

  const [
    homeClub,
    setHomeClub,
  ] = useState(null);

  const [
    awayClub,
    setAwayClub,
  ] = useState(null);

  /*
   * SQUADS
   */
  const [
    homeSquad,
    setHomeSquad,
  ] = useState([]);

  const [
    awaySquad,
    setAwaySquad,
  ] = useState([]);

  /*
   * LINEUPS
   */
  const [
    homeXI,
    setHomeXI,
  ] = useState([]);

  const [
    awayXI,
    setAwayXI,
  ] = useState([]);

  const [
    lineupMode,
    setLineupMode,
  ] = useState('selection');

  /*
   * PAGE LOADING
   */
  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    loadingPlayers,
    setLoadingPlayers,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState(null);

  /*
   * MATCH STATE
   */
  const [
    matchStatus,
    setMatchStatus,
  ] = useState('loading');

  const [
    minute,
    setMinute,
  ] = useState(0);

  const [
    homeScore,
    setHomeScore,
  ] = useState(0);

  const [
    awayScore,
    setAwayScore,
  ] = useState(0);

  const [
    homeStats,
    setHomeStats,
  ] = useState(
    createStats()
  );

  const [
    awayStats,
    setAwayStats,
  ] = useState(
    createStats()
  );

  const [
    events,
    setEvents,
  ] = useState([]);

  /*
   * ANIMATION STATE
   */
  const [
    ballTeam,
    setBallTeam,
  ] = useState(null);

  const [
    activePlayerId,
    setActivePlayerId,
  ] = useState(null);

  const [
    action,
    setAction,
  ] = useState(null);

  /*
   * PAUSE
   */
  const [
    paused,
    setPaused,
  ] = useState(false);

  /*
   * REFS
   */
  const scoreRef =
    useRef({
      home: 0,
      away: 0,
    });

  const homeStatsRef =
    useRef(
      createStats()
    );

  const awayStatsRef =
    useRef(
      createStats()
    );

  const eventsRef =
    useRef([]);

  const minuteRef =
    useRef(0);

  const simulationRef =
    useRef(false);

  const intervalRef =
    useRef(null);

  /*
   * FORMATION
   */
  const formation =
    match?.formation ||
    '4-4-2';

  /*
   * =========================================================
   * LOAD CLUB
   * =========================================================
   */

  const loadClub =
    useCallback(
      async clubId => {

        if (!clubId) {
          return null;
        }

        try {

          const snap =
            await getDoc(
              doc(
                db,
                'clubs',
                clubId
              )
            );

          if (
            snap.exists()
          ) {

            return {
              id: snap.id,
              ...snap.data(),
            };
          }

        } catch (err) {

          console.error(
            'Club load error:',
            err
          );

        }

        return {
          id: clubId,
          name: 'Unknown Club',
        };
      },
      []
    );

  /*
   * =========================================================
   * LOAD PLAYERS
   * =========================================================
   */

  const loadPlayers =
    useCallback(
      async clubId => {

        if (!clubId) {
          return [];
        }

        try {

          /*
           * First query.
           */
          const q =
            query(
              collection(
                db,
                'players'
              ),
              where(
                'clubId',
                '==',
                clubId
              )
            );

          const snapshot =
            await getDocs(q);

          return snapshot.docs.map(
            playerDoc => ({
              id:
                playerDoc.id,

              ...playerDoc.data(),
            })
          );

        } catch (err) {

          console.error(
            'Player query error:',
            err
          );

          /*
           * Don't crash match if players
           * cannot be loaded.
           */
          return [];
        }
      },
      []
    );

  /*
   * =========================================================
   * LOAD MATCH
   * =========================================================
   */

  useEffect(() => {

    if (!router.isReady) {
      return;
    }

    if (!id) {
      setLoading(false);
      setError(
        'Missing match ID.'
      );
      return;
    }

    if (authLoading) {
      return;
    }

    /*
     * IMPORTANT:
     *
     * Don't leave the page stuck forever
     * when AuthContext has no user.
     */
    if (!user) {

      setLoading(false);

      setMatchStatus(
        'ready'
      );

      setError(
        'Please login before opening this match.'
      );

      return;
    }

    let cancelled = false;

    async function load() {

      try {

        setLoading(true);
        setError(null);

        console.log(
          '🏟️ Loading match:',
          id
        );

        /*
         * MATCH
         */
        const matchSnap =
          await getDoc(
            doc(
              db,
              'matches',
              id
            )
          );

        if (cancelled) {
          return;
        }

        if (
          !matchSnap.exists()
        ) {

          setError(
            'Match does not exist.'
          );

          setLoading(false);

          return;
        }

        const matchData = {
          id:
            matchSnap.id,

          ...matchSnap.data(),
        };

        setMatch(
          matchData
        );

        /*
         * CLUBS
         */
        const [
          home,
          away,
        ] = await Promise.all([
          loadClub(
            matchData.homeClubId
          ),
          loadClub(
            matchData.awayClubId
          ),
        ]);

        if (cancelled) {
          return;
        }

        setHomeClub(home);
        setAwayClub(away);

        /*
         * MATCH STATE
         */
        const initialHomeScore =
          safeNumber(
            matchData.homeScore,
            0
          );

        const initialAwayScore =
          safeNumber(
            matchData.awayScore,
            0
          );

        const initialHomeStats =
          cloneStats(
            matchData.homeStats
          );

        const initialAwayStats =
          cloneStats(
            matchData.awayStats
          );

        const initialEvents =
          Array.isArray(
            matchData.events
          )
            ? matchData.events
            : [];

        const initialMinute =
          safeNumber(
            matchData.minute,
            0
          );

        scoreRef.current = {
          home:
            initialHomeScore,

          away:
            initialAwayScore,
        };

        homeStatsRef.current =
          initialHomeStats;

        awayStatsRef.current =
          initialAwayStats;

        eventsRef.current =
          initialEvents;

        minuteRef.current =
          initialMinute;

        setHomeScore(
          initialHomeScore
        );

        setAwayScore(
          initialAwayScore
        );

        setHomeStats(
          initialHomeStats
        );

        setAwayStats(
          initialAwayStats
        );

        setEvents(
          initialEvents
        );

        setMinute(
          initialMinute
        );

        /*
         * STATUS
         */
        if (
          matchData.status ===
          'finished'
        ) {

          setMatchStatus(
            'finished'
          );

        } else if (
          matchData.status ===
          'live'
        ) {

          setMatchStatus(
            'live'
          );

        } else if (
          matchData.status ===
          'half-time'
        ) {

          setMatchStatus(
            'half-time'
          );

        } else {

          /*
           * Never leave status as "loading".
           */
          setMatchStatus(
            'ready'
          );
        }

        /*
         * PLAYERS
         *
         * IMPORTANT:
         * Page loading is already finished
         * before player query.
         */
        setLoading(false);
        setLoadingPlayers(true);

        const [
          homePlayers,
          awayPlayers,
        ] = await Promise.all([
          loadPlayers(
            matchData.homeClubId
          ),
          loadPlayers(
            matchData.awayClubId
          ),
        ]);

        if (cancelled) {
          return;
        }

        setHomeSquad(
          homePlayers
        );

        setAwaySquad(
          awayPlayers
        );

        /*
         * HOME LINEUP
         */
        let selectedHome;

        if (
          Array.isArray(
            matchData.homeLineup
          ) &&
          matchData.homeLineup.length >=
            11
        ) {

          selectedHome =
            matchData.homeLineup;

        } else {

          /*
           * User's first lineup:
           * AI gives initial suggestion.
           * User can change it before start.
           */
          selectedHome =
            selectAIStartingXI(
              homePlayers,
              formation
            );
        }

        /*
         * AWAY LINEUP
         *
         * If away has no manager,
         * AI selects it automatically.
         */
        let selectedAway;

        if (
          Array.isArray(
            matchData.awayLineup
          ) &&
          matchData.awayLineup.length >=
            11
        ) {

          selectedAway =
            matchData.awayLineup;

        } else {

          selectedAway =
            selectAIStartingXI(
              awayPlayers,
              formation
            );
        }

        setHomeXI(
          selectedHome
        );

        setAwayXI(
          selectedAway
        );

        setLoadingPlayers(false);

        console.log(
          '✅ Match loaded'
        );

      } catch (err) {

        console.error(
          '❌ Match loading error:',
          err
        );

        if (!cancelled) {

          setError(
            err?.message ||
            'Failed to load match.'
          );

          setLoading(false);
          setLoadingPlayers(false);

          /*
           * Never leave UI in loading state.
           */
          setMatchStatus(
            'ready'
          );
        }

      }
    }

    load();

    return () => {
      cancelled = true;
    };

  }, [
    router.isReady,
    id,
    user,
    authLoading,
    loadClub,
    loadPlayers,
    formation,
  ]);

  /*
   * =========================================================
   * LINEUP TOGGLE
   * =========================================================
   */

  function togglePlayer(
    player
  ) {

    const playerId =
      getPlayerId(player);

    setHomeXI(
      current => {

        const exists =
          current.some(
            p =>
              getPlayerId(p) ===
              playerId
          );

        /*
         * Remove
         */
        if (exists) {

          return current.filter(
            p =>
              getPlayerId(p) !==
              playerId
          );
        }

        /*
         * Maximum 11.
         */
        if (
          current.length >= 11
        ) {

          toast.error(
            'Starting XI can only contain 11 players.'
          );

          return current;
        }

        return [
          ...current,
          player,
        ];
      }
    );
  }

  /*
   * =========================================================
   * SAVE MATCH
   * =========================================================
   */

  const saveMatch =
    useCallback(
      async status => {

        if (!match?.id) {
          return;
        }

        try {

          await updateDoc(
            doc(
              db,
              'matches',
              match.id
            ),
            {
              status:
                status ||
                matchStatus,

              minute:
                minuteRef.current,

              homeScore:
                scoreRef.current.home,

              awayScore:
                scoreRef.current.away,

              homeLineup:
                homeXI,

              awayLineup:
                awayXI,

              homeStats:
                homeStatsRef.current,

              awayStats:
                awayStatsRef.current,

              events:
                eventsRef.current,

              updatedAt:
                serverTimestamp(),
            }
          );

        } catch (err) {

          console.error(
            'Save match error:',
            err
          );
        }
      },
      [
        match,
        matchStatus,
        homeXI,
        awayXI,
      ]
    );

  /*
   * =========================================================
   * START MATCH
   * =========================================================
   */

  const startMatch =
    useCallback(
      async () => {

        if (
          homeXI.length !== 11
        ) {

          toast.error(
            'Select exactly 11 home players.'
          );

          return;
        }

        if (
          awayXI.length !== 11
        ) {

          toast.error(
            'Away team does not have 11 players.'
          );

          return;
        }

        setMatchStatus(
          'live'
        );

        setPaused(false);

        await saveMatch(
          'live'
        );

        toast.success(
          '⚽ Match started!'
        );
      },
      [
        homeXI,
        awayXI,
        saveMatch,
      ]
    );

  /*
   * =========================================================
   * SIMULATION
   * =========================================================
   */

  const simulateMinute =
    useCallback(
      () => {

        if (
          simulationRef.current
        ) {
          return;
        }

        if (
          homeXI.length !== 11 ||
          awayXI.length !== 11
        ) {
          return;
        }

        simulationRef.current =
          true;

        try {

          /*
           * Simulate multiple actions
           * during one match minute.
           */
          for (
            let i = 0;
            i < 8;
            i++
          ) {

            const result =
              simulateMatchTick({
                homeXI,
                awayXI,

                homeStats:
                  homeStatsRef.current,

                awayStats:
                  awayStatsRef.current,

                homeScore:
                  scoreRef.current.home,

                awayScore:
                  scoreRef.current.away,

                minute:
                  minuteRef.current,
              });

            scoreRef.current = {
              home:
                result.homeScore,

              away:
                result.awayScore,
            };

            if (
              result.ballTeam
            ) {

              setBallTeam(
                result.ballTeam
              );
            }

            if (
              result.player
            ) {

              setActivePlayerId(
                getPlayerId(
                  result.player
                )
              );
            }

            if (
              result.action
            ) {

              setAction(
                result.action
              );
            }

            if (
              result.event
            ) {

              eventsRef.current = [
                result.event,
                ...eventsRef.current,
              ];
            }
          }

          /*
           * Update React UI.
           */
          setHomeScore(
            scoreRef.current.home
          );

          setAwayScore(
            scoreRef.current.away
          );

          setHomeStats({
            ...homeStatsRef.current,
          });

          setAwayStats({
            ...awayStatsRef.current,
          });

          setEvents([
            ...eventsRef.current,
          ]);

        } finally {

          simulationRef.current =
            false;
        }

      },
      [
        homeXI,
        awayXI,
      ]
    );

  /*
   * =========================================================
   * MATCH CLOCK
   * =========================================================
   */

  useEffect(() => {

    if (
      matchStatus !== 'live' ||
      paused ||
      loading ||
      homeXI.length !== 11 ||
      awayXI.length !== 11
    ) {

      if (
        intervalRef.current
      ) {

        clearInterval(
          intervalRef.current
        );

        intervalRef.current =
          null;
      }

      return;
    }

    intervalRef.current =
      setInterval(
        () => {

          /*
           * One second = one match minute
           * for this game simulation.
           */
          minuteRef.current += 1;

          setMinute(
            minuteRef.current
          );

          simulateMinute();

          /*
           * Save every 5 minutes.
           */
          if (
            minuteRef.current % 5 ===
            0
          ) {

            saveMatch(
              'live'
            );
          }

          /*
           * Half time.
           */
          if (
            minuteRef.current ===
            45
          ) {

            setMatchStatus(
              'half-time'
            );

            saveMatch(
              'half-time'
            );

            toast.success(
              '⏸ Half time'
            );

            return;
          }

          /*
           * Full time.
           */
          if (
            minuteRef.current >=
            90
          ) {

            setMatchStatus(
              'finished'
            );

            setPaused(
              true
            );

            saveMatch(
              'finished'
            );

            toast.success(
              `Full time: ${scoreRef.current.home} - ${scoreRef.current.away}`
            );
          }

        },
        1000
      );

    return () => {

      if (
        intervalRef.current
      ) {

        clearInterval(
          intervalRef.current
        );

        intervalRef.current =
          null;
      }
    };

  }, [
    matchStatus,
    paused,
    loading,
    homeXI.length,
    awayXI.length,
    simulateMinute,
    saveMatch,
  ]);

  /*
   * =========================================================
   * SECOND HALF
   * =========================================================
   */

  const startSecondHalf =
    useCallback(
      async () => {

        if (
          matchStatus !==
          'half-time'
        ) {
          return;
        }

        setMatchStatus(
          'live'
        );

        setPaused(false);

        await saveMatch(
          'live'
        );

        toast.success(
          '▶ Second half started'
        );
      },
      [
        matchStatus,
        saveMatch,
      ]
    );

  /*
   * =========================================================
   * FINISH
   * =========================================================
   */

  const finishMatch =
    useCallback(
      async () => {

        setMatchStatus(
          'finished'
        );

        setPaused(true);

        await saveMatch(
          'finished'
        );
      },
      [
        saveMatch,
      ]
    );

  /*
   * =========================================================
   * STATUS LABEL
   * =========================================================
   */

  const statusLabel =
    matchStatus === 'ready'
      ? 'READY'
      : matchStatus === 'live'
        ? paused
          ? 'PAUSED'
          : 'LIVE'
        : matchStatus === 'half-time'
          ? 'HALF TIME'
          : matchStatus === 'finished'
            ? 'FULL TIME'
            : 'READY';

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

  if (
    authLoading
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
          Checking login...
        </p>
      </div>
    );
  }

  if (
    loading
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
          Loading match...
        </p>
      </div>
    );
  }

  if (
    error &&
    !match
  ) {

    return (
      <div
        className={
          styles.errorContainer
        }
      >
        <h1>
          Match Error
        </h1>

        <p>
          {error}
        </p>

        <button
          onClick={() =>
            router.push(
              '/fixtures'
            )
          }
        >
          Back to Fixtures
        </button>
      </div>
    );
  }

  if (
    !match ||
    !homeClub ||
    !awayClub
  ) {

    return (
      <div
        className={
          styles.errorContainer
        }
      >
        <h1>
          Match Not Found
        </h1>

        <button
          onClick={() =>
            router.push(
              '/fixtures'
            )
          }
        >
          Back to Fixtures
        </button>
      </div>
    );
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs {awayClub.name}
        </title>
      </Head>

      <main
        className={
          styles.page
        }
      >

        {/* HEADER */}

        <header
          className={
            styles.header
          }
        >

          <button
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

          <h1>
            Match Centre
          </h1>

          <span
            className={
              styles.status
            }
          >
            {statusLabel}
          </span>

        </header>

        {/* SCORE */}

        <section
          className={
            styles.scoreboard
          }
        >

          <div
            className={
              styles.scoreTeam
            }
          >
            <strong>
              {homeClub.name}
            </strong>

            <small>
              HOME
            </small>
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

            <div>
              {minute}'
            </div>

          </div>

          <div
            className={
              styles.scoreTeam
            }
          >
            <strong>
              {awayClub.name}
            </strong>

            <small>
              AWAY
            </small>
          </div>

        </section>

        {/* 3D PITCH */}

        <section
          className={
            styles.pitchContainer
          }
        >

          <ThreePitch
            homeXI={
              homeXI
            }

            awayXI={
              awayXI
            }

            homeColor={
              homeClub.primaryColor ||
              '#2563eb'
            }

            awayColor={
              awayClub.primaryColor ||
              '#dc2626'
            }

            formation={
              formation
            }

            matchStarted={
              matchStatus === 'live'
            }

            ballTeam={
              ballTeam
            }

            activePlayerId={
              activePlayerId
            }

            action={
              action
            }
          />

        </section>

        {/* LINEUP */}

        {matchStatus ===
          'ready' && (
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

              <h2>
                {homeClub.name}
              </h2>

              <p>
                Select Starting XI
              </p>

              {loadingPlayers && (
                <p>
                  Loading players...
                </p>
              )}

              <div>
                {homeSquad.map(
                  player => {

                    const selected =
                      homeXI.some(
                        p =>
                          getPlayerId(
                            p
                          ) ===
                          getPlayerId(
                            player
                          )
                      );

                    return (
                      <button
                        key={
                          getPlayerId(
                            player
                          )
                        }
                        onClick={() =>
                          togglePlayer(
                            player
                          )
                        }
                        style={{
                          display:
                            'flex',
                          justifyContent:
                            'space-between',
                          width:
                            '100%',
                          marginBottom:
                            '6px',
                          padding:
                            '10px',
                          borderRadius:
                            '8px',
                          border:
                            selected
                              ? '2px solid #22c55e'
                              : '1px solid #334155',
                          background:
                            selected
                              ? 'rgba(34,197,94,.12)'
                              : 'transparent',
                        }}
                      >

                        <span>
                          {getPlayerName(
                            player
                          )}
                        </span>

                        <span>
                          {getOverall(
                            player
                          )}
                        </span>

                      </button>
                    );
                  }
                )}
              </div>

              <strong>
                Selected:
                {' '}
                {homeXI.length}/11
              </strong>

            </div>

            {/* AWAY AI */}

            <div
              className={
                styles.lineupCard
              }
            >

              <h2>
                {awayClub.name}
              </h2>

              <p>
                AI Starting XI
              </p>

              {awayXI.map(
                player => (
                  <div
                    key={
                      getPlayerId(
                        player
                      )
                    }
                    className={
                      styles.lineupPlayer
                    }
                  >
                    <span>
                      {getPlayerName(
                        player
                      )}
                    </span>

                    <strong>
                      {getOverall(
                        player
                      )}
                    </strong>
                  </div>
                )
              )}

            </div>

          </section>
        )}

        {/* CONTROLS */}

        <section
          className={
            styles.controls
          }
        >

          {matchStatus ===
            'ready' && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startMatch
              }
            >
              ▶ START MATCH
            </button>
          )}

          {matchStatus ===
            'live' && (
            <>
              <button
                onClick={() =>
                  setPaused(
                    p => !p
                  )
                }
              >
                {paused
                  ? '▶ Resume'
                  : '⏸ Pause'}
              </button>

              <button
                onClick={
                  finishMatch
                }
              >
                ⏹ Finish
              </button>
            </>
          )}

          {matchStatus ===
            'half-time' && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startSecondHalf
              }
            >
              ▶ START SECOND HALF
            </button>
          )}

          {matchStatus ===
            'finished' && (
            <button
              onClick={() =>
                router.push(
                  '/fixtures'
                )
              }
            >
              Back to Fixtures
            </button>
          )}

        </section>

        {/* STATISTICS */}

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
              {homeScore}
              {' - '}
              {awayScore}
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
              'Passes Completed',
              homeStats.passesCompleted,
              awayStats.passesCompleted,
            ],

            [
              'Tackles',
              homeStats.tackles,
              awayStats.tackles,
            ],

            [
              'Interceptions',
              homeStats.interceptions,
              awayStats.interceptions,
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
              'Saves',
              homeStats.saves,
              awayStats.saves,
            ],

            [
              'Yellow Cards',
              homeStats.yellowCards,
              awayStats.yellowCards,
            ],

            [
              'Red Cards',
              homeStats.redCards,
              awayStats.redCards,
            ],

            [
              'Attacks',
              homeStats.attacks,
              awayStats.attacks,
            ],

            [
              'Dangerous Attacks',
              homeStats.dangerousAttacks,
              awayStats.dangerousAttacks,
            ],

            [
              'Dribbles',
              homeStats.dribbles,
              awayStats.dribbles,
            ],

          ].map(
            row => (
              <div
                key={
                  row[0]
                }
                className={
                  styles.statRow
                }
              >

                <strong
                  className={
                    styles.homeStat
                  }
                >
                  {row[1]}
                </strong>

                <span>
                  {row[0]}
                </span>

                <strong
                  className={
                    styles.awayStat
                  }
                >
                  {row[2]}
                </strong>

              </div>
            )
          )}

        </section>

        {/* EVENTS */}

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

            <span>
              LIVE MATCH PLAY
            </span>

            <strong>
              {events.length}
              {' events'}
            </strong>

          </div>

          {events.length ===
            0 ? (
            <div
              className={
                styles.noEvents
              }
            >
              Match events will appear here.
            </div>
          ) : (

            events
              .slice(0, 30)
              .map(
                event => (
                  <div
                    key={
                      event.id
                    }
                    className={
                      styles.event
                    }
                  >

                    <strong>
                      {event.minute}'
                    </strong>

                    <span>
                      {event.type ===
                      'goal'
                        ? '⚽'
                        : '🧤'}
                    </span>

                    <div>

                      <strong>
                        {event.playerName}
                      </strong>

                      <p>
                        {event.detail}
                      </p>

                    </div>

                  </div>
                )
              )

          )}

        </section>

        {/* LINEUPS AFTER START */}

        {matchStatus !==
          'ready' && (
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

              <h3>
                {homeClub.name}
              </h3>

              {homeXI.map(
                player => (
                  <div
                    key={
                      getPlayerId(
                        player
                      )
                    }
                    className={
                      styles.lineupPlayer
                    }
                  >
                    <span>
                      {getPlayerName(
                        player
                      )}
                    </span>

                    <strong>
                      {getOverall(
                        player
                      )}
                    </strong>
                  </div>
                )
              )}

            </div>

            <div
              className={
                styles.lineupCard
              }
            >

              <h3>
                {awayClub.name}
              </h3>

              {awayXI.map(
                player => (
                  <div
                    key={
                      getPlayerId(
                        player
                      )
                    }
                    className={
                      styles.lineupPlayer
                    }
                  >
                    <span>
                      {getPlayerName(
                        player
                      )}
                    </span>

                    <strong>
                      {getOverall(
                        player
                      )}
                    </strong>
                  </div>
                )
              )}

            </div>

          </section>
        )}

      </main>
    </>
  );
}
