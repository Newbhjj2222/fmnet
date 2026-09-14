import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Head from "next/head";
import { useRouter } from "next/router";

import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";
import MatchEngine from "../../lib/match-engine/python-engine";

import styles from "./Mach.module.css";


/* =========================================================
   BASIC HELPERS
========================================================= */

function firstValue(object, keys, fallback = null) {
  if (!object) return fallback;

  for (const key of keys) {
    const value = object[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}


function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}


function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}


function normalizeId(value) {
  if (value === undefined || value === null) return "";

  if (typeof value === "object") {
    return String(
      value.id ||
      value.clubId ||
      value.teamId ||
      value.value ||
      ""
    );
  }

  return String(value);
}


function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


/* =========================================================
   USER HELPERS (from useAuth)
========================================================= */

function getUsernameFromUser(user) {
  return safeString(
    user?.username ||
    user?.userName ||
    user?.displayName ||
    user?.name ||
    user?.email
  ).toLowerCase();
}


function getUserIdFromUser(user) {
  return safeString(
    user?.uid ||
    user?.id ||
    user?.userId ||
    user?._id
  );
}


/* =========================================================
   PLAYER HELPERS
========================================================= */

function playerBelongsToClub(player, clubId) {
  const wanted = normalizeId(clubId);
  if (!wanted) return false;

  const values = [
    player.clubId,
    player.currentClub,
    player.currentClubId,
    player.teamId,
    player.team,
    player.club,
    player.clubID,
  ]
    .filter(value => value !== undefined && value !== null)
    .map(value => normalizeId(value))
    .filter(Boolean);

  return values.includes(wanted);
}


function normalizePlayer(player = {}, index = 0) {
  const ratings = player.ratings || player.stats || {};

  return {
    id: String(
      player.id ||
      player.playerId ||
      player.uid ||
      `player-${index + 1}`
    ),

    name:
      player.name ||
      player.displayName ||
      player.fullName ||
      player.playerName ||
      `Player ${index + 1}`,

    number: safeNumber(
      player.number ?? player.shirtNumber ?? player.jerseyNumber,
      index + 1
    ),

    position:
      player.position ||
      player.preferredPosition ||
      player.role ||
      "CM",

    role: player.role || player.position || "CM",

    pace: safeNumber(player.pace ?? ratings.pace ?? ratings.speed, 70),
    passing: safeNumber(player.passing ?? ratings.passing ?? ratings.pass, 70),
    shooting: safeNumber(player.shooting ?? ratings.shooting ?? ratings.shoot, 65),
    dribbling: safeNumber(player.dribbling ?? ratings.dribbling ?? ratings.dribble, 68),
    defending: safeNumber(
      player.defending ?? ratings.defending ?? ratings.defence ?? ratings.defense,
      65
    ),
    stamina: safeNumber(player.stamina ?? ratings.stamina, 80),
    strength: safeNumber(player.strength ?? ratings.strength ?? ratings.physical, 70),
    vision: safeNumber(player.vision ?? ratings.vision, 70),
    goalkeeping: safeNumber(player.goalkeeping ?? ratings.goalkeeping ?? ratings.gk, 60),
    composure: safeNumber(player.composure ?? ratings.composure, 65),
    positioning: safeNumber(player.positioning ?? ratings.positioning, 65),
    acceleration: safeNumber(player.acceleration ?? ratings.acceleration, 68),
    aggression: safeNumber(player.aggression ?? ratings.aggression, 60),
    balance: safeNumber(player.balance ?? ratings.balance, 65),
  };
}


/* =========================================================
   CLUB HELPERS
========================================================= */

function normalizeClub(club, fallbackId) {
  return {
    id: String(club?.id || club?.clubId || fallbackId),

    name:
      club?.name ||
      club?.clubName ||
      club?.title ||
      "Unknown Club",

    logo:
      club?.logo ||
      club?.logoUrl ||
      club?.image ||
      club?.imageUrl ||
      "",

    formation: club?.formation || "4-3-3",
    tactics: club?.tactics || {},
    players: Array.isArray(club?.players) ? club.players : [],
    bench: Array.isArray(club?.bench) ? club.bench : [],
  };
}


function getClubId(match, side) {
  if (side === "home") {
    return firstValue(match, [
      "homeClubId",
      "homeTeamId",
      "homeId",
      "homeClub",
      "homeTeam",
    ]);
  }

  return firstValue(match, [
    "awayClubId",
    "awayTeamId",
    "awayId",
    "awayClub",
    "awayTeam",
  ]);
}


/* =========================================================
   MANAGED TEAM RESOLUTION
========================================================= */

function getManagedClubIdFromMatch(match) {
  return normalizeId(
    firstValue(match, [
      "managerClubId",
      "managedClubId",
      "userClubId",
      "userTeamId",
      "managerTeamId",
      "controlledClubId",
      "controlledTeamId",
      "currentClubId",
      "playerClubId",
      "myClubId",
      "userManagedClubId",
      "managerManagedClubId",
    ])
  );
}


function getManagedSideFromMatch(match) {
  const explicitSide = safeString(
    firstValue(match, [
      "userSide",
      "managerSide",
      "controlledSide",
      "mySide",
      "playerSide",
    ])
  ).toLowerCase();

  if (explicitSide === "home" || explicitSide === "away") {
    return explicitSide;
  }

  return null;
}


/*
 * Shaka muri "clubs" collection ukoresheje userId cyangwa
 * username y'uwo user winjiye (uva muri useAuth).
 */
function findManagedClubInDatabase(clubs, username, userId) {
  const wantedUsername = safeString(username).toLowerCase();
  const wantedUserId = safeString(userId);

  if (!wantedUsername && !wantedUserId) {
    return null;
  }

  for (const club of clubs) {
    const data = club.data || club;

    // ---- Reba userId ----
    const possibleIds = [
      data.managerId,
      data.managerUid,
      data.managerUserId,
      data.ownerId,
      data.ownerUid,
      data.userId,
      data.uid,
      data.createdBy,
      data.manager?.uid,
      data.manager?.id,
      data.manager?.userId,
      data.owner?.uid,
      data.owner?.id,
    ]
      .map(value => safeString(value))
      .filter(Boolean);

    if (wantedUserId && possibleIds.includes(wantedUserId)) {
      return normalizeId(data.id || data.clubId || club.id);
    }

    // ---- Reba username ----
    const possibleUsernames = [
      data.username,
      data.userName,
      data.managerUsername,
      data.managerUser,
      data.managerName,
      data.ownerUsername,
      data.owner,
      data.coachUsername,
      data.coach,
      data.user,
      data.createdBy,
      data.manager?.username,
      data.manager?.userName,
      data.manager?.name,
      data.owner?.username,
    ]
      .map(value => safeString(value).toLowerCase())
      .filter(Boolean);

    if (wantedUsername && possibleUsernames.includes(wantedUsername)) {
      return normalizeId(data.id || data.clubId || club.id);
    }
  }

  return null;
}


/*
 * Shaka mu home/away objects bya match ubwayo.
 */
