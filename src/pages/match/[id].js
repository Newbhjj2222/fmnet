import React, {
  useCallback,
  useEffect,
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

// Real match duration in seconds (4 minutes)
const MATCH_REAL_DURATION_SECONDS = 240;
// Timer tick in milliseconds (500ms = 2 plays per second)
const MATCH_TICK_MS = 500;

const MATCH_MINUTE = 90;

const MAX_SUBSTITUTIONS = 5;

const PLAYERS_ON_PITCH = 11;

const MIN_SQUAD_SIZE = 11;

const FALLBACK_SQUAD_SIZE = 18;

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

// ============================================================
// FORMATION VISUAL POSITIONS
// ============================================================

const FORMATION_POINTS = {
  "4-4-2": [
    [-11.5, 0],

    [-8.5, -6.8],
    [-8.5, -2.3],
    [-8.5, 2.3],
    [-8.5, 6.8],

    [-3.0, -6.0],
    [-2.0, -2.0],
    [-2.0, 2.0],
    [-3.0, 6.0],

    [3.5, -3.2],
    [3.5, 3.2],
  ],

  "4-3-3": [
    [-11.5, 0],

    [-8.5, -6.8],
    [-8.5, -2.3],
    [-8.5, 2.3],
    [-8.5, 6.8],

    [-3.0, -5.0],
    [-2.0, 0],
    [-3.0, 5.0],

    [4.5, -6.0],
    [5.5, 0],
    [4.5, 6.0],
  ],

  "3-5-2": [
    [-11.5, 0],

    [-8.5, -4.8],
    [-8.5, 0],
    [-8.5, 4.8],

    [-3.5, -7.0],
    [-2.0, -3.5],
    [-1.0, 0],
    [-2.0, 3.5],
    [-3.5, 7.0],

    [4.0, -3.0],
    [4.0, 3.0],
  ],

  "5-3-2": [
    [-11.5, 0],

    [-8.5, -8.0],
    [-8.5, -4.0],
    [-8.5, 0],
    [-8.5, 4.0],
    [-8.5, 8.0],

    [-3.0, -5.0],
    [-2.0, 0],
    [-3.0, 5.0],

    [4.0, -3.0],
    [4.0, 3.0],
  ],

  "4-2-3-1": [
    [-11.5, 0],

    [-8.5, -6.8],
    [-8.5, -2.3],
    [-8.5, 2.3],
    [-8.5, 6.8],

    [-3.5, -3.5],
    [-3.5, 3.5],

    [1.0, -5.0],
    [1.5, 0],
    [1.0, 5.0],

    [5.5, 0],
  ],
};

// ============================================================
// HELPERS
// ============================================================

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function randomInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function playerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    `${player?.firstName || ""} ${player?.lastName || ""}`.trim() ||
    "Unknown Player"
  );
}

function playerId(player) {
  return (
    player?.id ||
    player?.playerId ||
    player?.uid ||
    null
  );
}

function overall(player) {
  return clamp(
    safeNumber(
      player?.overall ??
        player?.rating ??
        player?.ovr ??
        player?.overallRating ??
        60
    ),
    35,
    99
  );
}

