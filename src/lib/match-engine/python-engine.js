const PYTHON_ENGINE_URL =
  "https://python-engine-1.onrender.com";


async function pythonRequest(
  path,
  options = {}
) {
  const response = await fetch(
    `${PYTHON_ENGINE_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text
      ? JSON.parse(text)
      : null;
  } catch {
    throw new Error(
      `Python engine returned invalid JSON (${response.status}). ` +
      `Response: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.detail ||
      `Python engine HTTP ${response.status}`
    );
  }

  return data;
}


function cleanPlayer(
  player,
  index = 0
) {
  return {
    id: String(
      player?.id ??
      player?.playerId ??
      `player-${index}`
    ),

    name:
      player?.name ||
      player?.displayName ||
      `Player ${index + 1}`,

    number: Number(
      player?.number ??
      player?.shirtNumber ??
      index + 1
    ),

    position:
      player?.position ||
      player?.pos ||
      "MID",

    overall: Number(
      player?.overall ?? 60
    ),

    pace: Number(
      player?.pace ??
      player?.speed ??
      60
    ),

    passing: Number(
      player?.passing ?? 60
    ),

    dribbling: Number(
      player?.dribbling ?? 60
    ),

    shooting: Number(
      player?.shooting ?? 60
    ),

    defending: Number(
      player?.defending ?? 60
    ),

    stamina: Number(
      player?.stamina ?? 80
    ),
  };
}


function cleanPlayers(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players.map(
    cleanPlayer
  );
}


export default class MatchEngine {
  constructor(config) {
    this.config = {
      ...config,

      homePlayers:
        cleanPlayers(
          config.homePlayers
        ),

      awayPlayers:
        cleanPlayers(
          config.awayPlayers
        ),
    };

    this.snapshot = null;

    this.running = false;

    this.requestInFlight = false;

    this.lastPoll = 0;

    this.ready = this.create();
  }


  async create() {
    const result =
      await pythonRequest(
        "/match/create",
        {
          method: "POST",

          body: JSON.stringify(
            this.config
          ),
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  applySnapshot(
    snapshot
  ) {
    if (!snapshot) {
      return;
    }

    this.snapshot =
      snapshot;

    this.running =
      snapshot.status === "live";

    this.home =
      snapshot.home || {};

    this.away =
      snapshot.away || {};

    this.ball =
      snapshot.ball || {};

    this.events =
      snapshot.events || [];

    this.score =
      snapshot.score || {
        home: 0,
        away: 0,
      };

    this.minute =
      Number(
        snapshot.minute || 0
      );

    this.second =
      Number(
        snapshot.second || 0
      );

    this.status =
      snapshot.status ||
      "ready";
  }


  async start() {
    await this.ready;

    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/start`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  async pause() {
    this.running = false;

    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/pause`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  async update() {
    if (!this.snapshot) {
      return null;
    }

    if (
      this.requestInFlight
    ) {
      return this.snapshot;
    }

    if (
      !this.running
    ) {
      return this.snapshot;
    }

    const now =
      Date.now();

    if (
      now - this.lastPoll < 100
    ) {
      return this.snapshot;
    }

    this.lastPoll = now;

    this.requestInFlight = true;

    try {
      const result =
        await pythonRequest(
          `/match/${this.config.matchId}/state`
        );

      this.applySnapshot(
        result
      );

      return result;

    } catch (error) {
      console.error(
        "Python engine state error:",
        error
      );

      return this.snapshot;

    } finally {
      this.requestInFlight =
        false;
    }
  }


  async setUserTactics(
    tactics
  ) {
    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/tactics`,
        {
          method: "POST",

          body: JSON.stringify({
            side: "home",
            tactics,
          }),
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  async setFormation(
    side,
    formation
  ) {
    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/formation`,
        {
          method: "POST",

          body: JSON.stringify({
            side,
            formation,
          }),
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  async substituteUser(
    outgoingId,
    incomingId
  ) {
    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/substitute`,
        {
          method: "POST",

          body: JSON.stringify({
            side: "home",
            outgoingId,
            incomingId,
          }),
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  async finish() {
    const result =
      await pythonRequest(
        `/match/${this.config.matchId}/finish`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      result
    );

    return result;
  }


  getSnapshot() {
    return this.snapshot;
  }


  getState() {
    return this.snapshot;
  }


  serializeResult() {
    return this.snapshot;
  }


  isFinished() {
    return (
      this.snapshot?.status ===
        "finished" ||
      Number(
        this.snapshot?.minute || 0
      ) >= 90
    );
  }


  stop() {
    this.running = false;
  }
}
