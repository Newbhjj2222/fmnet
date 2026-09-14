const PYTHON_ENGINE_URL =
  "https://fmnet-seven.vercel.app";

async function request(
  path,
  options = {}
) {
  const response =
    await fetch(
      `${PYTHON_ENGINE_URL}${path}`,
      {
        method:
          options.method || "GET",

        headers: {
          "Content-Type":
            "application/json",

          ...(options.headers || {}),
        },

        body:
          options.body
            ? JSON.stringify(
                options.body
              )
            : undefined,
      }
    );

  let json;

  try {
    json =
      await response.json();
  } catch {
    throw new Error(
      `Python engine returned invalid JSON (${response.status})`
    );
  }

  if (
    !response.ok ||
    json?.success === false
  ) {
    throw new Error(
      json?.error ||
      `Python engine error ${response.status}`
    );
  }

  return (
    json?.data ??
    json
  );
}


export default class PythonMatchEngine {
  constructor(config) {
    this.config = config;

    this.snapshotData = null;

    this.running = false;

    this.started = false;

    this.paused = true;

    this.minute = 0;

    this.second = 0;

    this.events = [];

    this.home = {
      players: [],
      bench: [],
      stats: {},
    };

    this.away = {
      players: [],
      bench: [],
      stats: {},
    };
  }


  async create() {
    const snapshot =
      await request(
        "/match/create",
        {
          method: "POST",
          body: this.config,
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async start() {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/start`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.running = true;
    this.started = true;
    this.paused = false;

    return snapshot;
  }


  async pause() {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/pause`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.running = false;
    this.paused = true;

    return snapshot;
  }


  async startSecondHalf() {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/second-half`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.running = true;
    this.started = true;
    this.paused = false;

    return snapshot;
  }


  async update() {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/update`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async setUserTactics(
    tactics
  ) {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/tactics`,
        {
          method: "POST",

          body: {
            side: "home",
            tactics,
          },
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async setFormation(
    side,
    formation
  ) {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/formation`,
        {
          method: "POST",

          body: {
            side,
            formation,
          },
        }
      );

    this.applySnapshot(
      snapshot
    );

    return snapshot;
  }


  async substituteUser(
    outgoingId,
    incomingId
  ) {
    const result =
      await request(
        `/match/${this.config.matchId}/substitute`,
        {
          method: "POST",

          body: {
            side: "home",

            outgoingId,

            incomingId,
          },
        }
      );

    if (
      result?.snapshot
    ) {
      this.applySnapshot(
        result.snapshot
      );
    }

    return (
      result?.success !==
      false
    );
  }


  async finish() {
    const snapshot =
      await request(
        `/match/${this.config.matchId}/finish`,
        {
          method: "POST",
        }
      );

    this.applySnapshot(
      snapshot
    );

    this.running = false;
    this.paused = true;

    return snapshot;
  }


  isFinished() {
    return (
      this.snapshotData
        ?.finished === true ||
      Number(
        this.snapshotData
          ?.minute || 0
      ) >= 90
    );
  }


  getSnapshot() {
    return this.snapshotData;
  }


  serializeResult() {
    return this.snapshotData;
  }


  getState() {
    return this.snapshotData;
  }


  applySnapshot(
    snapshot
  ) {
    if (!snapshot) {
      return;
    }

    this.snapshotData =
      snapshot;

    this.minute =
      Number(
        snapshot.minute || 0
      );

    this.second =
      Number(
        snapshot.second || 0
      );

    this.events =
      Array.isArray(
        snapshot.events
      )
        ? snapshot.events
        : [];

    this.home =
      snapshot.home || {
        players: [],
        bench: [],
        stats: {},
      };

    this.away =
      snapshot.away || {
        players: [],
        bench: [],
        stats: {},
      };

    this.running =
      snapshot.running === true;

    this.started =
      this.running ||
      this.minute > 0;

    this.paused =
      !this.running;
  }
}
