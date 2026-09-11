// pages/match/[id].js

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
  FaExchangeAlt,
  FaFutbol,
  FaPause,
  FaPlay,
  FaSave,
  FaSlidersH,
  FaUsers,
} from "react-icons/fa";

import { db } from "../../components/firebase";

import MatchEngine from "../../lib/match-engine/MatchEngine";

import MatchCanvas from "../../components/match/MatchCanvas";

import {
  FORMATIONS,
} from "../../lib/match-engine/constants";

import styles from "./Mach.module.css";

function firstValue(
  object,
  fields,
  fallback = null
) {
  for (const field of fields) {
    if (
      object &&
      object[field] !== undefined &&
      object[field] !== null
    ) {
      return object[field];
    }
  }

  return fallback;
}

function normalizePlayer(raw, id) {
  return {
    id:
      raw.id ||
      id,

    name:
      raw.name ||
      raw.fullName ||
      raw.displayName ||
      "Unknown",

    number:
      firstValue(
        raw,
        [
          "shirtNumber",
          "number",
          "jerseyNumber",
        ],
        0
      ),

    position:
      firstValue(
        raw,
        [
          "position",
          "pos",
          "role",
        ],
        "CM"
      ),

    overall:
      firstValue(
        raw,
        [
          "overall",
          "rating",
          "ova",
        ],
        60
      ),

    speed:
      firstValue(
        raw,
        [
          "speed",
          "pace",
        ],
        65
      ),

    acceleration:
      firstValue(
        raw,
        [
          "acceleration",
        ],
        65
      ),

    stamina:
      firstValue(
        raw,
        [
          "stamina",
          "fitness",
        ],
        90
      ),

    passing:
      firstValue(
        raw,
        [
          "passing",
          "pass",
        ],
        55
      ),

    shooting:
      firstValue(
        raw,
        [
          "shooting",
          "finishing",
          "shoot",
        ],
        55
      ),

    dribbling:
      firstValue(
        raw,
        [
          "dribbling",
          "dribble",
        ],
        55
      ),

    tackling:
      firstValue(
        raw,
        [
          "tackling",
          "defending",
          "defense",
        ],
        50
      ),

    positioning:
      firstValue(
        raw,
        [
          "positioning",
        ],
        55
      ),

    vision:
      firstValue(
        raw,
        [
          "vision",
        ],
        55
      ),

    decisionMaking:
      firstValue(
        raw,
        [
          "decisionMaking",
          "decisions",
        ],
        55
      ),

    composure:
      firstValue(
        raw,
        [
          "composure",
        ],
        55
      ),

    reaction:
      firstValue(
        raw,
        [
          "reaction",
        ],
        60
      ),

    handling:
      firstValue(
        raw,
        [
          "handling",
        ],
        60
      ),

    diving:
      firstValue(
        raw,
        [
          "diving",
        ],
        60
      ),

    catching:
      firstValue(
        raw,
        [
          "catching",
        ],
        60
      ),

    parrying:
      firstValue(
        raw,
        [
          "parrying",
        ],
        60
      ),
  };
}

function sortStartingXI(
  players,
  formation
) {
  const positions =
    FORMATIONS[
      formation
    ] ||
    FORMATIONS["4-3-3"];

  const list = [
    ...players,
  ];

  const selected = [];

  const take = (
    predicate
  ) => {
    const index =
      list.findIndex(
        predicate
      );

    if (index >= 0) {
      const player =
        list.splice(
          index,
          1
        )[0];

      selected.push(
        player
      );

      return player;
    }

    return null;
  };

  take((p) =>
    String(
      p.position
    )
      .toUpperCase()
      .includes("GK")
  );

  const defenderSlots =
    positions.filter(
      (p) =>
        [
          "CB",
          "LB",
          "RB",
          "LWB",
          "RWB",
        ].includes(p.role)
    ).length;

  const midfielderSlots =
    positions.filter(
      (p) =>
        [
          "CM",
          "CDM",
          "CAM",
          "LM",
          "RM",
        ].includes(p.role)
    ).length;

  const attackerSlots =
    positions.filter(
      (p) =>
        [
          "ST",
          "CF",
          "LW",
          "RW",
        ].includes(p.role)
    ).length;

  for (
    let i = 0;
    i < defenderSlots;
    i++
  ) {
    take((p) =>
      [
        "CB",
        "LB",
        "RB",
        "LWB",
        "RWB",
        "DF",
      ].includes(
        String(
          p.position
        ).toUpperCase()
      )
    );
  }

  for (
    let i = 0;
    i < midfielderSlots;
    i++
  ) {
    take((p) =>
      [
        "CM",
        "CDM",
        "CAM",
        "LM",
        "RM",
        "DM",
        "AM",
        "MF",
      ].includes(
        String(
          p.position
        ).toUpperCase()
      )
    );
  }

  for (
    let i = 0;
    i < attackerSlots;
    i++
  ) {
    take((p) =>
      [
        "ST",
        "CF",
        "LW",
        "RW",
        "LF",
        "RF",
        "FW",
      ].includes(
        String(
          p.position
        ).toUpperCase()
      )
    );
  }

  while (
    selected.length <
      positions.length &&
    list.length
  ) {
    selected.push(
      list.shift()
    );
  }

  return {
    starting: selected.slice(
      0,
      11
    ),
    bench: list.slice(
      0,
      7
    ),
  };
}

