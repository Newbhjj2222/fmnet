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
const AI_TRAINING_INTERVAL_DAYS = 7;

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
    category: 'attack',
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
    category: 'defense',
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
    category: 'midfield',
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
    category: 'physical',
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
    category: 'attack',
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
    category: 'goalkeeper',
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
    category: 'tactical',
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
    category: 'attack',
  },
  recovery: {
    id: 'recovery',
    name: 'Recovery Session',
    icon: '🧊',
    color: '#06b6d4',
    description: 'Restore player stamina and reduce fatigue',
    effects: {
      stamina: { min: 2, max: 5 },
      physical: { min: 1, max: 3 },
    },
    duration: 1,
    category: 'physical',
  },
  agility: {
    id: 'agility',
    name: 'Agility Training',
    icon: '🏃',
    color: '#a3e635',
    description: 'Improve pace, acceleration, and quickness',
    effects: {
      pace: { min: 2, max: 4 },
      dribbling: { min: 0, max: 2 },
      physical: { min: 0, max: 2 },
    },
    duration: 1,
    category: 'physical',
  },
  heading: {
    id: 'heading',
    name: 'Heading Practice',
    icon: '🎯',
    color: '#fbbf24',
    description: 'Improve aerial ability and heading accuracy',
    effects: {
      heading: { min: 1, max: 3 },
      physical: { min: 0, max: 2 },
      positioning: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: 'attack',
  },
  crossing: {
    id: 'crossing',
    name: 'Crossing Drill',
    icon: '🔄',
    color: '#fb923c',
    description: 'Improve crossing accuracy and delivery',
    effects: {
      crossing: { min: 1, max: 3 },
      passing: { min: 0, max: 2 },
      technique: { min: 0, max: 1 },
    },
    duration: 1.5,
    category: 'midfield',
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
  return player?.position || player?.primaryPosition || player?.role || 'MID';
}

function getPlayerOverall(player) {
  return safeNumber(
    player?.overall ?? player?.rating ?? player?.overallRating,
    0
  );
}

function createId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* =========================================================
   NORMALIZE OLD SCHEDULE
========================================================= */

function normalizeSchedule(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') {
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
        if (!slot || typeof slot !== 'object') return null;

        const drillId = slot.drillId;

        if (!TRAINING_DRILLS[drillId]) return null;

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
  const { user, loading } = useAuth();

  const [careerData, setCareerData] = useState(null);
  const [clubInfo, setClubInfo] = useState(null);
  const [players, setPlayers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [schedule, setSchedule] = useState({});
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [showDrillPicker, setShowDrillPicker] = useState(false);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [drillFilter, setDrillFilter] = useState('all');

  const scheduleRef = useRef({});

  /* =======================================================
     SYNC SCHEDULE REF
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
     FETCH TRAINING DATA
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
        scheduleRef.current = {};
        return;
      }

      const clubRef = doc(db, 'clubs', career.currentClub);
      const clubSnapshot = await getDoc(clubRef);

      if (clubSnapshot.exists()) {
        setClubInfo({
          id: clubSnapshot.id,
          ...clubSnapshot.data(),
        });
      }

      const playersQuery = query(
        collection(db, 'players'),
        where('clubId', '==', career.currentClub)
      );

      const playersSnapshot = await getDocs(playersQuery);
      const playerList = [];

      playersSnapshot.forEach((playerDoc) => {
        const player = playerDoc.data();

        if (player.squadType !== 'youth' && player.isYouth !== true) {
          playerList.push({
            id: playerDoc.id,
            ...player,
          });
        }
      });

      playerList.sort((a, b) => getPlayerOverall(b) - getPlayerOverall(a));
      setPlayers(playerList);

      const normalized = normalizeSchedule(career.trainingSchedule);
      setSchedule(normalized);
      scheduleRef.current = normalized;
    } catch (error) {
      console.error('Error fetching training data:', error);
      toast.error('Failed to load training data');
    } finally {
      setIsLoading(false);
    }
  };

  /* =======================================================
     SAVE TO FIRESTORE
  ======================================================= */

  const saveScheduleToFirestore = useCallback(
    async (scheduleToSave) => {
      if (!user || !careerData?.currentClub) return false;

      try {
        await updateDoc(doc(db, 'users', user.uid), {
          'careerData.trainingSchedule': scheduleToSave,
          'careerData.trainingScheduleUpdatedAt': new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });

        setCareerData((previous) => ({
          ...(previous || {}),
          trainingSchedule: scheduleToSave,
          trainingScheduleUpdatedAt: new Date().toISOString(),
        }));

        return true;
      } catch (error) {
        console.error('Save schedule error:', error);
        return false;
      }
    },
    [user, careerData?.currentClub]
  );

  /* =======================================================
     AUTO SAVE
  ======================================================= */

  useEffect(() => {
    if (isLoading || !user || !careerData?.currentClub) return;

    const timer = setTimeout(() => {
      saveScheduleToFirestore(scheduleRef.current);
    }, 700);

    return () => clearTimeout(timer);
  }, [schedule, isLoading, user, careerData?.currentClub, saveScheduleToFirestore]);

  /* =======================================================
     UPDATE SCHEDULE HELPER
  ======================================================= */

  const updateSchedule = useCallback((updater) => {
    setSchedule((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      scheduleRef.current = next;
      return next;
    });
  }, []);

  /* =======================================================
     ADD DRILL
  ======================================================= */

  const addDrillToDay = useCallback(
    (dayIndex, drillId) => {
      if (!TRAINING_DRILLS[drillId]) return;

      updateSchedule((previous) => {
        const daySlots = Array.isArray(previous[dayIndex])
          ? [...previous[dayIndex]]
          : [];

        if (daySlots.length >= MAX_DRILLS_PER_DAY) {
          toast.error('Maximum 3 drills per day');
          return previous;
        }

        daySlots.push({
          id: createId('drill'),
          drillId,
          playerIds: [],
        });

        return {
          ...previous,
          [dayIndex]: daySlots,
        };
      });

      setShowDrillPicker(false);
      toast.success(`${TRAINING_DRILLS[drillId].name} added to ${DAY_NAMES[dayIndex]}`);
    },
    [updateSchedule]
  );

  /* =======================================================
     ADD PLAYER
  ======================================================= */

  const addPlayerToDrill = useCallback(
    (dayIndex, slotId, playerId) => {
      updateSchedule((previous) => {
        const daySlots = Array.isArray(previous[dayIndex])
          ? previous[dayIndex]
          : [];

        const target = daySlots.find((slot) => slot.id === slotId);

        if (!target) return previous;

        if (target.playerIds.length >= MAX_PLAYERS_PER_DRILL) {
          toast.error('Maximum 5 players per drill');
          return previous;
        }

        if (target.playerIds.includes(playerId)) {
          toast.error('Player already in this drill');
          return previous;
        }

        toast.success('Player added to training');

        return {
          ...previous,
          [dayIndex]: daySlots.map((slot) =>
            slot.id === slotId
              ? { ...slot, playerIds: [...slot.playerIds, playerId] }
              : slot
          ),
        };
      });

      setShowPlayerPicker(false);
    },
    [updateSchedule]
  );

  /* =======================================================
     REMOVE DRILL
  ======================================================= */

  const removeDrillFromDay = useCallback(
    (dayIndex, slotId) => {
      updateSchedule((previous) => {
        const daySlots = Array.isArray(previous[dayIndex])
          ? previous[dayIndex]
          : [];

        return {
          ...previous,
          [dayIndex]: daySlots.filter((slot) => slot.id !== slotId),
        };
      });
    },
    [updateSchedule]
  );

  /* =======================================================
     REMOVE PLAYER
  ======================================================= */

  const removePlayerFromDrill = useCallback(
    (dayIndex, slotId, playerId) => {
      updateSchedule((previous) => {
        const daySlots = Array.isArray(previous[dayIndex])
          ? previous[dayIndex]
          : [];

        return {
          ...previous,
          [dayIndex]: daySlots.map((slot) =>
            slot.id === slotId
              ? {
                  ...slot,
                  playerIds: slot.playerIds.filter((id) => id !== playerId),
                }
              : slot
          ),
        };
      });
    },
    [updateSchedule]
  );

  /* =======================================================
     MANUAL SAVE
  ======================================================= */

  const saveTrainingSchedule = async () => {
    if (!user || !careerData?.currentClub) {
      toast.error('No active club found');
      return;
    }

    try {
      setSaving(true);
      const success = await saveScheduleToFirestore(scheduleRef.current);

      if (success) {
        toast.success('Training schedule saved');
      } else {
        toast.error('Could not save training schedule');
      }
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     APPLY TRAINING
  ======================================================= */

  const applyTraining = async () => {
    if (!user || !careerData?.currentClub || !clubInfo) {
      toast.error('No active club found');
      return;
    }

    try {
      setSaving(true);

      const playerUpdates = {};

      Object.entries(scheduleRef.current).forEach(([dayIndex, slots]) => {
        if (!Array.isArray(slots)) return;

        slots.forEach((slot) => {
          const drill = TRAINING_DRILLS[slot.drillId];

          if (!drill) return;

          (slot.playerIds || []).forEach((playerId) => {
            const player = players.find((p) => p.id === playerId);

            if (!player) return;

            if (!playerUpdates[playerId]) {
              playerUpdates[playerId] = { ...player };
            }

            Object.entries(drill.effects).forEach(([attribute, range]) => {
              const gain = Math.floor(
                Math.random() * (range.max - range.min + 1) + range.min
              );

              const current = safeNumber(
                playerUpdates[playerId][attribute] ?? player[attribute],
                0
              );

              playerUpdates[playerId][attribute] = Math.min(current + gain, 99);
            });

            const currentOverall = getPlayerOverall(playerUpdates[playerId]);
            playerUpdates[playerId].overall = Math.min(
              currentOverall + Math.floor(Math.random() * 2),
              99
            );
            playerUpdates[playerId].rating = playerUpdates[playerId].overall;
          });
        });
      });

      const ids = Object.keys(playerUpdates);

      if (ids.length === 0) {
        toast.error('No players assigned to training');
        return;
      }

      const batch = writeBatch(db);

      Object.values(playerUpdates).forEach((player) => {
        const playerRef = doc(db, 'players', player.id);

        batch.update(playerRef, {
          overall: safeNumber(player.overall),
          rating: safeNumber(player.rating),
          shooting: safeNumber(player.shooting),
          dribbling: safeNumber(player.dribbling),
          pace: safeNumber(player.pace),
          defending: safeNumber(player.defending),
          physical: safeNumber(player.physical),
          tackling: safeNumber(player.tackling),
          passing: safeNumber(player.passing),
          vision: safeNumber(player.vision),
          technique: safeNumber(player.technique),
          stamina: safeNumber(player.stamina),
          finishing: safeNumber(player.finishing),
          goalkeeping: safeNumber(player.goalkeeping),
          reflexes: safeNumber(player.reflexes),
          positioning: safeNumber(player.positioning),
          teamwork: safeNumber(player.teamwork),
          heading: safeNumber(player.heading),
          crossing: safeNumber(player.crossing),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();

      setPlayers((previous) =>
        previous.map((player) =>
          playerUpdates[player.id]
            ? { ...player, ...playerUpdates[player.id] }
            : player
        )
      );

      toast.success(`Training completed: ${ids.length} players improved`);
    } catch (error) {
      console.error('Apply training error:', error);
      toast.error('Could not apply training');
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     SYSTEM AI TRAINING
  ======================================================= */

  const processSystemAITraining = useCallback(async () => {
    if (!user || isSaving) return;

    try {
      const clubsSnapshot = await getDocs(collection(db, 'clubs'));
      const aiClubs = [];

      clubsSnapshot.forEach((clubDoc) => {
        const clubData = clubDoc.data();

        if (!clubData.managerId) {
          aiClubs.push({
            id: clubDoc.id,
            ...clubData,
          });
        }
      });

      if (aiClubs.length === 0) return;

      const batch = writeBatch(db);
      let trainedCount = 0;

      for (const aiClub of aiClubs) {
        const playersQuery = query(
          collection(db, 'players'),
          where('clubId', '==', aiClub.id)
        );

        const playersSnapshot = await getDocs(playersQuery);
        const clubPlayers = [];

        playersSnapshot.forEach((playerDoc) => {
          const player = playerDoc.data();

          if (player.squadType !== 'youth' && player.isYouth !== true) {
            clubPlayers.push({
              id: playerDoc.id,
              ...player,
            });
          }
        });

        if (clubPlayers.length === 0) continue;

        // Pick random players to train (up to 11)
        const shuffled = [...clubPlayers].sort(() => Math.random() - 0.5);
        const selectedPlayers = shuffled.slice(0, Math.min(11, shuffled.length));

        // Pick random drills
        const drillIds = Object.keys(TRAINING_DRILLS);
        const selectedDrills = drillIds
          .sort(() => Math.random() - 0.5)
          .slice(0, 3);

        selectedPlayers.forEach((player) => {
          const drillId = selectedDrills[Math.floor(Math.random() * selectedDrills.length)];
          const drill = TRAINING_DRILLS[drillId];

          if (!drill) return;

          const updates = {};

          Object.entries(drill.effects).forEach(([attribute, range]) => {
            const gain = Math.floor(
              Math.random() * (range.max - range.min + 1) + range.min
            );

            updates[attribute] = Math.min(
              safeNumber(player[attribute], 0) + gain,
              99
            );
          });

          updates.overall = Math.min(
            getPlayerOverall(player) + Math.floor(Math.random() * 2),
            99
          );
          updates.rating = updates.overall;
          updates.updatedAt = serverTimestamp();

          const playerRef = doc(db, 'players', player.id);
          batch.update(playerRef, updates);
          trainedCount++;
        });
      }

      if (trainedCount > 0) {
        await batch.commit();
        console.log(`System trained ${trainedCount} AI club players`);
      }
    } catch (error) {
      console.error('System AI training error:', error);
    }
  }, [user, isSaving]);

  /* =======================================================
     RUN SYSTEM AI TRAINING
  ======================================================= */

  useEffect(() => {
    if (!user || !careerData?.currentClub) return;

    const interval = setInterval(() => {
      processSystemAITraining();
    }, 60000 * AI_TRAINING_INTERVAL_DAYS);

    return () => clearInterval(interval);
  }, [user, careerData?.currentClub, processSystemAITraining]);

  /* =======================================================
     LOADING
  ======================================================= */

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        <p>Loading training...</p>
      </div>
    );
  }

  if (!user) return null;

  const daySlots = Array.isArray(schedule[selectedDay])
    ? schedule[selectedDay]
    : [];

  const filteredDrills = Object.values(TRAINING_DRILLS).filter((drill) => {
    if (drillFilter === 'all') return true;
    return drill.category === drillFilter;
  });

  const drillCategories = [
    { value: 'all', label: 'All Drills', icon: '📋' },
    { value: 'attack', label: 'Attack', icon: '⚽' },
    { value: 'defense', label: 'Defense', icon: '🛡️' },
    { value: 'midfield', label: 'Midfield', icon: '🦶' },
    { value: 'physical', label: 'Physical', icon: '💪' },
    { value: 'tactical', label: 'Tactical', icon: '📋' },
    { value: 'goalkeeper', label: 'Goalkeeper', icon: '🧤' },
  ];

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
            <p>Assign drills and players to improve your squad.</p>
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

        {/* MAIN LAYOUT */}
        <div className={styles.trainingLayout}>
          {/* DRILLS PANEL */}
          <aside className={styles.drillsPanel}>
            <h2>Training Drills</h2>
            <p>Tap a drill to add it to the selected day</p>

            <div className={styles.drillFilterTabs}>
              {drillCategories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  className={drillFilter === cat.value ? styles.activeFilter : ''}
                  onClick={() => setDrillFilter(cat.value)}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>

            <div className={styles.drillList}>
              {filteredDrills.map((drill) => (
                <div
                  key={drill.id}
                  className={styles.drillCard}
                  style={{ borderLeftColor: drill.color }}
                  onClick={() => addDrillToDay(selectedDay, drill.id)}
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
                    <small>⏱️ {drill.duration}h • Tap to add</small>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* PLAYERS PANEL */}
          <aside className={styles.playersPanel}>
            <h2>Squad Players</h2>
            <p>Select a drill first, then add players</p>

            <div className={styles.playerDragList}>
              {players.slice(0, 16).map((player) => (
                <div
                  key={player.id}
                  className={styles.dragPlayer}
                  onClick={() => {
                    if (selectedSlot) {
                      addPlayerToDrill(selectedDay, selectedSlot, player.id);
                    } else {
                      toast.error('Select a drill first');
                    }
                  }}
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

                  <span className={styles.addIcon}>+</span>
                </div>
              ))}
            </div>
          </aside>

          {/* SCHEDULE PANEL */}
          <section className={styles.schedulePanel}>
            <h2>Weekly Schedule</h2>

            <div className={styles.dayTabs}>
              {DAY_NAMES.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className={selectedDay === index ? styles.activeDay : ''}
                  onClick={() => {
                    setSelectedDay(index);
                    setSelectedSlot(null);
                  }}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>

            <div className={styles.dayDropZone}>
              <div className={styles.dayHeader}>
                <div>
                  <h3>{DAY_NAMES[selectedDay]} Training</h3>
                  <small>
                    {daySlots.length} / {MAX_DRILLS_PER_DAY} drills
                  </small>
                </div>
              </div>

              {/* SCHEDULE SLOTS */}
              {daySlots.map((slot) => {
                const drill = TRAINING_DRILLS[slot.drillId];

                if (!drill) return null;

                const isSelected = selectedSlot === slot.id;

                return (
                  <div
                    key={slot.id}
                    className={`${styles.scheduleSlot} ${
                      isSelected ? styles.slotSelected : ''
                    }`}
                    style={{ borderColor: drill.color }}
                    onClick={() => setSelectedSlot(isSelected ? null : slot.id)}
                  >
                    <div className={styles.slotHeader}>
                      <span style={{ color: drill.color }}>
                        {drill.icon} {drill.name}
                      </span>

                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDrillFromDay(selectedDay, slot.id);
                          if (selectedSlot === slot.id) setSelectedSlot(null);
                        }}
                      >
                        ×
                      </button>
                    </div>

                    <div className={styles.slotPlayers}>
                      {slot.playerIds?.length > 0 ? (
                        slot.playerIds.map((playerId) => {
                          const player = players.find((p) => p.id === playerId);

                          if (!player) return null;

                          return (
                            <span key={playerId} className={styles.slotPlayer}>
                              {getPlayerName(player)}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removePlayerFromDrill(selectedDay, slot.id, playerId);
                                }}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      ) : (
                        <span className={styles.emptySlot}>
                          {isSelected
                            ? 'Tap players to add them here'
                            : 'Select this drill to add players'}
                        </span>
                      )}
                    </div>

                    <div className={styles.slotFooter}>
                      <span>👥 {slot.playerIds?.length || 0} / {MAX_PLAYERS_PER_DRILL}</span>
                      <span>⏱️ {drill.duration}h</span>
                    </div>
                  </div>
                );
              })}

              {daySlots.length === 0 && (
                <div className={styles.noDrills}>
                  <div>📋</div>
                  <strong>No training scheduled</strong>
                  <span>Tap a drill from the left panel to add it</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
