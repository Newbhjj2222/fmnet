// pages/match/[id].js

import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';

import {
  useRouter,
} from 'next/router';

import Head from 'next/head';

import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import {
  db,
} from '../../components/firebase';

import {
  useAuth,
} from '../../context/AuthContext';

import toast from 'react-hot-toast';

import dynamic from 'next/dynamic';

import styles from './match.module.css';

// ============================================================
// THREE PITCH
// ============================================================

const ThreePitch = dynamic(
  () =>
    import(
      '../../components/ThreePitch'
    ),
  {
    ssr: false,
    loading: () => (
      <div className="pitch-loading">
        Loading 3D pitch...
      </div>
    ),
  }
);

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

function safeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
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
    'MID'
  );
}

function getPlayerOverall(player) {
  return clamp(
    safeNumber(
      player?.overall ||
        player?.rating ||
        60
    ),
    35,
    99
  );
}

function normalizePosition(
  position
) {
  const value =
    String(position || '')
      .trim()
      .toLowerCase();

  if (
    value.includes('goal') ||
    value === 'gk'
  ) {
    return 'GK';
  }

  if (
    value.includes('def')
  ) {
    return 'DEF';
  }

  if (
    value.includes('mid')
  ) {
    return 'MID';
  }

  if (
    value.includes('attack') ||
    value.includes('forward') ||
    value.includes('striker')
  ) {
    return 'ATT';
  }

  return 'MID';
}