async function getPlayersForClub(
  clubId,
  embeddedPlayers = []
) {
  if (
    Array.isArray(
      embeddedPlayers
    ) &&
    embeddedPlayers.length
  ) {
    return embeddedPlayers.map(
      (p, index) =>
        normalizePlayer(
          p,
          p.id ||
            `embedded-${index}`
        )
    );
  }

  const attempts = [
    "clubId",
    "currentClub",
    "teamId",
  ];

  for (const field of attempts) {
    try {
      const q =
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
        );

      const snap =
        await getDocs(q);

      if (
        !snap.empty
      ) {
        return snap.docs.map(
          (d) =>
            normalizePlayer(
              d.data(),
              d.id
            )
        );
      }
    } catch (error) {
      console.error(
        `Player query ${field} failed`,
        error
      );
    }
  }

  return [];
}

async function getClub(
  clubId,
  embedded
) {
  if (
    embedded &&
    typeof embedded ===
      "object"
  ) {
    return {
      id: clubId,
      name:
        embedded.name ||
        embedded.clubName ||
        "Club",
      logo:
        embedded.logo ||
        embedded.logoUrl ||
        "",
    };
  }

  if (!clubId) {
    return {
      id: "",
      name: "Club",
      logo: "",
    };
  }

  const snap =
    await getDoc(
      doc(
        db,
        "clubs",
        clubId
      )
    );

  if (!snap.exists()) {
    return {
      id: clubId,
      name: "Club",
      logo: "",
    };
  }

  const data =
    snap.data();

  return {
    id: clubId,
    name:
      data.name ||
      data.clubName ||
      data.title ||
      "Club",
    logo:
      data.logo ||
      data.logoUrl ||
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

  const animationRef =
    useRef(null);

  const lastTimeRef =
    useRef(null);

  const saveTimerRef =
    useRef(0);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [snapshot, setSnapshot] =
    useState(null);

  const [paused, setPaused] =
    useState(false);

  const [selectedTab, setSelectedTab] =
    useState("match");

  const [selectedTeam, setSelectedTeam] =
    useState("home");

  const [formation, setFormation] =
    useState({
      home: "4-3-3",
      away: "4-3-3",
    });

  const [tactics, setTactics] =
    useState({
      home: {
        mentality:
          "balanced",
        pressing:
          "medium",
        width: 55,
        defensiveLine: 50,
        tempo: 55,
        passingStyle:
          "mixed",
        attackingFocus:
          "balanced",
        counterAttack:
          true,
      },

      away: {
        mentality:
          "balanced",
        pressing:
          "medium",
        width: 55,
        defensiveLine: 50,
        tempo: 55,
        passingStyle:
          "mixed",
        attackingFocus:
          "balanced",
        counterAttack:
          true,
      },
    });

  const loadMatch =
    useCallback(
      async () => {
        if (!matchId) {
          return;
        }

        setLoading(true);
        setError("");

        try {
          const matchSnap =
            await getDoc(
              doc(
                db,
                "matches",
                matchId
              )
            );

          if (
            !matchSnap.exists()
          ) {
            throw new Error(
              "Match ntibonetse muri database."
            );
          }

          const match =
            matchSnap.data();

          const homeClubId =
            firstValue(
              match,
              [
                "homeClubId",
                "homeTeamId",
                "homeClub",
              ]
            );

          const awayClubId =
            firstValue(
              match,
              [
                "awayClubId",
                "awayTeamId",
                "awayClub",
              ]
            );

          const [
            homeClub,
            awayClub,
          ] =
            await Promise.all([
              getClub(
                homeClubId,
                match.homeTeam
              ),

              getClub(
                awayClubId,
                match.awayTeam
              ),
            ]);

          const [
            homePlayers,
            awayPlayers,
          ] =
            await Promise.all([
              getPlayersForClub(
                homeClubId,
                match.homePlayers
              ),

              getPlayersForClub(
                awayClubId,
                match.awayPlayers
              ),
            ]);

          if (
            homePlayers.length <
              11 ||
            awayPlayers.length <
              11
          ) {
            throw new Error(
              `Abakinnyi ntibahagije. Home=${homePlayers.length}, Away=${awayPlayers.length}. Reba collection players na clubId.`
            );
          }

          const homeFormation =
            match.homeFormation ||
            "4-3-3";

          const awayFormation =
            match.awayFormation ||
            "4-3-3";

          const homeTactics =
            match.homeTactics ||
            {};

          const awayTactics =
            match.awayTactics ||
            {};

          setFormation({
            home:
              homeFormation,
            away:
              awayFormation,
          });

          setTactics({
            home: {
              ...tactics.home,
              ...homeTactics,
            },

            away: {
              ...tactics.away,
              ...awayTactics,
            },
          });

          const homeXI =
            Array.isArray(
              match.homeLineupIds
            ) &&
            match.homeLineupIds.length
              ? homePlayers.filter(
                  (p) =>
                    match.homeLineupIds.includes(
                      p.id
                    )
                )
              : null;

          const awayXI =
            Array.isArray(
              match.awayLineupIds
            ) &&
            match.awayLineupIds.length
              ? awayPlayers.filter(
                  (p) =>
                    match.awayLineupIds.includes(
                      p.id
                    )
                )
              : null;

          const selectedHome =
            homeXI &&
            homeXI.length >= 11
              ? {
                  starting:
                    homeXI.slice(
                      0,
                      11
                    ),
                  bench:
                    homePlayers.filter(
                      (p) =>
                        !homeXI.some(
                          (x) =>
                            x.id ===
                            p.id
                        )
                    ),
                }
              : sortStartingXI(
                  homePlayers,
                  homeFormation
                );

          const selectedAway =
            awayXI &&
            awayXI.length >= 11
              ? {
                  starting:
                    awayXI.slice(
                      0,
                      11
                    ),
                  bench:
                    awayPlayers.filter(
                      (p) =>
                        !awayXI.some(
                          (x) =>
                            x.id ===
                            p.id
                        )
                    ),
                }
              : sortStartingXI(
                  awayPlayers,
                  awayFormation
                );

          const engine =
            new MatchEngine({
              matchId,

              homeTeam: {
                ...homeClub,
                allPlayers:
                  homePlayers,
              },

              awayTeam: {
                ...awayClub,
                allPlayers:
                  awayPlayers,
              },

              homePlayers:
                selectedHome.starting,

              awayPlayers:
                selectedAway.starting,

              homeFormation,
              awayFormation,

              homeTactics,
              awayTactics,

              initialHomeScore:
                Number(
                  match.homeScore || 0
                ),

              initialAwayScore:
                Number(
                  match.awayScore || 0
                ),

              initialMinute:
                Number(
                  match.minute || 0
                ),
            });

          engineRef.current =
            engine;

          setSnapshot(
            engine.getSnapshot()
          );

          await updateDoc(
            doc(
              db,
              "matches",
              matchId
            ),
            {
              status: "live",

              homeFormation,
              awayFormation,

              homeTactics,
              awayTactics,

              homeLineupIds:
                selectedHome.starting.map(
                  (p) => p.id
                ),

              awayLineupIds:
                selectedAway.starting.map(
                  (p) => p.id
                ),

              startedAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(err);

          setError(
            err.message ||
              "Match loading error."
          );
        } finally {
          setLoading(false);
        }
      },
      [matchId]
    );

  useEffect(() => {
    loadMatch();

    return () => {
      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }
    };
  }, [loadMatch]);

  const saveLive =
    useCallback(
      async () => {
        const engine =
          engineRef.current;

        if (
          !engine ||
          !matchId
        ) {
          return;
        }

        const data =
          engine.getSnapshot();

        try {
          await updateDoc(
            doc(
              db,
              "matches",
              matchId
            ),
            {
              status:
                data.status,

              minute:
                data.minute,

              homeScore:
                data.score.home,

              awayScore:
                data.score.away,

              homeStats:
                data.stats.home,

              awayStats:
                data.stats.away,

              events:
                data.events,

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            "Live save error:",
            err
          );
        }
      },
      [matchId]
    );

  const saveFinal =
    useCallback(
      async () => {
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
              matchId
            ),
            {
              status: "finished",

              minute: 90,

              homeScore:
                result.homeScore,

              awayScore:
                result.awayScore,

              result:
                result.result,

              homeStats:
                result.stats.home,

              awayStats:
                result.stats.away,

              homeLineup:
                result.homeLineup,

              awayLineup:
                result.awayLineup,

              events:
                result.events,

              finishedAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp(),
            }
          );
        } catch (err) {
          console.error(
            "Final save error:",
            err
          );
        }
      },
      [matchId]
    );

  const loop =
    useCallback(
      (time) => {
        const engine =
          engineRef.current;

        if (!engine) {
          animationRef.current =
            requestAnimationFrame(
              loop
            );

          return;
        }

        if (
          lastTimeRef.current ===
          null
        ) {
          lastTimeRef.current =
            time;
        }

        let dt =
          (
            time -
            lastTimeRef.current
          ) / 1000;

        lastTimeRef.current =
          time;

        dt = Math.min(
          dt,
          0.05
        );

        if (!paused) {
          engine.update(dt);

          saveTimerRef.current +=
            dt;

          if (
            saveTimerRef.current >
            8
          ) {
            saveTimerRef.current =
              0;

            saveLive();
          }

          setSnapshot(
            engine.getSnapshot()
          );

          if (
            engine.status ===
            "finished"
          ) {
            saveFinal();

            return;
          }
        }

        animationRef.current =
          requestAnimationFrame(
            loop
          );
      },
      [
        paused,
        saveLive,
        saveFinal,
      ]
    );

  useEffect(() => {
    if (
      loading ||
      !engineRef.current
    ) {
      return;
    }

    lastTimeRef.current =
      null;

    animationRef.current =
      requestAnimationFrame(
        loop
      );

    return () => {
      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }
    };
  }, [
    loading,
    loop,
  ]);

  const changeFormation =
    (team, value) => {
      setFormation(
        (old) => ({
          ...old,
          [team]: value,
        })
      );

      engineRef.current?.setFormation(
        team,
        value
      );

      setSnapshot(
        engineRef.current?.getSnapshot()
      );
    };

  const changeTactic =
    (team, field, value) => {
      setTactics(
        (old) => ({
          ...old,

          [team]: {
            ...old[team],
            [field]: value,
          },
        })
      );

      engineRef.current?.setTactics(
        team,
        {
          [field]: value,
        }
      );
    };

  const stats =
    snapshot?.stats;

  const recentEvents =
    snapshot?.events
      ?.slice()
      .reverse() || [];

  const activePlayers =
    useMemo(
      () =>
        snapshot?.players || [],
      [snapshot]
    );

  if (loading) {
    return (
      <div className={styles.loading}>
        <div
          className={
            styles.loader
          }
        />

        <p>
          Match irimo gutegurwa...
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
        <h2>Match Error</h2>

        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {snapshot?.homeTeam?.name}
          {" vs "}
          {snapshot?.awayTeam?.name}
          {" | Virtual Football Manager"}
        </title>

        <meta
          name="description"
          content="Real-time 2D football match simulation"
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
              styles.team
            }
          >
            {snapshot.homeTeam.logo ? (
              <img
                src={
                  snapshot.homeTeam.logo
                }
                alt=""
              />
            ) : (
              <div
                className={
                  styles.logoFallback
                }
              >
                H
              </div>
            )}

            <strong>
              {snapshot.homeTeam.name}
            </strong>
          </div>

          <div
            className={
              styles.scoreCenter
            }
          >
            <span>
              {snapshot.minute}'
            </span>

            <strong>
              {snapshot.score.home}
              {" - "}
              {snapshot.score.away}
            </strong>

            <small>
              {snapshot.status}
            </small>
          </div>

          <div
            className={
              styles.team
            }
          >
            <strong>
              {snapshot.awayTeam.name}
            </strong>

            {snapshot.awayTeam.logo ? (
              <img
                src={
                  snapshot.awayTeam.logo
                }
                alt=""
              />
            ) : (
              <div
                className={
                  styles.logoFallback
                }
              >
                A
              </div>
            )}
          </div>
        </section>

        <section
          className={
            styles.canvasCard
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
            styles.controls
          }
        >
          <button
            onClick={() =>
              setPaused(
                (value) =>
                  !value
              )
            }
          >
            {paused ? (
              <FaPlay />
            ) : (
              <FaPause />
            )}

            {paused
              ? " Komeza"
              : " Pause"}
          </button>

          <button
            onClick={() =>
              setSelectedTab(
                "lineup"
              )
            }
          >
            <FaUsers />
            Lineup
          </button>

          <button
            onClick={() =>
              setSelectedTab(
                "tactics"
              )
            }
          >
            <FaSlidersH />
            Tactics
          </button>

          <button
            onClick={saveLive}
          >
            <FaSave />
            Save
          </button>
        </section>

        <section
          className={
            styles.tabs
          }
        >
          <button
            className={
              selectedTab ===
              "match"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setSelectedTab(
                "match"
              )
            }
          >
            Match
          </button>

          <button
            className={
              selectedTab ===
              "lineup"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setSelectedTab(
                "lineup"
              )
            }
          >
            Lineup
          </button>

          <button
            className={
              selectedTab ===
              "tactics"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setSelectedTab(
                "tactics"
              )
            }
          >
            Tactics
          </button>

          <button
            className={
              selectedTab ===
              "stats"
                ? styles.activeTab
                : ""
            }
            onClick={() =>
              setSelectedTab(
                "stats"
              )
            }
          >
            Statistics
          </button>
        </section>

        {selectedTab ===
          "match" && (
          <section
            className={
              styles.matchGrid
            }
          >
            <div
              className={
                styles.card
              }
            >
              <h3>
                <FaFutbol />
                Match Events
              </h3>

              <div
                className={
                  styles.events
                }
              >
                {recentEvents.length ===
                0 ? (
                  <p
                    className={
                      styles.muted
                    }
                  >
                    Umukino uracyatangira...
                  </p>
                ) : (
                  recentEvents.map(
                    (event) => (
                      <div
                        key={
                          event.id
                        }
                        className={
                          styles.event
                        }
                      >
                        <span>
                          {event.minute}'
                        </span>

                        <strong>
                          {event.type ===
                          "goal"
                            ? "⚽"
                            : event.type ===
                              "yellow"
                            ? "🟨"
                            : event.type ===
                              "red"
                            ? "🟥"
                            : "•"}
                        </strong>

                        <p>
                          {event.text}
                        </p>
                      </div>
                    )
                  )
                )}
              </div>
            </div>

            <div
              className={
                styles.card
              }
            >
              <h3>
                Statistics
              </h3>

              <StatRow
                label="Possession"
                home={
                  stats.home.possession
                }
                away={
                  stats.away.possession
                }
                suffix="%"
              />

              <StatRow
                label="Shots"
                home={
                  stats.home.shots
                }
                away={
                  stats.away.shots
                }
              />

              <StatRow
                label="Shots on target"
                home={
                  stats.home.shotsOnTarget
                }
                away={
                  stats.away.shotsOnTarget
                }
              />

              <StatRow
                label="Passes"
                home={
                  stats.home.completedPasses
                }
                away={
                  stats.away.completedPasses
                }
              />

              <StatRow
                label="Tackles"
                home={
                  stats.home.tackles
                }
                away={
                  stats.away.tackles
                }
              />

              <StatRow
                label="Corners"
                home={
                  stats.home.corners
                }
                away={
                  stats.away.corners
                }
              />

              <StatRow
                label="Fouls"
                home={
                  stats.home.fouls
                }
                away={
                  stats.away.fouls
                }
              />

              <StatRow
                label="xG"
                home={
                  stats.home.xg.toFixed(
                    2
                  )
                }
                away={
                  stats.away.xg.toFixed(
                    2
                  )
                }
              />
            </div>
          </section>
        )}

        {selectedTab ===
          "lineup" && (
          <LineupPanel
            snapshot={
              snapshot
            }

            selectedTeam={
              selectedTeam
            }

            setSelectedTeam={
              setSelectedTeam
            }
          />
        )}

        {selectedTab ===
          "tactics" && (
          <TacticsPanel
            snapshot={
              snapshot
            }

            formation={
              formation
            }

            tactics={
              tactics
            }

            changeFormation={
              changeFormation
            }

            changeTactic={
              changeTactic
            }
          />
        )}

        {selectedTab ===
          "stats" && (
          <section
            className={
              styles.card
            }
          >
            <h2>
              Full Match Statistics
            </h2>

            <div
              className={
                styles.fullStats
              }
            >
              <StatRow
                label="Goals"
                home={
                  stats.home.goals
                }
                away={
                  stats.away.goals
                }
              />

              <StatRow
                label="Possession"
                home={
                  stats.home.possession.toFixed(
                    1
                  )
                }
                away={
                  stats.away.possession.toFixed(
                    1
                  )
                }
                suffix="%"
              />

              <StatRow
                label="Passes attempted"
                home={
                  stats.home.passes
                }
                away={
                  stats.away.passes
                }
              />

              <StatRow
                label="Passes completed"
                home={
                  stats.home.completedPasses
                }
                away={
                  stats.away.completedPasses
                }
              />

              <StatRow
                label="Shots"
                home={
                  stats.home.shots
                }
                away={
                  stats.away.shots
                }
              />

              <StatRow
                label="Shots on target"
                home={
                  stats.home.shotsOnTarget
                }
                away={
                  stats.away.shotsOnTarget
                }
              />

              <StatRow
                label="xG"
                home={
                  stats.home.xg.toFixed(
                    2
                  )
                }
                away={
                  stats.away.xg.toFixed(
                    2
                  )
                }
              />

              <StatRow
                label="Tackles"
                home={
                  stats.home.tackles
                }
                away={
                  stats.away.tackles
                }
              />

              <StatRow
                label="Interceptions"
                home={
                  stats.home.interceptions
                }
                away={
                  stats.away.interceptions
                }
              />

              <StatRow
                label="Saves"
                home={
                  stats.home.saves
                }
                away={
                  stats.away.saves
                }
              />

              <StatRow
                label="Corners"
                home={
                  stats.home.corners
                }
                away={
                  stats.away.corners
                }
              />

              <StatRow
                label="Fouls"
                home={
                  stats.home.fouls
                }
                away={
                  stats.away.fouls
                }
              />

              <StatRow
                label="Offsides"
                home={
                  stats.home.offsides
                }
                away={
                  stats.away.offsides
                }
              />

              <StatRow
                label="Yellow cards"
                home={
                  stats.home.yellowCards
                }
                away={
                  stats.away.yellowCards
                }
              />

              <StatRow
                label="Red cards"
                home={
                  stats.home.redCards
                }
                away={
                  stats.away.redCards
                }
              />
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function StatRow({
  label,
  home,
  away,
  suffix = "",
}) {
  return (
    <div
      className={
        styles.statRow
      }
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

function LineupPanel({
  snapshot,
  selectedTeam,
  setSelectedTeam,
}) {
  const players =
    snapshot.players.filter(
      (p) =>
        p.team ===
        selectedTeam
    );

  return (
    <section
      className={
        styles.card
      }
    >
      <div
        className={
          styles.panelHeader
        }
      >
        <h2>
          <FaUsers />
          Starting XI
        </h2>

        <div
          className={
            styles.teamSwitch
          }
        >
          <button
            className={
              selectedTeam ===
              "home"
                ? styles.activeButton
                : ""
            }
            onClick={() =>
              setSelectedTeam(
                "home"
              )
            }
          >
            {
              snapshot.homeTeam
                .name
            }
          </button>

          <button
            className={
              selectedTeam ===
              "away"
                ? styles.activeButton
                : ""
            }
            onClick={() =>
              setSelectedTeam(
                "away"
              )
            }
          >
            {
              snapshot.awayTeam
                .name
            }
          </button>
        </div>
      </div>

      <div
        className={
          styles.lineupGrid
        }
      >
        {players.map(
          (player) => (
            <div
              key={
                player.id
              }
              className={
                styles.playerCard
              }
            >
              <div
                className={
                  styles.playerNumber
                }
              >
                {player.number}
              </div>

              <div>
                <strong>
                  {player.name}
                </strong>

                <small>
                  {player.position}
                  {" • "}
                  {player.stamina.toFixed(
                    0
                  )}
                  %
                </small>
              </div>

              {player.hasBall && (
                <span
                  className={
                    styles.ballMark
                  }
                >
                  ⚽
                </span>
              )}
            </div>
          )
        )}
      </div>

      <h3>
        Bench
      </h3>

      <div
        className={
          styles.benchGrid
        }
      >
        {snapshot.bench[
          selectedTeam
        ].map(
          (player) => (
            <div
              key={
                player.id
              }
              className={
                styles.benchPlayer
              }
            >
              <span>
                {player.number}
              </span>

              <div>
                <strong>
                  {player.name}
                </strong>

                <small>
                  {player.position}
                  {" • "}
                  OVR{" "}
                  {player.overall}
                </small>
              </div>

              <FaExchangeAlt />
            </div>
          )
        )}
      </div>
    </section>
  );
}

function TacticsPanel({
  snapshot,
  formation,
  tactics,
  changeFormation,
  changeTactic,
}) {
  return (
    <section
      className={
        styles.card
      }
    >
      <h2>
        <FaSlidersH />
        Tactical Management
      </h2>

      <div
        className={
          styles.tacticsTeam
        }
      >
        <h3>
          {snapshot.homeTeam.name}
        </h3>

        <TacticsEditor
          team="home"
          formation={
            formation.home
          }
          tactics={
            tactics.home
          }
          changeFormation={
            changeFormation
          }
          changeTactic={
            changeTactic
          }
        />
      </div>

      <div
        className={
          styles.tacticsTeam
        }
      >
        <h3>
          {snapshot.awayTeam.name}
        </h3>

        <TacticsEditor
          team="away"
          formation={
            formation.away
          }
          tactics={
            tactics.away
          }
          changeFormation={
            changeFormation
          }
          changeTactic={
            changeTactic
          }
        />
      </div>
    </section>
  );
}

function TacticsEditor({
  team,
  formation,
  tactics,
  changeFormation,
  changeTactic,
}) {
  return (
    <div
      className={
        styles.tacticsGrid
      }
    >
      <label>
        Formation

        <select
          value={formation}
          onChange={(e) =>
            changeFormation(
              team,
              e.target.value
            )
          }
        >
          {Object.keys(
            FORMATIONS
          ).map(
            (value) => (
              <option
                key={value}
                value={value}
              >
                {value}
              </option>
            )
          )}
        </select>
      </label>

      <label>
        Mentality

        <select
          value={
            tactics.mentality
          }
          onChange={(e) =>
            changeTactic(
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
      </label>

      <label>
        Pressing

        <select
          value={
            tactics.pressing
          }
          onChange={(e) =>
            changeTactic(
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
      </label>

      <label>
        Passing style

        <select
          value={
            tactics.passingStyle
          }
          onChange={(e) =>
            changeTactic(
              team,
              "passingStyle",
              e.target.value
            )
          }
        >
          <option value="short">
            Short
          </option>

          <option value="mixed">
            Mixed
          </option>

          <option value="long">
            Long
          </option>
        </select>
      </label>

      <label>
        Attacking focus

        <select
          value={
            tactics.attackingFocus
          }
          onChange={(e) =>
            changeTactic(
              team,
              "attackingFocus",
              e.target.value
            )
          }
        >
          <option value="balanced">
            Balanced
          </option>

          <option value="wings">
            Wings
          </option>

          <option value="middle">
            Middle
          </option>

          <option value="counter">
            Counter
          </option>
        </select>
      </label>

      <label>
        Width
        <input
          type="range"
          min="20"
          max="90"
          value={
            tactics.width
          }
          onChange={(e) =>
            changeTactic(
              team,
              "width",
              Number(
                e.target.value
              )
            )
          }
        />
        <span>
          {tactics.width}
        </span>
      </label>

      <label>
        Defensive line
        <input
          type="range"
          min="20"
          max="90"
          value={
            tactics.defensiveLine
          }
          onChange={(e) =>
            changeTactic(
              team,
              "defensiveLine",
              Number(
                e.target.value
              )
            )
          }
        />
        <span>
          {
            tactics.defensiveLine
          }
        </span>
      </label>

      <label>
        Tempo
        <input
          type="range"
          min="20"
          max="90"
          value={
            tactics.tempo
          }
          onChange={(e) =>
            changeTactic(
              team,
              "tempo",
              Number(
                e.target.value
              )
            )
          }
        />
        <span>
          {tactics.tempo}
        </span>
      </label>

      <label
        className={
          styles.checkbox
        }
      >
        <input
          type="checkbox"
          checked={
            tactics.counterAttack
          }
          onChange={(e) =>
            changeTactic(
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
