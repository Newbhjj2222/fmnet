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
  getDocs,
  query,
  updateDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import {
  FiActivity,
  FiChevronDown,
  FiClock,
  FiEdit3,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiSettings,
  FiUsers,
  FiZap,
} from "react-icons/fi";

import { db } from "../../components/firebase";

import MatchEngine from "../../lib/match-engine/MatchEngine";

import {
  FORMATIONS,
} from "../../lib/match-engine/constants";

import MatchCanvas from "../../components/match/MatchCanvas";

import styles from "./Mach.module.css";

function getValue(
  object,
  fields,
  fallback = null
) {
  for (const field of fields) {
    if (
      object &&
      object[field] !== undefined &&
      object[field] !== null &&
      object[field] !== ""
    ) {
      return object[field];
    }
  }

  return fallback;
}

function normalizePlayer(raw) {
  return {
    ...raw,

    id: String(
      getValue(
        raw,
        ["id", "playerId", "uid"],
        ""
      )
    ),

    name:
      getValue(
        raw,
        [
          "name",
          "fullName",
          "displayName",
        ],
        "Unknown Player"
      ),

    position:
      getValue(
        raw,
        [
          "position",
          "pos",
          "role",
        ],
        "CM"
      ),

    shirtNumber:
      Number(
        getValue(
          raw,
          [
            "shirtNumber",
            "number",
            "jerseyNumber",
            "jersey",
            "squadNumber",
          ],
          0
        )
      ) || 0,
  };
}

async function loadPlayers(
  clubId
) {
  if (!clubId) {
    return [];
  }

  const fields = [
    "clubId",
    "currentClub",
    "teamId",
  ];

  for (const field of fields) {
    try {
      const snap =
        await getDocs(
          query(
            collection(
              db,
              "players"
            ),
            where(
              field,
              "==",
              clubId
            )
          )
        );

      if (!snap.empty) {
        return snap.docs.map(
          (item) =>
            normalizePlayer({
              id: item.id,
              ...item.data(),
            })
        );
      }
    } catch (error) {
      console.warn(
        `Player query failed for ${field}`,
        error
      );
    }
  }

  return [];
}

function normalizeTeam(
  club,
  fallback,
  id
) {
  return {
    id:
      club?.id ||
      id ||
      fallback?.id ||
      "",

    name:
      club?.name ||
      club?.clubName ||
      fallback?.name ||
      "Unknown",

    logo:
      club?.logo ||
      club?.logoUrl ||
      fallback?.logo ||
      "",
  };
}

