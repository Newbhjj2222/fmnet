import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRouter } from "next/router";
import Head from "next/head";
import dynamic from "next/dynamic";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";
import toast from "react-hot-toast";

import styles from "./match.module.css";

const ThreePitch = dynamic(
  () => import("../../components/ThreePitch"),
  {
    ssr: false,
    loading: () => (
      <div className={styles.pitchLoading}>
        <div className={styles.spinner} />
        <span>Loading 3D pitch...</span>
      </div>
    ),
  }
);

// ============================================================
// CONSTANTS
// ============================================================

const MATCH_MINUTE_MS = 1000;
const MAX_SUBSTITUTIONS = 5;
const PLAYERS_ON_PITCH = 11;

const FORMATIONS = {
  "4-4-2": {
    GK: 1,
    DEF: 4,
    MID: 4,
    ATT: 2,
  },

  "4-3-3": {
    GK: 1,
    DEF: 4,
    MID: 3,
    ATT: 3,
  },

  "3-5-2": {
    GK: 1,
    DEF: 3,
    MID: 5,
    ATT: 2,
  },

  "5-3-2": {
    GK: 1,
    DEF: 5,
    MID: 3,
    ATT: 2,
  },

  "4-2-3-1": {
    GK: 1,
    DEF: 4,
    MID: 5,
    ATT: 1,
  },
};

const FORMATION_POINTS = {
  "4-4-2": [
    [ -11.5, 0 ],
    [ -8.5, -6.8 ],
    [ -8.5, -2.3 ],
    [ -8.5, 2.3 ],
    [ -8.5, 6.8 ],
    [ -3.0, -6.0 ],
    [ -2.0, -2.0 ],
    [ -2.0, 2.0 ],
    [ -3.0, 6.0 ],
    [ 3.5, -3.2 ],
    [ 3.5, 3.2 ],
  ],

  "4-3-3": [
    [ -11.5, 0 ],
    [ -8.5, -6.8 ],
    [ -8.5, -2.3 ],
    [ -8.5, 2.3 ],
    [ -8.5, 6.8 ],
    [ -3.0, -5.0 ],
    [ -2.0, 0 ],
    [ -3.0, 5.0 ],
    [ 4.5, -6.0 ],
    [ 5.5, 0 ],
    [ 4.5, 6.0 ],
  ],

  "3-5-2": [
    [ -11.5, 0 ],
    [ -8.5, -4.8 ],
    [ -8.5, 0 ],
    [ -8.5, 4.8 ],
    [ -3.5, -7.0 ],
    [ -2.0, -3.5 ],
    [ -1.0, 0 ],
    [ -2.0, 3.5 ],
    [ -3.5, 7.0 ],
    [ 4.0, -3.0 ],
    [ 4.0, 3.0 ],
  ],

  "5-3-2": [
    [ -11.5, 0 ],
    [ -8.5, -8.0 ],
    [ -8.5, -4.0 ],
    [ -8.5, 4.0 ],
    [ -8.5, 8.0 ],
    [ -8.5, 0 ],
    [ -3.0, -5.0 ],
    [ -2.0, 0 ],
    [ -3.0, 5.0 ],
    [ 4.0, -3.0 ],
    [ 4.0, 3.0 ],
  ],

  "4-2-3-1": [
    [ -11.5, 0 ],
    [ -8.5, -6.8 ],
    [ -8.5, -2.3 ],
    [ -8.5, 2.3 ],
    [ -8.5, 6.8 ],
    [ -3.5, -3.5 ],
    [ -3.5, 3.5 ],
    [ 1.0, -5.0 ],
    [ 1.5, 0 ],
    [ 1.0, 5.0 ],
    [ 5.5, 0 ],
  ],
};

// ============================================================
// HELPERS
// ============================================================

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function playerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    `${player?.firstName || ""} ${player?.lastName || ""}`.trim() ||
    "Unknown"
  );
}

function playerId(player) {
  return player?.id || player?.playerId || null;
}

function overall(player) {
  return clamp(
    safeNumber(
      player?.overall ??
      player?.rating ??
      player?.ovr ??
      60
    ),
    35,
    99
  );
}

function position(player) {
  const p = String(
    player?.position ||
    player?.primaryPosition ||
    "MID"
  ).toLowerCase();

  if (
    p.includes("goal") ||
    p === "gk"
  ) {
    return "GK";
  }

  if (
    p.includes("def") ||
    p.includes("back") ||
    p === "cb" ||
    p === "lb" ||
    p === "rb"
  ) {
    return "DEF";
  }

  if (
    p.includes("attack") ||
    p.includes("forward") ||
    p.includes("striker") ||
    p === "st" ||
    p === "cf"
  ) {
    return "ATT";
  }

  return "MID";
}

function emptyStats() {
  return {
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    corners: 0,
    saves: 0,
    yellow: 0,
    red: 0,
    attacks: 0,
    dangerousAttacks: 0,
    dribbles: 0,
  };
}

function defaultTactics() {
  return {
    mentality: "balanced",
    tempo: "normal",
    pressing: "medium",
    defensiveLine: "normal",
    width: "normal",
  };
}

function normalizeStats(stats) {
  return {
    ...emptyStats(),
    ...(stats || {}),
  };
}

function normalizeTactics(tactics) {
  return {
    ...defaultTactics(),
    ...(tactics || {}),
  };
}

function parseDate(value) {
  if (!value) return null;

  if (
    value?.toDate &&
    typeof value.toDate === "function"
  ) {
    return value.toDate();
  }

  const d = new Date(value);

  return Number.isNaN(d.getTime())
    ? null
    : d;
}

// ============================================================
// POSITION / LINEUP
// ============================================================

function getFormationPlayers(squad, formation) {
  if (!Array.isArray(squad)) {
    return [];
  }

  const required =
    FORMATIONS[formation] ||
    FORMATIONS["4-4-2"];

  const remaining = [...squad];

  const selected = [];

  const takeBest = (type, count) => {
    const candidates = remaining
      .filter((p) => position(p) === type)
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, count);

    candidates.forEach((p) => {
      const id = playerId(p);

      const index = remaining.findIndex(
        (x) => playerId(x) === id
      );

      if (index >= 0) {
        remaining.splice(index, 1);
      }

      selected.push(p);
    });
  };

  takeBest("GK", required.GK);
  takeBest("DEF", required.DEF);
  takeBest("MID", required.MID);
  takeBest("ATT", required.ATT);

  while (
    selected.length < PLAYERS_ON_PITCH &&
    remaining.length
  ) {
    remaining.sort(
      (a, b) => overall(b) - overall(a)
    );

    selected.push(remaining.shift());
  }

  return selected.slice(
    0,
    PLAYERS_ON_PITCH
  );
}

function lineupFromIds(squad, ids, formation) {
  if (!Array.isArray(ids) || ids.length !== 11) {
    return getFormationPlayers(
      squad,
      formation
    );
  }

  const map = new Map(
    squad.map((p) => [
      String(playerId(p)),
      p,
    ])
  );

  const players = ids
    .map((id) => map.get(String(id)))
    .filter(Boolean);

  return players.length === 11
    ? players
    : getFormationPlayers(
        squad,
        formation
      );
}

function getBench(squad, xi) {
  const selected = new Set(
    xi.map((p) => String(playerId(p)))
  );

  return squad.filter(
    (p) =>
      !selected.has(
        String(playerId(p))
      )
  );
}

// ============================================================
// MANAGER DETECTION
// ============================================================

