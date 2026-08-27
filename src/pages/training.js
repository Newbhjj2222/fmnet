import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRouter } from "next/router";
import Head from "next/head";

import { useAuth } from "../context/AuthContext";
import { db } from "../components/firebase";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

import toast from "react-hot-toast";
import styles from "./training.module.css";

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_PLAYERS_PER_DRILL = 10;
const MAX_DRILLS_PER_DAY = 3;

/*
  Training does NOT advance the game calendar.

  The current game date must come from:
  careerData.currentDate

  Example:
  2026-08-27
*/

const CORE_ATTRIBUTES = [
  "pace",
  "shooting",
  "passing",
  "dribbling",
  "defending",
  "goalkeeping",
];

const EXTRA_ATTRIBUTES = [
  "finishing",
  "stamina",
  "physical",
  "tackling",
  "vision",
  "technique",
  "reflexes",
  "positioning",
  "teamwork",
  "heading",
  "crossing",
];

const ALL_TRAINING_ATTRIBUTES = [
  ...CORE_ATTRIBUTES,
  ...EXTRA_ATTRIBUTES,
];

/* =========================================================
   TRAINING DRILLS
========================================================= */

const TRAINING_DRILLS = {
  attacking: {
    id: "attacking",
    name: "Attacking Drill",
    icon: "⚽",
    color: "#38bdf8",
    description:
      "Improve attacking movement, shooting and dribbling.",
    effects: {
      shooting: { min: 1, max: 2 },
      dribbling: { min: 0, max: 1 },
      pace: { min: 0, max: 1 },
      finishing: { min: 0, max: 1 },
    },
    duration: 2,
    category: "attack",
  },

  defending: {
    id: "defending",
    name: "Defending Drill",
    icon: "🛡️",
    color: "#ef4444",
    description:
      "Improve defending, tackling and defensive positioning.",
    effects: {
      defending: { min: 1, max: 2 },
      physical: { min: 0, max: 1 },
      tackling: { min: 0, max: 1 },
      positioning: { min: 0, max: 1 },
    },
    duration: 2,
    category: "defense",
  },

  passing: {
    id: "passing",
    name: "Passing Drill",
    icon: "🦶",
    color: "#22c55e",
    description:
      "Improve passing accuracy, vision and technique.",
    effects: {
      passing: { min: 1, max: 2 },
      vision: { min: 0, max: 1 },
      technique: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: "midfield",
  },

  fitness: {
    id: "fitness",
    name: "Fitness Training",
    icon: "💪",
    color: "#f59e0b",
    description:
      "Improve stamina, physical condition and pace.",
    effects: {
      pace: { min: 0, max: 1 },
      stamina: { min: 1, max: 2 },
      physical: { min: 0, max: 1 },
    },
    duration: 1,
    category: "physical",
  },

  shooting: {
    id: "shooting",
    name: "Shooting Practice",
    icon: "🎯",
    color: "#ec4899",
    description:
      "Improve shooting and finishing ability.",
    effects: {
      shooting: { min: 1, max: 2 },
      finishing: { min: 0, max: 1 },
      technique: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: "attack",
  },

  goalkeeper: {
    id: "goalkeeper",
    name: "Goalkeeper Training",
    icon: "🧤",
    color: "#8b5cf6",
    description:
      "Improve goalkeeping, reflexes and positioning.",
    effects: {
      goalkeeping: { min: 1, max: 2 },
      reflexes: { min: 0, max: 1 },
      positioning: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: "goalkeeper",
  },

  tactics: {
    id: "tactics",
    name: "Tactical Session",
    icon: "📋",
    color: "#14b8a6",
    description:
      "Improve tactical awareness and teamwork.",
    effects: {
      passing: { min: 0, max: 1 },
      vision: { min: 0, max: 1 },
      positioning: { min: 0, max: 1 },
      teamwork: { min: 0, max: 1 },
    },
    duration: 2,
    category: "tactical",
  },

  set_pieces: {
    id: "set_pieces",
    name: "Set Piece Practice",
    icon: "🚩",
    color: "#f97316",
    description:
      "Improve free kicks, corners and finishing.",
    effects: {
      shooting: { min: 0, max: 1 },
      passing: { min: 0, max: 1 },
      finishing: { min: 0, max: 1 },
      technique: { min: 0, max: 1 },
    },
    duration: 1,
    category: "attack",
  },

  recovery: {
    id: "recovery",
    name: "Recovery Session",
    icon: "🧊",
    color: "#06b6d4",
    description:
      "Recover stamina and physical condition.",
    effects: {
      stamina: { min: 1, max: 2 },
      physical: { min: 0, max: 1 },
    },
    duration: 1,
    category: "physical",
  },

  agility: {
    id: "agility",
    name: "Agility Training",
    icon: "🏃",
    color: "#a3e635",
    description:
      "Improve pace, dribbling and physical movement.",
    effects: {
      pace: { min: 1, max: 2 },
      dribbling: { min: 0, max: 1 },
      physical: { min: 0, max: 1 },
    },
    duration: 1,
    category: "physical",
  },

  heading: {
    id: "heading",
    name: "Heading Practice",
    icon: "🎯",
    color: "#fbbf24",
    description:
      "Improve heading and aerial positioning.",
    effects: {
      heading: { min: 1, max: 2 },
      physical: { min: 0, max: 1 },
      positioning: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: "attack",
  },

  crossing: {
    id: "crossing",
    name: "Crossing Drill",
    icon: "🔄",
    color: "#fb923c",
    description:
      "Improve crossing, passing and technique.",
    effects: {
      passing: { min: 1, max: 2 },
      crossing: { min: 0, max: 1 },
      technique: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: "midfield",
  },
};

/* =========================================================
   DAYS
========================================================= */

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    player?.displayName ||
    `${player?.firstName || ""} ${
      player?.lastName || ""
    }`.trim() ||
    "Unknown Player"
  );
}

function getPlayerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    "MID"
  );
}

function getPlayerOverall(player) {
  return safeNumber(
    player?.overall ??
      player?.rating ??
      player?.overallRating,
    0
  );
}

function createId(prefix = "item") {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/* =========================================================
   GAME DATE HELPERS
========================================================= */

function normalizeGameDate(value) {
  if (!value) return null;

  if (
    typeof value === "object" &&
    typeof value.toDate === "function"
  ) {
    const date = value.toDate();

    return date.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})/
    );

    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}