export default function MatchPage() {
  const router =
    useRouter();

  const {
    id: matchId,
  } = router.query;

  const engineRef =
    useRef(null);

  const frameRef =
    useRef(null);

  const saveTimerRef =
    useRef(null);

  const lastFrameRef =
    useRef(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [match, setMatch] =
    useState(null);

  const [snapshot, setSnapshot] =
    useState(null);

  const [selectedFormationHome, setSelectedFormationHome] =
    useState("4-4-2");

  const [selectedFormationAway, setSelectedFormationAway] =
    useState("4-4-2");

  const [homeTactics, setHomeTactics] =
    useState({
      mentality: "balanced",
      pressing: "medium",
      tempo: "medium",
      width: 55,
      defensiveLine: 50,
      passingStyle: "mixed",
      counterAttack: true,
    });

  const [awayTactics, setAwayTactics] =
    useState({
      mentality: "balanced",
      pressing: "medium",
      tempo: "medium",
      width: 55,
      defensiveLine: 50,
      passingStyle: "mixed",
      counterAttack: true,
    });

  const [speed, setSpeed] =
    useState(1);

  const [tab, setTab] =
    useState("match");

  const [showTactics, setShowTactics] =
    useState(false);

  const loadMatch =
    useCallback(async () => {
      if (!matchId) return;

      try {
        setLoading(true);
        setError("");

        const matchRef =
          doc(
            db,
            "matches",
            String(matchId)
          );

        const matchSnap =
          await getDoc(
            matchRef
          );

        if (!matchSnap.exists()) {
          throw new Error(
            "Match not found"
          );
        }

        const matchData = {
          id:
            matchSnap.id,
          ...matchSnap.data(),
        };

        setMatch(
          matchData
        );

        const homeClubId =
          getValue(
            matchData,
            [
              "homeClubId",
              "homeTeamId",
              "homeClub",
            ]
          );

        const awayClubId =
          getValue(
            matchData,
            [
              "awayClubId",
              "awayTeamId",
              "awayClub",
            ]
          );

        let homeClub = null;
        let awayClub = null;

        if (homeClubId) {
          const snap =
            await getDoc(
              doc(
                db,
                "clubs",
                String(
                  homeClubId
                )
              )
            );

          if (snap.exists()) {
            homeClub = {
              id: snap.id,
              ...snap.data(),
            };
          }
        }

        if (awayClubId) {
          const snap =
            await getDoc(
              doc(
                db,
                "clubs",
                String(
                  awayClubId
                )
              )
            );

          if (snap.exists()) {
            awayClub = {
              id: snap.id,
              ...snap.data(),
            };
          }
        }

        const homeTeam =
          normalizeTeam(
            homeClub,
            {
              id: homeClubId,
              name:
                getValue(
                  matchData,
                  [
                    "homeTeamName",
                    "homeClubName",
                    "homeTeam",
                  ],
                  "Home"
                ),
            },
            homeClubId
          );

        const awayTeam =
          normalizeTeam(
            awayClub,
            {
              id: awayClubId,
              name:
                getValue(
                  matchData,
                  [
                    "awayTeamName",
                    "awayClubName",
                    "awayTeam",
                  ],
                  "Away"
                ),
            },
            awayClubId
          );

        let homePlayers =
          Array.isArray(
            matchData.homePlayers
          )
            ? matchData.homePlayers.map(
                normalizePlayer
              )
            : [];

        let awayPlayers =
          Array.isArray(
            matchData.awayPlayers
          )
            ? matchData.awayPlayers.map(
                normalizePlayer
              )
            : [];

        if (
          homePlayers.length <
          11
        ) {
          homePlayers =
            await loadPlayers(
              homeClubId
            );
        }

        if (
          awayPlayers.length <
          11
        ) {
          awayPlayers =
            await loadPlayers(
              awayClubId
            );
        }

        if (
          homePlayers.length <
          11 ||
          awayPlayers.length <
          11
        ) {
          throw new Error(
            "One team does not have at least 11 players in the database."
          );
        }

        const savedHomeFormation =
          matchData.homeFormation ||
          "4-4-2";

        const savedAwayFormation =
          matchData.awayFormation ||
          "4-4-2";

        const savedHomeTactics =
          matchData.homeTactics ||
          {};

        const savedAwayTactics =
          matchData.awayTactics ||
          {};

        setSelectedFormationHome(
          savedHomeFormation
        );

        setSelectedFormationAway(
          savedAwayFormation
        );

        setHomeTactics(
          (old) => ({
            ...old,
            ...savedHomeTactics,
          })
        );

        setAwayTactics(
          (old) => ({
            ...old,
            ...savedAwayTactics,
          })
        );

        const engine =
          new MatchEngine({
            matchId,

            homeTeam,
            awayTeam,

            homePlayers,
            awayPlayers,

            homeFormation:
              savedHomeFormation,

            awayFormation:
              savedAwayFormation,

            homeTactics:
              savedHomeTactics,

            awayTactics:
              savedAwayTactics,

            durationSeconds: 240,

            initialScore: {
              home:
                Number(
                  matchData.homeScore ||
                  0
                ),

              away:
                Number(
                  matchData.awayScore ||
                  0
                ),
            },

            initialMinute:
              Number(
                matchData.minute ||
                0
              ),

            onEvent: () => {},
          });

        engineRef.current =
          engine;

        setSnapshot(
          engine.getSnapshot()
        );
      } catch (err) {
        console.error(err);

        setError(
          err.message ||
          "Failed to load match"
        );
      } finally {
        setLoading(false);
      }
    }, [matchId]);

  useEffect(() => {
    loadMatch();

    return () => {
      if (
        frameRef.current
      ) {
        cancelAnimationFrame(
          frameRef.current
        );
      }

      if (
        saveTimerRef.current
      ) {
        clearInterval(
          saveTimerRef.current
        );
      }
    };
  }, [loadMatch]);

  const saveLive =
    useCallback(async () => {
      const engine =
        engineRef.current;

      if (
        !engine ||
        !matchId
      ) {
        return;
      }

      try {
        const state =
          engine.getSnapshot();

        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            status:
              "live",

            homeScore:
              state.score.home,

            awayScore:
              state.score.away,

            minute:
              state.minute,

            liveStats:
              state.stats,

            updatedAt:
              serverTimestamp(),
          }
        );
      } catch (err) {
        console.error(
          "Live save error",
          err
        );
      }
    }, [matchId]);

  const saveFinal =
    useCallback(async () => {
      const engine =
        engineRef.current;

      if (
        !engine ||
        !matchId
      ) {
        return;
      }

      const result =
        engine.getResult();

      try {
        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            status:
              "finished",

            minute: 90,

            homeScore:
              result.homeScore,

            awayScore:
              result.awayScore,

            homeStats:
              result.stats.home,

            awayStats:
              result.stats.away,

            stats:
              result.stats,

            events:
              result.events,

            playerStats:
              result.players,

            result:
              result.result,

            finishedAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),
          }
        );
      } catch (err) {
        console.error(
          "Final save error",
          err
        );
      }
    }, [matchId]);

  useEffect(() => {
    if (!snapshot) return;

    if (
      snapshot.finished
    ) {
      saveFinal();
    }
  }, [
    snapshot,
    saveFinal,
  ]);

  useEffect(() => {
    saveTimerRef.current =
      setInterval(
        saveLive,
        10000
      );

    return () => {
      clearInterval(
        saveTimerRef.current
      );
    };
  }, [saveLive]);

  const gameLoop =
    useCallback(
      (timestamp) => {
        const engine =
          engineRef.current;

        if (!engine) {
          return;
        }

        if (
          !lastFrameRef.current
        ) {
          lastFrameRef.current =
            timestamp;
        }

        const realDt =
          Math.min(
            (timestamp -
              lastFrameRef.current) /
              1000,
            0.05
          );

        lastFrameRef.current =
          timestamp;

        if (engine.running) {
          const dt =
            realDt * speed;

          engine.update(dt);

          setSnapshot(
            engine.getSnapshot()
          );
        }

        frameRef.current =
          requestAnimationFrame(
            gameLoop
          );
      },
      [speed]
    );

  useEffect(() => {
    frameRef.current =
      requestAnimationFrame(
        gameLoop
      );

    return () => {
      if (
        frameRef.current
      ) {
        cancelAnimationFrame(
          frameRef.current
        );
      }
    };
  }, [gameLoop]);

  const toggleMatch =
    () => {
      const engine =
        engineRef.current;

      if (!engine) return;

      if (engine.running) {
        engine.pause();
      } else {
        engine.start();
      }

      setSnapshot(
        engine.getSnapshot()
      );
    };

  const resetMatch =
    async () => {
      if (
        frameRef.current
      ) {
        cancelAnimationFrame(
          frameRef.current
        );
      }

      engineRef.current =
        null;

      setSnapshot(null);

      await loadMatch();
    };

  const changeFormation =
    async (
      team,
      formation
    ) => {
      if (team === "home") {
        setSelectedFormationHome(
          formation
        );

        if (
          engineRef.current
        ) {
          engineRef.current.homeTeam.formation =
            formation;

          engineRef.current.prepareTeam(
            "home"
          );
        }

        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            homeFormation:
              formation,
            updatedAt:
              serverTimestamp(),
          }
        );
      } else {
        setSelectedFormationAway(
          formation
        );

        if (
          engineRef.current
        ) {
          engineRef.current.awayTeam.formation =
            formation;

          engineRef.current.prepareTeam(
            "away"
          );
        }

        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            awayFormation:
              formation,
            updatedAt:
              serverTimestamp(),
          }
        );
      }

      setSnapshot(
        engineRef.current?.getSnapshot()
      );
    };

  const changeTactic =
    async (
      team,
      key,
      value
    ) => {
      const tactics =
        team === "home"
          ? homeTactics
          : awayTactics;

      const updated = {
        ...tactics,
        [key]: value,
      };

      if (team === "home") {
        setHomeTactics(
          updated
        );

        if (
          engineRef.current
        ) {
          engineRef.current.homeTeam.tactics =
            updated;
        }

        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            homeTactics:
              updated,
            updatedAt:
              serverTimestamp(),
          }
        );
      } else {
        setAwayTactics(
          updated
        );

        if (
          engineRef.current
        ) {
          engineRef.current.awayTeam.tactics =
            updated;
        }

        await updateDoc(
          doc(
            db,
            "matches",
            String(matchId)
          ),
          {
            awayTactics:
              updated,
            updatedAt:
              serverTimestamp(),
          }
        );
      }

      setSnapshot(
        engineRef.current?.getSnapshot()
      );
    };

  const homePlayers =
    snapshot?.players?.home ||
    [];

  const awayPlayers =
    snapshot?.players?.away ||
    [];

  const events =
    snapshot?.events || [];

  const homeStats =
    snapshot?.stats?.home;

  const awayStats =
    snapshot?.stats?.away;

  const formatTime =
    (minute, second) =>
      `${String(
        minute || 0
      ).padStart(2, "0")}:${String(
        second || 0
      ).padStart(2, "0")}`;

  if (loading) {
    return (
      <div
        className={
          styles.loading
        }
      >
        <FiRefreshCw
          className={
            styles.spin
          }
        />

        <span>
          Loading real teams and
          players...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={
          styles.error
        }
      >
        <h2>
          Match Error
        </h2>

        <p>{error}</p>

        <button
          className={
            styles.primaryButton
          }
          onClick={
            loadMatch
          }
        >
          <FiRefreshCw />
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {snapshot?.teams?.home
            ?.name ||
            "Home"}{" "}
          vs{" "}
          {snapshot?.teams?.away
            ?.name ||
            "Away"}{" "}
          | Virtual Football
          Manager
        </title>

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.scoreboard
          }
        >
          <div
            className={
              styles.teamName
            }
          >
            <span>
              {
                snapshot?.teams
                  ?.home?.name
              }
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
              {
                snapshot?.score
                  ?.home || 0
              }

              <span>
                -
              </span>

              {
                snapshot?.score
                  ?.away || 0
              }
            </div>

            <div
              className={
                styles.matchClock
              }
            >
              <FiClock />

              {formatTime(
                snapshot?.minute,
                snapshot?.second
              )}
            </div>
          </div>

          <div
            className={
              styles.teamName
            }
          >
            <span>
              {
                snapshot?.teams
                  ?.away?.name
              }
            </span>
          </div>
        </section>

        <section
          className={
            styles.toolbar
          }
        >
          <button
            className={
              styles.primaryButton
            }
            onClick={
              toggleMatch
            }
          >
            {snapshot?.running ? (
              <>
                <FiPause />
                Pause
              </>
            ) : (
              <>
                <FiPlay />
                Play
              </>
            )}
          </button>

          <button
            className={
              styles.secondaryButton
            }
            onClick={
              resetMatch
            }
          >
            <FiRefreshCw />
            Reset
          </button>

          <button
            className={
              styles.secondaryButton
            }
            onClick={() =>
              setShowTactics(
                !showTactics
              )
            }
          >
            <FiSettings />
            Tactics
          </button>

          <div
            className={
              styles.speedBox
            }
          >
            <FiZap />

            {[1, 2, 4, 8].map(
              (value) => (
                <button
                  key={value}
                  className={
                    speed === value
                      ? styles.speedActive
                      : styles.speedButton
                  }
                  onClick={() =>
                    setSpeed(
                      value
                    )
                  }
                >
                  {value}x
                </button>
              )
            )}
          </div>
        </section>

        {showTactics && (
          <section
            className={
              styles.tacticsPanel
            }
          >
            <TacticsTeam
              title={
                snapshot?.teams
                  ?.home?.name
              }
              team="home"
              formation={
                selectedFormationHome
              }
              tactics={
                homeTactics
              }
              onFormation={
                changeFormation
              }
              onTactic={
                changeTactic
              }
            />

            <TacticsTeam
              title={
                snapshot?.teams
                  ?.away?.name
              }
              team="away"
              formation={
                selectedFormationAway
              }
              tactics={
                awayTactics
              }
              onFormation={
                changeFormation
              }
              onTactic={
                changeTactic
              }
            />
          </section>
        )}

        <section
          className={
            styles.pitchSection
          }
        >
          <MatchCanvas
            snapshot={
              snapshot
            }
          />
        </section>

        <section
          className={
            styles.contentGrid
          }
        >
          <div
            className={
              styles.mainPanel
            }
          >
            <div
              className={
                styles.tabs
              }
            >
              <button
                className={
                  tab === "match"
                    ? styles.activeTab
                    : styles.tab
                }
                onClick={() =>
                  setTab("match")
                }
              >
                <FiActivity />
                Events
              </button>

              <button
                className={
                  tab === "stats"
                    ? styles.activeTab
                    : styles.tab
                }
                onClick={() =>
                  setTab("stats")
                }
              >
                <FiActivity />
                Statistics
              </button>

              <button
                className={
                  tab === "lineup"
                    ? styles.activeTab
                    : styles.tab
                }
                onClick={() =>
                  setTab("lineup")
                }
              >
                <FiUsers />
                Lineup
              </button>
            </div>

            {tab === "match" && (
              <Events
                events={
                  events
                }
              />
            )}

            {tab === "stats" && (
              <Statistics
                home={
                  homeStats
                }
                away={
                  awayStats
                }
                homeName={
                  snapshot?.teams
                    ?.home?.name
                }
                awayName={
                  snapshot?.teams
                    ?.away?.name
                }
              />
            )}

            {tab === "lineup" && (
              <Lineups
                home={
                  homePlayers
                }
                away={
                  awayPlayers
                }
                homeName={
                  snapshot?.teams
                    ?.home?.name
                }
                awayName={
                  snapshot?.teams
                    ?.away?.name
                }
              />
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function TacticsTeam({
  title,
  team,
  formation,
  tactics,
  onFormation,
  onTactic,
}) {
  return (
    <div
      className={
        styles.tacticsTeam
      }
    >
      <div
        className={
          styles.panelTitle
        }
      >
        <FiSettings />
        {title}
      </div>

      <label>
        Formation
      </label>

      <select
        value={formation}
        onChange={(e) =>
          onFormation(
            team,
            e.target.value
          )
        }
      >
        {Object.keys(
          FORMATIONS
        ).map(
          (formationName) => (
            <option
              key={
                formationName
              }
              value={
                formationName
              }
            >
              {
                formationName
              }
            </option>
          )
        )}
      </select>

      <label>
        Mentality
      </label>

      <select
        value={
          tactics.mentality
        }
        onChange={(e) =>
          onTactic(
            team,
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

      <label>
        Pressing
      </label>

      <select
        value={
          tactics.pressing
        }
        onChange={(e) =>
          onTactic(
            team,
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

      <label>
        Tempo
      </label>

      <select
        value={
          tactics.tempo
        }
        onChange={(e) =>
          onTactic(
            team,
            "tempo",
            e.target.value
          )
        }
      >
        <option value="slow">
          Slow
        </option>

        <option value="medium">
          Medium
        </option>

        <option value="fast">
          Fast
        </option>
      </select>

      <label>
        Width:{" "}
        {tactics.width}
      </label>

      <input
        type="range"
        min="20"
        max="90"
        value={
          tactics.width
        }
        onChange={(e) =>
          onTactic(
            team,
            "width",
            Number(
              e.target.value
            )
          )
        }
      />

      <label>
        Defensive line:{" "}
        {tactics.defensiveLine}
      </label>

      <input
        type="range"
        min="20"
        max="90"
        value={
          tactics.defensiveLine
        }
        onChange={(e) =>
          onTactic(
            team,
            "defensiveLine",
            Number(
              e.target.value
            )
          )
        }
      />

      <label
        className={
          styles.checkRow
        }
      >
        <input
          type="checkbox"
          checked={
            !!tactics.counterAttack
          }
          onChange={(e) =>
            onTactic(
              team,
              "counterAttack",
              e.target.checked
            )
          }
        />

        Counter Attack
      </label>
    </div>
  );
}

function Events({
  events,
}) {
  if (!events.length) {
    return (
      <div
        className={
          styles.empty
        }
      >
        Match events will appear
        here...
      </div>
    );
  }

  return (
    <div
      className={
        styles.events
      }
    >
      {events
        .slice()
        .reverse()
        .map((event) => (
          <div
            key={event.id}
            className={
              styles.event
            }
          >
            <div
              className={
                styles.eventTime
              }
            >
              {event.minute}'
            </div>

            <div
              className={
                styles.eventIcon
              }
            >
              {event.type ===
              "goal"
                ? "⚽"
                : event.type ===
                  "yellow"
                ? "🟨"
                : event.type ===
                  "red"
                ? "🟥"
                : event.type ===
                  "save"
                ? "🧤"
                : event.type ===
                  "substitution"
                ? "🔄"
                : event.type ===
                  "corner"
                ? "◢"
                : event.type ===
                  "offside"
                ? "🚩"
                : "•"}
            </div>

            <div
              className={
                styles.eventText
              }
            >
              {event.text}
            </div>
          </div>
        ))}
    </div>
  );
}

function Statistics({
  home,
  away,
  homeName,
  awayName,
}) {
  const rows = [
    ["Possession", `${Math.round(home?.possession || 0)}%`, `${Math.round(away?.possession || 0)}%`],
    ["Shots", home?.shots || 0, away?.shots || 0],
    ["Shots on target", home?.shotsOnTarget || 0, away?.shotsOnTarget || 0],
    ["xG", Number(home?.xG || 0).toFixed(2), Number(away?.xG || 0).toFixed(2)],
    ["Passes", home?.passes || 0, away?.passes || 0],
    ["Completed passes", home?.completedPasses || 0, away?.completedPasses || 0],
    ["Tackles", home?.tackles || 0, away?.tackles || 0],
    ["Interceptions", home?.interceptions || 0, away?.interceptions || 0],
    ["Fouls", home?.fouls || 0, away?.fouls || 0],
    ["Corners", home?.corners || 0, away?.corners || 0],
    ["Offsides", home?.offsides || 0, away?.offsides || 0],
    ["Saves", home?.saves || 0, away?.saves || 0],
    ["Yellow cards", home?.yellowCards || 0, away?.yellowCards || 0],
    ["Red cards", home?.redCards || 0, away?.redCards || 0],
  ];

  return (
    <div
      className={
        styles.statistics
      }
    >
      <div
        className={
          styles.statHeader
        }
      >
        <strong>
          {homeName}
        </strong>

        <span>
          STATISTICS
        </span>

        <strong>
          {awayName}
        </strong>
      </div>

      {rows.map(
        (row) => (
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
        )
      )}
    </div>
  );
}

function Lineups({
  home,
  away,
  homeName,
  awayName,
}) {
  return (
    <div
      className={
        styles.lineups
      }
    >
      <LineupTeam
        name={
          homeName
        }
        players={
          home
        }
        side="home"
      />

      <LineupTeam
        name={
          awayName
        }
        players={
          away
        }
        side="away"
      />
    </div>
  );
}

function LineupTeam({
  name,
  players,
}) {
  return (
    <div
      className={
        styles.lineupTeam
      }
    >
      <h3>
        {name}
      </h3>

      {players.map(
        (player) => (
          <div
            key={
              player.id
            }
            className={
              styles.playerRow
            }
          >
            <span
              className={
                styles.playerNumber
              }
            >
              {
                player.number
              }
            </span>

            <div
              className={
                styles.playerInfo
              }
            >
              <strong>
                {
                  player.name
                }
              </strong>

              <small>
                {
                  player.position
                }
              </small>
            </div>

            <div
              className={
                styles.playerStats
              }
            >
              {player.goals >
                0 && (
                <span>
                  ⚽{" "}
                  {
                    player.goals
                  }
                </span>
              )}

              {player.assists >
                0 && (
                <span>
                  A{" "}
                  {
                    player.assists
                  }
                </span>
              )}

              {player.yellow && (
                <span>
                  🟨
                </span>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