function findManagedSideInMatchTeams(match, username, userId) {
  const wantedUsername = safeString(username).toLowerCase();
  const wantedUserId = safeString(userId);

  for (const side of ["home", "away"]) {
    const team = match?.[side];
    if (!team) continue;

    const teamIds = [
      team.managerId,
      team.managerUid,
      team.managerUserId,
      team.userId,
      team.uid,
      team.ownerId,
      team.manager?.uid,
      team.manager?.id,
    ]
      .map(value => safeString(value))
      .filter(Boolean);

    if (wantedUserId && teamIds.includes(wantedUserId)) {
      return side;
    }

    const teamUsernames = [
      team.username,
      team.userName,
      team.managerUsername,
      team.managerUser,
      team.ownerUsername,
      team.coachUsername,
      team.manager?.username,
      team.manager?.userName,
    ]
      .map(value => safeString(value).toLowerCase())
      .filter(Boolean);

    if (wantedUsername && teamUsernames.includes(wantedUsername)) {
      return side;
    }
  }

  return null;
}


/* =========================================================
   EMBEDDED PLAYERS
========================================================= */

function extractEmbeddedPlayers(club, side) {
  const possible = [
    club?.players,
    club?.squad,
    club?.lineup,
    club?.[`players${side}`],
  ];

  for (const list of possible) {
    if (Array.isArray(list)) return list;
  }

  return [];
}


/* =========================================================
   BENCH
========================================================= */

function buildBench(
  explicitBench,
  clubBench,
  allPlayers,
  clubId,
  startingPlayers
) {
  let source = [];

  if (Array.isArray(explicitBench) && explicitBench.length) {
    source = explicitBench;
  } else if (Array.isArray(clubBench) && clubBench.length) {
    source = clubBench;
  } else {
    const startingIds = new Set(
      startingPlayers.map(player => String(player.id))
    );

    source = allPlayers.filter(
      player =>
        playerBelongsToClub(player, clubId) &&
        !startingIds.has(String(player.id || player.playerId || player.uid))
    );
  }

  const unique = [];
  const ids = new Set();

  source.forEach((player, index) => {
    const normalized = normalizePlayer(player, index);
    if (ids.has(normalized.id)) return;
    ids.add(normalized.id);
    unique.push(normalized);
  });

  const startingIds = new Set(
    startingPlayers.map(player => String(player.id))
  );

  return unique
    .filter(player => !startingIds.has(String(player.id)))
    .slice(0, 9);
}


/* =========================================================
   CLOCK
========================================================= */

function formatClock(minute, second) {
  const safeMinute = Math.max(0, Math.floor(safeNumber(minute, 0)));
  const safeSecond = Math.max(0, Math.floor(safeNumber(second, 0)));

  return `${String(safeMinute).padStart(2, "0")}:${String(safeSecond).padStart(2, "0")}`;
}


/* =========================================================
   STATS HELPERS
========================================================= */

function getStat(source, keys, fallback = 0) {
  if (!source) return fallback;

  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      return safeNumber(value, fallback);
    }
  }

  return fallback;
}


function hasStat(source, keys) {
  if (!source) return false;
  return keys.some(
    key => source[key] !== undefined && source[key] !== null
  );
}


function normalizeEventType(event) {
  return safeString(
    event?.type ||
    event?.eventType ||
    event?.action ||
    event?.name
  )
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}


function normalizeSide(value) {
  const side = safeString(value).toLowerCase();

  if (["home", "h", "home_team", "hometeam"].includes(side)) {
    return "home";
  }
  if (["away", "a", "away_team", "awayteam"].includes(side)) {
    return "away";
  }
  return null;
}


/* =========================================================
   POSSESSION — ISHINGIYE KURI PASSES
========================================================= */

function calculatePossessionFromPasses(homePasses, awayPasses) {
  const h = safeNumber(homePasses, 0);
  const a = safeNumber(awayPasses, 0);
  const total = h + a;

  if (total <= 0) {
    return { home: 50, away: 50 };
  }

  const homePercent = Math.round((h / total) * 100);
  const safeHome = Math.max(0, Math.min(100, homePercent));

  return {
    home: safeHome,
    away: 100 - safeHome,
  };
}


/* =========================================================
   LIVE STATS
========================================================= */

function calculateLiveStats(snapshot, side) {
  const original = snapshot?.stats?.[side] || {};
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];

  const sideEvents = events.filter(event => {
    const eventSide = normalizeSide(
      event?.side || event?.team || event?.teamSide
    );
    return eventSide === side;
  });

  const shotKeys = ["shots", "shot"];
  const targetKeys = ["shotsOnTarget", "shots_on_target", "onTarget"];
  const passKeys = ["passes", "pass", "totalPasses"];
  const tackleKeys = ["tackles", "tackle"];
  const interceptionKeys = ["interceptions", "interception"];
  const cornerKeys = ["corners", "corner"];
  const saveKeys = ["saves", "save"];
  const foulKeys = ["fouls", "foul"];

  let shots = getStat(original, shotKeys, 0);
  let shotsOnTarget = getStat(original, targetKeys, 0);
  let passes = getStat(original, passKeys, 0);
  let tackles = getStat(original, tackleKeys, 0);
  let interceptions = getStat(original, interceptionKeys, 0);
  let corners = getStat(original, cornerKeys, 0);
  let saves = getStat(original, saveKeys, 0);
  let fouls = getStat(original, foulKeys, 0);

  const calculateShots = !hasStat(original, shotKeys);
  const calculateTargets = !hasStat(original, targetKeys);
  const calculatePasses = !hasStat(original, passKeys);
  const calculateTackles = !hasStat(original, tackleKeys);
  const calculateInterceptions = !hasStat(original, interceptionKeys);
  const calculateCorners = !hasStat(original, cornerKeys);
  const calculateSaves = !hasStat(original, saveKeys);
  const calculateFouls = !hasStat(original, foulKeys);

  sideEvents.forEach(event => {
    const type = normalizeEventType(event);

    if (calculateShots && type.includes("shot")) {
      shots += 1;
    }

    if (
      calculateTargets &&
      (type.includes("saved") ||
        type.includes("goal") ||
        type.includes("on_target") ||
        type.includes("target"))
    ) {
      shotsOnTarget += 1;
    }

    if (
      calculatePasses &&
      (type === "pass" ||
        type.includes("pass_completed") ||
        type.includes("successful_pass"))
    ) {
      passes += 1;
    }

    if (calculateTackles && type.includes("tackle")) {
      tackles += 1;
    }

    if (calculateInterceptions && type.includes("interception")) {
      interceptions += 1;
    }

    if (calculateCorners && type.includes("corner")) {
      corners += 1;
    }

    if (calculateSaves && type.includes("save")) {
      saves += 1;
    }

    if (calculateFouls && type.includes("foul")) {
      fouls += 1;
    }
  });

  return {
    ...original,
    shots,
    shotsOnTarget,
    passes,
    corners,
    tackles,
    interceptions,
    saves,
    fouls,
  };
}


/* =========================================================
   FIRESTORE FINAL RESULT
========================================================= */

