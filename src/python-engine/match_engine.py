import math
import random
import time
from copy import deepcopy


FIELD_WIDTH = 100.0
FIELD_HEIGHT = 64.0

REAL_MATCH_SECONDS = 8 * 60
FOOTBALL_MINUTES = 90

MAX_SPEED = 7.5

FORMATION_POSITIONS = {
    "4-4-2": [
        (8, 32),
        (20, 13),
        (20, 26),
        (20, 38),
        (20, 51),
        (39, 13),
        (39, 27),
        (39, 40),
        (39, 52),
        (60, 25),
        (60, 43),
    ],

    "4-3-3": [
        (8, 32),
        (20, 13),
        (20, 26),
        (20, 38),
        (20, 51),
        (39, 20),
        (39, 32),
        (39, 45),
        (58, 14),
        (62, 32),
        (58, 50),
    ],

    "3-5-2": [
        (8, 32),
        (20, 19),
        (20, 32),
        (20, 45),
        (38, 12),
        (39, 24),
        (40, 32),
        (39, 40),
        (38, 52),
        (61, 25),
        (61, 42),
    ],

    "5-3-2": [
        (8, 32),
        (18, 10),
        (19, 22),
        (19, 32),
        (19, 42),
        (18, 54),
        (39, 21),
        (40, 32),
        (39, 43),
        (61, 25),
        (61, 43),
    ],

    "4-2-3-1": [
        (8, 32),
        (20, 13),
        (20, 26),
        (20, 38),
        (20, 51),
        (35, 24),
        (35, 40),
        (52, 14),
        (54, 32),
        (52, 50),
        (64, 32),
    ],
}


def clamp(value, low, high):
    return max(low, min(high, value))


def distance(ax, ay, bx, by):
    return math.sqrt(
        ((bx - ax) ** 2) +
        ((by - ay) ** 2)
    )


def normalize_vector(dx, dy):
    length = math.sqrt(dx * dx + dy * dy)

    if length <= 0.0001:
        return 0.0, 0.0

    return dx / length, dy / length


def lerp(a, b, amount):
    return a + ((b - a) * amount)


class Player:

    def __init__(
        self,
        data,
        index,
        side
    ):
        self.id = str(
            data.get("id")
            or data.get("playerId")
            or f"{side}-{index}"
        )

        self.name = (
            data.get("name")
            or data.get("displayName")
            or f"Player {index + 1}"
        )

        self.number = (
            data.get("shirtNumber")
            or data.get("jerseyNumber")
            or data.get("number")
            or index + 1
        )

        self.position_name = (
            data.get("position")
            or data.get("pos")
            or "CM"
        )

        self.overall = float(
            data.get("overall")
            or data.get("rating")
            or data.get("ovr")
            or 60
        )

        self.pace = float(
            data.get("pace")
            or data.get("speed")
            or 60
        )

        self.passing = float(
            data.get("passing")
            or data.get("pass")
            or 60
        )

        self.shooting = float(
            data.get("shooting")
            or data.get("shot")
            or 60
        )

        self.dribbling = float(
            data.get("dribbling")
            or data.get("dribble")
            or 60
        )

        self.defending = float(
            data.get("defending")
            or data.get("defence")
            or 60
        )

        self.stamina = float(
            data.get("stamina")
            or 75
        )

        self.side = side

        self.x = 0.0
        self.y = 32.0

        self.home_x = 0.0
        self.home_y = 32.0

        self.target_x = 0.0
        self.target_y = 32.0

        self.vx = 0.0
        self.vy = 0.0

        self.action = "positioning"
        self.action_timer = random.uniform(0.2, 1.2)

        self.has_ball = False
        self.on_pitch = True
        self.substituted = False

        self.energy = 100.0

        self.last_action = None

    def set_position(self, x, y):
        self.x = x
        self.y = y

        self.home_x = x
        self.home_y = y

        self.target_x = x
        self.target_y = y

    def speed_value(self):
        pace_factor = clamp(
            self.pace / 100.0,
            0.35,
            1.0
        )

        energy_factor = clamp(
            self.energy / 100.0,
            0.45,
            1.0
        )

        return (
            MAX_SPEED *
            pace_factor *
            energy_factor
        )

    def move_towards(self, x, y, dt):
        if not self.on_pitch:
            return

        dx = x - self.x
        dy = y - self.y

        nx, ny = normalize_vector(
            dx,
            dy
        )

        speed = self.speed_value()

        desired_vx = nx * speed
        desired_vy = ny * speed

        acceleration = clamp(
            7.0 * dt,
            0.0,
            1.0
        )

        self.vx = lerp(
            self.vx,
            desired_vx,
            acceleration
        )

        self.vy = lerp(
            self.vy,
            desired_vy,
            acceleration
        )

        self.x += self.vx * dt
        self.y += self.vy * dt

        self.x = clamp(
            self.x,
            2,
            98
        )

        self.y = clamp(
            self.y,
            2,
            62
        )

        movement = math.sqrt(
            self.vx * self.vx +
            self.vy * self.vy
        )

        if movement > 0.5:
            self.energy -= (
                movement *
                0.015 *
                dt
            )

        self.energy = clamp(
            self.energy,
            35,
            100
        )

    def rest(self, dt):
        self.energy = clamp(
            self.energy +
            (0.7 * dt),
            35,
            100
        )

    def serialize(self):
        return {
            "id": self.id,
            "playerId": self.id,
            "name": self.name,
            "number": self.number,
            "shirtNumber": self.number,
            "position": self.position_name,
            "overall": round(self.overall, 1),

            "x": round(self.x, 2),
            "y": round(self.y, 2),

            "vx": round(self.vx, 2),
            "vy": round(self.vy, 2),

            "position2D": {
                "x": round(self.x, 2),
                "y": round(self.y, 2)
            },

            "energy": round(
                self.energy,
                1
            ),

            "stamina": round(
                self.energy,
                1
            ),

            "action": self.action,
            "lastAction": self.last_action,

            "hasBall": self.has_ball,

            "onPitch": self.on_pitch,
            "substituted": self.substituted,
        }