function position(player) {
  const raw = String(
    player?.position ||
      player?.primaryPosition ||
      player?.role ||
      "MID"
  ).toLowerCase();

  if (
    raw.includes("goalkeeper") ||
    raw.includes("goal keeper") ||
    raw === "gk" ||
    raw.includes("keeper")
  ) {
    return "GK";
  }

  if (
    raw.includes("def") ||
    raw.includes("back") ||
    raw === "cb" ||
    raw === "lb" ||
    raw === "rb" ||
    raw === "lwb" ||
    raw === "rwb"
  ) {
    return "DEF";
  }

  if (
    raw.includes("attack") ||
    raw.includes("forward") ||
    raw.includes("striker") ||
    raw === "st" ||
    raw === "cf" ||
    raw === "lw" ||
    raw === "rw"
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

// ============================================================
// STATUS NORMALIZATION
// ============================================================

function normalizeMatchStatus(status) {
  const value = String(
    status || ""
  ).toLowerCase();

  if (
    [
      "ready",
      "scheduled",
      "pending",
      "upcoming",
      "not-started",
      "not_started",
      "created",
    ].includes(value)
  ) {
    return "ready";
  }

  if (
    [
      "live",
      "playing",
      "started",
      "in-progress",
      "in_progress",
    ].includes(value)
  ) {
    return "live";
  }

  if (
    [
      "half-time",
      "halftime",
      "half_time",
    ].includes(value)
  ) {
    return "half-time";
  }

  if (
    [
      "finished",
      "completed",
      "full-time",
      "full_time",
      "ended",
    ].includes(value)
  ) {
    return "finished";
  }

  return "ready";
}

// ============================================================
// FORMATION
// ============================================================

function normalizeFormation(formation) {
  return FORMATIONS[formation]
    ? formation
    : "4-4-2";
}

function formationModifier(formation) {
  const values = {
    "4-4-2": 1.0,
    "4-3-3": 1.035,
    "3-5-2": 1.02,
    "5-3-2": 0.985,
    "4-2-3-1": 1.03,
  };

  return values[formation] || 1;
}

// ============================================================
// TACTICS
// ============================================================

function tacticModifier(tactics) {
  const t = normalizeTactics(tactics);

  let modifier = 1;

  if (t.mentality === "attacking") {
    modifier += 0.055;
  }

  if (t.mentality === "defensive") {
    modifier -= 0.025;
  }

  if (t.tempo === "fast") {
    modifier += 0.025;
  }

  if (t.tempo === "slow") {
    modifier -= 0.01;
  }

  if (t.pressing === "high") {
    modifier += 0.03;
  }

  if (t.pressing === "low") {
    modifier -= 0.012;
  }

  if (t.defensiveLine === "high") {
    modifier += 0.018;
  }

  if (t.defensiveLine === "deep") {
    modifier += 0.008;
  }

  if (t.width === "wide") {
    modifier += 0.012;
  }

  if (t.width === "narrow") {
    modifier -= 0.005;
  }

  return modifier;
}

// ============================================================
// PLAYER STRENGTH
// ============================================================

function calculateTeamPower(
  xi,
  tactics,
  formation
) {
  if (
    !Array.isArray(xi) ||
    xi.length === 0
  ) {
    return 60;
  }

  const total = xi.reduce(
    (sum, player) =>
      sum + overall(player),
    0
  );

  const average =
    total / xi.length;

  const power =
    average *
    formationModifier(formation) *
    tacticModifier(tactics);

  return clamp(power, 35, 110);
}

// ============================================================
// GET FORMATION PLAYERS
// ============================================================

function getFormationPlayers(
  squad,
  formation
) {
  if (
    !Array.isArray(squad) ||
    squad.length === 0
  ) {
    return [];
  }

  const normalizedFormation =
    normalizeFormation(formation);

  const required =
    FORMATIONS[normalizedFormation];

  const remaining = [...squad];

  const selected = [];

  const takeBest = (
    type,
    count
  ) => {
    const candidates = remaining
      .filter(
        (player) =>
          position(player) === type
      )
      .sort(
        (a, b) =>
          overall(b) -
          overall(a)
      )
      .slice(0, count);

    candidates.forEach(
      (player) => {
        const id =
          playerId(player);

        const index =
          remaining.findIndex(
            (item) =>
              String(
                playerId(item)
              ) ===
              String(id)
          );

        if (index >= 0) {
          remaining.splice(
            index,
            1
          );
        }

        selected.push(player);
      }
    );
  };

  takeBest(
    "GK",
    required.GK
  );

  takeBest(
    "DEF",
    required.DEF
  );

  takeBest(
    "MID",
    required.MID
  );

  takeBest(
    "ATT",
    required.ATT
  );

  // Fill missing places with strongest remaining players.
  while (
    selected.length <
      PLAYERS_ON_PITCH &&
    remaining.length
  ) {
    remaining.sort(
      (a, b) =>
        overall(b) -
        overall(a)
    );

    selected.push(
      remaining.shift()
    );
  }

  return selected.slice(
    0,
    PLAYERS_ON_PITCH
  );
}

// ============================================================
// LINEUP FROM IDS
// ============================================================

function lineupFromIds(
  squad,
  ids,
  formation
) {
  if (
    !Array.isArray(squad) ||
    squad.length < PLAYERS_ON_PITCH
  ) {
    return [];
  }

  if (
    !Array.isArray(ids) ||
    ids.length !== PLAYERS_ON_PITCH
  ) {
    return getFormationPlayers(
      squad,
      formation
    );
  }

  const map = new Map();

  squad.forEach(
    (player) => {
      const id =
        playerId(player);

      if (id !== null) {
        map.set(
          String(id),
          player
        );
      }
    }
  );

  const players = ids
    .map((id) =>
      map.get(String(id))
    )
    .filter(Boolean);

  if (
    players.length ===
    PLAYERS_ON_PITCH
  ) {
    return players;
  }

  return getFormationPlayers(
    squad,
    formation
  );
}

// ============================================================
// ENSURE XI
// ============================================================

function ensureStartingXI(
  squad,
  formation,
  savedIds
) {
  if (
    !Array.isArray(squad) ||
    squad.length <
      PLAYERS_ON_PITCH
  ) {
    return [];
  }

  const lineup =
    lineupFromIds(
      squad,
      savedIds,
      formation
    );

  if (
    lineup.length ===
    PLAYERS_ON_PITCH
  ) {
    return lineup;
  }

  return getFormationPlayers(
    squad,
    formation
  ).slice(
    0,
    PLAYERS_ON_PITCH
  );
}

// ============================================================
// BENCH
// ============================================================

function getBench(
  squad,
  xi
) {
  if (!Array.isArray(squad)) {
    return [];
  }

  const selected =
    new Set(
      xi
        .map(playerId)
        .filter(Boolean)
        .map(String)
    );

  return squad.filter(
    (player) =>
      !selected.has(
        String(playerId(player))
      )
  );
}

// ============================================================
// FALLBACK PLAYERS
// ============================================================

function generateFallbackPlayers(
  clubId,
  count
) {
  const roles = [
    "GK",
    "DEF",
    "DEF",
    "DEF",
    "DEF",
    "DEF",
    "MID",
    "MID",
    "MID",
    "MID",
    "MID",
    "ATT",
    "ATT",
    "ATT",
    "MID",
    "DEF",
    "MID",
    "ATT",
  ];

  return Array.from(
    { length: count },
    (_, index) => {
      const role =
        roles[index] ||
        "MID";

      return {
        id: `generated-${clubId}-${index + 1}`,
        playerId: `generated-${clubId}-${index + 1}`,
        name: `${role} Player ${index + 1}`,
        position: role,
        overall: randomInt(58, 72),
        clubId,
        generated: true,
      };
    }
  );
}

function completeSquad(
  squad,
  clubId
) {
  const existing =
    Array.isArray(squad)
      ? [...squad]
      : [];

  if (
    existing.length >=
    FALLBACK_SQUAD_SIZE
  ) {
    return existing;
  }

  const needed =
    FALLBACK_SQUAD_SIZE -
    existing.length;

  return [
    ...existing,
    ...generateFallbackPlayers(
      clubId,
      needed
    ),
  ];
}

// ============================================================
// MANAGER DETECTION
// ============================================================

function isManagerOfClub(
  club,
  profile,
  authUser
) {
  if (!club) {
    return false;
  }

  const uid =
    authUser?.uid ||
    profile?.uid ||
    profile?.id ||
    null;

  const username =
    profile?.username ||
    authUser?.username ||
    authUser?.displayName ||
    null;

  const possibleManagerIds = [
    club.managerId,
    club.managerUid,
    club.managerUserId,
    club.manager?.uid,
    club.manager?.userId,
    club.manager?.id,
  ]
    .filter(Boolean)
    .map(String);

  if (
    uid &&
    possibleManagerIds.includes(
      String(uid)
    )
  ) {
    return true;
  }

  const possibleUsernames = [
    club.managerUsername,
    club.manager,
    club.managerName,
    club.manager?.username,
  ]
    .filter(
      (value) =>
        typeof value ===
        "string"
    )
    .map(String);

  if (
    username &&
    possibleUsernames.includes(
      String(username)
    )
  ) {
    return true;
  }

  const currentClub =
    profile?.careerData
      ?.currentClub ??
    profile?.currentClub ??
    null;

  if (currentClub) {
    const currentId =
      typeof currentClub ===
      "object"
        ? currentClub.id ||
          currentClub.clubId ||
          currentClub.currentClubId
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
// AI TACTICS
// ============================================================

function calculateAITactics(
  aiTeam,
  score
) {
  const aiScore =
    aiTeam === "home"
      ? score.home
      : score.away;

  const opponentScore =
    aiTeam === "home"
      ? score.away
      : score.home;

  const difference =
    aiScore -
    opponentScore;

  if (difference < 0) {
    return {
      mentality: "attacking",
      tempo: "fast",
      pressing: "high",
      defensiveLine: "high",
      width: "wide",
    };
  }

  if (difference > 0) {
    return {
      mentality: "defensive",
      tempo: "slow",
      pressing: "low",
      defensiveLine: "deep",
      width: "normal",
    };
  }

  return {
    mentality: "balanced",
    tempo: "normal",
    pressing: "medium",
    defensiveLine: "normal",
    width: "normal",
  };
}

// ============================================================
// AI FORMATION
// ============================================================

function calculateAIFormation(
  aiTeam,
  score,
  currentFormation
) {
  const aiScore =
    aiTeam === "home"
      ? score.home
      : score.away;

  const opponentScore =
    aiTeam === "home"
      ? score.away
      : score.home;

  const difference =
    aiScore -
    opponentScore;

  if (difference <= -2) {
    return "4-3-3";
  }

  if (difference >= 2) {
    return "5-3-2";
  }

  return normalizeFormation(
    currentFormation
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

  // ==========================================================
  // STATE
  // ==========================================================

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

  const [managerTeam, setManagerTeam] =
    useState(null);

  const [isManager, setIsManager] =
    useState(false);

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

  const [playerPositions, setPlayerPositions] =
    useState({});

  const [ballAction, setBallAction] =
    useState({
      id: 0,
      from: [0, 0],
      to: [0, 0],
      type: "idle",
    });

  // ==========================================================
  // REFS
  // ==========================================================

  const matchRef =
    useRef(null);

  const statusRef =
    useRef("loading");

  const minuteRef =
    useRef(0);

  const scoreRef =
    useRef({
      home: 0,
      away: 0,
    });

  const statsRef =
    useRef({
      home: emptyStats(),
      away: emptyStats(),
    });

  const eventsRef =
    useRef([]);

  const homeXIRef =
    useRef([]);

  const awayXIRef =
    useRef([]);

  const homeBenchRef =
    useRef([]);

  const awayBenchRef =
    useRef([]);

  const tacticsRef =
    useRef({
      home: defaultTactics(),
      away: defaultTactics(),
    });

  const formationRef =
    useRef({
      home: "4-4-2",
      away: "4-4-2",
    });

  const positionsRef =
    useRef({});

  const ballRef =
    useRef({
      x: 0,
      z: 0,
    });

  const subsRef =
    useRef({
      home: 0,
      away: 0,
    });

  const processingRef =
    useRef(false);

  const timerRef =
    useRef(null);

  const ballActionIdRef =
    useRef(0);

  // Real time match start timestamp
  const startTimeRef =
    useRef(null);

  // ==========================================================
  // LOAD USER PROFILE
  // ==========================================================

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      try {
        const profileSnap =
          await getDoc(
            doc(
              db,
              "users",
              user.uid
            )
          );

        if (
          !cancelled &&
          profileSnap.exists()
        ) {
          setProfile({
            id: profileSnap.id,
            ...profileSnap.data(),
          });
        }
      } catch (err) {
        console.error(
          "PROFILE LOAD ERROR:",
          err
        );
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // ==========================================================
  // LOAD PLAYERS
  // ==========================================================

  const loadPlayers = useCallback(
    async (clubId) => {
      if (!clubId) {
        return [];
      }

      try {
        const playersRef =
          collection(
            db,
            "players"
          );

        const queries = [
          query(
            playersRef,
            where(
              "clubId",
              "==",
              clubId
            )
          ),

          query(
            playersRef,
            where(
              "currentClub",
              "==",
              clubId
            )
          ),

          query(
            playersRef,
            where(
              "teamId",
              "==",
              clubId
            )
          ),
        ];

        const snapshots =
          await Promise.all(
            queries.map(
              async (playerQuery) => {
                try {
                  return await getDocs(
                    playerQuery
                  );
                } catch (err) {
                  console.warn(
                    "PLAYER QUERY ERROR:",
                    err
                  );

                  return null;
                }
              }
            )
          );

        const uniquePlayers =
          new Map();

        snapshots.forEach(
          (snapshot) => {
            if (!snapshot) {
              return;
            }

            snapshot.docs.forEach(
              (playerDoc) => {
                uniquePlayers.set(
                  playerDoc.id,
                  {
                    id: playerDoc.id,
                    ...playerDoc.data(),
                  }
                );
              }
            );
          }
        );

        return Array.from(
          uniquePlayers.values()
        );
      } catch (err) {
        console.error(
          "PLAYER LOADING ERROR:",
          err
        );

        return [];
      }
    },
    []
  );

  // ==========================================================
  // LOAD MATCH
  // ==========================================================

  useEffect(() => {
    if (
      authLoading ||
      !id
    ) {
      return;
    }

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError("");

        const matchSnap =
          await getDoc(
            doc(
              db,
              "matches",
              id
            )
          );

        if (
          !matchSnap.exists()
        ) {
          throw new Error(
            "Match not found."
          );
        }

        const matchData = {
          id: matchSnap.id,
          ...matchSnap.data(),
        };

        if (cancelled) {
          return;
        }

        matchRef.current =
          matchData;

        setMatch(matchData);

        // ====================================================
        // CLUBS
        // ====================================================

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
                  "Home",
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
                  "Away",
              };

        if (cancelled) {
          return;
        }

        setHomeClub(home);
        setAwayClub(away);

        // ====================================================
        // PLAYERS
        // ====================================================

        const [
          rawHomeSquad,
          rawAwaySquad,
        ] = await Promise.all([
          loadPlayers(home.id),
          loadPlayers(away.id),
        ]);

        if (cancelled) {
          return;
        }

        const finalHomeSquad =
          completeSquad(
            rawHomeSquad,
            home.id
          );

        const finalAwaySquad =
          completeSquad(
            rawAwaySquad,
            away.id
          );

        setHomeSquad(
          finalHomeSquad
        );

        setAwaySquad(
          finalAwaySquad
        );

        // ====================================================
        // STATUS
        // ====================================================

        const loadedStatus =
          normalizeMatchStatus(
            matchData.status
          );

        statusRef.current =
          loadedStatus;

        setMatchStatus(
          loadedStatus
        );

        // ====================================================
        // FORMATIONS
        // ====================================================

        const savedHomeFormation =
          normalizeFormation(
            matchData.homeFormation ||
              matchData.formation ||
              "4-4-2"
          );

        const savedAwayFormation =
          normalizeFormation(
            matchData.awayFormation ||
              "4-4-2"
          );

        formationRef.current = {
          home:
            savedHomeFormation,
          away:
            savedAwayFormation,
        };

        setHomeFormation(
          savedHomeFormation
        );

        setAwayFormation(
          savedAwayFormation
        );

        // ====================================================
        // LINEUPS
        // ====================================================

        const loadedHomeXI =
          ensureStartingXI(
            finalHomeSquad,
            savedHomeFormation,
            matchData.homeLineupIds
          );

        const loadedAwayXI =
          ensureStartingXI(
            finalAwaySquad,
            savedAwayFormation,
            matchData.awayLineupIds
          );

        setHomeXI(
          loadedHomeXI
        );

        setAwayXI(
          loadedAwayXI
        );

        homeXIRef.current =
          loadedHomeXI;

        awayXIRef.current =
          loadedAwayXI;

        // ====================================================
        // BENCH
        // ====================================================

        const loadedHomeBench =
          getBench(
            finalHomeSquad,
            loadedHomeXI
          );

        const loadedAwayBench =
          getBench(
            finalAwaySquad,
            loadedAwayXI
          );

        homeBenchRef.current =
          loadedHomeBench;

        awayBenchRef.current =
          loadedAwayBench;

        setHomeBench(
          loadedHomeBench
        );

        setAwayBench(
          loadedAwayBench
        );

        // ====================================================
        // TACTICS
        // ====================================================

        const loadedHomeTactics =
          normalizeTactics(
            matchData.homeTactics
          );

        const loadedAwayTactics =
          normalizeTactics(
            matchData.awayTactics
          );

        tacticsRef.current = {
          home:
            loadedHomeTactics,
          away:
            loadedAwayTactics,
        };

        setHomeTactics(
          loadedHomeTactics
        );

        setAwayTactics(
          loadedAwayTactics
        );

        // ====================================================
        // MATCH STATE
        // ====================================================

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
          clamp(
            safeNumber(
              matchData.minute,
              0
            ),
            0,
            90
          );

        const loadedEvents =
          Array.isArray(
            matchData.events
          )
            ? matchData.events
            : [];

        const loadedSubs = {
          home: clamp(
            safeNumber(
              matchData.homeSubsUsed,
              0
            ),
            0,
            MAX_SUBSTITUTIONS
          ),

          away: clamp(
            safeNumber(
              matchData.awaySubsUsed,
              0
            ),
            0,
            MAX_SUBSTITUTIONS
          ),
        };

        statsRef.current = {
          home:
            loadedHomeStats,
          away:
            loadedAwayStats,
        };

        scoreRef.current = {
          home:
            loadedHomeScore,
          away:
            loadedAwayScore,
        };

        minuteRef.current =
          loadedMinute;

        eventsRef.current =
          loadedEvents;

        subsRef.current =
          loadedSubs;

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

        setSubsUsed(
          loadedSubs
        );

        // ====================================================
        // START TIME REF (for real time progression)
        // ====================================================

        if (loadedStatus === "live") {
          // Estimate startTime so that current minute matches real elapsed
          const minutesPerSecond =
            90 / MATCH_REAL_DURATION_SECONDS; // 0.375
          startTimeRef.current =
            Date.now() -
            (loadedMinute / minutesPerSecond) * 1000;
        } else {
          startTimeRef.current = Date.now();
        }

        // ====================================================
        // PAUSE STATE
        // ====================================================

        if (
          loadedStatus ===
          "half-time"
        ) {
          setIsPaused(true);
        } else if (
          loadedStatus ===
          "finished"
        ) {
          setIsPaused(true);
        } else {
          setIsPaused(false);
        }

        console.log(
          "MATCH LOADED:",
          {
            id,
            status:
              loadedStatus,
            homePlayers:
              finalHomeSquad.length,
            awayPlayers:
              finalAwaySquad.length,
            homeXI:
              loadedHomeXI.length,
            awayXI:
              loadedAwayXI.length,
          }
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
    loadPlayers,
  ]);

  // ==========================================================
  // MANAGER DETECTION
  // ==========================================================

  useEffect(() => {
    if (
      !homeClub ||
      !awayClub
    ) {
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
    setIsManager(
      Boolean(team)
    );

    console.log(
      "MANAGER DETECTION:",
      {
        homeManager,
        awayManager,
        managerTeam:
          team,
      }
    );
  }, [
    homeClub,
    awayClub,
    profile,
    user,
  ]);

  // ==========================================================
  // INITIAL POSITIONS
  // ==========================================================

  useEffect(() => {
    if (
      homeXI.length !==
        PLAYERS_ON_PITCH ||
      awayXI.length !==
        PLAYERS_ON_PITCH
    ) {
      return;
    }

    const result = {};

    const homePoints =
      FORMATION_POINTS[
        homeFormation
      ] ||
      FORMATION_POINTS[
        "4-4-2"
      ];

    const awayPoints =
      FORMATION_POINTS[
        awayFormation
      ] ||
      FORMATION_POINTS[
        "4-4-2"
      ];

    homeXI.forEach(
      (player, index) => {
        const point =
          homePoints[index] ||
          homePoints[0];

        result[
          `home-${playerId(player)}`
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
          `away-${playerId(player)}`
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
      async (
        statusOverride
      ) => {
        const currentMatch =
          matchRef.current;

        if (
          !currentMatch?.id
        ) {
          return;
        }

        try {
          setIsSaving(true);

          const status =
            normalizeMatchStatus(
              statusOverride ||
                statusRef.current
            );

          await updateDoc(
            doc(
              db,
              "matches",
              currentMatch.id
            ),
            {
              status,

              minute:
                minuteRef.current,

              homeScore:
                scoreRef.current
                  .home,

              awayScore:
                scoreRef.current
                  .away,

              result: {
                homeScore:
                  scoreRef.current
                    .home,

                awayScore:
                  scoreRef.current
                    .away,
              },

              events:
                eventsRef.current,

              homeStats:
                statsRef.current
                  .home,

              awayStats:
                statsRef.current
                  .away,

              homeTactics:
                tacticsRef.current
                  .home,

              awayTactics:
                tacticsRef.current
                  .away,

              homeFormation:
                formationRef.current
                  .home,

              awayFormation:
                formationRef.current
                  .away,

              homeLineupIds:
                homeXIRef.current
                  .map(playerId)
                  .filter(Boolean),

              awayLineupIds:
                awayXIRef.current
                  .map(playerId)
                  .filter(Boolean),

              homeSubsUsed:
                subsRef.current
                  .home,

              awaySubsUsed:
                subsRef.current
                  .away,

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
  // SYNC UI
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

      setMatchMinute(
        minuteRef.current
      );

      setPlayerPositions({
        ...positionsRef.current,
      });
    }, []);

  // ==========================================================
  // VISUAL PLAYER POSITION
  // ==========================================================

  const getVisualPosition =
    useCallback(
      (
        team,
        player
      ) => {
        const key =
          `${team}-${playerId(player)}`;

        return (
          positionsRef.current[
            key
          ] || {
            x:
              team === "home"
                ? -5
                : 5,
            z: 0,
          }
        );
      },
      []
    );

  // ==========================================================
  // PLAYER MOVEMENT
  // ==========================================================

  const updatePlayerMovement =
    useCallback(
      (
        teamWithBall,
        ballX,
        ballZ
      ) => {
        const newPositions =
          {
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
                  `${team}-${playerId(player)}`;

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
                    -3,
                    3
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
          formationRef.current
            .home,
          1
        );

        updateTeam(
          "away",
          awayXIRef.current,
          formationRef.current
            .away,
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

        const nextX =
          to?.x || 0;

        const nextZ =
          to?.z || 0;

        setBallAction({
          id:
            ballActionIdRef.current,

          from: [
            from?.x || 0,
            from?.z || 0,
          ],

          to: [
            nextX,
            nextZ,
          ],

          type,
        });

        ballRef.current = {
          x: nextX,
          z: nextZ,
        };
      },
      []
    );

  // ==========================================================
  // AI TACTICS
  // ==========================================================

  const runAITactics =
    useCallback(() => {
      if (!managerTeam) {
        return;
      }

      const aiTeam =
        managerTeam === "home"
          ? "away"
          : "home";

      const tactics =
        calculateAITactics(
          aiTeam,
          scoreRef.current
        );

      tacticsRef.current[
        aiTeam
      ] = tactics;

      if (
        aiTeam === "home"
      ) {
        setHomeTactics({
          ...tactics,
        });
      } else {
        setAwayTactics({
          ...tactics,
        });
      }

      const currentFormation =
        formationRef.current[
          aiTeam
        ];

      const nextFormation =
        calculateAIFormation(
          aiTeam,
          scoreRef.current,
          currentFormation
        );

      if (
        nextFormation !==
        currentFormation
      ) {
        formationRef.current[
          aiTeam
        ] =
          nextFormation;

        if (
          aiTeam ===
          "home"
        ) {
          setHomeFormation(
            nextFormation
          );
        } else {
          setAwayFormation(
            nextFormation
          );
        }

        const squad =
          aiTeam ===
          "home"
            ? homeSquad
            : awaySquad;

        const currentXI =
          aiTeam ===
          "home"
            ? homeXIRef.current
            : awayXIRef.current;

        const newXI =
          ensureStartingXI(
            squad,
            nextFormation,
            currentXI.map(
              playerId
            )
          );

        if (
          newXI.length ===
          PLAYERS_ON_PITCH
        ) {
          if (
            aiTeam ===
            "home"
          ) {
            homeXIRef.current =
              newXI;

            setHomeXI([
              ...newXI,
            ]);

            const bench =
              getBench(
                squad,
                newXI
              );

            homeBenchRef.current =
              bench;

            setHomeBench([
              ...bench,
            ]);
          } else {
            awayXIRef.current =
              newXI;

            setAwayXI([
              ...newXI,
            ]);

            const bench =
              getBench(
                squad,
                newXI
              );

            awayBenchRef.current =
              bench;

            setAwayBench([
              ...bench,
            ]);
          }
        }
      }
    }, [
      managerTeam,
      homeSquad,
      awaySquad,
    ]);

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

      if (!managerTeam) {
        return;
      }

      const aiTeam =
        managerTeam ===
        "home"
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
        xi.length !==
          PLAYERS_ON_PITCH ||
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
        !bestBench
      ) {
        return;
      }

      const improvement =
        overall(bestBench) -
        overall(weakest);

      if (
        improvement < 2
      ) {
        return;
      }

      const newXI =
        xi.map(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              playerId(weakest)
            )
              ? bestBench
              : player
        );

      const newBench =
        bench.filter(
          (player) =>
            String(
              playerId(player)
            ) !==
            String(
              playerId(bestBench)
            )
        );

      newBench.push(
        weakest
      );

      if (
        aiTeam === "home"
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
        aiTeam
      ] += 1;

      eventsRef.current = [
        {
          id: `sub-ai-${Date.now()}-${Math.random()}`,

          type:
            "substitution",

          team:
            aiTeam,

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
  // SIMULATE ONE PLAY (REALISTIC & HIGH-SCORING)
  // ==========================================================

  const simulatePlay = useCallback(() => {
    if (processingRef.current) return;
    if (
      homeXIRef.current.length !== PLAYERS_ON_PITCH ||
      awayXIRef.current.length !== PLAYERS_ON_PITCH
    ) return;

    processingRef.current = true;

    try {
      const homePower = calculateTeamPower(
        homeXIRef.current,
        tacticsRef.current.home,
        formationRef.current.home
      );

      const awayPower = calculateTeamPower(
        awayXIRef.current,
        tacticsRef.current.away,
        formationRef.current.away
      );

      // ====================================================
      // POSSESSION (team with ball)
      // ====================================================
      const homePossessionChance = clamp(
        0.5 + (homePower - awayPower) * 0.02,
        0.30,
        0.70
      );

      const team = Math.random() < homePossessionChance ? "home" : "away";
      const players = team === "home" ? homeXIRef.current : awayXIRef.current;
      const opponent = team === "home" ? awayXIRef.current : homeXIRef.current;

      const ownTactics = tacticsRef.current[team];
      const opponentTactics = tacticsRef.current[team === "home" ? "away" : "home"];

      const teamPower = team === "home" ? homePower : awayPower;
      const opponentPower = team === "home" ? awayPower : homePower;

      // ====================================================
      // ATTACK
      // ====================================================
      statsRef.current[team].attacks += 1;

      const dangerousChance = clamp(
        0.30 + (teamPower - opponentPower) * 0.01 + (ownTactics.mentality === "attacking" ? 0.10 : 0),
        0.15,
        0.70
      );

      const isDangerousAttack = Math.random() < dangerousChance;
      if (isDangerousAttack) {
        statsRef.current[team].dangerousAttacks += 1;
      }

      // ====================================================
      // POSSESSION STATS
      // ====================================================
      const possession = clamp(
        50 + (homePower - awayPower) * 1.2 + (Math.random() - 0.5) * 10,
        25,
        75
      );
      statsRef.current.home.possession = Number(possession.toFixed(1));
      statsRef.current.away.possession = Number((100 - possession).toFixed(1));

      // ====================================================
      // PLAYER SELECTION (rating irakoreshwa cyane)
      // ====================================================
      const attackingPlayers = players.filter((p) => {
        const pos = position(p);
        return pos === "ATT" || pos === "MID";
      });
      const pool = attackingPlayers.length ? attackingPlayers : players;

      // Hitamo umukinnyi ufite rating nini cyane (weighted)
      const totalWeight = pool.reduce((sum, p) => sum + overall(p), 0);
      let random = Math.random() * totalWeight;
      let actor = pool[0];
      for (const p of pool) {
        random -= overall(p);
        if (random <= 0) {
          actor = p;
          break;
        }
      }

      if (!actor) return;

      const actorOVR = overall(actor);
      const actorPosition = getVisualPosition(team, actor);

      // ====================================================
      // ACTION DECISION (Pass, Dribble, Shot, Lose ball)
      // ====================================================
      const actionRoll = Math.random() * 100;
      let action;

      if (actionRoll < 55) action = "pass";          // 55% pass
      else if (actionRoll < 80) action = "dribble";  // 25% dribble
      else if (actionRoll < 95) action = "shot";     // 15% shot
      else action = "lose_ball";                     // 5% lose/tackle

      // ====================================================
      // PASS
      // ====================================================
      if (action === "pass") {
        const passChance = clamp(
          0.72 + (actorOVR - 60) * 0.005 + (teamPower - opponentPower) * 0.003 +
          (ownTactics.tempo === "slow" ? 0.05 : ownTactics.tempo === "fast" ? -0.03 : 0),
          0.50,
          0.92
        );

        if (Math.random() < passChance) {
          const targets = players.filter((p) => playerId(p) !== playerId(actor));
          const target = targets[Math.floor(Math.random() * targets.length)];

          if (target) {
            statsRef.current[team].passes += 1;

            const completionChance = clamp(
              0.70 + (actorOVR - 60) * 0.006 + (teamPower - opponentPower) * 0.005,
              0.55,
              0.95
            );

            if (Math.random() < completionChance) {
              statsRef.current[team].passesCompleted += 1;
              const targetPosition = getVisualPosition(team, target);
              createBallAction(actorPosition, targetPosition, "pass");
              updatePlayerMovement(team, targetPosition.x, targetPosition.z);
              return;
            }

            // Interception
            statsRef.current[team].interceptions += 1;
            const defendingTeam = team === "home" ? "away" : "home";
            const defenders = opponent.filter((p) => {
              const pos = position(p);
              return pos === "DEF" || pos === "MID";
            });
            const interceptor = defenders[Math.floor(Math.random() * defenders.length)];
            if (interceptor) {
              const interceptionPosition = getVisualPosition(defendingTeam, interceptor);
              createBallAction(actorPosition, interceptionPosition, "interception");
              updatePlayerMovement(defendingTeam, interceptionPosition.x, interceptionPosition.z);
            }
            return;
          }
        } else {
          // Pass failure -> opponent tackle/interception
          statsRef.current[team].passes += 1;
          statsRef.current[team].interceptions += 1;
          const defendingTeam = team === "home" ? "away" : "home";
          const defenders = opponent.filter((p) => position(p) === "DEF" || position(p) === "MID");
          const interceptor = defenders.length ? defenders[Math.floor(Math.random() * defenders.length)] : null;
          if (interceptor) {
            const interceptionPosition = getVisualPosition(defendingTeam, interceptor);
            createBallAction(actorPosition, interceptionPosition, "interception");
            updatePlayerMovement(defendingTeam, interceptionPosition.x, interceptionPosition.z);
          }
          return;
        }
      }

      // ====================================================
      // DRIBBLE
      // ====================================================
      if (action === "dribble") {
        const dribbleChance = clamp(
          0.25 + (actorOVR - 60) * 0.006 + (ownTactics.mentality === "attacking" ? 0.06 : 0),
          0.15,
          0.55
        );

        if (Math.random() < dribbleChance) {
          statsRef.current[team].dribbles += 1;
          const newX = clamp(actorPosition.x + (team === "home" ? 3 : -3), -13, 13);
          const newZ = clamp(actorPosition.z + (Math.random() - 0.5) * 4, -8.5, 8.5);
          const dribblePosition = { x: newX, z: newZ };
          createBallAction(actorPosition, dribblePosition, "dribble");
          updatePlayerMovement(team, newX, newZ);
          return;
        }

        // Failed dribble -> tackle
        const defendingTeam = team === "home" ? "away" : "home";
        statsRef.current[defendingTeam].tackles += 1;
        if (Math.random() < 0.08) statsRef.current[team].fouls += 1;
        return;
      }

      // ====================================================
      // SHOT
      // ====================================================
      if (action === "shot") {
        let shotChance = 0.15 + (actorOVR - 60) * 0.005 + (teamPower - opponentPower) * 0.004;
        if (ownTactics.mentality === "attacking") shotChance += 0.06;
        if (ownTactics.mentality === "defensive") shotChance -= 0.03;
        if (isDangerousAttack) shotChance *= 1.5;

        shotChance = clamp(shotChance, 0.08, 0.50);

        if (Math.random() < shotChance) {
          statsRef.current[team].shots += 1;

          const goalX = team === "home" ? 14.7 : -14.7;
          const goalPosition = { x: goalX, z: (Math.random() - 0.5) * 5.5 };

          const onTargetChance = clamp(
            0.45 + (actorOVR - 60) * 0.008 + (teamPower - opponentPower) * 0.005,
            0.35,
            0.90
          );
          const onTarget = Math.random() < onTargetChance;

          createBallAction(actorPosition, goalPosition, onTarget ? "shot" : "miss");
          updatePlayerMovement(team, goalPosition.x, goalPosition.z);

          if (!onTarget) {
            if (Math.random() < 0.30) statsRef.current[team].corners += 1;
            return;
          }

          statsRef.current[team].shotsOnTarget += 1;

          // ================================================
          // GOAL PROBABILITY (yongerewe cyane)
          // ================================================
          const goalkeeper = opponent.find((p) => position(p) === "GK");
          const gkOverall = goalkeeper ? overall(goalkeeper) : 65;

          let goalProbability = 0.22;
          goalProbability += (teamPower - opponentPower) * 0.015;
          goalProbability += (actorOVR - 60) * 0.006;
          goalProbability -= (gkOverall - 60) * 0.003;

          if (ownTactics.mentality === "attacking") goalProbability += 0.05;
          if (ownTactics.mentality === "defensive") goalProbability -= 0.03;
          if (opponentTactics.mentality === "defensive") goalProbability -= 0.04;
          if (opponentTactics.defensiveLine === "high") goalProbability += 0.03;
          if (opponentTactics.defensiveLine === "deep") goalProbability -= 0.03;

          goalProbability = clamp(goalProbability, 0.08, 0.55);

          if (Math.random() < goalProbability) {
            scoreRef.current[team] += 1;

            const event = {
              id: `goal-${Date.now()}-${Math.random()}`,
              type: "goal",
              team,
              minute: minuteRef.current,
              playerName: playerName(actor),
              detail: `${playerName(actor)} scored!`,
            };
            eventsRef.current = [event, ...eventsRef.current];
            toast.success(`⚽ ${playerName(actor)} SCORED!`);
          } else {
            const defendingTeam = team === "home" ? "away" : "home";
            statsRef.current[defendingTeam].saves += 1;
            eventsRef.current = [
              {
                id: `save-${Date.now()}-${Math.random()}`,
                type: "save",
                team: defendingTeam,
                minute: minuteRef.current,
                detail: `${goalkeeper ? playerName(goalkeeper) : "Goalkeeper"} made a save.`,
              },
              ...eventsRef.current,
            ];
          }
          return;
        }
      }

      // ====================================================
      // LOSE BALL / TACKLE
      // ====================================================
      const defendingTeam = team === "home" ? "away" : "home";
      statsRef.current[defendingTeam].tackles += 1;
      if (Math.random() < 0.10) {
        statsRef.current[team].fouls += 1;
        if (Math.random() < 0.03) {
          statsRef.current[team].yellow += 1;
          eventsRef.current = [
            {
              id: `yellow-${Date.now()}-${Math.random()}`,
              type: "yellow_card",
              team: team,
              minute: minuteRef.current,
              detail: `${playerName(actor)} received a yellow card.`,
            },
            ...eventsRef.current,
          ];
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [createBallAction, getVisualPosition, updatePlayerMovement]);

  // ==========================================================
  // MATCH TIMER (REAL TIME, CONTINUOUS PLAY)
  // ==========================================================

  useEffect(() => {
    if (
      matchStatus !== "live" ||
      isPaused ||
      loading
    ) {
      return;
    }

    if (
      homeXIRef.current.length !==
        PLAYERS_ON_PITCH ||
      awayXIRef.current.length !==
        PLAYERS_ON_PITCH
    ) {
      console.warn(
        "MATCH TIMER WAITING FOR XI:",
        {
          home:
            homeXIRef.current
              .length,

          away:
            awayXIRef.current
              .length,
        }
      );

      return;
    }

    if (
      timerRef.current
    ) {
      clearInterval(
        timerRef.current
      );
    }

    timerRef.current =
      setInterval(() => {
        if (
          processingRef.current
        ) {
          return;
        }

        // Calculate current minute based on real elapsed time
        const elapsedSeconds =
          (Date.now() - startTimeRef.current) / 1000;
        const minutesPerSecond =
          90 / MATCH_REAL_DURATION_SECONDS; // 0.375

        const newMinute = Math.min(
          MATCH_MINUTE,
          Math.floor(elapsedSeconds * minutesPerSecond)
        );

        const previousMinute = minuteRef.current;
        minuteRef.current = newMinute;
        setMatchMinute(newMinute);

        // Continuous play: simulate every tick regardless of minute change
        simulatePlay();

        // AI updates only when minute changes
        if (newMinute !== previousMinute) {
          if (
            newMinute > 0 &&
            newMinute % 10 === 0
          ) {
            runAITactics();
          }

          if (
            newMinute >= 55 &&
            newMinute % 5 === 0
          ) {
            if (
              Math.random() <
              0.22
            ) {
              runAISubstitution();
            }
          }

          // Save every 5 minutes
          if (newMinute % 5 === 0) {
            saveMatchState("live");
          }
        }

        syncUI();

        // ====================================================
        // HALF TIME
        // ====================================================

        if (
          newMinute >= 45 &&
          statusRef.current !== "half-time"
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

          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          return;
        }

        // ====================================================
        // FULL TIME
        // ====================================================

        if (
          newMinute >= MATCH_MINUTE
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

          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          return;
        }
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
    useCallback(
      async () => {
        if (
          matchStatus !==
            "ready" &&
          matchStatus !==
            "half-time"
        ) {
          return;
        }

        if (
          homeXIRef.current
            .length !==
            PLAYERS_ON_PITCH ||
          awayXIRef.current
            .length !==
            PLAYERS_ON_PITCH
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

        // Reset startTimeRef for real-time progression
        startTimeRef.current = Date.now();

        await saveMatchState(
          "live"
        );

        toast.success(
          matchStatus ===
            "half-time"
            ? "Second half started!"
            : "Match started!"
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
    useCallback(() => {
      if (
        matchStatus !==
        "live"
      ) {
        return;
      }

      setIsPaused(
        (previous) =>
          !previous
      );
    }, [
      matchStatus,
    ]);

  // ==========================================================
  // CHANGE FORMATION
  // ==========================================================

  const changeFormation =
    useCallback(
      (formation) => {
        if (
          !isManager ||
          !managerTeam ||
          !FORMATIONS[
            formation
          ]
        ) {
          return;
        }

        const normalized =
          normalizeFormation(
            formation
          );

        const squad =
          managerTeam ===
          "home"
            ? homeSquad
            : awaySquad;

        const currentXI =
          managerTeam ===
          "home"
            ? homeXIRef.current
            : awayXIRef.current;

        const newXI =
          getFormationPlayers(
            squad,
            normalized
          );

        if (
          newXI.length !==
          PLAYERS_ON_PITCH
        ) {
          toast.error(
            "Your team needs at least 11 players."
          );

          return;
        }

        formationRef.current[
          managerTeam
        ] = normalized;

        if (
          managerTeam ===
          "home"
        ) {
          setHomeFormation(
            normalized
          );

          homeXIRef.current =
            currentXI.length ===
            PLAYERS_ON_PITCH
              ? currentXI
              : newXI;

          setHomeXI([
            ...homeXIRef.current,
          ]);

          const bench =
            getBench(
              squad,
              homeXIRef.current
            );

          homeBenchRef.current =
            bench;

          setHomeBench([
            ...bench,
          ]);
        } else {
          setAwayFormation(
            normalized
          );

          awayXIRef.current =
            currentXI.length ===
            PLAYERS_ON_PITCH
              ? currentXI
              : newXI;

          setAwayXI([
            ...awayXIRef.current,
          ]);

          const bench =
            getBench(
              squad,
              awayXIRef.current
            );

          awayBenchRef.current =
            bench;

          setAwayBench([
            ...bench,
          ]);
        }

        saveMatchState();

        toast.success(
          `Formation changed to ${normalized}`
        );
      },
      [
        isManager,
        managerTeam,
        homeSquad,
        awaySquad,
        saveMatchState,
      ]
    );

  // ==========================================================
  // CHANGE TACTIC
  // ==========================================================

  const changeTactic =
    useCallback(
      (
        field,
        value
      ) => {
        if (
          !isManager ||
          !managerTeam
        ) {
          return;
        }

        tacticsRef.current[
          managerTeam
        ] = {
          ...tacticsRef.current[
            managerTeam
          ],

          [field]:
            value,
        };

        if (
          managerTeam ===
          "home"
        ) {
          setHomeTactics({
            ...tacticsRef.current
              .home,
          });
        } else {
          setAwayTactics({
            ...tacticsRef.current
              .away,
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
  // SAVE LINEUP
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
        PLAYERS_ON_PITCH
      ) {
        toast.error(
          "Select exactly 11 players."
        );

        return;
      }

      const squad =
        managerTeam ===
        "home"
          ? homeSquad
          : awaySquad;

      const lineup =
        selectedLineup
          .map(
            (idValue) =>
              squad.find(
                (player) =>
                  String(
                    playerId(
                      player
                    )
                  ) ===
                  String(
                    idValue
                  )
              )
          )
          .filter(Boolean);

      if (
        lineup.length !==
        PLAYERS_ON_PITCH
      ) {
        toast.error(
          "Some selected players are no longer available."
        );

        return;
      }

      if (
        managerTeam ===
        "home"
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

      syncUI();

      saveMatchState();

      toast.success(
        "Lineup saved successfully."
      );
    }, [
      isManager,
      managerTeam,
      selectedLineup,
      homeSquad,
      awaySquad,
      syncUI,
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
        managerTeam ===
        "home"
          ? homeSquad
          : awaySquad;

      const formation =
        managerTeam ===
        "home"
          ? homeFormation
          : awayFormation;

      const lineup =
        getFormationPlayers(
          squad,
          formation
        );

      if (
        lineup.length !==
        PLAYERS_ON_PITCH
      ) {
        toast.error(
          "Not enough players."
        );

        return;
      }

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
  // OPEN LINEUP
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
        managerTeam ===
        "home"
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
  // USER SUBSTITUTION
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
        matchStatus ===
        "finished"
      ) {
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
        managerTeam ===
        "home"
          ? homeXIRef.current
          : awayXIRef.current;

      const bench =
        managerTeam ===
        "home"
          ? homeBenchRef.current
          : awayBenchRef.current;

      const outgoing =
        xi.find(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              selectedSubOut
            )
        );

      const incoming =
        bench.find(
          (player) =>
            String(
              playerId(player)
            ) ===
            String(
              selectedSubIn
            )
        );

      if (
        !outgoing ||
        !incoming
      ) {
        toast.error(
          "Invalid substitution."
        );

        return;
      }

      const newXI =
        xi.map(
          (player) =>
            String(
              playerId(player)
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
              playerId(player)
            ) !==
            String(
              selectedSubIn
            )
        );

      newBench.push(
        outgoing
      );

      if (
        managerTeam ===
        "home"
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

      eventsRef.current =
        [
          {
            id: `sub-${Date.now()}-${Math.random()}`,

            type:
              "substitution",

            team:
              managerTeam,

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

      setSelectedSubOut(
        ""
      );

      setSelectedSubIn(
        ""
      );

      syncUI();

      saveMatchState();

      toast.success(
        "Substitution completed."
      );
    }, [
      isManager,
      managerTeam,
      matchStatus,
      selectedSubOut,
      selectedSubIn,
      syncUI,
      saveMatchState,
    ]);

  // ==========================================================
  // DISPLAY
  // ==========================================================

  const statusLabel =
    matchStatus ===
    "ready"
      ? "READY"
      : matchStatus ===
        "live"
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
  // LOADING
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

  // ==========================================================
  // ERROR
  // ==========================================================

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

  // ==========================================================
  // MATCH NOT FOUND
  // ==========================================================

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

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} |
          Match Centre
        </title>

        <meta
          name="theme-color"
          content="#050816"
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* ====================================================
            HEADER
        ==================================================== */}

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

        {/* ====================================================
            SCOREBOARD
        ==================================================== */}

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

              <span>
                -
              </span>

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

        {/* ====================================================
            PITCH
        ==================================================== */}

        <section
          className={
            styles.pitchCard
          }
        >
          {homeXI.length ===
            PLAYERS_ON_PITCH &&
          awayXI.length ===
            PLAYERS_ON_PITCH ? (
            <ThreePitch
              homeXI={
                homeXI
              }
              awayXI={
                awayXI
              }
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
          ) : (
            <div
              className={
                styles.pitchLoading
              }
            >
              <div
                className={
                  styles.spinner
                }
              />

              <span>
                Preparing starting
                players...
              </span>
            </div>
          )}

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
                    homeClub.color ||
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
                    awayClub.color ||
                    "#ef4444",
                }}
              />

              {awayClub.name}
            </span>
          </div>
        </section>

        {/* ====================================================
            MANAGER PANEL
        ==================================================== */}

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
                  onChange={(event) =>
                    changeFormation(
                      event.target
                        .value
                    )
                  }
                >
                  {Object.keys(
                    FORMATIONS
                  ).map(
                    (
                      formation
                    ) => (
                      <option
                        key={
                          formation
                        }
                        value={
                          formation
                        }
                      >
                        {
                          formation
                        }
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
                  onChange={(event) =>
                    changeTactic(
                      "mentality",
                      event.target
                        .value
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
                  onChange={(event) =>
                    changeTactic(
                      "tempo",
                      event.target
                        .value
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
                  onChange={(event) =>
                    changeTactic(
                      "pressing",
                      event.target
                        .value
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
                  onChange={(event) =>
                    changeTactic(
                      "defensiveLine",
                      event.target
                        .value
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
                  onChange={(event) =>
                    changeTactic(
                      "width",
                      event.target
                        .value
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

        {/* ====================================================
            CONTROLS
        ==================================================== */}

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
                isSaving ||
                homeXI.length !==
                  11 ||
                awayXI.length !==
                  11
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

        {/* ====================================================
            SUBSTITUTIONS
        ==================================================== */}

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
                  /
                  {
                    MAX_SUBSTITUTIONS
                  }
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
                    onChange={(
                      event
                    ) =>
                      setSelectedSubOut(
                        event.target
                          .value
                      )
                    }
                  >
                    <option value="">
                      Select player
                    </option>

                    {activeXI.map(
                      (
                        player
                      ) => (
                        <option
                          key={String(
                            playerId(
                              player
                            )
                          )}
                          value={String(
                            playerId(
                              player
                            )
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
                    onChange={(
                      event
                    ) =>
                      setSelectedSubIn(
                        event.target
                          .value
                      )
                    }
                  >
                    <option value="">
                      Select substitute
                    </option>

                    {activeBench.map(
                      (
                        player
                      ) => (
                        <option
                          key={String(
                            playerId(
                              player
                            )
                          )}
                          value={String(
                            playerId(
                              player
                            )
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
                  🔄 Make
                  Substitution
                </button>
              </div>
            </section>
          )}

        {/* ====================================================
            STATS
        ==================================================== */}

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

        {/* ====================================================
            EVENTS
        ==================================================== */}

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
                  (
                    event
                  ) => (
                    <div
                      className={
                        styles.event
                      }
                      key={
                        event.id
                      }
                    >
                      <b>
                        {
                          event.minute
                        }
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
                            "yellow_card"
                          ? "🟨"
                          : event.type ===
                            "red_card"
                          ? "🟥"
                          : "•"}
                      </span>

                      <div>
                        <strong>
                          {String(
                            event.type
                          ).toUpperCase()}
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

        {/* ====================================================
            LINEUPS
        ==================================================== */}

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
                  {
                    homeClub.name
                  }
                </h3>
              </div>

              <b>
                {
                  homeFormation
                }
              </b>
            </div>

            {homeXI.map(
              (
                player,
                index
              ) => (
                <div
                  key={String(
                    playerId(
                      player
                    )
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
                  {
                    awayClub.name
                  }
                </h3>
              </div>

              <b>
                {
                  awayFormation
                }
              </b>
            </div>

            {awayXI.map(
              (
                player,
                index
              ) => (
                <div
                  key={String(
                    playerId(
                      player
                    )
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

        {/* ====================================================
            LINEUP MODAL
        ==================================================== */}

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
                      Select Starting
                      XI
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
                    (
                      player
                    ) => {
                      const idValue =
                        String(
                          playerId(
                            player
                          )
                        );

                      const selected =
                        selectedLineup.some(
                          (
                            value
                          ) =>
                            String(
                              value
                            ) ===
                            idValue
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
                                (
                                  previous
                                ) =>
                                  previous.filter(
                                    (
                                      value
                                    ) =>
                                      String(
                                        value
                                      ) !==
                                      idValue
                                  )
                              );

                              return;
                            }

                            if (
                              selectedLineup.length <
                              PLAYERS_ON_PITCH
                            ) {
                              setSelectedLineup(
                                (
                                  previous
                                ) => [
                                  ...previous,
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
                      PLAYERS_ON_PITCH
                    }
                    onClick={
                      saveUserLineup
                    }
                  >
                    Save Starting
                    XI
                  </button>
                </div>
              </div>
            </div>
          )}
      </main>
    </>
  );
}