function getDayIndexFromGameDate(gameDate) {
  if (!gameDate) return 0;

  const parts = gameDate.split("-").map(Number);

  if (parts.length !== 3) return 0;

  const [year, month, day] = parts;

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  /*
    JavaScript:
    Sunday = 0
    Monday = 1

    Our system:
    Monday = 0
    ...
    Sunday = 6
  */

  const jsDay = date.getUTCDay();

  return jsDay === 0 ? 6 : jsDay - 1;
}

/* =========================================================
   NORMALIZE SCHEDULE
========================================================= */

function normalizeSchedule(rawSchedule) {
  if (
    !rawSchedule ||
    typeof rawSchedule !== "object"
  ) {
    return {};
  }

  const normalized = {};

  for (let day = 0; day < 7; day += 1) {
    const rawDay = rawSchedule[day];

    if (!Array.isArray(rawDay)) continue;

    const slots = rawDay
      .map((slot) => {
        if (
          !slot ||
          typeof slot !== "object"
        ) {
          return null;
        }

        if (
          !TRAINING_DRILLS[slot.drillId]
        ) {
          return null;
        }

        return {
          id:
            slot.id ||
            createId("drill"),

          drillId: slot.drillId,

          playerIds: Array.isArray(
            slot.playerIds
          )
            ? [
                ...new Set(
                  slot.playerIds.map(String)
                ),
              ].slice(
                0,
                MAX_PLAYERS_PER_DRILL
              )
            : [],
        };
      })
      .filter(Boolean)
      .slice(0, MAX_DRILLS_PER_DAY);

    if (slots.length > 0) {
      normalized[day] = slots;
    }
  }

  return normalized;
}

/* =========================================================
   SMALL TRAINING GAIN
========================================================= */

function calculateTrainingGain(
  currentValue,
  range
) {
  const current = safeNumber(
    currentValue,
    0
  );

  if (current >= 99) {
    return 0;
  }

  /*
    We deliberately keep development small.

    Most training:
      +1

    Sometimes:
      +2

    Never:
      +3/+4/+5 in one normal session.
  */

  const roll =
    Math.random() *
      (range.max - range.min + 1) +
    range.min;

  let gain = Math.floor(roll);

  if (gain > 2) {
    gain = 2;
  }

  return Math.min(
    gain,
    99 - current
  );
}

/* =========================================================
   OVERALL CALCULATION
========================================================= */

function calculateNewOverall(player) {
  const currentOverall =
    getPlayerOverall(player);

  /*
    Overall moves very slowly.

    Only +1 is possible per training application.
    Sometimes it stays the same.

    This prevents players from becoming
    99 OVR after three training sessions,
    because apparently humans enjoy breaking games.
  */

  const shouldIncrease =
    Math.random() < 0.45;

  if (!shouldIncrease) {
    return currentOverall;
  }

  return Math.min(
    currentOverall + 1,
    99
  );
}

/* =========================================================
   APPLY DRILL TO PLAYER
========================================================= */

function trainPlayer(
  player,
  drills
) {
  const updated = {
    ...player,
  };

  for (const drill of drills) {
    if (!drill) continue;

    Object.entries(
      drill.effects
    ).forEach(
      ([attribute, range]) => {
        const gain =
          calculateTrainingGain(
            updated[attribute],
            range
          );

        if (gain <= 0) return;

        updated[attribute] =
          safeNumber(
            updated[attribute],
            0
          ) + gain;

        updated[attribute] =
          Math.min(
            updated[attribute],
            99
          );
      }
    );
  }

  updated.overall =
    calculateNewOverall(updated);

  updated.rating =
    updated.overall;

  return updated;
}

/* =========================================================
   PAGE
========================================================= */

