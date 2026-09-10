import React, {
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
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";

import MatchEngine from "../../lib/match-engine/MatchEngine";
import MatchCanvas from "../../components/match/MatchCanvas";

import {
  MATCH_STATUS,
  TACTICAL_VALUES,
} from "../../lib/match-engine/constants";

import styles from "./Mach.module.css";

/* =========================================================
   HELPERS
========================================================= */

function normalizeId(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    return (
      value.id ??
      value.clubId ??
      value.teamId ??
      value.currentClubId ??
      null
    );
  }

  return String(value);
}

function getManagedClubId(profile, authUser) {
  /*
   * PRIMARY SOURCE:
   *
   * users/{uid}
   *   careerData.currentClub.id
   *
   * BACKUPS:
   *
   * currentClub
   * clubId
   * teamId
   * managedClubId
   */

  const currentClub =
    profile?.careerData?.currentClub ??
    profile?.currentClub ??
    null;

  const currentClubId = normalizeId(currentClub);

  if (currentClubId) {
    return String(currentClubId);
  }

  const fallback =
    profile?.clubId ??
    profile?.teamId ??
    profile?.managedClubId ??
    authUser?.clubId ??
    authUser?.teamId ??
    authUser?.managedClubId ??
    null;

  return normalizeId(fallback);
}

function normalizeUsername(value) {
  if (!value) return "";

  return String(value)
    .trim()
    .toLowerCase();
}

function getUserUsername(profile, authUser) {
  return normalizeUsername(
    profile?.username ??
      authUser?.username ??
      authUser?.displayName ??
      ""
  );
}

/*
 * Checks whether the current user actually manages this club.
 *
 * Priority:
 *
 * 1. club.managerId === Firebase Auth UID
 * 2. If managerId exists but belongs to another user,
 *    do NOT override it using username/currentClub.
 * 3. If managerId is absent, use managerUsername/currentClub
 *    as fallback.
 */
function isUserManagerOfClub({
  club,
  profile,
  authUser,
}) {
  if (!club || !authUser?.uid) {
    return false;
  }

  const uid = String(authUser.uid);

  const managerId =
    club.managerId ??
    club.managerUid ??
    club.managerUserId ??
    club.manager?.uid ??
    club.manager?.userId ??
    club.manager?.id ??
    null;

  /*
   * If database explicitly contains managerId,
   * it becomes the source of truth.
   */
  if (managerId) {
    return String(managerId) === uid;
  }

  /*
   * Username fallback only when managerId is absent.
   */
  const userUsername = getUserUsername(
    profile,
    authUser
  );

  const managerUsername = normalizeUsername(
    club.managerUsername ??
      (typeof club.manager === "string"
        ? club.manager
        : null) ??
      club.managerName ??
      club.manager?.username ??
      ""
  );

  if (
    userUsername &&
    managerUsername &&
    userUsername === managerUsername
  ) {
    return true;
  }

  /*
   * Current club fallback.
   */
  const managedClubId = getManagedClubId(
    profile,
    authUser
  );

  if (
    managedClubId &&
    String(club.id) === String(managedClubId)
  ) {
    return true;
  }

  return false;
}

function getInitialTactics(engine, side) {
  if (!engine) return {};

  const source =
    side === "away"
      ? engine.awayTactics
      : engine.homeTactics;

  return source ? { ...source } : {};
}

/* =========================================================
   PAGE
========================================================= */