class Ball:

    def __init__(self):
        self.x = 50.0
        self.y = 32.0

        self.vx = 0.0
        self.vy = 0.0

        self.owner_id = None
        self.last_touch_side = None

        self.state = "free"

        self.target_x = 50.0
        self.target_y = 32.0

    def move(self, dt):
        self.x += self.vx * dt
        self.y += self.vy * dt

        self.vx *= max(
            0.0,
            1.0 - (1.8 * dt)
        )

        self.vy *= max(
            0.0,
            1.0 - (1.8 * dt)
        )

    def stop(self):
        self.vx = 0
        self.vy = 0

    def serialize(self):
        return {
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "vx": round(self.vx, 2),
            "vy": round(self.vy, 2),
            "owner": self.owner_id,
            "ownerId": self.owner_id,
            "state": self.state
        }


class Team:

    def __init__(
        self,
        side,
        team_data,
        players,
        formation,
        tactics
    ):
        self.side = side

        self.id = (
            team_data.get("id")
            or team_data.get("clubId")
            or side
        )

        self.name = (
            team_data.get("name")
            or team_data.get("clubName")
            or (
                "Home"
                if side == "home"
                else "Away"
            )
        )

        self.logo = (
            team_data.get("logo")
            or team_data.get("image")
            or ""
        )

        self.formation = formation
        self.tactics = tactics or {}

        self.players = [
            Player(
                player,
                index,
                side
            )
            for index, player
            in enumerate(players[:18])
        ]

        while len(self.players) < 11:
            index = len(self.players)

            self.players.append(
                Player(
                    {
                        "id":
                            f"{side}-fallback-{index}",
                        "name":
                            f"{self.name} Player {index + 1}",
                        "overall": 55,
                        "pace": 55,
                        "passing": 55,
                        "shooting": 55,
                        "dribbling": 55,
                        "defending": 55,
                        "stamina": 70
                    },
                    index,
                    side
                )
            )

        self.bench = self.players[11:]

        self.active = self.players[:11]

        self.substitutions_used = 0

        self.stats = {
            "shots": 0,
            "shotsOnTarget": 0,
            "passes": 0,
            "passesCompleted": 0,
            "dribbles": 0,
            "successfulDribbles": 0,
            "tackles": 0,
            "tacklesWon": 0,
            "interceptions": 0,
            "possessionSeconds": 0,
            "corners": 0,
            "offsides": 0,
            "fouls": 0,
            "yellowCards": 0,
            "redCards": 0,
        }

        self.reset_positions()

    def get_mentality(self):
        return (
            self.tactics.get(
                "mentality",
                "balanced"
            )
            or "balanced"
        ).lower()

    def get_pressing(self):
        return (
            self.tactics.get(
                "pressing",
                "medium"
            )
            or "medium"
        ).lower()

    def get_tempo(self):
        return (
            self.tactics.get(
                "tempo",
                "normal"
            )
            or "normal"
        ).lower()

    def get_defensive_line(self):
        return (
            self.tactics.get(
                "defensiveLine",
                "normal"
            )
            or "normal"
        ).lower()

    def get_width(self):
        return (
            self.tactics.get(
                "width",
                "normal"
            )
            or "normal"
        ).lower()

    def reset_positions(self):
        positions = FORMATION_POSITIONS.get(
            self.formation,
            FORMATION_POSITIONS["4-4-2"]
        )

        direction = (
            1
            if self.side == "home"
            else -1
        )

        for index, player in enumerate(
            self.active
        ):
            bx, by = positions[
                index
            ]

            if self.side == "away":
                bx = FIELD_WIDTH - bx

            player.set_position(
                bx,
                by
            )

            player.has_ball = False

        for player in self.bench:
            player.on_pitch = False

    def set_formation(self, formation):
        if formation not in FORMATION_POSITIONS:
            formation = "4-4-2"

        self.formation = formation

        self.reset_positions()

    def set_tactics(self, tactics):
        self.tactics = {
            **self.tactics,
            **(tactics or {})
        }

    def player_by_id(self, player_id):
        for player in self.players:
            if player.id == str(player_id):
                return player

        return None

    def goalkeeper(self):
        if not self.active:
            return None

        return self.active[0]

    def serialize(self):
        return {
            "id": self.id,
            "name": self.name,
            "logo": self.logo,

            "formation": self.formation,

            "tactics": deepcopy(
                self.tactics
            ),

            "players": [
                player.serialize()
                for player in self.players
            ],

            "bench": [
                player.serialize()
                for player in self.bench
            ],

            "substitutionsUsed":
                self.substitutions_used,

            "stats":
                deepcopy(self.stats)
        }