function isManagerOfClub(
  club,
  profile,
  authUser
) {
  if (!club) return false;

  const uid =
    authUser?.uid ||
    profile?.uid ||
    null;

  const username =
    profile?.username ||
    authUser?.username ||
    authUser?.displayName ||
    null;

  if (
    uid &&
    [
      club.managerId,
      club.managerUid,
      club.managerUserId,
    ]
      .filter(Boolean)
      .map(String)
      .includes(String(uid))
  ) {
    return true;
  }

  if (
    username &&
    [
      club.managerUsername,
      club.manager,
      club.managerName,
    ]
      .filter(Boolean)
      .map(String)
      .includes(String(username))
  ) {
    return true;
  }

  const currentClub =
    profile?.careerData?.currentClub ??
    profile?.currentClub;

  if (currentClub) {
    const currentId =
      typeof currentClub === "object"
        ? currentClub.id ||
          currentClub.clubId
        : currentClub;

    if (
      currentId &&
      String(currentId) ===
        String(club.id)
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// TEAM POWER
// ============================================================

function formationModifier(formation) {
  const values = {
    "4-4-2": 1.0,
    "4-3-3": 1.04,
    "3-5-2": 1.02,
    "5-3-2": 0.97,
    "4-2-3-1": 1.03,
  };

  return values[formation] || 1;
}

function tacticModifier(tactics) {
  let value = 1;

  if (tactics.mentality === "attacking") {
    value += 0.06;
  }

  if (tactics.mentality === "defensive") {
    value -= 0.04;
  }

  if (tactics.tempo === "fast") {
    value += 0.025;
  }

  if (tactics.pressing === "high") {
    value += 0.035;
  }

  if (tactics.pressing === "low") {
    value -= 0.015;
  }

  return value;
}

function calculateTeamPower(
  xi,
  tactics,
  formation
) {
  if (!xi?.length) {
    return 60;
  }

  const average =
    xi.reduce(
      (sum, player) =>
        sum + overall(player),
      0
    ) / xi.length;

  return (
    average *
    formationModifier(formation) *
    tacticModifier(tactics)
  );
}

// ============================================================
// COMPONENT
// ============================================================

export default function MatchPage() {
  const router = useRouter();

  const {
    user,
    loading: authLoading,
  } = useAuth();

  const { id } = router.query;

  // ----------------------------------------------------------
  // BASIC DATA
  // ----------------------------------------------------------

  const [match, setMatch] =
    useState(null);

  const [homeClub, setHomeClub] =
    useState(null);

  const [awayClub, setAwayClub] =
    useState(null);

  const [homeSquad, setHomeSquad] =
    useState([]);

  const [awaySquad, setAwaySquad] =
    useState([]);

  const [profile, setProfile] =
    useState(null);

  // ----------------------------------------------------------
  // LINEUPS
  // ----------------------------------------------------------

  const [homeXI, setHomeXI] =
    useState([]);

  const [awayXI, setAwayXI] =
    useState([]);

  const [homeFormation, setHomeFormation] =
    useState("4-4-2");

  const [awayFormation, setAwayFormation] =
    useState("4-4-2");

  const [selectedLineup, setSelectedLineup] =
    useState([]);

  const [lineupOpen, setLineupOpen] =
    useState(false);

  // ----------------------------------------------------------
  // MANAGER
  // ----------------------------------------------------------

  const [managerTeam, setManagerTeam] =
    useState(null);

  const [isManager, setIsManager] =
    useState(false);

  // ----------------------------------------------------------
  // MATCH
  // ----------------------------------------------------------

  const [matchStatus, setMatchStatus] =
    useState("loading");

  const [matchMinute, setMatchMinute] =
    useState(0);

  const [homeScore, setHomeScore] =
    useState(0);

  const [awayScore, setAwayScore] =
    useState(0);

  const [events, setEvents] =
    useState([]);

  const [homeStats, setHomeStats] =
    useState(emptyStats());

  const [awayStats, setAwayStats] =
    useState(emptyStats());

  const [homeTactics, setHomeTactics] =
    useState(defaultTactics());

  const [awayTactics, setAwayTactics] =
    useState(defaultTactics());

  const [homeBench, setHomeBench] =
    useState([]);

  const [awayBench, setAwayBench] =
    useState([]);

  const [subsUsed, setSubsUsed] =
    useState({
      home: 0,
      away: 0,
    });

  const [selectedSubOut, setSelectedSubOut] =
    useState("");

  const [selectedSubIn, setSelectedSubIn] =
    useState("");

  const [isPaused, setIsPaused] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [isSaving, setIsSaving] =
    useState(false);

  // ----------------------------------------------------------
  // 3D VISUAL STATE
  // ----------------------------------------------------------

  const [playerPositions, setPlayerPositions] =
    useState({});

  const [ballAction, setBallAction] =
    useState({
      id: 0,
      from: [0, 0],
      to: [0, 0],
      type: "idle",
    });

  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const matchRef = useRef(null);

  const statusRef = useRef("loading");

  const minuteRef = useRef(0);

  const scoreRef = useRef({
    home: 0,
    away: 0,
  });

  const statsRef = useRef({
    home: emptyStats(),
    away: emptyStats(),
  });

  const eventsRef = useRef([]);

  const homeXIRef = useRef([]);

  const awayXIRef = useRef([]);

  const homeBenchRef = useRef([]);

  const awayBenchRef = useRef([]);

  const tacticsRef = useRef({
    home: defaultTactics(),
    away: defaultTactics(),
  });

  const formationRef = useRef({
    home: "4-4-2",
    away: "4-4-2",
  });

  const positionsRef = useRef({});

  const ballRef = useRef({
    x: 0,
    z: 0,
  });

  const subsRef = useRef({
    home: 0,
    away: 0,
  });

  const processingRef = useRef(false);

  const timerRef = useRef(null);

  const ballActionIdRef =
    useRef(0);

  // ==========================================================
  // USER PROFILE
  // ==========================================================

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      try {
        const snap = await getDoc(
          doc(db, "users", user.uid)
        );

        if (!cancelled && snap.exists()) {
          setProfile({
            id: snap.id,
            ...snap.data(),
          });
        }
      } catch (err) {
        console.error(
          "Profile loading error:",
          err
        );
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  useEffect(() => {
    if (authLoading || !id) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError("");

        const matchSnap =
          await getDoc(
            doc(db, "matches", id)
          );

        if (!matchSnap.exists()) {
          throw new Error(
            "Match not found."
          );
        }

        const matchData = {
          id: matchSnap.id,
          ...matchSnap.data(),
        };

        if (cancelled) return;

        matchRef.current = matchData;
        setMatch(matchData);

        const [
          homeSnap,
          awaySnap,
        ] = await Promise.all([
          matchData.homeClubId
            ? getDoc(
                doc(
                  db,
                  "clubs",
                  matchData.homeClubId
                )
              )
            : null,

          matchData.awayClubId
            ? getDoc(
                doc(
                  db,
                  "clubs",
                  matchData.awayClubId
                )
              )
            : null,
        ]);

        const home = homeSnap?.exists()
          ? {
              id: homeSnap.id,
              ...homeSnap.data(),
            }
          : {
              id: matchData.homeClubId,
              name:
                matchData.homeClubName ||
                "Home",
            };

        const away = awaySnap?.exists()
          ? {
              id: awaySnap.id,
              ...awaySnap.data(),
            }
          : {
              id: matchData.awayClubId,
              name:
                matchData.awayClubName ||
                "Away",
            };

        if (cancelled) return;

        setHomeClub(home);
        setAwayClub(away);

        // ------------------------------------------------------
        // LOAD PLAYERS
        // ------------------------------------------------------

        const loadPlayers =
          async (clubId) => {
            if (!clubId) return [];

            try {
              const q = query(
                collection(
                  db,
                  "players"
                ),
                where(
                  "clubId",
                  "==",
                  clubId
                )
              );

              const snap =
                await getDocs(q);

              return snap.docs.map(
                (playerDoc) => ({
                  id: playerDoc.id,
                  ...playerDoc.data(),
                })
              );
            } catch (err) {
              console.error(
                "Player query error:",
                err
              );

              return [];
            }
          };

        const [
          loadedHomeSquad,
          loadedAwaySquad,
        ] = await Promise.all([
          loadPlayers(home.id),
          loadPlayers(away.id),
        ]);

        if (cancelled) return;

        setHomeSquad(
          loadedHomeSquad
        );

        setAwaySquad(
          loadedAwaySquad
        );

        // ------------------------------------------------------
        // MANAGER
        // ------------------------------------------------------

        const homeManager =
          isManagerOfClub(
            home,
            profile,
            user
          );

        const awayManager =
          isManagerOfClub(
            away,
            profile,
            user
          );

        const team =
          homeManager
            ? "home"
            : awayManager
            ? "away"
            : null;

        setManagerTeam(team);
        setIsManager(Boolean(team));

        // ------------------------------------------------------
        // FORMATIONS
        // ------------------------------------------------------

        const savedHomeFormation =
          matchData.homeFormation ||
          matchData.formation ||
          "4-4-2";

        const savedAwayFormation =
          matchData.awayFormation ||
          "4-4-2";

        setHomeFormation(
          savedHomeFormation
        );

        setAwayFormation(
          savedAwayFormation
        );

        formationRef.current = {
          home: savedHomeFormation,
          away: savedAwayFormation,
        };

        // ------------------------------------------------------
        // LINEUPS
        // ------------------------------------------------------

        let loadedHomeXI =
          lineupFromIds(
            loadedHomeSquad,
            matchData.homeLineupIds,
            savedHomeFormation
          );

        let loadedAwayXI =
          lineupFromIds(
            loadedAwaySquad,
            matchData.awayLineupIds,
            savedAwayFormation
          );

        if (
          !matchData.homeLineupIds
        ) {
          loadedHomeXI =
            getFormationPlayers(
              loadedHomeSquad,
              savedHomeFormation
            );
        }

        if (
          !matchData.awayLineupIds
        ) {
          loadedAwayXI =
            getFormationPlayers(
              loadedAwaySquad,
              savedAwayFormation
            );
        }

        setHomeXI(loadedHomeXI);
        setAwayXI(loadedAwayXI);

        homeXIRef.current =
          loadedHomeXI;

        awayXIRef.current =
          loadedAwayXI;

        const homeBenchPlayers =
          getBench(
            loadedHomeSquad,
            loadedHomeXI
          );

        const awayBenchPlayers =
          getBench(
            loadedAwaySquad,
            loadedAwayXI
          );

        setHomeBench(
          homeBenchPlayers
        );

        setAwayBench(
          awayBenchPlayers
        );

        homeBenchRef.current =
          homeBenchPlayers;

        awayBenchRef.current =
          awayBenchPlayers;

        // ------------------------------------------------------
        // TACTICS
        // ------------------------------------------------------

        const loadedHomeTactics =
          normalizeTactics(
            matchData.homeTactics
          );

        const loadedAwayTactics =
          normalizeTactics(
            matchData.awayTactics
          );

        setHomeTactics(
          loadedHomeTactics
        );

        setAwayTactics(
          loadedAwayTactics
        );

        tacticsRef.current = {
          home: loadedHomeTactics,
          away: loadedAwayTactics,
        };

        // ------------------------------------------------------
        // MATCH STATE
        // ------------------------------------------------------

        const loadedHomeStats =
          normalizeStats(
            matchData.homeStats
          );

        const loadedAwayStats =
          normalizeStats(
            matchData.awayStats
          );

        const loadedHomeScore =
          safeNumber(
            matchData.homeScore,
            0
          );

        const loadedAwayScore =
          safeNumber(
            matchData.awayScore,
            0
          );

        const loadedMinute =
          safeNumber(
            matchData.minute,
            0
          );

        const loadedEvents =
          Array.isArray(
            matchData.events
          )
            ? matchData.events
            : [];

        statsRef.current = {
          home: loadedHomeStats,
          away: loadedAwayStats,
        };

        scoreRef.current = {
          home: loadedHomeScore,
          away: loadedAwayScore,
        };

        minuteRef.current =
          loadedMinute;

        eventsRef.current =
          loadedEvents;

        setHomeStats(
          loadedHomeStats
        );

        setAwayStats(
          loadedAwayStats
        );

        setHomeScore(
          loadedHomeScore
        );

        setAwayScore(
          loadedAwayScore
        );

        setMatchMinute(
          loadedMinute
        );

        setEvents(
          loadedEvents
        );

        // ------------------------------------------------------
        // STATUS
        // ------------------------------------------------------

        const loadedStatus =
          matchData.status ||
          "ready";

        statusRef.current =
          loadedStatus;

        setMatchStatus(
          loadedStatus
        );

        // ------------------------------------------------------
        // SUBSTITUTIONS
        // ------------------------------------------------------

        const loadedSubs = {
          home: safeNumber(
            matchData.homeSubsUsed,
            0
          ),
          away: safeNumber(
            matchData.awaySubsUsed,
            0
          ),
        };

        subsRef.current =
          loadedSubs;

        setSubsUsed(
          loadedSubs
        );

      } catch (err) {
        console.error(
          "MATCH LOAD ERROR:",
          err
        );

        if (!cancelled) {
          setError(
            err?.message ||
              "Failed to load match."
          );
        }
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
    authLoading,
    user,
    profile,
  ]);

  // ==========================================================
  // MANAGER TEAM UPDATE AFTER PROFILE LOAD
  // ==========================================================

  useEffect(() => {
    if (!homeClub || !awayClub) {
      return;
    }

    const homeManager =
      isManagerOfClub(
        homeClub,
        profile,
        user
      );

    const awayManager =
      isManagerOfClub(
        awayClub,
        profile,
        user
      );

    const team =
      homeManager
        ? "home"
        : awayManager
        ? "away"
        : null;

    setManagerTeam(team);
    setIsManager(Boolean(team));
  }, [
    homeClub,
    awayClub,
    profile,
    user,
  ]);

  // ==========================================================
  // INITIAL PLAYER POSITIONS
  // ==========================================================

  useEffect(() => {
    if (
      homeXI.length !== 11 ||
      awayXI.length !== 11
    ) {
      return;
    }

    const result = {};

    const homePoints =
      FORMATION_POINTS[
        homeFormation
      ] ||
      FORMATION_POINTS["4-4-2"];

    const awayPoints =
      FORMATION_POINTS[
        awayFormation
      ] ||
      FORMATION_POINTS["4-4-2"];

    homeXI.forEach(
      (player, index) => {
        const point =
          homePoints[index] ||
          homePoints[0];

        result[
          `home-${playerId(
            player
          )}`
        ] = {
          x: point[0],
          z: point[1],
        };
      }
    );

    awayXI.forEach(
      (player, index) => {
        const point =
          awayPoints[index] ||
          awayPoints[0];

        result[
          `away-${playerId(
            player
          )}`
        ] = {
          x: -point[0],
          z: -point[1],
        };
      }
    );

    positionsRef.current =
      result;

    setPlayerPositions(
      result
    );
  }, [
    homeXI,
    awayXI,
    homeFormation,
    awayFormation,
  ]);

  // ==========================================================
  // SAVE MATCH
  // ==========================================================

  const saveMatchState =
    useCallback(
      async (statusOverride) => {
        const currentMatch =
          matchRef.current;

        if (!currentMatch?.id) {
          return;
        }

        try {
          setIsSaving(true);

          await updateDoc(
            doc(
              db,
              "matches",
              currentMatch.id
            ),
            {
              status:
                statusOverride ||
                statusRef.current,

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

              homeTactics:
                tacticsRef.current.home,

              awayTactics:
                tacticsRef.current.away,

              homeFormation:
                formationRef.current.home,

              awayFormation:
                formationRef.current.away,

              homeLineupIds:
                homeXIRef.current.map(
                  playerId
                ),

              awayLineupIds:
                awayXIRef.current.map(
                  playerId
                ),

              homeSubsUsed:
                subsRef.current.home,

              awaySubsUsed:
                subsRef.current.away,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            "MATCH SAVE ERROR:",
            err
          );
        } finally {
          setIsSaving(false);
        }
      },
      []
    );

  // ==========================================================
  // UPDATE UI FROM REFS
  // ==========================================================

  const syncUI =
    useCallback(() => {
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

      setSubsUsed({
        ...subsRef.current,
      });

      setPlayerPositions({
        ...positionsRef.current,
      });
    }, []);

  // ==========================================================
  // FIND PLAYER POSITION
  // ==========================================================

  const getVisualPosition =
    useCallback(
      (team, player) => {
        const key =
          `${team}-${playerId(
            player
          )}`;

        return (
          positionsRef.current[
            key
          ] || {
            x: team === "home"
              ? -5
              : 5,
            z: 0,
          }
        );
      },
      []
    );

  // ==========================================================
  // MOVE PLAYERS
  // ==========================================================

  const updatePlayerMovement =
    useCallback(
      (
        teamWithBall,
        ballX,
        ballZ
      ) => {
        const newPositions = {
          ...positionsRef.current,
        };

        const updateTeam =
          (
            team,
            players,
            formation,
            direction
          ) => {
            const points =
              FORMATION_POINTS[
                formation
              ] ||
              FORMATION_POINTS[
                "4-4-2"
              ];

            players.forEach(
              (
                player,
                index
              ) => {
                const key =
                  `${team}-${playerId(
                    player
                  )}`;

                const point =
                  points[index] ||
                  points[0];

                const baseX =
                  direction *
                  point[0];

                const baseZ =
                  direction *
                  point[1];

                const current =
                  newPositions[
                    key
                  ] || {
                    x: baseX,
                    z: baseZ,
                  };

                const distanceX =
                  ballX -
                  current.x;

                const distanceZ =
                  ballZ -
                  current.z;

                const attraction =
                  team ===
                  teamWithBall
                    ? 0.16
                    : 0.07;

                const targetX =
                  baseX +
                  clamp(
                    distanceX *
                      attraction,
                    -3.0,
                    3.0
                  );

                const targetZ =
                  baseZ +
                  clamp(
                    distanceZ *
                      attraction,
                    -2.5,
                    2.5
                  );

                newPositions[
                  key
                ] = {
                  x:
                    current.x +
                    (targetX -
                      current.x) *
                      0.22,

                  z:
                    current.z +
                    (targetZ -
                      current.z) *
                      0.22,
                };
              }
            );
          };

        updateTeam(
          "home",
          homeXIRef.current,
          formationRef.current.home,
          1
        );

        updateTeam(
          "away",
          awayXIRef.current,
          formationRef.current.away,
          -1
        );

        positionsRef.current =
          newPositions;

        setPlayerPositions({
          ...newPositions,
        });
      },
      []
    );

  // ==========================================================
  // BALL ACTION
  // ==========================================================

  const createBallAction =
    useCallback(
      (
        from,
        to,
        type
      ) => {
        ballActionIdRef.current += 1;

        setBallAction({
          id:
            ballActionIdRef.current,
          from: [
            from?.x || 0,
            from?.z || 0,
          ],
          to: [
            to?.x || 0,
            to?.z || 0,
          ],
          type,
        });

        ballRef.current = {
          x: to?.x || 0,
          z: to?.z || 0,
        };
      },
      []
    );

  // ==========================================================
  // AI TACTICS
  // ==========================================================

  const runAITactics =
    useCallback(
      () => {
        const scoreDifference =
          scoreRef.current.away -
          scoreRef.current.home;

        let tactics;

        if (
          managerTeam === "home"
        ) {
          if (
            scoreDifference > 0
          ) {
            tactics = {
              mentality:
                "attacking",
              tempo: "fast",
              pressing: "high",
              defensiveLine:
                "high",
              width: "wide",
            };
          } else if (
            scoreDifference < 0
          ) {
            tactics = {
              mentality:
                "defensive",
              tempo: "slow",
              pressing: "low",
              defensiveLine:
                "deep",
              width: "normal",
            };
          } else {
            tactics =
              defaultTactics();
          }
        } else {
          if (
            scoreDifference < 0
          ) {
            tactics = {
              mentality:
                "attacking",
              tempo: "fast",
              pressing: "high",
              defensiveLine:
                "high",
              width: "wide",
            };
          } else if (
            scoreDifference > 0
          ) {
            tactics = {
              mentality:
                "defensive",
              tempo: "slow",
              pressing: "low",
              defensiveLine:
                "deep",
              width: "normal",
            };
          } else {
            tactics =
              defaultTactics();
          }
        }

        if (
          managerTeam === "home"
        ) {
          tacticsRef.current.away =
            tactics;

          setAwayTactics(
            tactics
          );
        } else {
          tacticsRef.current.home =
            tactics;

          setHomeTactics(
            tactics
          );
        }
      },
      [managerTeam]
    );

  // ==========================================================
  // AI SUBSTITUTION
  // ==========================================================

  const runAISubstitution =
    useCallback(() => {
      if (
        minuteRef.current <
        55
      ) {
        return;
      }

      const aiTeam =
        managerTeam === "home"
          ? "away"
          : "home";

      if (
        subsRef.current[
          aiTeam
        ] >=
        MAX_SUBSTITUTIONS
      ) {
        return;
      }

      const xi =
        aiTeam === "home"
          ? homeXIRef.current
          : awayXIRef.current;

      const bench =
        aiTeam === "home"
          ? homeBenchRef.current
          : awayBenchRef.current;

      if (
        !xi.length ||
        !bench.length
      ) {
        return;
      }

      const weakest =
        [...xi].sort(
          (a, b) =>
            overall(a) -
            overall(b)
        )[0];

      const bestBench =
        [...bench].sort(
          (a, b) =>
            overall(b) -
            overall(a)
        )[0];

      if (
        !weakest ||
        !bestBench ||
        overall(bestBench) <=
          overall(weakest)
      ) {
        return;
      }

      const newXI =
        xi.map((player) =>
          playerId(player) ===
          playerId(weakest)
            ? bestBench
            : player
        );

      const newBench =
        bench.filter(
          (player) =>
            playerId(player) !==
            playerId(bestBench)
        );

      newBench.push(
        weakest
      );

      if (aiTeam === "home") {
        homeXIRef.current =
          newXI;

        homeBenchRef.current =
          newBench;

        setHomeXI([
          ...newXI,
        ]);

        setHomeBench([
          ...newBench,
        ]);
      } else {
        awayXIRef.current =
          newXI;

        awayBenchRef.current =
          newBench;

        setAwayXI([
          ...newXI,
        ]);

        setAwayBench([
          ...newBench,
        ]);
      }

      subsRef.current[
        aiTeam
      ] += 1;

      eventsRef.current = [
        {
          id:
            `sub-ai-${Date.now()}`,
          type: "substitution",
          team: aiTeam,
          minute:
            minuteRef.current,
          detail:
            `AI replaced ${playerName(
              weakest
            )} with ${playerName(
              bestBench
            )}.`,
        },
        ...eventsRef.current,
      ];

      syncUI();
    }, [
      managerTeam,
      syncUI,
    ]);

  // ==========================================================
  // SIMULATE ONE PLAY
  // ==========================================================

  const simulatePlay =
    useCallback(() => {
      if (
        processingRef.current
      ) {
        return;
      }

      if (
        homeXIRef.current.length !==
          11 ||
        awayXIRef.current.length !==
          11
      ) {
        return;
      }

      processingRef.current =
        true;

      try {
        const homePower =
          calculateTeamPower(
            homeXIRef.current,
            tacticsRef.current.home,
            formationRef.current.home
          );

        const awayPower =
          calculateTeamPower(
            awayXIRef.current,
            tacticsRef.current.away,
            formationRef.current.away
          );

        const homePossessionChance =
          clamp(
            0.5 +
              (homePower -
                awayPower) *
                0.006,
            0.30,
            0.70
          );

        const team =
          Math.random() <
          homePossessionChance
            ? "home"
            : "away";

        const players =
          team === "home"
            ? homeXIRef.current
            : awayXIRef.current;

        const opponent =
          team === "home"
            ? awayXIRef.current
            : homeXIRef.current;

        const ownTactics =
          tacticsRef.current[
            team
          ];

        const teamPower =
          team === "home"
            ? homePower
            : awayPower;

        const opponentPower =
          team === "home"
            ? awayPower
            : homePower;

        // ------------------------------------------
        // ATTACK
        // ------------------------------------------

        statsRef.current[
          team
        ].attacks += 1;

        if (
          Math.random() <
          0.32 +
            (teamPower -
              opponentPower) *
              0.003
        ) {
          statsRef.current[
            team
          ].dangerousAttacks +=
            1;
        }

        // ------------------------------------------
        // POSSESSION
        // ------------------------------------------

        const possession =
          clamp(
            50 +
              (homePower -
                awayPower) *
                0.55 +
              (Math.random() -
                0.5) *
                8,
            25,
            75
          );

        statsRef.current.home
          .possession =
          Number(
            possession.toFixed(1)
          );

        statsRef.current.away
          .possession =
          Number(
            (
              100 -
              possession
            ).toFixed(1)
          );

        // ------------------------------------------
        // SELECT PLAYER
        // ------------------------------------------

        const attackingPlayers =
          players.filter(
            (player) => {
              const p =
                position(player);

              return (
                p === "ATT" ||
                p === "MID"
              );
            }
          );

        const pool =
          attackingPlayers.length
            ? attackingPlayers
            : players;

        const actor =
          pool[
            Math.floor(
              Math.random() *
                pool.length
            )
          ];

        if (!actor) {
          return;
        }

        const actorOVR =
          overall(actor);

        const actorPosition =
          getVisualPosition(
            team,
            actor
          );

        // ------------------------------------------
        // PASS
        // ------------------------------------------

        const passChance =
          ownTactics.tempo ===
          "fast"
            ? 0.58
            : 0.68;

        if (
          Math.random() <
          passChance
        ) {
          const targets =
            players.filter(
              (p) =>
                playerId(p) !==
                playerId(actor)
            );

          const target =
            targets[
              Math.floor(
                Math.random() *
                  targets.length
              )
            ];

          if (target) {
            statsRef.current[
              team
            ].passes += 1;

            const completionChance =
              clamp(
                0.65 +
                  (actorOVR -
                    60) *
                    0.008 +
                  (teamPower -
                    opponentPower) *
                    0.002,
                0.45,
                0.96
              );

            const completed =
              Math.random() <
              completionChance;

            if (completed) {
              statsRef.current[
                team
              ].passesCompleted +=
                1;

              const targetPosition =
                getVisualPosition(
                  team,
                  target
                );

              ballRef.current = {
                x: targetPosition.x,
                z: targetPosition.z,
              };

              createBallAction(
                actorPosition,
                targetPosition,
                "pass"
              );

              updatePlayerMovement(
                team,
                targetPosition.x,
                targetPosition.z
              );

              return;
            }

            statsRef.current[
              team
            ].interceptions += 1;

            const interceptionTeam =
              team === "home"
                ? "away"
                : "home";

            const defenders =
              opponent.filter(
                (p) =>
                  position(p) ===
                    "DEF" ||
                  position(p) ===
                    "MID"
              );

            const interceptor =
              defenders[
                Math.floor(
                  Math.random() *
                    defenders.length
                )
              ];

            if (interceptor) {
              const interceptionPosition =
                getVisualPosition(
                  interceptionTeam,
                  interceptor
                );

              createBallAction(
                actorPosition,
                interceptionPosition,
                "interception"
              );

              updatePlayerMovement(
                interceptionTeam,
                interceptionPosition.x,
                interceptionPosition.z
              );
            }

            return;
          }
        }

        // ------------------------------------------
        // DRIBBLE
        // ------------------------------------------

        if (
          Math.random() <
          0.18
        ) {
          statsRef.current[
            team
          ].dribbles += 1;

          const newX =
            clamp(
              actorPosition.x +
                (team === "home"
                  ? 2
                  : -2),
              -13,
              13
            );

          const newZ =
            clamp(
              actorPosition.z +
                (Math.random() -
                  0.5) *
                  3,
              -8.5,
              8.5
            );

          const dribblePosition = {
            x: newX,
            z: newZ,
          };

          createBallAction(
            actorPosition,
            dribblePosition,
            "dribble"
          );

          updatePlayerMovement(
            team,
            newX,
            newZ
          );

          return;
        }

        // ------------------------------------------
        // SHOT
        // ------------------------------------------

        const shotChance =
          clamp(
            0.08 +
              (actorOVR -
                60) *
                0.002 +
              (teamPower -
                opponentPower) *
                0.002 +
              (ownTactics.mentality ===
              "attacking"
                ? 0.025
                : 0),
            0.04,
            0.22
          );

        if (
          Math.random() <
          shotChance
        ) {
          statsRef.current[
            team
          ].shots += 1;

          const goalX =
            team === "home"
              ? 14.7
              : -14.7;

          const goalPosition = {
            x: goalX,
            z:
              (Math.random() -
                0.5) *
              4.5,
          };

          const onTargetChance =
            clamp(
              0.45 +
                (actorOVR -
                  60) *
                  0.008,
              0.35,
              0.85
            );

          const onTarget =
            Math.random() <
            onTargetChance;

          createBallAction(
            actorPosition,
            goalPosition,
            onTarget
              ? "shot"
              : "miss"
          );

          updatePlayerMovement(
            team,
            goalPosition.x,
            goalPosition.z
          );

          if (onTarget) {
            statsRef.current[
              team
            ].shotsOnTarget += 1;

            const defensiveTactic =
              tacticsRef.current[
                team === "home"
                  ? "away"
                  : "home"
              ];

            let goalProbability =
              0.11 +
              (teamPower -
                opponentPower) *
                0.003 +
              (actorOVR -
                60) *
                0.002;

            if (
              ownTactics.mentality ===
              "attacking"
            ) {
              goalProbability +=
                0.035;
            }

            if (
              defensiveTactic.mentality ===
              "defensive"
            ) {
              goalProbability -=
                0.025;
            }

            goalProbability =
              clamp(
                goalProbability,
                0.05,
                0.35
              );

            if (
              Math.random() <
              goalProbability
            ) {
              scoreRef.current[
                team
              ] += 1;

              const event = {
                id:
                  `goal-${Date.now()}-${Math.random()}`,
                type: "goal",
                team,
                minute:
                  minuteRef.current,
                playerName:
                  playerName(actor),
                detail:
                  `${playerName(
                    actor
                  )} scored a great goal!`,
              };

              eventsRef.current = [
                event,
                ...eventsRef.current,
              ];

              toast.success(
                `⚽ ${playerName(
                  actor
                )} SCORED!`
              );
            } else {
              const defendingTeam =
                team === "home"
                  ? "away"
                  : "home";

              statsRef.current[
                defendingTeam
              ].saves += 1;

              eventsRef.current = [
                {
                  id:
                    `save-${Date.now()}`,
                  type: "save",
                  team:
                    defendingTeam,
                  minute:
                    minuteRef.current,
                  detail:
                    "Goalkeeper made an important save.",
                },
                ...eventsRef.current,
              ];
            }
          } else {
            if (
              Math.random() <
              0.25
            ) {
              statsRef.current[
                team
              ].corners += 1;
            }
          }

          return;
        }

        // ------------------------------------------
        // TACKLE / FOUL
        // ------------------------------------------

        if (
          Math.random() <
          0.18
        ) {
          const defendingTeam =
            team === "home"
              ? "away"
              : "home";

          statsRef.current[
            defendingTeam
          ].tackles += 1;

          if (
            Math.random() <
            0.07
          ) {
            statsRef.current[
              team
            ].fouls += 1;
          }
        }

      } finally {
        processingRef.current =
          false;
      }
    },
    [
      createBallAction,
      getVisualPosition,
      updatePlayerMovement,
    ]
  );

  // ==========================================================
  // MATCH TIMER
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !== "live" ||
      isPaused ||
      loading
    ) {
      return;
    }

    if (timerRef.current) {
      clearInterval(
        timerRef.current
      );
    }

    timerRef.current =
      setInterval(() => {
        const nextMinute =
          minuteRef.current + 1;

        minuteRef.current =
          nextMinute;

        simulatePlay();

        // AI tactics every 10 minutes
        if (
          nextMinute > 0 &&
          nextMinute % 10 === 0
        ) {
          runAITactics();
        }

        // AI substitution
        if (
          nextMinute >= 60 &&
          nextMinute % 5 === 0
        ) {
          if (
            Math.random() <
            0.18
          ) {
            runAISubstitution();
          }
        }

        syncUI();

        // Half time
        if (
          nextMinute === 45
        ) {
          statusRef.current =
            "half-time";

          setMatchStatus(
            "half-time"
          );

          setIsPaused(true);

          saveMatchState(
            "half-time"
          );

          return;
        }

        // Full time
        if (
          nextMinute >= 90
        ) {
          statusRef.current =
            "finished";

          setMatchStatus(
            "finished"
          );

          setIsPaused(true);

          saveMatchState(
            "finished"
          );

          toast.success(
            `FULL TIME ${scoreRef.current.home} - ${scoreRef.current.away}`
          );
        }

        // Save periodically
        if (
          nextMinute % 5 === 0
        ) {
          saveMatchState(
            "live"
          );
        }
      }, MATCH_MINUTE_MS);

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
    simulatePlay,
    runAITactics,
    runAISubstitution,
    syncUI,
    saveMatchState,
  ]);

  // ==========================================================
  // START MATCH
  // ==========================================================

  const startMatch =
    useCallback(async () => {
      if (
        matchStatus !== "ready" &&
        matchStatus !== "half-time"
      ) {
        return;
      }

      if (
        homeXIRef.current.length !==
          11 ||
        awayXIRef.current.length !==
          11
      ) {
        toast.error(
          "Both teams need 11 players."
        );

        return;
      }

      statusRef.current =
        "live";

      setMatchStatus(
        "live"
      );

      setIsPaused(false);

      await saveMatchState(
        "live"
      );

      toast.success(
        matchStatus ===
          "half-time"
          ? "Second half started!"
          : "Match started!"
      );
    }, [
      matchStatus,
      saveMatchState,
    ]);

  // ==========================================================
  // PAUSE
  // ==========================================================

  const togglePause =
    useCallback(() => {
      if (
        matchStatus !== "live"
      ) {
        return;
      }

      setIsPaused(
        (previous) =>
          !previous
      );
    }, [matchStatus]);

  // ==========================================================
  // FORMATION CHANGE
  // ==========================================================

  const changeFormation =
    useCallback(
      (formation) => {
        if (!isManager) {
          return;
        }

        if (
          !FORMATIONS[formation]
        ) {
          return;
        }

        if (
          managerTeam === "home"
        ) {
          formationRef.current.home =
            formation;

          setHomeFormation(
            formation
          );
        } else {
          formationRef.current.away =
            formation;

          setAwayFormation(
            formation
          );
        }

        toast.success(
          `Formation changed to ${formation}`
        );

        saveMatchState();
      },
      [
        isManager,
        managerTeam,
        saveMatchState,
      ]
    );

  // ==========================================================
  // TACTIC CHANGE
  // ==========================================================

  const changeTactic =
    useCallback(
      (field, value) => {
        if (!isManager) {
          return;
        }

        const team =
          managerTeam;

        if (!team) {
          return;
        }

        tacticsRef.current[
          team
        ] = {
          ...tacticsRef.current[
            team
          ],
          [field]: value,
        };

        if (team === "home") {
          setHomeTactics({
            ...tacticsRef.current.home,
          });
        } else {
          setAwayTactics({
            ...tacticsRef.current.away,
          });
        }

        saveMatchState();
      },
      [
        isManager,
        managerTeam,
        saveMatchState,
      ]
    );

  // ==========================================================
  // SAVE USER LINEUP
  // ==========================================================

  const saveUserLineup =
    useCallback(() => {
      if (
        !isManager ||
        !managerTeam
      ) {
        return;
      }

      if (
        selectedLineup.length !==
        11
      ) {
        toast.error(
          "Select exactly 11 players."
        );

        return;
      }

      const squad =
        managerTeam === "home"
          ? homeSquad
          : awaySquad;

      const lineup =
        selectedLineup
          .map((idValue) =>
            squad.find(
              (player) =>
                String(
                  playerId(
                    player
                  )
                ) ===
                String(idValue)
            )
          )
          .filter(Boolean);

      if (
        lineup.length !== 11
      ) {
        toast.error(
          "Some selected players are no longer available."
        );

        return;
      }

      if (
        managerTeam === "home"
      ) {
        homeXIRef.current =
          lineup;

        setHomeXI([
          ...lineup,
        ]);

        const bench =
          getBench(
            homeSquad,
            lineup
          );

        homeBenchRef.current =
          bench;

        setHomeBench([
          ...bench,
        ]);
      } else {
        awayXIRef.current =
          lineup;

        setAwayXI([
          ...lineup,
        ]);

        const bench =
          getBench(
            awaySquad,
            lineup
          );

        awayBenchRef.current =
          bench;

        setAwayBench([
          ...bench,
        ]);
      }

      setLineupOpen(
        false
      );

      toast.success(
        "Lineup saved successfully."
      );

      saveMatchState();
    }, [
      isManager,
      managerTeam,
      selectedLineup,
      homeSquad,
      awaySquad,
      saveMatchState,
    ]);

  // ==========================================================
  // AUTO LINEUP
  // ==========================================================

  const autoLineup =
    useCallback(() => {
      if (
        !isManager ||
        !managerTeam
      ) {
        return;
      }

      const squad =
        managerTeam === "home"
          ? homeSquad
          : awaySquad;

      const formation =
        managerTeam === "home"
          ? homeFormation
          : awayFormation;

      const lineup =
        getFormationPlayers(
          squad,
          formation
        );

      setSelectedLineup(
        lineup.map(
          playerId
        )
      );
    }, [
      isManager,
      managerTeam,
      homeSquad,
      awaySquad,
      homeFormation,
      awayFormation,
    ]);

  // ==========================================================
  // LINEUP OPEN
  // ==========================================================

  const openLineup =
    useCallback(() => {
      if (
        !isManager ||
        !managerTeam
      ) {
        return;
      }

      const xi =
        managerTeam === "home"
          ? homeXIRef.current
          : awayXIRef.current;

      setSelectedLineup(
        xi.map(playerId)
      );

      setLineupOpen(
        true
      );
    }, [
      isManager,
      managerTeam,
    ]);

  // ==========================================================
  // SUBSTITUTE
  // ==========================================================

  const makeSubstitution =
    useCallback(() => {
      if (
        !isManager ||
        !managerTeam
      ) {
        return;
      }

      if (
        subsRef.current[
          managerTeam
        ] >=
        MAX_SUBSTITUTIONS
      ) {
        toast.error(
          `Maximum ${MAX_SUBSTITUTIONS} substitutions reached.`
        );

        return;
      }

      if (
        !selectedSubOut ||
        !selectedSubIn
      ) {
        toast.error(
          "Select a player to replace and a substitute."
        );

        return;
      }

      const xi =
        managerTeam === "home"
          ? homeXIRef.current
          : awayXIRef.current;

      const bench =
        managerTeam === "home"
          ? homeBenchRef.current
          : awayBenchRef.current;

      const outgoing =
        xi.find(
          (player) =>
            String(
              playerId(
                player
              )
            ) ===
            String(
              selectedSubOut
            )
        );

      const incoming =
        bench.find(
          (player) =>
            String(
              playerId(
                player
              )
            ) ===
            String(
              selectedSubIn
            )
        );

      if (
        !outgoing ||
        !incoming
      ) {
        return;
      }

      const newXI =
        xi.map((player) =>
          String(
            playerId(
              player
            )
          ) ===
          String(
            selectedSubOut
          )
            ? incoming
            : player
        );

      const newBench =
        bench.filter(
          (player) =>
            String(
              playerId(
                player
              )
            ) !==
            String(
              selectedSubIn
            )
        );

      newBench.push(
        outgoing
      );

      if (
        managerTeam === "home"
      ) {
        homeXIRef.current =
          newXI;

        homeBenchRef.current =
          newBench;

        setHomeXI([
          ...newXI,
        ]);

        setHomeBench([
          ...newBench,
        ]);
      } else {
        awayXIRef.current =
          newXI;

        awayBenchRef.current =
          newBench;

        setAwayXI([
          ...newXI,
        ]);

        setAwayBench([
          ...newBench,
        ]);
      }

      subsRef.current[
        managerTeam
      ] += 1;

      eventsRef.current = [
        {
          id:
            `sub-${Date.now()}`,
          type: "substitution",
          team: managerTeam,
          minute:
            minuteRef.current,
          detail:
            `${playerName(
              outgoing
            )} replaced by ${playerName(
              incoming
            )}.`,
        },
        ...eventsRef.current,
      ];

      setSelectedSubOut("");
      setSelectedSubIn("");

      syncUI();
      saveMatchState();

      toast.success(
        "Substitution completed."
      );
    }, [
      isManager,
      managerTeam,
      selectedSubOut,
      selectedSubIn,
      syncUI,
      saveMatchState,
    ]);

  // ==========================================================
  // DISPLAY
  // ==========================================================

  const statusLabel =
    matchStatus === "ready"
      ? "READY"
      : matchStatus === "live"
      ? isPaused
        ? "PAUSED"
        : "LIVE"
      : matchStatus ===
        "half-time"
      ? "HALF TIME"
      : matchStatus ===
        "finished"
      ? "FULL TIME"
      : "LOADING";

  const displayMinute =
    matchMinute > 90
      ? `90+${matchMinute - 90}`
      : `${matchMinute}`;

  const activeSquad =
    managerTeam === "home"
      ? homeSquad
      : awaySquad;

  const activeXI =
    managerTeam === "home"
      ? homeXI
      : awayXI;

  const activeBench =
    managerTeam === "home"
      ? homeBench
      : awayBench;

  const currentTactics =
    managerTeam === "home"
      ? homeTactics
      : awayTactics;

  // ==========================================================
  // RENDER
  // ==========================================================

  if (
    authLoading ||
    loading
  ) {
    return (
      <div
        className={
          styles.loadingPage
        }
      >
        <div
          className={
            styles.spinner
          }
        />
        <h2>
          Loading Match Centre
        </h2>
        <p>
          Preparing teams,
          players and match
          engine...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={
          styles.errorPage
        }
      >
        <div>⚠️</div>
        <h1>
          Match Error
        </h1>
        <p>{error}</p>

        <button
          onClick={() =>
            router.push(
              "/fixtures"
            )
          }
        >
          ← Back to Fixtures
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
          styles.errorPage
        }
      >
        <h1>
          Match Not Found
        </h1>

        <button
          onClick={() =>
            router.push(
              "/fixtures"
            )
          }
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} | Match
          Centre
        </title>

        <meta
          name="theme-color"
          content="#050816"
        />
      </Head>

      <main
        className={styles.page}
      >
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

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
                "/fixtures"
              )
            }
          >
            ← Fixtures
          </button>

          <div>
            <h1>
              Match Centre
            </h1>

            <span
              className={
                styles.liveCompetition
              }
            >
              {match.leagueName ||
                match.competition ||
                "Football Match"}
            </span>
          </div>

          <div
            className={`${styles.status} ${
              matchStatus ===
              "live"
                ? styles.statusLive
                : ""
            }`}
          >
            {statusLabel}
          </div>
        </header>

        {/* ================================================= */}
        {/* SCOREBOARD */}
        {/* ================================================= */}

        <section
          className={
            styles.scoreboard
          }
        >
          <div
            className={
              styles.teamBox
            }
          >
            <div
              className={
                styles.logo
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
                "⚽"
              )}
            </div>

            <strong>
              {homeClub.name}
            </strong>

            <span>
              HOME
            </span>
          </div>

          <div
            className={
              styles.scoreCenter
            }
          >
            <div
              className={
                styles.score
              }
            >
              {homeScore}
              <span>-</span>
              {awayScore}
            </div>

            <div
              className={
                styles.minute
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
              styles.teamBox
            }
          >
            <div
              className={
                styles.logo
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
                "⚽"
              )}
            </div>

            <strong>
              {awayClub.name}
            </strong>

            <span>
              AWAY
            </span>
          </div>
        </section>

        {/* ================================================= */}
        {/* PITCH */}
        {/* ================================================= */}

        <section
          className={
            styles.pitchCard
          }
        >
          <ThreePitch
            homeXI={homeXI}
            awayXI={awayXI}
            playerPositions={
              playerPositions
            }
            ballAction={
              ballAction
            }
            homeColor={
              homeClub.primaryColor ||
              homeClub.color ||
              "#2563eb"
            }
            awayColor={
              awayClub.primaryColor ||
              awayClub.color ||
              "#ef4444"
            }
          />

          <div
            className={
              styles.pitchLegend
            }
          >
            <span>
              <i
                style={{
                  background:
                    homeClub.primaryColor ||
                    "#2563eb",
                }}
              />
              {homeClub.name}
            </span>

            <span>
              <i
                style={{
                  background:
                    awayClub.primaryColor ||
                    "#ef4444",
                }}
              />
              {awayClub.name}
            </span>
          </div>
        </section>

        {/* ================================================= */}
        {/* MANAGER PANEL */}
        {/* ================================================= */}

        {isManager && (
          <section
            className={
              styles.managerPanel
            }
          >
            <div
              className={
                styles.panelTitle
              }
            >
              <div>
                <span>
                  MANAGER
                </span>

                <h2>
                  {managerTeam ===
                  "home"
                    ? homeClub.name
                    : awayClub.name}
                </h2>
              </div>

              <span
                className={
                  styles.managerBadge
                }
              >
                YOUR TEAM
              </span>
            </div>

            <div
              className={
                styles.managerActions
              }
            >
              <button
                onClick={
                  openLineup
                }
              >
                👥 Edit Lineup
              </button>

              <label>
                Formation

                <select
                  value={
                    managerTeam ===
                    "home"
                      ? homeFormation
                      : awayFormation
                  }
                  onChange={(e) =>
                    changeFormation(
                      e.target.value
                    )
                  }
                >
                  {Object.keys(
                    FORMATIONS
                  ).map(
                    (formation) => (
                      <option
                        key={
                          formation
                        }
                        value={
                          formation
                        }
                      >
                        {formation}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>

            <div
              className={
                styles.tacticsGrid
              }
            >
              <label>
                Mentality

                <select
                  value={
                    currentTactics.mentality
                  }
                  onChange={(e) =>
                    changeTactic(
                      "mentality",
                      e.target.value
                    )
                  }
                >
                  <option value="defensive">
                    Defensive
                  </option>

                  <option value="balanced">
                    Balanced
                  </option>

                  <option value="attacking">
                    Attacking
                  </option>
                </select>
              </label>

              <label>
                Tempo

                <select
                  value={
                    currentTactics.tempo
                  }
                  onChange={(e) =>
                    changeTactic(
                      "tempo",
                      e.target.value
                    )
                  }
                >
                  <option value="slow">
                    Slow
                  </option>

                  <option value="normal">
                    Normal
                  </option>

                  <option value="fast">
                    Fast
                  </option>
                </select>
              </label>

              <label>
                Pressing

                <select
                  value={
                    currentTactics.pressing
                  }
                  onChange={(e) =>
                    changeTactic(
                      "pressing",
                      e.target.value
                    )
                  }
                >
                  <option value="low">
                    Low
                  </option>

                  <option value="medium">
                    Medium
                  </option>

                  <option value="high">
                    High
                  </option>
                </select>
              </label>

              <label>
                Defensive Line

                <select
                  value={
                    currentTactics.defensiveLine
                  }
                  onChange={(e) =>
                    changeTactic(
                      "defensiveLine",
                      e.target.value
                    )
                  }
                >
                  <option value="deep">
                    Deep
                  </option>

                  <option value="normal">
                    Normal
                  </option>

                  <option value="high">
                    High
                  </option>
                </select>
              </label>

              <label>
                Width

                <select
                  value={
                    currentTactics.width
                  }
                  onChange={(e) =>
                    changeTactic(
                      "width",
                      e.target.value
                    )
                  }
                >
                  <option value="narrow">
                    Narrow
                  </option>

                  <option value="normal">
                    Normal
                  </option>

                  <option value="wide">
                    Wide
                  </option>
                </select>
              </label>
            </div>
          </section>
        )}

        {/* ================================================= */}
        {/* MATCH CONTROLS */}
        {/* ================================================= */}

        <section
          className={
            styles.controls
          }
        >
          {matchStatus ===
            "ready" && (
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
            "half-time" && (
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
            "live" && (
            <button
              onClick={
                togglePause
              }
            >
              {isPaused
                ? "▶ Resume"
                : "⏸ Pause"}
            </button>
          )}

          {matchStatus ===
            "finished" && (
            <button
              onClick={() =>
                router.push(
                  "/fixtures"
                )
              }
            >
              ← Fixtures
            </button>
          )}
        </section>

        {/* ================================================= */}
        {/* SUBSTITUTIONS */}
        {/* ================================================= */}

        {isManager &&
          matchStatus !==
            "finished" && (
            <section
              className={
                styles.substitutionPanel
              }
            >
              <div
                className={
                  styles.panelTitle
                }
              >
                <div>
                  <span>
                    BENCH
                  </span>

                  <h2>
                    Substitutions
                  </h2>
                </div>

                <strong>
                  {
                    subsUsed[
                      managerTeam
                    ]
                  }
                  /{MAX_SUBSTITUTIONS}
                </strong>
              </div>

              <div
                className={
                  styles.substitutionGrid
                }
              >
                <label>
                  Player Out

                  <select
                    value={
                      selectedSubOut
                    }
                    onChange={(e) =>
                      setSelectedSubOut(
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      Select player
                    </option>

                    {activeXI.map(
                      (player) => (
                        <option
                          key={playerId(
                            player
                          )}
                          value={playerId(
                            player
                          )}
                        >
                          {playerName(
                            player
                          )}{" "}
                          ·{" "}
                          {overall(
                            player
                          )}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  Player In

                  <select
                    value={
                      selectedSubIn
                    }
                    onChange={(e) =>
                      setSelectedSubIn(
                        e.target.value
                      )
                    }
                  >
                    <option value="">
                      Select substitute
                    </option>

                    {activeBench.map(
                      (player) => (
                        <option
                          key={playerId(
                            player
                          )}
                          value={playerId(
                            player
                          )}
                        >
                          {playerName(
                            player
                          )}{" "}
                          ·{" "}
                          {overall(
                            player
                          )}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <button
                  onClick={
                    makeSubstitution
                  }
                  disabled={
                    subsUsed[
                      managerTeam
                    ] >=
                    MAX_SUBSTITUTIONS
                  }
                >
                  🔄 Make Substitution
                </button>
              </div>
            </section>
          )}

        {/* ================================================= */}
        {/* STATS */}
        {/* ================================================= */}

        <section
          className={
            styles.statsCard
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <div>
              <span>
                LIVE DATA
              </span>

              <h2>
                Match Statistics
              </h2>
            </div>

            <strong>
              {homeScore} -{" "}
              {awayScore}
            </strong>
          </div>

          {[
            [
              "Possession",
              `${homeStats.possession.toFixed(
                1
              )}%`,
              `${awayStats.possession.toFixed(
                1
              )}%`,
            ],
            [
              "Shots",
              homeStats.shots,
              awayStats.shots,
            ],
            [
              "Shots on Target",
              homeStats.shotsOnTarget,
              awayStats.shotsOnTarget,
            ],
            [
              "Passes",
              homeStats.passes,
              awayStats.passes,
            ],
            [
              "Passes Completed",
              homeStats.passesCompleted,
              awayStats.passesCompleted,
            ],
            [
              "Tackles",
              homeStats.tackles,
              awayStats.tackles,
            ],
            [
              "Interceptions",
              homeStats.interceptions,
              awayStats.interceptions,
            ],
            [
              "Fouls",
              homeStats.fouls,
              awayStats.fouls,
            ],
            [
              "Corners",
              homeStats.corners,
              awayStats.corners,
            ],
            [
              "Saves",
              homeStats.saves,
              awayStats.saves,
            ],
            [
              "Yellow Cards",
              homeStats.yellow,
              awayStats.yellow,
            ],
            [
              "Red Cards",
              homeStats.red,
              awayStats.red,
            ],
            [
              "Attacks",
              homeStats.attacks,
              awayStats.attacks,
            ],
            [
              "Dangerous Attacks",
              homeStats.dangerousAttacks,
              awayStats.dangerousAttacks,
            ],
            [
              "Dribbles",
              homeStats.dribbles,
              awayStats.dribbles,
            ],
          ].map(
            (row) => (
              <div
                className={
                  styles.statRow
                }
                key={row[0]}
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
            )
          )}
        </section>

        {/* ================================================= */}
        {/* EVENTS */}
        {/* ================================================= */}

        <section
          className={
            styles.eventsCard
          }
        >
          <div
            className={
              styles.sectionHeader
            }
          >
            <div>
              <span>
                LIVE MATCH PLAY
              </span>

              <h2>
                Events
              </h2>
            </div>

            <strong>
              {events.length}
            </strong>
          </div>

          <div
            className={
              styles.eventsList
            }
          >
            {events.length ===
            0 ? (
              <div
                className={
                  styles.emptyEvents
                }
              >
                The match is
                starting...
              </div>
            ) : (
              events
                .slice(0, 40)
                .map(
                  (event) => (
                    <div
                      className={
                        styles.event
                      }
                      key={
                        event.id
                      }
                    >
                      <b>
                        {event.minute}
                        '
                      </b>

                      <span>
                        {event.type ===
                        "goal"
                          ? "⚽"
                          : event.type ===
                            "save"
                          ? "🧤"
                          : event.type ===
                            "substitution"
                          ? "🔄"
                          : event.type ===
                            "shot"
                          ? "💥"
                          : "•"}
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

                      <small>
                        {event.team ===
                        "home"
                          ? homeClub.name
                          : awayClub.name}
                      </small>
                    </div>
                  )
                )
            )}
          </div>
        </section>

        {/* ================================================= */}
        {/* LINEUPS */}
        {/* ================================================= */}

        <section
          className={
            styles.lineupsGrid
          }
        >
          <div
            className={
              styles.lineupCard
            }
          >
            <div
              className={
                styles.lineupHeader
              }
            >
              <div>
                <span>
                  HOME
                </span>

                <h3>
                  {homeClub.name}
                </h3>
              </div>

              <b>
                {homeFormation}
              </b>
            </div>

            {homeXI.map(
              (
                player,
                index
              ) => (
                <div
                  key={playerId(
                    player
                  )}
                  className={
                    styles.playerRow
                  }
                >
                  <span>
                    {index + 1}
                  </span>

                  <div>
                    <strong>
                      {playerName(
                        player
                      )}
                    </strong>

                    <small>
                      {position(
                        player
                      )}
                    </small>
                  </div>

                  <b>
                    {overall(
                      player
                    )}
                  </b>
                </div>
              )
            )}
          </div>

          <div
            className={
              styles.lineupCard
            }
          >
            <div
              className={
                styles.lineupHeader
              }
            >
              <div>
                <span>
                  AWAY
                </span>

                <h3>
                  {awayClub.name}
                </h3>
              </div>

              <b>
                {awayFormation}
              </b>
            </div>

            {awayXI.map(
              (
                player,
                index
              ) => (
                <div
                  key={playerId(
                    player
                  )}
                  className={
                    styles.playerRow
                  }
                >
                  <span>
                    {index + 1}
                  </span>

                  <div>
                    <strong>
                      {playerName(
                        player
                      )}
                    </strong>

                    <small>
                      {position(
                        player
                      )}
                    </small>
                  </div>

                  <b>
                    {overall(
                      player
                    )}
                  </b>
                </div>
              )
            )}
          </div>
        </section>

        {/* ================================================= */}
        {/* LINEUP MODAL */}
        {/* ================================================= */}

        {lineupOpen &&
          isManager && (
            <div
              className={
                styles.modalBackdrop
              }
            >
              <div
                className={
                  styles.lineupModal
                }
              >
                <div
                  className={
                    styles.modalHeader
                  }
                >
                  <div>
                    <span>
                      MANAGER
                    </span>

                    <h2>
                      Select Starting XI
                    </h2>
                  </div>

                  <button
                    onClick={() =>
                      setLineupOpen(
                        false
                      )
                    }
                  >
                    ×
                  </button>
                </div>

                <div
                  className={
                    styles.modalTools
                  }
                >
                  <strong>
                    {
                      selectedLineup.length
                    }
                    /11 selected
                  </strong>

                  <button
                    onClick={
                      autoLineup
                    }
                  >
                    ⭐ Best XI
                  </button>
                </div>

                <div
                  className={
                    styles.squadList
                  }
                >
                  {activeSquad.map(
                    (player) => {
                      const idValue =
                        String(
                          playerId(
                            player
                          )
                        );

                      const selected =
                        selectedLineup.includes(
                          idValue
                        ) ||
                        selectedLineup.includes(
                          playerId(
                            player
                          )
                        );

                      return (
                        <button
                          key={
                            idValue
                          }
                          className={`${styles.squadPlayer} ${
                            selected
                              ? styles.selectedPlayer
                              : ""
                          }`}
                          onClick={() => {
                            if (
                              selected
                            ) {
                              setSelectedLineup(
                                selectedLineup.filter(
                                  (x) =>
                                    String(
                                      x
                                    ) !==
                                    idValue
                                )
                              );
                            } else if (
                              selectedLineup.length <
                              11
                            ) {
                              setSelectedLineup(
                                [
                                  ...selectedLineup,
                                  idValue,
                                ]
                              );
                            }
                          }}
                        >
                          <span>
                            {selected
                              ? "✓"
                              : "+"}
                          </span>

                          <div>
                            <strong>
                              {playerName(
                                player
                              )}
                            </strong>

                            <small>
                              {position(
                                player
                              )}
                            </small>
                          </div>

                          <b>
                            {overall(
                              player
                            )}
                          </b>
                        </button>
                      );
                    }
                  )}
                </div>

                <div
                  className={
                    styles.modalFooter
                  }
                >
                  <button
                    onClick={() =>
                      setLineupOpen(
                        false
                      )
                    }
                  >
                    Cancel
                  </button>

                  <button
                    className={
                      styles.primaryButton
                    }
                    disabled={
                      selectedLineup.length !==
                      11
                    }
                    onClick={
                      saveUserLineup
                    }
                  >
                    Save Starting XI
                  </button>
                </div>
              </div>
            </div>
          )}
      </main>
    </>
  );
}