export default function TrainingPage() {
  const router = useRouter();

  const {
    user,
    loading,
  } = useAuth();

  const [
    careerData,
    setCareerData,
  ] = useState(null);

  const [
    clubInfo,
    setClubInfo,
  ] = useState(null);

  const [
    players,
    setPlayers,
  ] = useState([]);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    schedule,
    setSchedule,
  ] = useState({});

  const [
    selectedDay,
    setSelectedDay,
  ] = useState(0);

  const [
    selectedSlot,
    setSelectedSlot,
  ] = useState(null);

  const [
    drillFilter,
    setDrillFilter,
  ] = useState("all");

  const scheduleRef =
    useRef({});

  const aiProcessingRef =
    useRef(false);

  /* =======================================================
     CURRENT GAME DATE
  ======================================================= */

  const currentGameDate = useMemo(
    () =>
      normalizeGameDate(
        careerData?.currentDate
      ),
    [careerData?.currentDate]
  );

  /* =======================================================
     CURRENT GAME DAY
  ======================================================= */

  const currentGameDayIndex = useMemo(
    () =>
      getDayIndexFromGameDate(
        currentGameDate
      ),
    [currentGameDate]
  );

  /* =======================================================
     SYNC SCHEDULE REF
  ======================================================= */

  useEffect(() => {
    scheduleRef.current =
      schedule;
  }, [schedule]);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    fetchTrainingData();
  }, [
    user,
    loading,
    router,
  ]);

  /* =======================================================
     FETCH TRAINING DATA
  ======================================================= */

  const fetchTrainingData =
    async () => {
      if (!user) return;

      try {
        setIsLoading(true);

        const userRef = doc(
          db,
          "users",
          user.uid
        );

        const userSnapshot =
          await getDoc(userRef);

        if (
          !userSnapshot.exists()
        ) {
          toast.error(
            "User account not found"
          );
          return;
        }

        const userData =
          userSnapshot.data();

        const career =
          userData.careerData ||
          {};

        setCareerData(career);

        if (!career.currentClub) {
          setPlayers([]);
          setSchedule({});
          scheduleRef.current = {};
          return;
        }

        /* =================================================
           CLUB
        ================================================= */

        const clubRef = doc(
          db,
          "clubs",
          career.currentClub
        );

        const clubSnapshot =
          await getDoc(clubRef);

        if (
          clubSnapshot.exists()
        ) {
          setClubInfo({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }

        /* =================================================
           PLAYERS

           NO YOUTH FILTER.
           Everyone belongs to the squad.
        ================================================= */

        const playersQuery =
          query(
            collection(
              db,
              "players"
            ),
            where(
              "clubId",
              "==",
              career.currentClub
            )
          );

        const playersSnapshot =
          await getDocs(
            playersQuery
          );

        const playerList = [];

        playersSnapshot.forEach(
          (playerDoc) => {
            playerList.push({
              id: playerDoc.id,
              ...playerDoc.data(),
            });
          }
        );

        playerList.sort(
          (a, b) =>
            getPlayerOverall(b) -
            getPlayerOverall(a)
        );

        setPlayers(playerList);

        /* =================================================
           SCHEDULE
        ================================================= */

        const normalized =
          normalizeSchedule(
            career.trainingSchedule
          );

        setSchedule(normalized);

        scheduleRef.current =
          normalized;

        /*
          Select today's game-calendar day,
          not Monday by default.
        */

        if (
          career.currentDate
        ) {
          setSelectedDay(
            getDayIndexFromGameDate(
              normalizeGameDate(
                career.currentDate
              )
            )
          );
        }
      } catch (error) {
        console.error(
          "Error fetching training data:",
          error
        );

        toast.error(
          "Failed to load training data"
        );
      } finally {
        setIsLoading(false);
      }
    };

  /* =======================================================
     SAVE SCHEDULE
  ======================================================= */

  const saveScheduleToFirestore =
    useCallback(
      async (
        scheduleToSave
      ) => {
        if (
          !user ||
          !careerData?.currentClub
        ) {
          return false;
        }

        try {
          const savedAt =
            new Date().toISOString();

          await updateDoc(
            doc(
              db,
              "users",
              user.uid
            ),
            {
              "careerData.trainingSchedule":
                scheduleToSave,

              "careerData.trainingScheduleUpdatedAt":
                savedAt,

              updatedAt:
                serverTimestamp(),
            }
          );

          setCareerData(
            (previous) => ({
              ...(previous || {}),

              trainingSchedule:
                scheduleToSave,

              trainingScheduleUpdatedAt:
                savedAt,
            })
          );

          return true;
        } catch (error) {
          console.error(
            "Save schedule error:",
            error
          );

          return false;
        }
      },
      [
        user,
        careerData?.currentClub,
      ]
    );

  /* =======================================================
     AUTO SAVE
  ======================================================= */

  useEffect(() => {
    if (
      isLoading ||
      !user ||
      !careerData?.currentClub
    ) {
      return;
    }

    const timer =
      setTimeout(() => {
        saveScheduleToFirestore(
          scheduleRef.current
        );
      }, 700);

    return () =>
      clearTimeout(timer);
  }, [
    schedule,
    isLoading,
    user,
    careerData?.currentClub,
    saveScheduleToFirestore,
  ]);

  /* =======================================================
     UPDATE SCHEDULE
  ======================================================= */

  const updateSchedule =
    useCallback(
      (updater) => {
        setSchedule(
          (previous) => {
            const next =
              typeof updater ===
              "function"
                ? updater(previous)
                : updater;

            scheduleRef.current =
              next;

            return next;
          }
        );
      },
      []
    );

  /* =======================================================
     ADD DRILL
  ======================================================= */

  const addDrillToDay =
    useCallback(
      (
        dayIndex,
        drillId
      ) => {
        const drill =
          TRAINING_DRILLS[
            drillId
          ];

        if (!drill) return;

        updateSchedule(
          (previous) => {
            const daySlots =
              Array.isArray(
                previous[dayIndex]
              )
                ? [
                    ...previous[
                      dayIndex
                    ],
                  ]
                : [];

            if (
              daySlots.length >=
              MAX_DRILLS_PER_DAY
            ) {
              toast.error(
                "Maximum 3 drills per day"
              );

              return previous;
            }

            daySlots.push({
              id: createId(
                "drill"
              ),

              drillId,

              playerIds: [],
            });

            return {
              ...previous,
              [dayIndex]:
                daySlots,
            };
          }
        );

        toast.success(
          `${drill.name} added to ${DAY_NAMES[dayIndex]}`
        );
      },
      [updateSchedule]
    );

  /* =======================================================
     ADD PLAYER
  ======================================================= */

  const addPlayerToDrill =
    useCallback(
      (
        dayIndex,
        slotId,
        playerId
      ) => {
        updateSchedule(
          (previous) => {
            const daySlots =
              Array.isArray(
                previous[dayIndex]
              )
                ? previous[
                    dayIndex
                  ]
                : [];

            const target =
              daySlots.find(
                (slot) =>
                  slot.id ===
                  slotId
              );

            if (!target) {
              return previous;
            }

            if (
              target.playerIds
                .length >=
              MAX_PLAYERS_PER_DRILL
            ) {
              toast.error(
                `Maximum ${MAX_PLAYERS_PER_DRILL} players per drill`
              );

              return previous;
            }

            if (
              target.playerIds.includes(
                playerId
              )
            ) {
              toast.error(
                "Player already in this drill"
              );

              return previous;
            }

            return {
              ...previous,

              [dayIndex]:
                daySlots.map(
                  (slot) =>
                    slot.id ===
                    slotId
                      ? {
                          ...slot,
                          playerIds:
                            [
                              ...slot.playerIds,
                              playerId,
                            ],
                        }
                      : slot
                ),
            };
          }
        );
      },
      [updateSchedule]
    );

  /* =======================================================
     REMOVE DRILL
  ======================================================= */

  const removeDrillFromDay =
    useCallback(
      (
        dayIndex,
        slotId
      ) => {
        updateSchedule(
          (previous) => {
            const daySlots =
              Array.isArray(
                previous[dayIndex]
              )
                ? previous[
                    dayIndex
                  ]
                : [];

            return {
              ...previous,

              [dayIndex]:
                daySlots.filter(
                  (slot) =>
                    slot.id !==
                    slotId
                ),
            };
          }
        );
      },
      [updateSchedule]
    );

  /* =======================================================
     REMOVE PLAYER
  ======================================================= */

  const removePlayerFromDrill =
    useCallback(
      (
        dayIndex,
        slotId,
        playerId
      ) => {
        updateSchedule(
          (previous) => {
            const daySlots =
              Array.isArray(
                previous[dayIndex]
              )
                ? previous[
                    dayIndex
                  ]
                : [];

            return {
              ...previous,

              [dayIndex]:
                daySlots.map(
                  (slot) =>
                    slot.id ===
                    slotId
                      ? {
                          ...slot,

                          playerIds:
                            slot.playerIds.filter(
                              (id) =>
                                id !==
                                playerId
                            ),
                        }
                      : slot
                ),
            };
          }
        );
      },
      [updateSchedule]
    );

  /* =======================================================
     MANUAL SAVE
  ======================================================= */

  const saveTrainingSchedule =
    async () => {
      if (
        !user ||
        !careerData?.currentClub
      ) {
        toast.error(
          "No active club found"
        );
        return;
      }

      try {
        setSaving(true);

        const success =
          await saveScheduleToFirestore(
            scheduleRef.current
          );

        if (success) {
          toast.success(
            "Training schedule saved"
          );
        } else {
          toast.error(
            "Could not save training schedule"
          );
        }
      } finally {
        setSaving(false);
      }
    };

  /* =======================================================
     APPLY USER TRAINING
  ======================================================= */

  const applyTraining =
    async () => {
      if (
        !user ||
        !careerData?.currentClub ||
        !clubInfo
      ) {
        toast.error(
          "No active club found"
        );

        return;
      }

      if (!currentGameDate) {
        toast.error(
          "Game date is not available"
        );

        return;
      }

      /*
        IMPORTANT:

        Training is only for the current
        game calendar date.

        It does NOT advance currentDate.
      */

      const trainingDay =
        getDayIndexFromGameDate(
          currentGameDate
        );

      const todaySlots =
        Array.isArray(
          scheduleRef.current[
            trainingDay
          ]
        )
          ? scheduleRef.current[
              trainingDay
            ]
          : [];

      if (
        todaySlots.length === 0
      ) {
        toast.error(
          `No training scheduled for ${DAY_NAMES[trainingDay]}`
        );

        return;
      }

      /*
        Prevent duplicate training
        on the same game date.
      */

      if (
        careerData.lastTrainingGameDate ===
        currentGameDate
      ) {
        toast.error(
          "Training has already been applied for this game date"
        );

        return;
      }

      try {
        setSaving(true);

        const playerUpdates =
          {};

        todaySlots.forEach(
          (slot) => {
            const drill =
              TRAINING_DRILLS[
                slot.drillId
              ];

            if (!drill) return;

            (
              slot.playerIds || []
            ).forEach(
              (playerId) => {
                const player =
                  players.find(
                    (item) =>
                      item.id ===
                      playerId
                  );

                if (!player) {
                  return;
                }

                if (
                  !playerUpdates[
                    playerId
                  ]
                ) {
                  playerUpdates[
                    playerId
                  ] = {
                    ...player,
                    __drills: [],
                  };
                }

                playerUpdates[
                  playerId
                ].__drills.push(
                  drill
                );
              }
            );
          }
        );

        const ids =
          Object.keys(
            playerUpdates
          );

        if (ids.length === 0) {
          toast.error(
            "No players assigned to today's training"
          );

          return;
        }

        /*
          Firestore batch has a limit.
          This prevents crashes if the squad
          becomes large later.
        */

        let batch =
          writeBatch(db);

        let batchCount = 0;

        const commitBatch =
          async () => {
            if (batchCount > 0) {
              await batch.commit();
            }

            batch =
              writeBatch(db);

            batchCount = 0;
          };

        const finalPlayers =
          [];

        for (const id of ids) {
          const original =
            playerUpdates[id];

          const drills =
            original.__drills ||
            [];

          const updated =
            trainPlayer(
              original,
              drills
            );

          delete updated.__drills;

          const playerRef =
            doc(
              db,
              "players",
              id
            );

          const firestoreUpdates =
            {
              overall:
                safeNumber(
                  updated.overall
                ),

              rating:
                safeNumber(
                  updated.rating
                ),

              pace:
                safeNumber(
                  updated.pace
                ),

              shooting:
                safeNumber(
                  updated.shooting
                ),

              passing:
                safeNumber(
                  updated.passing
                ),

              dribbling:
                safeNumber(
                  updated.dribbling
                ),

              defending:
                safeNumber(
                  updated.defending
                ),

              goalkeeping:
                safeNumber(
                  updated.goalkeeping
                ),

              finishing:
                safeNumber(
                  updated.finishing
                ),

              stamina:
                safeNumber(
                  updated.stamina
                ),

              physical:
                safeNumber(
                  updated.physical
                ),

              tackling:
                safeNumber(
                  updated.tackling
                ),

              vision:
                safeNumber(
                  updated.vision
                ),

              technique:
                safeNumber(
                  updated.technique
                ),

              reflexes:
                safeNumber(
                  updated.reflexes
                ),

              positioning:
                safeNumber(
                  updated.positioning
                ),

              teamwork:
                safeNumber(
                  updated.teamwork
                ),

              heading:
                safeNumber(
                  updated.heading
                ),

              crossing:
                safeNumber(
                  updated.crossing
                ),

              updatedAt:
                serverTimestamp(),
            };

          batch.update(
            playerRef,
            firestoreUpdates
          );

          batchCount += 1;

          finalPlayers.push({
            ...original,
            ...updated,
          });

          if (
            batchCount >= 450
          ) {
            await commitBatch();
          }
        }

        await commitBatch();

        /*
          Mark the game date as trained.

          Notice:
          currentDate is NEVER changed.
        */

        await updateDoc(
          doc(
            db,
            "users",
            user.uid
          ),
          {
            "careerData.lastTrainingGameDate":
              currentGameDate,

            "careerData.lastTrainingAt":
              serverTimestamp(),

            updatedAt:
              serverTimestamp(),
          }
        );

        setPlayers(
          (previous) =>
            previous.map(
              (player) =>
                playerUpdates[
                  player.id
                ]
                  ? {
                      ...player,
                      ...finalPlayers.find(
                        (item) =>
                          item.id ===
                          player.id
                      ),
                    }
                  : player
            )
        );

        setCareerData(
          (previous) => ({
            ...(previous || {}),

            lastTrainingGameDate:
              currentGameDate,
          })
        );

        toast.success(
          `Training completed for ${ids.length} players`
        );
      } catch (error) {
        console.error(
          "Apply training error:",
          error
        );

        toast.error(
          "Could not apply training"
        );
      } finally {
        setSaving(false);
      }
    };

  /* =======================================================
     AI TRAINING
  ======================================================= */

  const processSystemAITraining =
    useCallback(
      async (
        gameDate
      ) => {
        if (
          !user ||
          !gameDate ||
          aiProcessingRef.current
        ) {
          return;
        }

        try {
          aiProcessingRef.current =
            true;

          /*
            Get all clubs.

            AI club =
            no managerId
          */

          const clubsSnapshot =
            await getDocs(
              collection(
                db,
                "clubs"
              )
            );

          const aiClubs = [];

          clubsSnapshot.forEach(
            (clubDoc) => {
              const club =
                clubDoc.data();

              if (
                !club.managerId
              ) {
                aiClubs.push({
                  id: clubDoc.id,
                  ...club,
                });
              }
            }
          );

          if (
            aiClubs.length === 0
          ) {
            return;
          }

          let batch =
            writeBatch(db);

          let batchCount = 0;

          const commitBatch =
            async () => {
              if (
                batchCount > 0
              ) {
                await batch.commit();
              }

              batch =
                writeBatch(db);

              batchCount = 0;
            };

          let trainedCount =
            0;

          /*
            AI decides which players
            should train.

            Better players still train,
            but selection is not purely random.
          */

          for (const aiClub of aiClubs) {
            /*
              Prevent AI from training
              twice on same game date.
            */

            if (
              aiClub.lastAITrainingGameDate ===
              gameDate
            ) {
              continue;
            }

            const playersQuery =
              query(
                collection(
                  db,
                  "players"
                ),
                where(
                  "clubId",
                  "==",
                  aiClub.id
                )
              );

            const playersSnapshot =
              await getDocs(
                playersQuery
              );

            const clubPlayers =
              [];

            playersSnapshot.forEach(
              (playerDoc) => {
                clubPlayers.push({
                  id: playerDoc.id,
                  ...playerDoc.data(),
                });
              }
            );

            if (
              clubPlayers.length === 0
            ) {
              /*
                Still mark the date so
                we don't repeatedly scan
                an empty AI club.
              */

              const clubRef =
                doc(
                  db,
                  "clubs",
                  aiClub.id
                );

              batch.update(
                clubRef,
                {
                  lastAITrainingGameDate:
                    gameDate,

                  lastAITrainingAt:
                    serverTimestamp(),
                }
              );

              batchCount += 1;

              if (
                batchCount >= 450
              ) {
                await commitBatch();
              }

              continue;
            }

            /*
              AI trains up to 10 players.
            */

            const selectedPlayers =
              [...clubPlayers]
                .sort(
                  (a, b) =>
                    getPlayerOverall(
                      b
                    ) -
                    getPlayerOverall(
                      a
                    )
                )
                .slice(0, 10);

            /*
              Pick 3 drills.
            */

            const drillIds =
              Object.keys(
                TRAINING_DRILLS
              );

            const shuffledDrills =
              [...drillIds].sort(
                () =>
                  Math.random() -
                  0.5
              );

            const selectedDrills =
              shuffledDrills
                .slice(0, 3)
                .map(
                  (id) =>
                    TRAINING_DRILLS[
                      id
                    ]
                );

            for (const player of selectedPlayers) {
              /*
                AI selects 1 or 2 drills
                per player instead of
                dumping all three onto everyone.
              */

              const numberOfDrills =
                Math.random() <
                0.65
                  ? 1
                  : 2;

              const playerDrills =
                [...selectedDrills]
                  .sort(
                    () =>
                      Math.random() -
                      0.5
                  )
                  .slice(
                    0,
                    numberOfDrills
                  );

              const updated =
                trainPlayer(
                  player,
                  playerDrills
                );

              const playerRef =
                doc(
                  db,
                  "players",
                  player.id
                );

              batch.update(
                playerRef,
                {
                  overall:
                    safeNumber(
                      updated.overall
                    ),

                  rating:
                    safeNumber(
                      updated.rating
                    ),

                  pace:
                    safeNumber(
                      updated.pace
                    ),

                  shooting:
                    safeNumber(
                      updated.shooting
                    ),

                  passing:
                    safeNumber(
                      updated.passing
                    ),

                  dribbling:
                    safeNumber(
                      updated.dribbling
                    ),

                  defending:
                    safeNumber(
                      updated.defending
                    ),

                  goalkeeping:
                    safeNumber(
                      updated.goalkeeping
                    ),

                  finishing:
                    safeNumber(
                      updated.finishing
                    ),

                  stamina:
                    safeNumber(
                      updated.stamina
                    ),

                  physical:
                    safeNumber(
                      updated.physical
                    ),

                  tackling:
                    safeNumber(
                      updated.tackling
                    ),

                  vision:
                    safeNumber(
                      updated.vision
                    ),

                  technique:
                    safeNumber(
                      updated.technique
                    ),

                  reflexes:
                    safeNumber(
                      updated.reflexes
                    ),

                  positioning:
                    safeNumber(
                      updated.positioning
                    ),

                  teamwork:
                    safeNumber(
                      updated.teamwork
                    ),

                  heading:
                    safeNumber(
                      updated.heading
                    ),

                  crossing:
                    safeNumber(
                      updated.crossing
                    ),

                  updatedAt:
                    serverTimestamp(),
                }
              );

              batchCount += 1;
              trainedCount += 1;

              if (
                batchCount >= 450
              ) {
                await commitBatch();
              }
            }

            /*
              Mark AI club as trained
              for this game date.
            */

            const clubRef =
              doc(
                db,
                "clubs",
                aiClub.id
              );

            batch.update(
              clubRef,
              {
                lastAITrainingGameDate:
                  gameDate,

                lastAITrainingAt:
                  serverTimestamp(),
              }
            );

            batchCount += 1;

            if (
              batchCount >= 450
            ) {
              await commitBatch();
            }
          }

          await commitBatch();

          if (
            trainedCount > 0
          ) {
            console.log(
              `AI training completed: ${trainedCount} players trained for game date ${gameDate}`
            );
          }
        } catch (error) {
          console.error(
            "System AI training error:",
            error
          );
        } finally {
          aiProcessingRef.current =
            false;
        }
      },
      [user]
    );

  /* =======================================================
     RUN AI WHEN GAME DATE CHANGES
  ======================================================= */

  useEffect(() => {
    if (
      !user ||
      !currentGameDate
    ) {
      return;
    }

    processSystemAITraining(
      currentGameDate
    );
  }, [
    user,
    currentGameDate,
    processSystemAITraining,
  ]);

  /* =======================================================
     POLL FOR GAME DATE CHANGES
     
     IMPORTANT:
     This does NOT advance the date.
     It only checks whether another
     page/system already advanced it.
  ======================================================= */

  useEffect(() => {
    if (!user) return;

    const interval =
      setInterval(async () => {
        try {
          const userSnapshot =
            await getDoc(
              doc(
                db,
                "users",
                user.uid
              )
            );

          if (
            !userSnapshot.exists()
          ) {
            return;
          }

          const latestCareer =
            userSnapshot.data()
              ?.careerData || {};

          const latestDate =
            normalizeGameDate(
              latestCareer.currentDate
            );

          if (
            latestDate &&
            latestDate !==
              currentGameDate
          ) {
            setCareerData(
              latestCareer
            );

            const latestSchedule =
              normalizeSchedule(
                latestCareer.trainingSchedule
              );

            setSchedule(
              latestSchedule
            );

            scheduleRef.current =
              latestSchedule;

            setSelectedDay(
              getDayIndexFromGameDate(
                latestDate
              )
            );

            /*
              New game date detected.
              Let AI train automatically.
            */

            await processSystemAITraining(
              latestDate
            );
          }
        } catch (error) {
          console.error(
            "Game date sync error:",
            error
          );
        }
      }, 30000);

    return () =>
      clearInterval(interval);
  }, [
    user,
    currentGameDate,
    processSystemAITraining,
  ]);

  /* =======================================================
     DRILL CATEGORIES
  ======================================================= */

  const drillCategories =
    [
      {
        value: "all",
        label: "All Drills",
        icon: "📋",
      },

      {
        value: "attack",
        label: "Attack",
        icon: "⚽",
      },

      {
        value: "defense",
        label: "Defense",
        icon: "🛡️",
      },

      {
        value: "midfield",
        label: "Midfield",
        icon: "🦶",
      },

      {
        value: "physical",
        label: "Physical",
        icon: "💪",
      },

      {
        value: "tactical",
        label: "Tactical",
        icon: "📋",
      },

      {
        value: "goalkeeper",
        label: "Goalkeeper",
        icon: "🧤",
      },
    ];

  /* =======================================================
     FILTERED DRILLS
  ======================================================= */

  const filteredDrills =
    useMemo(() => {
      return Object.values(
        TRAINING_DRILLS
      ).filter((drill) => {
        if (
          drillFilter ===
          "all"
        ) {
          return true;
        }

        return (
          drill.category ===
          drillFilter
        );
      });
    }, [drillFilter]);

  /* =======================================================
     CURRENT DAY SLOTS
  ======================================================= */

  const daySlots =
    Array.isArray(
      schedule[selectedDay]
    )
      ? schedule[selectedDay]
      : [];

  /* =======================================================
     LOADING
  ======================================================= */

  if (
    loading ||
    isLoading
  ) {
    return (
      <div
        className={
          styles.loadingContainer
        }
      >
        <div
          className={
            styles.spinner
          }
        />

        <p>
          Loading training...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Training Center - Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Plan weekly training sessions and develop your football squad."
        />
      </Head>

      <main
        className={
          styles.page
        }
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <header
          className={
            styles.header
          }
        >
          <div>
            <span
              className={
                styles.eyebrow
              }
            >
              CLUB DEVELOPMENT
            </span>

            <h1>
              Training Center
            </h1>

            <p>
              Train your squad and
              improve player attributes.
            </p>

            {currentGameDate && (
              <div
                className={
                  styles.gameDate
                }
              >
                📅 Game Date:{" "}
                <strong>
                  {currentGameDate}
                </strong>

                <span>
                  •{" "}
                  {
                    DAY_NAMES[
                      currentGameDayIndex
                    ]
                  }
                </span>
              </div>
            )}
          </div>

          <div
            className={
              styles.headerActions
            }
          >
            <button
              type="button"
              className={
                styles.saveButton
              }
              onClick={
                saveTrainingSchedule
              }
              disabled={saving}
            >
              💾 Save Schedule
            </button>

            <button
              type="button"
              className={
                styles.applyButton
              }
              onClick={
                applyTraining
              }
              disabled={
                saving ||
                !currentGameDate ||
                careerData?.lastTrainingGameDate ===
                  currentGameDate
              }
            >
              {saving
                ? "Training..."
                : careerData?.lastTrainingGameDate ===
                  currentGameDate
                ? "✅ Training Applied"
                : "🏋️ Apply Today's Training"}
            </button>
          </div>
        </header>

        {/* =================================================
            INFO BAR
        ================================================= */}

        <div
          className={
            styles.infoBar
          }
        >
          <div>
            <span>
              📅 Current Game Date
            </span>

            <strong>
              {currentGameDate ||
                "Not available"}
            </strong>
          </div>

          <div>
            <span>
              🏋️ Today's Drills
            </span>

            <strong>
              {
                (
                  schedule[
                    currentGameDayIndex
                  ] || []
                ).length
              }{" "}
              /{" "}
              {MAX_DRILLS_PER_DAY}
            </strong>
          </div>

          <div>
            <span>
              👥 Players / Drill
            </span>

            <strong>
              10 Maximum
            </strong>
          </div>

          <div>
            <span>
              🤖 AI Clubs
            </span>

            <strong>
              Automatic
            </strong>
          </div>
        </div>

        {/* =================================================
            MAIN LAYOUT
        ================================================= */}

        <div
          className={
            styles.trainingLayout
          }
        >
          {/* =================================================
              DRILLS PANEL
          ================================================= */}

          <aside
            className={
              styles.drillsPanel
            }
          >
            <div
              className={
                styles.panelHeading
              }
            >
              <div>
                <h2>
                  Training Drills
                </h2>

                <p>
                  Select a drill to add
                  it to the selected day.
                </p>
              </div>

              <span
                className={
                  styles.countBadge
                }
              >
                {
                  Object.keys(
                    TRAINING_DRILLS
                  ).length
                }
              </span>
            </div>

            <div
              className={
                styles.drillFilterTabs
              }
            >
              {drillCategories.map(
                (category) => (
                  <button
                    key={
                      category.value
                    }
                    type="button"
                    className={
                      drillFilter ===
                      category.value
                        ? styles.activeFilter
                        : ""
                    }
                    onClick={() =>
                      setDrillFilter(
                        category.value
                      )
                    }
                  >
                    <span>
                      {
                        category.icon
                      }
                    </span>

                    {
                      category.label
                    }
                  </button>
                )
              )}
            </div>

            <div
              className={
                styles.drillList
              }
            >
              {filteredDrills.map(
                (drill) => (
                  <button
                    key={
                      drill.id
                    }
                    type="button"
                    className={
                      styles.drillCard
                    }
                    style={{
                      borderLeftColor:
                        drill.color,
                    }}
                    onClick={() =>
                      addDrillToDay(
                        selectedDay,
                        drill.id
                      )
                    }
                  >
                    <div
                      className={
                        styles.drillIcon
                      }
                      style={{
                        background:
                          `${drill.color}18`,
                      }}
                    >
                      {
                        drill.icon
                      }
                    </div>

                    <div
                      className={
                        styles.drillInfo
                      }
                    >
                      <strong
                        style={{
                          color:
                            drill.color,
                        }}
                      >
                        {
                          drill.name
                        }
                      </strong>

                      <p>
                        {
                          drill.description
                        }
                      </p>

                      <small>
                        ⏱️{" "}
                        {
                          drill.duration
                        }
                        h • Tap to
                        add
                      </small>
                    </div>
                  </button>
                )
              )}
            </div>
          </aside>

          {/* =================================================
              PLAYERS PANEL
          ================================================= */}

          <aside
            className={
              styles.playersPanel
            }
          >
            <div
              className={
                styles.panelHeading
              }
            >
              <div>
                <h2>
                  Squad Players
                </h2>

                <p>
                  Select a drill first,
                  then add players.
                </p>
              </div>

              <span
                className={
                  styles.countBadge
                }
              >
                {players.length}
              </span>
            </div>

            <div
              className={
                styles.playerDragList
              }
            >
              {players.map(
                (player) => (
                  <button
                    key={
                      player.id
                    }
                    type="button"
                    className={
                      styles.dragPlayer
                    }
                    onClick={() => {
                      if (
                        selectedSlot
                      ) {
                        addPlayerToDrill(
                          selectedDay,
                          selectedSlot,
                          player.id
                        );
                      } else {
                        toast.error(
                          "Select a drill first"
                        );
                      }
                    }}
                  >
                    <div
                      className={
                        styles.dragPlayerAvatar
                      }
                    >
                      {player.photo ? (
                        <img
                          src={
                            player.photo
                          }
                          alt={getPlayerName(
                            player
                          )}
                        />
                      ) : (
                        getPlayerName(
                          player
                        )
                          .charAt(0)
                          .toUpperCase()
                      )}
                    </div>

                    <div
                      className={
                        styles.playerSummary
                      }
                    >
                      <strong>
                        {
                          getPlayerName(
                            player
                          )
                        }
                      </strong>

                      <small>
                        {
                          getPlayerPosition(
                            player
                          )
                        }{" "}
                        • OVR{" "}
                        {
                          getPlayerOverall(
                            player
                          )
                        }
                      </small>
                    </div>

                    <span
                      className={
                        styles.addIcon
                      }
                    >
                      +
                    </span>
                  </button>
                )
              )}

              {players.length ===
                0 && (
                <div
                  className={
                    styles.emptyPlayers
                  }
                >
                  <span>
                    👥
                  </span>

                  <strong>
                    No players found
                  </strong>

                  <p>
                    This club currently
                    has no players.
                  </p>
                </div>
              )}
            </div>
          </aside>

          {/* =================================================
              SCHEDULE PANEL
          ================================================= */}

          <section
            className={
              styles.schedulePanel
            }
          >
            <div
              className={
                styles.panelHeading
              }
            >
              <div>
                <h2>
                  Weekly Schedule
                </h2>

                <p>
                  Your schedule follows
                  the game calendar.
                </p>
              </div>
            </div>

            {/* =================================================
                DAY TABS
            ================================================= */}

            <div
              className={
                styles.dayTabs
              }
            >
              {DAY_NAMES.map(
                (
                  day,
                  index
                ) => {
                  const isToday =
                    index ===
                    currentGameDayIndex;

                  return (
                    <button
                      key={day}
                      type="button"
                      className={
                        selectedDay ===
                        index
                          ? styles.activeDay
                          : ""
                      }
                      onClick={() => {
                        setSelectedDay(
                          index
                        );

                        setSelectedSlot(
                          null
                        );
                      }}
                    >
                      <span>
                        {day.slice(
                          0,
                          3
                        )}
                      </span>

                      {isToday && (
                        <small>
                          TODAY
                        </small>
                      )}
                    </button>
                  );
                }
              )}
            </div>

            {/* =================================================
                DAY DROP ZONE
            ================================================= */}

            <div
              className={
                styles.dayDropZone
              }
            >
              <div
                className={
                  styles.dayHeader
                }
              >
                <div>
                  <span
                    className={
                      styles.dayEyebrow
                    }
                  >
                    GAME CALENDAR
                  </span>

                  <h3>
                    {
                      DAY_NAMES[
                        selectedDay
                      ]
                    }{" "}
                    Training
                  </h3>

                  <small>
                    {daySlots.length}{" "}
                    /{" "}
                    {
                      MAX_DRILLS_PER_DAY
                    }{" "}
                    drills
                  </small>
                </div>

                {selectedDay ===
                  currentGameDayIndex && (
                  <span
                    className={
                      styles.todayBadge
                    }
                  >
                    TODAY
                  </span>
                )}
              </div>

              {/* =================================================
                  SCHEDULE SLOTS
              ================================================= */}

              {daySlots.map(
                (slot) => {
                  const drill =
                    TRAINING_DRILLS[
                      slot.drillId
                    ];

                  if (!drill) {
                    return null;
                  }

                  const isSelected =
                    selectedSlot ===
                    slot.id;

                  return (
                    <div
                      key={
                        slot.id
                      }
                      className={`${styles.scheduleSlot} ${
                        isSelected
                          ? styles.slotSelected
                          : ""
                      }`}
                      style={{
                        borderColor:
                          drill.color,
                      }}
                      onClick={() =>
                        setSelectedSlot(
                          isSelected
                            ? null
                            : slot.id
                        )
                      }
                    >
                      <div
                        className={
                          styles.slotHeader
                        }
                      >
                        <div
                          className={
                            styles.slotTitle
                          }
                        >
                          <span>
                            {
                              drill.icon
                            }
                          </span>

                          <strong
                            style={{
                              color:
                                drill.color,
                            }}
                          >
                            {
                              drill.name
                            }
                          </strong>
                        </div>

                        <button
                          type="button"
                          className={
                            styles.removeButton
                          }
                          onClick={(
                            event
                          ) => {
                            event.stopPropagation();

                            removeDrillFromDay(
                              selectedDay,
                              slot.id
                            );

                            if (
                              selectedSlot ===
                              slot.id
                            ) {
                              setSelectedSlot(
                                null
                              );
                            }
                          }}
                        >
                          ×
                        </button>
                      </div>

                      <div
                        className={
                          styles.slotPlayers
                        }
                      >
                        {slot.playerIds
                          ?.length >
                        0 ? (
                          slot.playerIds.map(
                            (
                              playerId
                            ) => {
                              const player =
                                players.find(
                                  (
                                    item
                                  ) =>
                                    item.id ===
                                    playerId
                                );

                              if (
                                !player
                              ) {
                                return null;
                              }

                              return (
                                <span
                                  key={
                                    playerId
                                  }
                                  className={
                                    styles.slotPlayer
                                  }
                                >
                                  {
                                    getPlayerName(
                                      player
                                    )
                                  }

                                  <button
                                    type="button"
                                    onClick={(
                                      event
                                    ) => {
                                      event.stopPropagation();

                                      removePlayerFromDrill(
                                        selectedDay,
                                        slot.id,
                                        playerId
                                      );
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            }
                          )
                        ) : (
                          <span
                            className={
                              styles.emptySlot
                            }
                          >
                            {isSelected
                              ? "Tap players to add them here"
                              : "Select this drill to add players"}
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.slotFooter
                        }
                      >
                        <span>
                          👥{" "}
                          {
                            slot
                              .playerIds
                              ?.length ||
                            0
                          }{" "}
                          /{" "}
                          {
                            MAX_PLAYERS_PER_DRILL
                          }
                        </span>

                        <span>
                          ⏱️{" "}
                          {
                            drill.duration
                          }
                          h
                        </span>
                      </div>
                    </div>
                  );
                }
              )}

              {daySlots.length ===
                0 && (
                <div
                  className={
                    styles.noDrills
                  }
                >
                  <div>
                    📋
                  </div>

                  <strong>
                    No training scheduled
                  </strong>

                  <span>
                    Select a drill from
                    the drills panel.
                  </span>
                </div>
              )}
            </div>

            {/* =================================================
                TRAINING RULE
            ================================================= */}

            <div
              className={
                styles.trainingNotice
              }
            >
              <span>
                ℹ️
              </span>

              <div>
                <strong>
                  Game Calendar Training
                </strong>

                <p>
                  Training is applied only
                  to the current game date.
                  Applying training never
                  advances the calendar, and
                  the same date cannot be
                  trained twice.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
