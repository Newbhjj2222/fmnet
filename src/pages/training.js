// pages/training.js

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

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
    description:
      'Improve shooting, finishing, and offensive movement',
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
    description:
      'Improve tackling, marking, and defensive positioning',
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
    description:
      'Improve passing accuracy and vision',
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
    description:
      'Improve stamina, strength, and physical condition',
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
    description:
      'Improve finishing and long shots',
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
    description:
      'Improve goalkeeping, reflexes, and positioning',
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
    description:
      'Improve tactical awareness and teamwork',
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
    description:
      'Improve free kicks, corners, and penalties',
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
  if (
    value === null ||
    value === undefined ||
    value === ''
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

/* =========================================================
   NORMALIZE OLD SCHEDULE
========================================================= */

function normalizeSchedule(rawSchedule) {
  if (
    !rawSchedule ||
    typeof rawSchedule !== 'object'
  ) {
    return {};
  }

  const normalized = {};

  for (let day = 0; day < 7; day += 1) {
    const rawDay = rawSchedule[day];

    if (!Array.isArray(rawDay)) {
      continue;
    }

    const slots = rawDay
      .map((slot) => {
        if (
          !slot ||
          typeof slot !== 'object'
        ) {
          return null;
        }

        const drillId =
          slot.drillId;

        if (
          !TRAINING_DRILLS[drillId]
        ) {
          return null;
        }

        return {
          id:
            slot.id ||
            createId('drill'),

          drillId,

          playerIds:
            Array.isArray(
              slot.playerIds
            )
              ? [
                  ...new Set(
                    slot.playerIds.map(
                      String
                    )
                  ),
                ]
              : [],
        };
      })
      .filter(Boolean)
      .slice(
        0,
        MAX_DRILLS_PER_DAY
      );

    if (slots.length > 0) {
      normalized[day] = slots;
    }
  }

  return normalized;
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
    dropTarget,
    setDropTarget,
  ] = useState(null);

  const [
    activeDrag,
    setActiveDrag,
  ] = useState(null);

  /*
    Reference containing the current
    schedule without waiting for React
    to finish a render.
  */

  const scheduleRef =
    useRef({});

  /*
    Pointer drag reference.

    This is the important part for
    Android / touch devices.
  */

  const pointerDragRef =
    useRef(null);

  const pointerMovedRef =
    useRef(false);

  const autoSaveTimerRef =
    useRef(null);

  const suppressClickRef =
    useRef(false);

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
    if (loading) {
      return;
    }

    if (!user) {
      router.push('/login');
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
      if (!user) {
        return;
      }

      try {
        setIsLoading(true);

        const userRef = doc(
          db,
          'users',
          user.uid
        );

        const userSnapshot =
          await getDoc(userRef);

        if (
          !userSnapshot.exists()
        ) {
          toast.error(
            'User account not found'
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

        /* ================================================
           CLUB
        ================================================ */

        const clubRef = doc(
          db,
          'clubs',
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
        } else {
          setClubInfo(null);
        }

        /* ================================================
           PLAYERS
        ================================================ */

        const playersQuery =
          query(
            collection(
              db,
              'players'
            ),
            where(
              'clubId',
              '==',
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
            const player =
              playerDoc.data();

            if (
              player.squadType !==
                'youth' &&
              player.isYouth !== true
            ) {
              playerList.push({
                id: playerDoc.id,
                ...player,
              });
            }
          }
        );

        playerList.sort(
          (a, b) =>
            getPlayerOverall(b) -
            getPlayerOverall(a)
        );

        setPlayers(
          playerList
        );

        /* ================================================
           SCHEDULE
        ================================================ */

        const normalized =
          normalizeSchedule(
            career.trainingSchedule
          );

        setSchedule(normalized);

        scheduleRef.current =
          normalized;
      } catch (error) {
        console.error(
          'Error fetching training data:',
          error
        );

        toast.error(
          'Failed to load training data'
        );
      } finally {
        setIsLoading(false);
      }
    };

  /* =======================================================
     SAVE TO FIRESTORE
  ======================================================= */

  const saveScheduleToFirestore =
    useCallback(
      async (scheduleToSave) => {
        if (
          !user ||
          !careerData?.currentClub
        ) {
          return false;
        }

        try {
          await updateDoc(
            doc(
              db,
              'users',
              user.uid
            ),
            {
              'careerData.trainingSchedule':
                scheduleToSave,

              'careerData.trainingScheduleUpdatedAt':
                new Date().toISOString(),

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
                new Date().toISOString(),
            })
          );

          return true;
        } catch (error) {
          console.error(
            'Save schedule error:',
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

    if (
      autoSaveTimerRef.current
    ) {
      clearTimeout(
        autoSaveTimerRef.current
      );
    }

    autoSaveTimerRef.current =
      setTimeout(() => {
        saveScheduleToFirestore(
          scheduleRef.current
        );
      }, 700);

    return () => {
      if (
        autoSaveTimerRef.current
      ) {
        clearTimeout(
          autoSaveTimerRef.current
        );
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
     UPDATE SCHEDULE HELPER
  ======================================================= */

  const updateSchedule =
    useCallback((updater) => {
      setSchedule((previous) => {
        const next =
          typeof updater ===
          'function'
            ? updater(previous)
            : updater;

        scheduleRef.current =
          next;

        return next;
      });
    }, []);

  /* =======================================================
     ADD DRILL
  ======================================================= */

  const addDrillToDay =
    useCallback(
      (dayIndex, drillId) => {
        if (
          !TRAINING_DRILLS[
            drillId
          ]
        ) {
          return false;
        }

        let added = false;

        updateSchedule(
          (previous) => {
            const daySlots =
              Array.isArray(
                previous[
                  dayIndex
                ]
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
                'Maximum 3 drills per day'
              );

              return previous;
            }

            daySlots.push({
              id: createId(
                'drill'
              ),

              drillId,

              playerIds: [],
            });

            added = true;

            return {
              ...previous,

              [dayIndex]:
                daySlots,
            };
          }
        );

        return added;
      },
      [updateSchedule]
    );

  /* =======================================================
     MOVE EXISTING DRILL
  ======================================================= */

  const moveScheduleDrill =
    useCallback(
      (
        fromDay,
        slotId,
        toDay
      ) => {
        if (
          fromDay === toDay
        ) {
          return;
        }

        updateSchedule(
          (previous) => {
            const source =
              Array.isArray(
                previous[
                  fromDay
                ]
              )
                ? [
                    ...previous[
                      fromDay
                    ],
                  ]
                : [];

            const target =
              Array.isArray(
                previous[
                  toDay
                ]
              )
                ? [
                    ...previous[
                      toDay
                    ],
                  ]
                : [];

            const index =
              source.findIndex(
                (slot) =>
                  slot.id ===
                  slotId
              );

            if (index === -1) {
              return previous;
            }

            if (
              target.length >=
              MAX_DRILLS_PER_DAY
            ) {
              toast.error(
                'Maximum 3 drills per day'
              );

              return previous;
            }

            const [
              movedSlot,
            ] =
              source.splice(
                index,
                1
              );

            target.push(
              movedSlot
            );

            toast.success(
              `Training moved to ${DAY_NAMES[toDay]}`
            );

            return {
              ...previous,

              [fromDay]:
                source,

              [toDay]:
                target,
            };
          }
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
                previous[
                  dayIndex
                ]
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
              target.playerIds.length >=
              MAX_PLAYERS_PER_DRILL
            ) {
              toast.error(
                'Maximum 5 players per drill'
              );

              return previous;
            }

            if (
              target.playerIds.includes(
                playerId
              )
            ) {
              toast.error(
                'Player already in this drill'
              );

              return previous;
            }

            toast.success(
              'Player added to training'
            );

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
     MOVE PLAYER
  ======================================================= */

  const movePlayerToDrill =
    useCallback(
      (
        fromDay,
        fromSlotId,
        playerId,
        toDay,
        toSlotId
      ) => {
        updateSchedule(
          (previous) => {
            const source =
              Array.isArray(
                previous[
                  fromDay
                ]
              )
                ? [
                    ...previous[
                      fromDay
                    ],
                  ]
                : [];

            const target =
              Array.isArray(
                previous[
                  toDay
                ]
              )
                ? [
                    ...previous[
                      toDay
                    ],
                  ]
                : [];

            const sourceSlot =
              source.find(
                (slot) =>
                  slot.id ===
                  fromSlotId
              );

            const targetSlot =
              target.find(
                (slot) =>
                  slot.id ===
                  toSlotId
              );

            if (
              !sourceSlot ||
              !targetSlot
            ) {
              return previous;
            }

            if (
              fromDay === toDay &&
              fromSlotId ===
                toSlotId
            ) {
              return previous;
            }

            if (
              targetSlot.playerIds.length >=
              MAX_PLAYERS_PER_DRILL
            ) {
              toast.error(
                'Maximum 5 players per drill'
              );

              return previous;
            }

            if (
              targetSlot.playerIds.includes(
                playerId
              )
            ) {
              toast.error(
                'Player already in this drill'
              );

              return previous;
            }

            const newSource =
              source.map(
                (slot) =>
                  slot.id ===
                  fromSlotId
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
              );

            const newTarget =
              target.map(
                (slot) =>
                  slot.id ===
                  toSlotId
                    ? {
                        ...slot,

                        playerIds:
                          [
                            ...slot.playerIds,
                            playerId,
                          ],
                      }
                    : slot
              );

            toast.success(
              'Player moved to training'
            );

            return {
              ...previous,

              [fromDay]:
                newSource,

              [toDay]:
                newTarget,
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
                previous[
                  dayIndex
                ]
              )
                ? previous[
                    dayIndex
                  ]
                : [];

            const filtered =
              daySlots.filter(
                (slot) =>
                  slot.id !==
                  slotId
              );

            return {
              ...previous,

              [dayIndex]:
                filtered,
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
                previous[
                  dayIndex
                ]
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
     POINTER DRAG START
  ======================================================= */

  const startPointerDrag =
    useCallback(
      (
        e,
        dragData
      ) => {
        if (
          e.pointerType ===
          'mouse'
        ) {
          return;
        }

        e.preventDefault();

        pointerMovedRef.current =
          false;

        suppressClickRef.current =
          false;

        pointerDragRef.current = {
          ...dragData,

          pointerId:
            e.pointerId,

          x: e.clientX,
          y: e.clientY,

          started: false,
        };

        setActiveDrag(
          dragData
        );

        setDropTarget(null);

        try {
          e.currentTarget.setPointerCapture(
            e.pointerId
          );
        } catch {
          // Ignore pointer capture errors.
        }
      },
      []
    );

  /* =======================================================
     FIND DROP TARGET
  ======================================================= */

  const findPointerDropTarget =
    useCallback(
      (x, y) => {
        const element =
          document.elementFromPoint(
            x,
            y
          );

        if (!element) {
          return null;
        }

        const slot =
          element.closest(
            '[data-training-slot]'
          );

        if (slot) {
          return {
            type: 'slot',
            day: Number(
              slot.dataset.day
            ),
            slotId:
              slot.dataset.slotId,
          };
        }

        const day =
          element.closest(
            '[data-training-day]'
          );

        if (day) {
          return {
            type: 'day',
            day: Number(
              day.dataset.day
            ),
          };
        }

        return null;
      },
      []
    );

  /* =======================================================
     POINTER MOVE
  ======================================================= */

  const handlePointerMove =
    useCallback(
      (e) => {
        const drag =
          pointerDragRef.current;

        if (!drag) {
          return;
        }

        const distance =
          Math.sqrt(
            Math.pow(
              e.clientX -
                drag.x,
              2
            ) +
              Math.pow(
                e.clientY -
                  drag.y,
                2
              )
          );

        if (distance > 8) {
          pointerMovedRef.current =
            true;

          suppressClickRef.current =
            true;

          drag.started = true;
        }

        if (!drag.started) {
          return;
        }

        const target =
          findPointerDropTarget(
            e.clientX,
            e.clientY
          );

        if (!target) {
          setDropTarget(null);
          return;
        }

        if (
          target.type ===
          'slot'
        ) {
          setDropTarget(
            `slot-${target.day}-${target.slotId}`
          );
        } else {
          setDropTarget(
            `day-${target.day}`
          );
        }

        e.preventDefault();
      },
      [findPointerDropTarget]
    );

  /* =======================================================
     POINTER DROP
  ======================================================= */

  const finishPointerDrag =
    useCallback(
      (e) => {
        const drag =
          pointerDragRef.current;

        if (!drag) {
          return;
        }

        const target =
          findPointerDropTarget(
            e.clientX,
            e.clientY
          );

        const wasDragging =
          drag.started;

        pointerDragRef.current =
          null;

        setActiveDrag(null);
        setDropTarget(null);

        if (!wasDragging) {
          return;
        }

        e.preventDefault();

        if (!target) {
          toast.error(
            'Drop the item inside a training day or drill'
          );

          return;
        }

        /* ================================================
           NEW DRILL
        ================================================ */

        if (
          drag.type ===
          'new-drill'
        ) {
          if (
            target.type ===
            'day'
          ) {
            addDrillToDay(
              target.day,
              drag.drillId
            );
          } else {
            addDrillToDay(
              target.day,
              drag.drillId
            );
          }

          return;
        }

        /* ================================================
           EXISTING DRILL
        ================================================ */

        if (
          drag.type ===
          'schedule-drill'
        ) {
          if (
            target.type ===
            'day'
          ) {
            moveScheduleDrill(
              drag.fromDay,
              drag.slotId,
              target.day
            );

            return;
          }

          if (
            target.type ===
            'slot'
          ) {
            moveScheduleDrill(
              drag.fromDay,
              drag.slotId,
              target.day
            );

            return;
          }
        }

        /* ================================================
           PLAYER
        ================================================ */

        if (
          drag.type ===
          'player'
        ) {
          if (
            target.type ===
            'slot'
          ) {
            addPlayerToDrill(
              target.day,
              target.slotId,
              drag.playerId
            );

            return;
          }

          toast.error(
            'Drop the player inside a drill'
          );

          return;
        }

        /* ================================================
           EXISTING SCHEDULE PLAYER
        ================================================ */

        if (
          drag.type ===
          'schedule-player'
        ) {
          if (
            target.type ===
            'slot'
          ) {
            movePlayerToDrill(
              drag.fromDay,
              drag.fromSlotId,
              drag.playerId,
              target.day,
              target.slotId
            );

            return;
          }

          toast.error(
            'Drop the player inside a drill'
          );
        }
      },
      [
        findPointerDropTarget,
        addDrillToDay,
        moveScheduleDrill,
        addPlayerToDrill,
        movePlayerToDrill,
      ]
    );

  /* =======================================================
     GLOBAL POINTER LISTENERS
  ======================================================= */

  useEffect(() => {
    const onMove = (e) => {
      handlePointerMove(e);
    };

    const onUp = (e) => {
      finishPointerDrag(e);
    };

    window.addEventListener(
      'pointermove',
      onMove,
      {
        passive: false,
      }
    );

    window.addEventListener(
      'pointerup',
      onUp,
      {
        passive: false,
      }
    );

    window.addEventListener(
      'pointercancel',
      onUp,
      {
        passive: false,
      }
    );

    return () => {
      window.removeEventListener(
        'pointermove',
        onMove
      );

      window.removeEventListener(
        'pointerup',
        onUp
      );

      window.removeEventListener(
        'pointercancel',
        onUp
      );
    };
  }, [
    handlePointerMove,
    finishPointerDrag,
  ]);

  /* =======================================================
     NATIVE DESKTOP DRAG START
  ======================================================= */

  const handleNativeDragStart =
    useCallback(
      (
        e,
        dragData
      ) => {
        setActiveDrag(
          dragData
        );

        e.dataTransfer.effectAllowed =
          dragData.type ===
          'new-drill'
            ? 'copy'
            : 'move';

        e.dataTransfer.setData(
          'application/json',
          JSON.stringify(
            dragData
          )
        );
      },
      []
    );

  /* =======================================================
     NATIVE DRAG END
  ======================================================= */

  const handleNativeDragEnd =
    useCallback(() => {
      setActiveDrag(null);
      setDropTarget(null);
    }, []);

  /* =======================================================
     NATIVE DRAG OVER
  ======================================================= */

  const handleNativeDragOver =
    useCallback(
      (e, target) => {
        e.preventDefault();

        e.dataTransfer.dropEffect =
          activeDrag?.type ===
          'new-drill'
            ? 'copy'
            : 'move';

        setDropTarget(target);
      },
      [activeDrag]
    );

  /* =======================================================
     NATIVE DROP
  ======================================================= */

  const handleNativeDrop =
    useCallback(
      (
        e,
        target
      ) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          const raw =
            e.dataTransfer.getData(
              'application/json'
            );

          if (!raw) {
            return;
          }

          const data =
            JSON.parse(raw);

          /* NEW DRILL */

          if (
            data.type ===
            'new-drill'
          ) {
            addDrillToDay(
              target.day,
              data.drillId
            );

            return;
          }

          /* EXISTING DRILL */

          if (
            data.type ===
            'schedule-drill'
          ) {
            moveScheduleDrill(
              data.fromDay,
              data.slotId,
              target.day
            );

            return;
          }

          /* PLAYER */

          if (
            data.type ===
            'player'
          ) {
            if (
              target.type !==
              'slot'
            ) {
              toast.error(
                'Drop the player inside a drill'
              );

              return;
            }

            addPlayerToDrill(
              target.day,
              target.slotId,
              data.playerId
            );

            return;
          }

          /* SCHEDULE PLAYER */

          if (
            data.type ===
            'schedule-player'
          ) {
            if (
              target.type !==
              'slot'
            ) {
              toast.error(
                'Drop the player inside a drill'
              );

              return;
            }

            movePlayerToDrill(
              data.fromDay,
              data.fromSlotId,
              data.playerId,
              target.day,
              target.slotId
            );
          }
        } catch (error) {
          console.error(
            'Native drop error:',
            error
          );
        } finally {
          setActiveDrag(null);
          setDropTarget(null);
        }
      },
      [
        addDrillToDay,
        moveScheduleDrill,
        addPlayerToDrill,
        movePlayerToDrill,
      ]
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
      } finally {
        setSaving(false);
      }
    };

  /* =======================================================
     APPLY TRAINING
  ======================================================= */

  const applyTraining =
    async () => {
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

        const playerUpdates =
          {};

        Object.entries(
          scheduleRef.current
        ).forEach(
          ([dayIndex, slots]) => {
            if (
              !Array.isArray(
                slots
              )
            ) {
              return;
            }

            slots.forEach(
              (slot) => {
                const drill =
                  TRAINING_DRILLS[
                    slot.drillId
                  ];

                if (!drill) {
                  return;
                }

                (
                  slot.playerIds ||
                  []
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

                        const current =
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
                            current +
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
            'No players assigned to training'
          );

          return;
        }

        const batch =
          writeBatch(db);

        Object.values(
          playerUpdates
        ).forEach(
          (player) => {
            const playerRef =
              doc(
                db,
                'players',
                player.id
              );

            batch.update(
              playerRef,
              {
                overall:
                  safeNumber(
                    player.overall
                  ),

                rating:
                  safeNumber(
                    player.rating
                  ),

                shooting:
                  safeNumber(
                    player.shooting
                  ),

                dribbling:
                  safeNumber(
                    player.dribbling
                  ),

                pace:
                  safeNumber(
                    player.pace
                  ),

                defending:
                  safeNumber(
                    player.defending
                  ),

                physical:
                  safeNumber(
                    player.physical
                  ),

                tackling:
                  safeNumber(
                    player.tackling
                  ),

                passing:
                  safeNumber(
                    player.passing
                  ),

                vision:
                  safeNumber(
                    player.vision
                  ),

                technique:
                  safeNumber(
                    player.technique
                  ),

                stamina:
                  safeNumber(
                    player.stamina
                  ),

                finishing:
                  safeNumber(
                    player.finishing
                  ),

                goalkeeping:
                  safeNumber(
                    player.goalkeeping
                  ),

                reflexes:
                  safeNumber(
                    player.reflexes
                  ),

                positioning:
                  safeNumber(
                    player.positioning
                  ),

                teamwork:
                  safeNumber(
                    player.teamwork
                  ),

                updatedAt:
                  serverTimestamp(),
              }
            );
          }
        );

        await batch.commit();

        setPlayers(
          (previous) =>
            previous.map(
              (player) =>
                playerUpdates[
                  player.id
                ]
                  ? {
                      ...player,
                      ...playerUpdates[
                        player.id
                      ],
                    }
                  : player
            )
        );

        toast.success(
          `Training completed: ${ids.length} players improved`
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

  const daySlots =
    Array.isArray(
      schedule[
        selectedDay
      ]
    )
      ? schedule[
          selectedDay
        ]
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
        className={
          styles.page
        }
      >
        {/* ===============================================
            HEADER
        =============================================== */}

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
              Drag drills to
              days and players
              to drills.
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

        {/* ===============================================
            MAIN LAYOUT
        =============================================== */}

        <div
          className={
            styles.trainingLayout
          }
        >
          {/* =============================================
              DRILLS
          ============================================= */}

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
              training day
            </p>

            <div
              className={
                styles.drillList
              }
            >
              {Object.values(
                TRAINING_DRILLS
              ).map(
                (drill) => {
                  const dragData = {
                    type:
                      'new-drill',
                    drillId:
                      drill.id,
                  };

                  return (
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

                        touchAction:
                          'none',

                        userSelect:
                          'none',
                      }}
                      draggable
                      onDragStart={(
                        e
                      ) =>
                        handleNativeDragStart(
                          e,
                          dragData
                        )
                      }
                      onDragEnd={
                        handleNativeDragEnd
                      }
                      onPointerDown={(
                        e
                      ) =>
                        startPointerDrag(
                          e,
                          dragData
                        )
                      }
                      onClick={() => {
                        if (
                          suppressClickRef.current
                        ) {
                          suppressClickRef.current =
                            false;

                          return;
                        }

                        /*
                          Tap fallback:
                          tap a drill to add
                          it to selected day.
                        */

                        addDrillToDay(
                          selectedDay,
                          drill.id
                        );
                      }}
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
                          h
                        </small>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </aside>

          {/* =============================================
              PLAYERS
          ============================================= */}

          <aside
            className={
              styles.playersPanel
            }
          >
            <h2>
              Squad Players
            </h2>

            <p>
              Drag a player into
              a drill
            </p>

            <div
              className={
                styles.playerDragList
              }
            >
              {players
                .slice(0, 16)
                .map(
                  (player) => {
                    const dragData = {
                      type:
                        'player',
                      playerId:
                        player.id,
                    };

                    return (
                      <div
                        key={
                          player.id
                        }
                        className={
                          styles.dragPlayer
                        }
                        style={{
                          touchAction:
                            'none',

                          userSelect:
                            'none',
                        }}
                        draggable
                        onDragStart={(
                          e
                        ) =>
                          handleNativeDragStart(
                            e,
                            dragData
                          )
                        }
                        onDragEnd={
                          handleNativeDragEnd
                        }
                        onPointerDown={(
                          e
                        ) =>
                          startPointerDrag(
                            e,
                            dragData
                          )
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
                    );
                  }
                )}
            </div>
          </aside>

          {/* =============================================
              SCHEDULE
          ============================================= */}

          <section
            className={
              styles.schedulePanel
            }
          >
            <h2>
              Weekly Schedule
            </h2>

            {/* DAYS */}

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
                    key={
                      day
                    }
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

            {/* DAY DROP ZONE */}

            <div
              className={`${styles.dayDropZone} ${
                dropTarget ===
                `day-${selectedDay}`
                  ? styles.dropActive
                  : ''
              }`}
              data-training-day={
                selectedDay
              }
              onDragOver={(e) =>
                handleNativeDragOver(
                  e,
                  `day-${selectedDay}`
                )
              }
              onDrop={(e) =>
                handleNativeDrop(
                  e,
                  {
                    type:
                      'day',

                    day:
                      selectedDay,
                  }
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
                  SCHEDULE SLOTS
              ========================================= */}

              {daySlots.map(
                (slot) => {
                  const drill =
                    TRAINING_DRILLS[
                      slot.drillId
                    ];

                  if (!drill) {
                    return null;
                  }

                  const drillDragData =
                    {
                      type:
                        'schedule-drill',

                      fromDay:
                        selectedDay,

                      slotId:
                        slot.id,
                    };

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
                      data-training-slot="true"
                      data-day={
                        selectedDay
                      }
                      data-slot-id={
                        slot.id
                      }
                      style={{
                        borderColor:
                          drill.color,
                      }}
                      onDragOver={(
                        e
                      ) =>
                        handleNativeDragOver(
                          e,
                          `slot-${selectedDay}-${slot.id}`
                        )
                      }
                      onDrop={(e) =>
                        handleNativeDrop(
                          e,
                          {
                            type:
                              'slot',

                            day:
                              selectedDay,

                            slotId:
                              slot.id,
                          }
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
                          style={{
                            cursor:
                              'grab',

                            touchAction:
                              'none',

                            userSelect:
                              'none',
                          }}
                          onDragStart={(
                            e
                          ) =>
                            handleNativeDragStart(
                              e,
                              drillDragData
                            )
                          }
                          onDragEnd={
                            handleNativeDragEnd
                          }
                          onPointerDown={(
                            e
                          ) =>
                            startPointerDrag(
                              e,
                              drillDragData
                            )
                          }
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

                              const playerDragData =
                                {
                                  type:
                                    'schedule-player',

                                  fromDay:
                                    selectedDay,

                                  fromSlotId:
                                    slot.id,

                                  playerId,
                                };

                              return (
                                <span
                                  key={
                                    playerId
                                  }
                                  className={
                                    styles.slotPlayer
                                  }
                                  draggable
                                  style={{
                                    touchAction:
                                      'none',

                                    userSelect:
                                      'none',
                                  }}
                                  onDragStart={(
                                    e
                                  ) =>
                                    handleNativeDragStart(
                                      e,
                                      playerDragData
                                    )
                                  }
                                  onDragEnd={
                                    handleNativeDragEnd
                                  }
                                  onPointerDown={(
                                    e
                                  ) =>
                                    startPointerDrag(
                                      e,
                                      playerDragData
                                    )
                                  }
                                >
                                  {getPlayerName(
                                    player
                                  )}

                                  <button
                                    type="button"
                                    onPointerDown={(
                                      e
                                    ) =>
                                      e.stopPropagation()
                                    }
                                    onClick={(
                                      e
                                    ) => {
                                      e.stopPropagation();

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
                            Drop player
                            here
                            <br />
                            <small>
                              Maximum 5
                            </small>
                          </span>
                        )}
                      </div>

                      {/* SLOT FOOTER */}

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
                              ?.length ||
                            0
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

              {/* EMPTY */}

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
                    here or tap a
                    drill to add it
                  </span>
                </div>
              )}

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

        {/* ===============================================
            MOBILE DRAG INDICATOR
        =============================================== */}

        {activeDrag && (
          <div
            style={{
              position:
                'fixed',

              left: 12,
              right: 12,
              bottom: 16,

              zIndex: 99999,

              padding:
                '12px 16px',

              borderRadius:
                12,

              background:
                'rgba(15,23,42,0.95)',

              color:
                '#fff',

              textAlign:
                'center',

              pointerEvents:
                'none',

              boxShadow:
                '0 10px 30px rgba(0,0,0,0.35)',
            }}
          >
            {activeDrag.type ===
              'new-drill' &&
              `Moving ${TRAINING_DRILLS[activeDrag.drillId]?.name || 'drill'}...`}

            {activeDrag.type ===
              'schedule-drill' &&
              'Move training to another day...'}

            {(activeDrag.type ===
              'player' ||
              activeDrag.type ===
                'schedule-player') &&
              'Move player into a training drill...'}
          </div>
        )}
      </main>
    </>
  );
}
