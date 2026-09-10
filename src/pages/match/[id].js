import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  collection, doc, getDoc, getDocs, query,
  updateDoc, where, serverTimestamp,
} from "firebase/firestore";

import { db } from "../../components/firebase";
import { useAuth } from "../../context/AuthContext";
import MatchEngine from "../../lib/match-engine/MatchEngine";
import MatchCanvas from "../../components/match/MatchCanvas";
import {
  MATCH_STATUS, TACTICAL_VALUES,
} from "../../lib/match-engine/constants";
import styles from "./Match.module.css";

export default function MatchPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [match, setMatch] = useState(null);
  const [homeClub, setHomeClub] = useState(null);
  const [awayClub, setAwayClub] = useState(null);
  const [engine, setEngine] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [saving, setSaving] = useState(false);

  const [userSide, setUserSide] = useState("home");
  const [tactics, setTactics] = useState(null);
  const [subOut, setSubOut] = useState("");
  const [subIn, setSubIn] = useState("");
  const [subMessage, setSubMessage] = useState("");

  const engineRef = useRef(null);
  const lastSaveRef = useRef(0);

  /* ====== LOAD PLAYERS ====== */
  const loadPlayers = useCallback(async clubId => {
    if (!clubId) return [];
    const playersRef = collection(db, "players");
    const queries = [
      query(playersRef, where("clubId", "==", clubId)),
      query(playersRef, where("currentClub", "==", clubId)),
      query(playersRef, where("teamId", "==", clubId)),
    ];
    const snaps = await Promise.all(
      queries.map(async q => {
        try { return await getDocs(q); } catch { return null; }
      })
    );
    const unique = new Map();
    snaps.forEach(s => {
      if (!s) return;
      s.docs.forEach(d => unique.set(d.id, { id: d.id, ...d.data() }));
    });
    return Array.from(unique.values());
  }, []);

  /* ====== LOAD MATCH ====== */
  const loadMatch = useCallback(async () => {
    if (authLoading || !id) return;
    try {
      setLoading(true);
      setError("");

      const matchSnap = await getDoc(doc(db, "matches", String(id)));
      if (!matchSnap.exists()) throw new Error("Match not found.");
      const matchData = { id: matchSnap.id, ...matchSnap.data() };

      const [homeSnap, awaySnap] = await Promise.all([
        matchData.homeClubId
          ? getDoc(doc(db, "clubs", matchData.homeClubId)) : null,
        matchData.awayClubId
          ? getDoc(doc(db, "clubs", matchData.awayClubId)) : null,
      ]);

      const home = homeSnap?.exists()
        ? { id: homeSnap.id, ...homeSnap.data() }
        : { id: matchData.homeClubId, name: matchData.homeClubName || "Home" };
      const away = awaySnap?.exists()
        ? { id: awaySnap.id, ...awaySnap.data() }
        : { id: matchData.awayClubId, name: matchData.awayClubName || "Away" };

      const [homePlayers, awayPlayers] = await Promise.all([
        loadPlayers(home.id),
        loadPlayers(away.id),
      ]);

      if (homePlayers.length < 11)
        throw new Error(`${home.name} does not have enough players.`);
      if (awayPlayers.length < 11)
        throw new Error(`${away.name} does not have enough players.`);

      const newEngine = new MatchEngine({
        match: matchData,
        homeClub: home,
        awayClub: away,
        homePlayers,
        awayPlayers,
      });

      // ===== USER SIDE detection =====
      const userClubId =
        user?.clubId || user?.teamId || user?.managedClubId || null;

      let side = "home";
      if (userClubId) {
        if (String(home.id) === String(userClubId)) side = "home";
        else if (String(away.id) === String(userClubId)) side = "away";
      } else {
        // Niba nta club id ifitwe, home ihabwa user
        side = "home";
      }

      newEngine.setUserControlled(side);
      engineRef.current = newEngine;

      setEngine(newEngine);
      setMatch(matchData);
      setHomeClub(home);
      setAwayClub(away);
      setUserSide(side);
      setSnapshot(newEngine.getSnapshot());

      const userTactics = side === "home"
        ? newEngine.homeTactics : newEngine.awayTactics;
      setTactics({ ...userTactics });
    } catch (err) {
      console.error("MATCH LOAD ERROR:", err);
      setError(err?.message || "Failed to load match.");
    } finally {
      setLoading(false);
    }
  }, [id, authLoading, loadPlayers, user]);

  useEffect(() => {
    loadMatch();
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, [loadMatch]);

  /* ====== SAVE TO FIRESTORE ====== */
  const saveMatch = useCallback(async (force = false) => {
    const current = engineRef.current;
    if (!current || !match?.id) return;

    const now = Date.now();
    if (!force && now - lastSaveRef.current < 10000) return;
    lastSaveRef.current = now;

    try {
      setSaving(true);
      const data = current.getSnapshot();
      await updateDoc(doc(db, "matches", match.id), {
        status: data.status,
        minute: data.minute,
        homeScore: data.homeScore,
        awayScore: data.awayScore,
        result: { homeScore: data.homeScore, awayScore: data.awayScore },
        events: data.events,
        homeStats: data.homeStats,
        awayStats: data.awayStats,
        homeFormation: data.homeFormation,
        awayFormation: data.awayFormation,
        homeTactics: data.homeTactics,
        awayTactics: data.awayTactics,
        homeLineupIds: current.homeXI.map(p => p.id),
        awayLineupIds: current.awayXI.map(p => p.id),
        homeSubsUsed: data.substitutions.home,
        awaySubsUsed: data.substitutions.away,
        homeInjuries: data.injuries.home,
        awayInjuries: data.injuries.away,
        userControlledSide: current.userControlled || "home",
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("MATCH SAVE ERROR:", err);
    } finally {
      setSaving(false);
    }
  }, [match]);

  /* ====== SNAPSHOT TICK ====== */
  useEffect(() => {
    if (!engine) return;
    const timer = setInterval(() => {
      const data = engine.getSnapshot();
      setSnapshot(data);
      const liveUser = userSide === "home"
        ? engine.homeTactics : engine.awayTactics;
      setTactics(prev => prev ? { ...prev, ...liveUser } : { ...liveUser });

      if (data.status === MATCH_STATUS.FINISHED) saveMatch(true);
      else saveMatch(false);
    }, 250);
    return () => clearInterval(timer);
  }, [engine, saveMatch, userSide]);

  /* ====== CONTROLS ====== */
  const startMatch = () => { engine?.start(); saveMatch(true); };
  const pauseMatch = () => { engine?.pause(); saveMatch(true); };
  const resumeMatch = () => { engine?.resume(); saveMatch(true); };
  const stopMatch = () => { engine?.stop(); saveMatch(true); };

  const updateTactic = (key, value) => {
    if (!engine) return;
    engine.setTactics(userSide, { [key]: value });
    setTactics(prev => ({ ...prev, [key]: value }));
    setTimeout(() => saveMatch(true), 100);
  };

  const doSub = () => {
    if (!engine || !subOut || !subIn) return;
    const ok = engine.performSubstitution(userSide, subOut, subIn);
    if (ok) {
      setSubOut("");
      setSubIn("");
      setSubMessage("Substitution yagenze neza ✅");
      setTimeout(() => setSubMessage(""), 2500);
      setSnapshot(engine.getSnapshot());
      saveMatch(true);
    } else {
      setSubMessage("Ntibishoboka (max 5?)");
      setTimeout(() => setSubMessage(""), 2500);
    }
  };

  /* ====== MEMOS ====== */
  const ballOwner = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.players.find(p => p.hasBall) || null;
  }, [snapshot]);

  const recentEvents = useMemo(
    () => snapshot?.events?.slice(0, 10) || [], [snapshot]
  );

  const myLineup = useMemo(() => {
    if (!snapshot) return [];
    return userSide === "home"
      ? snapshot.homeLineup || [] : snapshot.awayLineup || [];
  }, [snapshot, userSide]);

  const myBench = useMemo(() => {
    if (!snapshot) return [];
    return userSide === "home"
      ? snapshot.homeBench || [] : snapshot.awayBench || [];
  }, [snapshot, userSide]);

  const oppBench = useMemo(() => {
    if (!snapshot) return [];
    return userSide === "home"
      ? snapshot.awayBench || [] : snapshot.homeBench || [];
  }, [snapshot, userSide]);

  const mySubsUsed = useMemo(() => {
    if (!snapshot) return 0;
    return userSide === "home"
      ? snapshot.substitutions?.home ?? 0
      : snapshot.substitutions?.away ?? 0;
  }, [snapshot, userSide]);

  /* ====== LOADING / ERROR ====== */
  if (authLoading || loading) {
    return (
      <main className={styles.loadingPage}>
        <div className={styles.spinner} />
        <h2>Loading Match Engine</h2>
        <p>Loading clubs, players and match intelligence...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.errorPage}>
        <div className={styles.errorIcon}>⚠️</div>
        <h1>Match Error</h1>
        <p>{error}</p>
        <button
          onClick={() => router.push("/fixtures")}
          className={styles.primaryButton}
        >
          ← Back to Fixtures
        </button>
      </main>
    );
  }

  if (!engine || !snapshot || !homeClub || !awayClub) return null;

  const score = `${snapshot.homeScore} - ${snapshot.awayScore}`;
  const minute = snapshot.minute ?? 0;
  const status = snapshot.status || "loading";
  const myClub = userSide === "home" ? homeClub : awayClub;

  return (
    <>
      <Head>
        <title>{homeClub.name} vs {awayClub.name} | Match Centre</title>
        <meta name="theme-color" content="#050816" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className={styles.page}>
        <header className={styles.header}>
          <button
            className={styles.backButton}
            onClick={() => router.push("/fixtures")}
          >
            ← Fixtures
          </button>
          <div className={styles.headerTitle}>
            <span>{match?.leagueName || match?.competition || "Football Match"}</span>
            <h1>Match Centre</h1>
          </div>
          <div className={styles.statusBadge}>
            {saving ? "SAVING" : status.toUpperCase()}
          </div>
        </header>

        <section className={styles.scoreboard}>
          <div className={styles.teamScore}>
            <div className={styles.logo}>
              {homeClub.logo ? <img src={homeClub.logo} alt="" /> : "⚽"}
            </div>
            <strong>
              {homeClub.name}{userSide === "home" ? " ⭐" : ""}
            </strong>
            <span>HOME</span>
          </div>

          <div className={styles.scoreCenter}>
            <small>{minute}'</small>
            <strong>{score}</strong>
            <span>{status}</span>
          </div>

          <div className={styles.teamScore}>
            <div className={styles.logo}>
              {awayClub.logo ? <img src={awayClub.logo} alt="" /> : "⚽"}
            </div>
            <strong>
              {awayClub.name}{userSide === "away" ? " ⭐" : ""}
            </strong>
            <span>AWAY</span>
          </div>
        </section>

        <section className={styles.mainGrid}>
          <div className={styles.pitchCard}>
            <MatchCanvas engine={engine} />
          </div>

          <aside className={styles.sidebar}>
            {/* CONTROLS */}
            <section className={styles.controlCard}>
              <h2>Match Controls</h2>
              <div className={styles.buttonGrid}>
                {status === MATCH_STATUS.READY && (
                  <button className={styles.primaryButton} onClick={startMatch}>
                    ▶ Start
                  </button>
                )}
                {status === MATCH_STATUS.LIVE && (
                  <button className={styles.secondaryButton} onClick={pauseMatch}>
                    ⏸ Pause
                  </button>
                )}
                {status === MATCH_STATUS.HALF_TIME && (
                  <button className={styles.primaryButton} onClick={resumeMatch}>
                    ▶ Resume
                  </button>
                )}
                {status === MATCH_STATUS.LIVE && snapshot.minute < 90 && (
                  <button className={styles.dangerButton} onClick={stopMatch}>
                    ■ Finish
                  </button>
                )}
                {status === MATCH_STATUS.FINISHED && (
                  <div className={styles.finishedMessage}>Full Time</div>
                )}
              </div>
            </section>

            {/* TACTICS */}
            <section className={styles.tacticsCard}>
              <h2>Tactics — {myClub?.name} ({userSide})</h2>
              <div className={styles.tacticsGrid}>
                {[
                  ["mentality", "Mentality"],
                  ["tempo", "Tempo"],
                  ["pressing", "Pressing"],
                  ["defensiveLine", "Defensive Line"],
                  ["width", "Width"],
                  ["passingStyle", "Passing Style"],
                ].map(([key, label]) => (
                  <div key={key} className={styles.tacticRow}>
                    <label>{label}</label>
                    <select
                      value={tactics?.[key] || ""}
                      onChange={e => updateTactic(key, e.target.value)}
                      disabled={status === MATCH_STATUS.FINISHED}
                    >
                      {TACTICAL_VALUES[key].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className={styles.hint}>
                🎯 Ibihinduka bijya kuri simulation — AI yo mu rundi
                ruhande na we ihindura tactics zayo.
              </p>
            </section>

            {/* BALL */}
            <section className={styles.infoCard}>
              <span>BALL</span>
              <strong>
                {ballOwner
                  ? `${ballOwner.name} #${ballOwner.number}`
                  : "Free Ball"}
              </strong>
            </section>

            {/* STATS */}
            <section className={styles.statsCard}>
              <h2>Match Statistics</h2>
              <StatRow label="Possession" home={snapshot.homeStats.possession} away={snapshot.awayStats.possession} suffix="%" />
              <StatRow label="Shots" home={snapshot.homeStats.shots} away={snapshot.awayStats.shots} />
              <StatRow label="On Target" home={snapshot.homeStats.shotsOnTarget} away={snapshot.awayStats.shotsOnTarget} />
              <StatRow label="Passes" home={snapshot.homeStats.passesCompleted} away={snapshot.awayStats.passesCompleted} />
              <StatRow label="Tackles" home={snapshot.homeStats.tackles} away={snapshot.awayStats.tackles} />
              <StatRow label="Corners" home={snapshot.homeStats.corners} away={snapshot.awayStats.corners} />
              <StatRow label="Fouls" home={snapshot.homeStats.fouls} away={snapshot.awayStats.fouls} />
              <StatRow label="Saves" home={snapshot.homeStats.saves} away={snapshot.awayStats.saves} />
              <StatRow label="Yellow" home={snapshot.homeStats.yellow} away={snapshot.awayStats.yellow} />
              <StatRow label="Red" home={snapshot.homeStats.red} away={snapshot.awayStats.red} />
            </section>

            {/* EVENTS */}
            <section className={styles.eventsCard}>
              <h2>Match Events</h2>
              {recentEvents.length === 0 ? (
                <p className={styles.empty}>No events yet.</p>
              ) : recentEvents.map(ev => (
                <div key={ev.id} className={styles.event}>
                  <span>{ev.minute}'</span>
                  <div>
                    <strong>{ev.type.replace(/_/g, " ")}</strong>
                    <p>{ev.detail}</p>
                  </div>
                </div>
              ))}
            </section>

            {/* LINEUPS */}
            <section className={styles.benchCard}>
              <h2>Lineups</h2>
              <div className={styles.lineupGrid}>
                <LineupCol
                  title={homeClub.name}
                  lineup={snapshot.homeLineup}
                  highlight={userSide === "home"}
                />
                <LineupCol
                  title={awayClub.name}
                  lineup={snapshot.awayLineup}
                  highlight={userSide === "away"}
                />
              </div>
            </section>

            {/* SUBS */}
            <section className={styles.benchCard}>
              <h2>Substitutions — {myClub?.name} ({mySubsUsed}/5)</h2>
              <div className={styles.subRow}>
                <select value={subOut} onChange={e => setSubOut(e.target.value)}>
                  <option value="">— Out —</option>
                  {myLineup.filter(p => !p.redCard).map(p => (
                    <option key={p.id} value={p.id}>
                      #{p.number} {p.name} ({p.position})
                      {p.injury ? " 🚑" : ""}
                      {p.stamina < 40 ? " 😓" : ""}
                    </option>
                  ))}
                </select>
                <select value={subIn} onChange={e => setSubIn(e.target.value)}>
                  <option value="">— In —</option>
                  {myBench.map(p => (
                    <option key={p.id} value={p.id}>
                      #{p.number} {p.name} ({p.position})
                    </option>
                  ))}
                </select>
                <button
                  className={styles.subButton}
                  onClick={doSub}
                  disabled={!subOut || !subIn || mySubsUsed >= 5}
                >
                  Sub
                </button>
              </div>
              {subMessage && <p className={styles.hint}>{subMessage}</p>}

              <div className={styles.benchColumns} style={{ marginTop: 10 }}>
                <div>
                  <h3>Bench (my team)</h3>
                  {myBench.length === 0 ? (
                    <p className={styles.empty}>No bench.</p>
                  ) : myBench.map(p => (
                    <div key={p.id} className={styles.benchPlayer}>
                      <span>{p.number || "-"}</span>
                      <label>{p.name}</label>
                    </div>
                  ))}
                </div>
                <div>
                  <h3>Bench (AI)</h3>
                  {oppBench.map(p => (
                    <div key={p.id} className={styles.benchPlayer}>
                      <span>{p.number || "-"}</span>
                      <label>{p.name}</label>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </aside>
        </section>
      </main>
    </>
  );
}

/* ====== HELPERS ====== */
function StatRow({ label, home, away, suffix = "" }) {
  return (
    <div className={styles.statRow}>
      <strong>{home}{suffix}</strong>
      <span>{label}</span>
      <strong>{away}{suffix}</strong>
    </div>
  );
}

function LineupCol({ title, lineup = [], highlight }) {
  return (
    <div className={styles.lineupCol}>
      <h3 style={highlight ? { color: "#fbbf24" } : {}}>
        {title} {highlight ? "⭐" : ""}
      </h3>
      {lineup.map(p => (
        <div key={p.id} className={styles.lineupPlayer}>
          <span className="num">{p.number}</span>
          <label>{p.name}</label>
          {p.injury && <span className={styles.injuredBadge}>+</span>}
          {p.redCard && <span className={styles.redBadge}>RC</span>}
          {p.yellowCards > 0 && !p.redCard && (
            <span className={styles.yellowBadge}>Y{p.yellowCards}</span>
          )}
          {p.goals > 0 && (
            <span className={styles.goalBadge}>⚽{p.goals}</span>
          )}
        </div>
      ))}
    </div>
  );
}