export default function MatchPage() {
  const router = useRouter();
  const { id } = router.query;

  const {
    user,
    loading: authLoading,
  } = useAuth();

  /* =======================================================
     STATE
  ======================================================= */

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState(null);

  const [match, setMatch] = useState(null);

  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);

  const [engine, setEngine] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const [saving, setSaving] = useState(false);

  /*
   * IMPORTANT:
   *
   * null = user does not manage either team
   * home = user manages home
   * away = user manages away
   */
  const [userSide, setUserSide] = useState(null);

  const [tactics, setTactics] = useState(null);

  const [subOut, setSubOut] = useState("");
  const [subIn, setSubIn] = useState("");
  const [subMessage, setSubMessage] = useState("");

  const engineRef = useRef(null);
  const lastSaveRef = useRef(0);
  const savingRef = useRef(false);

  /* =======================================================
     LOAD USER PROFILE
  ======================================================= */

  const loadProfile = useCallback(async () => {
    if (!user?.uid) {
      return null;
    }

    try {
      /*
       * Your database structure:
       *
       * users/{firebaseAuthUid}
       */
      const userRef = doc(
        db,
        "users",
        String(user.uid)
      );

      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        console.warn(
          "User profile not found:",
          user.uid
        );

        return null;
      }

      return {
        id: snap.id,
        ...snap.data(),
      };
    } catch (err) {
      console.error(
        "PROFILE LOAD ERROR:",
        err
      );

      return null;
    }
  }, [user]);

  /* =======================================================
     LOAD PLAYERS
  ======================================================= */

  const loadPlayers = useCallback(
    async clubId => {
      if (!clubId) return [];

      const playersRef = collection(
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

      const snaps = await Promise.all(
        queries.map(async q => {
          try {
            return await getDocs(q);
          } catch (err) {
            console.warn(
              "PLAYER QUERY FAILED:",
              err
            );

            return null;
          }
        })
      );

      const unique = new Map();

      snaps.forEach(snap => {
        if (!snap) return;

        snap.docs.forEach(playerDoc => {
          unique.set(
            playerDoc.id,
            {
              id: playerDoc.id,
              ...playerDoc.data(),
            }
          );
        });
      });

      return Array.from(
        unique.values()
      );
    },
    []
  );

  /* =======================================================
     DETECT USER SIDE
  ======================================================= */

  const detectUserSide = useCallback(
    ({
      home,
      away,
      profileData,
      authUser,
    }) => {
      if (!authUser?.uid) {
        return null;
      }

      const homeManager =
        isUserManagerOfClub({
          club: home,
          profile: profileData,
          authUser,
        });

      const awayManager =
        isUserManagerOfClub({
          club: away,
          profile: profileData,
          authUser,
        });

      console.log(
        "===== USER MANAGER DETECTION ====="
      );

      console.log(
        "Firebase UID:",
        authUser.uid
      );

      console.log(
        "Managed Club:",
        getManagedClubId(
          profileData,
          authUser
        )
      );

      console.log(
        "Home Club:",
        home.id,
        home.name
      );

      console.log(
        "Away Club:",
        away.id,
        away.name
      );

      console.log(
        "Home Manager:",
        homeManager
      );

      console.log(
        "Away Manager:",
        awayManager
      );

      if (homeManager && awayManager) {
        console.warn(
          "USER IS MANAGER OF BOTH TEAMS."
        );

        /*
         * This should normally never happen.
         *
         * We choose home only to avoid ambiguous state.
         */
        return "home";
      }

      if (homeManager) {
        return "home";
      }

      if (awayManager) {
        return "away";
      }

      /*
       * IMPORTANT:
       *
       * Do NOT automatically make the user home.
       *
       * This means AI-vs-AI can exist.
       */
      return null;
    },
    []
  );

  /* =======================================================
     LOAD MATCH
  ======================================================= */

  const loadMatch = useCallback(async () => {
    if (
      authLoading ||
      !id ||
      !user?.uid
    ) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      /*
       * ---------------------------------------------------
       * USER PROFILE
       * ---------------------------------------------------
       */

      const profileData =
        await loadProfile();

      setProfile(profileData);

      /*
       * ---------------------------------------------------
       * MATCH
       * ---------------------------------------------------
       */

      const matchRef = doc(
        db,
        "matches",
        String(id)
      );

      const matchSnap =
        await getDoc(matchRef);

      if (!matchSnap.exists()) {
        throw new Error(
          "Match not found."
        );
      }

      const matchData = {
        id: matchSnap.id,
        ...matchSnap.data(),
      };

      /*
       * ---------------------------------------------------
       * CLUBS
       * ---------------------------------------------------
       */

      const [
        homeSnap,
        awaySnap,
      ] = await Promise.all([
        matchData.homeClubId
          ? getDoc(
              doc(
                db,
                "clubs",
                String(
                  matchData.homeClubId
                )
              )
            )
          : null,

        matchData.awayClubId
          ? getDoc(
              doc(
                db,
                "clubs",
                String(
                  matchData.awayClubId
                )
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
              id: matchData.homeClubId,
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
              id: matchData.awayClubId,
              name:
                matchData.awayClubName ||
                "Away",
            };

      if (!home.id) {
        throw new Error(
          "Home club ID is missing."
        );
      }

      if (!away.id) {
        throw new Error(
          "Away club ID is missing."
        );
      }

      /*
       * ---------------------------------------------------
       * PLAYERS
       * ---------------------------------------------------
       */

      const [
        homePlayers,
        awayPlayers,
      ] = await Promise.all([
        loadPlayers(home.id),
        loadPlayers(away.id),
      ]);

      if (homePlayers.length < 11) {
        throw new Error(
          `${home.name} does not have enough players.`
        );
      }

      if (awayPlayers.length < 11) {
        throw new Error(
          `${away.name} does not have enough players.`
        );
      }

      /*
       * ---------------------------------------------------
       * USER SIDE
       * ---------------------------------------------------
       */

      const detectedSide =
        detectUserSide({
          home,
          away,
          profileData,
          authUser: user,
        });

      /*
       * ---------------------------------------------------
       * ENGINE
       * ---------------------------------------------------
       */

      const newEngine =
        new MatchEngine({
          match: matchData,
          homeClub: home,
          awayClub: away,
          homePlayers,
          awayPlayers,
        });

      /*
       * If user controls a team,
       * tell engine.
       *
       * If null, engine remains AI-vs-AI.
       */
      if (detectedSide) {
        newEngine.setUserControlled(
          detectedSide
        );
      } else {
        /*
         * Make sure the engine does not
         * accidentally assume home.
         */
        if (
          typeof newEngine.setUserControlled ===
          "function"
        ) {
          newEngine.setUserControlled(
            null
          );
        }
      }

      /*
       * ---------------------------------------------------
       * SAVE REFERENCES
       * ---------------------------------------------------
       */

      engineRef.current =
        newEngine;

      setEngine(newEngine);

      setMatch(matchData);
      setHomeClub(home);
      setAwayClub(away);

      setUserSide(
        detectedSide
      );

      const initialSnapshot =
        newEngine.getSnapshot();

      setSnapshot(
        initialSnapshot
      );

      setTactics(
        getInitialTactics(
          newEngine,
          detectedSide || "home"
        )
      );
    } catch (err) {
      console.error(
        "MATCH LOAD ERROR:",
        err
      );

      setError(
        err?.message ||
          "Failed to load match."
      );
    } finally {
      setLoading(false);
    }
  }, [
    id,
    authLoading,
    user,
    loadProfile,
    loadPlayers,
    detectUserSide,
  ]);

  /* =======================================================
     LOAD EFFECT
  ======================================================= */

  useEffect(() => {
    if (
      authLoading ||
      !user?.uid ||
      !id
    ) {
      return;
    }

    loadMatch();

    return () => {
      if (engineRef.current) {
        try {
          engineRef.current.stop();
        } catch (err) {
          console.error(
            "ENGINE STOP ERROR:",
            err
          );
        }
      }

      engineRef.current = null;
    };
  }, [
    authLoading,
    user,
    id,
    loadMatch,
  ]);

  /* =======================================================
     SAVE MATCH
  ======================================================= */

  const saveMatch = useCallback(
    async (force = false) => {
      const current =
        engineRef.current;

      if (
        !current ||
        !match?.id
      ) {
        return;
      }

      const now = Date.now();

      /*
       * Don't save every 250ms.
       */
      if (
        !force &&
        now - lastSaveRef.current <
          10000
      ) {
        return;
      }

      /*
       * Prevent overlapping Firestore writes.
       */
      if (savingRef.current) {
        return;
      }

      lastSaveRef.current = now;
      savingRef.current = true;

      try {
        setSaving(true);

        const data =
          current.getSnapshot();

        const homeXI =
          Array.isArray(
            current.homeXI
          )
            ? current.homeXI
            : [];

        const awayXI =
          Array.isArray(
            current.awayXI
          )
            ? current.awayXI
            : [];

        await updateDoc(
          doc(
            db,
            "matches",
            String(match.id)
          ),
          {
            status: data.status,
            minute: data.minute,

            homeScore:
              data.homeScore,

            awayScore:
              data.awayScore,

            result: {
              homeScore:
                data.homeScore,
              awayScore:
                data.awayScore,
            },

            events:
              data.events || [],

            homeStats:
              data.homeStats || {},

            awayStats:
              data.awayStats || {},

            homeFormation:
              data.homeFormation,

            awayFormation:
              data.awayFormation,

            homeTactics:
              data.homeTactics || {},

            awayTactics:
              data.awayTactics || {},

            homeLineupIds:
              homeXI
                .map(p => p?.id)
                .filter(Boolean),

            awayLineupIds:
              awayXI
                .map(p => p?.id)
                .filter(Boolean),

            homeSubsUsed:
              data.substitutions
                ?.home ?? 0,

            awaySubsUsed:
              data.substitutions
                ?.away ?? 0,

            homeInjuries:
              data.injuries
                ?.home || [],

            awayInjuries:
              data.injuries
                ?.away || [],

            /*
             * null means AI-vs-AI.
             */
            userControlledSide:
              current.userControlled ??
              null,

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
        savingRef.current = false;
        setSaving(false);
      }
    },
    [match]
  );

  /* =======================================================
     ENGINE SNAPSHOT LOOP
  ======================================================= */

  useEffect(() => {
    if (!engine) {
      return undefined;
    }

    const timer =
      setInterval(() => {
        try {
          const data =
            engine.getSnapshot();

          setSnapshot(data);

          /*
           * Update tactics shown in UI.
           */
          if (userSide) {
            const liveTactics =
              userSide === "home"
                ? engine.homeTactics
                : engine.awayTactics;

            if (liveTactics) {
              setTactics({
                ...liveTactics,
              });
            }
          }

          /*
           * Save periodically.
           */
          if (
            data.status ===
            MATCH_STATUS.FINISHED
          ) {
            saveMatch(true);
          } else {
            saveMatch(false);
          }
        } catch (err) {
          console.error(
            "SNAPSHOT ERROR:",
            err
          );
        }
      }, 250);

    return () =>
      clearInterval(timer);
  }, [
    engine,
    userSide,
    saveMatch,
  ]);

  /* =======================================================
     START
  ======================================================= */

  const startMatch =
    useCallback(() => {
      const current =
        engineRef.current;

      if (!current) {
        setError(
          "Match engine is not ready."
        );
        return;
      }

      try {
        console.log(
          "===== START MATCH ====="
        );

        console.log(
          "Before:",
          current.getSnapshot()
        );

        current.start();

        const after =
          current.getSnapshot();

        console.log(
          "After:",
          after
        );

        setSnapshot(after);

        saveMatch(true);
      } catch (err) {
        console.error(
          "START MATCH ERROR:",
          err
        );

        setError(
          err?.message ||
            "Unable to start match."
        );
      }
    }, [saveMatch]);

  /* =======================================================
     PAUSE
  ======================================================= */

  const pauseMatch =
    useCallback(() => {
      const current =
        engineRef.current;

      if (!current) return;

      try {
        current.pause();

        setSnapshot(
          current.getSnapshot()
        );

        saveMatch(true);
      } catch (err) {
        console.error(
          "PAUSE ERROR:",
          err
        );
      }
    }, [saveMatch]);

  /* =======================================================
     RESUME
  ======================================================= */

  const resumeMatch =
    useCallback(() => {
      const current =
        engineRef.current;

      if (!current) return;

      try {
        current.resume();

        setSnapshot(
          current.getSnapshot()
        );

        saveMatch(true);
      } catch (err) {
        console.error(
          "RESUME ERROR:",
          err
        );
      }
    }, [saveMatch]);

  /* =======================================================
     STOP
  ======================================================= */

  const stopMatch =
    useCallback(() => {
      const current =
        engineRef.current;

      if (!current) return;

      try {
        current.stop();

        setSnapshot(
          current.getSnapshot()
        );

        saveMatch(true);
      } catch (err) {
        console.error(
          "STOP ERROR:",
          err
        );
      }
    }, [saveMatch]);

  /* =======================================================
     UPDATE TACTIC
  ======================================================= */

  const updateTactic =
    useCallback(
      (key, value) => {
        const current =
          engineRef.current;

        if (
          !current ||
          !userSide
        ) {
          return;
        }

        try {
          current.setTactics(
            userSide,
            {
              [key]: value,
            }
          );

          setTactics(prev => ({
            ...(prev || {}),
            [key]: value,
          }));

          /*
           * Small delay allows engine
           * state to update first.
           */
          setTimeout(() => {
            saveMatch(true);
          }, 100);
        } catch (err) {
          console.error(
            "TACTIC UPDATE ERROR:",
            err
          );
        }
      },
      [userSide, saveMatch]
    );

  /* =======================================================
     SUBSTITUTION
  ======================================================= */

  const doSub =
    useCallback(() => {
      const current =
        engineRef.current;

      if (
        !current ||
        !userSide ||
        !subOut ||
        !subIn
      ) {
        return;
      }

      try {
        const ok =
          current.performSubstitution(
            userSide,
            subOut,
            subIn
          );

        if (ok) {
          setSubOut("");
          setSubIn("");

          setSubMessage(
            "Substitution yagenze neza ✅"
          );

          setTimeout(() => {
            setSubMessage("");
          }, 2500);

          setSnapshot(
            current.getSnapshot()
          );

          saveMatch(true);
        } else {
          setSubMessage(
            "Substitution ntibishoboka. Reba abakinnyi cyangwa umubare wa substitutions."
          );

          setTimeout(() => {
            setSubMessage("");
          }, 3000);
        }
      } catch (err) {
        console.error(
          "SUBSTITUTION ERROR:",
          err
        );

        setSubMessage(
          "Habaye ikibazo muri substitution."
        );

        setTimeout(() => {
          setSubMessage("");
        }, 3000);
      }
    }, [
      userSide,
      subOut,
      subIn,
      saveMatch,
    ]);

  /* =======================================================
     MEMOS
  ======================================================= */

  const ballOwner =
    useMemo(() => {
      if (!snapshot) {
        return null;
      }

      return (
        snapshot.players?.find(
          player =>
            player.hasBall
        ) || null
      );
    }, [snapshot]);

  const recentEvents =
    useMemo(() => {
      return (
        snapshot?.events
          ?.slice(0, 10) || []
      );
    }, [snapshot]);

  const myLineup =
    useMemo(() => {
      if (
        !snapshot ||
        !userSide
      ) {
        return [];
      }

      return userSide === "home"
        ? snapshot.homeLineup || []
        : snapshot.awayLineup || [];
    }, [
      snapshot,
      userSide,
    ]);

  const myBench =
    useMemo(() => {
      if (
        !snapshot ||
        !userSide
      ) {
        return [];
      }

      return userSide === "home"
        ? snapshot.homeBench || []
        : snapshot.awayBench || [];
    }, [
      snapshot,
      userSide,
    ]);

  const oppBench =
    useMemo(() => {
      if (
        !snapshot ||
        !userSide
      ) {
        return [];
      }

      return userSide === "home"
        ? snapshot.awayBench || []
        : snapshot.homeBench || [];
    }, [
      snapshot,
      userSide,
    ]);

  const mySubsUsed =
    useMemo(() => {
      if (
        !snapshot ||
        !userSide
      ) {
        return 0;
      }

      return userSide === "home"
        ? snapshot.substitutions
            ?.home ?? 0
        : snapshot.substitutions
            ?.away ?? 0;
    }, [
      snapshot,
      userSide,
    ]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    authLoading ||
    loading
  ) {
    return (
      <>
        <Head>
          <title>
            Loading Match | New Talents
          </title>
        </Head>

        <main className={styles.loadingPage}>
          <div
            className={styles.loadingSpinner}
          />

          <h1>
            Loading Match Engine
          </h1>

          <p>
            Loading clubs, players and
            match intelligence...
          </p>
        </main>
      </>
    );
  }

  /* =======================================================
     ERROR
  ======================================================= */

  if (error) {
    return (
      <>
        <Head>
          <title>
            Match Error | New Talents
          </title>
        </Head>

        <main className={styles.errorPage}>
          <div className={styles.errorIcon}>
            ⚠️
          </div>

          <h1>
            Match Error
          </h1>

          <p>{error}</p>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/fixtures"
              )
            }
            className={
              styles.primaryButton
            }
          >
            ← Back to Fixtures
          </button>
        </main>
      </>
    );
  }

  /* =======================================================
     SAFETY CHECK
  ======================================================= */

  if (
    !engine ||
    !snapshot ||
    !homeClub ||
    !awayClub
  ) {
    return null;
  }

  /* =======================================================
     DISPLAY DATA
  ======================================================= */

  const score =
    `${snapshot.homeScore ?? 0} - ${
      snapshot.awayScore ?? 0
    }`;

  const minute =
    snapshot.minute ?? 0;

  const status =
    snapshot.status ||
    MATCH_STATUS.READY;

  const myClub =
    userSide === "home"
      ? homeClub
      : userSide === "away"
      ? awayClub
      : null;

  const isManager =
    Boolean(userSide);

  return (
    <>
      <Head>
        <title>
          {homeClub.name} vs{" "}
          {awayClub.name} | Match Centre
        </title>

        <meta
          name="description"
          content={`Live football match between ${homeClub.name} and ${awayClub.name}.`}
        />
      </Head>

      <main className={styles.page}>
        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={styles.header}
        >
          <button
            type="button"
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

          <div
            className={
              styles.headerTitle
            }
          >
            <span>
              {match?.leagueName ||
                match?.competition ||
                "Football Match"}
            </span>

            <h1>
              Match Centre
            </h1>
          </div>

          <div
            className={
              styles.statusBadge
            }
          >
            {saving
              ? "SAVING"
              : String(
                  status
                ).toUpperCase()}
          </div>
        </header>

        {/* =================================================
            USER CONTROL INFO
        ================================================= */}

        <section
          className={
            styles.managerBanner
          }
        >
          {isManager ? (
            <>
              <span>
                🎮 You manage
              </span>

              <strong>
                {myClub?.name}
              </strong>

              <small>
                {userSide === "home"
                  ? "HOME"
                  : "AWAY"}
              </small>
            </>
          ) : (
            <>
              <span>
                🤖 AI vs AI
              </span>

              <strong>
                You do not manage either
                club in this match.
              </strong>
            </>
          )}
        </section>

        {/* =================================================
            SCOREBOARD
        ================================================= */}

        <section
          className={
            styles.scoreboard
          }
        >
          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={styles.logo}
            >
              {homeClub.logo ? (
                <img
                  src={homeClub.logo}
                  alt={`${homeClub.name} logo`}
                />
              ) : (
                "⚽"
              )}
            </div>

            <strong>
              {homeClub.name}

              {userSide ===
                "home" && " ⭐"}
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
            <small>
              {minute}'
            </small>

            <strong>
              {score}
            </strong>

            <span>
              {String(
                status
              ).replace(
                /_/g,
                " "
              )}
            </span>
          </div>

          <div
            className={
              styles.teamScore
            }
          >
            <div
              className={styles.logo}
            >
              {awayClub.logo ? (
                <img
                  src={awayClub.logo}
                  alt={`${awayClub.name} logo`}
                />
              ) : (
                "⚽"
              )}
            </div>

            <strong>
              {awayClub.name}

              {userSide ===
                "away" && " ⭐"}
            </strong>

            <span>
              AWAY
            </span>
          </div>
        </section>

        {/* =================================================
            MAIN GRID
        ================================================= */}

        <section
          className={
            styles.mainGrid
          }
        >
          {/* =================================================
              PITCH
          ================================================= */}

          <div
            className={
              styles.pitchCard
            }
          >
            <MatchCanvas
              engine={engine}
              snapshot={snapshot}
            />
          </div>

          {/* =================================================
              SIDEBAR
          ================================================= */}

          <aside
            className={
              styles.sidebar
            }
          >
            {/* ===============================================
                CONTROLS
            =============================================== */}

            <section
              className={
                styles.controlCard
              }
            >
              <h2>
                Match Controls
              </h2>

              <div
                className={
                  styles.buttonGrid
                }
              >
                {status ===
                  MATCH_STATUS.READY && (
                  <button
                    type="button"
                    className={
                      styles.primaryButton
                    }
                    onClick={
                      startMatch
                    }
                  >
                    ▶ Start
                  </button>
                )}

                {status ===
                  MATCH_STATUS.LIVE && (
                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    onClick={
                      pauseMatch
                    }
                  >
                    ⏸ Pause
                  </button>
                )}

                {status ===
                  MATCH_STATUS.HALF_TIME && (
                  <button
                    type="button"
                    className={
                      styles.primaryButton
                    }
                    onClick={
                      resumeMatch
                    }
                  >
                    ▶ Resume 2nd Half
                  </button>
                )}

                {status ===
                    MATCH_STATUS.LIVE &&
                  minute < 90 && (
                    <button
                      type="button"
                      className={
                        styles.dangerButton
                      }
                      onClick={
                        stopMatch
                      }
                    >
                      ■ Finish
                    </button>
                  )}

                {status ===
                  MATCH_STATUS.FINISHED && (
                  <div
                    className={
                      styles.finishedMessage
                    }
                  >
                    🏁 Full Time
                  </div>
                )}
              </div>
            </section>

            {/* ===============================================
                TACTICS
            =============================================== */}

            {isManager && (
              <section
                className={
                  styles.tacticsCard
                }
              >
                <h2>
                  Tactics
                  {" — "}
                  {myClub?.name}
                </h2>

                <div
                  className={
                    styles.tacticsGrid
                  }
                >
                  {[
                    [
                      "mentality",
                      "Mentality",
                    ],
                    [
                      "tempo",
                      "Tempo",
                    ],
                    [
                      "pressing",
                      "Pressing",
                    ],
                    [
                      "defensiveLine",
                      "Defensive Line",
                    ],
                    [
                      "width",
                      "Width",
                    ],
                    [
                      "passingStyle",
                      "Passing Style",
                    ],
                  ].map(
                    ([key, label]) => (
                      <div
                        key={key}
                        className={
                          styles.tacticRow
                        }
                      >
                        <label
                          htmlFor={`tactic-${key}`}
                        >
                          {label}
                        </label>

                        <select
                          id={`tactic-${key}`}
                          value={
                            tactics?.[
                              key
                            ] || ""
                          }
                          onChange={e =>
                            updateTactic(
                              key,
                              e.target
                                .value
                            )
                          }
                          disabled={
                            status ===
                            MATCH_STATUS.FINISHED
                          }
                        >
                          {(
                            TACTICAL_VALUES[
                              key
                            ] || []
                          ).map(
                            value => (
                              <option
                                key={
                                  value
                                }
                                value={
                                  value
                                }
                              >
                                {value}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    )
                  )}
                </div>

                <p
                  className={
                    styles.hint
                  }
                >
                  🎯 Tactics zoherezwa
                  muri simulation. AI yo
                  ku rundi ruhande na yo
                  irakina tactics zayo.
                </p>
              </section>
            )}

            {/* ===============================================
                BALL
            =============================================== */}

            <section
              className={
                styles.infoCard
              }
            >
              <span>
                BALL
              </span>

              <strong>
                {ballOwner
                  ? `${ballOwner.name} #${ballOwner.number ?? "-"}`
                  : "Free Ball"}
              </strong>
            </section>

            {/* ===============================================
                STATS
            =============================================== */}

            <section
              className={
                styles.statsCard
              }
            >
              <h2>
                Match Statistics
              </h2>

              <StatRow
                label="Possession"
                home={
                  snapshot.homeStats
                    ?.possession ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.possession ?? 0
                }
                suffix="%"
              />

              <StatRow
                label="Shots"
                home={
                  snapshot.homeStats
                    ?.shots ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.shots ?? 0
                }
              />

              <StatRow
                label="On Target"
                home={
                  snapshot.homeStats
                    ?.shotsOnTarget ??
                  0
                }
                away={
                  snapshot.awayStats
                    ?.shotsOnTarget ??
                  0
                }
              />

              <StatRow
                label="Passes"
                home={
                  snapshot.homeStats
                    ?.passesCompleted ??
                  0
                }
                away={
                  snapshot.awayStats
                    ?.passesCompleted ??
                  0
                }
              />

              <StatRow
                label="Tackles"
                home={
                  snapshot.homeStats
                    ?.tackles ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.tackles ?? 0
                }
              />

              <StatRow
                label="Corners"
                home={
                  snapshot.homeStats
                    ?.corners ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.corners ?? 0
                }
              />

              <StatRow
                label="Fouls"
                home={
                  snapshot.homeStats
                    ?.fouls ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.fouls ?? 0
                }
              />

              <StatRow
                label="Saves"
                home={
                  snapshot.homeStats
                    ?.saves ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.saves ?? 0
                }
              />

              <StatRow
                label="Yellow"
                home={
                  snapshot.homeStats
                    ?.yellow ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.yellow ?? 0
                }
              />

              <StatRow
                label="Red"
                home={
                  snapshot.homeStats
                    ?.red ?? 0
                }
                away={
                  snapshot.awayStats
                    ?.red ?? 0
                }
              />
            </section>

            {/* ===============================================
                EVENTS
            =============================================== */}

            <section
              className={
                styles.eventsCard
              }
            >
              <h2>
                Match Events
              </h2>

              {recentEvents.length ===
              0 ? (
                <p
                  className={
                    styles.empty
                  }
                >
                  No events yet.
                </p>
              ) : (
                recentEvents.map(
                  event => (
                    <div
                      key={
                        event.id
                      }
                      className={
                        styles.event
                      }
                    >
                      <span>
                        {event.minute ?? 0}
                        '
                      </span>

                      <div>
                        <strong>
                          {String(
                            event.type ||
                              "event"
                          ).replace(
                            /_/g,
                            " "
                          )}
                        </strong>

                        <p>
                          {event.detail ||
                            ""}
                        </p>
                      </div>
                    </div>
                  )
                )
              )}
            </section>

            {/* ===============================================
                LINEUPS
            =============================================== */}

            <section
              className={
                styles.benchCard
              }
            >
              <h2>
                Lineups
              </h2>

              <div
                className={
                  styles.lineupGrid
                }
              >
                <LineupCol
                  title={
                    homeClub.name
                  }
                  lineup={
                    snapshot.homeLineup ||
                    []
                  }
                  highlight={
                    userSide ===
                    "home"
                  }
                />

                <LineupCol
                  title={
                    awayClub.name
                  }
                  lineup={
                    snapshot.awayLineup ||
                    []
                  }
                  highlight={
                    userSide ===
                    "away"
                  }
                />
              </div>
            </section>

            {/* ===============================================
                SUBSTITUTIONS
            =============================================== */}

            {isManager && (
              <section
                className={
                  styles.benchCard
                }
              >
                <h2>
                  Substitutions
                  {" — "}
                  {myClub?.name}
                  {" "}
                  ({mySubsUsed}/5)
                </h2>

                <div
                  className={
                    styles.subRow
                  }
                >
                  <select
                    value={subOut}
                    onChange={e =>
                      setSubOut(
                        e.target
                          .value
                      )
                    }
                    disabled={
                      status ===
                      MATCH_STATUS.FINISHED ||
                      mySubsUsed >= 5
                    }
                  >
                    <option value="">
                      — Out —
                    </option>

                    {myLineup
                      .filter(
                        player =>
                          !player.redCard
                      )
                      .map(
                        player => (
                          <option
                            key={
                              player.id
                            }
                            value={
                              player.id
                            }
                          >
                            #
                            {player.number ??
                              "-"}{" "}
                            {
                              player.name
                            }{" "}
                            (
                            {
                              player.position
                            }
                            )
                            {player.injury
                              ? " 🚑"
                              : ""}
                            {player.stamina <
                            40
                              ? " 😓"
                              : ""}
                          </option>
                        )
                      )}
                  </select>

                  <select
                    value={subIn}
                    onChange={e =>
                      setSubIn(
                        e.target
                          .value
                      )
                    }
                    disabled={
                      status ===
                      MATCH_STATUS.FINISHED ||
                      mySubsUsed >= 5
                    }
                  >
                    <option value="">
                      — In —
                    </option>

                    {myBench.map(
                      player => (
                        <option
                          key={
                            player.id
                          }
                          value={
                            player.id
                          }
                        >
                          #
                          {player.number ??
                            "-"}{" "}
                          {
                            player.name
                          }{" "}
                          (
                          {
                            player.position
                          }
                          )
                        </option>
                      )
                    )}
                  </select>

                  <button
                    type="button"
                    className={
                      styles.subButton
                    }
                    onClick={
                      doSub
                    }
                    disabled={
                      !subOut ||
                      !subIn ||
                      mySubsUsed >=
                        5 ||
                      status ===
                        MATCH_STATUS.FINISHED
                    }
                  >
                    Sub
                  </button>
                </div>

                {subMessage && (
                  <p
                    className={
                      styles.hint
                    }
                  >
                    {subMessage}
                  </p>
                )}

                <div
                  className={
                    styles.benchColumns
                  }
                  style={{
                    marginTop: 10,
                  }}
                >
                  {/* MY BENCH */}

                  <div>
                    <h3>
                      Bench (my team)
                    </h3>

                    {myBench.length ===
                    0 ? (
                      <p
                        className={
                          styles.empty
                        }
                      >
                        No bench.
                      </p>
                    ) : (
                      myBench.map(
                        player => (
                          <div
                            key={
                              player.id
                            }
                            className={
                              styles.benchPlayer
                            }
                          >
                            <span>
                              {player.number ??
                                "-"}
                            </span>

                            <label>
                              {
                                player.name
                              }
                            </label>
                          </div>
                        )
                      )
                    )}
                  </div>

                  {/* AI BENCH */}

                  <div>
                    <h3>
                      Bench (AI)
                    </h3>

                    {oppBench.map(
                      player => (
                        <div
                          key={
                            player.id
                          }
                          className={
                            styles.benchPlayer
                          }
                        >
                          <span>
                            {player.number ??
                              "-"}
                          </span>

                          <label>
                            {
                              player.name
                            }
                          </label>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </section>
            )}
          </aside>
        </section>
      </main>
    </>
  );
}

/* =========================================================
   STAT ROW
========================================================= */

function StatRow({
  label,
  home = 0,
  away = 0,
  suffix = "",
}) {
  return (
    <div
      className={styles.statRow}
    >
      <strong>
        {home}
        {suffix}
      </strong>

      <span>
        {label}
      </span>

      <strong>
        {away}
        {suffix}
      </strong>
    </div>
  );
}

/* =========================================================
   LINEUP COLUMN
========================================================= */

function LineupCol({
  title,
  lineup = [],
  highlight = false,
}) {
  return (
    <div
      className={
        styles.lineupColumn
      }
    >
      <h3
        className={
          highlight
            ? styles.userTeamTitle
            : styles.lineupTitle
        }
      >
        {title}

        {highlight && " ⭐"}
      </h3>

      {lineup.length === 0 ? (
        <p
          className={
            styles.empty
          }
        >
          No lineup.
        </p>
      ) : (
        lineup.map(player => (
          <div
            key={player.id}
            className={
              styles.lineupPlayer
            }
          >
            <span
              className={
                styles.playerNumber
              }
            >
              {player.number ??
                "-"}
            </span>

            <div
              className={
                styles.playerInfo
              }
            >
              <strong>
                {player.name}
              </strong>

              <small>
                {player.position ||
                  "PLAYER"}
              </small>
            </div>

            <div
              className={
                styles.playerBadges
              }
            >
              {player.injury && (
                <span
                  title="Injured"
                >
                  🚑
                </span>
              )}

              {player.redCard && (
                <span
                  title="Red card"
                >
                  🟥
                </span>
              )}

              {player.yellowCards >
                0 &&
                !player.redCard && (
                  <span>
                    Y
                    {
                      player.yellowCards
                    }
                  </span>
                )}

              {player.goals > 0 && (
                <span>
                  ⚽
                  {player.goals}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
