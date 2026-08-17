// pages/training.js

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
  where,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import styles from './training.module.css';

/* =========================================================
   CONSTANTS
========================================================= */

const TRAINING_DAYS = 7;
const MAX_PLAYERS_PER_DRILL = 5;
const MAX_DRIILLS_PER_DAY = 3;

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

function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value.name || value.title || value.label || value.id || fallback;
  }
  return String(value);
}

function getPlayerName(player) {
  return (
    player.name ||
    player.fullName ||
    player.displayName ||
    `${player.firstName || ''} ${player.lastName || ''}`.trim() ||
    'Unknown Player'
  );
}

function getPlayerPosition(player) {
  return player.position || player.primaryPosition || player.role || 'MID';
}

function getPlayerOverall(player) {
  return safeNumber(
    player.overall ?? player.rating ?? player.overallRating,
    0
  );
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

  // Training schedule: { dayIndex: { drillId: string, playerIds: string[] }[] }
  const [schedule, setSchedule] = useState({});

  // Drag and drop state
  const [draggedPlayer, setDraggedPlayer] = useState(null);
  const [draggedDrill, setDraggedDrill] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // UI state
  const [selectedDay, setSelectedDay] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);

  const dragOverRef = useRef(null);

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      fetchTrainingData();
    }
  }, [user, loading, router]);

  /* =======================================================
     FETCH DATA
  ======================================================= */

  const fetchTrainingData = async () => {
    try {
      setIsLoading(true);

      const userRef = doc(db, 'users', user.uid);
      const userSnapshot = await getDoc(userRef);

      let career = {};

      if (userSnapshot.exists()) {
        const data = userSnapshot.data();
        career = data.careerData || {};
        setCareerData(career);
      }

      if (career.currentClub) {
        const clubRef = doc(db, 'clubs', career.currentClub);
        const clubSnapshot = await getDoc(clubRef);

        if (clubSnapshot.exists()) {
          setClubInfo({
            id: clubSnapshot.id,
            ...clubSnapshot.data(),
          });
        }

        // Load players
        const playersQuery = query(
          collection(db, 'players'),
          where('clubId', '==', career.currentClub)
        );

        const playersSnapshot = await getDocs(playersQuery);
        const playerList = [];

        playersSnapshot.forEach((docItem) => {
          const player = docItem.data();

          if (player.squadType !== 'youth' && player.isYouth !== true) {
            playerList.push({
              id: docItem.id,
              ...player,
            });
          }
        });

        playerList.sort((a, b) => getPlayerOverall(b) - getPlayerOverall(a));
        setPlayers(playerList);

        // Load existing schedule
        if (career.trainingSchedule) {
          setSchedule(career.trainingSchedule);
        }
      }
    } catch (error) {
      console.error('Error fetching training data:', error);
      toast.error('Failed to load training data');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     DRAG AND DROP
  ======================================================= */

  const handleDragStartPlayer = (e, player) => {
    setDraggedPlayer(player);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('type', 'player');
    e.dataTransfer.setData('playerId', player.id);
  };

  const handleDragStartDrill = (e, drillId) => {
    setDraggedDrill(drillId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('type', 'drill');
    e.dataTransfer.setData('drillId', drillId);
  };

  const handleDragOver = (e, target) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
    dragOverRef.current = target;
  };

  const handleDragLeave = () => {
    setDropTarget(null);
    dragOverRef.current = null;
  };

  const handleDropOnDay = (e, dayIndex) => {
    e.preventDefault();

    const type = e.dataTransfer.getData('type');

    if (type === 'drill') {
      const drillId = e.dataTransfer.getData('drillId');
      addDrillToDay(dayIndex, drillId);
    }

    setDraggedDrill(null);
    setDropTarget(null);
    dragOverRef.current = null;
  };

  const handleDropOnDrillSlot = (e, dayIndex, slotIndex) => {
    e.preventDefault();

    const type = e.dataTransfer.getData('type');

    if (type === 'player') {
      const playerId = e.dataTransfer.getData('playerId');
      addPlayerToDrill(dayIndex, slotIndex, playerId);
    }

    setDraggedPlayer(null);
    setDropTarget(null);
    dragOverRef.current = null;
  };

  /* =======================================================
     SCHEDULE OPERATIONS
  ======================================================= */

  const addDrillToDay = (dayIndex, drillId) => {
    const daySlots = schedule[dayIndex] || [];

    if (daySlots.length >= MAX_DRIILLS_PER_DAY) {
      toast.error('Maximum 3 drills per day');
      return;
    }

    const newDaySlots = [
      ...daySlots,
      {
        drillId,
        playerIds: [],
      },
    ];

    setSchedule((prev) => ({
      ...prev,
      [dayIndex]: newDaySlots,
    }));
  };

  const addPlayerToDrill = (dayIndex, slotIndex, playerId) => {
    const daySlots = schedule[dayIndex] || [];

    if (!daySlots[slotIndex]) return;

    const slot = daySlots[slotIndex];

    if (slot.playerIds.length >= MAX_PLAYERS_PER_DRILL) {
      toast.error('Maximum 5 players per drill');
      return;
    }

    if (slot.playerIds.includes(playerId)) {
      toast.error('Player already in this drill');
      return;
    }

    const newDaySlots = daySlots.map((s, i) => {
      if (i === slotIndex) {
        return {
          ...s,
          playerIds: [...s.playerIds, playerId],
        };
      }
      return s;
    });

    setSchedule((prev) => ({
      ...prev,
      [dayIndex]: newDaySlots,
    }));
  };

  const removeDrillFromDay = (dayIndex, slotIndex) => {
    const daySlots = schedule[dayIndex] || [];

    const newDaySlots = daySlots.filter((_, i) => i !== slotIndex);

    setSchedule((prev) => ({
      ...prev,
      [dayIndex]: newDaySlots,
    }));
  };

  const removePlayerFromDrill = (dayIndex, slotIndex, playerId) => {
    const daySlots = schedule[dayIndex] || [];

    const newDaySlots = daySlots.map((s, i) => {
      if (i === slotIndex) {
        return {
          ...s,
          playerIds: s.playerIds.filter((id) => id !== playerId),
        };
      }
      return s;
    });

    setSchedule((prev) => ({
      ...prev,
      [dayIndex]: newDaySlots,
    }));
  };

  /* =======================================================
     SAVE TRAINING SCHEDULE
  ======================================================= */

  const saveTrainingSchedule = async () => {
    if (!user || !careerData?.currentClub) return;

    try {
      setSaving(true);

      await updateDoc(doc(db, 'users', user.uid), {
        'careerData.trainingSchedule': schedule,
        'careerData.trainingScheduleUpdatedAt': new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });

      setCareerData((prev) => ({
        ...prev,
        trainingSchedule: schedule,
        trainingScheduleUpdatedAt: new Date().toISOString(),
      }));

      toast.success('Training schedule saved');
    } catch (error) {
      console.error('Save schedule error:', error);
      toast.error('Could not save training schedule');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     APPLY TRAINING EFFECTS
  ======================================================= */

  const applyTraining = async () => {
    if (!user || !careerData?.currentClub || !clubInfo) return;

    try {
      setSaving(true);

      const updates = [];
      const playerUpdates = {};

      Object.entries(schedule).forEach(([dayIndex, slots]) => {
        slots.forEach((slot) => {
          const drill = TRAINING_DRILLS[slot.drillId];

          if (!drill) return;

          slot.playerIds.forEach((playerId) => {
            const player = players.find((p) => p.id === playerId);

            if (!player) return;

            if (!playerUpdates[playerId]) {
              playerUpdates[playerId] = { ...player };
            }

            Object.entries(drill.effects).forEach(([attribute, range]) => {
              const gain = Math.floor(
                Math.random() * (range.max - range.min + 1) + range.min
              );

              const currentValue = safeNumber(
                playerUpdates[playerId][attribute] ?? player[attribute],
                0
              );

              playerUpdates[playerId][attribute] = Math.min(
                currentValue + gain,
                99
              );
            });

            // Increase overall slightly
            const currentOverall = getPlayerOverall(playerUpdates[playerId]);
            playerUpdates[playerId].overall = Math.min(
              currentOverall + Math.floor(Math.random() * 2),
              99
            );
            playerUpdates[playerId].rating = playerUpdates[playerId].overall;

            updates.push({
              playerId,
              data: playerUpdates[playerId],
            });
          });
        });
      });

      // Batch update players
      const batch = writeBatch(db);

      Object.values(playerUpdates).forEach((updatedPlayer) => {
        const playerRef = doc(db, 'players', updatedPlayer.id);

        batch.update(playerRef, {
          overall: updatedPlayer.overall,
          rating: updatedPlayer.rating,
          shooting: updatedPlayer.shooting,
          dribbling: updatedPlayer.dribbling,
          pace: updatedPlayer.pace,
          defending: updatedPlayer.defending,
          physical: updatedPlayer.physical,
          tackling: updatedPlayer.tackling,
          passing: updatedPlayer.passing,
          vision: updatedPlayer.vision,
          technique: updatedPlayer.technique,
          stamina: updatedPlayer.stamina,
          finishing: updatedPlayer.finishing,
          goalkeeping: updatedPlayer.goalkeeping,
          reflexes: updatedPlayer.reflexes,
          positioning: updatedPlayer.positioning,
          teamwork: updatedPlayer.teamwork,
          updatedAt: serverTimestamp(),
        });
      });

      if (Object.keys(playerUpdates).length > 0) {
        await batch.commit();
      }

      // Update players state
      setPlayers((prev) =>
        prev.map((player) => {
          if (playerUpdates[player.id]) {
            return {
              ...player,
              ...playerUpdates[player.id],
            };
          }
          return player;
        })
      );

      toast.success(`Training completed: ${Object.keys(playerUpdates).length} players improved`);
    } catch (error) {
      console.error('Apply training error:', error);
      toast.error('Could not apply training');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading training...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      <Head>
        <title>Training Center - Virtual Football Manager</title>
        <meta
          name="description"
          content="Plan weekly training sessions and improve your squad."
        />
      </Head>

      <main className={styles.page}>
        {/* HEADER */}
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>CLUB DEVELOPMENT</span>
            <h1>Training Center</h1>
            <p>
              Drag and drop players to training drills to improve their
              abilities.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.saveButton}
              onClick={saveTrainingSchedule}
              disabled={saving}
            >
              💾 Save Schedule
            </button>

            <button
              type="button"
              className={styles.applyButton}
              onClick={applyTraining}
              disabled={saving}
            >
              {saving ? 'Training...' : '🏋️ Apply Training'}
            </button>
          </div>
        </header>

        {/* TRAINING LAYOUT */}
        <div className={styles.trainingLayout}>
          {/* DRILLS PANEL */}
          <aside className={styles.drillsPanel}>
            <h2>Training Drills</h2>
            <p>Drag a drill to a day slot</p>

            <div className={styles.drillList}>
              {Object.values(TRAINING_DRILLS).map((drill) => (
                <div
                  key={drill.id}
                  className={styles.drillCard}
                  style={{ borderLeftColor: drill.color }}
                  draggable
                  onDragStart={(e) => handleDragStartDrill(e, drill.id)}
                >
                  <div
                    className={styles.drillIcon}
                    style={{ background: `${drill.color}15` }}
                  >
                    {drill.icon}
                  </div>

                  <div className={styles.drillInfo}>
                    <strong style={{ color: drill.color }}>{drill.name}</strong>
                    <p>{drill.description}</p>
                    <small>
                      {drill.duration} hour
                      {drill.duration > 1 ? 's' : ''}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* PLAYERS PANEL */}
          <aside className={styles.playersPanel}>
            <h2>Squad Players</h2>
            <p>Drag a player to a drill slot</p>

            <div className={styles.playerDragList}>
              {players.slice(0, 16).map((player) => (
                <div
                  key={player.id}
                  className={styles.dragPlayer}
                  draggable
                  onDragStart={(e) => handleDragStartPlayer(e, player)}
                >
                  <div className={styles.dragPlayerAvatar}>
                    {player.photo ? (
                      <img src={player.photo} alt={getPlayerName(player)} />
                    ) : (
                      getPlayerName(player).charAt(0).toUpperCase()
                    )}
                  </div>

                  <div>
                    <strong>{getPlayerName(player)}</strong>
                    <small>
                      {getPlayerPosition(player)} • OVR {getPlayerOverall(player)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* SCHEDULE GRID */}
          <section className={styles.schedulePanel}>
            <h2>Weekly Schedule</h2>

            <div className={styles.dayTabs}>
              {dayNames.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className={selectedDay === index ? styles.activeDay : ''}
                  onClick={() => setSelectedDay(index)}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>

            <div
              className={`${styles.dayDropZone} ${
                dropTarget === `day-${selectedDay}` ? styles.dropActive : ''
              }`}
              onDragOver={(e) => handleDragOver(e, `day-${selectedDay}`)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnDay(e, selectedDay)}
            >
              <h3>{dayNames[selectedDay]} Training</h3>

              {(schedule[selectedDay] || []).map((slot, slotIndex) => {
                const drill = TRAINING_DRILLS[slot.drillId];

                if (!drill) return null;

                return (
                  <div
                    key={slotIndex}
                    className={`${styles.scheduleSlot} ${
                      dropTarget === `slot-${selectedDay}-${slotIndex}`
                        ? styles.slotActive
                        : ''
                    }`}
                    style={{ borderColor: drill.color }}
                    onDragOver={(e) =>
                      handleDragOver(e, `slot-${selectedDay}-${slotIndex}`)
                    }
                    onDragLeave={handleDragLeave}
                    onDrop={(e) =>
                      handleDropOnDrillSlot(e, selectedDay, slotIndex)
                    }
                  >
                    <div className={styles.slotHeader}>
                      <span style={{ color: drill.color }}>
                        {drill.icon} {drill.name}
                      </span>

                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => removeDrillFromDay(selectedDay, slotIndex)}
                      >
                        ×
                      </button>
                    </div>

                    <div className={styles.slotPlayers}>
                      {slot.playerIds.length > 0 ? (
                        slot.playerIds.map((playerId) => {
                          const player = players.find((p) => p.id === playerId);

                          if (!player) return null;

                          return (
                            <span
                              key={playerId}
                              className={styles.slotPlayer}
                            >
                              {getPlayerName(player)}
                              <button
                                type="button"
                                onClick={() =>
                                  removePlayerFromDrill(
                                    selectedDay,
                                    slotIndex,
                                    playerId
                                  )
                                }
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      ) : (
                        <span className={styles.emptySlot}>
                          Drop players here (max 5)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {!schedule[selectedDay] ||
                schedule[selectedDay].length === 0 ? (
                <div className={styles.noDrills}>
                  Drop a drill here to add training
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