function formatPossession(
  value
) {
  return `${Number(value).toFixed(1)}%`;
}

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

  const {
    user,
    loading: authLoading,
  } = useAuth();

  const {
    id,
  } = router.query;

  // ==========================================================
  // BASIC STATE
  // ==========================================================

  const [match, setMatch] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  const [homeXI, setHomeXI] =
    useState([]);

  const [awayXI, setAwayXI] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(null);

  // ==========================================================
  // MATCH STATE
  // ==========================================================

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [matchStatus, setMatchStatus] =
    useState('loading');

  const [homeScore, setHomeScore] =
    useState(0);

  const [awayScore, setAwayScore] =
    useState(0);

  const [events, setEvents] =
    useState([]);

  const [homeStats, setHomeStats] =
    useState(createDefaultStats());

  const [awayStats, setAwayStats] =
    useState(createDefaultStats());

  const [isPaused, setIsPaused] =
    useState(false);

  const [isSaving, setIsSaving] =
    useState(false);

  const [injuryTime, setInjuryTime] =
    useState({
      firstHalf: 0,
      secondHalf: 0,
    });

  // ==========================================================
  // 3D ACTION
  // ==========================================================

  const [lastAction, setLastAction] =
    useState(null);

  // ==========================================================
  // REFS
  // ==========================================================

  const timerRef =
    useRef(null);

  const processingRef =
    useRef(false);

  const scoreRef =
    useRef({
      home: 0,
      away: 0,
    });

  const statsRef =
    useRef({
      home: createDefaultStats(),
      away: createDefaultStats(),
    });

  const eventsRef =
    useRef([]);

  const minuteRef =
    useRef(0);

  // ==========================================================
  // LOAD PLAYERS
  // ==========================================================

  const loadClubPlayers =
    useCallback(
      async (clubId) => {
        if (!clubId) return [];

        try {
          const {
            collection,
            getDocs,
            query,
            where,
          } = await import(
            'firebase/firestore'
          );

          const playersQuery =
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
            await getDocs(
              playersQuery
            );

          return snapshot.docs.map(
            (playerDoc) => ({
              id: playerDoc.id,
              ...playerDoc.data(),
            })
          );
        } catch (err) {
          console.error(
            'Load players error:',
            err
          );

          return [];
        }
      },
      []
    );

  // ==========================================================
  // STARTING XI
  // ==========================================================

  const selectStartingXI =
    useCallback(
      (
        squad,
        formation
      ) => {
        if (
          !Array.isArray(squad) ||
          squad.length === 0
        ) {
          return [];
        }

        const sorted =
          [...squad].sort(
            (a, b) =>
              getPlayerOverall(b) -
              getPlayerOverall(a)
          );

        return sorted.slice(
          0,
          PLAYERS_ON_PITCH
        );
      },
      []
    );

  // ==========================================================
  // TEAM STRENGTH
  // ==========================================================

  const calculateTeamStrength =
    useCallback(
      (players) => {
        if (
          !Array.isArray(players) ||
          players.length === 0
        ) {
          return 60;
        }

        const total =
          players.reduce(
            (sum, player) =>
              sum +
              getPlayerOverall(
                player
              ),
            0
          );

        return (
          total / players.length
        );
      },
      []
    );

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  useEffect(() => {
    if (
      authLoading ||
      !id ||
      !user
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError(null);

        const matchRef =
          doc(
            db,
            'matches',
            id
          );

        const matchSnap =
          await getDoc(
            matchRef
          );

        if (
          !matchSnap.exists()
        ) {
          setError(
            'Match not found in database'
          );

          setLoading(false);

          return;
        }

        const matchData = {
          id: matchSnap.id,
          ...matchSnap.data(),
        };

        if (cancelled) return;

        setMatch(matchData);

        // ----------------------------------------------------
        // CLUBS
        // ----------------------------------------------------

        const [
          homeSnap,
          awaySnap,
        ] = await Promise.all([
          matchData.homeClubId
            ? getDoc(
                doc(
                  db,
                  'clubs',
                  matchData.homeClubId
                )
              )
            : null,

          matchData.awayClubId
            ? getDoc(
                doc(
                  db,
                  'clubs',
                  matchData.awayClubId
                )
              )
            : null,
        ]);

        if (cancelled) return;

        const home =
          homeSnap?.exists()
            ? {
                id: homeSnap.id,
                ...homeSnap.data(),
              }
            : {
                id:
                  matchData.homeClubId,
                name:
                  matchData.homeClubName ||
                  'Home',
              };

        const away =
          awaySnap?.exists()
            ? {
                id: awaySnap.id,
                ...awaySnap.data(),
              }
            : {
                id:
                  matchData.awayClubId,
                name:
                  matchData.awayClubName ||
                  'Away',
              };

        setHomeClub(home);
        setAwayClub(away);

        // ----------------------------------------------------
        // PLAYERS
        // ----------------------------------------------------

        const [
          homePlayers,
          awayPlayers,
        ] = await Promise.all([
          loadClubPlayers(
            matchData.homeClubId
          ),

          loadClubPlayers(
            matchData.awayClubId
          ),
        ]);

        if (cancelled) return;

        const formation =
          matchData.formation ||
          '4-4-2';

        const startingHome =
          selectStartingXI(
            homePlayers,
            formation
          );

        const startingAway =
          selectStartingXI(
            awayPlayers,
            formation
          );

        setHomeXI(
          startingHome
        );

        setAwayXI(
          startingAway
        );

        // ----------------------------------------------------
        // SAVED MATCH
        // ----------------------------------------------------

        if (
          matchData.status ===
            'live' ||
          matchData.status ===
            'half-time'
        ) {
          const savedHomeScore =
            safeNumber(
              matchData.homeScore,
              0
            );

          const savedAwayScore =
            safeNumber(
              matchData.awayScore,
              0
            );

          scoreRef.current = {
            home:
              savedHomeScore,
            away:
              savedAwayScore,
          };

          statsRef.current = {
            home: {
              ...createDefaultStats(),
              ...(matchData.homeStats ||
                {}),
            },

            away: {
              ...createDefaultStats(),
              ...(matchData.awayStats ||
                {}),
            },
          };

          eventsRef.current =
            Array.isArray(
              matchData.events
            )
              ? matchData.events
              : [];

          minuteRef.current =
            safeNumber(
              matchData.minute,
              0
            );

          setHomeScore(
            savedHomeScore
          );

          setAwayScore(
            savedAwayScore
          );

          setHomeStats({
            ...statsRef.current.home,
          });

          setAwayStats({
            ...statsRef.current.away,
          });

          setEvents([
            ...eventsRef.current,
          ]);

          setMatchMinute(
            minuteRef.current
          );

          setMatchStatus(
            matchData.status
          );

          setIsPaused(
            matchData.status ===
              'half-time'
          );
        } else if (
          matchData.status ===
          'finished'
        ) {
          const home =
            safeNumber(
              matchData.result
                ?.homeScore ||
                matchData.homeScore,
              0
            );

          const away =
            safeNumber(
              matchData.result
                ?.awayScore ||
                matchData.awayScore,
              0
            );

          scoreRef.current = {
            home,
            away,
          };

          setHomeScore(home);
          setAwayScore(away);

          setMatchStatus(
            'finished'
          );

          setMatchMinute(
            90 +
              safeNumber(
                matchData.injuryTimeFirstHalf,
                0
              ) +
              safeNumber(
                matchData.injuryTimeSecondHalf,
                0
              )
          );
        } else {
          setMatchStatus(
            'ready'
          );

          setMatchMinute(0);
        }

        // ----------------------------------------------------
        // INJURY TIME
        // ----------------------------------------------------

        setInjuryTime({
          firstHalf:
            safeNumber(
              matchData.injuryTimeFirstHalf,
              Math.floor(
                Math.random() * 3
              ) + 1
            ),

          secondHalf:
            safeNumber(
              matchData.injuryTimeSecondHalf,
              Math.floor(
                Math.random() * 3
              ) + 1
            ),
        });
      } catch (err) {
        console.error(
          'Match load error:',
          err
        );

        setError(
          'Failed to load match: ' +
            err.message
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    user,
    authLoading,
    loadClubPlayers,
    selectStartingXI,
  ]);

  // ==========================================================
  // SAVE MATCH
  // ==========================================================

  const saveMatchState =
    useCallback(
      async (status) => {
        if (
          !match?.id ||
          !user
        ) {
          return;
        }

        try {
          setIsSaving(true);

          const matchRef =
            doc(
              db,
              'matches',
              match.id
            );

          await updateDoc(
            matchRef,
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

              result: {
                homeScore:
                  scoreRef.current.home,

                awayScore:
                  scoreRef.current.away,
              },

              events:
                eventsRef.current,

              homeStats:
                statsRef.current.home,

              awayStats:
                statsRef.current.away,

              injuryTimeFirstHalf:
                injuryTime.firstHalf,

              injuryTimeSecondHalf:
                injuryTime.secondHalf,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            'Save match error:',
            err
          );
        } finally {
          setIsSaving(false);
        }
      },
      [
        match,
        user,
        matchStatus,
        injuryTime,
      ]
    );

  // ==========================================================
  // FINISH MATCH
  // ==========================================================

  const finishMatch =
    useCallback(
      async () => {
        if (
          scoreRef.current == null ||
          matchStatus ===
            'finished'
        ) {
          return;
        }

        setMatchStatus(
          'finished'
        );

        setIsPaused(true);

        await saveMatchState(
          'finished'
        );

        const home =
          scoreRef.current.home;

        const away =
          scoreRef.current.away;

        const winner =
          home > away
            ? 'Home'
            : home < away
            ? 'Away'
            : 'Draw';

        toast.success(
          `Full time: ${home} - ${away} (${winner})`
        );
      },
      [
        matchStatus,
        saveMatchState,
      ]
    );

  // ==========================================================
  // GET PLAYER
  // ==========================================================

  const getPlayer =
    useCallback(
      (
        team,
        id
      ) => {
        const players =
          team === 'home'
            ? homeXI
            : awayXI;

        return players.find(
          (player) =>
            player.id === id ||
            player.playerId === id
        );
      },
      [homeXI, awayXI]
    );

  // ==========================================================
  // GET 3D POSITION
  // ==========================================================

  const getPlayer3DPosition =
    useCallback(
      (
        team,
        player
      ) => {
        const players =
          team === 'home'
            ? homeXI
            : awayXI;

        const index =
          players.findIndex(
            (item) =>
              item.id ===
                player.id ||
              item.playerId ===
                player.playerId
          );

        const positions = {
          '4-4-2': [
            { x: 8, y: 50 },
            { x: 23, y: 18 },
            { x: 23, y: 39 },
            { x: 23, y: 61 },
            { x: 23, y: 82 },
            { x: 42, y: 20 },
            { x: 42, y: 42 },
            { x: 42, y: 58 },
            { x: 42, y: 80 },
            { x: 62, y: 36 },
            { x: 62, y: 64 },
          ],

          '4-3-3': [
            { x: 8, y: 50 },
            { x: 23, y: 18 },
            { x: 23, y: 39 },
            { x: 23, y: 61 },
            { x: 23, y: 82 },
            { x: 42, y: 30 },
            { x: 42, y: 50 },
            { x: 42, y: 70 },
            { x: 64, y: 20 },
            { x: 64, y: 50 },
            { x: 64, y: 80 },
          ],

          '3-5-2': [
            { x: 8, y: 50 },
            { x: 23, y: 30 },
            { x: 23, y: 50 },
            { x: 23, y: 70 },
            { x: 42, y: 20 },
            { x: 42, y: 39 },
            { x: 42, y: 50 },
            { x: 42, y: 61 },
            { x: 42, y: 80 },
            { x: 64, y: 36 },
            { x: 64, y: 64 },
          ],
        };

        const formationPositions =
          positions[
            match?.formation ||
              '4-4-2'
          ] ||
          positions['4-4-2'];

        const position =
          formationPositions[
            index >= 0
              ? index
              : 0
          ];

        let x =
          ((position.x - 50) /
            50) *
          15;

        let z =
          ((position.y - 50) /
            50) *
          10;

        if (team === 'away') {
          x = -x;
          z = -z;
        }

        return {
          x,
          z,
        };
      },
      [homeXI, awayXI, match]
    );

  // ==========================================================
  // ADD EVENT
  // ==========================================================

  const addMatchEvent =
    useCallback(
      (event) => {
        const newEvent = {
          id:
            `${event.type}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`,

          ...event,

          minute:
            minuteRef.current,
        };

        eventsRef.current = [
          newEvent,
          ...eventsRef.current,
        ];

        setEvents([
          ...eventsRef.current,
        ]);

        return newEvent;
      },
      []
    );

  // ==========================================================
  // SIMULATE ACTION
  // ==========================================================

  const simulateAction =
    useCallback(() => {
      if (
        homeXI.length < 11 ||
        awayXI.length < 11
      ) {
        return;
      }

      const homeStrength =
        calculateTeamStrength(
          homeXI
        );

      const awayStrength =
        calculateTeamStrength(
          awayXI
        );

      // ------------------------------------------------------
      // POSSESSION
      // ------------------------------------------------------

      const possessionShift =
        clamp(
          (homeStrength -
            awayStrength) *
            0.003 +
            (Math.random() -
              0.5) *
              0.04,
          -0.35,
          0.35
        );

      const currentPos =
        safeNumber(
          statsRef.current.home
            .possession,
          50
        );

      const nextPos =
        clamp(
          currentPos +
            possessionShift,
          20,
          80
        );

      statsRef.current.home.possession =
        Number(
          nextPos.toFixed(1)
        );

      statsRef.current.away.possession =
        Number(
          (
            100 -
            nextPos
          ).toFixed(1)
        );

      // ------------------------------------------------------
      // TEAM
      // ------------------------------------------------------

      const homeChance =
        nextPos / 100;

      const team =
        Math.random() <
        homeChance
          ? 'home'
          : 'away';

      const players =
        team === 'home'
          ? homeXI
          : awayXI;

      const opponents =
        team === 'home'
          ? awayXI
          : homeXI;

      const attackingStrength =
        team === 'home'
          ? homeStrength
          : awayStrength;

      const defendingStrength =
        team === 'home'
          ? awayStrength
          : homeStrength;

      if (
        players.length === 0
      ) {
        return;
      }

      // ------------------------------------------------------
      // SELECT PLAYER
      // ------------------------------------------------------

      const attackers =
        players.filter(
          (player) => {
            const position =
              normalizePosition(
                getPlayerPosition(
                  player
                )
              );

            return (
              position ===
                'ATT' ||
              position ===
                'MID'
            );
          }
        );

      const selected =
        attackers.length > 0
          ? attackers[
              Math.floor(
                Math.random() *
                  attackers.length
              )
            ]
          : players[
              Math.floor(
                Math.random() *
                  players.length
              )
            ];

      if (!selected) {
        return;
      }

      const selectedId =
        selected.id ||
        selected.playerId;

      const selectedPosition =
        getPlayer3DPosition(
          team,
          selected
        );

      const playerOVR =
        getPlayerOverall(
          selected
        );

      // ======================================================
      // PASS
      // ======================================================

      const passProbability =
        clamp(
          0.48 +
            (playerOVR - 60) *
              0.004,
          0.35,
          0.75
        );

      if (
        Math.random() <
        passProbability
      ) {
        const teammates =
          players.filter(
            (player) =>
              (
                player.id ||
                player.playerId
              ) !== selectedId
          );

        if (
          teammates.length ===
          0
        ) {
          return;
        }

        const target =
          teammates[
            Math.floor(
              Math.random() *
                teammates.length
            )
          ];

        const targetId =
          target.id ||
          target.playerId;

        const targetPosition =
          getPlayer3DPosition(
            team,
            target
          );

        statsRef.current[
          team
        ].passes += 1;

        const event =
          addMatchEvent({
            type: 'pass',
            team,
            playerId:
              selectedId,
            playerName:
              getPlayerName(
                selected
              ),
            targetPlayerId:
              targetId,
            targetPlayerName:
              getPlayerName(
                target
              ),
            detail: `${getPlayerName(
              selected
            )} passed to ${getPlayerName(
              target
            )}.`,
          });

        setLastAction({
          type: 'pass',
          team,
          playerId:
            selectedId,
          targetPlayerId:
            targetId,
          from: {
            x: selectedPosition.x,
            z: selectedPosition.z,
          },
          to: {
            x: targetPosition.x,
            z: targetPosition.z,
          },
          duration: 750,
          eventId:
            event.id,
        });

        return;
      }

      // ======================================================
      // SHOT
      // ======================================================

      const shotProbability =
        clamp(
          0.18 *
            (0.75 +
              (playerOVR /
                100) *
                0.55) *
            (attackingStrength /
              50) /
            Math.max(
              defendingStrength /
                50,
              0.1
            ),
          0.04,
          0.42
        );

      if (
        Math.random() <
        shotProbability
      ) {
        statsRef.current[
          team
        ].shots += 1;

        const onTarget =
          Math.random() <
          0.42 +
            (playerOVR /
              100) *
              0.32;

        if (onTarget) {
          statsRef.current[
            team
          ].shotsOnTarget += 1;
        }

        const goalProbability =
          clamp(
            0.22 *
              (attackingStrength /
                100) *
              (playerOVR /
                100) *
              (1 -
                (defendingStrength -
                  50) /
                  300),
            0.025,
            0.45
          );

        const isGoal =
          onTarget &&
          Math.random() <
            goalProbability;

        const goalPosition =
          team === 'home'
            ? {
                x: 15,
                z:
                  (Math.random() -
                    0.5) *
                  4,
              }
            : {
                x: -15,
                z:
                  (Math.random() -
                    0.5) *
                  4,
              };

        if (isGoal) {
          scoreRef.current[
            team
          ] += 1;

          const event =
            addMatchEvent({
              type: 'goal',
              team,
              playerId:
                selectedId,
              playerName:
                getPlayerName(
                  selected
                ),
              detail: `${getPlayerName(
                selected
              )} scored!`,
            });

          setLastAction({
            type: 'goal',
            team,
            playerId:
              selectedId,
            from: {
              x: selectedPosition.x,
              z: selectedPosition.z,
            },
            to: goalPosition,
            duration: 1200,
            eventId:
              event.id,
          });

          toast.success(
            `⚽ ${getPlayerName(
              selected
            )} scored!`
          );
        } else {
          const defendingTeam =
            team === 'home'
              ? 'away'
              : 'home';

          if (onTarget) {
            statsRef.current[
              defendingTeam
            ].saves += 1;

            const event =
              addMatchEvent({
                type: 'save',
                team: defendingTeam,
                playerId:
                  selectedId,
                playerName:
                  getPlayerName(
                    selected
                  ),
                detail: `Great save after ${getPlayerName(
                  selected
                )}'s shot.`,
              });

            setLastAction({
              type: 'shot',
              team,
              playerId:
                selectedId,
              from: {
                x: selectedPosition.x,
                z: selectedPosition.z,
              },
              to: goalPosition,
              duration: 950,
              eventId:
                event.id,
            });
          } else {
            const event =
              addMatchEvent({
                type: 'shot',
                team,
                playerId:
                  selectedId,
                playerName:
                  getPlayerName(
                    selected
                  ),
                detail: `${getPlayerName(
                  selected
                )} missed the target.`,
              });

            setLastAction({
              type: 'shot',
              team,
              playerId:
                selectedId,
              from: {
                x: selectedPosition.x,
                z: selectedPosition.z,
              },
              to: goalPosition,
              duration: 900,
              eventId:
                event.id,
            });
          }
        }

        return;
      }

      // ======================================================
      // TACKLE
      // ======================================================

      if (
        Math.random() <
        0.13
      ) {
        statsRef.current[
          team
        ].tackles += 1;

        const event =
          addMatchEvent({
            type: 'tackle',
            team,
            playerId:
              selectedId,
            playerName:
              getPlayerName(
                selected
              ),
            detail: `${getPlayerName(
              selected
            )} made a tackle.`,
          });

        setLastAction({
          type: 'tackle',
          team,
          playerId:
            selectedId,
          from: {
            x: selectedPosition.x,
            z: selectedPosition.z,
          },
          to: {
            x:
              selectedPosition.x +
              (Math.random() -
                0.5) *
                2,
            z:
              selectedPosition.z +
              (Math.random() -
                0.5) *
                2,
          },
          duration: 500,
          eventId:
            event.id,
        });

        return;
      }

      // ======================================================
      // FOUL
      // ======================================================

      if (
        Math.random() <
        0.035
      ) {
        statsRef.current[
          team
        ].fouls += 1;

        const yellow =
          Math.random() <
          0.12;

        if (yellow) {
          statsRef.current[
            team
          ].yellow += 1;
        }

        const event =
          addMatchEvent({
            type: yellow
              ? 'yellow'
              : 'foul',
            team,
            playerId:
              selectedId,
            playerName:
              getPlayerName(
                selected
              ),
            detail: yellow
              ? `${getPlayerName(
                  selected
                )} received a yellow card.`
              : `${getPlayerName(
                  selected
                )} committed a foul.`,
          });

        setLastAction({
          type: 'foul',
          team,
          playerId:
            selectedId,
          from: {
            x: selectedPosition.x,
            z: selectedPosition.z,
          },
          to: {
            x: selectedPosition.x,
            z: selectedPosition.z,
          },
          duration: 400,
          eventId:
            event.id,
        });

        return;
      }

      // ======================================================
      // CORNER
      // ======================================================

      if (
        Math.random() <
        0.025
      ) {
        statsRef.current[
          team
        ].corners += 1;

        const event =
          addMatchEvent({
            type: 'corner',
            team,
            playerId:
              selectedId,
            playerName:
              getPlayerName(
                selected
              ),
            detail: `${team === 'home' ? 'Home' : 'Away'} won a corner.`,
          });

        const cornerX =
          team === 'home'
            ? 14
            : -14;

        const cornerZ =
          Math.random() <
          0.5
            ? -9
            : 9;

        setLastAction({
          type: 'corner',
          team,
          playerId:
            selectedId,
          from: {
            x: selectedPosition.x,
            z: selectedPosition.z,
          },
          to: {
            x: cornerX,
            z: cornerZ,
          },
          duration: 850,
          eventId:
            event.id,
        });

        return;
      }
    }, [
      homeXI,
      awayXI,
      calculateTeamStrength,
      getPlayer3DPosition,
      addMatchEvent,
    ]);

  // ==========================================================
  // SIMULATE MINUTE
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      isPaused ||
      loading ||
      matchMinute <= 0
    ) {
      return;
    }

    if (
      processingRef.current
    ) {
      return;
    }

    processingRef.current = true;

    // Approximately 10 actions per match minute

    for (
      let i = 0;
      i < 10;
      i++
    ) {
      simulateAction();
    }

    setHomeScore(
      scoreRef.current.home
    );

    setAwayScore(
      scoreRef.current.away
    );

    setHomeStats({
      ...statsRef.current.home,
    });

    setAwayStats({
      ...statsRef.current.away,
    });

    setEvents([
      ...eventsRef.current,
    ]);

    if (
      matchMinute % 5 ===
      0
    ) {
      saveMatchState(
        'live'
      );
    }

    processingRef.current = false;
  }, [
    matchMinute,
    matchStatus,
    isPaused,
    loading,
    simulateAction,
    saveMatchState,
  ]);

  // ==========================================================
  // TIMER
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      isPaused ||
      loading
    ) {
      return;
    }

    timerRef.current =
      setInterval(() => {
        setMatchMinute(
          (previous) => {
            const next =
              previous + 1;

            minuteRef.current =
              next;

            const firstHalfTotal =
              FIRST_HALF_END +
              injuryTime.firstHalf;

            const fullMatchTotal =
              MATCH_DURATION +
              injuryTime.firstHalf +
              injuryTime.secondHalf;

            if (
              next ===
                firstHalfTotal &&
              previous <
                firstHalfTotal
            ) {
              setMatchStatus(
                'half-time'
              );

              setIsPaused(true);

              saveMatchState(
                'half-time'
              );

              return next;
            }

            if (
              next >=
              fullMatchTotal
            ) {
              finishMatch();

              return fullMatchTotal;
            }

            return next;
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

        timerRef.current =
          null;
      }
    };
  }, [
    matchStatus,
    isPaused,
    loading,
    injuryTime,
    saveMatchState,
    finishMatch,
  ]);

  // ==========================================================
  // START MATCH
  // ==========================================================

  const startMatch =
    useCallback(
      async () => {
        if (
          matchStatus !==
            'ready' &&
          matchStatus !==
            'half-time'
        ) {
          return;
        }

        setMatchStatus(
          'live'
        );

        setIsPaused(false);

        await saveMatchState(
          'live'
        );

        toast.success(
          matchStatus ===
            'half-time'
            ? 'Second half started!'
            : 'Match started!'
        );
      },
      [
        matchStatus,
        saveMatchState,
      ]
    );

  // ==========================================================
  // PAUSE
  // ==========================================================

  const togglePause =
    useCallback(
      () => {
        if (
          matchStatus !==
          'live'
        ) {
          return;
        }

        setIsPaused(
          (previous) =>
            !previous
        );

        saveMatchState(
          matchStatus
        );
      },
      [
        matchStatus,
        saveMatchState,
      ]
    );

  // ==========================================================
  // RENDER STATES
  // ==========================================================

  if (
    authLoading ||
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

  if (error) {
    return (
      <div
        className={
          styles.errorContainer
        }
      >
        <div
          className={
            styles.errorIcon
          }
        >
          ⚠️
        </div>

        <h1>
          Match Error
        </h1>

        <p>{error}</p>

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
        <div
          className={
            styles.errorIcon
          }
        >
          ⚽
        </div>

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

  // ==========================================================
  // STATUS
  // ==========================================================

  const statusLabel =
    matchStatus ===
    'ready'
      ? 'READY'
      : matchStatus ===
        'live'
      ? isPaused
        ? 'PAUSED'
        : 'LIVE'
      : matchStatus ===
        'half-time'
      ? 'HALF TIME'
      : 'FULL TIME';

  const displayMinute =
    matchMinute > 90
      ? `90+${
          matchMinute - 90
        }`
      : matchMinute;

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{' '}
          {awayClub.name} |
          Match
        </title>
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* ==================================================
            HEADER
        ================================================== */}

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
            className={`${styles.status} ${
              matchStatus ===
              'live'
                ? styles.live
                : ''
            }`}
          >
            {statusLabel}
          </span>
        </header>

        {/* ==================================================
            3D PITCH
        ================================================== */}

        <div
          className={
            styles.pitchContainer
          }
        >
          <ThreePitch
            homeXI={homeXI}
            awayXI={awayXI}
            homeColor={
              homeClub.primaryColor ||
              '#3b82f6'
            }
            awayColor={
              awayClub.primaryColor ||
              '#ef4444'
            }
            formation={
              match.formation ||
              '4-4-2'
            }
            lastAction={
              lastAction
            }
            isPaused={
              isPaused ||
              matchStatus !==
                'live'
            }
          />
        </div>

        {/* ==================================================
            SCOREBOARD
        ================================================== */}

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
            <div
              className={
                styles.clubLogo
              }
            >
              {homeClub.logo ? (
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
              {homeClub.name}
            </strong>

            <span
              className={
                styles.badge
              }
            >
              HOME
            </span>
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
              <strong
                className={
                  styles.homeScore
                }
              >
                {homeScore}
              </strong>

              <span>
                -
              </span>

              <strong
                className={
                  styles.awayScore
                }
              >
                {awayScore}
              </strong>
            </div>

            <div
              className={
                styles.matchClock
              }
            >
              {displayMinute}'
            </div>

            <small>
              {statusLabel}
            </small>
          </div>

          <div
            className={
              styles.scoreTeam
            }
          >
            <div
              className={
                styles.clubLogo
              }
            >
              {awayClub.logo ? (
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
              {awayClub.name}
            </strong>

            <span
              className={
                styles.badge
              }
            >
              AWAY
            </span>
          </div>
        </section>

        {/* ==================================================
            CONTROLS
        ================================================== */}

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
              disabled={
                isSaving
              }
            >
              ▶ START MATCH
            </button>
          )}

          {matchStatus ===
            'half-time' && (
            <button
              className={
                styles.primaryButton
              }
              onClick={
                startMatch
              }
              disabled={
                isSaving
              }
            >
              ▶ START SECOND HALF
            </button>
          )}

          {matchStatus ===
            'live' && (
            <>
              <button
                onClick={
                  togglePause
                }
                disabled={
                  isSaving
                }
              >
                {isPaused
                  ? '▶ Resume'
                  : '⏸ Pause'}
              </button>

              <button
                onClick={
                  finishMatch
                }
                disabled={
                  isSaving
                }
              >
                ⏹ Finish
              </button>
            </>
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

        {/* ==================================================
            STATS
        ================================================== */}

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
              {homeScore} -{' '}
              {awayScore}
            </strong>
          </div>

          {[
            [
              'Possession',
              formatPossession(
                homeStats.possession
              ),
              formatPossession(
                awayStats.possession
              ),
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
              'Tackles',
              homeStats.tackles,
              awayStats.tackles,
            ],

            [
              'Yellow Cards',
              homeStats.yellow,
              awayStats.yellow,
            ],
          ].map(
            (row) => (
              <div
                key={row[0]}
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

        {/* ==================================================
            EVENTS
        ================================================== */}

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
            <div>
              <span>
                LIVE FEED
              </span>

              <h2>
                Match Events
              </h2>
            </div>
          </div>

          <div
            className={
              styles.eventsList
            }
          >
            {events.length >
            0 ? (
              events
                .slice(
                  0,
                  30
                )
                .map(
                  (
                    event
                  ) => (
                    <div
                      key={
                        event.id
                      }
                      className={
                        styles.event
                      }
                    >
                      <span
                        className={
                          styles.eventMinute
                        }
                      >
                        {event.minute >
                        90
                          ? `90+${
                              event.minute -
                              90
                            }`
                          : event.minute}
                        '
                      </span>

                      <span
                        className={
                          styles.eventIcon
                        }
                      >
                        {event.type ===
                        'goal'
                          ? '⚽'
                          : event.type ===
                            'save'
                          ? '🧤'
                          : event.type ===
                            'shot'
                          ? '💥'
                          : event.type ===
                            'yellow'
                          ? '🟨'
                          : event.type ===
                            'corner'
                          ? '🚩'
                          : event.type ===
                            'tackle'
                          ? '🛡️'
                          : '🔄'}
                      </span>

                      <div>
                        <strong>
                          {event.type.toUpperCase()}
                        </strong>

                        <p>
                          {event.detail ||
                            event.playerName}
                        </p>
                      </div>

                      <span
                        className={
                          event.team ===
                          'home'
                            ? styles.homeEvent
                            : styles.awayEvent
                        }
                      >
                        {event.team ===
                        'home'
                          ? homeClub.name
                          : awayClub.name}
                      </span>
                    </div>
                  )
                )
            ) : (
              <div
                className={
                  styles.noEvents
                }
              >
                No events yet.
                Match in
                progress...
              </div>
            )}
          </div>
        </section>

        {/* ==================================================
            LINEUPS
        ================================================== */}

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
              {homeClub.name}{' '}
              <small>
                Starting XI
              </small>
            </h3>

            {homeXI
              .slice(
                0,
                11
              )
              .map(
                (player) => (
                  <div
                    key={
                      player.id
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

                    <span
                      className={
                        styles.playerRating
                      }
                    >
                      {getPlayerOverall(
                        player
                      )}
                    </span>
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
              {awayClub.name}{' '}
              <small>
                Starting XI
              </small>
            </h3>

            {awayXI
              .slice(
                0,
                11
              )
              .map(
                (player) => (
                  <div
                    key={
                      player.id
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

                    <span
                      className={
                        styles.playerRating
                      }
                    >
                      {getPlayerOverall(
                        player
                      )}
                    </span>
                  </div>
                )
              )}
          </div>
        </section>

        {/* ==================================================
            MATCH INFO
        ================================================== */}

        <section
          className={
            styles.matchInfo
          }
        >
          <div>
            <span>
              STADIUM
            </span>

            <strong>
              {match.stadium ||
                'Unknown Stadium'}
            </strong>
          </div>

          <div>
            <span>
              LEAGUE
            </span>

            <strong>
              {match.leagueName ||
                match.competition ||
                'Friendly'}
            </strong>
          </div>

          <div>
            <span>
              DATE
            </span>

            <strong>
              {match.date
                ? new Date(
                    match.date
                  ).toLocaleDateString()
                : '-'}
            </strong>
          </div>

          <div>
            <span>
              INJURY TIME
            </span>

            <strong>
              +
              {
                injuryTime.firstHalf
              }{' '}
              / +
              {
                injuryTime.secondHalf
              }
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
