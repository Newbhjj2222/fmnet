import Vector2 from "./Vector2";

export function movePlayerTowards(player, target, dt) {
  player.setTarget(target.x, target.y);
  player.update(dt);
}

export function getDistance(a, b) {
  return Vector2.distance(new Vector2(a.x, a.y), new Vector2(b.x, b.y));
}

export function getDirection(from, to) {
  return new Vector2(to.x - from.x, to.y - from.y).normalize();
}

export function separatePlayers(players) {
  const min = 34;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d === 0 || d >= min) continue;
      const overlap = min - d;
      const nx = dx / d, ny = dy / d;
      a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
    }
  }
}