class MatchEngine:

    def __init__(self, config):
        self.match_id = str(
            config.get("matchId")
        )

        self.real_start_time = None

        self.elapsed_real_seconds = 0.0

        self.minute = int(
            config.get("initialMinute")
            or 0
        )

        self.second = 0

        self.score = {
            "home": int(
                config.get(
                    "initialScore",
                    {}
                ).get("home", 0)
                or 0
            ),

            "away": int(
                config.get(
                    "initialScore",
                    {}
                ).get("away", 0)
                or 0
            )
        }

        self.status = "ready"

        self.phase = (
            "first_half"
            if self.minute < 45
            else (
                "half_time"
                if self.minute < 90
                else "finished"
            )
        )

        self.ball = Ball()

        self.events = []

        self.max_events = 300

        self.last_update = time.monotonic()

        self.next_action = random.uniform(
            0.4,
            1.2
        )

        self.possession_side = (
            "home"
        )

        self.last_event_time = 0

        home_players = (
            config.get("homePlayers")
            or []
        )

        away_players = (
            config.get("awayPlayers")
            or []
        )

        self.home = Team(
            "home",
            config.get("homeTeam") or {},
            home_players,
            config.get(
                "formationHome",
                "4-4-2"
            ),
            config.get(
                "tacticsHome",
                {}
            )
        )

        self.away = Team(
            "away",
            config.get("awayTeam") or {},
            away_players,
            config.get(
                "formationAway",
                "4-4-2"
            ),
            config.get(
                "tacticsAway",
                {}
            )
        )

        self.home.stats = {
            **self.home.stats
        }

        self.away.stats = {
            **self.away.stats
        }

        self.restore_lineups(
            config
        )

        self.restore_events(
            config
        )

        self.reset_ball()

    # -----------------------------------------------------
    # RESTORE
    # -----------------------------------------------------

    def restore_lineups(self, config):
        home_ids = (
            config.get("homeLineupIds")
            or []
        )

        away_ids = (
            config.get("awayLineupIds")
            or []
        )

        if home_ids:
            self.apply_lineup(
                self.home,
                home_ids
            )

        if away_ids:
            self.apply_lineup(
                self.away,
                away_ids
            )

    def apply_lineup(
        self,
        team,
        ids
    ):
        wanted = {
            str(x)
            for x in ids
        }

        selected = [
            p
            for p in team.players
            if p.id in wanted
        ]

        remaining = [
            p
            for p in team.players
            if p.id not in wanted
        ]

        selected = (
            selected +
            remaining
        )[:11]

        team.active = selected
        team.bench = [
            p
            for p in team.players
            if p not in selected
        ]

        team.reset_positions()

    def restore_events(self, config):
        events = config.get(
            "initialEvents"
        )

        if isinstance(events, list):
            self.events = deepcopy(
                events[-self.max_events:]
            )

    # -----------------------------------------------------
    # CLOCK
    # -----------------------------------------------------

    def start(self):
        if self.status == "finished":
            return self.snapshot()

        if self.phase == "half_time":
            return self.start_second_half()

        self.status = "live"

        self.phase = "first_half"

        self.real_start_time = (
            time.monotonic()
            -
            (
                self.minute /
                90.0
            ) *
            REAL_MATCH_SECONDS
        )

        self.last_update = time.monotonic()

        self.add_event(
            "kickoff",
            self.possession_side,
            "Kick off"
        )

        return self.snapshot()

    def pause(self):
        if self.status == "live":
            self.advance()

        self.status = "paused"

        return self.snapshot()

    def start_second_half(self):
        if self.minute >= 90:
            return self.snapshot()

        self.phase = "second_half"

        self.status = "live"

        if self.real_start_time is None:
            self.real_start_time = (
                time.monotonic()
                -
                (
                    self.minute /
                    90.0
                ) *
                REAL_MATCH_SECONDS
            )

        self.last_update = time.monotonic()

        self.halftime_reset()

        self.add_event(
            "second_half",
            None,
            "Second half started"
        )

        return self.snapshot()

    def halftime_reset(self):
        self.ball.stop()

        self.ball.owner_id = None

        self.ball.state = "free"

        self.possession_side = (
            "away"
            if self.possession_side == "home"
            else "home"
        )

        self.home.reset_positions()
        self.away.reset_positions()

        self.reset_ball()

    def finish(self):
        self.minute = 90
        self.second = 0

        self.status = "finished"

        self.phase = "finished"

        self.ball.stop()

        self.add_event(
            "full_time",
            None,
            "Full time"
        )

        return self.snapshot()

    def advance(self):
        if self.status != "live":
            return self.snapshot()

        now = time.monotonic()

        if self.last_update is None:
            self.last_update = now

        real_dt = now - self.last_update

        self.last_update = now

        real_dt = clamp(
            real_dt,
            0.0,
            0.30
        )

        self.elapsed_real_seconds += real_dt

        football_seconds = (
            real_dt *
            (
                90.0 /
                REAL_MATCH_SECONDS
            )
        )

        if self.minute >= 90:
            self.finish()
            return self.snapshot()

        self.update_clock(
            football_seconds
        )

        self.simulate(
            football_seconds
        )

        if self.minute >= 45 and self.phase == "first_half":
            self.minute = 45
            self.second = 0

            self.status = "paused"

            self.phase = "half_time"

            self.add_event(
                "half_time",
                None,
                "Half time"
            )

        if self.minute >= 90:
            self.finish()

        return self.snapshot()

    def update_clock(self, football_seconds):
        total = (
            self.minute * 60
            +
            self.second
            +
            football_seconds
        )

        if self.phase == "first_half":
            total = min(
                total,
                45 * 60
            )

        else:
            total = min(
                total,
                90 * 60
            )

        self.minute = int(
            total // 60
        )

        self.second = int(
            total % 60
        )

    # -----------------------------------------------------
    # SIMULATION
    # -----------------------------------------------------

    def simulate(self, dt):
        self.next_action -= dt

        self.update_player_positions(
            self.home,
            self.away,
            dt
        )

        self.update_player_positions(
            self.away,
            self.home,
            dt
        )

        self.ball.move(dt)

        self.handle_ball_boundaries()

        if self.ball.owner_id:
            self.follow_ball_owner()

        if self.next_action <= 0:
            self.next_action = random.uniform(
                0.45,
                1.25
            )

            self.make_decision()

        self.update_possession_stats(
            dt
        )

    # -----------------------------------------------------
    # POSITIONS
    # -----------------------------------------------------

    def update_player_positions(
        self,
        team,
        opponent,
        dt
    ):
        mentality = team.get_mentality()

        pressing = team.get_pressing()

        width = team.get_width()

        for player in team.active:
            if not player.on_pitch:
                continue

            player.rest(dt)

            distance_ball = distance(
                player.x,
                player.y,
                self.ball.x,
                self.ball.y
            )

            opponent_has_ball = (
                self.ball.owner_id
                and self.player_by_id(
                    self.ball.owner_id
                ) in opponent.active
            )

            own_has_ball = (
                self.ball.owner_id
                and self.player_by_id(
                    self.ball.owner_id
                ) in team.active
            )

            # -------------------------------------------------
            # PRESSING
            # -------------------------------------------------

            if opponent_has_ball:
                pressing_distance = {
                    "low": 20,
                    "medium": 28,
                    "high": 36,
                    "very_high": 42
                }.get(
                    pressing,
                    28
                )

                if distance_ball < pressing_distance:
                    player.action = "pressing"

                    player.move_towards(
                        self.ball.x,
                        self.ball.y,
                        dt
                    )

                    continue

            # -------------------------------------------------
            # BALL PLAYER
            # -------------------------------------------------

            if own_has_ball and player.has_ball:
                player.action = "dribbling"

                self.attack_run(
                    team,
                    player,
                    dt
                )

                continue

            # -------------------------------------------------
            # ATTACKING
            # -------------------------------------------------

            if own_has_ball:
                self.attack_position(
                    team,
                    player,
                    mentality,
                    width,
                    dt
                )

                continue

            # -------------------------------------------------
            # DEFENDING
            # -------------------------------------------------

            self.defensive_position(
                team,
                opponent,
                player,
                dt
            )

    def attack_position(
        self,
        team,
        player,
        mentality,
        width,
        dt
    ):
        base_x = player.home_x
        base_y = player.home_y

        attack_strength = {
            "defensive": -5,
            "balanced": 0,
            "attacking": 7,
            "very_attacking": 12
        }.get(
            mentality,
            0
        )

        direction = (
            1
            if team.side == "home"
            else -1
        )

        target_x = (
            base_x +
            (
                attack_strength *
                direction
            )
        )

        ball_influence = 0.25

        target_x = lerp(
            target_x,
            self.ball.x,
            ball_influence
        )

        width_amount = {
            "narrow": -5,
            "normal": 0,
            "wide": 6
        }.get(
            width,
            0
        )

        if player.position_name in [
            "LW",
            "RW",
            "LM",
            "RM"
        ]:
            if player.y < 32:
                target_y -= width_amount
            else:
                target_y += width_amount

        player.action = "attacking"

        player.move_towards(
            target_x,
            clamp(
                base_y,
                5,
                59
            ),
            dt
        )

    def attack_run(
        self,
        team,
        player,
        dt
    ):
        direction = (
            1
            if team.side == "home"
            else -1
        )

        target_x = (
            player.x +
            direction *
            (
                3.0 +
                (
                    player.pace /
                    100.0
                ) *
                4
            )
        )

        target_y = (
            32 +
            random.uniform(
                -5,
                5
            )
        )

        player.move_towards(
            clamp(
                target_x,
                5,
                95
            ),
            target_y,
            dt
        )

    def defensive_position(
        self,
        team,
        opponent,
        player,
        dt
    ):
        direction = (
            1
            if team.side == "home"
            else -1
        )

        defensive_line = team.get_defensive_line()

        line_offset = {
            "deep": -5,
            "normal": 0,
            "high": 5,
            "very_high": 9
        }.get(
            defensive_line,
            0
        )

        line_offset *= direction

        target_x = (
            player.home_x +
            line_offset
        )

        # Move block towards ball.
        target_x = lerp(
            target_x,
            self.ball.x,
            0.15
        )

        target_y = lerp(
            player.home_y,
            self.ball.y,
            0.12
        )

        player.action = "defending"

        player.move_towards(
            target_x,
            clamp(
                target_y,
                4,
                60
            ),
            dt
        )

    # -----------------------------------------------------
    # BALL
    # -----------------------------------------------------

    def reset_ball(self):
        self.ball.x = 50
        self.ball.y = 32

        self.ball.stop()

        self.ball.owner_id = None

        self.ball.state = "free"

        for player in (
            self.home.active +
            self.away.active
        ):
            player.has_ball = False

    def player_by_id(self, player_id):
        if not player_id:
            return None

        for player in (
            self.home.players +
            self.away.players
        ):
            if player.id == str(player_id):
                return player

        return None

    def follow_ball_owner(self):
        player = self.player_by_id(
            self.ball.owner_id
        )

        if not player:
            self.ball.owner_id = None
            return

        self.ball.x = player.x
        self.ball.y = player.y

        self.ball.state = "controlled"

    def nearest_player(
        self,
        side,
        x,
        y
    ):
        team = (
            self.home
            if side == "home"
            else self.away
        )

        available = [
            p
            for p in team.active
            if p.on_pitch
        ]

        if not available:
            return None

        return min(
            available,
            key=lambda p:
                distance(
                    p.x,
                    p.y,
                    x,
                    y
                )
        )

    def nearest_opponent(
        self,
        player
    ):
        opponent = (
            self.away
            if player.side == "home"
            else self.home
        )

        players = [
            p
            for p in opponent.active
            if p.on_pitch
        ]

        if not players:
            return None

        return min(
            players,
            key=lambda p:
                distance(
                    p.x,
                    p.y,
                    player.x,
                    player.y
                )
        )

    # -----------------------------------------------------
    # DECISION MAKING
    # -----------------------------------------------------

    def make_decision(self):
        owner = self.player_by_id(
            self.ball.owner_id
        )

        if owner is None:
            self.resolve_free_ball()
            return

        team = (
            self.home
            if owner.side == "home"
            else self.away
        )

        opponent = (
            self.away
            if owner.side == "home"
            else self.home
        )

        self.possession_side = team.side

        goal_x = (
            100
            if team.side == "home"
            else 0
        )

        goal_distance = distance(
            owner.x,
            owner.y,
            goal_x,
            32
        )

        box = self.in_penalty_box(
            owner.x,
            owner.y,
            team.side
        )

        # SHOOTING
        if (
            goal_distance < 24
            and
            (
                box
                or random.random() < 0.30
            )
        ):
            self.shoot(
                team,
                opponent,
                owner
            )
            return

        # DRIBBLE
        pressure = self.nearest_opponent(
            owner
        )

        pressure_distance = (
            distance(
                owner.x,
                owner.y,
                pressure.x,
                pressure.y
            )
            if pressure
            else 50
        )

        if (
            pressure_distance < 9
            and
            owner.dribbling >= 55
        ):
            if random.random() < (
                owner.dribbling /
                130
            ):
                self.dribble(
                    owner,
                    pressure
                )
                return

            self.tackle(
                pressure,
                owner
            )
            return

        # PASS
        if random.random() < 0.72:
            target = self.find_pass_target(
                team,
                owner
            )

            if target:
                self.pass_ball(
                    team,
                    owner,
                    target
                )
                return

        # DRIBBLE FORWARD
        self.dribble(
            owner,
            pressure
        )

    # -----------------------------------------------------
    # FREE BALL
    # -----------------------------------------------------

    def resolve_free_ball(self):
        home_player = self.nearest_player(
            "home",
            self.ball.x,
            self.ball.y
        )

        away_player = self.nearest_player(
            "away",
            self.ball.x,
            self.ball.y
        )

        if not home_player and not away_player:
            return

        home_distance = (
            distance(
                home_player.x,
                home_player.y,
                self.ball.x,
                self.ball.y
            )
            if home_player
            else 999
        )

        away_distance = (
            distance(
                away_player.x,
                away_player.y,
                self.ball.x,
                self.ball.y
            )
            if away_player
            else 999
        )

        winner = (
            home_player
            if home_distance <= away_distance
            else away_player
        )

        if (
            min(
                home_distance,
                away_distance
            ) < 3
        ):
            self.give_ball(
                winner
            )

    def give_ball(self, player):
        for p in (
            self.home.active +
            self.away.active
        ):
            p.has_ball = False

        player.has_ball = True

        self.ball.owner_id = player.id

        self.ball.last_touch_side = (
            player.side
        )

        self.ball.state = "controlled"

        self.possession_side = (
            player.side
        )

    # -----------------------------------------------------
    # PASSING
    # -----------------------------------------------------

    def find_pass_target(
        self,
        team,
        owner
    ):
        candidates = []

        direction = (
            1
            if team.side == "home"
            else -1
        )

        for player in team.active:
            if (
                player.id ==
                owner.id
            ):
                continue

            if not player.on_pitch:
                continue

            d = distance(
                owner.x,
                owner.y,
                player.x,
                player.y
            )

            if d > 35:
                continue

            forward_gain = (
                player.x -
                owner.x
            ) * direction

            score = (
                player.passing * 0.20 +
                player.overall * 0.20 +
                forward_gain * 2 -
                d * 0.5 +
                random.uniform(
                    -8,
                    8
                )
            )

            candidates.append(
                (
                    score,
                    player
                )
            )

        if not candidates:
            return None

        candidates.sort(
            key=lambda item:
                item[0],
            reverse=True
        )

        return candidates[0][1]

    def pass_ball(
        self,
        team,
        owner,
        target
    ):
        accuracy = clamp(
            (
                owner.passing /
                100
            ),
            0.35,
            0.98
        )

        team.stats["passes"] += 1

        for p in (
            self.home.active +
            self.away.active
        ):
            p.has_ball = False

        if random.random() < accuracy:
            target_x = target.x
            target_y = target.y

            self.ball.owner_id = None

            self.ball.state = "passing"

            self.ball.target_x = target_x
            self.ball.target_y = target_y

            nx, ny = normalize_vector(
                target_x - owner.x,
                target_y - owner.y
            )

            speed = 22

            self.ball.vx = nx * speed
            self.ball.vy = ny * speed

            target.action = "receiving"

            team.stats[
                "passesCompleted"
            ] += 1

            self.add_event(
                "pass",
                team.side,
                f"{owner.name} passed to {target.name}"
            )

        else:
            error_x = (
                target.x +
                random.uniform(
                    -9,
                    9
                )
            )

            error_y = (
                target.y +
                random.uniform(
                    -7,
                    7
                )
            )

            self.ball.owner_id = None

            self.ball.state = "passing"

            nx, ny = normalize_vector(
                error_x - owner.x,
                error_y - owner.y
            )

            self.ball.vx = nx * 18
            self.ball.vy = ny * 18

            self.add_event(
                "bad_pass",
                team.side,
                f"{owner.name} misplaced the pass"
            )

    # -----------------------------------------------------
    # DRIBBLING
    # -----------------------------------------------------

    def dribble(
        self,
        owner,
        defender=None
    ):
        team = (
            self.home
            if owner.side == "home"
            else self.away
        )

        team.stats[
            "dribbles"
        ] += 1

        direction = (
            1
            if owner.side == "home"
            else -1
        )

        target_x = (
            owner.x +
            direction *
            random.uniform(
                4,
                9
            )
        )

        target_y = (
            owner.y +
            random.uniform(
                -5,
                5
            )
        )

        owner.has_ball = True

        owner.action = "dribbling"

        owner.move_towards(
            target_x,
            clamp(
                target_y,
                4,
                60
            ),
            0.6
        )

        self.ball.x = owner.x
        self.ball.y = owner.y

        if defender:
            pressure = distance(
                owner.x,
                owner.y,
                defender.x,
                defender.y
            )

            success = (
                owner.dribbling /
                (
                    owner.dribbling +
                    defender.defending +
                    1
                )
            )

            if pressure < 5:
                success *= 0.75

            if random.random() < success:
                team.stats[
                    "successfulDribbles"
                ] += 1

                self.add_event(
                    "dribble",
                    team.side,
                    f"{owner.name} beats the defender"
                )
            else:
                owner.has_ball = False

                self.ball.owner_id = None

                self.ball.state = "free"

                self.add_event(
                    "dispossessed",
                    defender.side,
                    f"{defender.name} wins the ball"
                )

    # -----------------------------------------------------
    # TACKLING
    # -----------------------------------------------------

    def tackle(
        self,
        defender,
        attacker
    ):
        team = (
            self.home
            if defender.side == "home"
            else self.away
        )

        team.stats[
            "tackles"
        ] += 1

        chance = (
            defender.defending /
            (
                defender.defending +
                attacker.dribbling +
                1
            )
        )

        if random.random() < chance:
            team.stats[
                "tacklesWon"
            ] += 1

            attacker.has_ball = False

            defender.has_ball = True

            self.ball.owner_id = (
                defender.id
            )

            self.ball.state = "controlled"

            self.possession_side = (
                defender.side
            )

            defender.action = "tackling"

            self.add_event(
                "tackle",
                defender.side,
                f"{defender.name} wins the ball"
            )

        else:
            team.stats[
                "fouls"
            ] += 1

            self.add_event(
                "foul",
                defender.side,
                f"{defender.name} commits a foul"
            )

    # -----------------------------------------------------
    # SHOOTING
    # -----------------------------------------------------

    def shoot(
        self,
        team,
        opponent,
        shooter
    ):
        team.stats[
            "shots"
        ] += 1

        goal_x = (
            100
            if team.side == "home"
            else 0
        )

        target_y = random.uniform(
            25,
            39
        )

        distance_goal = distance(
            shooter.x,
            shooter.y,
            goal_x,
            32
        )

        goalkeeper = opponent.goalkeeper()

        keeper_quality = (
            goalkeeper.defending
            if goalkeeper
            else 60
        )

        base_chance = (
            shooter.shooting /
            100
        )

        distance_penalty = clamp(
            distance_goal /
            70,
            0.1,
            0.85
        )

        pressure = self.nearest_opponent(
            shooter
        )

        pressure_penalty = 0

        if pressure:
            pressure_distance = distance(
                shooter.x,
                shooter.y,
                pressure.x,
                pressure.y
            )

            if pressure_distance < 5:
                pressure_penalty = 0.22

        chance = (
            base_chance *
            (1 - distance_penalty) *
            0.48
            -
            (
                keeper_quality /
                100
            ) *
            0.12
            -
            pressure_penalty
        )

        chance = clamp(
            chance,
            0.03,
            0.78
        )

        shooter.has_ball = False

        self.ball.owner_id = None

        self.ball.state = "shot"

        nx, ny = normalize_vector(
            goal_x - shooter.x,
            target_y - shooter.y
        )

        speed = random.uniform(
            24,
            34
        )

        self.ball.vx = nx * speed
        self.ball.vy = ny * speed

        on_target = (
            random.random() <
            clamp(
                shooter.shooting /
                100,
                0.25,
                0.9
            )
        )

        if on_target:
            team.stats[
                "shotsOnTarget"
            ] += 1

        self.add_event(
            "shot",
            team.side,
            f"{shooter.name} shoots"
        )

        if random.random() < chance:
            self.score[
                team.side
            ] += 1

            team.stats[
                "shotsOnTarget"
            ] += 1

            self.ball.x = goal_x

            self.ball.y = 32

            self.ball.stop()

            self.ball.state = "goal"

            self.add_event(
                "goal",
                team.side,
                f"GOAL! {shooter.name} scores"
            )

            self.reset_after_goal(
                team.side
            )

        else:
            if random.random() < 0.30:
                self.handle_corner(
                    opponent,
                    team
                )
            else:
                self.ball.state = "free"

    # -----------------------------------------------------
    # GOAL RESET
    # -----------------------------------------------------

    def reset_after_goal(
        self,
        scoring_side
    ):
        self.home.reset_positions()
        self.away.reset_positions()

        self.possession_side = (
            "away"
            if scoring_side == "home"
            else "home"
        )

        self.ball.x = 50
        self.ball.y = 32

        self.ball.stop()

        self.ball.state = "free"

        self.ball.owner_id = None

    # -----------------------------------------------------
    # BOX
    # -----------------------------------------------------

    def in_penalty_box(
        self,
        x,
        y,
        side
    ):
        if side == "home":
            return (
                x >= 82
                and
                19 <= y <= 45
            )

        return (
            x <= 18
            and
            19 <= y <= 45
        )

    # -----------------------------------------------------
    # CORNER
    # -----------------------------------------------------

    def handle_corner(
        self,
        defending_team,
        attacking_team
    ):
        attacking_team.stats[
            "corners"
        ] += 1

        if self.ball.x > 50:
            corner_x = 96
        else:
            corner_x = 4

        corner_y = (
            3
            if self.ball.y < 32
            else 61
        )

        self.ball.x = corner_x
        self.ball.y = corner_y

        self.ball.stop()

        self.ball.owner_id = None

        self.ball.state = "corner"

        self.add_event(
            "corner",
            attacking_team.side,
            f"Corner for {attacking_team.name}"
        )

        self.corner_play(
            attacking_team,
            defending_team
        )

    def corner_play(
        self,
        attacking,
        defending
    ):
        taker = min(
            attacking.active,
            key=lambda p:
                distance(
                    p.x,
                    p.y,
                    self.ball.x,
                    self.ball.y
                )
        )

        target = max(
            attacking.active,
            key=lambda p:
                p.shooting +
                p.overall +
                random.uniform(
                    -10,
                    10
                )
        )

        target.x = (
            90
            if attacking.side == "home"
            else 10
        )

        target.y = random.uniform(
            24,
            40
        )

        self.ball.owner_id = None

        self.ball.state = "corner_cross"

        nx, ny = normalize_vector(
            target.x - self.ball.x,
            target.y - self.ball.y
        )

        self.ball.vx = nx * 20
        self.ball.vy = ny * 20

        self.add_event(
            "corner_cross",
            attacking.side,
            f"{taker.name} takes the corner"
        )

    # -----------------------------------------------------
    # BOUNDARIES
    # -----------------------------------------------------

    def handle_ball_boundaries(self):
        if self.ball.state in [
            "goal",
            "corner",
            "corner_cross"
        ]:
            return

        if self.ball.x < 0:
            self.ball.x = 1

            self.ball.stop()

            self.ball.owner_id = None

            self.ball.state = "free"

            self.restart_from_line(
                "away"
            )

        elif self.ball.x > 100:
            self.ball.x = 99

            self.ball.stop()

            self.ball.owner_id = None

            self.ball.state = "free"

            self.restart_from_line(
                "home"
            )

        if self.ball.y < 0:
            self.ball.y = 2

            self.ball.stop()

            self.ball.owner_id = None

            self.ball.state = "free"

            self.restart_throw_in()

        elif self.ball.y > 64:
            self.ball.y = 62

            self.ball.stop()

            self.ball.owner_id = None

            self.ball.state = "free"

            self.restart_throw_in()

    def restart_from_line(self, side):
        player = self.nearest_player(
            side,
            self.ball.x,
            self.ball.y
        )

        if player:
            self.give_ball(
                player
            )

    def restart_throw_in(self):
        side = (
            "home"
            if self.possession_side == "away"
            else "away"
        )

        player = self.nearest_player(
            side,
            self.ball.x,
            self.ball.y
        )

        if player:
            self.give_ball(
                player
            )

            self.add_event(
                "throw_in",
                side,
                f"{player.name} takes a throw-in"
            )

    # -----------------------------------------------------
    # POSSESSION
    # -----------------------------------------------------

    def update_possession_stats(
        self,
        dt
    ):
        if self.possession_side == "home":
            self.home.stats[
                "possessionSeconds"
            ] += dt
        else:
            self.away.stats[
                "possessionSeconds"
            ] += dt

    # -----------------------------------------------------
    # SUBSTITUTION
    # -----------------------------------------------------

    def substitute(
        self,
        side,
        outgoing_id,
        incoming_id
    ):
        team = (
            self.home
            if side == "home"
            else self.away
        )

        if team.substitutions_used >= 5:
            return {
                "success": False,
                "message":
                    "Maximum substitutions reached"
            }

        outgoing = team.player_by_id(
            outgoing_id
        )

        incoming = team.player_by_id(
            incoming_id
        )

        if not outgoing or not incoming:
            return {
                "success": False,
                "message":
                    "Player not found"
            }

        if outgoing not in team.active:
            return {
                "success": False,
                "message":
                    "Outgoing player is not active"
            }

        if incoming in team.active:
            return {
                "success": False,
                "message":
                    "Incoming player is already playing"
            }

        outgoing.on_pitch = False
        outgoing.substituted = True
        outgoing.has_ball = False

        incoming.on_pitch = True
        incoming.substituted = False
        incoming.energy = 100

        index = team.active.index(
            outgoing
        )

        team.active[index] = incoming

        team.substitutions_used += 1

        team.reset_positions()

        if self.ball.owner_id == outgoing.id:
            self.ball.owner_id = None
            self.ball.state = "free"

        self.add_event(
            "substitution",
            side,
            f"{incoming.name} replaces {outgoing.name}"
        )

        return {
            "success": True,
            "message":
                f"{incoming.name} replaces {outgoing.name}",
            "snapshot":
                self.snapshot()
        }

    # -----------------------------------------------------
    # TACTICS
    # -----------------------------------------------------

    def set_tactics(
        self,
        side,
        tactics
    ):
        team = (
            self.home
            if side == "home"
            else self.away
        )

        team.set_tactics(
            tactics
        )

        self.add_event(
            "tactics",
            side,
            f"{team.name} changed tactics"
        )

        return self.snapshot()

    def set_formation(
        self,
        side,
        formation
    ):
        team = (
            self.home
            if side == "home"
            else self.away
        )

        team.set_formation(
            formation
        )

        self.add_event(
            "formation",
            side,
            f"{team.name} changed formation to {formation}"
        )

        return self.snapshot()

    # -----------------------------------------------------
    # EVENTS
    # -----------------------------------------------------

    def add_event(
        self,
        event_type,
        side,
        text
    ):
        event = {
            "id":
                f"{self.match_id}-{len(self.events)+1}-{int(time.time()*1000)}",

            "minute":
                self.minute,

            "second":
                self.second,

            "type":
                event_type,

            "side":
                side,

            "team":
                side,

            "text":
                text,

            "message":
                text,

            "timestamp":
                int(
                    time.time() * 1000
                )
        }

        self.events.append(
            event
        )

        if len(self.events) > self.max_events:
            self.events = (
                self.events[
                    -self.max_events:
                ]
            )

    # -----------------------------------------------------
    # SNAPSHOT
    # -----------------------------------------------------

    def snapshot(self):
        home_possession = (
            self.home.stats[
                "possessionSeconds"
            ]
        )

        away_possession = (
            self.away.stats[
                "possessionSeconds"
            ]
        )

        total_possession = (
            home_possession +
            away_possession
        )

        if total_possession <= 0:
            home_percentage = 50
            away_percentage = 50
        else:
            home_percentage = round(
                (
                    home_possession /
                    total_possession
                ) * 100
            )

            away_percentage = (
                100 -
                home_percentage
            )

        home_stats = deepcopy(
            self.home.stats
        )

        away_stats = deepcopy(
            self.away.stats
        )

        home_stats[
            "possession"
        ] = home_percentage

        away_stats[
            "possession"
        ] = away_percentage

        return {
            "matchId": self.match_id,

            "status": self.status,

            "phase": self.phase,

            "minute": self.minute,

            "second": self.second,

            "score": {
                "home":
                    self.score["home"],
                "away":
                    self.score["away"]
            },

            "homeScore":
                self.score["home"],

            "awayScore":
                self.score["away"],

            "home": {
                **self.home.serialize(),
                "stats":
                    home_stats
            },

            "away": {
                **self.away.serialize(),
                "stats":
                    away_stats
            },

            "ball":
                self.ball.serialize(),

            "events":
                deepcopy(
                    self.events
                ),

            "result":
                (
                    "home"
                    if self.score["home"] >
                    self.score["away"]
                    else (
                        "away"
                        if self.score["away"] >
                        self.score["home"]
                        else "draw"
                    )
                ),

            "running":
                self.status == "live",

            "finished":
                self.status == "finished"
        }


class MatchManager:

    def __init__(self):
        self.matches = {}

    def create(self, config):
        match_id = str(
            config.get("matchId")
        )

        if match_id in self.matches:
            engine = self.matches[
                match_id
            ]

            return engine.snapshot()

        engine = MatchEngine(
            config
        )

        self.matches[
            match_id
        ] = engine

        return engine.snapshot()

    def get(self, match_id):
        return self.matches.get(
            str(match_id)
        )