async function saveFinalResult(matchId, snapshot) {
  if (!matchId || !snapshot) {
    throw new Error("Final match result is missing.");
  }

  const score = snapshot.score || {};
  const home = snapshot.home || {};
  const away = snapshot.away || {};

  const homeScore = safeNumber(score.home, 0);
  const awayScore = safeNumber(score.away, 0);

  const homeStatsRaw = calculateLiveStats(snapshot, "home");
  const awayStatsRaw = calculateLiveStats(snapshot, "away");

  const possession = calculatePossessionFromPasses(
    homeStatsRaw.passes,
    awayStatsRaw.passes
  );

  const finalStats = {
    home: { ...homeStatsRaw, possession: possession.home },
    away: { ...awayStatsRaw, possession: possession.away },
  };

  let winner = "draw";
  if (homeScore > awayScore) winner = "home";
  else if (awayScore > homeScore) winner = "away";

  const events = Array.isArray(snapshot.events) ? snapshot.events : [];

  const finalResult = {
    status: "finished",
    minute: safeNumber(snapshot.minute, 90),
    second: safeNumber(snapshot.second, 0),
    score: { home: homeScore, away: awayScore },
    homeScore,
    awayScore,
    winner,
    homeTeam: {
      id: safeString(home.id),
      name: safeString(home.name, "Home"),
      logo: home.logo || "",
    },
    awayTeam: {
      id: safeString(away.id),
      name: safeString(away.name, "Away"),
      logo: away.logo || "",
    },
    stats: finalStats,
    events,
    lastEvent: snapshot.lastEvent || null,
    result:
      snapshot.result || { home: homeScore, away: awayScore, winner },
    resultSaved: true,
  };

  const matchRef = doc(db, "matches", String(matchId));

  await setDoc(
    matchRef,
    {
      status: "finished",
      finalResult,
      score: finalResult.score,
      homeScore,
      awayScore,
      stats: finalStats,
      finalStats,
      events,
      finalEvents: events,
      result: finalResult.result,
      winner,
      resultSaved: true,
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const serverSnap = await getDocFromServer(matchRef);

  if (!serverSnap.exists()) {
    throw new Error("Firestore server ntiyemeje ko match yabitswe.");
  }

  const serverData = serverSnap.data();

  if (
    serverData.status !== "finished" ||
    serverData.resultSaved !== true
  ) {
    throw new Error("Firestore server ntiyagaruye final result neza.");
  }

  return true;
}


/* =========================================================
   MAIN PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();
  const { id } = router.query;

  /* =======================================================
     AUTH CONTEXT
  ======================================================= */

  const {
    user,
    loading: authLoading,
  } = useAuth();

  /* =======================================================
     REFS
  ======================================================= */

  const engineRef = useRef(null);
  const updateTimerRef = useRef(null);
  const resultSavingRef = useRef(false);
  const redirectingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const matchConfigRef = useRef(null);

  /*
   * managedSideRef: "home" | "away" | null
   * null bivuze ko user atari manager wa match iyi.
   */
  const managedSideRef = useRef(null);

  /* =======================================================
     STATE
  ======================================================= */

  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [savingTactics, setSavingTactics] = useState(false);
  const [substituting, setSubstituting] = useState(false);
  const [savingLineup, setSavingLineup] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [error, setError] = useState("");
  const [matchDoc, setMatchDoc] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeTab, setActiveTab] = useState("events");

  const [managedSide, setManagedSide] = useState(null);
  const [managedTeamName, setManagedTeamName] = useState("Your Team");

  const [tactics, setTactics] = useState({
    mentality: "balanced",
    tempo: 60,
    pressing: "medium",
    defensiveLine: "medium",
    width: 55,
  });

  const [formation, setFormation] = useState("4-3-3");
  const [outgoingPlayer, setOutgoingPlayer] = useState("");
  const [incomingPlayer, setIncomingPlayer] = useState("");
  const [managedStartingXI, setManagedStartingXI] = useState([]);
  const [managedBench, setManagedBench] = useState([]);
  const [homeBenchPlayers, setHomeBenchPlayers] = useState([]);
  const [awayBenchPlayers, setAwayBenchPlayers] = useState([]);

  /* =======================================================
     FINAL SAVE
  ======================================================= */

  const finishAndSave = useCallback(
    async finalSnapshot => {
      if (
        !finalSnapshot ||
        !id ||
        resultSavingRef.current ||
        redirectingRef.current
      ) {
        return;
      }

      resultSavingRef.current = true;
      setSavingResult(true);
      setError("");

      let lastError = null;

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          if (
            typeof navigator !== "undefined" &&
            navigator.onLine === false
          ) {
            throw new Error("Internet connection is offline.");
          }

          await saveFinalResult(String(id), finalSnapshot);

          redirectingRef.current = true;
          setSavingResult(false);

          await router.replace("/fixtures");
          return;
        } catch (err) {
          lastError = err;
          console.error(
            `Final result save attempt ${attempt} failed:`,
            err
          );

          if (attempt < 5) {
            await sleep(attempt * 1200);
          }
        }
      }

      resultSavingRef.current = false;
      setSavingResult(false);

      setError(
        lastError?.message ||
          "Final result ntibashije kubikwa muri database."
      );
    },
    [id, router]
  );

  /* =======================================================
     ENGINE SUBSCRIPTION
  ======================================================= */

  const attachEngine = useCallback(
    engine => {
      if (!engine) return;

      engine.subscribe(nextSnapshot => {
        if (!nextSnapshot) return;

        setSnapshot(nextSnapshot);

        setEvents(
          Array.isArray(nextSnapshot.events)
            ? nextSnapshot.events
            : []
        );

        if (
          Array.isArray(nextSnapshot.home?.bench) &&
          nextSnapshot.home.bench.length
        ) {
          setHomeBenchPlayers(
            nextSnapshot.home.bench.map(normalizePlayer)
          );
        }

        if (
          Array.isArray(nextSnapshot.away?.bench) &&
          nextSnapshot.away.bench.length
        ) {
          setAwayBenchPlayers(
            nextSnapshot.away.bench.map(normalizePlayer)
          );
        }

        const side = managedSideRef.current;

        if (side === "home" && nextSnapshot.home?.formation) {
          setFormation(nextSnapshot.home.formation);
        }

        if (side === "away" && nextSnapshot.away?.formation) {
          setFormation(nextSnapshot.away.formation);
        }

        const controlledTeam =
          side === "away" ? nextSnapshot.away : nextSnapshot.home;

        if (controlledTeam?.tactics) {
          setTactics(previous => ({
            ...previous,
            ...controlledTeam.tactics,
          }));
        }

        if (nextSnapshot.status === "finished") {
          setStarting(false);
          finishAndSave(nextSnapshot);
        }
      });
    },
    [finishAndSave]
  );

  /* =======================================================
     REBUILD ENGINE
  ======================================================= */

  const rebuildEngine = useCallback(
    async (homePlayers, awayPlayers, homeBench, awayBench) => {
      if (!matchConfigRef.current) return null;

      const previous = engineRef.current;
      if (previous) {
        previous.destroy();
        engineRef.current = null;
      }

      const config = matchConfigRef.current;

      const engineConfig = {
        ...config,
        home: { ...config.home, players: homePlayers, bench: homeBench },
        away: { ...config.away, players: awayPlayers, bench: awayBench },
      };

      const engine = new MatchEngine(engineConfig);
      engineRef.current = engine;

      attachEngine(engine);

      await engine.ready;

      const initial = engine.getState();
      if (initial) {
        setSnapshot(initial);
        setEvents(initial.events || []);
      }

      return engine;
    },
    [attachEngine]
  );

  /* =======================================================
     LOAD MATCH
     (urutonde: rindira authLoading na router.isReady)
  ======================================================= */

  useEffect(() => {
    if (authLoading) return;
    if (!router.isReady || !id) return;

    let cancelled = false;

    async function loadMatch() {
      try {
        setLoading(true);
        setError("");

        resultSavingRef.current = false;
        redirectingRef.current = false;
        finishRequestedRef.current = false;

        const matchRef = doc(db, "matches", String(id));
        const matchSnap = await getDoc(matchRef);

        if (!matchSnap.exists()) {
          throw new Error("Match ntiboneka muri database.");
        }

        const match = matchSnap.data();
        if (cancelled) return;

        setMatchDoc({ id: matchSnap.id, ...match });

        const homeClubId = normalizeId(getClubId(match, "home"));
        const awayClubId = normalizeId(getClubId(match, "away"));

        if (!homeClubId || !awayClubId) {
          throw new Error(
            "Match ibura homeClubId cyangwa awayClubId."
          );
        }

        /* ---------------------------------------------
           USER (uva muri useAuth)
        --------------------------------------------- */
        const username = getUsernameFromUser(user);
        const userId = getUserIdFromUser(user);

        console.log("AUTH USER:", { userId, username });

        /* ---------------------------------------------
           FETCH FIREBASE DATA
        --------------------------------------------- */
        const [homeClubSnap, awayClubSnap, playersSnap, clubsSnap] =
          await Promise.all([
            getDoc(doc(db, "clubs", homeClubId)),
            getDoc(doc(db, "clubs", awayClubId)),
            getDocs(collection(db, "players")),
            getDocs(collection(db, "clubs")),
          ]);

        if (cancelled) return;

        const homeClub = normalizeClub(
          homeClubSnap.exists()
            ? { id: homeClubId, ...homeClubSnap.data() }
            : {},
          homeClubId
        );

        const awayClub = normalizeClub(
          awayClubSnap.exists()
            ? { id: awayClubId, ...awayClubSnap.data() }
            : {},
          awayClubId
        );

        const allPlayers = playersSnap.docs.map(playerDoc => ({
          id: playerDoc.id,
          ...playerDoc.data(),
        }));

        const allClubs = clubsSnap.docs.map(clubDoc => ({
          id: clubDoc.id,
          data: clubDoc.data(),
        }));

        /* =================================================
           MANAGER DETECTION
           -------------------------------------------------
           1. Reba match.managerClubId / managedClubId
           2. Reba match.userSide / managerSide
           3. Shakisha muri clubs ukoresheje userId
           4. Shakisha muri clubs ukoresheje username
           5. Reba match.home / match.away objects
        ================================================= */

        let resolvedManagedClubId = getManagedClubIdFromMatch(match);
        let resolvedManagedSide = getManagedSideFromMatch(match);

        // Niba side itaramenye, shakisha club ID muri DB
        if (!resolvedManagedClubId && (userId || username)) {
          resolvedManagedClubId = findManagedClubInDatabase(
            allClubs,
            username,
            userId
          );
        }

        // Niba club ID yabonetse, iyihuze na home/away
        if (resolvedManagedClubId) {
          if (resolvedManagedClubId === homeClubId) {
            resolvedManagedSide = "home";
          } else if (resolvedManagedClubId === awayClubId) {
            resolvedManagedSide = "away";
          }
        }

        // Niba side itaramenye, reba match.home / match.away
        if (!resolvedManagedSide) {
          resolvedManagedSide = findManagedSideInMatchTeams(
            match,
            username,
            userId
          );
        }

        console.log("MANAGER DETECTION:", {
          managedClubId: resolvedManagedClubId,
          managedSide: resolvedManagedSide,
          homeClubId,
          awayClubId,
          username,
          userId,
        });

        managedSideRef.current = resolvedManagedSide;
        setManagedSide(resolvedManagedSide);

        /* =================================================
           SQUADS
        ================================================= */

        let homePlayers = allPlayers
          .filter(player => playerBelongsToClub(player, homeClubId))
          .map(normalizePlayer);

        let awayPlayers = allPlayers
          .filter(player => playerBelongsToClub(player, awayClubId))
          .map(normalizePlayer);

        const embeddedHome =
          match?.home?.players ||
          match?.home?.lineup ||
          match?.homeLineup ||
          match?.homePlayers ||
          [];

        const embeddedAway =
          match?.away?.players ||
          match?.away?.lineup ||
          match?.awayLineup ||
          match?.awayPlayers ||
          [];

        if (Array.isArray(embeddedHome) && embeddedHome.length >= 11) {
          homePlayers = embeddedHome.map(normalizePlayer);
        }

        if (Array.isArray(embeddedAway) && embeddedAway.length >= 11) {
          awayPlayers = embeddedAway.map(normalizePlayer);
        }

        if (homePlayers.length < 11) {
          const embedded = extractEmbeddedPlayers(homeClub, "home");
          if (embedded.length >= 11) {
            homePlayers = embedded.map(normalizePlayer);
          }
        }

        if (awayPlayers.length < 11) {
          const embedded = extractEmbeddedPlayers(awayClub, "away");
          if (embedded.length >= 11) {
            awayPlayers = embedded.map(normalizePlayer);
          }
        }

        if (homePlayers.length < 11 || awayPlayers.length < 11) {
          throw new Error(
            `Abakinnyi ntibuzuye. ${homeClub.name}: ${homePlayers.length}, ${awayClub.name}: ${awayPlayers.length}.`
          );
        }

        /* =================================================
           STARTING XI + BENCH
        ================================================= */

        let homeStarting = homePlayers.slice(0, 11);
        let awayStarting = awayPlayers.slice(0, 11);

        if (
          Array.isArray(match?.home?.startingXI) &&
          match.home.startingXI.length >= 11
        ) {
          homeStarting = match.home.startingXI
            .slice(0, 11)
            .map(normalizePlayer);
        }

        if (
          Array.isArray(match?.away?.startingXI) &&
          match.away.startingXI.length >= 11
        ) {
          awayStarting = match.away.startingXI
            .slice(0, 11)
            .map(normalizePlayer);
        }

        const homeBench = buildBench(
          match?.home?.bench,
          homeClub.bench,
          allPlayers,
          homeClubId,
          homeStarting
        );

        const awayBench = buildBench(
          match?.away?.bench,
          awayClub.bench,
          allPlayers,
          awayClubId,
          awayStarting
        );

        setHomeBenchPlayers(homeBench);
        setAwayBenchPlayers(awayBench);

        /* =================================================
           MANAGED TEAM DATA
        ================================================= */

        const isAway = resolvedManagedSide === "away";
        const isHome = resolvedManagedSide === "home";

        const managedStarting = isAway
          ? awayStarting
          : isHome
          ? homeStarting
          : [];

        const managedBenchPlayers = isAway
          ? awayBench
          : isHome
          ? homeBench
          : [];

        setManagedStartingXI(managedStarting);
        setManagedBench(managedBenchPlayers);

        const managedClubName = isAway
          ? awayClub.name
          : isHome
          ? homeClub.name
          : "No Team";

        setManagedTeamName(managedClubName);

        /* =================================================
           TACTICS
        ================================================= */

        const managedClub = isAway
          ? awayClub
          : isHome
          ? homeClub
          : null;

        const managedMatchSide = isAway
          ? match?.away
          : isHome
          ? match?.home
          : null;

        const savedTactics =
          managedMatchSide?.tactics || managedClub?.tactics || {};

        setTactics({
          mentality: savedTactics.mentality || "balanced",
          tempo: safeNumber(savedTactics.tempo, 60),
          pressing: savedTactics.pressing || "medium",
          defensiveLine: savedTactics.defensiveLine || "medium",
          width: safeNumber(savedTactics.width, 55),
        });

        setFormation(
          managedMatchSide?.formation ||
            managedClub?.formation ||
            "4-3-3"
        );

        /* =================================================
           ENGINE CONFIG
        ================================================= */

        matchConfigRef.current = {
          matchId: String(id),
          home: { ...homeClub, players: homeStarting, bench: homeBench },
          away: { ...awayClub, players: awayStarting, bench: awayBench },
          metadata: {
            source: "firebase",
            matchId: String(id),
            managedClubId:
              resolvedManagedClubId ||
              (isAway ? awayClubId : isHome ? homeClubId : null),
            managedSide: resolvedManagedSide,
            managerUsername: username,
            managerUserId: userId,
          },
        };

        const engine = await rebuildEngine(
          homeStarting,
          awayStarting,
          homeBench,
          awayBench
        );

        if (cancelled) {
          engine?.destroy();
          return;
        }

        const initial = engine?.getState();
        if (initial) {
          setSnapshot(initial);
          setEvents(initial.events || []);
        }

        setLoading(false);

        if (initial?.status === "finished") {
          finishAndSave(initial);
        }
      } catch (err) {
        console.error("Match loading error:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to load match.");
          setLoading(false);
        }
      }
    }

    loadMatch();

    return () => {
      cancelled = true;

      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
        updateTimerRef.current = null;
      }

      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [
    authLoading,
    user,
    router.isReady,
    id,
    rebuildEngine,
    finishAndSave,
  ]);

  /* =======================================================
     LIVE POLLING
  ======================================================= */

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !snapshot) return;

    if (snapshot.status !== "playing") {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      return;
    }

    if (updateTimerRef.current) {
      clearInterval(updateTimerRef.current);
    }

    updateTimerRef.current = setInterval(async () => {
      const current = engineRef.current;
      if (!current || !current.isRunning()) return;

      try {
        const state = await current.update();
        if (!state) return;

        if (
          state.status === "playing" &&
          safeNumber(state.minute, 0) >= 90 &&
          !finishRequestedRef.current
        ) {
          finishRequestedRef.current = true;
          const finished = await current.finish();

          if (finished) {
            setSnapshot(finished);
            setEvents(finished.events || []);
          }
        }
      } catch (err) {
        console.error("Live match update error:", err);
      }
    }, 400);

    return () => {
      if (updateTimerRef.current) {
        clearInterval(updateTimerRef.current);
        updateTimerRef.current = null;
      }
    };
  }, [snapshot?.status]);

  /* =======================================================
     START
  ======================================================= */

  const startMatch = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (!managedSideRef.current) {
      setError("Ntabwo uri manager w'ikipe iyi.");
      return;
    }

    if (managedStartingXI.length !== 11) {
      setError("Ugomba kubanza kugira Starting XI y'abakinnyi 11.");
      setActiveTab("lineup");
      return;
    }

    try {
      setStarting(true);
      setError("");
      finishRequestedRef.current = false;

      await engine.start();

      const state = engine.getState();
      setSnapshot(state);
      setEvents(state?.events || []);
    } catch (err) {
      console.error("Start error:", err);
      setError(err?.message || "Match ntiyatangiye.");
    } finally {
      setStarting(false);
    }
  }, [managedStartingXI.length]);

  /* =======================================================
     PAUSE
  ======================================================= */

  const pauseMatch = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (!managedSideRef.current) {
      setError("Ntabwo uri manager w'ikipe iyi.");
      return;
    }

    try {
      setError("");
      await engine.pause();

      const state = engine.getState();
      setSnapshot(state);
      setEvents(state?.events || []);
    } catch (err) {
      console.error("Pause error:", err);
      setError(err?.message || "Pause failed.");
    }
  }, []);

  /* =======================================================
     TACTICS
  ======================================================= */

  function updateTactic(field, value) {
    setTactics(previous => ({ ...previous, [field]: value }));
  }

  async function saveTactics() {
    const engine = engineRef.current;
    if (!engine) return;

    if (!managedSideRef.current) {
      setError("Ntabwo uri manager w'ikipe iyi.");
      return;
    }

    try {
      setSavingTactics(true);
      setError("");

      const nextTactics = {
        mentality: tactics.mentality,
        tempo: safeNumber(tactics.tempo, 60),
        pressing: tactics.pressing,
        defensiveLine: tactics.defensiveLine,
        width: safeNumber(tactics.width, 55),
      };

      await engine.setUserTactics(nextTactics);

      if (formation) {
        await engine.setFormation(formation);
      }

      const state = engine.getState();
      setSnapshot(state);

      const matchRef = doc(db, "matches", String(id));
      const side = managedSideRef.current;

      await setDoc(
        matchRef,
        {
          [side]: { formation, tactics: nextTactics },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Tactics error:", err);
      setError(err?.message || "Tactics ntizibitswe.");
    } finally {
      setSavingTactics(false);
    }
  }

  /* =======================================================
     STARTING XI
  ======================================================= */

  const removeFromStartingXI = useCallback(
    playerId => {
      if (!managedSideRef.current) return;

      if (
        snapshot?.status !== "created" &&
        snapshot?.status !== "paused"
      ) {
        return;
      }

      const player = managedStartingXI.find(
        item => String(item.id) === String(playerId)
      );
      if (!player) return;

      setManagedStartingXI(previous =>
        previous.filter(item => String(item.id) !== String(playerId))
      );

      setManagedBench(previous => [...previous, player]);
    },
    [managedStartingXI, snapshot?.status]
  );

  const addToStartingXI = useCallback(
    playerId => {
      if (!managedSideRef.current) return;

      if (managedStartingXI.length >= 11) {
        setError("Starting XI ntishobora kurenga abakinnyi 11.");
        return;
      }

      const player = managedBench.find(
        item => String(item.id) === String(playerId)
      );
      if (!player) return;

      setManagedBench(previous =>
        previous.filter(item => String(item.id) !== String(playerId))
      );

      setManagedStartingXI(previous => [...previous, player]);
    },
    [managedBench, managedStartingXI.length]
  );

  const saveStartingXI = useCallback(async () => {
    if (!managedSideRef.current) {
      setError("Ntabwo uri manager w'ikipe iyi.");
      return;
    }

    if (managedStartingXI.length !== 11) {
      setError("Starting XI igomba kuba igizwe n'abakinnyi 11.");
      return;
    }

    try {
      setSavingLineup(true);
      setError("");

      const side = managedSideRef.current;
      const config = matchConfigRef.current;

      if (!config) {
        throw new Error("Match configuration ntiboneka.");
      }

      const homeXI =
        side === "home" ? managedStartingXI : config.home.players;
      const awayXI =
        side === "away" ? managedStartingXI : config.away.players;
      const homeBench =
        side === "home" ? managedBench : config.home.bench;
      const awayBench =
        side === "away" ? managedBench : config.away.bench;

      if (side === "home") setHomeBenchPlayers(homeBench);
      else setAwayBenchPlayers(awayBench);

      await rebuildEngine(homeXI, awayXI, homeBench, awayBench);

      matchConfigRef.current = {
        ...config,
        home: { ...config.home, players: homeXI, bench: homeBench },
        away: { ...config.away, players: awayXI, bench: awayBench },
      };

      const matchRef = doc(db, "matches", String(id));

      await setDoc(
        matchRef,
        {
          [side]: {
            startingXI: managedStartingXI,
            bench: managedBench,
            formation,
            tactics,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Starting XI save error:", err);
      setError(err?.message || "Starting XI ntibashije kubikwa.");
    } finally {
      setSavingLineup(false);
    }
  }, [
    managedStartingXI,
    managedBench,
    rebuildEngine,
    formation,
    tactics,
    id,
  ]);

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  async function makeSubstitution() {
    const engine = engineRef.current;
    if (!engine) return;

    if (!managedSideRef.current) {
      setError("Ntabwo uri manager w'ikipe iyi.");
      return;
    }

    if (!outgoingPlayer || !incomingPlayer) {
      setError("Hitamo umukinnyi usohoka n'umusimbura.");
      return;
    }

    try {
      setSubstituting(true);
      setError("");

      await engine.substituteUser(outgoingPlayer, incomingPlayer);

      const state = engine.getState();
      setSnapshot(state);
      setEvents(state?.events || []);

      const outgoing = managedStartingXI.find(
        player => String(player.id) === String(outgoingPlayer)
      );
      const incoming = managedBench.find(
        player => String(player.id) === String(incomingPlayer)
      );

      if (outgoing && incoming) {
        const nextStarting = managedStartingXI.map(player =>
          String(player.id) === String(outgoing.id) ? incoming : player
        );

        const nextBench = managedBench.map(player =>
          String(player.id) === String(incoming.id) ? outgoing : player
        );

        setManagedStartingXI(nextStarting);
        setManagedBench(nextBench);

        if (managedSideRef.current === "home") {
          setHomeBenchPlayers(nextBench);
        } else {
          setAwayBenchPlayers(nextBench);
        }

        if (matchConfigRef.current) {
          const side = managedSideRef.current;
          matchConfigRef.current = {
            ...matchConfigRef.current,
            [side]: {
              ...matchConfigRef.current[side],
              players: nextStarting,
              bench: nextBench,
            },
          };
        }
      }

      setOutgoingPlayer("");
      setIncomingPlayer("");
    } catch (err) {
      console.error("Substitution error:", err);
      setError(err?.message || "Substitution yanze.");
    } finally {
      setSubstituting(false);
    }
  }

  /* =======================================================
     SNAPSHOT VALUES
  ======================================================= */

  const home = snapshot?.home || null;
  const away = snapshot?.away || null;
  const score = snapshot?.score || { home: 0, away: 0 };
  const minute = safeNumber(snapshot?.minute, 0);
  const second = safeNumber(snapshot?.second, 0);
  const clock = formatClock(minute, second);
  const status = snapshot?.status || "created";

  /* =======================================================
     STATS + POSSESSION (ISHINGIYE KURI PASSES)
  ======================================================= */

  const homeStats = useMemo(
    () => calculateLiveStats(snapshot, "home"),
    [snapshot]
  );

  const awayStats = useMemo(
    () => calculateLiveStats(snapshot, "away"),
    [snapshot]
  );

  const possession = useMemo(
    () =>
      calculatePossessionFromPasses(
        homeStats.passes,
        awayStats.passes
      ),
    [homeStats.passes, awayStats.passes]
  );

  const homeStatsWithPossession = useMemo(
    () => ({ ...homeStats, possession: possession.home }),
    [homeStats, possession.home]
  );

  const awayStatsWithPossession = useMemo(
    () => ({ ...awayStats, possession: possession.away }),
    [awayStats, possession.away]
  );

  /* =======================================================
     PITCH PLAYERS
  ======================================================= */

  const allPlayers = useMemo(() => {
    const homePlayers = Array.isArray(home?.players) ? home.players : [];
    const awayPlayers = Array.isArray(away?.players) ? away.players : [];

    return [
      ...homePlayers.map(player => ({ ...player, side: "home" })),
      ...awayPlayers.map(player => ({ ...player, side: "away" })),
    ];
  }, [home, away]);

  /* =======================================================
     BENCH
  ======================================================= */

  const liveHomeBench = homeBenchPlayers;
  const liveAwayBench = awayBenchPlayers;

  const liveManagedBench =
    managedSide === "away" ? liveAwayBench : liveHomeBench;

  /* =======================================================
     LOADING (auth + page)
  ======================================================= */

  if (authLoading || loading) {
    return (
      <main className={styles.loadingPage}>
        <div className={styles.spinner} />
        <p>Loading match...</p>
      </main>
    );
  }

  /* =======================================================
     ERROR
  ======================================================= */

  if (error && !snapshot) {
    return (
      <main className={styles.errorPage}>
        <h2>Match Error</h2>
        <p>{error}</p>
      </main>
    );
  }

  /* =======================================================
     PAGE
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          {home?.name || "Home"} vs {away?.name || "Away"} | Live Match
        </title>

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div className={styles.status}>
            <span
              className={
                status === "playing"
                  ? styles.liveDot
                  : styles.statusDot
              }
            />
            {status === "playing"
              ? "LIVE MATCH"
              : status === "finished"
              ? "FULL TIME"
              : status === "paused"
              ? "PAUSED"
              : "READY"}
          </div>

          <div className={styles.clock}>{clock}</div>

          {savingResult && (
            <div className={styles.savingResult}>
              Saving final result...
            </div>
          )}
        </header>

        {/* SCOREBOARD */}
        <section className={styles.scoreboard}>
          <div className={styles.team}>
            {home?.logo ? (
              <img
                src={home.logo}
                alt={home.name}
                className={styles.logo}
              />
            ) : (
              <div className={styles.logoPlaceholder}>⚽</div>
            )}
            <strong>{home?.name || "Home"}</strong>
          </div>

          <div className={styles.score}>
            <span>{safeNumber(score.home, 0)}</span>
            <small>-</small>
            <span>{safeNumber(score.away, 0)}</span>
          </div>

          <div className={styles.team}>
            {away?.logo ? (
              <img
                src={away.logo}
                alt={away.name}
                className={styles.logo}
              />
            ) : (
              <div className={styles.logoPlaceholder}>⚽</div>
            )}
            <strong>{away?.name || "Away"}</strong>
          </div>
        </section>

        {/* MANAGED TEAM INFO */}
        <div className={styles.managerTeamBar}>
          {managedSide ? (
            <>
              Managing: <strong>{managedTeamName}</strong>
              <span> ({managedSide})</span>
            </>
          ) : (
            <span>
              Spectator mode — you are not managing this match.
            </span>
          )}
        </div>

        {/* CONTROLS */}
        <section className={styles.controls}>
          {managedSide &&
            status !== "finished" &&
            status !== "playing" && (
              <button
                onClick={startMatch}
                disabled={
                  starting ||
                  savingResult ||
                  managedStartingXI.length !== 11
                }
                className={styles.startButton}
              >
                {starting
                  ? "Starting..."
                  : managedStartingXI.length !== 11
                  ? `SELECT 11 PLAYERS (${managedStartingXI.length}/11)`
                  : "▶ START MATCH"}
              </button>
            )}

          {managedSide && status === "playing" && (
            <button onClick={pauseMatch} className={styles.pauseButton}>
              ⏸ PAUSE
            </button>
          )}
        </section>

        {/* ERROR */}
        {error && <div className={styles.errorBox}>{error}</div>}

        {/* PITCH */}
        <section className={styles.pitch}>
          <div className={styles.halfLine} />
          <div className={styles.centerCircle} />
          <div className={styles.centerSpot} />
          <div className={`${styles.penaltyBox} ${styles.leftBox}`} />
          <div className={`${styles.penaltyBox} ${styles.rightBox}`} />
          <div className={`${styles.goalBox} ${styles.leftGoal}`} />
          <div className={`${styles.goalBox} ${styles.rightGoal}`} />

          {allPlayers.map(player => {
            const x = safeNumber(
              player.x,
              player.side === "home" ? 25 : 75
            );
            const y = safeNumber(player.y, 50);

            return (
              <div
                key={`${player.side}-${player.id}`}
                className={`${styles.player} ${
                  player.side === "home"
                    ? styles.homePlayer
                    : styles.awayPlayer
                } ${player.hasBall ? styles.hasBall : ""}`}
                style={{
                  left: `${Math.max(2, Math.min(98, x))}%`,
                  top: `${Math.max(3, Math.min(97, y))}%`,
                }}
              >
                <span className={styles.playerNumber}>
                  {player.number}
                </span>
                <span className={styles.playerName}>
                  {player.name}
                </span>
              </div>
            );
          })}

          {snapshot?.ball && (
            <div
              className={styles.ball}
              style={{
                left: `${Math.max(
                  1,
                  Math.min(99, safeNumber(snapshot.ball.x, 50))
                )}%`,
                top: `${Math.max(
                  2,
                  Math.min(98, safeNumber(snapshot.ball.y, 50))
                )}%`,
              }}
            >
              ⚽
            </div>
          )}
        </section>

        {/* CONTENT */}
        <section className={styles.contentGrid}>
          <div className={styles.panel}>
            <div className={styles.tabs}>
              {[
                ["events", "Events"],
                ["players", "Players"],
                ["stats", "Stats"],
                ["lineup", "Starting XI"],
                ["tactics", "Tactics"],
                ["subs", "Substitutions"],
              ].map(tab => (
                <button
                  key={tab[0]}
                  className={
                    activeTab === tab[0] ? styles.activeTab : ""
                  }
                  onClick={() => setActiveTab(tab[0])}
                >
                  {tab[1]}
                </button>
              ))}
            </div>

            {/* EVENTS */}
            {activeTab === "events" && (
              <div className={styles.events}>
                {events
                  .slice()
                  .reverse()
                  .map((event, index) => (
                    <div
                      key={
                        event.id ||
                        `${event.minute}-${event.second}-${event.type}-${index}`
                      }
                      className={styles.event}
                    >
                      <span>{event.minute ?? 0}'</span>
                      <p>
                        {event.text ||
                          event.description ||
                          event.type ||
                          "Match event"}
                      </p>
                    </div>
                  ))}

                {!events.length && (
                  <p className={styles.empty}>
                    Match has not started.
                  </p>
                )}
              </div>
            )}

            {/* PLAYERS */}
            {activeTab === "players" && (
              <div className={styles.playerList}>
                <div>
                  <h3>{home?.name}</h3>
                  {home?.players?.map(player => (
                    <div
                      className={styles.listPlayer}
                      key={player.id}
                    >
                      <b>{player.number}</b>
                      <span>{player.name}</span>
                      <small>{player.position}</small>
                    </div>
                  ))}

                  <h3>Bench ({liveHomeBench.length})</h3>
                  {liveHomeBench.length > 0 ? (
                    liveHomeBench.map(player => (
                      <div
                        className={styles.listPlayer}
                        key={`home-bench-${player.id}`}
                      >
                        <b>{player.number}</b>
                        <span>{player.name}</span>
                        <small>{player.position}</small>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>
                      No bench players found.
                    </p>
                  )}
                </div>

                <div>
                  <h3>{away?.name}</h3>
                  {away?.players?.map(player => (
                    <div
                      className={styles.listPlayer}
                      key={player.id}
                    >
                      <b>{player.number}</b>
                      <span>{player.name}</span>
                      <small>{player.position}</small>
                    </div>
                  ))}

                  <h3>Bench ({liveAwayBench.length})</h3>
                  {liveAwayBench.length > 0 ? (
                    liveAwayBench.map(player => (
                      <div
                        className={styles.listPlayer}
                        key={`away-bench-${player.id}`}
                      >
                        <b>{player.number}</b>
                        <span>{player.name}</span>
                        <small>{player.position}</small>
                      </div>
                    ))
                  ) : (
                    <p className={styles.empty}>
                      No bench players found.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* STATS */}
            {activeTab === "stats" && (
              <div className={styles.stats}>
                {[
                  [
                    "Possession",
                    `${Math.round(
                      homeStatsWithPossession.possession
                    )}%`,
                    `${Math.round(
                      awayStatsWithPossession.possession
                    )}%`,
                  ],
                  [
                    "Passes",
                    homeStatsWithPossession.passes,
                    awayStatsWithPossession.passes,
                  ],
                  [
                    "Shots",
                    homeStatsWithPossession.shots,
                    awayStatsWithPossession.shots,
                  ],
                  [
                    "Shots on target",
                    homeStatsWithPossession.shotsOnTarget,
                    awayStatsWithPossession.shotsOnTarget,
                  ],
                  [
                    "Corners",
                    homeStatsWithPossession.corners,
                    awayStatsWithPossession.corners,
                  ],
                  [
                    "Tackles",
                    homeStatsWithPossession.tackles,
                    awayStatsWithPossession.tackles,
                  ],
                  [
                    "Interceptions",
                    homeStatsWithPossession.interceptions,
                    awayStatsWithPossession.interceptions,
                  ],
                  [
                    "Saves",
                    homeStatsWithPossession.saves,
                    awayStatsWithPossession.saves,
                  ],
                  [
                    "Fouls",
                    homeStatsWithPossession.fouls,
                    awayStatsWithPossession.fouls,
                  ],
                ].map(row => (
                  <div
                    className={styles.statRow}
                    key={row[0]}
                  >
                    <strong>{row[1]}</strong>
                    <span>{row[0]}</span>
                    <strong>{row[2]}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* STARTING XI */}
            {activeTab === "lineup" && managedSide && (
              <div className={styles.tacticsPanel}>
                <div className={styles.sectionTitle}>
                  <h3>{managedTeamName} Starting XI</h3>
                  <span>{managedStartingXI.length}/11</span>
                </div>

                <p className={styles.empty}>
                  Hitamo abakinnyi 11 bazatangira umukino.
                </p>

                <div className={styles.playerList}>
                  <div>
                    <h3>Starting XI</h3>
                    {managedStartingXI.map(player => (
                      <div
                        className={styles.listPlayer}
                        key={player.id}
                      >
                        <b>{player.number}</b>
                        <span>{player.name}</span>
                        <small>{player.position}</small>

                        {status !== "playing" &&
                          status !== "finished" && (
                            <button
                              className={styles.removeButton}
                              onClick={() =>
                                removeFromStartingXI(player.id)
                              }
                            >
                              Remove
                            </button>
                          )}
                      </div>
                    ))}
                  </div>

                  <div>
                    <h3>Bench ({managedBench.length})</h3>
                    {managedBench.map(player => (
                      <div
                        className={styles.listPlayer}
                        key={player.id}
                      >
                        <b>{player.number}</b>
                        <span>{player.name}</span>
                        <small>{player.position}</small>

                        {status !== "playing" &&
                          status !== "finished" && (
                            <button
                              className={styles.addButton}
                              onClick={() =>
                                addToStartingXI(player.id)
                              }
                              disabled={
                                managedStartingXI.length >= 11
                              }
                            >
                              Add
                            </button>
                          )}
                      </div>
                    ))}

                    {!managedBench.length && (
                      <p className={styles.empty}>
                        No bench players.
                      </p>
                    )}
                  </div>
                </div>

                {status !== "playing" &&
                  status !== "finished" && (
                    <button
                      className={styles.saveTacticsButton}
                      onClick={saveStartingXI}
                      disabled={
                        savingLineup ||
                        managedStartingXI.length !== 11
                      }
                    >
                      {savingLineup
                        ? "Saving Starting XI..."
                        : `✓ SAVE STARTING XI (${managedStartingXI.length}/11)`}
                    </button>
                  )}
              </div>
            )}

            {/* TACTICS */}
            {activeTab === "tactics" && managedSide && (
              <div className={styles.tacticsPanel}>
                <div className={styles.sectionTitle}>
                  <h3>{managedTeamName} Tactics</h3>
                  <span>Manager</span>
                </div>

                <div className={styles.formGroup}>
                  <label>Formation</label>
                  <select
                    value={formation}
                    onChange={event =>
                      setFormation(event.target.value)
                    }
                    disabled={status === "finished"}
                  >
                    <option value="4-3-3">4-3-3</option>
                    <option value="4-4-2">4-4-2</option>
                    <option value="4-2-3-1">4-2-3-1</option>
                    <option value="3-5-2">3-5-2</option>
                    <option value="5-3-2">5-3-2</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Mentality</label>
                  <select
                    value={tactics.mentality}
                    onChange={event =>
                      updateTactic(
                        "mentality",
                        event.target.value
                      )
                    }
                    disabled={status === "finished"}
                  >
                    <option value="very_defensive">
                      Very Defensive
                    </option>
                    <option value="defensive">Defensive</option>
                    <option value="balanced">Balanced</option>
                    <option value="attacking">Attacking</option>
                    <option value="very_attacking">
                      Very Attacking
                    </option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Pressing</label>
                  <select
                    value={tactics.pressing}
                    onChange={event =>
                      updateTactic(
                        "pressing",
                        event.target.value
                      )
                    }
                    disabled={status === "finished"}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="very_high">Very High</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Defensive Line</label>
                  <select
                    value={tactics.defensiveLine}
                    onChange={event =>
                      updateTactic(
                        "defensiveLine",
                        event.target.value
                      )
                    }
                    disabled={status === "finished"}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Tempo: {tactics.tempo}</label>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={tactics.tempo}
                    onChange={event =>
                      updateTactic(
                        "tempo",
                        Number(event.target.value)
                      )
                    }
                    disabled={status === "finished"}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Width: {tactics.width}</label>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={tactics.width}
                    onChange={event =>
                      updateTactic(
                        "width",
                        Number(event.target.value)
                      )
                    }
                    disabled={status === "finished"}
                  />
                </div>

                <button
                  className={styles.saveTacticsButton}
                  onClick={saveTactics}
                  disabled={
                    savingTactics || status === "finished"
                  }
                >
                  {savingTactics
                    ? "Saving..."
                    : "✓ APPLY TACTICS"}
                </button>
              </div>
            )}

            {/* SUBSTITUTIONS */}
            {activeTab === "subs" && managedSide && (
              <div className={styles.substitutionPanel}>
                <div className={styles.sectionTitle}>
                  <h3>Substitution</h3>
                  <span>{managedTeamName}</span>
                </div>

                <div className={styles.formGroup}>
                  <label>Player coming off</label>
                  <select
                    value={outgoingPlayer}
                    onChange={event =>
                      setOutgoingPlayer(event.target.value)
                    }
                    disabled={
                      status === "finished" ||
                      status === "created" ||
                      substituting
                    }
                  >
                    <option value="">Select player</option>
                    {(managedSide === "away"
                      ? away?.players
                      : home?.players
                    )?.map(player => (
                      <option
                        key={player.id}
                        value={player.id}
                      >
                        #{player.number} {player.name} (
                        {player.position})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Player coming on</label>
                  <select
                    value={incomingPlayer}
                    onChange={event =>
                      setIncomingPlayer(event.target.value)
                    }
                    disabled={
                      status === "finished" ||
                      status === "created" ||
                      substituting
                    }
                  >
                    <option value="">Select substitute</option>
                    {liveManagedBench.map(player => (
                      <option
                        key={player.id}
                        value={player.id}
                      >
                        #{player.number} {player.name} (
                        {player.position})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className={styles.substituteButton}
                  onClick={makeSubstitution}
                  disabled={
                    substituting ||
                    status === "finished" ||
                    status === "created" ||
                    !outgoingPlayer ||
                    !incomingPlayer
                  }
                >
                  {substituting
                    ? "Making substitution..."
                    : "⇄ MAKE SUBSTITUTION"}
                </button>

                <div className={styles.substitutionInfo}>
                  <p>
                    Substitutions used:{" "}
                    <strong>
                      {safeNumber(
                        managedTeam?.substitutionsUsed,
                        0
                      )}
                    </strong>{" "}
                    / 5
                  </p>
                  <p>
                    Available substitutes:{" "}
                    <strong>{liveManagedBench.length}</strong>
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
