import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
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

import { db } from '../../components/firebase';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

import {
  FORMATIONS,
  TACTICS,
  MATCH_DURATION,
} from '../../utils/matchConstants';

import {
  getClubName,
  getClubLogo,
  getPlayerName,
  getPlayerPosition,
  getPlayerOverall,
  playerId,
  calculateTeamStrength,
  safeNumber,
  normalizePosition,
} from '../../utils/matchHelpers';

import styles from './match.module.css';

/*
|--------------------------------------------------------------------------
| THREE.JS
|--------------------------------------------------------------------------
|
| ThreePitch is loaded only in the browser.
| This prevents:
|
|   window is not defined
|   document is not defined
|
| during Next.js SSR.
|
*/

const ThreePitch = dynamic(
  () => import('../../components/ThreePitch'),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          minHeight: 360,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        Loading 3D pitch...
      </div>
    ),
  }
);

/*
|--------------------------------------------------------------------------
| DEFAULT STATS
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| NORMALIZE STATS
|--------------------------------------------------------------------------
*/

function normalizeStats(value) {
  const defaults = createDefaultStats();

  return {
    ...defaults,
    ...(value && typeof value === 'object' ? value : {}),
  };
}

/*
|--------------------------------------------------------------------------
| SAFE PLAYER POSITION
|--------------------------------------------------------------------------
*/

function positionOf(player) {
  try {
    return normalizePosition(
      getPlayerPosition(player) || player?.position || 'MID'
    );
  } catch {
    return String(
      player?.position ||
      player?.pos ||
      player?.role ||
      'MID'
    ).toUpperCase();
  }
}

/*
|--------------------------------------------------------------------------
| LOAD CLUB PLAYERS
|--------------------------------------------------------------------------
*/

