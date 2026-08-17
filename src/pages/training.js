// pages/training.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '../context/AuthContext';
import { db } from '../components/firebase';

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
} from 'firebase/firestore';

import toast from 'react-hot-toast';
import styles from './training.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const MAX_PLAYERS_PER_DRILL = 5;
const MAX_DRILLS_PER_DAY = 3;

const TRAINING_DRILLS = {
  attacking: {
    id: 'attacking',
    name: 'Attacking Drill',
    icon: '⚽',
    color: '#38bdf8',
    description: 'Improve shooting, finishing, and offensive movement',
    effects: {
      shooting: { min: 1, max: 3 },
      dribbling: { min: 0, max: 2 },
      pace: { min: 0, max: 1 },
    },
    duration: 2,
  },

  defending: {
    id: 'defending',
    name: 'Defending Drill',
    icon: '🛡️',
    color: '#ef4444',
    description: 'Improve tackling, marking, and defensive positioning',
    effects: {
      defending: { min: 1, max: 3 },
      physical: { min: 0, max: 2 },
      tackling: { min: 0, max: 2 },
    },
    duration: 2,
  },

  passing: {
    id: 'passing',
    name: 'Passing Drill',
    icon: '🦶',
    color: '#22c55e',
    description: 'Improve passing accuracy and vision',
    effects: {
      passing: { min: 1, max: 3 },
      vision: { min: 0, max: 2 },
      technique: { min: 0, max: 2 },
    },
    duration: 1.5,
  },

  fitness: {
    id: 'fitness',
    name: 'Fitness Training',
    icon: '💪',
    color: '#f59e0b',
    description: 'Improve stamina, strength, and physical condition',
    effects: {
      stamina: { min: 1, max: 4 },
      physical: { min: 0, max: 3 },
      pace: { min: 0, max: 1 },
    },
    duration: 1,
  },

  shooting: {
    id: 'shooting',
    name: 'Shooting Practice',
    icon: '🎯',
    color: '#ec4899',
    description: 'Improve finishing and long shots',
    effects: {
      shooting: { min: 2, max: 4 },
      finishing: { min: 0, max: 3 },
      technique: { min: 0, max: 1 },
    },
    duration: 1.5,
  },

  goalkeeper: {
    id: 'goalkeeper',
    name: 'Goalkeeper Training',
    icon: '🧤',
    color: '#8b5cf6',
    description: 'Improve goalkeeping, reflexes, and positioning',
    effects: {
      goalkeeping: { min: 1, max: 4 },
      reflexes: { min: 0, max: 3 },
      positioning: { min: 0, max: 2 },
    },
    duration: 1.5,
  },

  tactics: {
    id: 'tactics',
    name: 'Tactical Session',
    icon: '📋',
    color: '#14b8a6',
    description: 'Improve tactical awareness and teamwork',
    effects: {
      vision: { min: 1, max: 2 },
      positioning: { min: 0, max: 2 },
      teamwork: { min: 0, max: 2 },
    },
    duration: 2,
  },

  set_pieces: {
    id: 'set_pieces',
    name: 'Set Piece Practice',
    icon: '🚩',
    color: '#f97316',
    description: 'Improve free kicks, corners, and penalties',
    effects: {
      technique: { min: 1, max: 3 },
      passing: { min: 0, max: 1 },
      finishing: { min: 0, max: 1 },
    },
    duration: 1,
  },
};

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/* =========================================================
   HELPERS
========================================================= */

