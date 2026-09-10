import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import MatchEngine from "../../lib/match-engine/MatchEngine";
import MatchCanvas from "../../components/match/MatchCanvas";
import { MATCH_STATUS, TACTICAL_VALUES } from "../../lib/match-engine/constants";
import styles from "./Mach.module.css";

const USER_TEAM = "home";

export default function MatchPage() {
  const router = useRouter();
  const { id } = router.query;

  const engineRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimeRef = useRef(0);
  const lastSyncRef = useRef(0);

  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tactics, setTactics] = useState(null);
  const [subOut, setSubOut] = useState("");
  const [subIn, setSubIn] = useState("");

  // load / build engine
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        let data = null;
        try {
          const res = await fetch(`/api/matches/${id}`);
          if (res.ok) data = await res.json();
        } catch (_) { /* ignore */ }

        if (!data) data = createMockMatch();

        const engine = new MatchEngine(data);
        engine.setUserControlled(USER_TEAM);
        engineRef.current = engine;
        setTactics({ ...engine.homeTactics });
        setSnapshot(engine.getSnapshot());
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Ntibyashobotse gutangiza umukino.");
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id]);

  // main RAF loop
  useEffect(() => {
    lastTimeRef.current = performance.now();
    lastSyncRef.current = 0;

    const tick = () => {
      const engine = engineRef.current;
      const now = performance.now();
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      if (engine) {
        engine.update(dt);
        if (now - lastSyncRef.current > 150) {
          lastSyncRef.current = now;
          setSnapshot(engine.getSnapshot());
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const start = useCallback(() => { engineRef.current?.start(); }, []);
  const pause = useCallback(() => { engineRef.current?.pause(); }, []);
  const resume = useCallback(() => { engineRef.current?.resume(); }, []);
  const stop = useCallback(() => { engineRef.current?.stop(); }, []);

  const updateTactic = useCallback((key, value) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.homeTactics[key] = value;
    setTactics({ ...engine.homeTactics });
  }, []);

  const doSub = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !subOut || !subIn) return;
    const ok = engine.performSubstitution(USER_TEAM, subOut, subIn);
    if (ok) {
      setSubOut("");
      setSubIn("");
      setSnapshot(engine.getSnapshot());
    }
  }, [subOut, subIn]);

  if (loading) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.spinner} />
        <h2>Gutegura umukino...</h2>
        <p>Abakinnyi barimo kwitegura.</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className={styles.errorPage}>
        <div className={styles.errorIcon}>⚠️</div>
        <h1>Habaye ikibazo</h1>
        <p>{error}</p>
        <button className={styles.primaryButton} onClick={() => router.back()}>← Subira inyuma</button>
      </div>
    );
  }

  const statusLabel = {
    [MATCH_STATUS.READY]: "READY",
    [MATCH_STATUS.LIVE]: "LIVE",
    [MATCH_STATUS.HALF_TIME]: "HALF TIME",
    [MATCH_STATUS.FINISHED]: "FULL TIME",
  }[snapshot.status] || snapshot.status;

  const engine = engineRef.current;
  const homeName = engine?.homeClub?.name || "Home";
  const awayName = engine?.awayClub?.name || "Away";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={() => router.back()}>← Subira</button>
        <div className={styles.headerTitle}>
          <span>Umukino Live</span>
          <h1>{homeName} vs {awayName}</h1>
        </div>
        <div className={styles.statusBadge}>{statusLabel}</div>
      </header>

      <div className={styles.scoreboard}>
        <TeamBadge club={engine?.homeClub} score={snapshot.homeScore} />
        <div className={styles.scoreCenter}>
          <small>{snapshot.minute}'</small>
          <strong>{snapshot.homeScore} - {snapshot.awayScore}</strong>
          <span>{statusLabel}</span>
        </div>
        <TeamBadge club={engine?.awayClub} score={snapshot.awayScore} flip />
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.pitchCard}>
          <div className={styles.canvasContainer}>
            <MatchCanvas engineRef={engineRef} />
          </div>
        </div>

        <aside className={styles.sidebar}>
          {/* Control */}
          <div className={styles.controlCard}>
            <h2>Igenzura</h2>
            {snapshot.status === MATCH_STATUS.FINISHED ? (
              <div className={styles.finishedMessage}>Umukino warangiye</div>
            ) : (
              <div className={styles.buttonGrid}>
                {!engine?.running && !engine?.paused && (
                  <button className={styles.primaryButton} onClick={start}>▶ Tangira</button>
                )}
                {engine?.running && !engine?.paused && (
                  <button className={styles.secondaryButton} onClick={pause}>⏸ Hagarika</button>
                )}
                {engine?.paused && (
                  <button className={styles.primaryButton} onClick={resume}>▶ Komeza</button>
                )}
                <button className={styles.dangerButton} onClick={stop}>■ Rangiza</button>
              </div>
            )}
          </div>

          {/* Tactics (user home) */}
          <div className={styles.tacticsCard}>
            <h2>Tactics zawe (Home)</h2>
            {tactics && (
              <div className={styles.tacticsGrid}>
                {[
                  ["mentality", "Mentality"],
                  ["tempo", "Tempo"],
                  ["pressing", "Pressing"],
                  ["defensiveLine", "Line Defense"],
                  ["width", "Ubugari"],
                  ["passingStyle", "Passing"],
                ].map(([k, label]) => (
                  <div key={k} className={styles.tacticRow}>
                    <label>{label}</label>
                    <select value={tactics[k]} onChange={(e) => updateTactic(k, e.target.value)}>
                      {TACTICAL_VALUES[k].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className={styles.infoCard}>
            <span>FORMATION (HOME)</span>
            <strong>{snapshot.homeFormation} · {snapshot.homeTactics?.mentality}</strong>
            <span style={{ marginTop: 8 }}>FORMATION (AWAY · AI)</span>
            <strong>{snapshot.awayFormation} · {snapshot.awayTactics?.mentality}</strong>
          </div>

          {/* Stats */}
          <div className={styles.statsCard}>
            <h2>Imibare</h2>
            <StatRow home={snapshot.homeStats.possession} away={snapshot.awayStats.possession} label="Possession %" />
            <StatRow home={snapshot.homeStats.shots} away={snapshot.awayStats.shots} label="Shots" />
            <StatRow home={snapshot.homeStats.shotsOnTarget} away={snapshot.awayStats.shotsOnTarget} label="On Target" />
            <StatRow home={snapshot.homeStats.passesCompleted} away={snapshot.awayStats.passesCompleted} label="Passes" />
            <StatRow home={snapshot.homeStats.tackles} away={snapshot.awayStats.tackles} label="Tackles" />
            <StatRow home={snapshot.homeStats.corners} away={snapshot.awayStats.corners} label="Corners" />
            <StatRow home={snapshot.homeStats.fouls} away={snapshot.awayStats.fouls} label="Fouls" />
            <StatRow home={snapshot.homeStats.yellow} away={snapshot.awayStats.yellow} label="Yellow" />
            <StatRow home={snapshot.homeStats.red} away={snapshot.awayStats.red} label="Red" />
          </div>

          {/* Events */}
          <div className={styles.eventsCard}>
            <h2>Ibibera</h2>
            {snapshot.events.length === 0 ? (
              <p className={styles.empty}>Nta kintu kirabaho.</p>
            ) : (
              snapshot.events.slice(0, 12).map(ev => (
                <div key={ev.id} className={styles.event}>
                  <span>{ev.minute}'</span>
                  <div>
                    <strong>{ev.type.replace(/_/g, " ")}</strong>
                    <p>{ev.detail}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Bench & subs */}
          <div className={styles.benchCard}>
            <h2>Substitutions & Bench</h2>
            <div className={styles.lineupGrid}>
              <LineupCol title="Home (we)" lineup={snapshot.homeLineup} />
              <LineupCol title="Away (AI)" lineup={snapshot.awayLineup} />
            </div>
            <div className={styles.subRow}>
              <select value={subOut} onChange={(e) => setSubOut(e.target.value)}>
                <option value="">— Out —</option>
                {snapshot.homeLineup
                  .filter(p => !p.redCard)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      #{p.number} {p.name} ({p.position})
                    </option>
                  ))}
              </select>
              <select value={subIn} onChange={(e) => setSubIn(e.target.value)}>
                <option value="">— In —</option>
                {snapshot.homeBench.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.position})
                  </option>
                ))}
              </select>
              <button
                className={styles.subButton}
                onClick={doSub}
                disabled={!subOut || !subIn || snapshot.substitutions.home >= 5}
              >
                Sub
              </button>
            </div>
            <p className={styles.empty} style={{ marginTop: 6 }}>
              Subs: {snapshot.substitutions.home}/5 · Injured: {snapshot.injuries.home}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TeamBadge({ club, score, flip }) {
  return (
    <div className={styles.teamScore} style={flip ? { flexDirection: "row-reverse" } : {}}>
      <div className={styles.logo}>
        {club?.logo ? <img src={club.logo} alt="" /> : <span>{club?.short || "?"}</span>}
      </div>
      <div style={{ textAlign: flip ? "right" : "left" }}>
        <strong>{club?.name || "—"}</strong>
        <br />
        <span>{score} GOALS</span>
      </div>
    </div>
  );
}

function StatRow({ home, away, label }) {
  return (
    <div className={styles.statRow}>
      <strong>{home}</strong>
      <span>{label}</span>
      <strong>{away}</strong>
    </div>
  );
}

function LineupCol({ title, lineup }) {
  return (
    <div className={styles.lineupCol}>
      <h3>{title}</h3>
      {lineup.map(p => (
        <div key={p.id} className={styles.lineupPlayer}>
          <span className="num">{p.number}</span>
          <label>{p.name}</label>
          {p.injury && <span className={styles.injuredBadge}>+</span>}
          {p.redCard && <span className={styles.injuredBadge}>RC</span>}
        </div>
      ))}
    </div>
  );
}

/* Mock data: kubyo nta API */
function createMockMatch() {
  const clubs = [
    { id: "c1", name: "Kigali FC", short: "KGL", logo: "" },
    { id: "c2", name: "Rayon Sports", short: "RAY", logo: "" },
  ];
  const names = [
    "Mugisha", "Habimana", "Niyonzima", "Uwimana", "Kagabo", "Rwema",
    "Bizimana", "Ndayisaba", "Iradukunda", "Nsengiyumva", "Hakizimana",
    "Mukamana", "Kayitesi", "Uwase", "Ingabire", "Gasana", "Twagirayezu",
  ];
  const mk = (side, count) =>
    Array.from({ length: count }).map((_, i) => ({
      id: `${side}-${i}`,
      name: names[(i + (side === "away" ? 5 : 0)) % names.length] + ` ${i + 1}`,
      shirtNumber: i + 1,
      position: ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"][i % 11],
      overall: 60 + Math.floor(Math.random() * 25),
      speed: 60 + Math.floor(Math.random() * 30),
      passing: 60 + Math.floor(Math.random() * 30),
      shooting: 55 + Math.floor(Math.random() * 35),
      dribbling: 60 + Math.floor(Math.random() * 30),
      tackling: 55 + Math.floor(Math.random() * 35),
    }));

  return {
    match: {
      id: "m1", minute: 0, homeScore: 0, awayScore: 0, status: "ready",
      homeFormation: "4-3-3", awayFormation: "4-4-2",
      homeTactics: { mentality: "balanced", tempo: "normal", pressing: "medium", defensiveLine: "normal", width: "normal", passingStyle: "mixed" },
      awayTactics: { mentality: "balanced", tempo: "normal", pressing: "medium", defensiveLine: "normal", width: "normal", passingStyle: "mixed" },
    },
    homeClub: clubs[0],
    awayClub: clubs[1],
    homePlayers: mk("home", 18),
    awayPlayers: mk("away", 18),
  };
}