async function loadClubPlayers(clubId) {
  if (!clubId) return [];

  const playersRef = collection(db, 'players');

  /*
  |--------------------------------------------------------------------------
  | Primary query
  |--------------------------------------------------------------------------
  */

  try {
    const q = query(
      playersRef,
      where('clubId', '==', clubId)
    );

    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      return snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
    }
  } catch (error) {
    console.warn(
      '[MATCH] clubId player query failed:',
      error
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Fallback
  |--------------------------------------------------------------------------
  |
  | Different versions of the manager used:
  |
  | clubId
  | currentClub
  | teamId
  | club
  |
  */

  try {
    const snapshot = await getDocs(playersRef);

    return snapshot.docs
      .map((item) => ({
        id: item.id,
        ...item.data(),
      }))
      .filter((player) => {
        const playerClub =
          player.clubId ||
          player.currentClub ||
          player.teamId ||
          player.club ||
          null;

        return String(playerClub) === String(clubId);
      });
  } catch (error) {
    console.error(
      '[MATCH] Failed loading players:',
      error
    );

    return [];
  }
}

/*
|--------------------------------------------------------------------------
| FORMATION REQUIREMENTS
|--------------------------------------------------------------------------
*/

function getFormationRequirements(formation) {
  const formations = {
    '4-4-2': {
      GK: 1,
      DEF: 4,
      MID: 4,
      FWD: 2,
    },

    '4-3-3': {
      GK: 1,
      DEF: 4,
      MID: 3,
      FWD: 3,
    },

    '3-5-2': {
      GK: 1,
      DEF: 3,
      MID: 5,
      FWD: 2,
    },

    '5-3-2': {
      GK: 1,
      DEF: 5,
      MID: 3,
      FWD: 2,
    },

    '4-2-3-1': {
      GK: 1,
      DEF: 4,
      MID: 5,
      FWD: 1,
    },
  };

  return formations[formation] || formations['4-4-2'];
}

/*
|--------------------------------------------------------------------------
| SELECT STARTING XI
|--------------------------------------------------------------------------
*/

function selectStartingXI(squad, formation) {
  if (!Array.isArray(squad)) return [];

  if (squad.length === 0) return [];

  const requirements =
    getFormationRequirements(formation);

  const sorted = [...squad].sort(
    (a, b) =>
      safeNumber(getPlayerOverall(b), 60) -
      safeNumber(getPlayerOverall(a), 60)
  );

  const selected = [];
  const used = new Set();

  const addBest = (positions, amount) => {
    let added = 0;

    for (const player of sorted) {
      if (added >= amount) break;

      const id = playerId(player);

      if (!id || used.has(String(id))) {
        continue;
      }

      const position = positionOf(player);

      if (positions.includes(position)) {
        selected.push(player);
        used.add(String(id));
        added += 1;
      }
    }

    return added;
  };

  /*
  |--------------------------------------------------------------------------
  | First choose natural positions
  |--------------------------------------------------------------------------
  */

  addBest(['GK', 'G', 'GOALKEEPER'], requirements.GK);

  addBest(
    ['DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'D'],
    requirements.DEF
  );

  addBest(
    ['MID', 'CM', 'CDM', 'CAM', 'LM', 'RM', 'DM', 'AM', 'M'],
    requirements.MID
  );

  addBest(
    ['FWD', 'ST', 'CF', 'LW', 'RW', 'ATT', 'FW', 'A'],
    requirements.FWD
  );

  /*
  |--------------------------------------------------------------------------
  | Fill remaining slots with best players
  |--------------------------------------------------------------------------
  */

  for (const player of sorted) {
    if (selected.length >= 11) break;

    const id = playerId(player);

    if (!id || used.has(String(id))) continue;

    selected.push(player);
    used.add(String(id));
  }

  /*
  |--------------------------------------------------------------------------
  | If fewer than 11 players exist, use entire squad.
  |--------------------------------------------------------------------------
  */

  return selected.slice(0, Math.min(11, sorted.length));
}

/*
|--------------------------------------------------------------------------
| EVENT LABEL
|--------------------------------------------------------------------------
*/

function eventLabel(event) {
  const labels = {
    goal: 'GOAL',
    yellow: 'YELLOW CARD',
    red: 'RED CARD',
    foul: 'FOUL',
    corner: 'CORNER',
    save: 'SAVE',
    shot: 'SHOT',
    substitution: 'SUBSTITUTION',
    halftime: 'HALF TIME',
    fulltime: 'FULL TIME',
  };

  return labels[event?.type] || 'EVENT';
}

/*
|--------------------------------------------------------------------------
| EVENT ICON
|--------------------------------------------------------------------------
*/

function eventIcon(event) {
  const icons = {
    goal: '⚽',
    yellow: '🟨',
    red: '🟥',
    foul: '⚠️',
    corner: '🚩',
    save: '🧤',
    shot: '💥',
    substitution: '🔄',
    halftime: '⏸️',
    fulltime: '🏁',
  };

  return icons[event?.type] || '•';
}

/*
|--------------------------------------------------------------------------
| SAFE EVENT ID
|--------------------------------------------------------------------------
*/

function getEventId(event, index) {
  return (
    event?.id ||
    `${event?.minute || 0}-${event?.type || 'event'}-${index}`
  );
}

/*
|--------------------------------------------------------------------------
| PAGE
|--------------------------------------------------------------------------
*/

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    loading: authLoading,
  } = useAuth();

  /*
  |--------------------------------------------------------------------------
  | ROUTER ID
  |--------------------------------------------------------------------------
  */

  const matchId =
    router.isReady &&
    typeof router.query.id === 'string'
      ? router.query.id
      : null;

  /*
  |--------------------------------------------------------------------------
  | MATCH DATA
  |--------------------------------------------------------------------------
  */

  const [match, setMatch] = useState(null);

  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);

  const [homeSquad, setHomeSquad] = useState([]);
  const [awaySquad, setAwaySquad] = useState([]);

  const [homeXI, setHomeXI] = useState([]);
  const [awayXI, setAwayXI] = useState([]);

  /*
  |--------------------------------------------------------------------------
  | MATCH STATE
  |--------------------------------------------------------------------------
  */

  const [matchMinute, setMatchMinute] = useState(0);

  const [matchStatus, setMatchStatus] =
    useState('ready');

  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);

  const [events, setEvents] = useState([]);

  const [homeStats, setHomeStats] =
    useState(createDefaultStats());

  const [awayStats, setAwayStats] =
    useState(createDefaultStats());

  /*
  |--------------------------------------------------------------------------
  | TACTICS
  |--------------------------------------------------------------------------
  */

  const [formation, setFormation] =
    useState('4-4-2');

  const [tactic, setTactic] =
    useState('Tiki-Taka');

  const [mentality, setMentality] =
    useState('balanced');

  /*
  |--------------------------------------------------------------------------
  | MATCH CONTROL
  |--------------------------------------------------------------------------
  */

  const [isPaused, setIsPaused] =
    useState(false);

  const [loadingMatch, setLoadingMatch] =
    useState(true);

  const [userClubId, setUserClubId] =
    useState(null);

  const [injuryTimeFirstHalf, setInjuryTimeFirstHalf] =
    useState(2);

  const [injuryTimeSecondHalf, setInjuryTimeSecondHalf] =
    useState(3);

  const [showFormation, setShowFormation] =
    useState(false);

  const [showTactics, setShowTactics] =
    useState(false);

  const [showSubs, setShowSubs] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  /*
  |--------------------------------------------------------------------------
  | STAMINA
  |--------------------------------------------------------------------------
  */

  const [playerStamina, setPlayerStamina] =
    useState({
      home: {},
      away: {},
    });

  /*
  |--------------------------------------------------------------------------
  | POSSESSION
  |--------------------------------------------------------------------------
  */

  const [ballPossession, setBallPossession] =
    useState({
      home: 50,
      away: 50,
    });

  /*
  |--------------------------------------------------------------------------
  | USER CLUB
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;

    const loadUserClub = async () => {
      try {
        const userRef = doc(
          db,
          'users',
          user.uid
        );

        const snapshot =
          await getDoc(userRef);

        if (!snapshot.exists()) return;

        const data = snapshot.data();

        const clubId =
          data?.careerData?.currentClub ||
          data?.currentClub ||
          data?.clubId ||
          null;

        if (!cancelled) {
          setUserClubId(clubId);
        }
      } catch (error) {
        console.error(
          '[MATCH] User club error:',
          error
        );
      }
    };

    loadUserClub();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  /*
  |--------------------------------------------------------------------------
  | LOAD MATCH
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      authLoading ||
      !user ||
      !router.isReady ||
      !matchId
    ) {
      return;
    }

    let cancelled = false;

    const loadMatch = async () => {
      setLoadingMatch(true);

      try {
        const matchRef = doc(
          db,
          'matches',
          matchId
        );

        const matchSnap =
          await getDoc(matchRef);

        if (!matchSnap.exists()) {
          toast.error('Match not found');

          router.replace('/fixture');

          return;
        }

        if (cancelled) return;

        const matchData = {
          id: matchSnap.id,
          ...matchSnap.data(),
        };

        setMatch(matchData);

        /*
        |--------------------------------------------------------------------------
        | TEAM IDS
        |--------------------------------------------------------------------------
        */

        const homeId =
          matchData.homeClubId ||
          matchData.homeTeamId ||
          matchData.homeId;

        const awayId =
          matchData.awayClubId ||
          matchData.awayTeamId ||
          matchData.awayId;

        if (!homeId || !awayId) {
          throw new Error(
            'Match does not contain homeClubId and awayClubId'
          );
        }

        /*
        |--------------------------------------------------------------------------
        | LOAD CLUBS
        |--------------------------------------------------------------------------
        */

        const [
          homeClubSnapshot,
          awayClubSnapshot,
        ] = await Promise.all([
          getDoc(doc(db, 'clubs', homeId)),
          getDoc(doc(db, 'clubs', awayId)),
        ]);

        const home = homeClubSnapshot.exists()
          ? {
              id: homeClubSnapshot.id,
              ...homeClubSnapshot.data(),
            }
          : {
              id: homeId,
              name:
                matchData.homeClubName ||
                'Home Club',
            };

        const away = awayClubSnapshot.exists()
          ? {
              id: awayClubSnapshot.id,
              ...awayClubSnapshot.data(),
            }
          : {
              id: awayId,
              name:
                matchData.awayClubName ||
                'Away Club',
            };

        if (cancelled) return;

        setHomeClub(home);
        setAwayClub(away);

        /*
        |--------------------------------------------------------------------------
        | LOAD PLAYERS
        |--------------------------------------------------------------------------
        */

        const [
          loadedHomeSquad,
          loadedAwaySquad,
        ] = await Promise.all([
          loadClubPlayers(homeId),
          loadClubPlayers(awayId),
        ]);

        if (cancelled) return;

        setHomeSquad(loadedHomeSquad);
        setAwaySquad(loadedAwaySquad);

        /*
        |--------------------------------------------------------------------------
        | FORMATION
        |--------------------------------------------------------------------------
        */

        const savedFormation =
          matchData.formation ||
          matchData.homeFormation ||
          '4-4-2';

        setFormation(savedFormation);

        /*
        |--------------------------------------------------------------------------
        | STARTING XI
        |--------------------------------------------------------------------------
        */

        const startingHome =
          selectStartingXI(
            loadedHomeSquad,
            savedFormation
          );

        const startingAway =
          selectStartingXI(
            loadedAwaySquad,
            savedFormation
          );

        setHomeXI(startingHome);
        setAwayXI(startingAway);

        /*
        |--------------------------------------------------------------------------
        | STAMINA
        |--------------------------------------------------------------------------
        */

        const homeStamina = {};
        const awayStamina = {};

        startingHome.forEach((player) => {
          const id = playerId(player);

          if (id) {
            homeStamina[id] =
              safeNumber(
                matchData?.playerStamina?.home?.[id],
                100
              );
          }
        });

        startingAway.forEach((player) => {
          const id = playerId(player);

          if (id) {
            awayStamina[id] =
              safeNumber(
                matchData?.playerStamina?.away?.[id],
                100
              );
          }
        });

        setPlayerStamina({
          home: homeStamina,
          away: awayStamina,
        });

        /*
        |--------------------------------------------------------------------------
        | MATCH STATE
        |--------------------------------------------------------------------------
        */

        const savedHomeScore =
          safeNumber(
            matchData.homeScore ??
              matchData.result?.homeScore,
            0
          );

        const savedAwayScore =
          safeNumber(
            matchData.awayScore ??
              matchData.result?.awayScore,
            0
          );

        const savedMinute =
          safeNumber(matchData.minute, 0);

        const savedHomeStats =
          normalizeStats(
            matchData.homeStats
          );

        const savedAwayStats =
          normalizeStats(
            matchData.awayStats
          );

        const savedEvents =
          Array.isArray(matchData.events)
            ? matchData.events
            : [];

        setHomeScore(savedHomeScore);
        setAwayScore(savedAwayScore);
        setMatchMinute(savedMinute);
        setHomeStats(savedHomeStats);
        setAwayStats(savedAwayStats);
        setEvents(savedEvents);

        /*
        |--------------------------------------------------------------------------
        | STATUS
        |--------------------------------------------------------------------------
        */

        let status =
          matchData.status || 'scheduled';

        if (status === 'scheduled') {
          status = 'ready';
        }

        if (
          matchData.result &&
          matchData.status !== 'live' &&
          matchData.status !== 'half-time'
        ) {
          status = 'finished';
        }

        setMatchStatus(status);

        /*
        |--------------------------------------------------------------------------
        | INJURY TIME
        |--------------------------------------------------------------------------
        */

        setInjuryTimeFirstHalf(
          safeNumber(
            matchData.injuryTimeFirstHalf,
            2
          )
        );

        setInjuryTimeSecondHalf(
          safeNumber(
            matchData.injuryTimeSecondHalf,
            3
          )
        );

        /*
        |--------------------------------------------------------------------------
        | POSSESSION
        |--------------------------------------------------------------------------
        */

        setBallPossession({
          home: safeNumber(
            savedHomeStats.possession,
            50
          ),
          away: safeNumber(
            savedAwayStats.possession,
            50
          ),
        });
      } catch (error) {
        console.error(
          '[MATCH] Load error:',
          error
        );

        toast.error(
          error?.message ||
            'Could not load match'
        );
      } finally {
        if (!cancelled) {
          setLoadingMatch(false);
        }
      }
    };

    loadMatch();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    router,
    matchId,
  ]);

  /*
  |--------------------------------------------------------------------------
  | USER PARTICIPATION
  |--------------------------------------------------------------------------
  */

  const isHomeUser =
    String(userClubId || '') ===
    String(homeClub?.id || '');

  const isAwayUser =
    String(userClubId || '') ===
    String(awayClub?.id || '');

  const userIsParticipant =
    isHomeUser || isAwayUser;

  /*
  |--------------------------------------------------------------------------
  | START MATCH
  |--------------------------------------------------------------------------
  */

  const startMatch = useCallback(async () => {
    if (!matchId) return;

    if (!userIsParticipant) {
      toast.error(
        'You are not managing either club.'
      );
      return;
    }

    try {
      setSaving(true);

      await updateDoc(
        doc(db, 'matches', matchId),
        {
          status: 'live',
          minute: 0,
          homeScore: 0,
          awayScore: 0,
          homeStats,
          awayStats,
          events: [],
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      setMatchStatus('live');
      setMatchMinute(0);
      setIsPaused(false);

      toast.success('Match started');
    } catch (error) {
      console.error(
        '[MATCH] Start error:',
        error
      );

      toast.error(
        error?.message ||
          'Could not start match'
      );
    } finally {
      setSaving(false);
    }
  }, [
    matchId,
    userIsParticipant,
    homeStats,
    awayStats,
  ]);

  /*
  |--------------------------------------------------------------------------
  | SAVE MATCH
  |--------------------------------------------------------------------------
  */

  const saveMatchState = useCallback(
    async (extra = {}) => {
      if (!matchId) return;

      try {
        await updateDoc(
          doc(db, 'matches', matchId),
          {
            status: matchStatus,
            minute: matchMinute,
            homeScore,
            awayScore,
            homeStats,
            awayStats,
            events,
            playerStamina,
            updatedAt: serverTimestamp(),
            ...extra,
          }
        );
      } catch (error) {
        console.error(
          '[MATCH] Save error:',
          error
        );
      }
    },
    [
      matchId,
      matchStatus,
      matchMinute,
      homeScore,
      awayScore,
      homeStats,
      awayStats,
      events,
      playerStamina,
    ]
  );

  /*
  |--------------------------------------------------------------------------
  | FINISH MATCH
  |--------------------------------------------------------------------------
  */

  const finishMatch = useCallback(async () => {
    if (
      matchStatus === 'finished' ||
      !matchId
    ) {
      return;
    }

    setMatchStatus('finished');
    setIsPaused(true);

    try {
      const result = {
        homeScore,
        awayScore,
      };

      await updateDoc(
        doc(db, 'matches', matchId),
        {
          status: 'finished',
          minute:
            90 +
            injuryTimeFirstHalf +
            injuryTimeSecondHalf,
          homeScore,
          awayScore,
          homeStats,
          awayStats,
          events,
          playerStamina,
          result,
          finishedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      toast.success(
        `Full time: ${homeScore} - ${awayScore}`
      );
    } catch (error) {
      console.error(
        '[MATCH] Finish error:',
        error
      );

      toast.error(
        'Match finished locally, but could not save result.'
      );
    }
  }, [
    matchId,
    matchStatus,
    homeScore,
    awayScore,
    homeStats,
    awayStats,
    events,
    playerStamina,
    injuryTimeFirstHalf,
    injuryTimeSecondHalf,
  ]);

  /*
  |--------------------------------------------------------------------------
  | TIMER
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      isPaused
    ) {
      return undefined;
    }

    const firstHalfEnd =
      45 + injuryTimeFirstHalf;

    const fullTime =
      90 +
      injuryTimeFirstHalf +
      injuryTimeSecondHalf;

    const timer = setInterval(() => {
      setMatchMinute((previous) => {
        const next = previous + 1;

        if (
          next >= fullTime
        ) {
          return fullTime;
        }

        if (
          next === firstHalfEnd
        ) {
          setMatchStatus('half-time');
          setIsPaused(true);
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [
    matchStatus,
    isPaused,
    injuryTimeFirstHalf,
    injuryTimeSecondHalf,
  ]);

  /*
  |--------------------------------------------------------------------------
  | FINISH WHEN FULL TIME REACHED
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const fullTime =
      90 +
      injuryTimeFirstHalf +
      injuryTimeSecondHalf;

    if (
      matchStatus === 'live' &&
      matchMinute >= fullTime
    ) {
      finishMatch();
    }
  }, [
    matchMinute,
    matchStatus,
    injuryTimeFirstHalf,
    injuryTimeSecondHalf,
    finishMatch,
  ]);

  /*
  |--------------------------------------------------------------------------
  | CONTINUE SECOND HALF
  |--------------------------------------------------------------------------
  */

  const startSecondHalf = useCallback(() => {
    if (matchStatus !== 'half-time') {
      return;
    }

    setMatchStatus('live');
    setIsPaused(false);
  }, [matchStatus]);

  /*
  |--------------------------------------------------------------------------
  | SIMPLE FALLBACK SIMULATION
  |--------------------------------------------------------------------------
  |
  | This keeps the page functional even if the custom hook is not available.
  | One simulation tick represents one in-game minute.
  |
  */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      isPaused ||
      homeXI.length === 0 ||
      awayXI.length === 0
    ) {
      return undefined;
    }

    const timer = setInterval(() => {
      const homeStrength =
        calculateTeamStrength(homeXI);

      const awayStrength =
        calculateTeamStrength(awayXI);

      const totalStrength =
        Math.max(
          1,
          homeStrength +
            awayStrength
        );

      const homePossession =
        Math.round(
          45 +
            (homeStrength /
              totalStrength) *
              10 +
            (Math.random() * 6 - 3)
        );

      const safeHomePossession =
        Math.max(
          35,
          Math.min(
            65,
            homePossession
          )
        );

      const safeAwayPossession =
        100 -
        safeHomePossession;

      setBallPossession({
        home: safeHomePossession,
        away: safeAwayPossession,
      });

      setHomeStats((previous) => ({
        ...previous,
        possession:
          safeHomePossession,
        passes:
          previous.passes +
          Math.floor(
            1 +
            Math.random() * 4
          ),
      }));

      setAwayStats((previous) => ({
        ...previous,
        possession:
          safeAwayPossession,
        passes:
          previous.passes +
          Math.floor(
            1 +
            Math.random() * 4
          ),
      }));

      /*
      |--------------------------------------------------------------------------
      | RANDOM MATCH EVENT
      |--------------------------------------------------------------------------
      */

      const roll = Math.random();

      if (roll < 0.045) {
        const homeChance =
          homeStrength /
          Math.max(
            1,
            homeStrength +
              awayStrength
          );

        const scoringTeam =
          Math.random() <
          homeChance
            ? 'home'
            : 'away';

        const scoringPlayers =
          scoringTeam === 'home'
            ? homeXI
            : awayXI;

        const player =
          scoringPlayers[
            Math.floor(
              Math.random() *
                scoringPlayers.length
            )
          ];

        const event = {
          id: `${Date.now()}-${Math.random()}`,
          minute: matchMinute,
          type: 'goal',
          team: scoringTeam,
          playerName:
            player
              ? getPlayerName(player)
              : 'Unknown player',
          detail: 'Goal',
        };

        setEvents((previous) => [
          event,
          ...previous,
        ]);

        if (scoringTeam === 'home') {
          setHomeScore(
            (previous) =>
              previous + 1
          );

          setHomeStats((previous) => ({
            ...previous,
            shots:
              previous.shots + 1,
            shotsOnTarget:
              previous.shotsOnTarget + 1,
          }));
        } else {
          setAwayScore(
            (previous) =>
              previous + 1
          );

          setAwayStats((previous) => ({
            ...previous,
            shots:
              previous.shots + 1,
            shotsOnTarget:
              previous.shotsOnTarget + 1,
          }));
        }
      } else if (roll < 0.15) {
        const team =
          Math.random() < 0.5
            ? 'home'
            : 'away';

        const squad =
          team === 'home'
            ? homeXI
            : awayXI;

        const player =
          squad[
            Math.floor(
              Math.random() *
                squad.length
            )
          ];

        const event = {
          id: `${Date.now()}-${Math.random()}`,
          minute: matchMinute,
          type: 'shot',
          team,
          playerName:
            player
              ? getPlayerName(player)
              : 'Unknown player',
          detail: 'Shot',
        };

        setEvents((previous) => [
          event,
          ...previous,
        ]);

        if (team === 'home') {
          setHomeStats((previous) => ({
            ...previous,
            shots:
              previous.shots + 1,
          }));
        } else {
          setAwayStats((previous) => ({
            ...previous,
            shots:
              previous.shots + 1,
          }));
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [
    matchStatus,
    isPaused,
    homeXI,
    awayXI,
    matchMinute,
  ]);

  /*
  |--------------------------------------------------------------------------
  | AUTOSAVE
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      matchStatus !== 'live' ||
      !matchId
    ) {
      return;
    }

    const timer = setTimeout(() => {
      saveMatchState();
    }, 1500);

    return () => clearTimeout(timer);
  }, [
    matchMinute,
    homeScore,
    awayScore,
    homeStats,
    awayStats,
    events,
    matchStatus,
    matchId,
    saveMatchState,
  ]);

  /*
  |--------------------------------------------------------------------------
  | DISPLAY HELPERS
  |--------------------------------------------------------------------------
  */

  const displayMinute =
    matchMinute > 90
      ? `90+${matchMinute - 90}`
      : matchMinute;

  const statusLabel =
    matchStatus === 'ready'
      ? 'READY'
      : matchStatus === 'live'
        ? isPaused
          ? 'PAUSED'
          : 'LIVE'
        : matchStatus === 'half-time'
          ? 'HALF TIME'
          : matchStatus === 'finished'
            ? 'FULL TIME'
            : 'MATCH';

  const homeStrength = useMemo(
    () =>
      calculateTeamStrength(
        homeXI
      ),
    [homeXI]
  );

  const awayStrength = useMemo(
    () =>
      calculateTeamStrength(
        awayXI
      ),
    [awayXI]
  );

  /*
  |--------------------------------------------------------------------------
  | AUTH REDIRECT
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      !authLoading &&
      !user
    ) {
      router.replace(
        `/login?redirect=${encodeURIComponent(
          router.asPath
        )}`
      );
    }
  }, [
    authLoading,
    user,
    router,
  ]);

  /*
  |--------------------------------------------------------------------------
  | LOADING
  |--------------------------------------------------------------------------
  */

  if (
    authLoading ||
    !router.isReady ||
    loadingMatch
  ) {
    return (
      <main className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading match...</p>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | NO USER
  |--------------------------------------------------------------------------
  */

  if (!user) {
    return (
      <main className={styles.loading}>
        <p>Redirecting to login...</p>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | MATCH NOT FOUND
  |--------------------------------------------------------------------------
  */

  if (
    !match ||
    !homeClub ||
    !awayClub
  ) {
    return (
      <main className={styles.emptyPage}>
        <div className={styles.emptyIcon}>
          ⚽
        </div>

        <h1>Match not found</h1>

        <p>
          The requested match could not
          be loaded.
        </p>

        <button
          type="button"
          onClick={() =>
            router.push('/fixture')
          }
        >
          Back to Fixtures
        </button>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | RENDER
  |--------------------------------------------------------------------------
  */

  return (
    <>
      <Head>
        <title>
          {getClubName(homeClub)} vs{' '}
          {getClubName(awayClub)}
        </title>

        <meta
          name="description"
          content={`Match Centre: ${getClubName(
            homeClub
          )} vs ${getClubName(
            awayClub
          )}`}
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}

        <header className={styles.header}>
          <button
            type="button"
            className={styles.backButton}
            onClick={() =>
              router.push('/fixture')
            }
          >
            ← Fixtures
          </button>

          <div>
            <span
              className={
                styles.competition
              }
            >
              {match.leagueName ||
                match.type ||
                'MATCH'}
            </span>

            <h1>
              Match Centre
            </h1>
          </div>

          <span
            className={styles.status}
          >
            {statusLabel}
          </span>
        </header>

        {/* 3D PITCH */}

        <section>
          <ThreePitch
            homeXI={homeXI}
            awayXI={awayXI}
            formation={formation}
            ballPossession={
              ballPossession
            }
          />
        </section>

        {/* SCOREBOARD */}

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
              {getClubLogo(
                homeClub
              ) ? (
                <img
                  src={getClubLogo(
                    homeClub
                  )}
                  alt={getClubName(
                    homeClub
                  )}
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

            <span>
              HOME
            </span>

            <small>
              OVR {homeStrength}
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
              {getClubLogo(
                awayClub
              ) ? (
                <img
                  src={getClubLogo(
                    awayClub
                  )}
                  alt={getClubName(
                    awayClub
                  )}
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

            <span>
              AWAY
            </span>

            <small>
              OVR {awayStrength}
            </small>
          </div>
        </section>

        {/* CONTROLS */}

        {userIsParticipant && (
          <section
            className={
              styles.controls
            }
          >
            {matchStatus ===
              'ready' && (
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                onClick={
                  startMatch
                }
                disabled={saving}
              >
                {saving
                  ? 'STARTING...'
                  : '▶ START MATCH'}
              </button>
            )}

            {matchStatus ===
              'live' && (
              <button
                type="button"
                onClick={() =>
                  setIsPaused(
                    (previous) =>
                      !previous
                  )
                }
              >
                {isPaused
                  ? '▶ Resume'
                  : 'Ⅱ Pause'}
              </button>
            )}

            {matchStatus ===
              'half-time' && (
              <button
                type="button"
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

            <button
              type="button"
              onClick={() =>
                setShowFormation(
                  (previous) =>
                    !previous
                )
              }
            >
              📋 Formation
            </button>

            <button
              type="button"
              onClick={() =>
                setShowTactics(
                  (previous) =>
                    !previous
                )
              }
            >
              ⚙ Tactics
            </button>

            <button
              type="button"
              onClick={() =>
                setShowSubs(
                  (previous) =>
                    !previous
                )
              }
            >
              🔄 Substitutions
            </button>
          </section>
        )}

        {/* FORMATION */}

        {showFormation &&
          userIsParticipant && (
            <section
              className={
                styles.panel
              }
            >
              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Formation
                </h2>

                <span>
                  {formation}
                </span>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Object.keys(
                  FORMATIONS || {
                    '4-4-2': true,
                    '4-3-3': true,
                    '3-5-2': true,
                    '5-3-2': true,
                    '4-2-3-1': true,
                  }
                ).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={
                      formation === key
                        ? styles.active
                        : ''
                    }
                    onClick={() =>
                      setFormation(
                        key
                      )
                    }
                  >
                    {key}
                  </button>
                ))}
              </div>
            </section>
          )}

        {/* TACTICS */}

        {showTactics &&
          userIsParticipant && (
            <section
              className={
                styles.panel
              }
            >
              <div
                className={
                  styles.panelHeader
                }
              >
                <h2>
                  Tactics
                </h2>

                <span>
                  {tactic}
                </span>
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {Array.isArray(
                  TACTICS
                )
                  ? TACTICS.map(
                      (item) => {
                        const value =
                          typeof item ===
                          'string'
                            ? item
                            : item?.name;

                        if (!value)
                          return null;

                        return (
                          <button
                            type="button"
                            key={value}
                            className={
                              tactic ===
                              value
                                ? styles.active
                                : ''
                            }
                            onClick={() =>
                              setTactic(
                                value
                              )
                            }
                          >
                            {value}
                          </button>
                        );
                      }
                    )
                  : Object.keys(
                      TACTICS || {}
                    ).map(
                      (key) => (
                        <button
                          type="button"
                          key={key}
                          className={
                            tactic ===
                            key
                              ? styles.active
                              : ''
                          }
                          onClick={() =>
                            setTactic(
                              key
                            )
                          }
                        >
                          {key}
                        </button>
                      )
                    )}
              </div>

              <div
                className={
                  styles.mentalityGrid
                }
              >
                {[
                  'balanced',
                  'attacking',
                  'defensive',
                  'counter',
                ].map(
                  (item) => (
                    <button
                      type="button"
                      key={item}
                      className={
                        mentality ===
                        item
                          ? styles.active
                          : ''
                      }
                      onClick={() =>
                        setMentality(
                          item
                        )
                      }
                    >
                      {item}
                    </button>
                  )
                )}
              </div>
            </section>
          )}

        {/* SUBSTITUTIONS */}

        {showSubs &&
          userIsParticipant && (
            <section
              className={
                styles.panel
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
                  {homeSquad.length +
                    awaySquad.length}{' '}
                  players loaded
                </span>
              </div>

              <p>
                Substitution management
                can be connected to the
                match engine here.
              </p>
            </section>
          )}

        {/* STATS */}

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
              `${safeNumber(
                homeStats.possession,
                50
              )}%`,
              `${safeNumber(
                awayStats.possession,
                50
              )}%`,
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
          ].map((row) => (
            <div
              key={row[0]}
              className={
                styles.statRow
              }
            >
              <strong>
                {row[1]}
              </strong>

              <span>
                {row[0]}
              </span>

              <strong>
                {row[2]}
              </strong>
            </div>
          ))}
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
            {events.length > 0 ? (
              events
                .slice(0, 30)
                .map(
                  (
                    event,
                    index
                  ) => (
                    <article
                      key={getEventId(
                        event,
                        index
                      )}
                      className={
                        styles.event
                      }
                    >
                      <span
                        className={
                          styles.eventMinute
                        }
                      >
                        {safeNumber(
                          event.minute,
                          0
                        ) > 90
                          ? `90+${safeNumber(
                              event.minute,
                              0
                            ) - 90}`
                          : safeNumber(
                              event.minute,
                              0
                            )}
                        '
                      </span>

                      <span
                        className={
                          styles.eventIcon
                        }
                      >
                        {eventIcon(
                          event
                        )}
                      </span>

                      <div>
                        <strong>
                          {eventLabel(
                            event
                          )}
                        </strong>

                        <p>
                          {event.detail ||
                            event.playerName ||
                            'Match event'}
                        </p>
                      </div>

                      <span>
                        {event.team ===
                        'home'
                          ? getClubName(
                              homeClub
                            )
                          : getClubName(
                              awayClub
                            )}
                      </span>
                    </article>
                  )
                )
            ) : (
              <div
                className={
                  styles.noEvents
                }
              >
                No events yet.
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