function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function getPlayerName(player) {
  return (
    player?.name ||
    player?.fullName ||
    player?.displayName ||
    `${player?.firstName || ''} ${player?.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return (
    player?.position ||
    player?.primaryPosition ||
    player?.role ||
    'MID'
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

function createId(prefix = 'item') {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/*
  Old schedule compatibility.

  Old structure:

  {
    "0": [
      {
        drillId: "attacking",
        playerIds: ["abc"]
      }
    ]
  }

  New structure:

  {
    "0": [
      {
        id: "drill-...",
        drillId: "attacking",
        playerIds: ["abc"]
      }
    ]
  }

  This converts old data automatically.
*/

function normalizeSchedule(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') {
    return {};
  }

  const normalized = {};

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const rawDay = rawSchedule[dayIndex];

    if (!Array.isArray(rawDay)) {
      continue;
    }

    normalized[dayIndex] = rawDay
      .map((slot) => {
        if (!slot || typeof slot !== 'object') {
          return null;
        }

        const drillId = slot.drillId;

        if (!TRAINING_DRILLS[drillId]) {
          return null;
        }

        return {
          id: slot.id || createId('drill'),
          drillId,
          playerIds: Array.isArray(slot.playerIds)
            ? [...new Set(slot.playerIds.map(String))]
            : [],
        };
      })
      .filter(Boolean)
      .slice(0, MAX_DRILLS_PER_DAY);
  }

  return normalized;
}

/* =========================================================
   PAGE
========================================================= */

export default function TrainingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [careerData, setCareerData] = useState(null);
  const [clubInfo, setClubInfo] = useState(null);
  const [players, setPlayers] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [schedule, setSchedule] = useState({});

  const [selectedDay, setSelectedDay] = useState(0);

  const [draggedPlayer, setDraggedPlayer] = useState(null);
  const [draggedDrill, setDraggedDrill] = useState(null);

  const [draggedScheduleDrill, setDraggedScheduleDrill] =
    useState(null);

  const [dropTarget, setDropTarget] = useState(null);

  const scheduleRef = useRef({});
  const saveTimerRef = useRef(null);

  /* =======================================================
     SYNC REF
  ======================================================= */

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    fetchTrainingData();
  }, [user, loading, router]);

  /* =======================================================
     FETCH DATA
  ======================================================= */

  const fetchTrainingData = async () => {
    if (!user) return;

    try {
      setIsLoading(true);

      const userRef = doc(db, 'users', user.uid);
      const userSnapshot = await getDoc(userRef);

      if (!userSnapshot.exists()) {
        toast.error('User account not found');
        return;
      }

      const userData = userSnapshot.data();
      const career = userData.careerData || {};

      setCareerData(career);

      if (!career.currentClub) {
        setPlayers([]);
        setSchedule({});
        return;
      }

      /* ===================================================
         CLUB
      =================================================== */

      const clubRef = doc(
        db,
        'clubs',
        career.currentClub
      );

      const clubSnapshot = await getDoc(clubRef);

      if (clubSnapshot.exists()) {
        setClubInfo({
          id: clubSnapshot.id,
          ...clubSnapshot.data(),
        });
      } else {
        setClubInfo(null);
      }

      /* ===================================================
         PLAYERS
      =================================================== */

      const playersQuery = query(
        collection(db, 'players'),
        where('clubId', '==', career.currentClub)
      );

      const playersSnapshot = await getDocs(playersQuery);

      const playerList = [];

      playersSnapshot.forEach((playerDoc) => {
        const player = playerDoc.data();

        if (
          player.squadType !== 'youth' &&
          player.isYouth !== true
        ) {
          playerList.push({
            id: playerDoc.id,
            ...player,
          });
        }
      });

      playerList.sort(
        (a, b) => getPlayerOverall(b) - getPlayerOverall(a)
      );

      setPlayers(playerList);

      /* ===================================================
         SCHEDULE
      =================================================== */

      const normalized = normalizeSchedule(
        career.trainingSchedule
      );

      setSchedule(normalized);
      scheduleRef.current = normalized;
    } catch (error) {
      console.error(
        'Error fetching training data:',
        error
      );

      toast.error('Failed to load training data');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     SAVE SCHEDULE TO FIRESTORE
  ======================================================= */

  const saveScheduleToFirestore = useCallback(
    async (scheduleToSave) => {
      if (!user || !careerData?.currentClub) {
        return false;
      }

      try {
        await updateDoc(doc(db, 'users', user.uid), {
          'careerData.trainingSchedule': scheduleToSave,
          'careerData.trainingScheduleUpdatedAt':
            new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });

        setCareerData((prev) => ({
          ...(prev || {}),
          trainingSchedule: scheduleToSave,
          trainingScheduleUpdatedAt:
            new Date().toISOString(),
        }));

        return true;
      } catch (error) {
        console.error(
          'Save training schedule error:',
          error
        );

        return false;
      }
    },
    [user, careerData?.currentClub]
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

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      const success =
        await saveScheduleToFirestore(scheduleRef.current);

      if (!success) {
        console.error(
          'Automatic training schedule save failed'
        );
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    schedule,
    isLoading,
    user,
    careerData?.currentClub,
    saveScheduleToFirestore,
  ]);

  /* =======================================================
     DRAG: LIBRARY DRILL
  ======================================================= */

  const handleDragStartDrill = useCallback(
    (e, drillId) => {
      setDraggedDrill(drillId);
      setDraggedScheduleDrill(null);
      setDraggedPlayer(null);

      e.dataTransfer.effectAllowed = 'copy';

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'new-drill',
          drillId,
        })
      );
    },
    []
  );

  /* =======================================================
     DRAG: PLAYER
  ======================================================= */

  const handleDragStartPlayer = useCallback(
    (e, player) => {
      setDraggedPlayer(player);
      setDraggedDrill(null);
      setDraggedScheduleDrill(null);

      e.dataTransfer.effectAllowed = 'move';

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'player',
          playerId: player.id,
        })
      );
    },
    []
  );

  /* =======================================================
     DRAG: SCHEDULE DRILL
  ======================================================= */

  const handleDragStartScheduleDrill = useCallback(
    (e, dayIndex, slotId) => {
      setDraggedScheduleDrill({
        dayIndex,
        slotId,
      });

      setDraggedDrill(null);
      setDraggedPlayer(null);

      e.dataTransfer.effectAllowed = 'move';

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'schedule-drill',
          dayIndex,
          slotId,
        })
      );
    },
    []
  );

  /* =======================================================
     DRAG OVER
  ======================================================= */

  const handleDragOver = useCallback(
    (e, targetId) => {
      e.preventDefault();

      e.dataTransfer.dropEffect =
        draggedScheduleDrill ? 'move' : 'copy';

      if (dropTarget !== targetId) {
        setDropTarget(targetId);
      }
    },
    [dropTarget, draggedScheduleDrill]
  );

  /* =======================================================
     DRAG END
  ======================================================= */

  const handleDragEnd = useCallback(() => {
    setDraggedPlayer(null);
    setDraggedDrill(null);
    setDraggedScheduleDrill(null);
    setDropTarget(null);
  }, []);

  /* =======================================================
     ADD NEW DRILL
  ======================================================= */

  const addDrillToDay = useCallback(
    (dayIndex, drillId) => {
      if (!TRAINING_DRILLS[drillId]) {
        return;
      }

      setSchedule((prev) => {
        const currentDay = Array.isArray(prev[dayIndex])
          ? prev[dayIndex]
          : [];

        if (
          currentDay.length >= MAX_DRILLS_PER_DAY
        ) {
          toast.error(
            'Maximum 3 drills per day'
          );

          return prev;
        }

        const newSlot = {
          id: createId('drill'),
          drillId,
          playerIds: [],
        };

        return {
          ...prev,
          [dayIndex]: [
            ...currentDay,
            newSlot,
          ],
        };
      });
    },
    []
  );

  /* =======================================================
     MOVE EXISTING DRILL
  ======================================================= */

  const moveScheduleDrill = useCallback(
    (
      fromDayIndex,
      slotId,
      toDayIndex
    ) => {
      setSchedule((prev) => {
        const sourceDay = Array.isArray(
          prev[fromDayIndex]
        )
          ? [...prev[fromDayIndex]]
          : [];

        const targetDay = Array.isArray(
          prev[toDayIndex]
        )
          ? [...prev[toDayIndex]]
          : [];

        const sourceIndex =
          sourceDay.findIndex(
            (slot) => slot.id === slotId
          );

        if (sourceIndex === -1) {
          return prev;
        }

        /*
          Same day:
          do nothing because the user dropped
          the drill back onto its own day.
        */

        if (fromDayIndex === toDayIndex) {
          return prev;
        }

        if (
          targetDay.length >= MAX_DRILLS_PER_DAY
        ) {
          toast.error(
            'Maximum 3 drills per day'
          );

          return prev;
        }

        const [movedSlot] =
          sourceDay.splice(
            sourceIndex,
            1
          );

        targetDay.push(movedSlot);

        return {
          ...prev,
          [fromDayIndex]: sourceDay,
          [toDayIndex]: targetDay,
        };
      });
    },
    []
  );

  /* =======================================================
     ADD PLAYER
  ======================================================= */

  const addPlayerToDrill = useCallback(
    (dayIndex, slotId, playerId) => {
      setSchedule((prev) => {
        const daySlots = Array.isArray(
          prev[dayIndex]
        )
          ? prev[dayIndex]
          : [];

        const targetSlot = daySlots.find(
          (slot) => slot.id === slotId
        );

        if (!targetSlot) {
          return prev;
        }

        if (
          targetSlot.playerIds.length >=
          MAX_PLAYERS_PER_DRILL
        ) {
          toast.error(
            'Maximum 5 players per drill'
          );

          return prev;
        }

        /*
          Prevent same player from being
          assigned twice in the same drill.
        */

        if (
          targetSlot.playerIds.includes(
            playerId
          )
        ) {
          toast.error(
            'Player already in this drill'
          );

          return prev;
        }

        return {
          ...prev,
          [dayIndex]: daySlots.map(
            (slot) =>
              slot.id === slotId
                ? {
                    ...slot,
                    playerIds: [
                      ...slot.playerIds,
                      playerId,
                    ],
                  }
                : slot
          ),
        };
      });
    },
    []
  );

  /* =======================================================
     MOVE PLAYER BETWEEN DRILLS
  ======================================================= */

  const movePlayerToDrill = useCallback(
    (
      fromDayIndex,
      fromSlotId,
      playerId,
      toDayIndex,
      toSlotId
    ) => {
      setSchedule((prev) => {
        const sourceDay = Array.isArray(
          prev[fromDayIndex]
        )
          ? [...prev[fromDayIndex]]
          : [];

        const targetDay = Array.isArray(
          prev[toDayIndex]
        )
          ? [...prev[toDayIndex]]
          : [];

        const sourceSlot =
          sourceDay.find(
            (slot) => slot.id === fromSlotId
          );

        const targetSlot =
          targetDay.find(
            (slot) => slot.id === toSlotId
          );

        if (
          !sourceSlot ||
          !targetSlot
        ) {
          return prev;
        }

        /*
          Dropping into the same drill.
        */

        if (
          fromDayIndex === toDayIndex &&
          fromSlotId === toSlotId
        ) {
          return prev;
        }

        /*
          Target drill full.
        */

        if (
          targetSlot.playerIds.length >=
          MAX_PLAYERS_PER_DRILL
        ) {
          toast.error(
            'Maximum 5 players per drill'
          );

          return prev;
        }

        /*
          Target already contains player.
        */

        if (
          targetSlot.playerIds.includes(
            playerId
          )
        ) {
          toast.error(
            'Player already in this drill'
          );

          return prev;
        }

        /*
          Remove from source.
        */

        const newSourceDay =
          sourceDay.map((slot) =>
            slot.id === fromSlotId
              ? {
                  ...slot,
                  playerIds:
                    slot.playerIds.filter(
                      (id) =>
                        id !== playerId
                    ),
                }
              : slot
          );

        /*
          Add to target.
        */

        const newTargetDay =
          targetDay.map((slot) =>
            slot.id === toSlotId
              ? {
                  ...slot,
                  playerIds: [
                    ...slot.playerIds,
                    playerId,
                  ],
                }
              : slot
          );

        return {
          ...prev,
          [fromDayIndex]:
            newSourceDay,
          [toDayIndex]:
            newTargetDay,
        };
      });
    },
    []
  );

  /* =======================================================
     REMOVE DRILL
  ======================================================= */

  const removeDrillFromDay = useCallback(
    (dayIndex, slotId) => {
      setSchedule((prev) => {
        const daySlots = Array.isArray(
          prev[dayIndex]
        )
          ? prev[dayIndex]
          : [];

        const newDaySlots =
          daySlots.filter(
            (slot) =>
              slot.id !== slotId
          );

        return {
          ...prev,
          [dayIndex]: newDaySlots,
        };
      });
    },
    []
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
        setSchedule((prev) => {
          const daySlots = Array.isArray(
            prev[dayIndex]
          )
            ? prev[dayIndex]
            : [];

          return {
            ...prev,
            [dayIndex]: daySlots.map(
              (slot) =>
                slot.id === slotId
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
        });
      },
      []
    );

  /* =======================================================
     DROP ON DAY
  ======================================================= */

  const handleDropOnDay = useCallback(
    (e, dayIndex) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const rawData =
          e.dataTransfer.getData(
            'application/json'
          );

        if (!rawData) {
          return;
        }

        const data =
          JSON.parse(rawData);

        /* New drill from library */

        if (
          data.type === 'new-drill'
        ) {
          addDrillToDay(
            dayIndex,
            data.drillId
          );

          toast.success(
            `${
              TRAINING_DRILLS[
                data.drillId
              ]?.name ||
              'Drill'
            } added to ${
              DAY_NAMES[dayIndex]
            }`
          );

          return;
        }

        /* Existing schedule drill */

        if (
          data.type ===
          'schedule-drill'
        ) {
          moveScheduleDrill(
            data.dayIndex,
            data.slotId,
            dayIndex
          );

          return;
        }

        /*
          Player dropped directly on day:
          we don't add it because a player
          must belong to a drill.
        */

        if (
          data.type === 'player'
        ) {
          toast.error(
            'Drop the player inside a drill'
          );
        }
      } catch (error) {
        console.error(
          'Day drop error:',
          error
        );
      } finally {
        handleDragEnd();
      }
    },
    [
      addDrillToDay,
      moveScheduleDrill,
      handleDragEnd,
    ]
  );

  /* =======================================================
     DROP ON DRILL
  ======================================================= */

  const handleDropOnDrillSlot =
    useCallback(
      (
        e,
        dayIndex,
        slotId
      ) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          const rawData =
            e.dataTransfer.getData(
              'application/json'
            );

          if (!rawData) {
            return;
          }

          const data =
            JSON.parse(rawData);

          /*
            Player from squad panel.
          */

          if (
            data.type === 'player'
          ) {
            addPlayerToDrill(
              dayIndex,
              slotId,
              data.playerId
            );

            return;
          }

          /*
            Player already inside
            another drill.
          */

          if (
            data.type ===
            'schedule-player'
          ) {
            movePlayerToDrill(
              data.fromDayIndex,
              data.fromSlotId,
              data.playerId,
              dayIndex,
              slotId
            );

            return;
          }

          /*
            Existing drill dropped
            onto another drill.
            We move the whole drill
            to that day.
          */

          if (
            data.type ===
            'schedule-drill'
          ) {
            moveScheduleDrill(
              data.dayIndex,
              data.slotId,
              dayIndex
            );
          }
        } catch (error) {
          console.error(
            'Drill drop error:',
            error
          );
        } finally {
          handleDragEnd();
        }
      },
      [
        addPlayerToDrill,
        movePlayerToDrill,
        moveScheduleDrill,
        handleDragEnd,
      ]
    );

  /* =======================================================
     DRAG PLAYER INSIDE SCHEDULE
  ======================================================= */

  const handleDragStartSchedulePlayer =
    useCallback(
      (
        e,
        dayIndex,
        slotId,
        playerId
      ) => {
        setDraggedPlayer(null);
        setDraggedDrill(null);

        setDraggedScheduleDrill(
          null
        );

        e.dataTransfer.effectAllowed =
          'move';

        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({
            type: 'schedule-player',
            fromDayIndex:
              dayIndex,
            fromSlotId: slotId,
            playerId,
          })
        );
      },
      []
    );

  /* =======================================================
     MANUAL SAVE
  ======================================================= */

  const saveTrainingSchedule =
    useCallback(async () => {
      if (
        !user ||
        !careerData?.currentClub
      ) {
        toast.error(
          'No active club found'
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
            'Training schedule saved'
          );
        } else {
          toast.error(
            'Could not save training schedule'
          );
        }
      } catch (error) {
        console.error(
          'Manual save error:',
          error
        );

        toast.error(
          'Could not save training schedule'
        );
      } finally {
        setSaving(false);
      }
    }, [
      user,
      careerData?.currentClub,
      saveScheduleToFirestore,
    ]);

  /* =======================================================
     APPLY TRAINING
  ======================================================= */

  const applyTraining = async () => {
    if (
      !user ||
      !careerData?.currentClub ||
      !clubInfo
    ) {
      toast.error(
        'No active club found'
      );

      return;
    }

    try {
      setSaving(true);

      const playerUpdates = {};

      Object.entries(
        scheduleRef.current
      ).forEach(
        ([dayIndex, slots]) => {
          if (!Array.isArray(slots)) {
            return;
          }

          slots.forEach((slot) => {
            const drill =
              TRAINING_DRILLS[
                slot.drillId
              ];

            if (!drill) {
              return;
            }

            (
              slot.playerIds || []
            ).forEach(
              (playerId) => {
                const player =
                  players.find(
                    (p) =>
                      p.id ===
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
                  };
                }

                Object.entries(
                  drill.effects
                ).forEach(
                  ([
                    attribute,
                    range,
                  ]) => {
                    const gain =
                      Math.floor(
                        Math.random() *
                          (
                            range.max -
                            range.min +
                            1
                          ) +
                          range.min
                      );

                    const currentValue =
                      safeNumber(
                        playerUpdates[
                          playerId
                        ][
                          attribute
                        ] ??
                          player[
                            attribute
                          ],
                        0
                      );

                    playerUpdates[
                      playerId
                    ][attribute] =
                      Math.min(
                        currentValue +
                          gain,
                        99
                      );
                  }
                );

                const currentOverall =
                  getPlayerOverall(
                    playerUpdates[
                      playerId
                    ]
                  );

                playerUpdates[
                  playerId
                ].overall =
                  Math.min(
                    currentOverall +
                      Math.floor(
                        Math.random() *
                          2
                      ),
                    99
                  );

                playerUpdates[
                  playerId
                ].rating =
                  playerUpdates[
                    playerId
                  ].overall;
              }
            );
          });
        }
      );

      if (
        Object.keys(
          playerUpdates
        ).length === 0
      ) {
        toast.error(
          'No players assigned to training'
        );

        return;
      }

      /* ===================================================
         BATCH UPDATE
      =================================================== */

      const batch =
        writeBatch(db);

      Object.values(
        playerUpdates
      ).forEach(
        (updatedPlayer) => {
          const playerRef =
            doc(
              db,
              'players',
              updatedPlayer.id
            );

          const updateData = {
            overall:
              safeNumber(
                updatedPlayer.overall
              ),
            rating:
              safeNumber(
                updatedPlayer.rating
              ),

            shooting:
              safeNumber(
                updatedPlayer.shooting
              ),

            dribbling:
              safeNumber(
                updatedPlayer.dribbling
              ),

            pace:
              safeNumber(
                updatedPlayer.pace
              ),

            defending:
              safeNumber(
                updatedPlayer.defending
              ),

            physical:
              safeNumber(
                updatedPlayer.physical
              ),

            tackling:
              safeNumber(
                updatedPlayer.tackling
              ),

            passing:
              safeNumber(
                updatedPlayer.passing
              ),

            vision:
              safeNumber(
                updatedPlayer.vision
              ),

            technique:
              safeNumber(
                updatedPlayer.technique
              ),

            stamina:
              safeNumber(
                updatedPlayer.stamina
              ),

            finishing:
              safeNumber(
                updatedPlayer.finishing
              ),

            goalkeeping:
              safeNumber(
                updatedPlayer.goalkeeping
              ),

            reflexes:
              safeNumber(
                updatedPlayer.reflexes
              ),

            positioning:
              safeNumber(
                updatedPlayer.positioning
              ),

            teamwork:
              safeNumber(
                updatedPlayer.teamwork
              ),

            updatedAt:
              serverTimestamp(),
          };

          batch.update(
            playerRef,
            updateData
          );
        }
      );

      await batch.commit();

      /* ===================================================
         UPDATE LOCAL STATE
      =================================================== */

      setPlayers((prev) =>
        prev.map((player) => {
          if (
            playerUpdates[
              player.id
            ]
          ) {
            return {
              ...player,
              ...playerUpdates[
                player.id
              ],
            };
          }

          return player;
        })
      );

      toast.success(
        `Training completed: ${
          Object.keys(
            playerUpdates
          ).length
        } players improved`
      );
    } catch (error) {
      console.error(
        'Apply training error:',
        error
      );

      toast.error(
        'Could not apply training'
      );
    } finally {
      setSaving(false);
    }
  };

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

  const daySlots = Array.isArray(
    schedule[selectedDay]
  )
    ? schedule[selectedDay]
    : [];

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>
          Training Center -
          Virtual Football Manager
        </title>

        <meta
          name="description"
          content="Plan weekly training sessions and improve your squad."
        />
      </Head>

      <main
        className={styles.page}
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
              Drag drills to days,
              then drag players to
              drills to improve
              their abilities.
            </p>
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
              disabled={saving}
            >
              {saving
                ? 'Training...'
                : '🏋️ Apply Training'}
            </button>
          </div>
        </header>

        {/* =================================================
            TRAINING LAYOUT
        ================================================= */}

        <div
          className={
            styles.trainingLayout
          }
        >
          {/* ===============================================
              DRILLS PANEL
          =============================================== */}

          <aside
            className={
              styles.drillsPanel
            }
          >
            <h2>
              Training Drills
            </h2>

            <p>
              Drag a drill to a
              day
            </p>

            <div
              className={
                styles.drillList
              }
            >
              {Object.values(
                TRAINING_DRILLS
              ).map(
                (drill) => (
                  <div
                    key={
                      drill.id
                    }
                    className={
                      styles.drillCard
                    }
                    style={{
                      borderLeftColor:
                        drill.color,
                    }}
                    draggable
                    onDragStart={(
                      e
                    ) =>
                      handleDragStartDrill(
                        e,
                        drill.id
                      )
                    }
                    onDragEnd={
                      handleDragEnd
                    }
                  >
                    <div
                      className={
                        styles.drillIcon
                      }
                      style={{
                        background: `${drill.color}15`,
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
                        {
                          drill.duration
                        }
                        h session
                      </small>
                    </div>
                  </div>
                )
              )}
            </div>
          </aside>

          {/* ===============================================
              PLAYERS PANEL
          =============================================== */}

          <aside
            className={
              styles.playersPanel
            }
          >
            <h2>
              Squad Players
            </h2>

            <p>
              Drag players to a
              drill
            </p>

            <div
              className={
                styles.playerDragList
              }
            >
              {players
                .slice(0, 16)
                .map(
                  (player) => (
                    <div
                      key={
                        player.id
                      }
                      className={
                        styles.dragPlayer
                      }
                      draggable
                      onDragStart={(
                        e
                      ) =>
                        handleDragStartPlayer(
                          e,
                          player
                        )
                      }
                      onDragEnd={
                        handleDragEnd
                      }
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
                            .charAt(
                              0
                            )
                            .toUpperCase()
                        )}
                      </div>

                      <div>
                        <strong>
                          {getPlayerName(
                            player
                          )}
                        </strong>

                        <small>
                          {getPlayerPosition(
                            player
                          )}{' '}
                          • OVR{' '}
                          {getPlayerOverall(
                            player
                          )}
                        </small>
                      </div>
                    </div>
                  )
                )}
            </div>
          </aside>

          {/* ===============================================
              SCHEDULE
          =============================================== */}

          <section
            className={
              styles.schedulePanel
            }
          >
            <h2>
              Weekly Schedule
            </h2>

            <div
              className={
                styles.dayTabs
              }
            >
              {DAY_NAMES.map(
                (
                  day,
                  index
                ) => (
                  <button
                    key={day}
                    type="button"
                    className={
                      selectedDay ===
                      index
                        ? styles.activeDay
                        : ''
                    }
                    onClick={() => {
                      setSelectedDay(
                        index
                      );

                      setDropTarget(
                        null
                      );
                    }}
                  >
                    {day.slice(
                      0,
                      3
                    )}
                  </button>
                )
              )}
            </div>

            <div
              className={`${styles.dayDropZone} ${
                dropTarget ===
                `day-${selectedDay}`
                  ? styles.dropActive
                  : ''
              }`}
              onDragOver={(e) =>
                handleDragOver(
                  e,
                  `day-${selectedDay}`
                )
              }
              onDragLeave={
                handleDragEnd
              }
              onDrop={(e) =>
                handleDropOnDay(
                  e,
                  selectedDay
                )
              }
            >
              <div
                className={
                  styles.dayHeader
                }
              >
                <div>
                  <h3>
                    {
                      DAY_NAMES[
                        selectedDay
                      ]
                    }{' '}
                    Training
                  </h3>

                  <small>
                    {
                      daySlots.length
                    } /{' '}
                    {
                      MAX_DRILLS_PER_DAY
                    }{' '}
                    drills
                  </small>
                </div>
              </div>

              {/* =========================================
                  DRILLS
              ========================================= */}

              {daySlots.map(
                (
                  slot
                ) => {
                  const drill =
                    TRAINING_DRILLS[
                      slot.drillId
                    ];

                  if (
                    !drill
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={
                        slot.id
                      }
                      className={`${styles.scheduleSlot} ${
                        dropTarget ===
                        `slot-${selectedDay}-${slot.id}`
                          ? styles.slotActive
                          : ''
                      }`}
                      style={{
                        borderColor:
                          drill.color,
                      }}
                      onDragOver={(
                        e
                      ) =>
                        handleDragOver(
                          e,
                          `slot-${selectedDay}-${slot.id}`
                        )
                      }
                      onDragLeave={
                        handleDragEnd
                      }
                      onDrop={(
                        e
                      ) =>
                        handleDropOnDrillSlot(
                          e,
                          selectedDay,
                          slot.id
                        )
                      }
                    >
                      {/* DRILL HEADER */}

                      <div
                        className={
                          styles.slotHeader
                        }
                      >
                        <div
                          draggable
                          onDragStart={(
                            e
                          ) =>
                            handleDragStartScheduleDrill(
                              e,
                              selectedDay,
                              slot.id
                            )
                          }
                          onDragEnd={
                            handleDragEnd
                          }
                          style={{
                            cursor:
                              'grab',
                          }}
                        >
                          <span
                            style={{
                              color:
                                drill.color,
                            }}
                          >
                            {
                              drill.icon
                            }{' '}
                            {
                              drill.name
                            }
                          </span>

                          <small
                            style={{
                              marginLeft:
                                8,
                              opacity:
                                0.7,
                            }}
                          >
                            Drag to
                            another
                            day
                          </small>
                        </div>

                        <button
                          type="button"
                          className={
                            styles.removeButton
                          }
                          onClick={() =>
                            removeDrillFromDay(
                              selectedDay,
                              slot.id
                            )
                          }
                        >
                          ×
                        </button>
                      </div>

                      {/* PLAYERS */}

                      <div
                        className={
                          styles.slotPlayers
                        }
                      >
                        {slot
                          .playerIds
                          ?.length >
                        0 ? (
                          slot.playerIds.map(
                            (
                              playerId
                            ) => {
                              const player =
                                players.find(
                                  (
                                    p
                                  ) =>
                                    p.id ===
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
                                  draggable
                                  onDragStart={(
                                    e
                                  ) =>
                                    handleDragStartSchedulePlayer(
                                      e,
                                      selectedDay,
                                      slot.id,
                                      playerId
                                    )
                                  }
                                  onDragEnd={
                                    handleDragEnd
                                  }
                                >
                                  {getPlayerName(
                                    player
                                  )}

                                  <button
                                    type="button"
                                    onClick={() =>
                                      removePlayerFromDrill(
                                        selectedDay,
                                        slot.id,
                                        playerId
                                      )
                                    }
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
                            Drop players
                            here
                            <br />
                            <small>
                              Maximum 5
                              players
                            </small>
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.slotFooter
                        }
                      >
                        <span>
                          👥{' '}
                          {
                            slot
                              .playerIds
                              ?.length || 0
                          }
                          /
                          {
                            MAX_PLAYERS_PER_DRILL
                          }
                        </span>

                        <span>
                          ⏱️{' '}
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

              {/* EMPTY DAY */}

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
                    No training
                    scheduled
                  </strong>

                  <span>
                    Drag a drill
                    here to add
                    training
                  </span>
                </div>
              )}

              {/* MAX DRILLS */}

              {daySlots.length >=
                MAX_DRILLS_PER_DAY && (
                <div
                  className={
                    styles.scheduleLimit
                  }
                >
                  Maximum 3 drills
                  scheduled for this
                  day.
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
